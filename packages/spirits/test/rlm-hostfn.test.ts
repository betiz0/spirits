import { expect, test } from "bun:test";
import type { ExtensionToolContext, PiModel } from "@earendil-works/pi-coding-agent";
import { PI_VIRTUAL_MODEL_API } from "../src/constants.ts";
import type { HostFnEntry, HostFnScope } from "../src/repl/registry.ts";
import { createTsreplTool } from "../src/tools.ts";
import { DEFAULT_MAX_DEPTH } from "../src/rlm/depth.ts";
import {
	RLM_ABORTED_NOTICE,
	createRlmHostFn,
	type ChildModelResolver,
	type SpawnFn,
} from "../src/rlm/hostfn.ts";
import type { RlmRunResult, RlmTokens, SpawnParams } from "../src/rlm/spawn.ts";
import { makeScope, makeToolContext } from "./support.ts";

const MODEL = { provider: "p", id: "m" };
const USAGE: RlmTokens = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 };

class FakePi {
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}
}

interface UsageEntry {
	depth: number;
	sessionId: string | null;
	provider: string | null;
	modelId: string | null;
	tokens: RlmTokens;
	cost: number;
	durationMs: number;
	outcome: string;
}

interface ScopeOptions {
	cwd?: string;
	signal?: AbortSignal;
	model?: typeof MODEL | undefined;
	thinkingLevel?: ExtensionToolContext["thinkingLevel"];
}

function rlmScope(options: ScopeOptions = {}): HostFnScope {
	const model = "model" in options ? options.model : MODEL;
	return makeScope({
		cwd: options.cwd ?? "/work",
		signal: options.signal,
		model,
		thinkingLevel: options.thinkingLevel,
	}).scope;
}

function completedResult(text: string): RlmRunResult {
	return { outcome: "completed", text, sessionId: "child-1", tokens: USAGE, cost: 0.02 };
}

function makeCountingSpawn(): { spawn: SpawnFn; count: () => number } {
	let count = 0;
	return {
		spawn: async () => {
			count++;
			return completedResult("ok");
		},
		count: () => count,
	};
}

function makeCapturingSpawn(result: RlmRunResult = completedResult("ok")): {
	spawn: SpawnFn;
	params: SpawnParams[];
} {
	const params: SpawnParams[] = [];
	return {
		spawn: async (spawnParams) => {
			params.push(spawnParams);
			return result;
		},
		params,
	};
}

function callRlm(entry: HostFnEntry, scope: HostFnScope, ...args: unknown[]): Promise<string> {
	return Promise.resolve(entry.create(scope)(...args)) as Promise<string>;
}

function usageEntries(pi: FakePi): UsageEntry[] {
	return pi.entries
		.filter((entry) => entry.customType === "rlm_usage")
		.map((entry) => entry.data as UsageEntry);
}

async function runCell(
	tool: SpawnParams["childTool"],
	code: string,
	model: PiModel | undefined = MODEL,
): Promise<{ isError: boolean; value: string; error: string }> {
	const result = await tool.execute("cell", { code }, undefined, undefined, makeToolContext({ cwd: "/work", model }));
	return {
		isError: result.isError === true,
		value: result.details.value ?? "",
		error: result.details.error ?? "",
	};
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// 4.1 entry handling
// ---------------------------------------------------------------------------

test("rejects non-string prompt", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope(), 42)).rejects.toThrow("prompt");
	expect(counting.count()).toBe(0);
});

test("rejects blank prompt", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope(), "   ")).rejects.toThrow("空");
	expect(counting.count()).toBe(0);
});

test("rejects unknown option key", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope(), "x", { model: "other" })).rejects.toThrow("model");
	expect(counting.count()).toBe(0);
});

test("rejects non-object opts", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope(), "x", null)).rejects.toThrow("opts");
	await expect(callRlm(entry, rlmScope(), "x", ["maxDepth"])).rejects.toThrow("opts");
	expect(counting.count()).toBe(0);
});

test("rejects invalid maxDepth", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	for (const value of [Number.NaN, -1, 1.5, "2"]) {
		await expect(callRlm(entry, rlmScope(), "x", { maxDepth: value })).rejects.toThrow("maxDepth");
	}
	expect(counting.count()).toBe(0);
});

test("accepts maxDepth 0", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	const value = await callRlm(entry, rlmScope(), "x", { maxDepth: 0 });
	expect(value).toBe("ok");
	expect(counting.count()).toBe(1);
});

test("depth limit throws without spawn", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 2, maxDepth: 2, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("深度上限（2）");
	expect(counting.count()).toBe(0);
});

