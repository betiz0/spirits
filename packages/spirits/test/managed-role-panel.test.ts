/**
 * The `/spirits-role` settings list.
 *
 * The list is tested as what it is: a row builder over a snapshot, an edit handler that goes through the
 * command's own writes, and a pi-tui adapter that opens the screen and reloads once when it closes.
 *
 * Two kinds of test appear below, and the difference matters. A row-level test reads the rows the panel
 * builds and calls its `edit`, which is enough for what a row says. A screen-level test drives the
 * `SettingsList` the command handed `ctx.ui.custom()` with the keys a terminal would send — Enter, the
 * arrows, Escape — because the submenu plumbing lives in pi-tui, and a test that calls the row callbacks
 * directly cannot see a screen that will not close (spec `managed-commands` /
 * 一覧の候補は Esc で閉じられる).
 */

import { expect, test } from "bun:test";
import { getKeybindings, type KeyId, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asExtensionApi, fakeModel, fakeModelRegistry, fakeTheme, slashCommandInfo } from "./host/fake-pi.ts";
import type { ExtensionMode, ExtensionModelRegistry, PiModel } from "../src/types/host.ts";
import {
	COMMAND_SPIRITS_ROLE,
	ENV_AGENT_DIR,
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	ROLE_SAVE_ROW,
	ROLE_SAVE_WORD,
	SETTINGS_FILE_NAME,
	ROLE_ENTRY_TYPE,
	ROLE_MODEL_STATUS_KEY,
	ROLE_STATUS_KEY,
	STEP_DEFINITIONS,
} from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { readRoutingSettings } from "../src/config.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import {
	missingStartersFor,
	modelChoices,
	openRolePanel,
	RolePanel,
	SEPARATOR_ROW,
	rowSetting,
	rowSubmenu,
	selectListTheme,
	settingsListTheme,
	stepRowValue,
	type PanelRead,
} from "../src/commands/role-panel.ts";
import type { RolePanelSnapshot } from "../src/commands/role-panel.ts";
import type { RoleWriteDeps, SessionSelection } from "../src/commands/role-write.ts";
import type { SettingsPath } from "../src/commands/settings-store.ts";
import { writePathValue } from "../src/commands/settings-store.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { createNotificationGuard, createRoutingRoute } from "../src/routing/router.ts";
import { modelKey } from "../src/routing/resolve.ts";
import { fakeCommandContext, FakePi } from "./routing/fake-pi.ts";
import { mergeSettingsPatch } from "./support.ts";

const FAKE_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { api: "openai" });
const FAKE_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { api: "openai" });
/** pi lists the routing entry among the available models, so every candidate list has to drop it. */
const AUTO: PiModel = fakeModel("spirits", "auto", { api: "pi-virtual" });
/**
 * A physical catalog entry that spells the routing model's name.
 *
 * An extension's provider namespace is not reserved, so a catalog can hold a real model at `spirits/auto`.
 * Only the virtual kind makes the routing model the routing model, and a surface that compared the name
 * alone would call this one the routing.
 */
const PHYSICAL_AUTO: PiModel = fakeModel("spirits", "auto", { api: "openai" });
/** The `save` row's pointer to the report, spelled the way the row spells it. */
const STATUS_POINTER = "run /spirits-role status for the procedure, or the reason there is none";

const SETTINGS: RoutingSettings = {
	defaultProvider: "compat-fake",
	defaultModelId: "fake-model",
	strong: { provider: "compat-fake", modelId: "fake-strong" },
};

/**
 * A model catalog in the shape the host reports.
 *
 * The rows describe what the routing would reach, and that is a question about this object: which models
 * exist and which providers have credentials. Passing a real one is what makes a row description say
 * something a test can trust.
 */
function registry(models: readonly PiModel[], authed: readonly string[] = ["compat-fake"]): ExtensionModelRegistry {
	return fakeModelRegistry({
		getAvailable: () => models.filter((model) => authed.includes(model.provider)),
		find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
		hasConfiguredAuth: (model) => authed.includes(model.provider),
	});
}

function snapshot(overrides: Partial<RolePanelSnapshot> = {}): RolePanelSnapshot {
	return {
		lock: "normal",
		settings: SETTINGS,
		lookup: registry([FAKE_MODEL, FAKE_STRONG]),
		sessionThinkingLevel: "medium",
		modelChoices: modelChoices([AUTO, FAKE_MODEL, FAKE_STRONG]),
		missingStarters: new Set<string>(),
		// A session on the routing model with a global file that has no default role and no default model,
		// which is the state every preview below starts from before a case overrides one of them.
		saveSelection: { role: "normal", model: { provider: "spirits", id: "auto" } },
		globalSettings: {},
		...overrides,
	};
}

/** The row of a panel by id, which is how every test here finds what it is checking. */
function rowOf(panel: RolePanel, id: string) {
	const row = panel.rows().find((candidate) => candidate.id === id);
	if (!row) throw new Error(`no row ${id}`);
	return row;
}

/** A panel over a fixed snapshot, with the writes replaced by recorders. */
function panelOf(
	overrides: Partial<RolePanelSnapshot> = {},
	writes: Partial<RoleWriteDeps> = {},
	hooks: { lockDrawn?: (role: string) => void } = {},
) {
	const locked: Array<{ path: readonly string[]; value: unknown }> = [];
	const locks: string[] = [];
	const panel = new RolePanel(
		() => snapshot(overrides),
		{
			lockRole: (role) => locks.push(role),
			patchSettings: () => {},
			patchSettingsPath: (path, value) => locked.push({ path, value }),
			saveSettings: () => ({}),
			...writes,
		},
		hooks,
	);
	return { panel, locked, locks };
}

// --- the rows ---------------------------------------------------------------------------------

// spec scenario "一覧の開閉": one row per setting, and every row that pi-tui draws has to carry the
// fields it reads. A row without a `description` or a `currentValue` renders as a blank line the user
// cannot tell apart from a setting that is off.
test("rows carry every required field", () => {
	const { panel } = panelOf();
	const rows = panel.rows();

	// The save row, its separator, the lock, the two roles' model and thinking, and one row for every listed
	// step: a step is a pair of settings shown as one setting, not two rows (spec 一覧のステップの行は 2 段で選ぶ).
	// The list starts with save and the separator (spec `managed-commands` / 一覧の開閉).
	expect(rows).toHaveLength(1 + 1 + 1 + 2 * 2 + STEP_DEFINITIONS.length);
	for (const row of rows) {
		expect(row.id.length).toBeGreaterThan(0);
		// The separator is the one row with nothing on it at all, and the action rows are the ones with
		// nothing in the right-hand column: the first is a separator, the others act rather than set.
		if (row.id === SEPARATOR_ROW) {
			expect(row.label).toBe("");
			expect(row.description).toBe("");
			expect(row.currentValue).toBe("");
			expect(row.values).toEqual([]);
			continue;
		}
		expect(row.label.length).toBeGreaterThan(0);
		expect(row.description.length).toBeGreaterThan(0);
		if (row.id === ROLE_SAVE_ROW) {
			expect(row.currentValue).toBe("");
			continue;
		}
		expect(row.currentValue.length).toBeGreaterThan(0);
		expect(Array.isArray(row.values)).toBe(true);
		// A row with no value to offer is a row that cannot be edited, and pi-tui renders it as one.
		if (row.values.length === 0) expect(row.models).toBe(true);
		// Every row but the lock names the setting it changes: a role's item by its own id, a step by the
		// two halves its submenu writes.
		if (row.step !== undefined) {
			for (const item of ["role", "thinking"]) expect(rowSetting(`${row.id}.${item}`)).toBeDefined();
		} else if (row.id !== "lock") {
			expect(rowSetting(row.id)).toBeDefined();
		}
	}
	// The save row and the separator are the first two, and neither names a setting.
	const leading = rows.slice(0, 2).map((row) => row.id);
	expect(leading).toEqual([ROLE_SAVE_ROW, SEPARATOR_ROW]);
	for (const row of rows.slice(0, 2)) {
		expect(rowSetting(row.id)).toBeUndefined();
	}

	// The rows the spec lists by name are all there.
	const ids = rows.map((row) => row.id);
	for (const id of ["lock", "normal.model", "normal.thinking", "strong.model", "strong.thinking", "step:opsx-propose"]) {
		expect(ids).toContain(id);
	}
	// A step is one row, so its halves are never listed apart.
	expect(ids).not.toContain("step:opsx-propose.role");
	expect(ids).not.toContain("step:opsx-propose.thinking");
});

// The pair is one value on the row, spelled the way the command spells it.
test("a step row shows its pair as one value", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, steps: { "opsx-propose": { role: "strong", thinking: "low" } } } });

	expect(rowOf(panel, "step:opsx-propose").currentValue).toBe("strong / low");
	// Nothing set is not nothing shown: the row says `unset` for each half it holds nothing for.
	expect(rowOf(panel, "step:opsx-apply").currentValue).toBe("unset / unset");
	// And the value splits back into the halves the submenu preselects.
	expect(stepRowValue("strong / low")).toEqual({ role: "strong", thinking: "low" });
	expect(stepRowValue("unset / unset")).toEqual({ role: "unset", thinking: "unset" });
});

// spec "一覧の説明は実際の解決結果を示す": the description names the model that would answer, which is
// not the same statement as "this is what the settings file holds". A row that read the settings would
// call an unusable target the answer, and the user would only find out from a request.
test("an unusable target row names the model that answers", () => {
	const unknown = panelOf({
		settings: { ...SETTINGS, strong: { provider: "compat-fake", modelId: "ghost" } },
		lookup: registry([FAKE_MODEL, FAKE_STRONG]),
	});
	const goneRow = rowOf(unknown.panel, "strong.model");
	expect(goneRow.description).toContain("cannot use what is set");
	expect(goneRow.description).toContain("runs compat-fake/fake-model");

	// A reference whose provider has no credentials is unusable the same way.
	const unauthenticated = panelOf({ lookup: registry([FAKE_MODEL, FAKE_STRONG], []) });
	expect(rowOf(unauthenticated.panel, "strong.model").description).toContain("cannot use what is set");

	// A usable target says so plainly, with the setting behind it.
	const usable = panelOf();
	expect(rowOf(usable.panel, "strong.model").description).toContain("strong answers with compat-fake/fake-strong");

	// A value the settings reader dropped is neither unset nor unusable: the file holds something routing
	// refused to read, and only the ignored list says so.
	const unreadable = panelOf({
		settings: { ...SETTINGS, strong: undefined },
		ignored: [{ path: "models.strong", reason: "is not a model reference" }],
	});
	expect(rowOf(unreadable.panel, "strong.model").description).toContain("cannot read");
	expect(rowOf(unreadable.panel, "strong.model").description).toContain("is not a model reference");
});

// spec scenario "読めない normal でも実際に応答するモデルを出す": a `models.normal` the reader dropped is
// a diagnosis, not a replacement for the answer — the row still names the model that will handle the
// request, and the reason the setting is not used.
test("an unreadable normal still names the answering model", () => {
	const { panel } = panelOf({
		lookup: registry([FAKE_MODEL, FAKE_STRONG]),
		ignored: [{ path: "models.normal", reason: "not a model reference" }],
	});

	const description = rowOf(panel, "normal.model").description;
	expect(description).toContain("models.normal");
	expect(description).toContain("not a model reference");
	expect(description).toContain("compat-fake/fake-model");
});

// The last successful response is a target the settings file cannot show at all, and it is the one a
// normal request falls back to. A description that ignored it would call normal unset while a request was
// answering on it (spec `dual-model-routing` / normal の対象解決).
test("a normal row names the last response when that is what answers", () => {
	const { panel } = panelOf({ settings: { defaultProvider: "other", defaultModelId: "gone" }, previous: FAKE_MODEL });

	expect(rowOf(panel, "normal.model").description).toContain("compat-fake/fake-model");
	expect(rowOf(panel, "normal.model").description).not.toContain("has no model of its own");
});

// spec scenario "ステップの既定ロールで走っている間もロックの行はロックを出す": the lock row is the lock,
// and the role the running step takes belongs on the step's row.
test("the lock row shows the lock during a strong-default step", () => {
	const running = {
		name: "sprt-opsx-verify-deep",
		defaultRole: "strong",
		continuing: false,
		starters: ["/skill:sprt-opsx-verify-deep"],
	};
	const { panel } = panelOf({ lock: "normal", step: running });

	expect(rowOf(panel, "lock").currentValue).toBe("normal");
	expect(rowOf(panel, "lock").description).toContain("The sprt-opsx-verify-deep step is running and runs strong");
	expect(rowOf(panel, "step:sprt-opsx-verify-deep").description).toContain("Runs strong, its step-list default");
});

