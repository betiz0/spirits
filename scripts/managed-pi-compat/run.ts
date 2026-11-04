/**
 * Managed Pi compatibility runner.
 *
 * Usage:
 *   bun scripts/managed-pi-compat/run.ts [--artifact-root <managed-root>] [--keep] [--out <path>]
 *
 * Local, pure checks always run. Process checks use the official artifact only when a managed
 * root with an installed `current` set is supplied; otherwise they are recorded as `not-run`,
 * never as success. The runner never reads or writes the user's real agent dir.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeManagedEnv } from "../../packages/spirits/src/managed-pi/environment.ts";
import { managedRoot, readCurrentSet } from "../../packages/spirits/src/managed-pi/layout.ts";
import { managedSetFailureMessage, verifyManagedSet } from "../../packages/spirits/src/managed-pi/verify.ts";
import {
	classifyBundledMarkdown,
	classifyEnv,
	classifyExtensionLoad,
	classifyHelpSideEffects,
	classifyHostVersion,
	classifyPreservedEnv,
	classifyWrittenMarkdown,
	listFiles,
} from "./probes.ts";
import type { CompatState } from "./runner.ts";
import { applyProbeObservations, COMPAT_MATRIX, type MatrixObservation, validateMatrix } from "./matrix.ts";
import { createCompatRunner, type CompatResult } from "./runner.ts";
import { requestFakeToolCall, startFakeProvider } from "./fake-provider.ts";
import { createProbeTsreplTool, executeCapturedTsrepl, simpleReturnValue } from "./tsrepl.ts";
import { findResponse, runCommandProbe, runRpcProbe, type RpcRecord } from "./rpc.ts";
import { copyRedactedAgentFixture, classifyRead, classifyWrite, readAgentDirSnapshot } from "./data.ts";
import { classifyAutoChild, classifyPhysicalChild } from "./rlm.ts";

interface CliOptions {
	artifactRoot?: string;
	out?: string;
	keep: boolean;
}

const PROBE_EXTENSION = join(import.meta.dir, "fixtures", "probe-extension.ts");
const PROVIDER_EXTENSION = join(import.meta.dir, "fixtures", "custom-provider.ts");
const REDACTED_AGENT = join(import.meta.dir, "fixtures", "redacted-agent");
const PROBE_STATE_ENV = "MANAGED_PI_COMPAT_PROBE_STATE";
const PROBE_RESULT_ENV = "MANAGED_PI_COMPAT_PROBE_RESULT";
const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";
const FAKE_API_KEY = "compat-fake-key";
const FAKE_PROXY = "http://compat-proxy.invalid";
const RPC_TIMEOUT_MS = 60_000;

interface ProbeState {
	sessionStarted: boolean;
	tools: string[];
	captured: string[];
	hostVersion?: string;
	appName?: string;
	packageDir?: string;
	agentDir?: string;
	oldAgentDir?: string;
	apiKey?: string;
	proxy?: string;
}

interface ProbeResult {
	text: string;
	isError: boolean;
	bypassedPiHooks?: boolean;
	rlmUsage?: unknown[];
}

function parseArgs(args: readonly string[]): CliOptions {
	const options: CliOptions = { keep: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--keep") {
			options.keep = true;
		} else if (arg === "--artifact-root") {
			options.artifactRoot = args[++index];
		} else if (arg === "--out") {
			options.out = args[++index];
		} else if (arg === "--help" || arg === "-h") {
			console.log("Usage: bun scripts/managed-pi-compat/run.ts [--artifact-root <managed-root>] [--out <path>] [--keep]");
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function modelEvents(records: readonly RpcRecord[], type: string): RpcRecord[] {
	return records.filter((record) => record.type === type);
}

function promptCommand(id: string, message: string) {
	return { id, type: "prompt" as const, message };
}

function cellState(result: ProbeResult | undefined, expected: unknown): { state: CompatState; detail: string } {
	if (!result) return { state: "failed", detail: "probe command produced no result" };
	if (result.isError) return { state: "failed", detail: result.text };
	const value = simpleReturnValue({
		text: result.text,
		isError: false,
		details: undefined,
		bypassedPiHooks: true,
	});
	return value === expected
		? { state: "confirmed", detail: "cell ran inside the managed Pi probe process" }
		: { state: "failed", detail: `cell returned ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}` };
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

function commandsFrom(records: readonly RpcRecord[]): string[] {
	const response = findResponse(records, "get_commands");
	const data = response?.data as { commands?: Array<{ name?: string }> } | undefined;
	return (data?.commands ?? []).map((command) => command.name ?? "").filter((name) => name.length > 0);
}

function observationsFrom(tools: readonly string[], commands: readonly string[]): MatrixObservation[] {
	const roleRows = COMPAT_MATRIX.filter((row) => row.feature === "role");
	const clearRow = COMPAT_MATRIX.find((row) => row.feature === "clear");
	const modelRows = COMPAT_MATRIX.filter((row) => row.feature === "model");
	const observations: MatrixObservation[] = [];
	if (roleRows[0]) {
		observations.push({
			feature: "role",
			purpose: roleRows[0].purpose,
			state: tools.includes("tsrepl") ? "limited" : "unavailable",
			detail: "routing is observed through the managed extension load",
		});
	}
	if (roleRows[1]) observations.push({ feature: "role", purpose: roleRows[1].purpose, state: "unavailable" });
	if (roleRows[2]) observations.push({ feature: "role", purpose: roleRows[2].purpose, state: "unavailable" });
	if (clearRow) {
		observations.push({
			feature: "clear",
			purpose: clearRow.purpose,
			state: commands.includes("clear") ? "limited" : "unavailable",
			detail: "a command named clear does not preserve the session ID",
		});
	}
	if (modelRows[0]) {
		observations.push({
			feature: "model",
			purpose: modelRows[0].purpose,
			state: commands.includes("model") ? "limited" : "unavailable",
		});
	}
	if (modelRows[1]) observations.push({ feature: "model", purpose: modelRows[1].purpose, state: "unavailable" });
	return observations;
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	const runner = await createCompatRunner();
	const recorded = new Map<string, CompatResult>();
	const run = async (name: string, check: () => Promise<{ state: CompatState; detail?: string; data?: unknown }>) => {
		const result = await runner.run(name, check);
		recorded.set(name, result);
		return result;
	};
	const notRun = (name: string, detail?: string) => {
		recorded.set(name, runner.notRun(name, detail));
	};
	try {
		validateMatrix();
		await run("role/clear/model matrix is internally consistent", async () => ({
			state: "confirmed",
			detail: `${COMPAT_MATRIX.length} rows, unavailable rows have alternatives`,
		}));

		const localTool = createProbeTsreplTool();
		await run("tsrepl simple cell", async () => {
			const result = await executeCapturedTsrepl(localTool, "return 1 + 1", runner.workRoot);
			return simpleReturnValue(result) === 2
				? { state: "confirmed", detail: "local probe cell returned 2 (probe bypasses Pi hooks)" }
				: { state: "failed", detail: result.text };
		});

		const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1 + 1" } });
		try {
			await run("fake provider reaches tsrepl", async () => {
				const response = await requestFakeToolCall(provider.baseUrl, "tsrepl");
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
			provider.stop();
		}

		await run("compatibility matrix validation", async () => {
			validateMatrix();
			return { state: "confirmed", detail: "unavailable rows carry an alternative and difference" };
		});

		const artifactRoot = options.artifactRoot
			? options.artifactRoot.replace(/^~(?=\/|$)/, homedir())
			: managedRoot();
		const setId = await readCurrentSet(artifactRoot);
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
			"no real credentials are read",
			"rlm physical model child",
			"rlm child usage",
			"rlm child abort",
			"rlm auto parent",
			"data read compatibility",
			"data write compatibility",
			"role/clear/model matrix",
		];
		if (!setId) {
			for (const name of processItems) notRun(name, "no current managed set");
		} else {
			try {
				const verified = await verifyManagedSet(artifactRoot, setId);
				const managedPi = join(artifactRoot, "current", "pi", "pi");
				const managedEnv = (extra: Record<string, string | undefined> = {}) =>
					computeManagedEnv({
						env: runner.env({
							ANTHROPIC_API_KEY: FAKE_API_KEY,
							HTTPS_PROXY: FAKE_PROXY,
							...extra,
						}),
						// The runner always writes to its own temporary agent dir, never to the measured
						// managed root. This isolation is a test property, not a product safety control.
						agentDir: runner.agentDir,
						packageDir: verified.packageDir,
					});
				const baseEnv = managedEnv({ [PROBE_STATE_ENV]: join(runner.workRoot, "probe-state.json") });
				const loadRun = await runRpcProbe({
					command: [
						managedPi,
						"--mode",
						"rpc",
						"--no-session",
						"--no-extensions",
						"-e",
						PROBE_EXTENSION,
						"-e",
						verified.extensionPath,
					],
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
				await run("managed extension load", async () =>
					classifyExtensionLoad({ sessionStarted, tools: toolNames, stderr: loadRun.stderr }),
				);
				await run("agent dir precedence", async () =>
					state
						? classifyEnv(
								{
									agentDir: state.agentDir,
									packageDir: state.packageDir,
									appName: state.appName,
									version: state.hostVersion,
									packageDirDecoyUsed: state.packageDir !== verified.packageDir,
									apiKey: state.apiKey,
									proxy: state.proxy,
								},
								{ agentDir: runner.agentDir, version: verified.manifest.pi.version },
							)
						: { state: "not-run", detail: "the probe did not report its environment" },
				);
				await run("help touches only the isolated home", async () => {
					const before = new Set(listFiles(runner.home));
					const help = await runCommandProbe({
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
					const version = await runCommandProbe({
						command: [managedPi, "--version"],
						cwd: runner.workRoot,
						env: managedEnv({ PI_PACKAGE_DIR: decoy }),
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const output = version.stdout.trim();
					return output.includes(verified.manifest.pi.version) && !output.includes("9.9.9")
						? { state: "confirmed", detail: "the decoy package dir did not change the version" }
						: { state: "failed", detail: `version output was ${output || version.stderr.trim()}` };
				});
				await run("bundled SKILL.md is raw markdown", async () => {
					const skill = listFiles(runner.agentDir).find((path) => path.endsWith("SKILL.md"));
					return skill
						? classifyWrittenMarkdown(skill)
						: { state: "not-run", detail: "the session did not write a bundled SKILL.md" };
				});
				await run("host version", async () =>
					state
						? classifyHostVersion(state.hostVersion, verified.manifest.pi.version)
						: { state: "not-run", detail: "the probe did not report the host version" },
				);
				const cell = async (name: string, code: string, expected: unknown) =>
					run(name, async () => {
						const resultPath = join(runner.workRoot, `${name.replace(/[^a-z0-9]+/gi, "-")}.json`);
						const result = await runRpcProbe({
							command: [
								managedPi,
								"--mode",
								"rpc",
								"--no-session",
								"--no-extensions",
								"-e",
								PROBE_EXTENSION,
								"-e",
								verified.extensionPath,
							],
							cwd: runner.workRoot,
							env: { ...baseEnv, [PROBE_RESULT_ENV]: resultPath },
							requests: [promptCommand("prompt-1", `/compat-probe ${code}`)],
							timeoutMs: RPC_TIMEOUT_MS,
						});
						const failure = findResponse(result.records, "prompt")?.success === false;
						return cellState(await readProbeResult(resultPath), failure ? undefined : expected);
					});
				await cell("managed tsrepl simple cell", "return 1 + 1", 2);
				await cell("managed tsrepl Bun.Transpiler cell", "const n: number = 2; return n", 2);
				await cell("managed tsrepl node:vm cell", "const vm = await use('node:vm'); return vm.runInNewContext('1 + 2')", 3);
				await run("cell failure is not reported as a load failure", async () => {
					const resultPath = join(runner.workRoot, "cell-failure.json");
					await runRpcProbe({
						command: [
							managedPi,
							"--mode",
							"rpc",
							"--no-session",
							"--no-extensions",
							"-e",
							PROBE_EXTENSION,
							"-e",
							verified.extensionPath,
						],
						cwd: runner.workRoot,
						env: { ...baseEnv, [PROBE_RESULT_ENV]: resultPath },
						requests: [promptCommand("prompt-1", "/compat-probe throw new Error('cell boom')")],
						timeoutMs: RPC_TIMEOUT_MS,
					});
					const result = await readProbeResult(resultPath);
					return result?.isError && result.text.includes("cell boom")
						? { state: "confirmed", detail: "cell failure is separate from extension load" }
						: { state: "failed", detail: "the cell failure was not observed" };
				});

				const provider = startFakeProvider(
					{ name: "tsrepl", arguments: { code: "return 1 + 1" } },
					{ finalAnswerAfterToolResult: "finished" },
				);
				try {
					await run("model tool call reaches tsrepl", async () => {
						const result = await runRpcProbe({
							command: [
								managedPi,
								"--mode",
								"rpc",
								"--no-session",
								"--no-extensions",
								"-e",
								PROBE_EXTENSION,
								"-e",
								PROVIDER_EXTENSION,
								"-e",
								verified.extensionPath,
							],
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
						const starts = modelEvents(result.records, "tool_execution_start");
						const ends = modelEvents(result.records, "tool_execution_end");
						const reached =
							starts.some((record) => record.toolName === "tsrepl") &&
							ends.some((record) => record.toolName === "tsrepl" && record.isError !== true);
						return reached
							? {
									state: "confirmed",
									detail: "fake provider tool call reached tsrepl; not real-provider compatibility",
									data: { scope: "fake-provider", realProviderCompatibility: false },
								}
							: { state: "failed", detail: result.stderr || "the tool call did not reach tsrepl" };
					});
					await run("no real credentials are read", async () => {
						const authorization = provider.requests.map((request) => request.authorization ?? "");
						return authorization.every((value) => value === "Bearer fake" || value === "")
							? { state: "confirmed", detail: "only the fake bearer token was sent" }
							: { state: "failed", detail: "a non-fake authorization header reached the fake provider" };
					});
					await run("rlm physical model child", async () => {
						const resultPath = join(runner.workRoot, "rlm-physical.json");
						const result = await runRpcProbe({
							command: [
								managedPi,
								"--mode",
								"rpc",
								"--no-session",
								"--no-extensions",
								"-e",
								PROBE_EXTENSION,
								"-e",
								PROVIDER_EXTENSION,
								"-e",
								verified.extensionPath,
							],
							cwd: runner.workRoot,
							env: {
								...baseEnv,
								[FAKE_PROVIDER_ENV]: provider.baseUrl,
								[PROBE_RESULT_ENV]: resultPath,
								ANTHROPIC_API_KEY: undefined,
								OPENAI_API_KEY: undefined,
							},
							requests: [
								{ id: "model-1", type: "set_model", provider: "compat-fake", modelId: "fake-model" },
								promptCommand("prompt-1", '/compat-probe return await rlm("child task")'),
							],
							timeoutMs: RPC_TIMEOUT_MS,
						});
						const probe = await readProbeResult(resultPath);
						const child = classifyPhysicalChild({
							childCreated: probe !== undefined && !probe.isError,
							finalAnswer: probe?.text,
							usageRecorded: (probe?.rlmUsage?.length ?? 0) > 0,
							abortReported: undefined,
							error: probe?.text ?? result.stderr,
						});
						return child;
					});
					await run("rlm child usage", async () => {
						const probe = await readProbeResult(join(runner.workRoot, "rlm-physical.json"));
						return (probe?.rlmUsage?.length ?? 0) > 0
							? { state: "confirmed", detail: "rlm_usage was recorded by the child" }
							: { state: "not-run", detail: "no rlm_usage entry was observed" };
					});
					notRun("rlm child abort", "abort requires a delayed provider response; not exercised in this run");
					await run("rlm auto parent", async () => {
						const resultPath = join(runner.workRoot, "rlm-auto.json");
						const result = await runRpcProbe({
							command: [
								managedPi,
								"--mode",
								"rpc",
								"--no-session",
								"--no-extensions",
								"-e",
								PROBE_EXTENSION,
								"-e",
								PROVIDER_EXTENSION,
								"-e",
								verified.extensionPath,
							],
							cwd: runner.workRoot,
							env: {
								...baseEnv,
								[FAKE_PROVIDER_ENV]: provider.baseUrl,
								[PROBE_RESULT_ENV]: resultPath,
								ANTHROPIC_API_KEY: undefined,
								OPENAI_API_KEY: undefined,
							},
							requests: [
								{ id: "model-1", type: "set_model", provider: "spirits", modelId: "auto" },
								promptCommand("prompt-1", '/compat-probe return await rlm("child task")'),
							],
							timeoutMs: RPC_TIMEOUT_MS,
						});
						const setModel = findResponse(result.records, "set_model");
						const probe = await readProbeResult(resultPath);
						return classifyAutoChild({
							childCreated: probe !== undefined && !probe.isError,
							finalAnswer: probe?.text,
							usageRecorded: (probe?.rlmUsage?.length ?? 0) > 0,
							error: setModel?.success === false ? "spirits/auto was not selectable" : probe?.text ?? result.stderr,
						});
					});
				} finally {
					provider.stop();
				}

				await run("data read compatibility", async () => {
					const copy = join(runner.workRoot, "redacted-agent-copy");
					await copyRedactedAgentFixture(REDACTED_AGENT, copy);
					const first = readAgentDirSnapshot(copy);
					const second = readAgentDirSnapshot(copy);
					return first.settings === second.settings && first.sessions.length === second.sessions.length
						? classifyRead(first)
						: { state: "failed", detail: "the redacted copy changed while reading" };
				});
				await run("data write compatibility", async () => {
					const copy = join(runner.workRoot, "redacted-agent-write-copy");
					await copyRedactedAgentFixture(REDACTED_AGENT, copy);
					const before = await readFile(join(copy, "settings.json"), "utf8");
					const result = classifyWrite({ requiresConversion: true });
					const after = await readFile(join(copy, "settings.json"), "utf8");
					return before === after
						? result
						: { state: "failed", detail: "the fixture changed during the aborted write" };
				});

				const observations = observationsFrom(toolNames, commandsFrom(loadRun.records));
				const matrix = applyProbeObservations(observations);
				await run("role/clear/model matrix", async () => ({
					state: "confirmed",
					detail: "matrix rows were overridden by dedicated Pi observations",
					data: matrix,
				}));
			} catch (error) {
				const reason = managedSetFailureMessage(error instanceof Error ? error.message : String(error));
				for (const name of processItems) notRun(name, reason);
			}
		}

		const resultPath = await runner.writeResult(options.out);
		const results = runner.results();
		const counts = new Map<string, number>();
		for (const result of results) counts.set(result.state, (counts.get(result.state) ?? 0) + 1);
		console.log(`Compatibility result: ${resultPath}`);
		console.log([...counts].map(([state, count]) => `${state}=${count}`).join(" "));
		const failed = results.some((result) => result.state === "failed");
		return failed ? 1 : 0;
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
