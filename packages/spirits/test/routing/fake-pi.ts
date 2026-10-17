/**
 * Test doubles shared by the routing tests.
 *
 * `FakePi` records the virtual model the extension registers and the event handlers it subscribes
 * to, and can fire events the way pi does. `fakeCatalog` is the `ExtensionContext` a route reads.
 */

import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	ExtensionVirtualModel,
	InputEvent,
	InputEventResult,
	ModelRouteRequest,
	PiModel,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionStartEvent,
	SessionTreeEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

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
	settings: Record<string, unknown> = {};

	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void {
		this.tools.push(tool as ToolDefinition);
	}

	appendEntry(): void {}

	getSettings(): Record<string, unknown> {
		return this.settings;
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

/** Extension context backed by a catalog, capturing the notices the route emits. */
export function fakeCatalog(options: { available: readonly PiModel[]; authedProviders?: readonly string[] } = {
	available: [],
}): { ctx: ExtensionContext; notices: string[] } {
	const authed = new Set(options.authedProviders ?? []);
	const notices: string[] = [];
	return {
		notices,
		ctx: {
			ui: { setHeader: () => {}, setWidget: () => {}, notify: (message: string) => notices.push(message) },
			modelRegistry: {
				getAvailable: () => [...options.available],
				find: (provider: string, modelId: string) =>
					options.available.find((model) => model.provider === provider && model.id === modelId),
				hasConfiguredAuth: (model: PiModel) => authed.has(model.provider),
			},
		} as unknown as ExtensionContext,
	};
}
