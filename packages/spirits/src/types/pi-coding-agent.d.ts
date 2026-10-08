/**
 * Minimal local mirror of the upstream pi Extension API surface that spirits uses.
 *
 * The real types live in `packages/coding-agent/src/core/extensions/types.ts`. Spirits
 * does not compile against them directly: doing so pulls the whole pi source tree into
 * the type check, where `@types/bun` globals conflict with pi's Node-targeted types
 * (`ReadableStream`, `path.PlatformPath`). At runtime the extension loader injects the
 * real module (see `core/extensions/virtual-modules.ts`), so only type-only imports
 * appear in spirits source and this file is never loaded.
 *
 * Keep this in sync with the upstream definitions when spirits adopts new API fields.
 */

import type { Static, TSchema } from "typebox";

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

/** Context shared by all extension entry points. Only the fields spirits reads are mirrored. */
export interface ExtensionContext {
	/** Current working directory. */
	cwd: string;
	/** The current abort signal, or undefined when the agent is not streaming. */
	signal: AbortSignal | undefined;
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
}

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
