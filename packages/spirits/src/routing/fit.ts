/**
 * The shared fit measurement behind the context fit gate.
 *
 * Two pure readings live here and nothing else: how full a conversation is (projection messages and
 * a not-yet-sent input line, counted with pi's own `estimateTokens`), and whether a measured amount
 * passes pi's own reserve-inclusive threshold for a window (design Decisions D2 and D5 of the
 * fit-gate change). The gate's input control stays in `register.ts` and the summary resolution in
 * `router.ts`; both read through this module so neither re-derives a threshold the other could
 * disagree with.
 *
 * The threshold call is the host's exported `shouldCompact` with `enabled` pinned true: the gate's
 * rejection must read exactly like pi's compaction decision minus the switch that only decides
 * whether pi compacts on its own (design Decision D8). Spirits adds no numeric default of its own —
 * the fallback is the host's exported `DEFAULT_COMPACTION_SETTINGS`.
 */

import { DEFAULT_COMPACTION_SETTINGS, estimateTokens, shouldCompact } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, PiModel } from "../types/host.ts";
import {
	SETTINGS_KEY_COMPACTION,
	SETTINGS_KEY_COMPACTION_KEEP_RECENT_TOKENS,
	SETTINGS_KEY_COMPACTION_MODEL_OVERRIDES,
	SETTINGS_KEY_COMPACTION_RESERVE_TOKENS,
} from "../constants.ts";
import { modelKey } from "./resolve.ts";

/** pi's compaction numbers as resolved for one model: the three values the fit check reads. */
export interface FitCompactionSettings {
	/** pi's `compaction.enabled`: whether pi compacts on its own, which decides if the gate may. */
	enabled: boolean;
	/** Tokens pi keeps free below the window, which is what makes the threshold bite early. */
	reserveTokens: number;
	/** Tokens pi keeps recent in a compaction, which bounds how short the result can get. */
	keepRecentTokens: number;
}

/** One settings token value: a non-negative safe integer is the only form pi accepts. */
function tokenSetting(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Read one object member without assuming the parent is an object. */
function member(value: unknown, key: string): unknown {
	if (typeof value !== "object" || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}

/**
 * Resolve pi's compaction numbers for one model.
 *
 * The walk is pi's own: the model's `compaction.modelOverrides["provider/id"]` entry, then the
 * ordinary `compaction` key, then the host's built-in default. A value pi would reject (a negative
 * number, a decimal, a non-number) reads as unset here too, so the gate cannot invent a threshold
 * from a value the host ignores.
 */
export function readFitCompaction(settings: unknown, model: PiModel): FitCompactionSettings {
	const compaction = member(settings, SETTINGS_KEY_COMPACTION);
	const override = member(member(compaction, SETTINGS_KEY_COMPACTION_MODEL_OVERRIDES), modelKey(model));
	return {
		enabled: member(compaction, "enabled") === false ? false : DEFAULT_COMPACTION_SETTINGS.enabled,
		reserveTokens:
			tokenSetting(member(override, SETTINGS_KEY_COMPACTION_RESERVE_TOKENS)) ??
			tokenSetting(member(compaction, SETTINGS_KEY_COMPACTION_RESERVE_TOKENS)) ??
			DEFAULT_COMPACTION_SETTINGS.reserveTokens,
		keepRecentTokens:
			tokenSetting(member(override, SETTINGS_KEY_COMPACTION_KEEP_RECENT_TOKENS)) ??
			tokenSetting(member(compaction, SETTINGS_KEY_COMPACTION_KEEP_RECENT_TOKENS)) ??
			DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
	};
}

/**
 * Estimate one conversation: the messages on the branch projection plus the input line that is
 * about to join them.
 *
 * The count is pi's chars/4 estimate summed per message — conservative, so a conversation reads
 * fuller here than the provider would count it, which pushes the gate to compact and to refuse on
 * the safe side (design Decision D5). The input text is measured before any skill or template
 * expansion, the same content the projection does not carry yet.
 */
export function estimateConversationTokens(messages: readonly AgentMessage[], inputText?: string): number {
	let tokens = 0;
	for (const message of messages) tokens += estimateTokens(message);
	if (inputText !== undefined && inputText !== "") {
		// A plain user message, in the shape pi's own estimator reads; the timestamp is not part of
		// the count, and no message reaches a session from here.
		tokens += estimateTokens({ role: "user", content: inputText, timestamp: 0 } as unknown as AgentMessage);
	}
	return tokens;
}

/**
 * Whether a measured amount passes pi's threshold for a window.
 *
 * The call is the host's exported `shouldCompact` with `enabled` pinned true: same comparison,
 * `estimate > contextWindow - reserveTokens`, so the gate rejects exactly where pi would compact and
 * nowhere else. `keepRecentTokens` takes the default because the comparison never reads it.
 */
export function overFitThreshold(estimate: number, contextWindow: number, reserveTokens: number): boolean {
	return shouldCompact(estimate, contextWindow, {
		enabled: true,
		reserveTokens,
		keepRecentTokens: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
	});
}

/**
 * Whether a measured span fits a window under the same threshold.
 *
 * This is the predicate the route uses to pick a summary model: a candidate holds the span exactly
 * when it is not over that candidate's own threshold (design Decision D4 of the fit-gate change).
 * The estimate and the capacity are arguments, so no model, role, or input control reaches in.
 */
export function spanFits(estimate: number, contextWindow: number, reserveTokens: number): boolean {
	return !overFitThreshold(estimate, contextWindow, reserveTokens);
}
