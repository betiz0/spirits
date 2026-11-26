/**
 * Registration and event wiring of `spirits/auto`.
 *
 * The virtual model registers when the extension loads, not on `session_start`, so the selection
 * survives `/reload` whatever the session_start reason (design Decision 2). The slash inputs drive the
 * step phase, and `agent_settled` ends the run: it closes a step that does not continue and clears the
 * notice guard (design Decisions 2 and 8). `/spirits-role <role>` sets the lock, and the host keeps no
 * part in it: what this layer asks of the host is the virtual model and the events.
 *
 * A reload replaces this runtime, so the phase starts empty every time and what survives is only what
 * the session recorded. Restoring that is the command surface's job — it owns the entries — and this
 * layer only hands the phase to it.
 */

import type { ExtensionAPI, ExtensionContext, InputEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../types/host.ts";
import { readRoutingSettings } from "../config.ts";
import {
	EXTENSION_MODE_RPC,
	EXTENSION_MODE_TUI,
	FIT_BLOCK_CAUSES,
	FIT_GATE_INFLIGHT_NOTICE,
	fitBlockNotice,
	type FitBlockCause,
	INPUT_SOURCE_EXTENSION,
	MODEL_ROLE_NORMAL,
	ROUTING_MODEL_ID,
	ROUTING_MODEL_NAME,
	ROUTING_PROVIDER_ID,
	SHELL_INPUT_PREFIX,
	STEP_ENTRY_TYPE,
	THINKING_LEVELS,
	isRoutingModel,
} from "../constants.ts";
import { estimateConversationTokens, overFitThreshold, readFitCompaction } from "./fit.ts";
import type { RoutingPhase } from "./phase.ts";
import { commandNameFromInput, createRoutingPhase, spiritsStepEntry } from "./phase.ts";
import { resolveRequestPlan } from "./plan.ts";
import { createNotificationGuard, createRoutingRoute, type RouteDecision } from "./router.ts";
import { latestSuccessfulModel, modelKey } from "./resolve.ts";

/**
 * Every thinking level is offered for selection: the route passes the selection through and pi
 * clamps it to the routed model, so a virtual level needs no per-role mapping. This is pi's list read
 * from the shared vocabulary, so `test/pi-runtime/virtual-model-api.test.ts` pins it against what pi
 * builds for the entry.
 */
export const ALL_THINKING_LEVELS: readonly ThinkingLevel[] = THINKING_LEVELS;

/** What the routing registered. */
export interface RoutingRegistrationResult {
	/**
	 * View of the role phase, for the readers outside this layer: the entry layer hands it to the
	 * child-model resolution, so a child of an `spirits/auto` parent follows the step, and the managed
	 * commands lock the role and read the running step through it.
	 */
	phase: Pick<
		RoutingPhase,
		| "current"
		| "lock"
		| "setRole"
		| "restoreLock"
		| "restoreStep"
		| "step"
		| "endStep"
		| "undoInput"
		| "undoToken"
		| "rejectStep"
		| "stepStartedByInput"
	>;
}

/**
 * What one request the routing answered, as the command surface reports it.
 *
 * This is the routing layer's own record of its last decision, not something read back out of the
 * session: pi's message entries carry the physical model but neither the role nor the level the request
 * asked for, and the level is the one thing `status` has to distinguish from the level the model ended
 * up using (spec `managed-commands` / `/spirits-role status`).
 */
export interface RoutedRequest {
	/** Role the route settled on, which is not always the session lock. */
	role: string;
	/** Physical model that answers, in `provider/id` spelling. */
	model: string;
	/** Thinking level the request asked for, before pi rounded it to the model. */
	thinkingLevel?: string;
}

/** Observers a host attaches to the routing decisions. */
export interface RoutingHooks {
	/**
	 * Called with the role that will handle a request, which is not always the session lock.
	 *
	 * An observer only: the managed route no longer draws anything from here. Its badge is a projection of
	 * the session's state, drawn by the command surface at every point that state can change, so a line fed
	 * by requests would go stale in a session that makes none (spec `managed-commands` /
	 * badge は状態の射影を決められた時点で描き直す).
	 */
	onRole?: (role: string, ctx: ExtensionContext) => void;
	/**
	 * Called with everything one request resolved to, role included. The managed command surface keeps the
	 * last one so `status` can report the request that ran rather than the setting it hopes for.
	 */
	onRequest?: (request: RoutedRequest) => void;
}

/**
 * Report the role a route chose, then hand the route back to pi unchanged.
 *
 * The route decides the role and hands it to this reporter rather than to its result, which the host
 * owns (spec `dual-model-routing` / ModelRoute の role は使わない): the routing decisions stay in
 * `routing/`, and the host surface that shows the role stays outside.
 */
function reportRouteDecision(hooks: RoutingHooks): (decision: RouteDecision, ctx: ExtensionContext) => void {
	const { onRole, onRequest } = hooks;
	return (decision, ctx) => {
		// The hooks report choices the route already made, and each report stands on its own: a footer that
		// will not take a status write must cost the badge alone, not the request record `status` reads
		// (spec `managed-commands` / `/spirits-role status`). Neither may take the user's request down.
		try {
			onRole?.(decision.role, ctx);
		} catch {
			// Nothing to report to.
		}
		try {
			onRequest?.({
				role: decision.role,
				model: modelKey(decision.model),
				...(decision.thinkingLevel ? { thinkingLevel: decision.thinkingLevel } : {}),
			});
		} catch {
			// Nothing to report to.
		}
	};
}

/**
 * Put a refused input's text back into the editor by append.
 *
 * Append, not set: refusals arrive one after another while the gate's compaction is in flight (the
 * terminal queues lines typed during a compaction and delivers them at its end), and a set would
 * wipe the earlier texts. RPC reads an empty editor back and its set request is the host's
 * best-effort either way, which is what makes the block notice's warning honest.
 */
function restoreInputText(ctx: ExtensionContext, text: string): void {
	try {
		ctx.ui.setEditorText(`${ctx.ui.getEditorText() ?? ""}${text}`);
	} catch {
		// An editor that will not take text back is exactly the path the notice warns about.
	}
}

/**
 * Run pi's compaction and wait for the one callback the host reports.
 *
 * `ctx.compact()` is fire-and-forget; the wait is what makes the idle `input` handler the one
 * boundary where "compact, re-measure, then decide" can run (design Decision D1). The settled guard
 * keeps a host that reported both ways from resolving twice.
 */
function aheadCompaction(ctx: ExtensionContext): Promise<{ kind: "complete" } | { kind: "error"; message: string }> {
	return new Promise((resolve) => {
		let settled = false;
		ctx.compact({
			onComplete: () => {
				if (settled) return;
				settled = true;
				resolve({ kind: "complete" });
			},
			onError: (error: Error) => {
				if (settled) return;
				settled = true;
				resolve({ kind: "error", message: error.message });
			},
		});
	});
}

/** Register `spirits/auto` and wire the step phase and the default role to it. */
export function registerDualModelRouting(pi: ExtensionAPI, hooks: RoutingHooks = {}): RoutingRegistrationResult {
	const phase = createRoutingPhase({
		listCommands: () => pi.getCommands(),
		hooks: {
			onStepChange: (step) => {
				// The step record is all a reload and a branch move read back, so every change is written as
				// it happens.
				pi.appendEntry(STEP_ENTRY_TYPE, { step });
			},
		},
	});
	const guard = createNotificationGuard();

	pi.registerVirtualModel({
		provider: ROUTING_PROVIDER_ID,
		id: ROUTING_MODEL_ID,
		name: ROUTING_MODEL_NAME,
		thinkingLevels: ALL_THINKING_LEVELS,
		route: createRoutingRoute({
			phase,
			// Read per request: a settings edit or `/reload` takes effect on the next request.
			readSettings: () => readRoutingSettings(pi.getSettings()),
			guard,
			// The gate's summary rule: only while its ahead compaction is in flight, and only for the
			// `direct` request that carries the conversation being compacted (design Decision D4).
			gateInFlight: () => gateInFlight,
			readCompaction: (model) => readFitCompaction(pi.getSettings(), model),
			// Resolving a target is the proof that the step's run really started, which is what tells a
			// step whose run never happened to end at the next input.
			onResolved: () => phase.requestResolved(),
			...(hooks.onRole || hooks.onRequest ? { onRoute: reportRouteDecision(hooks) } : {}),
		}),
	});

	pi.on("session_start", (event) => {
		const { defaultRole } = readRoutingSettings(pi.getSettings());
		// A reload is the one start that keeps the step in memory; every other start opens a conversation
		// that never had it. The lock then reads as the default role, and the command surface — which owns
		// the session records and runs on this event after this handler — puts back the lock and the step the
		// branch recorded, which is what makes a reopened session continue where it left off.
		phase.beginSession(event.reason);
		phase.restoreLock(defaultRole ?? MODEL_ROLE_NORMAL);
	});

	// ------------------------------------------------------------------
	// Context fit gate (fit-gate change, design Decisions D1, D6, D7, D8, D10)
	// ------------------------------------------------------------------

	// The in-flight fact: set synchronously before the compaction path's first await and lowered by
	// the gate handler's finally at every exit. Not `session_compact`, not `compaction_end`, not
	// `before_agent_start` — clearing on an event would open the window where a queued input starts
	// its own run before the original input continues.
	let gateInFlight = false;
	// The host reports a cancelled compaction on this event with its `cancelled` flag; reading the
	// flag beats matching the host's error string (tasks 5.3: host wording is observation, not contract).
	let gateCompactionCancelled = false;

	// Registered before the phase handler on purpose: an input that reached the phase handler while
	// the gate compacts would overwrite the single pending-undo slot and disarm the rollback of the
	// input the gate is waiting for (design Decision D10).
	pi.on("input", (event, ctx) => {
		if (!gateInFlight) return undefined;
		restoreInputText(ctx, event.text);
		ctx.ui.notify(FIT_GATE_INFLIGHT_NOTICE, "warning");
		return { action: "handled" as const };
	});

	pi.on("input", (event) => {
		// pi fires this before expanding a skill command, and `streamingBehavior` says whether the
		// input joins a run in progress or starts one.
		phase.handleInput(event.text, event.streamingBehavior);
	});

	pi.on("input", async (event, ctx) => {
		if (!gateInScope(event, ctx)) return undefined;
		// The token names this input to the phase's rollback, read before anything is waited for.
		const token = phase.undoToken();
		const raw = pi.getSettings();
		const lookup = ctx.modelRegistry;
		const step = phase.step();
		// The same composition `route()` will make for this input: the step the input just opened,
		// the settings, and pi's `previous`, so the gate measures against the model that answers.
		const previous = latestSuccessfulModel(ctx.sessionManager.getBranch(), lookup).model;
		const plan = resolveRequestPlan({
			...(step ? { step } : {}),
			settings: readRoutingSettings(raw),
			phaseRole: phase.current(),
			lookup,
			...(previous ? { previous: { model: previous } } : {}),
		});
		const target = plan.model;
		// No target means the route itself will end the request with its own error; the gate has no
		// window to measure against and fails open.
		if (!target) return undefined;
		const compaction = readFitCompaction(raw, target);
		const estimate = estimateConversationTokens(ctx.sessionManager.buildSessionProjection().messages, event.text);
		if (!overFitThreshold(estimate, target.contextWindow, compaction.reserveTokens)) return undefined;

		const block = (cause: FitBlockCause, measured: number, detail?: string) => {
			// The same rollback the step-start confirmation uses: the phase goes back where this input
			// found it, and the record it writes is what a reload reads back (design Decision D6).
			phase.undoInput(token);
			restoreInputText(ctx, event.text);
			ctx.ui.notify(
				fitBlockNotice({
					model: modelKey(target),
					contextWindow: target.contextWindow,
					threshold: target.contextWindow - compaction.reserveTokens,
					estimate: measured,
					keepRecentTokens: compaction.keepRecentTokens,
					cause,
					...(detail ? { detail } : {}),
					// The terminal's editor takes the text back; every other path only asks the host to.
					restoreUncertain: ctx.mode !== EXTENSION_MODE_TUI,
				}),
				"warning",
			);
			return { action: "handled" as const };
		};

		// pi's own compaction switch, switched off, is respected: nothing is compacted and the
		// over-threshold request is still refused with the same threshold (design Decision D8).
		if (!compaction.enabled) return block(FIT_BLOCK_CAUSES.compactionDisabled, estimate);

		// Set synchronously, before the compaction path's first await, so a racing input that reaches
		// the guard handler while this one waits is rejected (design Decision D10).
		gateInFlight = true;
		gateCompactionCancelled = false;
		try {
			const outcome = await aheadCompaction(ctx);
			if (outcome.kind === "error") {
				return block(
					gateCompactionCancelled ? FIT_BLOCK_CAUSES.cancelled : FIT_BLOCK_CAUSES.compactionFailed,
					estimate,
					outcome.message,
				);
			}
			// Re-measure with the same reading: projection rebuilt after the compaction entry, the
			// still-unsent input line included.
			const after = estimateConversationTokens(ctx.sessionManager.buildSessionProjection().messages, event.text);
			if (!overFitThreshold(after, target.contextWindow, compaction.reserveTokens)) {
				return { action: "continue" as const };
			}
			return block(FIT_BLOCK_CAUSES.stillOver, after);
		} finally {
			gateInFlight = false;
		}
	});

	pi.on("session_compact_failed", (event) => {
		if (gateInFlight && event.aborted === true) gateCompactionCancelled = true;
	});

	/**
	 * Whether this input is the gate's to judge: an idle model request in a routed session.
	 *
	 * A steering input joins a run the gate cannot interrupt, an extension-sent input has nobody to
	 * refuse, a shell line and an empty line start no request, and a session on a physical model is
	 * pi's to manage — routing is off there. A command name pi resolves from an extension source is
	 * out of scope too, as a guard: the host dispatches those before the `input` event today, and a
	 * gate that refused one would take `/spirits-role status` down with it. Skills and prompt
	 * templates stay in scope, judged on their unexpanded text (design Decision D7).
	 */
	function gateInScope(event: InputEvent, ctx: ExtensionContext): boolean {
		if (ctx.mode !== EXTENSION_MODE_TUI && ctx.mode !== EXTENSION_MODE_RPC) return false;
		if (event.source === INPUT_SOURCE_EXTENSION) return false;
		if (event.streamingBehavior !== undefined) return false;
		if (!isRoutingModel(ctx.model)) return false;
		if (event.text.trim() === "") return false;
		if (event.text.startsWith(SHELL_INPUT_PREFIX)) return false;
		const name = commandNameFromInput(event.text);
		return (
			name === undefined ||
			!pi.getCommands().some((command) => command.name === name && command.source === "extension")
		);
	}
	pi.on("session_tree", (_event, ctx) => {
		// A tree move does not start a session; the branch behind the running runtime changes. The step has
		// to follow the branch the user landed on, or a later reload restores a step this branch never had
		// (design Decision 12). The record already says what runs, so nothing is appended here.
		phase.followStepRecord(spiritsStepEntry(ctx.sessionManager.getBranch()));
	});
	pi.on("agent_settled", () => {
		// The run is over whatever its outcome: a step that does not continue ends here, and the notice
		// guard lets every reason report again in the next run.
		phase.settle();
		guard.settle();
	});
	return {
		phase: {
			current: phase.current,
			lock: phase.lock,
			setRole: phase.setRole,
			restoreLock: phase.restoreLock,
			restoreStep: phase.restoreStep,
			step: phase.step,
			endStep: phase.endStep,
			undoInput: phase.undoInput,
			undoToken: phase.undoToken,
			rejectStep: phase.rejectStep,
			stepStartedByInput: phase.stepStartedByInput,
		},
	};
}
