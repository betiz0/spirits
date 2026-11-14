/**
 * Compatibility matrix for role, `/clear`, and `/model`.
 *
 * A purpose is the unit of measurement. Each purpose definition carries the current mechanism, the
 * alternative, and the difference once, and the matrix rows are derived from the purpose
 * observations. A row never carries a state that no observation produced: an unobserved purpose
 * yields a `not-run` row, and a command-list absence is not an observation.
 */

/** Managed-route availability. `not-run` means nothing was observed on the dedicated Pi. */
export type MatrixState = "available" | "limited" | "unavailable" | "not-run";

/**
 * The word an observation detail carries when an alternative served the purpose.
 *
 * A row says `available` whether pi's own `/model` answered or an extension command served the same
 * purpose, so the detail has to name the alternative for the row to be readable.
 */
export const ALTERNATIVE_MARKER = "alternative";

/** One purpose of a feature. This is the single source of the row wording. */
export interface PurposeDefinition {
	id: string;
	feature: "role" | "clear" | "model";
	purpose: string;
	/** How the default route serves this purpose. */
	currentMechanism: string;
	alternative?: string;
	difference?: string;
}

/** role purposes observed separately. */
export const ROLE_PURPOSES: readonly PurposeDefinition[] = [
	{
		id: "skill-strong-phase",
		feature: "role",
		purpose: "Route review/deep work to strong while keeping one selection",
		currentMechanism: "spirits/auto + skill phase + models.strong",
		alternative: "The same extension routing; the route reports its role to the extension status line",
		difference: "No /model role suffix or core footer badge; the routing decision itself is identical",
	},
	{
		id: "model-role-vocabulary",
		feature: "role",
		purpose: "Pin normal or strong without changing the model",
		currentMechanism: "/model role suffix and registerModelRoles",
		alternative: "/spirits-role <role>: locks the phase, records a spirits_role entry, writes models.role",
		difference: "A separate command; pi's /model keeps its own behaviour, and the lock survives resume and reload",
	},
	{
		id: "role-badge",
		feature: "role",
		purpose: "Show which role handled the last request",
		currentMechanism: "Core footer badge reading the route role",
		alternative: "ui.setStatus() on the extension status line, updated by the route",
		difference: "Renders on the footer's extension status line, not beside the model name",
	},
	{
		id: "step-role-settings",
		feature: "role",
		purpose: "Set the role and thinking level of one workflow step",
		currentMechanism: "none",
		alternative: "/spirits-role <step> role <role> and /spirits-role <step> thinking <level>, writing models.steps.<name>",
		difference: "The step list decides which names exist; an unknown name is ignored and reported by /spirits-role status",
	},
	{
		id: "role-status-report",
		feature: "role",
		purpose: "Read how the routing is running: the lock, the step, and both roles' targets",
		currentMechanism: "none",
		alternative: "/spirits-role status: one report listing the routing state, the lock, the running step, the last request, and what each role resolves to",
		difference: "pi shows a selection, never a routing: this report is the only surface that names the target a role answered with",
	},
];

/** `/clear` purposes observed separately. */
export const CLEAR_PURPOSES: readonly PurposeDefinition[] = [
	{
		id: "conversation-clear",
		feature: "clear",
		purpose: "Remove conversation from context while the display keeps it",
		currentMechanism: "Core clearConversation() and /clear",
		alternative: "/spirits-clear: a boundary entry plus a context handler that drops what precedes it",
		difference: "The chat display keeps the earlier messages; pi's /clear removes them from the display too",
	},
	{
		id: "same-session-id",
		feature: "clear",
		purpose: "Keep the same session ID after clearing",
		currentMechanism: "Core clearConversation() keeps the session file and ID",
		alternative: "/spirits-clear appends one entry and rewrites nothing",
		difference: "None for the ID; the session file keeps growing instead of being reset",
	},
	{
		id: "todo-retention",
		feature: "clear",
		purpose: "Keep the TODO list after clearing",
		currentMechanism: "TODO snapshots live outside the cleared conversation",
		alternative: "Same: the boundary is a conversation cut, not a session reset",
		difference: "None; a new session would drop the TODO list",
	},
];

