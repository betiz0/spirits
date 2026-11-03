import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyManagedPiArgs } from "../src/managed-pi/classify.ts";
import { installManagedSet } from "../src/managed-pi/install.ts";
import { launchManagedPi } from "../src/managed-pi/launch.ts";
import { readCurrentSet } from "../src/managed-pi/layout.ts";
import { updateManagedSet } from "../src/managed-pi/update.ts";
import { classifyUpdateArgs } from "../src/update/classify.ts";
import {
	cleanupManagedFixture,
	FAKE_RPC_PI_SCRIPT,
	makeManagedFixture,
	type ManagedFixture,
} from "./managed-pi-fixtures.ts";

const fixtures: ManagedFixture[] = [];
afterAll(async () => {
	for (const fixture of fixtures) await cleanupManagedFixture(fixture);
});

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
		io: { out: () => {}, err: () => {} },
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
