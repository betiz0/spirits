/**
 * What a session records about its step, and what comes back through a reload.
 *
 * A reload replaces the extension runtime and keeps the conversation, so the running step is the one
 * piece of phase state worth writing down. Every other start — new, startup, resume, fork — opens a
 * conversation that never had it (design Decision 12).
 *
 * Both layers are registered here because the record is written by the routing layer and read back by
 * the command surface: neither alone can show the round trip.
 */

import { expect, test } from "bun:test";
import type { PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, FakePi, fakeCommandContext, makeCustomEntry, withoutRoleApi } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = { provider: "compat-fake", id: "fake-model", api: "openai" };
const FAKE_STRONG: PiModel = { provider: "compat-fake", id: "fake-strong", api: "openai" };
const AVAILABLE = [FAKE_MODEL, FAKE_STRONG];

/** The routing layer and the command surface over one fake host, as `src/index.ts` wires them. */
function wire(options: { skills?: readonly string[]; settings?: Record<string, unknown> } = {}) {
	const pi = withoutRoleApi(new FakePi());
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model", ...(options.settings ?? {}) };
	pi.slashCommands = (options.skills ?? ["skill:openspec-apply-change", "skill:sprt-opsx-verify-deep"]).map((name) => ({
		name,
		source: "skill" as const,
	}));
	const routing = registerDualModelRouting(pi);
	registerManagedCommands(pi, { phase: routing.phase, patchSettings: () => {}, patchSettingsPath: () => {} });
	/** The full resolution of one request, which is what the route, the child, and the list share. */
	const route = () => {
		const { ctx } = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"] });
		return pi.route()({ model: AUTO_SELECTION, thinkingLevel: "medium", reason: "user" }, ctx) as {
			role?: string;
			model: PiModel;
			thinkingLevel?: string;
		};
	};
	/** `"<role>:<routed model id>"` for one request, the way the footer and the router see it. */
	const decision = () => {
		const routed = route();
		return `${routed.role}:${routed.model.id}`;
	};
	/** The `status` report the command would show. */
	const status = async () => {
		const context = fakeCommandContext({ available: AVAILABLE });
		await pi.commands.get("spirits-role")!.handler("status", context.ctx);
		return context.notices.at(-1) ?? "";
	};
	return { pi, phase: routing.phase, decision, route, status };
}

/** The step records of a branch, oldest first, as the session file holds them. */
function stepRecords(branch: readonly SessionEntry[]): unknown[] {
	return branch
		.filter((entry) => entry.type === "custom" && entry.customType === STEP_ENTRY_TYPE)
		.map((entry) => (entry as { data: unknown }).data);
}

async function start(pi: FakePi, reason: string, branch: readonly SessionEntry[] = []) {
	const context = fakeCommandContext({ available: AVAILABLE, branch });
	await pi.fire("session_start", { type: "session_start", reason }, context.ctx);
	return context;
}

async function input(pi: FakePi, text: string) {
	const context = fakeCommandContext({ available: AVAILABLE });
	await pi.fire("input", { type: "input", text, source: "interactive" }, context.ctx);
}

/** Move between branches the way `/tree` does: no session start, only the new branch behind the runtime. */
async function treeMove(pi: FakePi, branch: readonly SessionEntry[]) {
	const context = fakeCommandContext({ available: AVAILABLE, branch });
	await pi.fire(
		"session_tree",
		{ type: "session_tree", newLeafId: "new-leaf", oldLeafId: "old-leaf", fromExtension: false },
		context.ctx,
	);
	return context;
}

/** The branch a reload reads back: the lock the session held, then the step that was running. */
function restoredBranch(role: string, step: string | null): SessionEntry[] {
	return [makeCustomEntry(ROLE_ENTRY_TYPE, { role }), makeCustomEntry(STEP_ENTRY_TYPE, { step })];
}

test("records the step name and the end of a step", async () => {
	const { pi, phase } = wire();
	await start(pi, "startup");

	await input(pi, "/skill:openspec-apply-change add-dual-model-routing");

	// The record carries the step name and nothing else: the step list is what says whether it continues
	// and what role it runs on, and a record must not be able to disagree with the list.
	expect(pi.entries).toEqual([{ customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } }]);
	expect(phase.step()?.name).toBe("opsx-apply");

	// Ending writes the opposite record rather than rewriting the old one, so the session file stays an
	// append-only log of what was true when.
	phase.endStep();
	expect(pi.entries.at(-1)).toEqual({ customType: STEP_ENTRY_TYPE, data: { step: null } });
});

