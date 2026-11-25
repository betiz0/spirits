import type { PiModel } from "../src/types/host.ts";
import { asExtensionApi, fakeModel } from "./host/fake-pi.ts";
/**
 * The notice a setting change may need.
 *
 * Two things are worth saying at the moment of a change, and neither takes the change back: a strong
 * that nothing resolves to, and a session that is not on the routing model so nothing is in force yet.
 * The notices a request produces keep their own rules and are not touched here (spec
 * `managed-commands` / 設定時は振り分けの効きを伝える).
 */

import { expect, test } from "bun:test";

import { COMMAND_SPIRITS_ROLE } from "../src/constants.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { roleSettingWarning, strongSettingWarning } from "../src/commands/role.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { fakeCommandContext, FakePi } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { api: "openai" });
const FAKE_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { api: "openai" });
const AUTO: PiModel = fakeModel("spirits", "auto", { api: "pi-virtual" });

function wire(settings: Record<string, unknown>) {
	const pi = new FakePi();
	pi.settings = settings;
	const phase = createRoutingPhase();
	const written: Array<{ path: readonly string[]; value: unknown }> = [];
	// The lock writes a flat patch and every other change writes a path, so both writes are recorded: a
	// warning is added to a change that happened, and "it happened" is half of what these cases check.
	const patched: Record<string, unknown>[] = [];
	registerManagedCommands(asExtensionApi(pi), {
		phase,
		patchSettings: (patch) => {
			patched.push(patch);
		},
		patchSettingsPath: (path, value) => written.push({ path, value }),
	});
	// The fake host hands back the settings it was given and never sees the writes, which is the state a
	// real host is in until `ctx.reload()` — so a warning that judged from `pi.getSettings()` alone would
	// contradict the write it just made.
	return { pi, phase, written, patched };
}

async function run(pi: FakePi, args: string, options: Parameters<typeof fakeCommandContext>[0] = {}) {
	const context = fakeCommandContext({ available: [FAKE_MODEL, FAKE_STRONG], model: AUTO, authedProviders: ["compat-fake"], ...options });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler(args, context.ctx);
	return context;
}

// spec scenario "strong 未設定でロックする"
test("warns but keeps the lock", async () => {
	const { pi, phase, patched } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const { notices } = await run(pi, "strong");

	// The lock and the save both happened; the warning is added to them, not a replacement for either.
	expect(phase.current()).toBe("strong");
	expect(patched).toEqual([{ models: { role: "strong" } }]);
	expect(notices[0]).toContain("role locked to strong");
	expect(notices.at(-1)).toContain("strong has no usable model");
	// The line names what to do, so the user does not have to look the command up.
	expect(notices.at(-1)).toContain("/spirits-role strong model");
});

// spec scenario "strong の対象を設定した直後は strong 未設定と言わない": the write the command just made is
// not visible to `pi.getSettings()` until the reload, and the judgment may not pretend otherwise.
test("does not warn about strong right after setting the strong model", async () => {
	const { pi, written } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const { notices } = await run(pi, "strong model compat-fake/fake-strong");

	expect(written).toEqual([{ path: ["models", "strong"], value: "compat-fake/fake-strong" }]);
	expect(notices).toEqual(["set strong model compat-fake/fake-strong"]);
});

// spec scenario "物理モデル選択中に thinking を設定する" and the `unset` case: every change, not only the
// ones that name strong.
test("says routing is off on any setting change while a physical model is selected", async () => {
	for (const args of ["strong", "normal thinking high", "opsx-propose role strong", "opsx-propose thinking unset"]) {
		const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

		const { notices } = await run(pi, args, { model: FAKE_MODEL });

		// The first notice is the change itself, so a warning that came with it is a warning on a change
		// that really went through, not one that replaced it.
		expect(notices.length).toBeGreaterThan(1);
		expect(notices.at(-1)).toContain("routing is off");
	}
});

// spec scenario "対象が設定済みなら警告しない"
test("stays quiet when strong is usable", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } });

	const { notices } = await run(pi, "strong");

	expect(notices).toEqual(["role locked to strong"]);
});

// spec scenario "物理モデル選択中に設定する": a step set to strong is the case worth commenting on, and
// the setting still lands.
test("says routing is off while a physical model is selected", async () => {
	const { pi, written } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } });

	const { notices } = await run(pi, "opsx-propose role strong", { model: FAKE_MODEL });

	expect(written).toEqual([{ path: ["models", "steps", "opsx-propose", "role"], value: "strong" }]);
	expect(notices.at(-1)).toContain("routing is off");
	expect(notices.at(-1)).toContain("spirits/auto");
});

