/**
 * TODO panel rendering.
 *
 * `renderTodoLines` turns a snapshot into display lines: pending items in ID order up
 * to the configured limit, then one counts line for hidden pending and done items. An
 * all-done list renders a single line, an empty list renders nothing. Every line is
 * truncated to the draw width.
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
import { loadConfig } from "../config.ts";
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

/** Component rendering one snapshot at the widget slot's width. */
export class TodoPanelComponent implements Component {
	private readonly snapshot: TodoSnapshot;
	private readonly maxLines: number;

	constructor(snapshot: TodoSnapshot, maxLines: number) {
		this.snapshot = snapshot;
		this.maxLines = maxLines;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return renderTodoLines(this.snapshot, this.maxLines, width);
	}
}

/** Widget factory installed through `setWidget`. */
export type TodoPanelFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

/** Build a widget factory for a snapshot. */
export function createTodoPanel(snapshot: TodoSnapshot, maxLines: number): TodoPanelFactory {
	return () => new TodoPanelComponent(snapshot, maxLines);
}

/** Context needed to install the panel. `ExtensionContext` and `ExtensionToolContext` satisfy it. */
export interface TodoPanelContext {
	mode: ExtensionMode;
	ui: Pick<ExtensionUIContext, "setWidget">;
	sessionManager: ReadonlySessionManager;
}

/** Show the panel for a snapshot, or clear it when the snapshot is empty. TUI only. */
export function updateTodoPanel(ctx: TodoPanelContext, snapshot: TodoSnapshot, maxLines: number): void {
	if (ctx.mode !== "tui") {
		return;
	}
	if (snapshot.items.length === 0) {
		ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(TODO_WIDGET_KEY, createTodoPanel(snapshot, maxLines), { placement: "belowEditor" });
}

/** Re-resolve the panel from the current branch. */
export function refreshTodoPanel(ctx: TodoPanelContext, maxLines: number): void {
	updateTodoPanel(ctx, resolveTodoSnapshot(ctx.sessionManager.getBranch()), maxLines);
}

/** Register the `session_start` / `session_tree` re-render handlers. */
export function registerTodoPanel(pi: Pick<ExtensionAPI, "on">): void {
	const { maxLines } = loadConfig(process.env).todo;
	pi.on("session_start", (_event, ctx) => refreshTodoPanel(ctx, maxLines));
	pi.on("session_tree", (_event, ctx) => refreshTodoPanel(ctx, maxLines));
}
