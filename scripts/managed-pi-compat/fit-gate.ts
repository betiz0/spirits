/**
 * Observations of the `spirits/auto` context fit gate on the dedicated Pi.
 *
 * The gate measures the transition from the strong role's large window to the normal role's small
 * window at an idle input: when what the conversation accumulated is over the routed target's own
 * reserve-inclusive threshold, the gate runs the host's compaction first, re-measures, and either
 * lets the input through or refuses it with a notice. The fixture supplies both windows —
 * `fake-strong` (128000) answers the strong-phase steps that grow the conversation, and `fake-small`
 * (32000) is the normal role's target the transition routes to.
 *
 * Two settings numbers drive every scenario (tasks 5.1–5.4):
 *
 * - `reserveTokens` 4000: the small target's threshold is 28000 tokens and the strong target's is
 *   124000, so a conversation can be over one and under the other at the same time.
 * - `keepRecentTokens`: below the small threshold (2000) the compaction result fits and the
 *   transition proceeds; above it (38000, over four filler turns' ~50000-token conversation the
 *   cut still leaves more than 28000 kept) the result still does not fit and the gate must refuse.
 *
 * As in `clear-boundary.ts`, the `judge*` functions are pure over what the harness measured, and
 * the drivers in `run.ts` only collect that measurement.
 */

import { SUMMARIZATION_MARKERS } from "./clear-boundary.ts";
import { type FakeProviderRequest, startFakeProvider } from "./fake-provider.ts";
import type { CompatState } from "./runner.ts";

/** The reserve both fit-gate scenarios pin; the windows are the fixture's (128000 / 32000). */
export const FIT_GATE_RESERVE_TOKENS = 4000;
/** Text length of one strong-phase filler answer, about 11000 tokens under pi's chars/4 estimate. */
export const FIT_GATE_FILLER_CHARS = 44_000;
/** Number of strong-phase filler turns; four of them put the conversation ~50000 tokens deep. */
export const FIT_GATE_FILL_TURNS = 4;
/** Keep that leaves the compaction result under the small window: the transition may proceed. */
export const FIT_GATE_KEEP_FITS = 2_000;
/** Keep that leaves more than the small window's threshold behind: the gate must refuse. */
export const FIT_GATE_KEEP_BLOCKS = 38_000;

/** Marker every filler prompt carries, so the fake endpoint knows to answer at length. */
export const FIT_GATE_FILL_MARKER = "fitgate fill";
/** The plain idle prompt that crosses from the strong phase back to the normal role. */
export const FIT_GATE_TRANSITION_MARKER = "fitgate transition";
/**
 * The two refused inputs of the block scenario; neither may reach the provider.
 *
 * The wording is a marker no prompt template or skill expansion in the fixture carries, so a leak
 * of a refused text into a later request is always visible and never incidental.
 */
export const FIT_GATE_BLOCK_MARKERS = ["fitgate block one", "fitgate block two"] as const;

/** One filler turn: a strong-phase skill step whose answer grows the conversation. */
export function fitGateFillPrompt(index: number): string {
	return `${FIT_GATE_FILL_MARKER} ${index} answer ok`;
}

/** The settings one fit-gate scenario needs before its launch. */
export function fitGateSettings(
	keepRecentTokens: number,
	provider: string,
	strongModel: string,
	smallModel: string,
): Record<string, unknown> {
	return {
		models: {
			strong: `${provider}/${strongModel}`,
			normal: `${provider}/${smallModel}`,
		},
		compaction: { enabled: true, reserveTokens: FIT_GATE_RESERVE_TOKENS, keepRecentTokens },
	};
}

/** The fake endpoint the fit-gate scenarios run against. */
export interface FitGateProvider {
	baseUrl: string;
	requests: FakeProviderRequest[];
	/** The model each summarization request asked for, oldest first. */
	summarizationModels(): Array<string | undefined>;
	/** The model of the newest conversation (non-summarization) request carrying `marker`. */
	modelFor(marker: string): string | undefined;
	/** How many conversation requests carried `marker`. */
	conversationRequests(marker: string): number;
	stop(): void;
}

/**
 * Start the endpoint that grows the conversation on demand.
 *
 * A request whose prompt carries the fill marker is answered with a long filler text — that answer
 * is what accumulates past the small window. Pi's own summarization prompts are answered briefly
 * (and are classified as summarizations, never as conversation), and everything else, including the
 * transition prompt, gets a short answer. Usage stays the default small value everywhere: pi's
 * own threshold compaction is usage-driven, and the only compaction these scenarios want is the
 * gate's.
 */
export function startFitGateProvider(fillerChars: number): FitGateProvider {
	let filled = 0;
	const isSummarizationBody = (body: unknown): boolean => {
		const json = JSON.stringify(body ?? "");
		return SUMMARIZATION_MARKERS.some((marker) => json.includes(marker));
	};
	const provider = startFakeProvider(
		{ name: "noop", arguments: {} },
		{
			reply: (body) => {
				if (isSummarizationBody(body)) return { kind: "text", text: "compat fit gate summary" };
				if (JSON.stringify(body ?? "").includes(FIT_GATE_FILL_MARKER)) {
					return { kind: "text", text: `compat filler ${++filled} ${"x".repeat(fillerChars)}` };
				}
				return { kind: "text", text: "ok" };
			},
		},
	);
	const bodyOf = (request: FakeProviderRequest) => JSON.stringify(request.body ?? "");
	const isConversation = (request: FakeProviderRequest) =>
		request.body !== undefined && !isSummarizationBody(request.body);
	return {
		baseUrl: provider.baseUrl,
		requests: provider.requests,
		summarizationModels: () =>
			provider.requests.filter((request) => isSummarizationBody(request.body)).map((request) => request.model),
		modelFor: (marker) =>
			[...provider.requests].reverse().find((request) => isConversation(request) && bodyOf(request).includes(marker))
				?.model,
		conversationRequests: (marker) =>
			provider.requests.filter((request) => isConversation(request) && bodyOf(request).includes(marker)).length,
		stop: provider.stop,
	};
}

