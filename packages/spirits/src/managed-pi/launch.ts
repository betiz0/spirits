/**
 * Launch the managed Pi by absolute path.
 *
 * There is no PATH lookup, no `Bun.which`, and no fallback to the default spirits binary. The
 * managed set is verified before spawn, stdio is inherited, and the child exit code is returned.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	assertManagedLaunchArgs,
	ensureManagedAgentDir,
	ManagedAgentGuardError,
	resolveManagedAgentPaths,
} from "./agent-dir.ts";
import { applyChildEnv, computeManagedEnv, type ManagedEnv } from "./environment.ts";
import { managedRoot, readCurrentSet } from "./layout.ts";
import {
	assertSupportedManagedPlatform,
	managedSetFailureMessage,
	ManagedSetError,
	verifyManagedSet,
} from "./verify.ts";

/** Spawn request handed to the test seam. */
export interface ManagedSpawnRequest {
	command: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	stdin: "inherit";
	stdout: "inherit";
	stderr: "inherit";
}

/** Spawn seam; returns the child exit code. */
export type ManagedSpawn = (request: ManagedSpawnRequest) => Promise<number>;

/** Options for launching the managed route. */
export interface LaunchManagedPiOptions {
	root?: string;
	setId?: string;
	args: readonly string[];
	env?: ManagedEnv;
	home?: string;
	cwd?: string;
	spawn?: ManagedSpawn;
	io?: { out(line: string): void; err(line: string): void };
	/** Runtime platform and arch, injectable for tests. */
	platform?: NodeJS.Platform;
	arch?: string;
}

/** Result of a launch attempt. */
export interface LaunchManagedPiResult {
	exitCode: number;
	launched: boolean;
}

/** Default spawn: absolute command, inherited stdio. */
export function spawnManagedProcess(request: ManagedSpawnRequest): Promise<number> {
	const child = Bun.spawn(request.command, {
		cwd: request.cwd,
		env: request.env,
		stdin: request.stdin,
		stdout: request.stdout,
		stderr: request.stderr,
	});
	return child.exited;
}

const DEFAULT_IO = {
	out: (line: string) => console.log(line),
	err: (line: string) => console.error(line),
};

/** Resolve the current set id or fail with an install hint. */
async function resolveLaunchSetId(root: string, explicitSetId?: string): Promise<string> {
	const setId = explicitSetId ?? (await readCurrentSet(root));
	if (!setId) {
		throw new ManagedSetError("The managed Pi set is not installed.");
	}
	return setId;
}

/**
 * Launch the managed Pi. A failure prints the reason and returns non-zero without fallback.
 *
 * The isolated agent dir is resolved, guarded, and created after the set and platform checks and
 * before the environment is computed, so a path or explicit-directory rejection never spawns Pi and
 * never creates the directory.
 */
export async function launchManagedPi(options: LaunchManagedPiOptions): Promise<LaunchManagedPiResult> {
	const io = options.io ?? DEFAULT_IO;
	const home = options.home ?? homedir();
	const root = options.root ?? managedRoot(home);
	const env = options.env ?? process.env;
	try {
		const setId = await resolveLaunchSetId(root, options.setId);
		const verified = await verifyManagedSet(root, setId);
		assertSupportedManagedPlatform(
			verified.manifest.platform,
			options.platform ?? process.platform,
			options.arch ?? process.arch,
		);
		const paths = await resolveManagedAgentPaths({ home, root, env });
		assertManagedLaunchArgs(options.args, paths);
		await ensureManagedAgentDir(paths);
		// Spawn through the `current` link so the launched path is exactly the selected set, and a
		// concurrent update cannot leave the wrapper using a path that is no longer current.
		const currentDir = join(root, "current");
		const packageDir = join(currentDir, "pi");
		const childEnv: Record<string, string | undefined> = {};
		applyChildEnv(childEnv, computeManagedEnv({ env, packageDir, agentDir: paths.agentDir }));
		const command = [join(packageDir, "pi"), "-e", join(currentDir, "spirits-extension.js"), ...options.args];
		const spawn = options.spawn ?? spawnManagedProcess;
		const exitCode = await spawn({
			command,
			cwd: options.cwd ?? process.cwd(),
			env: childEnv,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		return { exitCode, launched: true };
	} catch (error) {
		if (error instanceof ManagedAgentGuardError) {
			io.err(error.message);
			return { exitCode: 1, launched: false };
		}
		const reason = error instanceof Error ? error.message : String(error);
		io.err(managedSetFailureMessage(reason));
		return { exitCode: 1, launched: false };
	}
}

/** User-facing help for the explicit experimental route. */
export const MANAGED_PI_HELP = [
	"spirits managed-pi - experimental route using a pinned official Pi artifact",
	"",
	"Usage:",
	"  spirits managed-pi install [--version <pi-version>]",
	"  spirits managed-pi update",
	"  spirits managed-pi repair",
	"  spirits managed-pi -- [pi args...]",
	"",
	"This route is experimental and is not the default spirits launch path.",
	"It never falls back to the system pi or the compiled spirits binary.",
	"It writes only to the isolated agent directory under the managed root, never to ~/.spirits/agent.",
].join("\n");
