/**
 * The default launch route.
 *
 * `spirits` starts the managed host: the verified official Pi plus the spirits extension bundle,
 * storing in the agent directory the caller's rule selects. There is no second route. The Pi fork
 * is gone, so a launch that cannot verify a set refuses instead of falling back somewhere else.
 *
 * Order matters, because every step here happens before a host process exists:
 *
 * 1. refuse a run that still selects the removed fork route through the environment;
 * 2. resolve the agent directory, so an explicit `SPIRITS_CODING_AGENT_DIR` keeps its meaning;
 * 3. make sure a set is present. A compiled launcher fetches the missing one from its own release;
 *    a source run has no release to fetch from and is pointed at the install command;
 * 4. take the one-time backup of the agent directory;
 * 5. spawn.
 *
 * A step that fails prints the reason, `spirits managed-pi repair`, and the rollback lines, and
 * returns non-zero. The launcher never starts another host: a silent fallback would hide a corrupt
 * set behind a session that looks like it worked.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	AGENT_BACKUP_STATE_FILE_NAME,
	ENV_MANAGED_PI_MANIFEST_URL,
	ENV_ROUTE,
	MANAGED_PI_INSTALL_COMMAND,
	MANAGED_PI_ROLLBACK_HINT,
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

/**
 * Refusal shown when the environment still selects the fork route.
 *
 * This is the only reader of {@link ENV_ROUTE} and {@link ROUTE_FORK_VALUE} outside `constants.ts`.
 * Silently ignoring the setting would leave the user believing a fork was running, so the refusal
 * names the reason the setting stopped working, says `unset` restores the launch, and gives the way
 * back to a previous binary. Only the exact value counts, so a variable another tool set for its own
 * purpose cannot turn the launch into an error.
 *
 * The spirits subcommands (`update`, `managed-pi`, `--version`, `--help`) never reach this: the
 * launcher classifies them before a host launch, so an operator can repair the install with
 * `SPIRITS_ROUTE` still exported.
 */
export function forkRouteRefusal(env: Readonly<Record<string, string | undefined>>): string | undefined {
	if (env[ENV_ROUTE] !== ROUTE_FORK_VALUE) return undefined;
	return [
		`${ENV_ROUTE}=${ROUTE_FORK_VALUE} selects the Pi fork, and this build has none: the only launch path is the verified official Pi host.`,
		`Unset ${ENV_ROUTE} to start it.`,
		MANAGED_PI_ROLLBACK_HINT,
	].join("\n");
}

/**
 * How a source run gets a managed set.
 *
 * A run from source has no release tag of its own, so there is nothing to fetch: the two ways of
 * naming a source (an installed release, or a manifest URL) are shown instead.
 */
function sourceInstallGuidance(): string {
	return [
		"The managed Pi set is not installed, and a run from source has no release to fetch it from.",
		`Run \`${MANAGED_PI_INSTALL_COMMAND}\`, or point ${ENV_MANAGED_PI_MANIFEST_URL} at a manifest URL and start again.`,
	].join("\n");
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
	/**
	 * True for the compiled launcher. Only a compiled binary knows the release its set comes from, so
	 * a missing set is fetched for it and refused for a source run.
	 */
	compiled: boolean;
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

/** Verify the current set, or fetch it from the launcher's own release. */
async function requireCurrentSet(
	options: DefaultManagedStartupOptions,
	setId: string | undefined,
): Promise<void> {
	const io = options.io ?? DEFAULT_IO;
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
	const forkRefusal = forkRouteRefusal(options.env);
	if (forkRefusal !== undefined) {
		io.err(forkRefusal);
		return { exitCode: 1, launched: false, agentDir };
	}
	try {
		const setId = await readCurrentSet(options.root);
		if (setId === undefined && !options.compiled) {
			io.err(sourceInstallGuidance());
			return { exitCode: 1, launched: false, agentDir };
		}
		await requireCurrentSet(options, setId);
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
