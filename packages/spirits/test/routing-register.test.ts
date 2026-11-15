import { expect, test } from "bun:test";
import type { ModelRoute, PiModel, SessionEntry, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	ROLE_STATUS_KEY,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
	STEP_ENTRY_TYPE,
} from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import {
	AUTO_SELECTION,
	fakeCatalog,
	FakePi,
	makeCustomEntry,
	makeInputEvent,
	makeMessageEntry,
	makeRequest,
	makeSettledEvent,
	registerReportedRouting,
} from "./routing/fake-pi.ts";

/** All pi thinking levels: the router passes the selection through and pi clamps it. */
const ALL_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };

/** Settings with a strong target and, when given, a default role, as the settings file holds them. */
function routingSettings(defaultRole?: string): Record<string, unknown> {
	return {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7", ...(defaultRole ? { role: defaultRole } : {}) },
	};
}

/** The registered routing, on a session that selected `spirits/auto` unless told otherwise. */
function harness(options: { defaultRole?: string; model?: PiModel; branch?: readonly SessionEntry[] } = {}) {
	const pi = new FakePi();
	pi.settings = routingSettings(options.defaultRole);
	const routing = registerReportedRouting(pi);
	const { ctx, notices } = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: options.model ?? AUTO_SELECTION,
		branch: options.branch,
	});
	return {
		pi,
		ctx,
		notices,
		phase: routing.phase,
		/** `"<role>:<routed model id>"` for one request, the way the footer and the router see it. */
		decision: () => {
			const route = pi.route()(makeRequest(), ctx) as { model: PiModel };
			return `${routing.lastRole()}:${route.model.id}`;
		},
		start: (reason: string) => pi.fire("session_start", { type: "session_start", reason }, ctx),
	};
}

test("registers spirits/auto with every thinking level and no declared limits", () => {
	const pi = new FakePi();

	const routing = registerDualModelRouting(pi);

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
	// Registration writes nothing into the session and asks the host for no role vocabulary: the only
	// entries the routing touches are the ones it appends itself.
	expect(pi.entries).toEqual([]);
	expect(Object.keys(routing)).toEqual(["phase"]);
});

test("routes through the registered model after a reload", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };

	// `/reload` loads the extension into the same pi again, replacing the registration.
	spiritsExtension(pi);
	spiritsExtension(pi);

	const registrations = pi.registrations.map((model) => `${model.provider}/${model.id}`);
	expect(registrations).toEqual([`${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID}`, `${ROUTING_PROVIDER_ID}/${ROUTING_MODEL_ID}`]);

	const { ctx, statuses } = fakeCatalog({ available: [SONNET], authedProviders: ["anthropic"] });
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
	// The role the replaced routing answered with reaches the user the way the host shows it: the report
	// the route made went to the extension's own status line.
	expect(statuses.get(ROLE_STATUS_KEY)).toBe(`[${MODEL_ROLE_NORMAL}]`);
});

