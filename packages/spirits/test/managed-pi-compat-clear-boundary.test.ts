/**
 * The judgements behind the five `/spirits-clear` boundary items.
 *
 * The driving happens on the dedicated Pi inside the compatibility runner; what is pinned here is
 * what a measurement means. Each judge is exercised with the shapes the runner records, including the
 * `not-run` cases, which are the ones that keep a fixture gap from reading as a product result.
 */

import { expect, test } from "bun:test";
import {
	CLEAR_COMPACTION_SUMMARY,
	CLEAR_ENTRY_TYPE,
} from "../src/constants.ts";
import {
	compactionRecords,
	forkTargetOf,
	judgeAutomaticCompaction,
	judgeFork,
	judgeManualCompaction,
	judgeResume,
	judgeTreeMove,
	startBoundaryProvider,
	NO_AUTOMATIC_COMPACTION,
	treeTargetOf,
	type AutomaticCompactionObservation,
	type BranchRecord,
	type ManualCompactionAttempt,
} from "../../../scripts/managed-pi-compat/clear-boundary.ts";

const BEFORE = "compat-before-1";
const AFTER = "compat-after-1";

/** The branch one of the boundary items seeds: a cleared message, a boundary, a kept message. */
const BRANCH: BranchRecord[] = [
	{ id: "header", type: "header", text: "" },
	{ id: "cleared", type: "message", role: "user", text: JSON.stringify({ role: "user", content: BEFORE }) },
	{ id: "answer", type: "message", role: "assistant", text: JSON.stringify({ role: "assistant", content: "fake answer" }) },
	{ id: "boundary", type: "custom", customType: CLEAR_ENTRY_TYPE, text: `"${CLEAR_ENTRY_TYPE}"` },
	{ id: "kept", type: "message", role: "user", text: JSON.stringify({ role: "user", content: AFTER }) },
	{ id: "kept-answer", type: "message", role: "assistant", text: JSON.stringify({ role: "assistant", content: "fake answer" }) },
];

function automatic(overrides: Partial<AutomaticCompactionObservation> = {}): AutomaticCompactionObservation {
	return {
		attempted: true,
		compactions: [{ summary: CLEAR_COMPACTION_SUMMARY, firstKeptEntryId: "boundary", fromHook: true }],
		summarizationRequests: 0,
		followingRequest: JSON.stringify({ messages: [{ role: "user", content: AFTER }] }),
		beforeMarker: BEFORE,
		afterMarker: AFTER,
		...overrides,
	};
}

function attempt(overrides: Partial<ManualCompactionAttempt> = {}): ManualCompactionAttempt {
	return { ran: true, summary: "pi structured summary", fromHook: false, summarizationRequests: 1, ...overrides };
}

test("a compaction the extension wrote after the boundary is confirmed", () => {
	expect(judgeAutomaticCompaction(automatic())).toEqual({
		state: "confirmed",
		detail: expect.stringContaining("from the extension hook"),
	});
});

test("a compaction of pi's own after the boundary fails", () => {
	// The extension hook is what puts the clear note in the entry. An entry pi wrote for itself means
	// the takeover did not happen, whatever the summary says.
	const own = judgeAutomaticCompaction(automatic({ compactions: [{ summary: "pi structured summary", fromHook: false }] }));
	expect(own.state).toBe("failed");
	expect(own.detail).toContain("pi's own summary");
});

test("a compaction that summarized the cleared conversation fails", () => {
	const leaked = judgeAutomaticCompaction(automatic({ compactions: [{ summary: `kept ${BEFORE}`, fromHook: true }] }));
	expect(leaked.state).toBe("failed");
	expect(leaked.detail).toContain(BEFORE);
	// A request after the compaction that carries it again fails the same way.
	const returned = judgeAutomaticCompaction(automatic({ followingRequest: `${BEFORE} ${AFTER}` }));
	expect(returned.state).toBe("failed");
});

test("a compaction that still asked the model for a summary was not taken over", () => {
	const judged = judgeAutomaticCompaction(automatic({ summarizationRequests: 2 }));
	expect(judged.state).toBe("failed");
	expect(judged.detail).toContain("2 request(s)");
	// The authorship mark is the other half of the same claim.
	expect(judgeAutomaticCompaction(automatic({ compactions: [{ summary: CLEAR_COMPACTION_SUMMARY, fromHook: false }] })).state).toBe(
		"failed",
	);
});

