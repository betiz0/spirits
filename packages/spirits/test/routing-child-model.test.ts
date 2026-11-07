/**
 * The child-model resolution `rlm` uses for a parent that selected `spirits/auto`.
 *
 * The resolution reuses the router's targets, so the cases below are the router's branches seen from
 * a child: the phase decides strong or normal, a strong phase with no usable target falls back in
 * silence, and the latest successful response takes over when the default model is gone. The last
 * group is the branch scan: what pi counts as a successful response, and what it must not use.
 */

import { expect, test } from "bun:test";
import type { PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, PI_VIRTUAL_MODEL_API, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { createChildModelResolver } from "../src/routing/child.ts";
import {
	AUTO_SELECTION,
	fakeToolContext,
	makeAssistantEntry,
	makeInputEvent,
	makeUserEntry,
} from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };
const LUNA: PiModel = { provider: "openai", id: "gpt-5.6-luna" };
/** A virtual model registered by someone else: spirits never routes it, so a child cannot run it. */
const FOREIGN_VIRTUAL: PiModel = { provider: "other", id: "router", api: PI_VIRTUAL_MODEL_API };

/** Settings with both targets configured. */
const SETTINGS: RoutingSettings = {
	defaultProvider: "anthropic",
	defaultModelId: "claude-sonnet-4-5",
	strong: { provider: "anthropic", modelId: "claude-opus-4-7" },
};

/**
 * The resolver under test, with the phase driven the way the event handlers drive it.
 * `readSettings` is a live read, so a settings edit between two children shows up in the next one.
 */
