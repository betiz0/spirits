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

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Minimal view of a pi-ai model. */
export interface PiModel {
	provider: string;
	id: string;
	/**
	 * pi's api id. A virtual catalog entry is `"pi-virtual"`, which pi does not export a helper for
	 * outside its package. Absent on test doubles.
	 */
	api?: string;
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

/** Effective settings subset the spirits extension reads. */
export interface ExtensionSettings {
	quietStartup?: boolean | "header";
	/**
	 * spirits-owned settings keys. pi's `Settings` type does not declare them; pi keeps unknown
	 * keys in the settings file when it saves a known setting, so no core change is needed.
	 */
	models?: { strong?: string };
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

/** Context passed to tool `execute()`: the extension context plus `executeTool()`. */
export interface ExtensionToolContext extends ExtensionContext {
	/** Tools {@link executeTool} can call. */
	readonly tools: readonly unknown[];
	/**
	 * Run another tool through the same validation, hooks, and permission checks as
	 * model-issued calls. Never rejects for tool failures.
	 */
	executeTool(name: string, args: unknown, options?: ExecuteToolOptions): Promise<AgentToolCallOutcome>;
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
}

/** An extension-defined entry that is not sent to the LLM. */
export interface CustomEntry<T = unknown> {
	type: "custom";
	customType: string;
	data?: T;
}

/** Session entry shapes spirits walks on the current branch. */
export type SessionEntry = SessionMessageEntry | CustomEntry;

/** Read-only session manager. Spirits only resolves the current branch. */
export interface ReadonlySessionManager {
	/** Entries from the root to the current leaf, in order. */
	getBranch(): readonly SessionEntry[];
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
	readonly sessionId: string;
	readonly messages: readonly AgentMessage[];
}

/** Session manager. Spirits uses `inMemory`; pi-runtime tests also use the persisted factories. */
export class SessionManager {
	static inMemory(cwd?: string): SessionManager;
	/** Create a persisted session in `sessionDir` (defaults to the pi session dir for `cwd`). */
	static create(cwd: string, sessionDir?: string): SessionManager;
	/** Open an existing session file. */
	static open(path: string): SessionManager;
	/** Session file path, or undefined for in-memory sessions. */
	getSessionFile(): string | undefined;
	/** Entries from the root to the current leaf, in order. */
	getBranch(): readonly SessionEntry[];
	/** Append a conversation message. The first one flushes the session file to disk. */
	appendMessage(message: AgentMessage & { timestamp?: number }): string;
	/** Append a custom extension entry as a child of the current leaf. */
	appendCustomEntry(customType: string, data?: unknown): string;
}

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
	/** Reload the model config and catalogs. */
	refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
	/** Models available for selection, virtual entries included. */
	getAvailable(): Promise<PiModel[]>;
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
