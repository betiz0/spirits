import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelfUpdate, type RunUpdateOptions, type UpdateIo } from "../src/update/run.ts";

const BINARY_CONTENT = "downloaded spirits binary";
const THEME_CONTENTS: Record<string, string> = {
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
	/** Theme asset name whose checksum is deliberately wrong. */
	corruptThemeChecksum?: string;
	/** Serve no theme assets, like 0.6.0 and earlier releases. */
	withoutThemes?: boolean;
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
				return new Response(`${sha256Hex(BINARY_CONTENT)}  spirits-linux-x64\n`);
			}
			if (path.endsWith("/spirits-linux-x64")) {
				return new Response(BINARY_CONTENT);
			}
			for (const [name, content] of Object.entries(THEME_CONTENTS)) {
				if (options.withoutThemes === true) break;
				if (path.endsWith(`/${name}.sha256`)) {
					const hash = options.corruptThemeChecksum === name ? "0".repeat(64) : sha256Hex(content);
					return new Response(`${hash}  ${name}\n`);
				}
				if (path.endsWith(`/${name}`)) {
					return new Response(content);
				}
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
	themeDir: string;
}

/** Install a placeholder binary; `themeContent: null` leaves the theme directory absent. */
async function setupInstalled(
	version: string,
	themeContent: string | null = "installed theme",
): Promise<InstalledPaths> {
	const work = await makeWorkDir();
	const installDir = join(work, "install");
	await mkdir(installDir);
	const execPath = join(installDir, "spirits");
	await writeFile(execPath, `installed ${version}`);
	const themeDir = join(installDir, "theme");
	if (themeContent !== null) {
		await mkdir(themeDir);
		await writeFile(join(themeDir, "dark.json"), themeContent);
		await writeFile(join(themeDir, "light.json"), themeContent);
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

test("places the theme assets on a replacement", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath, themeDir } = await setupInstalled("0.2.0");
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: makeIo().io }));
	expect(result).toEqual({ exitCode: 0, replaced: true });
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe(THEME_CONTENTS["dark.json"]);
	expect(await readFile(join(themeDir, "light.json"), "utf8")).toBe(THEME_CONTENTS["light.json"]);
});

test("does not fetch artifacts when up to date and themes are present", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath } = await setupInstalled("0.3.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(captured.out.join("\n")).toContain("spirits 0.3.0 is already up to date");
	expect(fixture.requests.every((path) => path.endsWith("/releases"))).toBe(true);
});

test("repairs missing theme assets when up to date", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath, themeDir } = await setupInstalled("0.3.0", null);
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 0, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe(THEME_CONTENTS["dark.json"]);
	expect(await readFile(join(themeDir, "light.json"), "utf8")).toBe(THEME_CONTENTS["light.json"]);
	expect(captured.out.join("\n")).toContain("repaired the missing theme assets");
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

test("does not touch theme assets when installed is newer", async () => {
	const fixture = startFixture("0.3.0");
	const { execPath, themeDir } = await setupInstalled("0.4.0-rc.1", "installed theme");
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.4.0-rc.1", { io: makeIo().io }));
	expect(result).toEqual({ exitCode: 0, replaced: false });
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe("installed theme");
	expect(await readFile(join(themeDir, "light.json"), "utf8")).toBe("installed theme");
	expect(fixture.requests.every((path) => path.endsWith("/releases"))).toBe(true);
});

test("keeps the binary when a theme checksum fails", async () => {
	const fixture = startFixture("0.3.0", { corruptThemeChecksum: "dark.json" });
	const { execPath, themeDir } = await setupInstalled("0.2.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.2.0");
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe("installed theme");
	expect(captured.err.join("\n")).toContain("Checksum mismatch");
});

test("keeps the binary when theme placement fails", async () => {
	const fixture = startFixture("0.3.0");
	const { installDir, execPath } = await setupInstalled("0.2.0", null);
	// A regular file at the theme directory path makes mkdir fail after the downloads succeed.
	await writeFile(join(installDir, "theme"), "not a directory");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.2.0");
	expect(captured.err.join("\n")).toContain("Update failed");
});

test("fails the repair when a theme checksum does not match", async () => {
	const fixture = startFixture("0.3.0", { corruptThemeChecksum: "dark.json" });
	const { execPath, themeDir } = await setupInstalled("0.3.0", null);
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(await Bun.file(join(themeDir, "dark.json")).exists()).toBe(false);
	expect(captured.err.join("\n")).toContain("Checksum mismatch");
	expect(captured.out.join("\n")).not.toContain("repaired");
});

test("fails the repair when the theme directory is not a directory", async () => {
	const fixture = startFixture("0.3.0");
	const { installDir, execPath } = await setupInstalled("0.3.0", null);
	// A regular file at the theme directory path makes mkdir fail after the downloads succeed.
	await writeFile(join(installDir, "theme"), "not a directory");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(await Bun.file(join(installDir, "theme")).text()).toBe("not a directory");
	expect(captured.err.join("\n")).toContain("Update failed");
	expect(captured.out.join("\n")).not.toContain("repaired");
});

test("keeps the binary when the release has no theme assets", async () => {
	const fixture = startFixture("0.3.0", { withoutThemes: true });
	const { execPath, themeDir } = await setupInstalled("0.2.0");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.2.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.2.0");
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe("installed theme");
	expect(await readFile(join(themeDir, "light.json"), "utf8")).toBe("installed theme");
	expect(captured.err.join("\n")).toContain("Update failed");
});

test("keeps the theme assets when the release has no theme assets", async () => {
	const fixture = startFixture("0.3.0", { withoutThemes: true });
	const { execPath, themeDir } = await setupInstalled("0.3.0", null);
	await mkdir(themeDir);
	await writeFile(join(themeDir, "dark.json"), "installed theme");
	const captured = makeIo();
	const result = await runSelfUpdate(makeOptions(fixture, execPath, "0.3.0", { io: captured.io }));
	expect(result).toEqual({ exitCode: 1, replaced: false });
	expect(await Bun.file(execPath).text()).toBe("installed 0.3.0");
	expect(await readFile(join(themeDir, "dark.json"), "utf8")).toBe("installed theme");
	expect(await Bun.file(join(themeDir, "light.json")).exists()).toBe(false);
	expect(captured.err.join("\n")).toContain("Update failed");
	expect(captured.out.join("\n")).not.toContain("repaired");
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
