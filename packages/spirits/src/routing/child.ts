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

import type { ExtensionToolContext, PiModel } from "@earendil-works/pi-coding-agent";
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
import { type ModelLookup, modelKey, resolveNormalTarget, resolveStrongTarget } from "./resolve.ts";

/** What the resolution reads per child: the phase and the settings, both read at the child's start. */
export interface ChildModelDeps {
	/** Role phase of the parent session. Only `current()` is read. */
	phase: Pick<RoutingPhase, "current">;
	/** Effective settings, read per child and never cached. */
	readSettings: () => RoutingSettings;
}

/** Catalog view the resolution needs. `ctx.modelRegistry` satisfies it. */
type ChildModelLookup = ModelLookup & Pick<ExtensionToolContext["modelRegistry"], "find">;

/** Latest successful response, or why it cannot be the child's model. */
interface PreviousModel {
	model?: PiModel;
	/** Why there is nothing usable, for the resolution error. Empty when `model` is set. */
	reason: string;
}

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
): (parentModel: PiModel, ctx: ExtensionToolContext) => PiModel {
	return (parentModel, ctx) => {
		if (parentModel.api !== PI_VIRTUAL_MODEL_API) return parentModel;
		if (parentModel.provider !== ROUTING_PROVIDER_ID || parentModel.id !== ROUTING_MODEL_ID) {
			throw new Error(
				`${modelKey(parentModel)} is a virtual model spirits does not route, so it cannot start a child session: select ${ROUTING_PROVIDER_ID}${MODEL_SPEC_SEPARATOR}${ROUTING_MODEL_ID} or a physical model`,
			);
		}

		const settings = deps.readSettings();
		const lookup = ctx.modelRegistry as ChildModelLookup;
		const tried: string[] = [];
		const missing: string[] = [];

		// A strong phase that cannot reach its target falls back in silence: the notice the route
		// sends belongs to a request, and the child's target is not the user's selection.
		if (deps.phase.current() === MODEL_ROLE_STRONG) {
			tried.push(MODEL_ROLE_STRONG);
			if (!settings.strong) {
				missing.push(`${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STRONG_MODEL} is not set`);
			} else {
				const strong = resolveStrongTarget({
					lookup,
					spec: settings.strong,
					defaultProvider: settings.defaultProvider,
				});
				if (strong) return strong;
				missing.push(`${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STRONG_MODEL} ${modelKey(settings.strong)} is unusable`);
			}
		}

		tried.push(MODEL_ROLE_NORMAL);
		const previous = latestSuccessfulModel(ctx, lookup);
		const normal = resolveNormalTarget({
			lookup,
			defaultProvider: settings.defaultProvider,
			defaultModelId: settings.defaultModelId,
			...(previous.model ? { previous: { model: previous.model } } : {}),
		});
		if (normal) return normal.model;

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

/**
 * The physical model of the latest successful response, the way pi derives a route request's
 * `previous`: the last assistant message that did not end in `error` or `aborted`, mapped through
 * the catalog, and dropped when it names a virtual entry. pi checks the target's credentials after
 * the route; the child path has no such step, so the check happens here instead (design Decision 3).
 *
 * The scan stops at that one message. An older successful response is not pi's `previous`, and
 * reaching back for it would invent a rule the router does not have.
 */
function latestSuccessfulModel(ctx: ExtensionToolContext, lookup: ChildModelLookup): PreviousModel {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		// A failed or aborted response is not a success: pi keeps walking back past it, and so does this.
		if (entry.message.stopReason === "error" || entry.message.stopReason === "aborted") continue;
		const provider = entry.message.provider ?? "";
		const modelId = entry.message.model ?? "";
		const found = lookup.find(provider, modelId);
		if (found === undefined || found.api === PI_VIRTUAL_MODEL_API) {
			return {
				reason: `the latest response model ${provider}${MODEL_SPEC_SEPARATOR}${modelId} is not a physical model in the catalog`,
			};
		}
		if (!lookup.hasConfiguredAuth(found)) {
			return { reason: `the latest response model ${modelKey(found)} has no credentials` };
		}
		return { model: found, reason: "" };
	}
	return { reason: "the session has no successful response" };
}
