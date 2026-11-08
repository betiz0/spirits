/**
 * The `/spirits-clear` boundary, measured against pi's own session functions.
 *
 * The boundary works by counting messages, and a count is only as good as the projection behind it:
 * an earlier compaction, a branch summary, and an extension message each change how many messages pi
 * hands the `context` handler for the same branch. So these tests build real pi sessions and read
 * `buildSessionProjection()` through the functions the extension registers. The argument grammar and
 * the settings file are in `managed-commands.test.ts`, where doubles are enough.
 */

import { expect, test } from "bun:test";
import type {
	AgentMessage,
	ContextEventResult,
	ExtensionCommandContext,
	SessionBeforeCompactEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CLEAR_ENTRY_TYPE, COMMAND_SPIRITS_CLEAR } from "../src/constants.ts";
import { boundaryCompactionResult, clearedMessageCount } from "../src/commands/clear.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { SessionManager } from "./pi-runtime/session-manager.ts";
import { FakePi, fakeCommandContext } from "./routing/fake-pi.ts";

/** A user turn, as pi stores it. */
function ask(text: string): AgentMessage {
	return { role: "user", content: text };
}

/** An assistant turn, as pi stores it. */
function reply(text: string): AgentMessage {
	return { role: "assistant", content: text };
}

/** A session with the system prompt pi puts in front of every conversation. */
function session(): SessionManager {
	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionManager.appendMessage({ role: "system", content: "system prompt and tool loadout" });
	return sessionManager;
}

/** Ids of a session's turns, so a compaction event can name the entry it keeps. */
function lastTurnId(sessionManager: SessionManager): string {
	const turn = [...sessionManager.getBranch()].reverse().find((entry) => entry.type === "message");
	return turn?.id ?? "";
}

/** The context of a command: a real pi session behind pi's own command context shape. */
function commandContext(sessionManager: SessionManager): ExtensionCommandContext {
	const base = fakeCommandContext();
	return { ...base.ctx, sessionManager } as unknown as ExtensionCommandContext;
}

/** The command surface wired to a real pi session, the way pi wires `pi.appendEntry`. */
function managed(sessionManager: SessionManager): {
	pi: FakePi;
	clear: (args: string) => Promise<void>;
	context: (event: { type: "context"; messages: AgentMessage[] }) => Promise<ContextEventResult | undefined>;
	notices: string[];
} {
	const pi = new FakePi();
	pi.appendEntry = (customType: string, data?: unknown): void => {
		sessionManager.appendCustomEntry(customType, data);
	};
	const base = fakeCommandContext();
	const ctx = { ...base.ctx, sessionManager } as unknown as ExtensionCommandContext;
	registerManagedCommands(pi, { phase: createRoutingPhase() });

	const command = pi.commands.get(COMMAND_SPIRITS_CLEAR);
	if (!command) throw new Error(`${COMMAND_SPIRITS_CLEAR} was not registered`);
	const context = pi.handlers.get("context")?.[0];
	if (!context) throw new Error("the context handler was not registered");

	return {
		pi,
		clear: async (args) => {
			await command.handler(args, ctx);
		},
		context: (event) => context(event, ctx) as Promise<ContextEventResult | undefined>,
		notices: base.notices,
	};
}

/** A compaction event as pi builds it, carrying the ids of a real session. */
function compactionEvent(
	sessionManager: SessionManager,
	firstKeptEntryId: string,
	reason: "manual" | "threshold",
): SessionBeforeCompactEvent {
	return {
		type: "session_before_compact",
		preparation: { firstKeptEntryId, tokensBefore: 9000 },
		branchEntries: [...sessionManager.getBranch()],
		reason,
		willRetry: false,
		signal: new AbortController().signal,
	};
}

function boundaryOf(sessionManager: SessionManager): SessionEntry | undefined {
	return sessionManager.getBranch().find((entry) => entry.type === "custom" && entry.customType === CLEAR_ENTRY_TYPE);
}

