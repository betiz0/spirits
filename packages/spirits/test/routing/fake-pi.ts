/**
 * Test doubles shared by the routing tests.
 *
 * `FakePi` records the virtual model the extension registers and the event handlers it subscribes
 * to, and can fire events the way pi does. `fakeCatalog` is the `ExtensionContext` a route reads.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionToolContext,
	ExtensionUIContext,
	ExtensionVirtualModel,
	ModelRouteRequest,
	SessionEntry,
	SlashCommandInfo,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	ExtensionMode,
	PiModel,
	RegisteredCommandOptions,
	ScopedModel,
	ThinkingLevel,
} from "../../src/types/host.ts";
import type { TSchema } from "typebox";
import {
	asExtensionApi,
	assistantEntry,
	customEntry,
	fakeCommandContext as hostCommandContext,
	fakeContext,
	fakeCustomScreen,
	fakeModel,
	fakeModelRegistry,
	fakeProjection,
	fakeSessionManager,
	fakeToolCallOutcome,
	fakeToolContext as hostToolContext,
	fakeUi,
	hostEventRegistrar,
	messageEntry,
	modelChangeEntry,
	nextEntryId,
	slashCommandInfo,
	thinkingLevelChangeEntry,
	type StopReason,
	userMessage,
} from "../host/fake-pi.ts";
import { registerDualModelRouting, type RoutingHooks, type RoutingRegistrationResult } from "../../src/routing/register.ts";
import { PI_VIRTUAL_MODEL_API } from "../../src/constants.ts";
import type { RecordedShortcut } from "../support.ts";

type RecordedHandler = (event: unknown, ctx: ExtensionContext) => unknown;

export class FakePi {
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
	settings: Record<string, unknown> = {};
	/** Commands registered through `registerCommand()`, in registration order. */
	readonly commands = new Map<string, RegisteredCommandOptions>();
	/** Shortcuts registered through `registerShortcut()`, keyed by the key id as registered. */
	readonly shortcuts = new Map<string, RecordedShortcut>();
	/** Models handed to `setModel()`, in order. */
	readonly modelChanges: PiModel[] = [];
	/** Thinking levels handed to `setThinkingLevel()`, in order. */
	readonly thinkingChanges: ThinkingLevel[] = [];
	/** When set, `setModel()` refuses the way pi refuses a model it cannot select. */
	refuseModelChange = false;

	registerCommand(name: string, options: RegisteredCommandOptions): void {
		this.commands.set(name, options);
	}

	/**
	 * Prompt templates and skills the session has, in pi's `getCommands()` shape. A test that drives a
	 * step's starter command puts that starter here.
	 */
	slashCommands: SlashCommandInfo[] = [];

	/** pi's command list: this host's registered commands first, then what the test installed. */
	getCommands(): SlashCommandInfo[] {
		return [
			...[...this.commands.keys()].map((name) => slashCommandInfo(name)),
			...this.slashCommands,
		];
	}

	registerShortcut(shortcut: string, options: RecordedShortcut): void {
		this.shortcuts.set(shortcut, options);
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

	/** Declared by the host API, used by no spirits code. */
	registerModelRoles(): void {}

	registerVirtualModel<TState = unknown>(model: ExtensionVirtualModel<TState>): void {
		this.registrations.push(model as ExtensionVirtualModel);
	}

	unregisterVirtualModel(): void {}

	/**
	 * The host's own `on()` type, recording into `handlers` and `unsubscribers`.
	 *
	 * The host declares `on()` once per event type, so a fake that named one overload per event it
	 * happens to use cannot satisfy that member. The recorder takes the host's member type and hands the
	 * handler back to the test's own map, which is what `fire()` and `handlersFor()` read.
	 */
	readonly on: ExtensionAPI["on"] = hostEventRegistrar(this.handlers, this.unsubscribers);

	handlersFor(event: string): number {
		return (this.handlers.get(event) ?? []).length;
	}

	/**
	 * Fire an event through the recorded handlers, collecting handler errors like pi reports them.
	 *
	 * The results come back in registration order, because an `input` handler's answer is the thing a test
	 * needs: pi stops at the first `handled` and sends nothing, and a step the user stopped is only stopped
	 * if that answer is there.
	 */
	async fire(event: string, payload: unknown, ctx: ExtensionContext): Promise<unknown[]> {
		const results: unknown[] = [];
		for (const handler of [...(this.handlers.get(event) ?? [])]) {
			try {
				results.push(await handler(payload, ctx));
			} catch (error) {
				this.errors.push(error);
			}
		}
		return results;
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
export function makeInputEvent(
	text: string,
	streamingBehavior?: "steer" | "followUp",
	source: "interactive" | "rpc" | "extension" = "interactive",
): unknown {
	return { type: "input", text, source, streamingBehavior };
}

/** `agent_settled` payload with the given abort flag. */
export function makeSettledEvent(aborted = false): unknown {
	return { type: "agent_settled", aborted };
}

/**
 * `model_select` payload as pi fires it when the selection changes.
 *
 * pi names how the change happened: `set` for `/model`, `cycle` for the model-cycle shortcut, and
 * `restore` for a selection the session took back. The step-start badge redraw reads the event, not the
 * reason, so a test picks whichever reason it wants to stand behind the change.
 */
export function makeModelSelectEvent(model: PiModel, previousModel?: PiModel, source: "set" | "cycle" | "restore" = "set"): unknown {
	return { type: "model_select", model, previousModel, source };
}

/**
 * `thinking_level_select` payload as pi fires it.
 *
 * pi fires only when the resolved level really changed, so `previousLevel` is whatever the session
 * carried before.
 */
export function makeThinkingLevelSelectEvent(level: ThinkingLevel, previousLevel: ThinkingLevel = "off"): unknown {
	return { type: "thinking_level_select", level, previousLevel };
}

/** A routing request as pi would build one for the `spirits/auto` selection. */
export function makeRequest(overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
	// pi always hands the route the conversation, so an override that names none still asks with one.
	const { messages = [], ...rest } = overrides;
	return {
		model: fakeModel("spirits", "auto"),
		thinkingLevel: "medium",
		reason: "user",
		messages,
		...rest,
	};
}

/** A custom entry as pi stores it, for building a fake session branch. */
export function makeCustomEntry(customType: string, data: unknown): SessionEntry {
	return customEntry(customType, data, nextEntryId());
}

/** A message entry as pi stores it. Its presence is what makes a session an already asked one. */
export function makeMessageEntry(): SessionEntry {
	const message: AgentMessage = userMessage("asked");
	return messageEntry(message, nextEntryId());
}

/** One of the entries pi writes for its own state changes, on a branch from the launch on. */
export function makeStateChangeEntry(type: "model_change" | "thinking_level_change"): SessionEntry {
	return type === "model_change"
		? modelChangeEntry("anthropic", "claude-sonnet-4-5", nextEntryId())
		: thinkingLevelChangeEntry("high", nextEntryId());
}

/**
 * Extension context backed by a catalog, capturing the notices the route emits. `model` is the
 * session selection and `branch` the entries `ctx.sessionManager.getBranch()` reports.
 */
/** What a fake host is asked to show through `ctx.ui.custom()`. */
export interface FakeCustomUi {
	/** The components the factories returned, in call order. */
	readonly components: unknown[];
}

/**
 * How the fake answers one `ctx.ui.select()`.
 *
 * The host closes a selector on a choice, on Esc, on its own countdown, and on an `abort` of the
 * `signal` the caller handed it, and the last three all come back as `undefined`. A test therefore says
 * which of the four it stands for rather than handing over a bare value, which is the only way to tell
 * "the wait ran out" from "the user closed it" in a test.
 */
export interface FakeSelectBehavior {
	/** Resolve with this choice. An absent value stands for an Esc typed at once. */
	value?: string;
	/** Wait this long, then resolve `undefined` the way an Esc does. */
	escAfterMs?: number;
	/** Resolve `undefined` when the caller's `signal` aborts, which is how a timeout reaches the caller. */
	abortAsCancel?: boolean;
	/** Throw instead of showing the dialog, the way a host that refuses it does. */
	error?: string;
	/**
	 * Runs while the dialog is held open, before the answer arrives.
	 *
	 * The host awaits an `input` handler with the dialog on screen, so the session keeps living — another
	 * extension's input can start a step, `/tree` can move the branch — while the answer is still out. This is
	 * the only way a test can put something in that window.
	 */
	during?: () => void | Promise<void>;
}

/** One call an extension made through `ctx.ui.select()`. */
export interface FakeSelectCall {
	title: string;
	options: string[];
	timeout?: number;
	signal?: AbortSignal;
}

/** The `ui.select` double and the calls it recorded. */
export interface FakeSelect {
	/** Every call, in order, with the `timeout` and `signal` the extension passed. */
	readonly calls: FakeSelectCall[];
	readonly select: ExtensionUIContext["select"];
}

/** Build the `ui.select` double out of the answer one test wants. */
export function fakeSelect(behavior: FakeSelectBehavior = {}): FakeSelect {
	const calls: FakeSelectCall[] = [];
	const select: ExtensionUIContext["select"] = async (title, options, opts) => {
		calls.push({
			title,
			options: [...options],
			...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
			...(opts?.signal === undefined ? {} : { signal: opts.signal }),
		});
		if (behavior.error !== undefined) throw new Error(behavior.error);
		if (behavior.during) await behavior.during();
		if (behavior.escAfterMs !== undefined) await new Promise((resolve) => setTimeout(resolve, behavior.escAfterMs));
		if (behavior.abortAsCancel) await aborted(opts?.signal);
		return behavior.value;
	};
	return { calls, select };
}

/** Resolves when `signal` aborts, so a fake can stand for the host closing the dialog on it. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) throw new Error("the fake select was told to close on abort, but the caller gave no signal");
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/** One entry of a session's model scope, as `ctx.scopedModels` reports it. */
export function scopedModel(model: PiModel): ScopedModel {
	return { model };
}

export function fakeCatalog(options: {
	available?: readonly PiModel[];
	authedProviders?: readonly string[];
	model?: PiModel;
	branch?: readonly SessionEntry[];
	/** Run mode pi reports. Defaults to `tui`, the mode a custom screen may open in. */
	mode?: ExtensionMode;
	/** Thinking level the session selected, which is what a role or step level overrides. */
	thinkingLevel?: ThinkingLevel;
	/**
	 * The session's model scope, as pi resolves it from `--models` / `enabledModels`. Empty means every
	 * available model is usable, which is what pi's own reader reports for an unscoped session.
	 */
	scopedModels?: readonly ScopedModel[];
	/** How `ui.select()` answers. Absent means the session has no dialog-capable host to ask. */
	select?: FakeSelectBehavior;
	/**
	 * Providers an extension registered, as `modelRegistry.getRegisteredProviderIds()` reports them.
	 * Absent leaves the method out, which is the shape of a host that publishes no provenance; the
	 * default reports a known-empty list, the shape of the pinned host when nothing registered one.
	 */
	registeredProviders?: readonly string[];
	/** The value `custom()` hands back, standing for the result a closed screen reports. */
	customResult?: unknown;
	/**
	 * Runs after the custom screen is built, standing for the edits the user makes in it. It is handed the
	 * component the factory returned, so a test can drive a screen with keys rather than calling its
	 * callbacks directly — which is the only way to test the wiring of a pi-tui component.
	 */
	onCustom?: (component: unknown) => void;
} = {}): {
	ctx: ExtensionContext;
	notices: string[];
	/** The notices with the type each was sent as, which is what a test of the notice's kind reads. */
	notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
	statuses: Map<string, string | undefined>;
	custom: FakeCustomUi;
	/** The `ui.select()` calls, in order, only when the test gave a `select` behavior. */
	selects?: FakeSelectCall[];
} {
	const authed = new Set(options.authedProviders ?? []);
	const notices: string[] = [];
	const notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }> = [];
	const statuses = new Map<string, string | undefined>();
	const components: unknown[] = [];
	const custom: FakeCustomUi = { components };
	const selector = options.select === undefined ? undefined : fakeSelect(options.select);
	return {
		notices,
		notifications,
		statuses,
		custom,
		...(selector ? { selects: selector.calls } : {}),
		ctx: fakeContext({
			ui: fakeUi({
				setHeader: () => {},
				setWidget: () => {},
				notify: (message: string, type?: "info" | "warning" | "error") => {
					notifications.push({ message, type });
					notices.push(message);
				},
				setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
				...(selector ? { select: selector.select } : {}),
				// pi's `custom()` builds the component through the factory and resolves with what `done()`
				// carries. The fake runs the factory with a `done` that closes at once, so a test sees the
				// component the screen built without a terminal in front of it.
				custom: fakeCustomScreen({ components, onCustom: options.onCustom, customResult: options.customResult }),
			}),
			mode: options.mode ?? "tui",
			thinkingLevel: options.thinkingLevel,
			scopedModels: options.scopedModels ?? [],
			model: options.model,
			// pi's projection contributes one model-visible message per conversation entry and none
			// for state-only entries, which is what a clear boundary counts.
			sessionManager: fakeSessionManager({
				getBranch: () => [...(options.branch ?? [])],
				buildSessionProjection: () =>
					fakeProjection({
						entries: (options.branch ?? []).map((entry) => ({
							sourceEntry: entry,
							messages: entry.type === "message" ? [entry.message] : [],
						})),
					}),
			}),
			modelRegistry: fakeModelRegistry({
				getAvailable: () => [...(options.available ?? [])],
				find: (provider: string, modelId: string) =>
					(options.available ?? []).find((model) => model.provider === provider && model.id === modelId),
				hasConfiguredAuth: (model: PiModel) => authed.has(model.provider),
				...(options.registeredProviders === undefined
					? { getRegisteredProviderIds: () => [] }
					: { getRegisteredProviderIds: () => [...options.registeredProviders!] }),
			}),
		}),
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
		/** Thinking level the session selected, which the child's resolution reads. */
		thinkingLevel?: ThinkingLevel;
	} = {},
): { ctx: ExtensionToolContext; notices: string[] } {
	const { ctx, notices } = fakeCatalog(options);
	return {
		notices,
		ctx: hostToolContext({
			...ctx,
			cwd: "/work",
			signal: undefined,
			tools: [],
			executeTool: async () => fakeToolCallOutcome(),
		}),
	};
}

/**
 * Assistant message entry as pi stores it: the model that answered (the physical model a virtual
 * selection routed to) and how the response ended.
 */
export function makeAssistantEntry(provider: string, modelId: string, stopReason: StopReason = "stop"): SessionEntry {
	return assistantEntry(provider, modelId, stopReason, nextEntryId());
}

/** A user message entry: pi stores no model on it. */
export function makeUserEntry(text: string): SessionEntry {
	return messageEntry(userMessage(text), nextEntryId());
}

/**
 * The `spirits/auto` selection, as pi reports it on the context of a session that chose it. pi's
 * catalog entry carries the virtual api id, which is how a reader tells it from a physical model.
 */
export const AUTO_SELECTION: PiModel = fakeModel("spirits", "auto", { api: PI_VIRTUAL_MODEL_API });

/**
 * Command context: the event context plus the `reload()` a command handler gets. `reloads` counts
 * them, because "nothing runs after reload" is a rule a test has to be able to see.
 */
export function fakeCommandContext(
	options: Parameters<typeof fakeCatalog>[0] & { reloadError?: string } = {},
): {
	ctx: ExtensionCommandContext;
	notices: string[];
	notifications: Array<{ message: string; type: "info" | "warning" | "error" | undefined }>;
	statuses: Map<string, string | undefined>;
	custom: FakeCustomUi;
	selects?: FakeSelectCall[];
	reloads: () => number;
} {
	const { ctx, notices, notifications, statuses, custom, selects } = fakeCatalog(options);
	let reloadCount = 0;
	return {
		notices,
		notifications,
		statuses,
		custom,
		...(selects ? { selects } : {}),
		reloads: () => reloadCount,
		ctx: hostCommandContext({ ...ctx, reload: async () => {
				reloadCount += 1;
				if (options.reloadError !== undefined) throw new Error(options.reloadError);
			} }),
	};
}

/**
 * The routing registered with its role reports kept, for a test that needs the role a request took.
 *
 * The route result the host reads names the model and the thinking level and nothing else: the role is
 * the routing's own report (spec `dual-model-routing` / ModelRoute の role は使わない). A test that wants
 * the role registers through here and reads `lastRole()` after the request, instead of asking the
 * result for a key the host never had.
 */
export interface ReportedRouting extends RoutingRegistrationResult {
	/** The roles in the order the route reported them. */
	readonly roles: string[];
	/** The role of the newest report, or undefined when no request has resolved yet. */
	lastRole(): string | undefined;
}

/** `registerDualModelRouting` plus the role reports, which the host's result does not carry. */
export function registerReportedRouting(pi: Parameters<typeof registerDualModelRouting>[0], hooks: RoutingHooks = {}): ReportedRouting {
	const roles: string[] = [];
	const routing = registerDualModelRouting(asExtensionApi(pi), {
		...hooks,
		onRole: (role, ctx) => {
			roles.push(role);
			hooks.onRole?.(role, ctx);
		},
	});
	return { ...routing, roles, lastRole: () => roles.at(-1) };
}
