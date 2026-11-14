/**
 * Minimal local mirror of the upstream pi Extension API surface that spirits uses.
 *
 * The real types live in `packages/coding-agent/src/core/extensions/types.ts`. Spirits
 * does not compile against them directly: doing so pulls the whole pi source tree into
 * the type check, where `@types/bun` globals conflict with pi's Node-targeted types
 * (`ReadableStream`, `path.PlatformPath`). The `paths` entry in
 * `packages/spirits/tsconfig.json` points type-only imports at this file, which the
 * runtime does not load.
 *
 * `src/rlm/spawn.ts` is the exception: it imports pi values at runtime (the SDK). Bun
 * resolves those with the nearest `tsconfig.json`, `src/rlm/tsconfig.json`, whose
 * `paths` extend the root config and point at the pi sources (design Decision 12).
 *
 * Keep this in sync with the upstream definitions when spirits adopts new API fields.
 */

import type { Static, TSchema } from "typebox";
import type { KeyId, SelectListTheme, SettingsListTheme } from "@earendil-works/pi-tui";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Minimal view of a pi-ai model. */
export interface PiModel {
	provider: string;
	id: string;
	/** Display name pi carries for the model. */
	name?: string;
	/**
	 * pi's api id. A virtual catalog entry is `"pi-virtual"`, which pi does not export a helper for
	 * outside its package. Absent on test doubles.
	 */
	api?: string;
	/**
	 * pi's thinking level map: every level pi knows, mapped to the level or to `null` when the model
	 * does not offer it. Only the pi-runtime pin test reads it, to catch pi adding a level.
	 */
	thinkingLevelMap?: Record<string, string | null>;
}

export type ToolExecutionMode = "sequential" | "parallel";

export type ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden";

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { [key: string]: JsonValue };

/** Final or partial result produced by a tool. */
export interface AgentToolResult<T = JsonValue | undefined> {
	/** Text or image content returned to the model. */
	content: (TextContent | ImageContent)[];
	/** Arbitrary structured details for logs or UI rendering. */
	details: T;
	/** Machine-readable result matching the tool's `outputSchema`, for programmatic callers. */
	structuredContent?: JsonValue;
	/** Report a failure without throwing. */
	isError?: boolean;
	/** Hint that the agent should stop after the current tool batch. */
	terminate?: boolean;
}

/** Final outcome of a tool call after hooks ran. */
export interface AgentToolCallOutcome {
	toolCall: unknown;
	result: AgentToolResult<any>;
	isError: boolean;
}

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

/** Options for {@link ExtensionToolContext.executeTool}. */
export interface ExecuteToolOptions {
	signal?: AbortSignal;
	onUpdate?: AgentToolUpdateCallback;
}

/** Run mode of the current pi process. */
export type ExtensionMode = "tui" | "rpc" | "json" | "print";

/**
 * The settings-list theme pi itself uses, and a submenu's. Both read the live theme, so a panel that
 * colors itself is the thing that looks wrong after a theme change; the role list takes these instead.
 */
export function getSettingsListTheme(): SettingsListTheme;
export function getSelectListTheme(): SelectListTheme;

/** Theme colors used by the spirits header. */
export type ThemeColor = "accent" | "dim" | "muted";

/** Theme façade passed to extension UI factories. Only `fg` is mirrored. */
export interface Theme {
	fg(color: ThemeColor, text: string): string;
}

/** Minimal pi-tui component contract for extension UI factories. */
export interface Component {
	render(width: number): string[];
	invalidate(): void;
}

/** Header factory argument; the spirits header does not use the TUI handle. */
export type TUI = unknown;

/** Effective settings subset the spirits extension reads and writes. */
export interface ExtensionSettings {
	quietStartup?: boolean | "header";
	/** Provider of pi's default model. pi owns and writes this key; spirits only reads it. */
	defaultProvider?: string;
	/** Model id of pi's default model. pi owns and writes this key; spirits only reads it. */
	defaultModel?: string;
	/** pi's default thinking level, written by pi's own `/thinking`. */
	defaultThinkingLevel?: ThinkingLevel;
	/**
	 * spirits-owned settings keys. pi's `Settings` type does not declare them; pi keeps unknown
	 * keys in the settings file when it saves a known setting, so no core change is needed.
	 */
	models?: {
		strong?: string;
		role?: string;
		normal?: string;
		thinking?: { normal?: string; strong?: string };
		steps?: Record<string, { role?: string; thinking?: string }>;
	};
}

