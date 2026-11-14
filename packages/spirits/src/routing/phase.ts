/**
 * The role phase of one spirits session: the role the session locks, and the workflow step in effect.
 *
 * The phase is extension memory plus the two session entries the managed route writes. `route()`
 * reads it; the event handlers and `setRole()` are the only writers, and the writers that end a step
 * always say so through {@link RoutingPhase.endStep} so the session record keeps up (design
 * Decision 12).
 *
 * A step is the work interval a starter slash command opens. It survives `agent_settled` when the
 * step continues, which is what makes an answer to the step's question run on the same role (design
 * Decision 2). A step only starts on input pi would actually expand, which is why the starter match
 * consults `pi.getCommands()` instead of trusting the text (design Decision 9).
 */

import type { InputEvent, SessionEntry, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLE_NORMAL, SKILL_COMMAND_PREFIX, STEP_DEFINITIONS, STEP_ENTRY_TYPE } from "../constants.ts";
import type { StepDefinition } from "../constants.ts";

/** How input delivered during streaming joins the run. Undefined when the session is idle. */
type StreamingBehavior = InputEvent["streamingBehavior"];

/** Character that ends the skill name in a `/skill:<name> <args>` command line, as pi splits it. */
const SKILL_NAME_DELIMITER = " ";

/** A step the session is running, resolved against the step list. */
export interface ActiveStep {
	/** Step name, the key of `models.steps.<name>`. */
	name: string;
	/** Role the step list gives it. Absent means the step follows the session lock. */
	defaultRole?: string;
	/** True when the step outlives its run. */
	continuing: boolean;
	/** Starters the step has in this session, in the spelling the user types. */
	starters: readonly string[];
}

/** Hooks the layer above uses to keep the session record and the phase in step. */
export interface RoutingPhaseHooks {
	/**
	 * Called whenever the step changes, with the new name or `null` when the step ended. The managed
	 * route appends a `spirits_step` record, which is what a reload reads back (design Decision 12).
	 */
	onStepChange?: (step: string | null) => void;
}

/** Inputs the phase needs from the host, both read per input rather than cached. */
export interface RoutingPhaseDeps {
	/**
	 * The commands pi would expand in this session. A starter that is not in this list cannot open a
	 * step, which covers an untrusted project, a removed skill, and `--no-skills` in one rule.
	 *
	 * Absent means the caller has no command view at all, in which case no input opens a step and the
	 * phase is the lock alone. The routing layer always passes one; a caller that only exercises locks
	 * does not need the host.
	 */
	listCommands?: () => readonly SlashCommandInfo[];
	hooks?: RoutingPhaseHooks;
}

/**
 * Phase state worth restoring across a runtime reload.
 *
 * The lock and the running step are the only state a reload needs: the resolved flag and the
 * continuing default are derived from the step list, not remembered.
 */
export interface RoutingPhaseSnapshot {
	lock: string;
	step?: string;
}

