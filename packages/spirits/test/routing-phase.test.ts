import { expect, test } from "bun:test";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";

test("enters strong for the change review skill command", () => {
	const phase = createRoutingPhase();

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-review-change add-dual-model-routing`);

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("enters strong for the deep verify skill command", () => {
	const phase = createRoutingPhase();

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("ignores other skill commands and plain input", () => {
	const phase = createRoutingPhase();

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

// spec "dual-model-routing / strong フェーズの開始": 展開されないスキルコマンドでは遷移しない
test("ends the skill name at the first space like pi", () => {
	const phase = createRoutingPhase();

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

// spec "dual-model-routing / strong フェーズの開始": run が始まらなかった strong を次の run へ持ち越さない
	test("returns to normal on the next idle input when no run settled", () => {
		const phase = createRoutingPhase();
		phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`);
		expect(phase.current()).toBe(MODEL_ROLE_STRONG);

		// The skill run never started (a credential error, or another extension handling the input),
		// so no `agent_settled` comes back. The next idle input decides the phase again.
		phase.handleInput("/opsx-apply add-dual-model-routing");

		expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
	});

	test("keeps the phase on steer and follow-up input", () => {
		const phase = createRoutingPhase();
		phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);

		phase.handleInput("stop and use the change review skill instead", "steer");
		expect(phase.current()).toBe(MODEL_ROLE_STRONG);

		phase.handleInput("and then check the footer", "followUp");
		expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	});

	test("returns to normal on settle regardless of abort", () => {
	const phase = createRoutingPhase();
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	// `agent_settled` carries `aborted` but the phase ignores it: an aborted run settles the same way,
	// which is what makes the handler a finally for the run.
	phase.settle();

	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

// spec "dual-model-routing / strong フェーズの開始": ロック中の入力はロックを解除しない
test("keeps the locked role on idle input that is not a target skill", () => {
	const phase = createRoutingPhase();
	phase.setRole(MODEL_ROLE_STRONG);

	for (const text of ["plain prompt", `${SKILL_COMMAND_PREFIX}sprt-architecture-guards`, "/opsx-apply x"]) {
		phase.handleInput(text);
		expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	}
});

// spec "dual-model-routing / strong フェーズの開始": 対象スキルはロック中でも strong へ遷移する
test("enters strong for a target skill while locked on strong", () => {
	const phase = createRoutingPhase();
	phase.setRole(MODEL_ROLE_STRONG);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`);

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

// spec "dual-model-routing / strong フェーズからの復帰": ロックしたロールへ戻る
test("settles back to the locked role", () => {
	const phase = createRoutingPhase();
	phase.setRole(MODEL_ROLE_STRONG);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	phase.settle();

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
});

test("a lock set to normal releases a strong lock", () => {
	const phase = createRoutingPhase();
	phase.setRole(MODEL_ROLE_STRONG);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);

	// `/model <model> normal` is the way out of a strong lock.
	phase.setRole(MODEL_ROLE_NORMAL);
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});

test("settles back to normal twice without drifting", () => {
	const phase = createRoutingPhase();
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-review-change`);

	phase.settle();
	phase.settle();

	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);

	// A later strong phase still works after the extra settles.
	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep`);
	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	phase.settle();
	expect(phase.current()).toBe(MODEL_ROLE_NORMAL);
});