// The notice a command sends has nowhere to go in a list, so the lock row says it instead (spec
// `managed-commands` / 設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える).
test("the lock row carries the warnings a command would notify", () => {
	const strongWithNothing = panelOf({ lock: "strong", settings: { defaultProvider: "compat-fake", defaultModelId: "fake-model" }, lookup: registry([FAKE_MODEL]) });
	expect(rowOf(strongWithNothing.panel, "lock").description).toContain("strong has no usable model");

	// The other half of the notice: a session on a physical model is not routed at all.
	const off = panelOf({ lock: "normal", routingOff: true });
	expect(rowOf(off.panel, "lock").description).toContain("routing is off");

	// And the way out of a step, which is the thing a user reading this row is most likely after.
	expect(rowOf(off.panel, "lock").description).toContain("/spirits-clear");
});

// spec scenario "一覧の説明は実際の解決結果を示す" for a step: the row describes what a request in that
// step would do, which is the same resolution the route reaches, and not the two settings alone
// (d-verify2 C-2: the model, the level, and whether the step continues).
test("a step row names the model that answers and whether it continues", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, steps: { "opsx-apply": { role: "strong", thinking: "high" } } } });

	const description = rowOf(panel, "step:opsx-apply").description;
	expect(description).toContain("Runs strong, which you set");
	expect(description).toContain("It answers with compat-fake/fake-strong");
	expect(description).toContain("It asks for high");
	// A continuing step is the one that keeps costing the user the step's model, so the row says which it is.
	expect(description).toContain("continues after its run");
	expect(rowOf(panel, "step:sprt-opsx-verify-deep").description).toContain("ends with its run");
});

// A step set to strong is where the warning has to appear: the lock row only sees the step that happens to
// be running, so setting a step from the list would otherwise warn nowhere at all (design Decision 4).
test("a step set to strong warns on its row when strong has nothing to run on", () => {
	const { panel } = panelOf({
		settings: { defaultProvider: "compat-fake", defaultModelId: "fake-model", steps: { "opsx-propose": { role: "strong" } } },
		lookup: registry([FAKE_MODEL]),
	});

	const description = rowOf(panel, "step:opsx-propose").description;
	expect(description).toContain("strong has no usable model");
	// And it names what answers instead of leaving the user to guess.
	expect(description).toContain("compat-fake/fake-model");
});

// spec scenario "強が落ちるステップの行は normal のレベルを示す": the step row asks for the level the
// request will carry. A strong that has nothing to run on answers normal, so normal's level goes out;
// a row that resolved thinking on the requested role would name a level no request sends (d-verify3 C-1).
test("a step row names the level its requests carry when strong falls back", () => {
	const settings: RoutingSettings = {
		defaultProvider: "compat-fake",
		defaultModelId: "fake-model",
		thinking: { normal: "low", strong: "max" },
		steps: { "opsx-propose": { role: "strong" } },
	};
	const lookup = registry([FAKE_MODEL]);
	const { panel } = panelOf({ settings, lookup });

	const step = STEP_DEFINITIONS.find((candidate) => candidate.name === "opsx-propose")!;
	const routed = createRoutingRoute({
		phase: { current: () => "strong", step: () => step },
		readSettings: () => settings,
		guard: createNotificationGuard(),
	})(
		{ model: fakeModel("spirits", "auto"), thinkingLevel: "medium", reason: "user", messages: [] },
		{ modelRegistry: lookup, ui: { notify: () => {} } } as unknown as Parameters<ReturnType<typeof createRoutingRoute>>[1],
	) as { model: PiModel; thinkingLevel?: string };

	const description = rowOf(panel, "step:opsx-propose").description;
	expect(description).toContain(`It answers with ${modelKey(routed.model)}.`);
	expect(description).toContain(`It asks for ${routed.thinkingLevel}.`);
	expect(description).not.toContain("It asks for max");
});

// spec "一覧の説明は実際の解決結果を示す", read with design Decision 11's note on d-verify4 W-2: strong with
// nothing saved answers on normal's model, and the row has to name that model rather than stop at the word
// "normal" — which is what the row for a configured-but-unusable strong already does. The expected model
// comes from the route under the same conditions, not from the test.
test("an unset strong model row names the model that answers", () => {
	const settings: RoutingSettings = { defaultProvider: "compat-fake", defaultModelId: "fake-model" };
	const lookup = registry([FAKE_MODEL, FAKE_STRONG]);
	const { panel } = panelOf({ settings, lookup });

	const routed = createRoutingRoute({
		phase: { current: () => MODEL_ROLE_STRONG },
		readSettings: () => settings,
		guard: createNotificationGuard(),
	})(
		{ model: fakeModel("spirits", "auto"), thinkingLevel: "medium", reason: "user", messages: [] },
		{ modelRegistry: lookup, ui: { notify: () => {} } } as unknown as Parameters<ReturnType<typeof createRoutingRoute>>[1],
	) as { model: PiModel };

	expect(rowOf(panel, "strong.model").description).toContain(`runs normal on ${modelKey(routed.model)}`);
});

// spec scenario "使えない strong の thinking レベルの行": the row names the level a strong request
// actually carries when it falls back to normal, not the strong setting that has nowhere to run.
test("the strong thinking row names the level a fallback carries", () => {
	const settings: RoutingSettings = {
		defaultProvider: "compat-fake",
		defaultModelId: "fake-model",
		thinking: { normal: "low", strong: "max" },
	};
	const { panel } = panelOf({ settings, lookup: registry([FAKE_MODEL]) });

	const description = rowOf(panel, "strong.thinking").description;
	expect(description).toContain("strong requests run normal");
	expect(description).toContain("low");
	expect(description).not.toContain("carry max");
});

// A step that only sets a level has no role of its own, and the row has to say that rather than
// "nothing is set": the level is a setting the user made (d-verify3 G-2).
test("a step with only a level set says no role is set", () => {
	const { panel } = panelOf({
		settings: { ...SETTINGS, steps: { "opsx-propose": { thinking: "low" } } },
	});

	const description = rowOf(panel, "step:opsx-propose").description;
	expect(description).toContain("No role is set");
	expect(description).toContain("It asks for low");
});

// spec scenario "ロール未指定のステップはロックに従う旨、既定ロールが効いている行はその旨".
test("a step tells a lock it follows from a default it inherited", () => {
	const following = panelOf({ lock: "strong", settings: { ...SETTINGS, steps: { "opsx-apply": { thinking: "low" } } } });
	expect(rowOf(following.panel, "step:opsx-apply").description).toContain("follows the lock (strong)");
	expect(rowOf(following.panel, "step:opsx-apply").description).toContain("It asks for low");

	const defaulted = panelOf();
	const review = rowOf(defaulted.panel, "step:sprt-opsx-review-change").description;
	expect(review).toContain("step-list default");
	expect(review).toContain("Unset follows the lock");
});

// spec scenario "開始コマンドが無いステップ": the row says so and stays editable.
test("marks a step whose starters are absent", () => {
	const present = [
		slashCommandInfo("skill:openspec-apply-change", "skill"),
		slashCommandInfo("opsx-propose", "prompt"),
	];
	const missing = missingStartersFor(present);
	expect(missing.has("opsx-apply")).toBe(false);
	expect(missing.has("opsx-archive")).toBe(true);

	const { panel, locked } = panelOf({ missingStarters: missing });
	expect(rowOf(panel, "step:opsx-archive").description).toContain("none of its starter commands");
	// Setting it is still accepted; the skill may arrive tomorrow.
	panel.edit("step:opsx-archive.role", "strong");
	expect(locked).toEqual([{ path: ["models", "steps", "opsx-archive", "role"], value: "strong" }]);
});

// spec scenario "開始コマンドが無いステップ": an extension command of the same name is not a starter,
// because pi handles it before it ever fires `input` and so no step can open through it. The list and the
// phase have to count the same commands (design Decision 9).
test("an extension command is not a starter", () => {
	const extensionOnly = missingStartersFor([
		slashCommandInfo("opsx-propose", "extension"),
		slashCommandInfo("spirits-role", "extension"),
	]);
	expect(extensionOnly.has("opsx-propose")).toBe(true);

	// The same name from a template is a starter, and then the step is not missing.
	expect(missingStartersFor([slashCommandInfo("opsx-propose", "prompt")]).has("opsx-propose")).toBe(false);
});

// --- the writes -------------------------------------------------------------------------------

// spec "一覧での編集はコマンドと同じ書き込みを行う": the key path a list edit writes is the path the
// command's own grammar produces for the same change.
test("an edit writes through the same settings path", () => {
	const { panel, locked, locks } = panelOf();

	panel.edit("lock", "strong");
	panel.edit("strong.model", "compat-fake/fake-strong");
	panel.edit("normal.thinking", "high");
	panel.edit("step:opsx-propose.role", "unset");

	// The lock goes through the same role-lock the command runs, not through a settings path.
	expect(locks).toEqual(["strong"]);
	expect(locked).toEqual([
		{ path: ["models", "strong"], value: "compat-fake/fake-strong" },
		{ path: ["models", "thinking", "normal"], value: "high" },
		{ path: ["models", "steps", "opsx-propose", "role"], value: undefined },
	]);
});

// spec scenario "書き込みの失敗後は表示が戻る": the rows are read from the settings, so a write that
// never landed cannot leave the screen showing a value nobody saved.
test("a failed write restores the row", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, thinking: { normal: "low" } } }, {
		patchSettingsPath: () => {
			throw new Error("EACCES: permission denied");
		},
	});

	const before = rowOf(panel, "normal.thinking");
	const result = panel.edit("normal.thinking", "max");
	const after = rowOf(panel, "normal.thinking");

	expect(result.saved).toBe(false);
	expect(result.message).toContain("EACCES");
	expect(after.currentValue).toBe(before.currentValue);
	expect(after.currentValue).toBe("low");
	// A row the file refused does not count as a change waiting for a reload.
	expect(panel.hasWrites()).toBe(false);
});

// spec scenario "書き込みの失敗後は表示が戻る" for a step: the pair is one row, so either half's refusal is
// written on that row rather than on a half-row the screen no longer has.
test("a refused step write names the step row", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, steps: { "opsx-apply": { role: "normal", thinking: "low" } } } }, {
		patchSettingsPath: (path) => {
			if (path.at(-1) === "role") throw new Error("EACCES: permission denied");
		},
	});

	expect(panel.edit("step:opsx-apply.role", "strong").saved).toBe(false);

	const step = rowOf(panel, "step:opsx-apply");
	expect(step.description).toContain("not saved:");
	expect(step.description).toContain("EACCES");
	expect(rowOf(panel, "lock").description).not.toContain("not saved:");
});

// spec "一覧での編集はコマンドと同じ書き込みを行う": a model row accepts only what it offered, because a
// value the row never listed is a value nobody chose.
test("the model row offers the available models without the routing model", () => {
	const { panel, locked } = panelOf();

	const row = rowOf(panel, "strong.model");
	expect(row.values).toContain("compat-fake/fake-strong");
	expect(row.values).toContain("compat-fake/fake-model");
	expect(row.values).not.toContain("spirits/auto");
	// `unset` is the last choice, so a row can be returned to unset from the same screen.
	expect(row.values.at(-1)).toBe("unset");

	panel.edit("strong.model", "compat-fake/fake-strong");
	expect(locked).toEqual([{ path: ["models", "strong"], value: "compat-fake/fake-strong" }]);
});

// spec scenario "一覧の候補も api 値で除く": the exclusion reads the api, not the provider or the name, so
// a virtual model another extension registered is excluded too.
test("the model row drops every virtual model by its api", () => {
	const foreign = fakeModel("other", "router", { api: "pi-virtual" });
	const named = fakeModel("compat-fake", "auto-pilot", { name: "Auto Pilot", api: "openai" });
	const { panel } = panelOf({ modelChoices: modelChoices([AUTO, foreign, named, FAKE_MODEL]) });

	const values = rowOf(panel, "normal.model").values;
	expect(values).toContain("compat-fake/auto-pilot");
	expect(values).toContain("compat-fake/fake-model");
	expect(values).not.toContain("spirits/auto");
	expect(values).not.toContain("other/router");
});

