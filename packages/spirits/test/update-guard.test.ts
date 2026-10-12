import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_COMMAND, UPDATE_TEMP_DIR_PREFIX } from "../src/constants.ts";
import { runSelfUpdate, type RunUpdateOptions, type UpdateIo } from "../src/update/run.ts";

const RELEASE_PAYLOAD = [
	{ tag_name: "spirits-v0.3.0", draft: false, prerelease: false },
	{ tag_name: "spirits-v0.2.0", draft: false, prerelease: false },
];

const BINARY_CONTENT = "new binary";

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
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-guard-"));
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
	stop(): void;
}

interface FixtureOptions {
	releasesStatus?: number;
	artifactStatus?: number;
	stallArtifact?: boolean;
}

function startFixture(options: FixtureOptions = {}): Fixture {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith("/releases")) {
				if (options.releasesStatus) {
					return new Response("error", { status: options.releasesStatus });
				}
				return Response.json(RELEASE_PAYLOAD);
			}
			if (path.endsWith(".sha256")) {
				return new Response(`${sha256Hex(BINARY_CONTENT)}  spirits-linux-x64\n`);
			}
			if (options.artifactStatus) {
				return new Response("missing", { status: options.artifactStatus });
			}
			if (options.stallArtifact) {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("start"));
					},
				});
				return new Response(stream);
			}
			return new Response(BINARY_CONTENT);
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

function makeOptions(fixture: Fixture, execPath: string, overrides: Partial<RunUpdateOptions> = {}): RunUpdateOptions {
	return {
		kind: "self",
		force: false,
		env: {
			SPIRITS_API_BASE_URL: fixture.baseUrl,
			SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
		},
		fetch,
		installedVersion: "0.2.0",
		execPath,
		compiled: true,
		platform: "linux",
		arch: "x64",
		...overrides,
	};
}

function expectInstallerGuidance(haystack: string[]): void {
	const joined = haystack.join("\n");
	expect(joined).toContain("install.sh");
	expect(joined).toContain(INSTALL_COMMAND);
}

test("refuses to update an uncompiled run", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, join(work, "spirits"), { compiled: false, io: captured.io }),
	);
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(captured.err.join("\n")).toContain("source");
	expectInstallerGuidance(captured.err);
	expect(fixture.requests).toEqual([]);
	fixture.stop();
});

test("refuses an unsupported platform or architecture", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, join(work, "spirits"), { platform: "darwin", io: captured.io }),
	);
	expect(result.exitCode).toBe(1);
	expect(captured.err.join("\n")).toContain("linux/x64");
	expectInstallerGuidance(captured.err);
	expect(fixture.requests).toEqual([]);
	fixture.stop();
});

test("refuses an unsupported architecture", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, join(work, "spirits"), { arch: "arm64", io: captured.io }),
	);
	expect(result.exitCode).toBe(1);
	expect(captured.err.join("\n")).toContain("linux/x64");
	expectInstallerGuidance(captured.err);
	expect(fixture.requests).toEqual([]);
	fixture.stop();
});

test("refuses a non-writable install directory", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	await chmod(installDir, 0o555);
	const captured = makeIo();
	try {
		const result = await runSelfUpdate(makeOptions(fixture, join(installDir, "spirits"), { io: captured.io }));
		expect(result.exitCode).toBe(1);
		expect(captured.err.join("\n")).toContain("not writable");
		expectInstallerGuidance(captured.err);
		expect(fixture.requests).toEqual([]);
	} finally {
		await chmod(installDir, 0o755);
		fixture.stop();
	}
});

test("refuses a non-writable install directory even when the installed version is latest", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	await chmod(installDir, 0o555);
	const captured = makeIo();
	try {
		const result = await runSelfUpdate(
			makeOptions(fixture, join(installDir, "spirits"), { installedVersion: "0.3.0", io: captured.io }),
		);
		expect(result).toEqual({ exitCode: 1, replaced: false });
		expect(captured.err.join("\n")).toContain("not writable");
		expectInstallerGuidance(captured.err);
		expect(fixture.requests).toEqual([]);
	} finally {
		await chmod(installDir, 0o755);
		fixture.stop();
	}
});

