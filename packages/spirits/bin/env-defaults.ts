/**
 * Pure environment defaults applied by `bootstrap.ts` before pi loads.
 *
 * The compiled binary has no sibling `package.json`, so pi cannot infer spirits paths from disk;
 * defaults are computed from the environment and the home directory instead.
 */

import { join } from "node:path";
import {
	ENV_AGENT_DIR,
	ENV_SKIP_VERSION_CHECK,
	ENV_TELEMETRY,
	SPIRITS_AGENT_DIR_NAME,
	SPIRITS_CONFIG_DIR_NAME,
} from "../src/constants.ts";

/** Value that disables pi's version check. */
const SKIP_VERSION_CHECK_VALUE = "1";

/** Value that disables install telemetry unless the operator explicitly opts in. */
const TELEMETRY_DISABLED_VALUE = "0";

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
		defaults[ENV_AGENT_DIR] = join(home, SPIRITS_CONFIG_DIR_NAME, SPIRITS_AGENT_DIR_NAME);
	}
	if (env[ENV_TELEMETRY] === undefined) {
		defaults[ENV_TELEMETRY] = TELEMETRY_DISABLED_VALUE;
	}
	return defaults;
}