/** `/model` purposes observed separately. */
export const MODEL_PURPOSES: readonly PurposeDefinition[] = [
	{
		id: "thinking-level",
		feature: "model",
		purpose: "Choose the thinking level",
		currentMechanism: "Core /model parser and /thinking",
		alternative:
			"/spirits-role <role> thinking <level>: a per-role setting the route puts on the request, measured in the fake provider's request body",
		difference:
			"The setting belongs to the role, not to the session; pi's own set_thinking_level still owns the session selection and spirits never calls it",
	},
	{
		id: "role-model",
		feature: "model",
		purpose: "Give one role its own model and save it",
		currentMechanism: "Core /model parser and default save keys",
		alternative:
			"/spirits-role <role> model <ref>: a merge-write of models.<role> into pi's global settings.json, under pi's file lock, read back after the reload",
		difference: "The selection is the target of a role, not the session's model; pi's own selection stays where /model put it",
	},
	{
		id: "session-model-selection",
		feature: "model",
		purpose: "Choose the session's model and read the choice back",
		currentMechanism: "Core /model selector and the session model it saves",
		alternative: "pi's own set_model RPC read back with the session state; spirits routes requests and never selects the session's model",
		difference:
			"The routing model is one of the choices: selecting it puts every request through the routing, and selecting a physical model takes them out of it",
	},
	{
		id: "default-save",
		feature: "model",
		purpose: "Save the chosen model and level as defaults",
		currentMechanism: "Core /model selector save keys",
		alternative: "None over RPC",
		difference:
			"The selector's default save is a terminal surface with no RPC command, so this row is not-run; the session's model selection itself is observable with set_model",
	},
	{
		id: "settings-list",
		feature: "model",
		purpose: "Edit the role settings from an interactive list",
		currentMechanism: "Core /settings and /model selectors",
		alternative: "/spirits-role with no arguments opens the list, which exists only in the interactive TUI",
		difference:
			"The RPC path cannot open a terminal widget, so this row is not-run; every setting the list edits is reachable as a /spirits-role command line",
	},
];

/** Every purpose definition, in row order. */
export const PURPOSE_DEFINITIONS: readonly PurposeDefinition[] = [
	...ROLE_PURPOSES,
	...CLEAR_PURPOSES,
	...MODEL_PURPOSES,
];

/** One compatibility row, derived from a purpose definition plus its observation. */
export interface MatrixRow extends PurposeDefinition {
	state: MatrixState;
	observed: boolean;
}

/** A purpose observation; an unobserved purpose is `not-run`, never `unavailable`. */
export interface PurposeObservation {
	feature: MatrixRow["feature"];
	purposeId: string;
	purpose: string;
	state: MatrixState;
	detail?: string;
	/** The mechanism that served the purpose, taken from the purpose definition. */
	alternative?: string;
	/** How the managed route differs from the default route, taken from the purpose definition. */
	difference?: string;
}

/**
 * Record one purpose observation. `observed: false` keeps the purpose `not-run`: the absence of a
 * command in a command list, or of an API on the host, is not an observation of behaviour.
 */
export function observePurpose(
	feature: MatrixRow["feature"],
	purposeId: string,
	observation: { observed: boolean; state?: MatrixState; detail?: string },
): PurposeObservation {
	const definition = PURPOSE_DEFINITIONS.find((entry) => entry.feature === feature && entry.id === purposeId);
	if (!definition) throw new Error(`Unknown ${feature} purpose: ${purposeId}`);
	return observePurposeState(
		definition,
		observation.observed ? (observation.state ?? "available") : "not-run",
		observation.detail ?? "",
	);
}

/**
 * Build one observation from a state the harness actually measured.
 *
 * The alternative and the difference travel with the observation, and the detail of an observed
 * purpose names the alternative: without the marker a reader cannot tell pi's own surface from an
 * extension command that serves the same purpose.
 */
