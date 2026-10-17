import { expect, test } from "bun:test";
import type { ExtensionContext, ModelRouteRequest, PiModel } from "@earendil-works/pi-coding-agent";
import type { RoutingSettings } from "../src/config.ts";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG } from "../src/constants.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { createNotificationGuard, createRoutingRoute } from "../src/routing/router.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };
const LUNA: PiModel = { provider: "openai", id: "gpt-5.6-luna" };

const DEFAULTS: RoutingSettings = { defaultProvider: "anthropic", defaultModelId: "claude-sonnet-4-5" };
const STRONG_SPEC = { provider: "anthropic", modelId: "claude-opus-4-7" };

function makeRequest(overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
	return {
		model: { provider: "spirits", id: "auto" },
		thinkingLevel: "high",
		reason: "user",
		...overrides,
	};
}

/** Route with the phase, the settings, and the catalog set apart so each branch is reachable. */
function createHarness(options: {
	settings: RoutingSettings;
	available?: PiModel[];
	authedProviders?: string[];
	/** A real phase to route against, in place of the role the harness sets by hand. */
	phase?: { current(): string };
}) {
	const catalog = options.available ?? [];
	const authed = new Set(options.authedProviders ?? []);
	const notices: string[] = [];
	const ctx = {
		ui: { notify: (message: string) => notices.push(message) },
		modelRegistry: {
			getAvailable: () => [...catalog],
			find: (provider: string, modelId: string) =>
				catalog.find((model) => model.provider === provider && model.id === modelId),
			hasConfiguredAuth: (model: PiModel) => authed.has(model.provider),
		},
	} as unknown as ExtensionContext;

	let settings = options.settings;
	let role = MODEL_ROLE_NORMAL;
	const guard = createNotificationGuard();
	const route = createRoutingRoute({
		phase: options.phase ?? { current: () => role },
		readSettings: () => settings,
		guard,
	});

	return {
		route: (overrides: Partial<ModelRouteRequest> = {}) => route(makeRequest(overrides), ctx),
		notices,
		setRole: (next: string) => {
			role = next;
		},
		setSettings: (next: RoutingSettings) => {
			settings = next;
		},
		settle: () => guard.settle(),
	};
}

test("routes normal outside a strong phase", () => {
	const harness = createHarness({
		settings: { ...DEFAULTS, strong: STRONG_SPEC },
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
	});

	expect(harness.route()).toEqual({ model: SONNET, thinkingLevel: "high", role: MODEL_ROLE_NORMAL });
	expect(harness.notices).toEqual([]);
});

test("routes the configured strong model during a strong phase", () => {
	const harness = createHarness({
		settings: { ...DEFAULTS, strong: STRONG_SPEC },
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
	});
	harness.setRole(MODEL_ROLE_STRONG);

	// The selected thinking level passes through; pi clamps it to the routed model.
	expect(harness.route()).toEqual({ model: OPUS, thinkingLevel: "high", role: MODEL_ROLE_STRONG });
	expect(harness.notices).toEqual([]);
});

// spec "dual-model-routing / /model によるロールのロック": ロック strong のリクエストは strong の対象へルートされる
test("routes the role a locked phase reports", () => {
	const phase = createRoutingPhase();
	phase.setRole(MODEL_ROLE_STRONG);
	const harness = createHarness({
		settings: { ...DEFAULTS, strong: STRONG_SPEC },
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		phase,
	});

	// The route only reads `phase.current()`, so a lock and a strong phase reach it the same way.
	expect(harness.route()).toEqual({ model: OPUS, thinkingLevel: "high", role: MODEL_ROLE_STRONG });

	phase.settle();
	expect(harness.route()).toEqual({ model: OPUS, thinkingLevel: "high", role: MODEL_ROLE_STRONG });
});

test("falls back to normal silently when no strong model is configured", () => {
	const harness = createHarness({ settings: DEFAULTS, available: [SONNET], authedProviders: ["anthropic"] });
	harness.setRole(MODEL_ROLE_STRONG);

	expect(harness.route()).toEqual({ model: SONNET, thinkingLevel: "high", role: MODEL_ROLE_NORMAL });
	expect(harness.notices).toEqual([]);
});

test("falls back to normal and notifies once per run when the strong model is unusable", () => {
	const harness = createHarness({
		settings: { ...DEFAULTS, strong: STRONG_SPEC },
		available: [SONNET],
		authedProviders: ["anthropic"],
	});
	harness.setRole(MODEL_ROLE_STRONG);

	expect(harness.route()).toEqual({ model: SONNET, thinkingLevel: "high", role: MODEL_ROLE_NORMAL });
	harness.route();
	harness.route();

	expect(harness.notices.length).toBe(1);
	expect(harness.notices[0]).toContain("anthropic/claude-opus-4-7");
});

test("notifies once when falling back to the previous model", () => {
	const harness = createHarness({
		settings: { defaultProvider: "anthropic", defaultModelId: "claude-haiku-4-5" },
		available: [SONNET, LUNA],
		authedProviders: ["anthropic", "openai"],
	});
	const previous = { model: LUNA, thinkingLevel: "medium" as const };

	expect(harness.route({ previous })).toEqual({ model: LUNA, thinkingLevel: "high", role: MODEL_ROLE_NORMAL });
	harness.route({ previous });

	expect(harness.notices.length).toBe(1);
	expect(harness.notices[0]).toContain("openai/gpt-5.6-luna");
});

test("notifies again in the next run", () => {
	const harness = createHarness({
		settings: { ...DEFAULTS, strong: STRONG_SPEC },
		available: [SONNET],
		authedProviders: ["anthropic"],
	});
	harness.setRole(MODEL_ROLE_STRONG);
	harness.route();
	expect(harness.notices.length).toBe(1);

	// The run settles, then the next strong run hits the same reason again.
	harness.settle();
	harness.route();

	expect(harness.notices.length).toBe(2);
});

test("ends the request with an error when there is no normal target", () => {
	const harness = createHarness({ settings: {}, available: [SONNET], authedProviders: ["anthropic"] });

	expect(() => harness.route()).toThrow(/no normal model/);
});
