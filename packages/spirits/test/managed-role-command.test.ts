/**
 * `/spirits-role`: the argument grammar, the model-reference resolution it does before writing, and
 * the order the writes and the reload land in.
 *
 * The settings file itself is exercised in `managed-commands.test.ts`; the running report in
 * `managed-role-status.test.ts`; the warnings in `managed-role-warning.test.ts`; the completion in
 * `managed-role-completion.test.ts`. Everything here runs against the test doubles, so no pi process
 * and no settings file is involved.
 */

import { expect, test } from "bun:test";
import { asExtensionApi, customEntry, fakeModel, nextEntryId, slashCommandInfo } from "./host/fake-pi.ts";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { COMMAND_SPIRITS_ROLE, ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { parseRoleCommand, resolveModelTarget } from "../src/commands/role.ts";
import { decideSave } from "../src/commands/role-write.ts";
import type { SessionSelection } from "../src/commands/role-write.ts";
import type { SettingsPatch, SettingsPath } from "../src/commands/settings-store.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { fakeCommandContext, FakePi } from "./routing/fake-pi.ts";
import { mergeSettingsPatch } from "./support.ts";

const FAKE_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { name: "Fake", api: "openai" });
const FAKE_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { name: "Fake Strong", api: "openai" });
const CATALOG = [FAKE_MODEL, FAKE_STRONG];
/** The selection that puts the routing in force, which is what the badge projects from. */
const AUTO: PiModel = fakeModel("spirits", "auto", { name: "Auto", api: "pi-virtual" });
/** Settings both roles resolve under, so a badge has a role and a model to name.
 *  Every wiring here that draws the badge reads them. */
const SETTINGS = { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } };

/** One wiring of the command surface, with both settings writers replaced by recorders. */
function wire(branch: readonly SessionEntry[] = [], globalFile: Record<string, unknown> = {}) {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	const flat: SettingsPatch[] = [];
	const paths: Array<{ path: SettingsPath; value: unknown }> = [];
	// The `save` writes through the conditional entry, so the recorder keeps a stand-in for the file on
	// disk: the decider reads it and the recording is one write per decision that asked for one.
	let disk: Record<string, unknown> = globalFile;
	let saveCalls = 0;
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: (patch) => flat.push(patch),
		patchSettingsPath: (path, value) => paths.push({ path, value }),
		saveSettings: (decide) => {
			saveCalls += 1;
			const patch = decide(disk);
			if (patch === undefined) return undefined;
			disk = mergeSettingsPatch(disk, patch);
			return disk;
		},
	});
	return { pi, phase, flat, paths, set: paths, saves: () => saveCalls, disk: () => disk };
}

async function run(pi: FakePi, args: string, options: Parameters<typeof fakeCommandContext>[0] = {}) {
	const context = fakeCommandContext({ available: CATALOG, ...options });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler(args, context.ctx);
	return context;
}

// --------------------------------------------------------------- the grammar

// spec "managed-commands / 対象 項目 値の文法で設定する". One case per shape, because the shapes are
// what the caller has to get right and each fails in its own way.
test("grammar reads object, item, and value", () => {
	// A bare role locks; a bare step is a usage, because a step names no action by itself.
	expect(parseRoleCommand("strong")).toEqual({ kind: "lock", role: "strong" });
	expect(parseRoleCommand("normal")).toEqual({ kind: "lock", role: "normal" });
	// No arguments is the settings list, and `status` is the report.
	expect(parseRoleCommand("")).toEqual({ kind: "panel" });
	expect(parseRoleCommand("   ")).toEqual({ kind: "panel" });
	expect(parseRoleCommand("status")).toEqual({ kind: "status" });

	// A role's own items.
	expect(parseRoleCommand("strong model compat-fake/fake-strong")).toEqual({
		kind: "set",
		setting: { target: "role", name: "strong", item: "model" },
		value: "compat-fake/fake-strong",
	});
	expect(parseRoleCommand("normal thinking high")).toEqual({
		kind: "set",
		setting: { target: "role", name: "normal", item: "thinking" },
		value: "high",
	});
	// A step's items, and the `unset` word, which the caller reads as "delete the key".
	expect(parseRoleCommand("opsx-propose role strong")).toEqual({
		kind: "set",
		setting: { target: "step", name: "opsx-propose", item: "role" },
		value: "strong",
	});
	expect(parseRoleCommand("opsx-propose thinking high")).toEqual({
		kind: "set",
		setting: { target: "step", name: "opsx-propose", item: "thinking" },
		value: "high",
	});
	expect(parseRoleCommand("opsx-propose thinking unset")).toEqual({
		kind: "set",
		setting: { target: "step", name: "opsx-propose", item: "thinking" },
		value: undefined,
	});
});

// spec scenario "大文字小文字を区別しない"
test("every word matches without regard to case", () => {
	expect(parseRoleCommand("STRONG")).toEqual({ kind: "lock", role: "strong" });
	expect(parseRoleCommand("OpsX-Propose Role STRONG")).toEqual({
		kind: "set",
		setting: { target: "step", name: "opsx-propose", item: "role" },
		value: "strong",
	});
	expect(parseRoleCommand("Normal Thinking OFF")).toEqual({
		kind: "set",
		setting: { target: "role", name: "normal", item: "thinking" },
		value: "off",
	});
	expect(parseRoleCommand("opsx-verify THINKING Unset")).toEqual({
		kind: "set",
		setting: { target: "step", name: "opsx-verify", item: "thinking" },
		value: undefined,
	});
});

