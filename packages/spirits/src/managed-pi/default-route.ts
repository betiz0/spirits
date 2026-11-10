/**
 * The default launch route.
 *
 * `spirits` starts managed: the verified official Pi plus the spirits extension bundle, storing in
 * the agent directory the fork route has always used. The fork stays reachable through
 * `SPIRITS_ROUTE=fork`, and uncompiled (source) runs stay on the fork so development never needs a
 * downloaded set.
 *
 * Order matters, because every step here happens before a Pi process exists:
 *
 * 1. resolve the agent directory with the fork's own rule, so an explicit
 *    `SPIRITS_CODING_AGENT_DIR` keeps the meaning the fork gave it;
 * 2. verify the managed set, fetching it from the running binary's release when it is absent;
 * 3. take the one-time backup of the agent directory;
 * 4. spawn.
 *
 * A step that fails prints the reason, `spirits managed-pi repair`, and `SPIRITS_ROUTE=fork`, and
 * returns non-zero. The launcher never starts the fork instead: a silent fallback would hide a
 * corrupt set behind a session that looks like it worked.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	AGENT_BACKUP_STATE_FILE_NAME,
	ENV_ROUTE,
	ROUTE_FORK_VALUE,
	SPIRITS_BACKUPS_DIR_NAME,
	SPIRITS_CONFIG_DIR_NAME,
} from "../constants.ts";
import { resolveAgentDir } from "../env-defaults.ts";
import { backupAgentDirOnce } from "./agent-backup.ts";
import type { ManagedEnv } from "./environment.ts";
import { readCurrentSet } from "./layout.ts";
import { spawnManagedSet, type ManagedSpawn } from "./launch.ts";
import { installManagedSetFromRelease } from "./release-assets.ts";
import { releaseTagForVersion } from "../update/release.ts";
import { assertSupportedManagedPlatform, managedRepairHint, verifyManagedSet } from "./verify.ts";
import type { FetchLike } from "../update/types.ts";

/** Route the launcher takes for this run. */
export type StartupRoute = "managed" | "fork";

/** Inputs for the route decision. All values come from the caller, so a test drives every branch. */
export interface SelectStartupRouteOptions {
	/** Environment as the caller handed it over, before the wrapper applied its defaults. */
	env: Readonly<Record<string, string | undefined>>;
	/** True for the compiled binary. A source run has no embedded version and no release to fetch. */
	compiled: boolean;
}

/**
 * Pick the launch route.
 *
 * Only the exact value `fork` selects the fork. Any other value keeps the default, so a variable a
 * user set for another purpose cannot turn the default route into an error.
 */
export function selectStartupRoute(options: SelectStartupRouteOptions): StartupRoute {
	if (!options.compiled) return "fork";
	return options.env[ENV_ROUTE] === ROUTE_FORK_VALUE ? "fork" : "managed";
}

/** Refusal shown when managed cannot start. It never offers a silent fallback. */
export function defaultManagedFailureMessage(reason: string): string {
	return `${managedRepairHint(`The managed launch did not start: ${reason}`)}\nThere is no silent fallback: no Pi process was started.`;
}

/** Inputs for one default managed launch. */
export interface DefaultManagedStartupOptions {
	/** Managed root (`<home>/.spirits/managed-pi`). */
	root: string;
	home: string;
	/** Caller environment before the wrapper applied its defaults. */
	env: ManagedEnv;
	/** Pi arguments, forwarded unchanged. */
	args: readonly string[];
	/** Version embedded in the running binary; its release is where the set comes from. */
	version: string;
	fetch: FetchLike;
	cwd?: string;
	io?: { out(line: string): void; err(line: string): void };
	/** Test-only spawn seam. */
	spawn?: ManagedSpawn;
	/** Timestamp for the backup directory name. */
	now?: Date;
	/** Backups root override; tests point it inside an isolated home. */
	backupsDir?: string;
}

/** Result of a default managed launch attempt. */
export interface DefaultManagedStartupResult {
	exitCode: number;
	launched: boolean;
	/** Agent directory the child was told to use. */
	agentDir: string;
}

const DEFAULT_IO = {
	out: (line: string) => console.log(line),
	err: (line: string) => console.error(line),
};

/** Backups root for a home directory. */
export function backupsDir(home: string = homedir()): string {
	return join(home, SPIRITS_CONFIG_DIR_NAME, SPIRITS_BACKUPS_DIR_NAME);
}

/** Backup record path, kept in the managed root rather than in the directory being copied. */
export function agentBackupStatePath(root: string): string {
	return join(root, AGENT_BACKUP_STATE_FILE_NAME);
}

/** Verify the current set, or fail with a reason the caller turns into a refusal. */
async function requireCurrentSet(options: DefaultManagedStartupOptions): Promise<void> {
	const io = options.io ?? DEFAULT_IO;
	const setId = await readCurrentSet(options.root);
	if (setId === undefined) {
		const tag = releaseTagForVersion(options.version);
		io.out(`The managed Pi set is not installed. Installing it from ${tag}...`);
		await installManagedSetFromRelease({
			root: options.root,
			tag,
			env: options.env,
			fetch: options.fetch,
			io,
		});
		return;
	}
	// A set that exists but does not verify is left alone. Refetching on every launch would retry a
	// download over a disk or permission problem and would hide which file is broken.
	const verified = await verifyManagedSet(options.root, setId);
	assertSupportedManagedPlatform(verified.manifest.platform);
}

/**
 * Run the default managed launch.
 *
 * The agent directory comes from the fork's rule, the arguments are forwarded unchanged, and the
 * session directory is left to Pi so the existing per-project session layout stays readable.
 */
export async function runDefaultManagedStartup(
	options: DefaultManagedStartupOptions,
): Promise<DefaultManagedStartupResult> {
	const io = options.io ?? DEFAULT_IO;
	const agentDir = resolveAgentDir(options.env, options.home);
	try {
		await requireCurrentSet(options);
		await backupAgentDirOnce({
			agentDir,
			backupsDir: options.backupsDir ?? backupsDir(options.home),
			statePath: agentBackupStatePath(options.root),
			io,
			now: options.now,
		});
	} catch (error) {
		io.err(defaultManagedFailureMessage(error instanceof Error ? error.message : String(error)));
		return { exitCode: 1, launched: false, agentDir };
	}
	const exitCode = await spawnManagedSet({
		root: options.root,
		args: options.args,
		env: options.env,
		agentDir,
		cwd: options.cwd,
		spawn: options.spawn,
	});
	return { exitCode, launched: true, agentDir };
}