export function observePurposeState(
	definition: PurposeDefinition,
	state: MatrixState,
	detail: string,
): PurposeObservation {
	const marked =
		state !== "not-run" && definition.alternative !== undefined && !detail.includes(ALTERNATIVE_MARKER)
			? `${ALTERNATIVE_MARKER} (${definition.alternative}): ${detail}`
			: detail;
	return {
		feature: definition.feature,
		purposeId: definition.id,
		purpose: definition.purpose,
		state,
		...(marked ? { detail: marked } : {}),
		...(definition.alternative ? { alternative: definition.alternative } : {}),
		...(definition.difference ? { difference: definition.difference } : {}),
	};
}

/** The `not-run` observation for a purpose the harness could not exercise, with the reason. */
export function purposeNotRun(definition: PurposeDefinition, reason: string): PurposeObservation {
	return observePurposeState(definition, "not-run", reason);
}

/** Purpose definitions for one feature, in row order. */
export function purposesFor(feature: MatrixRow["feature"]): readonly PurposeDefinition[] {
	return PURPOSE_DEFINITIONS.filter((entry) => entry.feature === feature);
}

/** Look a purpose definition up by feature and id. */
function definitionFor(feature: MatrixRow["feature"], purposeId: string): PurposeDefinition {
	const definition = PURPOSE_DEFINITIONS.find((entry) => entry.feature === feature && entry.id === purposeId);
	if (!definition) throw new Error(`Unknown ${feature} purpose: ${purposeId}`);
	return definition;
}

/** An optional observation a harness may or may not have been able to make. */
export interface OptionalObservation {
	observed: boolean;
	state?: MatrixState;
	detail?: string;
}

/** Conversation size, session ID, and TODO entries read through the dedicated Pi. */
export interface ClearStateRecord {
	sessionId: string;
	messageEntries: number;
	todoEntries: number;
}

/**
 * Whether the model still sees the conversation that preceded the command, decided from the request
 * the fake provider received: a marker sent before the command is absent from the request after it.
 * The session file keeps every message, so the entry count cannot answer this.
 */
export interface ClearContextObservation {
	observed: boolean;
	cleared?: boolean;
	detail: string;
}

/** One `/clear` attempt: the state before and after the command the harness sent. */
export interface ClearAttempt {
	attempted: boolean;
	reason?: string;
	before?: ClearStateRecord;
	after?: ClearStateRecord;
	/** What the model saw around the command. Without it the conversation purpose is not-run. */
	context?: ClearContextObservation;
}

/**
 * Judge the three `/clear` purposes from one attempt.
 *
 * The conversation purpose is decided by what the model sees, not by the session file: the managed
 * command keeps every message entry so the chat display survives, and removes the earlier
 * conversation from the request. The other two purposes are read from the session state recorded
 * around the command. An attempt that produced no observation stays `not-run`.
 */
export function clearPurposeObservations(attempt: ClearAttempt): PurposeObservation[] {
	const definitions = purposesFor("clear");
	if (!attempt.attempted) {
		return definitions.map((definition) => purposeNotRun(definition, attempt.reason ?? "no clear attempt was made"));
	}
	const conversation = definitionFor("clear", "conversation-clear");
	const observations: PurposeObservation[] = [
		attempt.context?.observed === true
			? observePurposeState(
					conversation,
					attempt.context.cleared === true ? "available" : "unavailable",
					attempt.context.detail,
				)
			: purposeNotRun(conversation, attempt.reason ?? "the request content around the command was not observed"),
	];

	const { before, after } = attempt;
	if (before === undefined || after === undefined) {
		for (const definition of definitions) {
			if (definition.id === "conversation-clear") continue;
			observations.push(purposeNotRun(definition, attempt.reason ?? "the probe reported no session state around the attempt"));
		}
		return observations;
	}
	observations.push(
		after.sessionId === before.sessionId
			? observePurposeState(definitionFor("clear", "same-session-id"), "available", `the session kept the ID ${after.sessionId}`)
			: observePurposeState(
					definitionFor("clear", "same-session-id"),
					"unavailable",
					`the session ID changed from ${before.sessionId} to ${after.sessionId}`,
				),
		after.todoEntries > 0
			? observePurposeState(
					definitionFor("clear", "todo-retention"),
					"available",
					`${after.todoEntries} TODO entries survived the command`,
				)
			: observePurposeState(
					definitionFor("clear", "todo-retention"),
					"unavailable",
					"no TODO entry survived the command",
				),
	);
	return observations;
}