// spec scenario "利用できるモデルが無ければ書き込まない": an empty catalog is a real state, and picking
// from an empty list is not the same as choosing nothing.
test("an empty model list writes nothing", () => {
	const { panel, locked } = panelOf({ modelChoices: [] });

	const row = rowOf(panel, "normal.model");
	expect(row.values).toEqual([]);
	// The row still says what normal answers with today, so the screen is not blank about it.
	expect(row.description).toContain("pi's default model");
	// With nothing to choose there is nothing to hand back, and an edit for that row writes nothing.
	expect(panel.edit("normal.model", "").saved).toBe(false);
	expect(locked).toEqual([]);
});

// spec "一覧のロックの行は保存に失敗してもセッションのロックを示す": the session keeps the lock a list
// edit applied, the row keeps showing it, and the badge goes up anyway.
test("a failed lock save keeps the session lock on the row", () => {
	let lock = "normal";
	const drawn: string[] = [];
	const panel = new RolePanel(
		() => snapshot({ lock }),
		{
			// The session takes the lock; only the settings file refuses it.
			lockRole: (role) => {
				lock = role;
			},
			patchSettings: () => {
				throw new Error("EACCES: the settings file is read-only");
			},
			patchSettingsPath: () => {},
			saveSettings: () => ({}),
		},
		{ lockDrawn: (role) => drawn.push(role) },
	);

	const result = panel.edit("lock", "strong");

	expect(result.saved).toBe(false);
	expect(lock).toBe("strong");
	expect(rowOf(panel, "lock").currentValue).toBe("strong");
	expect(rowOf(panel, "lock").description).toContain("not saved:");
	expect(rowOf(panel, "lock").description).toContain("read-only");
	// The badge is drawn whatever the file answered: the session really is locked.
	expect(drawn).toEqual(["strong"]);
});

// spec scenario "書き込んだ直後の行の説明": the host's settings stay as they were until the reload that
// closes the screen, so the list has to carry its own writes into the next read. Without that, the row
// the user just edited keeps describing the model the session has already left.
test("a row follows the write it just made", () => {
	const file: Record<string, unknown> = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	// The same fold `register.ts` does: the writes applied to the raw settings object with the primitive
	// the write itself uses, then read back through the settings reader.
	const read: PanelRead = (written) => {
		const raw = written.reduce<unknown>((current, change) => writePathValue(current, change.path, change.value), file);
		return snapshot({ settings: readRoutingSettings(raw) });
	};
	const panel = new RolePanel(read, { lockRole: () => {}, patchSettings: () => {}, patchSettingsPath: () => {}, saveSettings: () => ({}) });

	const before = rowOf(panel, "strong.model");
	expect(before.currentValue).toBe("unset");
	expect(before.description).toContain("has no model of its own");

	expect(panel.edit("strong.model", "compat-fake/fake-strong").saved).toBe(true);

	const after = rowOf(panel, "strong.model");
	// Both halves move: a value that updated while the description stayed on the old target would leave
	// the screen naming a model the settings no longer hold.
	expect(after.currentValue).toBe("compat-fake/fake-strong");
	expect(after.description).toContain("strong answers with compat-fake/fake-strong");
	expect(after.description).not.toContain("has no model of its own");
});

// --- the save row ----------------------------------------------------------------------------

// spec scenario "一覧の開閉": `save` leads, the blank row follows it, and the settings keep their order behind them.
test("the rows are save, separator, lock, roles, steps", async () => {
	const run = await driveScreen(() => {});
	const shown = run.text();

	// Save is the first line and the separator the second, then the lock, both roles' model and thinking,
	// and the step settings — the rows the spec names, in the order it names them. No line offers to use a
	// role, because the state it existed to create is the state in which save writes nothing.
	const lines = shown.split("\n");
	expect(lines[0]).toContain(ROLE_SAVE_WORD);
	expect(lines[1]!.trim()).toBe("");
	expect(lines[2]).toContain("role lock");
	expect(lines[3]).toContain("normal model");
	expect(lines[4]).toContain("normal thinking");
	expect(lines[5]).toContain("strong model");
	expect(lines[6]).toContain("strong thinking");
	expect(lines[7]).toContain("opsx-propose");
	expect(shown).not.toContain(`use ${MODEL_ROLE_NORMAL}`);
	expect(shown).not.toContain(`use ${MODEL_ROLE_STRONG}`);

	// The separator carries no value and no description. The description area only ever shows the selected
	// row's, so the way to see that the separator has none is to stand on it.
	const onSeparator = await driveScreen((list) => {
		list.selectItem(SEPARATOR_ROW);
	});
	expect(onSeparator.text()).not.toContain("Requests run on the locked role");
	expect(onSeparator.text()).not.toContain("nothing to save");
});

// spec requirement "`save` の見送りは一覧の行と通知に出す" and scenario "一覧の save 行で見送る": the row a user reads before
// pressing and the row they read after pressing say the same thing, the screen stays open on a decline, and
// the file is never asked. The screen is driven with a physical model selected, which is what makes the save
// a decline.
test("a declined save stays open and says why on the row", async () => {
	// The preview, before anything is pressed, on a session sitting on a physical model.
	const opened = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL },
	);
	const preview = opened.text().replace(/\s*\n\s*/g, " ");
	expect(preview).toContain("save declined");
	expect(preview).toContain("a physical model is selected");
	expect(preview).toContain(STATUS_POINTER);
	expect(opened.saveWrites()).toBe(0);

	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ model: FAKE_MODEL, file: { models: { normal: "compat-fake/fake-model" } } },
	);

	// The words are the preview's and not a write's result, and the file was never asked.
	const shown = run.text().replace(/\s*\n\s*/g, " ");
	expect(shown).toContain("save declined");
	expect(shown).toContain(STATUS_POINTER);
	expect(shown).not.toContain("not saved");
	expect(run.saveWrites()).toBe(0);
	expect(run.file()).toEqual({ models: { normal: "compat-fake/fake-model" } });
	// The screen is still open: the component never asked the host to close it, so there is no notice, and
	// no reload for a write that never happened.
	expect(run.closes()).toBe(0);
	expect(run.notices).toEqual([]);
	expect(run.reloads).toBe(0);
	expect(run.phase.current()).toBe(MODEL_ROLE_NORMAL);
});

// spec scenario "一覧の save 行で見送る" read against the rest of the screen: a decline belongs to the one row
// that was pressed, so every other row — the lock row and each ordinary setting row — reads exactly as it did
// before the Enter. The description area only ever shows the selected row's, so the comparison stands the
// cursor on each row in turn and reads the whole line, and the two runs are the same wiring with and without
// the Enter.
test("a declined save leaves the ordinary rows and the lock row unchanged", async () => {
	// The file disagrees with the session on the role, so an unchanged screen is not a screen that had
	// nothing to write: the decline is what keeps the difference unwritten.
	const wiring = { model: FAKE_MODEL, file: { models: { role: MODEL_ROLE_STRONG, normal: "compat-fake/fake-model" } } };
	const rowIds = ["lock", "normal.model", "normal.thinking", "strong.model", "strong.thinking", "step:opsx-propose"];
	const capture = async (pressEnter: boolean) => {
		const lines: string[] = [];
		const run = await driveScreen((list) => {
			list.selectItem(ROLE_SAVE_ROW);
			if (pressEnter) {
				list.handleInput(ENTER);
				expect(screenText(list).replace(/\s*\n\s*/g, " ")).toContain("save declined");
			}
			for (const id of rowIds) {
				list.selectItem(id);
				lines.push(screenText(list).replace(/\s*\n\s*/g, " "));
			}
		}, wiring);
		return { lines, run };
	};

	const before = await capture(false);
	const after = await capture(true);

	// Every row's value column and description, taken with the cursor on it, is byte-for-byte what it was
	// before the Enter.
	after.lines.forEach((line, index) => expect(line).toBe(before.lines[index]));
	// The lock row is the session's lock and not the file's, and the decline left the file's disagreement alone.
	expect(after.lines[0]).toContain("role lock");
	expect(after.lines[0]).not.toContain("saved");
	expect(after.run.file()).toEqual({ models: { role: MODEL_ROLE_STRONG, normal: "compat-fake/fake-model" } });
	expect(after.run.saveAttempts()).toBe(0);
	expect(after.run.closes()).toBe(0);
});

// spec scenario "一覧は手順を名指さず status を示す": the row hands the procedure to the report. Naming an
// operation here would put a selector tutorial on one row of a twelve-row window, and the key that reaches
// it belongs to the host to draw.
test("the save row points to status instead of naming a key", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL, scoped: [FAKE_MODEL] },
	);
	const plain = run.text().replace(/\s*\n\s*/g, " ");

	expect(plain).toContain("run /spirits-role status");
	// Not the selector, not its scope switch, not the scope command, not the key bound to either, and not the
	// scope's own diagnosis — all of which `status` carries.
	expect(plain).not.toContain("/scoped-models");
	expect(plain).not.toContain("model scope");
	expect(plain).not.toContain("Tab");
	expect(plain).not.toContain("press");
});

// spec requirement "`save` の見送りは一覧の行と通知に出す" (見送りのために再読み込みを行ってはならない): the decline adds no write to the list's own
// changes, so a screen whose only action was a declined save closes with nothing to read back.
// spec scenario "一覧は手順を名指さず status を示す" read against "振り分け用モデルが未登録なら手順を名指さない": a row
// that promised "the way to turn it on" would be promising a procedure this session may not have. The pointer
// names the report and the two things it can hold, and it is the same sentence whether or not the catalog
// ever registered the routing model — which is what keeps the promise off the row.
test("the save row's pointer promises the report and not a procedure", () => {
	const selection: SessionSelection = { role: MODEL_ROLE_NORMAL, model: { provider: "compat-fake", id: "fake-model" } };
	// The two catalogs, in the only spelling a row can tell them apart by: what `getAll()` holds.
	const registered = panelOf({
		routingOff: true,
		currentModel: "compat-fake/fake-model",
		saveSelection: selection,
		lookup: registry([AUTO, FAKE_MODEL, FAKE_STRONG]),
	});
	const neverRegistered = panelOf({
		routingOff: true,
		currentModel: "compat-fake/fake-model",
		saveSelection: selection,
		lookup: registry([FAKE_MODEL, FAKE_STRONG]),
	});

	const pointer = rowOf(registered.panel, ROLE_SAVE_ROW).description;
	// One sentence for both catalogs.
	expect(rowOf(neverRegistered.panel, ROLE_SAVE_ROW).description).toBe(pointer);
	expect(pointer).toContain("save declined");
	expect(pointer).toContain(STATUS_POINTER);
	// Neither the selector, nor its scope switch, nor the scope command, nor a key bound to either, nor the
	// scope's own diagnosis.
	for (const named of ["/model", "/scoped-models", "model scope", "Tab", "press", "enabledModels"]) {
		expect(pointer).not.toContain(named);
	}
});

// spec scenario "一覧は手順を名指さず status を示す": the report is where the two off states part. A scope that
// leaves the routing model out gets an operation to run; a catalog that never registered it gets the reason
// there is none. Both answers are read off the host the list ran on.
test("status answers the pointer with the procedure or with the reason there is none", async () => {
	// The routing model is registered, and the session's scope is what keeps it out of reach.
	const registered = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL, scoped: [FAKE_MODEL] },
	);
	const registeredReport = await statusLine(registered.pi, {
		model: FAKE_MODEL,
		scopedModels: [{ model: FAKE_MODEL }],
		authedProviders: ["compat-fake"],
	});
	expect(registeredReport).toContain("/model");
	expect(registeredReport).not.toContain("model catalog");

	// The routing model is nowhere in the catalog, so no selector reaches it and no operation can be named.
	const missing = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: PHYSICAL_AUTO, available: [PHYSICAL_AUTO, FAKE_MODEL, FAKE_STRONG] },
	);
	const missingReport = await statusLine(missing.pi, {
		model: PHYSICAL_AUTO,
		available: [PHYSICAL_AUTO, FAKE_MODEL, FAKE_STRONG],
		authedProviders: ["compat-fake"],
	});
	expect(missingReport).toContain("is not in this session's model catalog");
	expect(missingReport).not.toContain("to enable: select");
});

test("a declined save alone reloads nothing on close", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ model: FAKE_MODEL },
	);

	expect(run.text()).toContain("save declined");
	expect(run.reloads).toBe(0);
});

// spec scenario "一覧の save 行で見送る": an ordinary edit still earns the one close-time
// reload, and a decline beside it neither adds one nor takes one away.
test("a declined save keeps the one close-time reload for earlier edits", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("normal.thinking");
			list.handleInput(ENTER);
			list.handleInput(UP);
			// The level list closes itself when it hands its choice back, so no Escape — which asks the whole
			// screen to close — is needed to get back to the rows.
			list.handleInput(ENTER);
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ model: FAKE_MODEL },
	);

	expect(run.text()).toContain("save declined");
	expect(run.saveWrites()).toBe(0);
	// The decline asked the screen to close nothing: the only close request is the one the earlier edit
	// leaves behind, and here the earlier edit closes nothing either — it is the close-time reload that
	// belongs to it.
	expect(run.closes()).toBe(0);
	expect(run.reloads).toBe(1);
});

