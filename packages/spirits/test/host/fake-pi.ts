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
	BeforeAgentStartEvent,
	AgentSessionEvent,
	ContextEvent,
	DefaultResourceLoader,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionToolContext,
	ExtensionUIContext,
	SessionBeforeCompactEvent,
	SessionEntry,
	SessionProjection,
	SessionStats,
	SlashCommandInfo,
	SourceInfo,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AgentToolCallOutcome,
	CallableToolInfo,
	AssistantMessage,
	ExtensionModelRegistry,
	PiModel,
	ReadonlySessionManager,
	UserMessage,
} from "../../src/types/host.ts";

/** A branch entry that carries one message, which the host derives from the same union. */
type SessionMessageEntry = Extract<SessionEntry, { type: "message" }>;

/** A tool call the model asked for, read off the content an assistant message carries. */
type HostToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/** How an answer ended, read off the assistant message the host's union carries. */
export type StopReason = AssistantMessage["stopReason"];

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
export function customEntry(
	customType: string,
	data: unknown,
	id: string,
	extra: Partial<Extract<SessionEntry, { type: "custom" }>> = {},
): Extract<SessionEntry, { type: "custom" }> {
	return { type: "custom", id, parentId: null, timestamp: new Date(0).toISOString(), customType, data, ...extra };
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

/**
 * The session reader a context carries.
 *
 * spirits walks the branch and reads the projection; the reader also owns persistence, navigation, and
 * compaction, none of which a unit test drives. A test hands over the members its subject calls, either
 * as a literal or as a small class that keeps the branch, so the parameter stays open.
 */
export function fakeSessionManager(partial: object = {}): ReadonlySessionManager {
	return asHost<ReadonlySessionManager>(partial);
}

/** The model catalog a router resolves against, holding only the lookups a test exercises. */
export function fakeModelRegistry(partial: Partial<ExtensionModelRegistry> = {}): ExtensionModelRegistry {
	return asHost<ExtensionModelRegistry>(partial);
}

/** An empty projection: no entries, no messages, no model, and a thinking level pi would print. */
export function fakeProjection(partial: Partial<SessionProjection> = {}): SessionProjection {
	return { entries: [], messages: [], thinkingLevel: "off", model: null, ...partial };
}

/**
 * The outcome of a nested `executeTool()` call.
 *
 * A test that does not care what a nested call returned still has to hand back the pair of a tool
 * call and its result, because that is what the host reports to the calling tool.
 */
export function fakeToolCallOutcome(partial: Partial<AgentToolCallOutcome> = {}): AgentToolCallOutcome {
	return asHost<AgentToolCallOutcome>({
		toolCall: { id: "call-0", name: "noop", arguments: {} },
		result: { content: [], details: undefined },
		isError: false,
		...partial,
	});
}

/**
 * An `on()` typed the way the host declares it, recording handlers into a map.
 *
 * The host declares `on()` once per event type, so a fake that writes one narrow overload per event
 * it cares about is not assignable to that member. The recorder here keeps the host's own member type,
 * and the map it fills stays the test's, so a test still reads back what it registered with its own
 * typing. The handler values pass through untouched.
 */
export function hostEventRegistrar(
	handlers: { get(key: string): unknown[] | undefined; set(key: string, value: unknown[]): unknown },
	unsubscribers?: { get(key: string): Array<() => void> | undefined; set(key: string, value: Array<() => void>): unknown },
): ExtensionAPI["on"] {
	return ((event: string, handler: (evt: never, ctx: never) => unknown) => {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
		const unsubscribe = () => {
			const index = list.indexOf(handler);
			if (index !== -1) list.splice(index, 1);
		};
		if (unsubscribers) {
			const recorded = unsubscribers.get(event) ?? [];
			recorded.push(unsubscribe);
			unsubscribers.set(event, recorded);
		}
		return unsubscribe;
	}) as ExtensionAPI["on"];
}

/** Where a command came from, for a test that names no file. */
export function fakeSourceInfo(path: string): SourceInfo {
	return { path, source: "test", scope: "user", origin: "top-level" };
}

/** One entry in pi's command list, as `getCommands()` reports it. */
export function slashCommandInfo(name: string, source: SlashCommandInfo["source"] = "extension"): SlashCommandInfo {
	return { name, source, sourceInfo: fakeSourceInfo(`test:${name}`) };
}

/** pi's entry for a thinking level the user changed, on a branch. */
export function thinkingLevelChangeEntry(thinkingLevel: string, id: string): SessionEntry {
	return { type: "thinking_level_change", thinkingLevel, id, parentId: null, timestamp: new Date(0).toISOString() };
}

/** pi's entry for a model the user changed, on a branch. */
export function modelChangeEntry(provider: string, modelId: string, id: string): SessionEntry {
	return { type: "model_change", provider, modelId, id, parentId: null, timestamp: new Date(0).toISOString() };
}

/** An assistant entry that answers with a physical model and ends the way the test says. */
export function assistantEntry(provider: string, modelId: string, stopReason: StopReason = "stop", id = "answer"): SessionEntry {
	return messageEntry(assistantMessage("", { provider, model: modelId, stopReason }), id);
}

/**
 * A test's own fake pi, given the type a registration function asks for.
 *
 * A fake records the handful of members its subject registers through, while `ExtensionAPI` names
 * commands, widgets, renderers, resources, and thirty events. The fake stays the fake — tests keep
 * reading what it recorded — and it takes the host type only where production code receives it.
 */
export function asExtensionApi(fake: object): ExtensionAPI {
	return asHost<ExtensionAPI>(fake);
}

/** The system message pi keeps in front of a conversation. */
export function systemMessage(text: string, extra: Partial<Extract<AgentMessage, { role: "system" }>> = {}) {
	return { role: "system" as const, content: text, timestamp: 0, ...extra };
}

/**
 * The preparation a `session_before_compact` event carries.
 *
 * spirits reads which entry the compaction keeps and how full the context was; pi's record also names
 * the messages it will summarize and the settings it will apply, which a test of a takeover never
 * inspects. The type is the event's own, so a host rename is still an error at the call.
 */
export function fakeCompactionPreparation(partial: Partial<SessionBeforeCompactEvent["preparation"]> = {}): SessionBeforeCompactEvent["preparation"] {
	return asHost<SessionBeforeCompactEvent["preparation"]>(partial);
}

/** Session totals, holding the counters a child run reports and the file it never wrote. */
export function fakeSessionStats(partial: Partial<SessionStats> = {}): SessionStats {
	return asHost<SessionStats>({ sessionId: "session-0", sessionFile: undefined, ...partial });
}

/**
 * pi's event for a tool call that started.
 *
 * pi always names the call and its arguments, so a test that only cares about the tool takes those
 * from here instead of inventing a partial event pi would never send.
 */
export function toolExecutionStart(toolName: string, toolCallId = "call-0", args: unknown = {}): AgentSessionEvent {
	return { type: "tool_execution_start", toolCallId, toolName, args };
}

/** A resource loader a child session can be handed, with only the reload a test counts. */
export function fakeResourceLoader(partial: Partial<DefaultResourceLoader> = {}): DefaultResourceLoader {
	return asHost<DefaultResourceLoader>(partial);
}

/** The entry kind a goal, a todo list, or any other spirits record is stored under. */
export type CustomSessionEntry = Extract<SessionEntry, { type: "custom" }>;

/**
 * An id for an entry a test builds.
 *
 * pi gives every branch entry its own id, and a test that builds a branch only needs the ids to differ
 * from each other, so they count up over the whole run.
 */
let entrySequence = 0;
export function nextEntryId(): string {
	entrySequence += 1;
	return `entry-${entrySequence}`;
}

/** A tool call the model asked for, with the ids pi always fills. */
export function fakeToolCall(name: string, args: Record<string, unknown> = {}, id = "call-0"): HostToolCall {
	return asHost<HostToolCall>({ type: "toolCall", id, name, arguments: args });
}

/**
 * A tool the tool list reports.
 *
 * pi's own tool record carries a label, a description, and an execute; a test that lists a tool by name
 * to check what the extension sees takes the rest from here.
 */
export function callableTool(name: string, extra: Record<string, unknown> = {}): CallableToolInfo {
	return asHost<CallableToolInfo>({
		name,
		label: name,
		description: `the ${name} tool`,
		parameters: {},
		execute: async () => fakeToolCallOutcome(),
		...extra,
	});
}

/**
 * A custom screen that opens and closes at once.
 *
 * pi builds a component through the factory and resolves with what `done()` carries. The double runs
 * the factory with a theme that adds no escape sequences, so a test reads the row text as written, and
 * hands the component to `onCustom` — the only way to drive a pi-tui component without a terminal.
 * The host's own member type is kept here, so the loose factory signature stays a test detail.
 */
/**
 * A host theme that paints nothing: the panel builders are judged on the entries they build, and a
 * colour is one of the entries' fields rather than something the test asserts about.
 *
 * The published `Theme` is a wide object a test has no business filling in, so the widening lives
 * here with the other doubles instead of at a call site.
 */
export function fakeTheme(): Theme {
	return asHost<Theme>({ fg: (_color: string, text: string) => text });
}

export function fakeCustomScreen(options: {
	/** Where to record each component the factory built, in call order. */
	components: unknown[];
	/** Runs after the screen is built, standing for the edits the user makes in it. */
	onCustom?: (component: unknown) => void;
	/** What the closed screen reports. */
	customResult?: unknown;
}): ExtensionUIContext["custom"] {
	return asHost<ExtensionUIContext["custom"]>((factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void) => unknown) => {
		options.components.push(factory({}, { fg: (_color: string, text: string) => text }, {}, () => {}));
		options.onCustom?.(options.components.at(-1));
		return Promise.resolve(options.customResult);
	});
}