/** Placement for extension widgets. */
export type WidgetPlacement = "aboveEditor" | "belowEditor";

/** Options for extension widgets. */
export interface ExtensionWidgetOptions {
	/** Where the widget is rendered. Defaults to "aboveEditor". */
	placement?: WidgetPlacement;
}

/** UI façade passed to extension event handlers. Only the fields spirits uses are mirrored. */
export interface ExtensionUIContext {
	/** Set a custom header component, or undefined to restore the built-in header. */
	setHeader(factory: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined): void;
	/** Set a widget to display above or below the editor. Accepts string array or component factory. */
	setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
	setWidget(
		key: string,
		content: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void;
	/** Show a notice. The only user-facing channel that works in every run mode. */
	notify(message: string, type?: "info" | "warning" | "error"): void;
	/** Set status text in the footer/status bar. `undefined` clears it. */
	setStatus(key: string, text: string | undefined): void;
	/**
	 * Show a component with keyboard focus and resolve with what the component reports through `done`.
	 *
	 * TUI only: pi's RPC mode returns `undefined` here, so a caller must guard with
	 * `ctx.mode === "tui"` and not treat `hasUI` as proof (the panel in `commands/role-panel.ts` does).
	 * The factory may resolve late, and the returned component's `dispose` runs when it closes.
	 */
	custom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: unknown,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: { overlay?: boolean },
	): Promise<T>;
}

/** Fired when a session is started, loaded, or reloaded. */
export interface SessionStartEvent {
	type: "session_start";
	reason: "startup" | "reload" | "new" | "resume" | "fork";
	previousSessionFile?: string;
}

/** Fired after session_start so extensions can provide additional resource paths. */
export interface ResourcesDiscoverEvent {
	type: "resources_discover";
	cwd: string;
	reason: "startup" | "reload";
}

/** Result of a `resources_discover` handler. */
export interface ResourcesDiscoverResult {
	skillPaths?: string[];
	promptPaths?: string[];
	themePaths?: string[];
}

/** Source of user input. */
export type InputSource = "interactive" | "rpc" | "extension";

/**
 * Fired when user input arrives. It fires before pi expands a `/skill:<name>` command into a skill
 * block, so a handler sees the command name.
 */
export interface InputEvent {
	type: "input";
	/** The input text. */
	text: string;
	/** Where the input came from. */
	source: InputSource;
	/** How the input is delivered during streaming, or undefined when idle. */
	streamingBehavior?: "steer" | "followUp";
}

/** Result of an `input` handler. */
export type InputEventResult =
	| { action: "continue" }
	| { action: "transform"; text: string; images?: ImageContent[] }
	| { action: "handled" };

/** Fired after an agent run settled, with no automatic retry, compaction, or queued continuation left. */
export interface AgentSettledEvent {
	type: "agent_settled";
	/** Whether the run ended because it was aborted, for example with Escape. */
	aborted: boolean;
}

/** Fired after navigating in the session tree. */
export interface SessionTreeEvent {
	type: "session_tree";
	newLeafId: string | null;
	oldLeafId: string | null;
	summaryEntry?: unknown;
	fromExtension?: boolean;
}

/** Keybinding identifier accepted by keyHint/keyText. */
export type AppKeybinding = string;

/** Render a keybinding's keys. */
export function keyText(keybinding: AppKeybinding): string;

/** Render a dim keybinding hint with a muted description. */
export function keyHint(keybinding: AppKeybinding, description: string): string;

/** Render a literal key as a dim hint with a muted description. */
export function rawKeyHint(key: string, description: string): string;

/** Context shared by all extension entry points. Only the fields spirits reads are mirrored. */
export interface ExtensionContext {
	/** UI methods for user interaction. */
	ui: ExtensionUIContext;
	/** Current run mode. Use `"tui"` to guard terminal-only UI. */
	mode: ExtensionMode;
	/** Current working directory. */
	cwd: string;
	/** Session manager (read-only). */
	sessionManager: ReadonlySessionManager;
	/** Current model, or undefined when no model is selected. */
	model: PiModel | undefined;
	/** Current thinking level, when the session runtime provides one. */
	thinkingLevel?: ThinkingLevel;
	/** The current abort signal, or undefined when the agent is not streaming. */
	signal: AbortSignal | undefined;
	/** Catalog lookups used to resolve a route target. Only the methods spirits calls are mirrored. */
	modelRegistry: ExtensionModelRegistry;
}

