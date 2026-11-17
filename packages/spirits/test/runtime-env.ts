/**
 * The environment names the suite owns.
 *
 * `test/preload.ts` drops every `PI_*` and `SPIRITS_*` variable the caller carried, because an inherited
 * identity, storage location, or session decides test results (Spirits CI #16). This module declares the
 * prefixes, the inherited name the suite reads on purpose, and the names that must end up with no value
 * at all, so the preload and `test/run-environment.test.ts` work from one list instead of two copies.
 */

import { OFFICIAL_PI_HOST } from "../src/managed-pi/host.ts";

/** Root the compatibility observations take an installed official set from. */
export const ENV_COMPAT_ARTIFACT_ROOT = "SPIRITS_COMPAT_ARTIFACT_ROOT";

/**
 * Name prefixes of a spirits or pi run, as opposed to this test process: the launcher's identity, storage
 * and package names, the names an older install left behind, and the facts a running host injects into
 * what it starts. Prefix matching keeps a new variable of either product from silently deciding a result.
 */
export const RUNTIME_ENV_PREFIXES: readonly string[] = ["PI_", "SPIRITS_"];

/**
 * Inherited names the suite reads on purpose. {@link ENV_COMPAT_ARTIFACT_ROOT} is where the compatibility
 * observations find an installed official set: it names an input to a measurement, not the identity or
 * storage of this run, and CI has no value for it.
 */
export const INHERITED_ENV_EXCEPTIONS: readonly string[] = [ENV_COMPAT_ARTIFACT_ROOT];

/**
 * Names a running host injects into the processes it starts: a nested `bun test` inherits them from the
 * session it was started in, and each one describes someone else's session.
 */
export const HOST_SESSION_ENV_NAMES: readonly string[] = ["PI_CODING_AGENT", "PI_SESSION_FILE", "PI_SESSION_ID"];

/**
 * Runtime names that must hold no value in a test process: the storage and app-name names the host
 * descriptor removes, the session directory the launcher alone decides, and the host's session facts.
 */
export const INERT_ENV_NAMES: readonly string[] = [
	...OFFICIAL_PI_HOST.env.removed,
	OFFICIAL_PI_HOST.env.sessionDir,
	...HOST_SESSION_ENV_NAMES,
];

/** True when `name` carries a spirits or pi value that must not reach a test from the caller. */
export function isCallerEnvName(name: string): boolean {
	if (INHERITED_ENV_EXCEPTIONS.includes(name)) return false;
	return RUNTIME_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}
