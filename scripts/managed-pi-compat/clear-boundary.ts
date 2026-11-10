/**
 * Observations of what still reads the conversation after a `/spirits-clear` boundary.
 *
 * The boundary only holds while everything that rebuilds the context later keeps honouring it: an
 * automatic compaction, a manual one, a fork, a move back through the session tree, and a resume.
 * Pi 1.5.0 drives all five over RPC or the extension API, so each one is a compatibility item judged
 * by the request the fake provider received and the session entries the host wrote.
 *
 * The judgement is split from the driving: `judge*` functions are pure over what the harness
 * measured, and the drivers below only collect that measurement.
 */

import { CLEAR_COMPACTION_SUMMARY, CLEAR_ENTRY_TYPE } from "../../packages/spirits/src/constants.ts";
import { startFakeProvider, type FakeProviderRequest, type FakeUsage } from "./fake-provider.ts";
import type { CompatState } from "./runner.ts";

/**
 * Openings of the two prompts pi sends when it summarizes on its own.
 *
 * `SUMMARIZATION_PROMPT` summarizes a span of conversation, `TURN_PREFIX_SUMMARIZATION_PROMPT`
 * summarizes the prefix of a turn that got split. Either one means the extension did not take the
 * compaction over.
 */
export const SUMMARIZATION_MARKERS = ["conversation to summarize", "earlier context from an ongoing conversation"];

/** Context size that puts the session over the compaction threshold the fixture writes. */
const BULKY_USAGE: FakeUsage = { prompt_tokens: 400_000, completion_tokens: 2, total_tokens: 400_002 };
const SMALL_USAGE: FakeUsage = { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 };

/** The fake endpoint the boundary items run against. */
export interface BoundaryProvider {
	baseUrl: string;
	requests: FakeProviderRequest[];
	/** Requests that carried pi's own summarization prompt, so a takeover attempt is visible. */
	summarizationRequests(): number;
	/** Body of the last request whose messages carry `marker`. */
	bodyWith(marker: string): string | undefined;
	stop(): void;
}

/**
 * A trigger no prompt contains, for the items that must not see an automatic compaction.
 *
 * A manual compaction, a fork, a tree move, and a resume are each measured on their own. An
 * automatic compaction on top of them would replace the thing being measured, and a second one after
 * the extension's takeover makes pi write its own summary behind it.
 */
export const NO_AUTOMATIC_COMPACTION = "compat-no-automatic-compaction";

/**
 * Start the endpoint for one boundary item.
 *
 * The first request that carries `trigger` reports a context over the compaction threshold, and every
 * request after it reports a small one. Pi checks the threshold when a turn ends, so a trigger that
 * fires on the request sent after the clear puts that turn's compaction behind the boundary, which is
 * the compaction under measurement. Firing once keeps a second compaction from following it, because
 * the follow-up prompt still carries the same marker.
 */
export function startBoundaryProvider(trigger: string): BoundaryProvider {
	let crossed = false;
	const provider = startFakeProvider(
		{ name: "noop", arguments: {} },
		{
			reply: () => ({ kind: "text", text: "ok" }),
			usage: (body) => {
				if (crossed || !JSON.stringify(body).includes(trigger)) return SMALL_USAGE;
				crossed = true;
				return BULKY_USAGE;
			},
		},
	);
	const bodyOf = (request: FakeProviderRequest) => JSON.stringify(request.body ?? "");
	return {
		baseUrl: provider.baseUrl,
		requests: provider.requests,
		summarizationRequests: () =>
			provider.requests.filter((request) => {
				const body = bodyOf(request);
				return SUMMARIZATION_MARKERS.some((marker) => body.includes(marker));
			}).length,
		bodyWith: (marker) => [...provider.requests].reverse().map(bodyOf).find((body) => body.includes(marker)),
		stop: provider.stop,
	};
}

/** A compaction entry as `get_entries` reports it. */
export interface CompactionRecord {
	summary?: string;
	firstKeptEntryId?: string;
	fromHook?: boolean;
}

/** One entry of the branch, as the probe extension read it through the dedicated Pi. */
export interface BranchRecord {
	id: string;
	type: string;
	/** Set on a custom entry, which is how a clear boundary is recognized. */
	customType?: string;
	role?: string;
	text: string;
}

/** Session state the probe extension records around a boundary step. */
export interface BoundaryState {
	sessionId: string;
	sessionFile?: string;
	messageEntries: number;
	todoEntries: number;
	branch: BranchRecord[];
	/** Compaction entries the host had written when the snapshot was taken, oldest first. */
	compactions?: CompactionRecord[];
}

/** What one item decided, in the runner's own state vocabulary. */
export interface BoundaryJudgement {
	state: CompatState;
	detail: string;
}

/** A step the harness could not drive, with the reason it could not. */
function notRun(reason: string): BoundaryJudgement {
	return { state: "not-run", detail: reason };
}

/** Whether any compaction summary in the list carries `marker`. */
function summaryCarries(compactions: readonly CompactionRecord[], marker: string): boolean {
	return compactions.some((entry) => (entry.summary ?? "").includes(marker));
}

