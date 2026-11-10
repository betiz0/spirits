import { afterAll, expect, test } from "bun:test";
import { readlink } from "node:fs/promises";
import { join } from "node:path";
import { MANAGED_PI_MANIFEST_ASSET_NAME, SPIRITS_APP_NAME } from "../src/constants.ts";
import { managedCurrentPath, managedInstalledStatePath } from "../src/managed-pi/layout.ts";
import {
	fetchManagedManifestOfRelease,
	installManagedSetFromRelease,
	runManagedInstallFromRelease,
} from "../src/managed-pi/release-assets.ts";
import { releaseTagForVersion } from "../src/update/release.ts";
import { makeReleaseFixture, stopManagedReleaseFixtures } from "./managed-pi-release-fixtures.ts";

afterAll(stopManagedReleaseFixtures);

/** A closed port: no manifest, no assets. */
const UNREACHABLE = "http://127.0.0.1:9";

test("a version maps to the release tag the assets come from", () => {
	expect(releaseTagForVersion("0.7.0")).toBe("spirits-v0.7.0");
	// Pre-releases carry the suffix in the tag, matching the release workflow's tag pattern.
	expect(releaseTagForVersion("0.4.0-rc.1")).toBe("spirits-v0.4.0-rc.1");
});

test("the manifest of one release is fetched by its tag", async () => {
	const fixture = await makeReleaseFixture();
	const { manifest, baseUrl, url } = await fetchManagedManifestOfRelease({
		tag: "spirits-v0.1.0",
		env: { SPIRITS_RELEASE_BASE_URL: fixture.baseUrl },
		fetch,
		timeoutMs: 5000,
	});
	expect(manifest.setId).toBe(fixture.manifest.setId);
	expect(manifest.pi.version).toBe("1.5.0");
	expect(url).toBe(`${fixture.baseUrl}/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_MANIFEST_ASSET_NAME}`);
	// The assets resolve against the same release directory, not against the latest release.
	expect(baseUrl).toBe(`${url.slice(0, url.lastIndexOf("/") + 1)}`);
	expect(fixture.requests).toContain(`/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_MANIFEST_ASSET_NAME}`);
});

test("installing from a release places a verified set", async () => {
	const fixture = await makeReleaseFixture();
	const result = await installManagedSetFromRelease({
		root: fixture.root,
		tag: "spirits-v0.1.0",
		env: { SPIRITS_RELEASE_BASE_URL: fixture.baseUrl },
		fetch,
		timeoutMs: 5000,
		io: { out: () => {}, err: () => {} },
	});
	expect(result).toEqual({ ok: true, setId: fixture.manifest.setId, exitCode: 0 });
	const piDir = join(fixture.root, "current", "pi");
	expect(await Bun.file(join(piDir, "pi")).exists()).toBe(true);
	expect(await Bun.file(join(fixture.root, "current", "spirits-extension.js")).exists()).toBe(true);
	// The overlay package.json is what names the official Pi after spirits without moving its data.
	expect(JSON.parse(await readFileText(join(piDir, "package.json")))).toMatchObject({
		piConfig: { name: SPIRITS_APP_NAME, configDir: ".pi" },
	});
	// The recorded checksums are what a later default launch verifies against.
	expect(await Bun.file(managedInstalledStatePath(fixture.root, fixture.manifest.setId)).exists()).toBe(true);
	// `current` points at the installed set directory.
	expect(await readlink(managedCurrentPath(fixture.root))).toContain(fixture.manifest.setId);
});

test("the managed install command reports success and failure", async () => {
	const fixture = await makeReleaseFixture();
	const out: string[] = [];
	const err: string[] = [];
	const ok = await runManagedInstallFromRelease({
		root: fixture.root,
		tag: "spirits-v0.1.0",
		env: { SPIRITS_RELEASE_BASE_URL: fixture.baseUrl },
		fetch,
		timeoutMs: 5000,
		io: { out: (line) => out.push(line), err: (line) => err.push(line) },
	});
	expect(ok).toEqual({ ok: true, exitCode: 0 });
	expect(out.join("\n")).toContain("Installed managed Pi 1.5.0 with spirits extension 0.1.0.");
	expect(err).toEqual([]);

	// Nothing can be fetched from a closed port, so the refusal names the tag and the escape hatches.
	const failedErr: string[] = [];
	const failed = await runManagedInstallFromRelease({
		root: fixture.root,
		tag: "spirits-v0.9.9",
		env: { SPIRITS_RELEASE_BASE_URL: UNREACHABLE },
		fetch,
		timeoutMs: 2000,
		io: { out: () => {}, err: (line) => failedErr.push(line) },
	});
	expect(failed).toEqual({ ok: false, exitCode: 1 });
	const message = failedErr.join("\n");
	expect(message).toContain("spirits-v0.9.9");
	expect(message).toContain("Repair: spirits managed-pi repair");
	expect(message).toContain("Start the previous fork route with: SPIRITS_ROUTE=fork spirits");
});

async function readFileText(path: string): Promise<string> {
	return await Bun.file(path).text();
}
