/**
 * Compatibility re-export of the environment defaults for the compiled entry.
 *
 * The implementation lives in `src/env-defaults.ts` so the compiled entry and the managed route
 * resolve the agent directory from one rule, instead of repeating it.
 */

export { computeEnvDefaults, resolveAgentDir } from "../src/env-defaults.ts";
