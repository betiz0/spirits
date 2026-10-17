/**
 * Pins the upstream marker spirits relies on to keep virtual models out of its routing targets: pi
 * lists a registered virtual model under the `pi-virtual` api and does not export `isVirtualModel`
 * outside its package (design Decision 2 of add-dual-model-routing).
 *
 * If this test fails, pi renamed the marker and `PI_VIRTUAL_MODEL_API` has to follow it, or spirits
 * needs another way to recognize a virtual catalog entry.
 */

import { expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** The pinned upstream value. A literal on purpose: this test pins pi, not spirits' own constant. */
const PINNED_VIRTUAL_MODEL_API = "pi-virtual";

const ROUTING_PROVIDER = "spirits";
const ROUTING_MODEL = "auto";

/** Credential store without entries, so the run never reads the operator's credential file. */
const credentials = {
	read: async () => undefined,
	list: async () => [],
	modify: async () => undefined,
	delete: async () => {},
};

/** Catalog cache without entries, so no stored model catalog reaches the assertion. */
const modelsStore = {
	read: async () => undefined,
	write: async () => {},
	delete: async () => {},
};

test("marks a registered virtual model with the pi-virtual api", async () => {
	const runtime = await ModelRuntime.create({
		credentials,
		modelsStore,
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerVirtualModel({
		provider: ROUTING_PROVIDER,
		id: ROUTING_MODEL,
		name: "Auto",
		route: () => {
			throw new Error("the pin test never routes");
		},
	});

	const available = await runtime.getAvailable();
	const entry = available.find((model) => model.provider === ROUTING_PROVIDER && model.id === ROUTING_MODEL);

	// A provider of virtual models only is available without credentials, so spirits has to filter by
	// the api rather than assume `getAvailable()` returns physical models.
	expect(entry).toBeDefined();
	expect(entry?.api).toBe(PINNED_VIRTUAL_MODEL_API);
});
