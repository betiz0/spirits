/**
 * Test doubles shared by the routing tests.
 *
 * `FakePi` records the virtual model the extension registers and the event handlers it subscribes
 * to, and can fire events the way pi does. `fakeCatalog` is the `ExtensionContext` a route reads.
 */

import type {
	AgentMessage,
	AgentSettledEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionHandler,
	ExtensionToolContext,
	ExtensionVirtualModel,
	InputEvent,
	InputEventResult,
	ModelRoleRegistration,
	ModelRouteRequest,
	PiModel,
	RegisteredCommandOptions,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionEntry,
	SessionStartEvent,
	SessionTreeEvent,
	ThinkingLevel,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { PI_VIRTUAL_MODEL_API } from "../../src/constants.ts";

type RecordedHandler = (event: unknown, ctx: ExtensionContext) => unknown;

export class FakePi implements ExtensionAPI {
	readonly tools: ToolDefinition[] = [];
	readonly registrations: ExtensionVirtualModel[] = [];
	/** Handlers by event type, in registration order. */
	readonly handlers = new Map<string, RecordedHandler[]>();
	/** The unsubscribe function `on()` handed back per registration, in the same order. */
	readonly unsubscribers = new Map<string, Array<() => void>>();
	/** Errors thrown by a handler while firing an event, collected the way pi reports them. */
	readonly errors: unknown[] = [];
	/** Entries passed to `appendEntry()`, in order. */
	readonly entries: Array<{ customType: string; data: unknown }> = [];
	/** The `registerModelRoles()` registration, which a re-registration replaces. */
	modelRoles?: ModelRoleRegistration;
	settings: Record<string, unknown> = {};
	/** Commands registered through `registerCommand()`, in registration order. */
	readonly commands = new Map<string, RegisteredCommandOptions>();
	/** Models handed to `setModel()`, in order. */
	readonly modelChanges: PiModel[] = [];
	/** Thinking levels handed to `setThinkingLevel()`, in order. */
	readonly thinkingChanges: ThinkingLevel[] = [];
	/** When set, `setModel()` refuses the way pi refuses a model it cannot select. */
	refuseModelChange = false;

	registerCommand(name: string, options: RegisteredCommandOptions): void {
		this.commands.set(name, options);
	}

	async setModel(model: PiModel): Promise<boolean> {
		if (this.refuseModelChange) return false;
		this.modelChanges.push(model);
		return true;
	}

	getThinkingLevel(): ThinkingLevel {
		return this.thinkingChanges.at(-1) ?? "off";
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.thinkingChanges.push(level);
	}

	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void {
		this.tools.push(tool as ToolDefinition);
	}

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}

	getSettings(): Record<string, unknown> {
		return this.settings;
	}

	registerModelRoles(definition: ModelRoleRegistration): void {
		this.modelRoles = definition;
	}

	registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void {
		this.registrations.push(model as ExtensionVirtualModel);
	}

	unregisterVirtualModel(): void {}

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
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): () => void;
	on(event: string, handler: unknown): () => void {
		const list = this.handlers.get(event) ?? [];
		const recorded = handler as RecordedHandler;
		list.push(recorded);
		this.handlers.set(event, list);
		const unsubscribe = () => {
			const index = list.indexOf(recorded);
			if (index !== -1) list.splice(index, 1);
		};
		const unsubscribers = this.unsubscribers.get(event) ?? [];
		unsubscribers.push(unsubscribe);
		this.unsubscribers.set(event, unsubscribers);
		return unsubscribe;
	}


	handlersFor(event: string): number {
		return (this.handlers.get(event) ?? []).length;
	}

	/** Fire an event through the recorded handlers, collecting handler errors like pi reports them. */
	async fire(event: string, payload: unknown, ctx: ExtensionContext): Promise<void> {
		for (const handler of [...(this.handlers.get(event) ?? [])]) {
			try {
				await handler(payload, ctx);
			} catch (error) {
				this.errors.push(error);
			}
		}
	}

	/** The route of the last registration, which is the live one: re-registering replaces it. */
	route(): (request: ModelRouteRequest, ctx: ExtensionContext) => unknown {
		const model = this.registrations.at(-1);
		if (!model) throw new Error("no virtual model registered");
		return model.route as (request: ModelRouteRequest, ctx: ExtensionContext) => unknown;
	}
}

/**
 * Input event payload with the given text, as pi fires it before expanding the text. `steer` and
 * `followUp` deliver the input into a run in progress; the default is an idle input that starts one.
 */
export function makeInputEvent(text: string, streamingBehavior?: "steer" | "followUp"): unknown {
	return { type: "input", text, source: "interactive", streamingBehavior };
}

/** `agent_settled` payload with the given abort flag. */
export function makeSettledEvent(aborted = false): unknown {
	return { type: "agent_settled", aborted };
}

