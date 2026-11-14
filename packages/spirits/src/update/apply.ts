/**
 * Atomic placement of verified update artifacts.
 *
 * Each verified file is chmodded and renamed onto its installed path. rename is atomic within a
 * filesystem, so each installed path is always either the old file or the complete new file.
 */

import { chmod, rename, rm } from "node:fs/promises";

/** Executable permission bits for the installed binary. */
const EXECUTABLE_MODE = 0o755;

/** Options accepted by `applyVerifiedBinary`. */
export interface ApplyVerifiedBinaryOptions {
	/** Temporary directory created for this update; removed on success and failure. */
	tempDir: string;
	/** Verified file inside `tempDir`. */
	downloadedPath: string;
	/** Installed executable path. */
	targetPath: string;
}

/** Move the verified file onto the installed path and remove the temporary directory. */
export async function applyVerifiedBinary(options: ApplyVerifiedBinaryOptions): Promise<void> {
	try {
		await chmod(options.downloadedPath, EXECUTABLE_MODE);
		await rename(options.downloadedPath, options.targetPath);
	} catch (error) {
		await rm(options.tempDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
	await rm(options.tempDir, { recursive: true, force: true }).catch(() => {});
}
