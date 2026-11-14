/**
 * Managed Pi compatibility runner.
 *
 * Usage:
 *   bun scripts/managed-pi-compat/run.ts [--mode fixture|official] [--artifact-root <managed-root>]
 *     [--bundle <path>] [--commit <sha>] [--bundle-version <version>] [--out <path>] [--keep]
 *
 * `fixture` mode (default) measures a managed root that carries a fixture set and labels every
 * result `fixture-only`. `official` mode verifies the official artifact digest against the product
 * trust root, extracts it into an isolated area, and measures it with a target-commit bundle.
 * Process checks that cannot run are recorded as `not-run`, never as success. The runner never
 * reads or writes the user's real agent dir.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { computeManagedEnv } from "../../packages/spirits/src/managed-pi/environment.ts";
import { managedRoot, readCurrentSet } from "../../packages/spirits/src/managed-pi/layout.ts";
import { managedSetFailureMessage, verifyManagedSet } from "../../packages/spirits/src/managed-pi/verify.ts";
import { sha256Hex, writeOverlayPackage } from "../../packages/spirits/src/managed-pi/overlay.ts";
import type { ManagedManifest } from "../../packages/spirits/src/managed-pi/manifest.ts";
import {
	classifyEnv,
	classifyExtensionLoad,
	classifyHelpSideEffects,
	classifyHostVersion,
	classifyPreservedEnv,
	classifyWrittenMarkdown,
	listFiles,
} from "./probes.ts";
import type { CompatResult, CompatState } from "./runner.ts";
import {
	clearPurposeObservations,
	deriveRows,
	modelPurposeObservations,
	rolePurposeObservations,
	validateMatrix,
	validatePurposeObservations,
	type ClearStateRecord,
	type PurposeObservation,
} from "./matrix.ts";
import {
	compactionRecords,
	forkTargetOf,
	NO_AUTOMATIC_COMPACTION,
	type CompactionRecord,
	judgeAutomaticCompaction,
	judgeFork,
	judgeManualCompaction,
	judgeResume,
	judgeTreeMove,
	startBoundaryProvider,
	treeTargetOf,
	type BoundaryProvider,
	type ManualCompactionAttempt,
	type BoundaryJudgement,
} from "./clear-boundary.ts";
import { createCompatRunner, type CompatRunner } from "./runner.ts";
import { reasoningEffortFor, requestFakeToolCall, startFakeProvider } from "./fake-provider.ts";
import type { FakeProviderRequest, FakeReply, FakeToolCall } from "./fake-provider.ts";
import {
	classifyAuxiliaryProbe,
	classifyCellFailure,
	classifyCellOutcome,
	classifyNormalToolPath,
	createProbeTsreplTool,
	executeCapturedTsrepl,
	simpleReturnValue,
} from "./tsrepl.ts";
import {
	findResponse,
	runAbortRpcProbe,
	runCommandProbe,
	runRpcProbe,
	runStagedRpcProbe,
	type RpcProbeOptions,
	type RpcRecord,
	type RpcStep,
	type StagedRpcProbeOptions,
} from "./rpc.ts";
import {
	classifyAuthRead,
	classifyDedicatedRead,
	classifyDedicatedWrite,
	classifyExternalExtensionRead,
	classifySettingsWrite,
	classifyWriteBackCompatibility,
	seedRedactedAgentFixture,
} from "./data.ts";
import {
	classifyAutoChild,
	classifyChildAbort,
	classifyChildAnswer,
	classifyChildCreation,
	classifyChildUsage,
	classifyPhysicalChild,
	fixtureProvidesChildTarget,
	rlmUsageOutcome,
	writeRlmFixture,
	type ChildAbortObservation,
	type RlmChildObservation,
} from "./rlm.ts";
import {
	buildRunnerProvenance,
	buildRuntimeEvidence,
	CLEAR_BOUNDARY_ITEMS,
	countStates,
	formatStateCounts,
	identifyRuntime,
} from "./evidence.ts";
import { stageFixtureBundle } from "./fixture-bundle.ts";
import {
	assertOfficialBundleSha,
	buildOfficialIdentity,
	createOfficialLaunchVerifier,
	loadOfficialArtifact,
	OfficialArtifactError,
	type OfficialArtifact,
} from "./official.ts";

interface CliOptions {
	mode: "fixture" | "official";
	artifactRoot?: string;
	bundle?: string;
	bundleVersion?: string;
	commit?: string;
	out?: string;
	keep: boolean;
}

const PROBE_EXTENSION = join(import.meta.dir, "fixtures", "probe-extension.ts");
const PROVIDER_EXTENSION = join(import.meta.dir, "fixtures", "custom-provider.ts");
const PROBE_STATE_ENV = "MANAGED_PI_COMPAT_PROBE_STATE";
const PROBE_RESULT_ENV = "MANAGED_PI_COMPAT_PROBE_RESULT";
/** Labelled session states, kept out of the result file because `agent_settled` rewrites it. */
const PROBE_PURPOSE_ENV = "MANAGED_PI_COMPAT_PROBE_PURPOSE";

const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";
const FAKE_API_KEY = "compat-fake-key";
const FAKE_PROXY = "http://compat-proxy.invalid";
/** Provider and models the fixture registers; the strong id proves a strong-phase route happened. */
const COMPAT_PROVIDER = "compat-fake";
/** The routing entry the session selects to put its requests under spirits. */
const ROUTING_PROVIDER = "spirits";
const ROUTING_MODEL = "auto";
const FAKE_MODEL_ID = "fake-model";
const STRONG_MODEL_ID = "fake-strong";
/** Skill command prefix and the bundled skill that puts the spirits router into its strong phase. */
const SKILL_COMMAND_PREFIX = "/skill:";
const STRONG_PHASE_SKILL = "sprt-opsx-review-change";
/** Prompt markers, so the request that carried one can be matched with the model that served it. */
const PLAIN_PROMPT = "compat plain prompt answer ok";
/** Turns that only measure the role pin, so their model choice is unambiguous. */
const PINNED_PROMPT = "compat pinned role prompt answer ok";
const UNPINNED_PROMPT = "compat unpinned role prompt answer ok";
/** The turn a step's own role setting is judged on. */
const STEP_PROMPT = "compat step setting prompt answer ok";
const STRONG_PROMPT = "compat strong prompt answer ok";
/** The thinking level one `/spirits-role normal thinking <level>` line is asked to install. */
const MODEL_PURPOSE_LEVEL = "high";
/** The turn that shows whether the role's thinking level reached the provider. */
const MODEL_PURPOSE_PROMPT = "compat thinking level prompt answer ok";
/**
 * Extension commands write their result file synchronously and the RPC surface reports no
 * completion for them, so a stage that sends one waits a fixed settle instead of an event.
 */
const PURPOSE_SETTLE_MS = 1500;
/** Real provider credentials never reach a managed Pi launch started by this harness. */
const noRealCredentials: Record<string, string | undefined> = { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined };
const RPC_TIMEOUT_MS = 60_000;
const RLM_ABORT_AFTER_MS = 3000;
/** Wait this long after the cell tool starts, so the abort lands while the child session runs. */
const RLM_ABORT_AFTER_TOOL_MS = 1500;
/** Re-read the entries for at most this long after the abort, instead of only at `agent_settled`. */
const RLM_ABORT_POLL_MS = 15_000;
const RLM_ABORT_POLL_INTERVAL_MS = 500;
/** The child stop counts once its provider request stayed closed this long, so the write can land. */
const RLM_CHILD_STOP_SETTLE_MS = 700;
/** The held-open child reply, so the abort provably arrives while the child is still waiting. */
const RLM_CHILD_REPLY_DELAY_MS = 8000;
/**
 * The parent prompt, which the fake endpoint answers with the rlm tool call.
 *
 * It is also what tells the parent's requests from a child's: a request that carries neither this
 * prompt nor a tool result came from a session the parent spawned.
 */
const RLM_PARENT_PROMPT = "run one rlm cell";
const REPO_ROOT = resolve(import.meta.dir, "../..");

interface ProbeState {
	sessionStarted: boolean;
	tools: string[];
	commands: string[];
	hostVersion?: string;
	hostRuntime?: string;
	appName?: string;
	packageDir?: string;
	agentDir?: string;
	oldAgentDir?: string;
	apiKey?: string;
	proxy?: string;
	settingsKeys: string[];
	sessionEntries: number;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	apis: Record<string, boolean>;
}

/** One labelled session state the probe extension recorded, with the branch it read. */
interface ProbePurposeState {
	sessionId?: string;
	sessionFile?: string;
	messageEntries?: number;
	todoEntries?: number;
	branch?: BranchRecord[];
	/** Compaction entries the host had written when the snapshot was taken, oldest first. */
	compactions?: CompactionRecord[];
	/** Set by `/compat-purpose-navigate`. */
	targetId?: string;
	moved?: boolean;
	error?: string;
}

interface ProbeResult {
	text?: string;
	isError?: boolean;
	bypassedPiHooks?: boolean;
	rlmUsage?: unknown[];
	toolRegistered?: boolean;
	direct?: unknown;
	settingsKeys?: string[];
	sessionEntries?: number;
	auth?: { stored?: { configured: boolean; source?: string }; control?: { configured: boolean; source?: string } };
	externalExtension?: { commandName: string; commandObserved: boolean };
	purposeStates?: Record<string, ProbePurposeState>;
	before?: { level?: string; model?: { provider: string; id: string }; defaults?: Record<string, string | undefined> };
	after?: { level?: string; model?: { provider: string; id: string }; defaults?: Record<string, string | undefined> };
	/** What `/compat-purpose-readback` reported: the runtime state after someone else changed it. */
	level?: string;
	model?: { provider: string; id: string };
	defaults?: Record<string, string | undefined>;
	levelChanged?: boolean;
	setModelResult?: boolean;
	defaultsChanged?: boolean;
	[key: string]: unknown;
}

