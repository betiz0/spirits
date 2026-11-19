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
import { slashCommandInfo, asExtensionApi, customEntry, fakeModel, nextEntryId } from "./host/fake-pi.ts";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, fakeCommandContext, FakePi, makeCustomEntry } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = fakeModel("compat-fake", "fake-model", { api: "openai" });
const FAKE_STRONG: PiModel = fakeModel("compat-fake", "fake-strong", { api: "openai" });
const AVAILABLE = [FAKE_MODEL, FAKE_STRONG];

/** The routing layer and the command surface over one fake host, as `src/index.ts` wires them. */
function wire(options: { skills?: readonly string[]; settings?: Record<string, unknown> } = {}) {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model", ...(options.settings ?? {}) };
	pi.slashCommands = (options.skills ?? ["skill:openspec-apply-change", "skill:sprt-opsx-verify-deep"]).map((name) => slashCommandInfo(name, "skill"));
	// The route result the host reads names the model and the level, and the role is the routing's own
	// report (spec `dual-model-routing` / ModelRoute の role は使わない), so the wire keeps the report and
	// reads a request's answer as the pair.
	let reported: string | undefined;
	const routing = registerDualModelRouting(asExtensionApi(pi), {
		onRole: (role) => {
			reported = role;
		},
	});
	registerManagedCommands(asExtensionApi(pi), { phase: routing.phase, patchSettings: () => {}, patchSettingsPath: () => {} });
	/** The full resolution of one request, which is what the route, the child, and the list share. */
	const route = () => {
		const { ctx } = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"] });
		const answered = pi.route()({ model: AUTO_SELECTION, thinkingLevel: "medium", reason: "user", messages: [] }, ctx) as {
			model: PiModel;
			thinkingLevel?: string;
		};
		return { ...answered, role: reported };
	};
	/** `"<role>:<routed model id>"` for one request, the way the footer and the router see it. */
	const decision = () => {
		const routed = route();
		return `${routed.role}:${routed.model.id}`;
	};
	/** The `status` report the command would show. */
	const status = async () => {
		const context = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"], model: AUTO_SELECTION });
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
	const context = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"], model: AUTO_SELECTION, branch });
	await pi.fire("session_start", { type: "session_start", reason }, context.ctx);
	return context;
}

async function input(pi: FakePi, text: string) {
	const context = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"], model: AUTO_SELECTION });
	await pi.fire("input", { type: "input", text, source: "interactive" }, context.ctx);
	return context;
}

/** Move between branches the way `/tree` does: no session start, only the new branch behind the runtime. */
async function treeMove(pi: FakePi, branch: readonly SessionEntry[]) {
	const context = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"], model: AUTO_SELECTION, branch });
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
		customEntry(ROLE_ENTRY_TYPE, { role: "normal" }, nextEntryId()),
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

// spec scenario "復帰でも継続中のステップを戻す": the branch's records say what runs on it, and a start
// reads them. What it does not do is write a step back that its own list no longer carries.
test("a resume restores the step the branch recorded", async () => {
	const branch: SessionEntry[] = [
		customEntry(ROLE_ENTRY_TYPE, { role: "normal" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }, nextEntryId()),
	];
	const { pi, phase } = wire();

	await start(pi, "resume", branch);

	expect(phase.lock()).toBe("normal");
	expect(phase.step()?.name).toBe("opsx-apply");
	// Nothing was written: the records already describe this branch, and a start that added one would make
	// the next reload believe the step had ended.
	expect(pi.entries).toEqual([]);
});

// spec scenario "run の途中で閉じた継続しないステップは復帰で戻さない": an open record of a step that ends
// with its run means the run was interrupted, and an interrupted run returns to the lock. The rejection is
// written down, which is what keeps the next reload from putting the step back.
test("a resume does not restore a step that ends with its run", async () => {
	const branch = restoredBranch("normal", "sprt-opsx-verify-deep");
	const { pi, phase, decision } = wire();

	await start(pi, "resume", branch);

	expect(phase.step()).toBeUndefined();
	expect(decision()).toBe("normal:fake-model");
	expect(stepRecords(branch.concat(pi.entries.map((entry) => makeCustomEntry(entry.customType, entry.data))).slice(-2))).toEqual([
		{ step: "sprt-opsx-verify-deep" },
		{ step: null },
	]);
});

// spec scenario "棄却した継続しないステップは再読み込みでも戻さない": the rejection has to survive the thing
// it was made for. A runtime is replaced by a reload, so a rejection that lived only in memory would let the
// next reload read the same open record and put the strong step back — measured in verification as normal
// right after the resume and strong again after the reload.
test("a rejected step that does not continue stays rejected through a reload", async () => {
	const branch = restoredBranch("normal", "sprt-opsx-verify-deep");
	const { pi, phase } = wire();

	await start(pi, "resume", branch);
	expect(phase.step()).toBeUndefined();

	// The branch as the reopened session leaves it: the record of the interrupted step, then the end this
	// start wrote over it. Read back by a fresh runtime through a reload.
	const reopened: SessionEntry[] = [
		...branch,
		...pi.entries.map((entry) => makeCustomEntry(entry.customType, entry.data)),
	];
	const fresh = wire();
	const started = await start(fresh.pi, "reload", reopened);

	expect(fresh.phase.step()).toBeUndefined();
	expect(started.statuses.get("spirits")).toBe("[normal]");
	expect(fresh.decision()).toBe("normal:fake-model");
	// The reload itself adds nothing.
	expect(fresh.pi.entries).toEqual([]);
});

// spec scenario "復帰では復元しない": `/spirits-clear` ended the step and recorded that, and the end is the
// newest thing the branch says.
test("a resume does not restore a step `/spirits-clear` ended", async () => {
	const branch: SessionEntry[] = [
		makeCustomEntry(ROLE_ENTRY_TYPE, { role: "normal" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: null }),
	];
	const { pi, phase, decision } = wire();

	await start(pi, "resume", branch);

	expect(phase.step()).toBeUndefined();
	expect(decision()).toBe("normal:fake-model");
});

// spec scenario "復帰後にロールが戻る" and the reopened half of "開き直したセッションは開いた時点で戻し、
// 再読み込みの後も同じ": the lock, the step, the badge, and the first request all come back as one state.
test("a resumed session continues its step on the role the badge shows", async () => {
	const { pi, phase, decision } = wire({
		settings: { models: { strong: "compat-fake/fake-strong", steps: { "opsx-apply": { role: "strong" } } } },
	});

	const started = await start(pi, "resume", restoredBranch("normal", "opsx-apply"));

	expect(phase.lock()).toBe("normal");
	expect(phase.step()?.name).toBe("opsx-apply");
	// The badge is drawn from the state that came back, so the footer says strong before the first request.
	expect(started.statuses.get("spirits")).toBe("[strong]");
	expect(started.statuses.get("spirits-model")).toBe("fake-strong");
	// And the first idle input really goes there: the line and the route cannot be telling two stories.
	expect(decision()).toBe("strong:fake-strong");
});

// The record of a step that ended is a record too, and it is the reason nothing comes back.
test("a reload after the step ended restores nothing", async () => {
	const branch: SessionEntry[] = [
		customEntry(ROLE_ENTRY_TYPE, { role: "normal" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: null }, nextEntryId()),
	];
	const { pi, phase } = wire();

	await start(pi, "reload", branch);

	expect(phase.step()).toBeUndefined();
});

// The badge and the status line are drawn from the phase, so what a reload restores is what they show —
// the step's role rather than the lock the user set before the step opened.
test("the badge and status match the phase restored across a reload", async () => {
	const branch = restoredBranch("normal", "sprt-opsx-verify-deep");
	const { pi, phase } = wire({ settings: { models: { strong: "compat-fake/fake-strong" } } });
	const started = fakeCommandContext({ available: AVAILABLE, authedProviders: ["compat-fake"], model: AUTO_SELECTION, branch });

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	// The step's own default role is what the next request takes.
	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");
	expect(phase.step()?.defaultRole).toBe("strong");
	expect(phase.current()).toBe("strong");
	// The badge is redrawn on the new runtime, on the role the phase settled on for the step, and the
	// answering model comes with it on its own key.
	expect(started.statuses.get("spirits")).toBe("[strong]");
	expect(started.statuses.get("spirits-model")).toBe("fake-strong");

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
		settings: { models: { strong: "compat-fake/fake-strong", steps: { "opsx-propose": { role: "strong", thinking: "high" } } } },
	});
	const started = fakeCommandContext({
		available: AVAILABLE,
		authedProviders: ["compat-fake"],
		model: AUTO_SELECTION,
		branch: restoredBranch("normal", "opsx-propose"),
	});

	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	expect(phase.step()?.name).toBe("opsx-propose");
	// The lock alone reads normal and the step list gives `opsx-propose` no role of its own, so a badge
	// drawn from the phase alone would say `[normal]` while the next request routes strong.
	expect(phase.lock()).toBe("normal");
	// spec scenario "ステップ設定のロールを badge に出す": the level the step asks for rides on the same word.
	expect(started.statuses.get("spirits")).toBe("[strong high]");
	expect(started.statuses.get("spirits-model")).toBe("fake-strong");
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

// spec scenario "開き直したセッションは開いた時点で戻し、再読み込みの後も同じ": the step is restored when the
// session is opened, not when a reload happens to follow, and no record is written to say so. The point of
// the old behavior was to stop a later reload reading back a step nobody remembered; reading the records at
// the open is what stops it now, and it stops it without inventing a record this branch never had.
for (const reason of ["startup", "resume", "fork"]) {
	test(`a reopened session restores its step at the open and on the next reload (${reason})`, async () => {
		const branch = restoredBranch("normal", "opsx-apply");
		const { pi, phase } = wire();

		await start(pi, reason, branch);

		expect(phase.step()?.name).toBe("opsx-apply");
		expect(pi.entries).toEqual([]);

		// The session file as the reopened session holds it — unchanged — read by a later reload.
		const reloaded = wire();
		await start(reloaded.pi, "reload", branch);
		expect(reloaded.phase.step()?.name).toBe("opsx-apply");
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
		customEntry(ROLE_ENTRY_TYPE, { role: "normal" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: "opsx-propose" }, nextEntryId()),
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
		customEntry(ROLE_ENTRY_TYPE, { role: "normal" }, nextEntryId()),
		customEntry(STEP_ENTRY_TYPE, { step: null }, nextEntryId()),
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
// spec scenario "移動の後に badge を描き直す", and "分岐ごとにロールを持つ": the badge follows the branch the
// user landed on, and so does the next request, because both read the same phase.
test("a tree move redraws the badge and moves the next request with it", async () => {
	const { pi, decision } = wire({
		skills: ["skill:openspec-propose"],
		settings: { models: { strong: "compat-fake/fake-strong", steps: { "opsx-propose": { role: "strong" } } } },
	});
	const started = await start(pi, "startup");
	expect(started.statuses.get("spirits")).toBe("[normal]");
	expect(started.statuses.get("spirits-model")).toBe("fake-model");

	const moved = await treeMove(pi, [makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-propose" })]);

	expect(moved.statuses.get("spirits")).toBe("[strong]");
	expect(moved.statuses.get("spirits-model")).toBe("fake-strong");
	expect(decision()).toBe("strong:fake-strong");

	// Back to the branch with no step of its own, and both follow.
	const back = await treeMove(pi, [makeCustomEntry(ROLE_ENTRY_TYPE, { role: "normal" })]);
	expect(back.statuses.get("spirits")).toBe("[normal]");
	expect(decision()).toBe("normal:fake-model");
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
// a default rather than a session's state. spec `managed-commands` / どちらも無ければ既定ロール: the lock is
// the default, and the badge is drawn from it rather than from a record that does not exist.
test("a new session with no records takes the configured default", async () => {
	const pi = new FakePi();
	pi.settings = {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { role: "strong", strong: "compat-fake/fake-strong" },
	};
	const routing = registerDualModelRouting(asExtensionApi(pi));
	registerManagedCommands(asExtensionApi(pi), { phase: routing.phase, patchSettings: () => {} });

	const started = await start(pi, "new");

	expect(routing.phase.lock()).toBe("strong");
	expect(routing.phase.current()).toBe("strong");
	expect(routing.phase.step()).toBeUndefined();
	expect(started.statuses.get("spirits")).toBe("[strong]");
	expect(started.statuses.get("spirits-model")).toBe("fake-strong");
});

// spec "dual-model-routing / strong フェーズからの復帰": 新規セッションの開始では継続中のステップを終える。
// A new conversation has no records of its own, so the step this process was holding is simply gone and the
// next request runs on the lock.
test("a new session ends the step the process was holding", async () => {
	const { pi, phase, decision } = wire({
		settings: { models: { strong: "compat-fake/fake-strong", steps: { "opsx-apply": { role: "strong" } } } },
	});
	await start(pi, "startup");
	await input(pi, "/skill:openspec-apply-change add-dual-model-routing");
	expect(phase.step()?.name).toBe("opsx-apply");
	expect(decision()).toBe("strong:fake-strong");

	await start(pi, "new");

	expect(phase.step()).toBeUndefined();
	expect(phase.lock()).toBe("normal");
	expect(decision()).toBe("normal:fake-model");
	// Ending the step for a new conversation writes nothing: the record belongs to the conversation that
	// ended, and this one has no file of its own to append it to.
	expect(pi.entries).toEqual([{ customType: STEP_ENTRY_TYPE, data: { step: "opsx-apply" } }]);
});
