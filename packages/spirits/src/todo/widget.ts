/**
 * TODO panel rendering.
 *
 * `renderTodoLines` turns a snapshot into display lines: pending items in ID order up
 * to the configured limit, then one counts line for hidden pending and done items. An
 * all-done list renders a single line, an empty list renders nothing. Every line is
 * truncated to the draw width.
 *
 * `renderTodoSummaryLines` is the collapsed reading of the same snapshot: one counts line, no item
 * line. Which of the two a redraw draws is the `TodoPanelState` the entry point owns, so the state is
 * never part of the saved snapshot and both renderings stay pure functions of it.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type {
	Component,
	ExtensionAPI,
	ExtensionMode,
	ExtensionUIContext,
	ReadonlySessionManager,
	Theme,
	TUI,
} from "@earendil-works/pi-coding-agent";
import type { TodoConfig } from "../config.ts";
import { resolveTodoSnapshot, type TodoSnapshot } from "./state.ts";

/** Widget key. */
export const TODO_WIDGET_KEY = "spirits_todo";

/** Pending item marker. */
const MESSAGE_PENDING_MARKER = "○";

/** Single line shown when every item is done. */
const MESSAGE_ALL_DONE = "✓ all done";

/** Suffix of the hidden pending count. */
const MESSAGE_MORE_SUFFIX = " more";

/** Suffix of the done count. */
const MESSAGE_DONE_SUFFIX = " done";

/** Suffix of the pending count on the collapsed summary line. */
const MESSAGE_PENDING_SUFFIX = " pending";

/** Joins the two count parts on the counts line. */
const MESSAGE_COUNT_SEPARATOR = " · ";

/** Prefix of the hidden pending count. */
const MESSAGE_PLUS = "+";

/** Separates the ID prefix from the item text. */
const MESSAGE_ID_PREFIX = "#";
const MESSAGE_SPACE = " ";

/**
 * Render a snapshot as panel lines. An empty snapshot yields no lines; the caller
 * removes the widget in that case.
 */
export function renderTodoLines(snapshot: TodoSnapshot, maxLines: number, width: number): string[] {
	if (snapshot.items.length === 0) {
		return [];
	}

	const pending = snapshot.items.filter((item) => !item.done).sort((a, b) => a.id - b.id);
	const doneCount = snapshot.items.length - pending.length;
	if (pending.length === 0) {
		return [truncateToWidth(MESSAGE_ALL_DONE, width)];
	}

	const shown = pending.slice(0, maxLines);
	const hiddenPending = pending.length - shown.length;
	const lines = shown.map((item) =>
		truncateToWidth(
			`${MESSAGE_PENDING_MARKER}${MESSAGE_SPACE}${MESSAGE_ID_PREFIX}${item.id}${MESSAGE_SPACE}${item.text}`,
			width,
		),
	);

	const counts: string[] = [];
	if (hiddenPending > 0) {
		counts.push(`${MESSAGE_PLUS}${hiddenPending}${MESSAGE_MORE_SUFFIX}`);
	}
	if (doneCount > 0) {
		counts.push(`${doneCount}${MESSAGE_DONE_SUFFIX}`);
	}
	if (counts.length > 0) {
		lines.push(truncateToWidth(counts.join(MESSAGE_COUNT_SEPARATOR), width));
	}
	return lines;
}

/**
 * Render a snapshot as the collapsed panel: one counts line, never an item line. The pending count is
 * the total pending, not the hidden remainder the expanded counts line shows, so collapsing a list
 * that does not fit the panel still reports every open item. An all-done list keeps the expanded
 * wording, and an empty list renders nothing, so the caller removes the widget in both states.
 */
export function renderTodoSummaryLines(snapshot: TodoSnapshot, width: number): string[] {
	if (snapshot.items.length === 0) {
		return [];
	}

	const pending = snapshot.items.filter((item) => !item.done).length;
	if (pending === 0) {
		return [truncateToWidth(MESSAGE_ALL_DONE, width)];
	}

	const parts = [`${pending}${MESSAGE_PENDING_SUFFIX}`];
	const doneCount = snapshot.items.length - pending;
	if (doneCount > 0) {
		parts.push(`${doneCount}${MESSAGE_DONE_SUFFIX}`);
	}
	return [truncateToWidth(parts.join(MESSAGE_COUNT_SEPARATOR), width)];
}

/**
 * Whether the panel shows its items or only the counts summary.
 *
 * The state lives in memory only: one instance per extension load, created by the entry point and
 * shared by the panel and the tool, so a redraw from any of the four paths reads the same value. A
 * session start resets it to the configured default; nothing else persists it (design Decision 1).
 */
