/**
 * The role phase of one spirits session: the role the session locks, and the strong phase of a
 * target skill run.
 *
 * The phase is extension memory only. A process kill loses it, and `session_start` replaces the
 * lock with the default role (add-model-role-setting design Decision 2 and 10). `route()` reads the
 * value; the event handlers and `setRole()` are the only writers. Re-deciding on every idle input is
 * what keeps a strong phase from surviving a run that never started, and reading the lock instead of
 * normal is what lets `/model <model> strong` hold across runs.
 */

import type { InputEvent } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX, STRONG_PHASE_SKILL_NAMES } from "../constants.ts";

/** How input delivered during streaming joins the run. Undefined when the session is idle. */
type StreamingBehavior = InputEvent["streamingBehavior"];

/** Character that ends the skill name in a `/skill:<name> <args>` command line, as pi splits it. */
const SKILL_NAME_DELIMITER = " ";

/**
 * Skill name the input starts a command for, or undefined when the input is not a skill command. The
 * name ends at the first space or the end of the input, which is exactly how pi's
 * `_expandSkillCommand` reads it: an input pi would not expand as a skill must not enter a strong
 * phase either.
 */
function skillNameFromInput(text: string): string | undefined {
	if (!text.startsWith(SKILL_COMMAND_PREFIX)) return undefined;
	const rest = text.slice(SKILL_COMMAND_PREFIX.length);
	const end = rest.indexOf(SKILL_NAME_DELIMITER);
	return end === -1 ? rest : rest.slice(0, end);
}

/** Role phase read by the router and written by the event handlers. */
export interface RoutingPhase {
	/** Role the next request takes. */
	current(): string;
	/**
	 * Lock the session role, the way `/model <model> <role>` and the default role do. The lock is what
	 * idle inputs and settles return to instead of normal, and it survives the routing model being
	 * deselected: the router only reads it when `spirits/auto` is selected.
	 */
	setRole(role: string): void;
	/**
	 * Decide the phase for one user input. An idle input starts a run and so always decides the phase:
	 * strong for a target skill command, the locked role for anything else. A steer or follow-up input
	 * joins the run in progress and leaves the phase alone.
	 */
	handleInput(text: string, streamingBehavior?: StreamingBehavior): void;
	/** Return to the locked role after a run, aborted or not. */
	settle(): void;
}

/** Build the phase machine for the bundled strong-phase skills. */
export function createRoutingPhase(): RoutingPhase {
	// The lock starts on normal: a session without a default role behaves as it did before roles.
	let lock = MODEL_ROLE_NORMAL;
	let role = MODEL_ROLE_NORMAL;
	return {
		current: () => role,
		setRole(next) {
			lock = next;
			role = next;
		},
		handleInput(text, streamingBehavior) {
			if (streamingBehavior) return;
			// An idle input is always the start of a run, so re-deciding here also drops a strong phase
			// whose run never started (design Decision 6).
			const name = skillNameFromInput(text);
			role = name && STRONG_PHASE_SKILL_NAMES.includes(name) ? MODEL_ROLE_STRONG : lock;
		},
		settle() {
			role = lock;
		},
	};
}
