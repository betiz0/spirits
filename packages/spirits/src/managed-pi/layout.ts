/**
 * Managed release layout and the atomic `current` switch.
 *
 * Layout:
 *   <managed root>/releases/<set-id>/{pi,spirits-extension.js,manifest.json}
 *   <managed root>/current -> releases/<set-id>
 *
 * The whole set is prepared in a temporary directory under the managed root and renamed into
 * `releases/`. Only a complete set becomes `current`; a failed update leaves the old link. The
 * rename of a symlink is atomic on Linux, which is the only supported platform.
 */

import { access, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import {
	MANAGED_PI_CURRENT_LINK_NAME,
	MANAGED_PI_RELEASES_DIR_NAME,
	MANAGED_PI_ROOT_NAME,
	MANAGED_PI_TEMP_DIR_PREFIX,
	SPIRITS_CONFIG_DIR_NAME,
} from "../constants.ts";
import { cleanStaleTempDirs } from "../update/cleanup.ts";

/** Resolve the managed root from a home directory. */
export function managedRoot(home: string = homedir()): string {
	return join(home, SPIRITS_CONFIG_DIR_NAME, MANAGED_PI_ROOT_NAME);
}

/** Releases directory inside a managed root. */
export function managedReleasesDir(root: string): string {
	return join(root, MANAGED_PI_RELEASES_DIR_NAME);
}

/** Directory of one set. */
export function managedSetDir(root: string, setId: string): string {
	return join(managedReleasesDir(root), setId);
}

/** `current` symlink path. */
export function managedCurrentPath(root: string): string {
	return join(root, MANAGED_PI_CURRENT_LINK_NAME);
}

/** Path of the installed official Pi package inside a set. */
export function managedPiDir(root: string, setId: string): string {
	return join(managedSetDir(root, setId), "pi");
}

/** Path of the official Pi executable inside a set. */
export function managedPiExecutable(root: string, setId: string): string {
	return join(managedPiDir(root, setId), "pi");
}

/** Path of the extension bundle inside a set. */
export function managedExtensionPath(root: string, setId: string): string {
	return join(managedSetDir(root, setId), "spirits-extension.js");
}

/** Path of the installed manifest inside a set. */
export function managedManifestPath(root: string, setId: string): string {
	return join(managedSetDir(root, setId), "manifest.json");
}

/** Temporary directory inside the managed root. */
export function managedTempDir(root: string, pid: number = process.pid): string {
	return join(root, `${MANAGED_PI_TEMP_DIR_PREFIX}${pid}`);
}

/** Ensure the managed root exists and remove stale temporary directories. */
export async function prepareManagedRoot(root: string): Promise<void> {
	await mkdir(managedReleasesDir(root), { recursive: true });
	await cleanStaleTempDirs(root);
}

/** Resolve the set id currently selected by `current`, or undefined when absent. */
export async function readCurrentSet(root: string): Promise<string | undefined> {
	try {
		const target = await readlink(managedCurrentPath(root));
		return basename(target);
	} catch {
		return undefined;
	}
}

/** Verify that a string cannot escape the managed root when used as a directory name. */
export function assertSafeSetId(setId: string): void {
	if (!setId || setId.includes("/") || setId.includes("\\") || setId === "." || setId === "..") {
		throw new Error(`Unsafe managed set id: ${setId}`);
	}
}

/** Move a completed release directory into `releases/`; returns the installed set path. */
export async function commitReleaseDir(root: string, setId: string, preparedDir: string): Promise<string> {
	assertSafeSetId(setId);
	const target = managedSetDir(root, setId);
	if (resolve(preparedDir) === resolve(target)) {
		return target;
	}
	await mkdir(managedReleasesDir(root), { recursive: true });
	if (!target.startsWith(managedReleasesDir(root) + sep)) {
		throw new Error(`Release target escaped the managed root: ${target}`);
	}
	// A repair uses the same set id. Move the old directory aside, install the new one, then
	// delete the backup. A failure restores the old directory so `current` never points at a
	// half-written set.
	const backup = join(root, `.previous-${process.pid}`);
	await rm(backup, { recursive: true, force: true });
	let movedPrevious = false;
	try {
		await rename(target, backup);
		movedPrevious = true;
	} catch {
		// No previous set with this id.
	}
	try {
		await rename(preparedDir, target);
	} catch (error) {
		if (movedPrevious) {
			await rename(backup, target).catch(() => {});
		}
		throw error;
	}
	if (movedPrevious) {
		await rm(backup, { recursive: true, force: true }).catch(() => {});
	}
	return target;
}

/** Atomically point `current` at `setId`. */
export async function switchCurrent(root: string, setId: string): Promise<void> {
	assertSafeSetId(setId);
	// Refuse to point `current` at a release that was never committed. The previous link stays.
	await access(managedSetDir(root, setId));
	const link = managedCurrentPath(root);
	const temporary = join(root, `.current-${process.pid}`);
	await rm(temporary, { force: true });
	await symlink(join(MANAGED_PI_RELEASES_DIR_NAME, setId), temporary);
	try {
		await rename(temporary, link);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}


/** Verification state written after a set is installed. */
export function managedInstalledStatePath(root: string, setId: string): string {
	return join(managedSetDir(root, setId), "installed.json");
}
