/**
 * Repository root discovery for the architecture-conventions check.
 *
 * The checker must not depend on the process working directory: `bun test` runs from
 * `packages/spirits`, but the check may be invoked from anywhere. The root is therefore
 * found by walking up from a start directory until a `package.json` that declares
 * `workspaces` is found (design decision 4).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function declaresWorkspaces(pkgPath: string): boolean {
	try {
		if (!existsSync(pkgPath) || !statSync(pkgPath).isFile()) return false;
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			workspaces?: unknown;
		};
		const ws = pkg?.workspaces;
		return Array.isArray(ws) || (typeof ws === "object" && ws !== null && Array.isArray((ws as { packages?: unknown }).packages));
	} catch {
		return false;
	}
}

/**
 * Walk up from `startDir` to find the repository root: the nearest directory whose
 * `package.json` declares `workspaces`. Returns `undefined` when no such directory
 * exists above `startDir`.
 */
export function findRepoRoot(startDir: string): string | undefined {
	let dir = resolve(startDir);
	for (;;) {
		if (declaresWorkspaces(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}
