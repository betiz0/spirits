import { afterAll, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { managedSetDir, readCurrentSet } from "../src/managed-pi/layout.ts";
import { launchManagedPi } from "../src/managed-pi/launch.ts";
import { updateManagedSet } from "../src/managed-pi/update.ts";
import { cleanupManagedFixture, directoryExists, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

async function fixture(setId?: string): Promise<ManagedFixture> {
	const value = await makeManagedFixture({ setId });
	fixtures.push(value);
	return value;
}

test("update does not create the managed agent directory", async () => {
	const value = await fixture();
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	const result = await updateManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	expect(result.exitCode).toBe(0);
	expect(await directoryExists(join(value.root, "agent"))).toBe(false);
	expect(await directoryExists(join(value.work, ".spirits", "agent"))).toBe(false);
});

test("update switches after verification", async () => {
	const first = await fixture("set-a");
	await installManagedSet({ root: first.root, manifest: first.manifest, fetch, timeoutMs: 2000 });
	const second = await makeManagedFixture({ setId: "set-b" });
	fixtures.push(second);
	// Use the same managed root as the installed route.
	const root = first.root;
	second.root = root;
	const result = await updateManagedSet({ root, manifest: second.manifest, fetch, timeoutMs: 2000 });
	expect(result.exitCode).toBe(0);
	expect(await readCurrentSet(root)).toBe("set-b");
});

test("failed update keeps the previous current", async () => {
	const first = await fixture("set-a");
	await installManagedSet({ root: first.root, manifest: first.manifest, fetch, timeoutMs: 2000 });
	const second = await makeManagedFixture({ setId: "set-b" });
	fixtures.push(second);
	const broken = {
		...second.manifest,
		extension: { ...second.manifest.extension, artifact: { ...second.manifest.extension.artifact, sha256: "0".repeat(64) } },
	};
	const result = await updateManagedSet({ root: first.root, manifest: broken, fetch, timeoutMs: 2000 });
	expect(result.exitCode).toBe(1);
	expect(await readCurrentSet(first.root)).toBe("set-a");
	await expect(stat(managedSetDir(first.root, "set-b"))).rejects.toThrow();
});

test("update does not check the network on launch", async () => {
	// Launch verification is local: it reads the manifest and installed state only. A spawn seam
	// proves no fetch happens even when the process is never started.
	const first = await fixture("set-a");
	await installManagedSet({ root: first.root, manifest: first.manifest, fetch, timeoutMs: 2000 });
	let requested = 0;
	const result = await launchManagedPi({
		root: first.root,
		args: ["--version"],
		home: first.work,
		spawn: async () => {
			requested++;
			return 0;
		},
		io: { out: () => {}, err: () => {} },
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	expect(requested).toBe(1);
});
