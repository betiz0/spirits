import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runSelfUpdate,
	type ExtensionUpdateRequest,
	type RunUpdateOptions,
	type SpawnExtensionUpdate,
	type UpdateIo,
} from "../src/update/run.ts";

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
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-routing-"));
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
}

function startFixture(options: { latestVersion: string; artifactStatus?: number }): Fixture {
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path.endsWith("/releases")) {
				return Response.json([
					{ tag_name: `spirits-v${options.latestVersion}`, draft: false, prerelease: false },
				]);
			}
			if (path.endsWith(".sha256")) {
				return new Response(`${sha256Hex(BINARY_CONTENT)}  spirits-linux-x64\n`);
			}
			if (options.artifactStatus) {
				return new Response("missing", { status: options.artifactStatus });
			}
			return new Response(BINARY_CONTENT);
		},
	});
	runningServers.push(server);
	return { baseUrl: `http://127.0.0.1:${server.port}` };
}

interface SpawnCall {
	command: string[];
	cwd: string;
	targetContent: string | undefined;
}

function makeSpawn(exitCode: number): { calls: SpawnCall[]; spawn: SpawnExtensionUpdate } {
	const calls: SpawnCall[] = [];
	const spawn: SpawnExtensionUpdate = async (request: ExtensionUpdateRequest) => {
		let targetContent: string | undefined;
		try {
			targetContent = await Bun.file(request.command[0]).text();
		} catch {
			targetContent = undefined;
		}
		calls.push({ command: request.command, cwd: request.cwd, targetContent });
		return exitCode;
	};
	return { calls, spawn };
}

async function setupInstalled(version: string): Promise<{ installDir: string; execPath: string }> {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, `installed ${version}`);
	return { installDir, execPath };
}

const silentIo: UpdateIo = { out: () => {}, err: () => {} };

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
		io: silentIo,
		...overrides,
	};
}

test("runs the extension update after the replacement", async () => {
	const fixture = startFixture({ latestVersion: "0.3.0" });
	const { execPath } = await setupInstalled("0.2.0");
	const { calls, spawn } = makeSpawn(0);
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.2.0", { kind: "all", spawnExtensionUpdate: spawn }),
	);
	expect(result).toEqual({ exitCode: 0, replaced: true });
	expect(calls).toHaveLength(1);
	expect(calls[0]?.command).toEqual([execPath, "update", "--extensions"]);
	expect(calls[0]?.cwd).toBe(process.cwd());
	expect(calls[0]?.targetContent).toBe(BINARY_CONTENT);
});

test("propagates the extension update exit code", async () => {
	const fixture = startFixture({ latestVersion: "0.3.0" });
	const { execPath } = await setupInstalled("0.2.0");
	const { calls, spawn } = makeSpawn(9);
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.2.0", { kind: "all", spawnExtensionUpdate: spawn }),
	);
	expect(result.exitCode).toBe(9);
	expect(calls).toHaveLength(1);
});

for (const trustFlag of ["-a", "--no-approve"]) {
	test(`forwards ${trustFlag} to the extension update`, async () => {
		const fixture = startFixture({ latestVersion: "0.3.0" });
		const { execPath } = await setupInstalled("0.2.0");
		const { calls, spawn } = makeSpawn(0);
		await runSelfUpdate(
			makeOptions(fixture, execPath, "0.2.0", {
				kind: "all",
				trustFlag,
				spawnExtensionUpdate: spawn,
			}),
		);
		expect(calls[0]?.command).toEqual([execPath, "update", "--extensions", trustFlag]);
	});
}

test("runs the extension update when the binary is already latest", async () => {
	const fixture = startFixture({ latestVersion: "0.3.0" });
	const { execPath } = await setupInstalled("0.3.0");
	const { calls, spawn } = makeSpawn(4);
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.3.0", { kind: "all", spawnExtensionUpdate: spawn }),
	);
	expect(result).toEqual({ exitCode: 4, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(calls).toHaveLength(1);
	expect(calls[0]?.targetContent).toBe("installed 0.3.0");
});

test("does not run the extension update when the self-update fails", async () => {
	const fixture = startFixture({ latestVersion: "0.3.0", artifactStatus: 500 });
	const { execPath } = await setupInstalled("0.2.0");
	const { calls, spawn } = makeSpawn(0);
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.2.0", { kind: "all", spawnExtensionUpdate: spawn }),
	);
	expect(result.exitCode).toBe(1);
	expect(calls).toHaveLength(0);
});

test("never runs the extension update for the self target", async () => {
	const fixture = startFixture({ latestVersion: "0.3.0" });
	const { execPath } = await setupInstalled("0.2.0");
	const { calls, spawn } = makeSpawn(0);
	await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { spawnExtensionUpdate: spawn }));
	expect(calls).toHaveLength(0);
});
