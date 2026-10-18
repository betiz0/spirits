import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptOverridePath } from "../src/harness/paths.ts";
import { resolveCodeModePrompt } from "../src/harness/prompt.ts";
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
	// 選択基準は tsrepl のツール宣言(promptGuidelines)と同じ文言で、2 か所に手書きしない。
	for (const guideline of TSREPL_PROMPT_GUIDELINES) {
		expect(prompt).toContain(guideline);
	}
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
