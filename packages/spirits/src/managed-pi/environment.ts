/**
 * Child environment for the managed Pi process.
 *
 * Only variables that would change identity or the data directory are touched. API keys, proxy
 * settings, provider configuration, and every other inherited variable stay as they are.
 */

import { join } from "node:path";
import {
	ENV_AGENT_DIR,
	ENV_MANAGED_AGENT_DIR,
	ENV_OLD_AGENT_DIR,
	ENV_PACKAGE_DIR,
	ENV_SKIP_VERSION_CHECK,
	ENV_TELEMETRY,
	SPIRITS_AGENT_DIR_NAME,
	SPIRITS_CONFIG_DIR_NAME,
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
	home: string;
	/** Directory containing the managed overlay package.json. */
	packageDir: string;
}

/**
 * Compute the child environment without mutating the caller's object.
 *
 * An explicit `SPIRITS_CODING_AGENT_DIR` wins; otherwise the existing spirits agent directory is
 * used. `PI_CODING_AGENT_DIR` is removed by setting it to `undefined` (the caller deletes it).
 */
export function computeManagedEnv(options: ManagedEnvOptions): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = { ...options.env };
	result[ENV_PACKAGE_DIR] = options.packageDir;
	result[ENV_OLD_AGENT_DIR] = undefined;
	result[ENV_MANAGED_AGENT_DIR] = options.env[ENV_MANAGED_AGENT_DIR]
		? options.env[ENV_MANAGED_AGENT_DIR]
		: options.env[ENV_AGENT_DIR]
			? options.env[ENV_AGENT_DIR]
			: join(options.home, SPIRITS_CONFIG_DIR_NAME, SPIRITS_AGENT_DIR_NAME);
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
