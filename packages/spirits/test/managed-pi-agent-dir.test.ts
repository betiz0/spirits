import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertManagedLaunchArgs,
	ensureManagedAgentDir,
	ManagedAgentGuardError,
	resolveManagedAgentPaths,
} from "../src/managed-pi/agent-dir.ts";

interface Workspace {
	work: string;
	home: string;
	root: string;
	agentDir: string;
	existingAgentDir: string;
}

const created: Workspace[] = [];

afterEach(async () => {
	for (const workspace of created.splice(0)) {
		await rm(workspace.work, { recursive: true, force: true });
	}
});

/** A temporary home with a managed root, and no agent dir created yet. */
async function workspace(options: { makeExisting?: boolean; makeRoot?: boolean } = {}): Promise<Workspace> {
	const work = await mkdtemp(join(tmpdir(), "spirits-managed-agent-dir-"));
	const home = join(work, "home");
	const root = join(home, ".spirits", "managed-pi");
	const existingAgentDir = join(home, ".spirits", "agent");
	await mkdir(home, { recursive: true });
	if (options.makeRoot !== false) await mkdir(root, { recursive: true });
	if (options.makeExisting) await mkdir(existingAgentDir, { recursive: true });
	const value: Workspace = { work, home, root, agentDir: join(root, "agent"), existingAgentDir };
	created.push(value);
	return value;
}

function resolve(value: Workspace, env: Record<string, string | undefined> = {}) {
	return resolveManagedAgentPaths({ home: value.home, root: value.root, env });
}

async function expectRejection(promise: Promise<unknown>): Promise<ManagedAgentGuardError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(ManagedAgentGuardError);
		return error as ManagedAgentGuardError;
	}
	throw new Error("expected the managed agent dir to be rejected");
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

test("uses the managed agent directory by default", async () => {
	const value = await workspace();
	const paths = await resolve(value);
	expect(paths.agentDir).toBe(join(value.root, "agent"));
	expect(paths.sessionDir).toBe(join(value.root, "agent", "sessions"));
	expect(await exists(paths.agentDir)).toBe(false);
});

test("rejects a path that resolves to the existing agent dir", async () => {
	const value = await workspace({ makeExisting: true });
	// The managed root is the existing agent dir's parent, so `<root>/agent` is the existing dir.
	const error = await expectRejection(
		resolveManagedAgentPaths({ home: value.home, root: join(value.home, ".spirits"), env: {} }),
	);
	expect(error.rejection).toBe("existing agent directory containment");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejects a symlinked managed agent directory", async () => {
	const value = await workspace();
	await mkdir(join(value.root, "elsewhere"), { recursive: true });
	await symlink(join(value.root, "elsewhere"), value.agentDir);
	const error = await expectRejection(resolve(value));
	expect(error.rejection).toBe("symlink in the managed agent path");
	expect(await exists(join(value.root, "elsewhere", "untouched"))).toBe(false);
});

test("rejects a non-directory managed agent path", async () => {
	const value = await workspace();
	await writeFile(value.agentDir, "not a directory\n");
	const error = await expectRejection(resolve(value));
	expect(error.rejection).toBe("not a directory");
});

test("rejects a path outside the managed root", async () => {
	const value = await workspace();
	const outside = join(value.work, "outside");
	await mkdir(outside, { recursive: true });
	await symlink(outside, value.agentDir);
	const error = await expectRejection(resolve(value));
	expect(error.rejection).toBe("outside the managed root");
	expect(await exists(join(outside, "agent"))).toBe(false);
});

test("creates the managed agent directory with owner-only permissions", async () => {
	const value = await workspace();
	const paths = await resolve(value);
	await ensureManagedAgentDir(paths);
	expect((await lstat(paths.agentDir)).mode & 0o777).toBe(0o700);
	// A second pass keeps the directory and its contents.
	await writeFile(join(paths.agentDir, "settings.json"), "{}\n");
	await ensureManagedAgentDir(paths);
	expect(await Bun.file(join(paths.agentDir, "settings.json")).exists()).toBe(true);
});

