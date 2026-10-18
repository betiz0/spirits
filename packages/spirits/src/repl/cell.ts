/**
 * Cell evaluation pipeline.
 *
 * Calls are serialized at the entry point, each cell runs inside its own
 * `AsyncLocalStorage` scope, and the persistent vm context is reused across cells.
 * Only `globalThis` assignments survive; declarations stay inside the async IIFE.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import vm from "node:vm";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { ReplContext } from "./context.ts";
import {
	type FormattedResult,
	formatFailure,
	formatRuntimeError,
	formatSuccess,
	formatSyntaxError,
} from "./format.ts";
import { isRecord } from "./guards.ts";
import type { CellMetrics, CellOutcome, ToolCallRecord } from "./metrics.ts";
import type { HostFnCallable, HostFnRegistry, HostFnScope } from "./registry.ts";
import {
	spillNotice,
	spillReason,
	spillToTempFile,
	type SpillOutcome,
	type SpillWriter,
} from "./spill.ts";
import { transpileCell } from "./transpile.ts";

/** Bounds of the cell-wide cutoff. Unit: ms. */
export const MIN_TIMEOUT = 500;
export const MAX_TIMEOUT = 2147483647;

/** Watchdog for the synchronous run before the cell's first `await`. Unit: ms. */
export const DEFAULT_SYNC_WATCHDOG = 30000;

const CELL_FILENAME = "tsrepl-cell.js";

export interface CellOptions {
	code: string;
	timeout?: number;
	reset?: boolean;
}

export interface ReplOptions {
	/** Destination for the whole text of a truncated result. Defaults to a file in `os.tmpdir()`. */
	writeOutput?: SpillWriter;
}

/** `Repl.run` result: the formatted text plus the measurement of the cell that produced it. */
export interface CellRunResult extends FormattedResult {
	metrics: CellMetrics;
}

/** One evaluation before measurement: what the model sees, how it ended, and whether `_` moved. */
interface Evaluation {
	result: FormattedResult;
	outcome: CellOutcome;
	underscoreSet: boolean;
}

function cellMetrics(
	evaluation: Evaluation,
	options: CellOptions,
	startedAt: number,
	spill: { outcome?: SpillOutcome },
	toolCalls: ToolCallRecord[],
): CellMetrics {
	const { result } = evaluation;
	return {
		outcome: evaluation.outcome,
		durationMs: Date.now() - startedAt,
		timeoutMs: resolveCellTimeouts(options.timeout).cellMs ?? null,
		reset: options.reset === true,
		codeChars: options.code.length,
		valueChars: result.details.value?.length ?? 0,
		printedChars: result.details.printed?.length ?? 0,
		outputChars: result.raw.length,
		truncated: result.details.truncated,
		spill: spill.outcome?.status ?? null,
		underscoreSet: evaluation.underscoreSet,
		toolCalls,
	};
}

interface CellState {
	hostFns: Map<string, HostFnCallable>;
	value: unknown;
}

export interface CellTimeouts {
	/** Cell-wide cutoff. `undefined` (no timeout specified) means the cell is never cut off. */
	cellMs: number | undefined;
	/** Watchdog applied to the synchronous run before the first `await`. Always set. */
	syncMs: number;
}

/**
 * Resolve the two cutoffs from the requested `timeout`. The cell-wide cutoff follows the request
 * (clamped). The synchronous watchdog stays at 30000ms for larger requests: a synchronous hang is
 * not cuttable by Esc once the vm call is past it, so it never waits for a huge cell timeout.
 */
export function resolveCellTimeouts(timeout: number | undefined): CellTimeouts {
	const cellMs = clampCellTimeout(timeout);
	return { cellMs, syncMs: Math.min(cellMs ?? DEFAULT_SYNC_WATCHDOG, DEFAULT_SYNC_WATCHDOG) };
}

function clampCellTimeout(timeout: number | undefined): number | undefined {
	// Only a value that is not a number, and NaN, mean "no timeout". `Infinity` clamps to the
	// maximum like any other oversized value, so the log still reports a `timeoutMs`.
	if (typeof timeout !== "number" || Number.isNaN(timeout)) {
		return undefined;
	}
	return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, timeout));
}