test("depth limit message includes limit", async () => {
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 2, maxDepth: 2, spawn: makeCountingSpawn().spawn });
	let message = "";
	try {
		await callRlm(entry, rlmScope(), "x");
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("2");
	expect(message).toContain("現在の層");
});

test("maxDepth lowered", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: capturing.spawn });
	await callRlm(entry, rlmScope(), "x", { maxDepth: 1 });

	expect(capturing.params.length).toBe(1);
	const child = await runCell(capturing.params[0].childTool, 'return await rlm("y")');
	expect(child.isError).toBe(true);
	expect(child.error).toContain("深度上限（1）");
});

test("maxDepth raised is clamped", async () => {
	const capturing = makeCapturingSpawn(completedResult("nested ok"));
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: capturing.spawn });
	await callRlm(entry, rlmScope(), "x", { maxDepth: 5 });

	// Depth 1 child (limit clamped to 2) can spawn a depth 2 grandchild.
	const child = await runCell(capturing.params[0].childTool, 'return await rlm("y")');
	expect(child.isError).toBe(false);
	expect(child.value).toContain("nested ok");
	expect(capturing.params.length).toBe(2);

	// The grandchild is at depth 2, so rlm must fail with limit 2 (not the requested 5).
	const grandchild = await runCell(capturing.params[1].childTool, 'return await rlm("z")');
	expect(grandchild.isError).toBe(true);
	expect(grandchild.error).toContain("深度上限（2）");
	expect(capturing.params.length).toBe(2);
});

test("model missing throws without spawn", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: counting.spawn });
	await expect(callRlm(entry, rlmScope({ model: undefined }), "x")).rejects.toThrow("モデル");
	expect(counting.count()).toBe(0);
});

// ---------------------------------------------------------------------------
// 4.2 child tool and spawn parameters
// ---------------------------------------------------------------------------

test("returns child answer", async () => {
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: makeCapturingSpawn().spawn });
	const value = await callRlm(entry, rlmScope(), "x");
	expect(value).toBe("ok");
});

test("return type is string", async () => {
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: makeCapturingSpawn().spawn });
	const value = await callRlm(entry, rlmScope(), "x");
	expect(typeof value).toBe("string");
});

test("passes cwd model thinking level to spawn", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: capturing.spawn });
	await callRlm(entry, rlmScope({ cwd: "/custom", thinkingLevel: "high" }), "x");

	expect(capturing.params[0].cwd).toBe("/custom");
	expect(capturing.params[0].model).toEqual(MODEL);
	expect(capturing.params[0].thinkingLevel).toBe("high");
});

test("child tool exposes rlm at depth plus one", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: capturing.spawn });
	await callRlm(entry, rlmScope(), "x");

	const child = await runCell(capturing.params[0].childTool, "return typeof rlm");
	expect(child.value).toContain("function");
});

test("child tool context isolated", async () => {
	const childTools: SpawnParams["childTool"][] = [];
	const spawn: SpawnFn = async (params) => {
		childTools.push(params.childTool);
		return completedResult("ok");
	};
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn });

	await callRlm(entry, rlmScope(), "a");
	await callRlm(entry, rlmScope(), "b");
	const set = await runCell(childTools[0], 'globalThis.shared = 1; return "set"');
	const read = await runCell(childTools[1], "return typeof shared");

	expect(set.isError).toBe(false);
	expect(read.value).toContain("undefined");
});

test("child host fn names", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: capturing.spawn });
	await callRlm(entry, rlmScope(), "x");

	// The continual-harness host fns must never be wired into the child's tsrepl (M4 policy).
	const child = await runCell(
		capturing.params[0].childTool,
		"return [typeof out, typeof print, typeof use, typeof tool, typeof rlm, typeof goal, typeof note, typeof sh].join(',')",
	);
	// `sh` reaches the root tsrepl only: a child has no bash to run.
	expect(child.value).toContain("function,function,function,function,function,undefined,undefined,undefined");
});

test("nested depth 0-1-2", async () => {
	const childTools: SpawnParams["childTool"][] = [];
	const spawn: SpawnFn = async (params) => {
		childTools.push(params.childTool);
		return completedResult(`answer${childTools.length}`);
	};
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });

	const outer = await callRlm(entry, rlmScope(), "outer");
	expect(outer).toBe("answer1");

	const grand = await runCell(childTools[0], 'return await rlm("grand")');
	expect(grand.isError).toBe(false);
	expect(grand.value).toContain("answer2");

	const tooDeep = await runCell(childTools[1], 'return await rlm("too deep")');
	expect(tooDeep.isError).toBe(true);
	expect(tooDeep.error).toContain("深度上限（2）");
	expect(childTools.length).toBe(2);
});

