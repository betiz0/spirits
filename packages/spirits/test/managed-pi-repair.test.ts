import { afterAll, expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { managedExtensionPath, readCurrentSet } from "../src/managed-pi/layout.ts";
import { repairManagedSet } from "../src/managed-pi/repair.ts";
import { cleanupManagedFixture, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

test("repair restores a missing extension bundle", async () => {
	const value = await makeManagedFixture();
	fixtures.push(value);
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	await rm(managedExtensionPath(value.root, value.manifest.setId));
	await expect(stat(managedExtensionPath(value.root, value.manifest.setId))).rejects.toThrow();
	const result = await repairManagedSet({ root: value.root, setId: value.manifest.setId, fetch, timeoutMs: 2000 });
	expect(result.exitCode).toBe(0);
	expect(await readFile(managedExtensionPath(value.root, value.manifest.setId), "utf8")).toContain("export default");
	expect(await readCurrentSet(value.root)).toBe(value.manifest.setId);
});

test("repair keeps the pi version", async () => {
	const value = await makeManagedFixture();
	fixtures.push(value);
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	await repairManagedSet({ root: value.root, setId: value.manifest.setId, fetch, timeoutMs: 2000 });
	const manifest = JSON.parse(
		await readFile(join(value.root, "releases", value.manifest.setId, "manifest.json"), "utf8"),
	);
	expect(manifest.pi.version).toBe("1.5.0");
});
