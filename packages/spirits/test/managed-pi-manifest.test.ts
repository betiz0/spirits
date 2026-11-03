import { expect, test } from "bun:test";
import {
	firstSupportedManifest,
	loadManagedManifest,
	ManagedManifestError,
	parseManagedManifest,
	type ManagedManifest,
} from "../src/managed-pi/manifest.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIGEST = "a".repeat(64);

function validManifest(): ManagedManifest {
	return firstSupportedManifest({ version: "0.1.0", url: "spirits-extension.js", sha256: DIGEST });
}

test("manifest accepts the first supported set", () => {
	const manifest = parseManagedManifest(validManifest());
	expect(manifest.platform).toBe("linux-x64");
	expect(manifest.pi.version).toBe("1.5.0");
	expect(manifest.pi.artifact.sha256).toBe("df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b");
	expect(manifest.extension.version).toBe("0.1.0");
	expect(manifest.overlay.sha256).toHaveLength(64);
});

test("manifest rejects a missing checksum", () => {
	const manifest = validManifest() as unknown as Record<string, unknown>;
	const pi = manifest.pi as Record<string, unknown>;
	const artifact = pi.artifact as Record<string, unknown>;
	delete artifact.sha256;
	expect(() => parseManagedManifest(manifest)).toThrow(ManagedManifestError);
	expect(() => parseManagedManifest(manifest)).toThrow("pi.artifact.sha256");
});

test("manifest rejects an unsupported platform", () => {
	const manifest = { ...validManifest(), platform: "darwin-arm64" };
	expect(() => parseManagedManifest(manifest)).toThrow("Unsupported managed Pi platform");
});

test("manifest rejects malformed JSON and unsafe set ids", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-manifest-"));
	const path = join(dir, "manifest.json");
	await writeFile(path, "not json");
	await expect(loadManagedManifest(path)).rejects.toThrow("not valid JSON");
	await expect(loadManagedManifest(join(dir, "missing.json"))).rejects.toThrow("Could not read");
	expect(() => parseManagedManifest({ ...validManifest(), setId: "../escape" })).toThrow("safe release id");
});
