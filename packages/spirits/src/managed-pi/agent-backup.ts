/**
 * One-time backup of the agent directory before the first managed launch.
 *
 * The default route points the managed Pi at the agent directory the fork route has been writing.
 * Before that process ever opens the directory, the launcher copies it once. The copy is the way
 * back for data the managed route has never written, so a failed copy stops the launch instead of
 * trading the only copy for a launch.
 *
 * Rules the callers depend on:
 *
 * - once per agent directory, recorded in the managed root, never a second time;
 * - symlinks stay symlinks. `~/.spirits/agent/skills -> ~/.pi/agent/skills` is copied as a link and
 *   reported with its target, because following it would copy data the agent directory does not own
 *   and would make the restore overwrite that data;
 * - file and directory permission bits are preserved;
 * - the copy lands in a `.partial` directory and is renamed when complete, so an interrupted backup
 *   never looks like a finished one;
 * - any failure throws with the path that failed and leaves no record, so the next launch retries.
 *
 * This is a copy, not a snapshot: files a concurrent process writes while the copy runs can be
 * mixed. The launcher runs before any Pi process exists, which is the closest thing to a quiet
 * moment the route has.
 */

import { chmod, copyFile, lstat, mkdir, readlink, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { AGENT_BACKUP_DIR_PREFIX, AGENT_BACKUP_TEMP_SUFFIX } from "../constants.ts";
import type { ManagedIo } from "./install.ts";

/** Permission bits copied from the source entry. */
const MODE_BITS = 0o7777;

/** One symlink found in the agent directory, reported with the target it points at. */
export interface AgentBackupLink {
	/** Path inside the backup, `/` separated from the backup root. */
	path: string;
	/** Raw link target, exactly as stored. */
	target: string;
	/** Resolved entity path, or `undefined` when the target does not exist. */
	resolved: string | undefined;
}

/** Outcome of one call to {@link backupAgentDirOnce}. */
export interface AgentBackupResult {
	/** Why the call did or did not copy. */
	reason: "backed-up" | "already-recorded" | "missing-agent-dir";
	/** Final backup directory, present only when a copy was taken. */
	destination?: string;
	/** Bytes of regular file content copied. */
	byteSize: number;
	/** Number of regular files copied. */
	fileCount: number;
	/** Symlinks kept as links. */
	links: AgentBackupLink[];
	/** Entries that are neither directory, regular file, nor symlink (sockets, fifos). */
	skipped: string[];
}

/** Inputs for one first-launch backup. */
export interface BackupAgentDirOptions {
	/** Agent directory the managed route is about to use. */
	agentDir: string;
	/** Backups root (`~/.spirits/backups`). */
	backupsDir: string;
	/** Record path inside the managed root. */
	statePath: string;
	/** Timestamp for the directory name and the record. Defaults to the current time. */
	now?: Date;
	io?: ManagedIo;
	/** Process id for the temporary directory name. Injectable for tests. */
	pid?: number;
}

/** Record written to the managed root once a backup has been handled. */
interface AgentBackupState {
	schemaVersion: 1;
	at: string;
	agentDir: string;
	reason: AgentBackupResult["reason"];
	destination?: string;
	byteSize: number;
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** UTC file-name-safe timestamp, e.g. `2026-11-10T09-12-33Z`. */
export function agentBackupTimestamp(now: Date): string {
	return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

/** Byte count for the user-visible summary. */
export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value = value / 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw new Error(`Could not read ${path}: ${errorMessage(error)}`);
	}
}

async function readState(statePath: string): Promise<AgentBackupState | undefined> {
	const text = await readFileOrUndefined(statePath).catch((error: unknown) => {
		throw new Error(`Could not read the backup record at ${statePath}: ${errorMessage(error)}`);
	});
	if (text === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`The backup record at ${statePath} is not valid JSON, so no backup was taken: ${errorMessage(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`The backup record at ${statePath} is not an object, so no backup was taken.`);
	}
	const state = parsed as Partial<AgentBackupState>;
	if (state.schemaVersion !== 1 || typeof state.reason !== "string") {
		throw new Error(`The backup record at ${statePath} has an unknown schemaVersion or reason.`);
	}
	return state as AgentBackupState;
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
	try {
		return await Bun.file(path).text();
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

interface CopyTotals {
	byteSize: number;
	fileCount: number;
	links: AgentBackupLink[];
	skipped: string[];
}

/** Copy one entry, keeping links as links and permission bits as they are. */
async function copyEntry(
	source: string,
	destination: string,
	sourceRoot: string,
	totals: CopyTotals,
): Promise<void> {
	const info = await lstat(source).catch((error: unknown) => {
		throw new Error(`Could not read ${source}: ${errorMessage(error)}`);
	});
	if (info.isSymbolicLink()) {
		const target = await readlink(source).catch((error: unknown) => {
			throw new Error(`Could not read the link ${source}: ${errorMessage(error)}`);
		});
		try {
			await symlink(target, destination);
		} catch (error) {
			throw new Error(`Could not copy the link ${source} to ${destination}: ${errorMessage(error)}`);
		}
		const resolved = await realpath(source).catch(() => undefined);
		// Reported relative to the agent directory, the path the user has to recognize.
		totals.links.push({ path: relative(sourceRoot, source), target, resolved });
		return;
	}
	if (info.isDirectory()) {
		try {
			await mkdir(destination, { mode: 0o700 });
		} catch (error) {
			throw new Error(`Could not create ${destination}: ${errorMessage(error)}`);
		}
		let names: string[];
		try {
			names = await readdirSorted(source);
		} catch (error) {
			throw new Error(`Could not read the directory ${source}: ${errorMessage(error)}`);
		}
		for (const name of names) {
			await copyEntry(join(source, name), join(destination, name), sourceRoot, totals);
		}
		await chmod(destination, info.mode & MODE_BITS).catch((error: unknown) => {
			throw new Error(`Could not set permissions on ${destination}: ${errorMessage(error)}`);
		});
		return;
	}
	if (info.isFile()) {
		try {
			await copyFile(source, destination);
			await chmod(destination, info.mode & MODE_BITS);
		} catch (error) {
			throw new Error(`Could not copy ${source} to ${destination}: ${errorMessage(error)}`);
		}
		totals.byteSize += info.size;
		totals.fileCount += 1;
		return;
	}
	totals.skipped.push(relative(sourceRoot, source));
}

async function readdirSorted(dir: string): Promise<string[]> {
	const names = await readdir(dir);
	return names.sort();
}

/** Show where the copy went, how big it is, and every link that stayed a link. */
function report(result: AgentBackupResult, io: ManagedIo): void {
	if (result.reason === "missing-agent-dir") {
		io.out("No agent directory to back up yet; the first managed launch will create it.");
		return;
	}
	if (result.reason !== "backed-up" || result.destination === undefined) return;
	io.out(`Backed up the agent directory before the first managed launch.`);
	io.out(`Backup: ${result.destination}`);
	io.out(`Size: ${formatByteSize(result.byteSize)} (${result.byteSize} bytes in ${result.fileCount} files)`);
	if (result.links.length > 0) {
		io.out(`Symlinks kept as links (${result.links.length}):`);
		for (const link of result.links) {
			io.out(`  ${link.path} -> ${link.target} (${link.resolved ?? "target does not exist"})`);
		}
	}
	if (result.skipped.length > 0) {
		io.out(`Skipped ${result.skipped.length} special entries: ${result.skipped.join(", ")}`);
	}
}

/**
 * Take the first-launch backup, or report that it was already handled.
 *
 * Throws with the failing path when a copy could not be completed; the caller then refuses to launch
 * managed so the user keeps the only copy of the data.
 */
const DEFAULT_IO: ManagedIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

export async function backupAgentDirOnce(options: BackupAgentDirOptions): Promise<AgentBackupResult> {
	const io = options.io ?? DEFAULT_IO;
	const now = options.now ?? new Date();
	const existing = await readState(options.statePath);
	if (existing !== undefined) {
		return { reason: "already-recorded", byteSize: 0, fileCount: 0, links: [], skipped: [] };
	}
	if (!(await exists(options.agentDir))) {
		await writeState(options.statePath, {
			schemaVersion: 1,
			at: now.toISOString(),
			agentDir: options.agentDir,
			reason: "missing-agent-dir",
			byteSize: 0,
		});
		const result: AgentBackupResult = { reason: "missing-agent-dir", byteSize: 0, fileCount: 0, links: [], skipped: [] };
		report(result, io);
		return result;
	}
	const name = `${AGENT_BACKUP_DIR_PREFIX}${agentBackupTimestamp(now)}`;
	const finalPath = join(options.backupsDir, name);
	const tempPath = `${finalPath}${AGENT_BACKUP_TEMP_SUFFIX}${options.pid ?? process.pid}`;
	const totals: CopyTotals = { byteSize: 0, fileCount: 0, links: [], skipped: [] };
	try {
		await mkdir(options.backupsDir, { recursive: true, mode: 0o700 });
		await rm(tempPath, { recursive: true, force: true });
		await copyEntry(options.agentDir, tempPath, options.agentDir, totals);
		await rename(tempPath, finalPath);
	} catch (error) {
		await rm(tempPath, { recursive: true, force: true }).catch(() => {});
		throw error instanceof Error ? error : new Error(String(error));
	}
	await writeState(options.statePath, {
		schemaVersion: 1,
		at: now.toISOString(),
		agentDir: options.agentDir,
		reason: "backed-up",
		destination: finalPath,
		byteSize: totals.byteSize,
	});
	const result: AgentBackupResult = {
		reason: "backed-up",
		destination: finalPath,
		byteSize: totals.byteSize,
		fileCount: totals.fileCount,
		links: totals.links,
		skipped: totals.skipped,
	};
	report(result, io);
	return result;
}

async function writeState(statePath: string, state: AgentBackupState): Promise<void> {
	await mkdir(join(statePath, ".."), { recursive: true, mode: 0o700 }).catch(() => {});
	try {
		await writeFile(statePath, `${JSON.stringify(state, null, "\t")}\n`);
	} catch (error) {
		throw new Error(`Could not write the backup record at ${statePath}: ${errorMessage(error)}`);
	}
}
