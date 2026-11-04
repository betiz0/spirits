import { afterAll, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ENV_MANAGED_PI_MANIFEST_URL } from "../src/constants.ts";
import { runManagedCommand } from "../src/managed-pi/command.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { readCurrentSet } from "../src/managed-pi/layout.ts";
import type { FetchLike } from "../src/update/types.ts";
import { cleanupManagedFixture, directoryExists, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
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
		io: sink,
	});
	expect(exitCode).toBe(0);
	expect(lines.out.join("\n")).toContain("experimental");
	expect(lines.out.join("\n")).toContain("spirits managed-pi -- [pi args...]");
});