test("refuses when the temporary directory cannot be created", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, "original binary");
	// The pre-check passes, but the PID-named temp path is occupied by a file, so the authoritative
	// check (creating the real temp directory) fails.
	await writeFile(join(installDir, `${UPDATE_TEMP_DIR_PREFIX}${process.pid}`), "occupied");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(captured.err.join("\n")).toContain("Could not create the temporary directory");
	expectInstallerGuidance(captured.err);
	expect(await Bun.file(execPath).text()).toBe("original binary");
	fixture.stop();
});

for (const offlineValue of ["1", "TRUE", "yes"]) {
	test(`refuses PI_OFFLINE=${offlineValue} without any request`, async () => {
		const fixture = startFixture();
		const work = await makeWorkDir();
		const captured = makeIo();
		const result = await runSelfUpdate(
			makeOptions(fixture, join(work, "spirits"), {
				env: {
					SPIRITS_API_BASE_URL: fixture.baseUrl,
					SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
					PI_OFFLINE: offlineValue,
				},
				io: captured.io,
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(captured.err.join("\n")).toContain("PI_OFFLINE");
		expect(captured.err.join("\n")).toContain("Unset PI_OFFLINE");
		expect(fixture.requests).toEqual([]);
		fixture.stop();
	});
}

test("does not refuse PI_OFFLINE=0", async () => {
	const fixture = startFixture();
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, join(work, "spirits"), {
			env: {
				SPIRITS_API_BASE_URL: fixture.baseUrl,
				SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
				PI_OFFLINE: "0",
			},
			io: captured.io,
		}),
	);
	expect(result.exitCode).toBe(0);
	expect(captured.out.join("\n")).toContain("Updated spirits from 0.2.0 to 0.3.0");
	expect(fixture.requests.length).toBeGreaterThan(0);
	fixture.stop();
});

test("reports a release resolution failure with installer guidance", async () => {
	const fixture = startFixture({ releasesStatus: 500 });
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, join(work, "spirits"), { io: captured.io }));
	expect(result.exitCode).toBe(1);
	expect(captured.err.join("\n")).toContain("Could not resolve");
	expectInstallerGuidance(captured.err);
	fixture.stop();
});

test("reports a download failure with installer guidance", async () => {
	const fixture = startFixture({ artifactStatus: 404 });
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, join(work, "spirits"), { io: captured.io }));
	expect(result.exitCode).toBe(1);
	expect(captured.err.join("\n")).toContain("HTTP 404");
	expectInstallerGuidance(captured.err);
	fixture.stop();
});

test("reports an idle timeout with installer guidance", async () => {
	const fixture = startFixture({ stallArtifact: true });
	const work = await makeWorkDir();
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, join(work, "spirits"), {
			env: {
				SPIRITS_API_BASE_URL: fixture.baseUrl,
				SPIRITS_RELEASE_BASE_URL: fixture.baseUrl,
				SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS: "1",
			},
			io: captured.io,
		}),
	);
	expect(result.exitCode).toBe(1);
	expect(captured.err.join("\n")).toContain("timed out");
	expectInstallerGuidance(captured.err);
	fixture.stop();
});

test("keeps the installed binary untouched on failure", async () => {
	const fixture = startFixture({ artifactStatus: 404 });
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, "original binary");
	await chmod(execPath, 0o755);
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, { io: captured.io }));
	expect(result.exitCode).toBe(1);
	expect(await Bun.file(execPath).text()).toBe("original binary");
	const entries = (await readdir(installDir)).filter((entry) => entry.startsWith(".spirits-tmp-"));
	expect(entries).toEqual([]);
	fixture.stop();
});
