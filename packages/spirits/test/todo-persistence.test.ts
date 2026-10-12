/**
 * Session-file round trip for `manage_todos` (verify2 W-1).
 *
 * The tool persists through `pi.appendEntry`, which the real runtime forwards to
 * `SessionManager.appendCustomEntry`. These tests use the real `SessionManager`
 * (`./pi-runtime/session-manager.ts` resolves it at runtime) so a successful call is
 * written to and read back from an actual JSONL session file.
 */

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { resolveTodoSnapshot, TODO_ENTRY_TYPE, type TodoSnapshot } from "../src/todo/state.ts";
import { createManageTodosTool } from "../src/todo/tool.ts";
import { refreshTodoPanel, TODO_WIDGET_KEY } from "../src/todo/widget.ts";
import { SessionManager } from "./pi-runtime/session-manager.ts";
import { makeToolContext } from "./support.ts";

type SetWidgetCall = { key: string; content: unknown; options?: { placement?: string } };

type WidgetFactory = (tui: unknown, theme: unknown) => { render(width: number): string[]; invalidate(): void };

function renderWidget(content: unknown, width: number): string[] {
	return (content as WidgetFactory)(undefined, undefined).render(width);
}

function panelContext(session: SessionManager, calls: SetWidgetCall[]): ExtensionToolContext {
	const ctx = makeToolContext({ sessionManager: session });
	ctx.mode = "tui";
	ctx.ui.setWidget = ((key: string, content: unknown, options?: { placement?: string }) => {
		calls.push({ key, content, options });
	}) as ExtensionUIContext["setWidget"];
	return ctx;
}

type Execute = (
	id: string,
	params: { updates: unknown[] },
	signal: undefined,
	onUpdate: undefined,
	ctx: ExtensionToolContext,
) => Promise<{ content: readonly unknown[]; details: unknown; isError?: boolean }>;

async function runManageTodos(session: SessionManager, updates: unknown[]): Promise<{ isError?: boolean }> {
	const tool = createManageTodosTool({
		pi: { appendEntry: (customType, data) => void session.appendCustomEntry(customType, data) },
		maxLines: 5,
	});
	return (tool.execute as unknown as Execute)("id", { updates }, undefined, undefined, panelContext(session, []));
}

/** Create a persisted session whose file already exists (a message flushes the header). */
function createSession(dir: string): SessionManager {
	const session = SessionManager.create(process.cwd(), dir);
	session.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
	return session;
}

test("tool call persists to the session file and restores after reopen", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-todo-persist-"));
	try {
		const session = createSession(dir);
		const result = await runManageTodos(session, [
			{ op: "add", text: "Fix bug" },
			{ op: "add", text: "Write test" },
			{ op: "update", id: 2, done: true },
		]);
		expect(result.isError).toBeFalsy();

		const sessionFile = session.getSessionFile();
		expect(sessionFile).toBeDefined();
		expect(existsSync(sessionFile!)).toBe(true);
		expect(await readFile(sessionFile!, "utf8")).toContain(`"${TODO_ENTRY_TYPE}"`);

		const expected: TodoSnapshot = {
			nextId: 3,
			items: [
				{ id: 1, text: "Fix bug", done: false },
				{ id: 2, text: "Write test", done: true },
			],
		};
		const reopened = SessionManager.open(sessionFile!);
		expect(resolveTodoSnapshot(reopened.getBranch())).toEqual(expected);

		const calls: SetWidgetCall[] = [];
		refreshTodoPanel(panelContext(reopened, calls), 5);
		expect(calls).toHaveLength(1);
		expect(calls[0].key).toBe(TODO_WIDGET_KEY);
		expect(calls[0].options).toEqual({ placement: "belowEditor" });
		expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 Fix bug", "1 done"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("restores the last valid snapshot when the latest record is malformed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-todo-persist-"));
	try {
		const session = createSession(dir);
		const result = await runManageTodos(session, [{ op: "add", text: "Fix bug" }]);
		expect(result.isError).toBeFalsy();

		// Duplicate IDs cannot be produced by the tool, so the record is malformed (W-2).
		session.appendCustomEntry(TODO_ENTRY_TYPE, {
			nextId: 3,
			items: [
				{ id: 1, text: "ghost", done: false },
				{ id: 1, text: "duplicate", done: false },
			],
		});

		const sessionFile = session.getSessionFile()!;
		expect(await readFile(sessionFile, "utf8")).toContain("duplicate");

		const reopened = SessionManager.open(sessionFile);
		expect(resolveTodoSnapshot(reopened.getBranch())).toEqual({
			nextId: 2,
			items: [{ id: 1, text: "Fix bug", done: false }],
		});

		const calls: SetWidgetCall[] = [];
		refreshTodoPanel(panelContext(reopened, calls), 5);
		expect(renderWidget(calls[0].content, 80)).toEqual(["○ #1 Fix bug"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