/** Catalog handle a router resolves its targets against. Only the methods spirits calls are mirrored. */
export interface ExtensionModelRegistry {
	/** Models available for selection: catalog entries whose provider has credentials. */
	getAvailable(): PiModel[];
	/** Catalog model of a provider, or undefined when the id is unknown. */
	find(provider: string, modelId: string): PiModel | undefined;
	/** Whether the model's provider has credentials. */
	hasConfiguredAuth(model: PiModel): boolean;
}

/** Why a request is being routed. */
export type ModelRouteReason = "user" | "continuation" | "retry" | "direct";

/** One routing decision input. Spirits reads the selection, reason, and previous response only. */
export interface ModelRouteRequest<TState = unknown> {
	/** The selected virtual model. */
	model: PiModel;
	/** The selected thinking level. Its meaning is up to the router. */
	thinkingLevel: ThinkingLevel;
	reason: ModelRouteReason;
	/** Physical model and thinking level of the latest successful response. */
	previous?: { model: PiModel; thinkingLevel?: ThinkingLevel };
	/** Router state last returned on this session branch. Undefined for `direct` requests. */
	state?: TState;
	signal?: AbortSignal;
}

/** Physical model, thinking level, and optional opaque role for one request. */
export interface ModelRoute<TState = unknown> {
	model: PiModel;
	thinkingLevel: ThinkingLevel;
	/** New router state, stored on the session branch. Must be JSON-serializable. */
	state?: TState;
	/** Label describing this request. pi stores and reports it without interpreting the value. */
	role?: string;
}

/** Virtual model registered via `pi.registerVirtualModel()`. Only the fields spirits sets are mirrored. */
export interface ExtensionVirtualModel<TState = unknown> {
	/** Provider the virtual model is listed under. May be any provider id. */
	provider: string;
	/** Model id. Must not be the id of a physical model of `provider`. */
	id: string;
	name: string;
	/** Thinking levels offered for selection. Defaults to `["off"]`. */
	thinkingLevels?: readonly ThinkingLevel[];
	/** Limits shown before the first response. Unset limits are unknown. */
	contextWindow?: number;
	maxTokens?: number;
	/** Pick the physical model, which must have credentials, and the thinking level for one request. */
	route(request: ModelRouteRequest<TState>, ctx: ExtensionContext): ModelRoute<TState> | Promise<ModelRoute<TState>>;
}

/** Where the `/model` save key writes the default role. pi writes the keys it is given and knows nothing about them. */
export interface ModelRoleSettingsKey {
	/** Top-level settings field, e.g. `"models"`. */
	field: string;
	/** Key inside that field, e.g. `"role"`. */
	key: string;
}

/** Definition passed to `pi.registerModelRoles()`. pi treats a role as an opaque string. */
export interface ModelRoleRegistration {
	/** Role words accepted as the last `/model` argument, matched case-insensitively. */
	roles: readonly string[];
	/** Settings location the `/model` save key writes the default role to. */
	settingsKey: ModelRoleSettingsKey;
	/** Called after `/model` applied a model, whatever the model kind, with the chosen role. */
	onSelect(role: string, ctx: ExtensionContext): void;
}

/**
 * A callable tool as reported on `ExtensionToolContext.tools`. Upstream mirrors it as `AgentTool`
 * (from `pi-agent-core`, not re-exported by `pi-coding-agent`), so spirits mirrors only the fields
 * it reads: the name and the `outputSchema` declaration.
 */
export interface CallableToolInfo {
	name: string;
	/** JSON Schema of `structuredContent`. Absent when the tool declares no machine-readable result. */
	outputSchema?: unknown;
}

/**
 * Context handed to a registered command handler: the event context plus session control.
 *
 * `reload()` replaces this extension runtime, and pi marks the command's `pi` handle and this
 * context stale afterwards, so a handler must not touch either one once `reload()` resolves.
 */
export interface ExtensionCommandContext extends ExtensionContext {
	/** Reload extensions, skills, prompts, themes, and context files. */
	reload(): Promise<void>;
}

/** One completion candidate pi's editor accepts. `label` is what pi renders and re-reads. */
export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