// spec scenario "空白を含むモデル参照": only a model reference runs to the end of the line.
test("a model reference keeps its spaces", () => {
	expect(parseRoleCommand("normal model Local/Qwen3.8 Flash Next").kind).toBe("set");
	expect(parseRoleCommand("normal model Local/Qwen3.8 Flash Next")).toEqual({
		kind: "set",
		setting: { target: "role", name: "normal", item: "model" },
		value: "Local/Qwen3.8 Flash Next",
	});
	// A thinking level is one word, so a second word is not part of it.
	expect(parseRoleCommand("normal thinking high strong").kind).toBe("usage");
});

// spec scenarios "空白を含むモデル参照" and "ID に空白を含む": the reference runs to the end of the
// line, and the resolution matches it against `provider/id` and the id, not against the display name.
test("resolves and saves a model whose id has spaces", async () => {
	const spaced: PiModel = fakeModel("Local", "Qwen3.8 Flash Next", { api: "openai" });
	const { pi, paths } = wire();

	const { notices } = await run(pi, "normal model Local/Qwen3.8 Flash Next", { available: [spaced] });

	expect(notices.some((notice) => notice.includes("no model matches"))).toBe(false);
	expect(paths).toEqual([{ path: ["models", "normal"], value: "Local/Qwen3.8 Flash Next" }]);

	// A model whose display name has the spaces but whose id does not is not reachable by that name: the
	// rule matches the id, as the retired model-selection command did (design Decision 7).
	const namedOnly: PiModel = fakeModel("Local", "qwen3.8-flash-next", { name: "Qwen3.8 Flash Next", api: "openai" });
	const named = wire();
	const refused = await run(named.pi, "normal model Qwen3.8 Flash Next", { available: [namedOnly] });
	expect(named.paths).toEqual([]);
	expect(refused.notices.at(-1)).toContain("no model matches");
});

// spec scenarios "項目を省略したステップ指定" and "空のモデル参照"
test("an omitted item or an empty value is a usage", () => {
	expect(parseRoleCommand("opsx-propose").kind).toBe("usage");
	expect(parseRoleCommand("normal model").kind).toBe("usage");
	expect(parseRoleCommand("normal thinking").kind).toBe("usage");
	expect(parseRoleCommand("opsx-apply role").kind).toBe("usage");
	expect(parseRoleCommand("status now").kind).toBe("usage");
});

// spec scenarios "解釈できない入力は変更しない" and "一覧に無い語は設定を変更しない"
test("leaves everything alone on an unparseable line", async () => {
	const { pi, phase, flat, paths } = wire();

	for (const args of ["strong bogus high", "teleport role strong", "gpt-5", "opsx-propose model strong", "opsx-propose thinking teleport"]) {
		const { notices, reloads } = await run(pi, args);
		expect(phase.current()).toBe("normal");
		expect(flat).toEqual([]);
		expect(paths).toEqual([]);
		expect(pi.entries).toEqual([]);
		expect(reloads()).toBe(0);
		expect(notices.at(-1)).toContain("use /spirits-role");
	}
});

// The usage is the only place the command explains itself, and a continuing step is the state a user is
// most likely to want out of, so the line names how a step ends (spec `managed-commands` /
// `/spirits-role` は対象 項目 値の文法で設定する, design Risks).
test("the usage names how a step ends", async () => {
	const { pi } = wire();

	const { notices } = await run(pi, "gibberish");

	const usage = notices.at(-1) ?? "";
	expect(usage).toContain("/spirits-clear");
	expect(usage).toMatch(/step ends|a step ends/);
	// A lock ends a step too, which is the other half of the way out.
	expect(usage).toContain("a role lock");
});

// spec scenario "引数誤りの使い方に save が載る": the usage is the only place a user learns the word
// exists, so it names `save` as a target that takes no item and no value.
test("the usage names save", async () => {
	const { pi } = wire();

	const { notices } = await run(pi, "bogus");

	const usage = notices.at(-1) ?? "";
	expect(usage).toContain("/spirits-role save");
	expect(usage).toMatch(/no item or value/);
});

// --------------------------------------------------------------- the writes

test("a role lock records the session entry and saves the default role", async () => {
	const { pi, phase, flat } = wire();
	const context = await run(pi, "strong", { model: FAKE_MODEL, thinkingLevel: "medium" });

	expect(phase.current()).toBe("strong");
	expect(pi.entries).toEqual([{ customType: ROLE_ENTRY_TYPE, data: { role: "strong" } }]);
	expect(flat).toEqual([{ models: { role: "strong" } }]);
	expect(context.reloads()).toBe(1);
	// spec scenario "現在のモデルのまま strong にする": a lock changes the role only. The session's model
	// and thinking level are still what pi selected before the command ran.
	expect(context.ctx.model).toBe(FAKE_MODEL);
	expect(context.ctx.thinkingLevel).toBe("medium");
	expect(pi.modelChanges).toEqual([]);
	expect(pi.thinkingChanges).toEqual([]);
});

// spec "dual-model-routing / ロールのロックはステップを終える": the lock is an end condition, and the
// step record the routing layer keeps has to say the same thing the phase does.
test("a role lock ends the running step", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase({ listCommands: () => [slashCommandInfo("skill:openspec-apply-change", "skill")] });
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: () => {}, patchSettingsPath: () => {} });

	// The routing layer's own `input` handler feeds the phase; the command surface only ends steps.
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	await run(pi, "strong");

	expect(phase.step()).toBeUndefined();
	expect(phase.current()).toBe("strong");
});

