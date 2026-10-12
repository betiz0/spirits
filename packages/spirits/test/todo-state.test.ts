import { expect, test } from "bun:test";
import type { CustomEntry, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import {
	applyTodoUpdates,
	BLANK_TEXT_REASON,
	EMPTY_UPDATES_REASON,
	emptyTodoSnapshot,
	resolveTodoSnapshot,
	TODO_ENTRY_TYPE,
	UPDATE_FIELDS_REASON,
	unknownIdReason,
	type TodoSnapshot,
} from "../src/todo/state.ts";

class FakeSessionManager {
	readonly #branch: readonly SessionEntry[];
	readonly #entries: readonly SessionEntry[];

	constructor(branch: readonly SessionEntry[], entries: readonly SessionEntry[] = branch) {
		this.#branch = branch;
		this.#entries = entries;
	}

	getBranch(): readonly SessionEntry[] {
		return this.#branch;
	}

	getEntries(): readonly SessionEntry[] {
		return this.#entries;
	}
}

function todoEntry(data: unknown): CustomEntry {
	return { type: "custom", customType: TODO_ENTRY_TYPE, data };
}

function goalEntry(goal: string): CustomEntry {
	return { type: "custom", customType: "spirits_goal", data: { goal } };
}

function userEntry(text: string): SessionMessageEntry {
	return { type: "message", message: { role: "user", content: text } };
}

const ONE_TWO: TodoSnapshot = {
	nextId: 3,
	items: [
		{ id: 1, text: "first", done: false },
		{ id: 2, text: "second", done: true },
	],
};

test("add assigns sequential ids from 1", () => {
	const result = applyTodoUpdates(emptyTodoSnapshot(), [
		{ op: "add", text: "Fix bug" },
		{ op: "add", text: "Write test" },
	]);
	expect(result).toEqual({
		ok: true,
		snapshot: {
			nextId: 3,
			items: [
				{ id: 1, text: "Fix bug", done: false },
				{ id: 2, text: "Write test", done: false },
			],
		},
	});
});

test("deleted ids are not reused", () => {
	const deleted = applyTodoUpdates(ONE_TWO, [{ op: "delete", id: 2 }]);
	if (!deleted.ok) throw new Error("expected delete to succeed");
	expect(deleted.snapshot).toEqual({
		nextId: 3,
		items: [{ id: 1, text: "first", done: false }],
	});

	const added = applyTodoUpdates(deleted.snapshot, [{ op: "add", text: "third" }]);
	expect(added).toEqual({
		ok: true,
		snapshot: {
			nextId: 4,
			items: [
				{ id: 1, text: "first", done: false },
				{ id: 3, text: "third", done: false },
			],
		},
	});
});

test("update changes only the given text or done", () => {
	const done = applyTodoUpdates(ONE_TWO, [{ op: "update", id: 1, done: true }]);
	if (!done.ok) throw new Error("expected done update to succeed");
	expect(done.snapshot.items).toEqual([
		{ id: 1, text: "first", done: true },
		{ id: 2, text: "second", done: true },
	]);

	const text = applyTodoUpdates(done.snapshot, [{ op: "update", id: 2, text: "renamed" }]);
	if (!text.ok) throw new Error("expected text update to succeed");
	expect(text.snapshot.items).toEqual([
		{ id: 1, text: "first", done: true },
		{ id: 2, text: "renamed", done: true },
	]);
});

test("later operations see earlier results in the same call", () => {
	const result = applyTodoUpdates(ONE_TWO, [
		{ op: "add", text: "third" },
		{ op: "update", id: 3, done: true },
		{ op: "delete", id: 1 },
		{ op: "add", text: "fourth" },
		{ op: "update", id: 4, text: "renamed fourth" },
	]);
	expect(result).toEqual({
		ok: true,
		snapshot: {
			nextId: 5,
			items: [
				{ id: 2, text: "second", done: true },
				{ id: 3, text: "third", done: true },
				{ id: 4, text: "renamed fourth", done: false },
			],
		},
	});
});

test("invalid call applies nothing", () => {
	const invalid: Array<{
		updates: Parameters<typeof applyTodoUpdates>[1];
		index: number | undefined;
		reason: string;
	}> = [
		{ updates: [{ op: "update", id: 9, done: true }], index: 0, reason: unknownIdReason(9) },
		{ updates: [{ op: "delete", id: 9 }], index: 0, reason: unknownIdReason(9) },
		{
			updates: [
				{ op: "delete", id: 1 },
				{ op: "update", id: 1, done: true },
			],
			index: 1,
			reason: unknownIdReason(1),
		},
		{ updates: [{ op: "add", text: "   " }], index: 0, reason: BLANK_TEXT_REASON },
		{ updates: [{ op: "update", id: 1, text: "" }], index: 0, reason: BLANK_TEXT_REASON },
		{ updates: [{ op: "update", id: 1 }], index: 0, reason: UPDATE_FIELDS_REASON },
		{ updates: [], index: undefined, reason: EMPTY_UPDATES_REASON },
	];

	for (const { updates, index, reason } of invalid) {
		const current: TodoSnapshot = { nextId: 3, items: ONE_TWO.items.map((item) => ({ ...item })) };
		const result = applyTodoUpdates(current, updates);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.error.index).toBe(index);
		expect(result.error.reason).toBe(reason);
		expect(current).toEqual(ONE_TWO);
	}
});

