/**
 * Registration, phase, and routing seen together: the route definition the extension registered is
 * driven through input, request, settle, request, the way one skill run goes.
 */

import { expect, test } from "bun:test";
import type { ModelRoute } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { fakeModel } from "./host/fake-pi.ts";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	ROLE_STATUS_KEY,
	SKILL_COMMAND_PREFIX,
} from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { createRoleBadge } from "../src/commands/role.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { registerReportedRouting } from "./routing/fake-pi.ts";
import { fakeCatalog, FakePi, makeInputEvent, makeRequest, makeSettledEvent } from "./routing/fake-pi.ts";

const SONNET: PiModel = fakeModel("anthropic", "claude-sonnet-4-5");
const OPUS: PiModel = fakeModel("anthropic", "claude-opus-4-7");

function harness() {
	const pi = new FakePi();
	// The skills these runs start with, as pi would report them.
	pi.slashCommands = [
		{ name: "skill:sprt-opsx-verify-deep", source: "skill" },
		{ name: "skill:sprt-opsx-review-change", source: "skill" },
	];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	// The two layers `src/index.ts` joins, so a test can lock the role the way `/spirits-role <role>`
	// does without writing a settings file.
	const badge = createRoleBadge();
	const routing = registerReportedRouting(pi, { onRole: (role, ctx) => badge.update(role, ctx) });
	registerManagedCommands(pi, { phase: routing.phase, badge, lastRequest: () => undefined, patchSettings: () => {} });
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });
	const decision = () => {
		const route = pi.route()(makeRequest(), ctx) as { model: PiModel };
		return `${routing.lastRole()}:${route.model.id}`;
	};
	return { pi, ctx, notices, decision, lock: routing.phase.setRole };
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

// spec "managed-commands / role badge は拡張の status 行に出す": strong で走ったあとは strong を出す。The
// badge is drawn by the route, on the role that answered, so a strong request is what puts `[strong]` on
// the status line — not the lock the session happens to hold.
test("the badge shows the role that answered the request", async () => {
	const pi = new FakePi();
	pi.slashCommands = [{ name: "skill:sprt-opsx-verify-deep", source: "skill" }];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	spiritsExtension(pi);
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });

	expect(statuses.get(ROLE_STATUS_KEY)).toBeUndefined();

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: OPUS });
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
});

// spec "dual-model-routing / strong フェーズからの復帰": ロックしたロールへ戻る
test("keeps the locked role across a target skill run", async () => {
	const { pi, ctx, decision, lock } = harness();
	lock(MODEL_ROLE_STRONG);

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`), ctx);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	// Settle returns to the lock, not to normal.
	decisions.push(decision());

	expect(decisions).toEqual([
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
	]);
});

// spec "dual-model-routing / /model によるロールのロック": run の実行中に指定したロールは直ちに効く
test("applies a role locked during a target skill run to the rest of that run", async () => {
	const { pi, ctx, notices, decision, lock } = harness();

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`), ctx);
	const decisions = [decision()];
	// `/spirits-role normal` while the run is in flight: the lock and the role of the run change together
	// (design Decision 2).
	lock(MODEL_ROLE_NORMAL);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"strong:claude-opus-4-7",
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});

// spec "dual-model-routing / strong フェーズの開始": ロック中の入力はロックを解除しない
test("keeps the locked role across a plain input run", async () => {
	const { pi, ctx, decision, lock } = harness();
	lock(MODEL_ROLE_STRONG);

	await pi.fire("input", makeInputEvent("check the footer badge"), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// `/spirits-role normal` is the way out.
	lock(MODEL_ROLE_NORMAL);
	expect(decision()).toBe("normal:claude-sonnet-4-5");
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
