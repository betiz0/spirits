/**
 * Pure Bun version gate for uncompiled (development) runs.
 *
 * The compiled binary skips the gate: the build pins the Bun version, so the runtime version
 * does not affect the shipped artifact. Keeping the decision pure lets tests cover all three
 * branches without switching the actual runtime.
 */

/** Minimum Bun version for uncompiled runs (design Decision 4). */
const MINIMUM_BUN_VERSION = "1.4.0";

/** Recommended Bun version; CI and release builds pin it (design Decision 4). */
const RECOMMENDED_BUN_VERSION = "1.4.2";

/** Exit code returned when the gate rejects the runtime (design Decision 4). */
const REJECT_EXIT_CODE = 1;

export type BunGateResult =
	| { decision: "reject"; message: string; exitCode: number }
	| { decision: "warn"; message: string }
	| { decision: "pass" };

function versionParts(version: string): [number, number, number] {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) {
		// Unparsable versions are treated as 0.0.0 so the gate fails closed.
		return [0, 0, 0];
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isOlderThan(version: string, minimum: string): boolean {
	const [major, minor, patch] = versionParts(version);
	const [minMajor, minMinor, minPatch] = versionParts(minimum);
	if (major !== minMajor) return major < minMajor;
	if (minor !== minMinor) return minor < minMinor;
	return patch < minPatch;
}

/** Decide whether an uncompiled run on `version` may proceed. */
export function checkBunVersion(version: string, compiled: boolean): BunGateResult {
	if (compiled) {
		return { decision: "pass" };
	}
	if (isOlderThan(version, MINIMUM_BUN_VERSION)) {
		return {
			decision: "reject",
			message: `spirits requires Bun ${MINIMUM_BUN_VERSION} or newer (running ${version}); upgrade Bun to continue.`,
			exitCode: REJECT_EXIT_CODE,
		};
	}
	if (isOlderThan(version, RECOMMENDED_BUN_VERSION)) {
		return {
			decision: "warn",
			message: `spirits recommends Bun ${RECOMMENDED_BUN_VERSION} or newer (running ${version}); continuing.`,
		};
	}
	return { decision: "pass" };
}