// spec scenario "見送りの理由は予告を置き換える": the lead and the decline are two
// sentences about one state, and the row says each once. Counted in plain text, because each half is styled
// differently and a test of wording is a test of words.
test("a declined save says routing is off once on the row", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL },
	);
	const plain = run.text().replace(/\s*\n\s*/g, " ");

	expect(plain.split("routing is off").length - 1).toBe(1);
	expect(plain).toContain("compat-fake/fake-model is selected");
	// The row holds no procedure and no scope diagnosis, which are the report's (spec
	// 一覧は手順を名指さず status を示す).
	expect(plain).not.toContain("/model");
	expect(plain).not.toContain("/scoped-models");
	expect(plain).not.toContain("model scope");
});

// spec scenario "global が読めないときも見送り理由が行に出る": the decline outranks the read failure, because the
// file was never the thing that stopped the write.
test("the save row declines even when the global settings cannot be read", async () => {
	// The preview reads the global file, and that read is what fails here. The row still leads with the
	// decline, because the file is not the reason nothing is written.
	const preview = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL, failSaveRead: true },
	);
	expect(preview.text()).toContain("save declined");
	expect(preview.text()).not.toContain("nothing to preview");

	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ model: FAKE_MODEL, failSaveRead: true },
	);

	expect(run.text()).toContain("save declined");
	expect(run.text()).not.toContain("nothing to preview");
	// The count that matters is the request, not the rewrite: a no-op rewrites nothing and a decline is never
	// asked, and only the request separates them.
	expect(run.saveAttempts()).toBe(0);
	expect(run.saveWrites()).toBe(0);
	expect(run.closes()).toBe(0);
});

// spec `物理モデルを選択中は save が global 設定を見送る` (振り分け用と認めるには識別子と仮想モデルの種別の両方が一致
// しなければならない): a physical catalog entry that spells `spirits/auto` is a physical model, so the row
// declines it exactly as it declines any other. An identifier-only test would write this session's selection
// into the global defaults behind a routing that never ran.
test("a physical model named spirits/auto is declined by the save row", async () => {
	const wiring = { model: PHYSICAL_AUTO, available: [PHYSICAL_AUTO, FAKE_MODEL, FAKE_STRONG], file: { models: { role: MODEL_ROLE_STRONG } } };

	const preview = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
		},
		wiring,
	);
	const shownPreview = preview.text().replace(/\s*\n\s*/g, " ");
	expect(shownPreview).toContain("save declined");
	expect(shownPreview).not.toContain("saves role");

	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		wiring,
	);
	expect(run.text().replace(/\s*\n\s*/g, " ")).toContain("save declined");
	expect(run.saveAttempts()).toBe(0);
	expect(run.saveWrites()).toBe(0);
	expect(run.file()).toEqual({ models: { role: MODEL_ROLE_STRONG } });
	expect(run.closes()).toBe(0);
	expect(run.reloads).toBe(0);
});

// spec scenario "見送りの理由は再描画の失敗で失われない": the decline the row carried into a refresh that could
// not read the session is still on the row, with the ordinary rows marked stale beside it.
test("a declined save keeps its reason when the redraw fails", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
			expect(screenText(list)).toContain("save declined");
			list.selectItem("normal.model");
			expect(screenText(list)).toContain("not redrawn:");
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ model: FAKE_MODEL, failRead: 3 },
	);

	const shown = run.text().replace(/\s*\n\s*/g, " ");
	expect(shown).toContain("save declined");
	expect(shown).toContain(STATUS_POINTER);
	expect(run.closes()).toBe(0);
	expect(run.notices).toEqual([]);
	expect(run.reloads).toBe(0);
});

// spec scenario "区行は操作を受け付けない": Enter, Space, and a click are the three ways to activate a row,
// and none of them opens a list of candidates or writes anything.
test("the blank row takes no action", async () => {
	for (const key of [ENTER, " "]) {
		const run = await driveScreen((list) => {
			list.selectItem(SEPARATOR_ROW);
			list.handleInput(key);
			// Still the settings list: no choice list, and no description replaced by one.
			expect(screenText(list)).toContain("role lock");
			expect(screenText(list)).not.toContain("back to unset");
		});
		expect(run.written).toEqual([]);
		expect(run.saveWrites()).toBe(0);
		expect(run.file()).toEqual({});
		expect(run.reloads).toBe(0);
	}

	const clicked = await driveScreen((list) => {
		list.selectItem(SEPARATOR_ROW);
		activateByMouse(list);
		expect(screenText(list)).not.toContain("back to unset");
	});
	expect(clicked.written).toEqual([]);
	expect(clicked.saveWrites()).toBe(0);
});

// spec scenario "save は確認 Enter だけで作動する": the three activation gestures reach the host list as one
// callback, and only the Enter this session confirms with writes.
test("the save row acts on Enter only", async () => {
	// Space and a click come to the same activation the save row answers to, and must not be taken for it.
	const space = await driveScreen((list) => {
		list.selectItem(ROLE_SAVE_ROW);
		list.handleInput(" ");
		// No candidate list opened: the row has one value and nothing to choose among.
		expect(screenText(list)).not.toContain("back to unset");
	});
	expect(space.saveWrites()).toBe(0);
	expect(space.file()).toEqual({});
	expect(space.reloads).toBe(0);

	const clicked = await driveScreen((list) => {
		list.selectItem(ROLE_SAVE_ROW);
		activateByMouse(list);
	});
	expect(clicked.saveWrites()).toBe(0);
	expect(clicked.file()).toEqual({});
	expect(clicked.reloads).toBe(0);

	// Enter writes, and writes once.
	const entered = await driveScreen((list) => {
		list.selectItem(ROLE_SAVE_ROW);
		list.handleInput(ENTER);
	});
	expect(entered.saveWrites()).toBe(1);
	expect(entered.file().models).toEqual({ role: "normal" });
	// A save leaves this session alone, so even closing the screen costs no restart (spec
	// `managed-commands` / save はディスク上の結果と実効状態を区別する).
	expect(entered.reloads).toBe(0);
});

// spec scenario "save は確認 Enter だけで作動する" for a session that moved the confirm key: Enter is no
// longer the list's confirm input, so neither key saves, and the command is the way round (documented in
// the READMEs).
test("a moved confirm key leaves the save row to the command", async () => {
	const moved = useConfirmKey("ctrl+y");
	try {
		const run = await driveScreen((list) => {
			list.selectItem(ROLE_SAVE_ROW);
			// Enter no longer confirms, so the list does not activate the row at all.
			list.handleInput(ENTER);
			// The key this session confirms with activates it, and is still not Enter.
			list.handleInput("\x19");
		});
		expect(run.saveWrites()).toBe(0);
		expect(run.file()).toEqual({});
	} finally {
		moved.restore();
	}
});

// spec scenario "save は確認 Enter だけで作動する" and the row's own contract: a key that was refused
// leaves the row's right-hand column empty, because the row is an action and has no value to show.
test("the save row stays blank after a refused key", async () => {
	const refused = await driveScreen((list) => {
		list.selectItem(ROLE_SAVE_ROW);
		list.handleInput(" ");
	});
	// `SettingsList` writes the cycled value into the row before it calls back, so the value the row was
	// given has to be the blank it started with.
	expect(refused.saveWrites()).toBe(0);

	// The save row owns no value, so the line it draws is its label with the cursor in front of it and
	// nothing on the right, whatever the key did.
	const saveLine = refused.text().split("\n").find((line) => line.includes(ROLE_SAVE_WORD));
	expect(saveLine?.trimEnd()).toBe(`\u2192 ${ROLE_SAVE_WORD}`);
});

// spec scenario "見送りの理由は再描画の失敗で失われない": the decline is held by the panel, so a redraw
// that cannot read the session keeps the result rather than falling back to the preview.
test("the save row keeps its result when the redraw fails", async () => {
	// Read 1 builds the screen, read 2 is the save's own read, read 3 is the redraw that follows it.
	const unreadable = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			expect(() => list.handleInput(ENTER)).not.toThrow();
		},
		{ failRead: 3 },
	);
	const shown = unreadable.text().replace(/\s*\n\s*/g, " ");
	// The file accepted the write, and the row says so rather than the preview it opened with.
	expect(shown).toContain("saved");
	expect(shown).not.toContain("to pi's global settings");
	// The right-hand column is still the blank the row owns.
	const saveLine = unreadable.text().split("\n").find((line) => line.includes(ROLE_SAVE_WORD));
	expect(saveLine?.trimEnd()).toBe(`\u2192 ${ROLE_SAVE_WORD}`);
	expect(unreadable.saveWrites()).toBe(1);
	// A save alone earns no reload, redrawn or not.
	expect(unreadable.reloads).toBe(0);
});

