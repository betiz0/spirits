import { expect, test } from "bun:test";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { HostFnEntry, HostFnScope } from "../src/repl/registry.ts";
import { DEFAULT_MAX_DEPTH } from "../src/rlm/depth.ts";
import { RLM_ABORTED_NOTICE, createRlmHostFn, type SpawnFn } from "../src/rlm/hostfn.ts";
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
): Promise<{ isError: boolean; value: string; error: string }> {
	const result = await tool.execute("cell", { code }, undefined, undefined, makeToolContext({ cwd: "/work", model: MODEL }));
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
		"return [typeof out, typeof print, typeof use, typeof tool, typeof rlm, typeof goal, typeof note].join(',')",
	);
	expect(child.value).toContain("function,function,function,function,function,undefined,undefined");
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
	expect(capturing.params[0].signal).toBe(controller.signal);
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
// 4.4 usage recording
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
