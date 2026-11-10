/**
 * Managed startup hand-off.
 *
 * `bootstrap.ts` classifies the CLI before pi loads, and the managed route must see the caller's
 * environment as it was *before* the wrapper injected the normal route's defaults. The injected
 * `SPIRITS_CODING_AGENT_DIR=~/.spirits/agent` would otherwise be indistinguishable from a selection
 * the user made, and the managed isolation guard would reject every default launch.
 *
 * This helper is the single hand-off the wrapper calls, so a test runs the same function instead of
 * re-implementing the wiring. The snapshot is copied, never printed, logged, or written to an
 * artifact, and the normal route keeps using the defaulted `process.env`.
 */

import { runManagedCommand, type ManagedCommandOptions } from "../src/managed-pi/command.ts";
import {
	runDefaultManagedStartup,
	selectStartupRoute,
	type DefaultManagedStartupOptions,
	type StartupRoute,
} from "../src/managed-pi/default-route.ts";
import type { ManagedSpawn } from "../src/managed-pi/launch.ts";
import type { ManagedIo } from "../src/managed-pi/install.ts";
import { runManagedInstallFromRelease } from "../src/managed-pi/release-assets.ts";
import { releaseTagForVersion } from "../src/update/release.ts";
import type { EnvLike, FetchLike } from "../src/update/types.ts";

/** One environment value, or absent. */
export type CallerEnvValue = string | undefined;

/** Caller environment before the wrapper applied its own defaults. */
export type CallerEnv = Readonly<Record<string, CallerEnvValue>>;

/** Independent shallow copy of the caller environment. */
export function copyCallerEnv(env: CallerEnv): Record<string, CallerEnvValue> {
	return { ...env };
}

/** Inputs for one managed hand-off. */
export interface ManagedStartupOptions extends Omit<ManagedCommandOptions, "env"> {
	/** Environment copy taken before `applyEnvDefaults()`; it is copied again before use. */
	snapshot: CallerEnv;
	/** Test-only spawn seam forwarded to the launch path. */
	spawn?: ManagedSpawn;
}

/** Inputs for one default (non `managed-pi`) managed launch. */
export interface DefaultManagedOptions extends Omit<DefaultManagedStartupOptions, "env"> {
	/** Environment copy taken before `applyEnvDefaults()`; it is copied again before use. */
	snapshot: CallerEnv;
}

/** The route this run takes, decided from the caller's environment. */
export function chooseStartupRoute(snapshot: CallerEnv, compiled: boolean): StartupRoute {
	return selectStartupRoute({ env: snapshot, compiled });
}

/** Hand the pre-default environment copy to the default managed launch. */
export async function runDefaultManaged(options: DefaultManagedOptions): Promise<number> {
	const { snapshot, ...rest } = options;
	const result = await runDefaultManagedStartup({ ...rest, env: copyCallerEnv(snapshot) });
	return result.exitCode;
}

/** Inputs for the managed install that follows a successful `spirits update`. */
export interface ManagedInstallAfterUpdateOptions {
	/** Environment copy taken before `applyEnvDefaults()`, so a caller's base URL override applies. */
	snapshot: CallerEnv;
	root: string;
	fetch: FetchLike;
	/** Version embedded in the running binary, used when the update did not report a release. */
	installedVersion: string;
	/** Release the update resolved, when it reported one. */
	releaseTag?: string;
	io?: ManagedIo;
}

/**
 * Install the managed set of the release the updated binary belongs to and return the exit code.
 *
 * A replacement reports the release it installed; a run that was already current reports its own
 * release. Either way the set comes from the same release as the binary on disk, never from the
 * newest release. A failure has already printed the repair command and the fork escape hatch.
 */
export async function installManagedSetAfterUpdate(options: ManagedInstallAfterUpdateOptions): Promise<number> {
	const env: EnvLike = copyCallerEnv(options.snapshot);
	const result = await runManagedInstallFromRelease({
		root: options.root,
		tag: options.releaseTag ?? releaseTagForVersion(options.installedVersion),
		env,
		fetch: options.fetch,
		...(options.io ? { io: options.io } : {}),
	});
	return result.exitCode;
}

/** Hand the pre-default environment copy to the managed command. */
export async function runManagedStartup(options: ManagedStartupOptions): Promise<number> {
	const command: ManagedCommandOptions = {
		root: options.root,
		action: options.action,
		env: copyCallerEnv(options.snapshot),
		fetch: options.fetch,
		home: options.home,
	};
	if (options.cwd !== undefined) command.cwd = options.cwd;
	if (options.io !== undefined) command.io = options.io;
	if (options.spawn !== undefined) command.spawn = options.spawn;
	return runManagedCommand(command);
}
