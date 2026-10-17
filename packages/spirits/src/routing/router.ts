/**
 * The `route()` body of `spirits/auto`: read the current phase, resolve the target, report the role.
 *
 * The route neither enters nor leaves a phase (design Decision 6); it reads what the event handlers
 * decided. Settings are read per request so an edit takes effect on the next request (Decision 1),
 * and notices are deduplicated per run because `route()` runs for every continuation (Decision 8).
 */

import type { ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	NOTIFY_KEY_PREVIOUS_FALLBACK,
	NOTIFY_KEY_STRONG_UNUSABLE,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
} from "../constants.ts";
import type { RoutingSettings } from "../config.ts";
import { type ModelLookup, modelKey, resolveNormalTarget, resolveStrongTarget } from "./resolve.ts";

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

/** Inputs the route reads per request. Injectable so a test drives every branch without pi. */
export interface RouterDeps {
	/** Current role phase, implemented by `createRoutingPhase()`. */
	phase: { current(): string };
	/** Effective settings, read per request and never cached. */
	readSettings: () => RoutingSettings;
	guard: NotificationGuard;
}

/** The route function registered for `spirits/auto`. */
export function createRoutingRoute(deps: RouterDeps): (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute {
	return (request, ctx) => {
		const settings = deps.readSettings();
		const lookup: ModelLookup = ctx.modelRegistry;

		// A strong phase with no configured target falls back in silence; only a configured target
		// that cannot be used is worth a notice.
		if (deps.phase.current() === MODEL_ROLE_STRONG && settings.strong) {
			const strong = resolveStrongTarget({ lookup, spec: settings.strong, defaultProvider: settings.defaultProvider });
			if (strong) return { model: strong, thinkingLevel: request.thinkingLevel, role: MODEL_ROLE_STRONG };
			if (deps.guard.shouldSend(NOTIFY_KEY_STRONG_UNUSABLE)) {
				ctx.ui.notify(
					`strong model ${modelKey(settings.strong)} is unavailable; running ${MODEL_ROLE_NORMAL}`,
					"warning",
				);
			}
		}

		const normal = resolveNormalTarget({
			lookup,
			defaultProvider: settings.defaultProvider,
			defaultModelId: settings.defaultModelId,
			previous: request.previous,
		});
		if (!normal) {
			throw new Error(
				`${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID} has no normal model: set defaultProvider and defaultModel in settings`,
			);
		}
		if (normal.viaPrevious && deps.guard.shouldSend(NOTIFY_KEY_PREVIOUS_FALLBACK)) {
			ctx.ui.notify(
				`default model is unavailable; continuing with ${modelKey({ ...normal.model, modelId: normal.model.id })}`,
				"warning",
			);
		}
		return { model: normal.model, thinkingLevel: request.thinkingLevel, role: MODEL_ROLE_NORMAL };
	};
}
