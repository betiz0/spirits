import { expect, test } from "bun:test";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionHandler,
	SessionEntry,
	SessionStartEvent,
	SessionTreeEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import spiritsExtension from "../src/index.ts";
import { createManageTodosTool, MANAGE_TODOS_PROMPT_GUIDELINES, registerManageTodos } from "../src/todo/tool.ts";
import { TODO_ENTRY_TYPE } from "../src/todo/state.ts";
import { makeToolContext } from "./support.ts";

class FakePi implements ExtensionAPI {
	readonly tools: ToolDefinition[] = [];
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void {
		this.tools.push(tool as ToolDefinition);
	}

	appendEntry<T = unknown>(customType: string, data?: T): void {
		this.entries.push({ customType, data });
	}

	getSettings(): Record<string, never> {
		return {};
	}

	on(
		event: "before_agent_start",
		handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
	): () => void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): () => void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): () => void;
	on(_event: string, _handler: unknown): () => void {
		return () => {};
	}
}

type Execute = (
	id: string,
	params: { updates: unknown[] },
	signal: undefined,
	onUpdate: undefined,
	ctx: ReturnType<typeof makeToolContext>,
) => Promise<{ content: readonly unknown[]; details: unknown; isError?: boolean }>;

async function runTool(
	pi: FakePi,
	updates: unknown[],
	branch: readonly SessionEntry[] = [],
): Promise<{ content: readonly unknown[]; details: unknown; isError?: boolean }> {
	const tool = createManageTodosTool({ pi });
	return (tool.execute as unknown as Execute)(
		"id",
		{ updates },
		undefined,
		undefined,
		makeToolContext({ sessionManager: { getBranch: () => branch } }),
	);
}

function branchFrom(pi: FakePi): SessionEntry[] {
	return pi.entries.map((entry) => ({ type: "custom", customType: entry.customType, data: entry.data }));
}

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
		return first.text;
	}
	return "";
}

test("registers manage_todos as a direct sequential tool", () => {
	const pi = new FakePi();
	registerManageTodos(pi);
	const tool = pi.tools.find((candidate) => candidate.name === "manage_todos");
	expect(tool).toBeDefined();
	expect(tool?.exposure).toBe("direct");
	expect(tool?.executionMode).toBe("sequential");
});

test("spiritsExtension registers manage_todos", () => {
	const pi = new FakePi();
	spiritsExtension(pi);
	expect(pi.tools.map((tool) => tool.name)).toContain("manage_todos");
});

test("appends one snapshot per successful call", async () => {
	const pi = new FakePi();
	const first = await runTool(pi, [{ op: "add", text: "Fix bug" }]);
	expect(first.isError).toBeFalsy();
	expect(pi.entries).toHaveLength(1);
	expect(pi.entries[0]).toEqual({
		customType: TODO_ENTRY_TYPE,
		data: { nextId: 2, items: [{ id: 1, text: "Fix bug", done: false }] },
	});

	const second = await runTool(pi, [{ op: "add", text: "Write test" }], branchFrom(pi));
	expect(second.isError).toBeFalsy();
	expect(pi.entries).toHaveLength(2);
	expect(pi.entries[1].data).toEqual({
		nextId: 3,
		items: [
			{ id: 1, text: "Fix bug", done: false },
			{ id: 2, text: "Write test", done: false },
		],
	});
});

test("returns isError and appends nothing for an invalid call", async () => {
	const pi = new FakePi();
	const result = await runTool(pi, [
		{ op: "add", text: "Fix bug" },
		{ op: "update", id: 9, done: true },
	]);
	expect(result.isError).toBe(true);
	expect(textOf(result)).toContain("updates[1]");
	expect(textOf(result)).toContain("ID 9");
	expect(pi.entries).toHaveLength(0);
});

test("result lists all items with ids", async () => {
	const pi = new FakePi();
	const result = await runTool(pi, [
		{ op: "add", text: "Fix bug" },
		{ op: "add", text: "Write test" },
		{ op: "update", id: 2, done: true },
	]);
	const text = textOf(result);
	expect(text).toContain("#1 Fix bug");
	expect(text).toContain("#2 Write test");
	expect(text).toContain("- [x] #2");
	expect(text).toContain("- [ ] #1");
	expect(result.details).toEqual({
		nextId: 3,
		items: [
			{ id: 1, text: "Fix bug", done: false },
			{ id: 2, text: "Write test", done: true },
		],
	});
});

test("guidelines say ids are assigned by the tool", () => {
	const pi = new FakePi();
	registerManageTodos(pi);
	const tool = pi.tools.find((candidate) => candidate.name === "manage_todos");
	const guidelines = (tool?.promptGuidelines ?? []).join("\n");
	expect(guidelines).toContain("ツールが採番");
	expect(guidelines).toContain("再利用されない");
	expect(MANAGE_TODOS_PROMPT_GUIDELINES.join("\n")).toContain("ID");
});
