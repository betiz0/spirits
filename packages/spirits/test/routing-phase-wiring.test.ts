import { expect, test } from "bun:test";
import type { ModelRoute, PiModel } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { fakeCatalog, FakePi, makeInputEvent, makeRequest, makeSettledEvent } from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };

/** `spirits/auto` wired to a fake pi, with both roles resolvable. */
function wire() {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	registerDualModelRouting(pi);
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });
	return {
		pi,
		ctx,
		notices,
		/** Role the next request would take, read through the registered route. */
		role: () => (pi.route()(makeRequest(), ctx) as ModelRoute).role,
	};
}

test("wires input and agent_settled handlers", async () => {
	const { pi, ctx, role } = wire();
	expect(pi.handlersFor("input")).toBe(1);
	expect(pi.handlersFor("agent_settled")).toBe(1);

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(role()).toBe(MODEL_ROLE_STRONG);

	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(role()).toBe(MODEL_ROLE_NORMAL);

	// `on()` handed back an unsubscribe for both handlers, and dropping them stops the wiring.
	const removeInput = pi.unsubscribers.get("input")?.[0];
	const removeSettled = pi.unsubscribers.get("agent_settled")?.[0];
	expect(typeof removeInput).toBe("function");
	expect(typeof removeSettled).toBe("function");
	removeInput?.();
	removeSettled?.();
	expect(pi.handlersFor("input")).toBe(0);
	expect(pi.handlersFor("agent_settled")).toBe(0);
});

test("phase returns to normal when settle follows a failed input handler", async () => {
	const { pi, ctx, role } = wire();
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(role()).toBe(MODEL_ROLE_STRONG);

	// An input whose text cannot be read makes the handler throw. The failure is reported and leaves
	// the strong phase as it was; it must not block the way back to normal.
	const unreadable = {
		type: "input",
		source: "interactive",
		get text(): string {
			throw new Error("unreadable input");
		},
	};
	await pi.fire("input", unreadable, ctx);
	expect(pi.errors.length).toBe(1);
	expect(role()).toBe(MODEL_ROLE_STRONG);

	await pi.fire("agent_settled", makeSettledEvent(true), ctx);
	expect(role()).toBe(MODEL_ROLE_NORMAL);
});

// spec "dual-model-routing / strong フェーズの開始": 始まらなかったスキル実行を持ち越さない
test("does not carry a strong phase into the next run when the skill run never started", async () => {
	const { pi, ctx, role } = wire();
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(role()).toBe(MODEL_ROLE_STRONG);

	// No `agent_settled` ever fires: the run never started. The next idle input starts a run of its own.
	await pi.fire("input", makeInputEvent("/opsx-apply add-dual-model-routing"), ctx);

	expect(role()).toBe(MODEL_ROLE_NORMAL);
});
