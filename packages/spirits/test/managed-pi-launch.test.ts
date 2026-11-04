import { afterAll, expect, test } from "bun:test";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { launchManagedPi, type ManagedSpawnRequest } from "../src/managed-pi/launch.ts";
import {
	cleanupManagedFixture,
	directoryExists,
	makeManagedFixture,
	type ManagedFixture,
} from "./managed-pi-fixtures.ts";

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

test("launches with the isolated agent directory", async () => {
	const value = await installed();
	const agentDir = join(value.root, "agent");
	let request: ManagedSpawnRequest | undefined;
	let createdBeforeSpawn = false;
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: {},
		home: value.fixture.work,
		spawn: async (spawned) => {
			request = spawned;
			createdBeforeSpawn = await directoryExists(agentDir);
			return 0;
		},
		io: silent,
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	expect(createdBeforeSpawn).toBe(true);
	expect(request?.env.SPIRITS_CODING_AGENT_DIR).toBe(agentDir);
	expect(request?.env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(agentDir, "sessions"));
	expect((await lstat(agentDir)).mode & 0o777).toBe(0o700);
	expect(await directoryExists(join(value.fixture.work, ".spirits", "agent"))).toBe(false);
});

test("unsafe agent directory is rejected before spawn", async () => {
	const value = await installed();
	const agentDir = join(value.root, "agent");
	await rm(agentDir, { recursive: true, force: true });
	await writeFile(agentDir, "not a directory\n");
	let spawned = false;
	const errors: string[] = [];
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
	expect(errors.join("\n")).toContain("not a directory");
	expect((await lstat(agentDir)).isFile()).toBe(true);
});

test("missing set does not create the isolated agent directory", async () => {
	const fixture = await makeManagedFixture();
	fixtures.push(fixture);
	const result = await launchManagedPi({
		root: fixture.root,
		args: [],
		env: {},
		home: fixture.work,
		spawn: async () => 0,
		io: silent,
	});
	expect(result).toEqual({ exitCode: 1, launched: false });
	expect(await directoryExists(join(fixture.root, "agent"))).toBe(false);
});

test("rejected explicit directory does not create the isolated agent directory", async () => {
	const value = await installed();
	let spawned = false;
	const errors: string[] = [];
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: { SPIRITS_CODING_AGENT_DIR: join(value.fixture.work, ".spirits", "agent") },
		home: value.fixture.work,
		spawn: async () => {
			spawned = true;
			return 0;
		},
		io: { out: () => {}, err: (line) => errors.push(line) },
	});
	expect(result).toEqual({ exitCode: 1, launched: false });
	expect(spawned).toBe(false);
	expect(errors.join("\n")).toContain("explicit agent directory is not the managed agent directory");
	expect(await directoryExists(join(value.root, "agent"))).toBe(false);
});

test("help uses the managed agent directory before spawn", async () => {
	const value = await installed();
	const agentDir = join(value.root, "agent");
	let request: ManagedSpawnRequest | undefined;
	const result = await launchManagedPi({
		root: value.root,
		args: ["--help"],
		env: {},
		home: value.fixture.work,
		spawn: async (spawned) => {
			request = spawned;
			return 0;
		},
		io: silent,
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	expect(await directoryExists(agentDir)).toBe(true);
	expect(request?.env.SPIRITS_CODING_AGENT_DIR).toBe(agentDir);
	expect(request?.command).toContain("--help");
	expect(await directoryExists(join(value.fixture.work, ".spirits", "agent"))).toBe(false);
});

test("version uses the managed agent directory before spawn", async () => {
	const value = await installed();
	const agentDir = join(value.root, "agent");
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
	expect(await directoryExists(agentDir)).toBe(true);
	expect(request?.env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(agentDir, "sessions"));
});

test("session arguments keep the pinned managed session dir", async () => {
	const value = await installed();
	const agentDir = join(value.root, "agent");
	let request: ManagedSpawnRequest | undefined;
	const result = await launchManagedPi({
		root: value.root,
		args: ["--continue"],
		env: {},
		home: value.fixture.work,
		spawn: async (spawned) => {
			request = spawned;
			return 0;
		},
		io: silent,
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	expect(request?.command).toContain("--continue");
	expect(request?.env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(agentDir, "sessions"));
	expect(request?.env.SPIRITS_CODING_AGENT_DIR).toBe(agentDir);
});

test("normal launch leaves the existing agent fixture unchanged", async () => {
	const value = await installed();
	const existingAgentDir = join(value.fixture.work, ".spirits", "agent");
	await mkdir(existingAgentDir, { recursive: true });
	const settings = join(existingAgentDir, "settings.json");
	await writeFile(settings, '{"theme":"dark"}\n');
	const before = await lstat(settings);
	const result = await launchManagedPi({
		root: value.root,
		args: [],
		env: {},
		home: value.fixture.work,
		spawn: async () => 0,
		io: silent,
	});
	expect(result).toEqual({ exitCode: 0, launched: true });
	const after = await lstat(settings);
	expect(await Bun.file(settings).text()).toBe('{"theme":"dark"}\n');
	expect(after.mtimeMs).toBe(before.mtimeMs);
	expect(after.ino).toBe(before.ino);
});
