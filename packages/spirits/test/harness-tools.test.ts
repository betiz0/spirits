import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SKILL_DESCRIPTION_MAX_LENGTH } from "../src/constants.ts";
import { promptBackupPath, promptOverridePath, skillsDir } from "../src/harness/paths.ts";
import { createHarnessTools } from "../src/harness/tools.ts";
import { makeToolContext } from "./support.ts";

const DRAFT = { name: "release-check", description: "check a release", body: "run bun test" };

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-tools-"));
}

async function exists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

function toolNamed(agentDir: string, name: string): ToolDefinition {
	const tool = createHarnessTools(agentDir).find((candidate) => candidate.name === name);
	if (tool === undefined) {
		throw new Error(`missing tool ${name}`);
	}
	return tool;
}

async function runTool(tool: ToolDefinition, params: Record<string, unknown>): Promise<string> {
	const execute = tool.execute as (
		id: string,
		params: Record<string, unknown>,
		signal: undefined,
		onUpdate: undefined,
		ctx: ReturnType<typeof makeToolContext>,
	) => Promise<AgentToolResult<unknown>>;
	const result = await execute("id", params, undefined, undefined, makeToolContext());
	return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

test("save tool returns path", async () => {
	const agentDir = await makeAgentDir();
	const text = await runTool(toolNamed(agentDir, "spirits_skill_save"), DRAFT);
	expect(text).toContain(path.join(skillsDir(agentDir), "release-check", "SKILL.md"));
});

test("save tool mentions reload", async () => {
	const agentDir = await makeAgentDir();
	const text = await runTool(toolNamed(agentDir, "spirits_skill_save"), DRAFT);
	expect(text).toContain("/reload");
});

test("list tool lists skills", async () => {
	const agentDir = await makeAgentDir();
	await runTool(toolNamed(agentDir, "spirits_skill_save"), DRAFT);
	await runTool(toolNamed(agentDir, "spirits_skill_save"), {
		name: "second-skill",
		description: "another description",
		body: "body",
	});
	const text = await runTool(toolNamed(agentDir, "spirits_skill_list"), {});
	expect(text).toContain("release-check");
	expect(text).toContain("check a release");
	expect(text).toContain("second-skill");
	expect(text).toContain("another description");
	expect(text).toContain("2 件");
});

test("delete tool confirms", async () => {
	const agentDir = await makeAgentDir();
	await runTool(toolNamed(agentDir, "spirits_skill_save"), DRAFT);
	const text = await runTool(toolNamed(agentDir, "spirits_skill_delete"), { name: DRAFT.name });
	expect(text).toContain("削除");
	expect(await exists(path.join(skillsDir(agentDir), DRAFT.name))).toBe(false);
});

test("tool names are the contract", async () => {
	const agentDir = await makeAgentDir();
	expect(createHarnessTools(agentDir).map((tool) => tool.name)).toEqual([
		"spirits_skill_save",
		"spirits_skill_list",
		"spirits_skill_delete",
		"spirits_prompt_set",
	]);
});

test("prompt set writes override and backup", async () => {
	const agentDir = await makeAgentDir();
	const text = await runTool(toolNamed(agentDir, "spirits_prompt_set"), { content: "custom prompt" });
	expect(await readFile(promptOverridePath(agentDir), "utf8")).toBe("custom prompt");
	expect(text).toContain(promptOverridePath(agentDir));
	expect(text).toContain(promptBackupPath(agentDir));
});

test("prompt set backs up default first", async () => {
	const agentDir = await makeAgentDir();
	await runTool(toolNamed(agentDir, "spirits_prompt_set"), { content: "custom prompt" });
	expect(await readFile(promptBackupPath(agentDir), "utf8")).toContain("tsrepl");
});

test("prompt set backup is previous content", async () => {
	const agentDir = await makeAgentDir();
	const tool = toolNamed(agentDir, "spirits_prompt_set");
	await runTool(tool, { content: "first" });
	await runTool(tool, { content: "second" });
	expect(await readFile(promptOverridePath(agentDir), "utf8")).toBe("second");
	expect(await readFile(promptBackupPath(agentDir), "utf8")).toBe("first");
});

test("prompt set rejects empty or blank", async () => {
	const agentDir = await makeAgentDir();
	const tool = toolNamed(agentDir, "spirits_prompt_set");
	for (const content of ["", "   "]) {
		await expect(runTool(tool, { content })).rejects.toThrow();
	}
	expect(await exists(promptOverridePath(agentDir))).toBe(false);
	expect(await exists(promptBackupPath(agentDir))).toBe(false);
});

test("prompt set keeps override when backup fails", async () => {
	const agentDir = await makeAgentDir();
	await mkdir(promptBackupPath(agentDir), { recursive: true });
	await expect(runTool(toolNamed(agentDir, "spirits_prompt_set"), { content: "custom" })).rejects.toThrow();
	expect(await exists(promptOverridePath(agentDir))).toBe(false);
});

test("all tools are codemode", async () => {
	const agentDir = await makeAgentDir();
	expect(createHarnessTools(agentDir).every((tool) => tool.exposure === "codemode")).toBe(true);
});

test("save tool states description limit", async () => {
	const agentDir = await makeAgentDir();
	const tool = toolNamed(agentDir, "spirits_skill_save");
	const parameters = tool.parameters as {
		properties?: Record<string, { description?: string }>;
	};
	expect(parameters.properties?.description?.description).toContain(String(SKILL_DESCRIPTION_MAX_LENGTH));
});