/** One command `pi.getCommands()` reports. Only the fields spirits reads are mirrored. */
export interface SlashCommandInfo {
	/** Invokable name without the leading slash; a skill is `skill:<name>`. */
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

/**
 * A command registered with `pi.registerCommand()`.
 *
 * `getArgumentCompletions` receives only the argument prefix: pi passes no `ExtensionContext`, so a
 * completion cannot reach the model catalog or any other context service (design Decision 8).
 */
export interface RegisteredCommandOptions {
	description?: string;
	getArgumentCompletions?: (
		argumentPrefix: string,
	) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

/**
 * The conversation about to be sent, without the system messages. pi rebuilds it from the session
 * file before every request, so a handler that returns a shorter list is applied to every following
 * request as well.
 */
export interface ContextEvent {
	type: "context";
	messages: AgentMessage[];
}

/** Result of a `context` handler. Absent `messages` leaves the conversation alone. */
export interface ContextEventResult {
	messages?: AgentMessage[];
}

/** What pi prepared for a compaction. Only the fields spirits reads are mirrored. */
export interface CompactionPreparation {
	/** Entry the kept conversation starts at; everything before it is summarized. */
	firstKeptEntryId: string;
	/** Estimated context tokens before the compaction. */
	tokensBefore: number;
}

/** Compaction content an extension hands back from `session_before_compact`. */
export interface CompactionResult {
	summary: string;
	/** Entry the kept conversation starts at. */
	firstKeptEntryId: string;
	tokensBefore: number;
	estimatedTokensAfter?: number;
	details?: unknown;
}

/**
 * Fired before pi compacts the context, for a manual `/compact` and for the automatic paths alike.
 * Note that pi skips a compaction it cannot prepare (a session too small, or one already compacted)
 * *before* dispatching this event, so a handler never sees those attempts.
 */
export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	preparation: CompactionPreparation;
	/** Raw branch entries, in order. */
	branchEntries: SessionEntry[];
	customInstructions?: string;
	/** What triggered the compaction. */
	reason: "manual" | "threshold" | "overflow";
	willRetry: boolean;
	signal: AbortSignal;
}

/** Result of a `session_before_compact` handler. */
export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: CompactionResult;
}

/** Context passed to tool `execute()`: the extension context plus `executeTool()`. */
export interface ExtensionToolContext extends ExtensionContext {
	/** Tools {@link executeTool} can call. */
	readonly tools: readonly CallableToolInfo[];
	/**
	 * Run another tool through the same validation, hooks, and permission checks as
	 * model-issued calls. Never rejects for tool failures.
	 */
	executeTool(name: string, args: unknown, options?: ExecuteToolOptions): Promise<AgentToolCallOutcome>;
}

// ============================================================================
// Tool call events (`tool_call`)
// ============================================================================

/** Identity fields every `tool_call` event carries. */
export interface ToolCallEventBase {
	type: "tool_call";
	/**
	 * The call's id. For a call another tool issued (with `parentToolCallId` set), pi assigns
	 * `<parent id>/<n>`; such an id never appears as a tool call or a tool result in the transcript,
	 * only in the parent result's `nestedCalls` record.
	 */
	toolCallId: string;
	/** Set when another tool (for example a codemode script or a tsrepl cell) issued this call. */
	parentToolCallId?: string;
}

/** Input of pi's bash tool. */
export interface BashToolInput {
	command: string;
	timeout?: number;
}

/** `tool_call` event for pi's bash tool. */
export interface BashToolCallEvent extends ToolCallEventBase {
	toolName: "bash";
	input: BashToolInput;
}

/** `tool_call` event for every tool the guard does not classify. */
export interface OtherToolCallEvent extends ToolCallEventBase {
	toolName: string;
	input: Record<string, unknown>;
}

/**
 * Fired before a tool executes. Can block.
 *
 * pi's union names one member per core tool (`read`, `edit`, `grep`, and so on). Spirits classifies
 * bash and ignores the rest, so this mirror declares bash plus everything else.
 */
export type ToolCallEvent = BashToolCallEvent | OtherToolCallEvent;

/** Result of a `tool_call` handler. `block` stops the tool; `reason` is what the model reads back. */
export interface ToolCallEventResult {
	/** Block tool execution. To modify arguments, mutate `event.input` in place instead. */
	block?: boolean;
	reason?: string;
	/** Hint that the agent should stop after the current tool batch when this call is blocked. */
	terminate?: boolean;
}

