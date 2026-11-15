/**
 * The routing on the host it actually runs on: an official Pi, which offers the virtual model and the
 * events and no role vocabulary of its own. The role, the step, and their records are the bundle's.
 */
import { expect, test } from "bun:test";
import type { ModelRoute } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { asExtensionApi, fakeModel, slashCommandInfo } from "./host/fake-pi.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, fakeCatalog, FakePi, makeRequest } from "./routing/fake-pi.ts";

const SONNET: PiModel = fakeModel("anthropic", "claude-sonnet-4-5");
const OPUS: PiModel = fakeModel("anthropic", "claude-opus-4-7");

function host(): FakePi {
	const pi = new FakePi();
	// The review skill is the starter of the step the cases below drive, and a step only opens where
	// pi reports the command.
	pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-review-change", "skill")];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	return pi;
}

test("loads on the host with nothing to report", async () => {
	const pi = host();
	const routing = registerDualModelRouting(asExtensionApi(pi));
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });

	expect(Object.keys(routing)).toEqual(["phase"]);
	expect(pi.registrations).toHaveLength(1);

	await pi.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, ctx);

	// Nothing is degraded any more, so a start says nothing and writes nothing: the session file the
	// routing leaves alone is the point.
	expect(notices).toEqual([]);
	expect(pi.entries).toEqual([]);
});

test("keeps the skill-driven strong step", async () => {
	const pi = host();
	registerDualModelRouting(asExtensionApi(pi));
	const { ctx } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });
	const input = pi.handlers.get("input")![0]!;

	await input({ type: "input", text: "/skill:sprt-opsx-review-change", source: "interactive" }, ctx);

	expect((pi.route()(makeRequest(), ctx) as ModelRoute).model.id).toBe(OPUS.id);
});
