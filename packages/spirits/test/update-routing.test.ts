/**
 * Routing of `update` and of the host's own commands through the launcher.
 *
 * The launcher knows two outcomes for an `update`: the self-update forms reach `runSelfUpdate`, and
 * everything else is refused with the commands that do the rest. A command the host dispatches from its
 * own first argument (`install`, `list`, ...) is refused with the host executable, because forwarding it
 * would start a model turn. A test therefore drives `runLauncher` with the self-update replaced by a seam,
 * so the routing is observed without ever touching the binary that runs the tests.
 */
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { planLauncherArgs, runLauncher } from "../bin/bootstrap.ts";
import { OFFICIAL_PI_HOST } from "../src/managed-pi/host.ts";
import type { ManagedSpawnRequest } from "../src/managed-pi/launch.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import type { RunUpdateOptions, UpdateIo, UpdateResult } from "../src/update/run.ts";
import type { FetchLike } from "../src/update/types.ts";
import { cleanupManagedFixture, makeManagedFixture, type ManagedFixture } from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];

afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

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

/** A fetch that records URLs and fails, so nothing reaches the network. */
function recordingFetch(): { urls: string[]; fetch: FetchLike } {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (input: string | URL | Request) => {
			urls.push(String(input));
			return new Response("not served", { status: 503 });
		},
	};
}

/** A managed set on disk, so a host launch reaches the spawn seam instead of the install guidance. */
async function launchedFixture(): Promise<{ root: string; home: string }> {
	const fixture = await makeManagedFixture();
	fixtures.push(fixture);
	await installManagedSet({ root: fixture.root, manifest: fixture.manifest, fetch, timeoutMs: 3000 });
	return { root: fixture.root, home: fixture.work };
}

interface UpdateRun {
	exitCode: number;
	/** Managed root the launcher was pointed at, for messages that name a path inside it. */
	root: string;
	options: RunUpdateOptions[];
	out: string[];
	err: string[];
	fetchUrls: string[];
	spawnRequests: ManagedSpawnRequest[];
}

/** Run one launcher invocation with the self-update, the host spawn, and the network replaced. */
async function runUpdateLaunch(argv: string[], updateResult: UpdateResult): Promise<UpdateRun> {
	const { root, home } = await launchedFixture();
	const captured = makeIo();
	const recorder = recordingFetch();
	const options: RunUpdateOptions[] = [];
	const spawnRequests: ManagedSpawnRequest[] = [];
	const exitCode = await runLauncher({
		argv,
		env: {},
		home,
		root,
		version: "0.2.0",
		compiled: true,
		bunVersion: "1.4.2",
		fetch: recorder.fetch,
		io: captured.io,
		spawn: async (request) => {
			spawnRequests.push(request);
			return 0;
		},
		runUpdate: async (updateOptions) => {
			options.push(updateOptions);
			return updateResult;
		},
	});
	return {
		exitCode,
		root,
		options,
		out: captured.out,
		err: captured.err,
		fetchUrls: recorder.urls,
		spawnRequests,
	};
}

test("the accepted forms plan a self-update and the rest a refusal", () => {
	expect(planLauncherArgs(["update"])).toEqual({ kind: "update", force: false });
	expect(planLauncherArgs(["update", "self", "--force"])).toEqual({ kind: "update", force: true });
	expect(planLauncherArgs(["update", "-a"])).toEqual({ kind: "update", force: false });
	expect(planLauncherArgs(["update", "--extensions"])).toEqual({
		kind: "update-refusal",
		args: ["--extensions"],
	});
	expect(planLauncherArgs(["update", "--all"])).toEqual({ kind: "update-refusal", args: ["--all"] });
});

test("a self-update runs with the launcher's version, force flag, and environment", async () => {
	const run = await runUpdateLaunch(["update", "self", "--force"], {
		exitCode: 0,
		replaced: false,
		releaseTag: "spirits-v0.2.0",
	});
	expect(run.options).toHaveLength(1);
	expect(run.options[0]).toMatchObject({
		force: true,
		installedVersion: "0.2.0",
		execPath: process.execPath,
		compiled: true,
	});
	// The managed set of the release the update reported is fetched right after the executable step.
	expect(run.fetchUrls.some((url) => url.includes("spirits-v0.2.0"))).toBe(true);
	expect(run.spawnRequests).toHaveLength(0);
});