// design Decision 5: the injected `readGlobalSettings` is a test seam, and the production default is
// pi's own global settings file. Pinned here by pointing the host's agent dir at a temp directory and
// leaving the seam out, so the preview is read from the real path the product reads.
test("the save row previews pi's real global settings file by default", async () => {
	const dir = mkdtempSync(join(tmpdir(), "spirits-global-default-"));
	const previous = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = dir;
	try {
		writeFileSync(
			join(dir, "settings.json"),
			JSON.stringify({ models: { role: "strong" }, defaultProvider: "compat-fake", defaultModel: "fake-model" }, null, 2),
			"utf-8",
		);
		const run = await driveScreen(() => {}, { defaultGlobalRead: true });
		expect(run.text().replace(/\s*\n\s*/g, " ")).toContain("saves role strong \u2192 normal");
	} finally {
		if (previous === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

// spec scenario "save はディスク上の結果と実効状態を区別する" for the preview: the row names the file's value
// and the value Enter would put there, and it says so once.
test("the save row states what it would write and what it skips", async () => {
	// The file holds `strong` and a physical default; the session locked normal and selected the routing
	// model with nothing behind it.
	const preview = await driveScreen(() => {}, {
		file: { models: { role: "strong" }, defaultProvider: "compat-fake", defaultModel: "fake-model" },
		model: AUTO,
	});
	const shown = preview.text().replace(/\s*\n\s*/g, " ");
	expect(shown).toContain("saves role strong \u2192 normal");
	// The global file has no `models.normal` a new session could resolve on its own, so the row says why the
	// model keys stay out instead of previewing `spirits/auto` as a default no fresh session could answer on.
	expect(shown).toContain("the routing model needs a global models.normal");
	expect(shown).not.toContain("default model unset");

	// No model at all: the row still previews the role, with the session-level reason beside it.
	const none = await driveScreen(() => {}, { file: { models: { role: "strong" } }, noModel: true });
	const noneShown = none.text().replace(/\s*\n\s*/g, " ");
	expect(noneShown).toContain("saves role strong \u2192 normal");
	expect(noneShown).toContain("no model is selected");

	// The routing-off statement, when the session is on a physical model, is stated once on this row too.
	const off = await driveScreen(() => {}, { model: FAKE_MODEL, file: { models: { role: "normal" } } });
	expect(off.text().match(/routing is off/g)).toHaveLength(1);

	// Nothing differs and nothing was skipped: the row says so and leaves the file alone. The routing model is
	// selected here because a physical one declines before it ever compares the file (spec
	// 物理モデルを選択中は `save` が global 設定を見送る).
	const settled = await driveScreen(() => {}, {
		file: { models: { role: "normal" }, defaultProvider: "compat-fake", defaultModel: "fake-model" },
		model: AUTO,
	});
	expect(settled.text().replace(/\s*\n\s*/g, " ")).toContain("nothing to save");

	// The file will not read: the row carries the reason, and the ordinary rows are still there to use.
	const unreadable = await driveScreen(() => {}, { failSaveRead: true });
	expect(unreadable.text().replace(/\s*\n\s*/g, " ")).toContain("the global settings file is unreadable");
	expect(unreadable.text()).toContain("normal model");
	expect(unreadable.text()).toContain("opsx-propose");
	// A screen whose preview could not be built still edits settings.
	const edited = await driveScreen((list) => {
		list.selectItem("normal.thinking");
		list.handleInput(ENTER);
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(ENTER);
	}, { failSaveRead: true });
	expect(edited.written).toEqual([{ path: ["models", "thinking", "normal"], value: "high" }]);
});

// spec "save はディスク上の結果と実効状態を区別する": once the row has been used it reports the file, and a
// later redraw does not turn that back into a promise.
test("the save row reports what reached the global file", async () => {
	const run = await driveScreen((list) => {
		list.selectItem(ROLE_SAVE_ROW);
		list.handleInput(ENTER);
		// The row moved from a preview to a result, and the rows below it are untouched by it.
		expect(screenText(list).replace(/\s*\n\s*/g, " ")).toContain("saved");
		// Pressing it again finds nothing left to write, and the row says the newer fact.
		list.handleInput(ENTER);
	});
	const shown = run.text().replace(/\s*\n\s*/g, " ");
	expect(shown).toContain("nothing to save");
	// A result never keeps previewing: the row no longer promises a write to the file.
	expect(shown).not.toContain("to pi's global settings");
	expect(run.saveWrites()).toBe(1);
	expect(run.file()).toEqual({ models: { role: "normal" } });
});

// spec scenario "保存の失敗はセッションの変更を取り消さない" and scenario "先行する編集の成功は save の失敗で
// 取り消されない": a save that the file refused says so on its row, changes nothing, and does not take back
// the reload an earlier edit earned.
test("a failed save keeps the session and says why on the row", async () => {
	const only = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			expect(() => list.handleInput(ENTER)).not.toThrow();
		},
		{ failSave: true },
	);
	expect(only.text()).toContain("read-only");
	expect(only.saveWrites()).toBe(0);
	expect(only.file()).toEqual({});
	expect(only.phase.current()).toBe("normal");
	expect(only.phase.step()).toBeUndefined();
	// The screen stayed open under a refused key — the host calls `handleInput` without a try. The rendered
	// text is not the evidence here: the fake host renders a component it has already been told to close, so
	// "still readable" and "still open" are different claims and only `done()` tells them apart.
	expect(only.closes()).toBe(0);
	expect(only.text()).toContain("role lock");
	// Nothing reached the file, so closing costs no runtime restart.
	expect(only.reloads).toBe(0);

	// The same refusal after an ordinary edit that did land still reloads once, for the edit's sake.
	const afterEdit = await driveScreen(
		(list) => {
			list.selectItem("normal.thinking");
			list.handleInput(ENTER);
			list.handleInput(UP);
			list.handleInput(UP);
			list.handleInput(UP);
			list.handleInput(ENTER);
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ failSave: true },
	);
	expect(afterEdit.written).toEqual([{ path: ["models", "thinking", "normal"], value: "high" }]);
	expect(afterEdit.text()).toContain("read-only");
	expect(afterEdit.reloads).toBe(1);
});

// spec "save はディスク上の結果と実効状態を区別する": a save writes the next session's defaults and
// leaves this one alone, so a screen that only saved closes without a restart — failed, unchanged, or
// landed alike.
test("a save alone reloads nothing on close", async () => {
	for (const options of [
		{ file: { models: { role: "strong" } } },
		{ file: { models: { role: "normal" }, defaultProvider: "compat-fake", defaultModel: "fake-model" }, model: FAKE_MODEL },
		{ failSave: true },
	]) {
		const run = await driveScreen(
			(list) => {
				list.selectItem(ROLE_SAVE_ROW);
				expect(() => list.handleInput(ENTER)).not.toThrow();
			},
			options,
		);
		expect(run.reloads).toBe(0);
	}
});

// spec scenario "成立した保存は一覧を閉じて通知する" and "差分がない保存はエラーではない": a save that closes
// leaves its result in a notice, and neither a write nor a no-op is reported as an error.
test("a closing save reports its result as information", async () => {
	const landed = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ file: { models: { normal: "compat-fake/fake-model" } } },
	);
	expect(landed.file()).toEqual({
		defaultProvider: "spirits",
		defaultModel: "auto",
		models: { role: MODEL_ROLE_NORMAL, normal: "compat-fake/fake-model" },
	});
	expect(landed.notices).toHaveLength(1);
	expect(landed.notices[0]).toContain("saved");
	expect(landed.notifications[0]?.type).toBe("info");
	// The positive control for the decline tests: a save that lands is the screen asking to close, once.
	expect(landed.closes()).toBe(1);
	// A save alone writes the next session's defaults and asks for no reload.
	expect(landed.reloads).toBe(0);

	const unchanged = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ file: { defaultProvider: "spirits", defaultModel: "auto", models: { role: MODEL_ROLE_NORMAL, normal: "compat-fake/fake-model" } } },
	);
	expect(unchanged.saveWrites()).toBe(0);
	expect(unchanged.notices[0]).toContain("nothing to save");
	expect(unchanged.notifications[0]?.type).toBe("info");
	// A no-op closes too: there is nothing on the row a reader still needs.
	expect(unchanged.closes()).toBe(1);
});

// spec scenario "成立した保存は一覧を閉じて通知する": a landed save closes with its result in a notice and
// does not trigger a reload.
test("a landed save closes and notifies without reloading", async () => {
	const save = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ file: { models: { normal: "compat-fake/fake-model" } } },
	);
	expect(save.reloads).toBe(0);
	expect(save.notices.at(-1)).toContain("saved");
	expect(save.notifications.at(-1)?.type).toBe("info");
});

// spec scenario "失敗の理由は再描画の失敗でも失われない": the save row keeps the file's refusal, and an
// ordinary row says its effective settings could not be redrawn. Neither fact makes a save-only screen reload.
test("a failed save keeps its reason when the ordinary rows cannot redraw", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
			// The action row retains the save failure even after the host settings read fails.
			expect(screenText(list)).toContain("not saved");
			expect(screenText(list)).toContain("read-only");

			// The same failed refresh marks ordinary rows, rather than making their old effective values look fresh.
			list.selectItem("normal.model");
			expect(screenText(list)).toContain("not redrawn:");
			expect(screenText(list)).toContain("settings file went unreadable");
			list.selectItem(ROLE_SAVE_ROW);
		},
		{ failSave: true, failRead: 3 },
	);

	const shown = run.text();
	expect(shown).toContain("not saved");
	expect(shown).toContain("read-only");
	expect(run.saveWrites()).toBe(0);
	expect(run.reloads).toBe(0);
});

// spec scenario "先行する編集の成功は save の失敗で取り消されない": the reload belongs to an ordinary edit,
// and a save beside it neither adds one nor takes one away.
test("a save plus a normal edit reloads once on close", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("normal.thinking");
			list.handleInput(ENTER);
			list.handleInput(UP);
			list.handleInput(UP);
			list.handleInput(UP);
			list.handleInput(ENTER);
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
		},
		{ file: { models: { role: "strong" } } },
	);
	expect(run.written).toEqual([{ path: ["models", "thinking", "normal"], value: "high" }]);
	expect(run.saveWrites()).toBe(1);
	// One reload for the edit, on close — not one per change and not one for the save.
	expect(run.reloads).toBe(1);
});

// spec scenario "global と project が異なる": the save writes the global file and the rest of the screen
// keeps reporting what the session actually runs on, which is the project's answer.
test("global saves leave effective project values alone", async () => {
	// The global file says `strong`; the host's effective settings — the global file merged with the trusted
	// project file — say `normal`, and that is what the session locked.
	// The global file says `strong` and carries a `models.normal` the routing model can resolve on. The
	// effective settings are the merged answer, and the ordinary rows report that, not the global file.
	const screen = {
		file: { models: { role: "strong", normal: "compat-fake/fake-strong" } },
		settings: { models: { role: "normal", normal: "compat-fake/fake-model", strong: "compat-fake/fake-strong" } },
	};
	const before = await driveScreen(() => {}, screen);
	const preview = before.text().replace(/\s*\n\s*/g, " ");
	// The row names the global file's value and the change, because that is the file the write goes to —
	// even though the effective settings already answer `normal`.
	expect(preview).toContain("saves role strong \u2192 normal");
	expect(preview).toContain("default model unset \u2192 spirits/auto");
	// The ordinary rows read the effective settings, so the normal model row still reports the project's
	// `models.normal` (`compat-fake/fake-model`), not the global file's (`compat-fake/fake-strong`).
	expect(preview).toContain("normal model              compat-fake/fake-model");

	const run = await driveScreen(
		(list) => {
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
			// The rows under the save row are unchanged by it: they still read the host's settings, and the
			// save's own keys are never folded onto them (design Decision 7).
			expect(screenText(list)).toContain("normal model              compat-fake/fake-model");
		},
		screen,
	);
	// Only the global file changed, and only for the keys `save` owns.
	expect(run.file()).toEqual({
		models: { role: "normal", normal: "compat-fake/fake-strong" },
		defaultProvider: "spirits",
		defaultModel: "auto",
	});
	expect(run.written).toEqual([]);
});

// spec scenario "一覧を開いた後に global が変わる", driven against pi's real settings file through the list's own
// save path. The decision is made again on the file's content under the file's lock, so a change that landed
// between the preview and the Enter is a change this row does not rewrite — and a write that turns out to
// change nothing costs the file neither its bytes nor its modification time.
/**
 * Land an update from a separate process, the way another pi session's save does.
 *
 * The claim this case rests on is that the bytes on disk changed after the preview was built, and a write
 * from this process cannot stand in for that: the extension's own read under its lock runs in this process,
 * so an in-process write proves the decision reads the file and says nothing about a writer that is not us.
 */
function writeFromAnotherProcess(path: string, contents: string): void {
	const result = spawnSync("/bin/sh", ["-c", 'printf "%s" "$SPIRITS_OTHER_WRITER" > "$1"', "sh", path], {
		env: { ...process.env, SPIRITS_OTHER_WRITER: contents },
		stdio: "ignore",
	});
	if (result.status !== 0) throw new Error(`the other writer exited ${String(result.status)}`);
}

