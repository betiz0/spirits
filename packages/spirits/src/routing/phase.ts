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
	 * Put the step back where the input {@link undoToken} named found it, for a user who stopped that input
	 * before it was sent.
	 *
	 * The step an input opened is a fact about an input the session never got, and leaving it running would
	 * send the next idle input on a role nobody asked for. The restore is recorded the way a step change is,
	 * so a reload and a branch move read the same phase this put back.
	 *
	 * The restore is limited to the input it was armed for: anything that changed the phase or the branch
	 * while the confirmation was open — another extension's input starting a step of its own, a move between
	 * branches — is a change this confirmation was never asked about, and putting the phase back over it
	 * would rewrite that input's state or the branch the user landed on (design Decision 7).
	 */
	undoInput(token: number | undefined): void;
	/**
	 * The token of the input being handled, which is the only one {@link undoInput} takes.
	 *
	 * Read by the surface that may stop an input, before it waits for an answer, so the answer can be applied
	 * to the input it was asked about rather than to whatever the session has done since.
	 */
	undoToken(): number | undefined;
	/**
	 * Record that a session start refused the step its branch left open.
	 *
	 * A start writes nothing, because the branch it opens already says what runs on it. The one exception is a
	 * record an interrupted run left open for a step that does not continue: this runtime drops it and the
	 * next reload would put it back, so the rejection is written down.
	 */
	rejectStep(): void;
	/**
	 * Whether the input just handled opened the running step, as opposed to leaving the phase alone.
	 *
	 * The step-start confirmation is asked once per start, so it has to tell the input that opened a step
	 * from the one that only joined a run already going.
	 */
	stepStartedByInput(): boolean;
	/**
	 * Align the running step with the branch a tree move landed on. A name on the step list restores that
	 * step the way a reload does; `{ step: null }`, no record, a name off the list, and a value that is not
	 * a step name all take the step off. Neither path writes a record, because the branch already says what
	 * is running (design Decision 12).
	 */
	followStepRecord(name: string | undefined): void;
	/**
	 * Open a session for one of pi's `session_start` reasons.
	 *
	 * A reload keeps the step — the runtime was replaced, not the conversation. Every other start drops the
	 * step this process holds, because it opens a conversation that never had it — or reopens one whose own
	 * records say what runs there, which the command surface reads back on the same event. Nothing is
	 * recorded here: the record of a step belongs to the conversation that was running, and appending its
	 * end to the session the user just opened would write a fact that conversation never had.
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

/** The start's classification of the branch's newest step record. */
export type StepEntryDisposition = { kind: "restore" | "reject"; step: string };

/**
 * Classify the step a session start finds, parsing the record and consulting its definition once.
 *
 * A reload restores the open step even when it normally ends with its run; other starts restore only
 * continuing steps and reject an interrupted non-continuing step so the next reload cannot put it back.
 * Missing, closed, unknown, or unreadable records need no action (design Decision 10).
 */
export function stepEntryDisposition(branch: readonly SessionEntry[], reason: string): StepEntryDisposition | undefined {
	const step = spiritsStepEntry(branch);
	if (step === undefined) return undefined;
	const definition = STEP_DEFINITIONS.find((candidate) => candidate.name === step);
	if (!definition) return undefined;
	if (reason === "reload" || definition.continuing) return { kind: "restore", step };
	return { kind: "reject", step };
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
	// What the input just handled found, and whether it opened the step now running. Both exist only for
	// the input being processed: a handler that runs after the routing layer's reads them to say what that
	// input did, and an aborted input puts the phase back from here.
	let pendingUndo: { token: number; step: ActiveStep | undefined; resolved: boolean; generation: number } | undefined;
	let startedByInput = false;
	// Counts the inputs handled, so a rollback names the one it was armed for, and counts the phase's own
	// changes, so a rollback can tell whether anything moved since. Together they are the guard Decision 7
	// asks for: a confirmation that waits cannot assume the phase it asked about is still there.
	let inputCount = 0;
	let generation = 0;

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
		generation += 1;
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
		generation += 1;
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
			// Each input arms its own rollback, and nothing else's survives into it. The rollback holds the
			// state the input *found*, read before anything below moves it, and the generation the input leaves
			// behind, which is what makes the arm expire.
			const found = { step: active, resolved };
			pendingUndo = undefined;
			startedByInput = false;
			// A steer or follow-up joins the run in progress: it changes no step and no phase, so it has
			// nothing to undo and asks nothing.
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
				startedByInput = true;
				pendingUndo = { token: ++inputCount, step: found.step, resolved: found.resolved, generation };
				return;
			}

			// A skill or template pi would expand, but that no step lists, ends the step: the conversation
			// left the listed workflow. An extension command (`/spirits-clear`, `/model`) is not that, so
			// only a command pi reports from a skill or a template ends here.
			const expanded = commands.some((command) => command.name === name && command.source !== "extension");
			if (expanded) end();
			// Armed with the state the input found, stamped with the generation it left the phase in: an undo
			// is only good while nothing else has moved.
			pendingUndo = { token: ++inputCount, step: found.step, resolved: found.resolved, generation };
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
		stepStartedByInput: () => startedByInput,
		undoToken: () => pendingUndo?.token,
		undoInput(token) {
			const armed = pendingUndo;
			// Two guards, both about what happened while the confirmation was open: the token ties the undo to
			// the input it was asked for, and the generation says nothing has moved the phase or the branch
			// since. A mismatch is a change this confirmation has no claim on — the newer input's own rollback
			// stays armed, because it belongs to that input, not to this one.
			if (!armed || armed.token !== token || armed.generation !== generation) return;
			pendingUndo = undefined;
			startedByInput = false;
			const changed = active?.name !== armed.step?.name;
			active = armed.step;
			resolved = armed.resolved;
			// The record is what a reload and a branch move read, so the state the input is undone to has to
			// be the newest thing written. Nothing is written when the name is the one already recorded.
			if (changed) notify(armed.step ? armed.step.name : null);
		},
		rejectStep() {
			// The step is already out of the phase — a start drops it before anything reads the records — so
			// this writes only the fact the next reload reads: the newest record stops being an open step.
			// Not `end()`, which would only say something when this runtime still held the step.
			notify(null);
		},
		beginSession(reason) {
			if (reason === "reload") return;
			// Not `end()`: a start writes nothing, because the branch this start opens says what runs on it,
			// and the step being dropped belongs to the conversation that closed. A start that does drop one
			// moves the generation, so a confirmation left waiting across it cannot put the old step back.
			generation += 1;
			active = undefined;
			resolved = false;
			pendingUndo = undefined;
			startedByInput = false;
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
				// the step from before the move running until a reload took it away (d-verify4 C-3). The move is
				// also a change a confirmation waiting over it has no claim on, so it moves the generation too.
				generation += 1;
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
