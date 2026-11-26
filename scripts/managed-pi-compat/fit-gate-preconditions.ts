/**
 * Precondition measurements for the routing context-fit gate.
 *
 * `add-routing-context-fit-gate` plans to (D1) await `ctx.compact()` from an idle `input` handler,
 * (D6/D7) return `{ action: "handled" }` so no run starts, (D10) rely on the host refusing or
 * queueing inputs that arrive while that wait is open, and treat an abort like the TUI's Esc. The
 * pinned artifact has to confirm each of those before the product code is written, and this script
 * is the measurement: it launches the managed Pi (a staged fixture set around the just-built
 * bundle, in an isolated HOME) over RPC with `fixtures/fit-gate-probe.ts` and a local fake
 * provider, drives the scenarios below, and writes the change's precondition evidence to `--out`
 * (recorded at `openspec/changes/archive/2026-11-26-add-routing-context-fit-gate/evidence/precondition-results.json`).
 *
 * Run judgement basis (task 1.5): a run exists when the fake provider received a conversation
 * request or the RPC stream carried `agent_start`; `compaction_start` alone does not map to a run.
 * A compaction happened when the session records a new compaction entry; one compaction can carry
 * more than one summarization request (a split turn adds the turn-prefix summary).
 *
 * Usage:
 *   bun scripts/managed-pi-compat/fit-gate-preconditions.ts \
 *     --inputs <dir written by build-managed-pi-inputs.ts> --out <evidence.json> [--keep]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MANAGED_PI_EXTENSION_ASSET_NAME } from "../../packages/spirits/src/constants.ts";
import { computeManagedEnv } from "../../packages/spirits/src/managed-pi/environment.ts";
import { managedRoot, readCurrentSet } from "../../packages/spirits/src/managed-pi/layout.ts";
import { sha256Hex } from "../../packages/spirits/src/managed-pi/overlay.ts";
import { SUMMARIZATION_MARKERS } from "./clear-boundary.ts";
import { type FakeProviderRequest, startFakeProvider } from "./fake-provider.ts";
import { stageFixtureBundle } from "./fixture-bundle.ts";
import { FITGATE_HANDLED_MARKER, FITGATE_TEMPLATE_MARKER, FITGATE_WAIT_MARKER } from "./fixtures/fit-gate-probe.ts";
import type { RpcProbeResult, RpcRecord, RpcRequest, RpcStep } from "./rpc.ts";
import { runStagedRpcProbe } from "./rpc.ts";
import { createCompatRunner } from "./runner.ts";

/** Environment the probe extension writes its observations to. */
const FITGATE_ENV = "MANAGED_PI_COMPAT_FITGATE";
const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";
const COMPAT_PROVIDER = "compat-fake";
const FAKE_MODEL_ID = "fake-model";
/** The prompt marker that makes the fake provider answer slowly, so steering lands mid-run. */
const SLOW_MARKER = "FITGATE-SLOW";
const RPC_TIMEOUT_MS = 60_000;
/** Extension commands answer nothing over RPC, so their stage waits a fixed settle. */
const COMMAND_SETTLE_MS = 2_000;

interface CliOptions {
	inputs: string;
	out: string;
	keep: boolean;
}

function parseArgs(args: readonly string[]): CliOptions {
	const options: Partial<CliOptions> = { keep: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--inputs") options.inputs = args[++index];
		else if (arg === "--out") options.out = args[++index];
		else if (arg === "--keep") options.keep = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.inputs || !options.out) {
		throw new Error(
			"Usage: bun scripts/managed-pi-compat/fit-gate-preconditions.ts --inputs <build-output-dir> --out <evidence.json> [--keep]",
		);
	}
	return options as CliOptions;
}

/** The probe extension's evidence file, as one shape the driver reads back. */
interface ProbeEvidence {
	sessionModes: string[];
	commands: Array<{ name: string; source: string }>;
	inputs: Array<{
		text: string;
		source: string;
		streamingBehavior: string | null;
		mode: string;
		hasUI: boolean;
		isIdle: boolean;
		gateWaitActive: boolean;
	}>;
	compacts: Array<{
		marker: string;
		outcome:
			| { kind: "complete"; summaryChars: number; estimatedTokensAfter: number | null }
			| { kind: "error"; message: string };
		timeline: Array<{ atMs: number; phase: string; isIdle: boolean; pending?: boolean }>;
	}>;
	handled: Array<{ text: string }>;
	states: Record<
		string,
		{ messageEntries: number; compactionEntries: number; model?: { provider: string; id: string } }
	>;
	sent: Array<{ text: string }>;
}