test("a save entered after another writer lands the same default writes nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "spirits-save-race-"));
	const settingsPath = join(dir, SETTINGS_FILE_NAME);
	// The role already matches the lock and the file resolves normal on its own, so the one thing the preview
	// can promise is the default model.
	writeFileSync(settingsPath, JSON.stringify({ models: { role: "normal", normal: "compat-fake/fake-model" }, theme: "dark" }, null, 2), "utf-8");
	// Another writer lands exactly that default, plus an unrelated key of its own.
	const otherWriter = JSON.stringify(
		{ models: { role: "normal", normal: "compat-fake/fake-model" }, defaultProvider: "spirits", defaultModel: "auto", theme: "light" },
		null,
		2,
	);
	let otherWriterMtime = 0;
	try {
		const run = await driveScreen((list) => {
			// The screen opened on the file's old default and promised the routing model in its place.
			expect(screenText(list).replace(/\s*\n\s*/g, " ")).toContain("default model unset \u2192 spirits/auto");
			writeFromAnotherProcess(settingsPath, otherWriter);
			otherWriterMtime = statSync(settingsPath).mtimeMs;

			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
			// The row re-decided on the file rather than repeating the preview it opened with, against bytes a
			// separate process put there.
			expect(screenText(list).replace(/\s*\n\s*/g, " ")).toContain("nothing to save");
		}, { model: AUTO, realGlobalDir: dir });

		// Neither the default model's two keys nor the key this operation does not own were rewritten, and a
		// write that found nothing to change left the modification time alone.
		expect(readFileSync(settingsPath, "utf-8")).toBe(otherWriter);
		expect(statSync(settingsPath).mtimeMs).toBe(otherWriterMtime);
		expect(run.reloads).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// spec scenario "信頼済み project が global を上書きする": the list's save writes pi's global file, and the ordinary
// rows and the report go on answering with the project's settings — before the write, after the close-time
// notice, and after a reload that re-reads both files.
//
// What is observed here and what is built by hand are different things, and this is where they part: the
// fake host keeps whatever settings it was handed, so the merge of the global file and the trusted project
// file is composed by the test with the same primitive the settings writer uses, not read out of a running
// host. The save, the close-time notice, the rows, and the report all run for real against a temp global
// file and the injected merge; only the host's own merge step is stood in for.
test("a trusted project still answers after the save and the reload", async () => {
	// The global file says `strong` and resolves normal on `compat-fake/fake-strong`. The trusted project
	// overrides the defaults with `normal` on `compat-fake/fake-model`, and that is what the session runs on.
	const globalFile = { models: { role: MODEL_ROLE_STRONG, normal: "compat-fake/fake-strong" } };
	const project = { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: MODEL_ROLE_NORMAL, normal: "compat-fake/fake-model" } };
	const normalRow = (text: string) => text.split("\n").find((line) => line.includes("normal model")) ?? "";

	const saved = await driveScreen(
		(list) => {
			// Before the write, the row reports the project's target.
			expect(normalRow(screenText(list))).toContain("compat-fake/fake-model");
			list.selectItem(ROLE_SAVE_ROW);
			list.handleInput(ENTER);
			expect(normalRow(screenText(list))).toContain("compat-fake/fake-model");
		},
		{ file: { ...globalFile }, settings: mergeSettingsPatch(globalFile, project) },
	);
	// The save closed the screen and told the user once, as information, and asked for no reload.
	expect(saved.closes()).toBe(1);
	expect(saved.notices).toHaveLength(1);
	expect(saved.notices[0]).toContain("saved");
	expect(saved.notifications[0]?.type).toBe("info");
	expect(saved.reloads).toBe(0);

	// The global file holds the session's selection now, and only the keys `save` owns.
	expect(saved.file()).toEqual({
		models: { role: MODEL_ROLE_NORMAL, normal: "compat-fake/fake-strong" },
		defaultProvider: "spirits",
		defaultModel: "auto",
	});

	// The report on the wiring that just saved still answers with the project's target: the save wrote the
	// file, and nothing reloaded the merged settings the host holds.
	const reportBeforeReload = await statusLine(saved.pi, { model: AUTO, authedProviders: ["compat-fake"] });
	expect(reportBeforeReload).toMatch(/normal: compat-fake\/fake-model/);
	expect(reportBeforeReload).not.toContain("compat-fake/fake-strong");

	// A reload re-reads pi's settings from the two files, and the project still wins. The ordinary rows report
	// that merge, and a normal edit is what earns the one reload — the save alone earns none.
	const afterReload = mergeSettingsPatch(saved.file(), project);
	const reloaded = await driveScreen(
		(list) => {
			list.selectItem("normal.thinking");
			list.handleInput(ENTER);
			list.handleInput(UP);
			list.handleInput(ENTER);
			list.handleInput(ESCAPE);
		},
		{ file: saved.file(), settings: afterReload },
	);
	expect(reloaded.reloads).toBe(1);
	expect(normalRow(reloaded.text())).toContain("compat-fake/fake-model");

	// The report reads the same merge and names the same target, so the two surfaces still agree on the
	// project's answer after the defaults the save wrote are on disk. `afterReload` is the merge the test
	// composes (see the header above): what is observed is that both surfaces follow whatever merge the host
	// hands them, not that a real host produces this one.
	saved.pi.getSettings = () => afterReload;
	const report = await statusLine(saved.pi, { model: AUTO, authedProviders: ["compat-fake"] });
	expect(report).toMatch(/normal: compat-fake\/fake-model/);
});

/**
 * Activate the row under the cursor the way a terminal's click does.
 *
 * `SettingsList` reads a press and a click as a pair of events on a row index, so the test drives both
 * rather than reaching into the component for the activation behind them.
 */
function activateByMouse(list: ScreenList): void {
	const withMouse = list as unknown as {
		handleMouse(event: { type: string; button: string; x: number; y: number }): unknown;
	};
	// The cursor the test just moved to is the row a click on the first list line lands on.
	withMouse.handleMouse({ type: "press", button: "left", x: 2, y: 0 });
	withMouse.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
}

/**
 * Point the list's confirm key somewhere else for one test.
 *
 * The rule under test is that `save` answers the Enter the session confirms with, and that is only visible
 * by moving the binding: with the default the two agree, and only the disagreement shows the rule. This
 * goes through pi-tui's own configuration rather than a stand-in, so the list under the keys is the one the
 * host would build.
 */
function useConfirmKey(key: KeyId): { restore(): void } {
	const previous = getKeybindings();
	setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": key }));
	return {
		restore: () => {
			setKeybindings(previous);
		},
	};
}

// --- the screen -------------------------------------------------------------------------------

// spec scenario "一覧での編集は行の説明で伝える": the list has no notices, so a change that a command
// would announce has to be readable on the row. A physical selection and an unset strong are two
// separate facts, and both belong on the lock row.
test("a list edit on a physical model sends no notice", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		{
			model: FAKE_MODEL,
			settings: { defaultProvider: "compat-fake", defaultModel: "fake-model" },
		},
	);

	// No notice stack behind the screen a user is still reading.
	expect(run.notices).toEqual([]);
	const shown = run.text();
	// The lead names the model the session sits on, because "off" is a statement about that selection, and
	// it says once: the warning below it adds no second copy of the same fact (spec
	// `managed-commands` / 振り分けが働いていない旨は 1 つの説明に 1 度だけ出す).
	expect(shown).toContain("routing is off while compat-fake/fake-model is selected");
	expect(shown.match(/routing is off/g)).toHaveLength(1);
	// The sentence wraps at the screen width, so check the words rather than the unbroken line.
	expect(shown).toContain("strong has no");
	expect(shown).toContain("usable model");
});

// spec scenario "振り分けが無効なときは仮定法で述べる": the rows go on describing the routing's resolution —
// that is the whole reason to read them on a session that is not routing — but they say it as the
// assumption it is, and every one of them says which model the session sits on instead of leaving the user
// to work out which session they are looking at.
test("every row leads with the routing being off and answers in the conditional", () => {
	const { panel } = panelOf({
		routingOff: true,
		currentModel: "compat-fake/fake-model",
		settings: { ...SETTINGS, steps: { "opsx-propose": { role: "strong", thinking: "high" } } },
	});

	// The action rows and the separator are the rows the resolution rules do not reach: the separator
	// has no description, the action rows describe the lock and the settings file rather than a request.
	// They still state the routing being off once when it is off, which is the next case's business.
	for (const row of panel.rows()) {
		if (row.id === ROLE_SAVE_ROW || row.id === SEPARATOR_ROW) continue;
		expect(row.description.startsWith("routing is off while compat-fake/fake-model is selected;")).toBe(true);
	}

	const step = rowOf(panel, "step:opsx-propose");
	expect(step.description).toContain("It would answer with compat-fake/fake-strong");
	expect(step.description).toContain("It would ask for high");
	expect(step.description).not.toContain("It answers with");
	// The level row speaks the same mood; which level it names is a separate rule, checked elsewhere.
	expect(rowOf(panel, "strong.thinking").description).toContain("strong requests would ask for");
});

// spec scenario "振り分けが働いていない旨は 1 つの説明に 1 度だけ出す": the warning a command would send and the
// lead every row carries are two ways of stating one fact, and a row that stated it twice would read as two
// separate failures.
test("a row on a physical model states the routing being off once", () => {
	const { panel } = panelOf({
		routingOff: true,
		currentModel: "compat-fake/fake-model",
		lock: "strong",
		settings: { defaultProvider: "compat-fake", defaultModelId: "fake-model" },
	});

	for (const id of ["lock", "strong.model", "strong.thinking", "step:opsx-propose"]) {
		expect(rowOf(panel, id).description.match(/routing is off/g)).toHaveLength(1);
	}
	// The rows that set or run on strong carry the other half, which is the part the lead says nothing about.
	expect(rowOf(panel, "lock").description).toContain("strong has no usable model");
	expect(rowOf(panel, "strong.model").description).toContain("strong has no usable model");
});

// spec scenario "一覧の候補はセッションのスコープで制限しない": a role's target is resolved without regard to the
// session's scope — the routing reaches it and the command line writes it — so the row offers every model
// that can answer. Intersecting the candidates with the scope made a rule only this screen had, and on a
// session scoped to `spirits/auto` alone it left nothing to offer: not a target, and not even the way back
// to `unset`.
test("the candidates are every model that can answer, whatever the session's scope", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("strong.model");
			list.handleInput(ENTER);
			const submenu = screenText(list);
			expect(submenu).toContain("compat-fake/fake-model");
			expect(submenu).toContain("compat-fake/fake-strong");
			expect(submenu).toContain("back to unset");
			list.handleInput(ESCAPE);
		},
		{ scoped: [AUTO], settings: { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } } },
	);

	expect(run.written).toEqual([]);
	// And no row diagnoses a scope the resolution never consulted.
	expect(run.text()).not.toContain("outside the models this session selects");
});

// spec "managed-commands / 一覧の説明は実際の解決結果を示す": the scope and its operations are `status`'s
// business, not the list's, and the routing-off sentence is stated once per row rather than once per fact
// about the session. Counted here because both halves are things a row must not do.
test("a row states the routing being off once and says nothing about the scope", () => {
	const { panel } = panelOf({
		routingOff: true,
		currentModel: "compat-fake/fake-model",
		lock: "strong",
		settings: { ...SETTINGS, strong: { provider: "compat-fake", modelId: "nowhere" } },
	});

	for (const row of panel.rows()) {
		if (row.id === SEPARATOR_ROW) continue;
		expect(row.description.match(/routing is off/g)).toHaveLength(1);
		expect(row.description).not.toContain("scope");
		expect(row.description).not.toContain("enabledModels");
		expect(row.description).not.toContain("/scoped-models");
	}
});

// spec `managed-commands` / 一覧のロックの行は保存に失敗してもセッションのロックを示す, read against
// 「badge は解決した応答ロール」「行の値はロック」: the row's value is the lock the session holds and the badge
// is the role that answers, which are two different answers wherever strong has nothing to run on.
test("the lock row keeps the lock while the badge follows the resolution", async () => {
	// strong cannot answer: the row still says strong, because that is what the session locked, and the badge
	// says normal with the model that does answer.
	const fallback = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		// A strong target the catalog does not hold, and a settings file that refuses the lock as well.
		{ failLock: true, settings: { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "nowhere/nothing" } } },
	);

	expect(fallback.phase.lock()).toBe("strong");
	expect(fallback.text()).toMatch(/role lock\s+strong/);
	expect(fallback.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(fallback.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-model");

	// With a strong that can answer, the two agree, level included — which is the case that makes the row and
	// the badge the same statement rather than two answers to two questions.
	const usable = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		{
			failLock: true,
			settings: {
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { strong: "compat-fake/fake-strong", thinking: { strong: "low" } },
			},
		},
	);

	expect(usable.statuses.get(ROLE_STATUS_KEY)).toBe("[strong low]");
	expect(usable.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-strong");
});

// The list, the badge, and the report are three surfaces over one resolution, so on one GIVEN they cannot
// name different models or different levels. This drives all three off one wiring, which is the only way a
// divergence between them would show up (spec `managed-commands` / 一覧の説明は実際の解決結果を示す and
// status のロックと解決結果は実際の位相と解決を示す).
test("the list, the badge, and the report read one resolution", async () => {
	const settings = {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "nowhere/nothing", thinking: { normal: "low", strong: "max" }, steps: { "opsx-propose": { role: "strong" } } },
	};

	const screen = await driveScreen((list) => list.selectItem("step:opsx-propose"), { settings });
	// The screen wraps at its width, so the description is read unwrapped: what matters here is which model
	// and which level the row names, not where the line broke.
	const shown = screen.text().replace(/\s*\n\s*/g, " ");
	const report = await statusLine(screen.pi, { authedProviders: ["compat-fake"] });

	// What a strong request answers on, in both surfaces: the model that does answer, not the target that
	// cannot.
	expect(shown).toContain("compat-fake/fake-model");
	expect(report).toContain("runs compat-fake/fake-model");
	// The level that rides on it is normal's, in both, and neither names the level a strong request never
	// sends while strong has nothing to run on.
	expect(shown).toContain("It asks for low");
	expect(report).toContain("carries thinking low");
	// `strong thinking` still shows the saved `max` as its value — that is what the file holds — and neither
	// surface claims a request carries it.
	expect(shown).not.toContain("for max");
	expect(report).not.toContain("thinking max");

	// And the badge, drawn off the same settings on the same host at its start, names the same model the
	// list names and the same level the report carries.
	const started = fakeCommandContext({ available: [AUTO, FAKE_MODEL, FAKE_STRONG], authedProviders: ["compat-fake"], model: AUTO });
	await screen.pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);
	expect(started.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-model");
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[normal low]");
});

// spec scenario "物理モデル選択中のロックの保存が失敗する": the session really does hold the lock the row shows,
// and the footer still reports the routing off, because a lock is not a routing state.
test("a lock save that fails on a physical model keeps the row and draws the badge off", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		{ model: FAKE_MODEL, failLock: true, settings: { defaultProvider: "compat-fake", defaultModel: "fake-model" } },
	);

	expect(run.phase.lock()).toBe("strong");
	expect(run.statuses.get(ROLE_STATUS_KEY)).toBe("[off]");
	expect(run.statuses.get(ROLE_MODEL_STATUS_KEY)).toBeUndefined();

	const shown = run.text();
	expect(shown).toContain("not saved:");
	// The reason belongs behind the lead: it is a statement about one row's write, and in front it would
	// read as a statement about the whole screen.
	expect(shown.indexOf("routing is off")).toBeLessThan(shown.indexOf("not saved:"));
});