/** Tool definition for registerTool(). */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	exposure?: ToolExposure;
	executionMode?: ToolExecutionMode;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ExtensionToolContext,
	): Promise<AgentToolResult<TDetails>>;
}

/** API passed to extension factory functions. */
export interface ExtensionAPI {
	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void;
	/** Append a custom entry to the session for state persistence (not sent to the LLM). */
	appendEntry<T = unknown>(customType: string, data?: T): void;
	/** A copy of the effective settings (global and project merged, with overrides). */
	getSettings(): ExtensionSettings;
	/** Register a virtual model: a selectable catalog entry that routes each request. */
	registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void;
	/** Remove a virtual model registered with `registerVirtualModel()`. */
	unregisterVirtualModel(provider: string, id: string): void;
	/**
	 * Register the `/model` role vocabulary, the settings key that holds the default role, and the
	 * callback for a role chosen through `/model`. One registration is active: registering again
	 * replaces it, which is what an extension reload does.
	 */
	registerModelRoles(definition: ModelRoleRegistration): void;
	/** Register a `/`-command the user can type. The handler gets a command-capable context. */
	registerCommand(name: string, options: RegisteredCommandOptions): void;
	/**
	 * Register a keyboard shortcut, shown in `/hotkeys` by its description. pi resolves conflicts with
	 * a built-in keybinding when it collects the shortcuts: a reserved key drops the extension shortcut
	 * with a warning, a non-reserved one is taken over by the extension, also with a warning.
	 */
	registerShortcut(
		shortcut: KeyId,
		options: {
			description?: string;
			handler: (ctx: ExtensionContext) => Promise<void> | void;
		},
	): void;
	/**
	 * The slash commands a prompt can invoke in this session: extension commands, prompt templates, and
	 * skill commands. `name` is the invokable name without the leading slash, so a skill reads
	 * `skill:<name>` while a template and an extension command read their own name. Built-in
	 * interactive commands (`/model`, `/settings`) are not listed, and nothing from an untrusted project
	 * is listed either — which is why a step's starter is matched against this list rather than a
	 * directory scan (design Decision 9).
	 */
	getCommands(): SlashCommandInfo[];
	/** Select a model for this session without changing the configured default. */
	setModel(model: PiModel): Promise<boolean>;
	/** Current thinking level of the session. */
	getThinkingLevel(): ThinkingLevel;
	/** Set the session's thinking level. */
	setThinkingLevel(level: ThinkingLevel): void;
	/** Subscribe to a session event. Returns an unsubscribe function. */
	on(
		event: "before_agent_start",
		handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
	): () => void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): () => void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): () => void;
	on(
		event: "resources_discover",
		handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>,
	): () => void;
	on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): () => void;
	on(event: "agent_settled", handler: ExtensionHandler<AgentSettledEvent>): () => void;
	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): () => void;
	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): () => void;
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): () => void;
}

/** Extension event handler. Return a result to influence the session, or void to observe only. */
export type ExtensionHandler<E, R = undefined> = (
	event: E,
	ctx: ExtensionContext,
) => Promise<R | void> | R | void;

/**
 * Subset of pi's `NormalizedBuildSystemPromptOptions` that spirits reads or mutates.
 * `sections` is mutable: later handlers observe changes made by earlier handlers.
 */
export interface SystemPromptOptions {
	/** Named prompt sections, wrapped in a tag of the same name when rendered. */
	sections: Record<string, string>;
	/** Complete system prompt override set by an earlier handler. Spirits never sets this. */
	forceSystemPrompt?: string;
}

/** Fired before an agent loop starts. Spirits adds its prompt sections here. */
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	/** The raw user prompt text (after expansion). */
	prompt: string;
	/** Mutable prompt options. Later handlers observe mutations made by earlier handlers. */
	systemPromptOptions: SystemPromptOptions;
}

/** Result of a `before_agent_start` handler. Only the fields spirits reads are mirrored. */
export interface BeforeAgentStartEventResult {
	/** Replace the complete system prompt for this turn. */
	systemPrompt?: string;
}

// ============================================================================
// Session state read by the continual harness
// ============================================================================

/** A user/assistant/tool message entry on the session branch. */
export interface SessionMessageEntry {
	type: "message";
	message: AgentMessage;
	/** See {@link CustomEntry.id}. */
	id?: string;
}

