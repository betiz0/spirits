/**
 * Registration, phase, and routing seen together: the route definition the extension registered is
 * driven through input, request, settle, request, the way one skill run goes.
 */

import { expect, test } from "bun:test";
import type { ModelRoute } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import {
	asExtensionApi,
	fakeContext,
	fakeModel,
	fakeProjection,
	fakeSessionManager,
	messageEntry,
	nextEntryId,
	slashCommandInfo,
	userMessage,
} from "./host/fake-pi.ts";
import {
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	ROLE_MODEL_STATUS_KEY,
	ROLE_STATUS_KEY,
	SKILL_COMMAND_PREFIX,
	STEP_ENTRY_TYPE,
} from "../src/constants.ts";
import { readRoutingSettings } from "../src/config.ts";
import spiritsExtension from "../src/index.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { resolveRequestRole } from "../src/routing/plan.ts";
import { registerDualModelRouting, type RoutedRequest } from "../src/routing/register.ts";
import { registerReportedRouting } from "./routing/fake-pi.ts";
import {
	AUTO_SELECTION,
	fakeCatalog,
	fakeCommandContext,
	FakePi,
	makeUserEntry,
	type FakeSelectBehavior,
	makeCustomEntry,
	makeInputEvent,
	makeModelSelectEvent,
	makeRequest,
	makeSettledEvent,
} from "./routing/fake-pi.ts";

const SONNET: PiModel = fakeModel("anthropic", "claude-sonnet-4-5");
const OPUS: PiModel = fakeModel("anthropic", "claude-opus-4-7");
const GPT: PiModel = fakeModel("openai", "gpt-5-mini");

function harness() {
	const pi = new FakePi();
	// The skills these runs start with, as pi would report them.
	pi.slashCommands = [
		slashCommandInfo("skill:sprt-opsx-verify-deep", "skill"),
		slashCommandInfo("skill:sprt-opsx-review-change", "skill"),
	];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	// The two layers `src/index.ts` joins, so a test can lock the role the way `/spirits-role <role>`
	// does without writing a settings file. The badge is the command surface's own: the routing reports the
	// roles for the test to read, and draws nothing.
	const routing = registerReportedRouting(asExtensionApi(pi));
	registerManagedCommands(asExtensionApi(pi), { phase: routing.phase, lastRequest: () => undefined, patchSettings: () => {} });
	const { ctx, notices } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"] });
	const decision = () => {
		const route = pi.route()(makeRequest(), ctx) as { model: PiModel };
		return `${routing.lastRole()}:${route.model.id}`;
	};
	return { pi, ctx, notices, decision, lock: routing.phase.setRole };
}

test("runs normal, then strong during the skill, then normal after settle", async () => {
	const { pi, ctx, notices, decision } = harness();

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	// Every request of the run, including the tool continuations, stays strong.
	decisions.push(decision(), decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"normal:claude-sonnet-4-5",
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});

// spec "managed-commands / badge は状態の射影を決められた時点で描き直す": the line is the next request's
// resolution, drawn where the state changes. A request is not one of those points, and answering is not
// what puts a role on the line any more.
test("the badge shows the role the next request takes, before it is sent", async () => {
	const pi = new FakePi();
	pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	spiritsExtension(asExtensionApi(pi));
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	// A session that has had none of the named points has no line yet: there is nothing remembered to show.
	expect(statuses.get(ROLE_STATUS_KEY)).toBeUndefined();

	// The input that opens the step is one of those points, and it is enough on its own: the strong the run
	// is about to take, and the model that will answer, are both on the line before any request is made.
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-dual-model-routing`), ctx);
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-opus-4-7");
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: OPUS });

	// The end of the run is one of the points too, and this step ends with its run: the line comes back to the
	// lock as the phase does rather than waiting for another input (spec: ステップの終了時).
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-sonnet-4-5");
	await pi.fire("input", makeInputEvent("anything else"), ctx);
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
});

// spec scenario "settle した非継続ステップの badge はロックへ戻る": the line is a picture of the phase, and a
// step that does not continue leaves the phase when its run settles. Left undrawn, the footer would go on
// naming the step's role while the next request went to the lock — the same two stories this surface exists
// to prevent, arriving from the other end.
test("a settled step that does not continue moves the line back to the lock", async () => {
	const pi = new FakePi();
	pi.slashCommands = [slashCommandInfo("skill:sprt-opsx-verify-deep", "skill")];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7" },
	};
	spiritsExtension(asExtensionApi(pi));
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep improve-x`), ctx);
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);

	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-sonnet-4-5");
	// The route agrees without an input in between, because the line and the request read one phase.
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
});

