/**
 * Target resolution for the two roles.
 *
 * Both resolvers take the catalog, the settings defaults, and the request as inputs, so a test can
 * drive every branch without a pi session. `ExtensionContext.modelRegistry` satisfies
 * {@link ModelLookup} at runtime.
 */

import type { ExtensionModelRegistry, PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODEL_SPEC_SEPARATOR, PI_VIRTUAL_MODEL_API } from "../constants.ts";
import type { ModelSpec } from "../config.ts";

/** Catalog view a resolver needs. `ctx.modelRegistry` satisfies it. */
export type ModelLookup = Pick<ExtensionModelRegistry, "getAvailable" | "hasConfiguredAuth">;

/** How a normal target was reached: the setting, pi's default model, or the last successful model. */
export type NormalSource = "spec" | "default" | "previous";

/** Normal target plus how it was reached. */
export interface NormalTarget {
	model: PiModel;
	source: NormalSource;
	/**
	 * True when `models.normal` named a model that could not be used, so the target came from further
	 * down the list. This is the fact worth a notice; landing on pi's default with nothing configured
	 * is not (design Decision 4).
	 */
	fellFromSpec: boolean;
}

/** Model key `provider/id`, or the bare model id. Takes a catalog model or a settings spec. */
export function modelKey(model: { provider?: string; id?: string; modelId?: string }): string {
	const id = model.id ?? model.modelId ?? "";
	return model.provider ? `${model.provider}${MODEL_SPEC_SEPARATOR}${id}` : id;
}

/**
 * A virtual entry routes requests instead of answering them, so it can never be a role target: a
 * route to `spirits/auto` itself fails in `resolveModel`. pi lists virtual models in `getAvailable()`
 * because their provider needs no credentials, so every lookup has to filter them out.
 */
function isVirtual(model: PiModel): boolean {
	return model.api === PI_VIRTUAL_MODEL_API;
}

function findModel(models: readonly PiModel[], provider: string, modelId: string): PiModel | undefined {
	return models.find((model) => !isVirtual(model) && model.provider === provider && model.id === modelId);
}

/** The catalog model a spec names: `provider/id`, or the bare id against the default provider. */
function findSpecModel(lookup: ModelLookup, spec: ModelSpec, defaultProvider?: string): PiModel | undefined {
	const provider = spec.provider ?? defaultProvider;
	if (!provider) return undefined;
	return findModel(lookup.getAvailable(), provider, spec.modelId);
}

/**
 * Resolve the normal target: the `models.normal` setting, else pi's default provider and model id,
 * else the physical model of the latest successful response, else unresolved.
 *
 * A setting that names a model pi cannot answer with — absent from the catalog, a virtual entry, or a
 * provider with no credentials — is unusable rather than absent, so the resolution keeps walking down
 * the list and reports where it landed. The caller decides which landings are worth a notice; the
 * source is the whole signal for that, and no resolution notifies here.
 *
 * A default that names a virtual model, including `spirits/auto` itself, counts as unresolvable
 * (design Decision 2).
 */
export function resolveNormalTarget(options: {
	lookup: ModelLookup;
	/** The `models.normal` setting. Absent means pi's default model fills the role. */
	spec?: ModelSpec;
	defaultProvider?: string;
	defaultModelId?: string;
	previous?: { model: PiModel };
}): NormalTarget | undefined {
	const { lookup, spec, defaultProvider, defaultModelId, previous } = options;
	const fellFromSpec = spec !== undefined;
	if (spec) {
		const configured = findSpecModel(lookup, spec, defaultProvider);
		if (configured && lookup.hasConfiguredAuth(configured)) return { model: configured, source: "spec", fellFromSpec: false };
	}
	if (defaultProvider && defaultModelId) {
		const model = findModel(lookup.getAvailable(), defaultProvider, defaultModelId);
		if (model) return { model, source: "default", fellFromSpec };
	}
	// `previous` is the model of a successful response, which pi guarantees physical: a failed route
	// leaves the virtual model on an error response, and only successful responses reach `previous`.
	if (previous) return { model: previous.model, source: "previous", fellFromSpec };
	return undefined;
}

/** Latest successful response, or why there is none to use. */
export interface PreviousModel {
	model?: PiModel;
	/** Why there is nothing usable, for a report or an error. Empty when `model` is set. */
	reason: string;
}

/**
 * The physical model of the latest successful response, the way pi derives a route request's
 * `previous`: the last assistant message that did not end in `error` or `aborted`, mapped through the
 * catalog, and dropped when it names a virtual entry.
 *
 * The scan stops at that one message. An older successful response is not pi's `previous`, and
 * reaching back for it would invent a rule the router does not have. Both the `rlm` child resolution
 * and the command surface read it, so the rule lives once.
 */
export function latestSuccessfulModel(branch: readonly SessionEntry[], lookup: ExtensionModelRegistry): PreviousModel {
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

/**
 * Resolve the strong target from the settings spec: an exact `provider/id` match in the catalog, or
 * a bare model id against the default provider. Unresolved when the catalog has no such model, when
 * it is a virtual model, or when its provider has no credentials (design Decision 1).
 */
export function resolveStrongTarget(options: {
	lookup: ModelLookup;
	spec: ModelSpec;
	defaultProvider?: string;
}): PiModel | undefined {
	const model = findSpecModel(options.lookup, options.spec, options.defaultProvider);
	if (!model) return undefined;
	return options.lookup.hasConfiguredAuth(model) ? model : undefined;
}
