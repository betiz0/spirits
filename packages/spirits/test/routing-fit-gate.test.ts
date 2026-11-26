/**
 * The context fit gate on the idle `input` handler (fit-gate change, tasks 4.1–4.10).
 *
 * The harness registers only the routing layer onto a `FakePi` and drives the `input` chain the way
 * the host does — handlers in registration order, stopping at the first `handled` — so the guard's
 * position relative to the phase handler is a measured fact, not an assumption. The compaction is
 * the fake's: a test pulls its `onComplete` / `onError` when it wants the gate's wait to end, and
 * `setMessages` stands for the projection the host rebuilds around a compaction entry.
 */

import { expect, test } from "bun:test";
import type { ExtensionContext, SessionEntry, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, PiModel } from "../src/types/host.ts";
import {
	asExtensionApi,
	customEntry,
	fakeContext,
	fakeModel,
	fakeModelRegistry,
	fakeProjection,
	fakeSessionManager,
	fakeUi,
	messageEntry,
	nextEntryId,
	slashCommandInfo,
	userMessage,
} from "./host/fake-pi.ts";
import { STEP_ENTRY_TYPE } from "../src/constants.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { spiritsStepEntry } from "../src/routing/phase.ts";
import { AUTO_SELECTION, FakePi, makeInputEvent } from "./routing/fake-pi.ts";

const SMALL: PiModel = fakeModel("fake", "small", { contextWindow: 32000 });
const BIG: PiModel = fakeModel("fake", "big", { contextWindow: 128000 });

/** A user message of exactly `tokens` tokens by pi's chars/4 estimate. */
function messageOfTokens(tokens: number): AgentMessage {
	return userMessage("x".repeat(tokens * 4));
}

// SMALL's threshold is 32000 - 16384 = 15616, so 20000 tokens of history is over by any reading.
const HUGE: AgentMessage[] = [messageOfTokens(20000)];

interface CompactCall {
	onComplete?: (result: unknown) => void;
	onError?: (error: Error) => void;
}

interface Harness {
	pi: FakePi;
	ctx: ExtensionContext;
	phase: ReturnType<typeof registerDualModelRouting>["phase"];
	compactions: CompactCall[];
	notifications: Array<{ message: string; type: string | undefined }>;
	editor: () => string;
	setMessages: (messages: AgentMessage[]) => void;
	emit: (
		text: string,
		options?: { source?: "interactive" | "rpc" | "extension"; streamingBehavior?: "steer" | "followUp" },
	) => Promise<{ action: string }>;
	flush: () => Promise<void>;
}

function gateHarness(
	options: {
		mode?: "tui" | "rpc" | "json" | "print";
		model?: PiModel;
		messages?: AgentMessage[];
		branch?: SessionEntry[];
		settings?: Record<string, unknown>;
		commands?: SlashCommandInfo[];
		notifyThrows?: boolean;
		/** Runs inside the fake `compact()` before it returns, standing for a synchronous host. */
		onCompact?: (call: CompactCall) => void;
	} = {},
): Harness {
	const pi = new FakePi();
	pi.settings = options.settings ?? { defaultProvider: "fake", defaultModel: "small" };
	pi.slashCommands = options.commands ?? [];
	const routing = registerDualModelRouting(asExtensionApi(pi));

	const compactions: CompactCall[] = [];
	const notifications: Array<{ message: string; type: string | undefined }> = [];
	let editor = "";
	let messages = [...(options.messages ?? [])];
	const ctx = fakeContext({
		mode: options.mode ?? "rpc",
		model: options.model ?? AUTO_SELECTION,
		ui: fakeUi({
			notify: (message: string, type?: "info" | "warning" | "error") => {
				if (options.notifyThrows) throw new Error("the host refused the notice");
				notifications.push({ message, type });
			},
			getEditorText: () => editor,
			setEditorText: (text: string) => {
				editor = text;
			},
		}),
		sessionManager: fakeSessionManager({
			getBranch: () => [...(options.branch ?? [])],
			buildSessionProjection: () => fakeProjection({ messages }),
		}),
		modelRegistry: fakeModelRegistry({
			getAvailable: () => [SMALL, BIG],
			find: (provider: string, modelId: string) =>
				[SMALL, BIG].find((model) => model.provider === provider && model.id === modelId),
			hasConfiguredAuth: () => true,
		}),
		compact: (call: CompactCall) => {
			compactions.push(call);
			options.onCompact?.(call);
		},
	});

	async function emit(
		text: string,
		emitOptions: { source?: "interactive" | "rpc" | "extension"; streamingBehavior?: "steer" | "followUp" } = {},
	): Promise<{ action: string }> {
		const event = makeInputEvent(text, emitOptions.streamingBehavior, emitOptions.source ?? "rpc");
		for (const handler of [...(pi.handlers.get("input") ?? [])]) {
			try {
				const result = (await handler(event, ctx)) as { action?: string } | undefined;
				// The host stops the chain at the first `handled`; nothing after it sees the input.
				if (result?.action === "handled") return { action: "handled" };
			} catch (error) {
				pi.errors.push(error);
			}
		}
		return { action: "continue" };
	}

	return {
		pi,
		ctx,
		phase: routing.phase,
		compactions,
		notifications,
		editor: () => editor,
		setMessages: (next) => {
			messages = [...next];
		},
		emit,
		flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
	};
}

