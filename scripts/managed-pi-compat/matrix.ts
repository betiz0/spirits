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
		currentMechanism: "Core /model parser",
		alternative: "/spirits-model <ref> <level>: pi's own setThinkingLevel plus defaultThinkingLevel",
		difference: "A separate command with no completion menu; pi's /model is untouched",
	},
	{
		id: "role-selection",
		feature: "model",
		purpose: "Combine model, thinking level, and role selection in one line",
		currentMechanism: "Core parser, role vocabulary, settings save",
		alternative: "/spirits-model <ref> [level] [role], parsed from the right",
		difference: "No completion or fuzzy search over provider/id/name/description",
	},
	{
		id: "default-save",
		feature: "model",
		purpose: "Save the chosen model and level as defaults",
		currentMechanism: "Core /model save keys",
		alternative: "Merge-write of pi's own keys into pi's global settings.json, under pi's file lock",
		difference: "Same keys and same file; no project-file write, so no trust prompt",
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
	/** Thinking level changed and was read back. */
	levelChanged?: boolean;
	/** The runtime accepted a model selection. */
	setModelResult?: boolean;
	/** The default settings keys changed after the selection. */
	defaultsChanged?: boolean;
	/** Whether the harness reached a surface that takes a role argument. */
	roleVocabulary?: OptionalObservation;
}

/**
 * Judge the `/model` purposes from the attempt.
 *
 * Level and model selection are observed through the session runtime, which is not the one-line
 * `/model` surface the default route uses, so a working selection is `limited` and the difference
 * stays visible. A default save needs the saved settings key to change; reading the key back
 * unchanged means no save path was exercised, which is `not-run`, not `unavailable`.
 */
export function modelPurposeObservations(attempt: ModelPurposeAttempt): PurposeObservation[] {
	const definitions = purposesFor("model");
	if (!attempt.attempted) {
		return definitions.map((definition) => purposeNotRun(definition, attempt.reason ?? "no model-purpose attempt was made"));
	}
	return [
		attempt.levelChanged === true
			? observePurposeState(
					definitionFor("model", "thinking-level"),
					"limited",
					[
						"the thinking level changed through the session runtime instead of the one-line /model,",
						"so the completion menu is missing; the RPC read-back answers only for the model,",
						"which is why the level is confirmed by the following request rather than by a reply",
					].join(" "),
				)
			: purposeNotRun(definitionFor("model", "thinking-level"), attempt.reason ?? "the thinking level was not read back changed"),
		attempt.roleVocabulary?.observed === true
			? observePurposeState(
					definitionFor("model", "role-selection"),
					attempt.roleVocabulary.state ?? "available",
					attempt.roleVocabulary.detail ?? "a role selection was observed on the dedicated Pi",
				)
			: purposeNotRun(
					definitionFor("model", "role-selection"),
					attempt.roleVocabulary?.detail ??
						"no drivable surface took a role argument, so the role vocabulary was not observed",
				),
		attempt.defaultsChanged === true
			? observePurposeState(
					definitionFor("model", "default-save"),
					"available",
					"the default settings keys changed after the selection",
				)
			: purposeNotRun(
					definitionFor("model", "default-save"),
					attempt.reason ??
						"the default settings keys were read back unchanged, so no default-saving path was exercised",
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
