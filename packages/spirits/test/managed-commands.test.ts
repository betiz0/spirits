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
import { asExtensionApi, customEntry, entryWithoutId, fakeModel, messageEntry, systemMessage, userMessage } from "./host/fake-pi.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { lockSync } from "proper-lockfile";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, PiModel } from "../src/types/host.ts";
import { CLEAR_ENTRY_TYPE, COMMAND_SPIRITS_CLEAR, COMMAND_SPIRITS_ROLE, PI_VIRTUAL_MODEL_API, ROLE_ENTRY_TYPE, ROLE_MODEL_STATUS_KEY, ROLE_STATUS_KEY, ROUTING_STATE_ENTRY_TYPE } from "../src/constants.ts";
import { alreadyCleared, boundaryCompactionResult, clearBoundaryIndex, clearedMessageCount } from "../src/commands/clear.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { inheritedRole, roleBadgeLines, roleModelDisplay } from "../src/commands/role.ts";
import { patchSettingsFile, patchSettingsFileIfChanged, patchSettingsPath } from "../src/commands/settings-store.ts";
import type { SettingsPatch } from "../src/commands/settings-store.ts";
import { decideSave } from "../src/commands/role-write.ts";
import { readRoutingSettings } from "../src/config.ts";
import spiritsExtension from "../src/index.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { fakeCatalog, fakeCommandContext, FakePi, makeModelSelectEvent, makeThinkingLevelSelectEvent } from "./routing/fake-pi.ts";

const MODEL_A: PiModel = fakeModel("anthropic", "claude-sonnet-4-5", { name: "Sonnet", api: "anthropic" });
const MODEL_B: PiModel = fakeModel("openai", "gpt-5-mini", { name: "GPT-5 Mini", api: "openai" });
/** The catalog the badge cases resolve against, and the selection that puts the routing in force. */
const COMPAT_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { api: "openai" });
const COMPAT_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { api: "openai" });
const AUTO: PiModel = fakeModel("spirits", "auto", { api: "pi-virtual" });
const CATALOG = [COMPAT_MODEL, COMPAT_STRONG];

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
	return customEntry(customType, data, id);
}

function userEntry(id: string, text: string): SessionEntry {
	return messageEntry(userMessage(text), id);
}

function systemEntry(id: string): SessionEntry {
	return messageEntry(systemMessage("prompt"), id);
}

/** Commands and patches a wiring produced, with the settings writer replaced by a recorder. */
function wire(branch: readonly SessionEntry[] = [], settings: Record<string, unknown> = {}) {
	const pi = new FakePi();
	pi.settings = settings;
	const phase = createRoutingPhase();
	const patches: SettingsPatch[] = [];
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: (patch) => patches.push(patch) });
	return { pi, phase, patches };
}

