import { expect, test } from "bun:test";
import type { ModelRoute, PiModel } from "@earendil-works/pi-coding-agent";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, fakeCatalog, FakePi, makeRequest } from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };

function withoutRoleApi(): FakePi {
	const pi = new FakePi();
	Object.defineProperty(pi, "registerModelRoles", { value: undefined, configurable: true });
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	return pi;
}

test("loads without the role API", () => {
	const pi = withoutRoleApi();
	const result = registerDualModelRouting(pi);
	expect(result.roleApi).toBe(false);
	expect(pi.registrations).toHaveLength(1);
	expect(pi.modelRoles).toBeUndefined();
});

test("keeps skill-driven strong phase", async () => {
	const pi = withoutRoleApi();
	registerDualModelRouting(pi);
	const { ctx } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });
	const input = pi.handlers.get("input")![0]!;
	await input({ type: "input", text: "/skill:sprt-opsx-review-change", source: "interactive" }, ctx);
	const route = pi.route()(makeRequest(), ctx) as ModelRoute;
	expect(route.model.id).toBe(OPUS.id);
});

test("reports the degraded role surface once", async () => {
	const pi = withoutRoleApi();
	registerDualModelRouting(pi);
	const { ctx, notices } = fakeCatalog({ available: [SONNET], authedProviders: ["anthropic"] });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, ctx);
	expect(notices).toHaveLength(1);
	expect(notices[0]).toContain("no role API");
	expect(notices[0]).toContain("/model role");
	expect(pi.entries).toEqual([]);
});
