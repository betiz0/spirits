import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	managedCurrentPath,
	managedReleasesDir,
	managedSetDir,
	managedTempDir,
	prepareManagedRoot,
	readCurrentSet,
	switchCurrent,
} from "../src/managed-pi/layout.ts";

const dirs: string[] = [];

afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function root(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-layout-"));
	dirs.push(dir);
	return dir;
}

test("current switches atomically", async () => {
	const dir = await root();
	await prepareManagedRoot(dir);
	await mkdir(managedSetDir(dir, "set-a"), { recursive: true });
	await mkdir(managedSetDir(dir, "set-b"), { recursive: true });
	await switchCurrent(dir, "set-a");
	expect(await readCurrentSet(dir)).toBe("set-a");
	await switchCurrent(dir, "set-b");
	expect(await readCurrentSet(dir)).toBe("set-b");
	expect(await stat(managedCurrentPath(dir))).toBeDefined();
});

test("failed switch keeps the previous set", async () => {
	const dir = await root();
	await prepareManagedRoot(dir);
	await mkdir(managedSetDir(dir, "set-a"), { recursive: true });
	await switchCurrent(dir, "set-a");
	await expect(switchCurrent(dir, "missing-set")).rejects.toThrow();
	expect(await readCurrentSet(dir)).toBe("set-a");
});

test("temporary directory stays inside the managed root", async () => {
	const dir = await root();
	await prepareManagedRoot(dir);
	await mkdir(managedTempDir(dir), { recursive: true });
	const entries = await readdir(dir);
	expect(entries.some((entry) => entry.startsWith(".spirits-tmp-"))).toBe(true);
	expect(managedReleasesDir(dir).startsWith(dir)).toBe(true);
});
