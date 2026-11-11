import { afterAll, expect, test } from "bun:test";
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ENV_AGENT_DIR, MANAGED_PI_MANIFEST_ASSET_NAME } from "../src/constants.ts";
import { runDefaultManagedStartup, type DefaultManagedStartupOptions } from "../src/managed-pi/default-route.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import {
	makeReleaseFixture,
	stopManagedReleaseFixtures,
	type ReleaseFixture,
} from "./managed-pi-release-fixtures.ts";

afterAll(stopManagedReleaseFixtures);

interface Harness {
	fixture: ReleaseFixture;
	baseUrl: string;
	home: string;
	root: string;
	agentDir: string;
	backupsDir: string;
	argsFile: string;
	envFile: string;
	settingsFile: string;
	out: string[];
	err: string[];
	/** Run the default route with the production spawner: the recorded Pi really runs. */
	run(overrides?: Partial<DefaultManagedStartupOptions>): Promise<{
		exitCode: number;
		launched: boolean;
		agentDir: string;
	}>;
	envOf(): Promise<Record<string, string>>;
	argsOf(): Promise<string>;
}

async function makeHarness(fixture: ReleaseFixture, installed: boolean): Promise<Harness> {
	if (installed) {
		await installManagedSet({
			root: fixture.root,
			manifest: fixture.manifest,
			fetch,
			timeoutMs: 5000,
			io: { out: () => {}, err: () => {} },
		});
	}
	const out: string[] = [];
	const err: string[] = [];
	const harness: Harness = {
		fixture,
		baseUrl: fixture.baseUrl,
		home: fixture.home,
		root: fixture.root,
		agentDir: join(fixture.home, ".spirits", "agent"),
		backupsDir: join(fixture.home, ".spirits", "backups"),
		argsFile: join(fixture.home, "args.txt"),
		envFile: join(fixture.home, "env.txt"),
		settingsFile: join(fixture.home, "written-settings.json"),
		out,
		err,
		envOf: async () =>
			Object.fromEntries(
				(await readFile(harness.envFile, "utf8"))
					.split("\n")
					.filter((line) => line.includes("="))
					.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
			),
		argsOf: () => readFile(harness.argsFile, "utf8"),
		// The fixture server stands in for the release host, so the managed manifest of
		// `spirits-v<version>` is served from it.
		run: (overrides = {}) =>
			runDefaultManagedStartup({
				root: fixture.root,
				home: fixture.home,
				version: "0.1.0",
				fetch,
				args: [],
				io: { out: (line) => out.push(line), err: (line) => err.push(line) },
				...overrides,
				env: {
					PATH: process.env.PATH ?? "/usr/bin:/bin",
					SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
					PI_ARGS_FILE: harness.argsFile,
					PI_ENV_FILE: harness.envFile,
					PI_SETTINGS_FILE: harness.settingsFile,
					...(overrides.env ?? {}),
				},
			}),
	};
	return harness;
}

async function entries(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}

test("the default route launches managed with the fork's agent directory", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), true);
	const result = await harness.run();
	expect(result.exitCode).toBe(0);
	expect(result.launched).toBe(true);
	expect(result.agentDir).toBe(harness.agentDir);
	const env = await harness.envOf();
	expect(env.SPIRITS_CODING_AGENT_DIR).toBe(harness.agentDir);
	// Pi takes the session directory as the directory itself, so pinning it here would move new
	// sessions out of the layout the fork route wrote. The default route leaves it unset.
	expect(env.SPIRITS_CODING_AGENT_SESSION_DIR).toBeUndefined();
	expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
	expect(env.PI_APP_NAME).toBeUndefined();
	expect(env.PI_PACKAGE_DIR).toContain(join("managed-pi", "current", "pi"));
	// The child wrote into the existing-rule agent dir, and nothing under the managed root's agent.
	expect(await readFile(harness.settingsFile, "utf8")).toContain("dark");
	expect(await entries(join(harness.root, "agent"))).toEqual([]);
}, 60_000);

test("explicit and defaulted agent directories follow the caller", async () => {
	const fixture = await makeReleaseFixture();
	const harness = await makeHarness(fixture, true);
	const custom = join(fixture.home, "elsewhere-agent");
	const result = await harness.run({
		env: {
			PATH: "/usr/bin:/bin",
			SPIRITS_CODING_AGENT_DIR: custom,
			PI_ARGS_FILE: harness.argsFile,
			PI_ENV_FILE: harness.envFile,
		},
	});
	expect(result.exitCode).toBe(0);
	expect((await harness.envOf())[ENV_AGENT_DIR]).toBe(custom);
});

