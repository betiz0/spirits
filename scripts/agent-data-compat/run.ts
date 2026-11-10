/**
 * Bidirectional read/write compatibility of `~/.spirits/agent` data between the fork (spirits 0.6.0)
 * and the managed route (official Pi 1.5.0 plus the spirits extension bundle).
 *
 * Protocol, per direction:
 *
 *   fork creates      -> managed reads, then writes -> fork reads the result back
 *   managed creates   -> fork reads, then writes     -> managed reads the result back
 *
 * Both hosts run the same scripted cells and tool calls against one local fake provider, in
 * isolated HOMEs, with no real credentials and no external endpoint. Nothing in this script changes
 * product code, guards, or the default route: it only observes.
 *
 * Usage:
 *
 *   bun scripts/agent-data-compat/run.ts \
 *     --fork ~/.spirits/bin/spirits \
 *     --artifact-root /tmp/pi-compat-staging/artifact \
 *     --bundle dist/spirits-managed-pi-extension.js \
 *     --out docs/agent-data-compat \
 *     [--managed-route isolated|default]
 *
 * `--managed-route default` measures the default launch instead of the isolated one: the managed
 * host then uses the fork's agent directory rule, gets no session-directory pin, and the production
 * one-time backup runs before its first launch. The route is recorded in `result.json`.
 *
 * Exit code is 0 unless an item failed to run at all; a compatibility finding is data, not a crash.
 */

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { redactSecrets } from "../managed-pi-compat/evidence.ts";
import { backupAgentDirOnce } from "../../packages/spirits/src/managed-pi/agent-backup.ts";
import { agentBackupStatePath, backupsDir } from "../../packages/spirits/src/managed-pi/default-route.ts";
import { managedSessionDir } from "../../packages/spirits/src/managed-pi/environment.ts";
import { managedRoot } from "../../packages/spirits/src/managed-pi/layout.ts";
import { startFakeProvider, type FakeProviderRequest, type FakeReply } from "../managed-pi-compat/fake-provider.ts";
import {
	runCommandProbe,
	runStagedRpcProbe,
	type RpcRecord,
	type RpcStep,
} from "../managed-pi-compat/rpc.ts";
import {
	createLocalPackage,
	forkLaunch,
	type HostLaunch,
	type ProbePaths,
	managedLaunch,
	prepareInputs,
	settingsWriteCommand,
} from "./hosts.ts";
import { decideReply, makeMarker, PROMPTS, unexpectedRequests } from "./protocol.ts";
import {
	ABSENT_PROVIDER,
	FILE_MODEL,
	FILE_PROVIDER,
	STORED_ONLY_PROVIDER,
	STRONG_MODEL,
	TRACKED_SETTINGS_KEYS,
	seedMarkers,
	writeSeedAgentDir,
} from "./seed.ts";
import { diffSnapshots, describeDiff, snapshotTree, type FileRecord, type SnapshotDiff } from "./snapshot.ts";
import { readSettings, testSettingsWrite, writerFidelity } from "./settings-write.ts";
import {
	customEntryCounts,
	compareEntries,
	type DirectionResult,
	keySurvival,

	overallOf,
	type DumpEntry,
	type Overall,
	settingValue,
	settingsEqual,
} from "./verdicts.ts";

/** Upstream tag whose settings writer is compared against the checkout. */
const OFFICIAL_TAG = "v1.5.0";
/** Default evidence destination. */
const DEFAULT_OUT = "docs/agent-data-compat";
/** Timeout for one RPC stage. `ADC_STAGE_MS` lowers it while diagnosing a stalled phase. */
const STAGE_MS = Number(process.env.ADC_STAGE_MS ?? 90_000);
/** Log every protocol record of every phase while diagnosing. */
const DEBUG_RECORDS = process.env.ADC_DEBUG === "1";

/** Why a host authors none of an entry type, so a not-run in the table carries its cause. */
const ENTRY_AUTHORING_NOTES: Record<string, string> = {
	"pi.virtual-model-state": "the bundle appends it only through the host role API, absent in official pi 1.5.0",
};
/** The isolated agent directories the protocol needs, and which host owns each one. */
const SLOTS = [
	{ name: "a1-fork-create", host: "fork" },
	{ name: "a2-managed-readwrite", host: "managed" },
	{ name: "a3-fork-reread", host: "fork" },
	{ name: "b1-managed-create", host: "managed" },
	{ name: "b2-fork-readwrite", host: "fork" },
	{ name: "b3-managed-reread", host: "managed" },
	// Two more slots hold the settings test write, one per direction, so the other host's own writer
	// is the one that has to preserve the keys.
	{ name: "tw-a-managed", host: "managed" },
	{ name: "tw-b-fork", host: "fork" },
] as const;

type SlotName = (typeof SLOTS)[number]["name"];
type SlotHost = "fork" | "managed";

/** One isolated agent directory with its own HOME. */
interface Slot {
	name: SlotName;
	host: SlotHost;
	home: string;
	agentDir: string;
}

/**
 * The managed route the managed host stands in for.
 *
 * `isolated` is `spirits managed-pi`: its own agent directory under the managed root, with the
 * session directory pinned. `default` is the default launch: the fork's agent directory rule, no
 * session-directory pin, and the production one-time backup before the first launch.
 */
type ManagedRoute = "isolated" | "default";

/** The agent directory layout of a host: the fork rule, or the managed root layout. */
function slotAgentDir(home: string, host: SlotHost, route: ManagedRoute): string {
	if (host === "fork" || route === "default") return join(home, ".spirits", "agent");
	return join(home, ".spirits", "managed-pi", "agent");
}

/** CLI options. */
interface Options {
	fork: string;
	artifactRoot: string;
	bundle: string;
	out: string;
	work?: string;
	keep: boolean;
	managedRoute: ManagedRoute;
}

/** One recorded item. */
interface Item {
	item: string;
	forkToManaged: DirectionResult;
	managedToFork: DirectionResult;
	overall: Overall;
	detail?: string;
	data?: unknown;
}

