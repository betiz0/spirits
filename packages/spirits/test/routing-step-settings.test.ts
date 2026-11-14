/**
 * The per-step settings, `models.steps.<name>`.
 *
 * A step setting is the narrowest thing a user can ask for, so it wins over the step list's own default
 * and over the session lock — and a name or a value the vocabulary does not carry is dropped on the way
 * in rather than honored by accident (spec `dual-model-routing` / ワークフローのステップ別ロール).
 */

import { expect, test } from "bun:test";
import { readRoutingSettings } from "../src/config.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { resolveRequestRole, resolveRequestThinkingLevel } from "../src/routing/router.ts";

/** The settings of a session that configured steps and left the rest to the step list. */
function settingsOf(steps: unknown): ReturnType<typeof readRoutingSettings> {
	return readRoutingSettings({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { steps } });
}

// spec scenario "role だけ指定されたステップ": a step may name a role and leave the level alone. The role
// comes from the setting; the level then falls to the setting of the role that answers, and to the
// session's own selection when that role sets nothing either.
test("a step that sets only a role still answers at a level", () => {
	const roleOnly = { name: "opsx-new", continuing: true, starters: [] };
	const withRoleLevel = {
		...settingsOf({ "opsx-new": { role: "strong" } }),
		thinking: { strong: "high" as const },
	};

	expect(resolveRequestRole(roleOnly, withRoleLevel, "normal")).toBe("strong");
	expect(resolveRequestThinkingLevel(withRoleLevel, "strong", "medium", roleOnly)).toBe("high");

	// No level set for the answering role either: the session's selection is the answer, not a default.
	const roleOnlySettings = settingsOf({ "opsx-new": { role: "strong" } });
	expect(resolveRequestRole(roleOnly, roleOnlySettings, "normal")).toBe("strong");
	expect(resolveRequestThinkingLevel(roleOnlySettings, "strong", "minimal", roleOnly)).toBe("minimal");
});

// spec scenario "一覧外の名前": a step the list does not carry is not a step, so its settings are not
// read and cannot reach a request.
test("ignores an unknown step name", () => {
	const settings = settingsOf({
		"opsx-teleport": { role: "strong" },
		"opsx-apply": { role: "strong" },
		// A name that differs from a listed one by case is not the listed step either: the file's keys are
		// the step list's own spellings.
		"Opsx-Apply": { role: "normal" },
	});

	expect(Object.keys(settings.steps ?? {})).toEqual(["opsx-apply"]);
});

// spec scenario "語彙外の値": a value that is not a role word, not a level word, or not a string at all
// leaves that one item unset, and the rest of the step's settings stand.
test("ignores a role that is not a word in the vocabulary", () => {
	const settings = settingsOf({
		"opsx-apply": { role: "teleport", thinking: "high" },
		"opsx-verify": { role: 42, thinking: "teleport" },
		"opsx-sync": { role: "STRONG", thinking: " MAX " },
	});

	// The unreadable role is gone and the readable thinking level stays.
	expect(settings.steps?.["opsx-apply"]).toEqual({ thinking: "high" });
	// A step whose every value was unreadable leaves no entry at all, so nothing reports it as set.
	expect(settings.steps?.["opsx-verify"]).toBeUndefined();
	// A word is matched without regard to case, and ignoring the space around it.
	expect(settings.steps?.["opsx-sync"]).toEqual({ role: "strong", thinking: "max" });
	// An entry that is not an object, and a `steps` value that is not an object, are read as nothing.
	expect(settingsOf({ "opsx-apply": "strong" }).steps).toBeUndefined();
	expect(settingsOf("opsx-apply").steps).toBeUndefined();
	expect(settingsOf([]).steps).toBeUndefined();
});

// spec scenario "ステップの設定が既定とロックに勝つ": step setting, then the step list's default role,
// then the session lock. The last two are already settled by the phase, so the resolver's job is the
// first one — and the phase is exercised here as well, because the order only exists across the two.
test("prefers the step role over the step default and the lock", () => {
	const applyStep = { name: "opsx-apply", continuing: true, starters: [] };
	const plainStep = { name: "opsx-new", continuing: true, starters: [] };

	// The setting wins over the phase role, whether that role came from the step list's default or the
	// lock.
	expect(resolveRequestRole(applyStep, settingsOf({ "opsx-apply": { role: "strong" } }), "normal")).toBe("strong");
	expect(resolveRequestRole(applyStep, settingsOf({ "opsx-apply": { role: "normal" } }), "strong")).toBe("normal");
	// A step that sets nothing follows the phase role.
	expect(resolveRequestRole(plainStep, settingsOf({ "opsx-apply": { role: "strong" } }), "strong")).toBe("strong");
	// No step at all is the phase role, whatever the settings hold for a step that is not running.
	expect(resolveRequestRole(undefined, settingsOf({ "opsx-apply": { role: "strong" } }), "normal")).toBe("normal");
	// A step whose settings were dropped reads the same as a step that set nothing.
	expect(resolveRequestRole(applyStep, settingsOf({ "opsx-apply": { role: "teleport" } }), "normal")).toBe("normal");

	// The step list's default role reaching a request is the phase's half of the same order: the phase
	// settles on the step's default and the resolver leaves that alone.
	const phase = createRoutingPhase({ listCommands: () => [{ name: "skill:sprt-opsx-review-change", source: "skill" }] });
	phase.handleInput("/skill:sprt-opsx-review-change some-change");
	expect(phase.current()).toBe("strong");
	expect(resolveRequestRole(phase.step(), settingsOf({}), phase.current())).toBe("strong");
	// Locking over the step takes the default away with it, which is the end condition speaking.
	phase.setRole("normal");
	expect(resolveRequestRole(phase.step(), settingsOf({}), phase.current())).toBe("normal");
});