/** An extension-defined entry that is not sent to the LLM. */
export interface CustomEntry<T = unknown> {
	type: "custom";
	customType: string;
	data?: T;
	/**
	 * pi's entry id. pi always writes one; the mirror keeps it optional because the doubles that model
	 * only the shape a reader walks omit it, and a reader has to treat a missing id as unlocatable
	 * rather than guess.
	 */
	id?: string;
}

/**
 * Entry pi writes for a change of its own state. The values are irrelevant here; a branch holds these
 * from the moment pi applies a model or thinking level, which is what tells a fresh session apart from
 * one that has already been asked something.
 */
export interface SessionStateChangeEntry {
	type: "model_change" | "thinking_level_change";
	id?: string;
}

/**
 * pi's compaction entry. A reader uses it to tell which entries a compaction already summarized; an
 * extension supplies one through `session_before_compact`, never through the session manager.
 */
export interface CompactionSessionEntry {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	id?: string;
}

/** Session entry shapes spirits walks on the current branch. */
export type SessionEntry = SessionMessageEntry | CustomEntry | SessionStateChangeEntry | CompactionSessionEntry;

/** One raw entry's contribution to the model context, after context edits. */
export interface ProjectedSessionEntry {
	sourceEntry: SessionEntry;
	/** Model-visible messages of this entry. Empty for state-only entries and omissions. */
	messages: AgentMessage[];
}

/** The context pi would send, built from the branch. */
export interface SessionProjection {
	entries: ProjectedSessionEntry[];
	messages: AgentMessage[];
}

/** Read-only session manager. Spirits resolves the branch and the context built from it. */
export interface ReadonlySessionManager {
	/** Entries from the root to the current leaf, in order. */
	getBranch(): readonly SessionEntry[];
	/** The context projection pi builds from the branch: kept entries and the messages they yield. */
	buildSessionProjection(): SessionProjection;
	/** The context pi builds from the current branch, per contributing entry. */
	buildSessionProjection(): SessionProjection;
}

// ============================================================================
// SDK surface used by the rlm host function
// ============================================================================

/** Session statistics returned by `AgentSession.getSessionStats()`. */
export interface SessionStats {
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}

/** Message shape spirits reads from `AgentSession.messages` and session entries. */
export interface AgentMessage {
	role: string;
	/** Text or content parts as produced by providers. */
	content?: string | readonly (TextContent | ImageContent)[];
	stopReason?: string;
	errorMessage?: string;
	/**
	 * Provider id of an assistant message. pi records the model the request went to, which is the
	 * physical model a virtual selection routed to, and the provider id for a failed route.
	 */
	provider?: string;
	/** Model id of an assistant message, in the same sense as {@link AgentMessage.provider}.
	 * Both are absent on a user, tool-result, or custom message. */
	model?: string;
}

/** Session event shape spirits reads from `AgentSession.subscribe()`. */
export interface AgentSessionEvent {
	type: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	parentToolCallId?: string;
}

/** Child agent session created by `createAgentSession()`. Only the fields spirits calls are mirrored. */
export interface AgentSession {
	prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
	abort(): Promise<void>;
	getLastAssistantText(): string | undefined;
	getSessionStats(): SessionStats;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	dispose(): void;
	/** Bind the loaded extensions, which fires `session_start`. The pin test binds an empty set. */
	bindExtensions(bindings: ExtensionBindings): Promise<void>;
	readonly sessionId: string;
	readonly messages: readonly AgentMessage[];
}

/** Bindings `AgentSession.bindExtensions()` accepts. Every field is optional. */
export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	mode?: ExtensionMode;
	abortHandler?: () => void;
}

/**
 * pi's built-in bash tool. Only the harness test builds one, to read the `promptSnippet` and
 * `promptGuidelines` pi shows for it. Spirits never creates built-in tools.
 */
export function createBashTool(cwd: string): {
	name: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
};

