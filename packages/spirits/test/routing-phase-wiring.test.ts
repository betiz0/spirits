import type { PiModel } from "../src/types/host.ts";
import { asExtensionApi, fakeModel, slashCommandInfo } from "./host/fake-pi.ts";
import { expect, test } from "bun:test";

import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import { fakeCatalog, FakePi, makeInputEvent, makeRequest, makeSettledEvent, registerReportedRouting } from "./routing/fake-pi.ts";

const SONNET: PiModel = fakeModel("anthropic", "claude-sonnet-4-5");
const OPUS: PiModel = fakeModel("anthropic", "claude-opus-4-7");

/** `spirits/auto` wired to a fake pi, with both roles resolvable. */
function wire() {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	// The session has the deep-verify skill, which is the starter of the step these cases drive.
	pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
	// The role a request takes is a report the route makes, not a key of the result the host reads
	// (spec `dual-model-routing` / ModelRoute の role は使わない), so the wire reads it off the report.
	const routing = registerReportedRouting(asExtensionApi(pi));
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });
	return {
		pi,
		ctx,
		notices,
		/** The phase itself, for a check that must not resolve a request. */
		phase: routing.phase,
		/** Role the next request would take, read through the registered route. */
		role: () => {
			pi.route()(makeRequest(), ctx);
			return routing.lastRole();
		},
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

// spec "dual-model-routing / strong フェーズの開始": SKILL の読み取りだけでは遷移しない
test("reading a skill file without input changes no phase", async () => {
	// A model that opens a SKILL.md on its own produces no `input` event. With no phase decided, the
	// request takes the lock rather than the skill it just read.
	const { pi, ctx, role, phase } = wire();
	expect(role()).toBe(MODEL_ROLE_NORMAL);
	expect(phase.step()).toBeUndefined();

	// With a step decided by its starter, the phase holds across input-less requests: the run reads the
	// rest of its skill, and two route calls with no input between them take the same role.
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");
	expect(role()).toBe(MODEL_ROLE_STRONG);
	expect(role()).toBe(MODEL_ROLE_STRONG);
});

// spec "dual-model-routing / strong フェーズの開始": 始まらなかったスキル実行を持ち越さない
test("does not carry a strong phase into the next run when the skill run never started", async () => {
	const { pi, ctx, role, phase } = wire();
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	// The precondition, read off the phase rather than the route: calling `role()` here would resolve a
	// request and mark the step as having earned its keep, which is the very thing under test.
	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");

	// No request resolved and no `agent_settled` ever fired: the run never started. The next idle input
	// starts a run of its own, and the step that never reached a model is over before it is read.
	await pi.fire("input", makeInputEvent("a plain prompt instead"), ctx);

	expect(phase.step()).toBeUndefined();
	expect(role()).toBe(MODEL_ROLE_NORMAL);
});
