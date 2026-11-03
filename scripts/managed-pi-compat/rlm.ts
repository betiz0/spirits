/**
 * rlm child-session compatibility classification.
 *
 * Physical-model children and `spirits/auto` parents are separate items. An auto-parent failure is
 * a known limitation, not a pass, and only the fake provider is in scope for this change.
 */

import type { CompatState } from "./runner.ts";

/** Observations from one child-session probe. */
export interface RlmChildObservation {
	childCreated: boolean;
	finalAnswer?: string;
	usageRecorded: boolean;
	abortReported?: boolean;
	error?: string;
}

/** Classify one physical-model child. */
export function classifyPhysicalChild(observation: RlmChildObservation): {
	state: CompatState;
	detail: string;
} {
	if (!observation.childCreated) {
		return { state: "failed", detail: observation.error ?? "child session was not created" };
	}
	if (!observation.finalAnswer || !observation.usageRecorded) {
		return { state: "limited", detail: "child completed without a final answer or usage record" };
	}
	if (observation.abortReported === false) {
		return { state: "limited", detail: "child completed but abort was not observed" };
	}
	return { state: "confirmed", detail: "physical-model child completed with usage and abort" };
}

/** Classify a child whose parent selected `spirits/auto`. */
export function classifyAutoChild(observation: RlmChildObservation): {
	state: CompatState;
	detail: string;
} {
	if (observation.childCreated && observation.finalAnswer) {
		return { state: "limited", detail: "auto parent child resolved a virtual model; recorded separately" };
	}
	return {
		state: "limited",
		detail: `known limitation: ${observation.error ?? "auto parent did not resolve a child virtual model"}`,
	};
}
