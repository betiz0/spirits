/**
 * Report numbering and the exclusive, whole-file creation under a change's directory.
 *
 * The series is `verify1.md`, `verify2.md`, … and `d-verify1.md`, …: the number is one past the
 * highest file of the same series in the directory (never a repair of a gap), and files outside the
 * series — notes, backups, the temporary file this module writes — do not count (design Decision 4
 * of the report-saving change).
 *
 * A report is evidence for an archive decision, so the final name only ever holds a complete body:
 * the body is written into a same-directory temporary file that no series matches, and only then
 * linked to the final name. `link` fails with `EEXIST` when another run created the name after this
 * module read the directory, and the save re-numbers instead of replacing — a POSIX `rename` would
 * silently replace, which is exactly the overwrite this layer exists to prevent.
 *
 * Nothing here throws at the save caller: a directory that disappeared before the numbering and a
 * write that failed after the temporary file was created both answer with a reason, and a temporary
 * file this call created is always removed on the way out (design Decision 5, d-verify3 C-2).
 */

import { link, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	VERIFY_REPORT_NUMBER_MAX,
	VERIFY_REPORT_LINK_RETRY_MAX,
	VERIFY_REPORT_TEMP_PREFIX,
} from "../constants.ts";

/** What creating a report file answers: the path it created, or why it did not. */
export type CreateReportResult = { kind: "ok"; path: string } | { kind: "error"; reason: string };

/** Escape a literal for use inside a `RegExp`. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The one pattern that says a file name belongs to `prefix`'s series: exactly `<prefix><n>.md`. */
export function reportSeriesPattern(prefix: string): RegExp {
	return new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.md$`);
}

/**
 * The number the next report of `prefix` in `dir` takes: the highest existing one plus one, or 1.
 *
 * A gap is left alone on purpose (the numbering answers "how many times has this been verified",
 * not "which numbers are free"), and a name another run is about to take is caught later by the
 * exclusive link, not guessed here.
 *
 * `readdir` reports the directory's own failures (a directory that is gone is `ENOENT`); this helper
 * passes them through and {@link createReportFile} turns them into a save failure.
 */
export async function nextReportNumber(dir: string, prefix: string): Promise<number> {
	const pattern = reportSeriesPattern(prefix);
	let highest = 0;
	for (const name of await readdir(dir)) {
		const match = pattern.exec(name);
		if (!match) continue;
		const number = Number.parseInt(match[1]!, 10);
		if (number > highest) highest = number;
	}
	return highest + 1;
}

/**
 * Create `<prefix><n>.md` in `dir` holding `body`, whole or not at all.
 *
 * The body goes into a temporary file named from {@link VERIFY_REPORT_TEMP_PREFIX} (outside every
 * series), and `link` puts it at the final name atomically: an existing final name is never
 * replaced, a failed write leaves neither a partial final file nor a temporary one, and a name
 * taken between the numbering and the link moves the attempt to the next number.
 *
 * Two module-internal seams let the failure tests stand for what production cannot reproduce on
 * demand: `beforeLink` puts a file at the final name after the numbering (the one window the retry
 * exists for), and `writeTemp` stands for the body write failing **after** the temporary file was
 * created. Production calls leave both out.
 */
export async function createReportFile(
	dir: string,
	prefix: string,
	body: string,
	seams: CreateReportFileSeams = {},
): Promise<CreateReportResult> {
	const writeTemp = seams.writeTemp ?? writeWholeFile;
	for (let attempt = 0; attempt <= VERIFY_REPORT_LINK_RETRY_MAX; attempt += 1) {
		let number: number;
		try {
			number = await nextReportNumber(dir, prefix);
		} catch (error) {
			// The directory is gone (or unreadable) before a single byte was written: a reason, not a
			// throw, which is the save contract the tool hands to the model.
			return { kind: "error", reason: `could not read ${dir} to number the report: ${describeError(error)}` };
		}
		if (number > VERIFY_REPORT_NUMBER_MAX) {
			return { kind: "error", reason: `the report series for ${prefix} reached its number limit (${VERIFY_REPORT_NUMBER_MAX}).` };
		}
		const finalPath = join(dir, `${prefix}${number}.md`);
		const tempPath = join(dir, `${VERIFY_REPORT_TEMP_PREFIX}${randomUUID()}.tmp`);
		try {
			await writeTemp(tempPath, body);
		} catch (error) {
			// The write may have left a partial file at a name this call invented (its path carries a
			// fresh uuid and this module's prefix), and only that name is ever removed here.
			await unlink(tempPath).catch(() => {});
			return { kind: "error", reason: `could not write the report: ${describeError(error)}` };
		}
		try {
			await seams.beforeLink?.(finalPath);
			await link(tempPath, finalPath);
			// The link put the whole body at the final name; the temporary name goes with it.
			await unlink(tempPath).catch(() => {});
			return { kind: "ok", path: finalPath };
		} catch (error) {
			// The temporary file is always dropped: either the name was taken (the loop re-numbers)
			// or the link failed for another reason, and a leftover would sit in the directory.
			await unlink(tempPath).catch(() => {});
			if (isExistError(error) && attempt < VERIFY_REPORT_LINK_RETRY_MAX) continue;
			return { kind: "error", reason: `could not create ${finalPath}: ${describeError(error)}` };
		}
	}
	// Reached only if every attempt collided; the loop returns the last failure otherwise.
	return { kind: "error", reason: `the report name kept being taken by another run (after ${VERIFY_REPORT_LINK_RETRY_MAX} re-numbers).` };
}

/** The test seams of {@link createReportFile}; production wiring passes none. */
export interface CreateReportFileSeams {
	/** Runs after the numbering and before the link, with the name the link would take. */
	beforeLink?: (finalPath: string) => Promise<void> | void;
	/** Writes the body to a report's whole file. Stands in for the write-failure test. */
	writeTemp?: (tempPath: string, body: string) => Promise<void>;
}

/** The whole-file write of the body, exclusive on creation. What {@link CreateReportFileSeams.writeTemp} replaces. */
async function writeWholeFile(tempPath: string, body: string): Promise<void> {
	await writeFile(tempPath, body, { flag: "wx" });
}

/** True when the error says "the name already exists". */
function isExistError(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST";
}

/** The shortest stable text a Node fs error carries. */
function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

