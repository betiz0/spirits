import { expect, test } from "bun:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HostFnEntry } from "../src/repl/registry.ts";
import { DEFAULT_MAX_DEPTH } from "../src/rlm/depth.ts";
import { createRlmHostFn, type SpawnFn } from "../src/rlm/hostfn.ts";
import type { RlmRunResult, RlmTokens } from "../src/rlm/spawn.ts";
import {
	TSREPL_DESCRIPTION,
	createTsreplTool,
	type TsreplDetails,
	type TsreplParameters,
} from "../src/tools.ts";
import { makeToolContext } from "./support.ts";

const MODEL = { provider: "p", id: "m" };
const ZERO_TOKENS: RlmTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

class FakePi {
	appendEntry(): void {}
}

function completedResult(text: string): RlmRunResult {
	return { outcome: "completed", text, sessionId: "child-1", tokens: ZERO_TOKENS, cost: 0 };
}

function abortedResult(): RlmRunResult {
	return { outcome: "aborted", text: "子セッションを中断しました。", sessionId: "child-1", tokens: ZERO_TOKENS, cost: 0 };
}

function makeRlmTool(spawn: SpawnFn): ToolDefinition<TsreplParameters, TsreplDetails> {
	const hostFn = createRlmHostFn({ pi: new FakePi(), depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn });
	return createTsreplTool({ hostFns: [hostFn] });
}

async function executeCell(
	tool: ToolDefinition<TsreplParameters, TsreplDetails>,
	code: string,
	options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<{ isError: boolean; value: string | undefined; error: string | undefined }> {
	const result = await tool.execute(
		"cell",
		{ code, timeout: options.timeout },
		options.signal,
		undefined,
		makeToolContext({ model: MODEL, signal: options.signal }),
	);
	return { isError: result.isError === true, value: result.details.value, error: result.details.error };
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("rlm exposed in cell", async () => {
	const tool = makeRlmTool(async () => completedResult("x"));
	const result = await executeCell(tool, "return typeof rlm");
	expect(result.isError).toBe(false);
	expect(result.value).toContain("function");
});

test("await rlm in cell", async () => {
	const tool = makeRlmTool(async () => completedResult("5"));
	const result = await executeCell(tool, 'return await rlm("x")');
	expect(result.isError).toBe(false);
	expect(result.value).toBe('"5"');
});

test("existing cell unaffected by rlm", async () => {
	const tool = makeRlmTool(async () => completedResult("5"));
	const result = await executeCell(tool, "globalThis.x = 1; return x");
	expect(result.isError).toBe(false);
	expect(result.value).toBe("1");
});

test("extra host fn rejected when duplicate", () => {
	const makeEntry = (name: string): HostFnEntry => ({ name, description: "", create: () => () => {} });
	expect(() => createTsreplTool({ hostFns: [makeEntry("print")] })).toThrow();
	expect(() => createTsreplTool({ hostFns: [makeEntry("x"), makeEntry("x")] })).toThrow();
});

test("tool description includes rlm guidance", () => {
	const tool = makeRlmTool(async () => completedResult("x"));
	expect(tool.description.startsWith(TSREPL_DESCRIPTION)).toBe(true);
	expect(tool.description).toContain("await rlm(");
	expect(tool.description).toContain("深度上限は 2");
});

test("tool description unchanged without host fns", () => {
	expect(createTsreplTool().description).toBe(TSREPL_DESCRIPTION);
});

test("tool abort propagates to child", async () => {
	const controller = new AbortController();
	let spawnSignal: AbortSignal | undefined;
	const spawn: SpawnFn = (params) => {
		spawnSignal = params.signal;
		return new Promise((resolve) => {
			params.signal.addEventListener("abort", () => resolve(abortedResult()), { once: true });
		});
	};
	const tool = makeRlmTool(spawn);

	const promise = executeCell(tool, 'return await rlm("x")', { signal: controller.signal });
	await tick();
	controller.abort();
	const result = await promise;

	expect(result.isError).toBe(true);
	expect(result.error).toContain("AbortError");
	expect(spawnSignal?.aborted).toBe(true);
});

test("cell timeout aborts child", async () => {
	let spawnSignal: AbortSignal | undefined;
	const spawn: SpawnFn = (params) => {
		spawnSignal = params.signal;
		return new Promise((resolve) => {
			params.signal.addEventListener("abort", () => resolve(abortedResult()), { once: true });
		});
	};
	const tool = makeRlmTool(spawn);

	const result = await executeCell(tool, 'return await rlm("x")', { timeout: 500 });

	expect(result.isError).toBe(true);
	expect(result.error).toContain("TimeoutError");
	expect(spawnSignal?.aborted).toBe(true);
});
