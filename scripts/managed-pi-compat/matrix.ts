/**
 * Compatibility matrix for role, `/clear`, and `/model`.
 *
 * A row records the purpose, the current mechanism, the managed-route state, and the difference
 * from the default route. Unavailable items carry an alternative; the default route is not changed.
 */

/** Managed-route availability. */
export type MatrixState = "available" | "limited" | "unavailable";

/** One compatibility row. */
export interface MatrixRow {
	feature: "role" | "clear" | "model";
	purpose: string;
	currentMechanism: string;
	state: MatrixState;
	alternative?: string;
	difference?: string;
}

/** Rows recorded by this change. */
export const COMPAT_MATRIX: readonly MatrixRow[] = [
	{
		feature: "role",
		purpose: "Route review/deep work to strong while keeping one selection",
		currentMechanism: "spirits/auto + skill phase + models.strong + /model role + footer badge",
		state: "limited",
		alternative: "Extension command plus own status line; limited Pi patch is a follow-up decision",
		difference: "No /model role suffix, saved role key, route role field, or footer badge",
	},
	{
		feature: "role",
		purpose: "Pin normal or strong without changing the model",
		currentMechanism: "/model role suffix and registerModelRoles",
		state: "unavailable",
		alternative: "/spirits-role or settings-only lock",
		difference: "New explicit command; no /model suffix",
	},
	{
		feature: "role",
		purpose: "Show which role handled the last request",
		currentMechanism: "Core footer badge reading the route role",
		state: "unavailable",
		alternative: "Extension status line/footer overlay",
		difference: "Different placement and persistence; must not claim the core badge exists",
	},
	{
		feature: "clear",
		purpose: "Remove conversation from context/display while keeping the session file, ID, model, thinking level, TODO, and tree history",
		currentMechanism: "Core clearConversation() and /clear",
		state: "unavailable",
		alternative: "Limited Pi patch, or redefine the command as starting a new session",
		difference: "ctx.newSession() creates a new file/ID and loses same-ID history behavior",
	},
	{
		feature: "model",
		purpose: "Choose model and thinking level in one line, optionally saving defaults",
		currentMechanism: "Core /model parser and save keys",
		state: "limited",
		alternative: "Extension command plus own save path",
		difference: "Command surface, completion, hints, and settings key ownership differ",
	},
	{
		feature: "model",
		purpose: "Combine model, thinking level, and role selection in one line",
		currentMechanism: "Core parser, role vocabulary, settings save",
		state: "unavailable",
		alternative: "Limited patch or split role selection into an extension command",
		difference: "UX and saved key differ",
	},
];

/** A dedicated-Pi observation for one row. */
export interface MatrixObservation {
	feature: MatrixRow["feature"];
	purpose: string;
	state: MatrixState;
	detail?: string;
}

/** Overlay observed states onto the static rows; unobserved rows stay as recorded. */
export function applyProbeObservations(
	observations: readonly MatrixObservation[],
	rows: readonly MatrixRow[] = COMPAT_MATRIX,
): MatrixRow[] {
	return rows.map((row) => {
		const observation = observations.find(
			(entry) => entry.feature === row.feature && entry.purpose === row.purpose,
		);
		return observation ? { ...row, state: observation.state } : row;
	});
}

/** Report rows with no dedicated-Pi observation as `not-run` instead of a static claim. */
export function withoutProbeObservations(rows: readonly MatrixRow[] = COMPAT_MATRIX): Array<MatrixRow & { observed: false }> {
	return rows.map((row) => ({ ...row, observed: false }));
}

/** Rows for one feature. */
export function matrixRows(feature: MatrixRow["feature"]): readonly MatrixRow[] {
	return COMPAT_MATRIX.filter((row) => row.feature === feature);
}

/** Validate that unavailable rows name an alternative and difference. */
export function validateMatrix(rows: readonly MatrixRow[] = COMPAT_MATRIX): void {
	for (const row of rows) {
		if (row.state === "unavailable" && (!row.alternative || !row.difference)) {
			throw new Error(`Unavailable matrix row for ${row.feature} needs an alternative and difference.`);
		}
	}
}
