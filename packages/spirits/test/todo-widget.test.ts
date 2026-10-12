import { expect, test } from "bun:test";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionHandler,
	ExtensionMode,
	ExtensionToolContext,
	ExtensionUIContext,
	SessionEntry,
	SessionStartEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { ENV_TODO_MAX_LINES } from "../src/constants.ts";
import { TODO_ENTRY_TYPE, type TodoItem, type TodoSnapshot } from "../src/todo/state.ts";
import { createManageTodosTool } from "../src/todo/tool.ts";
import { registerTodoPanel, renderTodoLines, TODO_WIDGET_KEY, updateTodoPanel } from "../src/todo/widget.ts";
import { makeToolContext } from "./support.ts";

function snapshot(items: TodoItem[]): TodoSnapshot {
	return { nextId: items.reduce((max, item) => Math.max(max, item.id), 0) + 1, items };
}

function item(id: number, done = false, text = `task ${id}`): TodoItem {
	return { id, text, done };
}

function todoEntry(data: unknown): SessionEntry {
	return { type: "custom", customType: TODO_ENTRY_TYPE, data };
}

type SetWidgetCall = { key: string; content: unknown; options?: { placement?: string } };

function panelContext(mode: ExtensionMode, branch: readonly SessionEntry[], calls: SetWidgetCall[]): ExtensionToolContext {
	const ctx = makeToolContext({ sessionManager: { getBranch: () => branch } });
	ctx.mode = mode;
	const record = ((key: string, content: unknown, options?: { placement?: string }) => {
		calls.push({ key, content, options });
	}) as ExtensionUIContext["setWidget"];
	ctx.ui.setWidget = record;
	return ctx;
}

type WidgetFactory = (tui: unknown, theme: unknown) => { render(width: number): string[]; invalidate(): void };

function renderWidget(content: unknown, width: number): string[] {
	return (content as WidgetFactory)(undefined, undefined).render(width);
}

type Execute = (
	id: string,
	params: { updates: unknown[] },
	signal: undefined,
	onUpdate: undefined,
	ctx: ExtensionToolContext,
) => Promise<{ content: readonly unknown[]; details: unknown; isError?: boolean }>;

class FakePi {
	readonly sessionStartHandlers: Array<ExtensionHandler<SessionStartEvent>> = [];
	readonly sessionTreeHandlers: Array<ExtensionHandler<SessionTreeEvent>> = [];

	on(
		event: "before_agent_start",
		handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
	): () => void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): () => void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): () => void;
	on(event: string, handler: unknown): () => void {
		if (event === "session_start") {
			this.sessionStartHandlers.push(handler as ExtensionHandler<SessionStartEvent>);
		} else if (event === "session_tree") {
			this.sessionTreeHandlers.push(handler as ExtensionHandler<SessionTreeEvent>);
		}
		return () => {};
	}
}

test("pending items first up to max lines", () => {
	const items = [
		...[1, 2, 3, 4, 5, 6, 7].map((id) => item(id)),
		item(8, true, "done a"),
		item(9, true, "done b"),
	];
	const lines = renderTodoLines(snapshot(items), 5, 80);
	expect(lines.slice(0, 5)).toEqual(["○ #1 task 1", "○ #2 task 2", "○ #3 task 3", "○ #4 task 4", "○ #5 task 5"]);
	expect(lines).toHaveLength(6);
	expect(lines[5]).toBe("+2 more · 2 done");
	expect(lines.join("\n")).not.toContain("done a");
});

test("hidden pending and done counts share one line", () => {
	const both = renderTodoLines(
		snapshot([...[1, 2, 3, 4, 5, 6, 7].map((id) => item(id)), item(8, true), item(9, true)]),
		5,
		80,
	);
	expect(both.at(-1)).toBe("+2 more · 2 done");

	const doneOnly = renderTodoLines(snapshot([item(1), item(2), item(3, true), item(4, true), item(5, true)]), 5, 80);
	expect(doneOnly.at(-1)).toBe("3 done");

	const pendingOnly = renderTodoLines(snapshot([1, 2, 3, 4, 5, 6].map((id) => item(id))), 5, 80);
	expect(pendingOnly.at(-1)).toBe("+1 more");
});

test("all done renders a single line", () => {
	const lines = renderTodoLines(snapshot([item(1, true), item(2, true), item(3, true)]), 5, 80);
	expect(lines).toEqual(["✓ all done"]);
});

test("no items renders nothing", () => {
	expect(renderTodoLines(snapshot([]), 5, 80)).toEqual([]);
});