// spec scenario "TODO と goal は残る": the boundary is a conversation cut. Everything the session keeps
// beside the conversation is a custom entry, and a custom entry is not conversation.
test("the session's other records survive the boundary", async () => {
	const sm = session();
	sm.appendCustomEntry("spirits_todo", { items: [{ text: "write the docs", done: false }] });
	sm.appendCustomEntry("spirits_goal", { goal: "ship the change" });
	sm.appendCustomEntry("spirits_memory", { text: "the runner needs a staged artifact root" });
	sm.appendMessage(ask("question"));
	const { clear } = managed(sm);
	const before = sm.getBranch().filter((entry) => entry.type === "custom").length;

	await clear("");

	const custom = sm.getBranch().filter((entry) => entry.type === "custom");
	// The three records, plus the boundary the command wrote.
	expect(custom).toHaveLength(before + 1);
	expect(custom.map((entry) => entry.customType)).toEqual([
		"spirits_todo",
		"spirits_goal",
		"spirits_memory",
		CLEAR_ENTRY_TYPE,
	]);
});

// spec scenario "a boundary in the middle of a conversation": pi's projection, not a hand-built one.
test("everything before the boundary leaves the conversation pi sends", () => {
	const sm = session();
	sm.appendMessage(ask("old question"));
	sm.appendMessage(reply("old answer"));
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));

	// Projection is [system, question, answer, boundary, question-after]; the boundary projects to
	// nothing, and the system prompt is prompt state rather than conversation, so two messages go.
	expect(sm.buildSessionProjection().messages).toHaveLength(4);
	expect(clearedMessageCount(sm)).toBe(2);
});

// spec requirement "消した会話が復元されない": an earlier compaction, a branch summary and an
// extension message each add a projected message a branch walk cannot see.
test("an earlier compaction is cleared conversation too", () => {
	const sm = session();
	const first = sm.appendMessage(ask("old question"));
	sm.appendMessage(reply("old answer"));
	sm.appendCompaction("pi summary of the old work", first, 9000);
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));

	// The projection is [summary, old question, old answer, boundary, after]. The summary describes
	// the cleared turns, so it goes with them; counting raw messages instead of the projection says 2.
	expect(clearedMessageCount(sm)).toBe(3);
});

test("a branch summary is cleared conversation too, and the abandoned path is not", () => {
	const sm = session();
	sm.appendMessage(ask("question on the abandoned path"));
	const kept = sm.appendMessage(ask("question kept on the branch"));
	// `/tree` moves the leaf and records one summary message for the path it dropped.
	sm.branchWithSummary(kept, "summary of the abandoned path");
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));

	// The abandoned turn is off the branch and contributes nothing; the summary that replaced it does.
	expect(clearedMessageCount(sm)).toBe(3);
});

test("an extension message before the boundary is cleared conversation too", () => {
	const sm = session();
	sm.appendMessage(ask("question"));
	sm.appendCustomMessageEntry("spirits_note", "a note the model reads", true);
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));

	expect(clearedMessageCount(sm)).toBe(2);
});

test("only the newest boundary counts", () => {
	const sm = session();
	sm.appendMessage(ask("first"));
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("second"));
	sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("third"));

	expect(clearedMessageCount(sm)).toBe(2);
});

test("/spirits-clear records one boundary and keeps the session id", async () => {
	const sm = session();
	sm.appendMessage(ask("before"));
	const sessionId = sm.getSessionId();
	const entries = sm.getBranch().length;
	const { clear, notices } = managed(sm);

	await clear("");
	expect(sm.getBranch().length).toBe(entries + 1);
	expect(boundaryOf(sm)).toBeDefined();
	// spec scenario "the session file stays intact": a new session is the only thing that may change id.
	expect(sm.getSessionId()).toBe(sessionId);
	expect(notices).toEqual(["conversation cleared from the model context"]);

	// A second run records nothing new and says so.
	await clear("");
	expect(sm.getBranch().length).toBe(entries + 1);
	expect(notices.at(-1)).toInclude("already cleared");
});

// spec scenario "会話 0 でもエラーにしない", and the boundary is a conversation cut: which model serves
// the next request is a separate choice and must not move with it.
test("a session with nothing to clear takes a boundary and keeps its model choice", async () => {
	const sm = session();
	const { pi, clear, notices } = managed(sm);

	await clear("");

	expect(boundaryOf(sm)).toBeDefined();
	expect(notices).toEqual(["conversation cleared from the model context"]);
	expect(pi.modelChanges).toEqual([]);
	expect(pi.thinkingChanges).toEqual([]);
});

