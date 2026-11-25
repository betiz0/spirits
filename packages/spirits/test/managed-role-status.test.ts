/**
 * `/spirits-role status`: the one notice that says how the routing is running.
 *
 * The report is built from the phase, the settings file, and the host's catalog, so the cases below
 * set those three and read the notice back. The rule the shape follows is the question a user asks when
 * routing is not doing what they set: is it on at all, what is locked, what step is running, what the
 * last request actually used, where each role's model comes from, and what the settings file holds that
 * routing will not read (spec `managed-commands` / `/spirits-role status`).
 */

import { expect, test } from "bun:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asExtensionApi, fakeModel, slashCommandInfo } from "./host/fake-pi.ts";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { COMMAND_SPIRITS_ROLE, MODEL_ROLE_NORMAL, PI_VIRTUAL_MODEL_API, ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { readRoutingSettings } from "../src/config.ts";
import { patchSettingsFileIfChanged, readSettingsFile } from "../src/commands/settings-store.ts";
import type { SettingsPatchDecider } from "../src/commands/settings-store.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { formatRoleStatus, routingModelAvailable } from "../src/commands/role.ts";
import type { RoleStatusReport } from "../src/commands/role.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { fakeCommandContext, FakePi, makeCustomEntry } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { api: "openai" });
const FAKE_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { api: "openai" });
const CATALOG = [FAKE_MODEL, FAKE_STRONG];
/** The routing entry, which is what a session has to select for routing to be in force. */
const AUTO: PiModel = fakeModel("spirits", "auto", { api: "pi-virtual" });

function wire(settings: Record<string, unknown>, options: { lastRequest?: boolean; savePath?: string } = {}) {
	const pi = new FakePi();
	pi.settings = settings;
	// The badge reads settings the way the product does, through the host, and the stub host answers with an
	// empty object unless the wiring hands it the settings the test set. The host hands out the raw object; the
	// routing parses it, exactly as it does with a real settings file.
	pi.getSettings = () => settings;
	const phase = createRoutingPhase({
		listCommands: () => [
			slashCommandInfo("skill:openspec-apply-change", "skill"),
			slashCommandInfo("skill:sprt-opsx-verify-deep", "skill"),
		],
	});
	// In the product the routing layer's own `session_start` handler puts `models.role` on the phase. This
	// wiring registers only the command surface, so the lock is handed over the same way a start does it —
	// otherwise the badge would project a lock the session never had.
	phase.restoreLock(readRoutingSettings(settings).defaultRole ?? MODEL_ROLE_NORMAL);
	// A routing that already answered one strong request, which is the state `status` reports on. A case that
	// wants a session that has answered nothing — where the badge is the resolution with nothing behind it —
	// asks for that instead.
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		...(options.lastRequest === false
			? {}
			: { lastRequest: () => ({ role: "strong", model: "compat-fake/fake-strong", thinkingLevel: "high" }) }),
		// The save's two halves against a real file, so a test can read back what the global file holds after
		// the command wrote it rather than trusting what the command said.
		...(options.savePath
			? {
					readGlobalSettings: () => readSettingsFile(options.savePath!),
					saveSettings: (decide: SettingsPatchDecider) =>
						patchSettingsFileIfChanged({ settingsPath: options.savePath!, decide }),
				}
				: {}),
	});
	return { pi, phase };
}

async function status(pi: FakePi, options: Parameters<typeof fakeCommandContext>[0] = {}) {
	// The registry holds the routing model unless a case says otherwise: our own extension registers it, so a
	// session with the commands available has it in its catalog, and the scope is the narrower list.
	const context = fakeCommandContext({ available: CATALOG, registered: [AUTO, ...CATALOG], model: AUTO, ...options });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("status", context.ctx);
	return context.notices.join("\n");
}

/** What pi's own read of the settings answers: the global file with the trusted project file merged over it. */
function effectiveSettings(global: Record<string, unknown>, project: Record<string, unknown>): Record<string, unknown> {
	return {
		...global,
		...project,
		models: { ...((global.models as object) ?? {}), ...((project.models as object) ?? {}) },
	};
}

