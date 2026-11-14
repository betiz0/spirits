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
import type { ExtensionModelRegistry, ExtensionMode, PiModel, Theme } from "@earendil-works/pi-coding-agent";import { COMMAND_SPIRITS_ROLE, MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, ROLE_ENTRY_TYPE, STEP_DEFINITIONS } from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { readRoutingSettings } from "../src/config.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import {
	missingStartersFor,
	modelChoices,
	openRolePanel,
	RolePanel,
	rowSetting,
	rowSubmenu,
	selectListTheme,
	settingsListTheme,
	stepRowValue,
	type PanelRead,
} from "../src/commands/role-panel.ts";
import type { RolePanelSnapshot } from "../src/commands/role-panel.ts";
import type { RoleWriteDeps } from "../src/commands/role-write.ts";
import type { SettingsPath } from "../src/commands/settings-store.ts";
import { writePathValue } from "../src/commands/settings-store.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { createNotificationGuard, createRoutingRoute } from "../src/routing/router.ts";
import { modelKey } from "../src/routing/resolve.ts";
import { FakePi, fakeCommandContext } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = { provider: "compat-fake", id: "fake-model", api: "openai" };
const FAKE_STRONG: PiModel = { provider: "compat-fake", id: "fake-strong", api: "openai" };
/** pi lists the routing entry among the available models, so every candidate list has to drop it. */
const AUTO: PiModel = { provider: "spirits", id: "auto", api: "pi-virtual" };

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
	return {
		getAvailable: () => models.filter((model) => authed.includes(model.provider)),
		find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
		hasConfiguredAuth: (model) => authed.includes(model.provider),
	};
}

function snapshot(overrides: Partial<RolePanelSnapshot> = {}): RolePanelSnapshot {
	return {
		lock: "normal",
		settings: SETTINGS,
		lookup: registry([FAKE_MODEL, FAKE_STRONG]),
		sessionThinkingLevel: "medium",
		modelChoices: modelChoices([AUTO, FAKE_MODEL, FAKE_STRONG]),
		missingStarters: new Set<string>(),
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

	// The lock, the two roles' model and thinking, and one row for every listed step: a step is a pair of
	// settings shown as one setting, not two rows (spec 一覧のステップの行は 2 段で選ぶ).
	expect(rows).toHaveLength(1 + 2 * 2 + STEP_DEFINITIONS.length);
	for (const row of rows) {
		expect(row.id.length).toBeGreaterThan(0);
		expect(row.label.length).toBeGreaterThan(0);
		expect(row.description.length).toBeGreaterThan(0);
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
		{ model: { provider: "spirits", id: "auto" }, thinkingLevel: "medium", reason: "user" },
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
		{ model: { provider: "spirits", id: "auto" }, thinkingLevel: "medium", reason: "user" },
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
		{ name: "skill:openspec-apply-change", source: "skill" as const },
		{ name: "opsx-propose", source: "prompt" as const },
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
		{ name: "opsx-propose", source: "extension" },
		{ name: "spirits-role", source: "extension" },
	]);
	expect(extensionOnly.has("opsx-propose")).toBe(true);

	// The same name from a template is a starter, and then the step is not missing.
	expect(missingStartersFor([{ name: "opsx-propose", source: "prompt" }]).has("opsx-propose")).toBe(false);
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
	const foreign = { provider: "other", id: "router", api: "pi-virtual" };
	const named = { provider: "compat-fake", id: "auto-pilot", name: "Auto Pilot", api: "openai" };
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
	const panel = new RolePanel(read, { lockRole: () => {}, patchSettings: () => {}, patchSettingsPath: () => {} });

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
	expect(shown).toContain("routing is off while a physical model is selected");
	// The sentence wraps at the screen width, so check the words rather than the unbroken line.
	expect(shown).toContain("strong has no");
	expect(shown).toContain("usable model");
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

/** What a screen run left behind: the writes, the badge, the reload count, and the screen itself. */
interface ScreenRun {
	written: Array<{ path: SettingsPath; value: unknown }>;
	notices: string[];
	statuses: Map<string, string | undefined>;
	reloads: number;
	text: () => string;
}

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
	const phase = createRoutingPhase();
	registerManagedCommands(pi, {
		phase,
		patchSettings: () => {
			if (options.failLock) throw new Error("EACCES: the settings file is read-only");
		},
		patchSettingsPath: (path, value) => {
			if (options.fail?.(path)) throw new Error("EACCES: the settings file is read-only");
			written.push({ path, value });
		},
	});
	const context = fakeCommandContext({
		available: options.available ?? [AUTO, FAKE_MODEL, FAKE_STRONG],
		authedProviders: options.authed ?? ["compat-fake"],
		model: options.model ?? AUTO,
		mode: options.mode ?? "tui",
		onCustom: (component) => keystrokes(component as ScreenList),
	});

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	return {
		phase,
		written,
		notices: context.notices,
		statuses: context.statuses,
		reloads: context.reloads(),
		text: () => (context.custom.components[0] as ScreenList).render(100).join("\n"),
	};
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
		{ failLock: true },
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
		{ failAppend: true },
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
		{ failRead: 2 },
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
	registerManagedCommands(pi, { phase: createRoutingPhase(), patchSettings: () => {} });

	const context = fakeCommandContext({ available: [FAKE_MODEL], model: AUTO, mode: "rpc" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	expect(context.custom.components).toHaveLength(0);
	expect(context.notices.join("\n")).toContain("routing:");
});

test("opens the list on a terminal", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	registerManagedCommands(pi, { phase: createRoutingPhase(), patchSettings: () => {} });

	const context = fakeCommandContext({ available: [FAKE_MODEL], model: AUTO, mode: "tui" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	expect(context.custom.components).toHaveLength(1);
	// Opening the list is not a change, so nothing is reloaded behind the user's back.
	expect(context.reloads()).toBe(0);
});

// --- the submenu parts and the themes ----------------------------------------------------------

/** A theme that adds no escape sequences, so a test reads the row text back as written. */
const PLAIN_THEME = { fg: (_color: string, text: string) => text } as unknown as Theme;

/** A `RoleWrite` for a submenu test that only cares what the row asked for. */
const SAVED = { message: "set", saved: true } as const;

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
		{ id: "empty", label: "empty", description: "", currentValue: "unset", values: [] },
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
