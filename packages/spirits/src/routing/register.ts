/**
 * Registration and event wiring of `spirits/auto`.
 *
 * The virtual model registers when the extension loads, not on `session_start`, so the selection
 * survives `/reload` whatever the session_start reason (design Decision 2). The skill commands drive
 * the role phase, and `agent_settled` ends the run: it clears the phase and the notice guard together
 * (design Decisions 6 and 8).
 */

import type { ExtensionAPI, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { readRoutingSettings } from "../config.ts";
import { ROUTING_MODEL_ID, ROUTING_MODEL_NAME, ROUTING_PROVIDER_ID } from "../constants.ts";
import { createRoutingPhase } from "./phase.ts";
import { createNotificationGuard, createRoutingRoute } from "./router.ts";

/**
 * Every thinking level is offered for selection: the route passes the selection through and pi
 * clamps it to the routed model, so a virtual level needs no per-role mapping.
 */
const ALL_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Register `spirits/auto` and wire the skill phase to it. */
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