/** A context on the routing model, with the catalog that resolves both roles. */
function routed(options: Parameters<typeof fakeCommandContext>[0] = {}) {
	return fakeCommandContext({ available: CATALOG, authedProviders: ["compat-fake"], model: AUTO, ...options });
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

// spec "managed-commands / role badge は拡張の status 行に出す": the badge is a projection with four states
// — a role with the level it asks for, a role with no level to ask for, the routing being off, and
// nothing answering at all — and each state is the word the spec spells.
test("the badge shows the role and level, or the word for the state that has neither", () => {
	expect(roleBadgeLines({ kind: "role", role: "strong", model: MODEL_A, thinkingLevel: "high" })).toEqual({
		role: "[strong high]",
		model: "claude-sonnet-4-5",
	});
	// A level nothing resolves is not a level to draw, and inventing one would name a request nobody sends.
	expect(roleBadgeLines({ kind: "role", role: "normal", model: MODEL_A }).role).toBe("[normal]");
	// The two states with no answering model draw one word and no model: the host's own stats row already
	// names the model the session sits on, and there is nothing to add to `[!]`.
	expect(roleBadgeLines({ kind: "off" })).toEqual({ role: "[off]", model: undefined });
	expect(roleBadgeLines({ kind: "none" })).toEqual({ role: "[!]", model: undefined });

	// spec scenario "制御文字を含む role は描画しない": without the escape byte the sequence is inert, so the
	// printable remainder shows as text, and a value that is nothing but control characters draws nothing.
	expect(roleBadgeLines({ kind: "role", role: "\u001b[31mred\u001b[0m", model: MODEL_A }).role).toBe("[[31mred[0m]");
	expect(roleBadgeLines({ kind: "role", role: "\u0001\u0007", model: MODEL_A }).role).toBeUndefined();
});

// spec scenario "id が境界の長さの応答モデル": the limit is a length, so the test names both sides of it —
// the id that still fits whole and the one that gives up its tail to the ellipsis.
test("an answering model id keeps its whole self up to the limit and its head past it", () => {
	expect(roleModelDisplay({ id: "x".repeat(23) })).toBe("x".repeat(23));
	expect(roleModelDisplay({ id: "x".repeat(24) })).toBe("x".repeat(24));
	expect(roleModelDisplay({ id: "x".repeat(25) })).toBe(`${"x".repeat(23)}\u2026`);
	expect(roleModelDisplay({ id: "x".repeat(26) })).toBe(`${"x".repeat(23)}\u2026`);
});

// spec scenarios "provider を含む長い id" and "id に空白が含まれる": a setting names a model as
// `provider/id`, and the footer has no room to repeat the provider the host already knows. A space inside
// an id is one of the characters counted, not a place to break — the line has a width, not a word list.
test("a long target shows the head of its id with no provider in front", async () => {
	const spaced = "reasoning model 2025 preview";
	const long: PiModel = fakeModel("deep-think", spaced);
	const { pi } = wire([], { defaultProvider: "deep-think", defaultModel: spaced });

	const started = routed({ available: [long, AUTO], authedProviders: ["deep-think"] });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);

	expect(started.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe(`${spaced.slice(0, 23)}\u2026`);
	expect(started.statuses.get(ROLE_MODEL_STATUS_KEY)).not.toContain("deep-think");
});

// spec scenario "モデル切り替えで badge が従う": `/model` is the host's command and spirits writes nothing to
// it, so the event is the only notice this surface gets, and the line cannot wait for a request to notice.
// The host rebuilds the context it emits with, so the selection the event carries is the selection the
// context carries too, and that is what the draw reads.
test("a model change redraws the badge without waiting for a request", async () => {
	const { pi } = wire([], { defaultProvider: "compat-fake", defaultModel: "fake-model" });
	const started = routed();
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");

	const physical = routed({ model: COMPAT_MODEL });
	await pi.fire("model_select", makeModelSelectEvent(COMPAT_MODEL, AUTO), physical.ctx);

	expect(physical.statuses.get(ROLE_STATUS_KEY)).toBe("[off]");
	expect(physical.statuses.get(ROLE_MODEL_STATUS_KEY)).toBeUndefined();
});

// A session limited by `enabledModels` to physical models still routes — the selector's list is the host's
// business, and the model answering stays spirits' — and the line reports the selection it holds.
test("a session scoped to physical models still routes and shows the selection it holds", async () => {
	const { pi } = wire([], { defaultProvider: "compat-fake", defaultModel: "fake-model" });
	const scoped = routed({ scopedModels: [{ model: COMPAT_MODEL }] });

	await pi.fire("session_start", { type: "session_start", reason: "startup" }, scoped.ctx);

	// The selector holds a list of its own, but the model answering is still the routing's to choose.
	expect(scoped.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(scoped.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-model");
});

// spec scenario "thinking レベルの切り替えで badge が従う": no role level is set, so the level the session
// selected is the level a request carries, and that is the level the line has to show.
test("a thinking level change redraws the level the request asks for", async () => {
	const { pi } = wire([], { defaultProvider: "compat-fake", defaultModel: "fake-model" });
	const started = routed({ thinkingLevel: "medium" });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[normal medium]");

	// The session's selection is what the host reports on the context of the event it fires.
	const raised = routed({ thinkingLevel: "high" });
	await pi.fire("thinking_level_select", makeThinkingLevelSelectEvent("high", "medium"), raised.ctx);

	expect(raised.statuses.get(ROLE_STATUS_KEY)).toBe("[normal high]");
});

// pi fires `thinking_level_select` only when the level really moves, so an operation that ends with the level
// where it started gives the line no event to react to. The redraw builds the value from the state rather than
// from the event, so a level that never changed still reads right — the line is not a log of notifications.
test("an operation that leaves the level alone still reads right on the line", async () => {
	const { pi } = wire([], {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "compat-fake/fake-strong", thinking: { strong: "high" } },
	});
	// The session already selected the level locking strong is about to ask for.
	const started = routed({ thinkingLevel: "high" });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, started.ctx);
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[normal high]");

	const locked = routed({ thinkingLevel: "high" });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("strong", locked.ctx);

	// No `thinking_level_select` was fired between the two lines, and the line moved anyway.
	expect(locked.statuses.get(ROLE_STATUS_KEY)).toBe("[strong high]");
	expect(locked.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-strong");
});

// spec "managed-commands / 物理モデル選択中はロールを出さない" and the routed half of the same requirement:
// the session's model decides whether there is a role to show at all.
test("the session start draws the badge for the model the session runs on", async () => {
	const { pi } = wire([], { defaultProvider: "compat-fake", defaultModel: "fake-model" });

	const physical = fakeCommandContext({ available: CATALOG, authedProviders: ["compat-fake"], model: COMPAT_MODEL });
	await pi.fire("session_start", { type: "session_start", reason: "start" }, physical.ctx);
	expect(physical.statuses.get(ROLE_STATUS_KEY)).toBe("[off]");
	// No answering model: the host's footer already names the physical model, twice would be one too often.
	expect(physical.statuses.get(ROLE_MODEL_STATUS_KEY)).toBeUndefined();

	const started = routed();
	await pi.fire("session_start", { type: "session_start", reason: "start" }, started.ctx);
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(started.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-model");
});

// Reloading extensions replaces the runtime that drew the badge, so the redraw is what keeps the role
// visible after a `/spirits-role` setting line reloaded the extension.
test("a reload draws the badge again", async () => {
	const { pi, phase } = wire([], { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } });
	phase.setRole("strong");
	const reloaded = routed();

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, reloaded.ctx);

	expect(reloaded.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
	expect(reloaded.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-strong");
});

test("a resumed session takes the lock back from its entries before showing the badge", async () => {
	const pi = new FakePi();
	// pi's settings are what a badge is projected from, and this session has a strong target of its own.
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "compat-fake/fake-strong" } };
	const phase = createRoutingPhase();
	registerManagedCommands(asExtensionApi(pi), { phase, patchSettings: () => {} });
	const started = routed({ branch: [entry("1", ROLE_ENTRY_TYPE, { role: "strong" })] });

	await pi.fire("session_start", { type: "session_start", reason: "resume" }, started.ctx);

	expect(phase.current()).toBe("strong");
	expect(started.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
	expect(started.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("fake-strong");
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

/**
 * The conditional write `save` goes through, against a real file.
 *
 * The row and the command decide together (`decideSave`), and what this file owns is the other half: that
 * the decision is taken on the bytes under the lock, that a decision of "nothing to write" is free, and
 * that a patch merges instead of replacing. The row's own cases are in `managed-role-panel.test.ts`.
 */

// spec "managed-commands / `save` は振り分け用のモデルを選択しているセッションの選択状況を global 既定に保存する": scenario "保存する乖離が無い".
// "Nothing changed" has to be observable as a file nobody touched, not as a file rewritten to its own
// content — a reader that watches the modification time should not see a save that wrote nothing.
test("a conditional save leaves an unchanged file untouched", () => {
	const path = join(tempDir("save-unchanged"), "settings.json");
	const before = JSON.stringify({ models: { role: "normal" }, defaultProvider: "compat-fake", defaultModel: "fake-model" }, null, 2);
	writeFileSync(path, before, "utf-8");
	const stat = statSync(path);

	const written = patchSettingsFileIfChanged({
		settingsPath: path,
		decide: (current) => (current.models as Record<string, unknown>).role === "normal" ? undefined : { models: { role: "normal" } },
	});

	// The decider declined, so there is no resulting settings object to report.
	expect(written).toBeUndefined();
	expect(readFileSync(path, "utf-8")).toBe(before);
	// Same bytes, same modification time: the file was opened for reading and nothing else.
	expect(statSync(path).mtimeMs).toBe(stat.mtimeMs);
});

// spec scenario "一覧を開いた後に global が変わる": the preview a user read is advisory. What the write
// compares against is the content the lock let it open with, which is the other process's version here.
test("a conditional save uses the latest global settings", () => {
	const path = join(tempDir("save-latest"), "settings.json");
	const previewed = { theme: "dark", models: { role: "normal" } };
	writeFileSync(path, JSON.stringify(previewed, null, 2), "utf-8");

	// What the preview answered from that content: the file says `normal`, the session locked `strong`.
	const promise = patchSettingsFileIfChanged({ settingsPath: path, decide: () => ({ models: { role: "strong" } }) });
	expect(promise).toBeDefined();

	// Between that preview and the write that follows it, another writer moved an unrelated key and landed
	// the same role. The save's decider now reads a file with nothing left to write.
	writeFileSync(path, JSON.stringify({ theme: "light", models: { role: "strong" } }, null, 2), "utf-8");
	const stat = statSync(path);
	const seen: Record<string, unknown>[] = [];
	const written = patchSettingsFileIfChanged({
		settingsPath: path,
		decide: (current) => {
			seen.push(current);
			return current.models && (current.models as Record<string, unknown>).role === "strong" ? undefined : { models: { role: "strong" } };
		},
	});

	// The decision saw the file as the other writer left it, not the content the preview read.
	expect(seen).toHaveLength(1);
	expect(seen[0]).toEqual({ theme: "light", models: { role: "strong" } });
	expect(written).toBeUndefined();
	// The other writer's key stands untouched, and the file was not rewritten to agree with itself.
	expect(readFileSync(path, "utf-8")).toBe(JSON.stringify({ theme: "light", models: { role: "strong" } }, null, 2));
	expect(statSync(path).mtimeMs).toBe(stat.mtimeMs);
});

// spec scenario "振り分け用モデルへ替えた後に保存する" and the declination the same requirement lets stand:
// the pair is one write, and a patch that names two of the three `models` keys replaces none of the others.
test("a save patch lands the role and model pair together", () => {
	const path = join(tempDir("save-pair"), "settings.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				lastChangelogVersion: "1.4.0",
				enabledModels: ["compat-fake/fake-model", "spirits/auto"],
				defaultProvider: "compat-fake",
				defaultModel: "fake-model",
				models: { role: "strong", normal: "compat-fake/fake-model", strong: "compat-fake/fake-strong", steps: { "opsx-apply": { role: "strong" } } },
			},
			null,
			2,
		),
	);

	patchSettingsFileIfChanged({
		settingsPath: path,
		decide: () => ({ defaultProvider: "spirits", defaultModel: "auto", models: { role: "normal" } }),
	});

	// One file, one rewrite: pi's own version key, the scope, and every `models` sibling the patch did not
	// name are still there, and the role and model pair landed together.
	expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
		lastChangelogVersion: "1.4.0",
		enabledModels: ["compat-fake/fake-model", "spirits/auto"],
		defaultProvider: "spirits",
		defaultModel: "auto",
		models: { role: "normal", normal: "compat-fake/fake-model", strong: "compat-fake/fake-strong", steps: { "opsx-apply": { role: "strong" } } },
	});

	// The skipped-model case: the role key goes in and the two default keys are left exactly as they were,
	// because a patch that does not name them cannot change them.
	writeFileSync(path, JSON.stringify({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "strong" } }, null, 2), "utf-8");
	patchSettingsFileIfChanged({ settingsPath: path, decide: () => ({ models: { role: "normal" } }) });
	expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { role: "normal" },
	});
});

