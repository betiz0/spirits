/**
 * Target resolution for the two roles.
 *
 * Both resolvers take the catalog, the settings defaults, and the request as inputs, so a test can
 * drive every branch without a pi session. `ExtensionContext.modelRegistry` satisfies
 * {@link ModelLookup} at runtime.
 */

import type { ExtensionModelRegistry, PiModel } from "@earendil-works/pi-coding-agent";
import { MODEL_SPEC_SEPARATOR, PI_VIRTUAL_MODEL_API } from "../constants.ts";
import type { StrongModelSpec } from "../config.ts";

/** Catalog view a resolver needs. `ctx.modelRegistry` satisfies it. */
export type ModelLookup = Pick<ExtensionModelRegistry, "getAvailable" | "hasConfiguredAuth">;

/** Normal target plus how it was reached. */
export interface NormalTarget {
	model: PiModel;
	/** True when the settings default was unusable and the previous response's model took over. */
	viaPrevious: boolean;
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

/**
 * Resolve the normal target: the settings default provider and model id, else the physical model of
 * the latest successful response, else unresolved. A default that names a virtual model, including
 * `spirits/auto` itself, counts as unresolvable (design Decision 2).
 */
export function resolveNormalTarget(options: {
	lookup: ModelLookup;
	defaultProvider?: string;
	defaultModelId?: string;
	previous?: { model: PiModel };
}): NormalTarget | undefined {
	const { lookup, defaultProvider, defaultModelId, previous } = options;
	if (defaultProvider && defaultModelId) {
		const model = findModel(lookup.getAvailable(), defaultProvider, defaultModelId);
		if (model) return { model, viaPrevious: false };
	}
	// `previous` is the model of a successful response, which pi guarantees physical: a failed route
	// leaves the virtual model on an error response, and only successful responses reach `previous`.
	if (previous) return { model: previous.model, viaPrevious: true };
	return undefined;
}

/**
 * Resolve the strong target from the settings spec: an exact `provider/id` match in the catalog, or
 * a bare model id against the default provider. Unresolved when the catalog has no such model, when
 * it is a virtual model, or when its provider has no credentials (design Decision 1).
 */
export function resolveStrongTarget(options: {
	lookup: ModelLookup;
	spec: StrongModelSpec;
	defaultProvider?: string;
}): PiModel | undefined {
	const provider = options.spec.provider ?? options.defaultProvider;
	if (!provider) return undefined;
	const model = findModel(options.lookup.getAvailable(), provider, options.spec.modelId);
	if (!model) return undefined;
	return options.lookup.hasConfiguredAuth(model) ? model : undefined;
}
