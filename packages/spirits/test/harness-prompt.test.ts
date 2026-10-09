import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptOverridePath } from "../src/harness/paths.ts";
import { resolveCodeModePrompt } from "../src/harness/prompt.ts";

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

test("override removal restores default", async () => {
	const agentDir = await makeAgentDir();
	await writeOverride(agentDir, "custom prompt");
	expect(await resolveCodeModePrompt(agentDir)).toBe("custom prompt");
	await rm(promptOverridePath(agentDir));
	expect(await resolveCodeModePrompt(agentDir)).toContain("tsrepl");
});