/** What one fit-gate item decided, in the runner's own state vocabulary. */
export interface FitGateJudgement {
	state: CompatState;
	detail: string;
}

function notRun(reason: string): FitGateJudgement {
	return { state: "not-run", detail: reason };
}

/** The ahead-compaction observation: the transition's summary ran on the previous model. */
export interface AheadCompactionObservation {
	attempted: boolean;
	reason?: string;
	/** Models of the summarization requests during the transition, oldest first. */
	summarizationModels: Array<string | undefined>;
	/** Model that answered the transition prompt, when a request carried it. */
	transitionModel?: string;
}

/**
 * The ahead compaction summarized on the last successful model, then the small-window target answered.
 *
 * A split turn may put two summarization requests behind one compaction, so more than one is
 * allowed; every one of them must name the strong model, because the span the gate hands pi does
 * not fit the small target (design Decision D4).
 */
export function judgeAheadCompaction(
	o: AheadCompactionObservation,
	expect: { summaryModel: string; targetModel: string },
): FitGateJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the transition could not be driven");
	if (o.summarizationModels.length === 0)
		return {
			state: "failed",
			detail: "the gate sent the over-threshold transition without a summarization request first",
		};
	const strays = [...new Set(o.summarizationModels.filter((model) => model !== expect.summaryModel))];
	if (strays.length > 0)
		return {
			state: "failed",
			detail: `the ahead summary ran on ${strays.map((model) => model ?? "an unnamed model").join(", ")}, not the previous successful model ${expect.summaryModel}`,
		};
	if (o.transitionModel === undefined)
		return {
			state: "failed",
			detail: "no request carried the transition prompt after the ahead compaction",
		};
	if (o.transitionModel !== expect.targetModel)
		return {
			state: "failed",
			detail: `the transition was answered by ${o.transitionModel}, not the small-window normal target ${expect.targetModel}`,
		};
	return {
		state: "confirmed",
		detail: `the ahead compaction summarized ${o.summarizationModels.length} time(s) on ${expect.summaryModel}, and ${expect.targetModel} answered the transition`,
	};
}

/** The blocked-interval observation: refusals start nothing and notify. */
export interface BlockedObservation {
	attempted: boolean;
	reason?: string;
	/** Conversation requests that carried either blocked prompt. */
	blockRequests: number;
	/** Runs the session started, against the number of turns the scenario built. */
	agentStarts: number;
	buildTurns: number;
	/** Refusal notices the RPC stream carried. */
	notices: number;
	/** Compaction entries after both refusals. */
	compactionEntries: number;
}

/**
 * Two over-threshold inputs were refused, and the second had nothing left to compact.
 *
 * The first refusal follows one ahead compaction; the second finds the session ending in that
 * compaction entry and must refuse without writing another one — pi's own "already compacted" path
 * is an observation here, not a contract this item asserts on.
 */
export function judgeBlocked(o: BlockedObservation): FitGateJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the refusal could not be driven");
	if (o.blockRequests > 0)
		return {
			state: "failed",
			detail: `a refused input still reached the provider (${o.blockRequests} conversation request(s))`,
		};
	if (o.agentStarts > o.buildTurns)
		return {
			state: "failed",
			detail: `a refused input started a run (${o.agentStarts} agent starts against ${o.buildTurns} built turns)`,
		};
	if (o.notices < FIT_GATE_BLOCK_MARKERS.length)
		return {
			state: "failed",
			detail: `the refusals produced ${o.notices} notice(s); each refused input must carry one`,
		};
	if (o.compactionEntries < 1)
		return {
			state: "failed",
			detail: "the first refusal compacted nothing, so the blocked interval was never measured",
		};
	if (o.compactionEntries > 1)
		return {
			state: "failed",
			detail: `the second refusal wrote another compaction entry (${o.compactionEntries} entries) although the session already ended in one`,
		};
	return {
		state: "confirmed",
		detail: `both refusals notified with 0 conversation requests and 0 runs; ${o.compactionEntries} compaction entry across the interval proves the second input had nothing left to compact`,
	};
}

/** The single-compaction observation: one transition turn, one compaction, one request. */
export interface SingleCompactionObservation {
	attempted: boolean;
	reason?: string;
	compactionEntries: number;
	/** Conversation requests that carried the transition prompt. */
	transitionRequests: number;
}

/**
 * The transition turn left exactly one compaction entry and one conversation request.
 *
 * A second entry means pi's own threshold compaction ran behind the gate's on the same turn
 * (double compaction); a second request means the turn was resent. Both are failures of the
 * "compact once, then send" contract.
 */
export function judgeSingleCompaction(o: SingleCompactionObservation): FitGateJudgement {
	if (!o.attempted) return notRun(o.reason ?? "the transition could not be driven");
	if (o.compactionEntries === 0) return { state: "failed", detail: "the ahead compaction wrote no compaction entry" };
	if (o.compactionEntries > 1)
		return {
			state: "failed",
			detail: `the transition turn left ${o.compactionEntries} compaction entries; pi's own compaction ran behind the gate's`,
		};
	if (o.transitionRequests !== 1)
		return {
			state: "failed",
			detail: `the transition turn produced ${o.transitionRequests} conversation requests; exactly one is allowed`,
		};
	return {
		state: "confirmed",
		detail: "one compaction entry and one conversation request for the transition turn",
	};
}
