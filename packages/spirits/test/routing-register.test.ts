import { expect, test } from "bun:test";
import type { PiModel, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { ROUTING_MODEL_ID, ROUTING_PROVIDER_ID } from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { fakeCatalog, FakePi, makeRequest } from "./routing/fake-pi.ts";

/** All pi thinking levels: the router passes the selection through and pi clamps it. */
const ALL_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };

test("registers spirits/auto with every thinking level and no declared limits", () => {
	const pi = new FakePi();

	registerDualModelRouting(pi);

	expect(pi.registrations.length).toBe(1);
	const model = pi.registrations.at(0)!;
	expect({ provider: model.provider, id: model.id, name: model.name }).toEqual({
		provider: ROUTING_PROVIDER_ID,
		id: ROUTING_MODEL_ID,
		name: "Auto",
	});
	expect(model.thinkingLevels).toEqual(ALL_LEVELS);
	// Limits stay undeclared: normal and strong have different ones, and pi uses the routed model's.
	expect(model.contextWindow).toBeUndefined();
	expect(model.maxTokens).toBeUndefined();
});

test("routes through the registered model after a reload", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };

	// `/reload` loads the extension into the same pi again, replacing the registration.
	spiritsExtension(pi);
	spiritsExtension(pi);

	const registrations = pi.registrations.map((model) => `${model.provider}/${model.id}`);
	expect(registrations).toEqual([`${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID}`, `${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID}`]);

	const { ctx } = fakeCatalog({ available: [SONNET], authedProviders: ["anthropic"] });
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET, role: "normal" });
});
