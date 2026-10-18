/**
 * Full-output spill.
 *
 * A cell whose formatted result text exceeded the output limit keeps its whole text in a file, so
 * the model can read the part the limit cut away. The destination is injectable: tests substitute a
 * writer, and a writer that throws only changes the note appended to the result text.
 */

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Prefix of a spill file name. The extension is `.txt` so editors render it as text. */
const SPILL_FILE_PREFIX = "spirits-tsrepl-";

/** File mode of a spill file: owner read/write only, like pi's bash output files. */
const SPILL_FILE_MODE = 0o600;

/** Write the whole result text somewhere and return the path. Throws when the write fails. */
export type SpillWriter = (fullText: string) => Promise<string>;

/** Where the whole result text ended up after a truncation. */
export type SpillOutcome = { status: "saved"; path: string } | { status: "failed"; reason: string };

/**
 * Default writer: `os.tmpdir()/spirits-tsrepl-<hex>.txt`, mode 0600, cleaned by the OS.
 *
 * The file is created exclusively (`flag: "wx"`). A shared tmp can already hold that name, or a
 * symlink planted under it, and `mode` only applies to a new file: on a collision the write fails
 * and the result text reports the reason instead of overwriting someone else's file.
 */
export async function spillToTempFile(fullText: string): Promise<string> {
	const target = path.join(tmpdir(), `${SPILL_FILE_PREFIX}${randomBytes(4).toString("hex")}.txt`);
	await writeFile(target, fullText, { mode: SPILL_FILE_MODE, flag: "wx" });
	return target;
}

/** Render the line appended to a truncated result text. */
export function spillNotice(outcome: SpillOutcome): string {
	return outcome.status === "saved"
		? `\n\n[全文: ${outcome.path}]`
		: `\n\n[全文の保存に失敗しました: ${outcome.reason}]`;
}

/** Shorten a write failure to one line for the result text. */
export function spillReason(error: unknown): string {
	if (error instanceof Error) {
		return error.message.split("\n")[0] ?? error.name;
	}
	return String(error);
}
