/**
 * Test doubles for the published host types.
 *
 * A test drives one behaviour of spirits and cannot spell out the whole host surface around it: pi's
 * `ExtensionAPI` has commands, widgets, resources, and twenty-odd events, `AgentSession` carries the
 * agent and its managers, and a model record names more fields than a routing decision reads. So the
 * doubles here are partial: a test fills the members its subject actually touches, and `asHost` gives
 * the partial the host's own type. That assertion is the only place in the test tree where a value is
 * widened to a host type, which keeps every other file's fakes checkable against the real surface —
 * a member the host renamed is an error at the call, not inside this file.
 */

import type {
	AgentSession,
	ContextEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionToolContext,
	ExtensionUIContext,
	SessionBeforeCompactEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage, AssistantMessage, PiModel, UserMessage } from "../../src/types/host.ts";

/** A branch entry that carries one message, which the host derives from the same union. */
type SessionMessageEntry = Extract<SessionEntry, { type: "message" }>;

/** Widen a partial double to the host type a spirits function asks for. See the file header. */
function asHost<THost>(partial: object): THost {
	return partial as THost;
}

/**
 * One model record, in the shape the host's `Model` demands.
 *
 * spirits reads `provider` and `id`; pi's own record also names the model, its api, the base url, the
 * modalities, the cost, and the two token limits. The limits and the cost stand in for a model no test
 * asks anything about — a routing or a settings test only ever compares `provider` and `id`.
 */
export function fakeModel(provider: string, id: string, extra: Partial<PiModel> = {}): PiModel {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider,
		baseUrl: "https://example.invalid",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: true,
		contextWindow: 200000,
		maxTokens: 8192,
		...extra,
	};
}

/** The `ExtensionAPI` double for a test that registers into a fake pi. */
export function fakeApi(partial: Partial<ExtensionAPI> = {}): ExtensionAPI {
	return asHost<ExtensionAPI>(partial);
}

/** The `ExtensionContext` a handler or a route reads. */
export function fakeContext(partial: Partial<ExtensionContext> = {}): ExtensionContext {
	return asHost<ExtensionContext>(partial);
}

/** The `ExtensionCommandContext` a command handler reads. */
export function fakeCommandContext(partial: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
	return asHost<ExtensionCommandContext>(partial);
}

/** The `ExtensionToolContext` a tool's `execute` reads. */
export function fakeToolContext(partial: Partial<ExtensionToolContext> = {}): ExtensionToolContext {
	return asHost<ExtensionToolContext>(partial);
}

/** The `ExtensionUIContext` an extension shows things with. */
export function fakeUi(partial: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
	return asHost<ExtensionUIContext>(partial);
}

/** The `AgentSession` a child-session run returns. */
export function fakeSession(partial: Partial<AgentSession> = {}): AgentSession {
	return asHost<AgentSession>(partial);
}

/** A user message, in the shape the host's message union carries. */
export function userMessage(text: string, extra: Partial<UserMessage> = {}): UserMessage {
	return { role: "user", content: text, timestamp: 0, ...extra };
}

/** An assistant message, with the text part spirits reads and no answer pending. */
export function assistantMessage(text: string, extra: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 0,
		...extra,
	};
}

/** A message entry on the session branch, with the ids a branch position is read from. */
export function messageEntry(message: AgentMessage, id: string, extra: Partial<SessionMessageEntry> = {}): SessionMessageEntry {
	return { type: "message", id, parentId: null, timestamp: new Date(0).toISOString(), message, ...extra };
}

/** A custom entry on the session branch, in the same complete shape. */
export function customEntry(customType: string, data: unknown, id: string, extra: Partial<SessionEntry> = {}): SessionEntry {
	return { type: "custom", id, parentId: null, timestamp: new Date(0).toISOString(), customType, data, ...extra } as SessionEntry;
}

/** A `session_before_compact` event, with the preparation a takeover reads. */
export function fakeCompactEvent(partial: Partial<SessionBeforeCompactEvent> = {}): SessionBeforeCompactEvent {
	return asHost<SessionBeforeCompactEvent>({
		type: "session_before_compact",
		preparation: { firstKeptEntryId: "keep-0", tokensBefore: 0 },
		branchEntries: [],
		...partial,
	});
}

/** A `context` event carrying one conversation. */
export function fakeContextEvent(messages: AgentMessage[], partial: Partial<ContextEvent> = {}): ContextEvent {
	return asHost<ContextEvent>({ type: "context", messages, ...partial });
}