/** Role phase read by the router and written by the event handlers. */
export interface RoutingPhase {
	/** Role the next request takes: the step's default role, or the lock. */
	current(): string;
	/** The session's own lock, without the running step's default role folded in. */
	lock(): string;
	/**
	 * Lock the session role, the way `/model <model> <role>`, the default role, and `/spirits-role`
	 * do. Locking ends the current step: the spec makes a lock an end condition, so a user who locks
	 * strong in the middle of a step gets strong from the next request onward.
	 */
	setRole(role: string): void;
	/**
	 * Set the lock without touching the step, for a session start that restores what the session
	 * recorded. A restore is not the user asking for a lock, so it must not end the step it restores.
	 */
	restoreLock(role: string): void;
	/**
	 * Decide the phase for one user input. An idle input starts a run and so always decides the phase.
	 * A steer or follow-up input joins the run in progress and leaves step and phase alone.
	 */
	handleInput(text: string, streamingBehavior?: StreamingBehavior): void;
	/** Close the run: a step that does not continue ends here and the phase returns to the lock. */
	settle(): void;
	/** Note that one request of the current run resolved its model, so the step earned its keep. */
	requestResolved(): void;
	/** Step in effect, or undefined when the session runs on the lock alone. */
	step(): ActiveStep | undefined;
	/** End the current step and fall back to the lock. No-op when no step is running. */
	endStep(): void;
	/**
	 * Restore a step name read back from the session record. Unknown names are dropped, so a step
	 * removed from the list cannot come back across a reload.
	 */
	restoreStep(name: string): void;
	/**
	 * Align the running step with the branch a tree move landed on. A name on the step list restores that
	 * step the way a reload does; `{ step: null }`, no record, a name off the list, and a value that is not
	 * a step name all take the step off. Neither path writes a record, because the branch already says what
	 * is running (design Decision 12).
	 */
	followStepRecord(name: string | undefined): void;
	/**
	 * Open a session for one of pi's `session_start` reasons. A reload keeps the step — the runtime was
	 * replaced, not the conversation — and every other start, new or resumed or forked, begins a
	 * conversation that never had the step.
	 */
	beginSession(reason: string): void;
	/** Snapshot of the state a reload restores. */
	snapshot(): RoutingPhaseSnapshot;
	/**
	 * Restore a snapshot read back from the session. Restoring is not a step change and not a user
	 * lock, so it never appends another `spirits_step` record and never ends the step it restores.
	 */
	restore(snapshot: RoutingPhaseSnapshot): void;
}

/**
 * Newest `spirits_step` entry on the branch, or undefined when the branch records no step.
 *
 * A step that has ended appends `{ step: null }`, so the newest record is the answer and a step that
 * is over stays over across a reload (design Decision 12). Both the reload and a tree move read the
 * same record, so the resolution lives here rather than in either caller.
 */
export function spiritsStepEntry(branch: readonly SessionEntry[]): string | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== STEP_ENTRY_TYPE) continue;
		const data = entry.data;
		if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
		const step = (data as Record<string, unknown>).step;
		return typeof step === "string" && step !== "" ? step : undefined;
	}
	return undefined;
}

/** The invokable name of a starter as `pi.getCommands()` spells it: the starter without its slash. */
function starterCommand(starter: string): string {
	return starter.startsWith("/") ? starter.slice(1) : starter;
}

/**
 * The command name a line of input invokes, in pi's spelling, or undefined when the input is not a
 * slash command.
 *
 * The name range follows pi's own expansion: a skill name runs from after `/skill:` to the first
 * space, anything else runs from after the slash to the first whitespace character. An input whose
 * name pi would read differently — a newline where a space belongs — is therefore not a command here
 * either, and does not open a step.
 */
function commandNameFromInput(text: string): string | undefined {
	if (!text.startsWith("/")) return undefined;
	if (text.startsWith(SKILL_COMMAND_PREFIX)) {
		const rest = text.slice(SKILL_COMMAND_PREFIX.length);
		const end = rest.indexOf(SKILL_NAME_DELIMITER);
		return `skill:${end === -1 ? rest : rest.slice(0, end)}`;
	}
	const rest = text.slice(1);
	const end = rest.search(/\s/);
	return end === -1 ? rest : rest.slice(0, end);
}

