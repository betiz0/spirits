/**
 * The host API names spirits uses, taken from the published host packages.
 *
 * The published `@earendil-works/pi-coding-agent` exports its own interfaces (`ExtensionAPI`,
 * `ExtensionContext`, `ToolDefinition`, ...) but not the names of the values those interfaces carry:
 * a model handle, a thinking level, the model catalog, the session reader, a tool-call outcome.
 * Spirits names those here by reading them back out of the exported interfaces, so a host change is
 * a `tsc` error on the member spirits actually calls, not a drift between the host and a
 * hand-written copy. Nothing in this file restates a host member, which is what makes it not a type
 * mirror: delete the host package and nothing here can keep working, so nothing here can go stale.
 *
 * The TUI-side names come from `@earendil-works/pi-tui`, whose package root is a published entry
 * point. Spirits imports no host subpath and declares no ambient module (see the
 * `architecture-conventions` specification and `docs/architecture/convention-registry.md`).
 */

import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	RegisteredCommand,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";


/** A model handle, as the host reports it on a context and accepts in `setModel()`. */
export type PiModel = NonNullable<ExtensionContext["model"]>;

/** A thinking level, as the host reports it for a session. */
export type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** The run mode the host reports on every context. */
export type ExtensionMode = ExtensionContext["mode"];

/** The model catalog a router resolves its targets against. */
export type ExtensionModelRegistry = ExtensionContext["modelRegistry"];

/** The session reader spirits walks for its own entries and for the last answered model. */
export type ReadonlySessionManager = ExtensionContext["sessionManager"];

/** One message of the transcript a `context` event hands an extension. */
export type AgentMessage = ContextEvent["messages"][number];

/** A tool a tool context can call, as the host reports it on the context. */
export type CallableToolInfo = ExtensionToolContext["tools"][number];

/** What a nested tool call came back as, success or failure. */
export type AgentToolCallOutcome = Awaited<ReturnType<ExtensionToolContext["executeTool"]>>;

/** The structured payload a tool result may carry, which spirits passes through its own tools. */
export type JsonValue = NonNullable<AgentToolCallOutcome["result"]["structuredContent"]>;

/** The options object `registerCommand()` takes, before pi adds the name and the source info. */
export type RegisteredCommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

/**
 * One tool definition, erased of its parameter schema and its details type.
 *
 * The host lists erased definitions wherever several tools travel together — `createAgentSession()`'s
 * `customTools`, and nothing in spirits registers a tool through a list — so a definition built with
 * a concrete schema cannot be *stored* in one of those lists: the erased form declares
 * `renderCall` and `prepareArguments` over `Static<TSchema>`, which a concrete schema's own argument
 * type does not accept in reverse. Passing a definition straight to the host's generic
 * `registerTool()` needs no widening. This is the one place that widens, and the only reason it may:
 * the value is already a definition the host accepts, and no list of them survives into a call.
 */
export type AnyToolDefinition = ToolDefinition;

/**
 * A definition built for one schema that also fits the lists above.
 *
 * `defineTool()`, the host's own identity helper for this purpose, returns a definition together with
 * its erased form, so a tool built through it needs no widening to travel as one.
 */
export type BuiltTool<TParams extends TSchema, TDetails> = ToolDefinition<TParams, TDetails> & AnyToolDefinition;

export type { AutocompleteItem, Component, KeyId, TUI } from "@earendil-works/pi-tui";
