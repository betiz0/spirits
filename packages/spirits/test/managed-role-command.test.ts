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
import type { PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { COMMAND_SPIRITS_ROLE, ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { parseRoleCommand, resolveModelTarget } from "../src/commands/role.ts";
import type { SettingsPatch, SettingsPath } from "../src/commands/settings-store.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { FakePi, fakeCommandContext } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = { provider: "compat-fake", id: "fake-model", name: "Fake", api: "openai" };
const FAKE_STRONG: PiModel = { provider: "compat-fake", id: "fake-strong", name: "Fake Strong", api: "openai" };
const CATALOG = [FAKE_MODEL, FAKE_STRONG];

/** One wiring of the command surface, with both settings writers replaced by recorders. */
function wire(branch: readonly SessionEntry[] = []) {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	const flat: SettingsPatch[] = [];
	const paths: Array<{ path: SettingsPath; value: unknown }> = [];
	registerManagedCommands(pi, {
		phase,
		patchSettings: (patch) => flat.push(patch),
		patchSettingsPath: (path, value) => paths.push({ path, value }),
	});
	return { pi, phase, flat, paths, set: paths };
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
	const spaced: PiModel = { provider: "Local", id: "Qwen3.8 Flash Next", api: "openai" };
	const { pi, paths } = wire();

	const { notices } = await run(pi, "normal model Local/Qwen3.8 Flash Next", { available: [spaced] });

	expect(notices.some((notice) => notice.includes("no model matches"))).toBe(false);
	expect(paths).toEqual([{ path: ["models", "normal"], value: "Local/Qwen3.8 Flash Next" }]);

	// A model whose display name has the spaces but whose id does not is not reachable by that name: the
	// rule matches the id, as the retired model-selection command did (design Decision 7).
	const namedOnly: PiModel = { provider: "Local", id: "qwen3.8-flash-next", name: "Qwen3.8 Flash Next", api: "openai" };
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
	const phase = createRoutingPhase({ listCommands: () => [{ name: "skill:openspec-apply-change", source: "skill" }] });
	registerManagedCommands(pi, { phase, patchSettings: () => {}, patchSettingsPath: () => {} });

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
	const routing: PiModel = { provider: "other", id: "router", api: "pi-virtual" };
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
	registerManagedCommands(pi, {
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
	const phase = createRoutingPhase();
	registerManagedCommands(pi, {
		phase,
		badge: { update: (role) => order.push(`badge:${role}`) },
		patchSettings: () => order.push("write"),
	});
	const context = fakeCommandContext({ available: CATALOG });
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

	expect(order).toEqual(["write", "badge:strong", "reload"]);
	expect(phase.current()).toBe("strong");
});

// spec scenario "設定の書き込みが失敗する": the session keeps what pi accepted, and nothing is reloaded.
test("keeps the session lock when the settings write fails", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(pi, {
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
	registerManagedCommands(pi, {
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

// --------------------------------------------------------------- step restoration on reload

// spec "dual-model-routing / ステップの復元": a reload replaced the runtime, not the conversation.
test("a reload restores the step the session recorded", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(pi, { phase, patchSettings: () => {} });
	const branch: SessionEntry[] = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "strong" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } },
	];

	await run(pi, "", { branch, mode: "rpc" });
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, fakeCommandContext({ branch }).ctx);

	expect(phase.current()).toBe("strong");
	expect(phase.step()?.name).toBe("opsx-apply");
});

test("a start that is not a reload restores no step", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(pi, { phase, patchSettings: () => {} });
	const branch: SessionEntry[] = [{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } }];

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, fakeCommandContext({ branch }).ctx);

	// The lock comes back and the step does not: a resume is a different conversation.
	expect(phase.step()).toBeUndefined();
});
