/**
 * TODO snapshot resolution and update application.
 *
 * TODO state is a branch-bound snapshot: the last valid `spirits_todo` custom entry on
 * the current branch wins. Updates apply to a copy in order and are all-or-nothing; a
 * failed batch reports the position and reason without appending anything. IDs come from
 * `nextId` and are never reused.
 */

import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../repl/guards.ts";

/** Custom session entry type recording a TODO snapshot. */
export const TODO_ENTRY_TYPE = "spirits_todo";

export interface TodoItem {
	id: number;
	text: string;
	done: boolean;
}

export interface TodoSnapshot {
	/** ID assigned to the next added item. Never decreases. */
	nextId: number;
	items: TodoItem[];
}

export type TodoUpdate =
	| { op: "add"; text: string }
	| { op: "update"; id: number; text?: string; done?: boolean }
	| { op: "delete"; id: number };

export interface TodoApplyError {
	/** 0-based position in the updates array; undefined when the array is empty. */
	index?: number;
	reason: string;
}

export type TodoApplyResult = { ok: true; snapshot: TodoSnapshot } | { ok: false; error: TodoApplyError };

/** Error for an operation that targets an ID not present at that point in the batch. */
export function unknownIdReason(id: number): string {
	return `ID ${id} は存在しません`;
}

/** Error for add/update text that is empty or whitespace only. */
export const BLANK_TEXT_REASON = "テキストは空または空白のみにできません";

/** Error for an update that specifies neither text nor done. */
export const UPDATE_FIELDS_REASON = "text または done の少なくとも一方を指定してください";

/** Error for a batch with no operations. */
export const EMPTY_UPDATES_REASON = "updates を 1 件以上指定してください";

/** Empty TODO state. */
export function emptyTodoSnapshot(): TodoSnapshot {
	return { nextId: 1, items: [] };
}

/**
 * Read one custom entry as a snapshot. Returns undefined for malformed data so a corrupt
 * record is skipped and the previous valid snapshot stays current.
 */
function readSnapshot(entry: CustomEntry): TodoSnapshot | undefined {
	if (entry.customType !== TODO_ENTRY_TYPE || !isRecord(entry.data)) {
		return undefined;
	}
	const { nextId, items } = entry.data;
	if (typeof nextId !== "number" || !Number.isSafeInteger(nextId) || nextId < 1 || !Array.isArray(items)) {
		return undefined;
	}
	const parsed: TodoItem[] = [];
	const seenIds = new Set<number>();
	for (const item of items) {
		if (!isRecord(item)) {
			return undefined;
		}
		const { id, text, done } = item;
		if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || seenIds.has(id)) {
			return undefined;
		}
		if (typeof text !== "string" || text.trim() === "" || typeof done !== "boolean") {
			return undefined;
		}
		seenIds.add(id);
		parsed.push({ id, text, done });
	}
	// A snapshot whose nextId could collide with an existing item is malformed.
	if (parsed.some((item) => item.id >= nextId)) {
		return undefined;
	}
	return { nextId, items: parsed };
}

/** Resolve the current TODO snapshot from a branch (root to leaf). */
export function resolveTodoSnapshot(branch: readonly SessionEntry[]): TodoSnapshot {
	let latest: TodoSnapshot | undefined;
	for (const entry of branch) {
		if (entry.type !== "custom") {
			continue;
		}
		const snapshot = readSnapshot(entry);
		if (snapshot !== undefined) {
			latest = snapshot;
		}
	}
	return latest ?? emptyTodoSnapshot();
}

/**
 * Apply updates in order to a copy of the snapshot. Returns the new snapshot only when
 * every update is valid; otherwise nothing is applied and the first invalid position and
 * reason are returned.
 */
export function applyTodoUpdates(current: TodoSnapshot, updates: readonly TodoUpdate[]): TodoApplyResult {
	if (updates.length === 0) {
		return { ok: false, error: { reason: EMPTY_UPDATES_REASON } };
	}

	const items = current.items.map((item) => ({ ...item }));
	let nextId = current.nextId;

	for (let index = 0; index < updates.length; index++) {
		const update = updates[index];
		if (update.op === "add") {
			if (update.text.trim() === "") {
				return { ok: false, error: { index, reason: BLANK_TEXT_REASON } };
			}
			items.push({ id: nextId, text: update.text, done: false });
			nextId += 1;
			continue;
		}

		const itemIndex = items.findIndex((candidate) => candidate.id === update.id);
		if (itemIndex === -1) {
			return { ok: false, error: { index, reason: unknownIdReason(update.id) } };
		}

		if (update.op === "delete") {
			items.splice(itemIndex, 1);
			continue;
		}

		if (update.text === undefined && update.done === undefined) {
			return { ok: false, error: { index, reason: UPDATE_FIELDS_REASON } };
		}
		if (update.text !== undefined) {
			if (update.text.trim() === "") {
				return { ok: false, error: { index, reason: BLANK_TEXT_REASON } };
			}
			items[itemIndex].text = update.text;
		}
		if (update.done !== undefined) {
			items[itemIndex].done = update.done;
		}
	}

	return { ok: true, snapshot: { nextId, items } };
}
