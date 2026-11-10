/**
 * Unit tests for the one-time agent directory backup.
 *
 * Every case runs against a temporary directory. The rules under test are the ones the default route
 * relies on: exactly one copy, links stay links, permission bits survive, a failure leaves nothing
 * behind that looks like a finished backup.
 */

import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_BACKUP_DIR_PREFIX, AGENT_BACKUP_STATE_FILE_NAME, AGENT_BACKUP_TEMP_SUFFIX } from "../src/constants.ts";
import {
	agentBackupTimestamp,
	backupAgentDirOnce,
	formatByteSize,
	type AgentBackupResult,
} from "../src/managed-pi/agent-backup.ts";

const NOW = new Date("2026-11-10T09:12:33.000Z");

interface BackupFixture {
	agentDir: string;
	backupsDir: string;
	statePath: string;
	out: string[];
	err: string[];
	run(now?: Date): Promise<AgentBackupResult>;
	backups(): Promise<string[]>;
}

async function makeBackupFixture(): Promise<BackupFixture> {
	const work = await mkdtemp(join(tmpdir(), "spirits-agent-backup-"));
	const fixture: BackupFixture = {
		agentDir: join(work, "agent"),
		backupsDir: join(work, "backups"),
		statePath: join(work, "managed-pi", AGENT_BACKUP_STATE_FILE_NAME),
		out: [],
		err: [],
		backups: async () => {
			try {
				return (await readdir(fixture.backupsDir)).sort();
			} catch {
				return [];
			}
		},
		run: (now = NOW) =>
			backupAgentDirOnce({
				agentDir: fixture.agentDir,
				backupsDir: fixture.backupsDir,
				statePath: fixture.statePath,
				now,
				pid: 4242,
				io: { out: (line) => fixture.out.push(line), err: (line) => fixture.err.push(line) },
			}),
	};
	return fixture;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

test("the timestamp names the backup directory in UTC", () => {
	expect(agentBackupTimestamp(NOW)).toBe("2026-11-10T09-12-33Z");
	// The file name has no colons, so it survives being tarred, copied, or typed.
	expect(agentBackupTimestamp(NOW)).not.toContain(":");
});

test("formats a size the user can read", () => {
	expect(formatByteSize(0)).toBe("0 B");
	expect(formatByteSize(1023)).toBe("1023 B");
	expect(formatByteSize(1024)).toBe("1.0 KiB");
	expect(formatByteSize(5 * 1024 * 1024)).toBe("5.0 MiB");
	expect(formatByteSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GiB");
});

test("copies the agent directory once and records the copy", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(fixture.agentDir, { recursive: true });
	await writeFile(join(fixture.agentDir, "settings.json"), '{"theme":"dark"}\n');
	await mkdir(join(fixture.agentDir, "sessions"), { recursive: true });
	await writeFile(join(fixture.agentDir, "sessions", "a.jsonl"), "{}\n");

	const first = await fixture.run();
	expect(first.reason).toBe("backed-up");
	expect(first.destination).toBe(join(fixture.backupsDir, `${AGENT_BACKUP_DIR_PREFIX}2026-11-10T09-12-33Z`));
	expect(first.fileCount).toBe(2);
	// `{"theme":"dark"}\n` plus `{}\n`.
	expect(first.byteSize).toBe(17 + 3);
	expect(await readFile(join(first.destination as string, "settings.json"), "utf8")).toContain("dark");
	expect(await readFile(join(first.destination as string, "sessions", "a.jsonl"), "utf8")).toBe("{}\n");
	expect(await fixture.backups()).toEqual([`${AGENT_BACKUP_DIR_PREFIX}2026-11-10T09-12-33Z`]);

	const state = JSON.parse(await readFile(fixture.statePath, "utf8"));
	expect(state).toMatchObject({
		schemaVersion: 1,
		at: "2026-11-10T09:12:33.000Z",
		agentDir: fixture.agentDir,
		reason: "backed-up",
		destination: first.destination,
		byteSize: 20,
	});

	// A second launch never copies again, even though the agent directory has changed since.
	await writeFile(join(fixture.agentDir, "settings.json"), '{"theme":"light"}\n');
	const second = await fixture.run(new Date("2027-01-01T00:00:00.000Z"));
	expect(second.reason).toBe("already-recorded");
	expect(second.destination).toBeUndefined();
	await expect(fixture.backups()).resolves.toEqual([`${AGENT_BACKUP_DIR_PREFIX}2026-11-10T09-12-33Z`]);
});

test("reports the destination, the size, and every link", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(fixture.agentDir, { recursive: true });
	await writeFile(join(fixture.agentDir, "auth.json"), "x".repeat(2048));
	const result = await fixture.run();
	const listing = fixture.out.join("\n");
	expect(listing).toContain(`Backup: ${result.destination}`);
	expect(listing).toContain("Size: 2.0 KiB (2048 bytes in 1 files)");
	expect(listing).toContain("Backed up the agent directory before the first managed launch.");
});

