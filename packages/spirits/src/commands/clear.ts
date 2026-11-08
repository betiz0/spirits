/**
 * `/spirits-clear`: drop the conversation before the command from the model context.
 *
 * What "cleared" means here is narrow and deliberate:
 *
 * - the LLM context no longer holds the messages before the boundary;
 * - the chat display keeps them, because the session file is never rewritten;
 * - the session id, the TODO list, the goal, and memory are untouched — the command appends one
 *   entry and changes nothing else;
 * - a compaction after the boundary must not summarize the cleared conversation back in.
 *
 * Both halves work on the same fact: pi keeps its context as a linked list of entries and rebuilds
 * the LLM context from that list before every request, running the extension `context` handler on
 * the result (`core/sdk.ts` wires `transformContext` to the runner's `emitContext`, and
 * `core/extensions/runner.ts` hands the handler the conversation without the system messages). So
 * the command appends a `spirits_clear` marker and the handler removes the projected messages that
 * belong to entries before the newest marker. Nothing is deleted, and the next rebuild produces the
 * same filtered view.
 *
 * Counting, not content matching, is what makes this exact. For the branch
 *
 *   [0] message(user "first")   [1] message(assistant)   [2] custom(spirits_clear)   [3] message(user "second")
 *
 * the projection contributes one model-visible message per conversation entry, so the boundary at
 * index 2 accounts for 2 messages, and the handler returns `messages.slice(2)`. The `system` role is
 * skipped for the same reason pi skips it in `getMessagesFromProjectedEntryForCompaction`: a system
 * message is prompt state, not conversation, and it is not in the list the handler receives either.
 * Counting through the projection rather than the raw branch keeps the number right when an earlier
 * compaction, a hidden entry, or a state-only entry has changed the shape of the list.
 *
 * The alternative this does not use is `ctx.compact()` plus `session_before_compact`. A probe with
 * `spirits/precondition-probe` on the official artifact showed it cannot meet the rules: a short
 * session raises `Nothing to compact (session too small)`, a command right after a compaction raises
 * `Already compacted`, and pi returns from both *before* dispatching the hook — so the extension
 * never gets the chance to clear anything.
 */

import type {
	ReadonlySessionManager,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CLEAR_COMPACTION_SUMMARY, CLEAR_ENTRY_TYPE } from "../constants.ts";

/** Index of the newest clear boundary on the branch, or -1 when there is none. */
export function clearBoundaryIndex(branch: readonly SessionEntry[]): number {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "custom" && entry.customType === CLEAR_ENTRY_TYPE) return index;
	}
	return -1;
}

/**
 * How many model-visible messages the `context` handler must drop for the current branch.
 *
 * Zero means "leave the conversation alone", which is what a session with no boundary — or one whose
 * boundary carries no id, which cannot be located — must do.
 */
export function clearedMessageCount(sessionManager: ReadonlySessionManager): number {
	const branch = sessionManager.getBranch();
	const boundary = clearBoundaryIndex(branch);
	if (boundary < 0) return 0;
	const boundaryId = branch[boundary].id;
	if (!boundaryId) return 0;

	// Branch position by entry id. The projection reports raw source entries, so an id is the only
	// handle that maps a projected message back to its place on the branch.
	const position = new Map<string, number>();
	branch.forEach((entry, index) => {
		if (entry.id) position.set(entry.id, index);
	});

	let drop = 0;
	for (const projected of sessionManager.buildSessionProjection().entries) {
		const at = position.get(projected.sourceEntry.id ?? "");
		// An entry the projection invented, or anything after the boundary, stays in the context.
		if (at === undefined || at > boundary) continue;
		drop += projected.messages.filter((message) => message.role !== "system").length;
	}
	return drop;
}

/**
 * Take a compaction over when its summary would carry cleared conversation content.
 *
 * A compaction summarizes everything from `firstKeptEntryId` down to the previous compaction (or the
 * session header). If a clear boundary sits inside that span, the summary would put the cleared
 * conversation back into the context, so the extension writes the compaction itself: the same
 * `firstKeptEntryId` pi prepared, and a summary that says the conversation was cleared and carries
 * none of it. When the boundary is already behind the summarized span, the automatic summary
 * proceeds untouched.
 */
export function boundaryCompactionResult(event: SessionBeforeCompactEvent): SessionBeforeCompactResult | undefined {
	const entries = event.branchEntries;
	const boundary = clearBoundaryIndex(entries);
	if (boundary < 0) return undefined;

	const previousCompaction = entries.findLastIndex((entry) => entry.type === "compaction");
	const firstSummarized = previousCompaction + 1;
	if (boundary < firstSummarized) return undefined;

	const firstKeptEntryId = entries[boundary].id;
	if (!firstKeptEntryId) return undefined;

	return {
		compaction: {
			summary: CLEAR_COMPACTION_SUMMARY,
			firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
		},
	};
}

/** True when the newest entry is already a clear boundary, so a second command has nothing to do. */
export function alreadyCleared(branch: readonly SessionEntry[]): boolean {
	return branch.length > 0 && clearBoundaryIndex(branch) === branch.length - 1;
}