/** One `/model`-purpose attempt made through the dedicated Pi runtime. */
export interface ModelPurposeAttempt {
	attempted: boolean;
	reason?: string;
	/** The thinking level the run asked the role to carry. */
	requestedLevel?: string;
	/** The thinking level the fake provider read off the request body it received. */
	observedLevel?: string;
	/**
	 * What `set_model` reported as the session's model, and what the session state read back afterwards.
	 *
	 * This is a different thing from {@link roleModelSaved}: one is the model the session is sitting on,
	 * the other is the target a role points at. The routing makes them differ on purpose, so a row that
	 * conflated them would report the same measurement twice under two names.
	 *
	 * Both spellings are carried because a row that only said "not observed" would not tell a missing
	 * readback apart from a readback of a different model, and those are different defects.
	 */
	sessionSelection?: { requested?: string; readBack?: string };
	/** `models.<role>` was written and read back through the reloaded runtime. */
	roleModelSaved?: boolean;
	/** Whether the harness reached a surface that takes a role argument. */
	roleVocabulary?: OptionalObservation;
}

/**
 * Judge the `/model` purposes from the attempt.
 *
 * A thinking level counts only when the level the run asked for is the level the provider received.
 * Reading a level back through an extension call would measure that call and not the request, which is
 * the thing the user actually pays for. Two rows are fixed at `not-run` before the attempt is looked at,
 * because the surfaces they need — pi's own `/model` selector and the interactive settings list — have
 * no RPC command at all. `unavailable` would say the feature is missing when only the measurement path
 * is missing (spec `managed-pi-compatibility`).
 */
export function modelPurposeObservations(attempt: ModelPurposeAttempt): PurposeObservation[] {
	if (!attempt.attempted) {
		return purposesFor("model").map((definition) => purposeNotRun(definition, attempt.reason ?? "no model-purpose attempt was made"));
	}
	const level = definitionFor("model", "thinking-level");
	const asked = attempt.requestedLevel;
	const saw = attempt.observedLevel;
	const levelObservation =
		asked === undefined || saw === undefined
			? purposeNotRun(level, attempt.reason ?? "no request was observed that could carry a thinking level")
			: asked === saw
				? observePurposeState(
						level,
						"available",
						`the run asked for ${asked} and the provider received ${saw}, which is the role's own setting rather than pi's /thinking selection`,
					)
					: observePurposeState(
						level,
						"unavailable",
						`the run asked for ${asked} and the provider received ${String(saw)}, so the role's setting did not reach the request`,
					);

	const roleModel = definitionFor("model", "role-model");
	const roleModelObservation =
		attempt.roleModelSaved === true
			? observePurposeState(
					roleModel,
					"available",
					"the role's model was written and read back through the reloaded runtime, which selects a role's target and not the session's model",
				)
				: purposeNotRun(roleModel, attempt.reason ?? "the role's model was not read back, so no role target was saved");

	// The session's own selection, which the routing model shares a surface with but does not own: pi's
	// `set_model` is what moves it, and reading it back is the only way to tell a selection from a request
	// that happened to run elsewhere (spec `managed-pi-compatibility` / model の記録).
	const session = definitionFor("model", "session-model-selection");
	const chosen = attempt.sessionSelection;
	const sessionObservation =
		chosen?.readBack === undefined
			? purposeNotRun(
					session,
					`${attempt.reason ?? "the run selected a model over RPC"}; the session state reported no model to read the selection back from`,
				)
				: chosen.requested !== undefined && chosen.requested !== chosen.readBack
					? observePurposeState(
							session,
							"unavailable",
							`set_model reported ${chosen.requested} and the session state reported ${chosen.readBack}, so the selection did not stick`,
						)
					: observePurposeState(
							session,
							"available",
							`set_model selected ${chosen.readBack} and the session state read it back, which is the session's own choice and not the target of a role`,
						);

	return [
		levelObservation,
		roleModelObservation,
		sessionObservation,
		purposeNotRun(
			definitionFor("model", "default-save"),
			"pi's own default save is a key of the interactive /model selector and has no RPC command; the session's model selection itself is observable with set_model",
		),
		purposeNotRun(
			definitionFor("model", "settings-list"),
			"the settings list is a terminal widget the RPC path cannot open; every setting it edits is reachable as a /spirits-role command line",
		),
	];
}
/** Models the fake provider saw for the plain and the strong-phase requests. */
export interface StrongPhaseAttempt {
	attempted: boolean;
	reason?: string;
	normalRequestModel?: string;
	strongRequestModel?: string;
	expectedNormalModel: string;
	expectedStrongModel: string;
	/** Whether the harness reached a surface that pins a role without changing the model. */
	roleVocabulary?: OptionalObservation;
	/** Whether the harness could read the role badge surface. */
	roleBadge?: OptionalObservation;
	/** Whether a `/spirits-role <step> role` line changed the model that served the step's request. */
	stepSettingsApplied?: boolean;
	/** The text `/spirits-role status` asked the host to show, or undefined when it showed nothing. */
	statusReport?: string;
}

