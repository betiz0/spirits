/**
 * Registration, phase, and routing seen together: the route definition the extension registered is
 * driven through input, request, settle, request, the way one skill run goes.
 */

import { expect, test } from "bun:test";
import type { ModelRoute, PiModel } from "@earendil-works/pi-coding-agent";
import { SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { fakeCatalog, FakePi, makeInputEvent, makeRequest, makeSettledEvent } from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };

function harness() {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	spiritsExtension(pi);
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });
	const decision = () => {
		const route = pi.route()(makeRequest(), ctx) as ModelRoute;
		return `${route.role}:${route.model.id}`;
	};
	return { pi, ctx, notices, decision };
}

test("runs normal, then strong during the skill, then normal after settle", async () => {
	const { pi, ctx, notices, decision } = harness();

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	// Every request of the run, including the tool continuations, stays strong.
	decisions.push(decision(), decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"normal:claude-sonnet-4-5",
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});

test("keeps normal across a non-target skill run", async () => {
	const { pi, ctx, notices, decision } = harness();

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-architecture-guards`), ctx);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});
