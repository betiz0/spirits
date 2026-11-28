/**
 * The one-time nudge: an unsaved, pinned verification gets exactly one continuation, then exactly
 * one notice, then silence; a pending (un-pinned) settle is neither; non-interactive modes get the
 * stderr notice only; a restored step never nudges (spec `verification-report-saving` /
 * 保存されるまで検証を完了として扱わない, 督促の境界).
 */

import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	TOOL_NAME_VERIFY_REPORT_SAVE,
	VERIFY_NUDGE_CUSTOM_TYPE,
	VERIFY_REPORT_NUDGE_MESSAGE,
	VERIFY_REPORT_UNPINNED_NOTICE,
	VERIFY_REPORT_UNPINNED_STDERR_NOTICE,
	VERIFY_REPORT_UNSAVED_NOTICE,
	VERIFY_REPORT_UNSAVED_STDERR_NOTICE,
} from "../src/constants.ts";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { registerVerifyReportSaving } from "../src/verify/register.ts";
import { asExtensionApi, erasedToolContext, fakeModel, slashCommandInfo } from "./host/fake-pi.ts";
import { AUTO_SELECTION, FakePi, fakeCatalog, makeInputEvent, makeRequest, makeSettledEvent } from "./routing/fake-pi.ts";

interface Setup {
	pi: FakePi;
	/** The phase the wiring reads; the restore test drives it the way the session record would. */
	phase: ReturnType<typeof registerDualModelRouting>["phase"];
	dir: string;
	ctx: ExtensionContext;
	notices: string[];
	stderrLines: string[];
	/** How many change-name reads happened: `pin.offer` is its only caller, so zero proves nothing was offered. */
	listCalls(): number;
	/** Fire `agent_before_settle` the way the host does at the last boundary, and read the answers. */
	settle(): Promise<unknown[]>;
	/** Say the step's request resolved, so a following plain input does not close the step. */
	resolved(): void;
	dispose(): Promise<void>;
}

async function setup(mode: "tui" | "rpc" | "print" | "json" = "tui"): Promise<Setup> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-nudge-"));
	const pi = new FakePi();
	const routing = registerDualModelRouting(asExtensionApi(pi));
	const stderrLines: string[] = [];
	let lists = 0;
	registerVerifyReportSaving(asExtensionApi(pi), {
		phase: routing.phase,
		listChangeNames: async () => {
			lists += 1;
			return ["alpha"];
		},
		resolveChangeRoot: async () => ({ kind: "ok", changeRoot: dir }),
		writeStderr: (line) => void stderrLines.push(line),
	});
	pi.slashCommands = [slashCommandInfo("opsx-verify", "prompt")];
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };
	const catalog = fakeCatalog({
		mode,
		available: [fakeModel("anthropic", "claude-sonnet-4-5")],
		authedProviders: ["anthropic"],
		model: AUTO_SELECTION,
	});
	return {
		pi,
		phase: routing.phase,
		dir,
		ctx: catalog.ctx,
		notices: catalog.notices,
		stderrLines,
		listCalls: () => lists,
		settle: () =>
			pi.fire(
				"agent_before_settle",
				{ type: "agent_before_settle", entries: [], continue: false, outcome: "completed", context: { canContinue: true } },
				catalog.ctx,
			),
		resolved: () => void pi.route()(makeRequest(), catalog.ctx),
		dispose: async () => void (await rm(dir, { recursive: true, force: true })),
	};
}

/** The one nudge answer shape the host accepts: a custom_message draft and `continue`. */
function isNudge(result: unknown): boolean {
	const r = result as { continue?: boolean; entries?: Array<{ type?: string; customType?: string; content?: string }> };
	return (
		r?.continue === true &&
		r.entries?.length === 1 &&
		r.entries[0]?.type === "custom_message" &&
		r.entries[0]?.customType === VERIFY_NUDGE_CUSTOM_TYPE &&
		r.entries[0]?.content === VERIFY_REPORT_NUDGE_MESSAGE
	);
}