/**
 * The parts of a status report that make it a routing report.
 *
 * A report that only restated the session's model would answer the purpose of pi's own footer, not this
 * one, so the row is decided by these names appearing in the text rather than by the notice existing.
 */
export const STATUS_REPORT_MARKERS = ["routing:", "lock:", "step:", "normal:", "strong:"] as const;

/**
 * Judge the status purpose from the report text the dedicated Pi was asked to show.
 *
 * No report at all is `not-run`: the harness could not drive the surface, which says nothing about the
 * command. A report that leaves a part out is `unavailable`, because the command ran and did not answer.
 */
export function roleStatusObservation(report: string | undefined): PurposeObservation {
	const definition = definitionFor("role", "role-status-report");
	if (report === undefined || report.trim() === "") {
		return purposeNotRun(definition, "the dedicated Pi showed no status report, so the report was never observed");
	}
	const missing = STATUS_REPORT_MARKERS.filter((marker) => !report.includes(marker));
	if (missing.length > 0) {
		return observePurposeState(definition, "unavailable", `the report left out ${missing.join(", ")}: ${report.replace(/\s+/g, " ")}`);
	}
	return observePurposeState(definition, "available", report.replace(/\s+/g, " ").slice(0, 240));
}

/**
 * Judge the role purposes.
 *
 * The routing purpose is decided by the model that actually served the strong-phase skill command,
 * which only a real request can show. The vocabulary and the badge need a surface the harness can
 * drive; without one they stay `not-run`, because an absent API or an absent command list says
 * nothing about the behaviour.
 */
