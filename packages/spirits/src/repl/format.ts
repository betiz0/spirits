/**
 * Result and error formatting.
 *
 * A successful cell renders `[printed]` / `[value]` sections, a failed cell renders an
 * `[error]` section. The whole rendered text is truncated once, after formatting, so the
 * limit also applies to errors.
 */

import type { TranspileFailure } from "./transpile.ts";
import { isRecord } from "./guards.ts";
import { MISSING_GLOBALS, type MissingGlobal } from "./context.ts";

/**
 * Output limit of one cell result, in JavaScript string length, with the head and tail it keeps.
 * The same order as bash's 50KB, so a cell can return a search result without cutting it down to a
 * summary. The middle is cut and the whole text goes to a file (see `spill.ts`).
 */
export const OUTPUT_LIMIT = 51200;
export const OUTPUT_HEAD = 30720;
export const OUTPUT_TAIL = 20480;

/** Name Bun uses for the vm script; only frames from this file describe cell code. */
const CELL_FILENAME = "tsrepl-cell.js";

/** Match `tsrepl-cell.js:<line>:<col>`. The filename's `.` is escaped so it is literal. */
const CELL_FRAME = new RegExp(`${CELL_FILENAME.replaceAll(".", "\\.")}:(\\d+):(\\d+)`);

export interface ResultDetails {
	printed?: string;
	value?: string;
	error?: string;
	truncated: boolean;
	truncatedChars: number;
}

export interface FormattedResult {
	text: string;
	isError: boolean;
	/** The formatted text before the output limit. `text` is this text cut to the limit. */
	raw: string;
	details: ResultDetails;
}

export interface TruncatedText {
	text: string;
	truncated: boolean;
	truncatedChars: number;
}

/** Render a value the same way the model sees it: no exceptions for circular or odd values. */
export function formatValue(value: unknown): string {
	return Bun.inspect(value);
}

export function applyOutputLimit(text: string): TruncatedText {
	if (text.length <= OUTPUT_LIMIT) {
		return { text, truncated: false, truncatedChars: 0 };
	}
	const truncatedChars = text.length - OUTPUT_LIMIT;
	const head = text.slice(0, OUTPUT_HEAD);
	const tail = text.slice(text.length - OUTPUT_TAIL);
	const marker = `\n\n[... ${truncatedChars} characters truncated ...]\n\n`;
	return { text: `${head}${marker}${tail}`, truncated: true, truncatedChars };
}

export function formatSuccess(printed: string, value: unknown): FormattedResult {
	const sections: string[] = [];
	if (printed !== "") {
		sections.push(`[printed]\n${printed}`);
	}
	const valueText = typeof value === "undefined" ? undefined : formatValue(value);
	if (valueText !== undefined) {
		sections.push(`[value]\n${valueText}`);
	}
	const raw = sections.length > 0 ? sections.join("\n\n") : "(no output)";
	const limited = applyOutputLimit(raw);
	return {
		text: limited.text,
		raw,
		isError: false,
		details: {
			...(printed !== "" ? { printed } : {}),
			...(valueText !== undefined ? { value: valueText } : {}),
			truncated: limited.truncated,
			truncatedChars: limited.truncatedChars,
		},
	};
}

export function formatFailure(errorText: string): FormattedResult {
	const raw = `[error]\n${errorText}`;
	const limited = applyOutputLimit(raw);
	return {
		text: limited.text,
		raw,
		isError: true,
		details: {
			error: errorText,
			truncated: limited.truncated,
			truncatedChars: limited.truncatedChars,
		},
	};
}

export function formatSyntaxError(failure: TranspileFailure): string {
	const excerpt = failure.lineText !== "" ? `\n  ${failure.lineText.trim()}` : "";
	return `SyntaxError: ${failure.message}\n行: ${failure.line}${excerpt}\n提案: 構文を修正してから再実行してください。`;
}

export function formatRuntimeError(error: unknown, convertedCode: string): string {
	const name = readStringProperty(error, "name") ?? "Error";
	const message = readStringProperty(error, "message") ?? String(error);
	const stack = readStringProperty(error, "stack") ?? "";
	const frame = findCellFrame(stack);
	let location = "";
	if (frame !== undefined) {
		const cellLine = frame.line - 1;
		const excerpt = convertedCode.split("\n")[frame.line - 1]?.trim() ?? "";
		location = `\n行: ${cellLine}${excerpt !== "" ? `\n  ${excerpt}` : ""}`;
	}
	return `${name}: ${message}${location}\n提案: ${suggestFix(name, message)}`;
}

/**
 * Pick the first frame that points into the cell script. Frames from the host (the REPL
 * implementation, tests, or `runInContext`) never match and are dropped. Exposed for tests.
 */
export function findCellFrame(stack: string): { line: number; column: number } | undefined {
	const match = CELL_FRAME.exec(stack);
	if (match === null) {
		return undefined;
	}
	return { line: Number(match[1]), column: Number(match[2]) };
}

/** A name the vm does not carry, read whole: `$process` is a different name from `process`. */
const MISSING_REFERENCE = /^([A-Za-z_$][\w$]*) is not defined$/;
/** The same name as a call spells it: `require("fs")` fails as `'require' is undefined`. */
const MISSING_CALL = /'([A-Za-z_$][\w$]*)' is undefined\b/;

/**
 * The absent global a message names, if it names one.
 *
 * Only the two shapes the vm throws answer here, and each is read from its own error kind: a bare
 * reference is a `ReferenceError` whose message is `X is not defined`, and calling the absent name is
 * a `TypeError` that quotes it. An `Error` that merely says "process is not defined by this
 * configuration", and a reference to `$process`, are not the vm reporting a host global.
 */
function unprovidedGlobal(errorName: string, message: string): MissingGlobal | undefined {
	const named = missingName(errorName, message);
	if (named === undefined) return undefined;
	return MISSING_GLOBALS.find((entry) => entry.name === named);
}

/** The absent name, from the error kind's own spelling of it. */
function missingName(errorName: string, message: string): string | undefined {
	if (errorName === "ReferenceError") return MISSING_REFERENCE.exec(message)?.[1];
	if (errorName === "TypeError") return MISSING_CALL.exec(message)?.[1];
	return undefined;
}


/**
 * The one line that tells the model what to change.
 *
 * A name the vm leaves out on purpose answers with its own replacement (`await use("node:...")`) from
 * `MISSING_GLOBALS`, because the generic advice below would send the model to assign a host global it
 * cannot have.
 */
function suggestFix(name: string, message: string): string {
	const unprovided = unprovidedGlobal(name, message);
	if (unprovided !== undefined) return unprovided.suggestion;
	if (name === "ReferenceError") {
		if (/\bconsole\b/.test(message)) {
			return "`console` は提供していません。文字列は `print(...)` で出力してください。";
		}
		const missing = MISSING_REFERENCE.exec(message)?.[1];
		if (missing === undefined) {
			return "参照名の綴りを確認し、セルをまたぐ値は `globalThis` へ代入してください。";
		}
		return `セルをまたいで値を残すには \`globalThis.${missing} = ...\` のように \`globalThis\` へ代入してください。`;
	}
	if (name === "TypeError") {
		return "対象の値が想定した型か確認し、必要なら null / undefined をガードしてください。";
	}
	return "エラーメッセージの箇所を修正して再実行してください。";
}

function readStringProperty(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const property = value[key];
	return typeof property === "string" ? property : undefined;
}
