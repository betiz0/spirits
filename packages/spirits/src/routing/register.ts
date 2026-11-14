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

import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRoute,
	ModelRouteRequest,
	SessionEntry,
	ThinkingLevel,
} from "@earendil-works/pi-coding-agent";
import { readRoutingSettings } from "../config.ts";
import {
	MODEL_ROLE_NORMAL,
	ROUTING_MODEL_ID,
	ROUTING_MODEL_NAME,
	ROUTING_PROVIDER_ID,
	STEP_ENTRY_TYPE,
	THINKING_LEVELS,
} from "../constants.ts";
import type { RoutingPhase } from "./phase.ts";
import { createRoutingPhase, spiritsStepEntry } from "./phase.ts";
import { createNotificationGuard, createRoutingRoute } from "./router.ts";
import { modelKey } from "./resolve.ts";

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
		"current" | "lock" | "setRole" | "restoreLock" | "restoreStep" | "step" | "endStep"
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
	 * Called with the role that will handle a request. The managed route uses it to keep the footer
	 * badge on the role that actually answered, which is not always the session lock.
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
 * The route already carries the role in its result, so this wrapper is the whole observation point:
 * the routing decisions stay in `routing/`, and the host surface that shows the role stays outside.
 */
function wrapRouteReportingRole(
	route: (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute,
	hooks: RoutingHooks,
): (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute {
	const { onRole, onRequest } = hooks;
	if (!onRole && !onRequest) return route;
	return (request, ctx) => {
		const result = route(request, ctx);
		// The hooks report choices the route already made, and each report stands on its own: a footer that
		// will not take a status write must cost the badge alone, not the request record `status` reads
		// (spec `managed-commands` / `/spirits-role status`). Neither may take the user's request down.
		if (result.role) {
			try {
				onRole?.(result.role, ctx);
			} catch {
				// Nothing to report to.
			}
			try {
				onRequest?.({
					role: result.role,
					model: modelKey(result.model),
					...(result.thinkingLevel ? { thinkingLevel: result.thinkingLevel } : {}),
				});
			} catch {
				// Nothing to report to.
			}
		}
		return result;
	};
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
		route: wrapRouteReportingRole(
			createRoutingRoute({
				phase,
				// Read per request: a settings edit or `/reload` takes effect on the next request.
				readSettings: () => readRoutingSettings(pi.getSettings()),
				guard,
				// Resolving a target is the proof that the step's run really started, which is what tells a
				// step whose run never happened to end at the next input.
				onResolved: () => phase.requestResolved(),
			}),
			hooks,
		),
	});

	pi.on("session_start", (event) => {
		const { defaultRole } = readRoutingSettings(pi.getSettings());
		// A reload is the one start that keeps the step; every other start opens a conversation that never
		// had it. The lock then reads as the default role, and the command surface — which owns the session
		// records and runs on this event after this handler — puts back the lock it recorded and, on a
		// reload only, the step that was still running.
		phase.beginSession(event.reason);
		phase.restoreLock(defaultRole ?? MODEL_ROLE_NORMAL);
	});

	pi.on("input", (event) => {
		// pi fires this before expanding a skill command, and `streamingBehavior` says whether the
		// input joins a run in progress or starts one.
		phase.handleInput(event.text, event.streamingBehavior);
	});
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
		},
	};
}