test("a pinned, unsaved settle nudges once, then notices once, then stays quiet", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);

		const first = await s.settle();
		expect(first.filter(isNudge)).toHaveLength(1);

		const second = await s.settle();
		expect(second.filter((r) => r !== undefined)).toEqual([]);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNSAVED_NOTICE))).toHaveLength(1);

		const third = await s.settle();
		expect(third.filter((r) => r !== undefined)).toEqual([]);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNSAVED_NOTICE))).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

test("the nudge does not trust the event-side canContinue flag (it is false before drafts)", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		// Measured on pi 1.6.0: at a normally completed settle the event context reports
		// canContinue=false, because its last message is the assistant's. The host re-checks after
		// committing the nudge draft, which is what actually decides.
		const results = await pi_fire_false(s);
		expect(results.filter(isNudge)).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

async function pi_fire_false(s: Setup): Promise<unknown[]> {
	return s.pi.fire(
		"agent_before_settle",
		{ type: "agent_before_settle", entries: [], continue: false, outcome: "completed", context: { canContinue: false } },
		s.ctx,
	);
}

test("the nudge text allows answering \"not finished\" instead of a report", () => {
	// Decision 8: the pressure to save must not become pressure to invent.
	expect(VERIFY_REPORT_NUDGE_MESSAGE).toContain("do not invent one");
});

test("a settle after the save does not nudge and does not notice", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		const tool = s.pi.tools.find((t) => t.name === "spirits_verify_report_save")!;
		await tool.execute("call-0", { body: "the report" }, undefined, undefined, erasedToolContext(tool, {}));

		expect((await s.settle()).filter((r) => r !== undefined)).toEqual([]);
		expect(s.notices).toEqual([]);
		expect(s.stderrLines).toEqual([]);
		expect(await Bun.file(join(s.dir, "verify1.md")).text()).toBe("the report");
	} finally {
		await s.dispose();
	}
});