// The same event on a step that continues draws the step's role again: settle closes a run, not a step, and a
// line that reset on every settle would lie about the continuing case.
test("a settled step that continues keeps its role on the line", async () => {
	const pi = new FakePi();
	pi.slashCommands = [slashCommandInfo("opsx-propose", "prompt")];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7", steps: { "opsx-propose": { role: "strong" } } },
	};
	const routing = registerReportedRouting(asExtensionApi(pi));
	registerManagedCommands(asExtensionApi(pi), { phase: routing.phase, patchSettings: () => {} });
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	await pi.fire("input", makeInputEvent("/opsx-propose improve-x"), ctx);
	await pi.fire("agent_settled", makeSettledEvent(), ctx);

	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-opus-4-7");
});

// --- the confirmation before a step starts on a physical model ---------------------------------

/**
 * The two layers again, with the confirmation's clocks shrunk to tens of milliseconds.
 *
 * The boundary the confirmation has to get right is between the wait running out and the user closing the
 * dialog, and both come back as nothing chosen; the only way to test that boundary at all is a wait short
 * enough to land on either side of it. The production wait is pinned in `constants-steps.test.ts`.
 */
function confirmHarness(options: { settings?: Record<string, unknown>; select?: FakeSelectBehavior; mode?: "tui" | "rpc" } = {}) {
	const pi = new FakePi();
	pi.slashCommands = [
		slashCommandInfo("opsx-propose", "skill"),
		slashCommandInfo("opsx-explore", "skill"),
		slashCommandInfo("skill:sprt-opsx-verify-deep", "skill"),
	];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		models: { strong: "anthropic/claude-opus-4-7", steps: { "opsx-explore": { role: "strong" } } },
		...(options.settings ?? {}),
	};
	const routing = registerReportedRouting(asExtensionApi(pi));
	registerManagedCommands(asExtensionApi(pi), {
		phase: routing.phase,
		patchSettings: () => {},
		stepConfirmClock: { timeoutMs: 60, slackMs: 20 },
	});
	// A physical model, which is the state the confirmation exists for.
	const session = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: SONNET,
		mode: options.mode ?? "tui",
		...(options.select === undefined ? {} : { select: options.select }),
	});
	return { pi, phase: routing.phase, ...session };
}

/** Send one idle line from the terminal and report what the handlers made of it. */
async function send(pi: FakePi, ctx: ExtensionContext, text: string, source: "interactive" | "rpc" | "extension" = "interactive") {
	const results = await pi.fire("input", makeInputEvent(text, undefined, source), ctx);
	return { stopped: results.some((result) => (result as { action?: string })?.action === "handled") };
}

// spec scenario "strong 設定のステップは確認してから進む": the ask names the role that will not be used and
// the way to put it back in force, and the two answers are there to be chosen.
test("a step set to strong is asked about first, with the way back in the body", async () => {
	const { pi, phase, ctx, selects } = confirmHarness({ select: { value: "continue" } });

	const { stopped } = await send(pi, ctx, "/opsx-explore improve-spirits-role-routing-visibility");

	expect(selects).toHaveLength(1);
	expect(selects?.[0].title).toContain("opsx-explore");
	expect(selects?.[0].title).toContain("strong");
	expect(selects?.[0].title).toContain("select spirits/auto with /model");
	expect(selects?.[0].options).toEqual(["continue", "cancel"]);
	// The wait the dialog is given, and the signal that lets this surface close it on its own timer.
	expect(selects?.[0].timeout).toBe(60);
	expect(selects?.[0].signal).toBeInstanceOf(AbortSignal);
	// Continued, so the step is running and the input went out.
	expect(phase.step()?.name).toBe("opsx-explore");
	expect(stopped).toBe(false);
});