const EMPTY_PROBE: ProbeEvidence = {
	sessionModes: [],
	commands: [],
	inputs: [],
	compacts: [],
	handled: [],
	states: {},
	sent: [],
};

async function readProbe(path: string): Promise<ProbeEvidence> {
	const file = Bun.file(path);
	if (!(await file.exists())) return EMPTY_PROBE;
	return { ...EMPTY_PROBE, ...(JSON.parse(await file.text()) as Partial<ProbeEvidence>) };
}

/** The local fake endpoint every scenario runs against. */
interface GateProvider {
	baseUrl: string;
	requests: FakeProviderRequest[];
	/** Requests the client hung up on before the reply was produced. */
	closedEarly(): FakeProviderRequest[];
	conversationRequests(): FakeProviderRequest[];
	summarizationRequests(): FakeProviderRequest[];
	/** Provider requests whose body carries `marker`. */
	requestsCarrying(marker: string): FakeProviderRequest[];
	stop(): void;
}

function makeProvider(options: { summaryDelayMs?: number; slowDelayMs?: number } = {}): GateProvider {
	const isSummarization = (body: unknown): boolean => {
		const json = JSON.stringify(body ?? "");
		return SUMMARIZATION_MARKERS.some((marker) => json.includes(marker));
	};
	const provider = startFakeProvider(
		{ name: "noop", arguments: {} },
		{
			reply: (body) => {
				if (isSummarization(body)) {
					return { kind: "text", text: "fitgate summary placeholder", delayMs: options.summaryDelayMs ?? 400 };
				}
				if (JSON.stringify(body ?? "").includes(SLOW_MARKER)) {
					return { kind: "text", text: "fitgate slow answer ok", delayMs: options.slowDelayMs ?? 1_500 };
				}
				return { kind: "text", text: "fitgate answer ok" };
			},
		},
	);
	const withBody = (): FakeProviderRequest[] => provider.requests.filter((request) => request.body !== undefined);
	return {
		baseUrl: provider.baseUrl,
		requests: provider.requests,
		closedEarly: provider.closedEarly,
		conversationRequests: () => withBody().filter((request) => !isSummarization(request.body)),
		summarizationRequests: () => withBody().filter((request) => isSummarization(request.body)),
		requestsCarrying: (marker) => withBody().filter((request) => JSON.stringify(request.body ?? "").includes(marker)),
		stop: provider.stop,
	};
}

/** Requests and launch environment shared by every scenario. */
function promptRequest(id: string, message: string): RpcRequest {
	return { id, type: "prompt", message };
}

function settledSince(records: readonly RpcRecord[], since: number): boolean {
	return records.slice(since).some((record) => record.type === "agent_settled");
}

function respondedTo(id: string): (records: readonly RpcRecord[], since: number) => boolean {
	return (records, since) => records.slice(since).some((record) => record.type === "response" && record.id === id);
}

function commandStep(id: string, line: string): RpcStep {
	return { requests: [promptRequest(id, line)], waitFor: () => false, timeoutMs: COMMAND_SETTLE_MS };
}

function promptStep(id: string, message: string): RpcStep {
	return { requests: [promptRequest(id, message)], waitFor: settledSince, timeoutMs: RPC_TIMEOUT_MS };
}

function responseFor(probed: RpcProbeResult, id: string): RpcRecord | undefined {
	return probed.records.find((record) => record.type === "response" && record.id === id);
}

function countEvents(probed: RpcProbeResult, type: string): number {
	return probed.records.filter((record) => record.type === type).length;
}

/** Events of one type recorded at or after `index` in the record list. */
function countEventsFrom(probed: RpcProbeResult, type: string, index: number): number {
	return probed.records.slice(index).filter((record) => record.type === type).length;
}