// spec scenario "ディスクの既定値に前後の空白がある": the file's padded `defaultProvider` is not the
// value the session selected, so the conditional write rewrites it — against a real file, where the
// comparison is the one the row's preview and the command share.
test("a padded default provider is rewritten to the selected value", () => {
	const path = join(tempDir("save-padded"), "settings.json");
	// The routing model is selected, because a physical one declines before the comparison is reached (spec
	// `managed-commands` / 物理モデルを選択中は `save` が global 設定を見送る).
	// The file carries a `models.normal` a new session can resolve on its own, which is what lets a routing
	// default be written at all; the padding is the difference under test.
	writeFileSync(
		path,
		JSON.stringify({ defaultProvider: " spirits ", defaultModel: "auto", models: { role: "normal", normal: "compat-fake/fake-strong" } }, null, 2),
		"utf-8",
	);
	// A provider the host does not list as extension-registered is one the global file can vouch for, which is
	// what lets the routing default be rewritten at all.
	const lookup = {
		getAvailable: () => [COMPAT_STRONG],
		hasConfiguredAuth: () => true,
		getRegisteredProviderIds: () => [],
	};

	patchSettingsFileIfChanged({
		settingsPath: path,
		decide: (current) => decideSave({ role: "normal", model: { provider: "spirits", id: "auto", api: PI_VIRTUAL_MODEL_API } }, current, lookup).patch,
	});

	expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
		defaultProvider: "spirits",
		defaultModel: "auto",
		models: { role: "normal", normal: "compat-fake/fake-strong" },
	});
});