/** The automatic compaction that follows a clear boundary. */
export interface AutomaticCompactionObservation {
	attempted: boolean;
	reason?: string;
	/** Compaction entries the host wrote, oldest first. */
	compactions: CompactionRecord[];
	/** Requests that carried pi's own summarization prompt. */
	summarizationRequests: number;
	/** The request the provider received after the compaction. */
	followingRequest?: string;
	beforeMarker: string;
	afterMarker: string;
}

/**
 * Decide the automatic compaction from what the host wrote and what the model received.
 *
 * A compaction that fires after the boundary has to be the one the extension wrote: its summary is
 * the fixed clear note, it names the extension hook as the author, and pi never asks the model to
 * summarize. A run where no compaction fired measured nothing, which is `not-run`.
 */
export function judgeAutomaticCompaction(o: AutomaticCompactionObservation): BoundaryJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the automatic compaction was not attempted");
	if (o.compactions.length === 0) {
		return notRun(`${o.reason ?? "the context never crossed the threshold"}; no compaction entry was written after the boundary`);
	}
	const takeover = o.compactions.find((entry) => entry.fromHook === true && (entry.summary ?? "") === CLEAR_COMPACTION_SUMMARY);
	if (takeover === undefined) {
		const summary = o.compactions.at(-1)?.summary ?? "";
		return {
			state: "failed",
			detail: `the compaction after the boundary was pi's own summary, not the extension's clear note (${summary.slice(0, 80)})`,
		};
	}
	if (o.summarizationRequests > 0) {
		return {
			state: "failed",
			detail: `pi asked the model for a summary in ${o.summarizationRequests} request(s), so something summarized behind the takeover`,
		};
	}
	if (summaryCarries(o.compactions, o.beforeMarker)) {
		return { state: "failed", detail: `a compaction summary carried the conversation cleared at the boundary (${o.beforeMarker})` };
	}
	if (o.followingRequest === undefined) {
		return notRun("no request followed the compaction, so the filtered context was not observed");
	}
	if (o.followingRequest.includes(o.beforeMarker)) {
		return { state: "failed", detail: `the request after the compaction carried ${o.beforeMarker} again` };
	}
	return {
		state: "confirmed",
		detail: `the compaction after the boundary came from the extension hook with the clear note in ${o.summarizationRequests} summarization request(s), and the following request carried ${o.afterMarker} without ${o.beforeMarker}`,
	};
}

/** One manual compaction and what it cost. */
export interface ManualCompactionAttempt {
	ran: boolean;
	/** Why the host refused, which is a fixture condition rather than a product failure. */
	error?: string;
	summary?: string;
	fromHook?: boolean;
	summarizationRequests: number;
}

export interface ManualCompactionObservation {
	attempted: boolean;
	reason?: string;
	/** A compaction whose span still holds conversation the boundary removed. */
	clearedSpan: ManualCompactionAttempt;
	/** A compaction whose span holds only conversation kept after the boundary. */
	cleanSpan: ManualCompactionAttempt;
	beforeMarker: string;
}

/**
 * Decide the manual compaction from both directions.
 *
 * The extension takes a manual compaction over only when the span holds cleared conversation; a
 * clean span has to keep pi's own summary, because swapping it for the clear note would drop kept
 * conversation and leave the context over the threshold.
 */
export function judgeManualCompaction(o: ManualCompactionObservation): BoundaryJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the manual compaction was not attempted");
	if (!o.clearedSpan.ran || !o.cleanSpan.ran) {
		const refusal = [o.clearedSpan, o.cleanSpan].map((attempt) => attempt.error).find((error) => error !== undefined);
		return notRun(`the host refused the manual compaction (${refusal ?? "no reason reported"})`);
	}
	const takenOver = (o.clearedSpan.summary ?? "").startsWith(CLEAR_COMPACTION_SUMMARY);
	if (!takenOver) {
		return {
			state: "failed",
			detail: `a compaction whose span holds cleared conversation kept pi's own summary: ${String(o.clearedSpan.summary ?? "").slice(0, 120)}`,
		};
	}
	if ((o.clearedSpan.summary ?? "").includes(o.beforeMarker)) {
		return { state: "failed", detail: `the taken-over summary carried the cleared conversation (${o.beforeMarker})` };
	}
	if (o.clearedSpan.summarizationRequests > 0) {
		return {
			state: "failed",
			detail: `the taken-over compaction still asked the model for a summary in ${o.clearedSpan.summarizationRequests} request(s)`,
		};
	}
	if ((o.cleanSpan.summary ?? "").startsWith(CLEAR_COMPACTION_SUMMARY)) {
		return { state: "failed", detail: "a compaction with nothing cleared behind the boundary was taken over, replacing pi's summary" };
	}
	if (o.cleanSpan.summarizationRequests === 0) {
		return { state: "failed", detail: "pi wrote no summary for a span that holds nothing the boundary removed" };
	}
	return {
		state: "confirmed",
		detail: `a compaction with cleared conversation in its span was taken over with the clear note in 0 summarization requests, and a clean span kept pi's own summary in ${o.cleanSpan.summarizationRequests} request(s)`,
	};
}

