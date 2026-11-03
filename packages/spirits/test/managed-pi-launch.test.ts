import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { launchManagedPi, type ManagedSpawnRequest } from "../src/managed-pi/launch.ts";
import { cleanupManagedFixture, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

async function installed(): Promise<{ fixture: ManagedFixture; root: string; executable: string; extension: string }> {
	const fixture = await makeManagedFixture();
	fixtures.push(fixture);
	await installManagedSet({ root: fixture.root, manifest: fixture.manifest, fetch, timeoutMs: 2000 });
	return {
		fixture,
		root: fixture.root,
		executable: join(fixture.root, "current", "pi", "pi"),
		extension: join(fixture.root, "current", "spirits-extension.js"),
	};
}

const silent = { out: () => {}, err: () => {} };

test("launches the absolute managed path", async () => {
	const value = await installed();
	let request: ManagedSpawnRequest | undefined;
	const result = await launchManagedPi({
		root: value.root,
		args: ["--version"],
		env: {},
		home: value.fixture.work,
		spawn: async (spawned) => {
			request = spawned;
			return 0;
		},
		io: silent,
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	expect(request?.command[0]).toBe(value.executable);
	expect(request?.command.slice(1)).toEqual(["-e", value.extension, "--version"]);
	expect(request?.env.PI_PACKAGE_DIR).toBe(join(value.root, "current", "pi"));
});

test("does not search PATH", async () => {
	const value = await installed();
	let command: string[] = [];
	await launchManagedPi({
		root: value.root,
		args: [],
		env: { PATH: "/definitely/not/here" },
		home: value.fixture.work,
		spawn: async (spawned) => {
			command = spawned.command;
			return 0;
		},
		io: silent,
	});
	expect(command[0]).toBe(value.executable);
	expect(command[0]).not.toBe("pi");
});

test("missing set does not fall back", async () => {
	const fixture = await makeManagedFixture();
	fixtures.push(fixture);
	let spawned = false;
	const errors: string[] = [];
	const result = await launchManagedPi({
		root: fixture.root,
		args: [],
		env: {},
		home: fixture.work,
		spawn: async () => {
			spawned = true;
			return 0;
		},
		io: { out: () => {}, err: (line) => errors.push(line) },
	});
	expect(result).toEqual({ exitCode: 1, launched: false });
	expect(spawned).toBe(false);
	expect(errors.join("\n")).toContain("managed-pi install");
});

test("exit code is propagated", async () => {
	const value = await installed();
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: {},
		home: value.fixture.work,
		spawn: async () => 42,
		io: silent,
	});
	expect(result).toEqual({ exitCode: 42, launched: true });
});

test("corrupt executable does not fall back", async () => {
	const value = await installed();
	let spawned = false;
	const errors: string[] = [];
	await Bun.write(value.executable, "#!/bin/sh\necho tampered\n");
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: {},
		home: value.fixture.work,
		spawn: async () => {
			spawned = true;
			return 0;
		},
		io: { out: () => {}, err: (line) => errors.push(line) },
	});
	expect(result).toEqual({ exitCode: 1, launched: false });
	expect(spawned).toBe(false);
	expect(errors.join("\n")).toContain("checksum");
	expect(errors.join("\n")).toContain("managed-pi install");
});

test("unsupported platform is rejected before spawn", async () => {
	const value = await installed();
	let spawned = false;
	const errors: string[] = [];
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: {},
		home: value.fixture.work,
		platform: "darwin",
		arch: "arm64",
		spawn: async () => {
			spawned = true;
			return 0;
		},
		io: { out: () => {}, err: (line) => errors.push(line) },
	});
	expect(result).toEqual({ exitCode: 1, launched: false });
	expect(spawned).toBe(false);
	expect(errors.join("\n")).toContain("Unsupported platform");
	expect(errors.join("\n")).toContain("managed-pi install");
});
