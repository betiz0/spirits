/**
 * Child environment for the managed Pi process.
 *
 * The agent dir and the session dir come in already resolved and validated by the caller, so this
 * module never reads a caller agent-dir variable as a storage choice. Session storage is pinned, the
 * old variable names are removed, and everything else — API keys, proxy settings, provider
 * configuration — is carried along unchanged.
 *
 * Identity is not part of this environment. The official Pi derives the app name and the agent-dir
 * variable name from `piConfig.name` in the package.json next to the executable (official
 * `config.ts`: `APP_NAME = piConfigName || "pi"`), and it reads no app-name or config-dir
 * environment variable at all, so the overlay `package.json` is the single place that sets the
 * identity. The variables a fork-route install may have left behind are dropped rather than pinned,
 * so the child environment describes only knobs this route has.
 */

import { join } from "node:path";
import { MANAGED_PI_SESSION_DIR_NAME } from "../constants.ts";
import { OFFICIAL_PI_HOST, type HostDescriptor } from "./host.ts";

/** Value that disables pi's version check, matching the compiled route. */
const SKIP_VERSION_CHECK_VALUE = "1";

/** Value that disables install telemetry unless the operator opted in. */
const TELEMETRY_DISABLED_VALUE = "0";

/** Environment shape used by the managed route. */
export type ManagedEnv = Readonly<Record<string, string | undefined>>;

/** Inputs for the child environment. */
export interface ManagedEnvOptions {
	env: ManagedEnv;
	/** Directory containing the managed overlay package.json. */
	packageDir: string;
	/** Agent directory the child stores under: the isolated dir, or the default route's agent dir. */
	agentDir: string;
	/**
	 * Session directory to pin. The isolated route passes its fixed dir so an inherited value or a
	 * project `settings.sessionDir` cannot move storage outside the experiment.
	 *
	 * The default route omits it. Pi reads `SPIRITS_CODING_AGENT_SESSION_DIR` as the session
	 * directory itself, not as a parent of the per-project directory it derives from the working
	 * directory, so pinning the default route would put new sessions in `<agent dir>/sessions/`
	 * instead of the `<agent dir>/sessions/<encoded cwd>/` layout the fork route already wrote.
	 * Omitting it passes an inherited value through, which is what the fork route does.
	 */
	sessionDir?: string;
	/** Host the child process runs. Defaults to the official Pi. */
	host?: HostDescriptor;
}

/** Session directory pinned inside an isolated agent dir. */
export function managedSessionDir(agentDir: string): string {
	return join(agentDir, MANAGED_PI_SESSION_DIR_NAME);
}

/**
 * Compute the child environment without mutating the caller's object.
 *
 * The names come from the host descriptor. The agent dir is set to the caller's resolved value, and
 * the session dir is pinned only when the caller passed one. The names the descriptor lists as
 * `removed` are dropped by setting them to `undefined` (the caller deletes them). The version-check
 * name is always pinned, and the telemetry name is defaulted only when the caller did not set it,
 * matching the compiled route.
 */
export function computeManagedEnv(options: ManagedEnvOptions): Record<string, string | undefined> {
	const host = options.host ?? OFFICIAL_PI_HOST;
	const result: Record<string, string | undefined> = { ...options.env };
	result[host.env.agentDir] = options.agentDir;
	if (options.sessionDir !== undefined) {
		result[host.env.sessionDir] = options.sessionDir;
	}
	result[host.env.packageDir] = options.packageDir;
	for (const name of host.env.removed) {
		result[name] = undefined;
	}
	result[host.env.skipVersionCheck] = SKIP_VERSION_CHECK_VALUE;
	if (options.env[host.env.telemetry] === undefined) {
		result[host.env.telemetry] = TELEMETRY_DISABLED_VALUE;
	}
	return result;
}

/** Apply a computed environment to a mutable object, deleting keys set to undefined. */
export function applyChildEnv(target: Record<string, string | undefined>, computed: Record<string, string | undefined>): void {
	for (const [name, value] of Object.entries(computed)) {
		if (value === undefined) {
			delete target[name];
		} else {
			target[name] = value;
		}
	}
}