export function rolePurposeObservations(attempt: StrongPhaseAttempt): PurposeObservation[] {
	const routing = definitionFor("role", "skill-strong-phase");
	let routingObservation: PurposeObservation;
	if (!attempt.attempted) {
		routingObservation = purposeNotRun(routing, attempt.reason ?? "no strong-phase request was made");
	} else if (attempt.strongRequestModel === undefined || attempt.normalRequestModel === undefined) {
		routingObservation = purposeNotRun(
			routing,
			`${attempt.reason ?? "the strong-phase or the plain request never reached the provider"}; no routing behaviour was observed`,
		);
	} else if (attempt.strongRequestModel !== attempt.expectedStrongModel) {
		// The purpose is to route strong work away from the plain model, so a strong-phase request that
		// stayed on the plain model is a purpose that was not served, not a partial success.
		routingObservation = observePurposeState(
			routing,
			"unavailable",
			`the strong-phase request ran on ${attempt.strongRequestModel}, expected ${attempt.expectedStrongModel}`,
		);
	} else if (attempt.normalRequestModel === attempt.expectedNormalModel) {
		routingObservation = observePurposeState(
			routing,
			"available",
			`the plain request ran on ${attempt.normalRequestModel} and the strong-phase request on ${attempt.strongRequestModel}`,
		);
	} else {
		routingObservation = observePurposeState(
			routing,
			"limited",
			`the strong phase routed to ${attempt.strongRequestModel} but the plain request ran on ${attempt.normalRequestModel} too, so the two phases are not distinguishable by model`,
		);
	}
	const vocabulary = definitionFor("role", "model-role-vocabulary");
	const badge = definitionFor("role", "role-badge");
	return [
		routingObservation,
		attempt.roleVocabulary?.observed === true
			? observePurposeState(
					vocabulary,
					attempt.roleVocabulary.state ?? "available",
					attempt.roleVocabulary.detail ?? "a role pin was observed on the dedicated Pi",
				)
			: purposeNotRun(
					vocabulary,
					attempt.roleVocabulary?.detail ??
						"no drivable surface took a role argument, so the role pin was not observed",
				),
		attempt.stepSettingsApplied === true
			? observePurposeState(
					definitionFor("role", "step-role-settings"),
					"available",
					"a /spirits-role <step> role line moved the model that served the step's request, which is the setting taking effect over the lock",
				)
			: purposeNotRun(
					definitionFor("role", "step-role-settings"),
					attempt.reason ??
						"no step request reached the provider after a /spirits-role <step> role line, so the step setting was not observed",
				),
		attempt.roleBadge?.observed === true
			? observePurposeState(
					badge,
					attempt.roleBadge.state ?? "available",
					attempt.roleBadge.detail ?? "the role badge surface was read on the dedicated Pi",
				)
			: purposeNotRun(
					badge,
					attempt.roleBadge?.detail ?? "the role badge is a terminal surface the RPC harness cannot read",
				),
		// The status report is driven on the same dedicated Pi as the routing, and its row is decided by
		// the text: a notice that exists but names no target answers nothing (d-verify2 C-5).
		roleStatusObservation(attempt.statusReport),
	];
}

/**
 * Derive the matrix rows from purpose observations.
 *
 * Every row's state comes from its observation, so a row cannot disagree with the purpose it
 * records. A purpose with no observation yields a `not-run` row rather than a static claim.
 */
export function deriveRows(observations: readonly PurposeObservation[]): MatrixRow[] {
	return PURPOSE_DEFINITIONS.map((definition) => {
		const observation = observations.find((entry) => entry.feature === definition.feature && entry.purposeId === definition.id);
		return {
			...definition,
			state: observation?.state ?? "not-run",
			observed: observation !== undefined && observation.state !== "not-run",
		};
	});
}

/** Rows for one feature. Without observations every row is `not-run`. */
export function matrixRows(feature: MatrixRow["feature"], observations: readonly PurposeObservation[] = []): MatrixRow[] {
	return deriveRows(observations).filter((row) => row.feature === feature);
}

/** A difference that names nothing the user can see, as written in the purpose definitions. */
const NO_VISIBLE_DIFFERENCE = /^none\b/i;

/**
 * Validate the recorded matrix.
 *
 * Every observed row has to name the mechanism that served the purpose and how it differs, because
 * a row that reads only "available" hides an alternative implementation. `limited` additionally has
 * to name a difference a user sees: a constraint of the observing harness belongs in the
 * observation detail, and an unobservable purpose belongs in `not-run`.
 */
export function validateMatrix(rows: readonly MatrixRow[]): void {
	for (const row of rows) {
		if (row.state === "not-run") continue;
		if (!row.alternative || !row.difference) {
			throw new Error(
				`Matrix row ${row.feature}/${row.id} was observed as ${row.state} without an alternative and a difference.`,
			);
		}
		if (row.state === "limited" && NO_VISIBLE_DIFFERENCE.test(row.difference)) {
			throw new Error(
				`Limited matrix row ${row.feature}/${row.id} names no difference a user sees: ${row.difference}`,
			);
		}
	}
}

/** Validate that every observed purpose detail names the alternative that served it. */
export function validatePurposeObservations(observations: readonly PurposeObservation[]): void {
	for (const observation of observations) {
		if (observation.state === "not-run") continue;
		if (definitionFor(observation.feature, observation.purposeId).alternative === undefined) continue;
		if (!observation.detail?.includes(ALTERNATIVE_MARKER)) {
			throw new Error(
				`Purpose observation ${observation.feature}/${observation.purposeId} does not name the alternative it used.`,
			);
		}
	}
}
