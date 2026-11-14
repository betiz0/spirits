/**
 * The one resolution the route, the `rlm` child, and the settings list share.
 *
 * The three used to compose "which role answers, with which model, at which level" separately, and each
 * composition could drop a part of the rule (design Decision 15). These tests do not spell the expected
 * model or level by hand: every expected value comes from the router under the same conditions, and the
 * child and the step row are compared against it. That is what makes a divergence visible instead of
 * making the test agree with the implementation's own mistake.
 */

import { expect, test } from "bun:test";
import type { ExtensionContext, ExtensionModelRegistry, ModelRouteRequest, PiModel, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, STEP_DEFINITIONS } from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { RolePanel, modelChoices, type RolePanelSnapshot } from "../src/commands/role-panel.ts";
import { createChildModelResolver } from "../src/routing/child.ts";
import { createNotificationGuard, createRoutingRoute } from "../src/routing/router.ts";
import { modelKey } from "../src/routing/resolve.ts";
import { AUTO_SELECTION, fakeToolContext } from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5", api: "openai" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7", api: "openai" };

const STEP_ROLE_SETTING = STEP_DEFINITIONS.find((step) => step.name === "opsx-propose")!;
const STEP_DEFAULT_STRONG = STEP_DEFINITIONS.find((step) => step.name === "sprt-opsx-review-change")!;
const STEP_LOCK = STEP_DEFINITIONS.find((step) => step.name === "opsx-apply")!;

/** The three ways a request can be strong: the step picks it, the step list defaults to it, or a lock. */
const ROLE_CASES = [
	{ name: "step setting", step: STEP_ROLE_SETTING, lock: MODEL_ROLE_NORMAL, stepRole: MODEL_ROLE_STRONG },
	{ name: "step default", step: STEP_DEFAULT_STRONG, lock: MODEL_ROLE_NORMAL, stepRole: MODEL_ROLE_STRONG },
	{ name: "lock normal", step: STEP_LOCK, lock: MODEL_ROLE_NORMAL, stepRole: MODEL_ROLE_NORMAL },
] as const;

/** The four thinking arrangements the settings can be in. */
const THINKING_CASES = [
	{ name: "none", thinking: undefined, stepThinking: undefined },
	{ name: "normal only", thinking: { normal: "low" as const }, stepThinking: undefined },
	{ name: "strong only", thinking: { strong: "max" as const }, stepThinking: undefined },
	{ name: "step", thinking: undefined, stepThinking: "xhigh" as const },
] as const;

/** The three states of the strong target. */
const STRONG_CASES = [
	{ name: "usable", strong: { provider: "anthropic", modelId: "claude-opus-4-7" } },
	{ name: "unset", strong: undefined },
	{ name: "configured but unusable", strong: { provider: "anthropic", modelId: "claude-haiku-4-5" } },
] as const;

function registry(models: readonly PiModel[], authed: readonly string[] = ["anthropic"]): ExtensionModelRegistry {
	return {
		getAvailable: () => models.filter((model) => authed.includes(model.provider)),
		find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
		hasConfiguredAuth: (model) => authed.includes(model.provider),
	};
}

function request(): ModelRouteRequest {
	return { model: AUTO_SELECTION, thinkingLevel: "medium", reason: "user" };
}

test("the route, the child, and the panel agree on the model and the level", () => {
	const available = [SONNET, OPUS];
	const authed = ["anthropic"];

	for (const roleCase of ROLE_CASES) {
		for (const strongCase of STRONG_CASES) {
			for (const thinkingCase of THINKING_CASES) {
				const step = roleCase.step;
				const stepEntry = {
					...(roleCase.name === "step setting" ? { role: MODEL_ROLE_STRONG } : {}),
					...(thinkingCase.stepThinking ? { thinking: thinkingCase.stepThinking } : {}),
				};
				const settings: RoutingSettings = {
					defaultProvider: "anthropic",
					defaultModelId: "claude-sonnet-4-5",
					...(strongCase.strong ? { strong: strongCase.strong } : {}),
					...(thinkingCase.thinking ? { thinking: thinkingCase.thinking } : {}),
					...(Object.keys(stepEntry).length > 0 ? { steps: { [step.name]: stepEntry } } : {}),
				};
				const condition = `${roleCase.name} / strong ${strongCase.name} / thinking ${thinkingCase.name}`;
				const phaseRole = roleCase.stepRole;
				const phase = { current: () => phaseRole, step: () => step };
				const lookup = registry(available, authed);

				const route = createRoutingRoute({
					phase,
					readSettings: () => settings,
					guard: createNotificationGuard(),
				});
				const ctx = {
					modelRegistry: lookup,
					ui: { notify: () => {} },
				} as unknown as ExtensionContext;
				const routed = route(request(), ctx) as { model: PiModel; thinkingLevel?: ThinkingLevel };
				const expected = { model: routed.model, thinkingLevel: routed.thinkingLevel };

				// The child reads the same plan.
				const child = createChildModelResolver({ phase, readSettings: () => settings });
				const toolContext = fakeToolContext({ available, authedProviders: authed, thinkingLevel: "medium" });
				expect(child(AUTO_SELECTION, toolContext.ctx), condition).toEqual(expected);

				// The step row reads the same plan: the model it names and the level it says the request
				// asks for are the ones the route just returned.
				const snapshot: RolePanelSnapshot = {
					lock: roleCase.lock,
					settings,
					lookup,
					step,
					sessionThinkingLevel: "medium",
					modelChoices: modelChoices(available),
					missingStarters: new Set<string>(),
				};
				const panel = new RolePanel(
					() => snapshot,
					{ lockRole: () => {}, patchSettings: () => {}, patchSettingsPath: () => {} },
				);
				const row = panel.rows().find((candidate) => candidate.id === `step:${step.name}`);
				if (!row) throw new Error(`no row for ${step.name}`);
				expect(row.description, condition).toContain(`It answers with ${modelKey(routed.model)}.`);
				expect(row.description, condition).toContain(`It asks for ${routed.thinkingLevel}.`);
			}
		}
	}
});

