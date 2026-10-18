/**
 * The `rlm` host function.
 *
 * `rlm(prompt, opts?)` runs a child agent session synchronously and returns its final answer as a
 * string. Depth and the child limit live in this closure (never in the REPL context), calls from
 * one REPL are serialized through a single queue, and every call appends exactly one `rlm_usage`
 * custom entry to the root session's `pi`.
 *
 * The actual child session is injected as `spawn` (`rlm/spawn.ts` in production), so the depth,
 * validation, serialization, abort, and usage logic here runs without a provider.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../repl/guards.ts";
import type { HostFnCallable, HostFnEntry, HostFnScope } from "../repl/registry.ts";
import { createTsreplTool } from "../tools.ts";
import { depthLimitError, resolveChildMaxDepth, RLM_MAX_CHILD_DURATION_MS } from "./depth.ts";
import { buildRlmGuidance } from "./guidance.ts";
import type { RlmOutcome, RlmRunResult, RlmTokens, SpawnParams } from "./spawn.ts";

/** Injected child-session runner. Production passes `spawnChildSession`. */
export type SpawnFn = (params: SpawnParams) => Promise<RlmRunResult>;

export interface CreateRlmHostFnOptions {
	/** Root session extension API. Nested host functions must receive the same instance. */
	pi: Pick<ExtensionAPI, "appendEntry">;
	/** Depth of the session that owns this host function (root is 0). */
	depth: number;
	/** Depth limit applied to this session. */
	maxDepth: number;
	spawn: SpawnFn;
	/**
	 * Wall-clock limit of one child run, for tests only. Production always takes
	 * `RLM_MAX_CHILD_DURATION_MS`.
	 */
	maxChildDurationMs?: number;
}

/** Returned when a call is aborted while waiting or while the child runs. */
export const RLM_ABORTED_NOTICE = "rlm: 呼び出しは中断されました。";

const ZERO_TOKENS: RlmTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

interface ParsedArgs {
	prompt: string;
	requestedMaxDepth: number | undefined;
}

export function createRlmHostFn(options: CreateRlmHostFnOptions): HostFnEntry {
	const { pi, depth, maxDepth, spawn } = options;
	const childDurationLimitMs = options.maxChildDurationMs ?? RLM_MAX_CHILD_DURATION_MS;
	// One queue per REPL (per `createRlmHostFn` instance, shared across cells). Different depths
	// create separate instances, so a parent waiting on a child never blocks the child's own calls.
	let tail: Promise<void> = Promise.resolve();

	return {
		name: "rlm",
		description: buildRlmGuidance({ depth, maxDepth }),
		create(scope: HostFnScope): HostFnCallable {
			return async (prompt: unknown, opts?: unknown): Promise<string> => {
				const started = Date.now();
				const model = scope.toolContext.model;
				const appendUsage = (
					outcome: RlmOutcome,
					sessionId: string | null,
					usage?: { tokens: RlmTokens; cost: number },
				): void => {
					pi.appendEntry("rlm_usage", {
						depth: depth + 1,
						sessionId,
						provider: model?.provider ?? null,
						modelId: model?.id ?? null,
						tokens: usage?.tokens ?? ZERO_TOKENS,
						cost: usage?.cost ?? 0,
						durationMs: Date.now() - started,
						outcome,
					});
				};

				let parsed: ParsedArgs;
				try {
					parsed = parseArgs(prompt, opts);
				} catch (error) {
					appendUsage("error", null);
					throw error;
				}
				if (depth >= maxDepth) {
					appendUsage("error", null);
					throw depthLimitError(maxDepth);
				}
				if (model === undefined) {
					appendUsage("error", null);
					throw new Error("親セッションのモデルが設定されていないため、子エージェントを起動できません。");
				}

				const previous = tail;
				let release: () => void = () => {};
				tail = new Promise<void>((resolve) => {
					release = resolve;
				});
				let released = false;
				const releaseOnce = (): void => {
					if (!released) {
						released = true;
						release();
					}
				};

				const turn = await waitTurn(previous, scope.signal);
				if (turn === "aborted" || scope.signal.aborted) {
					// Keep FIFO order for later callers: release only after the running call finishes.
					void previous.finally(releaseOnce);
					appendUsage("aborted", null);
					return RLM_ABORTED_NOTICE;
				}

				// The duration limit starts here, after the queue wait, and cuts the child through the
				// signal handed to `spawn`. A child that still reports `completed` after the timer fired is
				// a child that finished, so its answer wins over the limit.
				const limit = newChildDurationLimit(childDurationLimitMs, scope.signal);
				try {
					const childMax = resolveChildMaxDepth(maxDepth, parsed.requestedMaxDepth);
					const childTool = createTsreplTool({
						hostFns: [createRlmHostFn({ pi, depth: depth + 1, maxDepth: childMax, spawn })],
						// A child has no bash, so the tool-selection rules do not apply to it.
						promptGuidelines: [],
					});
					const params: SpawnParams = {
						prompt: parsed.prompt,
						cwd: scope.toolContext.cwd,
						model,
						signal: limit.signal,
						childTool,
					};
					if (scope.toolContext.thinkingLevel !== undefined) {
						params.thinkingLevel = scope.toolContext.thinkingLevel;
					}

					let result: RlmRunResult;
					try {
						result = await spawn(params);
					} catch (error) {
						// `spawn` throwing is an unexpected path; still record exactly one entry.
						appendUsage("error", null);
						throw error;
					}
					if (limit.fired && result.outcome !== "completed") {
						appendUsage("aborted", result.sessionId, result);
						throw childDurationLimitError(childDurationLimitMs);
					}
					appendUsage(result.outcome, result.sessionId, result);
					if (result.outcome === "completed" || result.outcome === "budget") {
						return result.text;
					}
					if (result.outcome === "aborted") {
						return RLM_ABORTED_NOTICE;
					}
					throw errorFromResult(result);
				} finally {
					limit.stop();
					releaseOnce();
				}
			};
		},
	};
}

