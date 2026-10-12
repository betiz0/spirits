/**
 * Temporary-directory cleanup for self-update.
 *
 * Temp directories are named `.spirits-tmp-<pid>` so a later run can tell leftovers from
 * concurrent runs. A directory whose owner process still exists is never removed; `EPERM` counts
 * as alive so another user's update is not disturbed.
 */

import { rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_TEMP_DIR_PREFIX } from "../constants.ts";

/** Positive decimal PIDs only. */
const PID_PATTERN = /^[1-9][0-9]*$/;

/** Conventional exit code for a process terminated by SIGINT (128 + 2). */
const SIGINT_EXIT_CODE = 130;

/** Conventional exit code for a process terminated by SIGTERM (128 + 15). */
const SIGTERM_EXIT_CODE = 143;

/** Handle returned by `guardTempDir`; removes the signal handlers. */
export interface TempDirCleanupHandle {
	dispose(): void;
}

/** Extract the owner PID from a temp directory name, or `undefined` for other entries. */
export function parseTempDirPid(name: string): number | undefined {
	if (!name.startsWith(UPDATE_TEMP_DIR_PREFIX)) return undefined;
	const raw = name.slice(UPDATE_TEMP_DIR_PREFIX.length);
	if (!PID_PATTERN.test(raw)) return undefined;
	const pid = Number(raw);
	return Number.isSafeInteger(pid) ? pid : undefined;
}

/** True when a process with `pid` exists. `EPERM` counts as alive. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH";
	}
}

/** Remove leftover temp directories in `installDir` whose owner process is gone. */
export async function cleanStaleTempDirs(installDir: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(installDir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const pid = parseTempDirPid(entry);
		if (pid === undefined || isProcessAlive(pid)) continue;
		await rm(join(installDir, entry), { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Remove `tempDir` and exit with the conventional code on SIGINT / SIGTERM.
 *
 * The removal is synchronous so it also completes while a download is in flight.
 */
export function guardTempDir(tempDir: string): TempDirCleanupHandle {
	const remove = (): void => {
		rmSync(tempDir, { recursive: true, force: true });
	};
	const onSigint = (): void => {
		remove();
		process.exit(SIGINT_EXIT_CODE);
	};
	const onSigterm = (): void => {
		remove();
		process.exit(SIGTERM_EXIT_CODE);
	};
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	return {
		dispose(): void {
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
		},
	};
}
