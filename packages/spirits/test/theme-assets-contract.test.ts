/**
 * The theme asset names live in `packages/spirits/src/constants.ts` (`THEME_ASSET_NAMES`), but the
 * POSIX shell installer, the self-update smoke script, its test fixture and the release workflow
 * cannot import TypeScript and therefore repeat the names. This test fails when those copies drift
 * apart, which would otherwise only surface as a broken `/settings` in a published release.
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

test("install.sh lists the theme assets from constants.ts", () => {
	const source = read("scripts/install.sh");
	const match = /^THEME_ASSETS="(.+)"$/m.exec(source);
	expect(match).not.toBeNull();
	expect(match![1].split(/\s+/).sort()).toEqual([...THEME_ASSET_NAMES].sort());
});

test("self-update-smoke.sh loops over the theme assets from constants.ts", () => {
	const source = read("scripts/self-update-smoke.sh");
	const lists = [...source.matchAll(/^for name in (.+); do$/gm)].map((match) => match[1].split(/\s+/).sort());
	expect(lists.length).toBeGreaterThan(0);
	for (const list of lists) {
		expect(list).toEqual([...THEME_ASSET_NAMES].sort());
	}
});

test("install.test.sh fixtures the theme assets from constants.ts", () => {
	const source = read("scripts/install.test.sh");
	const placed = captures(source, /theme\/([A-Za-z0-9._-]+\.json)/g);
	const fixtures = captures(source, /sha256sum ([A-Za-z0-9._-]+\.json) >/g);
	const expected = [...THEME_ASSET_NAMES].sort();
	expect(placed).toEqual(expected);
	expect(fixtures).toEqual(expected);
});

test("spirits-release.yml attaches the theme assets from constants.ts", () => {
	const source = read(".github/workflows/spirits-release.yml");
	const attached = captures(source, /dist\/theme\/([A-Za-z0-9._-]+\.json)(?:\s|$)/gm);
	expect(attached).toEqual([...THEME_ASSET_NAMES].sort());
	for (const name of THEME_ASSET_NAMES) {
		expect(source).toContain(`dist/theme/${name}.sha256`);
	}
});