test("an automatic compaction that never fired measured nothing", () => {
	const judged = judgeAutomaticCompaction(automatic({ compactions: [], reason: "the context stayed under the threshold" }));
	expect(judged.state).toBe("not-run");
	expect(judged.detail).toContain("under the threshold");
	expect(judgeAutomaticCompaction({ ...automatic(), attempted: false, reason: "settings were not written" }).state).toBe("not-run");
	// A compaction with nothing after it leaves the filtered context unobserved.
	expect(judgeAutomaticCompaction(automatic({ followingRequest: undefined })).state).toBe("not-run");
});

test("a manual compaction is judged from both directions", () => {
	const judged = judgeManualCompaction({
		attempted: true,
		clearedSpan: attempt({ summary: CLEAR_COMPACTION_SUMMARY, fromHook: true, summarizationRequests: 0 }),
		cleanSpan: attempt({ summary: "pi structured summary", summarizationRequests: 1 }),
		beforeMarker: BEFORE,
	});
	expect(judged.state).toBe("confirmed");
	expect(judged.detail).toContain("clean span");
});

test("a manual compaction that chose the wrong side fails", () => {
	// The span held cleared conversation, so pi's summary carries it back into the context.
	const missed = judgeManualCompaction({
		attempted: true,
		clearedSpan: attempt({ summary: `${BEFORE} was discussed`, summarizationRequests: 1 }),
		cleanSpan: attempt({ summarizationRequests: 1 }),
		beforeMarker: BEFORE,
	});
	expect(missed.state).toBe("failed");
	expect(missed.detail).toContain("kept pi's own summary");
	// The span held nothing cleared, so the clear note replaced a real summary.
	const greedy = judgeManualCompaction({
		attempted: true,
		clearedSpan: attempt({ summary: CLEAR_COMPACTION_SUMMARY, fromHook: true, summarizationRequests: 0 }),
		cleanSpan: attempt({ summary: CLEAR_COMPACTION_SUMMARY, summarizationRequests: 0 }),
		beforeMarker: BEFORE,
	});
	expect(greedy.state).toBe("failed");
	expect(greedy.detail).toContain("replacing pi's summary");
});

test("a refused manual compaction is a fixture gap, not a product failure", () => {
	const judged = judgeManualCompaction({
		attempted: true,
		clearedSpan: attempt({ ran: false, error: "Nothing to compact" }),
		cleanSpan: attempt({ summarizationRequests: 1 }),
		beforeMarker: BEFORE,
	});
	expect(judged.state).toBe("not-run");
	expect(judged.detail).toContain("Nothing to compact");
});

test("a fork that opened another session file kept the boundary", () => {
	const judged = judgeFork({
		attempted: true,
		forked: true,
		sessionFile: "/tmp/sessions/fork.jsonl",
		parentSessionFile: "/tmp/sessions/parent.jsonl",
		followingRequest: JSON.stringify({ messages: [{ role: "user", content: AFTER }] }),
		beforeMarker: BEFORE,
	});
	expect(judged.state).toBe("confirmed");
});

test("a fork that did not happen is not a judgement about the boundary", () => {
	expect(judgeFork({ attempted: true, forked: false, reason: "Invalid entry ID for forking", beforeMarker: BEFORE }).state).toBe(
		"not-run",
	);
	// Success without a new file means the run stayed where it was, so nothing was observed.
	expect(
		judgeFork({ attempted: true, forked: true, sessionFile: "/tmp/a.jsonl", parentSessionFile: "/tmp/a.jsonl", beforeMarker: BEFORE })
			.state,
	).toBe("failed");
	expect(
		judgeFork({
			attempted: true,
			forked: true,
			sessionFile: "/tmp/b.jsonl",
			parentSessionFile: "/tmp/a.jsonl",
			followingRequest: `${BEFORE} ${AFTER}`,
			beforeMarker: BEFORE,
		}).state,
	).toBe("failed");
});

