/**
 * Registration and event wiring of `spirits/auto`.
 *
 * The virtual model registers when the extension loads, not on `session_start`, so the selection
 * survives `/reload` whatever the session_start reason (design Decision 2). The skill commands drive
 * the role phase, and `agent_settled` ends the run: it clears the phase and the notice guard together
 * (design Decisions 6 and 8). `/model` sets the lock through the role vocabulary registered with pi
 * (add-model-role-setting design Decision 9), and `session_start` replaces the lock with the default
 * role (Decision 10).
 */

import type {
	ExtensionAPI,
	SessionEntry,
	SessionStartEvent,
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
} from "../constants.ts";
import { createRoutingPhase } from "./phase.ts";
import { createNotificationGuard, createRoutingRoute } from "./router.ts";

/**
 * Every thinking level is offered for selection: the route passes the selection through and pi
 * clamps it to the routed model, so a virtual level needs no per-role mapping. This is a copy of pi's
 * list, so `test/pi-runtime/virtual-model-api.test.ts` pins it against what pi builds for the entry.
 */
export const ALL_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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
function isUnaskedSession(event: SessionStartEvent, branch: readonly SessionEntry[]): boolean {
	if (event.reason !== "new" && event.reason !== "startup") return false;
	return !branch.some((entry) => entry.type === "message");
}

/** Register `spirits/auto` and wire the skill phase, the `/model` roles, and the default role to it. */
export function registerDualModelRouting(pi: ExtensionAPI): void {
	const phase = createRoutingPhase();
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
		}),
	});

	// pi passes the role of `/model <model> [level] <role>` back here after it applied the model, for
	// a physical model as well as for `spirits/auto` (design Decision 7).
	pi.registerModelRoles({
		roles: MODEL_ROLES,
		settingsKey: { field: SETTINGS_KEY_MODELS, key: SETTINGS_KEY_ROLE },
		onSelect: (role) => phase.setRole(role),
	});

	pi.on("session_start", (event, ctx) => {
		// Every start, `/reload` included, replaces the lock: an Enter-set lock is not saved, so it
		// ends here and the default role takes over (design Decision 10).
		const { defaultRole } = readRoutingSettings(pi.getSettings());
		phase.setRole(defaultRole ?? MODEL_ROLE_NORMAL);
		if (!defaultRole) return;

		// Record the role only where a request would otherwise be the first badge on a new session:
		// `spirits/auto` selected on a branch that carries no role yet (design Decision 6).
		const branch = ctx.sessionManager.getBranch();
		if (!isUnaskedSession(event, branch)) return;
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
	pi.on("agent_settled", () => {
		// The run is over whatever its outcome, so a strong phase never outlives it.
		phase.settle();
		guard.settle();
	});
}
