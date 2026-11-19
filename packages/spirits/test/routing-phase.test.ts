/**
 * The step phase: which step an input opens, which role it settles on, and when the step ends.
 *
 * The phase reads `pi.getCommands()` on every input, because a step only starts where pi would really
 * expand the command. The doubles here hand it that list directly.
 */

import { expect, test } from "bun:test";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import { slashCommandInfo } from "./host/fake-pi.ts";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { createRoutingPhase } from "../src/routing/phase.ts";
import type { RoutingPhaseHooks } from "../src/routing/phase.ts";

/** A phase whose host offers exactly these command names, as skills or templates. */
function phaseWithCommands(names: readonly string[], hooks?: RoutingPhaseHooks) {
	const commands: SlashCommandInfo[] = names.map((name) => slashCommandInfo(name, name.startsWith("skill:") ? "skill" : "prompt"));
	return createRoutingPhase({ listCommands: () => commands, ...(hooks ? { hooks } : {}) });
}

/** The review and deep-verify skills, which are the two steps that default to strong. */
const REVIEW_COMMANDS = ["skill:sprt-opsx-review-change", "skill:sprt-opsx-verify-deep"];

test("enters strong for the change review skill command", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-review-change add-dual-model-routing`);

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("enters strong for the deep verify skill command", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("ignores other skill commands and plain input", () => {
	const phase = phaseWithCommands([...REVIEW_COMMANDS, "skill:sprt-architecture-guards"]);

	for (const text of [
		`${SKILL_COMMAND_PREFIX}sprt-architecture-guards`,
		`${SKILL_COMMAND_PREFIX}sprt-opsx-review-change-extra`,
		"/model spirits/auto",
		`please run ${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep now`,
		"",
	]) {
		phase.handleInput(text);
		expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
	}
});

// spec "dual-model-routing / 開始コマンドの判定": 展開されないスキルコマンドでは遷移しない
test("ends the skill name at the first space like pi", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);

	// pi reads the skill name up to the first space, so these name `sprt-opsx-verify-deep\nadd-dual` and
	// `sprt-opsx-verify-deep\tadd-dual`: unknown skills pi passes through as plain text.
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep\nadd-dual model`);
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep\tadd-dual model`);
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);

	// With a space the same command names the target skill and its arguments.
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

// spec "dual-model-routing / 開始コマンドの判定": pi が展開しない入力では開始しない
test("starts a step from its starter command", () => {
	const phase = phaseWithCommands(["skill:openspec-propose"]);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}openspec-propose add-dual-model-routing`);

	const step = phase.step();
	expect(step?.name).toBe("opsx-propose");
	// The propose step has no default role of its own, so it follows the lock.
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