export interface TodoPanelState {
	/** True when the panel shows the counts summary instead of the item lines. */
	collapsed(): boolean;
	/** Switch between collapsed and expanded. */
	toggle(): void;
	/** Return to the state the settings ask for at a session start. */
	reset(startCollapsed: boolean): void;
}

/** Create the in-memory open/closed state, starting from `startCollapsed`. */
export function createTodoPanelState(startCollapsed: boolean): TodoPanelState {
	let collapsed = startCollapsed;
	return {
		collapsed: () => collapsed,
		toggle: () => {
			collapsed = !collapsed;
		},
		reset: (start) => {
			collapsed = start;
		},
	};
}

/** Component rendering one snapshot at the widget slot's width. */
export class TodoPanelComponent implements Component {
	private readonly snapshot: TodoSnapshot;
	private readonly maxLines: number;
	private readonly collapsed: boolean;

	constructor(snapshot: TodoSnapshot, maxLines: number, collapsed: boolean) {
		this.snapshot = snapshot;
		this.maxLines = maxLines;
		this.collapsed = collapsed;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return this.collapsed
			? renderTodoSummaryLines(this.snapshot, width)
			: renderTodoLines(this.snapshot, this.maxLines, width);
	}
}

/** Widget factory installed through `setWidget`. */
export type TodoPanelFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

/** Build a widget factory for a snapshot in one open/closed state. */
export function createTodoPanel(snapshot: TodoSnapshot, maxLines: number, collapsed: boolean): TodoPanelFactory {
	return () => new TodoPanelComponent(snapshot, maxLines, collapsed);
}

/** Context needed to install the panel. `ExtensionContext` and `ExtensionToolContext` satisfy it. */
export interface TodoPanelContext {
	mode: ExtensionMode;
	ui: Pick<ExtensionUIContext, "setWidget">;
	sessionManager: ReadonlySessionManager;
}

/** Show the panel for a snapshot in the current open/closed state, or clear it when it is empty. TUI only. */
export function updateTodoPanel(
	ctx: TodoPanelContext,
	snapshot: TodoSnapshot,
	maxLines: number,
	state: TodoPanelState,
): void {
	if (ctx.mode !== "tui") {
		return;
	}
	if (snapshot.items.length === 0) {
		ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(TODO_WIDGET_KEY, createTodoPanel(snapshot, maxLines, state.collapsed()), {
		placement: "belowEditor",
	});
}

/** Re-resolve the panel from the current branch, keeping the open/closed state. */
export function refreshTodoPanel(ctx: TodoPanelContext, maxLines: number, state: TodoPanelState): void {
	updateTodoPanel(ctx, resolveTodoSnapshot(ctx.sessionManager.getBranch()), maxLines, state);
}

/** Shown next to the toggle key in pi's `/hotkeys` list. */
const SHORTCUT_DESCRIPTION_TODO_TOGGLE = "TODO パネルを開閉";

/**
 * Register the `session_start` / `session_tree` re-render handlers and the toggle shortcut.
 *
 * A session start is the only place the open/closed state returns to the configured default: a branch
 * move keeps what the user last chose. The settings and the state come from the entry point, so the
 * panel and the `manage_todos` tool read the same pair (design Decision 1, 4).
 *
 * The shortcut is registered on every load, whatever the run mode turns out to be: pi only accepts
 * shortcut registrations while the extension loads, and the mode is only known per session, so the
 * handler is where a print or RPC run is ignored. An empty branch is ignored too, because flipping the
 * state behind an invisible panel would show the wrong reading when the first item arrives. Turning
 * the panel is a display choice only, so nothing here appends to the session.
 */
export function registerTodoPanel(
	pi: Pick<ExtensionAPI, "on" | "registerShortcut">,
	config: TodoConfig,
	state: TodoPanelState,
): void {
	pi.on("session_start", (_event, ctx) => {
		state.reset(config.startCollapsed);
		refreshTodoPanel(ctx, config.maxLines, state);
	});
	pi.on("session_tree", (_event, ctx) => refreshTodoPanel(ctx, config.maxLines, state));
	pi.registerShortcut(config.toggleKey, {
		description: SHORTCUT_DESCRIPTION_TODO_TOGGLE,
		handler: (ctx) => {
			if (ctx.mode !== "tui") {
				return;
			}
			const snapshot = resolveTodoSnapshot(ctx.sessionManager.getBranch());
			if (snapshot.items.length === 0) {
				return;
			}
			state.toggle();
			updateTodoPanel(ctx, snapshot, config.maxLines, state);
		},
	});
}
