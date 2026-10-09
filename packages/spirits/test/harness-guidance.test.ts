import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { buildGoalGuidance, buildNoteGuidance } from "../src/harness/guidance.ts";
import { createGoalHostFn } from "../src/harness/goal.ts";
import { createNoteHostFn } from "../src/harness/memory.ts";
import { createHarnessTools } from "../src/harness/tools.ts";
import { createTsreplTool } from "../src/tools.ts";
import { makeToolContext } from "./support.ts";

class FakePi {
	appendEntry(): void {}
}

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-guidance-"));
}

/** Run a codemode tool through the same call path the cell uses, ignoring the result text. */
async function callTool(
	tool: { execute: (...args: never[]) => Promise<unknown> },
	params: Record<string, unknown>,
): Promise<void> {
	const ctx = makeToolContext() as ExtensionToolContext;
	await (tool.execute as (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionToolContext) => Promise<unknown>)(
		"id",
		params,
		undefined,
		undefined,
		ctx,
	);
}

test("goal guidance covers get and set", () => {
	const guidance = buildGoalGuidance();
	expect(guidance).toContain("goal()");
	expect(guidance).toContain("goal(text)");
});

test("note guidance covers signature and newline normalization", () => {
	const guidance = buildNoteGuidance();
	expect(guidance).toContain("note(text)");
	expect(guidance).toContain("改行");
	expect(guidance).toContain("半角スペース");
});

test("note guidance lists skill and prompt tools with params", () => {
	const guidance = buildNoteGuidance();
	for (const name of ["spirits_skill_save", "spirits_skill_list", "spirits_skill_delete", "spirits_prompt_set"]) {
		expect(guidance).toContain(name);
	}
	for (const param of ["name", "description", "body", "content"]) {
		expect(guidance).toContain(param);
	}
});

test("guidance mentions reload", () => {
	expect(buildNoteGuidance()).toContain("/reload");
});

test("tsrepl description includes harness guidance", async () => {
	const agentDir = await makeAgentDir();
	const goal = createGoalHostFn({ pi: new FakePi() });
	const note = createNoteHostFn({ pi: new FakePi(), agentDir });
	const tool = createTsreplTool({ hostFns: [goal, note] });
	for (const word of [
		"goal(",
		"note(",
		"spirits_skill_save",
		"spirits_skill_list",
		"spirits_skill_delete",
		"spirits_prompt_set",
		"/reload",
	]) {
		expect(tool.description).toContain(word);
	}
});

test("guidance survives prompt override", async () => {
	const agentDir = await makeAgentDir();
	const promptSet = createHarnessTools(agentDir).find((tool) => tool.name === "spirits_prompt_set");
	expect(promptSet).toBeDefined();
	await callTool(promptSet as { execute: (...args: never[]) => Promise<unknown> }, { content: "custom prompt" });

	const description = createTsreplTool({
		hostFns: [createGoalHostFn({ pi: new FakePi() }), createNoteHostFn({ pi: new FakePi(), agentDir })],
	}).description;
	expect(description).toContain("spirits_skill_save");
	expect(description).toContain("spirits_prompt_set");
});

test("description omits guidance without harness", () => {
	expect(createTsreplTool().description).not.toContain("spirits_skill_save");
});
