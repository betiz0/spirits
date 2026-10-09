/**
 * Memory storage (`note`) and the startup summary injected as `spirits_memory`.
 *
 * The summary is a bounded excerpt: cleanup candidates first, then `notes.md` from the
 * tail, then the other Markdown files by name from the head. The whole body is capped
 * so a large memory directory cannot inflate the system prompt without bound. When the
 * cap bites, `notes.md` drops its oldest lines first (the newest notes stay), other
 * files lose their tail, and cuts never split a surrogate pair.
 */

import { mkdir, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MEMORY_NOTES_FILE_NAME } from "../constants.ts";
import type { MemoryLimits } from "../config.ts";
import type { HostFnCallable, HostFnEntry, HostFnScope } from "../repl/registry.ts";
import { buildNoteGuidance } from "./guidance.ts";
import { memoryDir, notesPath } from "./paths.ts";

/** Only Markdown files are summarized. */
const MEMORY_FILE_EXTENSION = ".md";

/** Prefix of every appended note line. */
const NOTE_LINE_PREFIX = "- ";

/** Newlines normalized to a single space. CRLF first so it becomes one replacement. */
const NEWLINE_PATTERN = /\r\n|\r|\n/g;

/** Replacement for each newline in a note. */
const NEWLINE_REPLACEMENT = " ";

/** Custom session entry type recording an appended note. */
const MEMORY_ENTRY_TYPE = "spirits_memory";

/** Separator for the line-append safeguard and the trailing newline of each note. */
const NOTE_LINE_SEPARATOR = "\n";

/** Byte value of `\n`; checked on the last byte of an existing notes.md. */
const NEWLINE_BYTE = 0x0a;

/** Fixed first line of the summary. */
const SUMMARY_HEADING = "## メモリ（抜粋）: 全文は各ファイルのパスを read で読んでください。";

/** Heading of the cleanup candidate list. */
const CLEANUP_HEADING = "### 整理候補（行数上限を超えたファイル）";

/** Label for a tail excerpt (`notes.md`). */
const TAIL_LABEL = "末尾";

/** Label for a head excerpt (all other files). */
const HEAD_LABEL = "先頭";

/** Per-file heading hint so a truncated section still points at the full file. */
const FILE_HEADING_HINT = "全文はこのファイルを read で読む";

/** Prefix of every file heading line. */
const FILE_HEADING_PREFIX = "### ";

/** Wrapper and separators of the file heading details. */
const HEADING_OPEN = "（";
const HEADING_CLOSE = "）";
const HEADING_SEPARATOR = " / ";
const HEADING_DETAIL_SEPARATOR = "、";

/** Unit appended to a line count. */
const LINE_UNIT = " 行";

/** Prefix of a cleanup candidate line. */
const LIST_ITEM_PREFIX = "- ";

/** Separator between summary blocks and between the lines inside a block. */
const BLOCK_SEPARATOR = "\n";

/** Fixed suffix appended when the body is capped. */
const TRUNCATION_NOTICE =
	"\n…（メモリ要約は上限のため切り詰めました。全文は各ファイルを read で読んでください）";

/** UTF-16 code-unit bounds of the high-surrogate range; cuts must not split a pair. */
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/** One readable memory file. */
interface MemoryFile {
	name: string;
	/** Absolute path shown in the heading. */
	path: string;
	lines: string[];
}

/** `notes.md` with the tail excerpt selected before capping. */
interface NotesExcerpt {
	file: MemoryFile;
	lines: string[];
}

export interface CreateNoteHostFnOptions {
	pi: Pick<ExtensionAPI, "appendEntry">;
	agentDir: string;
	/** Clock for the timestamp. Injected by tests; defaults to the wall clock. */
	now?: () => Date;
}

