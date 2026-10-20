import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasThemeAssets, themeAssetPath, themeDirFor } from "../src/update/theme.ts";

const workDirs: string[] = [];

afterAll(async () => {
	for (const dir of workDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function makeThemeDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-theme-"));
	workDirs.push(dir);
	return dir;
}

test("reports missing assets when a theme file is absent", async () => {
	const themeDir = await makeThemeDir();
	await writeFile(themeAssetPath(themeDir, "dark.json"), "{}");
	expect(await hasThemeAssets(themeDir)).toBe(false);
});

test("reports present assets when both theme files exist", async () => {
	const themeDir = await makeThemeDir();
	await writeFile(themeAssetPath(themeDir, "dark.json"), "{}");
	await writeFile(themeAssetPath(themeDir, "light.json"), "{}");
	expect(await hasThemeAssets(themeDir)).toBe(true);
});

test("treats a directory named dark.json as missing", async () => {
	const themeDir = await makeThemeDir();
	await mkdir(themeAssetPath(themeDir, "dark.json"));
	await writeFile(themeAssetPath(themeDir, "light.json"), "{}");
	expect(await hasThemeAssets(themeDir)).toBe(false);
});

test("resolves the theme directory next to the executable", () => {
	expect(themeDirFor("/home/user/.spirits/bin/spirits")).toBe("/home/user/.spirits/bin/theme");
	expect(themeAssetPath("/home/user/.spirits/bin/theme", "dark.json")).toBe(
		"/home/user/.spirits/bin/theme/dark.json",
	);
});
