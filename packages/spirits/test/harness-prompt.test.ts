import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptOverridePath } from "../src/harness/paths.ts";
import { resolveCodeModePrompt } from "../src/harness/prompt.ts";
import { BASH_PIPE_ALLOW_FILTERS } from "../src/constants.ts";
import { SH_HOST_FN_NAME } from "../src/repl/hostfns.ts";
import { TSREPL_PROMPT_GUIDELINES } from "../src/tools.ts";

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-prompt-"));
}

async function writeOverride(agentDir: string, content: string): Promise<void> {
	const file = promptOverridePath(agentDir);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
}

test("default used without override", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	expect(prompt).toContain("tsrepl");
});

test("override wins", async () => {
	const agentDir = await makeAgentDir();
	await writeOverride(agentDir, "custom prompt");
	expect(await resolveCodeModePrompt(agentDir)).toBe("custom prompt");
});

test("empty override falls back", async () => {
	const agentDir = await makeAgentDir();
	await writeOverride(agentDir, "");
	expect(await resolveCodeModePrompt(agentDir)).toContain("tsrepl");
});

test("blank override falls back", async () => {
	const agentDir = await makeAgentDir();
	await writeOverride(agentDir, "   \n");
	expect(await resolveCodeModePrompt(agentDir)).toContain("tsrepl");
});

test("unreadable override falls back", async () => {
	const agentDir = await makeAgentDir();
	await mkdir(promptOverridePath(agentDir), { recursive: true });
	expect(await resolveCodeModePrompt(agentDir)).toContain("tsrepl");
});

test("default covers code-mode rules", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	for (const word of ["tsrepl", "return", "rlm", "note", "スキル"]) {
		expect(prompt).toContain(word);
	}
});

test("default states the tool selection rule", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	expect(prompt).toContain("bash");
	expect(prompt).toContain("tsrepl");
	// bash に残る形をこのセクション自身が列挙する。許可フィルタは guard と同じ一覧から作る。
	// spec 「規則の文面の単一出典」: 基準は promptGuidelines の 4 項目と一字一句一致し、別の書き回しを
	// 含めない。フィルタ一覧は guard と同じ `BASH_PIPE_ALLOW_FILTERS` から作る。
	expect(prompt).toContain(`- ツール選択の基準: ${TSREPL_PROMPT_GUIDELINES.join(" / ")}`);
	expect(prompt.match(/ツール選択の基準/g)?.length).toBe(1);
	expect(prompt).toContain(BASH_PIPE_ALLOW_FILTERS.join(" / "));
	// pi の既定では `bash` がファイル操作の実行面。spirits のセクションが tsrepl を唯一または最優先の
	// 位置に置く文言に戻していないこと。
	expect(prompt).not.toMatch(/主要な.*実行面|最優先|唯一/);
});

test("default includes tool call examples", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	expect(prompt).toContain('tool("bash"');
	expect(prompt).toContain("exit_code");

	const start = prompt.indexOf("```ts");
	const block = prompt.slice(start + "```ts".length, prompt.lastIndexOf("```"));
	const lines = block.split("\n").filter((line) => line.trim() !== "");
	expect(lines.length).toBeGreaterThan(0);
	expect(lines.length).toBeLessThanOrEqual(15);
	// pi の bash は pipefail を付けない。`cmd | tail` の exit_code は tail のものになるため、
	// 成否を exit_code で確認する例にパイプは出せない。
	for (const command of [...block.matchAll(/command: "([^"]*)"/g)]) {
		expect(command[1]).not.toContain("|");
	}
});

test("override removal restores default", async () => {
	const agentDir = await makeAgentDir();
	await writeOverride(agentDir, "custom prompt");
	expect(await resolveCodeModePrompt(agentDir)).toBe("custom prompt");
	await rm(promptOverridePath(agentDir));
	expect(await resolveCodeModePrompt(agentDir)).toContain("tsrepl");
});

// change rebalance-action-surface-guidance: code-mode の例は bash を呼ぶ最短形と `await use()` を示す。
// 遮られたときの行き先は guard の block reason が書き、ここでは繰り返さない。
test("code-mode prompt shows the sh shortcut and awaited use", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	expect(TSREPL_PROMPT_GUIDELINES).toHaveLength(4);
	// guard のブロック理由をここへ写さない。
	for (const phrase of ["bash ガード", "このコマンドは実行しません", "記録のみ"] as const) {
		expect(prompt, phrase).not.toContain(phrase);
	}
	// bash を呼ぶ最短形として `sh` を使わせ、`tool("bash", ...)` と `exit_code` の説明は残す。
	expect(prompt).toContain(`await sh(`);
	expect(prompt).toContain('tool("bash", { command, ...options })');
	expect(prompt).toContain("exit_code");
	expect(prompt).toContain(`${SH_HOST_FN_NAME}(command, options?)`);
	expect(prompt).toContain("tool(name, args)");
	// import の例は `await use(...)` の形(実測で `await` 漏れの `ReferenceError` が出ていた)。
	expect(prompt).toContain('await use("node:');
	expect(prompt).not.toMatch(/(?:^|[^t] )use\("/);
});

// spec 「ファイルを sh で読む例と python の例を載せない」
test("code-mode examples do not read files with cat or run python", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	const code = prompt
		.split("```")
		.filter((_part, index) => index % 2 === 1)
		.join("\n");
	expect(code).not.toContain('sh("cat ');
	expect(code).not.toContain('command: "cat ');
	expect(code).not.toContain("python");
	// 置き換え後の例は `await use("node:fs/promises")` でファイルを読む。
	expect(code).toContain('await use("node:fs/promises")');
});

// change add-action-surface-guard (S-2): the code block shows all three call shapes, not only `sh`.
test("prompt examples show sh, tool(bash), and a non-bash tool", async () => {
	const prompt = await resolveCodeModePrompt(await makeAgentDir());
	const blocks = prompt.split("```").filter((_part, index) => index % 2 === 1);
	expect(blocks.length).toBeGreaterThanOrEqual(1);
	const code = blocks.join("\n");
	expect(code).toContain("await sh(");
	expect(code).toContain('await tool("bash"');
	// bash を呼ばない `tool(` の例も 1 つ。`sh` と `tool("bash")` だけのコードブロックでは不可。
	const otherToolCall = code
		.split("\n")
		.filter((line) => line.includes("await tool("))
		.filter((line) => !line.includes('tool("bash"'));
	expect(otherToolCall.length).toBeGreaterThanOrEqual(1);
	expect(code).toContain("exit_code");
});