/** Build the `note` host function. */
export function createNoteHostFn(options: CreateNoteHostFnOptions): HostFnEntry {
	const { pi, agentDir } = options;
	const now = options.now ?? ((): Date => new Date());
	return {
		name: "note",
		description: buildNoteGuidance(),
		create(_scope: HostFnScope): HostFnCallable {
			return async (text: unknown): Promise<string> => {
				if (typeof text !== "string") {
					throw new Error("note: text は文字列でなければなりません。");
				}
				if (text.trim() === "") {
					throw new Error("note: 空または空白のみの text は追記できません。");
				}
				const normalized = text.replace(NEWLINE_PATTERN, NEWLINE_REPLACEMENT);
				const timestamp = now().toISOString();
				const file = notesPath(agentDir);
				await mkdir(memoryDir(agentDir), { recursive: true });
				const handle = await open(file, "a+");
				try {
					// Appending to a file that does not end in a newline would join the
					// lines; read only the last byte and prepend a separator when needed.
					const { size } = await handle.stat();
					let separator = "";
					if (size > 0) {
						const lastByte = Buffer.alloc(1);
						await handle.read(lastByte, 0, 1, size - 1);
						if (lastByte[0] !== NEWLINE_BYTE) {
							separator = NOTE_LINE_SEPARATOR;
						}
					}
					const line = `${NOTE_LINE_PREFIX}${timestamp} ${normalized}${NOTE_LINE_SEPARATOR}`;
					await handle.write(`${separator}${line}`);
				} finally {
					await handle.close();
				}
				pi.appendEntry(MEMORY_ENTRY_TYPE, { text: normalized, timestamp, file });
				return `メモリに追記しました: ${file}`;
			};
		},
	};
}

/**
 * Build the `spirits_memory` body, or `undefined` when no Markdown file is readable
 * under `<agentDir>/memory/`. An unreadable file is skipped without failing the rest.
 */
export async function buildMemorySummary(
	agentDir: string,
	limits: MemoryLimits,
): Promise<string | undefined> {
	const dir = memoryDir(agentDir);
	let names: string[];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		names = entries
			.filter((entry) => !entry.isDirectory() && entry.name.endsWith(MEMORY_FILE_EXTENSION))
			.map((entry) => entry.name)
			.sort(compareNames);
	} catch {
		return undefined;
	}

	const files: MemoryFile[] = [];
	for (const name of names) {
		const absolutePath = path.join(dir, name);
		try {
			const content = await readFile(absolutePath, "utf8");
			files.push({ name, path: absolutePath, lines: splitLines(content) });
		} catch {
			// A single unreadable file must not hide the rest.
		}
	}
	if (files.length === 0) {
		return undefined;
	}

	return assembleSummary(files, limits);
}

/** Assemble the summary, capping it at `limits.injectionCharLimit`. */
function assembleSummary(files: readonly MemoryFile[], limits: MemoryLimits): string {
	const candidates = files.filter((file) => file.lines.length > limits.fileLineLimit);
	const notesFile = files.find((file) => file.name === MEMORY_NOTES_FILE_NAME);
	const others = files.filter((file) => file.name !== MEMORY_NOTES_FILE_NAME);

	const prefixParts = [SUMMARY_HEADING];
	if (candidates.length > 0) {
		prefixParts.push([CLEANUP_HEADING, ...candidates.map(cleanupItem)].join(BLOCK_SEPARATOR));
	}
	const prefix = prefixParts.join(BLOCK_SEPARATOR);

	const notes =
		notesFile === undefined
			? undefined
			: { file: notesFile, lines: tailExcerpt(notesFile.lines, limits.previewLines) };
	const otherBlocks = others.map((file) =>
		fileBlock(file, false, Math.min(limits.previewLines, file.lines.length)),
	);
	const full = [
		prefix,
		notes === undefined ? undefined : fileBlock(notes.file, true, notes.lines.length),
		...otherBlocks,
	]
		.filter((block): block is string => block !== undefined)
		.join(BLOCK_SEPARATOR);

	return capSummary(full, prefix, notes, otherBlocks, limits.injectionCharLimit);
}

/**
 * Cap the body at `limit`. The fixed heading, cleanup candidates, and `notes.md` are
 * kept first; `notes.md` loses old lines (its heading line count shrinks to match) and
 * other files lose their tail. The truncation notice itself stays inside the limit.
 */