test("lines are truncated to width", () => {
	const lines = renderTodoLines(snapshot([item(1, false, "あ".repeat(30))]), 5, 10);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain("...");
	expect(Bun.stringWidth(lines[0])).toBeLessThanOrEqual(10);

	const many = snapshot([
		...Array.from({ length: 200 }, (_, index) => item(index + 1, false)),
		...Array.from({ length: 300 }, (_, index) => item(201 + index, true)),
	]);
	const last = renderTodoLines(many, 5, 8).at(-1)!;
	expect(last).toContain("...");
	expect(Bun.stringWidth(last)).toBeLessThanOrEqual(8);
});

test("successful tool call updates the widget", async () => {
	const calls: SetWidgetCall[] = [];
	const ctx = panelContext("tui", [], calls);
	const tool = createManageTodosTool({ pi: { appendEntry: () => {} }, maxLines: 5 });

	const result = await (tool.execute as unknown as Execute)(
		"id",
		{ updates: [{ op: "add", text: "Fix bug" }] },
		undefined,
		undefined,
		ctx,
	);

	expect(result.isError).toBeFalsy();
	expect(calls).toHaveLength(1);
	expect(calls[0].key).toBe(TODO_WIDGET_KEY);
	expect(calls[0].options).toEqual({ placement: "belowEditor" });
	expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 Fix bug"]);
});

test("session_start renders the branch state for every reason", async () => {
	const pi = new FakePi();
	registerTodoPanel(pi);
	const branch: SessionEntry[] = [todoEntry({ nextId: 2, items: [{ id: 1, text: "A1", done: false }] })];

	for (const reason of ["startup", "reload", "new", "resume", "fork"] as const) {
		const calls: SetWidgetCall[] = [];
		await pi.sessionStartHandlers[0]({ type: "session_start", reason }, panelContext("tui", branch, calls));
		expect(calls).toHaveLength(1);
		expect(calls[0].key).toBe(TODO_WIDGET_KEY);
		expect(calls[0].options).toEqual({ placement: "belowEditor" });
		expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 A1"]);
	}
});

test("session_tree re-renders for the new leaf", async () => {
	const pi = new FakePi();
	registerTodoPanel(pi);
	const first: SessionEntry[] = [todoEntry({ nextId: 2, items: [{ id: 1, text: "A1", done: false }] })];
	const second: SessionEntry[] = [
		todoEntry({
			nextId: 3,
			items: [
				{ id: 1, text: "A1", done: true },
				{ id: 2, text: "A2", done: false },
			],
		}),
	];

	const firstCalls: SetWidgetCall[] = [];
	await pi.sessionTreeHandlers[0](
		{ type: "session_tree", newLeafId: "first", oldLeafId: null },
		panelContext("tui", first, firstCalls),
	);
	expect(renderWidget(firstCalls[0].content, 80)).toEqual(["○ #1 A1"]);

	const secondCalls: SetWidgetCall[] = [];
	await pi.sessionTreeHandlers[0](
		{ type: "session_tree", newLeafId: "second", oldLeafId: "first" },
		panelContext("tui", second, secondCalls),
	);
	expect(renderWidget(secondCalls[0].content, 80)).toEqual(["○ #2 A2", "1 done"]);
});

test("empty branch clears the widget", async () => {
	const pi = new FakePi();
	registerTodoPanel(pi);
	const calls: SetWidgetCall[] = [];

	await pi.sessionStartHandlers[0]({ type: "session_start", reason: "reload" }, panelContext("tui", [], calls));

	expect(calls).toEqual([{ key: TODO_WIDGET_KEY, content: undefined, options: undefined }]);
});

test("uses the configured max lines", async () => {
	process.env[ENV_TODO_MAX_LINES] = "3";
	try {
		const pi = new FakePi();
		registerTodoPanel(pi);
		const branch: SessionEntry[] = [
			todoEntry({
				nextId: 5,
				items: [1, 2, 3, 4].map((id) => ({ id, text: `task ${id}`, done: false })),
			}),
		];
		const calls: SetWidgetCall[] = [];

		await pi.sessionStartHandlers[0]({ type: "session_start", reason: "startup" }, panelContext("tui", branch, calls));

		expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 task 1", "○ #2 task 2", "○ #3 task 3", "+1 more"]);
	} finally {
		delete process.env[ENV_TODO_MAX_LINES];
	}
});

test("non-tui modes set no widget", async () => {
	const directCalls: SetWidgetCall[] = [];
	updateTodoPanel(panelContext("print", [], directCalls), snapshot([item(1)]), 5);
	expect(directCalls).toHaveLength(0);

	const appended: unknown[] = [];
	const calls: SetWidgetCall[] = [];
	const tool = createManageTodosTool({ pi: { appendEntry: (_customType, data) => void appended.push(data) }, maxLines: 5 });
	await (tool.execute as unknown as Execute)(
		"id",
		{ updates: [{ op: "add", text: "Fix bug" }] },
		undefined,
		undefined,
		panelContext("print", [], calls),
	);
	expect(appended).toHaveLength(1);
	expect(calls).toHaveLength(0);
});
