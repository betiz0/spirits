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
import type { HostFnCallable, HostFnRegistry, HostFnScope } from "./registry.ts";
import { transpileCell } from "./transpile.ts";

export const DEFAULT_TIMEOUT = 30000;
export const MIN_TIMEOUT = 500;
export const MAX_TIMEOUT = 120000;

const CELL_FILENAME = "tsrepl-cell.js";

export interface CellOptions {
	code: string;
	timeout?: number;
	reset?: boolean;
}

interface CellState {
	hostFns: Map<string, HostFnCallable>;
	value: unknown;
}

export function clampTimeout(timeout: number | undefined): number {
	if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
		return DEFAULT_TIMEOUT;
	}
	return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, timeout));
}

export class Repl {
	readonly #registry: HostFnRegistry;
	readonly #context: ReplContext;
	readonly #storage = new AsyncLocalStorage<CellState>();
	#tail: Promise<unknown> = Promise.resolve();

	constructor(registry: HostFnRegistry) {
		this.#registry = registry;
		this.#context = new ReplContext({
			registry,
			resolveHostFn: (name) => this.#storage.getStore()?.hostFns.get(name),
		});
	}

	/** Serialize cells and run one. `toolContext` supplies cwd, signal, and executeTool. */
	async run(options: CellOptions, toolContext: ExtensionToolContext): Promise<FormattedResult> {
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

	async #runCell(options: CellOptions, toolContext: ExtensionToolContext): Promise<FormattedResult> {
		if (options.reset === true) {
			this.#context.reset();
		}

		const transpiled = transpileCell(options.code);
		if (!transpiled.ok) {
			return formatFailure(formatSyntaxError(transpiled));
		}

		const printed: string[] = [];
		const controller = new AbortController();
		const unlinkExternal = linkAbort(toolContext.signal, controller);
		const timeoutMs = clampTimeout(options.timeout);
		const timeoutError = new TimeoutError(timeoutMs);
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
			finished: false,
		};
		for (const entry of this.#registry.list()) {
			state.hostFns.set(entry.name, entry.create(scope));
		}

		try {
			const returned = await this.#storage.run(state, async () => {
				const script = new vm.Script(transpiled.code, { filename: CELL_FILENAME });
				const execution = script.runInContext(this.#context.context, { timeout: timeoutMs }) as Promise<unknown>;
				return await raceTermination(execution, timeoutMs, timeoutError, controller.signal, abortError);
			});
			const value = typeof returned === "undefined" ? state.value : returned;
			return formatSuccess(printed.join("\n"), value);
		} catch (error) {
			if (isTerminationError(error)) {
				return formatFailure(terminationMessage(timeoutMs, error instanceof AbortError ? "abort" : "timeout"));
			}
			return formatFailure(formatRuntimeError(error, transpiled.code));
		} finally {
			scope.finished = true;
			controller.abort();
			unlinkExternal();
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
	timeoutMs: number,
	timeoutError: Error,
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

		handle = setTimeout(() => {
			if (finish()) {
				reject(timeoutError);
			}
		}, timeoutMs);

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

function terminationMessage(timeoutMs: number, reason: "timeout" | "abort"): string {
	const lead =
		reason === "timeout"
			? `TimeoutError: 実行が ${timeoutMs}ms を超えたため打ち切りました。`
			: "AbortError: 呼び出し元の中断により実行を打ち切りました。";
	return [
		lead,
		"部分実行により永続コンテキストが不整合になっている可能性があります。",
		"`reset: true` でコンテキストを初期化できます。",
		"提案: reset: true で再生成するか、timeout を増やして再実行してください。",
	].join("\n");
}
