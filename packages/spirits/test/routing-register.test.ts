import { expect, test } from "bun:test";
import type { ModelRoute, PiModel, SessionEntry, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
	ROUTING_STATE_ENTRY_TYPE,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
} from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import {
	AUTO_SELECTION,
	fakeCatalog,
	FakePi,
	makeCustomEntry,
	makeMessageEntry,
	makeRequest,
	makeStateChangeEntry,
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
	registerDualModelRouting(pi);
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
		/** `"<role>:<routed model id>"` for one request, the way the footer and the router see it. */
		decision: () => {
			const route = pi.route()(makeRequest(), ctx) as ModelRoute;
			return `${route.role}:${route.model.id}`;
		},
		start: (reason: string) => pi.fire("session_start", { type: "session_start", reason }, ctx),
	};
}

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

// spec "dual-model-routing / ロールの記録と復元": 既定ロールで開始する
test("records the default role on a new session and starts strong", async () => {
	const { pi, decision, start } = harness({ defaultRole: "strong" });

	await start("new");

	expect(pi.entries).toEqual([
		{
			customType: ROUTING_STATE_ENTRY_TYPE,
			data: { provider: ROUTING_PROVIDER_ID, modelId: ROUTING_MODEL_ID, role: MODEL_ROLE_STRONG },
		},
	]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// 目視確認(タスク 6.4)で出た回帰: pi は session_start を撃つ前に自前の entry を書くため、
// 新しいセッションでも分岐は空ではない。reason だけでも、entry の有無だけでも判別できない。
test("records the default role on a launch that created the session", async () => {
	const { pi, decision, start } = harness({
		defaultRole: "strong",
		branch: [makeStateChangeEntry("model_change"), makeStateChangeEntry("thinking_level_change")],
	});

	await start("startup");

	expect(pi.entries).toEqual([
		{
			customType: ROUTING_STATE_ENTRY_TYPE,
			data: { provider: ROUTING_PROVIDER_ID, modelId: ROUTING_MODEL_ID, role: MODEL_ROLE_STRONG },
		},
	]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// design Decision 6: 起動で既存セッションを開いたときは追記しない
test("does not record the default role on a launch that opens an asked session", async () => {
	const { pi, decision, start } = harness({
		defaultRole: "strong",
		branch: [makeStateChangeEntry("model_change"), makeMessageEntry()],
	});

	await start("startup");

	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// spec "dual-model-routing / ロールの記録と復元": 物理モデルで開始するときは記録しない
test("locks the default role without recording it when a physical model is selected", async () => {
	const { pi, decision, start } = harness({ defaultRole: "strong", model: SONNET });

	await start("new");

	// The lock is still set, so the request of a session that switches back to `spirits/auto` is strong.
	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// spec "dual-model-routing / ロールの記録と復元": 復帰では既定ロールを記録しない
test("does not record the default role when resuming", async () => {
	const { pi, decision, start } = harness({ defaultRole: "strong", branch: [makeCustomEntry("other", {})] });

	await start("resume");

	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// spec "dual-model-routing / /model によるロールのロック": 再読み込みでは既定ロールに戻る
test("returns to the default role on reload", async () => {
	const { pi, ctx, decision, start } = harness();

	await start("startup");
	pi.modelRoles?.onSelect(MODEL_ROLE_STRONG, ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// An Enter-set lock is not saved, so the start replaces it with the unset default role.
	await start("reload");
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});

// spec "dual-model-routing / /model によるロールのロック": 分岐間の移動ではロックを維持する
test("keeps the lock across a branch move", async () => {
	const { pi, ctx, decision, start } = harness();

	await start("startup");
	pi.modelRoles?.onSelect(MODEL_ROLE_STRONG, ctx);

	// pi fires `session_tree` for a branch move. Spirits handles neither the lock nor the default role
	// there, so the branch it moves to keeps asking for the locked role.
	expect(pi.handlersFor("session_tree")).toBe(0);
	await pi.fire("session_tree", { type: "session_tree", newLeafId: "leaf-b", oldLeafId: "leaf-a" }, ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

// design Decision 6 の実装上の注意: state を引き継ぐ
test("carries the router state into the record it writes", async () => {
	const state = { lastTarget: "claude-opus-4-7" };
	const { pi, decision, start } = harness({
		defaultRole: "strong",
		branch: [
			makeCustomEntry(ROUTING_STATE_ENTRY_TYPE, {
				provider: ROUTING_PROVIDER_ID,
				modelId: ROUTING_MODEL_ID,
				state,
			}),
		],
	});

	await start("new");

	expect(pi.entries).toEqual([
		{
			customType: ROUTING_STATE_ENTRY_TYPE,
			data: { provider: ROUTING_PROVIDER_ID, modelId: ROUTING_MODEL_ID, state, role: MODEL_ROLE_STRONG },
		},
	]);
	expect(decision()).toBe("strong:claude-opus-4-7");
});

test("leaves a branch that already records a role alone", async () => {
	const { pi, start } = harness({
		defaultRole: "strong",
		branch: [
			makeCustomEntry(ROUTING_STATE_ENTRY_TYPE, {
				provider: ROUTING_PROVIDER_ID,
				modelId: ROUTING_MODEL_ID,
				role: MODEL_ROLE_NORMAL,
			}),
		],
	});

	await start("new");

	expect(pi.entries).toEqual([]);
});

test("starts on normal and records nothing without a default role", async () => {
	const { pi, decision, start } = harness();

	await start("startup");

	expect(pi.entries).toEqual([]);
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});

// design Decision 9: the vocabulary, its settings key, and the callback are all pi reads
test("registers the role vocabulary and its settings key with pi", () => {
	const pi = new FakePi();

	registerDualModelRouting(pi);

	expect({ roles: pi.modelRoles?.roles, settingsKey: pi.modelRoles?.settingsKey }).toEqual({
		roles: [MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG],
		settingsKey: { field: SETTINGS_KEY_MODELS, key: SETTINGS_KEY_ROLE },
	});
});

// spec "dual-model-routing / /model によるロールのロック": spirits/auto を選んだままロックする / normal に戻す
test("locks the role a /model selection reports", async () => {
	const { pi, ctx, decision, start } = harness();

	await start("startup");

	pi.modelRoles?.onSelect(MODEL_ROLE_STRONG, ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// spec "dual-model-routing / /model によるロールのロック": ロック設定だけではバッジが変わらない。
	// The badge reads the recorded role, so locking writes nothing: the next request is what records it.
	expect(pi.entries).toEqual([]);

	pi.modelRoles?.onSelect(MODEL_ROLE_NORMAL, ctx);
	expect(decision()).toBe("normal:claude-sonnet-4-5");
	expect(pi.entries).toEqual([]);
});
