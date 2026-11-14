/**
 * Registration and event wiring of `spirits/auto`.
 *
 * The virtual model registers when the extension loads, not on `session_start`, so the selection
 * survives `/reload` whatever the session_start reason (design Decision 2). The slash inputs drive the
 * step phase, and `agent_settled` ends the run: it closes a step that does not continue and clears the
 * notice guard (design Decisions 2 and 8). `/model` sets the lock through the role vocabulary
 * registered with pi (add-model-role-setting design Decision 9).
 *
 * A reload replaces this runtime, so the phase starts empty every time and what survives is only what
 * the session recorded. Restoring that is the managed command surface's job — it owns the entries — and
 * this layer only hands the phase to it and hands the default role to a start that records nothing.
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
	MODEL_ROLES,
	MODEL_ROLE_NORMAL,
	ROUTING_MODEL_ID,
	ROUTING_MODEL_NAME,
	ROUTING_PROVIDER_ID,
	ROUTING_STATE_ENTRY_TYPE,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
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

/** Data of a `pi.virtual-model-state` entry. pi owns the type but exports it to extensions, so spirits mirrors it. */
interface RoutingRecordData {
	provider: string;
	modelId: string;
	/** Router state of the record. Carried along so a new record never drops it. */
	state?: unknown;
	/** Role label the footer badge reads. Absent on a record written before roles existed. */
	role?: string;
}

/**
 * Latest routing record of `spirits/auto` on the branch, or undefined when the branch has none. The
 * same scan pi does for the badge and the router state, because spirits cannot call it.
 */
function latestRoutingRecord(branch: readonly SessionEntry[]): RoutingRecordData | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== ROUTING_STATE_ENTRY_TYPE) continue;
		const data = entry.data as RoutingRecordData | undefined;
		if (data?.provider === ROUTING_PROVIDER_ID && data.modelId === ROUTING_MODEL_ID) return data;
	}
	return undefined;
}

/**
 * Whether this start is a session nothing has been asked in yet: `/new`, or a launch that created the
 * session. pi cannot be trusted on its own here. It reports `startup` both for a launch that creates a
 * session and for one that opens an existing file, and it writes its own `model_change` and
 * `thinking_level_change` entries before it fires the event, so a fresh session's branch is no longer
 * empty. What separates the two is a message entry: nothing was asked in this session before, so
 * recording the default role here changes a session file nobody has written a request to yet
 * (add-model-role-setting design Decision 6).
 */
function isUnaskedSession(reason: string, branch: readonly SessionEntry[]): boolean {
	if (reason !== "new" && reason !== "startup") return false;
	return !branch.some((entry) => entry.type === "message");
}

/** What the host supported when the routing was registered. */
export interface RoutingRegistrationResult {
	/** True when the optional role registration API exists on this host. */
	roleApi: boolean;
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

/** The optional piece of the host API the official Pi 1.5.0 does not provide. */
type RoleCapablePi = Pick<ExtensionAPI, "registerModelRoles">;

/** Read the optional role API without pretending it exists. */
function getRegisterModelRoles(pi: ExtensionAPI): RoleCapablePi["registerModelRoles"] | undefined {
	const candidate = (pi as Partial<RoleCapablePi>).registerModelRoles;
	return typeof candidate === "function" ? candidate.bind(pi) : undefined;
}

const DEGRADED_ROLE_NOTICE =
	"spirits: host has no role API. Model routing and the workflow steps work; /model role, saved default roles, and the role badge are unavailable.";

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

/** Register `spirits/auto` and wire the step phase, the `/model` roles, and the default role to it. */
export function registerDualModelRouting(pi: ExtensionAPI, hooks: RoutingHooks = {}): RoutingRegistrationResult {
	// `registerModelRoles` is read before the phase exists, because the phase is built with a hook that
	// has to know which route it is on: only the managed route writes the step record.
	const registerModelRoles = getRegisterModelRoles(pi);
	const phase = createRoutingPhase({
		listCommands: () => pi.getCommands(),
		hooks: {
			onStepChange: (step) => {
				// The fork route records nothing here: its role lives in pi's own routing-state entry, and
				// a step the fork cannot restore is a record the user never reads.
				if (registerModelRoles) return;
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

	// pi passes the role of `/model <model> [level] <role>` back here after it applied the model, for
	// a physical model as well as for `spirits/auto` (design Decision 7). A host without the role API
	// still gets the virtual model and the phase; only this registration and the badge record are lost.
	if (registerModelRoles) {
		registerModelRoles({
			roles: MODEL_ROLES,
			settingsKey: { field: SETTINGS_KEY_MODELS, key: SETTINGS_KEY_ROLE },
			onSelect: (role) => phase.setRole(role),
		});
	}

	let degradedNoticeSent = false;
	pi.on("session_start", (event, ctx) => {
		const { defaultRole } = readRoutingSettings(pi.getSettings());
		// A reload is the one start that keeps the step; every other start opens a conversation that never
		// had it. The lock then reads as the default role, and the managed command surface — which owns the
		// session records and runs on this event after this handler — puts back the lock it recorded and,
		// on a reload only, the step that was still running.
		phase.beginSession(event.reason);
		phase.restoreLock(defaultRole ?? MODEL_ROLE_NORMAL);
		if (!registerModelRoles && !degradedNoticeSent) {
			degradedNoticeSent = true;
			ctx.ui.notify(DEGRADED_ROLE_NOTICE, "warning");
		}
		// Do not write a role field when the host has no role surface: it would imply the badge and
		// `/model ... role` work. The routing phase still applies to the request.
		if (!registerModelRoles || !defaultRole) return;

		// Record the role only where a request would otherwise be the first badge on a new session:
		// `spirits/auto` selected on a branch that carries no role yet (design Decision 6).
		const branch = ctx.sessionManager.getBranch();
		if (!isUnaskedSession(event.reason, branch)) return;
		if (ctx.model?.provider !== ROUTING_PROVIDER_ID || ctx.model.id !== ROUTING_MODEL_ID) return;
		const record = latestRoutingRecord(branch);
		if (record?.role !== undefined) return;

		const data: RoutingRecordData = { provider: ROUTING_PROVIDER_ID, modelId: ROUTING_MODEL_ID, role: defaultRole };
		// The entry carries the router state as well as the role: writing the role alone would drop it.
		if (record?.state !== undefined) data.state = record.state;
		pi.appendEntry(ROUTING_STATE_ENTRY_TYPE, data);
	});

	pi.on("input", (event) => {
		// pi fires this before expanding a skill command, and `streamingBehavior` says whether the
		// input joins a run in progress or starts one.
		phase.handleInput(event.text, event.streamingBehavior);
	});
	// Following the record is a managed-route rule. The fork route never writes `spirits_step`
	// (`onStepChange` returns there), so reading a branch there always finds "no record" and would drop a
	// step that is still running (d-verify4 C-4). A fork step ends only on the phase's own end conditions.
	if (!registerModelRoles) {
		pi.on("session_tree", (_event, ctx) => {
			// A tree move does not start a session; the branch behind the running runtime changes. The step has
			// to follow the branch the user landed on, or a later reload restores a step this branch never had
			// (design Decision 12). The record already says what runs, so nothing is appended here.
			phase.followStepRecord(spiritsStepEntry(ctx.sessionManager.getBranch()));
		});
	}
	pi.on("agent_settled", () => {
		// The run is over whatever its outcome: a step that does not continue ends here, and the notice
		// guard lets every reason report again in the next run.
		phase.settle();
		guard.settle();
	});
	return {
		roleApi: registerModelRoles !== undefined,
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