async function main(): Promise<number> {
	const cli = parseArgs(process.argv.slice(2));
	const bundlePath = join(cli.inputs, MANAGED_PI_EXTENSION_ASSET_NAME);
	if (!(await Bun.file(bundlePath).exists())) throw new Error(`bundle not found: ${bundlePath}`);
	const bundleSha256 = sha256Hex(new Uint8Array(await Bun.file(bundlePath).arrayBuffer()));

	const runner = await createCompatRunner({});
	const artifactRoot = managedRoot();
	const setId = await readCurrentSet(artifactRoot);
	if (!setId) {
		await runner.cleanup();
		throw new Error(
			`no installed managed set under ${artifactRoot}; the fixture route needs one for the Pi artifact`,
		);
	}
	const staged = await stageFixtureBundle({
		artifactRoot,
		setId,
		bundle: bundlePath,
		workRoot: runner.workRoot,
	});
	const managedPi = staged.set.piExecutable;
	const packageDir = staged.set.packageDir;

	/** Launch options every scenario repeats through the same probe and provider fixture. */
	const launch = (evidenceFile: string, provider: GateProvider) => {
		const env = computeManagedEnv({
			env: runner.env({
				ANTHROPIC_API_KEY: "fitgate-fake-key",
				[FAKE_PROVIDER_ENV]: provider.baseUrl,
				[FITGATE_ENV]: evidenceFile,
			}),
			agentDir: runner.agentDir,
			packageDir,
		});
		return {
			command: [
				managedPi,
				"--mode",
				"rpc",
				"--no-session",
				"--no-extensions",
				"-e",
				join(import.meta.dir, "fixtures", "fit-gate-probe.ts"),
				"-e",
				join(import.meta.dir, "fixtures", "custom-provider.ts"),
				"-e",
				staged.extensionPath,
			],
			// The env carries the provider URL, the probe evidence path, and the managed identity.
			env: env as Record<string, string | undefined>,
		};
	};

	/** Write the settings the scenario needs, then run the stages, then read the probe file back. */
	const scenario = async (
		name: string,
		options: {
			provider: GateProvider;
			settings?: Record<string, unknown>;
			stages: readonly RpcStep[];
		},
	): Promise<{ probed: RpcProbeResult; probe: ProbeEvidence }> => {
		const evidenceFile = join(runner.workRoot, `${name}-probe.json`);
		await Bun.write(
			join(runner.agentDir, "settings.json"),
			`${JSON.stringify(options.settings ?? {}, null, "\t")}\n`,
		);
		const launched = launch(evidenceFile, options.provider);
		const probed = await runStagedRpcProbe({
			command: launched.command,
			cwd: runner.workRoot,
			env: launched.env,
			stages: options.stages,
			timeoutMs: RPC_TIMEOUT_MS,
		});
		return { probed, probe: await readProbe(evidenceFile) };
	};

	// Scenario 1.1 + 1.2: a manual compaction awaited inside an idle input handler, then a
	// `{ action: "handled" }` input that must start nothing.
	const provider1 = makeProvider();
	const modelStep: RpcStep = {
		requests: [{ id: "model-1", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }],
	};
	const s1 = await scenario("compact-wait", {
		provider: provider1,
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 } },
		stages: [
			modelStep,
			promptStep("seed", "fitgate seed turn answer ok"),
			promptStep("wait", `${FITGATE_WAIT_MARKER} run after the wait answer ok`),
			commandStep("state-wait", "/fitgate-state wait"),
			{
				requests: [promptRequest("handled", `${FITGATE_HANDLED_MARKER} blocked text answer ok`)],
				waitFor: respondedTo("handled"),
				timeoutMs: 15_000,
			},
			commandStep("state-handled", "/fitgate-state handled"),
		],
	});
	// Remember where the handled prompt entered the records: agent_starts after that point would be
	// the run the gate is not allowed to start.
	const handledIndex = s1.probed.records.findIndex((record) => record.type === "response" && record.id === "handled");
	const waitOutcome = s1.probe.compacts[0]?.outcome;
	const waitingSamples = s1.probe.compacts[0]?.timeline.filter((entry) => entry.phase === "waiting") ?? [];
	// The compacted conversation still reaches the provider carrying the original input text.
	const waitConversationSent = provider1.requestsCarrying(FITGATE_WAIT_MARKER).length > 0;
	const compactWaitableFinal =
		waitOutcome?.kind === "complete" &&
		s1.probe.states.wait?.compactionEntries === 1 &&
		countEvents(s1.probed, "agent_start") === 2 &&
		waitConversationSent;
	const handledDisposition = (responseFor(s1.probed, "handled")?.data as { disposition?: string } | undefined)
		?.disposition;
	const blockedSendsNothing =
		handledDisposition === "handled" &&
		provider1.requestsCarrying(FITGATE_HANDLED_MARKER).length === 0 &&
		s1.probe.handled.length === 1 &&
		countEventsFrom(s1.probed, "agent_start", handledIndex) === 0;

	// Scenario 1.3: enumerate the inputs an `input` handler sees, to decide the gate's scope rule.
	const provider2 = makeProvider();
	// A prompt template so the run can tell the raw input (seen by the handler) from the expanded
	// text (seen by the provider).
	await mkdir(join(runner.agentDir, "prompts"), { recursive: true });
	await Bun.write(
		join(runner.agentDir, "prompts", "fitgate-tpl.md"),
		`---\ndescription: fitgate template precondition\n---\n${FITGATE_TEMPLATE_MARKER} $ARGUMENTS\n`,
	);
	const s2 = await scenario("input-shapes", {
		provider: provider2,
		stages: [
			{ requests: [{ id: "model-2", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
			promptStep("plain", "fitgate shape plain answer ok"),
			promptStep("skill", `/skill:fitgate-unknown fitgate shape skill answer ok`),
			promptStep("template", `/fitgate-tpl fitgate shape template answer ok`),
			promptStep("host-command", `/compact`),
			promptStep("shell", `!echo fitgate shape shell answer ok`),
			commandStep("ext-send", "/fitgate-send"),
			promptStep("flush", "fitgate flush after send answer ok"),
			{
				requests: [promptRequest("slow", `${SLOW_MARKER} steer target answer ok`)],
				waitFor: (records, since) => records.slice(since).some((record) => record.type === "agent_start"),
				timeoutMs: 15_000,
			},
			{
				requests: [
					{ id: "steer", type: "steer", message: "fitgate steer during run" },
					{ id: "followup", type: "follow_up", message: "fitgate followup during run" },
				],
				waitFor: settledSince,
				timeoutMs: RPC_TIMEOUT_MS,
			},
			commandStep("state-shapes", "/fitgate-state shapes"),
		],
	});
	const templateExpanded = provider2.requestsCarrying(FITGATE_TEMPLATE_MARKER).length > 0;

	// Scenario 1.4a: an input that arrives while the gate's compaction wait is open.
	const provider3 = makeProvider({ summaryDelayMs: 1_500 });
	const s3 = await scenario("queue", {
		provider: provider3,
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 } },
		stages: [
			{ requests: [{ id: "model-3", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
			promptStep("seed", "fitgate queue seed turn answer ok"),
			{
				requests: [
					promptRequest("first", `${FITGATE_WAIT_MARKER} first while waiting answer ok`),
					promptRequest("second", "fitgate second while waiting answer ok"),
				],
				waitFor: respondedTo("first"),
				timeoutMs: 20_000,
			},
			{ requests: [], waitFor: () => false, timeoutMs: COMMAND_SETTLE_MS },
			commandStep("state-queue", "/fitgate-state queue"),
		],
	});
	const secondResponse = responseFor(s3.probed, "second");
	const secondError = typeof secondResponse?.error === "string" ? secondResponse.error : undefined;
	const secondDisposition = (secondResponse?.data as { disposition?: string } | undefined)?.disposition;
	const queueCoexists = secondError !== undefined || secondDisposition === "queued" || secondDisposition === "handled";
	// Measured host behaviour, kept even when it fails the queue contract: the racing prompt reaches
	// its input handler while the gate's wait is open, so a gate-level in-flight flag can intercept
	// it before any run starts (the revised D10 mechanism).
	const racingInputSawGateWait = s3.probe.inputs.some(
		(input) => input.text.includes("second while waiting") && input.gateWaitActive,
	);

	// Scenario 1.4b: an abort while the wait is open — the RPC path behind the TUI's Esc.
	const provider4 = makeProvider({ summaryDelayMs: 3_000 });
	const s4 = await scenario("abort", {
		provider: provider4,
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 } },
		stages: [
			{ requests: [{ id: "model-4", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
			promptStep("seed", "fitgate abort seed turn answer ok"),
			{
				requests: [promptRequest("wait", `${FITGATE_WAIT_MARKER} abort during wait answer ok`)],
				waitFor: (records, since) => records.slice(since).some((record) => record.type === "compaction_start"),
				timeoutMs: 15_000,
			},
			{ requests: [{ id: "abort", type: "abort" }], waitFor: respondedTo("abort"), timeoutMs: 30_000 },
			{ requests: [], waitFor: settledSince, timeoutMs: 20_000 },
			commandStep("state-abort", "/fitgate-state abort"),
		],
	});
	const abortOutcome = s4.probe.compacts.at(-1)?.outcome;
	const escAborts =
		abortOutcome?.kind === "error" &&
		s4.probe.states.abort?.compactionEntries === 0 &&
		provider4.closedEarly().length >= 1 &&
		s4.probe.compacts.length >= 1;

	// Scenario 1.5: split-turn calibration — one compaction may cost two summarization requests.
	const provider5 = makeProvider();
	const s5 = await scenario("split", {
		provider: provider5,
		settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 } },
		stages: [
			{ requests: [{ id: "model-5", type: "set_model", provider: COMPAT_PROVIDER, modelId: FAKE_MODEL_ID }] },
			{
				requests: [promptRequest("slow", `${SLOW_MARKER} split turn seed answer ok`)],
				waitFor: (records, since) => records.slice(since).some((record) => record.type === "agent_start"),
				timeoutMs: 15_000,
			},
			{
				requests: [{ id: "steer", type: "steer", message: "fitgate steer inside the split turn" }],
				waitFor: settledSince,
				timeoutMs: RPC_TIMEOUT_MS,
			},
			commandStep("state-split-before", "/fitgate-state split-before"),
			promptStep("compact", `${FITGATE_WAIT_MARKER} split calibrate answer ok`),
			commandStep("state-split-after", "/fitgate-state split-after"),
		],
	});

	const evidence = {
		generatedAt: new Date().toISOString(),
		measuredSet: setId,
		bundle: { path: bundlePath, sha256: bundleSha256 },
		mode:
			"fixture set staged around the built bundle; the Pi half is the installed pi-" +
			setId.replace("pi-", "") +
			" artifact",
		"run-judgement-definition":
			"a run exists when the fake provider received a conversation request or the RPC stream carried agent_start; compaction_start alone does not map to a run. A compaction happened when the session records a new compaction entry; one compaction can carry more than one summarization request (split turn).",
		"compact-waitable-from-idle-input": compactWaitableFinal,
		"blocked-input-sends-nothing": blockedSendsNothing,
		"queue-coexists": queueCoexists,
		"gate-flag-visible-to-racing-input": racingInputSawGateWait,
		"esc-aborts-compaction": escAborts,
		// Revised D10 (2026-11-26): the host does not queue a racing idle prompt (queue-coexists is a
		// raw host measurement, kept false). The gate rejects in-flight inputs itself, which needs the
		// wait, the abort path, and the flag visibility — the three keys below.
		"d1-basis":
			"compact-waitable-from-idle-input && esc-aborts-compaction && gate-flag-visible-to-racing-input (revised D10: gate-level in-flight rejection replaces the host queue assumption)",
		"d1-holds": compactWaitableFinal && escAborts && racingInputSawGateWait,
		"input-shapes": s2.probe.inputs,
		"input-shapes-commands": s2.probe.commands,
		"input-shapes-template-expanded": templateExpanded,
		// Restated on 2026-11-26 (task 1.3): only `extension` commands are out of scope. Prompt
		// templates and skill launches are judged, on their unexpanded text, which is what
		// `gateInScope` in packages/spirits/src/routing/register.ts implements and what the spec
		// scenario 「スキル起動のコマンドでは展開前の本文で判定する」 requires.
		"input-rule":
			'the gate applies when ctx.mode is tui or rpc, streamingBehavior is absent, source is not extension, the text is neither blank nor a shell-escape prefix, and the text is not a slash command whose name pi resolves in getCommands with source "extension"; prompt template (source "prompt") and skill launch (`skill:`) commands stay in scope and are judged on their unexpanded text; anything the rule does not classify is out of scope (fail open).',
		"input-rule-host-commands":
			'host commands cannot be excluded by name: getCommands() reports only the extension / prompt / skill sources (the host\'s BUILTIN_SLASH_COMMANDS is not a root export), the tui takes its own commands away before the input event, and in rpc a "/compact" line reaches input as plain prompt text (see input-shapes), where it starts a model request and is judged like any other idle input.',
		"input-rule-revision":
			"2026-11-26 (task 1.3): the rule sentence above was restated. It used to claim extension, builtin, template, and skill sources all bypass the gate, which contradicted design D7 and the spec scenario 「スキル起動のコマンドでは展開前の本文で判定する」 and did not match the implementation (`gateInScope` in packages/spirits/src/routing/register.ts excludes extension-source commands only). The measured input-shapes and input-shapes-commands above are unchanged.",
		"split-turn-calibration": {
			summarizationRequests: provider5.summarizationRequests().length,
			compactionEntries: s5.probe.states["split-after"]?.compactionEntries ?? 0,
			compactionEntriesBefore: s5.probe.states["split-before"]?.compactionEntries ?? 0,
			note: "fixture: scripts/managed-pi-compat/fixtures/custom-provider.ts defines fake-model/fake-strong at 128000 and fake-small at 32000; the sample run drives one compaction over a turn that carries a steering message",
		},
		measurements: {
			compactWait: {
				outcome: waitOutcome ?? null,
				waitingSamples: waitingSamples.slice(0, 8),
				timelineLength: waitingSamples.length,
				compactionEntriesAfterWait: s1.probe.states.wait?.compactionEntries ?? null,
				agentStartsTotal: countEvents(s1.probed, "agent_start"),
				agentStartsAfterHandled: countEventsFrom(s1.probed, "agent_start", handledIndex),
				handledDisposition: handledDisposition ?? null,
				conversationRequests: provider1.conversationRequests().length,
				summarizationRequests: provider1.summarizationRequests().length,
				stderr: s1.probed.stderr.slice(0, 400),
			},
			queue: {
				secondError: secondError ?? null,
				secondDisposition: secondDisposition ?? null,
				firstDisposition:
					(responseFor(s3.probed, "first")?.data as { disposition?: string } | undefined)?.disposition ?? null,
				secondConversationRequests: provider3.requestsCarrying("second while waiting").length,
				compactionEntries: s3.probe.states.queue?.compactionEntries ?? null,
				probeInputOrder: s3.probe.inputs.map((input) => ({
					text: input.text.slice(0, 40),
					behavior: input.streamingBehavior,
					source: input.source,
					gateWaitActive: input.gateWaitActive,
				})),
				agentStarts: countEvents(s3.probed, "agent_start"),
				stderr: s3.probed.stderr.slice(0, 400),
			},
			abort: {
				outcome: abortOutcome ?? null,
				compactionEntries: s4.probe.states.abort?.compactionEntries ?? null,
				closedEarly: provider4.closedEarly().length,
				summarizationRequests: provider4.summarizationRequests().length,
				agentStartsAfterAbort: countEventsFrom(
					s4.probed,
					"agent_start",
					s4.probed.records.findIndex((record) => record.type === "response" && record.id === "abort"),
				),
				stderr: s4.probed.stderr.slice(0, 400),
			},
			split: {
				probeInputs: s5.probe.inputs.length,
				steerBehaviorSeen: s5.probe.inputs.some((input) => input.streamingBehavior !== null),
				stderr: s5.probed.stderr.slice(0, 400),
			},
		},
	};

	await mkdir(dirname(cli.out), { recursive: true });
	await writeFile(cli.out, `${JSON.stringify(evidence, null, "\t")}\n`);
	console.log(
		JSON.stringify(
			{
				out: cli.out,
				"compact-waitable-from-idle-input": compactWaitableFinal,
				"blocked-input-sends-nothing": blockedSendsNothing,
				"queue-coexists": queueCoexists,
				"esc-aborts-compaction": escAborts,
				"d1-holds": evidence["d1-holds"],
			},
			null,
			"\t",
		),
	);
	provider1.stop();
	provider2.stop();
	provider3.stop();
	provider4.stop();
	provider5.stop();
	if (!cli.keep) await runner.cleanup();
	return evidence["d1-holds"] ? 0 : 1;
}

await main().then((code) => process.exit(code));