test("a step setting writes only its own key path", async () => {
	const { pi, paths } = wire();

	await run(pi, "opsx-propose role strong");
	await run(pi, "opsx-propose thinking high");
	await run(pi, "normal thinking max");

	expect(paths).toEqual([
		{ path: ["models", "steps", "opsx-propose", "role"], value: "strong" },
		{ path: ["models", "steps", "opsx-propose", "thinking"], value: "high" },
		{ path: ["models", "thinking", "normal"], value: "max" },
	]);
});

test("an unset deletes the key rather than writing the word", async () => {
	const { pi, paths } = wire();

	await run(pi, "opsx-propose thinking unset");
	await run(pi, "strong model unset");

	expect(paths).toEqual([
		{ path: ["models", "steps", "opsx-propose", "thinking"], value: undefined },
		{ path: ["models", "strong"], value: undefined },
	]);
});

// --------------------------------------------------------------- model references

// spec "managed-commands / ロールのモデルの参照は完全一致から部分一致で決める"
test("resolves a role model reference", () => {
	expect(resolveModelTarget(CATALOG, "compat-fake/fake-strong")).toEqual({ model: FAKE_STRONG });
	// A bare id reaches the same entry, and a case-insensitive substring does too.
	expect(resolveModelTarget(CATALOG, "fake-model")).toEqual({ model: FAKE_MODEL });
	expect(resolveModelTarget(CATALOG, "FAKE-STRONG")).toEqual({ model: FAKE_STRONG });

	// Through the command, the resolved `provider/id` is what gets saved.
	const { pi, paths } = wire();
	void run(pi, "strong model fake-strong");
	expect(paths).toEqual([{ path: ["models", "strong"], value: "compat-fake/fake-strong" }]);
});

test("refuses a reference that matches no model", async () => {
	const { pi, paths } = wire();

	const { notices, reloads } = await run(pi, "strong model nowhere/nothing");

	expect(paths).toEqual([]);
	expect(reloads()).toBe(0);
	expect(notices.at(-1)).toContain('no model matches "nowhere/nothing"');
});

test("refuses an ambiguous reference", async () => {
	const { pi, paths } = wire();

	const { notices, reloads } = await run(pi, "normal model fake");

	expect(paths).toEqual([]);
	expect(reloads()).toBe(0);
	// The message names the count and shows candidates, which is what the user types back.
	expect(notices.at(-1)).toContain("matches 2 models");
	expect(notices.at(-1)).toContain("compat-fake/fake-model");
});

// The routing entry routes requests instead of answering them, so it can never be a role target. The
// test reads the api, not the name: a routing entry called anything else is still excluded.
test("the routing model is never a role target", () => {
	const routing: PiModel = fakeModel("other", "router", { api: "pi-virtual" });
	expect(resolveModelTarget([routing, FAKE_MODEL], "other/router")).toHaveProperty("error");
	expect(resolveModelTarget([routing, FAKE_MODEL], "fake-model")).toEqual({ model: FAKE_MODEL });
});

// --------------------------------------------------------------- the order of writes and reload

// spec "managed-commands / `/spirits-role` は選んだ値を既定として保存する": the reload is the last
// statement, because it retires this command's `pi` handle and context.
test("reloads last", async () => {
	const order: string[] = [];
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => order.push("write"),
	});
	const context = fakeCommandContext({ available: CATALOG });
	const counted = new Proxy(context.ctx, {
		get(target, key) {
			if (key === "reload") {
				return async () => {
					order.push("reload");
					context.reloads();
				};
			}
			return Reflect.get(target, key);
		},
	});

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("strong", counted);

	// The session lock came first, then the file, then the reload, and nothing after it.
	expect(order).toEqual(["write", "reload"]);
	expect(phase.current()).toBe("strong");
});

// spec scenario "role を選んだときに描画する": the badge is the session's, not the runtime's, so it goes
// up on the lock the command just applied and before the reload that replaces the runtime drawing it.
test("a role lock draws the badge before the reload", async () => {
	const order: string[] = [];
	const pi = new FakePi();
	pi.settings = SETTINGS;
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		badge: { update: (lines) => order.push(`badge:${lines.role}`) },
		patchSettings: () => order.push("write"),
	});
	const context = fakeCommandContext({ available: CATALOG, authedProviders: ["compat-fake"], model: AUTO });
	const counted = new Proxy(context.ctx, {
		get(target, key) {
			if (key === "reload") {
				return async () => {
					order.push("reload");
				};
			}
			return Reflect.get(target, key);
		},
	});

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("strong", counted);

	expect(order).toEqual(["write", "badge:[strong]", "reload"]);
	expect(phase.current()).toBe("strong");
});

// spec scenario "設定の書き込みが失敗する": the session keeps what pi accepted, and nothing is reloaded.
test("keeps the session lock when the settings write fails", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {
			throw new Error("the file is locked");
		},
	});

	const { notices, reloads } = await run(pi, "strong");

	expect(phase.current()).toBe("strong");
	expect(pi.entries).toEqual([{ customType: ROLE_ENTRY_TYPE, data: { role: "strong" } }]);
	expect(notices.at(-1)).toContain("role locked to strong");
	expect(notices.at(-1)).toContain("the default role was not saved");
	expect(notices.at(-1)).toContain("the file is locked");
	expect(reloads()).toBe(0);
});