/** Model the fake provider received for the first request whose messages carry `marker`. */
function modelUsedFor(provider: { requests: Array<{ body?: unknown; model?: string }> }, marker: string): string | undefined {
	for (const request of provider.requests) {
		const body = request.body as { messages?: unknown } | undefined;
		if (!body || !JSON.stringify(body.messages ?? "").includes(marker)) continue;
		return request.model;
	}
	return undefined;
}

interface LaunchContext {
	managedPi: string;
	packageDir: string;
	extensionPath: string;
	manifest: ManagedManifest;
}

const USAGE =
	"Usage: bun scripts/managed-pi-compat/run.ts [--mode fixture|official] [--artifact-root <managed-root>] [--bundle <path>] [--commit <sha>] [--bundle-version <version>] [--out <path>] [--keep]";

function parseArgs(args: readonly string[]): CliOptions {
	const options: CliOptions = { mode: "fixture", keep: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--keep") {
			options.keep = true;
		} else if (arg === "--mode") {
			const value = args[++index];
			if (value !== "fixture" && value !== "official") throw new Error(`Unknown mode: ${value}`);
			options.mode = value;
		} else if (arg === "--artifact-root") {
			options.artifactRoot = args[++index];
		} else if (arg === "--bundle") {
			options.bundle = args[++index];
		} else if (arg === "--bundle-version") {
			options.bundleVersion = args[++index];
		} else if (arg === "--commit") {
			options.commit = args[++index];
		} else if (arg === "--out") {
			options.out = args[++index];
		} else if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function expandHome(path: string): string {
	return path.replace(/^~(?=\/|$)/, homedir());
}

function modelEvents(records: readonly RpcRecord[], type: string): RpcRecord[] {
	return records.filter((record) => record.type === type);
}

/** `setStatus` requests the host received, with the text the extension asked for. */
function statusSetRecords(records: readonly RpcRecord[]): string[] {
	return records
		.filter((record) => record.type === "extension_ui_request" && record.method === "setStatus")
		.map((record) => String((record as { statusText?: unknown }).statusText ?? ""));
}

/** `notify` requests the host received, oldest first, with the message the extension asked for. */
function notifyRecords(records: readonly RpcRecord[]): string[] {
	return records
		.filter((record) => record.type === "extension_ui_request" && record.method === "notify")
		.map((record) => String((record as { message?: unknown }).message ?? ""));
}

function promptCommand(id: string, message: string) {
	return { id, type: "prompt" as const, message };
}

/** Extract the text content from a `tool_execution_end` record. */
function toolResultText(record: RpcRecord | undefined): string {
	if (!record?.result || typeof record.result !== "object") return "";
	const content = (record.result as { content?: Array<{ type?: string; text?: string }> }).content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("");
}

async function readProbeState(path: string): Promise<ProbeState | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as ProbeState;
	} catch {
		return undefined;
	}
}

async function readProbeResult(path: string): Promise<ProbeResult | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as ProbeResult;
	} catch {
		return undefined;
	}
}

/** Run one git command in the repository and return stdout, or `undefined` when git is unavailable. */
function gitOutput(args: readonly string[]): string | undefined {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) return undefined;
	return result.stdout.toString();
}

/**
 * The version of the harness that produced this result.
 *
 * The measured bundle records its own `--commit`. The runner is separate code in the same checkout,
 * and a judgement change lives there, so HEAD, the digest of the working diff, and the untracked list
 * are recorded next to it.
 */
function runnerProvenance() {
	return buildRunnerProvenance({
		commit: gitOutput(["rev-parse", "HEAD"]),
		diff: gitOutput(["diff", "HEAD"]),
		status: gitOutput(["status", "--porcelain"]),
	});
}