function capSummary(
	full: string,
	prefix: string,
	notes: NotesExcerpt | undefined,
	otherBlocks: readonly string[],
	limit: number,
): string {
	if (full.length <= limit) {
		return full;
	}
	if (limit <= TRUNCATION_NOTICE.length) {
		return cutAt(full, limit);
	}
	const budget = limit - TRUNCATION_NOTICE.length;
	if (prefix.length >= budget) {
		// Even the fixed prefix does not fit: cut the whole body from the end.
		return `${cutAt(full, budget)}${TRUNCATION_NOTICE}`;
	}
	let out = prefix;
	if (notes !== undefined) {
		const space = budget - out.length - BLOCK_SEPARATOR.length;
		const fitted = fitNotesBlock(notes, space);
		if (fitted === undefined) {
			return `${cutAt(full, budget)}${TRUNCATION_NOTICE}`;
		}
		out += BLOCK_SEPARATOR + fitted.block;
		if (!fitted.complete) {
			// The newest line was cut to fill the space; nothing else can fit.
			return `${out}${TRUNCATION_NOTICE}`;
		}
	}
	for (const block of otherBlocks) {
		const space = budget - out.length - BLOCK_SEPARATOR.length;
		if (block.length <= space) {
			out += BLOCK_SEPARATOR + block;
			continue;
		}
		if (space > 0) {
			out += BLOCK_SEPARATOR + cutAt(block, space);
		}
		return `${out}${TRUNCATION_NOTICE}`;
	}
	return `${out}${TRUNCATION_NOTICE}`;
}

interface FittedNotes {
	block: string;
	/** False when the newest line was cut to fit. */
	complete: boolean;
}

/**
 * Fit the `notes.md` block into `space`: drop the oldest lines until it fits, and if
 * even one line does not fit, keep the heading and the front of the newest line.
 * Returns `undefined` when not even the heading fits.
 */
function fitNotesBlock(notes: NotesExcerpt, space: number): FittedNotes | undefined {
	if (notes.lines.length === 0) {
		const block = fileBlock(notes.file, true, 0);
		return block.length <= space ? { block, complete: true } : undefined;
	}
	for (let shown = notes.lines.length; shown >= 1; shown--) {
		const block = fileBlock(notes.file, true, shown);
		if (block.length <= space) {
			return { block, complete: shown === notes.lines.length };
		}
	}
	const heading = fileHeading(notes.file, true, 1);
	if (heading.length > space) {
		return undefined;
	}
	const newest = notes.lines[notes.lines.length - 1] ?? "";
	const roomForLine = space - heading.length - BLOCK_SEPARATOR.length;
	const partial = roomForLine > 0 ? cutAt(newest, roomForLine) : "";
	const block = partial === "" ? heading : `${heading}${BLOCK_SEPARATOR}${partial}`;
	return { block, complete: false };
}

/** Split on `\n`, dropping the single empty element created by a trailing newline. */
function splitLines(content: string): string[] {
	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

/** The last `previewLines` lines (or all lines when the file is shorter). */
function tailExcerpt(lines: readonly string[], previewLines: number): string[] {
	return lines.slice(Math.max(0, lines.length - previewLines));
}

/** Excerpt block for one file: heading plus `shown` excerpt lines. */
function fileBlock(file: MemoryFile, fromTail: boolean, shown: number): string {
	const heading = fileHeading(file, fromTail, shown);
	if (shown === 0) {
		return heading;
	}
	const excerpt = fromTail ? file.lines.slice(file.lines.length - shown) : file.lines.slice(0, shown);
	return [heading, ...excerpt].join(BLOCK_SEPARATOR);
}

/** Heading line: absolute path, head/tail position, shown/total lines, full-text hint. */
function fileHeading(file: MemoryFile, fromTail: boolean, shown: number): string {
	const position = fromTail ? TAIL_LABEL : HEAD_LABEL;
	const counts = `${position} ${shown}${LINE_UNIT}${HEADING_SEPARATOR}全 ${file.lines.length}${LINE_UNIT}`;
	const details = [counts, FILE_HEADING_HINT].join(HEADING_DETAIL_SEPARATOR);
	return `${FILE_HEADING_PREFIX}${file.path}${HEADING_OPEN}${details}${HEADING_CLOSE}`;
}

/** Cleanup candidate line: file name and its line count. */
function cleanupItem(file: MemoryFile): string {
	return `${LIST_ITEM_PREFIX}${file.name}${HEADING_OPEN}${file.lines.length}${LINE_UNIT}${HEADING_CLOSE}`;
}

/** Cut to `length` without keeping a lone high surrogate at the end. */
function cutAt(body: string, length: number): string {
	let end = Math.max(0, length);
	if (end > 0 && isHighSurrogate(body.charCodeAt(end - 1))) {
		end -= 1;
	}
	return body.slice(0, end);
}

function isHighSurrogate(code: number): boolean {
	return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

/** Plain code-unit ordering; locale-aware ordering would make the summary environment-dependent. */
function compareNames(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
