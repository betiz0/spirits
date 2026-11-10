/**
 * Compatibility re-export of the environment defaults for the compiled entry.
 *
 * The implementation lives in `src/env-defaults.ts` so the default managed route resolves the same
 * agent directory the fork route would, instead of repeating the rule.
 */

export { computeEnvDefaults, resolveAgentDir } from "../src/env-defaults.ts";