// Spec `verification-report-saving` / 検証プロンプトの再生成に依存しない (d-verify1 W-2,
// d-verify3 W-1): the fixture is a same-named prompt template whose regenerated body says the
// opposite of this change ("output only, do not save a file"). The expanded body is fed through the
// input path the way the run carries it, and the nudge still comes exactly once: the step name is
// the layer's only route to the workflow, and it never reads a template.
test("a regenerated verify prompt template body still earns exactly one nudge", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-prompt-"));
	const templateFile = join(dir, ".pi", "prompts", "opsx-verify.md");
	await mkdir(dirname(templateFile), { recursive: true });
	await writeFile(
		templateFile,
		"---\ndescription: verify (regenerated by a newer openspec CLI)\n---\n" +
			"検証結果をチャットに出力するだけでよく、ファイルへの保存はしないでください。対象: $ARGUMENTS\n",
	);
	// pi's own expansion of the template with the command's argument text.
	const expanded = (await Bun.file(templateFile).text()).replace("$ARGUMENTS", "alpha");
	expect(expanded).toContain("保存はしないでください");

	const s = await setup();
	try {
		s.pi.slashCommands = [slashCommandInfo("opsx-verify", "prompt")];
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		// The regenerated body joins the run in progress. A line the person steers with is nobody's
		// answer to a clarification and opens nothing, whatever its text says about saving.
		await s.pi.fire("input", makeInputEvent(expanded, "steer"), s.ctx);

		const first = await s.settle();
		expect(first.filter(isNudge)).toHaveLength(1);
		// The continuation asks in spirits' own words, not the template's.
		const second = await s.settle();
		expect(second.filter((result) => result !== undefined)).toEqual([]);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNSAVED_NOTICE))).toHaveLength(1);
		// Two phrases of the regenerated body, not one: the notices are spirits' own wording end to end.
		const said = s.notices.join("\n");
		expect(said).not.toContain("保存はしないでください");
		expect(said).not.toContain("チャットに出力するだけでよく");
	} finally {
		await s.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("the layer subscribes to lifecycle events only, so a prompt body has no path to it", () => {
	// The structural half of the prompt-regression guarantee: no prompt-side event
	// (`before_agent_start`, `context`) exists in this registration.
	const alone = new FakePi();
	registerVerifyReportSaving(asExtensionApi(alone), {
		phase: { step: () => undefined, stepStartedByInput: () => false },
		listChangeNames: async () => [],
	});
	expect([...alone.handlers.keys()].sort()).toEqual([
		"agent_before_settle",
		"agent_settled",
		"input",
		"session_start",
		"session_tree",
	]);
});

test("a pending settle nudges nothing and does not spend the one nudge", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify"), s.ctx);
		s.resolved();

		// The run ended asking which change. Nothing to save to, nobody to blame.
		expect((await s.settle()).filter((r) => r !== undefined)).toEqual([]);
		expect(s.notices).toEqual([]);

		// The user's answer pins the target; the nudge slot is still there for this step.
		await s.pi.fire("input", makeInputEvent("alpha"), s.ctx);
		const first = await s.settle();
		expect(first.filter(isNudge)).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

test("an aborted run is not nudged (the boundary never fires; the settle keeps the state)", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		// pi skips `agent_before_settle` on an abort and goes to `agent_settled` directly.
		await s.pi.fire("agent_settled", makeSettledEvent(true), s.ctx);
		expect(s.notices).toEqual([]);
		expect(s.stderrLines).toEqual([]);

		// The next real settle of the continuing step still owns its one nudge.
		const next = await s.settle();
		expect(next.filter(isNudge)).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

test("rpc nudges like tui", async () => {
	const s = await setup("rpc");
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha", undefined, "rpc"), s.ctx);
		expect((await s.settle()).filter(isNudge)).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

test("print and json modes never ask for the continuation and say it on stderr only", async () => {
	for (const mode of ["print", "json"] as const) {
		const s = await setup(mode);
		try {
			await s.pi.fire("input", makeInputEvent("/opsx-verify alpha", undefined, mode === "json" ? "rpc" : "interactive"), s.ctx);
			const results = await s.settle();
			expect(results.filter((r) => r !== undefined)).toEqual([]);
			expect(s.stderrLines.filter((line) => line === VERIFY_REPORT_UNSAVED_STDERR_NOTICE)).toHaveLength(1);
			// The stdout-side surfaces (ui notice) stay untouched: the output form does not change.
			expect(s.notices).toEqual([]);
		} finally {
			await s.dispose();
		}
	}
});

// Spec `verification-report-saving` / 対象を固定できないまま終わった検証を伝える (d-verify3 S-1): the
// two routes where no answer can pin anything any more still tell the user, once, that no report exists.
test("a deep verification that settles asking which change says no report was saved", async () => {
	const s = await setup();
	try {
		s.pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);

		// The deep verification does not continue: the routing's own settle handler closed the step before
		// this layer's, so the clarification dies with it.
		await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		const told = s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE));
		expect(told).toHaveLength(1);
		expect(told[0]).toContain("/skill:sprt-opsx-verify-deep <change>");
		expect(s.stderrLines).toEqual([]);

		// The answer pins nothing and repeats nothing.
		await s.pi.fire("input", makeInputEvent("alpha"), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toHaveLength(1);
		expect(await readdir(s.dir)).toEqual([]);
	} finally {
		await s.dispose();
	}
});

test("a physical model session that answers an un-named verification is told once", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify"), s.ctx);
		// No `resolved()`: a session on a physical model never resolves the step's request, so routing ends
		// the step at the next input — the answer itself.
		await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		expect(s.notices).toEqual([]);

		await s.pi.fire("input", makeInputEvent("alpha"), s.ctx);
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toHaveLength(1);
		// The answer never reached the pin: the window was already closed.
		expect(s.listCalls()).toBe(0);
		expect(await readdir(s.dir)).toEqual([]);

		await s.pi.fire("input", makeInputEvent("beta"), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toHaveLength(1);
	} finally {
		await s.dispose();
	}
});

test("the un-pinned close goes to stderr in stdout modes and stays silent on an abort", async () => {
	// Both stdout modes, as the continuation notice test does: neither gets a ui notice (d-verify3 G-1).
	for (const mode of ["print", "json"] as const) {
		const s = await setup(mode);
		try {
			s.pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
			await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep", undefined, "rpc"), s.ctx);
			await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
			expect(s.notices).toEqual([]);
			expect(s.stderrLines.filter((line) => line === VERIFY_REPORT_UNPINNED_STDERR_NOTICE)).toHaveLength(1);
		} finally {
			await s.dispose();
		}
	}

	// An aborted run is the user's own stop: the continuation rule already keeps quiet, and so does this.
	const aborted = await setup();
	try {
		aborted.pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
		await aborted.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep"), aborted.ctx);
		await aborted.pi.fire("agent_settled", makeSettledEvent(true), aborted.ctx);
		expect(aborted.notices).toEqual([]);
		expect(aborted.stderrLines).toEqual([]);
		expect(aborted.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await aborted.dispose();
	}
});

// Spec `verification-report-saving` / 対象を固定できないまま終わった検証を伝える, シナリオ
// 「固定された検証の終了が後日の通知にならない」(d-verify3 C-1): a close consumes its obligation, so a
// verification that did have a target cannot be reported later as one that never got a name.
test("an aborted pinned deep verification is not announced by a later input", async () => {
	const s = await setup();
	try {
		s.pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep alpha"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);

		// The run stopped by hand: no nudge boundary, and the non-continuing step closed with it.
		await s.pi.fire("agent_settled", makeSettledEvent(true), s.ctx);
		expect(s.notices).toEqual([]);

		await s.pi.fire("input", makeInputEvent("what changed since then?"), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);
		expect(s.stderrLines).toEqual([]);
		expect(await readdir(s.dir)).toEqual([]);
	} finally {
		await s.dispose();
	}
});

test("leaving a pinned verification through another command announces nothing later", async () => {
	const s = await setup();
	try {
		s.pi.slashCommands = [slashCommandInfo("opsx-verify", "prompt"), slashCommandInfo("opsx-apply", "prompt")];
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		s.resolved();

		// The user leaves the workflow without saving. The target was pinned, so this verification's
		// unsaved fact belongs to the continuation, not to the un-pinned notice.
		await s.pi.fire("input", makeInputEvent("/opsx-apply other"), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);

		await s.pi.fire("input", makeInputEvent("and now?"), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);
		expect(s.stderrLines).toEqual([]);
		expect(await readdir(s.dir)).toEqual([]);
	} finally {
		await s.dispose();
	}
});

test("a session start or tree move drops the window without the notice", async () => {
	const s = await setup();
	try {
		s.pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);

		// Decision 10 again: the obligation is this runtime's fact about a run it watched, so a session
		// change drops it in silence, and the leftover run's settle then has nothing to say either.
		await s.pi.fire("session_start", { reason: "reload" }, s.ctx);
		expect(s.notices).toEqual([]);
		await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);

		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep"), s.ctx);
		await s.pi.fire("session_tree", { type: "session_tree", newLeafId: "leaf-b", oldLeafId: "leaf-a" }, s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);
		await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
		expect(s.notices.filter((line) => line.includes(VERIFY_REPORT_UNPINNED_NOTICE))).toEqual([]);
		expect(s.stderrLines).toEqual([]);
	} finally {
		await s.dispose();
	}
});

test("a verify step restored by reload never nudges", async () => {
	const s = await setup();
	try {
		// The routing reads the step back from the session record; the pin and the obligation are
		// new-runtime facts and do not exist for it.
		s.phase.restoreStep("opsx-verify");
		await s.pi.fire("session_start", { reason: "reload" }, s.ctx);
		expect((await s.settle()).filter((r) => r !== undefined)).toEqual([]);
		expect(s.notices).toEqual([]);
		expect(s.stderrLines).toEqual([]);
	} finally {
		await s.dispose();
	}
});