// spec "dual-model-routing / ステップの復元": a reload replaced the runtime, not the conversation.
// spec scenario "設定変更の再読み込みをまたぐ": the request after the reload still carries the step's
// role and level, not just the restored step name.
test("a reload keeps the continuing step", async () => {
	const settings = {
		models: {
			strong: "compat-fake/fake-strong",
			steps: { "opsx-apply": { role: "strong", thinking: "high" } },
		},
	};
	const { pi, phase, route } = wire({ settings });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-apply-change add-dual-model-routing");
	// The resolution before the reload is the one the next request has to reproduce.
	expect(route()).toMatchObject({ role: "strong", model: FAKE_STRONG, thinkingLevel: "high" });
	// The session file at that moment: the lock the user held, and the step that was running.
	const branch = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "normal" } },
		...pi.entries.map((entry) => ({ type: "custom", ...entry })),
	] as unknown as SessionEntry[];

	// A fresh runtime for the same session: the lock and the step both come back, and the next request
	// still resolves to the same role, model, and level.
	const fresh = wire({ settings });
	await start(fresh.pi, "reload", branch);

	expect(fresh.phase.step()?.name).toBe("opsx-apply");
	expect(fresh.phase.current()).toBe("normal");
	expect(fresh.route()).toMatchObject({ role: "strong", model: FAKE_STRONG, thinkingLevel: "high" });
});

// spec scenario "a resume drops the step": resuming is opening a different conversation.
test("a resume drops the step", async () => {
	const branch: SessionEntry[] = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "strong" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } },
	];
	const { pi, phase } = wire();

	await start(pi, "resume", branch);

	// The lock is the session's and comes back; the step belonged to the conversation that was running.
	expect(phase.current()).toBe("strong");
	expect(phase.step()).toBeUndefined();
});

// The record of a step that ended is a record too, and it is the reason nothing comes back.
test("a reload after the step ended restores nothing", async () => {
	const branch: SessionEntry[] = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "normal" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: null } },
	];
	const { pi, phase } = wire();

	await start(pi, "reload", branch);

	expect(phase.step()).toBeUndefined();
});

// The badge and the status line are drawn from the phase, so what a reload restores is what they show —
// the step's role rather than the lock the user set before the step opened.
test("the badge and status match the phase restored across a reload", async () => {
	const branch = restoredBranch("normal", "sprt-opsx-verify-deep");
	const { pi, phase } = wire();
	const started = fakeCommandContext({ available: [FAKE_MODEL], branch });

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	// The step's own default role is what the next request takes.
	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");
	expect(phase.step()?.defaultRole).toBe("strong");
	expect(phase.current()).toBe("strong");
	// The badge is redrawn on the new runtime, on the role the phase settled on for the step.
	expect([...started.statuses.values()].at(-1)).toBe("[strong]");

	// The status line reads the same restored phase: the lock the session holds stays the lock, and the
	// step that came back is named as the thing running.
	const command = pi.commands.get("spirits-role");
	if (!command) throw new Error("/spirits-role is not registered");
	await command.handler("status", started.ctx);
	const status = started.notices.at(-1) ?? "";
	expect(status).toContain("lock: normal");
	expect(status).toContain("step: sprt-opsx-verify-deep");
});

// spec scenario "ステップ設定のロールを badge に出す": the badge resolves the step the way the route does.
test("a reload draws the badge from the step setting", async () => {
	const { pi, phase } = wire({
		skills: ["skill:openspec-propose"],
		settings: { models: { steps: { "opsx-propose": { role: "strong" } } } },
	});
	const started = fakeCommandContext({ available: [FAKE_MODEL], branch: restoredBranch("normal", "opsx-propose") });

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	expect(phase.step()?.name).toBe("opsx-propose");
	// The lock alone reads normal and the step list gives `opsx-propose` no role of its own, so a badge
	// drawn from the phase alone would say `[normal]` while the next request routes strong.
	expect(phase.lock()).toBe("normal");
	expect([...started.statuses.values()].at(-1)).toBe("[strong]");
});

