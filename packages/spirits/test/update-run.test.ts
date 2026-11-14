import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelfUpdate, type RunUpdateOptions, type UpdateIo } from "../src/update/run.ts";

const BINARY_CONTENT = "downloaded spirits binary";

/** The assets an older updater fetched. A release still attaches them; this updater never asks. */
const COMPAT_ASSETS: Record<string, string> = {
	"dark.json": '{"name":"dark","source":"release"}',
	"light.json": '{"name":"light","source":"release"}',
};

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

interface FixtureOptions {
	/** Serve a checksum that does not match the executable. */
	corruptBinaryChecksum?: boolean;
}

function startFixture(latestVersion: string, options: FixtureOptions = {}): Fixture {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith("/releases")) {
				return Response.json([{ tag_name: `spirits-v${latestVersion}`, draft: false, prerelease: false }]);
			}
			if (path.endsWith("/spirits-linux-x64.sha256")) {
				const hash = options.corruptBinaryChecksum === true ? "0".repeat(64) : sha256Hex(BINARY_CONTENT);
				return new Response(`${hash}  spirits-linux-x64\n`);
			}
			if (path.endsWith("/spirits-linux-x64")) {
				return new Response(BINARY_CONTENT);
			}
			for (const [name, content] of Object.entries(COMPAT_ASSETS)) {
				if (path.endsWith(`/${name}.sha256`)) return new Response(`${sha256Hex(content)}  ${name}\n`);
				if (path.endsWith(`/${name}`)) return new Response(content);
			}
			return new Response("not found", { status: 404 });
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

interface InstalledPaths {
	installDir: string;
	execPath: string;
	/** The directory a pre-managed release placed next to the executable. */
	themeDir: string;
}

/** Install a placeholder binary, plus the asset directory an older release left behind. */
async function setupInstalled(version: string): Promise<InstalledPaths> {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, `installed ${version}`);
	const themeDir = join(installDir, "theme");
	await mkdir(themeDir);
	for (const name of Object.keys(COMPAT_ASSETS)) {
		await writeFile(join(themeDir, name), "installed asset");
	}
	return { installDir, execPath, themeDir };
}

function makeOptions(
	fixture: Fixture,
	execPath: string,
	installedVersion: string,
	overrides: Partial<RunUpdateOptions> = {},
): RunUpdateOptions {
	return {
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

/** Requests other than the release listing, the executable, and its checksum. */
function otherRequests(fixture: Fixture): string[] {
	return fixture.requests.filter(
		(path) =>
			!path.endsWith("/releases") &&
			!path.endsWith("/spirits-linux-x64") &&
			!path.endsWith("/spirits-linux-x64.sha256"),
	);
}

test("replaces an older binary and reports the version transition", async () => {
	const fixture = startFixture("0.3.0");
	const { installDir, execPath } = await setupInstalled("0.2.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: true, releaseTag: "spirits-v0.3.0" });
	expect(await Bun.file(execPath).text()).toBe(BINARY_CONTENT);
	expect(captured.out.join("\n")).toContain("Updated spirits from 0.2.0 to 0.3.0");
	expect((await readdir(installDir)).filter((entry) => entry.startsWith(".spirits-tmp-"))).toEqual([]);
});

test("does not fetch the theme assets a release still attaches", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath, themeDir } = await setupInstalled("0.2.0");
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: makeIo().io }));
	expect(result.exitCode).toBe(0);
	expect(otherRequests(fixture)).toEqual([]);
	for (const name of Object.keys(COMPAT_ASSETS)) {
		expect(await Bun.file(join(themeDir, name)).text()).toBe("installed asset");
	}
});

test("fetches nothing but the release listing when up to date", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.3.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: false, releaseTag: "spirits-v0.3.0" });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(captured.out.join("\n")).toContain("spirits 0.3.0 is already up to date");
	expect(fixture.requests).toEqual(["/repos/betiz0/spirits/releases"]);
});

test("replaces an equal version when --force is given", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.3.0");
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.3.0", { force: true, io: captured.io }),
	);
	expect(result).toEqual({ exitCode: 0, replaced: true, releaseTag: "spirits-v0.3.0" });
	expect(await Bun.file(execPath).text()).toBe(BINARY_CONTENT);
	expect(fixture.requests.some((path) => path.endsWith("spirits-linux-x64"))).toBe(true);
});

test("does not replace a prerelease newer than the latest stable", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.4.0-rc.1");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.4.0-rc.1", { io: captured.io }));
	// The managed set follows the binary that will run, so the returned tag is the installed
	// prerelease's own release and not the older stable release that was resolved.
	expect(result).toEqual({ exitCode: 0, replaced: false, releaseTag: "spirits-v0.4.0-rc.1" });
	expect(await Bun.file(execPath).text()).toBe("installed 0.4.0-rc.1");
	expect(captured.out.join("\n")).toContain("newer than the latest stable release");
	expect(fixture.requests).toEqual(["/repos/betiz0/spirits/releases"]);
});

test("keeps the binary and the installed assets when the executable checksum fails", async () => {
	const fixture = startFixture("0.3.0", { corruptBinaryChecksum: true });
	const { execPath, themeDir } = await setupInstalled("0.2.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.2.0");
	expect(await Bun.file(join(themeDir, "dark.json")).text()).toBe("installed asset");
	expect(captured.err.join("\n")).toContain("Checksum mismatch");
});

test("replaces a newer prerelease with --force", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.4.0-rc.1");
	const captured = makeIo();
	const result = await runSelfUpdate(
		makeOptions(fixture, execPath, "0.4.0-rc.1", { force: true, io: captured.io }),
	);
	expect(result).toEqual({ exitCode: 0, replaced: true, releaseTag: "spirits-v0.3.0" });
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
