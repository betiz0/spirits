/**
 * The model an `rlm` child session gets, decided on the parent's side.
 *
 * A child session loads no extensions, so it cannot route a virtual selection: the parent has to
 * hand it a physical model. The decision reuses the router's own parts — the same role phase, the
 * same {@link resolveStrongTarget} / {@link resolveNormalTarget}, and the same credentials check pi
 * performs after a route — and adds no new rule (spec `dual-model-routing` / 振り分け用のモデルを選ぶ親の子セッション).
 *
 * Deciding here is also what makes a failure readable: the cell gets a routing error that names the
 * roles it tried and the settings that are missing, instead of a provider error raised inside a
 * child session that never had a chance to route.
 */

import type { ExtensionModelRegistry, ExtensionToolContext, PiModel, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	MODEL_SPEC_SEPARATOR,
	PI_VIRTUAL_MODEL_API,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_STRONG_MODEL,
} from "../constants.ts";
import type { RoutingSettings } from "../config.ts";
import type { RoutingPhase } from "./phase.ts";
import { resolveRequestPlan } from "./plan.ts";
import { latestSuccessfulModel, type ModelLookup, modelKey } from "./resolve.ts";

/**
 * What the child session gets: the physical model, and the thinking level to run it with.
 *
 * This mirrors `ChildTarget` in `rlm/hostfn.ts`, which is the sibling layer that consumes the resolver.
 * The two layers cannot import each other, so the entry point is what joins them, and the shapes stay
 * compatible by being written the same way.
 */
export interface ChildTarget {
	model: PiModel;
	/** Absent means the child keeps the session's own selection. */
	thinkingLevel?: ThinkingLevel;
}

/** What the resolution reads per child: the phase and the settings, both read at the child's start. */
export interface ChildModelDeps {
	/** Role phase of the parent session: the step it runs and the role that step settled on. */
	phase: Pick<RoutingPhase, "current" | "step">;
	/** Effective settings, read per child and never cached. */
	readSettings: () => RoutingSettings;
}

/** Catalog view the resolution needs. `ctx.modelRegistry` satisfies it. */
type ChildModelLookup = ModelLookup & Pick<ExtensionToolContext["modelRegistry"], "find">;

/**
 * Build the child-model resolver the entry layer injects into `rlm`.
 *
 * A physical parent selection passes through untouched. `spirits/auto` is resolved with the router's
 * targets: the strong target while the phase is strong and the target is usable, the normal target
 * otherwise. A virtual model spirits does not route, and an `spirits/auto` with no usable target,
 * throw without starting a child.
 */
export function createChildModelResolver(
	deps: ChildModelDeps,
): (parentModel: PiModel, ctx: ExtensionToolContext) => ChildTarget {
	return (parentModel, ctx) => {
		// A physical parent selection passes through with no thinking level of its own, so the child
		// keeps the session's level: spirits changes nothing about a session it does not route.
		if (parentModel.api !== PI_VIRTUAL_MODEL_API) return { model: parentModel };
		if (parentModel.provider !== ROUTING_PROVIDER_ID || parentModel.id !== ROUTING_MODEL_ID) {
			throw new Error(
				`${modelKey(parentModel)} is a virtual model spirits does not route, so it cannot start a child session: select ${ROUTING_PROVIDER_ID}${MODEL_SPEC_SEPARATOR}${ROUTING_MODEL_ID} or a physical model`,
			);
		}

		const settings = deps.readSettings();
		const lookup = ctx.modelRegistry as ChildModelLookup;
		const step = deps.phase.step();
		// The same resolution the route uses, so the child cannot run a model or a level the parent's
		// request would not (design Decision 15). The level the parent's session selected is the last
		// candidate for the child too.
		const previous = latestSuccessfulModel(ctx.sessionManager.getBranch(), lookup as ExtensionModelRegistry);
		const plan = resolveRequestPlan({
			...(step ? { step } : {}),
			settings,
			phaseRole: deps.phase.current(),
			lookup,
			...(ctx.thinkingLevel ? { sessionThinkingLevel: ctx.thinkingLevel } : {}),
			...(previous.model ? { previous: { model: previous.model } } : {}),
		});

		// A strong phase that cannot reach its target falls back in silence: the notice the route sends
		// belongs to a request, and the child's target is not the user's selection.
		if (plan.model) return { model: plan.model, thinkingLevel: plan.thinkingLevel };

		const tried: string[] = [];
		const missing: string[] = [];
		if (plan.role === MODEL_ROLE_STRONG) {
			tried.push(MODEL_ROLE_STRONG);
			if (!settings.strong) {
				missing.push(`${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STRONG_MODEL} is not set`);
			} else {
				missing.push(`${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STRONG_MODEL} ${modelKey(settings.strong)} is unusable`);
			}
		}

		tried.push(MODEL_ROLE_NORMAL);
		if (settings.defaultProvider && settings.defaultModelId) {
			missing.push(
				`the default model ${settings.defaultProvider}${MODEL_SPEC_SEPARATOR}${settings.defaultModelId} is not available`,
			);
		} else {
			missing.push(
				`${SETTINGS_KEY_DEFAULT_PROVIDER} and ${SETTINGS_KEY_DEFAULT_MODEL} are not set`,
			);
		}
		missing.push(previous.reason);
		throw new Error(
			`${ROUTING_PROVIDER_ID}${MODEL_SPEC_SEPARATOR}${ROUTING_MODEL_ID} has no child model: tried ${tried.join(", ")}; ${missing.join("; ")}`,
		);
	};
}