/** A routing request as pi would build one for the `spirits/auto` selection. */
export function makeRequest(overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
	return {
		model: { provider: "spirits", id: "auto" },
		thinkingLevel: "medium",
		reason: "user",
		...overrides,
	};
}

/** A custom entry as pi stores it, for building a fake session branch. */
export function makeCustomEntry(customType: string, data: unknown): SessionEntry {
	return { type: "custom", customType, data };
}

/** A message entry as pi stores it. Its presence is what makes a session an already asked one. */
export function makeMessageEntry(): SessionEntry {
	const message: AgentMessage = { role: "user", content: "asked" };
	return { type: "message", message };
}

/** One of the entries pi writes for its own state changes, on a branch from the launch on. */
export function makeStateChangeEntry(type: "model_change" | "thinking_level_change"): SessionEntry {
	return { type };
}

/**
 * Extension context backed by a catalog, capturing the notices the route emits. `model` is the
 * session selection and `branch` the entries `ctx.sessionManager.getBranch()` reports.
 */
export function fakeCatalog(options: {
	available?: readonly PiModel[];
	authedProviders?: readonly string[];
	model?: PiModel;
	branch?: readonly SessionEntry[];
} = {}): { ctx: ExtensionContext; notices: string[]; statuses: Map<string, string | undefined> } {
	const authed = new Set(options.authedProviders ?? []);
	const notices: string[] = [];
	const statuses = new Map<string, string | undefined>();
	return {
		notices,
		statuses,
		ctx: {
			ui: {
				setHeader: () => {},
				setWidget: () => {},
				notify: (message: string) => notices.push(message),
				setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
			},
			model: options.model,
			// pi's projection contributes one model-visible message per conversation entry and none
			// for state-only entries, which is what a clear boundary counts.
			sessionManager: {
				getBranch: () => [...(options.branch ?? [])],
				buildSessionProjection: () => ({
					entries: (options.branch ?? []).map((entry) => ({
						sourceEntry: entry,
						messages: entry.type === "message" ? [entry.message] : [],
					})),
					messages: [],
				}),
			},
			modelRegistry: {
				getAvailable: () => [...(options.available ?? [])],
				find: (provider: string, modelId: string) =>
					(options.available ?? []).find((model) => model.provider === provider && model.id === modelId),
				hasConfiguredAuth: (model: PiModel) => authed.has(model.provider),
			},
		} as unknown as ExtensionContext,
	};
}

/**
 * Tool context backed by the same catalog and branch reads `fakeCatalog` builds, because a tool call
 * carries them there. `notices` is what a child-model resolution must never write to.
 */
export function fakeToolContext(
	options: {
		available?: readonly PiModel[];
		authedProviders?: readonly string[];
		branch?: readonly SessionEntry[];
	} = {},
): { ctx: ExtensionToolContext; notices: string[] } {
	const { ctx, notices } = fakeCatalog(options);
	return {
		notices,
		ctx: {
			...ctx,
			cwd: "/work",
			signal: undefined,
			tools: [],
			executeTool: async () => ({ toolCall: {}, result: { content: [], details: undefined }, isError: false }),
		},
	} as unknown as { ctx: ExtensionToolContext; notices: string[] };
}

/**
 * Assistant message entry as pi stores it: the model that answered (the physical model a virtual
 * selection routed to) and how the response ended.
 */
export function makeAssistantEntry(provider: string, modelId: string, stopReason = "stop"): SessionEntry {
	return { type: "message", message: { role: "assistant", content: [], provider, model: modelId, stopReason } };
}

/** A user message entry: pi stores no model on it. */
export function makeUserEntry(text: string): SessionEntry {
	return { type: "message", message: { role: "user", content: text } };
}

/**
 * The `spirits/auto` selection, as pi reports it on the context of a session that chose it. pi's
 * catalog entry carries the virtual api id, which is how a reader tells it from a physical model.
 */
export const AUTO_SELECTION: PiModel = { provider: "spirits", id: "auto", api: PI_VIRTUAL_MODEL_API };

/**
 * Command context: the event context plus the `reload()` a command handler gets. `reloads` counts
 * them, because "nothing runs after reload" is a rule a test has to be able to see.
 */
export function fakeCommandContext(
	options: Parameters<typeof fakeCatalog>[0] = {},
): { ctx: ExtensionCommandContext; notices: string[]; statuses: Map<string, string | undefined>; reloads: () => number } {
	const { ctx, notices, statuses } = fakeCatalog(options);
	let reloadCount = 0;
	return {
		notices,
		statuses,
		reloads: () => reloadCount,
		ctx: { ...ctx, reload: async () => { reloadCount += 1; } } as ExtensionCommandContext,
	};
}