// spec scenario "再読み込み中の設定変更は継続中のステップに次から効く": a settings change that the reload
// applies is read on the next request, while the step itself stays the one the branch recorded.
test("a changed step setting reaches the next request after a reload", async () => {
	const skills = ["skill:openspec-propose"];
	const before = wire({
		skills,
		settings: {
			models: {
				strong: "compat-fake/fake-strong",
				steps: { "opsx-propose": { role: "normal", thinking: "low" } },
			},
		},
	});
	await start(before.pi, "startup");
	await input(before.pi, "/skill:openspec-propose");
	expect(before.route()).toMatchObject({ role: "normal", model: FAKE_MODEL, thinkingLevel: "low" });

	const branch: SessionEntry[] = [
		makeCustomEntry(ROLE_ENTRY_TYPE, { role: "normal" }),
		...before.pi.entries.map((entry) => makeCustomEntry(entry.customType, entry.data)),
	];
	// The setting the reload applies is the changed one; nothing about the step record changes.
	const after = wire({
		skills,
		settings: {
			models: {
				strong: "compat-fake/fake-strong",
				steps: { "opsx-propose": { role: "strong", thinking: "high" } },
			},
		},
	});
	await start(after.pi, "reload", branch);

	expect(after.phase.step()?.name).toBe("opsx-propose");
	expect(after.route()).toMatchObject({ role: "strong", model: FAKE_STRONG, thinkingLevel: "high" });
});

// spec scenario "開き直したセッションでは後の再読み込みでも復元しない": a process that opens a session has no
// memory of the step that died with the old one, so the start itself has to close the record. Without it,
// changing a setting after the reopen — anything that reloads the extension — reads the step back.
for (const reason of ["startup", "resume", "fork"]) {
	test(`a reopened session restores no step on the next reload (${reason})`, async () => {
		const branch = restoredBranch("normal", "opsx-apply");
		const { pi, phase } = wire();

		await start(pi, reason, branch);

		// Nothing was in memory to end, and the start records the end anyway.
		expect(phase.step()).toBeUndefined();
		expect(pi.entries).toEqual([{ customType: STEP_ENTRY_TYPE, data: { step: null } }]);

		// The session file as the reopened session now holds it, read by a later reload.
		const reloaded = wire();
		await start(
			reloaded.pi,
			"reload",
			[...branch, ...pi.entries.map((entry) => makeCustomEntry(entry.customType, entry.data))],
		);
		expect(reloaded.phase.step()).toBeUndefined();
	});
}

// A record is written to say something changed. A branch that never ran a step, and one whose step is
// already closed, gain nothing from a start.
test("a start appends nothing to a branch with no open step", async () => {
	for (const branch of [[], restoredBranch("normal", null)] as SessionEntry[][]) {
		const { pi } = wire();

		await start(pi, "resume", branch);

		expect(pi.entries).toEqual([]);
	}
});

// Restoring reads the newest record; it changes nothing, so the session file must not grow.
test("a reload appends no step record", async () => {
	const { pi } = wire();

	await start(pi, "reload", restoredBranch("normal", "opsx-apply"));

	expect(pi.entries).toEqual([]);
});

// spec scenario "終えたステップの手前へ移る": a tree move is not a start, so the step has to follow the
// branch the user landed on. The record already says what runs there, so the move itself writes nothing.
test("a tree move follows the step record of the new branch", async () => {
	const { pi, status } = wire({ skills: ["skill:openspec-propose"] });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-propose");
	// `/spirits-clear` ends the step and records the end, which is the node the user moves back past.
	await pi.commands.get("spirits-clear")!.handler("", fakeCommandContext({ available: AVAILABLE }).ctx);
	expect(await status()).toContain("step: none");

	// The branch whose newest record is the running step, before the clear that ended it.
	const branch: SessionEntry[] = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "normal" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: "opsx-propose" } },
	];
	await treeMove(pi, branch);

	// The status right after the move names the step, and so does the status after a settings change
	// reloads the runtime onto the same branch: the phase no longer depends on whether a reload happened
	// to run after the move.
	expect(await status()).toContain("step: opsx-propose");
	expect(pi.entries.filter((entry) => entry.customType === STEP_ENTRY_TYPE)).toEqual([
		{ customType: STEP_ENTRY_TYPE, data: { step: "opsx-propose" } },
		{ customType: STEP_ENTRY_TYPE, data: { step: null } },
	]);

	const reloaded = wire({ skills: ["skill:openspec-propose"] });
	await start(reloaded.pi, "reload", branch);
	expect(await reloaded.status()).toContain("step: opsx-propose");
});

