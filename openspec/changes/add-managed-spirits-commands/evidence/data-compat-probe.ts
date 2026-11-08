/**
 * Two-route data compatibility: the fork and the managed route share one agent dir and one session
 * file, and each side keeps working with what the other wrote.
 *
 * The write formats are the risk, not the reads:
 *  - settings: the managed route writes `<agentDir>/settings.json` with the lock pi itself uses, and
 *    the fork's `SettingsManager` has to resolve the result (not merely parse it);
 *  - session: the managed route appends `spirits_role` custom entries, which the fork has never
 *    seen, while the fork writes `pi.virtual-model-state`, which the managed route reads for the
 *    one-way role handoff.
 *
 * Local fake provider, isolated HOME, isolated agent dir. No real user data, no real credentials.
 *
 * Run: bun openspec/changes/add-managed-spirits-commands/evidence/data-compat-probe.ts
 *      [--fork <binary>] [--pi-dir <extracted official pi>]
 */

import { appendFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeOverlayPackage } from "../../../../packages/spirits/src/managed-pi/overlay.ts";
import { startFakeProvider } from "../../../../scripts/managed-pi-compat/fake-provider.ts";
import { runStagedRpcProbe, type RpcRecord } from "../../../../scripts/managed-pi-compat/rpc";

const HERE = import.meta.dir;
const REPO = resolve(HERE, "../../../..");
const FORK_BINARY = arg("--fork") ?? join(REPO, "dist/spirits-linux-x64");
const PI_DIR = arg("--pi-dir") ?? "/tmp/pi150bin/pi";
const BUNDLE = arg("--bundle") ?? resolve(REPO, "dist/spirits-managed-pi-extension.js");
const PROVIDER_FIXTURE = resolve(REPO, "scripts/managed-pi-compat/fixtures/custom-provider.ts");
const INSPECT_FIXTURE = join(HERE, "inspect-extension.ts");
const OUT = join(HERE, "data-compat-results.json");

const ROOT = "/tmp/spirits-data-compat";
const home = join(ROOT, "home");
const agentDir = join(ROOT, "agent");
const sessionFile = join(ROOT, "session.jsonl");
const cwd = join(ROOT, "cwd");
const piDir = join(ROOT, "pi");

const PROVIDER = "compat-fake";
const MODEL = "fake-model";
const STRONG = "fake-strong";

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

interface Check {
	name: string;
	pass: boolean;
	detail: string;
}
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
	checks.push({ name, pass, detail });
	console.log(`${pass ? "PASS" : "FAIL"} ${name} :: ${detail}`);
}

interface Inspect {
	sessionId: string | undefined;
	known: Record<string, unknown>;
	unknownKeys: Record<string, unknown>;
	commands: string[];
	currentModel: string | undefined;
	level: string | undefined;
	customTypes: string[];
	spiritsRoleEntries: string[];
	piStateRoles: string[];
}

async function inspect(path: string): Promise<Inspect> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			return (await Bun.file(path).json()) as Inspect;
		} catch {
			await new Promise((done) => setTimeout(done, 100));
		}
	}
	throw new Error(`inspector never wrote ${path}`);
}

function ask(marker: string) {
	return {
		requests: [{ id: `p-${marker}`, type: "prompt", message: `${marker} question` }],
		waitFor: (records: readonly RpcRecord[], since: number) => records.slice(since).some((record) => record.type === "agent_end"),
		timeoutMs: 60_000,
	};
}

/** Extension commands answer through the UI rather than the RPC stream, so the stage spends its window. */
function command(line: string) {
	return { requests: [{ id: `c-${line}`, type: "prompt", message: line }], waitFor: () => false, timeoutMs: 4_000 };
}

function inspectStage(id: string) {
	return { requests: [{ id, type: "prompt", message: "/adc-inspect" }], waitFor: () => false, timeoutMs: 2_500 };
}