/** Every `get_entries` response in arrival order, with only its `rlm_usage` entries kept. */
function usageReadsOf(records: readonly RpcRecord[]): Array<{ id: string; entries: Array<Record<string, unknown>> }> {
	return records
		.filter((record) => record.type === "response" && record.command === "get_entries" && record.success === true)
		.map((record) => {
			const entries = (record.data as { entries?: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
			return {
				id: String(record.id ?? ""),
				entries: entries.filter((entry) => entry.type === "custom" && entry.customType === "rlm_usage"),
			};
		});
}

/** How many entries carry an abort outcome, which the product stores under `entry.data`. */
function abortedUsageCount(entries: readonly Record<string, unknown>[]): number {
	return entries.filter((entry) => rlmUsageOutcome(entry) === "aborted").length;
}

/**
 * The cell's own notice for a run an outside abort cut short.
 *
 * `repl/cell.ts` renders the abort as an `AbortError` line whose message is Japanese text, so the
 * check accepts either the error name or the message and never a bare non-zero tool result.
 */
const CELL_ABORT_MARKERS = ["AbortError", "呼び出し元の中断"];

/** True when the tool result is the cell's abort notice. */
function cellReportsAbort(text: string | undefined): boolean {
	if (text === undefined) return false;
	return CELL_ABORT_MARKERS.some((marker) => text.includes(marker));
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	const runner = await createCompatRunner({ mode: options.mode });
	// Recorded before anything can fail, so even a partial run names the harness that ran it.
	runner.setEvidence({ runnerProvenance: runnerProvenance() });
	const recorded = new Map<string, CompatResult>();
	const run: CompatRunner["run"] = async (name, check) => {
		const result = await runner.run(name, check);
		recorded.set(name, result);
		return result;
	};
	const notRun = (name: string, detail?: string) => {
		recorded.set(name, runner.notRun(name, detail));
	};
	try {
		const purposesDefined = deriveRows([]);
		validateMatrix(purposesDefined);
		await run("role/clear/model matrix is internally consistent", async () => ({
			state: "confirmed",
			detail: `${purposesDefined.length} purpose rows, every row derived from a purpose definition`,
		}));

		const localTool = createProbeTsreplTool();
		await run("tsrepl simple cell", async () => {
			const result = await executeCapturedTsrepl(localTool, "return 1 + 1", runner.workRoot);
			return simpleReturnValue(result) === 2
				? { state: "confirmed", detail: "local probe cell returned 2 (probe bypasses Pi hooks)" }
				: { state: "failed", detail: result.text };
		});

		const transportProvider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1 + 1" } });
		try {
			await run("fake provider reaches tsrepl", async () => {
				const response = await requestFakeToolCall(transportProvider.baseUrl, "tsrepl");
				const cell = await executeCapturedTsrepl(
					localTool,
					String(response.toolCalls[0]?.arguments.code ?? "return 1 + 1"),
					runner.workRoot,
				);
				return simpleReturnValue(cell) === 2
					? { state: "confirmed", detail: "local fake provider transport only; not real-provider compatibility" }
					: { state: "failed", detail: cell.text };
			});
		} finally {
			transportProvider.stop();
		}

		await run("compatibility matrix validation", async () => {
			validateMatrix(purposesDefined);
			return { state: "confirmed", detail: "every row is derived from a purpose definition" };
		});

		// Resolve the launch context. Official mode verifies the artifact before anything is written.
		let launch: LaunchContext | undefined;
		// Re-checked before every spawn: a staged executable that changed after extraction must not start.
		let verifyLaunch: () => Promise<void> = async () => {};
		if (options.mode === "official") {
			if (!options.artifactRoot || !options.bundle || !options.commit) {
				throw new Error("official mode requires --artifact-root, --bundle, and --commit");
			}
			const artifact: OfficialArtifact = await loadOfficialArtifact({
				artifactRoot: expandHome(options.artifactRoot),
				workRoot: runner.workRoot,
			});
			await writeOverlayPackage(artifact.packageDir, artifact.manifest.overlay.sha256);
			const bundleSha256 = sha256Hex(new Uint8Array(await Bun.file(options.bundle).arrayBuffer()));
			// The bundle must be the extension the manifest pairs with this artifact, or the run would
			// measure some other commit and still report itself as official.
			assertOfficialBundleSha(artifact.manifest, bundleSha256);
			verifyLaunch = createOfficialLaunchVerifier(artifact);
			const identity = buildOfficialIdentity({
				manifest: artifact.manifest,
				manifestSha256: artifact.manifestSha256,
				artifactSha256: artifact.artifactSha256,
				executableSha256: artifact.executableSha256,
				bundleSha256,
				bundleVersion: options.bundleVersion,
				targetCommit: options.commit,
				workingTreeClean: runner.evidence.runnerProvenance?.clean,
			});
			runner.setEvidence(identity);
			launch = {
				managedPi: artifact.executablePath,
				packageDir: artifact.packageDir,
				extensionPath: options.bundle,
				manifest: artifact.manifest,
			};
		} else {
			const artifactRoot = options.artifactRoot ? expandHome(options.artifactRoot) : managedRoot();
			const setId = await readCurrentSet(artifactRoot);
			if (setId) {
				// `--bundle` in fixture mode stages a set around an extension the caller built, so the run
				// measures the code under review instead of the release that happens to be installed. Without
				// it the run measures the installed set, which is what this mode has always meant.
				const verified = options.bundle
					? (await stageFixtureBundle({ artifactRoot, setId, bundle: options.bundle, workRoot: runner.workRoot })).set
					: await verifyManagedSet(artifactRoot, setId);
				launch = {
					managedPi: verified.piExecutable,
					packageDir: verified.packageDir,
					extensionPath: verified.extensionPath,
					manifest: verified.manifest,
				};
			}
		}
		// Which extension the run actually launched, recorded with the result: a matrix row that cannot say
		// what it measured cannot be compared with another run.
		let measuredExtension: { path: string; sha256: string } | undefined;
		if (launch) {
			const bytes = new Uint8Array(await Bun.file(launch.extensionPath).arrayBuffer());
			measuredExtension = { path: launch.extensionPath, sha256: sha256Hex(bytes) };
		}

		const processItems = [
			"managed extension load",
			"agent dir precedence",
			"package dir decoy does not change identity",
			"help touches only the isolated home",
			"api key and proxy survive",
			"bundled SKILL.md is raw markdown",
			"host version",
			"managed tsrepl simple cell",
			"managed tsrepl Bun.Transpiler cell",
			"managed tsrepl node:vm cell",
			"cell failure is not reported as a load failure",
			"model tool call reaches tsrepl",
			"direct execute probe is auxiliary",
			"no real credentials are read",
			"rlm child creation",
			"rlm child answer",
			"rlm child usage",
			"rlm child abort",
			"rlm physical model child",
			"rlm auto parent",
			"data read compatibility",
			"auth read compatibility",
			"external extension read compatibility",
			"dedicated Pi write path",
			"existing agent dir write-back compatibility",
			"settings write compatibility",
			"role/clear/model matrix",
			CLEAR_BOUNDARY_ITEMS.automaticCompaction,
			CLEAR_BOUNDARY_ITEMS.manualCompaction,
			CLEAR_BOUNDARY_ITEMS.fork,
			CLEAR_BOUNDARY_ITEMS.treeMove,
			CLEAR_BOUNDARY_ITEMS.resume,
		];
		if (!launch) {
			for (const name of processItems) {
				notRun(name, options.mode === "official" ? "official artifact unavailable" : "no current managed set");
			}
		} else {
			try {
				const managedPi = launch.managedPi;
				const managedEnv = (extra: Record<string, string | undefined> = {}) =>
					computeManagedEnv({
						env: runner.env({
							ANTHROPIC_API_KEY: FAKE_API_KEY,
							HTTPS_PROXY: FAKE_PROXY,
							...extra,
						}),
						agentDir: runner.agentDir,
						packageDir: launch.packageDir,
					});
				const baseEnv = managedEnv({ [PROBE_STATE_ENV]: join(runner.workRoot, "probe-state.json") });
				// `--no-extensions` keeps unrelated code out of every measurement. The one item that asks
				// whether an external extension in the agent dir gets loaded drops it, because that flag is
				// exactly what stops the host from reading those files.
				const launchCommand = (extraExtensions: readonly string[] = [], agentExtensions = false, sessionFile?: string) => [
					managedPi,
					"--mode",
					"rpc",
					...(sessionFile === undefined ? ["--no-session"] : ["--session", sessionFile]),
					...(agentExtensions ? [] : ["--no-extensions"]),
					"-e",
					PROBE_EXTENSION,
					...extraExtensions.flatMap((path) => ["-e", path]),
				];
				// Every spawn re-verifies the launch target first, so a verification failure stops the run
				// before a process starts rather than producing an unlabelled measurement.
				const rpcProbe = async (options: RpcProbeOptions) => {
					await verifyLaunch();
					return runRpcProbe(options);
				};
				const stagedProbe = async (options: StagedRpcProbeOptions) => {
					await verifyLaunch();
					return runStagedRpcProbe(options);
				};
				const abortProbe = async (options: Parameters<typeof runAbortRpcProbe>[0]) => {
					await verifyLaunch();
					return runAbortRpcProbe(options);
				};
				const processProbe = async (options: Parameters<typeof runCommandProbe>[0]) => {
					await verifyLaunch();
					return runCommandProbe(options);
				};
				// The redacted existing agent dir becomes the storage the dedicated Pi reads, so the read
				// items measure settings, auth, sessions, and an external extension through that runtime.
				const seededAgentFiles = await seedRedactedAgentFixture(runner.agentDir);
				const loadRun = await rpcProbe({
					command: launchCommand([launch.extensionPath]),
					cwd: runner.workRoot,
					env: baseEnv,
					requests: [
						{ id: "state-1", type: "get_state" },
						{ id: "commands-1", type: "get_commands" },
					],
					timeoutMs: RPC_TIMEOUT_MS,
				});
				const state = await readProbeState(String(baseEnv[PROBE_STATE_ENV]));
				const sessionStarted = findResponse(loadRun.records, "get_state")?.success === true;
				const toolNames = state?.tools ?? [];
				await run("managed extension load", async () => ({
					...classifyExtensionLoad({ sessionStarted, tools: toolNames, stderr: loadRun.stderr }),
					log: { command: launchCommand([launch.extensionPath]), stderr: loadRun.stderr },
				}));
				await run("agent dir precedence", async () =>
					state
						? classifyEnv(
								{
									agentDir: state.agentDir,
									packageDir: state.packageDir,
									appName: state.appName,
									version: state.hostVersion,
									packageDirDecoyUsed: state.packageDir !== launch.packageDir,
									apiKey: state.apiKey,
									proxy: state.proxy,
								},
								{ agentDir: runner.agentDir, version: launch.manifest.pi.version },
							)
						: { state: "not-run", detail: "the probe did not report its environment" },
				);
				await run("help touches only the isolated home", async () => {
					const before = new Set(listFiles(runner.home));
					const help = await processProbe({
						command: [managedPi, "--help"],
						cwd: runner.workRoot,
						env: baseEnv,
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const after = listFiles(runner.home);
					const all = [...before, ...after];
					return {
						...classifyHelpSideEffects(all, runner.home),
						data: { exitCode: help.exitCode },
					};
				});
				await run("api key and proxy survive", async () =>
					state
						? classifyPreservedEnv(
								{ apiKey: state.apiKey, proxy: state.proxy },
								{ apiKey: FAKE_API_KEY, proxy: FAKE_PROXY },
							)
						: { state: "not-run", detail: "the probe did not report its environment" },
				);
				const decoy = join(runner.workRoot, "decoy-package");
				await mkdir(decoy, { recursive: true });
				await writeFile(
					join(decoy, "package.json"),
					JSON.stringify({ name: "decoy", version: "9.9.9", piConfig: { name: "decoy", configDir: ".pi" } }),
				);
				await run("package dir decoy does not change identity", async () => {
					const version = await processProbe({
						command: [managedPi, "--version"],
						cwd: runner.workRoot,
						env: managedEnv({ PI_PACKAGE_DIR: decoy }),
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const output = version.stdout.trim();
					return output.includes(launch.manifest.pi.version) && !output.includes("9.9.9")
						? { state: "confirmed", detail: "the decoy package dir did not change the version" }
						: { state: "failed", detail: `version output was ${output || version.stderr.trim()}` };
				});
				await run("bundled SKILL.md is raw markdown", async () => {
					// The written path is the proof that the storage in use is the isolated agent dir.
					const skills = listFiles(runner.agentDir).filter((path) => path.endsWith("SKILL.md"));
					const skill = skills[0];
					const bundled = skills.filter((path) => path.includes("bundled-skills")).length;
					return skill
						? {
								...classifyWrittenMarkdown(skill),
								data: { isolatedAgentDir: runner.agentDir, bundledSkillFiles: bundled, firstSkillFile: skill },
							}
							: { state: "not-run", detail: "the session did not write a bundled SKILL.md" };
				});
				await run("host version", async () =>
					state
						? classifyHostVersion(state.hostVersion, launch.manifest.pi.version)
						: { state: "not-run", detail: "the probe did not report the host version" },
				);
				// Cell execution goes through the normal model-to-tool path: the fake provider issues
				// the tool call and the runner reads the observed tool result.
				const cell = async (name: string, code: string, expected: unknown) => {
					const cellProvider = startFakeProvider({ name: "tsrepl", arguments: { code } });
					try {
						return await run(name, async () => {
							const result = await rpcProbe({
								command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
								cwd: runner.workRoot,
								env: {
									...baseEnv,
									[FAKE_PROVIDER_ENV]: cellProvider.baseUrl,

									ANTHROPIC_API_KEY: undefined,
									OPENAI_API_KEY: undefined,
								},
								requests: [
									{ id: "model-1", type: "set_model", provider: "compat-fake", modelId: "fake-model" },
									promptCommand("prompt-1", "run one tsrepl cell"),
								],
								timeoutMs: RPC_TIMEOUT_MS,
								waitFor: (records) => modelEvents(records, "agent_settled").length > 0,
							});
							const end = modelEvents(result.records, "tool_execution_end").find(
								(record) => record.toolName === "tsrepl",
							);
							const text = toolResultText(end);
							const value = simpleReturnValue({
								text,
								isError: end?.isError === true,
								details: undefined,
								bypassedPiHooks: false,
							});
							return classifyCellOutcome({
								value,
								expected,
								isError: end?.isError === true,
								text,
								fixtureHost: runner.mode === "fixture",
							});
						});
					} finally {
						cellProvider.stop();
					}
				};
				await cell("managed tsrepl simple cell", "return 1 + 1", 2);
				await cell("managed tsrepl Bun.Transpiler cell", "const n: number = 2; return n", 2);
				await cell("managed tsrepl node:vm cell", "const vm = await use('node:vm'); return vm.runInNewContext('1 + 2')", 3);
				await run("cell failure is not reported as a load failure", async () => {
					const failureProvider = startFakeProvider({
						name: "tsrepl",
						arguments: { code: "throw new Error('cell boom')" },
					});
					try {
						const result = await rpcProbe({
							command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
							cwd: runner.workRoot,
							env: {
								...baseEnv,
								[FAKE_PROVIDER_ENV]: failureProvider.baseUrl,
								ANTHROPIC_API_KEY: undefined,
								OPENAI_API_KEY: undefined,
							},
							requests: [
								{ id: "model-1", type: "set_model", provider: "compat-fake", modelId: "fake-model" },
								promptCommand("prompt-1", "run one failing tsrepl cell"),
							],
							timeoutMs: RPC_TIMEOUT_MS,
							waitFor: (records) => modelEvents(records, "agent_settled").length > 0,
						});
						const end = modelEvents(result.records, "tool_execution_end").find(
							(record) => record.toolName === "tsrepl",
						);
						return classifyCellFailure(
							end?.isError === true && toolResultText(end).includes("cell boom"),
							runner.mode === "fixture",
						);
					} finally {
						failureProvider.stop();
					}
				});

				// Existing-data reads run before any later item rewrites the agent dir, over the redacted
				// fixture copied into the isolated storage, so settings, auth, sessions, and an external
				// extension are all read through the dedicated Pi runtime.
				const probeOnce = async (
					requestId: string,
					command: string,
					resultFile: string,
					extraExtensions: readonly string[] = [],
					extraEnv: Record<string, string | undefined> = {},
					agentExtensions = false,
				) => {
					const spawn = launchCommand([...extraExtensions, launch.extensionPath], agentExtensions);
					const resultPath = join(runner.workRoot, resultFile);
					const result = await rpcProbe({
						command: spawn,
						cwd: runner.workRoot,
						env: { ...baseEnv, [PROBE_RESULT_ENV]: resultPath, ...extraEnv },
						requests: [promptCommand(requestId, command)],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					return { probe: await readProbeResult(resultPath), log: { command: spawn, stderr: result.stderr } };
				};
				await run("data read compatibility", async () => {
					const { probe, log } = await probeOnce("data-read-1", "/compat-data-read", "data-read.json");
					return {
						...classifyDedicatedRead({
							settingsKeys: probe?.settingsKeys ?? [],
							sessionEntries: probe?.sessionEntries ?? 0,
						}),
						data: {
							seededAgentFiles: seededAgentFiles.length,
							settingsKeys: probe?.settingsKeys ?? [],
							sessionEntries: probe?.sessionEntries ?? 0,
						},
						log,
					};
				});
				const sources = await probeOnce("data-sources-1", "/compat-data-sources", "data-sources.json");
				await run("auth read compatibility", async () => ({
					...classifyAuthRead(sources.probe?.auth ?? {}),
					data: sources.probe?.auth,
					log: sources.log,
				}));
				const externalSources = await probeOnce(
					"data-sources-2",
					"/compat-data-sources",
					"data-sources-external.json",
					[],
					{},
					true,
				);
				await run("external extension read compatibility", async () => ({
					...classifyExternalExtensionRead({
						commandObserved: externalSources.probe?.externalExtension?.commandObserved === true,
						commandName: externalSources.probe?.externalExtension?.commandName ?? "compat-redacted-command",
					}),
					data: { commands: externalSources.probe?.commands },
					log: externalSources.log,
				}));
				await run("dedicated Pi write path", async () => {
					const write = await probeOnce("data-write-1", "/compat-data-write", "data-write.json");
					const model = await probeOnce("model-write-1", "/compat-model-write", "model-write.json");
					return {
						...classifyDedicatedWrite({
							sessionWritten: write.probe?.sessionWritten === true,
							sessionReadBack: write.probe?.sessionReadBack === true,
							modelChanged: model.probe?.modelChanged === true,
							thinkingLevelChanged: model.probe?.thinkingLevelChanged === true,
						}),
						log: write.log,
					};
				});
				// The dedicated Pi write path says nothing about writing back into an existing agent dir, so
				// that stays its own item and never inherits a verdict from the write path above.
				await run("existing agent dir write-back compatibility", async () => classifyWriteBackCompatibility({ proven: false }));
				await run("settings write compatibility", async () => {
					const { probe, log } = await probeOnce("settings-write-1", "/compat-settings-write", "settings-write.json");
					return {
						...classifySettingsWrite({
							available: probe?.available === true,
							written: probe?.written,
							error: probe?.error,
						}),
						log,
					};
				});

				const provider = startFakeProvider(
					{ name: "tsrepl", arguments: { code: "return 1 + 1" } },
					{ finalAnswerAfterToolResult: "finished" },
				);
				try {
					await run("model tool call reaches tsrepl", async () => {
						const result = await rpcProbe({
							command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
							cwd: runner.workRoot,
							env: {
								...baseEnv,
								[FAKE_PROVIDER_ENV]: provider.baseUrl,
								ANTHROPIC_API_KEY: undefined,
								OPENAI_API_KEY: undefined,
							},
							requests: [
								{ id: "model-1", type: "set_model", provider: "compat-fake", modelId: "fake-model" },
								promptCommand("prompt-1", "run one tsrepl cell"),
							],
							timeoutMs: RPC_TIMEOUT_MS,
							waitFor: (records) => modelEvents(records, "agent_settled").length > 0,
						});
						return {
							...classifyNormalToolPath(result.records, "tsrepl"),
							log: {
								command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
								stderr: result.stderr,
							},
						};
					});
					// The auxiliary item no longer depends on capturing another extension's registration:
					// it reports what the dedicated Pi's own tool inventory shows and that no tool
					// definition is reachable for a direct `execute`.
					await run("direct execute probe is auxiliary", async () => {
						const resultPath = join(runner.workRoot, "auxiliary-probe.json");
						const command = launchCommand([launch.extensionPath]);
						const result = await rpcProbe({
							command,
							cwd: runner.workRoot,
							env: { ...baseEnv, [PROBE_RESULT_ENV]: resultPath },
							requests: [promptCommand("aux-1", "/compat-auxiliary")],
							timeoutMs: RPC_TIMEOUT_MS,
						});
						const observed = await readProbeResult(resultPath);
						return {
							...classifyAuxiliaryProbe({ toolRegistered: observed?.toolRegistered === true }),
							log: { command, stderr: result.stderr },
						};
					});
					await run("no real credentials are read", async () => {
						const authorization = provider.requests.map((request) => request.authorization ?? "");
						return authorization.every((value) => value === "Bearer fake" || value === "")
							? { state: "confirmed", detail: "only the fake bearer token was sent" }
							: { state: "failed", detail: "a non-fake authorization header reached the fake provider" };
					});

					// rlm: the child inherits the parent model, so the fixture must make both the
					// physical model and `spirits/auto` resolvable. The child runs through the normal
					// model-to-tool path; `rlm_usage` is read back through the dedicated Pi's entries.
					const physicalModel = { provider: "compat-fake", modelId: "fake-model" };
					const autoModel = { provider: "spirits", modelId: "auto" };
					const rlmEntriesFrom = (records: readonly RpcRecord[]): Array<Record<string, unknown>> => {
						const response = findResponse(records, "get_entries");
						const entries =
							(response?.data as { entries?: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
						return entries.filter((entry) => entry.type === "custom" && entry.customType === "rlm_usage");
					};
					interface RlmCellRun {
						text: string;
						isError: boolean;
						/** The entries the probe extension recorded at the run's `agent_settled`. */
						usageAtSettled: Array<Record<string, unknown>>;
						/** Every `get_entries` read in arrival order: the abort run polls, so the last one is after the stop. */
						usageReads: Array<{ id: string; entries: Array<Record<string, unknown>> }>;
						stderr: string;
						records: readonly RpcRecord[];
						/** Whether this run wrote an abort request to the host stdin. */
						abortSent?: boolean;
						/** How the host answered the abort request, for the run that sent one. */
						abortAccepted?: boolean;
					}
					const runRlmCell = async (
						model: { provider: string; modelId: string },
						cellProvider: { baseUrl: string },
						resultPath: string,
						options: {
							abortAfterMs?: number;
							abortAfterEventMs?: number;
							/** Re-read the entries until this reports the child stopped, then take one final read. */
							childStopped?: () => boolean;
						} = {},
					): Promise<RlmCellRun> => {
						const requests = [
							{ id: "model-rlm", type: "set_model", provider: model.provider, modelId: model.modelId },
							promptCommand("rlm-1", RLM_PARENT_PROMPT),
						];
						const settleRequests = [{ id: "entries-rlm", type: "get_entries" }];
						const env = {
							...baseEnv,
							[FAKE_PROVIDER_ENV]: cellProvider.baseUrl,
							[PROBE_RESULT_ENV]: resultPath,
							ANTHROPIC_API_KEY: undefined,
							OPENAI_API_KEY: undefined,
						};
						const command = launchCommand([PROVIDER_EXTENSION, launch.extensionPath]);
						const result =
							options.abortAfterMs !== undefined
							? await abortProbe({
								command,
								cwd: runner.workRoot,
								env,
								requests,
								abortRequest: { id: "abort-rlm", type: "abort" },
								abortAfterMs: options.abortAfterMs,
								abortAfterEventMs: options.abortAfterEventMs,
								abortWhen: (records) => records.some((record) => record.type === "tool_execution_start"),
								timeoutMs: RPC_TIMEOUT_MS,
								// A run that was cut short keeps writing after `agent_settled`, so the reads
								// continue until the child's own provider request closes or the poll window ends.
								// Only a run that can create a child polls: a fixture host never does.
								poll:
									options.childStopped === undefined
									? undefined
									: {
										request: { id: "entries-poll", type: "get_entries" },
										intervalMs: RLM_ABORT_POLL_INTERVAL_MS,
										timeoutMs: RLM_ABORT_POLL_MS,
										until: options.childStopped,
									},
							})
							: await rpcProbe({
								command,
								cwd: runner.workRoot,
								env,
								requests,
								timeoutMs: RPC_TIMEOUT_MS,
								waitFor: (records) => modelEvents(records, "agent_settled").length > 0,
								settleRequests,
							});
						const endRecord = modelEvents(result.records, "tool_execution_end").find(
							(record) => record.toolName === "tsrepl",
						);
						const fileResult = await readProbeResult(resultPath);
						const abortResponse = result.records.find(
							(record) => record.type === "response" && (record.command === "abort" || record.id === "abort-rlm"),
						);
						return {
							text: toolResultText(endRecord),
							isError: endRecord?.isError === true,
							usageAtSettled: Array.isArray(fileResult?.rlmUsage)
								? (fileResult?.rlmUsage as Array<Record<string, unknown>>)
								: [],
							usageReads: usageReadsOf(result.records),
							stderr: result.stderr,
							records: result.records,
							...(options.abortAfterMs === undefined
								? {}
								: {
									abortSent: result.abortSent === true,
									...(abortResponse === undefined ? {} : { abortAccepted: abortResponse.success !== false }),
								}),
						};
					};

					// An rlm child loads no extensions, but it is created inside the parent's process and resolves
					// its agent dir with the host's own getAgentDir(), which the managed launch pins to the
					// isolated agent dir. A run that put the fixture only in <home>/.pi/agent failed with
					// "No API key found for compat-fake" while the same run with the fixture only in the isolated
					// agent dir answered, so no extra child directory is written.
					// The same cell runs in the parent and, through rlm, in the child. The parent is the
					// request that carries the harness prompt; anything else is a child request and gets a
					// plain text answer, so a child never recurses into another rlm call.
					const rlmCellCode = 'return await rlm("child task")';
					const rlmToolCall: FakeToolCall = { name: "tsrepl", arguments: { code: rlmCellCode } };
					const rlmReply =
						(childDelayMs: number) =>
						(body: unknown): FakeReply => {
							// A tool result means the cell already ran, so end the run instead of calling the
							// tool again forever.
							const messages = (body as { messages?: Array<{ role?: string }> } | undefined)?.messages ?? [];
							if (messages.some((message) => message.role === "tool")) return { kind: "text", text: "finished" };
							return JSON.stringify(body ?? "").includes(RLM_PARENT_PROMPT)
								? { kind: "tool-call", toolCall: rlmToolCall }
								: { kind: "text", text: "child answer", delayMs: childDelayMs };
						};
					// The child request is the one that asked for the held-open reply, so the provider's own
					// record names the child traffic without reading request bodies.
					const childRequestsOf = (requests: readonly FakeProviderRequest[]) =>
						requests.filter((request) => request.delayMs === RLM_CHILD_REPLY_DELAY_MS);
					// The model the child asked for, which is the whole `rlm auto parent` judgement: a parent that
					// resolved its selection sends a physical model, one that did not sends nothing at all.
					const childRequestedModel = (requests: readonly FakeProviderRequest[]): string | undefined => {
						for (const request of requests) {
							const messages =
								(request.body as { messages?: Array<{ role?: string }> } | undefined)?.messages ?? [];
							if (messages.some((message) => message.role === "tool")) continue;
							if (JSON.stringify(request.body ?? "").includes(RLM_PARENT_PROMPT)) continue;
							return request.model;
						}
						return undefined;
					};
					// A failed cell returns its error text, which is not a child answer. Reading it as one would
					// confirm an item whose child never ran.
					const answerOf = (run: RlmCellRun | undefined): string | undefined =>
						run !== undefined && !run.isError ? run.text : undefined;
					/**
					 * A predicate reporting that the child stopped: every child request closed and stayed closed
					 * long enough for the detached continuation to write its entry before the final read.
					 */
					const childStoppedFor = (collect: () => readonly FakeProviderRequest[]) => (): boolean => {
						const seen = childRequestsOf(collect());
						if (seen.length === 0) return false;
						if (seen.some((request) => request.closedAt === undefined)) return false;
						const lastClose = Math.max(...seen.map((request) => request.closedAt ?? 0));
						return Date.now() - lastClose >= RLM_CHILD_STOP_SETTLE_MS;
					};
					/** The provider connection record, without the request bodies. */
					const providerLog = (requests: readonly FakeProviderRequest[]) =>
						requests.map((request) => ({
							kind: request.kind,
							model: request.model,
							receivedAt: request.receivedAt,
							respondedAt: request.respondedAt,
							closedAt: request.closedAt,
							delayMs: request.delayMs,
						}));
					// The entries a completed run recorded: the probe agent_settled write, or the last read when
					// that write did not happen.
					const usageOf = (run: RlmCellRun | undefined): Array<Record<string, unknown>> =>
						run === undefined
							? []
							: run.usageAtSettled.length > 0
								? run.usageAtSettled
								: (run.usageReads.at(-1)?.entries ?? []);
					// Abort first: the child request is held open so the cell is still inside rlm when the
					// abort arrives, and the entry reads continue until the child's own request closes, because
					// a tool call that was cut short keeps running after the run settled.
					const abortProvider = startFakeProvider(rlmToolCall, {
						reply: rlmReply(RLM_CHILD_REPLY_DELAY_MS),
					});
					await writeRlmFixture({
						agentDir: runner.agentDir,
						providerBaseUrl: abortProvider.baseUrl,
					});
					let abortRun: RlmCellRun | undefined;
					try {
						abortRun = await runRlmCell(physicalModel, abortProvider, join(runner.workRoot, "rlm-abort.json"), {
							abortAfterMs: RLM_ABORT_AFTER_MS,
							abortAfterEventMs: RLM_ABORT_AFTER_TOOL_MS,
							// A fixture host emits fixed events and never creates a child, so it has no child
							// stop to wait for and no product behaviour to measure here.
							childStopped: runner.mode === "official" ? childStoppedFor(() => abortProvider.requests) : undefined,
						});
					} finally {
						abortProvider.stop();
					}
					// The rlm cells all run through this launch, so the item logs name the command that ran them.
					const rlmCommand = launchCommand([PROVIDER_EXTENSION, launch.extensionPath]);
					// The stop evidence is read after the run, from the request record the endpoint kept.
					const abortChildren = childRequestsOf(abortProvider.requests);
					const abortObservation: ChildAbortObservation = {
						abortSent: abortRun?.abortSent === true,
						...(abortRun?.abortAccepted === undefined ? {} : { abortAccepted: abortRun.abortAccepted }),
						cellAborted: abortRun?.isError === true && cellReportsAbort(abortRun.text),
						childSeen: abortChildren.length > 0,
						childStopped: abortChildren.length > 0 && abortChildren.every((request) => request.closedAt !== undefined),
						usageAtSettled: abortedUsageCount(abortRun?.usageAtSettled ?? []),
						usageAfterStop: abortedUsageCount(abortRun?.usageReads.at(-1)?.entries ?? []),
						pollWindowMs: RLM_ABORT_POLL_MS,
						...(abortRun === undefined ? { error: "the child abort was not exercised" } : {}),
					};
					await run("rlm child abort", async () => ({
						...classifyChildAbort(abortObservation),
						data: {
							phases: abortObservation,
							cellText: abortRun?.text,
							cellIsError: abortRun?.isError,
							// childCutMidRequest is the endpoint's own record that the child hung up on a request it
							// had not been answered: the direct proof that the parent abort reached the child.
							childCutMidRequest: abortChildren.some(
								(request) => request.closedAt !== undefined && request.respondedAt === undefined,
							),
							usageAtSettledEntries: abortRun?.usageAtSettled.length ?? 0,
							usageAfterStopEntries: abortRun?.usageReads.at(-1)?.entries.length ?? 0,
							pollReads: (abortRun?.usageReads ?? []).map((read) => ({
								id: read.id,
								entries: read.entries.length,
								outcomes: read.entries.map((entry) => rlmUsageOutcome(entry)),
							})), 
							providerRequests: providerLog(abortProvider.requests),
						},
						log: { command: rlmCommand, stdout: abortRun?.text, stderr: abortRun?.stderr },
					}));
					const physicalProvider = startFakeProvider(rlmToolCall, { reply: rlmReply(0) });
					await writeRlmFixture({
						agentDir: runner.agentDir,
						providerBaseUrl: physicalProvider.baseUrl,
					});
					let physicalRequests: FakeProviderRequest[] = [];
					let physicalRun: RlmCellRun | undefined;
					try {
						physicalRun = await runRlmCell(
							physicalModel,
							physicalProvider,
							join(runner.workRoot, "rlm-physical.json"),
						);
					} finally {
						physicalRequests = [...physicalProvider.requests];
						physicalProvider.stop();
					}
					const physicalUsage = usageOf(physicalRun);
					const physicalObservation: RlmChildObservation = {
						childCreated: physicalRun !== undefined && !physicalRun.isError,
						finalAnswer: answerOf(physicalRun),
						usageRecorded: physicalUsage.length > 0,
						childRequestedModel: childRequestedModel(physicalRequests),
						error: physicalRun?.isError ? physicalRun.text : physicalRun?.stderr,
					};
					const physicalLog = {
						command: rlmCommand,
						stdout: physicalRun?.text,
						stderr: physicalRun?.stderr,
					};
					await run("rlm child creation", async () => ({ ...classifyChildCreation(physicalObservation), log: physicalLog }));
					await run("rlm child answer", async () => ({ ...classifyChildAnswer(physicalObservation), log: physicalLog }));
					await run("rlm child usage", async () => ({ ...classifyChildUsage(physicalObservation), log: physicalLog }));
					await run("rlm physical model child", async () => ({
						...classifyPhysicalChild(physicalObservation),
						data: { usageEntries: physicalUsage.length, providerRequests: providerLog(physicalRequests) },
						log: physicalLog,
					}));
					const autoProvider = startFakeProvider(rlmToolCall, { reply: rlmReply(0) });
					const autoFixture = await writeRlmFixture({
						agentDir: runner.agentDir,
						providerBaseUrl: autoProvider.baseUrl,
					});
					let autoRequests: FakeProviderRequest[] = [];
					let autoRun: RlmCellRun | undefined;
					try {
						autoRun = await runRlmCell(
							autoModel,
							autoProvider,
							join(runner.workRoot, "rlm-auto.json"),
						);
					} finally {
						autoRequests = [...autoProvider.requests];
						autoProvider.stop();
					}
					await run("rlm auto parent", async () => ({
						...classifyAutoChild({
							childCreated: autoRun !== undefined && !autoRun.isError,
							finalAnswer: answerOf(autoRun),
							usageRecorded: usageOf(autoRun).length > 0,
							childRequestedModel: childRequestedModel(autoRequests),
							error: autoRun?.isError ? autoRun.text : autoRun?.stderr,
							// The two gaps that alone make the item `not-run`: a fixture with no model the child
							// could run, and a host that answers with fixed events (a fixture run).
							childTargetInFixture: fixtureProvidesChildTarget(autoFixture, COMPAT_PROVIDER),
							hostCanRequestProvider: runner.mode === "official",
						}),
						data: { providerRequests: providerLog(autoRequests) },
						log: {
							command: rlmCommand,
							stdout: autoRun?.text,
							stderr: autoRun?.stderr,
						},
					}));
				} finally {
					provider.stop();
				}

				// Purpose observations on the dedicated Pi. A purpose the harness cannot drive stays
				// `not-run`, and a command that a command list omits is never read as unavailability.
				const purposes: PurposeObservation[] = [];

				// role: which physical model served a strong-phase skill command, read from the request the
				// fake provider actually received.
				await writeRlmFixture({ agentDir: runner.agentDir, strongModel: `${COMPAT_PROVIDER}/${STRONG_MODEL_ID}` });
				const roleProvider = startFakeProvider(
					{ name: "tsrepl", arguments: { code: "return 1" } },
					{ reply: () => ({ kind: "text", text: "ok" }) },
				);
				let strongAttempt: Parameters<typeof rolePurposeObservations>[0];
				try {
					const roleRun = await stagedProbe({
						command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
						cwd: runner.workRoot,
						env: {
							...baseEnv,
							[FAKE_PROVIDER_ENV]: roleProvider.baseUrl,
							ANTHROPIC_API_KEY: undefined,
							OPENAI_API_KEY: undefined,
						},
						stages: [
							{ requests: [{ id: "auto-model", type: "set_model", provider: "spirits", modelId: "auto" }] },
							{
								requests: [promptCommand("plain-1", PLAIN_PROMPT)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							{
								requests: [promptCommand("strong-1", `${SKILL_COMMAND_PREFIX}${STRONG_PHASE_SKILL} ${STRONG_PROMPT}`)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							// The pin is a separate command, so it is measured separately: the selection stays
							// `spirits/auto` and only the role changes, and the very next request has to follow it.
							{ requests: [promptCommand("pin-strong", "/spirits-role strong")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{
								requests: [promptCommand("pinned-1", PINNED_PROMPT)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							{ requests: [promptCommand("pin-normal", "/spirits-role normal")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{
								requests: [promptCommand("unpinned-1", UNPINNED_PROMPT)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							// A step setting is narrower than the step list's default role and than the lock, so the
							// review step — whose listed default is strong — is asked to answer on normal. Only the
							// setting can bring that request back from the strong model.
							{
								requests: [promptCommand("step-set", `/spirits-role ${STRONG_PHASE_SKILL} role normal`)],
								waitFor: () => false,
								timeoutMs: PURPOSE_SETTLE_MS,
							},
							{
								requests: [promptCommand("step-run", `${SKILL_COMMAND_PREFIX}${STRONG_PHASE_SKILL} ${STEP_PROMPT}`)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							// The status report is asked for after a routing has been answered, so the report the
							// matrix judges is one that has a lock, a step, and a last request to name.
							{
								requests: [promptCommand("status-report", "/spirits-role status")],
								waitFor: () => false,
								timeoutMs: PURPOSE_SETTLE_MS,
							},
						],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					strongAttempt = {
						attempted: true,
						normalRequestModel: modelUsedFor(roleProvider, PLAIN_PROMPT),
						strongRequestModel: modelUsedFor(roleProvider, STRONG_PROMPT),
						expectedNormalModel: FAKE_MODEL_ID,
						expectedStrongModel: STRONG_MODEL_ID,
						reason: roleRun.records.some((record) => record.type === "response" && record.id === "auto-model" && record.success === false)
							? "the dedicated Pi refused the spirits/auto selection"
							: undefined,
						roleVocabulary: {
							observed: true,
							state:
								modelUsedFor(roleProvider, PINNED_PROMPT) === STRONG_MODEL_ID &&
								modelUsedFor(roleProvider, UNPINNED_PROMPT) === FAKE_MODEL_ID
									? "available"
									: "unavailable",
							detail:
								modelUsedFor(roleProvider, PINNED_PROMPT) === STRONG_MODEL_ID &&
								modelUsedFor(roleProvider, UNPINNED_PROMPT) === FAKE_MODEL_ID
									? `/spirits-role strong sent the next request to ${STRONG_MODEL_ID} and /spirits-role normal sent the one after it back to ${FAKE_MODEL_ID}, with the selection unchanged`
									: `/spirits-role strong served ${String(modelUsedFor(roleProvider, PINNED_PROMPT))} and normal served ${String(modelUsedFor(roleProvider, UNPINNED_PROMPT))}, expected ${STRONG_MODEL_ID} then ${FAKE_MODEL_ID}`,
						},
						// The badge is a footer surface, but drawing it is an RPC call the harness does see:
						// the extension asks the host to set status text, and that request names the role.
						// The step setting is read the same way the routing is: the model that served the step's
						// request. Normal means the setting beat the step list's strong default.
						stepSettingsApplied: modelUsedFor(roleProvider, STEP_PROMPT) === FAKE_MODEL_ID,
						roleBadge: statusSetRecords(roleRun.records).length > 0
							? {
									observed: true,
									state: "limited",
									detail: `the extension asked the host to draw ${statusSetRecords(roleRun.records).length} role status line(s) over RPC, which is the extension status line, not the core footer badge`,
								}
							: { observed: false, detail: "the extension never asked the host to set status text" },
						// The status report reaches the user as a notice, and a notice is an RPC call the harness
						// can read. The last one is the report the `status` line asked for.
						statusReport: notifyRecords(roleRun.records).at(-1),
					};
				} finally {
					roleProvider.stop();
				}
				purposes.push(...rolePurposeObservations(strongAttempt));

				// /spirits-role: a role's model and thinking level are settings, so the command line owns the
				// write and the probe only reads the runtime back. The level is measured where it counts: in the
				// body the fake provider received, not in a value read off an extension call. The saved target is
				// read through the dedicated Pi after its reload, because a Node read of the file would judge the
				// harness's own view of disk rather than what pi loads into a new session.
				const modelPurposePath = join(runner.workRoot, "purpose-model.json");
				const levelProvider = startFakeProvider(
					{ name: "tsrepl", arguments: { code: "return 1" } },
					{ reply: () => ({ kind: "text", text: "ok" }) },
				);
				try {
					const modelRun = await stagedProbe({
						command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
						cwd: runner.workRoot,
						env: { ...baseEnv, [PROBE_RESULT_ENV]: modelPurposePath, ...noRealCredentials, [FAKE_PROVIDER_ENV]: levelProvider.baseUrl },
						stages: [
							// Both settings first: a request can only carry what the reloaded runtime can read, and each
							// of these lines reloads the extension on its own.
							{
								requests: [promptCommand("mp-target", `/spirits-role normal model ${COMPAT_PROVIDER}/${FAKE_MODEL_ID}`)],
								waitFor: () => false,
								timeoutMs: PURPOSE_SETTLE_MS,
							},
							{
								requests: [promptCommand("mp-level", `/spirits-role normal thinking ${MODEL_PURPOSE_LEVEL}`)],
								waitFor: () => false,
								timeoutMs: PURPOSE_SETTLE_MS,
							},
							// The routing model is what applies them. A physical selection would leave the level to pi.
							{
								requests: [{ id: "mp-auto", type: "set_model", provider: ROUTING_PROVIDER, modelId: ROUTING_MODEL }],
							},
							{
								requests: [promptCommand("mp-run", MODEL_PURPOSE_PROMPT)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							// The session's own model, read after the routed run settled rather than in the same
							// breath as the selection: `set_model` answers with the model it resolved, and reading the
							// state before the reload that selection ends reports the model the session started on.
							// This is a different row from the role's target the readback reports beside it.
							{
								requests: [
									{ id: "mp-state", type: "get_state" },
									promptCommand("mp-read", "/compat-purpose-readback"),
								],
								waitFor: (records, since) => records.slice(since).some((record) => record.type === "response" && record.id === "mp-read"),
								timeoutMs: RPC_TIMEOUT_MS,
							},
						],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const modelReadback = await readProbeResult(modelPurposePath);
					const savedTarget = `${COMPAT_PROVIDER}/${FAKE_MODEL_ID}`;
					// The session's own model. `set_model` answers with the model it selected and `get_state`
					// reports what the session is holding afterwards, and the two are the selection and its readback.
					// Which model it is does not matter to this row — that the session moved and says so does — and
					// it is not the role's target either, which the readback below reports separately.
					const modelName = (value: unknown): string | undefined => {
						const model = value as { provider?: string; id?: string } | undefined;
						return model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
					};
					const stateResponse = findResponse(modelRun.records, "get_state");
					purposes.push(
						...modelPurposeObservations({
							attempted: modelReadback !== undefined,
							reason:
								modelReadback === undefined ? `the readback reported nothing (${modelRun.stderr.trim().slice(0, 160)})` : undefined,
							requestedLevel: MODEL_PURPOSE_LEVEL,
							observedLevel: reasoningEffortFor(levelProvider, MODEL_PURPOSE_PROMPT),
							roleModelSaved: modelReadback?.defaults?.normal === savedTarget,
							sessionSelection: {
								requested: modelName(findResponse(modelRun.records, "set_model")?.data),
								readBack: modelName((stateResponse?.data as { model?: unknown } | undefined)?.model),
							},
						}),
					);
				} finally {
					levelProvider.stop();
				}
// /spirits-clear: the session state is recorded around the command, and the conversation
				// purpose is decided from the request the provider received — the session file keeps every
				// message on purpose, so only the request can show what left the model's context.
				const todoToolCall: FakeToolCall = {
					name: "manage_todos",
					arguments: { updates: [{ op: "add", text: "compat todo" }] },
				};
				const clearBeforeMarker = `compat-clear-before-${Date.now()}`;
				const clearAfterMarker = `compat-clear-after-${Date.now()}`;
				const clearProvider = startFakeProvider(todoToolCall, {
					// Only the seed turn answers with a tool call, so the marked turns stay plain and the
					// last request is the one that carries the conversation after the boundary.
					reply: (body) => {
						const json = JSON.stringify(body ?? "");
						if (json.includes("compat seed a todo") && !json.includes('"role":"tool"')) {
							return { kind: "tool-call", toolCall: todoToolCall };
						}
						return { kind: "text", text: "ok" };
					},
				});
				let clearAttempt: Parameters<typeof clearPurposeObservations>[0];
				const clearPurposePath = join(runner.workRoot, "purpose-clear.json");
				let clearDiagnostics: { stderr: string; recordTypes: string[] } = { stderr: "", recordTypes: [] };
				try {
					const clearRun = await stagedProbe({
						command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath]),
						cwd: runner.workRoot,
						env: {
							...baseEnv,
							[FAKE_PROVIDER_ENV]: clearProvider.baseUrl,
							[PROBE_PURPOSE_ENV]: clearPurposePath,
							ANTHROPIC_API_KEY: undefined,
							OPENAI_API_KEY: undefined,
						},
						stages: [
							{ requests: [{ id: "clear-model", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
							{
								requests: [promptCommand("todo-1", "compat seed a todo")],
								waitFor: (records, since) => modelEvents(records.slice(since), "tool_execution_end").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							{
								requests: [promptCommand("clear-marker-before", clearBeforeMarker)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
							{ requests: [promptCommand("clear-before", "/compat-purpose-state before")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{ requests: [promptCommand("clear-run", "/spirits-clear")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{ requests: [promptCommand("clear-after", "/compat-purpose-state after")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{
								requests: [promptCommand("clear-marker-after", clearAfterMarker)],
								waitFor: (records, since) => modelEvents(records.slice(since), "agent_settled").length > 0,
								timeoutMs: RPC_TIMEOUT_MS,
							},
						],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const states = (await readProbeResult(clearPurposePath))?.purposeStates;
					clearDiagnostics = {
						stderr: clearRun.stderr.trim(),
						recordTypes: [...new Set(clearRun.records.map((record) => String(record.type)))],
					};
					const lastRequest = clearProvider.requests.at(-1);
					const lastBody = JSON.stringify(lastRequest?.body ?? "");
					clearAttempt = {
						attempted: true,
						before: states?.before as ClearStateRecord | undefined,
						after: states?.after as ClearStateRecord | undefined,
						context:
							lastRequest === undefined
								? { observed: false, detail: "the fake provider recorded no request around the clear" }
								: {
										observed: lastBody.includes(clearAfterMarker),
										cleared: lastBody.includes(clearAfterMarker) && !lastBody.includes(clearBeforeMarker),
										detail: lastBody.includes(clearBeforeMarker)
											? `the request after the command still carried the conversation from before it (${clearBeforeMarker})`
											: `the request after the command carried ${clearAfterMarker} and not ${clearBeforeMarker}, while the session file kept every message entry`,
									},
						reason: clearRun.stderr.includes("unknown command") ? "the host rejected /spirits-clear on the RPC surface" : undefined,
					};
				} finally {
					clearProvider.stop();
				}
				purposes.push(...clearPurposeObservations(clearAttempt));

				// A clear boundary only helps while everything that rebuilds the context after it keeps
				// honouring it. Each item below drives one of those paths on the dedicated Pi and is judged
				// by the request the fake provider received and the entries the host wrote.
				const boundarySettled = (records: readonly RpcRecord[], since: number) =>
					records.slice(since).some((record) => record.type === "agent_settled");
				const boundaryPrompt = (id: string, message: string): RpcStep => ({
					requests: [promptCommand(id, message)],
					waitFor: boundarySettled,
					timeoutMs: RPC_TIMEOUT_MS,
				});
				const boundaryCommand = (id: string, line: string): RpcStep => ({
					requests: [promptCommand(id, line)],
					waitFor: () => false,
					timeoutMs: PURPOSE_SETTLE_MS,
				});
				// Pi decides compaction from the settings file, so the threshold the boundary items are measured
				// against has to be in place before the launch. The items that judge the settings file itself
				// already ran, and nothing after this point reads it. The other keys are kept: dropping the
				// provider and model entries would route these items somewhere other than the fake endpoint.
				await Bun.write(
					join(runner.agentDir, "settings.json"),
					`${JSON.stringify({ compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 } }, null, "\t")}\n`,
				);
				const boundaryStage = (options: {
					purpose: string;
					provider: BoundaryProvider;
					stages: readonly RpcStep[];
					sessionFile?: string;
				}) =>
					stagedProbe({
						command: launchCommand([PROVIDER_EXTENSION, launch.extensionPath], false, options.sessionFile),
						cwd: runner.workRoot,
						env: {
							...baseEnv,
							[FAKE_PROVIDER_ENV]: options.provider.baseUrl,
							[PROBE_PURPOSE_ENV]: join(runner.workRoot, `${options.purpose}.json`),
							// A stage that failed to select the compat model has to fail loudly. With a key present
							// pi would pick a real provider and the item would measure nothing while looking like it
							// measured something.
							ANTHROPIC_API_KEY: "",
							OPENAI_API_KEY: "",
						},
						stages: options.stages,
						timeoutMs: RPC_TIMEOUT_MS,
					});
				const boundaryStates = async (purpose: string) =>
					(await readProbeResult(join(runner.workRoot, `${purpose}.json`)))?.purposeStates;
				/** A session file that outlives its process, which the fork, tree move, and resume reopen. */
				const boundarySessionFile = (purpose: string) => join(runner.workRoot, `${purpose}-session.jsonl`);
				/** One seeded session with a cleared conversation in it, kept for the items that reopen it. */
				const seedBoundarySession = async (purpose: string, markers: { before: string; after: string }) => {
					const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
					const sessionFile = boundarySessionFile(purpose);
					try {
						await boundaryStage({
							purpose,
							provider,
							sessionFile,
							stages: [
								{ requests: [{ id: `${purpose}-model`, type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
								boundaryPrompt(`${purpose}-before`, `${markers.before} answer ok`),
								boundaryCommand(`${purpose}-clear`, "/spirits-clear"),
								boundaryPrompt(`${purpose}-after`, `${markers.after} answer ok`),
								boundaryCommand(`${purpose}-state`, "/compat-purpose-state seed"),
							],
						});
					} finally {
						provider.stop();
					}
					const seeded = (await boundaryStates(purpose))?.seed;
					return seeded === undefined ? undefined : { ...seeded, sessionFile: seeded.sessionFile ?? sessionFile };
				};
				/** A stage set whose provider never answered measured nothing, whatever the host wrote. */
				const noRequestSeen = (provider: BoundaryProvider): BoundaryJudgement | undefined =>
					provider.requests.length === 0
						? { state: "not-run", detail: "the fake provider received no request, so the compat model never answered" }
						: undefined;

				await run(CLEAR_BOUNDARY_ITEMS.automaticCompaction, async () => {
					const markers = { before: `compat-clear-auto-before-${Date.now()}`, after: `compat-clear-auto-after-${Date.now()}` };
					// The threshold has to be crossed by the turn that follows the clear. Pi checks it when a
					// turn ends, so triggering on the conversation before the boundary would compact before
					// the command and measure pi's own summary instead of the takeover.
					const provider = startBoundaryProvider(markers.after);
					try {
						const probed = await boundaryStage({
							purpose: "boundary-auto",
							provider,
							stages: [
								{ requests: [{ id: "auto-model", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
								boundaryPrompt("auto-before", `${markers.before} answer ok`),
								boundaryCommand("auto-clear", "/spirits-clear"),
								boundaryPrompt("auto-after", `${markers.after} answer ok`),
								boundaryPrompt("auto-follow", `${markers.after} follow up answer ok`),
								boundaryCommand("auto-state", "/compat-purpose-state observed"),
							],
						});
						const observed = (await boundaryStates("boundary-auto"))?.observed;
						const compactions = compactionRecords(observed);
						return {
							...(noRequestSeen(provider) ??
								judgeAutomaticCompaction({
									attempted: true,
									compactions,
									summarizationRequests: provider.summarizationRequests(),
									followingRequest: provider.bodyWith("follow up answer ok"),
									beforeMarker: markers.before,
									afterMarker: markers.after,
								})),
							data: {
								stderr: probed.stderr.trim().slice(0, 300),
								requests: provider.requests.length,
								compactions: compactions.map((entry) => ({
									fromHook: entry.fromHook,
									firstKeptEntryId: entry.firstKeptEntryId,
									summary: entry.summary?.slice(0, 160),
								})),
							},
						};
					} finally {
						provider.stop();
					}
				});

				await run(CLEAR_BOUNDARY_ITEMS.manualCompaction, async () => {
					const markers = { before: `compat-clear-manual-before-${Date.now()}`, after: `compat-clear-manual-after-${Date.now()}` };
					const attempt = async (purpose: string, stages: readonly RpcStep[]): Promise<ManualCompactionAttempt> => {
						const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
						try {
							const probed = await boundaryStage({ purpose, provider, stages });
							const response = probed.records.find((record) => record.type === "response" && record.command === "compact");
							const entry = compactionRecords((await boundaryStates(purpose))?.observed).at(-1);
							return {
								ran: response?.success === true,
								error: response?.error ?? (provider.requests.length === 0 ? "the fake provider received no request" : undefined),
								summary: (response?.data as { summary?: string } | undefined)?.summary ?? entry?.summary,
								fromHook: entry?.fromHook,
								summarizationRequests: provider.summarizationRequests(),
							};
						} finally {
							provider.stop();
						}
					};
					const seed = (purpose: string): RpcStep => ({
						requests: [{ id: `${purpose}-model`, type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }],
					});
					// Cleared conversation sits inside the span pi is about to summarize.
					const clearedSpan = await attempt("boundary-manual-cleared", [
						seed("boundary-manual-cleared"),
						boundaryPrompt("manual-before", `${markers.before} answer ok`),
						boundaryCommand("manual-clear", "/spirits-clear"),
						boundaryPrompt("manual-after", `${markers.after} answer ok`),
						{ requests: [{ id: "manual-cleared-compact", type: "compact" }] },
						boundaryCommand("manual-cleared-state", "/compat-purpose-state observed"),
					]);
					// The boundary has nothing cleared behind it, so pi's own summary has to survive.
					const cleanSpan = await attempt("boundary-manual-clean", [
						seed("boundary-manual-clean"),
						boundaryCommand("manual-clean", "/spirits-clear"),
						boundaryPrompt("manual-kept-one", `${markers.after} kept one answer ok`),
						boundaryPrompt("manual-kept-two", `${markers.after} kept two answer ok`),
						{ requests: [{ id: "manual-clean-compact", type: "compact" }] },
						boundaryCommand("manual-clean-state", "/compat-purpose-state observed"),
					]);
					return {
						...judgeManualCompaction({ attempted: true, clearedSpan, cleanSpan, beforeMarker: markers.before }),
						data: { clearedSpan, cleanSpan },
					};
				});

				await run(CLEAR_BOUNDARY_ITEMS.fork, async () => {
					const markers = { before: `compat-clear-fork-before-${Date.now()}`, after: `compat-clear-fork-after-${Date.now()}` };
					const seeded = await seedBoundarySession("boundary-fork", markers);
					const target = forkTargetOf(seeded?.branch ?? []);
					if (seeded?.sessionFile === undefined || target === undefined) {
						return {
							...judgeFork({ attempted: false, reason: "the seeded session reported no boundary and no message after it" }),
							data: { branch: seeded?.branch },
						};
					}
					const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
					try {
						const probed = await boundaryStage({
							purpose: "boundary-fork-run",
							provider,
							sessionFile: seeded.sessionFile,
							stages: [
								{ requests: [{ id: "fork-model", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
								{ requests: [{ id: "fork-run", type: "fork", entryId: target.id }] },
								boundaryCommand("fork-state", "/compat-purpose-state forked"),
								boundaryPrompt("fork-prompt", "forked answer ok"),
							],
						});
						const forked = (await boundaryStates("boundary-fork-run"))?.forked;
						const response = probed.records.find((record) => record.type === "response" && record.id === "fork-run");
						return {
							...(noRequestSeen(provider) ??
								judgeFork({
									attempted: true,
									forked: response?.success === true,
									reason: response?.error ?? "the host refused the fork",
									sessionFile: forked?.sessionFile,
									parentSessionFile: seeded.sessionFile,
									followingRequest: provider.bodyWith("forked answer ok"),
									beforeMarker: markers.before,
								})),
							data: { forkTarget: target.id, parentSessionFile: seeded.sessionFile, forkedSessionFile: forked?.sessionFile },
						};
					} finally {
						provider.stop();
					}
				});

				await run(CLEAR_BOUNDARY_ITEMS.treeMove, async () => {
					const markers = { before: `compat-clear-tree-before-${Date.now()}`, after: `compat-clear-tree-after-${Date.now()}` };
					const seeded = await seedBoundarySession("boundary-tree", markers);
					const target = treeTargetOf(seeded?.branch ?? [], markers.before);
					if (seeded?.sessionFile === undefined || target === undefined) {
						return {
							...judgeTreeMove({ attempted: false, reason: "the seeded session reported no reply that carried the cleared message" }),
							data: { branch: seeded?.branch },
						};
					}
					const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
					try {
						await boundaryStage({
							purpose: "boundary-tree-run",
							provider,
							sessionFile: seeded.sessionFile,
							stages: [
								{ requests: [{ id: "tree-model", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
								boundaryCommand("tree-move", `/compat-purpose-navigate ${target.id}`),
								boundaryPrompt("tree-prompt", "moved answer ok"),
							],
						});
						const moved = (await boundaryStates("boundary-tree-run"))?.navigate;
						return {
							...(noRequestSeen(provider) ??
								judgeTreeMove({
									attempted: true,
									moved: moved?.moved === true,
									reason: moved?.error ?? "the extension API refused the move",
									followingRequest: provider.bodyWith("moved answer ok"),
									beforeMarker: markers.before,
								})),
							data: { treeTarget: target.id, branchAfterMove: moved?.branch },
						};
					} finally {
						provider.stop();
					}
				});

				await run(CLEAR_BOUNDARY_ITEMS.resume, async () => {
					const markers = { before: `compat-clear-resume-before-${Date.now()}`, after: `compat-clear-resume-after-${Date.now()}` };
					const seeded = await seedBoundarySession("boundary-resume", markers);
					if (seeded?.sessionFile === undefined) {
						return judgeResume({ attempted: false, reason: "the seeded session reported no session file to reopen" });
					}
					const provider = startBoundaryProvider(NO_AUTOMATIC_COMPACTION);
					try {
						await boundaryStage({
							purpose: "boundary-resume-run",
							provider,
							sessionFile: seeded.sessionFile,
							stages: [
								{ requests: [{ id: "resume-model", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
								boundaryCommand("resume-state", "/compat-purpose-state resumed"),
								boundaryPrompt("resume-prompt", "resumed answer ok"),
							],
						});
						const resumed = (await boundaryStates("boundary-resume-run"))?.resumed;
						return {
							...(noRequestSeen(provider) ??
								judgeResume({
									attempted: true,
									sessionFile: seeded.sessionFile,
									openedSessionFile: resumed?.sessionFile,
									followingRequest: provider.bodyWith("resumed answer ok"),
									beforeMarker: markers.before,
								})),
							data: { sessionFile: seeded.sessionFile, openedSessionFile: resumed?.sessionFile },
						};
					} finally {
						provider.stop();
					}
				});

				const rows = deriveRows(purposes);
				validateMatrix(rows);
				validatePurposeObservations(purposes);
				const observedPurposes = purposes.filter((purpose) => purpose.state !== "not-run");
				const unavailablePurposes = purposes.filter((purpose) => purpose.state === "unavailable");
				// `confirmed` here means the purpose was observed behaving on the dedicated Pi. It does not
				// mean every purpose works: an observation of a missing capability is `unavailable`, and it
				// still counts as observed. The row states and the per-purpose states are both in `data`.
				await run("role/clear/model matrix", async () => ({
					state: observedPurposes.length > 0 ? ("confirmed" as const) : ("not-run" as const),
					detail:
						observedPurposes.length > 0
							? `confirmed here means observed on the dedicated Pi, including ${unavailablePurposes.length} purpose(s) observed as unavailable; ${observedPurposes.length} of ${purposes.length} purposes observed, rows derive from those observations`
							: "no role/clear/model purpose could be observed on this host",
					data: {
						confirmedMeans: "a purpose behaviour was observed on the dedicated Pi; unavailable is an observation too",
						rows,
						purposes,
						clearAttempt,
						clearDiagnostics,
					},
				}));

				runner.setEvidence({
					runtime: buildRuntimeEvidence({
						// The runner side names its own runtime; the host side comes from the value the probe
						// extension read inside the managed Pi process.
						runnerRuntime: identifyRuntime({
							bunVersion: typeof Bun === "undefined" ? undefined : Bun.version,
							nodeVersion: process.version,
						}),
						hostRuntime: state?.hostRuntime,
						requiredApis: state?.apis,
						extension: measuredExtension,
					}),
				});
			} catch (error) {
				// A failed official verification must stop the run without writing a result, so the
				// evidence can never record a launch that was not measured against the official set.
				if (error instanceof OfficialArtifactError) throw error;
				const reason = managedSetFailureMessage(error instanceof Error ? error.message : String(error));
				for (const name of processItems) {
					if (!recorded.has(name)) notRun(name, reason);
				}
			}
		}

		// Measured after every launch, and a changed existing agent dir is a failed item, so the exit
		// code below reflects it.
		await runner.verifyExistingAgentDir();
		const resultPath = await runner.writeResult(options.out);
		const evidence = runner.buildEvidence();
		const results = runner.results();
		console.log(`Compatibility result: ${resultPath}`);
		console.log(formatStateCounts(countStates(results)));
		console.log(
			`mode=${evidence.mode} runnerCompleted=${evidence.runnerCompleted} compatibilityMet=${evidence.compatibilityMet}`,
		);
		const failed = results.some((result) => result.state === "failed");
		if (failed) return 1;
		// A guard violation is reported through the item above; the evidence field must agree with it.
		if (evidence.existingAgentDirUnchanged === false) return 1;
		if (options.mode === "official" && !evidence.compatibilityMet) return 1;
		return 0;
	} finally {
		if (!options.keep) await runner.cleanup();
	}
}

if (import.meta.main) {
	try {
		process.exit(await main());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