test("the context handler drops the cleared conversation from the request", async () => {
	const sm = session();
	sm.appendMessage(ask("old question"));
	sm.appendMessage(reply("old answer"));
	const { clear, context } = managed(sm);
	await clear("");
	sm.appendMessage(ask("question after the clear"));

	// pi hands the handler the conversation with the system prompt already taken out.
	const messages = sm.buildSessionProjection().messages.filter((message) => message.role !== "system");
	expect(messages).toHaveLength(3);

	const result = await context({ type: "context", messages });
	expect(result?.messages).toEqual([messages[2]]);
});

// A context handler ahead of this one can remove messages before counting, leaving the list shorter
// than the boundary. Cutting then would drop conversation that outlives the boundary, and cutting all
// the way would send a prompt with no conversation at all.
test("a list shorter than the boundary is handed back untouched", async () => {
	const sm = session();
	sm.appendMessage(ask("old question"));
	sm.appendMessage(reply("old answer"));
	const { clear, context } = managed(sm);
	await clear("");
	sm.appendMessage(ask("question after the clear"));

	const messages = sm.buildSessionProjection().messages.filter((message) => message.role !== "system");
	expect(await context({ type: "context", messages: messages.slice(1) })).toBeUndefined();
});

test("a session with no boundary sends its conversation as pi built it", async () => {
	const sm = session();
	sm.appendMessage(ask("question"));
	const { context } = managed(sm);

	const messages = sm.buildSessionProjection().messages.filter((message) => message.role !== "system");
	expect(await context({ type: "context", messages })).toBeUndefined();
});

test("a summary that would carry cleared conversation is taken over at the boundary", () => {
	const sm = session();
	sm.appendMessage(ask("a secret question"));
	sm.appendMessage(reply("a secret answer"));
	const boundary = sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));
	sm.appendMessage(reply("answer after the clear"));

	const result = boundaryCompactionResult(compactionEvent(sm, lastTurnId(sm), "threshold"), sm);
	// Keeping from the boundary means pi writes this compaction and resumes from the same place.
	expect(result?.compaction?.firstKeptEntryId).toBe(boundary);
	expect(result?.compaction?.tokensBefore).toBe(9000);
	// spec scenario "the automatic summary carries no cleared content".
	expect(result?.compaction?.summary).toContain("/spirits-clear");
	expect(result?.compaction?.summary).not.toContain("a secret");
});

// Taking a summary over costs the session its real summary and keeps every message the summary would
// have dropped. A span that holds nothing cleared must therefore go to pi, even though the boundary
// sits inside it — which is the case a boundary position alone cannot tell apart.
test("a boundary with nothing cleared behind it leaves the summary to pi", () => {
	const sm = session();
	const boundary = sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("first question"));
	sm.appendMessage(reply("first answer"));
	sm.appendMessage(ask("second question"));

	const branch = sm.getBranch();
	// The boundary sits inside the span pi meant to summarize — everything up to the last turn — and
	// that span still holds nothing the boundary removed.
	expect(branch.findIndex((entry) => entry.id === boundary)).toBeLessThan(branch.length - 2);
	expect(boundaryCompactionResult(compactionEvent(sm, lastTurnId(sm), "threshold"), sm)).toBeUndefined();
});

test("a summary of a conversation that is already clear of the boundary is left to pi", () => {
	const sm = session();
	sm.appendMessage(ask("old question"));
	sm.appendMessage(reply("old answer"));
	const boundary = sm.appendCustomEntry(CLEAR_ENTRY_TYPE, {});
	sm.appendMessage(ask("question after the clear"));
	sm.appendMessage(reply("answer after the clear"));
	// The takeover compaction ran: the cleared turns are gone from the projection.
	sm.appendCompaction("Conversation cleared by /spirits-clear.", boundary, 9000);
	sm.appendMessage(ask("later question"));

	expect(boundaryCompactionResult(compactionEvent(sm, lastTurnId(sm), "threshold"), sm)).toBeUndefined();
});

test("compaction is left alone when the session has no boundary", () => {
	const sm = session();
	sm.appendMessage(ask("question"));

	expect(boundaryCompactionResult(compactionEvent(sm, lastTurnId(sm), "threshold"), sm)).toBeUndefined();
	// spec requirement "手動の /compact を妨げない": a manual run on a session that was never cleared.
	expect(boundaryCompactionResult(compactionEvent(sm, lastTurnId(sm), "manual"), sm)).toBeUndefined();
});
