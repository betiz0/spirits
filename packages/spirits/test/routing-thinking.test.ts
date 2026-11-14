/**
 * Thinking-level resolution for the two roles.
 *
 * A level is a word from pi's own vocabulary, and the order that decides one is the step's setting, then
 * the setting of the role that actually answers, then pi's session selection. Rounding a level to what
 * the physical model offers is pi's job, so nothing here clamps (spec `dual-model-routing` /
 * ロールとステップの thinking レベルの解決).
 */

import { expect, test } from "bun:test";
import type { PiModel } from "@earendil-works/pi-coding-agent";
import { COMMAND_SPIRITS_ROLE, THINKING_LEVELS } from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { readRoutingSettings } from "../src/config.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { resolveRequestThinkingLevel } from "../src/routing/router.ts";
import { FakePi, fakeCommandContext } from "./routing/fake-pi.ts";

const PHYSICAL: PiModel = { provider: "compat-fake", id: "fake-model", api: "openai" };

/** The settings of a session with one level per role, and nothing else configured. */
const ROLE_LEVELS: RoutingSettings = { thinking: { normal: "low", strong: "high" } };

// spec scenario "語彙の無い値": only pi's own level words are read, and anything else is the same as
// never having set it.
test("role thinking level reads only known levels", () => {
	expect(readRoutingSettings({ models: { thinking: { normal: "high", strong: "max" } } }).thinking).toEqual({
		normal: "high",
		strong: "max",
	});
	// A word pi does not know, a value that is not a string, and an empty string all read as unset.
	for (const value of ["teleport", "highest", 42, null, true, "", {}, []]) {
		const settings = readRoutingSettings({ models: { thinking: { normal: value } } });
		expect(settings.thinking?.normal).toBeUndefined();
	}
	// A level word is matched the way the command matches it: without regard to case, and ignoring the
	// space around it.
	expect(readRoutingSettings({ models: { thinking: { normal: " HIGH " } } }).thinking?.normal).toBe("high");
	// Every level in the vocabulary reads back as itself.
	for (const level of THINKING_LEVELS) {
		expect(readRoutingSettings({ models: { thinking: { normal: level } } }).thinking?.normal).toBe(level);
	}
	// A `thinking` key that is not an object is ignored whole.
	expect(readRoutingSettings({ models: { thinking: "high" } }).thinking).toBeUndefined();
});

// spec "ロールの thinking レベルはロール別に解決される": the level follows the role that answers, so a
// strong request that fell back to normal takes normal's level rather than the one it asked for.
test("strong fallback uses the normal level", () => {
	// A request that really runs on strong takes strong's level.
	expect(resolveRequestThinkingLevel(ROLE_LEVELS, "strong", "medium")).toBe("high");
	// The same settings with the role settled on normal — which is what a strong request with no usable
	// target becomes — take normal's level.
	expect(resolveRequestThinkingLevel(ROLE_LEVELS, "normal", "medium")).toBe("low");
});

// spec "thinking レベルの解決順": step, then role, then the session's own selection.
test("resolves the level by step, then role, then session", () => {
	const settings: RoutingSettings = {
		thinking: { normal: "low" },
		steps: { "opsx-apply": { thinking: "max" }, "opsx-new": {} },
	};
	const step = { name: "opsx-apply", continuing: true, starters: [] };
	const unsetStep = { name: "opsx-new", continuing: true, starters: [] };

	expect(resolveRequestThinkingLevel(settings, "normal", "medium", step)).toBe("max");
	// A step that sets no level leaves the role's own setting in charge.
	expect(resolveRequestThinkingLevel(settings, "normal", "medium", unsetStep)).toBe("low");
	// With nothing configured, the session's selection is the answer.
	expect(resolveRequestThinkingLevel({}, "normal", "medium")).toBe("medium");
	// A session with no selection at all stays unset rather than inventing a level.
	expect(resolveRequestThinkingLevel({}, "normal", undefined)).toBeUndefined();
});

// A physical model selection is pi's own, and the route is not in that path at all: the level the user
// picked with `/thinking` is what pi sends, and a role setting changes the session's selection not at
// all. `setThinkingLevel` is the only way to move it, so counting those calls is the whole test.
test("leaves the level alone on a physical model selection", async () => {
	const pi = new FakePi();
	registerManagedCommands(pi, { phase: createRoutingPhase(), patchSettings: () => {}, patchSettingsPath: () => {} });
	const context = fakeCommandContext({ available: [PHYSICAL], model: PHYSICAL, thinkingLevel: "minimal" });

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("normal thinking high", context.ctx);

	expect(pi.thinkingChanges).toEqual([]);
	expect(context.ctx.thinkingLevel).toBe("minimal");
	// The level still reaches the request that is routed, which is what makes the setting worth having.
	expect(resolveRequestThinkingLevel({ thinking: { normal: "high" } }, "normal", "minimal")).toBe("high");
});