test("Pi arguments are forwarded unchanged", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), true);
	for (const args of [
		["--continue"],
		["--resume"],
		["--session", join("relative", "session.jsonl")],
		["--fork", "session.jsonl"],
		["--session-dir", "/tmp/sessions"],
		["--export", "out.html", "session.jsonl"],
		["--help"],
	]) {
		const result = await harness.run({ args });
		expect(result.exitCode).toBe(0);
		// The caller's arguments reach the dedicated Pi unchanged, after the bundle selection.
		const received = (await harness.argsOf()).trim();
		expect(received.endsWith(args.join(" "))).toBe(true);
		expect(received.startsWith("-e ")).toBe(true);
	}
}, 60_000);

test("the first launch backs the agent directory up once", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), true);
	await mkdir(harness.agentDir, { recursive: true });
	await writeFile(join(harness.agentDir, "settings.json"), '{"theme":"light"}\n');
	await writeFile(join(harness.agentDir, "auth.json"), '{"key":"secret"}\n');
	await chmod(join(harness.agentDir, "auth.json"), 0o600);
	await mkdir(join(harness.agentDir, "private"), { recursive: true });
	await chmod(join(harness.agentDir, "private"), 0o700);
	const outside = join(harness.home, "outside-skills");
	await mkdir(outside, { recursive: true });
	await writeFile(join(outside, "SKILL.md"), "outside body\n");
	await symlink(outside, join(harness.agentDir, "skills"));

	const first = await harness.run();
	expect(first.exitCode).toBe(0);
	const backups = await entries(harness.backupsDir);
	expect(backups.length).toBe(1);
	expect(backups[0]).toMatch(/^agent-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
	const backup = join(harness.backupsDir, backups[0] as string);
	expect(await entries(backup)).toEqual(["auth.json", "private", "settings.json", "skills"]);
	expect(await readFile(join(backup, "settings.json"), "utf8")).toContain("light");
	expect((await lstat(join(backup, "auth.json"))).mode & 0o777).toBe(0o600);
	expect((await lstat(join(backup, "private"))).mode & 0o777).toBe(0o700);
	// The link stayed a link and its target was never copied.
	expect((await lstat(join(backup, "skills"))).isSymbolicLink()).toBe(true);
	expect(await entries(join(backup, "skills"))).toEqual(["SKILL.md"]);

	const listing = harness.out.join("\n");
	expect(listing).toContain(`Backup: ${backup}`);
	expect(listing).toContain("Size:");
	expect(listing).toContain("skills");
	expect(listing).toContain(outside);

	// The record keeps a second launch from copying again.
	const second = await harness.run();
	expect(second.exitCode).toBe(0);
	expect(await entries(harness.backupsDir)).toEqual(backups);
	expect(await readFile(join(harness.root, "agent-backup.json"), "utf8")).toContain(backup);
}, 60_000);

test("a different agent directory gets its own first backup", async () => {
	// The record is per agent directory (S-2): pointing `SPIRITS_CODING_AGENT_DIR` at another
	// directory is that directory's first managed launch, not a repeat of the default one.
	const fixture = await makeReleaseFixture();
	const harness = await makeHarness(fixture, true);
	await mkdir(harness.agentDir, { recursive: true });
	await writeFile(join(harness.agentDir, "settings.json"), '{"which":"default"}\n');
	const custom = join(fixture.home, "chosen-agent");
	await mkdir(custom, { recursive: true });
	await writeFile(join(custom, "settings.json"), '{"which":"chosen"}\n');

	// Distinct timestamps: two directories handled inside the same second would derive the same
	// backup directory name (recorded as follow-up W-5).
	const first = await harness.run({ now: new Date("2026-11-12T08:00:00.000Z") });
	expect(first.exitCode).toBe(0);
	expect(await entries(harness.backupsDir)).toHaveLength(1);

	const second = await harness.run({
		now: new Date("2026-11-12T08:00:01.000Z"),
		env: {
			PATH: "/usr/bin:/bin",
			SPIRITS_CODING_AGENT_DIR: custom,
			PI_ARGS_FILE: harness.argsFile,
			PI_ENV_FILE: harness.envFile,
		},
	});
	expect(second.exitCode).toBe(0);
	expect(await entries(harness.backupsDir)).toHaveLength(2);
	// The second copy is the custom directory's content, not the default one's.
	const secondBackup = join(harness.backupsDir, "agent-2026-11-12T08-00-01Z");
	expect(await readFile(join(secondBackup, "settings.json"), "utf8")).toContain("chosen");
	// A third launch of either directory copies nothing.
	await harness.run({ now: new Date("2026-11-12T08:00:02.000Z") });
	await harness.run({
		now: new Date("2026-11-12T08:00:03.000Z"),
		env: {
			PATH: "/usr/bin:/bin",
			SPIRITS_CODING_AGENT_DIR: custom,
			PI_ARGS_FILE: harness.argsFile,
			PI_ENV_FILE: harness.envFile,
		},
	});
	expect(await entries(harness.backupsDir)).toHaveLength(2);
}, 60_000);