test("resolves the latest snapshot on the branch", () => {
	const first: TodoSnapshot = { nextId: 2, items: [{ id: 1, text: "A1", done: false }] };
	const second: TodoSnapshot = { nextId: 3, items: [{ id: 1, text: "A1", done: true }, { id: 2, text: "A2", done: false }] };
	const branch: SessionEntry[] = [userEntry("hello"), todoEntry(first), goalEntry("ship"), todoEntry(second)];
	expect(resolveTodoSnapshot(branch)).toEqual(second);
});

test("ignores malformed snapshots", () => {
	const valid: TodoSnapshot = { nextId: 2, items: [{ id: 1, text: "A1", done: false }] };
	const malformed: unknown[] = [
		null,
		[],
		{ nextId: 0, items: [] },
		{ nextId: 1, items: [{ id: 1, text: "x", done: false }] },
		{ nextId: 3, items: "nope" },
		{ nextId: 3, items: [{ id: 1, text: "x", done: "yes" }] },
		{ nextId: 3, items: [{ id: 0, text: "x", done: false }] },
		{ nextId: 4, items: [{ id: 1, text: "x", done: false }, { id: 1, text: "y", done: false }] },
		{ nextId: 3, items: [{ id: 1, text: "   ", done: false }] },
	];
	const branch: SessionEntry[] = [todoEntry(valid), ...malformed.map((data) => todoEntry(data))];
	expect(resolveTodoSnapshot(branch)).toEqual(valid);
	expect(resolveTodoSnapshot([todoEntry(null)])).toEqual(emptyTodoSnapshot());
});

test("resolves copied entries after a re-rooted branch", () => {
	const first: TodoSnapshot = { nextId: 2, items: [{ id: 1, text: "A1", done: false }] };
	const second: TodoSnapshot = { nextId: 3, items: [{ id: 1, text: "A1", done: true }, { id: 2, text: "A2", done: false }] };
	const oldBranch: SessionEntry[] = [userEntry("old conversation"), todoEntry(first)];
	// /clear copies the custom entries onto a new root; the old conversation leaves the branch.
	const branch: SessionEntry[] = [todoEntry(first), goalEntry("ship"), todoEntry(second)];
	const session = new FakeSessionManager(branch, [...oldBranch, ...branch]);
	expect(resolveTodoSnapshot(session.getBranch())).toEqual(second);
});
