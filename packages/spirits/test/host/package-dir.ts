/**
 * The installed host package, as a directory on disk.
 *
 * `test/preload.ts` stages the product identity over a mirror of this directory, and it cannot ask the
 * host where the host lives: importing the host evaluates the identity constants the host computes
 * from its environment, which is exactly what the preload has to pin first. Resolving the published
 * specifier from a file inside `packages/spirits` reaches the same directory the host reaches by
 * walking up from its own module, so the staged mirror and a `node_modules` run describe one package.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** File name the host reads its identity from. */
const PACKAGE_JSON_FILE_NAME = "package.json";

/** Raised when the installed package that owns a specifier cannot be located. */
export class HostPackageNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HostPackageNotFoundError";
	}
}

/**
 * Directory of the installed `packageName`, found from the resolved entry of its main export.
 *
 * A `package.json` whose `name` is not `packageName` is a workspace or vendor manifest on the way up
 * and is skipped, so the answer is the package that owns the entry, not the nearest manifest.
 */
export function installedHostPackageDir(packageName: string): string {
	const entry = fileURLToPath(import.meta.resolve(packageName));
	for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
		const manifestPath = join(dir, PACKAGE_JSON_FILE_NAME);
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
		if (manifest.name === packageName) return dir;
	}
	throw new HostPackageNotFoundError(`No package.json for ${packageName} above ${entry}.`);
}