test("a failed settings write for a step is reported the same way", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettingsPath: () => {
			throw new Error("EACCES: permission denied");
		},
	});

	const { notices, reloads } = await run(pi, "opsx-verify thinking low");

	expect(notices.at(-1)).toContain("set opsx-verify thinking low");
	expect(notices.at(-1)).toContain("the setting was not saved");
	expect(notices.at(-1)).toContain("EACCES");
	expect(reloads()).toBe(0);
});

// --------------------------------------------------------------- the save decision

/**
 * The decision `save` makes, read off `decideSave` directly.
 *
 * The preview and the write share this function, and the difference between them is only which copy of
 * the global file it is handed. Everything below therefore passes a settings object in the shape the file
 * has — the keys pi owns at the top level and the spirits keys under `models` — and reads back the three
 * keys `save` may move.
 */
const AUTO_SELECTION = { provider: "spirits", id: "auto" };

/** A catalog in the shape the decision reads: the models there, and which providers can answer. */
function lookup(models: readonly PiModel[], authed: readonly string[] = ["compat-fake"]) {
	return {
		getAvailable: () => models.filter((model) => authed.includes(model.provider)),
		hasConfiguredAuth: (model: PiModel) => authed.includes(model.provider),
		// Provenance known and empty: the pinned host always answers this, and no extension registered a
		// provider in this catalog.
		getRegisteredProviderIds: () => [],
	};
}

