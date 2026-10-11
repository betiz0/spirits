/**
 * Compatibility re-export of the version module for the compiled entry.
 *
 * The implementation lives in `src/version.ts` so the branding header shares the same value.
 */

export { VERSION_FLAGS, formatVersionLine, isCompiledRun, resolveSpiritsVersion } from "../src/version.ts";
