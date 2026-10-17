/**
 * Pins the upstream facts spirits' routing reads but does not own: pi lists a registered virtual model
 * under the `pi-virtual` api and exports no `isVirtualModel` helper outside its package, and pi builds
 * the entry's thinking level map by walking its own level list (design Decision 2 of
 * add-dual-model-routing).
 *
 * If a test here fails, pi renamed the marker or changed its list, and `PI_VIRTUAL_MODEL_API` or
 * `ALL_THINKING_LEVELS` has to follow it.
 */

import { expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ALL_THINKING_LEVELS } from "../../src/routing/register.ts";

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

/**
 * Pins the thinking level list `spirits/auto` declares against the list pi knows. pi builds the
 * catalog entry's level map by walking its own list, so the map's keys are pi's list: a level pi adds
 * shows up as a key spirits never declared, and one pi stops offering would be mapped to `null`, which
 * pi hides from the level selector.
 */
test("offers every pi thinking level on spirits/auto", async () => {
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
		thinkingLevels: ALL_THINKING_LEVELS,
		route: () => {
			throw new Error("the pin test never routes");
		},
	});

	const entry = (await runtime.getAvailable()).find(
		(model) => model.provider === ROUTING_PROVIDER && model.id === ROUTING_MODEL,
	);
	const levelMap = entry?.thinkingLevelMap ?? {};

	expect(Object.keys(levelMap)).toEqual([...ALL_THINKING_LEVELS]);
	expect(Object.entries(levelMap).filter(([, level]) => level === null)).toEqual([]);
});