function parseArgs(argv: readonly string[]): Options {
	const options: Options = {
		fork: process.env.SPIRITS_FORK_BINARY ?? join(process.env.HOME ?? "", ".spirits", "bin", "spirits"),
		artifactRoot: "",
		bundle: "",
		out: DEFAULT_OUT,
		keep: false,
		managedRoute: "isolated",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = argv[index + 1];
		switch (argument) {
			case "--fork":
				if (!value) throw new Error("--fork needs a value");
				options.fork = value;
				index += 1;
				break;
			case "--artifact-root":
				if (!value) throw new Error("--artifact-root needs a value");
				options.artifactRoot = value;
				index += 1;
				break;
			case "--bundle":
				if (!value) throw new Error("--bundle needs a value");
				options.bundle = value;
				index += 1;
				break;
			case "--out":
				if (!value) throw new Error("--out needs a value");
				options.out = value;
				index += 1;
				break;
			case "--work":
				if (!value) throw new Error("--work needs a value");
				options.work = value;
				index += 1;
				break;
			case "--keep":
				options.keep = true;
				break;
			case "--managed-route": {
				if (value !== "isolated" && value !== "default") throw new Error("--managed-route is isolated or default");
				options.managedRoute = value;
				index += 1;
				break;
			}
			default:
				throw new Error(`unknown argument: ${argument}`);
		}
	}
	if (!options.artifactRoot) throw new Error("--artifact-root is required (manifest.json plus the pi tarball)");
	if (!options.bundle) throw new Error("--bundle is required (the spirits extension bundle)");
	return options;
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
	const child = Bun.spawn({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
	const text = await new Response(child.stdout).text();
	await child.exited;
	return text;
}

/** Provenance of the runner itself. */
async function provenance(cwd: string): Promise<{
	commit: string;
	diffSha256: string;
	untracked: string[];
	clean: boolean;
	tag: string;
	officialTagCommit: string;
	bun: string;
}> {
	const commit = (await runGit(["rev-parse", "HEAD"], cwd)).trim();
	const diff = await runGit(["diff", "HEAD"], cwd);
	const status = await runGit(["ls-files", "--others", "--exclude-standard"], cwd);
	const tag = (await runGit(["describe", "--tags", "--always", "HEAD"], cwd)).trim();
	const officialTagCommit = (await runGit(["rev-parse", OFFICIAL_TAG], cwd)).trim();
	return {
		commit,
		diffSha256: createHash("sha256").update(diff).digest("hex"),
		untracked: status.split("\n").filter((line) => line.length > 0),
		clean: diff.length === 0 && status.trim().length === 0,
		tag,
		officialTagCommit,
		bun: Bun.version,
	};
}

/** Mask the fixture credential so the evidence holds no key-shaped strings. */
function redact(value: string): string {
	return redactSecrets(value)
		.replace(/("(?:key|apiKey|api_key|token|password)"\s*:\s*")[^"]*(")/gi, "$1***$2")
		.replace(/(https?:\/\/127\.0\.0\.1):\d+/g, "$1:<port>");
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${redact(JSON.stringify(value, null, "\t"))}\n`, "utf-8");
}

/** A persisted snapshot record: parsed JSON is kept for `.json` files, digests for the rest. */
function compactRecord(record: FileRecord): Record<string, unknown> {
	const compact: Record<string, unknown> = {
		path: record.path,
		type: record.type,
		size: record.size,
		sha256: record.sha256,
	};
	if (record.lines !== undefined) compact.lines = record.lines;
	if (record.parseError !== undefined) compact.parseError = record.parseError;
	if (record.json !== undefined) compact.json = record.json;
	if (record.jsonl !== undefined) {
		compact.jsonlEntries = record.jsonl.length;
		compact.jsonlTypes = record.jsonl.map((entry) => {
			const value = entry as { type?: string; customType?: string };
			return value.customType ? `${value.type}:${value.customType}` : value.type;
		});
	}
	return compact;
}

/** Count custom entry types in a session file as it stands on disk, before the other host touches it. */
async function countCustomTypesInFile(path: string | undefined): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	if (!path) return counts;
	const text = await Bun.file(path)
		.text()
		.catch(() => "");
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry: { customType?: string };
		try {
			entry = JSON.parse(line) as { customType?: string };
		} catch {
			continue;
		}
		if (entry.customType) counts[entry.customType] = (counts[entry.customType] ?? 0) + 1;
	}
	return counts;
}

/** Find the newest session file inside an agent directory. */
async function newestSessionFile(agentDir: string): Promise<string | undefined> {
	const root = join(agentDir, "sessions");
	const found: Array<{ path: string; mtimeMs: number }> = [];
	const walk = async (dir: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}
			if (!entry.name.endsWith(".jsonl")) continue;
			const info = await stat(path);
			found.push({ path, mtimeMs: info.mtimeMs });
		}
	};
	await walk(root);
	found.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return found[0]?.path;
}

/** The probe dump written by a phase. */
interface Dump {
	host?: Record<string, unknown>;
	settings?: Record<string, unknown>;
	settingsKeys?: string[];
	thinkingLevel?: string;
	model?: { provider: string; id: string } | null;
	session?: { sessionId?: string; count?: number; byType?: Record<string, number>; entries?: DumpEntry[] };
	auth?: Record<string, unknown>;
	models?: string[];
	tools?: string[];
	commands?: string[];
	apis?: Record<string, unknown>;
}

/** Result of one host phase. */
interface PhaseResult {
	name: string;
	/** Provider requests this phase caused. */
	requests: Array<{ kind?: string; model?: string }>;
	/** Markers that appeared in the request bodies this phase sent. */
	markerHits: Record<string, boolean>;
	/** Whether each RPC request id in the phase succeeded. */
	commandResults: Record<string, boolean>;
	dump: Dump | null;
	systemPrompt: Array<{ markers?: Record<string, boolean>; markerLines?: string[] }>;
	toolResults: Array<{ tool: string; isError: boolean; text: string }>;
	stderr: string;
	exitCode: number;
	records: number;
	error?: string;
}

/**
 * Lightweight content fingerprint (path, size, mtime) for the operator's own data.
 *
 * `sessions/` is excluded on purpose: this runner is itself executed by a spirits session whose own
 * transcript lives in the operator's agent dir, so its session files change while the run is going
 * on. Everything else has to stay byte-for-byte and mtime-for-mtime identical.
 */
async function fingerprintTree(root: string): Promise<string> {
	const entries: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		for (const name of names.sort()) {
			const path = join(dir, name);
			if (path.slice(root.length + 1) === "sessions") continue;
			const info = await stat(path).catch(() => undefined);
			if (info === undefined) {
				entries.push(`${path.slice(root.length)}:unreadable`);
				continue;
			}
			if (info.isDirectory()) await walk(path);
			else entries.push(`${path.slice(root.length)}:${info.size}:${Math.round(info.mtimeMs)}`);
		}
	};
	await walk(root);
	return entries.join("\n");
}

/** Everything the run records. */
class Evidence {
	readonly items: Item[] = [];
	readonly phases: Record<string, unknown> = {};
	readonly notes: string[] = [];
	/** Phases that produced no probe dump. */
	readonly broken: string[] = [];

	record(
		item: string,
		forkToManaged: DirectionResult,
		managedToFork: DirectionResult,
		detail?: string,
		data?: unknown,
	): Item {
		const entry: Item = { item, forkToManaged, managedToFork, overall: overallOf(forkToManaged, managedToFork) };
		if (detail !== undefined) entry.detail = detail;
		if (data !== undefined) entry.data = data;
		this.items.push(entry);
		return entry;
	}

	note(line: string): void {
		this.notes.push(line);
	}
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	const repoRoot = join(import.meta.dirname, "..", "..");
	const workRoot = options.work ?? (await mkdtemp(join(tmpdir(), "spirits-agent-data-compat-")));
	await mkdir(workRoot, { recursive: true });
	const project = join(workRoot, "project");
	await mkdir(project, { recursive: true });
	const marker = makeMarker();
	const evidence = new Evidence();
	const failures: string[] = [];

	// Isolation guard: the real user agent dir must not change during the run.
	const realAgentDir = join(process.env.HOME ?? "", ".spirits", "agent");
	let realBefore = "";
	try {
		realBefore = await fingerprintTree(realAgentDir);
	} catch {
		realBefore = "";
	}

	const fakeProvider = startFakeProvider(
		{ name: "unused", arguments: {} },
		{
			reply: (body: unknown): FakeReply => decideReply(body, marker),
		},
	);
	const fakeUrl = fakeProvider.baseUrl;

	try {
		// ---------------------------------------------------------------- inputs
		const run = await provenance(repoRoot);
		const inputs = await prepareInputs({
			forkBinary: options.fork,
			artifactRoot: options.artifactRoot,
			// Pi resolves `-e` against the working directory, so the bundle has to be absolute.
			bundle: resolve(options.bundle),
			workRoot,
			commit: run.commit,
			workingTreeClean: run.clean,
		});

		// The test write replays Pi's writer; hash both sources to show that it is the same code.
		const forkWriterSource = await runGit(["show", `HEAD:packages/coding-agent/src/core/settings-manager.ts`], repoRoot);
		const officialWriterSource = await runGit(["show", `${OFFICIAL_TAG}:packages/coding-agent/src/core/settings-manager.ts`], repoRoot);
		// The bundle is built from this checkout, so its version label is the commit, not the manifest's
		// release version (that label belongs to the published asset, not to this measurement).
		inputs.identity.bundleVersion = `local-build@${run.commit.slice(0, 7)}`;
		const fidelity = writerFidelity({ forkSource: forkWriterSource, officialSource: officialWriterSource, officialTag: OFFICIAL_TAG });
		evidence.note(
			`settings writer replay: ${fidelity.regions.map((region) => `${region.name} ${region.identical ? "identical" : "DIFFERS"}`).join(", ")} (fork HEAD vs ${OFFICIAL_TAG})`,
		);

		// ---------------------------------------------------------------- slots
		const slots = new Map<SlotName, Slot>();
		for (const definition of SLOTS) {
			const home = join(workRoot, "homes", definition.name);
			await mkdir(home, { recursive: true });
			const agentDir = slotAgentDir(home, definition.host, options.managedRoute);
			await mkdir(agentDir, { recursive: true });
			slots.set(definition.name, { name: definition.name, host: definition.host, home, agentDir });
		}
		const slot = (name: SlotName): Slot => {
			const found = slots.get(name);
			if (!found) throw new Error(`unknown slot ${name}`);
			return found;
		};

		let phaseIndex = 0;
		const probePaths = (name: string): ProbePaths => {
			phaseIndex += 1;
			const base = join(workRoot, "probe", `${String(phaseIndex).padStart(2, "0")}-${name}`);
			return { dump: `${base}-dump.json`, systemPrompt: `${base}-system.jsonl` };
		};
		const markers = seedMarkers(marker);

		/** The production one-time backup, run before a slot's first default-route managed launch. */
		const backups: Array<{ slot: string; reason: string; destination?: string; byteSize: number; lines: string[] }> = [];
		const backedUp = new Set<SlotName>();
		const backUpBeforeLaunch = async (target: Slot): Promise<void> => {
			if (backedUp.has(target.name)) return;
			backedUp.add(target.name);
			const lines: string[] = [];
			const result = await backupAgentDirOnce({
				agentDir: target.agentDir,
				backupsDir: backupsDir(target.home),
				statePath: agentBackupStatePath(managedRoot(target.home)),
				io: { out: (line) => lines.push(line), err: (line) => lines.push(line) },
			});
			backups.push({
				slot: target.name,
				reason: result.reason,
				...(result.destination !== undefined ? { destination: result.destination } : {}),
				byteSize: result.byteSize,
				lines,
			});
			evidence.note(`backup ${target.name}: ${result.reason}${result.destination ? ` -> ${result.destination}` : ""}`);
		};

		const launchFor = async (slotName: SlotName, phaseName: string): Promise<HostLaunch> => {
			const target = slot(slotName);
			const isManaged = target.host === "managed";
			const probe = probePaths(phaseName);
			if (isManaged && options.managedRoute === "default") await backUpBeforeLaunch(target);
			return isManaged
				? managedLaunch({
						artifact: inputs.artifact,
						bundle: inputs.bundle,
						home: target.home,
						agentDir: target.agentDir,
						probe,
						markers,
						fakeUrl,
						...(options.managedRoute === "isolated" ? { sessionDir: managedSessionDir(target.agentDir) } : {}),
					})
				: forkLaunch({ binary: inputs.forkBinary, home: target.home, agentDir: target.agentDir, probe, markers, fakeUrl });
		};

		/** Run one host phase: optional model selection, optional session switch, then prompts, then the dump. */
		const runPhase = async (
			phaseName: string,
			slotName: SlotName,
			input: { sessionPath?: string; prompts: readonly string[]; routeModel?: boolean },
		): Promise<PhaseResult> => {
			const launch = await launchFor(slotName, phaseName);
			const requestsBefore = fakeProvider.requests.length;
			const stages: RpcStep[] = [];
			stages.push({
				requests: [{ id: "set-model", type: "set_model", provider: FILE_PROVIDER, modelId: FILE_MODEL }],
				timeoutMs: STAGE_MS,
			});
			if (input.sessionPath) {
				stages.push({
					requests: [{ id: "switch", type: "switch_session", sessionPath: input.sessionPath }],
					timeoutMs: STAGE_MS,
				});
			}
			let settled = 0;
			for (const prompt of input.prompts) {
				// The routing phase switches to the virtual model first, so the request goes through
				// `spirits/auto` and the host writes its routing-state entry.
				if (prompt === PROMPTS.route) {
					stages.push({
						requests: [{ id: "set-model-route", type: "set_model", provider: "spirits", modelId: "auto" }],
						timeoutMs: STAGE_MS,
					});
				}
				settled += 1;
				// Capture the count: a closure over the loop variable would make every stage wait for the
				// last phase's settlements and burn its whole timeout.
				const want = settled;
				stages.push({
					requests: [{ id: `prompt-${want}`, type: "prompt", message: prompt }],
					waitFor: (records) => records.filter((record) => record.type === "agent_settled").length >= want,
					timeoutMs: STAGE_MS,
				});
			}
			stages.push({ requests: [{ id: "dump", type: "prompt", message: "/adc-dump" }], timeoutMs: STAGE_MS });
			let probe;
			let error: string | undefined;
			const startedAt = Date.now();
			console.log(`phase ${phaseName} start (${stages.length} stages, host ${slot(slotName).host})`);
			try {
				await launch.verify();
				probe = await runStagedRpcProbe({ command: launch.command, cwd: project, env: launch.env, stages });
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
				probe = { records: [], stderr: error ?? "", exitCode: -1 };
			}
			if (DEBUG_RECORDS) {
				for (const record of probe.records) {
					console.log(`  ${phaseName} <- ${record.type}${record.command ? `:${record.command}` : ""}${record.success === false ? " FAILED" : ""}`);
				}
			}
			const dumpRaw = await Bun.file(launch.probe.dump).text().catch(() => undefined);
			const systemRaw = await Bun.file(launch.probe.systemPrompt).text().catch(() => "");
			const toolResults = probe.records
				.filter((record: RpcRecord) => record.type === "tool_execution_end")
				.map((record: RpcRecord) => ({
					tool: String(record.toolName ?? record.name ?? ""),
					isError: record.isError === true,
					text: typeof record.result === "string" ? record.result : JSON.stringify(record.result ?? ""),
				}));
			const requests: Array<{ kind?: string; model?: string }> = fakeProvider.requests
				.slice(requestsBefore)
				.map((request) => ({ kind: request.kind, model: request.model }));
			const markerHits: Record<string, boolean> = {};
			for (const text of markers) {
				markerHits[text] = fakeProvider.requests
					.slice(requestsBefore)
					.some((request) => JSON.stringify(request.body ?? "").includes(text));
			}
			const commandResults: Record<string, boolean> = {};
			for (const record of probe.records) {
				if (record.type !== "response" || !record.id) continue;
				commandResults[String(record.id)] = record.success === true;
			}
			const result: PhaseResult = {
				name: phaseName,
				requests,
				markerHits,
				commandResults,
				dump: dumpRaw ? (JSON.parse(dumpRaw) as Dump) : null,
				systemPrompt: systemRaw
					.split("\n")
					.filter((line: string) => line.trim().length > 0)
					.map((line: string) => JSON.parse(line) as { markers?: Record<string, boolean>; markerLines?: string[] }),
				toolResults,
				stderr: probe.stderr.slice(0, 2000),
				exitCode: probe.exitCode,
				records: probe.records.length,
			};
			if (error !== undefined) result.error = error;
			if (result.dump === null) evidence.broken.push(phaseName);
			console.log(
				`phase ${phaseName} done in ${Date.now() - startedAt}ms exit=${result.exitCode} records=${result.records} dump=${result.dump !== null} settled=${probe.records.filter((record) => record.type === "agent_settled").length}${result.stderr.trim() ? ` stderr=${redact(result.stderr).trim().slice(0, 300)}` : ""}${result.error ? ` error=${result.error}` : ""}`,
			);
			evidence.phases[phaseName] = {
				slot: slotName,
				command: launch.command,
				agentDir: slot(slotName).agentDir,
				prompts: input.prompts,
				sessionPath: input.sessionPath,
				requests: result.requests,
				markerHits: result.markerHits,
				commandResults: result.commandResults,
				exitCode: result.exitCode,
				records: result.records,
				stderr: redact(result.stderr),
				toolResults: result.toolResults.map((entry) => ({ ...entry, text: entry.text.slice(0, 900) })),
				systemPrompt: result.systemPrompt,
				dump: result.dump,
				...(result.error === undefined ? {} : { error: result.error }),
			};
			return result;
		};

		/** One real settings write by the host itself: `<host> install <local package>`. */
		const hostSettingsWrite = async (phaseName: string, slotName: SlotName): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
			const launch = await launchFor(slotName, `${phaseName}-settingswrite`);
			const localPkg = await createLocalPackage(join(workRoot, "localpkg"));
			const command = settingsWriteCommand(launch, localPkg);
			await launch.verify();
			const result = await runCommandProbe({ command, cwd: project, env: launch.env, timeoutMs: 120_000 });
			evidence.phases[`${phaseName}-settingswrite`] = {
				slot: slotName,
				command,
				exitCode: result.exitCode,
				stdout: redact(result.stdout.slice(0, 1500)),
				stderr: redact(result.stderr.slice(0, 1500)),
			};
			return result;
		};

		const snapshots: Record<string, FileRecord[]> = {};
		const takeSnapshot = async (name: string, slotName: SlotName): Promise<FileRecord[]> => {
			const records = await snapshotTree(slot(slotName).agentDir);
			snapshots[name] = records;
			await writeJsonFile(join(options.out, "snapshots", `${name}.json`), records.map(compactRecord));
			return records;
		};
		const diffOf = async (name: string, before: FileRecord[], slotName: SlotName): Promise<SnapshotDiff> => {
			const after = await takeSnapshot(name, slotName);
			const diff = diffSnapshots(before, after);
			evidence.phases[`${name}-diff`] = { from: before.length, to: after.length, lines: describeDiff(diff) };
			return diff;
		};

		// ------------------------------------------------------- direction A
		// A1: the fork creates the fixture agent dir, then writes settings with its own command.
		const slotA1 = slot("a1-fork-create");
		await writeSeedAgentDir(slotA1.agentDir, { fakeUrl, marker });
		const afterSeedA1 = await takeSnapshot("a1-seed", "a1-fork-create");
		const a1 = await runPhase("a1-fork-create", "a1-fork-create", {
			prompts: [PROMPTS.write, PROMPTS.rlm, PROMPTS.route, PROMPTS.read],
		});
		const diffA1 = await diffOf("a1-fork-write", afterSeedA1, "a1-fork-create");
		const beforeA1Settings = await takeSnapshot("a1-before-settingswrite", "a1-fork-create");
		const a1Settings = await hostSettingsWrite("a1-fork", "a1-fork-create");
		const diffA1Settings = await diffOf("a1-fork-settingswrite", beforeA1Settings, "a1-fork-create");
		// A settings baseline the other host can be compared against: the fork's own read of the tree
		// after its writer ran.
		const a1Baseline = await runPhase("a1-fork-after-install", "a1-fork-create", { prompts: [] });

		// A2: managed reads the fork's tree, then writes into it.
		const slotA2 = slot("a2-managed-readwrite");
		await cp(slotA1.agentDir, slotA2.agentDir, { recursive: true });
		const a2SessionPath = await newestSessionFile(slotA2.agentDir);
		const afterCopyA2 = await takeSnapshot("a2-copy-of-fork", "a2-managed-readwrite");
		// What the fork actually left in the session file, measured on disk before managed runs.
		const forkAuthored = await countCustomTypesInFile(a2SessionPath);
		// A fresh session sends the whole system prompt, which is built from the agent directory. That
		// is the read of `memory/`, `prompts/spirits/code-mode.md`, and `skills/`.
		const a2Fresh = await runPhase("a2-managed-fresh", "a2-managed-readwrite", { prompts: [PROMPTS.read] });
		const diffA2Fresh = await diffOf("a2-managed-fresh", afterCopyA2, "a2-managed-readwrite");
		// A loaded session is the read of the fork's session entries and of auth and models.
		const beforeA2Loaded = await takeSnapshot("a2-before-loaded", "a2-managed-readwrite");
		const a2Read = await runPhase("a2-managed-loaded", "a2-managed-readwrite", {
			sessionPath: a2SessionPath,
			prompts: [PROMPTS.read],
		});
		const diffA2Read = await diffOf("a2-managed-loaded", beforeA2Loaded, "a2-managed-readwrite");
		const beforeA2Write = await takeSnapshot("a2-before-write", "a2-managed-readwrite");
		await runPhase("a2-managed-write", "a2-managed-readwrite", {
			sessionPath: a2SessionPath,
			prompts: [PROMPTS.write, PROMPTS.rlm, PROMPTS.route],
		});
		const diffA2Write = await diffOf("a2-managed-write", beforeA2Write, "a2-managed-readwrite");
		const beforeA2Settings = await takeSnapshot("a2-before-settingswrite", "a2-managed-readwrite");
		const a2Settings = await hostSettingsWrite("a2-managed", "a2-managed-readwrite");
		const diffA2Settings = await diffOf("a2-managed-settingswrite", beforeA2Settings, "a2-managed-readwrite");

		// A3: the fork reads the managed result back.
		const slotA3 = slot("a3-fork-reread");
		await cp(slotA2.agentDir, slotA3.agentDir, { recursive: true });
		const a3SessionPath = await newestSessionFile(slotA3.agentDir);
		const afterCopyA3 = await takeSnapshot("a3-copy-of-managed", "a3-fork-reread");
		const a3 = await runPhase("a3-fork-reread", "a3-fork-reread", { sessionPath: a3SessionPath, prompts: [PROMPTS.read] });
		const diffA3 = await diffOf("a3-fork-reread", afterCopyA3, "a3-fork-reread");

		// ------------------------------------------------------- direction B
		// B1: managed creates the fixture agent dir, then writes settings with its own command.
		const slotB1 = slot("b1-managed-create");
		await writeSeedAgentDir(slotB1.agentDir, { fakeUrl, marker });
		const afterSeedB1 = await takeSnapshot("b1-seed", "b1-managed-create");
		const b1 = await runPhase("b1-managed-create", "b1-managed-create", {
			prompts: [PROMPTS.write, PROMPTS.rlm, PROMPTS.route, PROMPTS.read],
		});
		const diffB1 = await diffOf("b1-managed-write", afterSeedB1, "b1-managed-create");
		const beforeB1Settings = await takeSnapshot("b1-before-settingswrite", "b1-managed-create");
		const b1Settings = await hostSettingsWrite("b1-managed", "b1-managed-create");
		const diffB1Settings = await diffOf("b1-managed-settingswrite", beforeB1Settings, "b1-managed-create");
		const b1Baseline = await runPhase("b1-managed-after-install", "b1-managed-create", { prompts: [] });

		// B2: the fork reads the managed tree, then writes into it.
		const slotB2 = slot("b2-fork-readwrite");
		await cp(slotB1.agentDir, slotB2.agentDir, { recursive: true });
		const b2SessionPath = await newestSessionFile(slotB2.agentDir);
		const afterCopyB2 = await takeSnapshot("b2-copy-of-managed", "b2-fork-readwrite");
		const managedAuthored = await countCustomTypesInFile(b2SessionPath);
		const b2Fresh = await runPhase("b2-fork-fresh", "b2-fork-readwrite", { prompts: [PROMPTS.read] });
		const diffB2Fresh = await diffOf("b2-fork-fresh", afterCopyB2, "b2-fork-readwrite");
		const beforeB2Loaded = await takeSnapshot("b2-before-loaded", "b2-fork-readwrite");
		const b2Read = await runPhase("b2-fork-loaded", "b2-fork-readwrite", {
			sessionPath: b2SessionPath,
			prompts: [PROMPTS.read],
		});
		const diffB2Read = await diffOf("b2-fork-loaded", beforeB2Loaded, "b2-fork-readwrite");
		const beforeB2Write = await takeSnapshot("b2-before-write", "b2-fork-readwrite");
		await runPhase("b2-fork-write", "b2-fork-readwrite", {
			sessionPath: b2SessionPath,
			prompts: [PROMPTS.write, PROMPTS.rlm, PROMPTS.route],
		});
		const diffB2Write = await diffOf("b2-fork-write", beforeB2Write, "b2-fork-readwrite");
		const beforeB2Settings = await takeSnapshot("b2-before-settingswrite", "b2-fork-readwrite");
		const b2Settings = await hostSettingsWrite("b2-fork", "b2-fork-readwrite");
		const diffB2Settings = await diffOf("b2-fork-settingswrite", beforeB2Settings, "b2-fork-readwrite");

		// B3: managed reads the fork result back.
		const slotB3 = slot("b3-managed-reread");
		await cp(slotB2.agentDir, slotB3.agentDir, { recursive: true });
		const b3SessionPath = await newestSessionFile(slotB3.agentDir);
		const afterCopyB3 = await takeSnapshot("b3-copy-of-fork", "b3-managed-reread");
		const b3 = await runPhase("b3-managed-reread", "b3-managed-reread", { sessionPath: b3SessionPath, prompts: [PROMPTS.read] });
		const diffB3 = await diffOf("b3-managed-reread", afterCopyB3, "b3-managed-reread");

		// -------------------------------------------------- settings test writes
		// The documented test write (see settings-write.ts) stands in for the extension-side write the
		// product does not have yet. The values are then read by the other host, and the other host's
		// own writer has to preserve them.
		const testWriteKeys: Record<string, unknown> = {
			defaultProvider: FILE_PROVIDER,
			defaultModel: FILE_MODEL,
			defaultThinkingLevel: "medium",
			adcSpiritsKey: { origin: "test-write", marker },
			// A key no seed writes, so `addedKeys` proves a brand-new spirits-owned key is read by the
			// other host and kept by its writer.
			adcTestKey: { origin: "test-write", marker },
		};
		const testWriteNested = { models: { strong: `${FILE_PROVIDER}/${STRONG_MODEL}`, role: "strong" } };

		/** The settings values a probe dump reports, for the keys the investigation tracks. */
		const defaultValuesOf = (settings: unknown): Record<string, unknown> => ({
			defaultProvider: settingValue(settings, "defaultProvider"),
			defaultModel: settingValue(settings, "defaultModel"),
			defaultThinkingLevel: settingValue(settings, "defaultThinkingLevel"),
			models: settingValue(settings, "models"),
			adcSpiritsKey: settingValue(settings, "adcSpiritsKey"),
			adcTestKey: settingValue(settings, "adcTestKey"),
		});

		/**
		 * Test-write on one host's tree, copy the tree to the other host, read it there, then let that
		 * host write the file with its own command and read the file again.
		 */
		const settingsRoundTrip = async (input: {
			phase: string;
			sourceSlot: SlotName;
			targetSlot: SlotName;
		}): Promise<Record<string, unknown>> => {
			const sourcePath = join(slot(input.sourceSlot).agentDir, "settings.json");
			const written = testSettingsWrite(sourcePath, { fields: testWriteKeys, nested: testWriteNested });
			await cp(slot(input.sourceSlot).agentDir, slot(input.targetSlot).agentDir, { recursive: true });
			const readPhase = await runPhase(`${input.phase}-other-reads`, input.targetSlot, { prompts: [] });
			const install = await hostSettingsWrite(input.phase, input.targetSlot);
			const targetPath = join(slot(input.targetSlot).agentDir, "settings.json");
			const afterText = readSettings(targetPath) ?? "";
			const afterJson = (afterText.trim() ? JSON.parse(afterText) : {}) as Record<string, unknown>;
			const writtenKeys = Object.keys(JSON.parse(written.after) as Record<string, unknown>);
			return {
				fromSlot: input.sourceSlot,
				toSlot: input.targetSlot,
				testWrite: { addedKeys: written.addedKeys, removedKeys: written.removedKeys },
				writtenValues: defaultValuesOf(JSON.parse(written.after) as Record<string, unknown>),
				readByOtherHost: readPhase.dump ? defaultValuesOf(readPhase.dump.settings) : null,
				otherWriterCommand: `install <local package>`,
				otherWriterExit: install.exitCode,
				valuesAfterOtherWriter: defaultValuesOf(afterJson),
				survival: keySurvival(writtenKeys, Object.keys(afterJson), TRACKED_SETTINGS_KEYS),
				settingsTextAfter: afterText,
			};
		};

		// fork -> managed: the test write lands on the fork-created tree, managed reads and writes it.
		const twA = await settingsRoundTrip({
			phase: "tw-fork-to-managed",
			sourceSlot: "a3-fork-reread",
			targetSlot: "tw-a-managed",
		});
		// managed -> fork: the test write lands on the managed-created tree, fork reads and writes it.
		const twB = await settingsRoundTrip({
			phase: "tw-managed-to-fork",
			sourceSlot: "b3-managed-reread",
			targetSlot: "tw-b-fork",
		});

		// ------------------------------------------------------------ verdicts
		/** Compare one settings object across hosts. */
		const settingsItem = (
			name: string,
			direction: "forkToManaged" | "managedToFork",
			baseline: Dump | null,
			observed: Dump | null,
			why: string,
		): void => {
			if (!baseline || !observed) {
				recordDirection(name, direction, "not-run", `${why}: a dump is missing`);
				return;
			}
			const equal = settingsEqual(baseline.settings, observed.settings);
			const missingTracked = TRACKED_SETTINGS_KEYS.filter((key) => !(observed.settingsKeys ?? []).includes(key));
			const ok = equal.ok && missingTracked.length === 0;
			recordDirection(
				name,
				direction,
				ok ? "compatible" : "incompatible",
				ok
					? `${why}: ${observed.settingsKeys?.length ?? 0} keys read, tracked keys all present`
					: `${why}: differing keys ${equal.differingKeys.join(",") || "none"}; missing tracked keys ${missingTracked.join(",") || "none"}`,
				{ differingKeys: equal.differingKeys, missingTracked, observedKeys: observed.settingsKeys },
			);
		};

		/** Compare session entries across hosts. */
		const sessionsItem = (
			name: string,
			direction: "forkToManaged" | "managedToFork",
			baseline: Dump | null,
			observed: Dump | null,
			why: string,
		): void => {
			if (!baseline || !observed) {
				recordDirection(name, direction, "not-run", `${why}: a dump is missing`);
				return;
			}
			const comparison = compareEntries(baseline.session?.entries ?? [], observed.session?.entries ?? []);
			recordDirection(
				name,
				direction,
				comparison.ok ? "compatible" : "incompatible",
				comparison.ok
					? `${why}: ${comparison.compared} entries read back identical, custom types ${JSON.stringify(customEntryCounts(observed.session?.byType))}`
					: `${why}: ${comparison.missing.length} entries missing, ${comparison.mismatches.length} mismatched`,
				comparison,
			);
		};

		const directionPairs = new Map<string, { forkToManaged: DirectionResult[]; managedToFork: DirectionResult[]; details: string[]; data: unknown[] }>();

		/** Record a per-direction result; the overall label is computed when the item is flushed. */
		function recordDirection(
			name: string,
			direction: "forkToManaged" | "managedToFork",
			result: DirectionResult,
			detail: string,
			data?: unknown,
		): void {
			const pair = directionPairs.get(name) ?? { forkToManaged: [], managedToFork: [], details: [], data: [] };
			pair[direction].push(result);
			pair.details.push(`${direction}: ${detail}`);
			if (data !== undefined) pair.data.push({ direction, data });
			directionPairs.set(name, pair);
		}

		function flushDirections(): void {
			for (const [name, pair] of directionPairs) {
				const fold = (results: DirectionResult[]): DirectionResult =>
					results.length === 0
						? "not-run"
						: results.includes("incompatible")
							? "incompatible"
							: results.every((entry) => entry === "compatible")
								? "compatible"
								: "not-run";
				evidence.record(name, fold(pair.forkToManaged), fold(pair.managedToFork), pair.details.join(" | "), pair.data);
			}
		}

		// settings.json read, both directions
		settingsItem(
			"settings.json read",
			"forkToManaged",
			a1Baseline.dump,
			a2Read.dump,
			"managed read the fork's settings through getSettings()",
		);
		settingsItem(
			"settings.json read",
			"managedToFork",
			b1Baseline.dump,
			b2Read.dump,
			"fork read the managed settings through getSettings()",
		);

		// sessions read, both directions (read pass of the other host's tree)
		sessionsItem("sessions read", "forkToManaged", a1.dump, a2Read.dump, "managed loaded the fork session");
		sessionsItem("sessions read", "managedToFork", b1.dump, b2Read.dump, "fork loaded the managed session");

		// sessions rewritten by the other host (append-only, no version rewrite)
		const sessionRewrite = (
			name: string,
			direction: "forkToManaged" | "managedToFork",
			diff: SnapshotDiff,
			sessionPath?: string,
		): void => {
			if (!sessionPath) {
				recordDirection(name, direction, "not-run", "no session file was found to append to");
				return;
			}
			const relative = sessionPath.slice(slot(direction === "forkToManaged" ? "a2-managed-readwrite" : "b2-fork-readwrite").agentDir.length + 1);
			const change = diff.modified.find((entry) => entry.path === relative);
			const removed = diff.removed.filter((path) => path.startsWith("sessions/"));
			if (!change) {
				recordDirection(name, direction, "compatible", `${relative} was not modified at all`, { removed });
				return;
			}
			const appended = change.jsonl?.prefixKept === true && (change.jsonl?.removed ?? 0) === 0;
			recordDirection(
				name,
				direction,
				appended && removed.length === 0 ? "compatible" : "incompatible",
				appended
					? `${relative} grew by ${change.jsonl?.added ?? 0} entries with every earlier line byte-identical`
					: `${relative} was rewritten (first divergence ${change.jsonl?.firstDivergence}, removed lines ${change.jsonl?.removed ?? 0}, removed session files ${removed.length})`,
				{ relative, change, removed },
			);
		};
		sessionRewrite("sessions rewrite (append-only)", "forkToManaged", diffA2Write, a2SessionPath);
		sessionRewrite("sessions rewrite (append-only)", "managedToFork", diffB2Write, b2SessionPath);

		// auth.json read, both directions
		const authRead = (name: string, direction: "forkToManaged" | "managedToFork", dump: Dump | null, why: string): void => {
			if (!dump) {
				recordDirection(name, direction, "not-run", `${why}: no dump`);
				return;
			}
			const status = (provider: string): { configured?: boolean; source?: string } | null =>
				(dump.auth?.[provider] as { configured?: boolean; source?: string } | null) ?? null;
			const stored = status(FILE_PROVIDER);
			const storedOnly = status(STORED_ONLY_PROVIDER);
			const absent = status(ABSENT_PROVIDER);
			const ok = stored?.configured === true && storedOnly?.configured === true && absent?.configured !== true;
			recordDirection(
				name,
				direction,
				ok ? "compatible" : "incompatible",
				ok ? `${why}: auth.json entries reported as configured, control provider reported unconfigured` : `${why}: unexpected statuses`,
				{ stored, storedOnly, absent },
			);
		};
		authRead("auth.json read", "forkToManaged", a2Read.dump, "managed read the fork-side auth.json");
		authRead("auth.json read", "managedToFork", b2Read.dump, "fork read the managed-side auth.json");

		// models.json read, both directions (provider came from the file, not from the extension)
		// The extension registers its own provider with a distinct model id, so a request that names
		// FILE_MODEL can only have come from a provider defined in models.json.
		const modelsRead = (
			name: string,
			direction: "forkToManaged" | "managedToFork",
			phase: PhaseResult,
			why: string,
		): void => {
			const dump = phase.dump;
			if (!dump) {
				recordDirection(name, direction, "not-run", `${why}: no dump`);
				return;
			}
			const wanted = [`${FILE_PROVIDER}/${FILE_MODEL}`, `${FILE_PROVIDER}/fake-strong`];
			const present = wanted.every((model) => (dump.models ?? []).includes(model));
			const used = phase.requests.some((request) => request.model === FILE_MODEL);
			const ok = present && used;
			recordDirection(
				name,
				direction,
				ok ? "compatible" : "incompatible",
				ok
					? `${why}: both models.json models are listed and ${phase.requests.length} provider request(s) named ${FILE_MODEL}`
					: `${why}: listed=${present} requestNamedFileModel=${used}, models ${JSON.stringify(dump.models)} requests ${JSON.stringify(phase.requests)}`,
				{ models: dump.models, requests: phase.requests },
			);
		};
		modelsRead("models.json read", "forkToManaged", a2Read, "managed resolved the provider from models.json");
		modelsRead("models.json read", "managedToFork", b2Read, "fork resolved the provider from models.json");

		// spirits-owned session entries, both directions
		const spiritsEntryItem = (
			name: string,
			customType: string,
			forkToManaged: DirectionResult,
			managedToFork: DirectionResult,
			detail: string,
			data?: unknown,
		): void => {
			evidence.record(`${name} (${customType})`, forkToManaged, managedToFork, detail, data);
		};

		const countsA2 = customEntryCounts(a2Read.dump?.session?.byType);
		const countsA3 = customEntryCounts(a3.dump?.session?.byType);
		const countsB2 = customEntryCounts(b2Read.dump?.session?.byType);
		const countsB3 = customEntryCounts(b3.dump?.session?.byType);

		/** A custom entry type is compatible when the other host loaded it unchanged. */
		const entryTypeResult = (
			authored: Record<string, number>,
			observed: Dump | null,
			customType: string,
		): DirectionResult => {
			const before = authored[customType] ?? 0;
			if (!observed || before === 0) return "not-run";
			return (customEntryCounts(observed.session?.byType)[customType] ?? 0) >= before ? "compatible" : "incompatible";
		};

		for (const [name, customType] of [
			["goal entry", "spirits_goal"],
			["todo entry", "spirits_todo"],
			["memory entry", "spirits_memory"],
			["tsrepl cell entry", "tsrepl_cell"],
			["rlm usage entry", "rlm_usage"],
			["routing state entry", "pi.virtual-model-state"],
		] as const) {
			const forkToManaged = entryTypeResult(forkAuthored, a2Read.dump, customType);
			const managedToFork = entryTypeResult(managedAuthored, b2Read.dump, customType);
			const authoringNote =
				(managedAuthored[customType] ?? 0) > 0 || !ENTRY_AUTHORING_NOTES[customType]
					? ""
					: `; managed authored none because ${ENTRY_AUTHORING_NOTES[customType]}`;
			spiritsEntryItem(
				name,
				customType,
				forkToManaged,
				managedToFork,
				`authored on disk fork=${forkAuthored[customType] ?? 0} managed=${managedAuthored[customType] ?? 0}; read by the other host managed=${countsA2[customType]} fork=${countsB2[customType]}; read back after both hosts wrote fork=${countsA3[customType]} managed=${countsB3[customType]}${authoringNote}`,
				{
					forkAuthored,
					managedAuthored,
					a2Read: countsA2,
					a3Read: countsA3,
					b2Read: countsB2,
					b3Read: countsB3,
				},
			);
		}

		// memory file and code-mode prompt, proven by the request body of a fresh session on the other
		// host: a fresh session sends the whole system prompt, which is built from the agent directory.
		const memoryLine = `adc memory line ${marker}`;
		const promptLine = `adc code-mode override ${marker}`;
		const promptReadItem = (
			name: string,
			markerText: string,
			forkToManaged: PhaseResult,
			managedToFork: PhaseResult,
		): void => {
			const forward = forkToManaged.markerHits[markerText] === true;
			const backward = managedToFork.markerHits[markerText] === true;
			recordDirection(
				name,
				"forkToManaged",
				forward ? "compatible" : "incompatible",
				`${name}: the line written by the fork reaches the managed system prompt: ${forward} (${forkToManaged.requests.length} request(s) inspected)`,
				{ requests: forkToManaged.requests, markerHits: forkToManaged.markerHits },
			);
			recordDirection(
				name,
				"managedToFork",
				backward ? "compatible" : "incompatible",
				`${name}: the line written by managed reaches the fork system prompt: ${backward} (${managedToFork.requests.length} request(s) inspected)`,
				{ requests: managedToFork.requests, markerHits: managedToFork.markerHits },
			);
		};
		promptReadItem("memory/notes.md read (system prompt)", memoryLine, a2Fresh, b2Fresh);
		promptReadItem("prompts/spirits/code-mode.md read (system prompt)", promptLine, a2Fresh, b2Fresh);

		// skills saved by one host, listed by the other
		const skillRead = (dump: Dump | null, toolResults: PhaseResult["toolResults"]): { listed: boolean; command: boolean } => {
			const listedText = toolResults.map((entry) => entry.text).join("\n");
			return {
				listed: listedText.includes("adc-probe-skill") || JSON.stringify(dump?.commands ?? []).includes("adc-probe-skill"),
				command: (dump?.commands ?? []).some((command) => command.includes("adc-probe-skill")),
			};
		};
		const skillA = skillRead(a2Fresh.dump, a2Fresh.toolResults);
		const skillB = skillRead(b2Fresh.dump, b2Fresh.toolResults);
		evidence.record(
			"skills/ read",
			skillA.listed ? "compatible" : "incompatible",
			skillB.listed ? "compatible" : "incompatible",
			`the skill saved by one host is listed by the other: fork->managed ${JSON.stringify(skillA)}, managed->fork ${JSON.stringify(skillB)}`,
			{ forkToManaged: skillA, managedToFork: skillB },
		);

		// goal read back through the product's own reader
		const goalRead = (phase: PhaseResult): { ok: boolean; text: string } => {
			const text = phase.toolResults.map((entry) => entry.text).join("\n");
			return { ok: text.includes(`adc goal ${marker}`), text: text.slice(0, 400) };
		};
		const goalA = goalRead(a2Read);
		const goalB = goalRead(b2Read);
		evidence.record(
			"goal() read",
			goalA.ok ? "compatible" : "incompatible",
			goalB.ok ? "compatible" : "incompatible",
			`goal() returned the other host's goal: fork->managed ${goalA.ok}, managed->fork ${goalB.ok}`,
			{ forkToManaged: goalA, managedToFork: goalB },
		);

		// settings test write and survival of the other host's real writer
		/** A round trip is compatible when the other host read the values and its writer kept the keys. */
		const roundTripResult = (roundTrip: Record<string, unknown>): DirectionResult => {
			const read = roundTrip.readByOtherHost as Record<string, unknown> | null;
			const writtenValues = roundTrip.writtenValues as Record<string, unknown>;
			const after = roundTrip.valuesAfterOtherWriter as Record<string, unknown>;
			const survival = roundTrip.survival as { ok: boolean; missing: string[] };
			if (!read) return "not-run";
			const valuesKept = TRACKED_SETTINGS_KEYS.every((key) =>
				["defaultProvider", "defaultModel", "defaultThinkingLevel", "models", "adcSpiritsKey", "adcTestKey"].includes(
					key,
				)
					? JSON.stringify(read[key]) === JSON.stringify(writtenValues[key]) &&
						JSON.stringify(after[key]) === JSON.stringify(writtenValues[key])
					: true,
			);
			return survival.ok && valuesKept ? "compatible" : "incompatible";
		};
		evidence.record(
			"settings.json test write: read by the other host and kept by its writer",
			roundTripResult(twA),
			roundTripResult(twB),
			"the test write uses Pi's own procedure (proper-lockfile lock, migrate, merge modified fields, 2-space rewrite); the other host then reads the file and writes it with `install <local package>`",
			{ forkTreeToManaged: twA, managedTreeToFork: twB },
		);

		// real writer behaviour on the settings file itself. `install <local package dir>` is the only
		// headless settings write either host exposes: it persists the settings file through the host's
		// own SettingsManager (proper-lockfile lock, migrate, merge, 2-space rewrite).
		const writerSurvival = (diff: SnapshotDiff): { ok: boolean; removed: string[]; changed: string[]; added: string[] } => {
			const change = diff.modified.find((entry) => entry.path === "settings.json");
			if (!change) return { ok: true, removed: [], changed: [], added: [] };
			const delta = change.json ?? { added: [], removed: [], changed: [] };
			const tracked = (key: string): boolean =>
				TRACKED_SETTINGS_KEYS.some((trackedKey) => key === trackedKey || key.startsWith(`${trackedKey}.`));
			const removed = delta.removed.filter(tracked);
			const changed = delta.changed.filter(tracked);
			return { ok: removed.length === 0 && changed.length === 0, removed, changed, added: delta.added };
		};
		// the same four writes, in raw diff form
		const writerRaw = {
			exitCodes: { a1: a1Settings.exitCode, a2: a2Settings.exitCode, b1: b1Settings.exitCode, b2: b2Settings.exitCode },
			forkWriterOnForkTree: { exitCode: a1Settings.exitCode, lines: describeDiff(diffA1Settings) },
			officialWriterOnForkTree: { exitCode: a2Settings.exitCode, lines: describeDiff(diffA2Settings) },
			officialWriterOnManagedTree: { exitCode: b1Settings.exitCode, lines: describeDiff(diffB1Settings) },
			forkWriterOnManagedTree: { exitCode: b2Settings.exitCode, lines: describeDiff(diffB2Settings) },
		};

		const officialOnFork = writerSurvival(diffA2Settings);
		const forkOnManaged = writerSurvival(diffB2Settings);
		const forkOnFork = writerSurvival(diffA1Settings);
		const officialOnManaged = writerSurvival(diffB1Settings);
		evidence.record(
			"settings.json real writer diff",
			forkOnFork.ok && officialOnFork.ok ? "compatible" : "incompatible",
			officialOnManaged.ok && forkOnManaged.ok ? "compatible" : "incompatible",
			`each host's own settings writer ran over a tree written by each host and kept every tracked key: fork-writes-fork-tree ${JSON.stringify(forkOnFork)}, official-writes-fork-tree ${JSON.stringify(officialOnFork)}, official-writes-managed-tree ${JSON.stringify(officialOnManaged)}, fork-writes-managed-tree ${JSON.stringify(forkOnManaged)}`,
			{
				forkOnForkTree: forkOnFork,
				officialOnForkTree: officialOnFork,
				officialOnManagedTree: officialOnManaged,
				forkOnManagedTree: forkOnManaged,
				raw: writerRaw,
			},
		);

		// writes neither host can perform headlessly
		const credentialApis = {
			fork: a1.dump?.apis ?? null,
			managed: b1.dump?.apis ?? null,
		};
		evidence.record(
			"auth.json write",
			"not-run",
			"not-run",
			"pi writes auth.json only from the interactive `/login` flow; the RPC protocol and the extension API expose no credential write, so no headless product write path exists",
			{ credentialApis, authUnchangedAcrossRuns: { a2: diffA2Read.removed.length === 0, b2: diffB2Read.removed.length === 0 } },
		);
		evidence.record(
			"models.json write",
			"not-run",
			"not-run",
			"neither host wrote models.json during any phase; the file is user-authored and no headless product write path was observed",
			{
				untouchedByFork: !diffA2Write.modified.some((entry) => entry.path === "models.json") && !diffA1.modified.some((entry) => entry.path === "models.json"),
				untouchedByManaged: !diffB2Write.modified.some((entry) => entry.path === "models.json") && !diffB1.modified.some((entry) => entry.path === "models.json"),
			},
		);
		const modelsStoreSeen = [
			"snapshots/a1-fork-write.json",
			"snapshots/b1-managed-write.json",
		].filter((path) => snapshots[path.replace("snapshots/", "").replace(".json", "")]?.some((entry) => entry.path === "models-store.json"));
		evidence.record(
			"models-store.json",
			"not-run",
			"not-run",
			modelsStoreSeen.length === 0
				? "no host created or changed models-store.json in any phase (the fake provider has no dynamic catalog refresh)"
				: "observed but not exercised",
			{ snapshotsWherePresent: modelsStoreSeen },
		);
		evidence.record(
			"trust.json",
			"not-run",
			"not-run",
			"project trust is granted interactively; no phase created or changed trust.json",
			{
				present: Object.entries(snapshots)
					.filter(([, records]) => records.some((entry) => entry.path === "trust.json"))
					.map(([name]) => name),
			},
		);
		const bundledVersions = (records: readonly FileRecord[] | undefined): string[] =>
			[
				...new Set(
					(records ?? [])
						.filter((entry) => entry.path.startsWith("bundled-skills/") && entry.type === "dir")
						.map((entry) => entry.path.split("/")[1] ?? ""),
				),
			]
				.filter((version) => version.length > 0)
				.sort();
		const bundledUntouched = (diff: SnapshotDiff): boolean =>
			![...diff.modified.map((change) => change.path), ...diff.removed].some((path) => path.startsWith("bundled-skills/"));
		const forkBundled = bundledVersions(afterCopyA2);
		const managedBundled = bundledVersions(afterCopyB2);
		const bundledAfterManaged = bundledVersions(snapshots["a2-managed-write"]);
		const bundledAfterFork = bundledVersions(snapshots["b2-fork-write"]);
		const bundledKeptFork = forkBundled.every((version) => bundledAfterManaged.includes(version));
		const bundledKeptManaged = managedBundled.every((version) => bundledAfterFork.includes(version));
		evidence.record(
			"bundled-skills/ coexistence",
			bundledKeptFork && bundledUntouched(diffA2Fresh) && bundledUntouched(diffA2Write) ? "compatible" : "incompatible",
			bundledKeptManaged && bundledUntouched(diffB2Fresh) && bundledUntouched(diffB2Write) ? "compatible" : "incompatible",
			`each host writes only its own version directory and leaves the other's byte-identical (fork=${JSON.stringify(forkBundled)}, bundle=${JSON.stringify(managedBundled)}). Neither host reads the other's version directory, so a leftover tree is inert rather than wrong.`,
			{
				forkVersions: forkBundled,
				managedVersions: managedBundled,
				afterManaged: bundledAfterManaged,
				afterFork: bundledAfterFork,
			},
		);

		// isolation of the operator's real data
		const realAfter = await fingerprintTree(realAgentDir);
		const realUnchanged = realBefore === realAfter;
		evidence.record(
			"operator agent dir untouched",
			realUnchanged ? "compatible" : "incompatible",
			realUnchanged ? "compatible" : "incompatible",
			realUnchanged
				? `${realAgentDir} kept its content and modification times across every phase (sessions/ excluded: this runner's own session transcript lives there)`
				: `${realAgentDir} changed during the run (sessions/ excluded)`,

			{ realAgentDir, fingerprintBefore: createHash("sha256").update(realBefore).digest("hex").slice(0, 16), fingerprintAfter: createHash("sha256").update(realAfter).digest("hex").slice(0, 16) },
		);

		flushDirections();

		// ---------------------------------------------------------------- output
		const unexpected = unexpectedRequests(fakeProvider.requests, marker);
		const providerRequests = fakeProvider.requests.map((request: FakeProviderRequest) => ({
			kind: request.kind,
			model: request.model,
			receivedAt: request.receivedAt,
			respondedAt: request.respondedAt,
		}));

		const result = {
			title: "agent-dir compatibility: fork (spirits 0.6.0) vs managed (official Pi 1.5.0 + spirits bundle)",
			generatedAt: new Date().toISOString(),
			managedRoute: options.managedRoute,
			defaultRouteBackups: backups,
			runner: {
				commit: run.commit,
				tag: run.tag,
				diffSha256: run.diffSha256,
				untracked: run.untracked,
				clean: run.clean,
				bun: run.bun,
				script: "scripts/agent-data-compat/run.ts",
			},
			binaries: {
				fork: { path: inputs.forkBinary, sha256: inputs.forkSha256, version: inputs.forkVersion },
				managed: {
					piVersion: inputs.identity.piVersion,
					artifactSha256: inputs.identity.artifactSha256,
					executableSha256: inputs.identity.executableSha256,
					bundle: inputs.bundle,
					bundleSha256: inputs.bundleSha256,
					manifestSha256: inputs.identity.manifestSha256,
					overlayVersion: inputs.identity.overlayVersion,
					overlaySha256: inputs.identity.overlaySha256,
					setId: inputs.identity.manifestSetId,
				},
			},
			settingsWriterFidelity: fidelity,
			marker,
			verdictLabels: {
				compatible: "the other host read/wrote the data without loss",
				incompatible: "the other host lost, changed, or refused the data",
				"not-run": "no observation was possible; never counted as success",
				overall: "双方向で互換 / 片方向のみ / 互換なし / not-run",
			},
			notes: evidence.notes,
			items: evidence.items,
			phases: evidence.phases,
			fakeProvider: {
				requests: providerRequests,
				unexpected,
				note: "local OpenAI-compatible endpoint only; no real credential and no external endpoint",
			},
			workRoot,
		};
		await writeJsonFile(join(options.out, "result.json"), result);
		await writeFile(
			join(options.out, "summary.md"),
			renderSummary({
				result,
				items: evidence.items,
				phases: evidence.phases as Record<string, { exitCode?: number; stderr?: string }>,
				diffA1,
				diffA2Fresh,
				diffA2Read,
				diffA2Write,
				diffA3,
				diffB1,
				diffB2Fresh,
				diffB2Read,
				diffB2Write,
				diffB3,
				settings: {
					forkTreeToManaged: twA,
					managedTreeToFork: twB,
					writerDiffs: {
						forkOnFork: describeDiff(diffA1Settings),
						officialOnFork: describeDiff(diffA2Settings),
						officialOnManaged: describeDiff(diffB1Settings),
						forkOnManaged: describeDiff(diffB2Settings),
					},
				},
			}),
			"utf-8",
		);
		console.log(`evidence: ${options.out}`);
		console.log(`items: ${evidence.items.length}, phases: ${Object.keys(evidence.phases).length}, unexpected provider requests: ${unexpected}`);
		for (const failure of failures) console.error(failure);
		if (!options.keep) {
			// Snapshots and dumps are already copied into the evidence directory.
			await rm(workRoot, { recursive: true, force: true });
		} else {
			console.log(`work root kept: ${workRoot}`);
		}
		return failures.length > 0 ? 1 : 0;
	} catch (error) {
		console.error(`run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
		return 1;
	} finally {
		fakeProvider.stop();
	}
}

/** Whether a host phase saw the role API on the extension surface. */
function roleApiOf(input: { result: Record<string, unknown> }, phaseName: string): unknown {
	const phases = (input.result.phases ?? {}) as Record<string, { dump?: { apis?: Record<string, unknown> } }>;
	return phases[phaseName]?.dump?.apis?.registerModelRoles;
}

/** Render the human-readable summary. */
function renderSummary(input: {
	result: Record<string, unknown>;
	items: readonly Item[];
	phases: Record<string, { exitCode?: number; stderr?: string }>;
	diffA1: SnapshotDiff;
	diffA2Fresh: SnapshotDiff;
	diffA2Read: SnapshotDiff;
	diffA2Write: SnapshotDiff;
	diffA3: SnapshotDiff;
	diffB1: SnapshotDiff;
	diffB2Fresh: SnapshotDiff;
	diffB2Read: SnapshotDiff;
	diffB2Write: SnapshotDiff;
	diffB3: SnapshotDiff;
	settings: unknown;
}): string {
	const runner = (input.result.runner ?? {}) as Record<string, unknown>;
	const binaries = (input.result.binaries ?? {}) as Record<string, Record<string, string>>;
	const fidelity = (input.result.settingsWriterFidelity ?? {}) as { identical?: boolean; regions?: Array<{ name: string; identical: boolean }> };
	const managedRoute = String(input.result.managedRoute ?? "isolated");
	const backups = (input.result.defaultRouteBackups ?? []) as Array<{
		slot: string;
		reason: string;
		byteSize: number;
		destination?: string;
	}>;
	const routeLine =
		managedRoute === "default"
			? "既定経路 — agent dir は fork と同じ規則 (`~/.spirits/agent`)、session dir は pin せず Pi の既定配置、初回起動前に製品コードの一度きりバックアップを実行する"
			: "隔離経路 (`spirits managed-pi`) — agent dir は managed root 配下、session dir は pin";
	const lines: string[] = [
		"# agent-dir 読み書き互換 実測結果",
		"",
		"fork (spirits 0.6.0) と managed (公式 Pi 1.5.0 + spirits 拡張 bundle) のあいだの、既存",
		"`~/.spirits/agent` 形式データの双方向互換の実測。ランナーは製品コード・ガード・経路を変えずに観察する。",
		"実データ・実認証・実 provider は不使用（ローカル fake provider と隔離 HOME）。",
		"",
		`- 測定した経路: ${routeLine}`,
		`- runner commit: \`${String(runner.commit ?? "")}\` (tag ${String(runner.tag ?? "")}, diff sha256 \`${String(runner.diffSha256 ?? "")}\`, clean=${String(runner.clean ?? "")})`,
		`- fork binary: \`${binaries.fork?.path ?? ""}\` sha256 \`${binaries.fork?.sha256 ?? ""}\` (${binaries.fork?.version ?? ""})`,
		`- official pi ${binaries.managed?.piVersion ?? ""} tarball \`${binaries.managed?.artifactSha256 ?? ""}\` executable \`${binaries.managed?.executableSha256 ?? ""}\``,
		`- extension bundle \`${binaries.managed?.bundleSha256 ?? ""}\` manifest \`${binaries.managed?.manifestSha256 ?? ""}\` overlay ${binaries.managed?.overlayVersion ?? ""}`,
		`- role API (pi.registerModelRoles): fork=${String(roleApiOf(input, "a1-fork-create"))} managed=${String(roleApiOf(input, "b1-managed-create"))} (decides whether the bundle may append pi.virtual-model-state)`,
		`- settings writer replay: ${fidelity.regions?.map((region) => `${region.name}=${region.identical ? "identical" : "DIFFERS"}`).join(", ") ?? "unknown"} (identical=${String(fidelity.identical ?? "")})`,
		...(managedRoute === "default"
			? [
					`- first-launch backups: ${backups.length} (${backups.map((entry) => `${entry.slot}=${entry.reason}/${entry.byteSize}B`).join(", ") || "none"})`,
				]
				: []),
		"",
		"## 判定",
		"",
		"| 項目 | fork→managed | managed→fork | 総合 | 詳細 |",
		"|---|---|---|---|---|",
	];
	for (const item of input.items) {
		lines.push(
			`| ${item.item} | ${item.forkToManaged} | ${item.managedToFork} | ${overallOf(item.forkToManaged, item.managedToFork)} | ${(item.detail ?? "").replace(/\|/g, "/").slice(0, 300)} |`,
		);
	}
	lines.push("", "## フェーズの終了状態", "");
	for (const [name, phase] of Object.entries(input.phases)) {
		lines.push(`- ${name}: exit=${phase.exitCode ?? "?"}${phase.stderr ? ` stderr=${String(phase.stderr).slice(0, 160)}` : ""}`);
	}
	lines.push("", "## ツリー差分", "");
	const diffSection = (title: string, diff: SnapshotDiff): void => {
		lines.push(`### ${title}`, "");
		const described = describeDiff(diff);
		lines.push(...(described.length > 0 ? described.map((line) => `- ${line}`) : ["- 差分なし"]));
		lines.push("");
	};
	diffSection("a1 fork created", input.diffA1);
	diffSection("a2 managed fresh-session read on the fork tree", input.diffA2Fresh);
	diffSection("a2 managed read of the fork session", input.diffA2Read);
	diffSection("a2 managed write pass on the fork tree", input.diffA2Write);
	diffSection("a3 fork read pass on the managed tree", input.diffA3);
	diffSection("b1 managed created", input.diffB1);
	diffSection("b2 fork fresh-session read on the managed tree", input.diffB2Fresh);
	diffSection("b2 fork read of the managed session", input.diffB2Read);
	diffSection("b2 fork write pass on the managed tree", input.diffB2Write);
	diffSection("b3 managed read pass on the fork tree", input.diffB3);
	lines.push("## settings.json", "", "```json", redact(JSON.stringify(input.settings, null, "\t")), "```", "");
	return `${lines.join("\n")}\n`;
}

process.exit(await main());