test("keeps symlinks as links and reports what they point at", async () => {
	const fixture = await makeBackupFixture();
	const outside = join(fixture.agentDir, "..", "outside", "skills");
	await mkdir(join(fixture.agentDir, "nested"), { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(outside, "SKILL.md"), "outside body\n");
	await writeFile(join(fixture.agentDir, "settings.json"), "{}\n");
	await symlink(outside, join(fixture.agentDir, "skills"));
	await symlink("../settings.json", join(fixture.agentDir, "nested", "link.json"));
	await symlink(join(fixture.agentDir, "gone"), join(fixture.agentDir, "dangling"));

	const result = await fixture.run();
	const backup = result.destination as string;
	// The links stayed links, and the data behind them was never copied.
	expect((await lstat(join(backup, "skills"))).isSymbolicLink()).toBe(true);
	expect(await readdir(join(backup, "skills"))).toEqual(["SKILL.md"]);
	expect(await exists(join(backup, "..", "outside"))).toBe(false);
	expect(result.byteSize).toBe(3);
	expect(result.fileCount).toBe(1);
	expect(result.links.map((link) => link.path).sort()).toEqual(["dangling", "nested/link.json", "skills"]);
	const skills = result.links.find((link) => link.path === "skills");
	expect(skills?.target).toBe(outside);
	expect(skills?.resolved).toBe(await realpath(outside));
	const dangling = result.links.find((link) => link.path === "dangling");
	expect(dangling?.resolved).toBeUndefined();
	expect(fixture.out.join("\n")).toContain("skills -> ");
	expect(fixture.out.join("\n")).toContain(outside);
	expect(fixture.out.join("\n")).toContain("target does not exist");
});

test("preserves permission bits of files and directories", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(join(fixture.agentDir, "private"), { recursive: true });
	await chmod(join(fixture.agentDir, "private"), 0o700);
	await mkdir(join(fixture.agentDir, "public"), { recursive: true });
	await chmod(join(fixture.agentDir, "public"), 0o755);
	await writeFile(join(fixture.agentDir, "auth.json"), "secret\n");
	await chmod(join(fixture.agentDir, "auth.json"), 0o600);
	await writeFile(join(fixture.agentDir, "readable.txt"), "open\n");
	await chmod(join(fixture.agentDir, "readable.txt"), 0o644);

	const result = await fixture.run();
	const backup = result.destination as string;
	expect((await lstat(join(backup, "private"))).mode & 0o777).toBe(0o700);
	expect((await lstat(join(backup, "public"))).mode & 0o777).toBe(0o755);
	expect((await lstat(join(backup, "auth.json"))).mode & 0o777).toBe(0o600);
	expect((await lstat(join(backup, "readable.txt"))).mode & 0o777).toBe(0o644);
});

test("reports an absent agent directory without creating a backup", async () => {
	const fixture = await makeBackupFixture();
	const result = await fixture.run();
	expect(result.reason).toBe("missing-agent-dir");
	expect(result.destination).toBeUndefined();
	expect(fixture.out.join("\n")).toContain("No agent directory to back up yet");
	await expect(fixture.backups()).resolves.toEqual([]);
	expect(JSON.parse(await readFile(fixture.statePath, "utf8"))).toMatchObject({ reason: "missing-agent-dir" });

	// The record is what keeps the next launch from copying, so an agent dir created later is not
	// backed up either: one record, one handling.
	await mkdir(fixture.agentDir, { recursive: true });
	expect((await fixture.run()).reason).toBe("already-recorded");
	await expect(fixture.backups()).resolves.toEqual([]);
});

test("an unreadable entry fails the copy and leaves nothing behind", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(join(fixture.agentDir, "locked"), { recursive: true });
	await writeFile(join(fixture.agentDir, "settings.json"), "{}\n");
	await chmod(join(fixture.agentDir, "locked"), 0);
	try {
		await expect(fixture.run()).rejects.toThrow(new RegExp(`Could not read the directory ${fixture.agentDir}/locked`));
		// No record and no half-copied directory: the next launch retries the whole copy.
		expect(await exists(fixture.statePath)).toBe(false);
		await expect(fixture.backups()).resolves.toEqual([]);
	} finally {
		await chmod(join(fixture.agentDir, "locked"), 0o700);
	}
});

test("replaces a copy that an earlier run left half done", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(fixture.agentDir, { recursive: true });
	await writeFile(join(fixture.agentDir, "settings.json"), "{}\n");
	const stale = join(fixture.backupsDir, `${AGENT_BACKUP_DIR_PREFIX}2026-11-10T09-12-33Z${AGENT_BACKUP_TEMP_SUFFIX}4242`);
	await mkdir(stale, { recursive: true });
	await writeFile(join(stale, "orphan.txt"), "left over\n");

	const result = await fixture.run();
	expect(result.reason).toBe("backed-up");
	expect(await fixture.backups()).toEqual([`${AGENT_BACKUP_DIR_PREFIX}2026-11-10T09-12-33Z`]);
	expect(await exists(join(result.destination as string, "orphan.txt"))).toBe(false);
});

test("refuses to run on a record it cannot read", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(fixture.agentDir, { recursive: true });
	await writeFile(join(fixture.agentDir, "settings.json"), "{}\n");
	await mkdir(join(fixture.statePath, ".."), { recursive: true });
	await writeFile(fixture.statePath, "not json\n");
	await expect(fixture.run()).rejects.toThrow(/not valid JSON/);
	await expect(fixture.backups()).resolves.toEqual([]);

	await writeFile(fixture.statePath, JSON.stringify({ schemaVersion: 2, reason: "backed-up" }));
	await expect(fixture.run()).rejects.toThrow(/unknown schemaVersion/);
	await expect(fixture.backups()).resolves.toEqual([]);
});

test("reports special entries instead of copying them", async () => {
	const fixture = await makeBackupFixture();
	await mkdir(fixture.agentDir, { recursive: true });
	await writeFile(join(fixture.agentDir, "settings.json"), "{}\n");
	const fifo = join(fixture.agentDir, "pipe");
	const made = Bun.spawnSync({ cmd: ["mkfifo", fifo] });
	if (made.exitCode !== 0) throw new Error("mkfifo is unavailable");

	const result = await fixture.run();
	expect(result.skipped).toEqual(["pipe"]);
	expect(result.fileCount).toBe(1);
	expect(fixture.out.join("\n")).toContain("Skipped 1 special entries: pipe");
	expect(await exists(join(result.destination as string, "pipe"))).toBe(false);
});