test("moving below the boundary brings the cleared conversation back", () => {
	const judged = judgeTreeMove({ attempted: true, moved: true, followingRequest: `${BEFORE} ${AFTER}`, beforeMarker: BEFORE });
	expect(judged.state).toBe("confirmed");
	// The documented drop-off did not happen: the filter is keyed on something other than the branch.
	expect(judgeTreeMove({ attempted: true, moved: true, followingRequest: AFTER, beforeMarker: BEFORE }).state).toBe("failed");
	expect(judgeTreeMove({ attempted: true, moved: false, reason: "Entry not found", beforeMarker: BEFORE }).state).toBe("not-run");
});

test("a resumed session keeps the filter on", () => {
	const judged = judgeResume({
		attempted: true,
		sessionFile: "/tmp/a.jsonl",
		openedSessionFile: "/tmp/a.jsonl",
		followingRequest: AFTER,
		beforeMarker: BEFORE,
	});
	expect(judged.state).toBe("confirmed");
	expect(
		judgeResume({ attempted: true, sessionFile: "/tmp/a.jsonl", openedSessionFile: "/tmp/a.jsonl", followingRequest: `${BEFORE} ${AFTER}`, beforeMarker: BEFORE })
			.state,
	).toBe("failed");
	// Opening something other than the session under test measured a different session.
	expect(judgeResume({ attempted: true, sessionFile: "/tmp/a.jsonl", openedSessionFile: undefined, beforeMarker: BEFORE }).state).toBe(
		"not-run",
	);
});

test("the fork starts at the first message the boundary kept", () => {
	expect(forkTargetOf(BRANCH)?.id).toBe("kept");
	// A branch with no boundary gives nothing to fork from, which the item records as `not-run`.
	expect(forkTargetOf(BRANCH.filter((entry) => entry.id !== "boundary"))).toBeUndefined();
});

test("the tree move targets the reply that carried the cleared message", () => {
	expect(treeTargetOf(BRANCH, BEFORE)?.id).toBe("answer");
	expect(treeTargetOf(BRANCH, "absent-marker")).toBeUndefined();
});

test("compaction entries come out of a probe snapshot in order", () => {
	const snapshot = {
		compactions: [
			{ summary: "first", firstKeptEntryId: "kept", fromHook: false },
			{ summary: CLEAR_COMPACTION_SUMMARY, firstKeptEntryId: "boundary", fromHook: true },
		],
	};
	expect(compactionRecords(snapshot).map((entry) => entry.summary)).toEqual(["first", CLEAR_COMPACTION_SUMMARY]);
	expect(compactionRecords(undefined)).toEqual([]);
});

test("the boundary provider crosses the threshold once, not on every later request", async () => {
	const provider = startBoundaryProvider(AFTER);
	const usage = async (content: string) => {
		const text = await (
			await fetch(`${provider.baseUrl}/v1/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "fake-model", stream: true, messages: [{ role: "user", content }] }),
			})
		).text();
		return Number(text.match(/"prompt_tokens":(\d+)/)?.[1]);
	};
	try {
		expect(await usage(AFTER)).toBe(400_000);
		expect(await usage(AFTER)).toBe(4);
	} finally {
		provider.stop();
	}
});

test("a summarization prompt of either shape counts against the takeover", async () => {
	const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
	const ask = async (content: string) => {
		await fetch(`${provider.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "fake-model", stream: true, messages: [{ role: "user", content }] }),
		});
	};
	try {
		expect(provider.summarizationRequests()).toBe(0);
		await ask("The messages above are a conversation to summarize.");
		expect(provider.summarizationRequests()).toBe(1);
		await ask("The messages above are earlier context from an ongoing conversation.");
		expect(provider.summarizationRequests()).toBe(2);
	} finally {
		provider.stop();
	}
});

test("the boundary provider reports a context over the threshold only once the marker arrives", async () => {
	const provider = startBoundaryProvider(AFTER);
	const ask = async (content: string) => {
		const response = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "fake-model", stream: true, messages: [{ role: "user", content }] }),
		});
		return response.text();
	};
	try {
		const small = await ask("plain question");
		const large = await ask(AFTER);
		expect(small).toContain('"prompt_tokens":4');
		expect(large).toContain('"prompt_tokens":400000');
		expect(provider.bodyWith(AFTER)).toContain(AFTER);
		expect(provider.summarizationRequests()).toBe(0);

		await ask("Please provide a summary of the conversation to summarize");
		expect(provider.summarizationRequests()).toBe(1);
	} finally {
		provider.stop();
	}
});