// ---------------------------------------------------------------------------
// 4.3 serialization and abort
// ---------------------------------------------------------------------------

test("calls are serialized", async () => {
	const started: string[] = [];
	const resolvers: Array<() => void> = [];
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			started.push(params.prompt);
			resolvers.push(() => resolve(completedResult(params.prompt)));
		});
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });

	const first = callRlm(entry, rlmScope(), "a");
	const second = callRlm(entry, rlmScope(), "b");
	await tick();
	expect(started).toEqual(["a"]);

	resolvers[0]();
	expect(await first).toBe("a");
	await tick();
	expect(started).toEqual(["a", "b"]);

	resolvers[1]();
	expect(await second).toBe("b");
});

test("queued call skipped on abort", async () => {
	const pi = new FakePi();
	const resolvers: Array<(result: RlmRunResult) => void> = [];
	const spawn: SpawnFn = () =>
		new Promise((resolve) => {
			resolvers.push(resolve);
		});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });
	const controller = new AbortController();

	const first = callRlm(entry, rlmScope(), "a");
	await tick();
	const second = callRlm(entry, rlmScope({ signal: controller.signal }), "b");
	await tick();
	expect(resolvers.length).toBe(1);

	controller.abort();
	resolvers[0](completedResult("A"));
	expect(await first).toBe("A");
	expect(await second).toBe(RLM_ABORTED_NOTICE);
	expect(resolvers.length).toBe(1);

	const entries = usageEntries(pi);
	expect(entries.map((entry) => entry.outcome).sort()).toEqual(["aborted", "completed"]);
	const aborted = entries.find((entry) => entry.outcome === "aborted");
	expect(aborted?.sessionId).toBeNull();
});

test("abort before start does not spawn", async () => {
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn: counting.spawn });
	const controller = new AbortController();
	controller.abort();

	const value = await callRlm(entry, rlmScope({ signal: controller.signal }), "x");
	expect(value).toBe(RLM_ABORTED_NOTICE);
	expect(counting.count()).toBe(0);
});

test("depth queues are independent", async () => {
	const started: string[] = [];
	const resolvers: Array<(result: RlmRunResult) => void> = [];
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			started.push(params.prompt);
			resolvers.push(resolve);
		});
	const entryA = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });
	const entryB = createRlmHostFn({ pi: new FakePi(), depth: 1, maxDepth: 2, spawn });

	const first = callRlm(entryA, rlmScope(), "a");
	const second = callRlm(entryB, rlmScope(), "b");
	await tick();
	expect(started).toEqual(["a", "b"]);

	resolvers[0](completedResult("A"));
	resolvers[1](completedResult("B"));
	expect(await first).toBe("A");
	expect(await second).toBe("B");
});

test("signal passed to spawn", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn: capturing.spawn });
	const controller = new AbortController();
	await callRlm(entry, rlmScope({ signal: controller.signal }), "x");

	// The signal is the caller's combined with the duration-limit timer, so identity is not kept.
	// What matters is that the caller's abort reaches the child.
	const passed = capturing.params[0].signal;
	expect(passed.aborted).toBe(false);
	controller.abort();
	expect(passed.aborted).toBe(true);
});

test("signal passed to spawn is aborted when the caller already aborted", async () => {
	const capturing = makeCapturingSpawn();
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn: capturing.spawn });
	const controller = new AbortController();
	controller.abort();
	const value = await callRlm(entry, rlmScope({ signal: controller.signal }), "x");
	expect(value).toBe(RLM_ABORTED_NOTICE);
	expect(capturing.params.length).toBe(0);
});

test("abort resolves with notice", async () => {
	const spawn: SpawnFn = async () => ({
		outcome: "aborted",
		text: "child aborted",
		sessionId: "child-2",
		tokens: USAGE,
		cost: 0.01,
	});
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });
	const value = await callRlm(entry, rlmScope(), "x");
	expect(value).toBe(RLM_ABORTED_NOTICE);
});

test("waiter abort keeps fifo", async () => {
	const started: string[] = [];
	const resolvers: Array<() => void> = [];
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			started.push(params.prompt);
			resolvers.push(() => resolve(completedResult(params.prompt)));
		});
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });
	const controller = new AbortController();

	const a = callRlm(entry, rlmScope(), "A");
	await tick();
	const b = callRlm(entry, rlmScope({ signal: controller.signal }), "B");
	await tick();
	const c = callRlm(entry, rlmScope(), "C");
	await tick();
	expect(started).toEqual(["A"]);

	controller.abort();
	await tick();
	expect(started).toEqual(["A"]);

	resolvers[0]();
	expect(await a).toBe("A");
	expect(await b).toBe(RLM_ABORTED_NOTICE);
	await tick();
	expect(started).toEqual(["A", "C"]);

	resolvers[1]();
	expect(await c).toBe("C");
});