// spec scenario "ステップの記録より前へ移る": the destination branch never had the step, so the move ends it
// and the request goes to the lock's target, before and after a reload.
test("a tree move to a branch with no open step ends the step", async () => {
	const { pi, decision, status } = wire({ skills: ["skill:openspec-propose"] });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-propose");
	expect(await status()).toContain("step: opsx-propose");

	const branch: SessionEntry[] = [
		{ type: "custom", customType: ROLE_ENTRY_TYPE, data: { role: "normal" } },
		{ type: "custom", customType: STEP_ENTRY_TYPE, data: { step: null } },
	];
	await treeMove(pi, branch);
	expect(await status()).toContain("step: none");
	expect(decision()).toBe("normal:fake-model");

	const reloaded = wire({ skills: ["skill:openspec-propose"] });
	await start(reloaded.pi, "reload", branch);
	expect(await reloaded.status()).toContain("step: none");
	expect(reloaded.decision()).toBe("normal:fake-model");
});

// spec scenario "一覧に無いステップ名の記録へ移る": a name off the list is not a step, so the move takes the
// running step off — the same answer a reload gives, where the name matches nothing in the new runtime.
test("a tree move to an unlisted step record ends the step", async () => {
	const { pi, status } = wire({ skills: ["skill:openspec-propose"] });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-propose");
	expect(await status()).toContain("step: opsx-propose");

	const branch: SessionEntry[] = [makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-teleport" })];
	await treeMove(pi, branch);
	expect(await status()).toContain("step: none");

	const reloaded = wire({ skills: ["skill:openspec-propose"] });
	await start(reloaded.pi, "reload", branch);
	expect(await reloaded.status()).toContain("step: none");
});

// The fourth kind of record: one whose value is not a step name at all. It ends the step like a name off
// the list, and `spiritsStepEntry` is what reads it, so neither caller has to guard against the shape.
test("a tree move to an unreadable step record ends the step", async () => {
	const { pi, status } = wire({ skills: ["skill:openspec-propose"] });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-propose");
	expect(await status()).toContain("step: opsx-propose");

	const branch: SessionEntry[] = [makeCustomEntry(STEP_ENTRY_TYPE, { step: 42 })];
	await treeMove(pi, branch);
	expect(await status()).toContain("step: none");

	const reloaded = wire({ skills: ["skill:openspec-propose"] });
	await start(reloaded.pi, "reload", branch);
	expect(await reloaded.status()).toContain("step: none");
});

// spec scenario "ステップの記録より前へ移る", read as its GIVEN says: the node before `/opsx-propose` was ever
// sent, so the branch carries no step record of any kind.
test("a tree move to a branch with no step record ends the step", async () => {
	const { pi, decision, status } = wire({ skills: ["skill:openspec-propose"] });
	await start(pi, "startup");
	await input(pi, "/skill:openspec-propose");
	expect(await status()).toContain("step: opsx-propose");

	await treeMove(pi, [makeCustomEntry(ROLE_ENTRY_TYPE, { role: "normal" })]);

	expect(await status()).toContain("step: none");
	expect(decision()).toBe("normal:fake-model");
	expect(pi.entries).toEqual([{ customType: STEP_ENTRY_TYPE, data: { step: "opsx-propose" } }]);
});

// spec scenario "移動の後に badge を描き直す": nothing else fires on a move, so the badge would keep showing the
// role from before it. The step's own role is what the next request takes, so that is what is drawn.
test("a tree move redraws the badge", async () => {
	const { pi } = wire({
		skills: ["skill:openspec-propose"],
		settings: { models: { steps: { "opsx-propose": { role: "strong" } } } },
	});
	const started = await start(pi, "startup");
	expect([...started.statuses.values()].at(-1)).toBe("[normal]");

	const moved = await treeMove(pi, [makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-propose" })]);

	expect([...moved.statuses.values()].at(-1)).toBe("[strong]");
});

// A move reads the destination's record; it does not add one, because the destination leaf would then
// claim a change the user never made there.
test("a tree move appends no step record", async () => {
	for (const branch of [restoredBranch("normal", "opsx-propose"), restoredBranch("normal", null)] as SessionEntry[][]) {
		const { pi } = wire({ skills: ["skill:openspec-propose"] });
		await start(pi, "startup");
		expect(pi.entries).toEqual([]);

		await treeMove(pi, branch);

		expect(pi.entries).toEqual([]);
	}
});

// A start that records nothing leaves the configured default standing, which is what makes `models.role`
// a default rather than a session's state.
test("a new session with no records takes the configured default", async () => {
	const pi = withoutRoleApi(new FakePi());
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "strong" } };
	const routing = registerDualModelRouting(pi);
	registerManagedCommands(pi, { phase: routing.phase, patchSettings: () => {} });

	await start(pi, "new");

	expect(routing.phase.current()).toBe("strong");
	expect(routing.phase.step()).toBeUndefined();
});
