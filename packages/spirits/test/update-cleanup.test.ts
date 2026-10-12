import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanStaleTempDirs, isProcessAlive, parseTempDirPid } from "../src/update/cleanup.ts";
import { runSelfUpdate, type RunUpdateOptions, type UpdateIo } from "../src/update/run.ts";

const CHILD_SCRIPT = join(import.meta.dir, "fixtures", "update-cleanup-child.ts");
const runningServers: Array<ReturnType<typeof Bun.serve>> = [];
const workDirs: string[] = [];

afterAll(async () => {
	for (const server of runningServers) {
		server.stop(true);
	}
	for (const dir of workDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function makeWorkDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-cleanup-"));
	workDirs.push(dir);
	return dir;
}

async function waitFor(condition: () => boolean, description: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (condition()) return;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

test("parses temp directory PIDs", () => {
	expect(parseTempDirPid(".spirits-tmp-1234")).toBe(1234);
	expect(parseTempDirPid(".spirits-tmp-0")).toBeUndefined();
	expect(parseTempDirPid(".spirits-tmp-abc")).toBeUndefined();
	expect(parseTempDirPid("spirits")).toBeUndefined();
});

test("removes leftovers of exited processes", async () => {
	const work = await makeWorkDir();
	const finished = Bun.spawn(["true"]);
	const finishedPid = finished.pid;
	await finished.exited;
	await waitFor(() => !isProcessAlive(finishedPid), "the helper process to exit");
	const leftover = join(work, `.spirits-tmp-${finishedPid}`);
	await mkdir(leftover);
	await cleanStaleTempDirs(work);
	expect(existsSync(leftover)).toBe(false);
});

test("keeps temp directories of running processes", async () => {
	const work = await makeWorkDir();
	const running = Bun.spawn(["sleep", "30"]);
	try {
		await waitFor(() => isProcessAlive(running.pid), "the helper process to start");
		const guarded = join(work, `.spirits-tmp-${running.pid}`);
		await mkdir(guarded);
		await cleanStaleTempDirs(work);
		expect(existsSync(guarded)).toBe(true);
	} finally {
		running.kill("SIGKILL");
		await running.exited;
	}
});

/** Stable release fixture for the `runSelfUpdate` cleanup paths. */
function startReleaseFixture(): { baseUrl: string; requests: string[]; stop(): void } {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith("/releases")) {
				return Response.json([{ tag_name: "spirits-v0.3.0", draft: false, prerelease: false }]);
			}
			return new Response("unexpected request", { status: 404 });
		},
	});
	runningServers.push(server);
	return {
		baseUrl: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}

interface Captured {
	io: UpdateIo;
	out: string[];
	err: string[];
}

function makeIo(): Captured {
	const out: string[] = [];
	const err: string[] = [];
	return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

/** Options for an installed binary that already matches the fixture's latest stable release. */
function makeNoOpOptions(baseUrl: string, execPath: string, io: UpdateIo): RunUpdateOptions {
	return {
		kind: "self",
		force: false,
		env: { SPIRITS_API_BASE_URL: baseUrl, SPIRITS_RELEASE_BASE_URL: baseUrl },
		fetch,
		installedVersion: "0.3.0",
		execPath,
		compiled: true,
		platform: "linux",
		arch: "x64",
		io,
	};
}

test("removes stale temp directories on the up-to-date path", async () => {
	const fixture = startReleaseFixture();
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, "installed binary");
	const finished = Bun.spawn(["true"]);
	const finishedPid = finished.pid;
	await finished.exited;
	await waitFor(() => !isProcessAlive(finishedPid), "the helper process to exit");
	const leftover = join(installDir, `.spirits-tmp-${finishedPid}`);
	await mkdir(leftover);
	const captured = makeIo();
	try {
		const result = await runSelfUpdate(makeNoOpOptions(fixture.baseUrl, execPath, captured.io));
		expect(result).toEqual({ exitCode: 0, replaced: false });
		expect(captured.out.join("\n")).toContain("already up to date");
		expect(existsSync(leftover)).toBe(false);
		expect(await readFile(execPath, "utf8")).toBe("installed binary");
	} finally {
		fixture.stop();
	}
});

test("keeps running processes' temp directories on the up-to-date path", async () => {
	const fixture = startReleaseFixture();
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, "installed binary");
	const running = Bun.spawn(["sleep", "30"]);
	try {
		await waitFor(() => isProcessAlive(running.pid), "the helper process to start");
		const guarded = join(installDir, `.spirits-tmp-${running.pid}`);
		await mkdir(guarded);
		const captured = makeIo();
		const result = await runSelfUpdate(makeNoOpOptions(fixture.baseUrl, execPath, captured.io));
		expect(result).toEqual({ exitCode: 0, replaced: false });
		expect(captured.out.join("\n")).toContain("already up to date");
		expect(existsSync(guarded)).toBe(true);
	} finally {
		running.kill("SIGKILL");
		await running.exited;
		fixture.stop();
	}
});

async function runSignalCase(signal: "SIGINT" | "SIGTERM"): Promise<void> {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const targetPath = join(installDir, "spirits");
	await writeFile(targetPath, "original binary");
	await chmod(targetPath, 0o755);

	let binaryRequests = 0;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname.endsWith(".sha256")) {
				return new Response(`${"0".repeat(64)}  spirits-linux-x64\n`);
			}
			binaryRequests += 1;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("start"));
				},
			});
			return new Response(stream);
		},
	});
	runningServers.push(server);
	const baseUrl = `http://127.0.0.1:${server.port}`;

	const child = Bun.spawn([
		"bun",
		CHILD_SCRIPT,
		installDir,
		`${baseUrl}/spirits-linux-x64`,
		`${baseUrl}/spirits-linux-x64.sha256`,
	]);
	const tempDir = join(installDir, `.spirits-tmp-${child.pid}`);
	try {
		await waitFor(() => existsSync(tempDir) && binaryRequests > 0, "the child to start downloading");
		child.kill(signal);
		const exitCode = await child.exited;
		expect(exitCode).toBe(signal === "SIGINT" ? 130 : 143);
		expect(await readFile(targetPath, "utf8")).toBe("original binary");
		expect(existsSync(tempDir)).toBe(false);
	} finally {
		child.kill("SIGKILL");
		await child.exited;
		server.stop(true);
	}
}

test("SIGINT during a download removes the temp directory", async () => {
	await runSignalCase("SIGINT");
});

test("SIGTERM during a download removes the temp directory", async () => {
	await runSignalCase("SIGTERM");
});