/**
 * A branch entry that names no id.
 *
 * pi writes an id on every entry it stores, so the host type requires one; spirits still has to drop
 * nothing when it reads an entry that carries none, and that is what a test needs to be able to build.
 */
export function entryWithoutId(customType: string, data?: unknown): SessionEntry {
	return asHost<SessionEntry>({ type: "custom", customType, data });
}

/**
 * The system prompt options a `before_agent_start` event carries.
 *
 * pi's normalized form lists every section and flag; a test that hands over one section takes the rest
 * from here, since the extension under test only reads the sections.
 */
export function fakeSystemPromptOptions(partial: Record<string, unknown> = {}): BeforeAgentStartEvent["systemPromptOptions"] {
	return asHost<BeforeAgentStartEvent["systemPromptOptions"]>(partial);
}

/**
 * A settings key pi's own type does not name.
 *
 * pi keeps keys it does not know — spirits' own `models`, `todo`, and `quietStartup` among them — and
 * reading one back is what a compatibility observation does. The read lives here so the test says what
 * it means instead of casting at the call.
 */
export function unknownSetting(settings: object, key: string): unknown {
	return (settings as Record<string, unknown>)[key];
}

/**
 * An `on()` that refuses one event, the way a host whose subscription list lost it would.
 *
 * A degraded-host test needs the registration attempt to fail while every other event still works, so
 * it wraps the recorder rather than rewriting the fake.
 */
