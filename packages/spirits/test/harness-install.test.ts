import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionHandler,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { registerContinualHarness } from "../src/harness/install.ts";
import { memoryDir, notesPath, promptOverridePath } from "../src/harness/paths.ts";
import { makeScope, makeToolContext } from "./support.ts";

class FakePi implements ExtensionAPI {
	readonly tools: ToolDefinition[] = [];
	readonly entries: Array<{ customType: string; data: unknown }> = [];
	readonly handlers: Array<ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>> = [];

	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void {
		this.tools.push(tool as ToolDefinition);
	}

	appendEntry<T = unknown>(customType: string, data?: T): void {
		this.entries.push({ customType, data });
	}

	on(
		_event: "before_agent_start",
		handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
	): () => void {
		this.handlers.push(handler);
		return () => {};
	}
}

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-install-"));
}

async function writeMemoryFile(agentDir: string, name: string, content: string): Promise<void> {
	const dir = memoryDir(agentDir);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, name), content);
}

function makeEvent(): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		prompt: "hello",
		systemPromptOptions: { sections: {} },
	};
}

async function fire(pi: FakePi, event: BeforeAgentStartEvent): Promise<void> {
	for (const handler of pi.handlers) {
		await handler(event, makeToolContext());
	}
}

test("registers four codemode tools", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	expect(pi.tools.map((tool) => tool.name)).toEqual([
		"spirits_skill_save",
		"spirits_skill_list",
		"spirits_skill_delete",
		"spirits_prompt_set",
	]);
	expect(pi.tools.every((tool) => tool.exposure === "codemode")).toBe(true);
});

test("returns goal and note host fns", async () => {
	const agentDir = await makeAgentDir();
	const hostFns = registerContinualHarness(new FakePi(), { agentDir, env: {} });
	expect(hostFns.map((entry) => entry.name)).toEqual(["goal", "note"]);
});

test("before_agent_start adds spirits section", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	await fire(pi, event);
	expect(event.systemPromptOptions.sections["spirits"]).toContain("tsrepl");
});

test("before_agent_start adds memory section", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "notes.md", "- memory-marker\n");
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	await fire(pi, event);
	expect(event.systemPromptOptions.sections["spirits_memory"]).toContain("memory-marker");
});

test("before_agent_start keeps other sections", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	event.systemPromptOptions.sections["rules"] = "keep me";
	event.systemPromptOptions.forceSystemPrompt = "fixed prompt";
	await fire(pi, event);
	expect(event.systemPromptOptions.sections["rules"]).toBe("keep me");
	expect(event.systemPromptOptions.forceSystemPrompt).toBe("fixed prompt");
});

test("omits memory section without files", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	await fire(pi, event);
	expect("spirits_memory" in event.systemPromptOptions.sections).toBe(false);
});

test("uses override in section", async () => {
	const agentDir = await makeAgentDir();
	const override = promptOverridePath(agentDir);
	await mkdir(path.dirname(override), { recursive: true });
	await writeFile(override, "custom prompt");
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	await fire(pi, event);
	expect(event.systemPromptOptions.sections["spirits"]).toBe("custom prompt");
});

test("memory limits from env", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", `${"x".repeat(5000)}\n`);
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: { SPIRITS_MEMORY_CHAR_LIMIT: "300" } });
	const event = makeEvent();
	await fire(pi, event);
	expect(event.systemPromptOptions.sections["spirits_memory"]?.length).toBeLessThanOrEqual(300);
});

test("handler survives unreadable memory", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "ok.md", "readable-line\n");
	await symlink(path.join(agentDir, "missing-target"), path.join(memoryDir(agentDir), "x.md"));
	const pi = new FakePi();
	registerContinualHarness(pi, { agentDir, env: {} });
	const event = makeEvent();
	await fire(pi, event);
	const memory = event.systemPromptOptions.sections["spirits_memory"] ?? "";
	expect(memory).toContain("readable-line");
	expect(memory).not.toContain("x.md");
});

test("relative agent dir yields absolute paths", async () => {
	const base = await makeAgentDir();
	const previousCwd = process.cwd();
	try {
		process.chdir(base);
		const relative = path.join("sub", "agent");
		await writeMemoryFile(relative, "notes.md", "- relative-marker\n");
		const pi = new FakePi();
		const hostFns = registerContinualHarness(pi, { agentDir: relative, env: {} });
		const event = makeEvent();
		await fire(pi, event);
		const memory = event.systemPromptOptions.sections["spirits_memory"] ?? "";
		const expectedNotes = notesPath(path.resolve(relative));
		expect(path.isAbsolute(expectedNotes)).toBe(true);
		const heading = memory
			.split("\n")
			.find((line) => line.startsWith("### ") && line.includes("notes.md"));
		expect(heading).toBeDefined();
		expect(heading).toContain(expectedNotes);

		const note = hostFns.find((entry) => entry.name === "note");
		expect(note).toBeDefined();
		const fn = note?.create(makeScope().scope);
		const result = (await fn?.("relative path check")) as string;
		expect(result).toContain(expectedNotes);
	} finally {
		process.chdir(previousCwd);
	}
});