export interface ForkObservation {
	attempted: boolean;
	reason?: string;
	/** Whether the host accepted the fork. */
	forked: boolean;
	sessionFile?: string;
	/** The session file the fork was taken from. */
	parentSessionFile?: string;
	followingRequest?: string;
	beforeMarker: string;
}

/** Decide a fork taken from a session that carries a boundary. */
export function judgeFork(o: ForkObservation): BoundaryJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the fork was not attempted");
	if (!o.forked) return notRun(`${o.reason ?? "the host refused the fork"}; the forked session was never observed`);
	if (o.sessionFile === undefined || o.sessionFile === o.parentSessionFile) {
		return { state: "failed", detail: `the fork reported success but kept the session file ${String(o.sessionFile)}` };
	}
	if (o.followingRequest === undefined) return notRun("the forked session sent no request, so its context was not observed");
	if (o.followingRequest.includes(o.beforeMarker)) {
		return { state: "failed", detail: `the forked session sent ${o.beforeMarker} again` };
	}
	return {
		state: "confirmed",
		detail: `the fork created ${o.sessionFile?.slice(-12)} and its request carried the conversation kept after the boundary without ${o.beforeMarker}`,
	};
}

export interface TreeMoveObservation {
	attempted: boolean;
	reason?: string;
	/** Whether the extension API moved the leaf. */
	moved: boolean;
	followingRequest?: string;
	beforeMarker: string;
}

/**
 * Decide a move to before the boundary.
 *
 * The documented behaviour is that the filter drops off: the branch below the boundary holds no
 * boundary entry, so the cleared conversation returns to the request. A move that left it out would
 * mean the filter is keyed on something other than the branch.
 */
export function judgeTreeMove(o: TreeMoveObservation): BoundaryJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the tree move was not attempted");
	if (!o.moved) return notRun(`${o.reason ?? "the extension API refused the move"}; the branch below the boundary was never observed`);
	if (o.followingRequest === undefined) return notRun("no request followed the move, so the branch content was not observed");
	if (!o.followingRequest.includes(o.beforeMarker)) {
		return {
			state: "failed",
			detail: `the leaf moved before the boundary and the request still left ${o.beforeMarker} out, so the filter did not drop off`,
		};
	}
	return {
		state: "confirmed",
		detail: `moving the leaf to before the boundary brought ${o.beforeMarker} back into the request, which is the documented drop-off`,
	};
}

export interface ResumeObservation {
	attempted: boolean;
	reason?: string;
	sessionFile?: string;
	/** The session file the run opened. */
	openedSessionFile?: string;
	followingRequest?: string;
	beforeMarker: string;
}

/** Decide a session reopened in another process. */
export function judgeResume(o: ResumeObservation): BoundaryJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the resume was not attempted");
	if (o.openedSessionFile === undefined || o.openedSessionFile !== o.sessionFile) {
		return notRun(`the resume opened ${String(o.openedSessionFile)} instead of ${String(o.sessionFile)}`);
	}
	if (o.followingRequest === undefined) return notRun("the resumed session sent no request, so its context was not observed");
	if (o.followingRequest.includes(o.beforeMarker)) {
		return { state: "failed", detail: `the resumed session sent ${o.beforeMarker} again` };
	}
	return {
		state: "confirmed",
		detail: `the resumed session ${String(o.openedSessionFile).slice(-12)} kept the boundary and sent no ${o.beforeMarker}`,
	};
}

/** The compaction entries a probe snapshot reported, oldest first. */
export function compactionRecords(state: { compactions?: CompactionRecord[] } | undefined): CompactionRecord[] {
	return state?.compactions ?? [];
}

/** Index of the newest clear boundary in a branch the probe reported. */
function boundaryIndexOf(branch: readonly BranchRecord[]): number {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry !== undefined && entry.type === "custom" && entry.customType === CLEAR_ENTRY_TYPE) return index;
	}
	return -1;
}

/**
 * The entry to fork from: the first message the boundary kept.
 *
 * Forking before it leaves the forked session ending at the boundary, which is the shortest branch
 * that still carries one.
 */
export function forkTargetOf(branch: readonly BranchRecord[]): BranchRecord | undefined {
	const boundary = boundaryIndexOf(branch);
	if (boundary < 0) return undefined;
	return branch.slice(boundary + 1).find((entry) => entry.type === "message" && entry.role === "user");
}

/**
 * The entry to move the leaf to: the reply that carried the cleared message's answer.
 *
 * The branch below that entry still holds the cleared message and no boundary, which is the point the
 * filter is documented to stop applying.
 */
export function treeTargetOf(branch: readonly BranchRecord[], beforeMarker: string): BranchRecord | undefined {
	const cleared = branch.findIndex((entry) => entry.type === "message" && entry.text.includes(beforeMarker));
	if (cleared < 0) return undefined;
	return branch.slice(cleared + 1).find((entry) => entry.type === "message" && entry.role === "assistant");
}
