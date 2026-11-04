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
import type { ManagedSpawn } from "../src/managed-pi/launch.ts";

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
