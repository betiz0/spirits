import { afterAll, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { classifyManagedPiArgs } from "../src/managed-pi/classify.ts";
import { runManagedCommand } from "../src/managed-pi/command.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { launchManagedPi } from "../src/managed-pi/launch.ts";
import { readCurrentSet } from "../src/managed-pi/layout.ts";
import { repairManagedSet } from "../src/managed-pi/repair.ts";
import { updateManagedSet } from "../src/managed-pi/update.ts";
import { classifyUpdateArgs } from "../src/update/classify.ts";
import {
	cleanupManagedFixture,
	directoryExists,
	FAKE_RPC_PI_SCRIPT,
	makeManagedFixture,
	PI_SCRIPT,
	type ManagedFixture,
} from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

const silent = { out: () => {}, err: () => {} };

/** Path, modification time, and content of every file under `root`, in a stable order. */
async function snapshotTree(root: string): Promise<string> {
	const entries: string[] = [];
	async function walk(dir: string): Promise<void> {
		for (const name of (await readdir(dir)).sort()) {
			const path = join(dir, name);
			const info = await lstat(path);
			if (info.isDirectory()) {
				await walk(path);
				continue;
			}
			entries.push(`${relative(root, path)}\t${info.mtimeMs}\t${await readFile(path, "utf8")}`);
		}
	}
	await walk(root);
	return entries.join("\n");
}

test("managed commands leave the existing agent fixture unchanged", async () => {
	// `PI_SCRIPT` exits 0 for both `--version` and a plain launch, so the real spawner can run it.
	const fixture = await makeManagedFixture({ piScript: PI_SCRIPT });
	fixtures.push(fixture);
	const home = fixture.work;
	const existing = join(home, ".spirits", "agent");
	await mkdir(join(existing, "sessions", "project"), { recursive: true });
	await mkdir(join(existing, "extensions"), { recursive: true });
	await writeFile(join(existing, "settings.json"), '{"theme":"dark"}\n');
	await writeFile(join(existing, "auth.json"), '{"anthropic":"fixture-secret"}\n');
	await writeFile(join(existing, "sessions", "project", "session.jsonl"), '{"type":"session"}\n');
	await writeFile(join(existing, "extensions", "index.ts"), "export default function () {}\n");
	const before = await snapshotTree(existing);

	await installManagedSet({ root: fixture.root, manifest: fixture.manifest, fetch, timeoutMs: 3000 });
	await updateManagedSet({ root: fixture.root, manifest: fixture.manifest, fetch, timeoutMs: 3000 });
	await repairManagedSet({ root: fixture.root, setId: fixture.manifest.setId, fetch, timeoutMs: 3000 });
	await runManagedCommand({ root: fixture.root, action: { kind: "help" }, env: {}, fetch, home, version: "0.1.0", io: silent });
	// Version and the plain launch go through the production spawner (`spawnManagedProcess`), not a
	// seam, so the test exercises the same child-process path the wrapper uses.
	for (const args of [["--version"], []]) {
		const result = await launchManagedPi({
			root: fixture.root,
			args,
			env: {},
			home,
			io: silent,
		});
		expect(result).toEqual({ exitCode: 0, launched: true });
	}

	// Every existing file keeps its path, bytes, and modification time, and nothing new appeared.
	expect(await snapshotTree(existing)).toBe(before);
	expect(await directoryExists(join(fixture.root, "agent"))).toBe(true);
}, 120_000);

test("install, update, launch, and the compatibility runner complete on a fixture set", async () => {
	const first = await makeManagedFixture({ piScript: FAKE_RPC_PI_SCRIPT });
	const second = await makeManagedFixture({
		piScript: FAKE_RPC_PI_SCRIPT,
		setId: "pi-1.5.0-update",
		extensionBody: "export default function updated() {}\n",
	});
	fixtures.push(first, second);
	await installManagedSet({ root: first.root, manifest: first.manifest, fetch, timeoutMs: 3000 });
	expect(await readCurrentSet(first.root)).toBe(first.manifest.setId);

	await updateManagedSet({ root: first.root, manifest: second.manifest, fetch, timeoutMs: 3000 });
	expect(await readCurrentSet(first.root)).toBe(second.manifest.setId);

	let command: string[] = [];
	const launched = await launchManagedPi({
		root: first.root,
		args: ["--version"],
		env: {},
		home: first.work,
		spawn: async (request) => {
			command = request.command;
			return 0;
		},
		io: silent,
	});
	expect(launched).toEqual({ exitCode: 0, launched: true });
	expect(command[0]).toBe(join(first.root, "current", "pi", "pi"));

	const outDir = await mkdtemp(join(tmpdir(), "spirits-managed-integration-result-"));
	try {
		const out = join(outDir, "result.json");
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "..", "..", "..", "scripts", "managed-pi-compat", "run.ts"),
				"--artifact-root",
				first.root,
				"--out",
				out,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const exitCode = await child.exited;
		const stderr = await new Response(child.stderr).text();
		const result = JSON.parse(await readFile(out, "utf8")) as {
			results: Array<{ name: string; state: string; detail?: string }>;
		};
		expect(result.results.filter((entry) => entry.state === "failed")).toEqual([]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		const states = new Set(result.results.map((entry) => entry.state));
		for (const state of ["confirmed", "limited", "not-run"]) expect(states.has(state)).toBe(true);
		const names = new Set(result.results.map((entry) => entry.name));
		expect(names.has("managed extension load")).toBe(true);
		expect(names.has("data read compatibility")).toBe(true);
		expect(names.has("role/clear/model matrix")).toBe(true);
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}

	expect(classifyManagedPiArgs(["managed-pi", "update"])).toEqual({ kind: "update" });
	expect(classifyManagedPiArgs(["update"])).toEqual({ kind: "none" });
	expect(classifyUpdateArgs(["update"]).target).not.toBe("pass-through");
}, 120_000);