test("child rlm not blocked by parent call", async () => {
	let resolveParent: (result: RlmRunResult) => void = () => {};
	let childTool: SpawnParams["childTool"] | undefined;
	const spawn: SpawnFn = (params) => {
		if (childTool === undefined) {
			childTool = params.childTool;
			return new Promise((resolve) => {
				resolveParent = resolve;
			});
		}
		return Promise.resolve(completedResult("child answer"));
	};
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn });

	const parentCall = callRlm(entry, rlmScope(), "parent");
	await tick();
	expect(childTool).toBeDefined();

	// The child's own queue must not wait for the pending parent call.
	const child = await runCell(childTool as SpawnParams["childTool"], 'return await rlm("inner")');
	expect(child.isError).toBe(false);
	expect(child.value).toContain("child answer");

	resolveParent(completedResult("parent answer"));
	expect(await parentCall).toBe("parent answer");
});

// ---------------------------------------------------------------------------
// 4.4 child run duration limit
// ---------------------------------------------------------------------------

function abortedChild(sessionId = "child-9", input = 0): RlmRunResult {
	return {
		outcome: "aborted",
		text: "子セッションを中断しました。",
		sessionId,
		tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0, total: input },
		cost: 0.01,
	};
}

/**
 * A child that stops some time after the signal aborts, the way a real child session does: the
 * in-flight provider request has to be cancelled before the run settles.
 */
function delayedAbortSpawn(result: RlmRunResult, stopDelayMs: number): SpawnFn {
	return (params) =>
		new Promise((resolve) => {
			params.signal.addEventListener("abort", () => setTimeout(() => resolve(result), stopDelayMs), { once: true });
		});
}

/** A child that never finishes on its own and resolves once the signal handed to it aborts. */
function hangingSpawn(result: RlmRunResult = abortedChild()): SpawnFn {
	return (params) =>
		new Promise((resolve) => {
			params.signal.addEventListener("abort", () => resolve(result), { once: true });
		});
}

test("aborts the child at the duration limit", async () => {
	const entry = createRlmHostFn({
		pi: new FakePi(),
		depth: 0,
		maxDepth: 2,
		spawn: hangingSpawn(),
		maxChildDurationMs: 50,
	});
	let message = "";
	try {
		await callRlm(entry, rlmScope(), "x");
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("50");
	expect(message).toContain("実行時間");
});

test("duration limit error is catchable", async () => {
	const entry = createRlmHostFn({
		pi: new FakePi(),
		depth: 0,
		maxDepth: 2,
		spawn: hangingSpawn(),
		maxChildDurationMs: 50,
	});
	const cell = await runCell(createTsreplTool({ hostFns: [entry] }), 'try { await rlm("x") } catch (e) { return String(e) }');
	expect(cell.isError).toBe(false);
	expect(cell.value).toContain("50");
	expect(cell.value).toContain("実行時間");
});

test("completion wins over a fired limit timer", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			// The answer lands after the timer already fired.
			params.signal.addEventListener("abort", () => setTimeout(() => resolve(completedResult("done")), 5), {
				once: true,
			});
		});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn, maxChildDurationMs: 20 });

	expect(await callRlm(entry, rlmScope(), "x")).toBe("done");
	expect(usageEntries(pi)[0].outcome).toBe("completed");
});

test("does not count queue wait toward the limit", async () => {
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			setTimeout(() => resolve(completedResult(params.prompt)), params.prompt === "a" ? 30 : 45);
		});
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn, maxChildDurationMs: 60 });

	const first = callRlm(entry, rlmScope(), "a");
	await tick();
	// `b` waits 30ms for its turn, then needs 45ms of its own: over the limit in wall-clock terms
	// from the call, inside the limit for the child run itself.
	const second = callRlm(entry, rlmScope(), "b");

	expect(await first).toBe("a");
	expect(await second).toBe("b");
});

test("parent abort is not reported as the duration limit", async () => {
	const controller = new AbortController();
	const entry = createRlmHostFn({
		pi: new FakePi(),
		depth: 0,
		maxDepth: 2,
		spawn: hangingSpawn(),
		maxChildDurationMs: 5000,
	});
	const call = callRlm(entry, rlmScope({ signal: controller.signal }), "x");
	await tick();
	controller.abort();

	const value = await call;
	expect(value).toContain("中断");
	expect(value).not.toContain("実行時間");
});

