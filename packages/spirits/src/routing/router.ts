/**
 * The `route()` body of `spirits/auto`: read the step phase, resolve the target and the thinking
 * level, and report the role.
 *
 * The route neither enters nor leaves a step (design Decision 2); it reads what the event handlers
 * decided. Settings are read per request so an edit takes effect on the next request (Decision 1), and
 * notices are deduplicated per run because `route()` runs for every continuation (Decision 8).
 */

import type { ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	NOTIFY_KEY_NORMAL_UNUSABLE,
	NOTIFY_KEY_PREVIOUS_FALLBACK,
	NOTIFY_KEY_STRONG_UNUSABLE,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
} from "../constants.ts";
import type { RoutingSettings } from "../config.ts";
import type { ActiveStep } from "./phase.ts";
import { resolveRequestPlan } from "./plan.ts";
import { type ModelLookup, modelKey } from "./resolve.ts";

/** Notification reasons, deduplicated within one agent run (design Decision 8). */
export interface NotificationGuard {
	/** True the first time `key` is seen since the last settle. */
	shouldSend(key: string): boolean;
	/** Let every reason notify again: the run that produced them is over. */
	settle(): void;
}

/** Build a guard whose seen reasons clear on settle, so a kill or crash cannot strand a key. */
export function createNotificationGuard(): NotificationGuard {
	const seen = new Set<string>();
	return {
		shouldSend(key) {
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		},
		settle() {
			seen.clear();
		},
	};
}

/**
 * The phase view the route reads. `createRoutingPhase()` satisfies it in full.
 *
 * `step` is optional because a caller that has no step machine — a degraded routing layer, or a test of
 * one route branch — reports nothing, which reads as "the session runs on the lock alone".
 */
export interface RoutePhase {
	/** Role the phase settled on: the running step's default role, or the session lock. */
	current(): string;
	/** The running step, or undefined when the session runs on the lock alone. */
	step?(): ActiveStep | undefined;
}

/**
 * Inputs the route reads per request. Injectable so a test drives every branch without pi.
 */
export interface RouterDeps {
	/** Current step phase, implemented by `createRoutingPhase()`. */
	phase: RoutePhase;
	/** Effective settings, read per request and never cached. */
	readSettings: () => RoutingSettings;
	guard: NotificationGuard;
	/** Reports that this request resolved a target, which is what keeps its step alive. */
	onResolved?: () => void;
}

/** The role and level rules live with the plan, so every caller composes them the same way. */
export { resolveRequestRole, resolveRequestThinkingLevel } from "./plan.ts";

/** The `spirits/auto` route. */
export function createRoutingRoute(deps: RouterDeps): (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute {
	return (request, ctx) => {
		const settings = deps.readSettings();
		const lookup: ModelLookup = ctx.modelRegistry;
		const step = deps.phase.step?.();
		// The resolution is one function so the list and the child cannot compose a different answer
		// (design Decision 15). Notices, the missing-target error, and `onResolved` stay here: they belong
		// to the request rather than to the resolution.
		const plan = resolveRequestPlan({
			...(step ? { step } : {}),
			settings,
			phaseRole: deps.phase.current(),
			lookup,
			...(request.thinkingLevel ? { sessionThinkingLevel: request.thinkingLevel } : {}),
			...(request.previous ? { previous: request.previous } : {}),
		});

		if (plan.source === "strong" && plan.model) {
			deps.onResolved?.();
			return {
				model: plan.model,
				// The plan leaves the level out when nothing is configured and the caller passed no session
				// level. A route always names one, and pi hands us the session's own selection (D15).
				thinkingLevel: plan.thinkingLevel ?? request.thinkingLevel,
				role: MODEL_ROLE_STRONG,
			};
		}

		// A strong request with no configured target falls back in silence; only a configured target that
		// cannot be used is worth a notice.
		if (plan.strongUnavailable && settings.strong && deps.guard.shouldSend(NOTIFY_KEY_STRONG_UNUSABLE)) {
			ctx.ui.notify(
				`strong model ${modelKey(settings.strong)} is unavailable; running ${MODEL_ROLE_NORMAL}`,
				"warning",
			);
		}

		if (!plan.model) {
			throw new Error(
				`${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID} has no normal model: set models.normal, or defaultProvider and defaultModel in settings`,
			);
		}
		// A configured normal that could not be used is the user's own setting failing, so it is named
		// even when pi's default model caught the request. Nothing configured and pi's default answering
		// is the ordinary case, and stays quiet.
		if (plan.normalUnusable && settings.normal && deps.guard.shouldSend(NOTIFY_KEY_NORMAL_UNUSABLE)) {
			ctx.ui.notify(
				`normal model ${modelKey(settings.normal)} is unavailable; running ${modelKey(plan.model)}`,
				"warning",
			);
		}
		if (plan.normal?.source === "previous" && deps.guard.shouldSend(NOTIFY_KEY_PREVIOUS_FALLBACK)) {
			ctx.ui.notify(`default model is unavailable; continuing with ${modelKey(plan.model)}`, "warning");
		}
		deps.onResolved?.();
		return {
			model: plan.model,
			thinkingLevel: plan.thinkingLevel ?? request.thinkingLevel,
			role: MODEL_ROLE_NORMAL,
		};
	};
}