/** Session manager. Spirits uses `inMemory`; pi-runtime tests also use the persisted factories. */
export class SessionManager {
	static inMemory(cwd?: string): SessionManager;
	/** Create a persisted session in `sessionDir` (defaults to the pi session dir for `cwd`). */
	static create(cwd: string, sessionDir?: string): SessionManager;
	/** Open an existing session file. */
	static open(path: string): SessionManager;
	/** Session file path, or undefined for in-memory sessions. */
	getSessionFile(): string | undefined;
	/** Session id, from the header entry. */
	getSessionId(): string;
	/** Entries from the root to the current leaf, in order. */
	getBranch(): readonly SessionEntry[];
	/** The context projection pi builds from the branch: kept entries and the messages they yield. */
	buildSessionProjection(): SessionProjection;
	/** Append a conversation message. The first one flushes the session file to disk. */
	appendMessage(message: AgentMessage & { timestamp?: number }): string;
	/** Append a custom extension entry as a child of the current leaf. */
	appendCustomEntry(customType: string, data?: unknown): string;
	/**
	 * Append a compaction entry: everything before `firstKeptEntryId` leaves the context and the
	 * summary replaces it. Tests build compacted sessions with it; spirits never writes one by hand
	 * except when it takes a compaction over at a clear boundary.
	 */
	appendCompaction(
		summary: string,
		firstKeptEntryId: string | null,
		tokensBefore: number,
		details?: unknown,
		fromHook?: boolean,
	): string;
	/** Append an extension message entry, which does participate in LLM context. */
	appendCustomMessageEntry(customType: string, content: string | unknown[], display: boolean, details?: unknown): string;
	/** Move the leaf to `entryId` (null for the root), so the next entry starts a new branch. */
	branch(entryId: string | null): string | null;
	/** Move the leaf to `entryId` and record a summary of the abandoned path. */
	branchWithSummary(entryId: string | null, summary: string, details?: unknown, fromHook?: boolean): string;
}

/**
 * Project one session entry into the messages sent to the LLM. Plain custom entries — every entry
 * spirits writes through `appendEntry` — project to nothing and stay out of the context.
 */
export function sessionEntryToContextMessages(entry: SessionEntry): unknown[];

/** Settings manager. Only the methods the pi-runtime pin test calls are mirrored. */
export class SettingsManager {
	/** Load global (`<agentDir>/settings.json`) and project settings. */
	static create(cwd: string, agentDir?: string): SettingsManager;
	/** A copy of the effective settings, unknown keys included. */
	getSettings(): ExtensionSettings;
	/** Save the default provider and model id, the way `/model` does. */
	setDefaultModelAndProvider(provider: string, modelId: string): void;
	/** Await queued writes. */
	flush(): Promise<void>;
}

/**
 * Model runtime. Only the members the pi-runtime pin test calls are mirrored. The store options are
 * `unknown` because their interfaces live in pi-ai, whose types spirits does not compile against.
 */
export class ModelRuntime {
	/** Create a runtime. Without `credentials` pi reads the agent directory's credential file. */
	static create(options?: {
		credentials?: unknown;
		modelsStore?: unknown;
		modelsPath?: string | null;
		allowModelNetwork?: boolean;
		refreshOnCreate?: boolean;
	}): Promise<ModelRuntime>;
	/** Register a virtual model: a selectable catalog entry that routes each request. */
	registerVirtualModel(model: ExtensionVirtualModel): void;
	/** Remove a virtual model registered with `registerVirtualModel()`. */
	unregisterVirtualModel(provider: string, id: string): void;
	/**
	 * Register a provider configuration. pi's `ProviderConfigInput` lives outside the mirrored surface,
	 * so the config stays a record: only the pi-runtime pin test registers one.
	 */
	registerProvider(providerId: string, config: Record<string, unknown>): void;
	/**
	 * Ask a virtual model's router for one request. pi throws when the model is not registered, or when
	 * the route has no physical, credentialed target. `messages` stays unknown: pi's transcript types are
	 * outside the mirrored surface, and only the pi-runtime pin test calls this.
	 */
	resolveModel(
		model: PiModel,
		messages: readonly unknown[],
		options: { reason: string; thinkingLevel: ThinkingLevel; state?: unknown },
	): Promise<ModelRoute>;
	/** Reload the model config and catalogs. */
	refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
	/** Models available for selection, virtual entries included. */
	getAvailable(): Promise<PiModel[]>;
	/**
	 * A catalog entry by provider and id, or undefined. Only the pin tests need a model to select, and
	 * `PiModel` is enough for a selection: pi reads the provider and id off it.
	 */
	getModel(provider: string, modelId: string): PiModel | undefined;
}

/** Result of `discoverAndLoadExtensions()`. Only the members the pin test hands to the runner are mirrored. */
export interface LoadExtensionsResult {
	extensions: unknown[];
	errors: Array<{ path: string; error: string }>;
	runtime: unknown;
}