// spec scenario "振り分けが有効なときの全項目"
test("reports every field when routing is in force", async () => {
	const { pi, phase } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: {
			role: "normal",
			normal: "compat-fake/fake-model",
			strong: "compat-fake/fake-strong",
			thinking: { strong: "high" },
			steps: { "opsx-apply": { thinking: "max" } },
		},
	});
	phase.setRole("normal");
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("routing: on");
	expect(report).toContain("lock: normal");
	expect(report).toContain("step: opsx-apply (continuing)");
	// The request that ran, not the setting it hopes for: role, physical model, and the level asked for.
	expect(report).toContain("last request: strong on compat-fake/fake-strong at high");
	expect(report).toContain("normal: compat-fake/fake-model (models.normal)");
	expect(report).toContain("strong: compat-fake/fake-strong (models.strong, thinking high)");
	expect(report).toContain("step settings: opsx-apply thinking max");
});

// spec scenario "物理モデルを選んでいれば無効と出る": the report stays readable, only the verdict changes, and
// the verdict names the model it was reached from — "off" without a model named is a fact the user cannot
// check against the selector.
test("reports routing disabled on a physical model", async () => {
	const { pi, phase } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "strong" } });
	phase.setRole("strong");

	const report = await status(pi, { model: FAKE_MODEL });

	expect(report).toContain("routing: off (compat-fake/fake-model is selected)");
	expect(report).toContain("lock: strong");
	expect(report).toContain("normal: compat-fake/fake-model (pi's default model)");
});

test("reports routing off and no selected model when the host has none", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const report = await status(pi, { model: undefined });

	expect(report).toContain("routing: off (no model is selected)");
	expect(report).toContain("to enable: select spirits/auto with /model to put this to work");
});

// spec scenarios "振り分け用モデルがスコープ外だと分かる", "スコープが設定されていなくても手順が出る",
// "振り分け用モデルが範囲内でも手順が出る", and "対話端末でないセッションでは操作を名指さない": every off session
// is told how to get out of the state, and the scope only chooses which procedure. The mode decides whether
// an operation is named at all. The scope varies three ways — excluded, included, none — against both run
// modes, because the two halves of the answer are independent facts.
test("reports the way back to the routing model in every scope and mode", async () => {
	const settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	const outsideScope = [{ model: FAKE_MODEL }];
	const insideScope = [{ model: AUTO }, { model: FAKE_MODEL }];

	const rows = await Promise.all(
		[
			{ scoped: outsideScope, mode: "tui" as const },
			{ scoped: outsideScope, mode: "rpc" as const },
			{ scoped: insideScope, mode: "tui" as const },
			{ scoped: insideScope, mode: "rpc" as const },
			{ scoped: [], mode: "tui" as const },
			{ scoped: [], mode: "rpc" as const },
		].map(async (option) => {
			const { pi } = wire(settings);
			return status(pi, { model: FAKE_MODEL, scopedModels: option.scoped, mode: option.mode });
		}),
	);

	// A scope that leaves the routing model out is stated in both modes, because it is a fact about the
	// session rather than about the terminal.
	expect(rows[0]).toContain("spirits/auto is not in this session's model scope");
	expect(rows[1]).toContain("spirits/auto is not in this session's model scope");
	// Only the terminal is told how to work around it, and it is told both ways round: moving the selector's
	// scope, and the command that writes it. The switch is named as the operation rather than as the key bound
	// to it today, which is the host's to draw in its own hint.
	expect(rows[0]).toContain("switch /model's scope to all models");
	expect(rows[0]).toContain("/scoped-models");
	// A session nobody is looking at names no operation at all — and no settings file to edit, either: the
	// scope is a fact a headless session is told about, not a task it is given.
	for (const report of [rows[1], rows[3], rows[5]]) {
		expect(report).not.toContain("Tab");
		expect(report).not.toContain("press");
		expect(report).not.toContain("/model");
		expect(report).not.toContain("/scoped-models");
		expect(report).not.toContain("enabledModels");
		expect(report).not.toContain("settings file");
	}
	// Nothing is excluded, so the shorter procedure applies — but the procedure is still there: a session with
	// nothing wrong with its scope is still off, and the report is the one place its way out is written down.
	for (const report of [rows[2], rows[4]]) {
		expect(report).toContain("routing: off (compat-fake/fake-model is selected)");
		expect(report).not.toContain("model scope");
		expect(report).toContain("to enable: select spirits/auto with /model to put this to work");
	}
	// The same two states read as an RPC session: the verdict and the readable settings stay, no scope is
	// diagnosed where none excludes the routing model, and the procedure the terminal is given is not handed
	// to a session nobody is operating. Adding the procedure to every off session did not move these.
	for (const report of [rows[3], rows[5]]) {
		expect(report).toContain("routing: off (compat-fake/fake-model is selected)");
		expect(report).not.toContain("model scope");
		expect(report).not.toContain("to enable:");
	}
});