/**
 * The wall-clock limit of one child run, and the signal `spawn` receives: the caller's signal plus a
 * timer signal. `fired` says the timer (not the caller) cut the run.
 */
interface ChildDurationLimit {
	signal: AbortSignal;
	readonly fired: boolean;
	stop(): void;
}

function newChildDurationLimit(limitMs: number, caller: AbortSignal): ChildDurationLimit {
	const timer = new AbortController();
	let fired = false;
	const handle = setTimeout(() => {
		fired = true;
		timer.abort();
	}, limitMs);
	return {
		signal: AbortSignal.any([caller, timer.signal]),
		get fired(): boolean {
			return fired;
		},
		stop(): void {
			clearTimeout(handle);
		},
	};
}

/** Error for a child cut by the run-duration limit. Catchable in the cell. */
function childDurationLimitError(limitMs: number): Error {
	return new Error(
		`rlm: 子セッションの実行時間が上限（${limitMs}ms）を超えたため打ち切りました。委譲を分割するか、子に結果をファイルへ書かせてパスだけを返してください。`,
	);
}

/** Wait for this call's turn. Returns `aborted` if the scope signal aborts while waiting. */
function waitTurn(previous: Promise<void>, signal: AbortSignal): Promise<"ready" | "aborted"> {
	if (signal.aborted) {
		return Promise.resolve("aborted");
	}
	return new Promise<"ready" | "aborted">((resolve) => {
		let settled = false;
		const finish = (value: "ready" | "aborted"): void => {
			if (settled) {
				return;
			}
			settled = true;
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		};
		const onAbort = (): void => finish("aborted");
		signal.addEventListener("abort", onAbort, { once: true });
		previous.then(
			() => finish("ready"),
			() => finish("ready"),
		);
	});
}

function parseArgs(prompt: unknown, opts: unknown): ParsedArgs {
	if (typeof prompt !== "string") {
		throw new Error(`rlm: prompt は文字列でなければなりません（受信: ${typeof prompt}）。`);
	}
	if (prompt.trim() === "") {
		throw new Error("rlm: prompt を空または空白のみにすることはできません。");
	}
	if (opts === undefined) {
		return { prompt, requestedMaxDepth: undefined };
	}
	if (!isRecord(opts) || Array.isArray(opts)) {
		throw new Error("rlm: opts はオブジェクトでなければなりません（null と配列は指定できません）。");
	}
	for (const key of Object.keys(opts)) {
		if (key !== "maxDepth") {
			throw new Error(
				`rlm: 未知のオプション "${key}" が指定されました。opts は { maxDepth?: number } だけを受け付けます。`,
			);
		}
	}
	const maxDepthValue = opts.maxDepth;
	if (maxDepthValue === undefined) {
		return { prompt, requestedMaxDepth: undefined };
	}
	if (
		typeof maxDepthValue !== "number" ||
		!Number.isFinite(maxDepthValue) ||
		!Number.isInteger(maxDepthValue) ||
		maxDepthValue < 0
	) {
		throw new Error("rlm: opts.maxDepth は有限の非負整数でなければなりません。");
	}
	return { prompt, requestedMaxDepth: maxDepthValue };
}

function errorFromResult(result: RlmRunResult): Error {
	const message = result.errorMessage ?? "子セッションがエラーで終了しました。";
	return new Error(`rlm: ${message}`, { cause: new Error(message) });
}