// The fork route records the abort the same way the managed route must be measured: the cell is cut
// short immediately, while the child session and its usage record settle later. A reader that samples
// the session at the cell result therefore sees nothing recorded, even though the product does record.
test("a parent abort mid-child-run records the usage entry only after the child settles", async () => {
	const pi = new FakePi();
	const controller = new AbortController();
	const entry = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: delayedAbortSpawn(abortedChild("child-abort-1", 40), 30),
		maxChildDurationMs: 5000,
	});
	const tool = createTsreplTool({ hostFns: [entry] });
	const cell = tool.execute(
		"cell",
		{ code: 'return await rlm("delegate")' },
		undefined,
		undefined,
		makeToolContext({ cwd: "/work", model: MODEL, signal: controller.signal }),
	);
	await tick();
	controller.abort();

	const result = await cell;
	expect(result.isError).toBe(true);
	// At the moment the cell answers, nothing is recorded yet: the child has not stopped.
	expect(usageEntries(pi)).toHaveLength(0);

	// Once the child session settles, the detached continuation writes exactly one entry. It lands
	// after the run already settled, which is what a single read at agent_settled misses.
	await new Promise((resolve) => setTimeout(resolve, 30));
	const entries = usageEntries(pi);
	expect(entries).toHaveLength(1);
	expect(entries[0].outcome).toBe("aborted");
	expect(entries[0].sessionId).toBe("child-abort-1");
	expect(entries[0].tokens.input).toBe(40);
});

test("duration limit records one aborted usage entry", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: hangingSpawn(abortedChild("child-11", 50)),
		maxChildDurationMs: 40,
	});

	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("実行時間");

	const entries = usageEntries(pi);
	expect(entries.length).toBe(1);
	expect(entries[0].outcome).toBe("aborted");
	expect(entries[0].sessionId).toBe("child-11");
	expect(entries[0].tokens.input).toBe(50);
	expect(entries[0].durationMs).toBeGreaterThanOrEqual(40);
});

// ---------------------------------------------------------------------------
// 4.5 usage recording
// ---------------------------------------------------------------------------

test("rlm_usage appended on completion", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn: makeCapturingSpawn().spawn });
	await callRlm(entry, rlmScope(), "x");
	expect(pi.entries.length).toBe(1);
	expect(pi.entries[0].customType).toBe("rlm_usage");
});

test("rlm_usage entry shape", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn: makeCapturingSpawn().spawn });
	await callRlm(entry, rlmScope(), "x");

	const usage = usageEntries(pi)[0];
	expect(Object.keys(usage).sort()).toEqual([
		"cost",
		"depth",
		"durationMs",
		"modelId",
		"outcome",
		"provider",
		"sessionId",
		"tokens",
	]);
	expect(usage.depth).toBe(1);
	expect(usage.sessionId).toBe("child-1");
	expect(usage.provider).toBe("p");
	expect(usage.modelId).toBe("m");
	expect(usage.tokens).toEqual(USAGE);
	expect(usage.cost).toBe(0.02);
	expect(typeof usage.durationMs).toBe("number");
	expect(usage.outcome).toBe("completed");
});

test("rlm_usage depth is child depth", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({ pi, depth: 1, maxDepth: 2, spawn: makeCapturingSpawn().spawn });
	await callRlm(entry, rlmScope(), "x");
	expect(usageEntries(pi)[0].depth).toBe(2);
});

test("rlm_usage recorded on abort", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = async () => ({
		outcome: "aborted",
		text: "aborted",
		sessionId: "child-2",
		tokens: USAGE,
		cost: 0.01,
	});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });
	await callRlm(entry, rlmScope(), "x");

	const usage = usageEntries(pi)[0];
	expect(usage.outcome).toBe("aborted");
	expect(usage.sessionId).toBe("child-2");
	expect(usage.tokens).toEqual(USAGE);
	expect(usage.cost).toBe(0.01);
});

test("rlm_usage recorded on budget", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = async () => ({
		outcome: "budget",
		text: "partial",
		sessionId: "child-3",
		tokens: USAGE,
		cost: 0.01,
	});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });
	await callRlm(entry, rlmScope(), "x");

	const usage = usageEntries(pi)[0];
	expect(usage.outcome).toBe("budget");
	expect(usage.sessionId).toBe("child-3");
	expect(usage.tokens).toEqual(USAGE);
});