// spec scenario "スコープが設定されていなくても手順が出る": an absent scope is not an absent problem. The
// session is off, and the report is the surface long enough to say how to get out of it.
test("status names the procedure when the scope is unset", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const report = await status(pi, { model: FAKE_MODEL });

	expect(report).toContain("routing: off (compat-fake/fake-model is selected)");
	expect(report).toContain("to enable: select spirits/auto with /model to put this to work");
	expect(report).not.toContain("model scope");
});

// spec scenario "振り分け用モデルが範囲内でも手順が出る": a scope that already holds the routing model answers
// the same question the unset scope answers, so the shorter procedure applies — but it applies.
test("status names the procedure when the routing model is in scope", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const report = await status(pi, { model: FAKE_MODEL, scopedModels: [{ model: AUTO }, { model: FAKE_MODEL }] });

	expect(report).toContain("to enable: select spirits/auto with /model to put this to work");
	expect(report).not.toContain("model scope");
});

// spec scenario "振り分け用モデルが未登録なら手順を名指さない": the routing registers as a virtual model, so an
// extension that failed to register leaves a catalog with nothing for a selector to select. The report says
// that, still says the routing is off, and names no operation.
test("status gives no procedure when the routing model is not available", async () => {
	const settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };

	const rows = await Promise.all(
		[
			{ scoped: [{ model: FAKE_MODEL }], mode: "tui" as const },
			{ scoped: [], mode: "tui" as const },
			{ scoped: [], mode: "rpc" as const },
			{ scoped: [{ model: FAKE_MODEL }], mode: "rpc" as const },
		].map(async (option) => {
			const { pi } = wire(settings);
			// The catalog `status` reads, with the routing model missing from it.
			return status(pi, {
				model: FAKE_MODEL,
				available: [FAKE_MODEL, FAKE_STRONG],
				registered: [FAKE_MODEL, FAKE_STRONG],
				scopedModels: option.scoped,
				mode: option.mode,
			});
		}),
	);

	for (const report of rows) {
		expect(report).toContain("routing: off (compat-fake/fake-model is selected)");
		expect(report).toContain("spirits/auto is not in this session's model catalog");
		expect(report).not.toContain("to enable:");
		expect(report).not.toContain("switch /model");
		expect(report).not.toContain("/scoped-models");
	}
	for (const report of [rows[0], rows[3]]) {
		expect(report).toContain("spirits/auto is not in this session's model scope");
	}
});