// spec scenario "旧既定だけが normal を解決する" and scenario "成功履歴または project の指定だけで解決する":
// `spirits/auto` answers a normal request through `models.normal` and nothing else, so the check is made
// against the global file with the new defaults already in it and with no history. The old default model
// is gone by then — the save replaces it — and a session that is answering today out of its own successful
// responses or out of a project file has nothing a new session will read.
test("save checks normal against the prospective global defaults without history", () => {
	const catalog = [FAKE_MODEL, FAKE_STRONG];
	const selection: SessionSelection = { role: "strong", model: AUTO_SELECTION };

	// Only the old default resolves normal: no `models.normal` at all. The routing's resolver reaches the
	// old default through the file, and the prospective file has replaced it with `spirits/auto`, which is
	// virtual and cannot answer.
	const oldDefaultOnly = decideSave(selection, { defaultProvider: "compat-fake", defaultModel: "fake-model" }, lookup(catalog));
	expect(oldDefaultOnly.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
	expect(oldDefaultOnly.skipped).toContain("models.normal");

	// A `models.normal` the new defaults still resolve: both halves go.
	const withNormal = decideSave(
		selection,
		{ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { normal: "compat-fake/fake-model" } },
		lookup(catalog),
	);
	expect(withNormal.writes).toEqual([
		{ path: ["models", "role"], value: "strong" },
		{ path: ["defaultProvider"], value: "spirits" },
		{ path: ["defaultModel"], value: "auto" },
	]);
	expect(withNormal.skipped).toBeUndefined();

	// spec scenario "provider を省略した normal が保存後に解決できない": today the bare id resolves against
	// the file's `compat-fake`, so the session works. The save would move the default provider to `spirits`,
	// and the same bare id then reaches nothing.
	const bareId = decideSave(
		selection,
		{ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { normal: "fake-model" } },
		lookup(catalog),
	);
	expect(bareId.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
	// The reason carries the way out and names models the session can actually answer with.
	expect(bareId.skipped).toContain("/spirits-role normal model");
	expect(bareId.skipped).toContain("compat-fake/fake-model");

	// A `models.normal` the catalog holds but no credentials cover is not a resolution either.
	const noCredentials = decideSave(
		selection,
		{ models: { normal: "compat-fake/fake-model" } },
		lookup(catalog, []),
	);
	expect(noCredentials.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);

	// The decision takes no `previous` model and no project settings, so there is nothing for a history or
	// a project file to enter through: the same file that skipped above still skips however the session is
	// doing today.
	const unreadableProvider = decideSave(selection, { models: { normal: "compat-fake/fake-model" } }, lookup(catalog, []));
	expect(unreadableProvider.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
});

// spec scenario "物理モデルを選んでいるときに保存する" and scenario "モデルを選択していない": the safety check
// belongs to `spirits/auto` alone, and a session with no selection has no default model to state.
test("save plans a physical model or a role without a model", () => {
	const catalog = [FAKE_MODEL, FAKE_STRONG];

	// A physical default always resolves: a session that starts on one is an ordinary session, with no
	// routing to fall through. The step's own role is no part of this — the selection comes from the lock.
	const physical = decideSave(
		{ role: "normal", model: { provider: "compat-fake", id: "fake-strong" } },
		{ models: { role: "strong", normal: "nowhere/nothing" } },
		lookup(catalog),
	);
	expect(physical.writes).toEqual([
		{ path: ["models", "role"], value: "normal" },
		{ path: ["defaultProvider"], value: "compat-fake" },
		{ path: ["defaultModel"], value: "fake-strong" },
	]);
	// A `models.normal` nothing resolves is no obstacle here, and saying so is the point: the file that
	// would refuse the routing model accepts a physical one untouched.
	expect(physical.skipped).toBeUndefined();

	// A session with no model selected still has a lock to save, and the reason travels with it.
	const roleOnly = decideSave({ role: "strong" }, { defaultProvider: "compat-fake", defaultModel: "fake-model" }, lookup(catalog));
	expect(roleOnly.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
	expect(roleOnly.skipped).toContain("no model is selected");

	// The file already holds the lock and the session did select a model, so there is nothing to write and
	// nothing was held back. This is the case that leaves the file's bytes alone.
	const settled = decideSave({ role: "normal", model: { provider: "compat-fake", id: "fake-model" } }, { models: { role: "normal" }, defaultProvider: "compat-fake", defaultModel: "fake-model" }, lookup(catalog));
	expect(settled.writes).toEqual([]);
	expect(settled.skipped).toBeUndefined();

	// A session with no model is the one case that always has a reason, even when the role matches: the row
	// has to say why no model was saved as well as that the role needed nothing.
	const nothingAtAll = decideSave({ role: "normal" }, { models: { role: "normal" } }, lookup(catalog));
	expect(nothingAtAll.writes).toEqual([]);
	expect(nothingAtAll.skipped).toContain("no model is selected");
});

// spec scenario "ディスクの既定値に前後の空白がある": Pi reads `defaultProvider` / `defaultModel` as they
// are written and searches for them as they are written, so a padded value is not the value the session
// selected — it is a difference, and the save rewrites it to the selected spelling.
test("save compares the raw default values", () => {
	const selection: SessionSelection = { role: "normal", model: { provider: "compat-fake", id: "fake-strong" } };

	// The file holds the same model with a padded provider: a difference, not a match.
	const padded = decideSave(
		selection,
		{ models: { role: "normal" }, defaultProvider: " compat-fake ", defaultModel: "fake-strong" },
		lookup(CATALOG),
	);
	expect(padded.writes).toEqual([
		{ path: ["defaultProvider"], value: "compat-fake" },
		{ path: ["defaultModel"], value: "fake-strong" },
	]);

	// The same values without the padding are the same settings, so the file is left alone.
	const exact = decideSave(
		selection,
		{ models: { role: "normal" }, defaultProvider: "compat-fake", defaultModel: "fake-strong" },
		lookup(CATALOG),
	);
	expect(exact.writes).toEqual([]);
});

// spec scenario "provider を省略した normal が保存後に解決できない" read against provider provenance: the
// host publishes the providers an extension registered, and a model one of them provides is not a global
// default — a new session in another project starts without that extension.
test("save refuses the routing model when only the project catalog can answer", () => {
	const selection: SessionSelection = { role: "strong", model: AUTO_SELECTION };
	const projectLookup = {
		getAvailable: () => CATALOG,
		hasConfiguredAuth: () => true,
		getRegisteredProviderIds: () => ["compat-fake"],
	};

	const decision = decideSave(
		selection,
		{ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { normal: "compat-fake/fake-model" } },
		projectLookup,
	);
	expect(decision.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
	expect(decision.skipped).toContain("models.normal");

	// A provider the host does not list as extension-registered is one the global file can vouch for, so
	// the same settings save both halves.
	const globalLookup = {
		getAvailable: () => CATALOG,
		hasConfiguredAuth: () => true,
		getRegisteredProviderIds: () => [],
	};
	const allowed = decideSave(
		selection,
		{ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { normal: "compat-fake/fake-model" } },
		globalLookup,
	);
	expect(allowed.writes).toEqual([
		{ path: ["models", "role"], value: "strong" },
		{ path: ["defaultProvider"], value: "spirits" },
		{ path: ["defaultModel"], value: "auto" },
	]);

	// A host that publishes no provenance cannot vouch for any model, so the safe side is declining
	// the two model keys rather than writing a default no other project can resolve.
	const unknown = decideSave(
		selection,
		{ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { normal: "compat-fake/fake-model" } },
		{ getAvailable: () => CATALOG, hasConfiguredAuth: () => true },
	);
	expect(unknown.writes).toEqual([{ path: ["models", "role"], value: "strong" }]);
	expect(unknown.skipped).toContain("models.normal");
});

// The same refusal through the command: the role lands, the two model keys stay, and the notice says why.
test("a save from a project-only provider leaves the model keys alone", async () => {
	const { pi, phase, disk } = wire([], {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { role: "normal", normal: "compat-fake/fake-model" },
	});
	phase.setRole("strong");

	const { notices } = await run(pi, "save", { model: AUTO, authedProviders: ["compat-fake"], registeredProviders: ["compat-fake"] });

	expect(disk()).toEqual({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { role: "strong", normal: "compat-fake/fake-model" },
	});
	expect(notices[0]).toContain("saved");
	expect(notices[0]).toContain("models.normal");
});

// --------------------------------------------------------------- the save command

// spec "managed-commands / `/spirits-role save` はセッションの選択状況を設定に保存する": the decision is one
// call to the conditional writer whether it ends in a write or not, and none of the three outcomes reloads.
test("save distinguishes a write, no change and failure", async () => {
	// A write: the file has no role and no default, and the session holds both.
	const wrote = wire();
	wrote.phase.setRole("strong");
	const first = await run(wrote.pi, "save", { model: FAKE_MODEL });
	expect(wrote.saves()).toBe(1);
	expect(wrote.disk()).toEqual({ models: { role: "strong" }, defaultProvider: "compat-fake", defaultModel: "fake-model" });
	expect(first.notices[0]).toContain("saved");
	// A save leaves this session alone, so even a landed write earns no reload.
	expect(first.reloads()).toBe(0);

	// No change: the same command on the same file, now in agreement with the session.
	const unchanged = wire();
	unchanged.phase.setRole("strong");
	await run(unchanged.pi, "save", { model: FAKE_MODEL });
	const second = await run(unchanged.pi, "save", { model: FAKE_MODEL });
	// The second save still asks the file — that is where a change is detected — and asks it once.
	expect(unchanged.saves()).toBe(2);
	expect(second.notices.at(-1)).toContain("nothing to save");
	// A write that never happened earns no runtime restart.
	expect(second.reloads()).toBe(0);

	// Failure: the file refuses, and the notice says so without claiming the save.
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		saveSettings: () => {
			throw new Error("EACCES: the settings file is read-only");
		},
	});
	phase.setRole("strong");
	const failed = await run(pi, "save", { model: FAKE_MODEL });
	expect(failed.notices.at(-1)).toContain("read-only");
	// Nothing applied, so the refusal is the whole sentence: a save that wrote no key must not read as a
	// change that only the file lost.
	expect(failed.notices.at(-1)).toContain("the global settings file was not saved");
	expect(failed.notices.at(-1)).not.toMatch(/^[;,]/);
	expect(failed.reloads()).toBe(0);
});

// spec "managed-commands / save はディスク上の結果と実効状態を区別する": a save never reloads. A reload
// would re-read the project defaults over the lock and step this session holds, and the host refuses one
// while a response is running, so the command reports and stops — wrote, unchanged, or refused alike.
// The order is watched here rather than inferred from a count.
test("the save command reports and does not reload", async () => {
	const order: string[] = [];
	const pi = new FakePi();
	const phase = createRoutingPhase();
	let disk: Record<string, unknown> = { models: { role: "strong" } };
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		readGlobalSettings: () => disk,
		saveSettings: (decide) => {
			const patch = decide(disk);
			order.push("ask the file");
			if (patch === undefined) return undefined;
			disk = mergeSettingsPatch(disk, patch);
			return disk;
		},
	});
	// The context is watched, so the order says whether the handler touched it after the reload retired it.
	const watch = (onReload: () => void) =>
		new Proxy(context.ctx, {
			get(target, key) {
				if (key === "reload") {
					return async () => {
						order.push("reload");
						onReload();
					};
				}
				return Reflect.get(target, key);
			},
		});
	phase.setRole("normal");
	const context = fakeCommandContext({ available: CATALOG, model: AUTO, authedProviders: ["compat-fake"] });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", watch(() => context.reloads()));

	// The role landed and the model was held back, and the one notice carries both facts.
	expect(context.notices).toHaveLength(1);
	expect(context.notices[0]).toContain("saved");
	expect(context.notices[0]).toContain("models.normal");
	// The file is asked once and nothing is reloaded, whatever the file answered.
	expect(order).toEqual(["ask the file"]);
	expect(context.reloads()).toBe(0);
	// A command about the next session leaves this one alone: no lock change, no session record.
	expect(phase.current()).toBe("normal");
	expect(pi.entries).toEqual([]);

	// The same command with nothing left to write: the file is still asked — that is where a change would be
	// noticed — and still no reload follows.
	order.length = 0;
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", watch(() => context.reloads()));
	expect(order).toEqual(["ask the file"]);
	expect(context.reloads()).toBe(0);
});

// spec scenario "保存する乖離が無い" and the session half of every save scenario: the command writes a file
// and leaves the session exactly where it was.
test("save writes the file and changes nothing about the session", async () => {
	const { pi, phase } = wire();
	phase.setRole("strong");
	// A step is running, and it is not the role the save is about to make the default.
	const context = await run(pi, "save", { model: AUTO, thinkingLevel: "medium" });

	expect(phase.current()).toBe("strong");
	expect(phase.step()).toBeUndefined();
	// No lock record, no step record: `save` answers a question about the next session, and this one's
	// records say what this one is doing.
	expect(pi.entries).toEqual([]);
	expect(pi.modelChanges).toEqual([]);
	expect(pi.thinkingChanges).toEqual([]);
	expect(context.ctx.model).toBe(AUTO);
	expect(context.ctx.thinkingLevel).toBe("medium");
});

// spec scenario "対話端末以外では一覧を開かない" for print: the argumentless command opens nothing and
// reports nothing, because print's stdout is the model's answer and the extension adds no second output.
test("print prints no status for the argumentless command", async () => {
	const { pi } = wire();

	const context = fakeCommandContext({ available: CATALOG, model: AUTO, mode: "print" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("", context.ctx);

	expect(context.notices).toEqual([]);
	expect(context.custom.components).toHaveLength(0);
	expect(context.reloads()).toBe(0);
});

// spec scenario "保存後も現在のセッションのロックとステップは変わらない": a save writes the next session's
// defaults and never reloads, so a session whose lock disagrees with the project default keeps the lock it
// has, and the step it is running keeps running.
test("save keeps the current lock and step", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase({ listCommands: () => [slashCommandInfo("skill:openspec-apply-change", "skill")] });
	let disk: Record<string, unknown> = { models: { role: "normal" } };
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		saveSettings: (decide) => {
			const patch = decide(disk);
			if (patch === undefined) return undefined;
			disk = mergeSettingsPatch(disk, patch);
			return disk;
		},
	});
	phase.setRole("strong");
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.lock()).toBe("strong");
	expect(phase.step()?.name).toBe("opsx-apply");

	const context = fakeCommandContext({ available: CATALOG, model: FAKE_MODEL });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", context.ctx);

	// The lock and the step are this session's; the file holds what the next one starts from.
	expect(phase.lock()).toBe("strong");
	expect(phase.step()?.name).toBe("opsx-apply");
	expect(disk.models).toEqual({ role: "strong" });
	expect(context.reloads()).toBe(0);
});

