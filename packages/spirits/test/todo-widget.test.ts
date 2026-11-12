import { expect, test } from "bun:test";
import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionHandler,
	ExtensionMode,
	ExtensionToolContext,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionEntry,
	SessionStartEvent,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionTreeEvent,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { resolveTodoConfig, type EnvLike, type TodoConfig } from "../src/config.ts";
import { DEFAULT_TODO_TOGGLE_KEY, ENV_TODO_MAX_LINES } from "../src/constants.ts";
import { TODO_ENTRY_TYPE, type TodoItem, type TodoSnapshot } from "../src/todo/state.ts";
import { createManageTodosTool } from "../src/todo/tool.ts";
import {
	createTodoPanelState,
	registerTodoPanel,
	renderTodoLines,
	renderTodoSummaryLines,
	TODO_WIDGET_KEY,
	updateTodoPanel,
	type TodoPanelState,
} from "../src/todo/widget.ts";
import { makeToolContext, type RecordedShortcut } from "./support.ts";

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
	const ctx = makeToolContext({ sessionManager: { getBranch: () => branch, buildSessionProjection: () => ({ entries: [], messages: [] }) } });
	ctx.mode = mode;
	const record = ((key: string, content: unknown, options?: { placement?: string }) => {
		calls.push({ key, content, options });
	}) as ExtensionUIContext["setWidget"];
	ctx.ui.setWidget = record;
	return ctx;
}

/** The panel settings of a run with no settings file, resolved the way the entry point resolves them. */
function todoConfig(env: EnvLike = {}): TodoConfig {
	return resolveTodoConfig(env, {});
}

/** An expanded panel state, for the tests that do not exercise collapsing. */
function expanded(): TodoPanelState {
	return createTodoPanelState(false);
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
	/** Shortcuts registered through `registerShortcut()`, keyed by the key id as registered. */
	readonly shortcuts = new Map<string, RecordedShortcut>();
	/** Entries passed to `appendEntry()`, so a test can prove the panel writes nothing to the session. */
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}

	registerShortcut(shortcut: string, options: RecordedShortcut): void {
		this.shortcuts.set(shortcut, options);
	}

	/** Run the handler registered for a key, the way pi's input layer fires a shortcut. */
	fireShortcut(key: string, ctx: Parameters<RecordedShortcut["handler"]>[0]): void {
		this.shortcuts.get(key)?.handler(ctx);
	}

	on(
		event: "before_agent_start",
		handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
	): () => void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): () => void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): () => void;
	on(
		event: "resources_discover",
		handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>,
	): () => void;
	on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): () => void;
	on(event: "agent_settled", handler: ExtensionHandler<AgentSettledEvent>): () => void;
	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): () => void;
	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): () => void;
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): () => void;
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

// spec "session-todo / 折りたたみ時は件数サマリだけを表示する"
test("折りたたみサマリは未完了件数と完了件数を示す", () => {
	const items = [item(1), item(2), item(3), item(4, true), item(5, true)];
	expect(renderTodoSummaryLines(snapshot(items), 80)).toEqual(["3 pending · 2 done"]);
	// 項目行は出さず、未完了は上限で割らない。
	const many = snapshot([...Array.from({ length: 7 }, (_, index) => item(index + 1)), item(8, true)]);
	expect(renderTodoSummaryLines(many, 80)).toEqual(["7 pending · 1 done"]);
});

test("完了 0 件なら pending だけ", () => {
	expect(renderTodoSummaryLines(snapshot([item(1), item(2), item(3)]), 80)).toEqual(["3 pending"]);
});

test("全件完了は all done の 1 行", () => {
	expect(renderTodoSummaryLines(snapshot([item(1, true), item(2, true), item(3, true)]), 80)).toEqual([
		"✓ all done",
	]);
});

test("0 件は空", () => {
	expect(renderTodoSummaryLines(snapshot([]), 80)).toEqual([]);
});

test("幅で切り詰める", () => {
	const line = renderTodoSummaryLines(snapshot([item(1), item(2, true)]), 8)[0]!;
	expect(line).toContain("...");
	expect(Bun.stringWidth(line)).toBeLessThanOrEqual(8);
});