// spec scenario "既定ロールのあるステップでも確認する": the step carries no setting of its own, and the role
// it expects comes from the step list.
test("a step with a step-list default is asked about too", async () => {
	const { pi, ctx, selects } = confirmHarness({ select: { value: "continue" } });

	await send(pi, ctx, `${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep improve-spirits-role-routing-visibility`);

	expect(selects).toHaveLength(1);
	expect(selects?.[0].title).toContain("sprt-opsx-verify-deep");
});

// spec scenario "期待されるロールの無いステップでは確認しない": a step that follows the lock asks nothing of
// the routing, so stopping it would stop the user over a setting they never set.
test("a step with nothing set is not asked about", async () => {
	const { pi, phase, ctx, selects } = confirmHarness({ select: { value: "cancel" } });

	const { stopped } = await send(pi, ctx, "/opsx-propose improve-spirits-role-routing-visibility");

	expect(selects).toHaveLength(0);
	expect(phase.step()?.name).toBe("opsx-propose");
	expect(stopped).toBe(false);
});

// spec scenario "開始のたびに確認する": continuing an already running step asks nothing, and every new start
// asks again — the confirmation is about a start, not about a session.
test("every step start asks again", async () => {
	const { pi, ctx, selects } = confirmHarness({
		select: { value: "continue" },
		settings: { models: { strong: "anthropic/claude-opus-4-7", steps: { "opsx-explore": { role: "strong" }, "opsx-propose": { thinking: "high" } } } },
	});

	await send(pi, ctx, "/opsx-explore one");
	// An idle line inside the step is not a start, and neither is a steer.
	await send(pi, ctx, "keep going");
	await send(pi, ctx, "/opsx-propose two");

	expect(selects).toHaveLength(2);
});

// spec scenarios "振り分けが有効なら確認しない", "対話端末でなければ確認しない", and "拡張機能が送った入力では
// 確認しない": the three states where nobody at a terminal is being surprised, asked of one harness.
test("no ask on a routed session, off a terminal, or from another extension", async () => {
	const routed = confirmHarness({ select: { value: "cancel" } });
	const onRouting = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: AUTO_SELECTION,
		select: { value: "cancel" },
	});
	await send(routed.pi, onRouting.ctx, "/opsx-explore one");
	expect(onRouting.selects).toHaveLength(0);
	expect(routed.phase.step()?.name).toBe("opsx-explore");

	const headless = confirmHarness({ mode: "rpc", select: { value: "cancel" } });
	const rpc = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: SONNET, mode: "rpc", select: { value: "cancel" } });
	await send(headless.pi, rpc.ctx, "/opsx-explore two");
	expect(rpc.selects).toHaveLength(0);
	expect(headless.phase.step()?.name).toBe("opsx-explore");

	const fromExtension = confirmHarness({ select: { value: "cancel" } });
	const { stopped } = await send(fromExtension.pi, fromExtension.ctx, "/opsx-explore three", "extension");
	expect(fromExtension.selects).toHaveLength(0);
	expect(fromExtension.phase.step()?.name).toBe("opsx-explore");
	expect(stopped).toBe(false);
});

// spec "ステップ開始時の確認は時間切れで進み、中止で入力前に戻す": the four ways the dialog closes, told apart
// by the two clocks, and what each one does to the input.
test("the wait running out lets the input through", async () => {
	// The host closes the dialog when the abort lands, which is after this surface's own timer, so the lack
	// of a choice is the wait running out.
	const { pi, phase, ctx, selects } = confirmHarness({ select: { abortAsCancel: true } });

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(selects).toHaveLength(1);
	expect(stopped).toBe(false);
	expect(phase.step()?.name).toBe("opsx-explore");
});

test("choosing to run it lets the input through", async () => {
	const { pi, phase, ctx } = confirmHarness({ select: { value: "continue" } });

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(stopped).toBe(false);
	expect(phase.step()?.name).toBe("opsx-explore");
});