test("does not start when pi would not expand the command", () => {
	// The session has no openspec skill: an untrusted project, a removed skill, and `--no-skills` all
	// read this way, and none of them opens a step.
	const phase = phaseWithCommands([]);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}openspec-propose add-dual-model-routing`);

	expect(phase.step()).toBeUndefined();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);

	// A command registered by an extension is not something pi expands into a run either, so a name a
	// step claims but pi reports as an extension command opens nothing.
	const extensionOwned = phaseWithCommands([]);
	extensionOwned.handleInput("/opsx-propose");
	expect(extensionOwned.step()).toBeUndefined();
});

// spec "dual-model-routing / strong フェーズの開始": テンプレートとスキルで同じステップ
test("a template and a skill start the same step", () => {
	// The step lists both spellings, and pi reports the template as `source: "prompt"` and the skill as
	// `skill:<name>`. Either input opens the one step, which is what lets a step setting cover both.
	const phase = phaseWithCommands(["opsx-ff", "skill:openspec-ff-change"]);

	phase.handleInput("/opsx-ff add-dual-model-routing");
	expect(phase.step()?.name).toBe("opsx-ff");

	phase.requestResolved();
	phase.handleInput(`${SKILL_COMMAND_PREFIX}openspec-ff-change add-dual-model-routing`);
	expect(phase.step()?.name).toBe("opsx-ff");
});

// spec "dual-model-routing / strong フェーズの維持と解除": 表に無いスキルまたはテンプレートの起動で終わる
test("an unlisted template ends the step", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change", "some-other-template"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	// A prompt template pi expands that no step lists leaves the listed workflow, exactly as a skill does.
	phase.handleInput("/some-other-template arg");

	expect(phase.step()).toBeUndefined();
});

// spec "dual-model-routing / 継続するステップ": run が終わってもロールはステップに残る
test("a continuing step survives settle", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.setRole(MODEL_ROLE_STRONG);
	phase.handleInput(`/skill:openspec-apply-change ${"x"}`);
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	phase.settle();

	expect(phase.step()?.name).toBe("opsx-apply");
	// No default role of its own, so the continuing step still reads as the lock.
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("a non-continuing step returns to the lock at settle", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	phase.requestResolved();
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	// `agent_settled` carries `aborted` but the phase ignores it: an aborted run settles the same way,
	// which is what makes the handler a finally for the run.
	phase.settle();

	expect(phase.step()).toBeUndefined();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

// spec "dual-model-routing / 開始コマンドの判定": 1 回のリクエストも解決しないステップは次の run に持ち越さない
test("drops a continuing step whose run never started", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	phase.settle();
	expect(phase.step()?.name).toBe("opsx-apply");

	// The next run opens nothing, and the step that never resolved a request is over: a skill run that
	// never started — a credential error, or another extension handling the input — must not reach a
	// later run.
	const again = phaseWithCommands(["skill:openspec-apply-change"]);
	again.handleInput("/skill:openspec-apply-change x");
	expect(again.step()?.name).toBe("opsx-apply");
	again.handleInput("plain prompt");
	expect(again.step()).toBeUndefined();
});

// spec "dual-model-routing / ステップの終了条件"
test("ends the step on a starter of another step", () => {
	const phase = phaseWithCommands(["skill:openspec-propose", "skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-propose x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-propose");

	phase.handleInput("/skill:openspec-apply-change x");

	expect(phase.step()?.name).toBe("opsx-apply");
});

test("ends the step on a skill that is not listed", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change", "skill:some-other-workflow"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	// A skill pi expands that no step lists leaves the workflow, so the step is over rather than
	// carried into a conversation about something else.
	phase.handleInput("/skill:some-other-workflow");

	expect(phase.step()).toBeUndefined();
});

test("ends the step on clear", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	// `/spirits-clear` puts the conversation out of the context, which is the end of the step that ran
	// in it. The command calls this method; the phase knows nothing about clear.
	phase.endStep();

	expect(phase.step()).toBeUndefined();
});

test("ends the step on a role lock", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	expect(phase.step()?.name).toBe("opsx-apply");

	phase.setRole(MODEL_ROLE_STRONG);

	// The lock is an end condition, so the run in progress takes it from the next request onward.
	expect(phase.step()).toBeUndefined();
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("ends the step on a new session", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();

	phase.beginSession("new");

	expect(phase.step()).toBeUndefined();
});

test("ends the step on resume and fork", () => {
	const phase = phaseWithCommands(["skill:openspec-apply-change"]);
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();

	phase.beginSession("resume");
	expect(phase.step()).toBeUndefined();

	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();
	phase.beginSession("fork");
	expect(phase.step()).toBeUndefined();
});

// --------------------------------------------------------------- the lock under the step

test("keeps the locked role on idle input that is not a step starter", () => {
	const phase = phaseWithCommands([...REVIEW_COMMANDS, "skill:sprt-architecture-guards"]);
	phase.setRole(MODEL_ROLE_STRONG);

	for (const text of ["plain prompt", `${SKILL_COMMAND_PREFIX}sprt-architecture-guards`, "/opsx-apply x"]) {
		phase.handleInput(text);
		expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	}
});

// spec "dual-model-routing / strong フェーズの開始": 対象スキルはロック中でも strong へ遷移する
test("enters strong for a target skill while locked on strong", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.setRole(MODEL_ROLE_STRONG);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`);

	expect(phase.step()?.name).toBe("sprt-opsx-verify-deep");
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("settles back to the locked role", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.setRole(MODEL_ROLE_STRONG);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	phase.settle();

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("a lock set to normal releases a strong lock", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.setRole(MODEL_ROLE_STRONG);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	// `/model <model> normal` is the way out of a strong lock.
	phase.setRole(MODEL_ROLE_NORMAL);
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
	// A strong-default step run under the released lock still ends at settle: the phase goes back to
	// normal, not to the strong the session used to hold.
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

test("settles back to normal twice without drifting", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-review-change`);

	phase.settle();
	phase.settle();

	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);

	// A later strong step still works after the extra settles.
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

test("keeps the phase on steer and follow-up input", () => {
	const phase = phaseWithCommands(REVIEW_COMMANDS);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);

	phase.handleInput("stop and use the change review skill instead", "steer");
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	phase.handleInput("and then check the footer", "followUp");
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

// The step record is what a reload reads back, so every change reaches the hook exactly once, and a
// spec "managed-commands / 中止すれば入力前に戻る": a stopped input takes the phase back with it, and the
// record has to land where the phase did — the record is what a reload, a resume, and a branch move read,
// so a restore that lived only in memory would put the stopped step back on the next reload.
test("undoing an input puts the step that was running back and records it", () => {
	const seen: (string | null)[] = [];
	const phase = phaseWithCommands(["skill:openspec-apply-change", "skill:openspec-propose"], { onStepChange: (step) => seen.push(step) });
	phase.handleInput("/skill:openspec-apply-change x");

	phase.handleInput("/skill:openspec-propose x");
	expect(phase.step()?.name).toBe("opsx-propose");
	expect(phase.stepStartedByInput()).toBe(true);

	phase.undoInput(phase.undoToken());

	expect(phase.step()?.name).toBe("opsx-apply");
	expect(phase.stepStartedByInput()).toBe(false);
	// The newest record names the step the input found, which is the state the session is back in.
	expect(seen).toEqual(["opsx-apply", "opsx-propose", "opsx-apply"]);
});

test("undoing the input that opened the first step leaves no step and records none", () => {
	const seen: (string | null)[] = [];
	const phase = phaseWithCommands(["skill:openspec-propose"], { onStepChange: (step) => seen.push(step) });

	phase.handleInput("/skill:openspec-propose x");
	phase.undoInput(phase.undoToken());

	expect(phase.step()).toBeUndefined();
	expect(seen).toEqual(["opsx-propose", null]);
});

// An input that opened nothing has nothing to take back. Writing a record for it would tell a reload that a
// step had ended, in a session that never ran one.
test("undoing an input that opened no step writes nothing and asks nothing", () => {
	const seen: (string | null)[] = [];
	const phase = phaseWithCommands(["skill:openspec-propose"], { onStepChange: (step) => seen.push(step) });

	phase.handleInput("keep going");
	expect(phase.stepStartedByInput()).toBe(false);
	phase.undoInput(phase.undoToken());

	expect(phase.step()).toBeUndefined();
	expect(seen).toEqual([]);
});

// The confirmation asks once per start, so it reads the flag rather than comparing step names: an input that
// joined a run already going names the same step it found.
test("an input that joins a run already going starts nothing", () => {
	const phase = phaseWithCommands(["skill:openspec-propose"]);
	phase.handleInput("/skill:openspec-propose x");

	phase.handleInput("keep going", "steer");

	expect(phase.stepStartedByInput()).toBe(false);
	// The steer arms nothing of its own, and the idle input's rollback is gone with the input it belonged to.
	expect(phase.undoToken()).toBeUndefined();
	phase.undoInput(undefined);
	expect(phase.step()?.name).toBe("opsx-propose");
});

// spec `managed-commands` / 中止すれば入力前に戻る, design Decision 7: the rollback belongs to one input, and
// only to the state that input left. Anything that moves the phase or the branch while the confirmation is
// open is a change the ask has no claim on, and taking it back would rewrite that other input's session.
test("a rollback only reaches the input it was armed for", () => {
	const seen: (string | null)[] = [];
	const phase = phaseWithCommands(["skill:openspec-propose", "skill:openspec-apply-change"], {
		onStepChange: (step) => seen.push(step),
	});
	phase.handleInput("/skill:openspec-propose x");
	const first = phase.undoToken();

	// A second input starts a step of its own — the case of an extension sending a line while a person has
	// the dialog open. Its token is the live one, and the first input's rollback is spent.
	phase.handleInput("/skill:openspec-apply-change y");
	expect(phase.step()?.name).toBe("opsx-apply");

	phase.undoInput(first);

	expect(phase.step()?.name).toBe("opsx-apply");
	// Nothing was written, because nothing was moved.
	expect(seen).toEqual(["opsx-propose", "opsx-apply"]);

	// A branch move is the other change a waiting confirmation cannot undo: the phase is now what the
	// destination's record says, and the generation moved with it, so the step the input found does not come
	// back and the destination keeps what it was moved to.
	phase.handleInput("/skill:openspec-propose x");
	const token = phase.undoToken();
	phase.followStepRecord(undefined);
	phase.undoInput(token);
	expect(phase.step()).toBeUndefined();
	expect(seen).toEqual(["opsx-propose", "opsx-apply", "opsx-propose"]);
});

// host that refuses the write loses the record and nothing else.
test("reports every step change to the hook, and a throwing hook is contained", () => {
	const seen: (string | null)[] = [];
	const phase = phaseWithCommands(["skill:openspec-apply-change", "skill:openspec-propose"], {
		onStepChange: (step) => seen.push(step),
	});
	phase.handleInput("/skill:openspec-apply-change x");
	phase.handleInput("/skill:openspec-propose x");
	phase.endStep();
	expect(seen).toEqual(["opsx-apply", "opsx-propose", null]);

	const broken = phaseWithCommands(["skill:openspec-apply-change"], {
		onStepChange: () => {
			throw new Error("the session file is closed");
		},
	});
	broken.handleInput("/skill:openspec-apply-change x");
	expect(broken.step()?.name).toBe("opsx-apply");
});
