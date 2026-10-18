import { expect, test } from "bun:test";
import { type PiModel, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import spiritsExtension from "../src/index.ts";
import { TSREPL_CELL_ENTRY_TYPE } from "../src/constants.ts";
import type { CellMetrics } from "../src/repl/metrics.ts";
import { DEFAULT_SYNC_WATCHDOG, MAX_TIMEOUT, MIN_TIMEOUT } from "../src/repl/cell.ts";
import { OUTPUT_LIMIT } from "../src/repl/format.ts";
import { createRlmHostFn } from "../src/rlm/hostfn.ts";
import type { SpawnParams } from "../src/rlm/spawn.ts";
import { createTsreplTool, TSREPL_PROMPT_SNIPPET } from "../src/tools.ts";
import { sessionEntryToContextMessages, SessionManager } from "./pi-runtime/session-manager.ts";
import { FakePi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const CHILD_MODEL: PiModel = { provider: "p", id: "m" };
const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
		return first.text;
	}
	return "";
}

test("tool schema", () => {
	const tool = createTsreplTool();
	expect(tool.name).toBe("tsrepl");
	expect(tool.exposure).toBe("direct");
	expect(tool.executionMode).toBe("sequential");

	const schema = tool.parameters as unknown as {
		type: string;
		properties: Record<string, unknown>;
		required?: string[];
	};
	expect(schema.type).toBe("object");
	expect(Object.keys(schema.properties).sort()).toEqual(["code", "description", "reset", "timeout"]);
	expect(schema.required ?? []).toContain("code");
});

test("tool description", () => {
	const tool = createTsreplTool();
	expect(tool.description).toContain("globalThis");
});

test("tool prompt snippet and guidelines", () => {
	const tool = createTsreplTool();
	expect(tool.promptSnippet).toBeDefined();
	expect(tool.promptSnippet).not.toBe("");
	expect(tool.promptSnippet).not.toContain("\n");

	const guidelines = tool.promptGuidelines ?? [];
	expect(guidelines.length).toBe(2);
	expect(guidelines.join("\n")).toContain("2 つ以上のコマンド");
	expect(guidelines.join("\n")).toContain("bash");
});

// The expected numbers come from the constants, so a limit change cannot pass by editing only the test.
test("description states the new limits", () => {
	const description = createTsreplTool().description;
	for (const needle of [
		"既定なし",
		String(MAX_TIMEOUT),
		String(DEFAULT_SYNC_WATCHDOG),
		String(OUTPUT_LIMIT),
		"exit_code",
		"_",
	]) {
		expect(description).toContain(needle);
	}
});

test("timeout parameter description matches the new limits", () => {
	const schema = createTsreplTool().parameters as unknown as {
		properties: Record<string, { description?: string }>;
	};
	const description = schema.properties.timeout?.description ?? "";
	expect(description).toContain("既定なし");
	expect(description).toContain(String(MIN_TIMEOUT));
	expect(description).toContain(String(MAX_TIMEOUT));
	expect(description).toContain(String(DEFAULT_SYNC_WATCHDOG));
	expect(description).not.toContain("120000");
});

test("child tsrepl declares no prompt guidelines", async () => {
	let childTool: SpawnParams["childTool"] | undefined;
	const pi = new FakePi();
	const rlm = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: async (params) => {
			childTool = params.childTool;
			return { outcome: "completed", text: "ok", sessionId: "c", tokens: ZERO_TOKENS, cost: 0 };
		},
	});
	const parent = createTsreplTool({ hostFns: [rlm] });
	await parent.execute("id", { code: 'await rlm("x")' }, undefined, undefined, makeToolContext({ model: CHILD_MODEL }));

	expect(childTool).toBeDefined();
	expect(childTool?.promptGuidelines).toEqual([]);
	expect(childTool?.promptSnippet).toBe(TSREPL_PROMPT_SNIPPET);
});

test("tsrepl via extension without timeout", async () => {
	const pi = new FakePi();
	spiritsExtension(pi);
	const tool = pi.tools.find((candidate) => candidate.name === "tsrepl") as ToolDefinition;
	const result = await tool.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(result.isError).toBeFalsy();
	expect(textOf(result)).toContain("1");
	expect(textOf(result)).not.toContain("打ち切り");
});

function cellEntries(pi: FakePi): CellMetrics[] {
	return pi.entries
		.filter((entry) => entry.customType === TSREPL_CELL_ENTRY_TYPE)
		.map((entry) => entry.data as CellMetrics);
}

