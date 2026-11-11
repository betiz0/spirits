/**
 * Measurement of the guard's decisions.
 *
 * One `spirits_guard` entry per decision that hit a category, with four fields: which categories,
 * which mode, whether it blocked, and whether the call was nested. A decision that hit nothing is
 * not recorded — bash calls were an order of magnitude more numerous than cells, and the entry file
 * would stop being readable. pi keeps custom entries out of the LLM context, so this stays
 * measurement.
 *
 * The command string, its output, and its argument values never enter a record: the categories say
 * what the shape was, which is all the aggregate needs.
 */

import { ACTION_GUARD_ENTRY_TYPE, type ActionGuardMode, type GuardCategoryId } from "../constants.ts";

/** One recorded decision. The four fields are the whole entry. */
export interface GuardEntry {
	/** The category ids the decision hit, in reporting order. */
	category: GuardCategoryId[];
	/** The mode the guard was running in. */
	mode: ActionGuardMode;
	/** Whether the call was blocked. `warn` records the hit and lets it run. */
	blocked: boolean;
	/** Whether another tool issued the bash call. */
	nested: boolean;
}

/** The facts of one decision, as the handler has them. */
export interface GuardDecision {
	categories: readonly GuardCategoryId[];
	mode: ActionGuardMode;
	blocked: boolean;
	nested: boolean;
}

/** The part of `pi` this module writes through. */
export type AppendEntry = (customType: string, data: unknown) => void;

/** Build the entry for one decision. Copies the category list so later mutation cannot reach back. */
export function buildGuardEntry(decision: GuardDecision): GuardEntry {
	return {
		category: [...decision.categories],
		mode: decision.mode,
		blocked: decision.blocked,
		nested: decision.nested,
	};
}

/**
 * Record one decision, or build it and return it without recording when there is no sink.
 *
 * A failing `appendEntry` is swallowed: the measurement must not change the verdict, and pi turns a
 * handler error into a blocked tool.
 */
export function recordGuardDecision(decision: GuardDecision, appendEntry?: AppendEntry): GuardEntry {
	const entry = buildGuardEntry(decision);
	if (appendEntry === undefined) return entry;
	try {
		appendEntry(ACTION_GUARD_ENTRY_TYPE, entry);
	} catch {
		// The log is measurement, not part of the verdict.
	}
	return entry;
}
