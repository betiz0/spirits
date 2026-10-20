import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyVerifiedBinary, applyVerifiedThemeAssets } from "../src/update/apply.ts";

const workDirs: string[] = [];

afterAll(async () => {
	for (const dir of workDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function makeWorkDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-apply-"));
	workDirs.push(dir);
	return dir;
}

async function isExecutable(path: string): Promise<boolean> {
	const mode = (await stat(path)).mode;
	return (mode & 0o111) !== 0;
}

test("renames the verified file and sets the exec bit", async () => {
	const work = await makeWorkDir();
	const tempDir = join(work, ".spirits-tmp-1");
	const downloadedPath = join(tempDir, "spirits-linux-x64");
	const targetPath = join(work, "spirits");
	await mkdir(tempDir);
	await writeFile(downloadedPath, "new binary");

	await applyVerifiedBinary({ tempDir, downloadedPath, targetPath });

	expect(await readFile(targetPath, "utf8")).toBe("new binary");
	expect(await isExecutable(targetPath)).toBe(true);
	await expect(stat(tempDir)).rejects.toThrow();
});

test("keeps the original file and exec bit when rename fails", async () => {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	const tempRoot = join(work, "upload");
	const tempDir = join(tempRoot, ".spirits-tmp-2");
	const downloadedPath = join(tempDir, "spirits-linux-x64");
	const targetPath = join(installDir, "spirits");
	await mkdir(tempDir, { recursive: true });
	await mkdir(installDir);
	await writeFile(downloadedPath, "new binary");
	await writeFile(targetPath, "original binary");
	await chmod(targetPath, 0o755);
	await chmod(installDir, 0o555);

	try {
		await expect(applyVerifiedBinary({ tempDir, downloadedPath, targetPath })).rejects.toThrow();
		expect(await readFile(targetPath, "utf8")).toBe("original binary");
		expect(await isExecutable(targetPath)).toBe(true);
		await expect(stat(tempDir)).rejects.toThrow();
	} finally {
		await chmod(installDir, 0o755);
	}
});

test("leaves a complete verified file when two applies run concurrently", async () => {	const work = await makeWorkDir();
	const targetPath = join(work, "spirits");
	const tempA = join(work, ".spirits-tmp-a");
	const tempB = join(work, ".spirits-tmp-b");
	await mkdir(tempA);
	await mkdir(tempB);
	const downloadedA = join(tempA, "spirits-linux-x64");
	const downloadedB = join(tempB, "spirits-linux-x64");
	await writeFile(downloadedA, "first binary");
	await writeFile(downloadedB, "second binary");

	await Promise.all([
		applyVerifiedBinary({ tempDir: tempA, downloadedPath: downloadedA, targetPath }),
		applyVerifiedBinary({ tempDir: tempB, downloadedPath: downloadedB, targetPath }),
	]);

	const content = await readFile(targetPath, "utf8");
	expect(["first binary", "second binary"]).toContain(content);
	expect(await isExecutable(targetPath)).toBe(true);
	await expect(stat(tempA)).rejects.toThrow();
	await expect(stat(tempB)).rejects.toThrow();
});

test("places theme files and sets the file mode", async () => {
	const work = await makeWorkDir();
	const tempDir = join(work, ".spirits-tmp-3");
	const themeDir = join(work, "theme");
	await mkdir(tempDir);
	const darkSource = join(tempDir, "dark.json");
	const lightSource = join(tempDir, "light.json");
	await writeFile(darkSource, '{"name":"dark"}');
	await writeFile(lightSource, '{"name":"light"}');

	await applyVerifiedThemeAssets({
		themeDir,
		assets: [
			{ downloadedPath: darkSource, assetName: "dark.json" },
			{ downloadedPath: lightSource, assetName: "light.json" },
		],
	});

	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe('{"name":"dark"}');
	expect(await readFile(join(themeDir, "light.json"), "utf8")).toBe('{"name":"light"}');
	expect((await stat(join(themeDir, "dark.json"))).mode & 0o777).toBe(0o644);
	expect((await stat(join(themeDir, "light.json"))).mode & 0o777).toBe(0o644);
});
