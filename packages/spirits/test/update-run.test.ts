import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelfUpdate, type RunUpdateOptions, type UpdateIo } from "../src/update/run.ts";

const BINARY_CONTENT = "downloaded spirits binary";

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
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-run-"));
	workDirs.push(dir);
	return dir;
}

function sha256Hex(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

interface Fixture {
	baseUrl: string;
	requests: string[];
}

function startFixture(latestVersion: string): Fixture {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith("/releases")) {
				return Response.json([{ tag_name: `spirits-v${latestVersion}`, draft: false, prerelease: false }]);
			}
			if (path.endsWith(".sha256")) {
				return new Response(`${sha256Hex(BINARY_CONTENT)}  spirits-linux-x64\n`);
			}
			return new Response(BINARY_CONTENT);
		},
	});
	runningServers.push(server);
	return { baseUrl: `http://127.0.0.1:${server.port}`, requests };
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

async function setupInstalled(version: string): Promise<{ installDir: string; execPath: string }> {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, `installed ${version}`);
	return { installDir, execPath };
}

function makeOptions(
	fixture: Fixture,
	execPath: string,
	installedVersion: string,
	overrides: Partial<RunUpdateOptions> = {},
): RunUpdateOptions {
	return {
		kind: "self",
		force: false,
		env: {
			SPIRITS_API_BASE_URL: fixture.baseUrl,
			SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
		},
		fetch,
		installedVersion,
		execPath,
		compiled: true,
		platform: "linux",
		arch: "x64",
		...overrides,
	};
}

test("replaces an older binary and reports the version transition", async () => {
	const fixture = startFixture("0.3.0");
	const { installDir, execPath } = await setupInstalled("0.2.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: true });
	expect(await Bun.file(execPath).text()).toBe(BINARY_CONTENT);
	expect(captured.out.join("\n")).toContain("Updated spirits from 0.2.0 to 0.3.0");
	expect((await readdir(installDir)).filter((entry) => entry.startsWith(".spirits-tmp-"))).toEqual([]);
});

test("does not download when the installed version is already latest", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.3.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(captured.out.join("\n")).toContain("spirits 0.3.0 is already up to date");
	expect(fixture.requests.every((path) => path.endsWith("/releases"))).toBe(true);
});

test("replaces an equal version when --force is given", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.3.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { force: true, io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: true });
	expect(await Bun.file(execPath).text()).toBe(BINARY_CONTENT);
	expect(fixture.requests.some((path) => path.endsWith("spirits-linux-x64"))).toBe(true);
});

test("does not replace a prerelease newer than the latest stable", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.4.0-rc.1");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.4.0-rc.1", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.4.0-rc.1");
	expect(captured.out.join("\n")).toContain("newer than the latest stable release");
});

test("replaces a newer prerelease with --force", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.4.0-rc.1");
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.4.0-rc.1", { force: true, io: captured.io }),
	);
	expect(result).toEqual({ exitCode: 0, replaced: true });
	expect(await Bun.file(execPath).text()).toBe(BINARY_CONTENT);
	expect(captured.out.join("\n")).toContain("Updated spirits from 0.4.0-rc.1 to 0.3.0");
});

test("removes the signal handlers after the update", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.2.0");
	const before = { sigint: process.listenerCount("SIGINT"), sigterm: process.listenerCount("SIGTERM") };
	await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: makeIo().io }));
	expect(process.listenerCount("SIGINT")).toBe(before.sigint);
	expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
});
