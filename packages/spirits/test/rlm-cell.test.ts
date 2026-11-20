import { expect, test } from "bun:test";
import { fakeModel } from "./host/fake-pi.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HostFnEntry } from "../src/repl/registry.ts";
import { DEFAULT_MAX_DEPTH, RLM_MAX_CHILD_DURATION_MS, RLM_MAX_TOOL_CALLS } from "../src/rlm/depth.ts";
import { createRlmHostFn, type SpawnFn } from "../src/rlm/hostfn.ts";
import type { RlmRunResult, RlmTokens } from "../src/rlm/spawn.ts";
import { createTsreplTool, TSREPL_DESCRIPTION, type TsreplDetails, type TsreplParameters } from "../src/tools.ts";
import { makeToolContext } from "./support.ts";

const MODEL = fakeModel("p", "m");
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

// spec "未提供のホストグローバルへの参照の提案": 提案はルートと子のどちらでも同じ文である。
test("child session suggests the same replacement", async () => {
	const childCells: Parameters<SpawnFn>[0]["childTool"][] = [];
	const spawn: SpawnFn = async (params) => {
		childCells.push(params.childTool);
		return completedResult("ok");
	};
	const tool = makeRlmTool(spawn);
	await executeCell(tool, 'return await rlm("x")');
	const child = childCells[0];
	if (child === undefined) throw new Error("the spawn captured no child tool");

	const childResult = await child.execute("cell", { code: "return process.env.HOME" }, undefined, undefined, makeToolContext({ model: MODEL }));
	const rootResult = await executeCell(tool, "return process.env.HOME");
	expect(childResult.isError).toBe(true);
	const childSuggestion = suggestionOf(childResult.details.error ?? "");
	expect(childSuggestion).toContain('use("node:');
	expect(childSuggestion).not.toContain("globalThis.process =");
	expect(childSuggestion).toBe(suggestionOf(rootResult.error ?? ""));
});

/** The `提案:` line of a formatted cell error. */
function suggestionOf(errorText: string): string {
	return errorText.split("\n").find((line) => line.startsWith("提案:")) ?? "";
}

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
	// Without the `rlm` host function the description carries no rlm guidance: no usage example, no
	// depth limit, no child tool-call limit.
	const description = createTsreplTool().description;
	expect(description).not.toContain("await rlm(");
	expect(description).not.toContain("深度上限");
	expect(description).not.toContain(`${RLM_MAX_TOOL_CALLS} 回`);
	expect(description).not.toContain(String(RLM_MAX_CHILD_DURATION_MS));
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