// spec scenario "ステップの 2 段選択": the scenario's GIVEN is strong / low, and it changes both halves
// to unset / high. The writes, the row value, and the description all have to follow.
test("the two stages from strong low to unset high", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("step:opsx-propose");
			list.handleInput(ENTER);
			// Stage one: role `strong` -> `unset`, which is the last choice.
			list.handleInput(DOWN);
			list.handleInput(ENTER);
			// Stage two opens on the current `low`; `high` is two steps down.
			list.handleInput(DOWN);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		{
			settings: {
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { steps: { "opsx-propose": { role: "strong", thinking: "low" } } },
			},
		},
	);

	expect(run.written).toEqual([
		{ path: ["models", "steps", "opsx-propose", "role"], value: undefined },
		{ path: ["models", "steps", "opsx-propose", "thinking"], value: "high" },
	]);
	const shown = run.text();
	expect(shown).toContain("unset / high");
	expect(shown).toContain("follows the lock");
	expect(shown).toContain("It asks for high");
});

/** Keys a terminal sends, matched through pi's own keybindings rather than compared as literals. */
const ENTER = "\r";
const ESCAPE = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

/** The list screen as the terminal sees it: the component `ctx.ui.custom()` was built with. */
interface ScreenList {
	selectItem(id: string): void;
	handleInput(data: string): void;
	render(width: number): string[];
}

/** What a screen run left behind: the host, the writes, the badge, the reload count, and the screen. */
interface ScreenRun {
	/** The host the screen ran on, so a test can ask the same command something else afterwards. */
	readonly pi: FakePi;
	written: Array<{ path: SettingsPath; value: unknown }>;
	notices: string[];
	/** The notices with the type each was sent as, which is what the close-time information reads. */
	notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
	statuses: Map<string, string | undefined>;
	reloads: number;
	/** What the global settings file holds after the run, which is what `save` is for. */
	file: () => Record<string, unknown>;
	/** How many times the conditional write rewrote the file. */
	saveWrites: () => number;
	/**
	 * How many times the screen asked for the conditional write at all.
	 *
	 * A decline and a no-op both leave {@link saveWrites} at zero, so "the file was never asked" is a claim
	 * this counts and not that one.
	 */
	saveAttempts: () => number;
	/** How many times the screen asked the host to close it. */
	closes: () => number;
	text: () => string;
}

/** Settings with a strong target, for a screen whose lock is expected to show on the badge. */
const LOCKABLE = { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } };

/**
 * Open the list the way the command does — `/spirits-role` with no arguments on a terminal — and drive
 * the screen with keys.
 *
 * Everything the test needs to observe is what the user can observe: the screen, the notices, the badge,
 * and whether a reload followed. `fail` names the settings path a write refuses, the way a read-only
 * file does.
 */
async function driveScreen(
	keystrokes: (list: ScreenList) => void,
	options: {
		settings?: Record<string, unknown>;
		available?: readonly PiModel[];
		authed?: readonly string[];
		fail?: (path: readonly string[]) => boolean;
		failLock?: boolean;
		/**
		 * pi's global settings file, which is what the `save` row previews and what its Enter writes. Absent
		 * means an empty file: the session's lock and model are then both differences waiting to be written.
		 */
		file?: Record<string, unknown>;
		/** Refuse the conditional write the way a read-only file does. */
		failSave?: boolean;
		/** Leave the preview's read of the global file at its production default, which is the real file. */
		defaultGlobalRead?: boolean;
		/**
		 * Run the whole `save` path against a real pi agent dir, which holds the real `settings.json`.
		 *
		 * The seam is left out for both halves — the preview's read and the conditional write — so a test sees
		 * the file's bytes and modification time instead of an in-memory stand-in.
		 */
		realGlobalDir?: string;
		/** Raise from the preview's read of the global file, which costs the preview and not the screen. */
		failSaveRead?: boolean;
		/** Refuse the session record write, the one outside the settings file's own guard. */
		failAppend?: boolean;
		/**
		 * Raise from this `pi.getSettings()` call on, which is how a settings file that goes unreadable
		 * mid-screen behaves. The rows are read once to build the screen and again after every edit, so 2 is
		 * the redraw that follows the first change (d-verify5 W-1).
		 */
		failRead?: number;
		mode?: ExtensionMode;
		model?: PiModel;
		/** Run the screen with no model selected, rather than the routing model by default. */
		noModel?: boolean;
		/** Limit the session to these models, the way the host's own model scope does. */
		scoped?: readonly PiModel[];
	} = {},
): Promise<ScreenRun & { phase: ReturnType<typeof createRoutingPhase> }> {
	const pi = new FakePi();
	pi.settings = options.settings ?? { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	if (options.failRead !== undefined) {
		const settings = pi.getSettings.bind(pi);
		let reads = 0;
		pi.getSettings = () => {
			reads += 1;
			if (reads >= options.failRead!) throw new Error("the settings file went unreadable");
			return settings();
		};
	}
	if (options.failAppend) {
		const record = pi.appendEntry.bind(pi);
		pi.appendEntry = (type: string, data?: unknown) => {
			if (type === ROLE_ENTRY_TYPE) throw new Error("the session file is on a read-only volume");
			record(type, data);
		};
	}
	const written: Array<{ path: SettingsPath; value: unknown }> = [];
	// The `save` row's file. A plain object here, because what the screen and the reload have to agree about
	// is the decision and its result; `managed-commands.test.ts` drives the same conditional write against a
	// real file, where the lock and the merge are what is under test.
	let file: Record<string, unknown> = options.file ?? {};
	/** How many times the conditional write actually rewrote the file, as opposed to being asked. */
	let saveWrites = 0;
	/** How many times the conditional write was asked, whether or not it rewrote anything. */
	let saveAttempts = 0;
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: (patch) => {
			if (options.failLock) throw new Error("EACCES: the settings file is read-only");
			// The lock row writes `models.role` through here, before the save stage, so the file has to carry
			// that half for the failure cases to read it.
			file = mergeSettingsPatch(file, patch);
		},
		patchSettingsPath: (path, value) => {
			if (options.fail?.(path)) throw new Error("EACCES: the settings file is read-only");
			written.push({ path, value });
		},
		// A real agent dir stands for both halves of the `save` path; anything else keeps the seams.
		...(options.realGlobalDir
			? {}
			: {
					...(options.defaultGlobalRead
						? {}
						: {
								readGlobalSettings: () => {
									if (options.failSaveRead) throw new Error("the global settings file is unreadable");
									return file;
								},
						  }),
					saveSettings: (decide) => {
						saveAttempts += 1;
						if (options.failSave) throw new Error("EACCES: the settings file is read-only");
						const patch = decide(file);
						if (patch === undefined) return undefined;
						saveWrites += 1;
						file = mergeSettingsPatch(file, patch);
						return file;
					},
				}),
	});
	const context = fakeCommandContext({
		available: options.available ?? [AUTO, FAKE_MODEL, FAKE_STRONG],
		authedProviders: options.authed ?? ["compat-fake"],
		model: options.noModel ? undefined : (options.model ?? AUTO),
		mode: options.mode ?? "tui",
		...(options.scoped ? { scopedModels: options.scoped.map((model) => ({ model })) } : {}),
		onCustom: (component) => keystrokes(component as ScreenList),
	});

	// The production global path is the agent dir's `settings.json`, so pointing the env var at a temp dir
	// is what makes the run read and write a real file.
	const previousAgentDir = process.env[ENV_AGENT_DIR];
	if (options.realGlobalDir !== undefined) process.env[ENV_AGENT_DIR] = options.realGlobalDir;
	try {
		await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);
	} finally {
		if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previousAgentDir;
	}

	return {
		pi,
		phase,
		written,
		notices: context.notices,
		notifications: context.notifications,
		statuses: context.statuses,
		reloads: context.reloads(),
		file: () => file,
		saveWrites: () => saveWrites,
		saveAttempts: () => saveAttempts,
		closes: () => context.custom.closes.length,
		text: () => (context.custom.components[0] as ScreenList).render(100).join("\n"),
	};
}

/**
 * Run one `/spirits-role` argument line on a host the list already ran on.
 *
 * The list and the report are two surfaces of one command, and the point of comparing them is that they read
 * one resolution, so they have to be read off one wiring.
 */
async function statusLine(pi: FakePi, options: Parameters<typeof fakeCommandContext>[0] = {}): Promise<string> {
	const context = fakeCommandContext({ available: [AUTO, FAKE_MODEL, FAKE_STRONG], authedProviders: ["compat-fake"], model: AUTO, ...options });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("status", context.ctx);
	return context.notices.join("\n");
}

// spec scenario "候補の一覧を Esc で閉じる": the main list hands every key it receives while a submenu is
// open to that submenu, so a submenu with no cancel is a screen the user cannot leave. This drives the
// real `SettingsList`, because the wiring of that cancel is the thing under test.
test("escape closes a choice list without writing", async () => {
	const run = await driveScreen((list) => {
		list.selectItem("normal.thinking");
		list.handleInput(ENTER);
		list.handleInput(ESCAPE);
	});

	expect(run.written).toEqual([]);
	// Back on the list, with the row as it was.
	expect(run.text()).toContain("normal thinking");
	expect(run.text()).not.toContain("back to unset");
	// Nothing changed, so closing costs no runtime restart.
	expect(run.reloads).toBe(0);
});

// spec scenario "候補が空の案内を Esc で閉じる": the notice is not a `SelectList`, so it needs its own Esc,
// and the list has to be reachable from it again.
test("escape closes the empty model notice", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("normal.model");
			list.handleInput(ENTER);
			// The notice is showing, not a choice list.
			expect(screenText(list)).toContain("no choices to offer");
			list.handleInput(ESCAPE);
		},
		{ available: [AUTO], authed: [] },
	);

	expect(run.written).toEqual([]);
	expect(run.text()).toContain("normal model");
});

/**
 * The screen text while the keys are still being sent.
 *
 * The component is the only thing a keystroke callback holds, so the text has to be read off it rather
 * than off the run the callback is building.
 */
function screenText(list: ScreenList): string {
	return list.render(100).join("\n");
}

// spec scenario "ステップの 2 段選択": one row, the role list, then the level list on the same row.
test("a step row edits role then thinking", async () => {
	const run = await driveScreen((list) => {
		list.selectItem("step:opsx-propose");
		list.handleInput(ENTER);
		// Stage one offers the roles with `unset` last, and the row's own value is unset.
		expect(screenText(list)).toContain("back to unset");
		list.handleInput(UP);
		list.handleInput(ENTER);
		// The role landed and the level list opened on the same row: the screen is a choice list again.
		expect(screenText(list)).toContain("medium");
		// Three steps up the level list from `unset` is `high`.
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(ENTER);
	});

	expect(run.written).toEqual([
		{ path: ["models", "steps", "opsx-propose", "role"], value: "strong" },
		{ path: ["models", "steps", "opsx-propose", "thinking"], value: "high" },
	]);
	// One reload for the pair of edits, when the screen closes.
	expect(run.reloads).toBe(1);
});

// spec scenario "ステップの 2 段目を Esc で閉じる": the role the user confirmed stays, and the level does
// not move.
test("escape on the second stage keeps the thinking level", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("step:opsx-propose");
			list.handleInput(ENTER);
			list.handleInput(UP);
			list.handleInput(ENTER);
			list.handleInput(ESCAPE);
		},
		{ settings: { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { steps: { "opsx-propose": { thinking: "low" } } } } },
	);

	expect(run.written).toEqual([{ path: ["models", "steps", "opsx-propose", "role"], value: "strong" }]);
	// Back on the list with the pair showing the write and the level the user never chose to change.
	expect(run.text()).toContain("strong / low");
});

// d-verify2 W-7: a role the settings file refused must send the user back to the row that says why, not
// on to the level list.
test("a failed step role write does not open the second stage", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("step:opsx-propose");
			list.handleInput(ENTER);
			list.handleInput(UP);
			list.handleInput(ENTER);
			// The refusal is on the screen the user is back on, and no level list followed it.
			expect(screenText(list)).toContain("not saved:");
			expect(screenText(list)).not.toContain("back to unset");
		},
		{ fail: (path) => path.at(-1) === "role" },
	);

	// The refused role wrote nothing, and neither did anything after it.
	expect(run.written).toEqual([]);
});