test("successful tool call updates the widget", async () => {
	const calls: SetWidgetCall[] = [];
	const ctx = panelContext("tui", [], calls);
	const tool = createManageTodosTool({ pi: { appendEntry: () => {} }, maxLines: 5, state: expanded() });

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
	registerTodoPanel(pi, todoConfig(), expanded());
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
	registerTodoPanel(pi, todoConfig(), expanded());
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
	registerTodoPanel(pi, todoConfig(), expanded());
	const calls: SetWidgetCall[] = [];

	await pi.sessionStartHandlers[0]({ type: "session_start", reason: "reload" }, panelContext("tui", [], calls));

	expect(calls).toEqual([{ key: TODO_WIDGET_KEY, content: undefined, options: undefined }]);
});

test("uses the configured max lines", async () => {
	process.env[ENV_TODO_MAX_LINES] = "3";
	try {
		const pi = new FakePi();
		registerTodoPanel(pi, todoConfig(process.env), expanded());
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

// spec "session-todo / 折りたたみ時は件数サマリだけを表示する": 開閉状態で描画を選ぶ
test("折りたたみ時は項目行を出さない", () => {
	const calls: SetWidgetCall[] = [];
	const ctx = panelContext("tui", [], calls);
	const state = createTodoPanelState(false);
	state.toggle();

	updateTodoPanel(ctx, snapshot([item(1), item(2), item(3, true)]), 5, state);

	expect(calls).toHaveLength(1);
	expect(renderWidget(calls[0].content, 80)).toEqual(["2 pending · 1 done"]);
});

test("展開へ戻すと項目行が出る", () => {
	const calls: SetWidgetCall[] = [];
	const ctx = panelContext("tui", [], calls);
	const state = createTodoPanelState(true);
	expect(state.collapsed()).toBe(true);
	state.toggle();

	updateTodoPanel(ctx, snapshot([item(1), item(2), item(3, true)]), 5, state);

	expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 task 1", "○ #2 task 2", "1 done"]);
});

// spec "session-todo / 開閉状態はセッション開始時に既定へ戻る"
test("session_start で既定へ戻る", async () => {
	const branch: SessionEntry[] = [
		todoEntry({ nextId: 3, items: [{ id: 1, text: "A1", done: false }, { id: 2, text: "A2", done: true }] }),
	];

	// 既定が展開のランでは、折りたたんでいてもセッション開始で展開へ戻る。
	const expanding = new FakePi();
	const expandedState = createTodoPanelState(false);
	registerTodoPanel(expanding, todoConfig(), expandedState);
	expandedState.toggle();
	const expandedCalls: SetWidgetCall[] = [];
	await expanding.sessionStartHandlers[0](
		{ type: "session_start", reason: "reload" },
		panelContext("tui", branch, expandedCalls),
	);
	expect(expandedState.collapsed()).toBe(false);
	expect(renderWidget(expandedCalls[0].content, 80)).toEqual(["○ #1 A1", "1 done"]);

	// startCollapsed が true のランでは、展開状態から開始してもセッション開始で折りたたまれる。
	const collapsing = new FakePi();
	const collapsedState = createTodoPanelState(false);
	registerTodoPanel(collapsing, { ...todoConfig(), startCollapsed: true }, collapsedState);
	expect(collapsedState.collapsed()).toBe(false);
	const collapsedCalls: SetWidgetCall[] = [];
	await collapsing.sessionStartHandlers[0](
		{ type: "session_start", reason: "reload" },
		panelContext("tui", branch, collapsedCalls),
	);
	expect(collapsedState.collapsed()).toBe(true);
	expect(renderWidget(collapsedCalls[0].content, 80)).toEqual(["1 pending · 1 done"]);
});

test("session_tree は開閉状態を変えない", async () => {
	const pi = new FakePi();
	const state = createTodoPanelState(false);
	registerTodoPanel(pi, todoConfig(), state);
	state.toggle();
	const branch: SessionEntry[] = [
		todoEntry({ nextId: 3, items: [{ id: 1, text: "A1", done: false }, { id: 2, text: "A2", done: false }] }),
	];

	const calls: SetWidgetCall[] = [];
	await pi.sessionTreeHandlers[0]({ type: "session_tree", newLeafId: "leaf", oldLeafId: null }, panelContext("tui", branch, calls));

	expect(state.collapsed()).toBe(true);
	expect(renderWidget(calls[0].content, 80)).toEqual(["2 pending"]);
});

// spec "session-todo / 開閉状態はセッション開始時に既定へ戻る": ツール成功後も開閉状態を保つ
test("折りたたみ中の manage_todos 成功後も折りたたみのまま新しい件数を表示する", async () => {
	const calls: SetWidgetCall[] = [];
	const ctx = panelContext("tui", [], calls);
	const state = createTodoPanelState(true);
	const tool = createManageTodosTool({ pi: { appendEntry: () => {} }, maxLines: 5, state });

	const result = await (tool.execute as unknown as Execute)(
		"id",
		{ updates: [{ op: "add", text: "Fix bug" }] },
		undefined,
		undefined,
		ctx,
	);

	expect(result.isError).toBeFalsy();
	expect(state.collapsed()).toBe(true);
	expect(renderWidget(calls[0].content, 80)).toEqual(["1 pending"]);
});

// spec "session-todo / TODO パネルはキー入力で開閉できる"
test("設定されたキーでショートカットを登録する", () => {
	const pi = new FakePi();
	registerTodoPanel(pi, { ...todoConfig(), toggleKey: "ctrl+shift+k" }, expanded());

	expect([...pi.shortcuts.keys()]).toEqual(["ctrl+shift+k"]);
	expect(pi.shortcuts.get("ctrl+shift+k")?.description).toBeTruthy();
	// 既定値で登録した場合も、登録されるキーは解決済みのキー 1 つだけ。
	const defaults = new FakePi();
	registerTodoPanel(defaults, todoConfig(), expanded());
	expect([...defaults.shortcuts.keys()]).toEqual([DEFAULT_TODO_TOGGLE_KEY]);
});

test("ショートカットで折りたたみと展開が切り替わる", () => {
	const pi = new FakePi();
	const state = createTodoPanelState(false);
	registerTodoPanel(pi, todoConfig(), state);
	const branch: SessionEntry[] = [
		todoEntry({ nextId: 6, items: [item(1), item(2), item(3), item(4, true), item(5, true)] }),
	];

	const collapsedCalls: SetWidgetCall[] = [];
	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("tui", branch, collapsedCalls));
	expect(state.collapsed()).toBe(true);
	expect(renderWidget(collapsedCalls[0].content, 80)).toEqual(["3 pending · 2 done"]);

	const expandedCalls: SetWidgetCall[] = [];
	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("tui", branch, expandedCalls));
	expect(state.collapsed()).toBe(false);
	expect(renderWidget(expandedCalls[0].content, 80)).toEqual([
		"○ #1 task 1",
		"○ #2 task 2",
		"○ #3 task 3",
		"2 done",
	]);
});

test("ショートカットで開閉しても appendEntry は呼ばれない", () => {
	const pi = new FakePi();
	registerTodoPanel(pi, todoConfig(), expanded());
	const branch: SessionEntry[] = [todoEntry({ nextId: 2, items: [{ id: 1, text: "A1", done: false }] })];

	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("tui", branch, []));
	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("tui", branch, []));

	expect(pi.entries).toEqual([]);
});