test("a failing self-update stops before the managed set", async () => {
	const run = await runUpdateLaunch(["update"], { exitCode: 1, replaced: false });
	expect(run.exitCode).toBe(1);
	expect(run.fetchUrls).toHaveLength(0);
	expect(run.spawnRequests).toHaveLength(0);
});

for (const argv of [["update", "--extensions"], ["update", "--all"], ["update", "--unknown"], ["update", "-h"]]) {
	test(`"${argv[1]}" is refused with both commands and no host launch`, async () => {
		const run = await runUpdateLaunch(argv, { exitCode: 0, replaced: true, releaseTag: "spirits-v0.3.0" });
		expect(run.exitCode).not.toBe(0);
		expect(run.options).toHaveLength(0);
		expect(run.fetchUrls).toHaveLength(0);
		expect(run.spawnRequests).toHaveLength(0);
		const message = run.err.join("\n");
		expect(message).toContain("spirits managed-pi update");
		// Measured on the pinned host (Pi 1.5.0): `spirits -- update --extensions` is parsed as a
		// prompt plus an unknown option, because the launcher loads the bundle first and the host only
		// dispatches `update` as its own first argument. The refusal therefore names the host
		// executable and warns about the prompt instead of suggesting the pass-through spelling.
		expect(message).toContain(`${join(run.root, "current", "pi", "pi")} update ${argv.slice(1).join(" ")}`);
		expect(message).toContain('"spirits -- update ..." is a prompt to the model');
		expect(message.split("\n").some((line) => line.trim().startsWith("spirits -- update"))).toBe(false);
	});
}

test("a host command word is refused with the host executable and no host launch", async () => {
	const run = await runUpdateLaunch(["install", "some-extension"], { exitCode: 0, replaced: false });
	expect(run.exitCode).toBe(1);
	expect(run.options).toHaveLength(0);
	expect(run.spawnRequests).toHaveLength(0);
	const message = run.err.join("\n");
	// Measured on the pinned host (Pi 1.5.0): `<host> list` lists packages, `-e <bundle> list` reads `list`
	// as a prompt to the model, and `<host> list -e <bundle>` reports `Unknown option -e for "list"`. The
	// launcher can therefore neither pass the word through nor load the bundle for it.
	expect(message).toContain("spirits does not run install");
	expect(message).toContain(`${join(run.root, "current", "pi", "pi")} install some-extension`);
	expect(message).toContain("the host rejects that flag after one of its own commands");
});

test("every command word of the host descriptor is refused", () => {
	for (const word of OFFICIAL_PI_HOST.commandWords) {
		expect(planLauncherArgs([word, "x"])).toEqual({ kind: "host-command-refusal", word, args: ["x"] });
	}
	// `update` is the launcher's own command, so it stays out of the host's table.
	expect(OFFICIAL_PI_HOST.commandWords).not.toContain("update");
	expect(planLauncherArgs(["update", "--extensions"])).toEqual({ kind: "update-refusal", args: ["--extensions"] });
});

test("a command word behind the separator stays a host launch", () => {
	expect(planLauncherArgs(["--", "list"])).toEqual({ kind: "host", args: ["list"] });
});

test("the separator hands an update invocation to the host untouched", async () => {
	expect(planLauncherArgs(["--", "update", "--extensions"])).toEqual({
		kind: "host",
		args: ["update", "--extensions"],
	});
	const run = await runUpdateLaunch(["--", "update", "--extensions"], {
		exitCode: 0,
		replaced: false,
	});
	expect(run.exitCode).toBe(0);
	expect(run.options).toHaveLength(0);
	expect(run.spawnRequests).toHaveLength(1);
	const command = run.spawnRequests[0]?.command ?? [];
	expect(command.slice(-2)).toEqual(["update", "--extensions"]);
});

test("a source run refuses to update itself", async () => {
	const { root, home } = await launchedFixture();
	const captured = makeIo();
	const recorder = recordingFetch();
	const options: RunUpdateOptions[] = [];
	const exitCode = await runLauncher({
		argv: ["update"],
		env: {},
		home,
		root,
		version: "0.2.0",
		compiled: false,
		bunVersion: "1.4.2",
		fetch: recorder.fetch,
		io: captured.io,
		runUpdate: async (updateOptions) => {
			options.push(updateOptions);
			return { exitCode: 0, replaced: true };
		},
	});
	expect(exitCode).not.toBe(0);
	expect(options).toHaveLength(0);
	expect(captured.err.join("\n")).toContain("running from source");
});
