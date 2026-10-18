/**
 * Per-cell measurement, kept out of `cell.ts` so the evaluation pipeline stays about execution.
 *
 * The values feed the `tsrepl_cell` session entry, which is the base for measuring how tsrepl is
 * actually used. Nothing a cell ran into is here: only character counts, classifications, and the
 * outcome of each `tool()` call.
 */

/** How one cell ended. */
export type CellOutcome = "ok" | "error" | "timeout_cell" | "timeout_sync" | "aborted";

/** Result of one `tool()` call inside a cell. No arguments and no tool output are recorded. */
export interface ToolCallRecord {
	name: string;
	/** The tool reported its result as an error (`isError`). */
	isError: boolean;
	/** The result carried `structuredContent`. */
	structured: boolean;
	/** `exit_code` of a structured result, when it holds an integer. */
	exitCode: number | null;
	/** `tool()` threw: the cell saw an exception instead of a value. */
	threw: boolean;
}

/** Measurement of one cell run. */
export interface CellMetrics {
	outcome: CellOutcome;
	/** Cell start to result, in ms. */
	durationMs: number;
	/** Clamped cell-wide timeout, or null when none was specified. */
	timeoutMs: number | null;
	reset: boolean;
	codeChars: number;
	valueChars: number;
	printedChars: number;
	/** Length of the whole formatted result text, before the output limit. */
	outputChars: number;
	truncated: boolean;
	/** Where the whole text went after a truncation. */
	spill: "saved" | "failed" | null;
	underscoreSet: boolean;
	toolCalls: ToolCallRecord[];
}

/** Read an integer `exit_code` off a structured result. */
export function readExitCode(structured: unknown): number | null {
	if (typeof structured !== "object" || structured === null) {
		return null;
	}
	const value = (structured as Record<string, unknown>).exit_code;
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}
