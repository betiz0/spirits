/**
 * Registration, phase, and routing seen together: the route definition the extension registered is
 * driven through input, request, settle, request, the way one skill run goes.
 */

import { expect, test } from "bun:test";
import type { ModelRoute, PiModel } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
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

// spec "dual-model-routing / strong フェーズからの復帰": ロックしたロールへ戻る
test("keeps the locked role across a target skill run", async () => {
	const { pi, ctx, decision } = harness();
	pi.modelRoles?.onSelect(MODEL_ROLE_STRONG, ctx);

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
	const { pi, ctx, notices, decision } = harness();

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`), ctx);
	const decisions = [decision()];
	// `/model spirits/auto normal` while the run is in flight: pi calls back after it applied the model,
	// so the lock and the role of the run change together (design Decision 2).
	pi.modelRoles?.onSelect(MODEL_ROLE_NORMAL, ctx);
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
	const { pi, ctx, decision } = harness();
	pi.modelRoles?.onSelect(MODEL_ROLE_STRONG, ctx);

	await pi.fire("input", makeInputEvent("check the footer badge"), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// `/model <model> normal` is the way out.
	pi.modelRoles?.onSelect(MODEL_ROLE_NORMAL, ctx);
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
