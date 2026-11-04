import { afterAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeEnvDefaults } from "../bin/env-defaults.ts";
import { copyCallerEnv, runManagedStartup } from "../bin/startup.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import type { ManagedSpawnRequest } from "../src/managed-pi/launch.ts";
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

/** A fixture managed set under a temporary home, with the existing agent dir left alone. */
async function startupFixture(): Promise<{ fixture: ManagedFixture; root: string; home: string; agentDir: string; existing: string }> {
	const fixture = await makeManagedFixture();
	fixtures.push(fixture);
	await installManagedSet({ root: fixture.root, manifest: fixture.manifest, fetch, timeoutMs: 3000 });
	const home = fixture.work;
	return { fixture, root: fixture.root, home, agentDir: join(fixture.root, "agent"), existing: join(home, ".spirits", "agent") };
}

interface Launch {
	request: ManagedSpawnRequest | undefined;
	exitCode: number;
	errors: string[];
}

/** Run the same hand-off the wrapper calls, with the spawn replaced by a seam. */
async function launch(
	value: Awaited<ReturnType<typeof startupFixture>>,
	snapshot: Record<string, string | undefined>,
	args: string[] = [],
): Promise<Launch> {
	let request: ManagedSpawnRequest | undefined;
	const errors: string[] = [];
	const exitCode = await runManagedStartup({
		snapshot,
		action: { kind: "launch", args },
		root: value.root,
		fetch,
		home: value.home,
		io: { out: () => {}, err: (line) => errors.push(line) },
		spawn: async (spawned) => {
			request = spawned;
			return 0;
		},
	});
	return { request, exitCode, errors };
}

test("snapshot is a copy and does not receive defaults", () => {
	const home = "/home/tester";
	const callerEnv: Record<string, string | undefined> = { PATH: "/bin" };
	const snapshot = copyCallerEnv(callerEnv);
	// What `applyEnvDefaults()` does to `process.env` afterwards.
	for (const [name, value] of Object.entries(computeEnvDefaults(callerEnv, home))) {
		callerEnv[name] = value;
	}
	expect(callerEnv.SPIRITS_CODING_AGENT_DIR).toBe(join(home, ".spirits", "agent"));
	expect(snapshot.SPIRITS_CODING_AGENT_DIR).toBeUndefined();
	expect(snapshot.PATH).toBe("/bin");
});

test("managed launch receives the pre-default snapshot", async () => {
	const value = await startupFixture();
	const snapshot = { PATH: "/bin", SPIRITS_ROUTING_MODEL: "spirits/auto" };
	const result = await launch(value, snapshot);
	expect(result.exitCode).toBe(0);
	expect(result.request?.env.SPIRITS_ROUTING_MODEL).toBe("spirits/auto");
	expect(result.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
	expect(result.request?.env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(value.agentDir, "sessions"));
	expect(JSON.stringify(result.request?.env)).not.toContain(value.existing);
});

test("defaulted env is rejected while the snapshot is accepted", async () => {
	const value = await startupFixture();
	const defaulted: Record<string, string | undefined> = { PATH: "/bin" };
	for (const [name, envValue] of Object.entries(computeEnvDefaults({ PATH: "/bin" }, value.home))) {
		defaulted[name] = envValue;
	}
	const rejected = await launch(value, defaulted);
	expect(rejected.exitCode).toBe(1);
	expect(rejected.request).toBeUndefined();
	expect(await directoryExists(value.agentDir)).toBe(false);
	const accepted = await launch(value, { PATH: "/bin" });
	expect(accepted.exitCode).toBe(0);
	expect(accepted.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
});

test("unspecified launch uses the managed agent directory", async () => {
	const value = await startupFixture();
	const result = await launch(value, {});
	expect(result.exitCode).toBe(0);
	expect(result.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
	expect(await directoryExists(value.agentDir)).toBe(true);
	expect(await directoryExists(value.existing)).toBe(false);
});

test("explicit existing agent directory is rejected before spawn", async () => {
	const value = await startupFixture();
	await mkdir(value.existing, { recursive: true });
	await writeFile(join(value.existing, "settings.json"), "{}\n");
	const result = await launch(value, { SPIRITS_CODING_AGENT_DIR: value.existing });
	expect(result.exitCode).toBe(1);
	expect(result.request).toBeUndefined();
	expect(result.errors.join("\n")).toContain("explicit agent directory is not the managed agent directory");
	expect(await directoryExists(value.agentDir)).toBe(false);
	expect(await Bun.file(join(value.existing, "settings.json")).text()).toBe("{}\n");
});

test("explicit managed agent directory is accepted", async () => {
	const value = await startupFixture();
	const result = await launch(value, { SPIRITS_CODING_AGENT_DIR: value.agentDir });
	expect(result.exitCode).toBe(0);
	expect(result.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
	expect(await directoryExists(value.agentDir)).toBe(true);
});

test("arbitrary explicit directory is rejected before spawn", async () => {
	const value = await startupFixture();
	const result = await launch(value, { SPIRITS_CODING_AGENT_DIR: "/tmp/any-agent-dir" });
	expect(result.exitCode).toBe(1);
	expect(result.request).toBeUndefined();
	expect(result.errors.join("\n")).toContain(value.agentDir);
	expect(result.errors.join("\n")).toContain("/tmp/any-agent-dir");
	expect(await directoryExists(value.agentDir)).toBe(false);
});

test("normal route keeps the default agent directory", async () => {
	const value = await startupFixture();
	const defaults = computeEnvDefaults({}, value.home);
	expect(defaults.SPIRITS_CODING_AGENT_DIR).toBe(join(value.home, ".spirits", "agent"));
	expect(defaults.PI_SKIP_VERSION_CHECK).toBe("1");
	const managed = await launch(value, copyCallerEnv({}));
	expect(managed.exitCode).toBe(0);
	expect(managed.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
	expect(await directoryExists(value.existing)).toBe(false);
});

test("managed help uses the same guard", async () => {
	const value = await startupFixture();
	const result = await launch(value, {}, ["--help"]);
	expect(result.exitCode).toBe(0);
	expect(result.request?.command).toContain("--help");
	expect(result.request?.env.SPIRITS_CODING_AGENT_DIR).toBe(value.agentDir);
	expect(await directoryExists(value.agentDir)).toBe(true);
	expect(await directoryExists(value.existing)).toBe(false);
});