test("rlm_usage recorded without child", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = async () => ({
		outcome: "error",
		text: "",
		errorMessage: "no session",
		sessionId: null,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		cost: 0,
	});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });

	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("no session");
	await expect(callRlm(entry, rlmScope(), 42)).rejects.toThrow("prompt");

	const entries = usageEntries(pi);
	expect(entries.length).toBe(2);
	expect(entries[0].outcome).toBe("error");
	expect(entries[0].sessionId).toBeNull();
	expect(entries[0].tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
	expect(entries[0].cost).toBe(0);
	expect(entries[1].outcome).toBe("error");
	expect(entries[1].sessionId).toBeNull();
});

test("rlm_usage recorded on child error", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = async () => ({
		outcome: "error",
		text: "",
		errorMessage: "rate limit",
		sessionId: "child-4",
		tokens: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 },
		cost: 0,
	});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });
	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("rate limit");

	const usage = usageEntries(pi)[0];
	expect(usage.outcome).toBe("error");
	expect(usage.sessionId).toBe("child-4");
	expect(usage.tokens.input).toBe(50);
});

test("rlm_usage durationMs includes queue wait", async () => {
	const pi = new FakePi();
	const resolvers: Array<() => void> = [];
	const spawn: SpawnFn = () =>
		new Promise((resolve) => {
			resolvers.push(() => resolve(completedResult("ok")));
		});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });

	const first = callRlm(entry, rlmScope(), "a");
	await tick();
	const second = callRlm(entry, rlmScope(), "b");
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 30));

	resolvers[0]();
	await first;
	await tick();
	resolvers[1]();
	await second;

	const entries = usageEntries(pi);
	expect(entries.length).toBe(2);
	expect(entries[1].durationMs).toBeGreaterThanOrEqual(30);
});

test("rlm_usage nested calls go to root", async () => {
	const pi = new FakePi();
	let childTool: SpawnParams["childTool"] | undefined;
	const spawn: SpawnFn = async (params) => {
		childTool = params.childTool;
		return completedResult("nested");
	};
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });

	await callRlm(entry, rlmScope(), "outer");
	const inner = await runCell(childTool as SpawnParams["childTool"], 'return await rlm("inner")');
	expect(inner.isError).toBe(false);

	const entries = usageEntries(pi);
	expect(entries.length).toBe(2);
	expect(entries.map((entry) => entry.depth).sort()).toEqual([1, 2]);
});

test("rlm_usage uses appendEntry only", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn: makeCapturingSpawn().spawn });
	await callRlm(entry, rlmScope(), "x");
	expect(pi.entries.length).toBe(1);
	expect(pi.entries.every((entry) => entry.customType === "rlm_usage")).toBe(true);
});

test("error outcome throws with cause", async () => {
	const pi = new FakePi();
	const spawn: SpawnFn = async () => ({
		outcome: "error",
		text: "",
		errorMessage: "rate limit",
		sessionId: "child-5",
		tokens: USAGE,
		cost: 0,
	});
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });

	let caught: unknown;
	try {
		await callRlm(entry, rlmScope(), "x");
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(Error);
	expect((caught as Error).message).toContain("rate limit");
	expect((caught as Error).cause).toBeInstanceOf(Error);
	expect(((caught as Error).cause as Error).message).toBe("rate limit");
});

// ---------------------------------------------------------------------------
// 4.6 child model resolution (spec `rlm` / 子セッションへ渡すモデルは物理モデル)
// ---------------------------------------------------------------------------

/** The `spirits/auto` selection: virtual, so it must never reach a child session. */
const AUTO: PiModel = { provider: "spirits", id: "auto", api: PI_VIRTUAL_MODEL_API };
/** The physical model a resolver hands back. */
const RESOLVED: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** Resolver stub that records every selection it was asked about. */
function makeResolver(resolve: (parent: PiModel) => PiModel): { resolver: ChildModelResolver; seen: PiModel[] } {
	const seen: PiModel[] = [];
	return { resolver: (parent) => { seen.push(parent); return resolve(parent); }, seen };
}

// spec "rlm / 解決できない親では子を生成しない" と "解決失敗の記録"
test("resolution failure skips spawn and records nulls", async () => {
	const pi = new FakePi();
	const counting = makeCountingSpawn();
	const entry = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: counting.spawn,
		resolveChildModel: () => {
			throw new Error("no child model: set defaultProvider and defaultModel");
		},
	});

	await expect(callRlm(entry, rlmScope({ model: AUTO }), "x")).rejects.toThrow("defaultProvider");
	expect(counting.count()).toBe(0);

	const entries = usageEntries(pi);
	expect(entries.length).toBe(1);
	expect(entries[0].outcome).toBe("error");
	expect(entries[0].sessionId).toBeNull();
	expect(entries[0].provider).toBeNull();
	expect(entries[0].modelId).toBeNull();
	expect(entries[0].tokens).toEqual(NO_TOKENS);
	expect(entries[0].cost).toBe(0);
});