function modelFor(requests: Array<{ model?: string; body?: unknown }>, marker: string): string | null {
	for (const request of requests) {
		const body = request.body as { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
		if (JSON.stringify(body?.messages ?? []).includes(marker)) return request.model ?? null;
	}
	return null;
}

async function settings(): Promise<Record<string, any>> {
	return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, any>;
}

async function main(): Promise<void> {
	await rm(ROOT, { recursive: true, force: true });
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await cp(PI_DIR, piDir, { recursive: true });
	await writeOverlayPackage(piDir);

	// `spiritsForeign` is a key neither route owns, so the evidence shows neither side drops what it
	// does not know, and `models.strong` is the other owner's field inside the object spirits edits.
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({ quietStartup: true, defaultProvider: PROVIDER, defaultModel: MODEL, models: { strong: `${PROVIDER}/${STRONG}` }, enabledModels: ["*"], spiritsForeign: { keep: true } }, null, 2),
	);

	const provider = startFakeProvider({ name: "unused", arguments: {} }, { reply: () => ({ kind: "text", text: "ok" }) });
	await new Promise((done) => setTimeout(done, 200));
	const sharedEnv = {
		HOME: home,
		SPIRITS_CODING_AGENT_DIR: agentDir,
		PI_SKIP_VERSION_CHECK: "1",
		PI_TELEMETRY: "0",
		MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: provider.baseUrl,
	};

	// ------------------------------------------------------------------ 1. the fork writes first
	const fork1File = join(ROOT, "fork-1.json");
	const fork1 = await runStagedRpcProbe({
		command: [FORK_BINARY, "--mode", "rpc", "--session", sessionFile, "-e", PROVIDER_FIXTURE, "-e", INSPECT_FIXTURE],
		cwd,
		env: { ...sharedEnv, ADC_DUMP: fork1File },
		stages: [
			{ requests: [{ id: "auto", type: "set_model", provider: "spirits", modelId: "auto" }] },
			ask("alphamarker"),
			inspectStage("inspect-fork-1"),
		],
		timeoutMs: 240_000,
	});
	const fork1Inspect = await inspect(fork1File);
	check(
		"fork-1 routes the plain turn to the default model",
		modelFor(provider.requests, "alphamarker") === MODEL,
		`model=${String(modelFor(provider.requests, "alphamarker"))} stderr=${JSON.stringify(fork1.stderr.slice(0, 160))}`,
	);
	check(
		"fork-1 registers no spirits command surface",
		fork1Inspect.commands.every((name) => !name.startsWith("spirits-")),
		fork1Inspect.commands.filter((name) => name.startsWith("spirits-")).join(",") || "none",
	);
	check(
		"fork-1 wrote pi's own routing state entry",
		fork1Inspect.customTypes.includes("pi.virtual-model-state"),
		fork1Inspect.customTypes.join(","),
	);

	// A fork session that had locked strong: the same entry the fork just wrote, with the role it
	// would carry. This is what the managed route has to inherit on the handoff.
	const forkState = (await readFile(sessionFile, "utf8"))
		.split("\n")
		.filter((line) => line.includes("pi.virtual-model-state"))
		.at(-1);
	if (!forkState) throw new Error("the fork wrote no routing state entry to continue from");
	await appendFile(sessionFile, `${JSON.stringify({ ...JSON.parse(forkState), data: { provider: "spirits", modelId: "auto", role: "strong" } })}\n`);

	// ------------------------------------------------------------------ 2. managed inherits and routes
	const managed1File = join(ROOT, "managed-1.json");
	provider.requests.length = 0;
	await runStagedRpcProbe({
		command: [join(piDir, "pi"), "--mode", "rpc", "--session", sessionFile, "-e", PROVIDER_FIXTURE, "-e", BUNDLE, "-e", INSPECT_FIXTURE],
		cwd,
		env: { ...sharedEnv, ADC_DUMP: managed1File },
		stages: [ask("betamarker"), inspectStage("inspect-managed-1")],
		timeoutMs: 240_000,
	});
	const managed1Inspect = await inspect(managed1File);
	check(
		"managed-1 continues the fork's session id",
		managed1Inspect.sessionId === fork1Inspect.sessionId,
		`${String(managed1Inspect.sessionId)} vs ${String(fork1Inspect.sessionId)}`,
	);
	check(
		"managed-1 inherits the role the fork left and routes strong",
		managed1Inspect.piStateRoles.at(-1) === "strong" && modelFor(provider.requests, "betamarker") === STRONG,
		`pi state roles=${JSON.stringify(managed1Inspect.piStateRoles)} model=${String(modelFor(provider.requests, "betamarker"))}`,
	);
	check(
		"managed-1 added no routing state entry of its own yet",
		!managed1Inspect.spiritsRoleEntries.length,
		JSON.stringify(managed1Inspect.spiritsRoleEntries),
	);

	// ------------------------------------------------------------------ 3. managed writes both stores
	const managed2File = join(ROOT, "managed-2.json");
	await runStagedRpcProbe({
		command: [join(piDir, "pi"), "--mode", "rpc", "--session", sessionFile, "-e", PROVIDER_FIXTURE, "-e", BUNDLE, "-e", INSPECT_FIXTURE],
		cwd,
		env: { ...sharedEnv, ADC_DUMP: managed2File },
		stages: [command(`/spirits-model ${MODEL} minimal strong`), inspectStage("inspect-managed-2")],
		timeoutMs: 240_000,
	});
	const managed2Inspect = await inspect(managed2File);
	const written = await settings();
	check(
		"managed-2 persisted model, level, and role under pi's own keys",
		written.defaultProvider === PROVIDER && written.defaultModel === MODEL && written.defaultThinkingLevel === "minimal" && written.models?.role === "strong",
		JSON.stringify(written),
	);
	check(
		"managed-2 kept the foreign key and the other owner's strong entry",
		JSON.stringify(written.spiritsForeign) === JSON.stringify({ keep: true }) && written.models?.strong === `${PROVIDER}/${STRONG}`,
		JSON.stringify({ foreign: written.spiritsForeign, strong: written.models?.strong }),
	);
	check(
		"managed-2 wrote its own role entry and never pi's routing state",
		managed2Inspect.spiritsRoleEntries.length > 0 && managed2Inspect.customTypes.filter((type) => type === "spirits_role").length > 0,
		`spirits_role=${JSON.stringify(managed2Inspect.spiritsRoleEntries)} custom=${managed2Inspect.customTypes.join(",")}`,
	);

	// ------------------------------------------------------------------ 4. the fork reads both back
	const fork2File = join(ROOT, "fork-2.json");
	provider.requests.length = 0;
	const fork2 = await runStagedRpcProbe({
		command: [FORK_BINARY, "--mode", "rpc", "--session", sessionFile, "-e", PROVIDER_FIXTURE, "-e", INSPECT_FIXTURE],
		cwd,
		env: { ...sharedEnv, ADC_DUMP: fork2File },
		stages: [ask("gammamarker"), inspectStage("inspect-fork-2")],
		timeoutMs: 240_000,
	});
	const fork2Inspect = await inspect(fork2File);
	check(
		"fork-2 resolves the model and level the managed route saved",
		fork2Inspect.known.defaultModel === MODEL && fork2Inspect.known.defaultThinkingLevel === "minimal",
		JSON.stringify(fork2Inspect.known),
	);
	check(
		"fork-2 loads the session that holds the spirits custom entry",
		fork2Inspect.sessionId === fork1Inspect.sessionId && fork2Inspect.spiritsRoleEntries.length > 0,
		`${String(fork2Inspect.sessionId)} spirits_role=${JSON.stringify(fork2Inspect.spiritsRoleEntries)}`,
	);
	check(
		"fork-2 answers with no load error",
		modelFor(provider.requests, "gammamarker") !== null && fork2.stderr === "",
		`model=${String(modelFor(provider.requests, "gammamarker"))} stderr=${JSON.stringify(fork2.stderr.slice(0, 200))}`,
	);

	await writeFile(
		OUT,
		`${JSON.stringify({ checks, settings: written, fork1: fork1Inspect, managed1: managed1Inspect, managed2: managed2Inspect, fork2: fork2Inspect }, null, 2)}\n`,
	);
	const failed = checks.filter((entry) => !entry.pass).length;
	console.log(`\n${checks.length - failed}/${checks.length} checks passed -> ${OUT}`);
	process.exit(failed === 0 ? 0 : 1);
}

await main();