// spec scenario "中止すれば入力前に戻る": the step the input opened is taken back, recorded so a reload reads
// the same phase, and the input is never sent.
test("choosing to stop it puts the step back where the input found it", async () => {
	const { pi, phase, ctx } = confirmHarness({ select: { value: "continue" } });
	await send(pi, ctx, "/opsx-propose first");
	expect(phase.step()?.name).toBe("opsx-propose");

	const stoppedRun = fakeCatalog({
		available: [SONNET, OPUS],
		authedProviders: ["anthropic"],
		model: SONNET,
		select: { value: "cancel" },
	});
	const { stopped } = await send(pi, stoppedRun.ctx, "/opsx-explore second");

	expect(stopped).toBe(true);
	expect(phase.step()?.name).toBe("opsx-propose");
	// The records carry it too: the undo writes the state it returned to, which is what a reload, a resume,
	// and a branch move read.
	expect(stepRecords(pi)).toEqual(["opsx-propose", "opsx-explore", "opsx-propose"]);

	// …and a *fresh* runtime wired from those records reads the same phase back. The same phase in memory
	// cannot show a restore: it never lost the step.
	const reopened = confirmHarness();
	await reopened.pi.fire(
		"session_start",
		{ type: "session_start", reason: "reload" },
		fakeCommandContext({
			available: [SONNET, OPUS],
			authedProviders: ["anthropic"],
			model: SONNET,
			branch: pi.entries.map((entry) => makeCustomEntry(entry.customType, entry.data)),
		}).ctx,
	);
	expect(reopened.phase.step()?.name).toBe("opsx-propose");
});

/** The step records a fake host was asked to append, oldest first. */
function stepRecords(pi: FakePi): (string | null)[] {
	return pi.entries
		.filter((entry) => entry.customType === STEP_ENTRY_TYPE)
		.map((entry) => (entry.data as { step: string | null }).step);
}

// spec `managed-commands` / 中止すれば入力前に戻る, design Decision 7: the rollback belongs to the input that
// was asked about. The host awaits one input handler at a time, but the wait is on a person, and a person
// with a dialog open can have another extension send a line meanwhile. Stopping the first input must not take
// the second one's step back with it.
test("a cancel does not take back a step another input started while the ask was open", async () => {
	const acts: { run?: () => Promise<void> } = {};
	const { pi, phase, ctx } = confirmHarness({ select: { value: "cancel", during: () => acts.run?.() } });
	const meanwhile = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: SONNET });
	acts.run = async () => {
		await send(pi, meanwhile.ctx, "/opsx-propose meanwhile", "extension");
	};

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	// The line the person stopped is still not sent…
	expect(stopped).toBe(true);
	// …and the step the extension started stays started, with no record written over it.
	expect(phase.step()?.name).toBe("opsx-propose");
	expect(stepRecords(pi)).toEqual(["opsx-explore", "opsx-propose"]);
});