// spec scenario "ロールのモデルの行とロックの行もルーティングと一致する": the two rows a user reads to decide
// whether strong is worth setting. The step row is covered above; these two are the ones left, and their
// expected values come from the route under the same conditions rather than from the test (the rule at the
// head of tasks.md, and d-verify4 W-1).
test("the model row and the lock row agree with the route", () => {
	// GIVEN: `spirits/auto` selected, a strong target that is set but cannot be used, normal answering on
	// pi's default model, the lock on normal, and `opsx-propose` set to strong and continuing.
	const settings: RoutingSettings = {
		defaultProvider: "anthropic",
		defaultModelId: "claude-sonnet-4-5",
		strong: { provider: "anthropic", modelId: "claude-haiku-4-5" },
		steps: { "opsx-propose": { role: MODEL_ROLE_STRONG } },
	};
	const available = [SONNET, OPUS];
	const lookup = registry(available);
	const step = STEP_ROLE_SETTING;
	const phase = { current: () => MODEL_ROLE_STRONG, step: () => step };

	const routed = createRoutingRoute({ phase, readSettings: () => settings, guard: createNotificationGuard() })(
		request(),
		{ modelRegistry: lookup, ui: { notify: () => {} } } as unknown as ExtensionContext,
	) as { model: PiModel; thinkingLevel?: ThinkingLevel; role?: string };
	// The conditions themselves: strong was asked, and something else answered.
	expect(routed.role).toBe(MODEL_ROLE_NORMAL);

	const panel = new RolePanel(
		() => ({
			lock: MODEL_ROLE_NORMAL,
			settings,
			lookup,
			step,
			sessionThinkingLevel: "medium",
			modelChoices: modelChoices(available),
			missingStarters: new Set<string>(),
		}),
		{ lockRole: () => {}, patchSettings: () => {}, patchSettingsPath: () => {} },
	);
	const rows = panel.rows();
	const strongModel = rows.find((row) => row.id === "strong.model");
	const lock = rows.find((row) => row.id === "lock");
	if (!strongModel || !lock) throw new Error("the list lost one of its own rows");

	// The strong model row names the model that answers — the one value here that only a resolution knows.
	expect(strongModel.description).toContain(modelKey(routed.model));
	// And the lock row names the role the running step runs on, which is the role the GIVEN set and not the
	// lock: the raw lock on that row is what d-verify1 C-3 was about.
	expect(lock.description).toContain(`runs ${settings.steps?.["opsx-propose"]?.role}`);
	expect(lock.currentValue).toBe(MODEL_ROLE_NORMAL);
});

test("a strong fallback carries the normal level", () => {
	const settings: RoutingSettings = {
		defaultProvider: "anthropic",
		defaultModelId: "claude-sonnet-4-5",
		thinking: { normal: "low", strong: "max" },
		steps: { "opsx-propose": { role: "strong" } },
	};
	const step = STEP_ROLE_SETTING;
	const phaseRole = MODEL_ROLE_STRONG;
	const phase = { current: () => phaseRole, step: () => step };
	const lookup = registry([SONNET, OPUS]);

	const route = createRoutingRoute({ phase, readSettings: () => settings, guard: createNotificationGuard() });
	const routed = route(request(), { modelRegistry: lookup, ui: { notify: () => {} } } as unknown as ExtensionContext) as {
		model: PiModel;
		thinkingLevel?: ThinkingLevel;
		role: string;
	};

	// Strong has no target, so normal answers and normal's level is what the request carries.
	expect(routed.role).toBe(MODEL_ROLE_NORMAL);
	expect(routed.thinkingLevel).toBe("low");

	const child = createChildModelResolver({ phase, readSettings: () => settings });
	expect(child(AUTO_SELECTION, fakeToolContext({ available: [SONNET, OPUS], authedProviders: ["anthropic"], thinkingLevel: "medium" }).ctx)).toEqual({
		model: routed.model,
		thinkingLevel: routed.thinkingLevel,
	});

	const snapshot: RolePanelSnapshot = {
		lock: MODEL_ROLE_NORMAL,
		settings,
		lookup,
		step,
		sessionThinkingLevel: "medium",
		modelChoices: modelChoices([SONNET, OPUS]),
		missingStarters: new Set<string>(),
	};
	const panel = new RolePanel(
		() => snapshot,
		{ lockRole: () => {}, patchSettings: () => {}, patchSettingsPath: () => {} },
	);
	expect(panel.rows().find((row) => row.id === "step:opsx-propose")?.description).toContain(
		`It asks for ${routed.thinkingLevel}.`,
	);
});