test("a missing agent directory records the backup without copying", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), true);
	const result = await harness.run();
	expect(result.exitCode).toBe(0);
	expect(await entries(harness.backupsDir)).toEqual([]);
	expect(await Bun.file(join(harness.root, "agent-backup.json")).exists()).toBe(true);
	expect(harness.out.join("\n")).toContain("No agent directory to back up yet");
}, 60_000);

test("a failed backup stops the launch", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), true);
	await mkdir(harness.agentDir, { recursive: true });
	await writeFile(join(harness.agentDir, "settings.json"), "{}\n");
	// A read-only backups root makes every copy and rename under it fail.
	await mkdir(harness.backupsDir, { recursive: true });
	await chmod(harness.backupsDir, 0o500);
	try {
		const result = await harness.run();
		expect(result.exitCode).toBe(1);
		expect(result.launched).toBe(false);
		const message = harness.err.join("\n");
		expect(message).toContain("The managed launch did not start");
		expect(message).toContain("spirits managed-pi repair");
		expect(message).toContain("SPIRITS_ROUTE=fork spirits");
		expect(message).toContain("no Pi process was started");
		// Nothing was launched and nothing was recorded, so the next launch retries the backup.
		expect(await Bun.file(harness.argsFile).exists()).toBe(false);
		expect(await Bun.file(join(harness.root, "agent-backup.json")).exists()).toBe(false);
	} finally {
		await chmod(harness.backupsDir, 0o700);
	}
}, 60_000);

test("a missing managed set is fetched from the running binary's release", async () => {
	const harness = await makeHarness(await makeReleaseFixture(), false);
	const result = await harness.run({ version: "0.1.0" });
	expect(harness.err.join("\n") + "\n" + harness.out.join("\n")).toContain("Installed managed Pi");
	expect(result.exitCode).toBe(0);
	expect(harness.fixture.requests).toContain(
		`/betiz0/spirits/releases/download/spirits-v0.1.0/${MANAGED_PI_MANIFEST_ASSET_NAME}`,
	);
	expect(harness.out.join("\n")).toContain("Installing it from spirits-v0.1.0");
	expect(await readFile(harness.settingsFile, "utf8")).toContain("dark");
}, 60_000);

test("a fetch failure and a corrupt set both refuse to launch", async () => {
	const missing = await makeHarness(await makeReleaseFixture(), false);
	const unreachable = await runDefaultManagedStartup({
		root: missing.root,
		home: missing.home,
		version: "0.1.0",
		// A closed port: the manifest request cannot be served.
		fetch: (async () => {
			throw new Error("network is unavailable");
		}) as unknown as typeof fetch,
		args: [],
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
		io: { out: () => {}, err: (line) => missing.err.push(line) },
	});
	expect(unreachable.exitCode).toBe(1);
	expect(unreachable.launched).toBe(false);
	expect(unreachable.agentDir).toBe(missing.agentDir);
	const fetchMessage = missing.err.join("\n");
	expect(fetchMessage).toContain("spirits managed-pi repair");
	expect(fetchMessage).toContain("SPIRITS_ROUTE=fork spirits");
	expect(await entries(missing.backupsDir)).toEqual([]);

	// An installed set whose bundle was rewritten is left alone: the refusal names the repair command
	// instead of refetching on every launch.
	const corrupt = await makeHarness(await makeReleaseFixture(), true);
	await writeFile(join(corrupt.root, "current", "spirits-extension.js"), "tampered\n");
	const result = await corrupt.run();
	expect(result.launched).toBe(false);
	expect(result.exitCode).toBe(1);
	const message = corrupt.err.join("\n");
	expect(message).toContain("does not match its recorded checksum");
	expect(message).toContain("spirits managed-pi repair");
	expect(message).toContain("SPIRITS_ROUTE=fork spirits");
	expect(await entries(corrupt.backupsDir)).toEqual([]);
}, 60_000);