// spec "dual-model-routing / ロールの記録と復元": 既定ロールで開始する。The default role is a setting, so
// locking it writes no session record: a start never rewrites the file it opened.
test("starts on the default role and writes no record", async () => {
	const { pi, decision, start } = harness({ defaultRole: "strong" });

	await start("new");

	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// Every start reason takes the default role and leaves the file alone, whatever pi wrote before it
// fired the event. It reports `startup` both for a launch that creates a session and for one that
// opens an existing file, so a start may not write on the strength of the reason alone.
for (const reason of ["new", "startup", "resume", "reload"]) {
	test(`a ${reason} start locks the default role and writes no record`, async () => {
		const { pi, decision, start } = harness({ defaultRole: "strong", branch: [makeMessageEntry()] });

		await start(reason);

		expect(pi.entries).toEqual([]);
		expect(decision()).toBe("strong:claude-opus-4-7");
	});
}

// spec "dual-model-routing / /spirits-role によるロールのロック": 再読み込みでは既定ロールに戻る
test("returns to the default role on reload", async () => {
	const { phase, decision, start } = harness();

	await start("startup");
	phase.setRole(MODEL_ROLE_STRONG);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// An in-process lock is not saved, so the start replaces it with the unset default role.
	await start("reload");
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});

// spec "dual-model-routing / /spirits-role によるロールのロック": 分岐間の移動ではロックを維持する
test("keeps the lock across a branch move", async () => {
	const { pi, ctx, phase, decision, start } = harness();

	await start("startup");
	phase.setRole(MODEL_ROLE_STRONG);

	// pi fires `session_tree` for a branch move. The step follows the branch's record (design Decision
	// 12); the lock is the session's and is never read from the branch, so the move changes nothing here
	// and the request still asks for strong.
	await pi.fire("session_tree", { type: "session_tree", newLeafId: "leaf-b", oldLeafId: "leaf-a" }, ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// spec scenario "振り分け用のモデルの選択解除ではロックが消えない": moving to a physical model carries no
// role, so nothing here may clear a lock on the way. The session keeps asking for strong, and a session
// that comes back to the routing model is strong again.
test("keeps the lock across a physical model selection", async () => {
	const pi = new FakePi();
	pi.settings = routingSettings();
	const routing = registerDualModelRouting(pi);
	const auto = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });
	const physical = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: SONNET });
	const routed = (catalog: ReturnType<typeof fakeCatalog>) =>
		(pi.route()(makeRequest(), catalog.ctx) as ModelRoute).model.id;

	await pi.fire("session_start", { type: "session_start", reason: "startup" }, auto.ctx);
	routing.phase.setRole(MODEL_ROLE_STRONG);
	expect(routed(auto)).toBe("claude-opus-4-7");

	// The session selects a physical model, then the routing model again. The lock was never written off.
	expect(routed(physical)).toBe("claude-opus-4-7");
	expect(routed(auto)).toBe("claude-opus-4-7");
});

// spec "dual-model-routing / step の記録と分岐間の追従": the record says what runs, so a move reads the
// branch it lands on rather than keeping whatever this process happened to hold.
test("a tree move takes the step of the branch it lands on", async () => {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7", steps: { "opsx-propose": { role: "strong" } } },
	};
	const routing = registerReportedRouting(pi);
	const landed = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: AUTO_SELECTION,
		branch: [makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-propose" })],
	});

	await pi.fire("session_tree", { type: "session_tree", newLeafId: "leaf-b", oldLeafId: "leaf-a" }, landed.ctx);

	expect(routing.phase.step()?.name).toBe("opsx-propose");
	pi.route()(makeRequest(), landed.ctx);
	expect(routing.lastRole()).toBe(MODEL_ROLE_STRONG);
});

// The other half of the same rule: a branch whose newest record says the step ended, or that records
// nothing, leaves no step running. Clearing is not ending, so nothing is appended for it.
test("a tree move onto a branch with no open step ends it", async () => {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7", steps: { "opsx-propose": { role: "strong" } } },
	};
	pi.slashCommands = [{ name: "skill:openspec-propose", source: "skill" }];
	const routing = registerReportedRouting(pi);
	const running = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	await pi.fire("session_start", { type: "session_start", reason: "startup" }, running.ctx);
	await pi.fire("input", makeInputEvent("/skill:openspec-propose add-a-feature"), running.ctx);
	expect(routing.phase.step()?.name).toBe("opsx-propose");
	// The change itself is a session record, so a later start and a later move can read it back.
	expect(pi.entries).toEqual([{ customType: STEP_ENTRY_TYPE, data: { step: "opsx-propose" } }]);

	// The branch the user moves to has no open step.
	const landed = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: AUTO_SELECTION,
		branch: [makeCustomEntry(STEP_ENTRY_TYPE, { step: null })],
	});
	await pi.fire("session_tree", { type: "session_tree", newLeafId: "leaf-c", oldLeafId: "leaf-b" }, landed.ctx);

	expect(routing.phase.step()).toBeUndefined();
	pi.route()(makeRequest(), landed.ctx);
	expect(routing.lastRole()).toBe(MODEL_ROLE_NORMAL);
});

// spec scenario "振り分けの失敗では記録を更新しない": the role reaches a report only through a request that
// resolved. A route that ends in an error reports nothing, so the badge stays whatever the last
// answered request left it.
test("reports no role when the routing itself fails", () => {
	const pi = new FakePi();
	// No default provider or model, and no previous response: the normal target cannot be resolved at all.
	pi.settings = { models: { strong: "anthropic/claude-opus-4-7" } };
	const reported: string[] = [];
	registerDualModelRouting(pi, { onRole: (role) => reported.push(role) });
	const { ctx } = fakeCatalog({ available: [OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	expect(() => pi.route()(makeRequest(), ctx)).toThrow(/no normal model/);

	expect(reported).toEqual([]);
	expect(pi.entries).toEqual([]);
});

test("starts on normal and records nothing without a default role", async () => {
	const { pi, decision, start } = harness();

	await start("startup");

	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});

// A settled run closes a step that does not continue, so the next request is back on the lock.
test("a settled step stops reporting its role", async () => {
	const { pi, ctx, phase, decision } = harness();
	pi.slashCommands = [{ name: "skill:sprt-opsx-verify-deep", source: "skill" }];

	await pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep remove-pi-fork"), ctx);
	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");
	expect(decision()).toBe("strong:claude-opus-4-7");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);

	expect(phase.step()).toBeUndefined();
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});