test("TODO が 0 件ならショートカットは開閉状態を変えない", () => {
	const pi = new FakePi();
	const state = createTodoPanelState(false);
	registerTodoPanel(pi, todoConfig(), state);
	const calls: SetWidgetCall[] = [];

	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("tui", [], calls));

	expect(state.collapsed()).toBe(false);
	expect(calls).toEqual([]);
});

test("print モードではショートカットが何もしない", () => {
	const pi = new FakePi();
	const state = createTodoPanelState(false);
	registerTodoPanel(pi, todoConfig(), state);
	const branch: SessionEntry[] = [todoEntry({ nextId: 2, items: [{ id: 1, text: "A1", done: false }] })];
	const calls: SetWidgetCall[] = [];

	pi.fireShortcut(DEFAULT_TODO_TOGGLE_KEY, panelContext("print", branch, calls));

	expect(state.collapsed()).toBe(false);
	expect(calls).toEqual([]);
});

test("non-tui modes set no widget", async () => {
	const directCalls: SetWidgetCall[] = [];
	updateTodoPanel(panelContext("print", [], directCalls), snapshot([item(1)]), 5, expanded());
	expect(directCalls).toHaveLength(0);

	const appended: unknown[] = [];
	const calls: SetWidgetCall[] = [];
	const tool = createManageTodosTool({
		pi: { appendEntry: (_customType, data) => void appended.push(data) },
		maxLines: 5,
		state: expanded(),
	});
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