// design Risks "パネルが拡張ごとクラッシュする": pi-tui calls `handleInput` without a try, so an exception
// that escapes an edit ends the process. The row has to catch it and stay on screen (d-verify3 W-1).
test("an exception in an edit stays inside the list", async () => {
	const { panel } = panelOf({}, {
		// The session record write is outside the settings file's own guard, so it is the one that used to
		// escape: `pi.appendEntry` raising is what the new catch has to cover.
		lockRole: () => {
			throw new Error("the session record could not be written");
		},
	});
	let handled = false;
	const context = fakeCommandContext({
		available: [AUTO, FAKE_MODEL, FAKE_STRONG],
		model: AUTO,
		onCustom: (component) => {
			const list = component as ScreenList;
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			expect(() => list.handleInput(ENTER)).not.toThrow();
			// Back on the list, with the reason on the row that raised.
			expect(screenText(list)).toContain("not saved:");
			expect(screenText(list)).toContain("session record could not be written");
			expect(screenText(list)).toContain("role lock");
			handled = true;
		},
	});

	const reloaded = await openRolePanel(context.ctx, panel);

	expect(handled).toBe(true);
	// Nothing was saved, so closing the screen does not restart the runtime.
	expect(reloaded).toBe(false);
	expect(context.reloads()).toBe(0);
});

// spec scenario "書き込みの失敗後は表示が戻る", on the screen rather than on the row object: the reason is
// inside the list, not in a notice the user reads after the screen is gone.
test("a failed write shows its reason inside the list", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("normal.thinking");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		{
			settings: { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { thinking: { normal: "low" } } },
			fail: () => true,
		},
	);

	const shown = run.text();
	expect(shown).toContain("not saved:");
	expect(shown).toContain("read-only");
	// The row itself did not move: the file never took the change.
	expect(shown).toContain("low");
	expect(run.reloads).toBe(0);
});

// spec "書き込みに成功した行は、再読み込みを待たずに、値と説明の解決結果の両方を新しい値へ更新する".
test("a saved edit refreshes the row description", async () => {
	const run = await driveScreen((list) => {
		list.selectItem("normal.thinking");
		expect(screenText(list)).toContain("normal requests ask for the session's level");
		list.handleInput(ENTER);
		// `high` is three up from `unset`, the level the row holds when nothing is saved.
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(UP);
		list.handleInput(ENTER);
	});

	expect(run.written).toEqual([{ path: ["models", "thinking", "normal"], value: "high" }]);
	const shown = run.text();
	expect(shown).toContain("normal requests ask for high");
	expect(shown).not.toContain("the session's level");
});

// spec scenario "一覧のロックの行は保存に失敗してもセッションのロックを示す" on the screen: the row keeps
// the lock the session took, and the badge goes up with it.
test("a lock edit draws the badge even when the save fails", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			list.handleInput(ENTER);
		},
		// A session with a strong that has something to run on, so the badge drawn from the lock has a role
		// to name rather than a fallback to report.
		{ failLock: true, settings: { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } } },
	);

	// The badge is the footer status the command writes, on the role the session is locked to.
	expect(run.statuses.get("spirits")).toBe("[strong]");
	expect(run.text()).toContain("not saved:");
	// A change that never reached the file earns no reload.
	expect(run.reloads).toBe(0);
});

// spec scenario "ロックの記録の追記が例外を投げる": applying a lock is the phase and then the record, and a
// record that throws leaves the session on the new lock. The row and the badge are read from the phase, so
// neither one stays behind it — and the exception still does not leave the screen (d-verify4 C-2).
//
// The failure is injected at the host boundary (`pi.appendEntry`) rather than by replacing `lockRole`, so
// the write runs in its real order: `phase.setRole()` first, the record second.
test("a lock record that fails to append keeps the row and the badge on the session lock", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			expect(() => list.handleInput(ENTER)).not.toThrow();
		},
		{ failAppend: true, settings: LOCKABLE },
	);

	// The session really moved to strong even though its record was refused.
	expect(run.phase.lock()).toBe(MODEL_ROLE_STRONG);
	expect(run.text()).toContain("not saved:");
	expect(run.text()).toContain("read-only volume");
	expect(run.text()).toMatch(/role lock\s+strong/);
	expect(run.statuses.get("spirits")).toBe("[strong]");
});

// spec "一覧のロックの行は保存に失敗してもセッションのロックを示す" の読み戻し側(d-verify5 W-1): a row is
// redrawn by reading the session back, and that read can fail after the write landed. A row that then said
// `not saved` would take back a change the session made, so the row keeps the value the edit moved, the
// badge comes from the phase, and the reload the change earned still runs.
test("a read that raises after a landed lock keeps the row and the badge on the session lock", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("lock");
			list.handleInput(ENTER);
			list.handleInput(DOWN);
			expect(() => list.handleInput(ENTER)).not.toThrow();
		},
		// Read 1 builds the screen; read 2 is the redraw that follows the edit.
		{ failRead: 2, settings: LOCKABLE },
	);

	// The lock is in the session, and the row says so rather than denying it.
	expect(run.phase.lock()).toBe(MODEL_ROLE_STRONG);
	expect(run.text()).toMatch(/role lock\s+strong/);
	// The badge is the lock the phase holds, so it does not depend on the read that failed.
	expect(run.statuses.get("spirits")).toBe("[strong]");
	// The failure is on the row, and it names the redraw rather than the write.
	expect(run.text()).toContain("not redrawn:");
	expect(run.text()).toContain("settings file went unreadable");
	expect(run.text()).not.toContain("not saved:");
	// A change that landed earns its reload, even when the screen could not be redrawn.
	expect(run.reloads).toBe(1);
});

// The same read failure on a step's first stage: the level list has to open, because the role the user
// picked did land (spec 一覧のステップの行は 2 段で選ぶ, d-verify5 W-1).
test("a read that raises after a step role edit still opens the level stage", async () => {
	const run = await driveScreen(
		(list) => {
			list.selectItem("step:opsx-propose");
			list.handleInput(ENTER);
			// `strong` is one down from `normal`, the role the step holds in these settings.
			list.handleInput(DOWN);
			list.handleInput(ENTER);
			// The level list is showing, which only happens when the role write reports success.
			expect(screenText(list)).toContain("back to unset");
			list.handleInput(ESCAPE);
		},
		{
			settings: {
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { steps: { "opsx-propose": { role: "normal", thinking: "low" } } },
			},
			failRead: 2,
		},
	);

	expect(run.written).toEqual([{ path: ["models", "steps", "opsx-propose", "role"], value: "strong" }]);
	// Back on the list, the row carries the pair the edit left: its own role moved, its level stayed.
	expect(run.text()).toMatch(/opsx-propose\s+strong \/ low/);
	expect(run.text()).not.toContain("not saved:");
	expect(run.reloads).toBe(1);
});

// spec scenario "閉じるときに 1 回だけ再読み込む": the reload waits for the screen to close.
test("reloads once on close", async () => {
	const { panel } = panelOf();
	const context = fakeCommandContext({
		available: [AUTO, FAKE_MODEL, FAKE_STRONG],
		authedProviders: ["compat-fake"],
		onCustom: () => {
			// Three edits while the screen is open, which is the case the spec names.
			panel.edit("normal.thinking", "high");
			panel.edit("strong.model", "compat-fake/fake-strong");
			panel.edit("step:opsx-apply.thinking", "max");
		},
	});

	const reloaded = await openRolePanel(context.ctx, panel);

	expect(context.reloads()).toBe(1);
	expect(reloaded).toBe(true);
	// The screen pi-tui was handed is the list itself, not a wrapper the caller has to dispose.
	expect(context.custom.components).toHaveLength(1);
});

// A browse that changes nothing must not cost a runtime restart.
test("a browse that changes nothing does not reload", async () => {
	const { panel } = panelOf();
	const context = fakeCommandContext({ available: [AUTO, FAKE_MODEL, FAKE_STRONG] });

	const reloaded = await openRolePanel(context.ctx, panel);

	expect(context.reloads()).toBe(0);
	expect(reloaded).toBe(false);
});

// spec scenario "引数なしは表示だけ": the command with no arguments opens the list and changes neither the
// session nor the settings file. The rows are what the user came for.
test("an argumentless command opens the list without changing anything", async () => {
	const run = await driveScreen(() => {});

	expect(run.written).toEqual([]);
	expect(run.reloads).toBe(0);
	expect(run.notices).toEqual([]);
	expect(run.phase.current()).toBe("normal");
	expect(run.phase.step()).toBeUndefined();
	const shown = run.text();
	expect(shown).toContain("role lock");
	expect(shown).toContain("normal model");
	expect(shown).toContain("opsx-propose");
});

// spec scenario "対話端末以外では一覧を開かない": `hasUI` is true in RPC mode too, so the mode is the only
// thing that can decide this.
test("shows status outside the tui", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	registerManagedCommands(asExtensionApi(pi), { phase: createRoutingPhase(), patchSettings: () => {} });

	const context = fakeCommandContext({ available: [FAKE_MODEL], model: AUTO, mode: "rpc" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	expect(context.custom.components).toHaveLength(0);
	expect(context.notices.join("\n")).toContain("routing:");
});

test("opens the list on a terminal", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	registerManagedCommands(asExtensionApi(pi), { phase: createRoutingPhase(), patchSettings: () => {} });

	const context = fakeCommandContext({ available: [FAKE_MODEL], model: AUTO, mode: "tui" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	expect(context.custom.components).toHaveLength(1);
	// Opening the list is not a change, so nothing is reloaded behind the user's back.
	expect(context.reloads()).toBe(0);
});

// --- the submenu parts and the themes ----------------------------------------------------------

/** A theme that adds no escape sequences, so a test reads the row text back as written. */
const PLAIN_THEME = fakeTheme();

/** A `RoleWrite` for a submenu test that only cares what the row asked for. */
const SAVED = { message: "set", saved: true, wrote: [] } as const;

// The three shapes a row can open, checked at the part level: rendering is part of the check because
// `SettingsList` and `SelectList` read every field of the theme they are handed, and a partially filled
// one throws inside the extension rather than drawing half a screen.
test("every submenu shape renders and closes", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, steps: { "opsx-apply": { role: "normal", thinking: "low" } } } });
	const closed: unknown[] = [];
	const close = (selected?: string) => {
		closed.push(selected);
	};
	const noop = () => SAVED;

	const choices = rowSubmenu(rowOf(panel, "strong.model"), "compat-fake/fake-strong", PLAIN_THEME, noop, close);
	const step = rowSubmenu(rowOf(panel, "step:opsx-apply"), "normal / low", PLAIN_THEME, noop, close);
	const empty = rowSubmenu(
		{ id: "empty", label: "empty", description: "", currentValue: "unset", values: [], lead: "" },
		"unset",
		PLAIN_THEME,
		noop,
		close,
	);

	for (const submenu of [choices, step, empty]) {
		expect(submenu.render(60).length).toBeGreaterThan(0);
		expect(submenu.handleInput).toBeDefined();
		submenu.handleInput?.(ESCAPE);
	}
	expect(closed).toEqual([undefined, undefined, undefined]);

	// The same five fields pi builds for its own settings screen, both themes.
	expect(Object.keys(settingsListTheme(PLAIN_THEME)).sort()).toEqual(["cursor", "description", "hint", "label", "value"]);
	expect(Object.keys(selectListTheme(PLAIN_THEME)).sort()).toEqual([
		"description",
		"noMatch",
		"scrollInfo",
		"selectedPrefix",
		"selectedText",
	]);
});

// A step's second stage has to appear inside the same submenu, since the step is one row: pi-tui has no
// second row to move to.
test("a step submenu shows the level list after the role list", () => {
	const { panel } = panelOf({ settings: { ...SETTINGS, steps: { "opsx-apply": { role: "normal", thinking: "low" } } } });
	const written: Array<[string, string]> = [];
	let closed = 0;

	const submenu = rowSubmenu(rowOf(panel, "step:opsx-apply"), "normal / low", PLAIN_THEME, (rowId, value) => {
		written.push([rowId, value]);
		return SAVED;
	}, () => {
		closed += 1;
	});

	// Stage one is the role list: it offers `unset`, which the level list does not name.
	expect(submenu.render(60).join("\n")).toContain("back to unset");
	submenu.handleInput?.(ENTER);
	expect(written).toEqual([["step:opsx-apply.role", "normal"]]);
	// The level list is showing on the same submenu, and closing it is the one close the row owns.
	submenu.handleInput?.(ESCAPE);
	expect(closed).toBe(1);
});
