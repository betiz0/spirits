import { afterAll, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ENV_MANAGED_PI_MANIFEST_URL, MANAGED_PI_MANIFEST_ASSET_NAME } from "../src/constants.ts";
import { runManagedCommand } from "../src/managed-pi/command.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { readCurrentSet } from "../src/managed-pi/layout.ts";
import type { FetchLike } from "../src/update/types.ts";
import { cleanupManagedFixture, directoryExists, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";
import { makeReleaseFixture, stopManagedReleaseFixtures } from "./managed-pi-release-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
	await stopManagedReleaseFixtures();
});

interface Lines {
	out: string[];
	err: string[];
}

function io(): { lines: Lines; sink: { out(line: string): void; err(line: string): void } } {
	const lines: Lines = { out: [], err: [] };
	return {
		lines,
		sink: {
			out(line: string) {
				lines.out.push(line);
			},
			err(line: string) {
				lines.err.push(line);
			},
		},
	};
}

async function fixture(): Promise<ManagedFixture> {
	const value = await makeManagedFixture();
	fixtures.push(value);
	return value;
}

function fixtureFetch(value: ManagedFixture, manifestUrl: string): FetchLike {
	return async (input, init) => {
		if (input === manifestUrl) return Response.json(value.manifest);
		return fetch(input, init);
	};
}

test("unsupported version installs nothing", async () => {
	const value = await fixture();
	const manifestUrl = "https://fixture.invalid/manifest.json";
	const { lines, sink } = io();
	const exitCode = await runManagedCommand({
		root: value.root,
		action: { kind: "install", version: "1.4.0" },
		env: { [ENV_MANAGED_PI_MANIFEST_URL]: manifestUrl },
		fetch: fixtureFetch(value, manifestUrl),
		home: value.work,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(1);
	expect(lines.err.join("\n")).toContain("Unsupported managed Pi combination");
	await expect(stat(join(value.root, "releases"))).rejects.toThrow();
});

test("repair uses the installed manifest", async () => {
	const value = await fixture();
	await installManagedSet({ root: value.root, manifest: value.manifest, fetch, timeoutMs: 2000 });
	expect(await readCurrentSet(value.root)).toBe(value.manifest.setId);
	await rm(join(value.root, "current", "spirits-extension.js"));
	const { lines, sink } = io();
	const exitCode = await runManagedCommand({
		root: value.root,
		action: { kind: "repair" },
		env: {},
		fetch,
		home: value.work,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(await Bun.file(join(value.root, "current", "spirits-extension.js")).exists()).toBe(true);
});

test("help does not create an agent directory", async () => {
	const value = await fixture();
	const { sink } = io();
	const exitCode = await runManagedCommand({
		root: value.root,
		action: { kind: "help" },
		env: {},
		fetch,
		home: value.work,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(await directoryExists(join(value.root, "agent"))).toBe(false);
	expect(await directoryExists(join(value.work, ".spirits", "agent"))).toBe(false);
});

test("help prints the experimental route", async () => {
	const value = await fixture();
	const { lines, sink } = io();
	const exitCode = await runManagedCommand({
		root: value.root,
		action: { kind: "help" },
		env: {},
		fetch,
		home: value.work,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(lines.out.join("\n")).toContain("experimental");
	expect(lines.out.join("\n")).toContain("spirits managed-pi -- [pi args...]");
});

test("install resolves the manifest from the running binary's release", async () => {
	// Same rule as the other routes: the release of the version embedded in the binary, never the
	// newest release. The releases API is pointed at a closed port, so any attempt to resolve the
	// latest release would fail the run.
	const release = await makeReleaseFixture();
	const { lines, sink } = io();
	const exitCode = await runManagedCommand({
		root: release.root,
		action: { kind: "install" },
		env: { SPIRITS_RELEASE_BASE_URL: release.baseUrl, SPIRITS_API_BASE_URL: "http://127.0.0.1:9" },
		fetch,
		home: release.home,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(release.requests).toContain(
		`/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_MANIFEST_ASSET_NAME}`,
	);
	expect(lines.out.join("\n")).toContain("Installed managed Pi");
	expect(await readCurrentSet(release.root)).toBe(release.manifest.setId);
});

test("install uses the running binary's release, not the newest one", async () => {
	// The binary says 0.1.0 while the fixture release directory also serves a newer tag. The
	// manifest request must name spirits-v0.1.0 only.
	const release = await makeReleaseFixture();
	const { sink } = io();
	const exitCode = await runManagedCommand({
		root: release.root,
		action: { kind: "update" },
		env: { SPIRITS_RELEASE_BASE_URL: release.baseUrl, SPIRITS_API_BASE_URL: "http://127.0.0.1:9" },
		fetch,
		home: release.home,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(
		release.requests.filter((path) => path.endsWith(MANAGED_PI_MANIFEST_ASSET_NAME)),
	).toEqual([`/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_MANIFEST_ASSET_NAME}`]);
});

test("update handles a release manifest that names assets relatively", async () => {
	// Same real-release shape as the repair test: update resolves the manifest of the running
	// binary's release and the relative asset URL resolves against that release directory.
	const release = await makeReleaseFixture({ relativeExtensionUrl: true });
	const { lines, sink } = io();
	const exitCode = await runManagedCommand({
		root: release.root,
		action: { kind: "update" },
		env: { SPIRITS_RELEASE_BASE_URL: release.baseUrl },
		fetch,
		home: release.home,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(lines.out.join("\n")).toContain("Installed managed Pi");
	expect(await readCurrentSet(release.root)).toBe(release.manifest.setId);
});

test("the manifest URL override wins over the running binary's release", async () => {
	const release = await makeReleaseFixture();
	const override = `${release.baseUrl}/betiz0/spirits/releases/download/spirits-v9.9.9/${MANAGED_PI_MANIFEST_ASSET_NAME}`;
	const { sink } = io();
	const exitCode = await runManagedCommand({
		root: release.root,
		action: { kind: "install" },
		env: { [ENV_MANAGED_PI_MANIFEST_URL]: override },
		fetch,
		home: release.home,
		version: "0.1.0",
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(release.requests).toContain(
		`/betiz0/spirits/releases/download/spirits-v9.9.9/${MANAGED_PI_MANIFEST_ASSET_NAME}`,
	);
	expect(release.requests.some((path) => path.includes("spirits-v0.1.0"))).toBe(false);
});
