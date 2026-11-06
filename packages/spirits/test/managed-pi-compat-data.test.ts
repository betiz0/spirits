import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompatRunner } from "../../../scripts/managed-pi-compat/runner.ts";
import { runRpcProbe } from "../../../scripts/managed-pi-compat/rpc.ts";
import {
	classifyAuthRead,
	classifyDedicatedRead,
	classifyDedicatedWrite,
	classifyExternalExtensionRead,
	classifySettingsWrite,
	classifyWriteBackCompatibility,
	REDACTED_AGENT_FIXTURE_DIR,
	seedRedactedAgentFixture,
} from "../../../scripts/managed-pi-compat/data.ts";
import { computeManagedEnv } from "../src/managed-pi/environment.ts";
import { resolveManagedAgentPaths, ManagedAgentGuardError } from "../src/managed-pi/agent-dir.ts";
import { writeBundledSkills } from "../src/harness/bundled-skills/index.ts";
import { createBundledSkills } from "../src/harness/bundled-skills/definition.ts";
import { FAKE_RPC_PI_SCRIPT } from "./managed-pi-fixtures.ts";

const dirs: string[] = [];
afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

test("reads settings and sessions through the dedicated Pi", () => {
	expect(
		classifyDedicatedRead({ settingsKeys: ["defaultProvider", "models"], sessionEntries: 2 }).state,
	).toBe("confirmed");
	expect(classifyDedicatedRead({ settingsKeys: [], sessionEntries: 2 }).state).toBe("limited");
	expect(classifyDedicatedRead({ settingsKeys: [], sessionEntries: 0 }).state).toBe("not-run");
});

test("writes and reads back through the dedicated Pi", () => {
	expect(
		classifyDedicatedWrite({
			sessionWritten: true,
			sessionReadBack: true,
			modelChanged: true,
			thinkingLevelChanged: true,
		}).state,
	).toBe("confirmed");
	expect(
		classifyDedicatedWrite({
			sessionWritten: true,
			sessionReadBack: false,
			modelChanged: true,
			thinkingLevelChanged: false,
		}).detail,
	).toContain("thinking level");
	expect(
		classifyDedicatedWrite({
			sessionWritten: false,
			sessionReadBack: false,
			modelChanged: false,
			thinkingLevelChanged: false,
		}).state,
	).toBe("not-run");
});

test("settings write is not-run when the Pi API does not expose it", () => {
	const result = classifySettingsWrite({ available: false });
	expect(result.state).toBe("not-run");
	expect(result.detail).toContain("does not expose");
	expect(classifySettingsWrite({ available: true, written: true }).state).toBe("confirmed");
});

test("reads auth and external extensions through the dedicated Pi", () => {
	// A credential only the copied agent dir holds, plus an unconfigured control, is the read.
	expect(
		classifyAuthRead({
			stored: { configured: true, source: "stored" },
			control: { configured: false },
		}).state,
	).toBe("confirmed");
	expect(classifyAuthRead({ stored: { configured: true, source: "environment" } }).state).toBe("limited");
	expect(classifyAuthRead({ stored: { configured: false } }).state).toBe("limited");
	expect(classifyAuthRead({}).state).toBe("not-run");
	expect(
		classifyExternalExtensionRead({ commandObserved: true, commandName: "compat-redacted-command" }).state,
	).toBe("confirmed");
	const missing = classifyExternalExtensionRead({ commandObserved: false, commandName: "compat-redacted-command" });
	expect(missing.state).toBe("not-run");
	expect(missing.detail).toContain("compat-redacted-command");
	// The dedicated Pi write path never stands in for write-back compatibility.
	expect(classifyWriteBackCompatibility({ proven: false }).state).toBe("not-run");
});

