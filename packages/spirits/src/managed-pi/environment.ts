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
import {
	ENV_MANAGED_AGENT_DIR,
	ENV_MANAGED_SESSION_DIR,
	ENV_OLD_AGENT_DIR,
	ENV_OLD_APP_NAME,
	ENV_OLD_CONFIG_DIR,
	ENV_OLD_SESSION_DIR,
	ENV_PACKAGE_DIR,
	ENV_SKIP_VERSION_CHECK,
	ENV_TELEMETRY,
	MANAGED_PI_SESSION_DIR_NAME,
} from "../constants.ts";

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
	/** Resolved isolated agent dir; the caller has already run the path guards. */
	agentDir: string;
}

/** Session directory pinned inside an isolated agent dir. */
export function managedSessionDir(agentDir: string): string {
	return join(agentDir, MANAGED_PI_SESSION_DIR_NAME);
}

/**
 * Compute the child environment without mutating the caller's object.
 *
 * `SPIRITS_CODING_AGENT_DIR` and `SPIRITS_CODING_AGENT_SESSION_DIR` are set to the resolved
 * isolated paths, so an inherited value or a project `settings.sessionDir` cannot redirect storage.
 * `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_APP_NAME` and `PI_CONFIG_DIR` are
 * removed by setting them to `undefined` (the caller deletes them). `PI_SKIP_VERSION_CHECK` is
 * always pinned; `PI_TELEMETRY` is defaulted only when the caller did not set it, matching the
 * compiled route.
 */
export function computeManagedEnv(options: ManagedEnvOptions): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = { ...options.env };
	result[ENV_MANAGED_AGENT_DIR] = options.agentDir;
	result[ENV_MANAGED_SESSION_DIR] = managedSessionDir(options.agentDir);
	result[ENV_PACKAGE_DIR] = options.packageDir;
	result[ENV_OLD_AGENT_DIR] = undefined;
	result[ENV_OLD_SESSION_DIR] = undefined;
	result[ENV_OLD_APP_NAME] = undefined;
	result[ENV_OLD_CONFIG_DIR] = undefined;
	result[ENV_SKIP_VERSION_CHECK] = SKIP_VERSION_CHECK_VALUE;
	if (options.env[ENV_TELEMETRY] === undefined) {
		result[ENV_TELEMETRY] = TELEMETRY_DISABLED_VALUE;
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
