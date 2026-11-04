import { afterAll, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installManagedSet } from "../src/managed-pi/install.ts";
import {
	managedCurrentPath,
	managedExtensionPath,
	managedPiDir,
	managedReleasesDir,
	managedSetDir,
	readCurrentSet,
} from "../src/managed-pi/layout.ts";
import { cleanupManagedFixture, directoryExists, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

async function fixture(options: { setId?: string; extensionBody?: string } = {}): Promise<ManagedFixture> {
	const value = await makeManagedFixture(options);
	fixtures.push(value);
	return value;
}

test("install does not create the managed agent directory", async () => {
	const value = await fixture();
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	expect(await directoryExists(join(value.root, "agent"))).toBe(false);
	expect(await directoryExists(join(value.work, ".spirits", "agent"))).toBe(false);
});

test("install places a verified set", async () => {
	const value = await fixture();
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	expect(await readCurrentSet(value.root)).toBe(value.manifest.setId);
	expect(await readFile(managedExtensionPath(value.root, value.manifest.setId), "utf8")).toBe(
		"export default function () {}\n",
	);
	expect(JSON.parse(await readFile(join(managedPiDir(value.root, value.manifest.setId), "package.json"), "utf8")).piConfig.name).toBe(
		"spirits",
	);
	expect(await stat(managedCurrentPath(value.root))).toBeDefined();
});

test("install checksum failure leaves no new set", async () => {
	const value = await fixture();
	const manifest = {
		...value.manifest,
		extension: { ...value.manifest.extension, artifact: { ...value.manifest.extension.artifact, sha256: "0".repeat(64) } },
	};
	await expect(installManagedSet({ root: value.root, manifest, fetch, timeoutMs: 2000 })).rejects.toThrow(
		"Checksum mismatch",
	);
	expect(await readCurrentSet(value.root)).toBeUndefined();
	await expect(stat(managedSetDir(value.root, manifest.setId))).rejects.toThrow();
});

test("install does not touch the default install or agent dirs", async () => {
	const value = await fixture();
	const home = join(value.work, "home");
	const defaultBinary = join(home, ".spirits", "bin", "spirits");
	const agentFile = join(home, ".spirits", "agent", "settings.json");
	await mkdir(join(home, ".spirits", "bin"), { recursive: true });
	await mkdir(join(home, ".spirits", "agent"), { recursive: true });
	await writeFile(defaultBinary, "default binary");
	await writeFile(agentFile, "{}");
	const root = join(home, ".spirits", "managed-pi");
	await installManagedSet({ root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	expect(await readFile(defaultBinary, "utf8")).toBe("default binary");
	expect(await readFile(agentFile, "utf8")).toBe("{}");
	expect(await readCurrentSet(root)).toBe(value.manifest.setId);
	expect(managedReleasesDir(root).startsWith(root)).toBe(true);
});