export class Repl {
	readonly #registry: HostFnRegistry;
	readonly #context: ReplContext;
	readonly #writeOutput: SpillWriter;
	readonly #storage = new AsyncLocalStorage<CellState>();
	#tail: Promise<unknown> = Promise.resolve();

	constructor(registry: HostFnRegistry, options: ReplOptions = {}) {
		this.#registry = registry;
		this.#writeOutput = options.writeOutput ?? spillToTempFile;
		this.#context = new ReplContext({
			registry,
			resolveHostFn: (name) => this.#storage.getStore()?.hostFns.get(name),
		});
	}

	/** Serialize cells and run one. `toolContext` supplies cwd, signal, and executeTool. */
	async run(options: CellOptions, toolContext: ExtensionToolContext): Promise<CellRunResult> {
		const previous = this.#tail;
		let release: () => void = () => {};
		this.#tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await this.#runCell(options, toolContext);
		} finally {
			release();
		}
	}

	/** One cell run: the model-facing result plus the measurement of the same cell. */
	async #runCell(options: CellOptions, toolContext: ExtensionToolContext): Promise<CellRunResult> {
		const startedAt = Date.now();
		const toolCalls: ToolCallRecord[] = [];
		const spill: { outcome?: SpillOutcome } = {};
		const evaluation = await this.#evaluate(options, toolContext, toolCalls, spill);
		return { ...evaluation.result, metrics: cellMetrics(evaluation, options, startedAt, spill, toolCalls) };
	}

	async #evaluate(
		options: CellOptions,
		toolContext: ExtensionToolContext,
		toolCalls: ToolCallRecord[],
		spill: { outcome?: SpillOutcome },
	): Promise<Evaluation> {
		if (options.reset === true) {
			this.#context.reset();
		}

		const transpiled = transpileCell(options.code);
		if (!transpiled.ok) {
			return {
				result: await this.#spillFormatted(formatFailure(formatSyntaxError(transpiled)), spill),
				outcome: "error",
				underscoreSet: false,
			};
		}

		const printed: string[] = [];
		const controller = new AbortController();
		const unlinkExternal = linkAbort(toolContext.signal, controller);
		const { cellMs, syncMs } = resolveCellTimeouts(options.timeout);
		const timeoutError = cellMs === undefined ? undefined : new TimeoutError(cellMs);
		const abortError = new AbortError();

		const state: CellState = { hostFns: new Map(), value: undefined };
		const scope: HostFnScope = {
			signal: controller.signal,
			toolContext,
			print: (text) => {
				if (!scope.finished) {
					printed.push(text);
				}
			},
			setValue: (value) => {
				if (!scope.finished) {
					state.value = value;
				}
			},
			recordToolCall: (record) => {
				toolCalls.push(record);
			},
			finished: false,
		};
		for (const entry of this.#registry.list()) {
			state.hostFns.set(entry.name, entry.create(scope));
		}

		try {
			const returned = await this.#storage.run(state, async () => {
				const script = new vm.Script(transpiled.code, { filename: CELL_FILENAME });
				const execution = script.runInContext(this.#context.context, { timeout: syncMs }) as Promise<unknown>;
				return await raceTermination(execution, cellMs, timeoutError, controller.signal, abortError);
			});
			const value = typeof returned === "undefined" ? state.value : returned;
			// Only a cell that produced a value moves `_`. A print-only cell leaves it, and a failing
			// cell never reaches this line.
			const underscoreSet = typeof value !== "undefined";
			if (underscoreSet) {
				this.#context.setUnderscore(value);
			}
			return {
				result: await this.#spillFormatted(formatSuccess(printed.join("\n"), value), spill),
				outcome: "ok",
				underscoreSet,
			};
		} catch (error) {
			if (isTerminationError(error)) {
				const reason = terminationReason(error);
				return {
					result: await this.#spillFormatted(
						formatFailure(terminationMessage({ cellMs, syncMs }, reason)),
						spill,
					),
					outcome: reason === "abort" ? "aborted" : reason === "sync" ? "timeout_sync" : "timeout_cell",
					underscoreSet: false,
				};
			}
			return {
				result: await this.#spillFormatted(formatFailure(formatRuntimeError(error, transpiled.code)), spill),
				outcome: "error",
				underscoreSet: false,
			};
		} finally {
			scope.finished = true;
			controller.abort();
			unlinkExternal();
		}
	}

	/**
	 * Write the whole text of a truncated result and append where it went. A write failure never
	 * changes whether the cell succeeded; the result text names the failure instead of a path.
	 */
	async #spillFormatted(result: FormattedResult, spill: { outcome?: SpillOutcome }): Promise<FormattedResult> {
		if (!result.details.truncated) {
			return result;
		}
		try {
			const saved = { status: "saved" as const, path: await this.#writeOutput(result.raw) };
			spill.outcome = saved;
			return { ...result, text: `${result.text}${spillNotice(saved)}` };
		} catch (error) {
			const failed = { status: "failed" as const, reason: spillReason(error) };
			spill.outcome = failed;
			return { ...result, text: `${result.text}${spillNotice(failed)}` };
		}
	}
}

class TimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`cell execution exceeded ${timeoutMs}ms`);
		this.name = "TimeoutError";
	}
}

class AbortError extends Error {
	constructor() {
		super("cell execution aborted by the caller");
		this.name = "AbortError";
	}
}

/**
 * Race the cell promise against the timeout and an abort of `signal`. The same race
 * handles a timeout and a tool-call signal abort so both cut the cell's `await` and
 * produce the same error shape. The execution promise is always observed, so a late
 * rejection after the race settles is consumed instead of becoming unhandled.
 */
function raceTermination<T>(
	execution: Promise<T>,
	timeoutMs: number | undefined,
	timeoutError: Error | undefined,
	signal: AbortSignal,
	abortError: Error,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let handle: ReturnType<typeof setTimeout> | undefined;

		function finish(): boolean {
			if (settled) {
				return false;
			}
			settled = true;
			if (handle !== undefined) {
				clearTimeout(handle);
			}
			signal.removeEventListener("abort", onAbort);
			return true;
		}

		function onAbort(): void {
			if (finish()) {
				reject(abortError);
			}
		}

		if (timeoutMs !== undefined && timeoutError !== undefined) {
			handle = setTimeout(() => {
				if (finish()) {
					reject(timeoutError);
				}
			}, timeoutMs);
		}

		if (signal.aborted) {
			onAbort();
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		execution.then(
			(value) => {
				if (finish()) {
					resolve(value);
				}
			},
			(error: unknown) => {
				if (finish()) {
					reject(error);
				}
			},
		);
	});
}

function linkAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
	if (signal === undefined) {
		return () => {};
	}
	if (signal.aborted) {
		controller.abort(signal.reason);
		return () => {};
	}
	const onAbort = (): void => controller.abort(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

function isTerminationError(error: unknown): boolean {
	if (error instanceof TimeoutError || error instanceof AbortError) {
		return true;
	}
	// The vm's synchronous timeout is a plain Error with `ERR_SCRIPT_EXECUTION_TIMEOUT`.
	// Message matching ("timeout") would misfire on host errors that merely mention a
	// timeout, such as `use("./timeout-utils.ts")` failing to import.
	return isRecord(error) && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}

type TerminationReason = "timeout" | "sync" | "abort";

function terminationReason(error: unknown): TerminationReason {
	if (error instanceof AbortError) {
		return "abort";
	}
	// The vm's synchronous watchdog is the only termination left that is not this file's own error.
	return isRecord(error) && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "sync" : "timeout";
}

function terminationMessage(timeouts: CellTimeouts, reason: TerminationReason): string {
	const { cellMs, syncMs } = timeouts;
	const lines: string[] = [];
	if (reason === "sync") {
		lines.push(`TimeoutError: 同期実行（最初の await より前）が上限 ${syncMs}ms を超えたため打ち切りました。`);
	} else if (reason === "timeout") {
		lines.push(`TimeoutError: 実行が ${cellMs}ms を超えたため打ち切りました。`);
	} else {
		lines.push("AbortError: 呼び出し元の中断により実行を打ち切りました。");
	}
	lines.push("部分実行により永続コンテキストが不整合になっている可能性があります。");
	lines.push("`reset: true` でコンテキストを初期化できます。");
	lines.push(
		reason === "sync"
			? "提案: 処理を `await` を含む単位へ分割してください(例: 大きなループを数行ごとに `await null` で区切る、または `timeout` を指定する)。"
			: "提案: reset: true で再生成するか、timeout を増やして再実行してください。",
	);
	return lines.join("\n");
}
