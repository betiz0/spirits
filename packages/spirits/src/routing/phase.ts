/**
 * The role phase of one spirits session: one value, set by every idle input and reset on settle.
 *
 * The phase is extension memory only. A process kill loses it, and the next process starts on
 * normal (design Decision 6). `route()` reads the value; only the event handlers change it. Setting
 * normal on every idle input is what keeps a strong phase from surviving a run that never started.
 */

import type { InputEvent } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX, STRONG_PHASE_SKILL_NAMES } from "../constants.ts";

/** How input delivered during streaming joins the run. Undefined when the session is idle. */
type StreamingBehavior = InputEvent["streamingBehavior"];

/** Ends the skill name in a `/skill:<name> <args>` command line. */
const COMMAND_NAME_DELIMITER = /\s/;

/** Skill name the input starts a command for, or undefined when the input is not a skill command. */
function skillNameFromInput(text: string): string | undefined {
	if (!text.startsWith(SKILL_COMMAND_PREFIX)) return undefined;
	const rest = text.slice(SKILL_COMMAND_PREFIX.length);
	const end = rest.search(COMMAND_NAME_DELIMITER);
	return end === -1 ? rest : rest.slice(0, end);
}

/** Role phase read by the router and written by the event handlers. */
export interface RoutingPhase {
	/** Role the next request takes. */
	current(): string;
	/**
	 * Decide the phase for one user input. An idle input starts a run and so always decides the phase:
	 * strong for a target skill command, normal for anything else. A steer or follow-up input joins the
	 * run in progress and leaves the phase alone.
	 */
	handleInput(text: string, streamingBehavior?: StreamingBehavior): void;
	/** Return to normal after a run, aborted or not. */
	settle(): void;
}

/** Build the phase machine for the bundled strong-phase skills. */
export function createRoutingPhase(): RoutingPhase {
	let role = MODEL_ROLE_NORMAL;
	return {
		current: () => role,
		handleInput(text, streamingBehavior) {
			if (streamingBehavior) return;
			// An idle input is always the start of a run, so re-deciding here also drops a strong phase
			// whose run never started (design Decision 6).
			const name = skillNameFromInput(text);
			role = name && STRONG_PHASE_SKILL_NAMES.includes(name) ? MODEL_ROLE_STRONG : MODEL_ROLE_NORMAL;
		},
		settle() {
			role = MODEL_ROLE_NORMAL;
		},
	};
}
