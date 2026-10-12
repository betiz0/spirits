/**
 * Atomic placement of a verified binary.
 *
 * The verified file is chmodded and renamed onto the installed path. rename is atomic within a
 * filesystem, so the installed path is always either the old file or the complete new file. The
 * temporary directory is removed on both success and failure.
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
