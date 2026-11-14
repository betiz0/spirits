/**
 * The theme asset names live in `packages/spirits/src/constants.ts` (`THEME_ASSET_NAMES`). The
 * release workflow and the self-update smoke cannot import TypeScript and therefore repeat the names:
 * the workflow verifies and attaches the compatibility assets, the smoke serves them so an old
 * updater can fetch them. This test fails when those copies drift apart, which would otherwise only
 * surface as a broken `/settings` in a published release.
 *
 * The launcher and the installer place no theme assets, so `install.sh` must not mention them at all.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./architecture/repo.ts";
import { THEME_ASSET_NAMES } from "../src/constants.ts";

const ROOT = findRepoRoot(import.meta.dir)!;

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

/** Unique capture-group matches, sorted for stable comparisons. */
function captures(source: string, pattern: RegExp): string[] {
	return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

test("install.sh neither fetches nor places theme assets", () => {
	expect(read("scripts/install.sh")).not.toMatch(/theme|dark\.json|light\.json|SPIRITS_ROUTE/);
});

test("self-update-smoke.sh serves the compatibility assets from constants.ts", () => {
	const match = /^COMPAT_ASSETS="(.+)"$/m.exec(read("scripts/self-update-smoke.sh"));
	expect(match).not.toBeNull();
	expect(match![1].split(/\s+/).sort()).toEqual([...THEME_ASSET_NAMES].sort());
});

test("spirits-release.yml attaches the theme assets from constants.ts", () => {
	const source = read(".github/workflows/spirits-release.yml");
	const attached = captures(source, /dist\/theme\/([A-Za-z0-9._-]+\.json)(?:\s|$)/gm);
	expect(attached).toEqual([...THEME_ASSET_NAMES].sort());
	for (const name of THEME_ASSET_NAMES) {
		expect(source).toContain(`dist/theme/${name}.sha256`);
	}
});
