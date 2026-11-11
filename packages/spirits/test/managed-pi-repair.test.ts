import { afterAll, expect, test } from "bun:test";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MANAGED_PI_EXTENSION_ASSET_NAME } from "../src/constants.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { managedExtensionPath, readCurrentSet } from "../src/managed-pi/layout.ts";
import { repairManagedSet } from "../src/managed-pi/repair.ts";
import { installManagedSetFromRelease } from "../src/managed-pi/release-assets.ts";
import { cleanupManagedFixture, directoryExists, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";
import { makeReleaseFixture, stopManagedReleaseFixtures } from "./managed-pi-release-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
	await stopManagedReleaseFixtures();
});

test("repair does not create the managed agent directory", async () => {
	const value = await makeManagedFixture();
	fixtures.push(value);
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	await rm(managedExtensionPath(value.root, value.manifest.setId));
	const result = await repairManagedSet({ root: value.root, setId: value.manifest.setId, fetch, timeoutMs: 2000 });
	expect(result.exitCode).toBe(0);
	expect(await directoryExists(join(value.root, "agent"))).toBe(false);
	expect(await directoryExists(join(value.work, ".spirits", "agent"))).toBe(false);
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

test("repair restores a set whose release manifest named assets relatively", async () => {
	// The shape a real release ships (scripts/build-managed-pi-inputs.ts writes the extension URL
	// as the bare asset name). Repair only has the stored manifest, so the stored URLs must have
	// been resolved against the release the set came from at install time.
	const release = await makeReleaseFixture({ relativeExtensionUrl: true });
	const result = await installManagedSetFromRelease({
		root: release.root,
		tag: "spirits-v0.1.0",
		env: { SPIRITS_RELEASE_BASE_URL: release.baseUrl },
		fetch,
		timeoutMs: 5000,
		io: { out: () => {}, err: () => {} },
	});
	expect(result.exitCode).toBe(0);

	// The stored manifest keeps absolute URLs, so repair needs no release base URL of its own.
	const stored = JSON.parse(
		await readFile(join(release.root, "releases", release.manifest.setId, "manifest.json"), "utf8"),
	);
	expect(stored.extension.artifact.url).toBe(
		`${release.baseUrl}/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_EXTENSION_ASSET_NAME}`,
	);
	expect(stored.pi.artifact.url).toBe(`${release.baseUrl}/pi.tar.gz`);

	// Tamper with the whole set the release shipped, then repair it back.
	await rm(managedExtensionPath(release.root, release.manifest.setId));
	await writeFile(join(release.root, "current", "pi", "pi"), "tampered\n");
	const repaired = await repairManagedSet({
		root: release.root,
		setId: release.manifest.setId,
		fetch,
		timeoutMs: 5000,
		io: { out: () => {}, err: () => {} },
	});
	expect(repaired.exitCode).toBe(0);
	expect(await readFile(managedExtensionPath(release.root, release.manifest.setId), "utf8")).toContain(
		"export default",
	);
	expect(await readCurrentSet(release.root)).toBe(release.manifest.setId);
});