function harness(options: { settings?: RoutingSettings; branch?: readonly SessionEntry[] } = {}) {
	let settings = options.settings ?? SETTINGS;
	const phase = createRoutingPhase();
	const resolve = createChildModelResolver({ phase, readSettings: () => settings });
	return {
		resolve,
		phase,
		setSettings(next: RoutingSettings): void {
			settings = next;
		},
		/** Enter the strong phase the way the target skill command does. */
		enterStrong(): void {
			phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep fix-managed-rlm-child-model`);
		},
	};
}

function context(options: { branch?: readonly SessionEntry[] } = {}) {
	return fakeToolContext({
		available: [SONNET, OPUS, LUNA, FOREIGN_VIRTUAL],
		authedProviders: ["anthropic", "openai"],
		branch: options.branch,
	});
}

// spec "dual-model-routing / 物理モデルを選ぶ親は振り分けない"
test("leaves a physical parent selection untouched", () => {
	const { resolve, enterStrong } = harness();
	const { ctx, notices } = context();
	enterStrong();

	expect(resolve(SONNET, ctx)).toEqual(SONNET);
	// A physical parent never reaches the resolution, so a strong phase changes nothing for it.
	expect(resolve(LUNA, ctx)).toEqual(LUNA);
	expect(notices).toEqual([]);
});

// spec "dual-model-routing / strong 位相の子は strong の対象"
test("resolves a strong phase child to the strong target", () => {
	const { resolve, enterStrong } = harness();
	const { ctx, notices } = context();
	enterStrong();

	expect(resolve(AUTO_SELECTION, ctx)).toEqual(OPUS);
	expect(notices).toEqual([]);
});

// spec "dual-model-routing / normal 位相の子は既定モデル"
test("resolves a normal phase child to the default model", async () => {
	const { resolve, phase } = harness();
	const { ctx } = context();
	phase.setRole(MODEL_ROLE_NORMAL);

	expect(resolve(AUTO_SELECTION, ctx)).toEqual(SONNET);

	// An idle input that is not a target skill command keeps the phase normal.
	await phase.handleInput("plain request");
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
	expect(resolve(AUTO_SELECTION, ctx)).toEqual(SONNET);
});

// spec "dual-model-routing / strong が使えなければ黙って normal の対象"
test("falls back to the normal target without a notice", () => {
	// Strong configured but not in the catalog.
	const unconfigured = harness({
		settings: { ...SETTINGS, strong: { provider: "anthropic", modelId: "claude-haiku-4-5" } },
	});
	const first = context();
	unconfigured.enterStrong();
	expect(unconfigured.resolve(AUTO_SELECTION, first.ctx)).toEqual(SONNET);
	expect(first.notices).toEqual([]);

	// Strong configured and in the catalog, but its provider has no credentials while the default's has.
	const unauthed = harness({ settings: { ...SETTINGS, strong: { provider: "openai", modelId: "gpt-5.6-luna" } } });
	const second = fakeToolContext({ available: [SONNET, LUNA], authedProviders: ["anthropic"] });
	unauthed.enterStrong();
	expect(unauthed.resolve(AUTO_SELECTION, second.ctx)).toEqual(SONNET);
	expect(second.notices).toEqual([]);

	// Strong not configured at all.
	const noStrong = harness({ settings: { defaultProvider: "anthropic", defaultModelId: "claude-sonnet-4-5" } });
	const third = context();
	noStrong.enterStrong();
	expect(noStrong.resolve(AUTO_SELECTION, third.ctx)).toEqual(SONNET);
	expect(third.notices).toEqual([]);
});

// spec "rlm / 他の拡張の仮想モデルを選ぶ親"
test("refuses a virtual model spirits does not route", () => {
	const { resolve, enterStrong } = harness();
	const { ctx } = context();
	enterStrong();

	let message = "";
	try {
		resolve(FOREIGN_VIRTUAL, ctx);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("other/router");
	expect(message).toContain("spirits/auto");
	expect(message).toContain("virtual model");
});

// spec "dual-model-routing / 子の対象がどちらも使えない"
test("names the roles tried and the settings that are missing", () => {
	const empty = harness({ settings: {} });
	const { ctx, notices } = context();

	let message = "";
	try {
		empty.resolve(AUTO_SELECTION, ctx);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain(MODEL_ROLE_NORMAL);
	expect(message).toContain("defaultProvider");
	expect(message).toContain("defaultModel");
	expect(message).toContain("no successful response");
	expect(notices).toEqual([]);

	// A strong phase that also failed names both roles, and the strong setting it tried.
	const strong = harness({ settings: { ...SETTINGS, strong: { provider: "google", modelId: "gemini" } } });
	let strongMessage = "";
	try {
		strong.enterStrong();
		strong.resolve(AUTO_SELECTION, fakeToolContext({ available: [], authedProviders: [] }).ctx);
	} catch (error) {
		strongMessage = error instanceof Error ? error.message : String(error);
	}
	expect(strongMessage).toContain(`${MODEL_ROLE_STRONG}, ${MODEL_ROLE_NORMAL}`);
	expect(strongMessage).toContain("models.strong");
	// The default is configured here, so the error names the model instead of the unset keys.
	expect(strongMessage).toContain("anthropic/claude-sonnet-4-5");
});

// spec "dual-model-routing / 既定モデルを失った子は直近の成功レスポンス"
test("falls back to the latest successful response", () => {
	const { resolve } = harness({
		settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" },
	});
	const { ctx } = context({
		branch: [makeUserEntry("asked"), makeAssistantEntry("openai", "gpt-5.6-luna")],
	});

	expect(resolve(AUTO_SELECTION, ctx)).toEqual(LUNA);
});

// spec "dual-model-routing / 直近の成功レスポンスに資格情報が無い"
test("refuses a latest successful response without credentials", () => {
	const { resolve } = harness({ settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" } });
	const { ctx } = context({
		branch: [makeUserEntry("asked"), makeAssistantEntry("openai", "gpt-5.6-luna")],
	});
	const noCredentials = fakeToolContext({
		available: [SONNET, OPUS, LUNA],
		authedProviders: ["anthropic"],
		branch: [makeUserEntry("asked"), makeAssistantEntry("openai", "gpt-5.6-luna")],
	});

	let message = "";
	try {
		resolve(AUTO_SELECTION, noCredentials.ctx);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain(MODEL_ROLE_NORMAL);
	expect(message).toContain("openai/gpt-5.6-luna");
	expect(message).toContain("no credentials");
	// The plain context still resolves it, so the case is the credentials and nothing else.
	expect(resolve(AUTO_SELECTION, ctx)).toEqual(LUNA);
});

// spec "dual-model-routing / 既定モデルを失った子は直近の成功レスポンス" (scan exclusions)
test("skips a failed or aborted response and uses the last successful one", () => {
	const { resolve } = harness({ settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" } });
	const { ctx } = context({
		branch: [
			makeAssistantEntry("anthropic", "claude-opus-4-7"),
			makeAssistantEntry("openai", "gpt-5.6-luna", "error"),
			makeAssistantEntry("openai", "gpt-5.6-luna", "aborted"),
		],
	});

	expect(resolve(AUTO_SELECTION, ctx)).toEqual(OPUS);
});

// A failed route leaves the virtual selection on its response, and a virtual model is never a target.
test("does not use a response that names a virtual model", () => {
	const { resolve } = harness({ settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" } });
	const { ctx } = fakeToolContext({
		available: [SONNET, OPUS, LUNA, AUTO_SELECTION],
		authedProviders: ["anthropic", "openai", "spirits"],
		// The newest success is `spirits/auto` itself: pi reports no physical model for it.
		branch: [makeAssistantEntry("anthropic", "claude-opus-4-7"), makeAssistantEntry("spirits", "auto")],
	});

	let message = "";
	try {
		resolve(AUTO_SELECTION, ctx);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("spirits/auto");
	expect(message).toContain("not a physical model");
});

// A branch with no assistant message at all has no previous response to fall back to.
test("does not use a branch without an assistant response", () => {
	const { resolve } = harness({ settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" } });
	const { ctx } = context({ branch: [makeUserEntry("asked")] });

	let message = "";
	try {
		resolve(AUTO_SELECTION, ctx);
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toContain("no successful response");
});

// The strong target wins over both the default and the previous response.
test("prefers the strong target over the default and the previous response", () => {
	const { resolve, enterStrong } = harness({ settings: { ...SETTINGS, defaultModelId: "claude-haiku-4-5" } });
	const { ctx } = context({ branch: [makeAssistantEntry("openai", "gpt-5.6-luna")] });
	enterStrong();

	expect(resolve(AUTO_SELECTION, ctx)).toEqual(OPUS);
});