// The other change a waiting confirmation must keep its hands off: `/tree` lands the runtime on another
// branch, whose records say what runs there. A rollback of the stopped input would put the old branch's step
// onto the branch the user moved to.
test("a cancel does not rewrite the branch a move landed on", async () => {
	const acts: { run?: () => Promise<void> } = {};
	const { pi, phase, ctx } = confirmHarness({ select: { value: "cancel", during: () => acts.run?.() } });
	acts.run = async () => {
		await pi.fire(
			"session_tree",
			{ type: "session_tree", newLeafId: "leaf-2", oldLeafId: "leaf-1", fromExtension: false },
			fakeCatalog({
				available: [SONNET, OPUS],
				authedProviders: ["anthropic"],
				model: SONNET,
				branch: [makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-propose" })],
			}).ctx,
		);
	};

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(stopped).toBe(true);
	// The move's step survives the cancel, and the move — like every move — wrote no record of its own.
	expect(phase.step()?.name).toBe("opsx-propose");
	expect(stepRecords(pi)).toEqual(["opsx-explore"]);
});

test("closing the dialog with Esc before the wait is over stops the input", async () => {
	// Well before the 40ms own timer, so the lack of a choice can only be a key.
	const { pi, phase, ctx } = confirmHarness({ select: { escAfterMs: 5 } });

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(stopped).toBe(true);
	expect(phase.step()).toBeUndefined();
});

test("closing the dialog just after the own timer is the wait running out", async () => {
	// A hair past the 60 - 20 ms timer: the dialog cannot say which it was, and the timer is the record.
	const { pi, phase, ctx } = confirmHarness({ select: { escAfterMs: 55 } });

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(stopped).toBe(false);
	expect(phase.step()?.name).toBe("opsx-explore");
});

// spec scenario "確認を出せなければ待たずに進む": a host that cannot show the dialog does not get to hold the
// user's input hostage, and nothing of the session changes.
test("a host that refuses the dialog lets the input through", async () => {
	const { pi, phase, ctx, selects } = confirmHarness({ select: { error: "no selector here" } });

	const { stopped } = await send(pi, ctx, "/opsx-explore one");

	expect(selects).toHaveLength(1);
	expect(stopped).toBe(false);
	expect(phase.step()?.name).toBe("opsx-explore");
	expect(pi.errors).toEqual([]);
});

// spec scenario "解決が変われば次の入力で badge が従う": the resolution is read at the draw, so a target
// that stopped being usable — a provider whose credentials went away, which fires no event at all — shows on
// the next input instead of on the next failed request.
test("an input redraws the badge when the resolution changed under it", async () => {
	const pi = new FakePi();
	// The session is locked strong, which is the case where the answer can change under the line: the lock
	// holds while the target stops being reachable.
	pi.settings = { defaultProvider: "openai", defaultModel: "gpt-5-mini", models: { role: "strong", strong: "anthropic/claude-opus-4-7" } };
	spiritsExtension(asExtensionApi(pi));

	const both = fakeCatalog({ available: [SONNET, OPUS, GPT], authedProviders: ["anthropic", "openai"], model: AUTO_SELECTION });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, both.ctx);
	expect(both.statuses.get(ROLE_STATUS_KEY)).toBe("[strong]");
	expect(both.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-opus-4-7");

	// The strong provider's credentials are gone. Nothing fires for that, and the next input reads it.
	const gone = fakeCatalog({ available: [SONNET, OPUS, GPT], authedProviders: ["openai"], model: AUTO_SELECTION });
	await pi.fire("input", makeInputEvent("keep going"), gone.ctx);
	expect(gone.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(gone.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("gpt-5-mini");
});

// spec scenario "手で編集した設定は再読み込みから badge に効く": the host hands an extension the settings it
// read at load, so a file another process rewrote reaches the line through a reload and not through an
// input. That is the boundary of the design, written down rather than papered over.
test("a hand-edited settings file reaches the badge through a reload", async () => {
	const pi = new FakePi();
	// The file a second process edits, and the settings this runtime read when it was loaded.
	const file: Record<string, unknown> = {
		defaultProvider: "openai",
		defaultModel: "gpt-5-mini",
		models: { role: "strong", strong: "anthropic/claude-opus-4-7" },
	};
	let loaded = structuredClone(file);
	pi.getSettings = () => loaded;
	spiritsExtension(asExtensionApi(pi));

	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS, GPT], authedProviders: ["anthropic", "openai"], model: AUTO_SELECTION });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
	await pi.fire("input", makeInputEvent("first"), ctx);
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-opus-4-7");

	// The file now points strong somewhere else. The read still serves what the runtime loaded, and so does
	// the line drawn from it.
	(file.models as Record<string, unknown>).strong = "openai/gpt-5-mini";
	await pi.fire("input", makeInputEvent("second"), ctx);
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-opus-4-7");

	// A reload reads the file again, and the next draw follows the edited setting.
	loaded = structuredClone(file);
	spiritsExtension(asExtensionApi(pi));
	await pi.fire("input", makeInputEvent("third"), ctx);
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("gpt-5-mini");
});

// spec scenario "ロールが先、応答モデルが後": the footer sorts the extension statuses by key, so the two
// lines read as one sentence about the next request, and the order is a fact the test has to hold.
test("the role line comes first and the answering model after it", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };
	spiritsExtension(asExtensionApi(pi));
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	await pi.fire("session_start", { type: "session_start", reason: "startup" }, ctx);

	expect([...statuses.keys()]).toEqual([ROLE_STATUS_KEY, ROLE_MODEL_STATUS_KEY]);
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-sonnet-4-5");
});