/** Pull the wait's end on the compaction the gate started. */
function complete(h: Harness, index = 0): void {
	h.compactions[index].onComplete?.({ summary: "s", firstKeptEntryId: "k", tokensBefore: 0 });
}
function fail(h: Harness, message: string, index = 0): void {
	h.compactions[index].onError?.(new Error(message));
}

// ------------------------------------------------------------------
// 4.1 scope of the judgment
// ------------------------------------------------------------------

// spec "dual-model-routing / 判定を適用する入力と適用しない入力"
test("an input that starts no model request is out of scope", async () => {
	const h = gateHarness({ messages: HUGE, commands: [slashCommandInfo("spirits-role", "extension")] });

	expect((await h.emit("/spirits-role status")).action).toBe("continue");
	expect((await h.emit("   ")).action).toBe("continue");
	expect((await h.emit("!echo hi")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
});

test("a steering input is out of scope", async () => {
	const h = gateHarness({ messages: HUGE });

	const result = await h.emit("steer now", { streamingBehavior: "steer" });

	expect(result.action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications).toEqual([]);
});

test("an extension source input is out of scope", async () => {
	const h = gateHarness({ messages: HUGE });

	expect((await h.emit("from another extension", { source: "extension" })).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
});

test("a print mode input is out of scope", async () => {
	const h = gateHarness({ messages: HUGE, mode: "print" });

	expect((await h.emit("pipelined prompt")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications).toEqual([]);
});

test("a json mode input is out of scope", async () => {
	const h = gateHarness({ messages: HUGE, mode: "json" });

	expect((await h.emit("machine prompt")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
});

test("an rpc input is in scope", async () => {
	const h = gateHarness({ messages: HUGE, mode: "rpc" });

	const firing = h.emit("back to work");
	await h.flush();

	expect(h.compactions.length).toBe(1);
	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

// ------------------------------------------------------------------
// 4.2 compact, re-measure, decide
// ------------------------------------------------------------------

// spec scenario "圧縮後は送る" / "収まっている場合は圧縮しない"
test("a fitting conversation is sent after the compaction", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	expect(h.compactions.length).toBe(1);

	// The compaction entry lands and the rebuilt projection reads short again.
	h.setMessages([messageOfTokens(500)]);
	complete(h);

	expect((await firing).action).toBe("continue");
	expect(h.notifications).toEqual([]);
});

// spec scenario "圧縮後も枠を超える"
test("a conversation that still does not fit is not sent", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	complete(h);

	expect((await firing).action).toBe("handled");
	expect(h.notifications.length).toBe(1);
	expect(h.notifications[0]?.message).toContain("still past the threshold after compaction");
});

// spec scenario "圧縮の成立しなかったことを名指す"
test("a failed compaction does not send", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	fail(h, "provider exploded");

	expect((await firing).action).toBe("handled");
	expect(h.notifications[0]?.message).toContain("the ahead compaction did not complete");
	expect(h.notifications[0]?.message).toContain("provider exploded");
});

// spec requirement "自動 compaction の設定を打ち消さない"
test("auto compaction disabled compresses nothing and blocks with the same threshold", async () => {
	const h = gateHarness({ messages: HUGE, settings: { defaultProvider: "fake", defaultModel: "small", compaction: { enabled: false } } });

	const result = await h.emit("back to work");

	expect(result.action).toBe("handled");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications[0]?.message).toContain("automatic compaction is disabled");
	// The same reserve-inclusive threshold as when compaction is enabled: 32000 - 16384.
	expect(h.notifications[0]?.message).toContain("15616");
});

// ------------------------------------------------------------------
// 4.4 state after a block
// ------------------------------------------------------------------

// spec requirement "送らないことを選んだときに入力とロールの状態を残す"
test("a blocked input leaves the phase where the input found it", async () => {
	const h = gateHarness({
		messages: HUGE,
		commands: [slashCommandInfo("opsx-propose", "prompt")],
	});

	const firing = h.emit("/opsx-propose build the gate");
	await h.flush();
	fail(h, "provider exploded");

	expect((await firing).action).toBe("handled");
	// The step the input opened is not running, and the role reads as it did before the line.
	expect(h.phase.step()).toBeUndefined();
	expect(h.phase.current()).toBe("normal");
	// The rollback is the recorded kind: an open and a restore, the way the step-start undo writes them.
	const steps = h.pi.entries.filter((entry) => entry.customType === STEP_ENTRY_TYPE);
	expect(steps.length).toBe(2);
	expect(steps[0]?.data).toEqual({ step: "opsx-propose" });
	expect(steps[1]?.data).toEqual({ step: null });
});

// spec scenario "断ったあとに読み直すと入力前の位置である"
test("a reopened runtime reads the pre-input step after a block", async () => {
	const h = gateHarness({ commands: [slashCommandInfo("opsx-propose", "prompt")], messages: HUGE });

	const firing = h.emit("/opsx-propose build the gate");
	await h.flush();
	fail(h, "provider exploded");
	await firing;

	// Reading the session back the way a reload and a branch move do lands before the blocked input.
	const branch = h.pi.entries.map((entry) => customEntry(entry.customType, entry.data, nextEntryId()));
	expect(spiritsStepEntry(branch)).toBeUndefined();
});

// spec scenario "対話端末で断って本文を残す"
test("a blocked input returns the text to the editor in the terminal", async () => {
	const h = gateHarness({ messages: HUGE, mode: "tui" });

	const firing = h.emit("back to work");
	await h.flush();
	fail(h, "provider exploded");
	await firing;

	expect(h.editor()).toBe("back to work");
});

// ------------------------------------------------------------------
// 4.5 the notice
// ------------------------------------------------------------------

// spec requirement "送らないことを選んだ理由を出す"
test("the block notice names the target, its window, the estimate, and the threshold", async () => {
	const h = gateHarness({ messages: HUGE, settings: { defaultProvider: "fake", defaultModel: "small", compaction: { enabled: false } } });

	await h.emit("go");

	const notice = h.notifications[0]?.message ?? "";
	expect(notice).toContain("fake/small");
	expect(notice).toContain("32000");
	// 20000 tokens of history plus the two-character line, estimated by the host's own estimator.
	expect(notice).toContain("20001");
	expect(notice).toContain("15616");
	// `keepRecentTokens` is named so the user can see why a compaction may not shrink enough.
	expect(notice).toContain("20000");
});

// spec scenario "本文を戻せない経路ではその旨を出す"
test("the block notice says the text may not be restored outside the terminal", async () => {
	const terminal = gateHarness({ messages: HUGE, mode: "tui" });
	const remote = gateHarness({ messages: HUGE, mode: "rpc" });

	const first = terminal.emit("same line");
	await terminal.flush();
	fail(terminal, "boom");
	await first;
	const second = remote.emit("same line");
	await remote.flush();
	fail(remote, "boom");
	await second;

	expect(terminal.notifications[0]?.message).not.toContain("may not come back");
	expect(remote.notifications[0]?.message).toContain("may not come back");
});

test("the rpc block is delivered as an extension notification", async () => {
	const h = gateHarness({ messages: HUGE, mode: "rpc" });

	const firing = h.emit("back to work");
	await h.flush();
	fail(h, "boom");

	expect((await firing).action).toBe("handled");
	// In RPC the notice is the contract: the host carries it as `extension_ui_request` method `notify`.
	expect(h.notifications.length).toBe(1);
	expect(h.notifications[0]?.type).toBe("warning");
});

// ------------------------------------------------------------------
// 4.6 physical selection
// ------------------------------------------------------------------

test("a physical selection is left to pi", async () => {
	const h = gateHarness({ messages: HUGE, model: SMALL });

	expect((await h.emit("back to work")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications).toEqual([]);
});

// ------------------------------------------------------------------
// 4.7 cancellation
// ------------------------------------------------------------------

// spec scenario "Esc で先行圧縮を取り消す"
test("a cancelled compaction blocks the input with the cancellation named", async () => {
	const h = gateHarness({ messages: HUGE, mode: "tui" });

	const firing = h.emit("back to work");
	await h.flush();
	// The host reports the abort on its own event before the handler's `onError` line arrives.
	await h.pi.fire(
		"session_compact_failed",
		{ type: "session_compact_failed", reason: "manual", aborted: true, willRetry: false, fromExtension: false },
		h.ctx,
	);
	fail(h, "Compaction cancelled");

	expect((await firing).action).toBe("handled");
	expect(h.notifications[0]?.message).toContain("the ahead compaction was cancelled");
	// The text went back to the editor instead of a run.
	expect(h.editor()).toBe("back to work");
});

// ------------------------------------------------------------------
// 4.8 inputs that arrive while the ahead compaction is in flight
// ------------------------------------------------------------------

// spec requirement "先行圧縮の在職による入力の拒否"
test("an input during an in-flight compaction is blocked with one notice", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	const racing = await h.emit("a second line");

	expect(racing.action).toBe("handled");
	expect(h.compactions.length).toBe(1);
	expect(h.notifications.length).toBe(1);
	expect(h.notifications[0]?.message).toContain("was not sent");

	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

// spec requirement "在職中に拒否した入力の戻し方": append, so queued lines survive whole.
test("a blocked input appends its text without overwriting the editor", async () => {
	const h = gateHarness({ messages: HUGE, mode: "tui" });

	const firing = h.emit("back to work");
	await h.flush();
	await h.emit("first queued line");
	await h.emit("second queued line");

	expect(h.editor()).toBe("first queued linesecond queued line");

	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

test("templates and skill commands are blocked while in flight", async () => {
	const h = gateHarness({ messages: HUGE, commands: [slashCommandInfo("fitgate-tpl", "prompt")] });

	const firing = h.emit("back to work");
	await h.flush();

	// In the ordinary flow these two are judged by the fit rule; while the compaction is in flight
	// the in-flight rejection answers before any fit judgment, phase or all.
	expect((await h.emit("/fitgate-tpl do the thing")).action).toBe("handled");
	expect((await h.emit("/skill:some-skill do the thing")).action).toBe("handled");
	expect(h.phase.step()).toBeUndefined();

	complete(h);
	await firing;
});

// design D10: the guard stands before the handler that calls `phase.handleInput`, so a rejected
// input cannot open a step of its own or overwrite the pending-undo slot of the waiting input.
test("the in-flight check runs before the routing phase handler", async () => {
	const h = gateHarness({
		messages: HUGE,
		commands: [slashCommandInfo("opsx-propose", "prompt")],
	});

	const firing = h.emit("back to work");
	await h.flush();
	const racing = await h.emit("/opsx-propose a step started mid-compaction");

	expect(racing.action).toBe("handled");
	// The phase handler never saw the line: no step opened, no record written for it.
	expect(h.phase.step()).toBeUndefined();
	expect(h.pi.entries.filter((entry) => entry.customType === STEP_ENTRY_TYPE)).toEqual([]);

	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

test("an extension source input is blocked while in flight", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();

	// Normally an extension-sent input is out of the gate's scope; while the compaction is in
	// flight everything that reaches the input event is refused, source notwithstanding.
	expect((await h.emit("machine line", { source: "extension" })).action).toBe("handled");

	complete(h);
	await firing;
});

// ------------------------------------------------------------------
// 4.9 the lifetime of the in-flight flag
// ------------------------------------------------------------------

test("the flag is set synchronously before the compaction await", async () => {
	let racingAction: string | undefined;
	const probe = (h: Harness) => {
		// Run the first registered input handler synchronously: the flag must already be up before
		// the gate handler ever yields, because the host may deliver an input between the `compact()`
		// call and its completion with no await point in between.
		const handler = (h.pi.handlers.get("input") ?? [])[0];
		const result = handler?.(makeInputEvent("probe", undefined, "rpc"), h.ctx) as { action?: string } | undefined;
		racingAction = result?.action;
	};
	const h = gateHarness({ messages: HUGE, onCompact: () => probe(h) });

	const firing = h.emit("back to work");
	await h.flush();

	expect(racingAction).toBe("handled");
	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

test("a throwing gate handler still lowers the flag", async () => {
	const h = gateHarness({ messages: HUGE, notifyThrows: true });

	const firing = h.emit("back to work");
	await h.flush();
	complete(h);
	// The block path throws on its way out (the host would report it and let the input through);
	// the finally still lowers the flag.
	await firing;
	expect(h.pi.errors.length).toBe(1);

	// The next input is not refused as in-flight: it fits, and it goes through untouched.
	h.setMessages([messageOfTokens(10)]);
	expect((await h.emit("next line")).action).toBe("continue");
	expect(h.notifications).toEqual([]);
});

test("compaction_end does not lower the flag while the handler is open", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	// The host's compaction events fire while the gate handler still holds the flag open: settling
	// them must not reopen the window a queued input could run in.
	await h.pi.fire(
		"session_compact",
		{ type: "session_compact", reason: "manual", compactionEntry: { type: "compaction", id: "c", parentId: null, timestamp: "0", summary: "s", firstKeptEntryId: "k", tokensBefore: 0 } },
		h.ctx,
	);
	await h.pi.fire("agent_settled", { type: "agent_settled", aborted: false }, h.ctx);

	expect((await h.emit("queued during compaction")).action).toBe("handled");

	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");
});

// ------------------------------------------------------------------
// 4.10 spec scenarios the sections above left without a gate-level test
// ------------------------------------------------------------------

// spec scenario "収まっている場合は圧縮しない"
test("an input that fits starts no compaction", async () => {
	const h = gateHarness({ messages: [messageOfTokens(1000)] });

	expect((await h.emit("back to work")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications).toEqual([]);
});

// spec scenario "無効でも収まっている": the switch removes the compaction, not the send.
test("an input that fits with compaction disabled is sent", async () => {
	const h = gateHarness({
		messages: [messageOfTokens(1000)],
		settings: { defaultProvider: "fake", defaultModel: "small", compaction: { enabled: false } },
	});

	expect((await h.emit("back to work")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications).toEqual([]);
});

// spec scenario "スキル起動のコマンドでは展開前の本文で判定する"
test("a skill command is judged on its unexpanded text", async () => {
	// A skill launch reaches `input` before the host expands it, and pi reports it with the `skill`
	// command source, which the gate does not exclude (only `extension` commands are).
	const commands = [slashCommandInfo("some-skill", "skill")];

	const h = gateHarness({ messages: HUGE, commands });
	const firing = h.emit("/skill:some-skill do the thing");
	await h.flush();
	expect(h.compactions.length).toBe(1);

	h.setMessages([messageOfTokens(10)]);
	complete(h);
	expect((await firing).action).toBe("continue");

	// What it measured is the received line and nothing more: the 30 characters of `/skill:some-skill
	// do the thing` read as 8 tokens on top of the 20000 of history, so the expanded skill body never
	// entered the estimate (the host's own compaction takes that part, design Decision D9).
	const blocked = gateHarness({
		messages: HUGE,
		commands,
		settings: { defaultProvider: "fake", defaultModel: "small", compaction: { enabled: false } },
	});
	await blocked.emit("/skill:some-skill do the thing");

	expect(blocked.compactions.length).toBe(0);
	expect(blocked.notifications[0]?.message).toContain("20008");
});

// spec scenario "公称の収容量の内側でも reserve を越えていれば断る"
test("a refusal inside the nominal window names the threshold", async () => {
	const h = gateHarness({ messages: HUGE });

	const firing = h.emit("back to work");
	await h.flush();
	// The compaction lands and the projection reads the same amount: nothing was left to summarize.
	complete(h);

	expect((await firing).action).toBe("handled");
	const notice = h.notifications[0]?.message ?? "";
	// 20003 tokens fit inside the 32000 the provider advertises, yet pass the reserve-inclusive
	// threshold of 32000 - 16384, which is the reading the gate rejects on (design Decision D2).
	expect(notice).toContain("32000");
	expect(notice).toContain("20003");
	expect(notice).toContain("15616");
});

// spec scenario "収容量のあるモデルへ替えてから同じ本文を送る"
test("a refused line is sent after the target grows", async () => {
	const h = gateHarness({
		messages: HUGE,
		settings: { defaultProvider: "fake", defaultModel: "small", compaction: { enabled: false } },
	});

	expect((await h.emit("back to work")).action).toBe("handled");
	expect(h.notifications.length).toBe(1);

	// The user moves the role's target to a model with room, then sends the same text again.
	h.pi.settings = { defaultProvider: "fake", defaultModel: "big" };

	expect((await h.emit("back to work")).action).toBe("continue");
	expect(h.compactions.length).toBe(0);
	expect(h.notifications.length).toBe(1);
});