// spec "rlm / 解決失敗の catch"
test("resolution failure is catchable in the cell", async () => {
	const entry = createRlmHostFn({
		pi: new FakePi(),
		depth: 0,
		maxDepth: 2,
		spawn: makeCountingSpawn().spawn,
		resolveChildModel: () => {
			throw new Error("no child model: set defaultProvider and defaultModel");
		},
	});

	const cell = await runCell(
		createTsreplTool({ hostFns: [entry] }),
		'try { await rlm("x") } catch (e) { return String(e) }',
		AUTO,
	);
	expect(cell.isError).toBe(false);
	expect(cell.value).toContain("defaultProvider");
});

// spec "rlm / 解決失敗の後も次の呼び出しは進む" (design Decision 4)
test("a resolution failure releases the queue for the next call", async () => {
	const pi = new FakePi();
	const capturing = makeCapturingSpawn();
	let resolvable = false;
	const entry = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: capturing.spawn,
		resolveChildModel: () => {
			if (!resolvable) {
				throw new Error("no child model: set defaultProvider and defaultModel");
			}
			return RESOLVED;
		},
	});

	await expect(callRlm(entry, rlmScope({ model: AUTO }), "x")).rejects.toThrow("no child model");

	// A queue still held by the failed call would park the second call here until the test timeout.
	resolvable = true;
	const second = callRlm(entry, rlmScope({ model: AUTO }), "y");
	const settled = await Promise.race([
		second.then(() => "returned"),
		new Promise<string>((resolve) => setTimeout(() => resolve("still queued"), 250)),
	]);
	expect(settled).toBe("returned");
	expect(await second).toBe("ok");

	// The second call reached `spawn` on the resolved model, and each call recorded exactly one entry.
	expect(capturing.params.length).toBe(1);
	expect(capturing.params[0].model).toEqual(RESOLVED);
	expect(usageEntries(pi).map((entry) => entry.outcome)).toEqual(["error", "completed"]);
	expect(usageEntries(pi)[1].provider).toBe("anthropic");
});

// spec "rlm / 解決した物理モデルで子を起動する" と "解決したモデルの記録"
test("resolved model reaches spawn and usage", async () => {
	const pi = new FakePi();
	const capturing = makeCapturingSpawn();
	const { resolver, seen } = makeResolver((parent) => (parent.api === PI_VIRTUAL_MODEL_API ? RESOLVED : parent));
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn: capturing.spawn, resolveChildModel: resolver });

	await callRlm(entry, rlmScope({ model: AUTO }), "x");

	// The resolver sees the parent selection, and the child gets the resolved model.
	expect(seen).toEqual([AUTO]);
	expect(capturing.params[0].model).toEqual(RESOLVED);

	const usage = usageEntries(pi)[0];
	expect(usage.provider).toBe("anthropic");
	expect(usage.modelId).toBe("claude-sonnet-4-5");
	expect(usage.outcome).toBe("completed");
});

// spec "rlm / rlm_usage の記録規則": a call that created no child records null model fields.
test("no child session records null model fields", async () => {
	// (a) invalid arguments.
	const invalid = new FakePi();
	const entry = createRlmHostFn({ pi: invalid, depth: 0, maxDepth: 2, spawn: makeCountingSpawn().spawn });
	await expect(callRlm(entry, rlmScope(), 42)).rejects.toThrow("prompt");

	// (b) depth limit, on a parent that selected a physical model: the old record named the parent.
	const limited = new FakePi();
	const depthEntry = createRlmHostFn({ pi: limited, depth: 2, maxDepth: 2, spawn: makeCountingSpawn().spawn });
	await expect(callRlm(depthEntry, rlmScope(), "x")).rejects.toThrow("深度上限（2）");

	// (c) no parent model.
	const noModel = new FakePi();
	const noModelEntry = createRlmHostFn({ pi: noModel, depth: 0, maxDepth: 2, spawn: makeCountingSpawn().spawn });
	await expect(callRlm(noModelEntry, rlmScope({ model: undefined }), "x")).rejects.toThrow("モデル");

	// (d) child session creation failed.
	const creation = new FakePi();
	const creationEntry = createRlmHostFn({
		pi: creation,
		depth: 0,
		maxDepth: 2,
		spawn: async () => ({
			outcome: "error",
			text: "",
			errorMessage: "no session",
			sessionId: null,
			tokens: NO_TOKENS,
			cost: 0,
		}),
	});
	await expect(callRlm(creationEntry, rlmScope(), "x")).rejects.toThrow("no session");

	// (e) aborted while waiting for the queue.
	const queued = new FakePi();
	const resolvers: Array<(result: RlmRunResult) => void> = [];
	const queueSpawn: SpawnFn = () =>
		new Promise((resolve) => {
			resolvers.push(resolve);
		});
	const queueEntry = createRlmHostFn({ pi: queued, depth: 0, maxDepth: 2, spawn: queueSpawn });
	const controller = new AbortController();
	const first = callRlm(queueEntry, rlmScope(), "a");
	await tick();
	const second = callRlm(queueEntry, rlmScope({ signal: controller.signal }), "b");
	await tick();
	controller.abort();
	resolvers[0](completedResult("A"));
	await first;
	expect(await second).toBe(RLM_ABORTED_NOTICE);

	// Every call that created no child session records null, whatever the parent selected. The one
	// completed child in `queued` is the counter-case: it keeps the model it was handed.
	for (const pi of [invalid, limited, noModel, creation, queued]) {
		for (const entry of usageEntries(pi).filter((entry) => entry.sessionId === null)) {
			expect(entry.provider).toBeNull();
			expect(entry.modelId).toBeNull();
		}
	}
	expect(usageEntries(queued).find((entry) => entry.outcome === "completed")?.provider).toBe("p");
	expect(usageEntries(limited)[0].outcome).toBe("error");
	expect(usageEntries(queued).map((entry) => entry.outcome).sort()).toEqual(["aborted", "completed"]);
});