// spec scenario "strong が落ちれば応答モデルも従う": a step set to a strong that cannot answer is described
// by what does answer, on both lines, because both come out of the same resolution.
test("a strong that falls back moves the role line and the model line together", async () => {
	const pi = new FakePi();
	// The starter has to come from something pi would expand: an `extension` source is handled before pi fires
	// `input`, so no step opens and every assertion below would hold for a session that never started one.
	pi.slashCommands = [slashCommandInfo("opsx-propose", "prompt")];
	pi.settings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5",
		// strong is set to a model no provider here has, so a strong request answers on normal.
		models: { strong: "nowhere/nothing", steps: { "opsx-propose": { role: "strong" } } },
	};
	const routing = registerReportedRouting(asExtensionApi(pi));
	registerManagedCommands(asExtensionApi(pi), { phase: routing.phase, patchSettings: () => {} });
	const { ctx, statuses } = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });

	await pi.fire("input", makeInputEvent("/opsx-propose improve-spirits-role-routing-visibility"), ctx);

	// The step really opened, and it really asked for strong: without this the two lines below would agree
	// with each other while describing a session that was never in strong at all.
	const step = routing.phase.step();
	if (!step) throw new Error("the /opsx-propose step did not start");
	expect(resolveRequestRole(step, readRoutingSettings(pi.settings), routing.phase.current())).toBe(MODEL_ROLE_STRONG);

	// Both lines carry the answer, not the wish: normal, on normal's model.
	expect(statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-sonnet-4-5");
	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
});

// spec scenarios "振り分けが無効なら応答モデルは出さない" and "応答するロールが無ければ応答モデルは出さない",
// with the way back: switching to the routing model brings the model line back rather than leaving a hole.
test("the model line is absent when nothing answers and comes back with the routing", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };
	spiritsExtension(asExtensionApi(pi));

	const physical = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: SONNET });
	await pi.fire("session_start", { type: "session_start", reason: "startup" }, physical.ctx);
	expect(physical.statuses.get(ROLE_STATUS_KEY)).toBe("[off]");
	expect(physical.statuses.get(ROLE_MODEL_STATUS_KEY)).toBeUndefined();

	// The same session, now on the routing model: the host fires `model_select` with a context that already
	// carries the new selection, and both lines come back.
	const routedAgain = fakeCatalog({ available: [SONNET, OPUS], authedProviders: ["anthropic"], model: AUTO_SELECTION });
	await pi.fire("model_select", makeModelSelectEvent(AUTO_SELECTION, SONNET), routedAgain.ctx);
	expect(routedAgain.statuses.get(ROLE_STATUS_KEY)).toBe("[normal]");
	expect(routedAgain.statuses.get(ROLE_MODEL_STATUS_KEY)).toBe("claude-sonnet-4-5");

	// And nothing resolves at all: `[!]` is the whole line, because naming a model would name none.
	const none = new FakePi();
	spiritsExtension(asExtensionApi(none));
	const stuck = fakeCatalog({ available: [], model: AUTO_SELECTION });
	await none.fire("session_start", { type: "session_start", reason: "startup" }, stuck.ctx);
	expect(stuck.statuses.get(ROLE_STATUS_KEY)).toBe("[!]");
	expect(stuck.statuses.get(ROLE_MODEL_STATUS_KEY)).toBeUndefined();
});

// spec "dual-model-routing / strong フェーズからの復帰": ロックしたロールへ戻る
test("keeps the locked role across a target skill run", async () => {
	const { pi, ctx, decision, lock } = harness();
	lock(MODEL_ROLE_STRONG);

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`), ctx);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	// Settle returns to the lock, not to normal.
	decisions.push(decision());

	expect(decisions).toEqual([
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
		"strong:claude-opus-4-7",
	]);
});

// spec "dual-model-routing / /model によるロールのロック": run の実行中に指定したロールは直ちに効く
test("applies a role locked during a target skill run to the rest of that run", async () => {
	const { pi, ctx, notices, decision, lock } = harness();

	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep add-model-role-setting`), ctx);
	const decisions = [decision()];
	// `/spirits-role normal` while the run is in flight: the lock and the role of the run change together
	// (design Decision 2).
	lock(MODEL_ROLE_NORMAL);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"strong:claude-opus-4-7",
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});