// The same scenario for a step that never resolved: a reload would restore it as a step whose run was
// real, which is exactly the lifetime a save must not give it.
test("save does not change an unresolved step's lifetime", async () => {
	const runCase = async (save: boolean) => {
		const pi = new FakePi();
		const phase = createRoutingPhase({ listCommands: () => [slashCommandInfo("skill:openspec-apply-change", "skill")] });
		let disk: Record<string, unknown> = { models: { role: "normal" } };
		registerManagedCommands(asExtensionApi(pi), {
			phase,
			patchSettings: () => {},
			patchSettingsPath: () => {},
			saveSettings: (decide) => {
				const patch = decide(disk);
				if (patch === undefined) return undefined;
				disk = mergeSettingsPatch(disk, patch);
				return disk;
			},
		});
		phase.setRole("strong");
		phase.handleInput("/skill:openspec-apply-change x");
		expect(phase.step()?.name).toBe("opsx-apply");
		if (save) {
			const context = fakeCommandContext({ available: CATALOG, model: FAKE_MODEL });
			await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", context.ctx);
		}
		// The next idle input is what ends a step whose run never started.
		phase.handleInput("continue");
		return phase.step()?.name;
	};

	// With and without a save, the same rule ends it.
	expect(await runCase(true)).toBeUndefined();
	expect(await runCase(false)).toBeUndefined();
});

