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
 * A per-message predicate is not available: the `context` event hands over `AgentMessage[]`, which
 * carries no reference back to the session entry it came from. Position is the only handle the
 * handler has, so the boundary is translated into a count and applied as a prefix drop. The count is
 * still derived from entry ids, not from message text.
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
	ProjectedSessionEntry,
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
 * Branch position by entry id. The projection reports raw source entries, so an id is the only
 * handle that maps a projected message back to its place on the branch.
 */
function branchPositions(branch: readonly SessionEntry[]): Map<string, number> {
	const position = new Map<string, number>();
	branch.forEach((entry, index) => {
		if (entry.id) position.set(entry.id, index);
	});
	return position;
}

/**
 * How many model-visible messages a projected entry contributes to the cleared conversation.
 *
 * An entry the projection invented, or one after the boundary, contributes nothing: it stays in the
 * context. The `system` role is skipped because a system message is prompt state, not conversation.
 */
function clearedMessagesOf(
	projected: ProjectedSessionEntry,
	position: Map<string, number>,
	boundary: number,
): number {
	const at = position.get(projected.sourceEntry.id ?? "");
	if (at === undefined || at > boundary) return 0;
	return projected.messages.filter((message) => message.role !== "system").length;
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
	if (!branch[boundary].id) return 0;

	const position = branchPositions(branch);
	let drop = 0;
	for (const projected of sessionManager.buildSessionProjection().entries) {
		drop += clearedMessagesOf(projected, position, boundary);
	}
	return drop;
}

/**
 * Whether the span pi is about to summarize still holds conversation the boundary removed.
 *
 * The span is the one `prepareCompaction` builds: the projected entries after the newest compaction
 * that carries a summary, up to `preparation.firstKeptEntryId`, which is where the kept tail starts.
 * Entries at or after that id survive the compaction, so only what lies before it can reach the
 * summary.
 */
function summarizesClearedConversation(
	event: SessionBeforeCompactEvent,
	sessionManager: ReadonlySessionManager,
	boundary: number,
): boolean {
	const position = branchPositions(event.branchEntries);
	const projected = sessionManager.buildSessionProjection().entries;
	// A projection with no compaction at all summarizes from the first entry; an id the projection
	// does not carry leaves the span open at the end, which keeps the takeover rather than letting a
	// cleared message into a summary.
	// The summary source is the newest compaction that carries one, which is pi's own rule for the
	// entry it resumes from. A projection with no such compaction summarizes from its first entry.
	const from = projected.findIndex((entry) => entry.sourceEntry.type === "compaction" && entry.messages.length > 0) + 1;
	const cut = projected.findIndex((entry) => entry.sourceEntry.id === event.preparation.firstKeptEntryId);
	const to = cut === -1 ? projected.length : cut;

	return projected
		.slice(from, to)
		.some((entry) => clearedMessagesOf(entry, position, boundary) > 0);
}

/**
 * Take a compaction over when its summary would carry cleared conversation content.
 *
 * A compaction summarizes everything from the previous compaction (or the session header) down to
 * the entry it keeps. When that span still holds conversation the boundary removed, the summary would
 * put the cleared conversation back into the context, so the extension writes the compaction itself:
 * a summary that says the conversation was cleared and carries none of it, keeping from the boundary.
 * Otherwise the automatic summary proceeds untouched.
 *
 * The test is what the span holds, not where the boundary sits. A session cleared while it had
 * nothing to clear, or cleared right after a summary, has a span that reaches over the boundary and
 * holds no cleared conversation; taking that one over would swap pi's real summary for a note, keep
 * every message the summary would have dropped, and leave the context over the threshold for another
 * round. The cleared conversation itself stays out of the request either way, because the `context`
 * handler filters on every request.
 */
export function boundaryCompactionResult(
	event: SessionBeforeCompactEvent,
	sessionManager: ReadonlySessionManager,
): SessionBeforeCompactResult | undefined {
	const boundary = clearBoundaryIndex(event.branchEntries);
	if (boundary < 0) return undefined;

	const firstKeptEntryId = event.branchEntries[boundary].id;
	if (!firstKeptEntryId) return undefined;

	if (!summarizesClearedConversation(event, sessionManager, boundary)) return undefined;

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
