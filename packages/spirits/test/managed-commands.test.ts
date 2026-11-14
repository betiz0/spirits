/**
 * The managed command surface: argument grammar, persistence, the role badge, and the conversation
 * boundary.
 *
 * The route branch itself (`registerModelRoles` present or absent) is covered here by registering the
 * whole extension against both hosts. The routing side of that decision is in
 * `routing-register.test.ts`, and the boundary against real pi sessions is in
 * `managed-commands-clear.test.ts`. Both files here run against the test doubles, so no pi process is
 * involved.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CLEAR_ENTRY_TYPE,
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_ROLE,
	ROLE_ENTRY_TYPE,
	ROLE_STATUS_KEY,
	ROUTING_STATE_ENTRY_TYPE,
} from "../src/constants.ts";
import {
	alreadyCleared,
	boundaryCompactionResult,
	clearBoundaryIndex,
	clearedMessageCount,
} from "../src/commands/clear.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { inheritedRole, roleBadgeText } from "../src/commands/role.ts";
import { patchSettingsFile, patchSettingsPath } from "../src/commands/settings-store.ts";
import type { SettingsPatch } from "../src/commands/settings-store.ts";
import { readRoutingSettings } from "../src/config.ts";
import spiritsExtension from "../src/index.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { FakePi, fakeCatalog, fakeCommandContext, withoutRoleApi } from "./routing/fake-pi.ts";

const MODEL_A: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Sonnet", api: "anthropic" };
const MODEL_B: PiModel = { provider: "openai", id: "gpt-5-mini", name: "GPT-5 Mini", api: "openai" };

const tempDirs: string[] = [];
function tempDir(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `spirits-${name}-`));
	tempDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function entry(id: string, customType: string, data?: unknown): SessionEntry {
	return { type: "custom", id, customType, data };
}

function userEntry(id: string, text: string): SessionEntry {
	return { type: "message", id, message: { role: "user", content: text } as AgentMessage };
}

function systemEntry(id: string): SessionEntry {
	return { type: "message", id, message: { role: "system", content: "prompt" } as AgentMessage };
}

/** Commands and patches a wiring produced, with the settings writer replaced by a recorder. */
function wire(branch: readonly SessionEntry[] = []) {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	const patches: SettingsPatch[] = [];
	registerManagedCommands(pi, { phase, patchSettings: (patch) => patches.push(patch) });
	return { pi, phase, patches };
}

// --------------------------------------------------------------- role record and badge

test("a resumed session takes its role from the spirits record, then from a fork's record", () => {
	expect(inheritedRole([entry("1", ROLE_ENTRY_TYPE, { role: "strong" })])).toBe("strong");
	expect(inheritedRole([entry("1", ROUTING_STATE_ENTRY_TYPE, { provider: "spirits", modelId: "auto", role: "strong" })])).toBe(
		"strong",
	);
	expect(
		inheritedRole([
			entry("1", ROUTING_STATE_ENTRY_TYPE, { role: "strong" }),
			entry("2", ROLE_ENTRY_TYPE, { role: "normal" }),
		]),
	).toBe("normal");
	expect(inheritedRole([entry("1", ROLE_ENTRY_TYPE, { role: "gpt-5" })])).toBeUndefined();
	expect(inheritedRole([])).toBeUndefined();
});

test("a fork record without a role inherits nothing, so the configured default stands", () => {
	expect(inheritedRole([entry("1", ROUTING_STATE_ENTRY_TYPE, { provider: "spirits", modelId: "auto" })])).toBeUndefined();
});

// spec scenario "分岐ごとにロールを持つ": the role is read off the branch that was loaded, not off a
// session-wide value. Two branches with different records decide differently, and the same branch read
// again decides the same way — which is what a move between them shows.
test("each branch answers with the role it recorded", () => {
	const strongBranch = [entry("1", ROLE_ENTRY_TYPE, { role: "strong" })];
	const normalBranch = [entry("1", ROLE_ENTRY_TYPE, { role: "normal" })];

	expect(inheritedRole(strongBranch)).toBe("strong");
	expect(inheritedRole(normalBranch)).toBe("normal");
	expect(inheritedRole(strongBranch)).toBe("strong");
});

// spec scenario "読み取れない記録はロール未決定": a record whose role is not a word the vocabulary carries —
// a number, say — decides nothing, and reading the branch that holds one still finishes.
test("a record with a role that is not a word decides nothing", async () => {
	const unreadable = [entry("1", ROLE_ENTRY_TYPE, { role: 5 })];
	const { pi, phase } = wire(unreadable);
	const started = fakeCommandContext({ branch: unreadable });

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, started.ctx);

	expect(inheritedRole(unreadable)).toBeUndefined();
	// Nothing was inherited, so the start settles on the unset default and the draw completes: pi would
	// show no badge here because no role was ever decided.
	expect(phase.lock()).toBe("normal");
	expect(pi.errors).toEqual([]);
});