/** Discover and load the extensions of the agent and project directories, the way pi starts a session. */
export function discoverAndLoadExtensions(
	configuredPaths: readonly string[],
	cwd: string,
	agentDir: string,
): Promise<LoadExtensionsResult>;

/** Catalog handle a runner needs. pi constructs it from a `ModelRuntime`. */
export class ModelRegistry {
	constructor(modelRuntime: ModelRuntime);
}

/**
 * Runner that owns the loaded extensions. Only the role surface the pin test uses is mirrored: pi hands
 * the `/model` role to the registration an extension made, and reports the vocabulary to the caller
 * that has to parse the argument.
 */
export class ExtensionRunner {
	constructor(
		extensions: readonly unknown[],
		runtime: unknown,
		cwd: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
	);
	/** The active `pi.registerModelRoles()` registration. */
	getModelRoles(): ModelRoleRegistration | undefined;
	/** Hand the role `/model` chose to the registration, the way interactive mode does. */
	selectModelRole(role: string): void;
}

/** Options for `DefaultResourceLoader`. Only the fields spirits sets are mirrored. */
export interface DefaultResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noContextFiles?: boolean;
}

/** Resource loader. Spirits constructs one with the restricted options and reloads it. */
export class DefaultResourceLoader {
	constructor(options: DefaultResourceLoaderOptions);
	reload(): Promise<void>;
}

/** Options for `createAgentSession()`. Only the fields spirits sets are mirrored. */
export interface CreateAgentSessionOptions {
	cwd?: string;
	agentDir?: string;
	model?: PiModel;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	customTools?: readonly ToolDefinition[];
	sessionManager?: SessionManager;
	resourceLoader?: DefaultResourceLoader;
	/** Runtime to build the session on. The pin test brings its own, so no credential file is read. */
	modelRuntime?: ModelRuntime;
	/** Start with no tools enabled. */
	noTools?: "all" | "builtin";
	/** The `session_start` reason extensions receive, the way the CLI passes it. */
	sessionStartEvent?: SessionStartEvent;
}

/** Result of `createAgentSession()`. Only the fields spirits reads are mirrored. */
export interface CreateAgentSessionResult {
	session: AgentSession;
}

/** Create an AgentSession with the specified options. */
export function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;

/** Get the agent config directory (e.g. `~/.pi/agent/`). */
export function getAgentDir(): string;

/** Parsed YAML frontmatter and the remaining body. */
export interface ParsedFrontmatter<T extends Record<string, unknown> = Record<string, unknown>> {
	frontmatter: T;
	body: string;
}

/** Parse the `---` frontmatter block of a Markdown document (public pi API). */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T>;

// ============================================================================
// Skill loading (priority contract pinned in test/pi-runtime/bundled-skills.test.ts)
// ============================================================================

/** Skill loaded from disk. Only the fields spirits checks are mirrored. */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation: boolean;
}

/** Collision diagnostics carry the winner and the skipped file. */
export interface SkillCollision {
	resourceType: string;
	name: string;
	winnerPath: string;
	loserPath: string;
}

/** Diagnostic emitted by pi's skill loader. */
export interface SkillDiagnostic {
	type: string;
	message: string;
	path?: string;
	collision?: SkillCollision;
}

/** Options for `loadSkills()`. Only the fields spirits passes are mirrored. */
export interface LoadSkillsOptions {
	cwd: string;
	agentDir: string;
	skillPaths: string[];
	includeDefaults: boolean;
}

/** Result of `loadSkills()`. */
export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: SkillDiagnostic[];
}

/** Load skills from the default directories and the given extra paths (first name wins). */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult;

/** Format the model-facing skill list; `disableModelInvocation` skills are omitted. */
export function formatSkillsForPrompt(
	skills: Skill[],
	fileReadTool?: "read" | "bash" | "indirect",
): string;

/** Extension factory function type. Supports both sync and async initialization. */
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

/** Inline extension accepted by `main()`. Mirrors the upstream shape used by the builtin spirits extension. */
export type InlineExtension =
	| ExtensionFactory
	| {
			name: string;
			factory: ExtensionFactory;
			hidden?: boolean;
			replaceable?: boolean;
			builtin?: boolean;
	  };

/** Options for `main()`. Only the fields spirits sets are mirrored. */
export interface MainOptions {
	extensionFactories?: InlineExtension[];
}

/** Run pi with the given argv. */
export function main(args: string[], options?: MainOptions): Promise<void>;
