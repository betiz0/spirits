/**
 * Result and error formatting.
 *
 * A successful cell renders `[printed]` / `[value]` sections, a failed cell renders an
 * `[error]` section. The whole rendered text is truncated once, after formatting, so the
 * limit also applies to errors.
 */

import type { TranspileFailure } from "./transpile.ts";
import { isRecord } from "./guards.ts";

export const OUTPUT_LIMIT = 8000;
export const OUTPUT_HEAD = 4800;
export const OUTPUT_TAIL = 3200;

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

function suggestFix(name: string, message: string): string {
	if (name === "ReferenceError") {
		if (/\bconsole\b/.test(message)) {
			return "`console` は提供していません。文字列は `print(...)` で出力してください。";
		}
		const missing = /(\w[\w$]*) is not defined/.exec(message);
		if (missing !== null) {
			return `セルをまたいで値を残すには \`globalThis.${missing[1]} = ...\` のように \`globalThis\` へ代入してください。`;
		}
		return "参照名の綴りを確認し、セルをまたぐ値は `globalThis` へ代入してください。";
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