test("the badge prints the role on one line, and a role that leaves nothing prints nothing", () => {
	expect(roleBadgeText("strong")).toBe("[strong]");
	// Without the escape byte the sequence is inert, so the printable remainder shows as text.
	expect(roleBadgeText("\u001b[31mred\u001b[0m")).toBe("[[31mred[0m]");
	// A role that is nothing but control characters prints no badge at all.
	expect(roleBadgeText("\u0001\u0007")).toBeUndefined();
	expect(roleBadgeText("")).toBeUndefined();
	expect(roleBadgeText("  ")).toBeUndefined();
	expect(roleBadgeText(undefined)).toBeUndefined();
});

test("the session start shows the lock the phase carries", async () => {
	const { pi, phase } = wire();
	const { statuses } = fakeCommandContext();
	phase.setRole("strong");

	await pi.fire("session_start", { type: "session_start", reason: "start" }, fakeCommandContext().ctx);
	expect(statuses.size).toBe(0);

	const started = fakeCommandContext();
	await pi.fire("session_start", { type: "session_start", reason: "start" }, started.ctx);
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
});

// Reloading extensions replaces the runtime that drew the badge, so the redraw is what keeps the role
// visible after a `/spirits-role` setting line reloaded the extension.
test("a reload draws the badge again", async () => {
	const { pi, phase } = wire();
	phase.setRole("strong");
	const reloaded = fakeCommandContext();

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, reloaded.ctx);

	expect(reloaded.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
});

test("a resumed session takes the lock back from its entries before showing the badge", async () => {
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(pi, { phase, patchSettings: () => {} });
	const started = fakeCommandContext({ branch: [entry("1", ROLE_ENTRY_TYPE, { role: "strong" })] });

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, started.ctx);

	expect(phase.current()).toBe("strong");
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
});

// --------------------------------------------------------------- settings file

test("a settings write keeps the keys it was not told about, including pi's own", () => {
	const path = join(tempDir("settings-merge"), "settings.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				enabledModels: ["fake/model-a", "spirits/auto"],
				transport: "sse",
				quietStartup: true,
				tools: { deny: ["write"] },
				models: { strong: "fake/model-b", role: "normal" },
				customKey: { keep: 1 },
			},
			null,
			2,
		),
	);

	patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a", models: { role: "strong" } } });

	const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	expect(written).toEqual({
		enabledModels: ["fake/model-a", "spirits/auto"],
		transport: "sse",
		quietStartup: true,
		tools: { deny: ["write"] },
		// Only `role` changed inside `models`; `strong` is another owner's key.
		models: { strong: "fake/model-b", role: "strong" },
		customKey: { keep: 1 },
		defaultModel: "model-a",
	});
});

// spec "managed-commands / 設定の書き込みは Pi と同じロック手順で行う": 「ステップ 1 件の変更でほかのステップが残る」
test("a step write keeps the sibling steps", () => {
	const path = join(tempDir("settings-step-path"), "settings.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				enabledModels: ["fake/model-a"],
				models: {
					role: "normal",
					strong: "fake/model-b",
					steps: { "opsx-propose": { role: "strong" }, "opsx-verify": { thinking: "low" } },
				},
			},
			null,
			2,
		),
	);

	patchSettingsPath({ settingsPath: path, path: ["models", "steps", "opsx-propose", "thinking"], value: "high" });

	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		enabledModels: ["fake/model-a"],
		models: {
			role: "normal",
			strong: "fake/model-b",
			steps: { "opsx-propose": { role: "strong", thinking: "high" }, "opsx-verify": { thinking: "low" } },
		},
	});
});

// spec scenario "保存されたロールの対象が次のセッションで効く": the command's write lands as one string
// under `models.normal`, and the settings read a reload performs returns that value.
test("a saved role target is one string a reloaded read returns", async () => {
	const path = join(tempDir("settings-normal-round-trip"), "settings.json");
	const pi = new FakePi();
	const phase = createRoutingPhase();
	registerManagedCommands(pi, {
		phase,
		patchSettingsPath: (settingsPath, value) => patchSettingsPath({ settingsPath: path, path: settingsPath, value }),
	});

	const context = fakeCommandContext({ available: [MODEL_A] });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("normal model anthropic/claude-sonnet-4-5", context.ctx);

	const saved = JSON.parse(readFileSync(path, "utf8"));
	expect(saved.models.normal).toBe("anthropic/claude-sonnet-4-5");
	// The fresh runtime's first read after the reload sees the value the command saved.
	expect(readRoutingSettings(saved).normal).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
});

// spec scenario "未設定へ戻すとキーが消える": the key is deleted, not written as `"unset"`.
test("unset deletes only the named key", () => {
	const path = join(tempDir("settings-unset"), "settings.json");
	writeFileSync(
		path,
		JSON.stringify({ models: { role: "normal", steps: { "opsx-propose": { role: "strong", thinking: "high" } } } }, null, 2),
	);

	patchSettingsPath({ settingsPath: path, path: ["models", "steps", "opsx-propose", "thinking"], value: undefined });

	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		models: { role: "normal", steps: { "opsx-propose": { role: "strong" } } },
	});

	// Deleting a key that was never there changes nothing but the file's own content, and an unset of a
	// whole branch leaves its parent object alone.
	patchSettingsPath({ settingsPath: path, path: ["models", "steps", "opsx-teleport", "role"], value: undefined });
	patchSettingsPath({ settingsPath: path, path: ["models", "thinking", "normal"], value: "max" });
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		models: { role: "normal", thinking: { normal: "max" }, steps: { "opsx-propose": { role: "strong" } } },
	});
});

