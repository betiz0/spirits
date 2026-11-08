/**
 * The managed command surface: argument grammar, persistence, the role badge, and the conversation
 * boundary.
 *
 * The route branch itself (`registerModelRoles` present or absent) is covered here by asserting the
 * commands exist only when the host has no role API; the routing side of that decision is in
 * `routing-register.test.ts`. Both run against the test doubles, so no pi process is involved.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CLEAR_ENTRY_TYPE,
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_MODEL,
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
import { modelCommandSettings, parseModelCommandArgs, resolveModelTarget } from "../src/commands/model.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { inheritedRole, roleBadgeText } from "../src/commands/role.ts";
import { patchSettingsFile } from "../src/commands/settings-store.ts";
import type { SettingsPatch } from "../src/commands/settings-store.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { FakePi, fakeCatalog, fakeCommandContext } from "./routing/fake-pi.ts";

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

// --------------------------------------------------------------- argument grammar

test("/spirits-model takes the role off the right end, then the thinking level", () => {
	expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 high strong")).toEqual({
		ref: "anthropic/claude-sonnet-4-5",
		level: "high",
		role: "strong",
	});
	expect(parseModelCommandArgs("sonnet strong")).toEqual({ ref: "sonnet", level: undefined, role: "strong" });
	expect(parseModelCommandArgs("sonnet high")).toEqual({ ref: "sonnet", level: "high", role: undefined });
	expect(parseModelCommandArgs("strong")).toEqual({ ref: undefined, level: undefined, role: "strong" });
	expect(parseModelCommandArgs("")).toEqual({ ref: undefined, level: undefined, role: undefined });
});

test("a reference keeps its spaces once the trailing role and level are taken", () => {
	expect(parseModelCommandArgs("my company gpt high strong")).toEqual({
		ref: "my company gpt",
		level: "high",
		role: "strong",
	});
});

// --------------------------------------------------------------- model resolution

test("a reference resolves by exact provider/id, then by a unique substring", () => {
	const models = [MODEL_A, MODEL_B];
	expect(resolveModelTarget(models, "anthropic/claude-sonnet-4-5")).toEqual({ model: MODEL_A });
	expect(resolveModelTarget(models, "sonnet")).toEqual({ model: MODEL_A });
	expect(resolveModelTarget(models, "gpt-5")).toEqual({ model: MODEL_B });
});

test("an unmatched or ambiguous reference resolves to nothing, with a message naming what was found", () => {
	const models = [MODEL_A, MODEL_B];
	const missing = resolveModelTarget(models, "mistral");
	expect("model" in missing).toBe(false);
	expect(missing).toHaveProperty("error", 'no model matches "mistral"');

	const ambiguous = resolveModelTarget([MODEL_A, { ...MODEL_A, id: "claude-sonnet-4-6" }], "claude-sonnet");
	expect("model" in ambiguous).toBe(false);
	expect((ambiguous as { error: string }).error).toContain("matches 2 models");
});

test("the routing pseudo-model is never a target of /spirits-model", () => {
	const virtual: PiModel = { provider: "spirits", id: "auto", name: "Auto", api: "pi-virtual" };
	expect(resolveModelTarget([virtual, MODEL_A], "spirits/auto")).toHaveProperty("error", 'no model matches "spirits/auto"');
	// The bare word still reaches a physical model that happens to be called `auto`.
	expect(resolveModelTarget([virtual, { ...MODEL_A, id: "auto" }], "auto")).toEqual({
		model: { ...MODEL_A, id: "auto" },
	});
});

// --------------------------------------------------------------- persistence

test("a model line persists only what the user named", () => {
	expect(modelCommandSettings({ ref: "sonnet" }, MODEL_A)).toEqual({
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
	});
	expect(modelCommandSettings({ ref: "sonnet", level: "high", role: "strong" }, MODEL_A)).toEqual({
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		defaultThinkingLevel: "high",
		models: { role: "strong" },
	});
});

test("/spirits-model writes the model, level, role, and settings, then reloads last", async () => {
	const { pi, phase, patches } = wire();
	const { ctx, notices, reloads } = fakeCommandContext({ available: [MODEL_A] });
	phase.setRole("normal");

	await pi.commands.get(COMMAND_SPIRITS_MODEL)!.handler("anthropic/claude-sonnet-4-5 high strong", ctx);

	expect(pi.modelChanges).toEqual([MODEL_A]);
	expect(pi.thinkingChanges).toEqual(["high"]);
	expect(phase.current()).toBe("strong");
	expect(pi.entries).toEqual([{ customType: ROLE_ENTRY_TYPE, data: { role: "strong" } }]);
	expect(patches).toEqual([
		{
			defaultProvider: "anthropic",
			defaultModel: "claude-sonnet-4-5",
			defaultThinkingLevel: "high",
			models: { role: "strong" },
		},
	]);
	expect(notices.at(-1)).toBe("using anthropic/claude-sonnet-4-5 high strong");
	expect(reloads()).toBe(1);
});

test("a line with no model reference names what it needs instead of changing anything", async () => {
	const { pi, phase, patches } = wire();
	const { ctx, notices } = fakeCommandContext({ available: [MODEL_A] });
	phase.setRole("normal");

	await pi.commands.get(COMMAND_SPIRITS_MODEL)!.handler("strong", ctx);

	expect(pi.modelChanges).toEqual([]);
	expect(phase.current()).toBe("normal");
	expect(patches).toEqual([]);
	expect(notices.at(-1)).toContain("use /spirits-model <model> [level] [role]");
});

test("/spirits-role locks the role, records it on the branch, and persists the default", async () => {
	const { pi, phase, patches } = wire();
	const { ctx, reloads } = fakeCommandContext();

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("strong", ctx);

	expect(phase.current()).toBe("strong");
	expect(pi.entries).toEqual([{ customType: ROLE_ENTRY_TYPE, data: { role: "strong" } }]);
	expect(patches).toEqual([{ models: { role: "strong" } }]);
	expect(reloads()).toBe(1);
});

test("an unknown role leaves the lock, the entries, and the settings alone", async () => {
	const { pi, phase, patches } = wire();
	const { ctx, notices, reloads } = fakeCommandContext();
	phase.setRole("normal");

	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("gpt-5", ctx);

	expect(phase.current()).toBe("normal");
	expect(pi.entries).toEqual([]);
	expect(patches).toEqual([]);
	expect(reloads()).toBe(0);
	expect(notices.at(-1)).toContain("use /spirits-role normal or strong");
});

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

test("a settings write creates the file when the agent dir has none", () => {
	const path = join(tempDir("settings-create"), "settings.json");
	patchSettingsFile({ settingsPath: path, fields: { defaultModel: "model-a" } });
	expect(readFileSync(path, "utf8")).toContain('"defaultModel": "model-a"');
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

test("a compaction that would summarize cleared conversation is taken over without its content", () => {
	const branch = [userEntry("1", "first"), entry("2", CLEAR_ENTRY_TYPE), userEntry("3", "after")];
	const result = boundaryCompactionResult({
		type: "session_before_compact",
		preparation: { firstKeptEntryId: "1", tokensBefore: 4000 },
		branchEntries: branch,
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	});
	expect(result?.compaction).toEqual({
		summary: expect.stringContaining("/spirits-clear"),
		firstKeptEntryId: "2",
		tokensBefore: 4000,
	});
	expect(result?.compaction?.summary).not.toContain("first");
});

test("a compaction whose span holds nothing before the boundary is left to pi", () => {
	const branch = [
		userEntry("1", "first"),
		entry("2", CLEAR_ENTRY_TYPE),
		{ type: "compaction", id: "c", summary: "earlier", firstKeptEntryId: "2", tokensBefore: 10 } as SessionEntry,
		userEntry("3", "after"),
	];
	expect(
		boundaryCompactionResult({
			type: "session_before_compact",
			preparation: { firstKeptEntryId: "2", tokensBefore: 4000 },
			branchEntries: branch,
			reason: "threshold",
			willRetry: false,
			signal: new AbortController().signal,
		}),
	).toBeUndefined();
});
