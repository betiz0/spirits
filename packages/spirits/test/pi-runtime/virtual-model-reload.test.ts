/**
 * Pins the reload path of the routing model. pi replaces a virtual model by registering the same
 * provider and id again, and the spirits extension registers `spirits/auto` on every extension load,
 * which is what `/reload` does (design Decision 2 of add-dual-model-routing).
 *
 * If this test fails, `spirits/auto` is missing from the model list or stops routing after `/reload`,
 * and the operator has to restart spirits instead of reloading.
 */

import { expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ROUTING_MODEL_ID, ROUTING_PROVIDER_ID } from "../../src/constants.ts";
import { ALL_THINKING_LEVELS } from "../../src/routing/register.ts";

/** A physical model the router targets, registered without network access. */
const PHYSICAL_PROVIDER = "pin-physical";
const PHYSICAL_MODEL = "small";

/** Credential store without entries, so the run never reads the operator's credential file. */
const credentials = {
	read: async () => undefined,
	list: async () => [],
	modify: async () => undefined,
	delete: async () => {},
};

/** Catalog cache without entries, so no stored model catalog reaches the assertions. */
const modelsStore = { read: async () => undefined, write: async () => {}, delete: async () => {} };

/** A runtime with one physical model whose provider has credentials. */
async function createRuntime(): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials,
		modelsStore,
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider(PHYSICAL_PROVIDER, {
		apiKey: "pin-key",
		baseUrl: "http://127.0.0.1:9/pin",
		models: [
			{
				id: PHYSICAL_MODEL,
				name: "Pin Small",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
		],
	});
	await runtime.refresh({ allowNetwork: false });
	return runtime;
}

/** The registration the extension performs on every load, counting the requests its router serves. */
function registration(served: { count: number }) {
	return {
		provider: ROUTING_PROVIDER_ID,
		id: ROUTING_MODEL_ID,
		name: "Auto",
		thinkingLevels: ALL_THINKING_LEVELS,
		route: () => {
			served.count++;
			// pi reads only the provider and id of the returned model to find the catalog entry.
			return { model: { provider: PHYSICAL_PROVIDER, id: PHYSICAL_MODEL }, thinkingLevel: "high" as const };
		},
	};
}

test("keeps spirits/auto available and routable after re-registration", async () => {
	const runtime = await createRuntime();
	const served = { count: 0 };

	runtime.registerVirtualModel(registration(served));
	// The order a reload leaves behind: the previous registration goes away, then the new load registers.
	runtime.unregisterVirtualModel(ROUTING_PROVIDER_ID, ROUTING_MODEL_ID);
	runtime.registerVirtualModel(registration(served));

	const available = await runtime.getAvailable();
	const selected = available.find((model) => model.provider === ROUTING_PROVIDER_ID && model.id === ROUTING_MODEL_ID);
	expect(selected).toBeDefined();

	const resolved = await runtime.resolveModel(selected!, [], { reason: "user", thinkingLevel: "high" });

	// The router of the latest registration is the one pi dispatches through, and its target resolves.
	expect(served.count).toBe(1);
	expect(resolved.model.provider).toBe(PHYSICAL_PROVIDER);
	expect(resolved.model.id).toBe(PHYSICAL_MODEL);
});
