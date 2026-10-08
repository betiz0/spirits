/**
 * Cell transpilation.
 *
 * A cell must support top-level `await` and `return` at the same time. `Bun.Transpiler`
 * parses input as an ES module, which rejects that combination, so the cell is wrapped
 * in an async IIFE first and only then transpiled. The wrapper adds one line before the
 * cell body; the syntax-error line is shifted back by one to report a cell line.
 */

import { isRecord } from "./guards.ts";

const transpiler = new Bun.Transpiler({ loader: "ts" });

export interface TranspileSuccess {
	ok: true;
	/** Transpiled JavaScript, including the async IIFE wrapper. */
	code: string;
}

export interface TranspileFailure {
	ok: false;
	message: string;
	/** 1-based line in the input cell. */
	line: number;
	/** Text of the offending input line, when Bun reports it. */
	lineText: string;
}

export type TranspileResult = TranspileSuccess | TranspileFailure;

/**
 * Wrap a cell in an async IIFE so top-level `await` and `return` both work.
 *
 * The parameters paper over two `Bun.Transpiler` behaviors that would otherwise leak
 * host globals into the cell: it constant-folds `typeof require` to `"function"` and
 * injects `var __dirname = ""` / `var __filename = "input.ts"` when those identifiers
 * appear. Binding all three as IIFE parameters (called with no arguments, so they are
 * undefined) keeps `typeof` at `"undefined"` as the spec requires. The parameters sit on
 * the opening line, so the cell body still starts on the next line.
 */
export function wrapCell(cell: string): string {
	return `(async (require, __dirname, __filename) => {\n${cell}\n})()`;
}

export function transpileCell(cell: string): TranspileResult {
	try {
		return { ok: true, code: transpiler.transformSync(wrapCell(cell)) };
	} catch (error) {
		return { ok: false, ...extractTranspileError(error) };
	}
}

function extractTranspileError(error: unknown): Omit<TranspileFailure, "ok"> {
	const message = isRecord(error) && typeof error.message === "string" ? error.message : String(error);
	let line = 1;
	let lineText = "";
	if (isRecord(error) && isRecord(error.position)) {
		const position = error.position;
		if (typeof position.line === "number") {
			line = Math.max(1, position.line - 1);
		}
		if (typeof position.lineText === "string") {
			lineText = position.lineText;
		}
	}
	return { message, line, lineText };
}
