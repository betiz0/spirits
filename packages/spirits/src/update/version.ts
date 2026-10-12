/**
 * Pure installed-vs-latest update decision.
 *
 * Uses `Bun.semver.order` so prerelease ordering matches semver instead of a hand-rolled
 * comparison.
 */

/** What the self-update should do with the installed binary. */
export type UpdateDecision = "replace" | "up-to-date" | "newer";

/**
 * Decide whether to replace the installed binary.
 *
 * `force` always replaces. Otherwise the installed binary is replaced only when it is older
 * than the latest stable release; equal and newer (prerelease) versions are no-ops.
 */
export function decideUpdate(installedVersion: string, latestVersion: string, force: boolean): UpdateDecision {
	if (force) {
		return "replace";
	}
	const order = Bun.semver.order(installedVersion, latestVersion);
	if (order < 0) {
		return "replace";
	}
	if (order === 0) {
		return "up-to-date";
	}
	return "newer";
}