test("reads a redacted existing agent fixture", async () => {
	const runner = await createCompatRunner();
	dirs.push(runner.workRoot);
	try {
		const seeded = await seedRedactedAgentFixture(runner.agentDir);
		const relative = seeded.map((path) => path.slice(runner.agentDir.length + 1));
		// Settings, auth, sessions, and an external extension: the four kinds the spec lists.
		for (const expected of ["settings.json", "auth.json", "sessions/session.jsonl", "extensions/redacted.ts"]) {
			expect(relative).toContain(expected);
		}
		const settings = (await Bun.file(join(runner.agentDir, "settings.json")).json()) as Record<string, unknown>;
		expect(settings).toMatchObject({ defaultProvider: "compat-fake", defaultModel: "fake-model" });
		const auth = await Bun.file(join(runner.agentDir, "auth.json")).json();
		expect(auth).toMatchObject({ "compat-redacted": { key: "redacted" } });
		expect(await Bun.file(join(runner.agentDir, "sessions", "session.jsonl")).exists()).toBe(true);
		expect(await Bun.file(join(runner.agentDir, "extensions", "redacted.ts")).exists()).toBe(true);
		// Seeding again must not replace what an earlier item already wrote.
		await writeFile(join(runner.agentDir, "settings.json"), `${JSON.stringify({ defaultProvider: "kept" })}\n`);
		await seedRedactedAgentFixture(runner.agentDir);
		expect(await Bun.file(join(runner.agentDir, "settings.json")).text()).toContain("kept");
		expect(REDACTED_AGENT_FIXTURE_DIR.length).toBeGreaterThan(0);
	} finally {
		await runner.cleanup();
	}
});

test("existing agent fixture is unchanged", async () => {
	const runner = await createCompatRunner();
	dirs.push(runner.workRoot);
	try {
		// The runner resolves its storage through the product guard, not through its own path choice.
		await expect(resolveManagedAgentPaths({ home: runner.home, root: runner.managedRoot, env: {} })).resolves.toMatchObject({
			agentDir: runner.agentDir,
			existingAgentDir: runner.existingAgentDir,
		});
		const fixtureDir = runner.existingAgentDir;
		await mkdir(join(fixtureDir, "sessions"), { recursive: true });
		const settingsPath = join(fixtureDir, "settings.json");
		const sessionPath = join(fixtureDir, "sessions", "s1.jsonl");
		await writeFile(settingsPath, `${JSON.stringify({ defaultProvider: "real" }, null, "\t")}\n`);
		await writeFile(sessionPath, "{}\n");
		const before = [await readFile(settingsPath, "utf8"), await readFile(sessionPath, "utf8")];
		const beforeMtime = (await stat(settingsPath)).mtimeMs;

		const packageDir = join(runner.workRoot, "package");
		await mkdir(packageDir, { recursive: true });
		await writeFile(
			join(packageDir, "package.json"),
			`${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.0", piConfig: { name: "spirits", configDir: ".pi" } }, null, "\t")}\n`,
		);
		const statePath = join(runner.workRoot, "probe-state.json");
		const env = computeManagedEnv({
			env: runner.env({ MANAGED_PI_COMPAT_PROBE_STATE: statePath }),
			agentDir: runner.agentDir,
			packageDir,
		});
		const script = join(runner.workRoot, "fake-pi.ts");
		await writeFile(script, FAKE_RPC_PI_SCRIPT, { mode: 0o755 });
		const result = await runRpcProbe({
			command: [script, "--mode", "rpc", "--no-session"],
			cwd: runner.workRoot,
			env,
			requests: [{ id: "state-1", type: "get_state" }],
		});
		expect(result.records.length).toBeGreaterThan(0);
		const state = JSON.parse(await readFile(statePath, "utf8")) as { agentDir?: string };
		expect(state.agentDir).toBe(runner.agentDir);

		// An echoed environment variable proves nothing on its own, so the storage has to be shown in
		// use: the bundled skills the product writes land under the isolated agent dir.
		const versionDir = await writeBundledSkills({
			agentDir: runner.agentDir,
			version: "0.0.0-compat",
			skills: createBundledSkills(),
		});
		expect(versionDir.startsWith(`${runner.agentDir}/bundled-skills/`)).toBe(true);
		const writtenSkills = await readdir(versionDir, { recursive: true });
		expect(writtenSkills.filter((entry) => typeof entry === "string" && entry.endsWith("SKILL.md")).length).toBeGreaterThan(0);

		const after = [await readFile(settingsPath, "utf8"), await readFile(sessionPath, "utf8")];
		expect(after).toEqual(before);
		expect((await stat(settingsPath)).mtimeMs).toBe(beforeMtime);

		await expect(
			resolveManagedAgentPaths({
				home: runner.home,
				root: runner.managedRoot,
				env: { SPIRITS_CODING_AGENT_DIR: "/tmp/elsewhere" },
			}),
		).rejects.toBeInstanceOf(ManagedAgentGuardError);
		await expect(
			resolveManagedAgentPaths({
				home: runner.home,
				root: runner.managedRoot,
				env: { SPIRITS_CODING_AGENT_DIR: runner.agentDir },
			}),
		).resolves.toMatchObject({ agentDir: runner.agentDir });
	} finally {
		await runner.cleanup();
	}
});