// spec "dual-model-routing / strong フェーズの開始": ロック中の入力はロックを解除しない
test("keeps the locked role across a plain input run", async () => {
	const { pi, ctx, decision, lock } = harness();
	lock(MODEL_ROLE_STRONG);

	await pi.fire("input", makeInputEvent("check the footer badge"), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	expect(decision()).toBe("strong:claude-opus-4-7");

	// `/spirits-role normal` is the way out.
	lock(MODEL_ROLE_NORMAL);
	expect(decision()).toBe("normal:claude-sonnet-4-5");
});

test("keeps normal across a non-target skill run", async () => {
	const { pi, ctx, notices, decision } = harness();

	const decisions = [decision()];
	await pi.fire("input", makeInputEvent(`${SKILL_COMMAND_PREFIX}sprt-architecture-guards`), ctx);
	decisions.push(decision());
	await pi.fire("agent_settled", makeSettledEvent(), ctx);
	decisions.push(decision());

	expect(decisions).toEqual([
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
		"normal:claude-sonnet-4-5",
	]);
	expect(notices).toEqual([]);
});

// spec "dual-model-routing / 先行圧縮の要約先の解決": the gate's summary resolution must not move
// the role phase or the `status` report, and a `direct` request the gate did not start must keep
// reporting as it always has (fit-gate change task 3.3).
const FIT_SMALL: PiModel = fakeModel("fake", "small", { contextWindow: 32000 });
const FIT_BIG: PiModel = fakeModel("fake", "big", { contextWindow: 128000 });

function fitGateStatusHarness() {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "fake", defaultModel: "small" };
	const requests: RoutedRequest[] = [];
	registerDualModelRouting(asExtensionApi(pi), { onRequest: (request) => requests.push(request) });
	// A conversation past the small target's threshold, so an idle input starts the ahead compaction.
	const conversation = userMessage("x".repeat(20000 * 4));
	const { ctx } = fakeCatalog({
		available: [FIT_SMALL, FIT_BIG],
		authedProviders: ["fake"],
		model: AUTO_SELECTION,
		branch: [messageEntry(conversation, nextEntryId())],
	});
	const compactions: Array<{ onComplete?: (result: unknown) => void }> = [];
	const gateCtx = fakeContext({
		...ctx,
		compact: (call: { onComplete?: (result: unknown) => void }) => {
			compactions.push(call);
		},
		// `fakeCatalog`'s projection carries entries only; the gate measures the projection's messages.
		sessionManager: fakeSessionManager({
			getBranch: () => [...ctx.sessionManager.getBranch()],
			buildSessionProjection: () => fakeProjection({ messages: [conversation] }),
		}),
	});
	return { pi, ctx, gateCtx, requests, compactions };
}

test("a gate summary leaves the reported last request alone", async () => {
	const { pi, gateCtx, requests, compactions } = fitGateStatusHarness();

	// An idle input over the threshold puts the gate's ahead compaction in flight.
	const firing = pi.fire("input", makeInputEvent("back to work"), gateCtx);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(compactions.length).toBe(1);

	// The compaction's summarization request resolves on the model that held the conversation and
	// reports nothing: no role for the badge, no last request for `status`.
	const summary = pi.route()(
		makeRequest({ reason: "direct", messages: [userMessage("x".repeat(100000 * 4))], previous: { model: FIT_BIG } }),
		gateCtx,
	) as ModelRoute;
	expect(summary.model.id).toBe("big");
	expect(requests).toEqual([]);

	compactions[0]?.onComplete?.({ summary: "s", firstKeptEntryId: "k", tokensBefore: 0 });
	await firing;
});

test("a branch summary keeps reporting as before", async () => {
	const { pi, ctx, requests } = fitGateStatusHarness();

	// No gate compaction is in flight: this `direct` request is a branch summary or an extension call,
	// and it resolves and reports exactly as it did before the gate existed.
	const summary = pi.route()(makeRequest({ reason: "direct", messages: [userMessage("summarize the branch")] }), ctx) as ModelRoute;

	expect(summary.model.id).toBe("small");
	expect(requests.length).toBe(1);
	expect(requests[0]?.model).toBe("fake/small");
});