// The pinned Pi keeps a physical model with a provider/id collision and refuses the virtual registration.
// Feed that actual catalog into all three user-facing decisions so each surface follows the host's api fact.
test("a pinned physical spirits/auto collision is unavailable across status and notices", async () => {
	const runtime = await ModelRuntime.create({
		credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} },
		modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("spirits", {
		apiKey: "pin-key",
		baseUrl: "http://127.0.0.1:9/pin",
		models: [
			{
				id: "auto",
				name: "Physical Auto",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
		],
	});
	await runtime.refresh({ allowNetwork: false });
	try {
		runtime.registerVirtualModel({ provider: "spirits", id: "auto", name: "Auto", route: () => { throw new Error("not routed"); } });
	} catch {
		// Pinned Pi may reject the duplicate at registration time; either way the physical catalog entry wins.
	}
	const models = await runtime.getAvailable();
	const collision = models.find((model) => model.provider === "spirits" && model.id === "auto");
	expect(collision).toBeDefined();
	expect(collision?.api).not.toBe(PI_VIRTUAL_MODEL_API);
	expect(routingModelAvailable(models)).toBe(false);
	if (!collision) throw new Error("the pinned physical collision was not available");

	const catalog = [...CATALOG, collision];
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });
	const report = await status(pi, {
		available: catalog,
		registered: catalog,
		model: collision,
		scopedModels: [{ model: collision }],
	});
	expect(report).toContain("routing: off (spirits/auto is selected)");
	expect(report).toContain("spirits/auto is not in this session's model scope");
	expect(report).toContain("spirits/auto is not in this session's model catalog");
	expect(report).not.toContain("to enable:");
	expect(report).not.toContain("/model");

	const savePi = new FakePi();
	let saveCalls = 0;
	let settingWrites = 0;
	registerManagedCommands(asExtensionApi(savePi), {
		phase: createRoutingPhase(),
		patchSettings: () => {},
		patchSettingsPath: () => { settingWrites++; },
		saveSettings: () => { saveCalls++; return undefined; },
	});
	const saveContext = fakeCommandContext({ available: catalog, registered: models, model: collision, scopedModels: [{ model: collision }] });
	await savePi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", saveContext.ctx);
	expect(saveContext.notifications[0]?.type).toBe("warning");
	expect(saveContext.notices[0]).toContain("spirits/auto is not in this session's model catalog");
	expect(saveContext.notices[0]).not.toContain("/model");
	expect(saveCalls).toBe(0);
	expect(saveContext.reloads()).toBe(0);

	const settingContext = fakeCommandContext({ available: catalog, registered: models, model: collision, scopedModels: [{ model: collision }] });
	await savePi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("normal thinking high", settingContext.ctx);
	expect(settingWrites).toBe(1);
	expect(settingContext.notifications.at(-1)?.type).toBe("warning");
	expect(settingContext.notices.at(-1)).toContain("spirits/auto is not in this session's model catalog");
	expect(settingContext.notices.at(-1)).not.toContain("/model");
});

// spec `managed-commands` / badge は状態の射影を決められた時点で描き直す: the report and the badge are two
// surfaces over one resolution, so on one GIVEN they cannot name a different role, a different model, or a
// different level. Every case below is drawn as the badge and printed as the report on one wiring, and the
// two are read against each other rather than against the test's own arithmetic.
test("the badge projects the resolution the report prints", async () => {
	const cases = [
		{
			name: "strong with something to run on",
			settings: {
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { role: "strong", strong: "compat-fake/fake-strong", thinking: { strong: "high" } },
			},
			badge: "[strong high]",
			model: "fake-strong",
			report: ["lock: strong", "strong: compat-fake/fake-strong (models.strong, thinking high)"],
		},
		{
			name: "strong with nothing to run on",
			settings: {
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { role: "strong", strong: "nowhere/nothing", thinking: { normal: "low", strong: "max" } },
			},
			// The badge draws the role that answers and its level; the report says the same in its own words.
			badge: "[normal low]",
			model: "fake-model",
			report: ["lock: strong", "runs compat-fake/fake-model", "carries thinking low"],
		},
		{
			name: "nothing answers at all",
			settings: { models: { role: "strong" } },
			badge: "[!]",
			model: undefined,
			report: ["normal: unresolved"],
		},
	];

	for (const testCase of cases) {
		const { pi } = wire(testCase.settings, { lastRequest: false });
		const started = fakeCommandContext({ available: CATALOG, authedProviders: ["compat-fake"], model: AUTO });
		await pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);
		const report = await status(pi, { authedProviders: ["compat-fake"] });

		expect(started.statuses.get("spirits")).toBe(testCase.badge);
		expect(started.statuses.get("spirits-model")).toBe(testCase.model);
		for (const line of testCase.report) expect(report).toContain(line);
	}
});