// spec "rlm / 子セッションの失敗の伝達" と "子セッション生成の失敗の記録"
test("child creation failure names the attempted model", async () => {
	const pi = new FakePi();
	const entry = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: async () => ({
			outcome: "error",
			text: "",
			errorMessage: "No API key found",
			sessionId: null,
			tokens: NO_TOKENS,
			cost: 0,
		}),
		resolveChildModel: () => RESOLVED,
	});

	let message = "";
	try {
		await callRlm(entry, rlmScope({ model: AUTO }), "x");
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("anthropic/claude-sonnet-4-5");
	expect(message).toContain("No API key found");
});

// A child run that did start keeps its own diagnostic: the attempted model belongs to creation only.
test("child error after creation does not name the attempted model", async () => {
	const entry = createRlmHostFn({
		pi: new FakePi(),
		depth: 0,
		maxDepth: 2,
		spawn: async () => ({
			outcome: "error",
			text: "",
			errorMessage: "rate limit",
			sessionId: "child-7",
			tokens: NO_TOKENS,
			cost: 0,
		}),
	});

	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("rate limit");
});

// spec "rlm / 解決されたモデルの子も同じ規則を守る"
test("nested host fn receives the same resolver", async () => {
	const childTools: SpawnParams["childTool"][] = [];
	const models: PiModel[] = [];
	const spawn: SpawnFn = async (params) => {
		childTools.push(params.childTool);
		models.push(params.model);
		return completedResult(`answer${childTools.length}`);
	};
	const { resolver, seen } = makeResolver((parent) => (parent.api === PI_VIRTUAL_MODEL_API ? RESOLVED : parent));
	const entry = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: 2, spawn, resolveChildModel: resolver });

	await callRlm(entry, rlmScope({ model: AUTO }), "outer");

	// The depth-1 child runs on the resolved physical model, and its own `rlm` gets the same resolver.
	const inner = await runCell(childTools[0], 'return await rlm("inner")', RESOLVED);
	expect(inner.isError).toBe(false);

	expect(seen).toEqual([AUTO, RESOLVED]);
	expect(models).toEqual([RESOLVED, RESOLVED]);
	expect(models.some((model) => model.api === PI_VIRTUAL_MODEL_API)).toBe(false);
});

test("rlm_usage recorded when spawn throws", async () => {
	const pi = new FakePi();
	let calls = 0;
	const spawn: SpawnFn = async () => {
		calls++;
		if (calls === 1) {
			throw new Error("spawn boom");
		}
		return completedResult("ok");
	};
	const entry = createRlmHostFn({ pi, depth: 0, maxDepth: 2, spawn });

	await expect(callRlm(entry, rlmScope(), "x")).rejects.toThrow("spawn boom");

	const entries = usageEntries(pi);
	expect(entries.length).toBe(1);
	expect(entries[0].outcome).toBe("error");
	expect(entries[0].sessionId).toBeNull();
	expect(entries[0].tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
	expect(entries[0].cost).toBe(0);

	// The failed call must release the queue for the next caller.
	await callRlm(entry, rlmScope(), "y");
	expect(usageEntries(pi).length).toBe(2);
});