// spec scenario "save に項目や値を続けない".
test("save takes no item or value", async () => {
	expect(parseRoleCommand("save")).toEqual({ kind: "save" });
	expect(parseRoleCommand("SAVE")).toEqual({ kind: "save" });
	expect(parseRoleCommand("  save  ")).toEqual({ kind: "save" });

	const { pi, phase, flat, paths } = wire();
	for (const args of ["save strong", "save models.role strong", "save now"]) {
		const { notices, reloads } = await run(pi, args);
		expect(phase.current()).toBe("normal");
		expect(flat).toEqual([]);
		expect(paths).toEqual([]);
		expect(pi.entries).toEqual([]);
		expect(reloads()).toBe(0);
		const notice = notices.at(-1) ?? "";
		expect(notice).toContain("save takes no item or value");
		expect(notice).toContain("use /spirits-role");
	}
});

// spec scenario "RPC と print で保存する" and scenario "物理モデルの選択をコマンドで保存する": the write is the
// same in every mode, and what differs is only whether anyone is told.
/**
 * The save reaches the file the same way in every mode, and it speaks only through `ctx.ui.notify`.
 *
 * print is the mode the host binds no UI to, so `notify` there is the runner's no-op and the save's result
 * is readable only in the global file. The extension's own half of that rule is the one this test can
 * check: it must not open a second output path. `process.stdout.write` is watched here for exactly that,
 * and the pinned-host run repeats the whole comparison from the outside.
 */
test("saving in rpc and print uses the same settings but different notifications", async () => {
	const written: string[] = [];
	const stdout = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array) => {
		written.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	const results = [];
	try {
		for (const mode of ["tui", "rpc", "print"] as const) {
			const { pi, phase, disk } = wire([], { models: { role: "normal", normal: "compat-fake/fake-model" } });
			phase.setRole("strong");
			const context = await run(pi, "save", { model: AUTO, mode, authedProviders: ["compat-fake"] });
			results.push({ mode, disk: disk(), notices: context.notices, reloads: context.reloads() });
		}
	} finally {
		process.stdout.write = stdout;
	}

	// One file written the same way in every mode: the lock, and the routing model as the default, because
	// the file's own `models.normal` resolves under the new defaults. The role the file already held is
	// replaced and its `normal` is kept.
	for (const result of results) {
		expect(result.disk).toEqual({
			models: { role: "strong", normal: "compat-fake/fake-model" },
			defaultProvider: "spirits",
			defaultModel: "auto",
		});
		expect(result.reloads).toBe(0);
		expect(result.notices).toHaveLength(1);
		expect(result.notices[0]).toContain("saved");
		// Nothing was held back on this GIVEN, so the notice says only what landed.
		expect(result.notices[0]).not.toContain("left alone");
	}
	// Nothing went to stdout in any mode: the result is told through the host's UI, or not at all.
	expect(written).toEqual([]);
});

// spec "managed-commands / save はディスク上の結果と実効状態を区別する": the notice's kind follows the
// outcome, so a file that already agreed is information rather than an error.
test("a save that changed nothing is reported as information", async () => {
	const { pi, phase } = wire([], { models: { role: "strong" }, defaultProvider: "compat-fake", defaultModel: "fake-model" });
	phase.setRole("strong");

	const first = await run(pi, "save", { model: FAKE_MODEL });
	expect(first.notifications[0]?.type).toBe("info");

	const second = await run(pi, "save", { model: FAKE_MODEL });
	expect(second.notices.at(-1)).toContain("nothing to save");
	expect(second.notifications.at(-1)?.type).toBe("info");

	// A refusal is the one outcome that is an error.
	const refused = new FakePi();
	const refusedPhase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(refused), {
		phase: refusedPhase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		saveSettings: () => {
			throw new Error("EACCES: read-only");
		},
	});
	refusedPhase.setRole("strong");
	const failed = await run(refused, "save", { model: FAKE_MODEL });
	expect(failed.notifications.at(-1)?.type).toBe("error");
});