// An unset target and an unusable one are different facts, and only the second is worth alarming about.
test("separates an unset target from an unusable one", async () => {
	const unset = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });
	expect(await status(unset.pi)).toContain("strong: unset (models.strong is not set)");

	const unusable = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "nowhere/nothing" } });
	expect(await status(unusable.pi)).toContain("strong: unusable");
});

// spec scenario "ステップの既定ロールで走っている間のロック": the lock line is the lock, and the step line
// carries the role the step actually runs.
test("reports the lock, not the step default, during a strong-default step", async () => {
	const { pi, phase } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "normal" } });
	phase.setRole("normal");
	phase.handleInput("/skill:sprt-opsx-verify-deep some-change");
	phase.requestResolved();

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("lock: normal");
	expect(report).toContain("step: sprt-opsx-verify-deep");
	expect(report).toContain("runs strong");
});

// spec scenario "使えない normal の対象": the reason and the model that answers instead, not the setting.
test("reports an unusable normal target with its reason and the model that answers", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { normal: "compat-fake/fake-strong" },
	});

	// Nothing in `compat-fake` has credentials here, so the configured target cannot answer even though
	// it names a model that exists. The line has to carry the reason and the model that answers instead.
	const report = await status(pi);

	expect(report).toContain("normal: compat-fake/fake-model");
	expect(report).toContain("has no credentials for compat-fake");
	expect(report).toContain("running pi's default model");
});

// spec scenario "使えない normal の対象" for the other role: the replacement is only useful when the line
// says where it comes from, because the setting the user wrote names a different model.
test("an unusable strong names where its replacement comes from", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "nowhere/nothing" },
	});

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("strong: unusable");
	// The model that answers, and the source that put it there.
	expect(report).toContain("runs compat-fake/fake-model (pi's default model)");
});

// spec "status のロックと解決結果は実際の位相と解決を示す": a strong request that falls back to normal
// carries normal's thinking level, so that is the level the report has to name — strong's own level is a
// level no request sends while strong has nothing to run on.
test("an unresolved strong reports the level its requests carry", async () => {
	const unset = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { thinking: { normal: "low", strong: "max" } },
	});
	expect(await status(unset.pi, { authedProviders: ["compat-fake"] })).toContain("strong: unset (models.strong is not set; carries thinking low)");

	const unusable = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "nowhere/nothing", thinking: { normal: "low", strong: "max" } },
	});
	const report = await status(unusable.pi, { authedProviders: ["compat-fake"] });
	expect(report).toContain("carries thinking low");
	expect(report).not.toContain("thinking max");
});

// `models.strong` written but unreadable is not the same as `models.strong` absent.
test("reports an unreadable models.strong apart from unset", async () => {
	const report = await status(wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: 42 } }).pi);

	expect(report).toContain("ignored settings:");
	expect(report).toContain("models.strong: not a provider/id or model id");
	expect(report).not.toContain("models.strong is not set");
});

// spec scenario "綴りの違うステップ名": the step reader keys on the exact spelling, so a key that only
// differs by case is a step that is not on the list — it is not read, and the report has to say so.
test("reports a mixed-case step key as ignored", async () => {
	const settings = {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { steps: { "OpsX-Propose": { role: "strong" } } },
	};
	const report = await status(wire(settings).pi);

	expect(readRoutingSettings(settings).steps).toBeUndefined();
	expect(report).toContain("models.steps.OpsX-Propose: not a step on the list");
});

// spec scenario "設定値の不正区別": a value routing will not read is named with its reason, so the user
// does not have to guess which of their settings took effect.
test("names the settings values routing ignores", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { thinking: { normal: 42 }, steps: { "opsx-apply": { role: "teleport" } } },
	});

	const report = await status(pi);

	expect(report).toContain("ignored settings:");
	expect(report).toContain("models.thinking.normal");
	expect(report).toContain("models.steps.opsx-apply.role");
});

test("says no request has run since the last reload", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	registerManagedCommands(asExtensionApi(pi), { phase: createRoutingPhase(), patchSettings: () => {} });

	const report = await status(pi);

	expect(report).toContain("last request: none since the last reload");
});