test("a settings write creates the file when the agent dir has none", () => {
	const path = join(tempDir("settings-create"), "settings.json");
	patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a" } });
	expect(readFileSync(path, "utf8")).toContain('"defaultModel": "model-a"');
});

// spec scenario "a settings file that is empty": pi treats an empty settings file as no settings, so
// writing to one is not a corrupted-file case.
test("an empty settings file is written as a settings object", () => {
	const path = join(tempDir("settings-empty"), "settings.json");
	writeFileSync(path, "", "utf8");
	patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a" } });
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ defaultModel: "model-a" });
});

// A byte-order mark is what some editors leave behind. It is not part of the JSON text, so the file
// stays readable by pi afterwards.
test("a settings file with a byte-order mark is merged and written back without it", () => {
	const path = join(tempDir("settings-bom"), "settings.json");
	writeFileSync(path, "\uFEFF" + JSON.stringify({ base: true }), "utf8");
	patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a" } });

	const text = readFileSync(path, "utf8");
	expect(text.startsWith("\uFEFF")).toBe(false);
	expect(JSON.parse(text)).toEqual({ base: true, defaultModel: "model-a" });
});

// spec requirement "managed 限定のコマンド登録": `registerModelRoles` の有無だけで分岐し、fork 経路では
// 0 件、公式 Pi では 3 コマンド。entry point を通して確認するのは、分岐が登録の側にあるからである。
test("registers only spirits-role and spirits-clear on an official host", () => {
	const fork = new FakePi();
	spiritsExtension(fork);
	expect([...fork.commands.keys()]).toEqual([]);

	const official = withoutRoleApi(new FakePi());
	spiritsExtension(official);
	expect([...official.commands.keys()].sort()).toEqual([COMMAND_SPIRITS_CLEAR, COMMAND_SPIRITS_ROLE].sort());
});

test("a settings file that is not JSON is reported instead of overwritten", () => {
	const path = join(tempDir("settings-invalid"), "settings.json");
	writeFileSync(path, "{ not json");
	expect(() => patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a" } })).toThrow(/not valid JSON/);
	expect(readFileSync(path, "utf8")).toBe("{ not json");
});

test("two processes that write different fields both land, and the file stays readable", async () => {
	const dir = tempDir("settings-concurrent");
	const path = join(dir, "settings.json");
	writeFileSync(path, JSON.stringify({ base: true }), "utf8");
	const child = join(import.meta.dir, "fixtures", "settings-writer-child.ts");

	const writers = ["first", "second"].map((key) =>
		Bun.spawn([process.execPath, child, path, key, "25"], { stdout: "pipe", stderr: "pipe" }),
	);
	const results = await Promise.all(writers.map((child) => child.exited));
	expect(results).toEqual([0, 0]);

	const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	expect(written).toEqual({ base: true, first: "done", second: "done" });
}, 30_000);

// --------------------------------------------------------------- conversation boundary

test("the boundary index and the already-cleared check read the newest entry", () => {
	expect(clearBoundaryIndex([userEntry("1", "a")])).toBe(-1);
	expect(clearBoundaryIndex([userEntry("1", "a"), entry("2", CLEAR_ENTRY_TYPE, { at: 1 }), userEntry("3", "b")])).toBe(1);
	expect(alreadyCleared([userEntry("1", "a"), entry("2", CLEAR_ENTRY_TYPE, { at: 1 })])).toBe(true);
	expect(alreadyCleared([userEntry("1", "a"), entry("2", CLEAR_ENTRY_TYPE, { at: 1 }), userEntry("3", "b")])).toBe(false);
});

test("the cleared count covers the conversation before the boundary and nothing after it", () => {
	const branch = [systemEntry("s"), userEntry("1", "first"), userEntry("2", "second"), entry("3", CLEAR_ENTRY_TYPE), userEntry("4", "after")];
	const { ctx } = fakeCatalog({ branch });
	expect(clearedMessageCount(ctx.sessionManager)).toBe(2);
});

test("a boundary that is not on the branch, or one with no id, drops nothing", () => {
	const unlocatable: SessionEntry = { type: "custom", customType: CLEAR_ENTRY_TYPE };
	const { ctx } = fakeCatalog({ branch: [userEntry("1", "first"), unlocatable] });
	expect(clearedMessageCount(ctx.sessionManager)).toBe(0);
});

// Whether a summary would carry cleared conversation is a fact about pi's projection, and the fake
// projection here cannot show it: it projects only message entries. The compaction takeover is
// therefore tested against real pi sessions, in `managed-commands-clear.test.ts`.