test("tsrepl_cell entry is appended per cell", async () => {
	const pi = new FakePi();
	const tool = createTsreplTool({ pi });
	await tool.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	await tool.execute("id", { code: "throw new Error('x')" }, undefined, undefined, makeToolContext());

	const cells = cellEntries(pi);
	expect(cells.length).toBe(2);
	expect(Object.keys(cells[0]).sort()).toEqual([
		"codeChars",
		"durationMs",
		"outcome",
		"outputChars",
		"printedChars",
		"reset",
		"spill",
		"timeoutMs",
		"toolCalls",
		"truncated",
		"underscoreSet",
		"valueChars",
	]);
	expect(cells[0].outcome).toBe("ok");
	expect(cells[0].timeoutMs).toBeNull();
	expect(cells[0].toolCalls).toEqual([]);
	expect(cells[0].underscoreSet).toBe(true);
	expect(cells[1].outcome).toBe("error");
});

test("tsrepl_cell entry has no cell contents", async () => {
	const pi = new FakePi();
	const tool = createTsreplTool({ pi });
	await tool.execute(
		"id",
		{ code: 'print("secret-token"); return "secret-value"' },
		undefined,
		undefined,
		makeToolContext(),
	);

	const recorded = JSON.stringify(pi.entries);
	expect(recorded).not.toContain("secret-token");
	expect(recorded).not.toContain("secret-value");
	expect(cellEntries(pi)[0].printedChars).toBe("secret-token".length);
});

test("tsrepl_cell append failure does not change the result", async () => {
	const tool = createTsreplTool({
		pi: {
			appendEntry(): void {
				throw new Error("append boom");
			},
		},
	});
	const result = await tool.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(result.isError).toBeFalsy();
	expect(textOf(result)).toContain("1");
});

test("tsrepl without appendEntry records nothing", async () => {
	const pi = new FakePi();
	const unrecorded = createTsreplTool();
	await unrecorded.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(pi.entries).toEqual([]);

	const recorded = createTsreplTool({ pi });
	await recorded.execute("id", { code: "return 2" }, undefined, undefined, makeToolContext());
	expect(cellEntries(pi).length).toBe(1);
});

test("child tsrepl records no tsrepl_cell", async () => {
	const pi = new FakePi();
	let childTool: SpawnParams["childTool"] | undefined;
	const rlm = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: 2,
		spawn: async (params) => {
			childTool = params.childTool;
			return { outcome: "completed", text: "ok", sessionId: "c", tokens: ZERO_TOKENS, cost: 0 };
		},
	});
	const parent = createTsreplTool({ hostFns: [rlm], pi });
	await parent.execute("id", { code: 'await rlm("x")' }, undefined, undefined, makeToolContext({ model: CHILD_MODEL }));

	const child = await childTool?.execute("cell", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(child?.isError).toBeFalsy();
	// Only the two root cells are recorded. The child's cell never reaches an `appendEntry`.
	expect(cellEntries(pi).length).toBe(1);
	expect(pi.entries.filter((entry) => entry.customType === "rlm_usage").length).toBe(1);
});

// spec "tsrepl / セル実行ログの記録": LLM コンテキストへ送らない(カスタムエントリは本文に出ない)
test("tsrepl_cell is not injected into context", () => {
	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendCustomEntry(TSREPL_CELL_ENTRY_TYPE, { outcome: "ok" });

	const custom = sessionManager.getBranch().filter((entry) => entry.type === "custom");
	expect(custom.length).toBe(1);
	expect(sessionEntryToContextMessages(custom[0])).toEqual([]);
});

test("success result", async () => {
	const tool = createTsreplTool();
	const result = await tool.execute(
		"id",
		{ code: "print(1); return 2" },
		undefined,
		undefined,
		makeToolContext(),
	);
	expect(result.isError).toBeFalsy();
	const text = textOf(result);
	expect(text).toContain("1");
	expect(text).toContain("2");
});

test("error result", async () => {
	const tool = createTsreplTool();
	const result = await tool.execute(
		"id",
		{ code: "throw new Error('boom')" },
		undefined,
		undefined,
		makeToolContext(),
	);
	expect(result.isError).toBe(true);
	expect(textOf(result)).toContain("boom");
});

test("two calls serialized", async () => {
	const tool = createTsreplTool();
	const first = tool.execute(
		"a",
		{ code: "await new Promise((r) => setTimeout(r, 100)); print('A')" },
		undefined,
		undefined,
		makeToolContext(),
	);
	const second = tool.execute("b", { code: "print('B')" }, undefined, undefined, makeToolContext());
	const [r1, r2] = await Promise.all([first, second]);
	expect(r1.details.printed).toBe("A");
	expect(r2.details.printed).toBe("B");
});

test("dev log enabled", async () => {
	const lines: string[] = [];
	const tool = createTsreplTool({ dev: { env: "1", sink: (line) => lines.push(line) } });
	await tool.execute(
		"id",
		{ code: "return 1", description: "first" },
		undefined,
		undefined,
		makeToolContext(),
	);
	const log = lines.join("\n");
	expect(log).toContain("first");
	expect(log).toContain("ok");
	expect(log).toContain("elapsed=");
});

test("dev log disabled", async () => {
	const lines: string[] = [];
	const tool = createTsreplTool({ dev: { env: "0", sink: (line) => lines.push(line) } });
	await tool.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(lines).toEqual([]);
});