// spec "managed-commands / save はディスク上の結果と実効状態を区別する": the report is where that distinction
// has to survive. A save rewrites the global file, the trusted project file keeps overwriting the keys it
// names, and a reload hands the extension that merged answer back. The report therefore reports the merge,
// and it says nothing about the save that produced the file — the file is the record, and a save history in
// `status` would be a second, unreliably updated one.
test("status reports effective settings after save and reload", async () => {
	const dir = mkdtempSync(join(tmpdir(), "spirits-status-save-"));
	const globalPath = join(dir, "settings.json");
	writeFileSync(
		globalPath,
		JSON.stringify({ models: { role: "strong", normal: "compat-fake/fake-strong", strong: "compat-fake/fake-strong" } }, null, 2),
		"utf-8",
	);
	// The project file pi merges over the global one. Its `models.normal` is what the session actually runs on.
	const project = { models: { normal: "compat-fake/fake-model" } };

	// The session as it stands before the save: the lock was moved to `normal`, and the routing model is selected.
	const before = wire(effectiveSettings(readSettingsFile(globalPath), project), { lastRequest: false, savePath: globalPath });
	before.phase.setRole("normal");
	const saved = fakeCommandContext({ available: CATALOG, model: AUTO, authedProviders: ["compat-fake"] });
	await before.pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", saved.ctx);

	// The write went to the global file, and to no other file: the project's `models.normal` is untouched, and
	// the global one still names the model the project overrides.
	const onDisk = JSON.parse(readFileSync(globalPath, "utf-8")) as Record<string, unknown>;
	expect(onDisk).toEqual({
		models: { role: "normal", normal: "compat-fake/fake-strong", strong: "compat-fake/fake-strong" },
		defaultProvider: "spirits",
		defaultModel: "auto",
	});
	expect(saved.notices.join("\n")).toContain("saved");

	// The reload: a fresh extension reading the effective settings pi composes from the file the save just
	// wrote and the project file it still trusts. The lock comes back from those settings, the way a start
	// puts them on the phase.
	const reloaded = wire(effectiveSettings(onDisk, project), { lastRequest: false });
	const report = await status(reloaded.pi, { authedProviders: ["compat-fake"] });

	// The report follows the effective settings, not the file: `normal` answers with the project's model, and
	// the global file's `compat-fake/fake-strong` appears nowhere in the line for it.
	expect(report).toContain("lock: normal");
	expect(report).toContain("normal: compat-fake/fake-model (models.normal)");
	expect(report).not.toContain("normal: compat-fake/fake-strong");
	// `status` holds no record of the save that produced this file.
	expect(report).not.toContain("sav");
});

// The report is a pure function of its input, which is what lets the wording be checked without a host.
test("renders the report in one message", () => {
	const report: RoleStatusReport = {
		routingEnabled: true,
		sessionModel: "spirits/auto",
		routingModelInScope: true,
		routingModelAvailable: true,
		interactive: true,
		lock: "normal",
		last: { role: "normal", model: "compat-fake/fake-model" },
		normal: { role: "normal", target: "compat-fake/fake-model", source: "pi's default model" },
		strong: { role: "strong", target: "unset", source: "models.strong is not set" },
		stepSettings: [],
		ignored: [],
	};

	const text = formatRoleStatus(report);

	// One message, one line per fact, and no line for a section that has nothing in it.
	expect(text.split("\n")).toHaveLength(6);
	expect(text).not.toContain("step settings:");
	expect(text).not.toContain("ignored settings:");
	// A step that is not running is still reported, because "no step" is the answer to the question.
	expect(text).toContain("step: none");
});

// The records a report reads back are the ones the routing and the command surface wrote, so a step
// that ended stays ended in the report as well.
test("a step that ended reports no step", async () => {
	const branch: SessionEntry[] = [
		makeCustomEntry(ROLE_ENTRY_TYPE, { role: "strong" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: null }),
	];
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	// A reload reads that branch: the newest step record says "no step", so nothing is restored.
	const started = fakeCommandContext({ available: CATALOG, model: AUTO, branch });
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	expect(await status(pi)).toContain("step: none");
});