/** Build the phase machine for the steps of {@link STEP_DEFINITIONS}. */
export function createRoutingPhase(deps: RoutingPhaseDeps = {}): RoutingPhase {
	// The lock starts on normal: a session without a default role behaves as it did before roles.
	let lock = MODEL_ROLE_NORMAL;
	let active: ActiveStep | undefined;
	// Whether the current step resolved at least one request. A step whose run never started — a
	// credential error, or another extension handling the input — must not reach the next run.
	let resolved = false;

	const notify = (name: string | null): void => {
		try {
			deps.hooks?.onStepChange?.(name);
		} catch {
			// The record is a convenience for a reload; a host that refuses an entry must not take the
			// user's request down with it.
		}
	};

	/** Put `definition` in effect, recording nothing and saying nothing. */
	const activate = (definition: StepDefinition): void => {
		active = {
			name: definition.name,
			...(definition.defaultRole ? { defaultRole: definition.defaultRole } : {}),
			continuing: definition.continuing,
			starters: definition.starters,
		};
	};

	/** Make `definition` the step the user's input opened, and record it for a reload to read back. */
	const begin = (definition: StepDefinition): void => {
		activate(definition);
		resolved = false;
		notify(definition.name);
	};

	const end = (): void => {
		if (!active) return;
		active = undefined;
		resolved = false;
		notify(null);
	};

	return {
		current: () => active?.defaultRole ?? lock,
		lock: () => lock,
		setRole(role) {
			// A lock is an end condition for the step, and the role of the run in progress follows it.
			end();
			lock = role;
		},
		restoreLock(role) {
			lock = role;
		},
		handleInput(text, streamingBehavior) {
			// A steer or follow-up joins the run in progress: it changes no step and no phase.
			if (streamingBehavior) return;

			const commands = deps.listCommands?.() ?? [];
			const name = commandNameFromInput(text);
			// The command has to be one pi would really expand: an input that only looks like a starter is
			// plain text to pi, and plain text starts no step. This one rule covers a removed skill, an
			// untrusted project, and `--no-skills` (spec `dual-model-routing` / 開始コマンドの判定).
			const starter =
				name === undefined
					? undefined
					: STEP_DEFINITIONS.find(
							(step) =>
								step.starters.some((candidate) => starterCommand(candidate) === name) &&
								commands.some((command) => command.name === name && command.source !== "extension"),
						);

			// An idle input is the start of a run, so a step that never got a request is over before the new
			// input is read — unless this input opens a step of its own, which replaces it in one record.
			if (!starter && active && !resolved) end();
			if (name === undefined) return;

			if (starter) {
				// Another step's starter replaces the running one, which is how `/opsx-propose` followed
				// by `/opsx-apply` moves the session to the new step.
				begin(starter);
				return;
			}

			// A skill or template pi would expand, but that no step lists, ends the step: the conversation
			// left the listed workflow. An extension command (`/spirits-clear`, `/model`) is not that, so
			// only a command pi reports from a skill or a template ends here.
			const expanded = commands.some((command) => command.name === name && command.source !== "extension");
			if (expanded) end();
		},
		settle() {
			// A continuing step keeps its role through the gap between runs; one that does not continue
			// is over, aborted or not, which is what makes this handler a finally for the run.
			if (active && !active.continuing) end();
		},
		requestResolved() {
			if (active) resolved = true;
		},
		step: () => active,
		endStep: end,
		beginSession(reason) {
			if (reason === "reload") return;
			end();
		},
		restoreStep(name) {
			const definition = STEP_DEFINITIONS.find((step) => step.name === name);
			if (!definition) return;
			// Not `begin()`: reading a record back is not a step change, and appending the same name on
			// every reload would grow the session file for doing nothing.
			activate(definition);
			// A restored step is already past its start; the reload proves the run that opened it was
			// real, so the next idle input does not drop it for want of a request.
			resolved = true;
		},
		followStepRecord(name) {
			const definition = name === undefined ? undefined : STEP_DEFINITIONS.find((step) => step.name === name);
			if (!definition) {
				// The branch this move landed on has no open step: `{ step: null }`, no record at all, a name
				// off the list, or a value that is not a step name. Clearing is not ending: `end()` records the
				// end on the leaf the user just moved to, which would invent a fact the branch never had.
				// `restoreStep` is not the path here either — it ignores a name off the list, which would keep
				// the step from before the move running until a reload took it away (d-verify4 C-3).
				active = undefined;
				resolved = false;
				return;
			}
			this.restoreStep(definition.name);
		},
		snapshot: () => ({
			lock,
			...(active ? { step: active.name } : {}),
		}),
		restore(restored) {
			lock = restored.lock;
			if (restored.step === undefined) {
				active = undefined;
				resolved = false;
				return;
			}
			const definition = STEP_DEFINITIONS.find((step) => step.name === restored.step);
			if (!definition) {
				active = undefined;
				resolved = false;
				return;
			}
			activate(definition);
			// The reload proves the step's run was real; it must survive the next idle input.
			resolved = true;
		},
	};
}