test("rejection message names the reason and the managed agent directory", async () => {
	const value = await workspace();
	await writeFile(value.agentDir, "not a directory\n");
	const error = await expectRejection(resolve(value));
	const message = error.message;
	expect(message).toContain("not a directory");
	expect(message).toContain(value.agentDir);
	expect(message).toContain(value.existingAgentDir);
	expect(message).toContain("was not changed");
	expect(message).toContain("Safe start");
	expect(message).toContain("no fallback");
	expect((await lstat(value.agentDir)).isFile()).toBe(true);
});

test("accepts the exact managed agent directory", async () => {
	const value = await workspace();
	const paths = await resolve(value);
	await ensureManagedAgentDir(paths);
	const accepted = await resolve(value, { SPIRITS_CODING_AGENT_DIR: paths.agentDir });
	expect(accepted.agentDir).toBe(paths.agentDir);
});

test("rejects a different explicit agent directory", async () => {
	const value = await workspace();
	const error = await expectRejection(
		resolve(value, { SPIRITS_CODING_AGENT_DIR: join(value.root, "other-agent") }),
	);
	expect(error.rejection).toBe("explicit agent directory is not the managed agent directory");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejects a relative or tilde agent directory", async () => {
	const value = await workspace();
	const relative = await expectRejection(resolve(value, { SPIRITS_CODING_AGENT_DIR: "agent" }));
	expect(relative.rejection).toBe("explicit agent directory is not the managed agent directory");
	const tilde = await expectRejection(resolve(value, { SPIRITS_CODING_AGENT_DIR: "~/.spirits/agent" }));
	expect(tilde.rejection).toBe("explicit agent directory is not the managed agent directory");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejects an explicit directory outside the managed root", async () => {
	const value = await workspace();
	await mkdir(join(value.home, "somewhere"), { recursive: true });
	const error = await expectRejection(
		resolve(value, { SPIRITS_CODING_AGENT_DIR: join(value.home, "somewhere") }),
	);
	expect(error.rejection).toBe("explicit agent directory is not the managed agent directory");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejects an empty explicit agent directory", async () => {
	const value = await workspace();
	const error = await expectRejection(resolve(value, { SPIRITS_CODING_AGENT_DIR: "" }));
	expect(error.rejection).toBe("explicit agent directory is not the managed agent directory");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejection message names the rejected value and the safe start", async () => {
	const value = await workspace();
	const rejected = join(value.root, "other-agent");
	const error = await expectRejection(resolve(value, { SPIRITS_CODING_AGENT_DIR: rejected }));
	expect(error.message).toContain(rejected);
	expect(error.message).toContain(value.agentDir);
	expect(error.message).toContain("Safe start");
	expect(error.message).toContain("no fallback");
	expect(await exists(value.agentDir)).toBe(false);
});

test("rejects path-bearing session arguments", () => {
	const value = {
		root: "/managed",
		agentDir: "/managed/agent",
		sessionDir: "/managed/agent/sessions",
		existingAgentDir: "/home/.spirits/agent",
	};
	for (const args of [
		["--session", "abc"],
		["--fork=xyz"],
		["--session-dir", "/home/.spirits/agent/sessions"],
		["--export", "/tmp/session.jsonl"],
	]) {
		expect(() => assertManagedLaunchArgs(args, value)).toThrow(ManagedAgentGuardError);
	}
});

test("allows session arguments bounded by the managed session dir", () => {
	const value = {
		root: "/managed",
		agentDir: "/managed/agent",
		sessionDir: "/managed/agent/sessions",
		existingAgentDir: "/home/.spirits/agent",
	};
	for (const args of [
		["--continue"],
		["--resume"],
		["--session-id", "abc"],
		["--no-session"],
		["--model", "anthropic/claude"],
	]) {
		expect(() => assertManagedLaunchArgs(args, value)).not.toThrow();
	}
});

test("argument rejection message names the option and the safe start", () => {
	const value = {
		root: "/managed",
		agentDir: "/managed/agent",
		sessionDir: "/managed/agent/sessions",
		existingAgentDir: "/home/.spirits/agent",
	};
	let error: unknown;
	try {
		assertManagedLaunchArgs(["--session-dir", "/home/.spirits/agent/sessions"], value);
	} catch (thrown) {
		error = thrown;
	}
	const message = (error as Error).message;
	expect(message).toContain("--session-dir");
	expect(message).toContain("unsupported managed-pi argument");
	expect(message).toContain("Safe alternative");
	expect(message).toContain("Safe start");
	expect(message).toContain("/managed/agent");
});
