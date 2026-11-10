/**
 * Environment defaults shared by the compiled entry and the managed routes.
 *
 * The compiled binary has no sibling `package.json`, so pi cannot infer spirits paths from disk;
 * defaults are computed from the environment and the home directory instead. The default agent
 * directory is the single rule both the fork route and the default managed route use, so the two
 * routes cannot drift apart in where they store settings, sessions, and auth.
 */

import { join } from "node:path";
import {
	ENV_AGENT_DIR,
	ENV_SKIP_VERSION_CHECK,
	ENV_TELEMETRY,
	SPIRITS_AGENT_DIR_NAME,
	SPIRITS_CONFIG_DIR_NAME,
} from "./constants.ts";

/** Value that disables pi's version check. */
const SKIP_VERSION_CHECK_VALUE = "1";

/** Value that disables install telemetry unless the operator explicitly opts in. */
const TELEMETRY_DISABLED_VALUE = "0";

/**
 * The agent directory the default route uses: the caller's value when set, otherwise
 * `~/.spirits/agent`.
 *
 * Both routes read this so an explicit `SPIRITS_CODING_AGENT_DIR` keeps the meaning it has on the
 * fork route, and the old `PI_CODING_AGENT_DIR` name is never read as a storage choice.
 */
export function resolveAgentDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
	const explicit = env[ENV_AGENT_DIR];
	return explicit ? explicit : join(home, SPIRITS_CONFIG_DIR_NAME, SPIRITS_AGENT_DIR_NAME);
}

/**
 * Compute the environment variables to set, without mutating `env`.
 *
 * `SPIRITS_CODING_AGENT_DIR` and `PI_TELEMETRY` are set only when the caller has not set them;
 * `PI_SKIP_VERSION_CHECK` is always set so pi's update notification stays off (design Decision 2,
 * 3, and 7).
 */
export function computeEnvDefaults(
	env: Readonly<Record<string, string | undefined>>,
	home: string,
): Readonly<Record<string, string>> {
	const defaults: Record<string, string> = {
		[ENV_SKIP_VERSION_CHECK]: SKIP_VERSION_CHECK_VALUE,
	};
	if (!env[ENV_AGENT_DIR]) {
		defaults[ENV_AGENT_DIR] = resolveAgentDir(env, home);
	}
	if (env[ENV_TELEMETRY] === undefined) {
		defaults[ENV_TELEMETRY] = TELEMETRY_DISABLED_VALUE;
	}
	return defaults;
}


