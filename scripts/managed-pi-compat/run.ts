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
	type ClearStateRecord,
	type PurposeObservation,
} from "./matrix.ts";
import { createCompatRunner, type CompatRunner } from "./runner.ts";
import { requestFakeToolCall, startFakeProvider } from "./fake-provider.ts";
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
	rlmUsageOutcome,
	writeRlmFixture,
	type ChildAbortObservation,
	type RlmChildObservation,
} from "./rlm.ts";
import {
	buildRunnerProvenance,
	buildRuntimeEvidence,
	countStates,
	formatStateCounts,
	identifyRuntime,
} from "./evidence.ts";
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
const FAKE_MODEL_ID = "fake-model";
const STRONG_MODEL_ID = "fake-strong";
/** Skill command prefix and the bundled skill that puts the spirits router into its strong phase. */
const SKILL_COMMAND_PREFIX = "/skill:";
const STRONG_PHASE_SKILL = "sprt-opsx-review-change";
/** Prompt markers, so the request that carried one can be matched with the model that served it. */
const PLAIN_PROMPT = "compat plain prompt answer ok";
const STRONG_PROMPT = "compat strong prompt answer ok";
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
	purposeStates?: Record<string, { sessionId?: string; messageEntries?: number; todoEntries?: number }>;
	before?: { level?: string; model?: { provider: string; id: string }; defaults?: Record<string, string | undefined> };
	after?: { level?: string; model?: { provider: string; id: string }; defaults?: Record<string, string | undefined> };
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
				const verified = await verifyManagedSet(artifactRoot, setId);
				launch = {
					managedPi: verified.piExecutable,
					packageDir: verified.packageDir,
					extensionPath: verified.extensionPath,
					manifest: verified.manifest,
				};
			}
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
				const launchCommand = (extraExtensions: readonly string[] = [], agentExtensions = false) => [
					managedPi,
					"--mode",
					"rpc",
					"--no-session",
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
					await writeRlmFixture({
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
					};
				} finally {
					roleProvider.stop();
				}
				purposes.push(...rolePurposeObservations(strongAttempt));

				// /model: level selection and the saved defaults, read back through the runtime.
				const modelPurpose = await probeOnce(
					"purpose-model-1",
					"/compat-purpose-model",
					"purpose-model.json",
					[PROVIDER_EXTENSION],
					{ ...noRealCredentials, [FAKE_PROVIDER_ENV]: "http://127.0.0.1:9" },
				);
				purposes.push(
					...modelPurposeObservations({
						attempted: modelPurpose.probe !== undefined,
						reason: modelPurpose.probe === undefined ? "the probe reported no model-purpose attempt" : undefined,
						levelChanged: modelPurpose.probe?.levelChanged,
						setModelResult: modelPurpose.probe?.setModelResult,
						defaultsChanged: modelPurpose.probe?.defaultsChanged,
					}),
				);

				// /clear: session ID, conversation size, and TODO entries recorded around the command.
				const todoToolCall: FakeToolCall = {
					name: "manage_todos",
					arguments: { updates: [{ op: "add", text: "compat todo" }] },
				};
				const clearProvider = startFakeProvider(todoToolCall, {
					reply: (body) =>
						JSON.stringify(body ?? "").includes('"role":"tool"')
							? { kind: "text", text: "seeded" }
							: { kind: "tool-call", toolCall: todoToolCall },
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
							{ requests: [promptCommand("clear-before", "/compat-purpose-state before")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{ requests: [promptCommand("clear-run", "/clear")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
							{ requests: [promptCommand("clear-after", "/compat-purpose-state after")], waitFor: () => false, timeoutMs: PURPOSE_SETTLE_MS },
						],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const states = (await readProbeResult(clearPurposePath))?.purposeStates;
					clearDiagnostics = {
						stderr: clearRun.stderr.trim(),
						recordTypes: [...new Set(clearRun.records.map((record) => String(record.type)))],
					};
					clearAttempt = {
						attempted: true,
						before: states?.before as ClearStateRecord | undefined,
						after: states?.after as ClearStateRecord | undefined,
						reason: clearRun.stderr.includes("unknown command") ? "the host rejected /clear on the RPC surface" : undefined,
					};
				} finally {
					clearProvider.stop();
				}
				purposes.push(...clearPurposeObservations(clearAttempt));

				const rows = deriveRows(purposes);
				validateMatrix(rows);
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
