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
		alternative: "Extension command plus own status line; limited Pi patch is a follow-up decision",
		difference: "No /model role suffix, saved role key, route role field, or footer badge",
	},
	{
		id: "model-role-vocabulary",
		feature: "role",
		purpose: "Pin normal or strong without changing the model",
		currentMechanism: "/model role suffix and registerModelRoles",
		alternative: "/spirits-role or settings-only lock",
		difference: "New explicit command; no /model suffix",
	},
	{
		id: "role-badge",
		feature: "role",
		purpose: "Show which role handled the last request",
		currentMechanism: "Core footer badge reading the route role",
		alternative: "Extension status line/footer overlay",
		difference: "Different placement and persistence; must not claim the core badge exists",
	},
];

/** `/clear` purposes observed separately. */
export const CLEAR_PURPOSES: readonly PurposeDefinition[] = [
	{
		id: "conversation-clear",
		feature: "clear",
		purpose: "Remove conversation from context and display",
		currentMechanism: "Core clearConversation() and /clear",
		alternative: "Limited Pi patch, or redefine the command as starting a new session",
		difference: "ctx.newSession() creates a new file/ID and loses the same-ID history behaviour",
	},
	{
		id: "same-session-id",
		feature: "clear",
		purpose: "Keep the same session ID after clearing",
		currentMechanism: "Core clearConversation() keeps the session file and ID",
		alternative: "Limited Pi patch that preserves the session file and ID",
		difference: "A new session would change the ID and history",
	},
	{
		id: "todo-retention",
		feature: "clear",
		purpose: "Keep the TODO list after clearing",
		currentMechanism: "TODO snapshots live outside the cleared conversation",
		alternative: "Store the TODO list outside the cleared conversation",
		difference: "A new session would drop the TODO list",
	},
];

/** `/model` purposes observed separately. */
export const MODEL_PURPOSES: readonly PurposeDefinition[] = [
	{
		id: "thinking-level",
		feature: "model",
		purpose: "Choose the thinking level",
		currentMechanism: "Core /model parser",
		alternative: "Extension command plus own save path",
		difference: "Command surface, completion, hints, and settings key ownership differ",
	},
	{
		id: "role-selection",
		feature: "model",
		purpose: "Combine model, thinking level, and role selection in one line",
		currentMechanism: "Core parser, role vocabulary, settings save",
		alternative: "Limited patch or split role selection into an extension command",
		difference: "UX and saved key differ",
	},
	{
		id: "default-save",
		feature: "model",
		purpose: "Save the chosen model and level as defaults",
		currentMechanism: "Core /model save keys",
		alternative: "Extension-owned save key",
		difference: "Saved key ownership differs",
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
	return {
		feature,
		purposeId,
		purpose: definition.purpose,
		state: observation.observed ? (observation.state ?? "available") : "not-run",
		...(observation.detail ? { detail: observation.detail } : {}),
	};
}

/** Build one observation from a state the harness actually measured. */
export function observePurposeState(
	definition: PurposeDefinition,
	state: MatrixState,
	detail: string,
): PurposeObservation {
	return { feature: definition.feature, purposeId: definition.id, purpose: definition.purpose, state, detail };
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

/** One `/clear` attempt: the state before and after the command the harness sent. */
export interface ClearAttempt {
	attempted: boolean;
	reason?: string;
	before?: ClearStateRecord;
	after?: ClearStateRecord;
}

/**
 * Judge the three `/clear` purposes from one attempt.
 *
 * Nothing was cleared means nothing was observed: the built-in command lives on the interactive
 * surface, so a prompt that leaves the conversation in place is a harness limitation, not evidence
 * that the purpose is unmet. Only a conversation that actually shrank can decide the other two.
 */
export function clearPurposeObservations(attempt: ClearAttempt): PurposeObservation[] {
	const definitions = purposesFor("clear");
	if (!attempt.attempted) {
		return definitions.map((definition) => purposeNotRun(definition, attempt.reason ?? "no /clear attempt was made"));
	}
	const { before, after } = attempt;
	if (before === undefined || after === undefined) {
		return definitions.map((definition) =>
			purposeNotRun(definition, attempt.reason ?? "the probe reported no session state around the /clear attempt"),
		);
	}
	const cleared = after.messageEntries < before.messageEntries;
	if (!cleared) {
		// A clear shrank the conversation. Anything else means the built-in clear path did not run
		// here, and the numbers say which: a host that treated `/clear` as a prompt grows it.
		const reason =
			attempt.reason ??
			(after.messageEntries > before.messageEntries
				? `the conversation grew from ${before.messageEntries} to ${after.messageEntries} entries when the harness sent /clear, so the host treated it as a prompt and the built-in clear path did not run on this surface`
				: `the conversation stayed at ${before.messageEntries} entries when the harness sent /clear, so the built-in clear path did not run on this surface`);
		return definitions.map((definition) => purposeNotRun(definition, reason));
	}
	return [
		observePurposeState(definitionFor("clear", "conversation-clear"), "available", "the conversation shrank while the session kept running"),
		attempt.after !== undefined && after.sessionId === before.sessionId
			? observePurposeState(
					definitionFor("clear", "same-session-id"),
					"available",
					`the session kept the ID ${after.sessionId} across the clear`,
				)
			: observePurposeState(
					definitionFor("clear", "same-session-id"),
					"unavailable",
					`the session ID changed from ${before.sessionId} to ${after.sessionId}`,
				),
			after.todoEntries > 0
				? observePurposeState(
						definitionFor("clear", "todo-retention"),
						"available",
						`${after.todoEntries} TODO entries survived the clear`,
					)
				: observePurposeState(
						definitionFor("clear", "todo-retention"),
						"unavailable",
						"no TODO entry survived the clear",
					),
	];
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
					"the thinking level changed and was read back through the session runtime, not through the /model line",
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
	} else if (attempt.strongRequestModel === attempt.expectedStrongModel) {
		routingObservation = observePurposeState(
			routing,
			attempt.normalRequestModel === attempt.expectedNormalModel ? "available" : "limited",
			`the plain request ran on ${attempt.normalRequestModel} and the strong-phase request on ${attempt.strongRequestModel}`,
		);
	} else {
		routingObservation = observePurposeState(
			routing,
			"limited",
			`the strong-phase request ran on ${attempt.strongRequestModel}, expected ${attempt.expectedStrongModel}`,
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

/** Validate that unavailable rows name an alternative and difference. */
export function validateMatrix(rows: readonly MatrixRow[]): void {
	for (const row of rows) {
		if (row.state === "unavailable" && (!row.alternative || !row.difference)) {
			throw new Error(`Unavailable matrix row for ${row.feature} needs an alternative and difference.`);
		}
	}
}