// spec "managed-commands / 設定ファイルの作成はロック下で行う": the lock is taken before the file is read,
// so a writer that cannot get it leaves no file behind — not even an empty one that a later first save
// could mistake for the settings.
test("a save with no settings file does not create one when the lock is held", () => {
	const path = join(tempDir("save-locked"), "settings.json");
	const release = lockSync(path, { realpath: false });
	try {
		expect(() => patchSettingsFileIfChanged({ settingsPath: path, decide: () => ({ models: { role: "strong" } }) })).toThrow();
		expect(existsSync(path)).toBe(false);
	} finally {
		release();
	}

	// The lock free, the same write creates the file and nothing else.
	patchSettingsFileIfChanged({ settingsPath: path, decide: () => ({ models: { role: "strong" } }) });
	expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ models: { role: "strong" } });
});

// spec scenario "同時の初回保存で両方のキーが残る": two processes saving into a missing file both land,
// because neither creates an empty file on its way to the lock.
test("two concurrent first saves keep both keys", async () => {
	const dir = tempDir("save-first-concurrent");
	const path = join(dir, "settings.json");
	const child = join(import.meta.dir, "fixtures", "settings-writer-child.ts");

	const writers = ["first", "second"].map((key) =>
		Bun.spawn([process.execPath, child, path, key, "1"], { stdout: "pipe", stderr: "pipe" }),
	);
	const results = await Promise.all(writers.map((writer) => writer.exited));
	expect(results).toEqual([0, 0]);

	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ first: "done", second: "done" });
	expect(existsSync(`${path}.lock`)).toBe(false);
}, 30_000);

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
	registerManagedCommands(asExtensionApi(pi), {
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

// spec requirement "managed コマンドの登録": 登録はロードごとに必ず行う。host 側の分岐は無くなったので、
// entry point を通して 2 コマンドだけを数える (それ以上でもそれ以下でもないことを見る)。
test("registers spirits-role and spirits-clear on every load", () => {
	const pi = new FakePi();
	spiritsExtension(asExtensionApi(pi));
	expect([...pi.commands.keys()].sort()).toEqual([COMMAND_SPIRITS_CLEAR, COMMAND_SPIRITS_ROLE].sort());
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
	const unlocatable: SessionEntry = entryWithoutId(CLEAR_ENTRY_TYPE);
	const { ctx } = fakeCatalog({ branch: [userEntry("1", "first"), unlocatable] });
	expect(clearedMessageCount(ctx.sessionManager)).toBe(0);
});

// Whether a summary would carry cleared conversation is a fact about pi's projection, and the fake
// projection here cannot show it: it projects only message entries. The compaction takeover is
// therefore tested against real pi sessions, in `managed-commands-clear.test.ts`.
