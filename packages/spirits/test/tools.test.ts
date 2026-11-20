import { expect, test } from "bun:test";
import { type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { asExtensionApi, fakeModel } from "./host/fake-pi.ts";
import spiritsExtension from "../src/index.ts";
import { BASH_PIPE_ALLOW_FILTERS, TSREPL_CELL_ENTRY_TYPE } from "../src/constants.ts";
import type { CellMetrics } from "../src/repl/metrics.ts";
import { DEFAULT_SYNC_WATCHDOG, MAX_TIMEOUT, MIN_TIMEOUT } from "../src/repl/cell.ts";
import { OUTPUT_LIMIT } from "../src/repl/format.ts";
import { createShHostFn } from "../src/repl/hostfns.ts";
import { createRlmHostFn } from "../src/rlm/hostfn.ts";
import type { SpawnParams } from "../src/rlm/spawn.ts";
import { createTsreplTool, TSREPL_PROMPT_SNIPPET } from "../src/tools.ts";
import { sessionEntryToContextMessages, SessionManager } from "./pi-runtime/session-manager.ts";
import { FakePi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const CHILD_MODEL: PiModel = fakeModel("p", "m");
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
	// 変更 rebalance-action-surface-guidelines で 4 項目(読み書きの行き先が加わった)。内容の検査は
	// 下の「prompt guidelines are the four destinations of the action surface」。
	expect(guidelines.length).toBe(4);
	expect(guidelines.join("\n")).toContain("bash");
	expect(guidelines.join("\n")).toContain("tsrepl");
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
	spiritsExtension(asExtensionApi(pi));
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

// change rebalance-action-surface-guidance: 規則は意図ごとの 4 項目。合計の目安は現行 3 項目
// (356 文字)の 1.5 倍で、システムプロンプトの規則の節が膨らむ見え方を作るための上限制限。
const GUIDELINE_CHAR_BUDGET = 534;

test("prompt guidelines are the four destinations of the action surface", () => {
	const guidelines = createTsreplTool().promptGuidelines ?? [];
	expect(guidelines).toHaveLength(4);
	// 1 項目目: ファイルの読み書きは read / edit / write へ向ける。
	expect(guidelines[0]).toContain("read");
	expect(guidelines[0]).toContain("edit / write");
	expect(guidelines[0]).toContain("sed -i");
	// 2 項目目の許可フィルタは guard が通す一覧そのもの(2 か所に書かない)。
	expect(guidelines[1]).toContain("1 回の起動");
	expect(guidelines[1]).toContain("出力を自分で読む");
	// spec 「規則のフィルタ一覧はガードと一致する」: 列挙されたフィルタの集合が許可一覧と同じこと。
	const runs = guidelines[1].match(/[a-z]+(?: \/ [a-z]+)+/g) ?? [];
	expect(runs).toEqual([BASH_PIPE_ALLOW_FILTERS.join(" / ")]);
	// 3 項目目: 出力をコードで扱う処理と使い捨てのコードは tsrepl。
	expect(guidelines[2]).toContain("出力をコードで扱う処理");
	expect(guidelines[2]).toContain("シェルの制御構文");
	expect(guidelines[2]).toContain("awk / jq / xargs");
	expect(guidelines[2]).toContain("使い捨てのコード");
	// 4 項目目: python は対象プロジェクトの実行も含めて実行しない。
	expect(guidelines[3]).toContain("python");
	expect(guidelines[3]).toContain("対象プロジェクトの実行も含めて一切実行しない");
});

test("prompt guidelines stay inside the character budget", () => {
	const total = (createTsreplTool().promptGuidelines ?? []).join("").length;
	expect(total).toBeLessThanOrEqual(GUIDELINE_CHAR_BUDGET);
});

// spec "ツール説明の use() の書き方": 指定子を言った例はすべて `await` 付き。
test("tool description awaits use() and names what a cell lacks", () => {
	const description = createTsreplTool().description;
	expect(description).toContain('await use("node:');
	expect(description).toContain('await use("bun:');
	expect(description).toContain('await use("./');
	for (const match of [...description.matchAll(/use\("/g)]) {
		const before = description.slice(Math.max(0, (match.index ?? 0) - 6), match.index);
		expect(before, description.slice(Math.max(0, (match.index ?? 0) - 30), (match.index ?? 0) + 20)).toBe("await ");
	}
	for (const name of ["process", "Bun", "require"]) {
		expect(description, name).toContain(name);
	}
});

test("sh host fn is described", () => {
	const withSh = createTsreplTool({ hostFns: [createShHostFn()] });
	expect(withSh.description).toContain("sh(command, options?)");
	expect(withSh.description).toContain('tool("bash"');
	// The `rlm` child builds its tsrepl without `sh`, so its description keeps no promise it cannot keep.
	expect(createTsreplTool().description).not.toContain("sh(command, options?)");
});