// spec "managed-commands / save はディスク上の結果と実効状態を区別する": モデル未選択のセッションを物理
// モデルの選択として扱わない. A session with no model selected is not told the routing is off, and a save
// that writes a role does not warn about a physical selection it does not have.
test("an unselected model is not a physical model", async () => {
	const { pi, phase } = wire([], { models: { role: "normal" } });
	phase.setRole("strong");

	const { notices } = await run(pi, "save", { model: undefined });

	expect(notices[0]).toContain("saved");
	expect(notices.join("\n")).not.toContain("routing is off");
});

// spec scenario "保存されたモデルが起動時のスコープに含まれない": save records defaults but neither
// consults the active session scope nor puts Pi's scope key into the conditional patch.
test("save ignores the session scope and never patches enabledModels", async () => {
	const { pi, phase } = wire([], { models: { role: "normal", normal: "compat-fake/fake-model" } });
	phase.setRole("strong");
	let patchKeys: string[] = [];
	let modelsPatchKeys: string[] = [];
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		saveSettings: (decide) => {
			const patch = decide({ models: { role: "normal", normal: "compat-fake/fake-model" } });
			if (patch === undefined) return undefined;
			patchKeys = Object.keys(patch).sort();
			modelsPatchKeys = Object.keys((patch.models as Record<string, unknown> | undefined) ?? {}).sort();
			return patch;
		},
	});
	const context = fakeCommandContext({ available: [AUTO, FAKE_MODEL, FAKE_STRONG], authedProviders: ["compat-fake"], model: AUTO });
	const guardedContext = new Proxy(context.ctx, {
		get(target, key, receiver) {
			if (key === "scopedModels") throw new Error("save must not read the session model scope");
			return Reflect.get(target, key, receiver);
		},
	});

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("save", guardedContext);

	expect(context.notices[0]).toContain("saved");
	expect(patchKeys).toEqual(["defaultModel", "defaultProvider", "models"]);
	expect(modelsPatchKeys).toEqual(["role"]);
	expect(patchKeys).not.toContain("enabledModels");
});

// spec "managed-commands / 物理モデル選択中の設定変更は振り分けが働いていないことを伝える": a save that landed
// is a setting change like any other, and a session sitting on a physical model is told so.
test("a save that wrote a physical default says the routing is off", async () => {
	const { pi } = wire();

	const { notices } = await run(pi, "save", { model: FAKE_MODEL });

	expect(notices[0]).toContain("saved");
	expect(notices.at(-1)).toContain("routing is off");
	expect(notices.at(-1)).toContain("spirits/auto");
});

// A save that wrote nothing has no change to comment on: the routing-off notice belongs to a change, and
// repeating it after a no-op would teach the user something they already knew.
test("a save that wrote nothing sends no routing warning", async () => {
	const { pi } = wire();
	await run(pi, "save", { model: FAKE_MODEL });

	const second = await run(pi, "save", { model: FAKE_MODEL });
	expect(second.notices).toHaveLength(1);
	expect(second.notices[0]).toContain("nothing to save");
});

// --------------------------------------------------------------- step restoration on reload

// spec "dual-model-routing / ステップの復元": a reload replaced the runtime, not the conversation.
test("a reload restores the step the session recorded", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: () => {} });
	const branch: SessionEntry[] = [
		customEntry(ROLE_ENTRY_TYPE, { role: "strong" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }, nextEntryId()),
	];

	await run(pi, "", { branch, mode: "rpc" });
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, fakeCommandContext({ branch }).ctx);

	expect(phase.current()).toBe("strong");
	expect(phase.step()?.name).toBe("opsx-apply");
});

// spec scenario "復帰でも継続中のステップを戻す": the branch's own records say what runs on it, and a
// start reads them instead of ending what it finds. A start writes nothing, so a later reload of the same
// branch reads the same step back.
test("a start that is not a reload restores the step the branch recorded", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: () => {} });
	const branch: SessionEntry[] = [customEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }, nextEntryId())];

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, fakeCommandContext({ branch }).ctx);

	expect(phase.step()?.name).toBe("opsx-apply");
	expect(pi.entries).toEqual([]);
});

// spec "dual-model-routing / 再読み込みをまたぐロックと継続中のステップ": a step that does not continue is
// the one kind an interrupted session leaves behind, and an interrupted run returns to the lock.
test("a start that is not a reload does not restore a step that ends with its run", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: () => {} });
	const branch: SessionEntry[] = [customEntry(STEP_ENTRY_TYPE, { step: "sprt-opsx-verify-deep" }, nextEntryId())];

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, fakeCommandContext({ branch }).ctx);

	expect(phase.step()).toBeUndefined();
	// This wiring has no routing layer, so no step hook is attached and nothing can be recorded here. What the
	// rejection of such a record writes to the session file is checked in `routing-phase-reload.test.ts`,
	// where both layers are registered the way `src/index.ts` registers them.
	expect(pi.entries).toEqual([]);
});