test("an unselected model saves a setting without the routing-off warning", async () => {
	const { pi, written } = wire({});

	const context = await run(pi, "normal thinking high", { model: undefined });

	expect(written).toEqual([{ path: ["models", "thinking", "normal"], value: "high" }]);
	expect(context.notices).toEqual(["set normal thinking high"]);
	expect(context.notifications[0]?.type).toBe("info");
	expect(context.reloads()).toBe(1);
});

// A target that exists in the settings but not in the catalog is unusable in the same way, and the user
// has to hear it before the run, not as a routing notice in the middle of one.
test("warns when strong names a model the catalog does not have", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "nowhere/nothing" } });

	const { notices } = await run(pi, "strong");

	expect(notices.at(-1)).toContain("strong has no usable model");
});

// A step set to normal, with routing in force, is a plain setting change and gets no commentary.
test("stays quiet on a change that asks for nothing", async () => {
	const { pi, written } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const { notices } = await run(pi, "opsx-verify thinking low");

	expect(written.length).toBe(1);
	expect(notices).toEqual(["set opsx-verify thinking low"]);
});

// spec scenario "物理モデル選択中の save はこの警告ではない": the setting-change warning explains that a change
// went through while nothing was routing. A `save` under the same selection explains something else — that
// nothing was written at all — so it earns its own sentence and the warning's two halves stay out of it.
test("a declined save is not the setting-change warning", async () => {
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const { notices, notifications } = await run(pi, "save", { model: FAKE_MODEL });

	expect(notices).toHaveLength(1);
	expect(notices[0]).toContain("save declined");
	// Not the setting change's phrasing, which would report a change this command did not make.
	expect(notices[0]).not.toContain("routing is off while a physical model is selected");
	expect(notifications[0]?.type).toBe("warning");
});

// The wording function is pure, which is what lets both halves be said at once without either one
// swallowing the other.
test("says both halves when both are true", () => {
	const warning = roleSettingWarning({
		setStrong: true,
		strongUnresolved: true,
		physicalModelSelected: true,
		scoped: false,
		interactive: true,
		routingModelAvailable: true,
	});
	expect(warning).toBeDefined();
	expect(warning).toContain("strong has no usable model");
	expect(warning).toContain("routing is off");
});

// spec "managed-commands / 振り分けを有効にする手順は対話端末で実行できるものを名指す": the procedure has
// to be one the session can actually carry out, which is a question about its model scope, and a session
// nobody is watching has no operation to be handed — not a keystroke, not a slash command, and not an edit of
// a settings file either. Four states, because both halves vary.
test("names a procedure the session can run", () => {
	const base = { setStrong: false, strongUnresolved: false, physicalModelSelected: true, routingModelAvailable: true };

	const terminal = roleSettingWarning({ ...base, scoped: false, interactive: true })!;
	expect(terminal).toContain("select spirits/auto with /model");

	const scopedTerminal = roleSettingWarning({ ...base, scoped: true, interactive: true })!;
	// The fact first, then both ways out, since either one reaches the model from a scope that excludes it. The
	// scope switch is the operation, not the key that happens to be bound to it today.
	expect(scopedTerminal).toContain("spirits/auto is not in this session's model scope");
	expect(scopedTerminal).toContain("switch /model's scope to all models");
	expect(scopedTerminal).toContain("/scoped-models");

	// Off a terminal there is nobody to tell, so the two remaining states state the fact and stop there: what
	// the session would have to do is a fact about the routing model's selection, not an instruction.
	const headless = roleSettingWarning({ ...base, scoped: false, interactive: false })!;
	expect(headless).toContain("spirits/auto is not the model this session selected");

	const scopedHeadless = roleSettingWarning({ ...base, scoped: true, interactive: false })!;
	expect(scopedHeadless).toContain("spirits/auto is not in this session's model scope");

	// No session that is not being watched is told to press something, to run a command of the terminal's, or
	// to edit the settings file that holds the scope.
	for (const warning of [headless, scopedHeadless]) {
		expect(warning).not.toContain("Tab");
		expect(warning).not.toContain("press");
		expect(warning).not.toContain("/model");
		expect(warning).not.toContain("/scoped-models");
		expect(warning).not.toContain("enabledModels");
		expect(warning).not.toContain("settings file");
	}
});

// The routing-off sentence is one statement about the session, and the list already puts it in front of
// every row, so the warning the rows carry holds only the strong half (spec `managed-commands` /
// 設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える).
test("says the strong half on its own for a row that leads with the routing being off", () => {
	expect(strongSettingWarning(true, true)).toContain("strong has no usable model");
	expect(strongSettingWarning(true, false)).toBeUndefined();
	expect(strongSettingWarning(false, true)).toBeUndefined();
});