export function withoutEvent(
	handlers: { get(key: string): unknown[] | undefined; set(key: string, value: unknown[]): unknown },
	refused: string,
	message: string,
): ExtensionAPI["on"] {
	const recorder = hostEventRegistrar(handlers);
	return asHost<ExtensionAPI["on"]>((event: string, handler: (evt: never, ctx: never) => unknown) => {
		if (event === refused) throw new Error(message);
		return (recorder as unknown as (e: string, h: unknown) => () => void)(event, handler);
	});
}

/**
 * A tool context in the shape an erased ToolDefinition takes.
 *
 * The host declares the context a tool receives once per definition, and the erased form it lists
 * carries the narrower of the two widget signatures. A probe that runs a captured definition hands
 * over the context in the shape of that definition's own execute, read from the definition it was
 * given, so the widening stays here rather than at every call.
 */
export function erasedToolContext<TTool extends { execute: (...args: never) => unknown }>(
	tool: TTool,
	partial: object,
): Parameters<TTool["execute"]>[4] {
	return asHost<Parameters<TTool["execute"]>[4]>(partial);
}

/**
 * A before_agent_start event, with the prompt text and the system prompt options an extension reads.
 *
 * pi's own record also names the model, the session, and the abort signal, none of which a test of a
 * prompt transform inspects. The type is the host's, so a rename is still an error at the call.
 */
export function fakeBeforeAgentStartEvent(partial: Record<string, unknown> = {}): BeforeAgentStartEvent {
	return asHost<BeforeAgentStartEvent>({ type: "before_agent_start", prompt: "", ...partial });
}
