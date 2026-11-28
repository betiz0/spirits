/**
 * End-to-end measurement for the verification report saving (task 7.1 of
 * `enforce-verification-report-saving`).
 *
 * It launches the managed Pi (a staged fixture set around the just-built bundle, in an isolated
 * HOME) over RPC with `fixtures/verify-report-probe.ts` and the local fake provider, in a work
 * directory that holds a minimal openspec project (`changes/alpha` and `changes/beta`), and measures
 * the claims below. Each claim names the verdict keys that judge it, so a reader of the evidence can
 * tie a `true` back to a requirement: those 12 keys are the whole verdict set, beside the `all-holds`
 * aggregate.
 *
 * 1. the save tool is declared to the model **only while a verifying step is open** (the probe's
 *    per-run `getActiveTools()` and system-prompt reads) — `tool-declared-during-verify`,
 *    `tool-hidden-in-plain-run`, `tool-visible-in-answer-run`,
 * 2. a tool call saves the report under the change directory with the body it was given, whole —
 *    `report-saved-whole-under-change`, `chat-echoes-saved-body`,
 * 3. a settle with the target still un-pinned asks for nothing (no provider request carries the
 *    nudge text before the answer run) — `pending-settle-demanded-nothing`,
 * 4. after the user's answer pins the target, an unsaved settle adds exactly **one** continuation
 *    request, and that request carries the nudge message — `nudge-continued-exactly-once`,
 * 5. a later input naming the **other** listed change does not move the pinned destination: the
 *    next save is still alpha's, as the next number, and beta holds no report (d-verify1 C-1) —
 *    `later-change-name-did-not-move-target`,
 * 6. a verification opened with `--store <id>` reads its name list, its pin, and its save from that
 *    one store (d-verify3 C-1): a change only the **local** root has stays un-pinned and its save is
 *    refused, and the store's own change pins and saves into the store's change directory. The store
 *    is a real registered one — `openspec store setup` into this runner's isolated HOME, whose
 *    registry is the one the session's own openspec calls resolve against —
 *    `store-change-saved-into-the-store`, `store-listing-ignored-the-local-change`,
 *    `store-bait-save-was-refused`, and
 * 7. the verify prompt really comes from a **replaced** template body (task 7.1, d-verify3 W-1): the
 *    request that opens the first verification carries the replacement body with its expanded
 *    arguments, and that same run's unsaved settle buys exactly one nudge —
 *    `regenerated-template-expanded-and-nudged-once-in-same-run`. The count of requests taken at that
 *    settle splits the run from every later stage, so neither an earlier stage nor a later nudge can
 *    stand in for the two turns this judges.
 *
 * Usage:
 *   bun scripts/managed-pi-compat/verify-report.ts \
 *     --inputs <dir written by build-managed-pi-inputs.ts> --out <evidence.json> [--keep]
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	MANAGED_PI_EXTENSION_ASSET_NAME,
	VERIFY_REPORT_NUDGE_MESSAGE,
	VERIFY_REPORT_UNPINNED_REASON,
} from "../../packages/spirits/src/constants.ts";
import { computeManagedEnv } from "../../packages/spirits/src/managed-pi/environment.ts";
import { managedRoot, readCurrentSet } from "../../packages/spirits/src/managed-pi/layout.ts";
import { sha256Hex } from "../../packages/spirits/src/managed-pi/overlay.ts";
import { type FakeProviderRequest, type FakeReply, startFakeProvider } from "./fake-provider.ts";
import { stageFixtureBundle } from "./fixture-bundle.ts";
import type { RpcRecord, RpcRequest, RpcStep } from "./rpc.ts";
import { runStagedRpcProbe } from "./rpc.ts";
import { createCompatRunner } from "./runner.ts";

const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";
const PROBE_ENV = "MANAGED_PI_COMPAT_VERIFY_REPORT";
const COMPAT_PROVIDER = "compat-fake";
const FAKE_MODEL_ID = "fake-model";
const RPC_TIMEOUT_MS = 60_000;

/** Only the replacement template supplies this text; only the RPC command supplies the arguments. */
const REGENERATED_BODY = "Review the proposal and describe any remaining work:";
const REGENERATED_ARGS = "alpha VERIFY-REPORT-REGENERATED";

/** The first save input: the fake model answers it with the save tool call. */
const SAVE_MARKER = "VERIFY-REPORT-SAVE-ME";
/** The body the fake model passes to the save tool; the file must hold it byte for byte. */
const SAVED_BODY = "# Verification of alpha\n\n- findings: none\n- verdict: PASS\n\nVERIFY-REPORT-SAVED-BODY";
/** The verify input asked with no resolvable change name: the settle must stay pending. */
const ASK_MARKER = "VERIFY-REPORT-ASK-ME";
/** The second save request, after a later input named the other change (the C-1 measurement). */
const SAVE2_MARKER = "VERIFY-REPORT-SAVE2-ME";
/** The store the last two verifications name with `--store`, staged into the runner's isolated HOME. */
const STORE_ID = "vs1";
/** The store-only change: it exists inside the store and nowhere in the local root. */
const STORE_CHANGE = "gamma";
/** A store verification opened on a change the **local** root has and the store does not. */
const STORE_BAIT_MARKER = "VERIFY-REPORT-STORE-BAIT-ME";
/** A store verification opened on the store's own change. */
const STORE_PIN_MARKER = "VERIFY-REPORT-STORE-PIN-ME";
/** The save request asked inside a store verification (refused in the bait, saved in the pin). */
const STORE_SAVE_MARKER = "VERIFY-REPORT-STORE-SAVE-ME";
/** The store report's body, distinct so a mix-up between the two verifications is visible. */
const STORE_SAVED_BODY = "# Verification of gamma\n\n- store: vs1\n- verdict: PASS\n";

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
			"Usage: bun scripts/managed-pi-compat/verify-report.ts --inputs <build-output-dir> --out <evidence.json> [--keep]",
		);
	}
	return options as CliOptions;
}

/**
 * Register a store and put one change in it, the way a person with a second OpenSpec store would.
 *
 * The registration runs with this runner's own environment, so the registry entry the CLI writes
 * (`$XDG_DATA_HOME/openspec/stores/registry.yaml`) is the entry the session's own openspec calls
 * resolve against — the same route `--store <id>` takes in the product.
 */
async function stageStore(options: {
	env: Record<string, string | undefined>;
	cwd: string;
	root: string;
}): Promise<{ storeRoot: string; changeRoot: string }> {
	await mkdir(options.root, { recursive: true });
	const setup = Bun.spawn({
		cmd: ["openspec", "store", "setup", STORE_ID, "--path", options.root, "--no-init-git", "--json"],
		cwd: options.cwd,
		env: options.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(setup.stdout).text();
	const stderr = await new Response(setup.stderr).text();
	const code = await setup.exited;
	if (code !== 0) throw new Error(`openspec store setup exited ${code}: ${(stderr || stdout).trim()}`);
	const changeRoot = join(options.root, "openspec", "changes", STORE_CHANGE);
	await mkdir(changeRoot, { recursive: true });
	await writeFile(
		join(changeRoot, "proposal.md"),
		`---\nname: ${STORE_CHANGE}\ndescription: store-only change\n---\n\n# ${STORE_CHANGE}\n`,
	);
	return { storeRoot: options.root, changeRoot };
}

interface ProbeEvidence {
	mode: string;
	runs: Array<{ prompt: string; messageType: string; activeTools: string[]; promptHasTool: boolean }>;
	/** Mirrors what `fixtures/verify-report-probe.ts` writes: the probe records no abort flag here. */
	settles: Array<{ entries: number; canContinue: boolean }>;
	settled: Array<{ aborted: boolean }>;
}

async function readProbe(path: string): Promise<ProbeEvidence> {
	const file = Bun.file(path);
	if (!(await file.exists())) return { mode: "", runs: [], settles: [], settled: [] };
	return JSON.parse(await file.text()) as ProbeEvidence;
}

/**
 * The plain text of a wire message's content: a string, or the joined text blocks of an array.
 *
 * pi sends user and assistant content as content-block arrays, so `String(content)` would read
 * "[object Object]" and no needle would ever match. Read as text, the newlines are the real ones —
 * `JSON.stringify` would escape them and lose matches the other way.
 */
function textOfContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) =>
				typeof block === "object" && block !== null ? String((block as { text?: unknown }).text ?? "") : "",
			)
			.join("\n");
	}
	return "";
}

/** True when an assistant message's text content carries `needle`. */
function assistantEchoes(request: FakeProviderRequest, needle: string): boolean {
	const messages = (request.body as { messages?: Array<{ role?: string; content?: unknown }> })?.messages ?? [];
	return messages.some((message) => message.role === "assistant" && textOfContent(message.content).includes(needle));
}

function promptRequest(id: string, message: string): RpcRequest {
	return { id, type: "prompt", message };
}

function settledSince(records: readonly RpcRecord[], since: number): boolean {
	return records.slice(since).some((record) => record.type === "agent_settled");
}

function promptStep(id: string, message: string): RpcStep {
	return { requests: [promptRequest(id, message)], waitFor: settledSince, timeoutMs: RPC_TIMEOUT_MS };
}

/** True when the request body carries `needle`. */
function carries(request: FakeProviderRequest, needle: string): boolean {
	return JSON.stringify(request.body ?? "").includes(needle);
}

/**
 * The plain text of the last user message in a request body.
 *
 * The conversation grows, so "which user line is this request answering" is only decidable from the
 * newest user message: the nudge continuation of the ask run still carries the ask text, and only
 * the pinned answer adds a user line that is exactly the change name. Read as plain text: the nudge
 * message interpolates the change name, so a substring match over a JSON blob could not tell the
 * two apart.
 */
function lastUserText(request: FakeProviderRequest): string {
	const messages = (request.body as { messages?: Array<{ role?: string; content?: unknown }> })?.messages ?? [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user") return textOfContent(message.content);
	}
	return "";
}

async function main(): Promise<number> {
	const cli = parseArgs(process.argv.slice(2));
	const bundlePath = join(cli.inputs, MANAGED_PI_EXTENSION_ASSET_NAME);
	if (!(await Bun.file(bundlePath).exists())) throw new Error(`bundle not found: ${bundlePath}`);
	const bundleSha256 = sha256Hex(new Uint8Array(await Bun.file(bundlePath).arrayBuffer()));

	const provider = startFakeProvider(
		{ name: "noop", arguments: {} },
		{
			reply: (body): FakeReply => {
				const messages = ((body as { messages?: Array<{ role?: string; content?: unknown }> })?.messages ??
					[]) as Array<{ role?: string; content?: unknown }>;
				// A save request is the marker in the **newest user message** with no tool result after
				// it: the conversation of the second save still carries the first save's tool result, so
				// matching the whole body would keep answering the old request — and the nudge
				// continuation must not answer with a second save either (its newest user line is the nudge).
				let lastUser = -1;
				for (let index = messages.length - 1; index >= 0; index -= 1) {
					if (messages[index]?.role === "user") {
						lastUser = index;
						break;
					}
				}
				const newestUserText = lastUser === -1 ? "" : textOfContent(messages[lastUser]?.content);
				const toolResultAfterUser = messages.slice(lastUser + 1).some((message) => message.role === "tool");
				if (!toolResultAfterUser && newestUserText.includes(STORE_SAVE_MARKER)) {
					return {
						kind: "tool-call",
						toolCall: { name: "spirits_verify_report_save", arguments: { body: STORE_SAVED_BODY } },
					};
				}
				const wantsSave =
					!toolResultAfterUser && (newestUserText.includes(SAVE_MARKER) || newestUserText.includes(SAVE2_MARKER));
				if (wantsSave) {
					return {
						kind: "tool-call",
						toolCall: { name: "spirits_verify_report_save", arguments: { body: SAVED_BODY } },
					};
				}
				if (messages.some((message) => message.role === "tool"))
					return { kind: "text", text: `report complete ${SAVED_BODY}` };
				return { kind: "text", text: "verify-report probe answer ok" };
			},
		},
	);

	const runner = await createCompatRunner({});
	const artifactRoot = managedRoot();
	const setId = await readCurrentSet(artifactRoot);
	if (!setId) {
		await runner.cleanup();
		provider.stop();
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

	// A minimal openspec project in the session's cwd: two changes with proposals are enough for
	// `openspec list --json` and `openspec status --change <name> --json` to answer. The second one
	// is the bait for the C-1 measurement: an input naming it while alpha is pinned.
	const changeDirs: Record<string, string> = {};
	for (const name of ["alpha", "beta"]) {
		const dir = join(runner.workRoot, "openspec", "changes", name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "proposal.md"), `---\nname: ${name}\ndescription: probe change\n---\n\n# ${name}\n`);
		changeDirs[name] = dir;
	}
	// The verify prompt template, so `/opsx-verify <args>` is a command pi really expands.
	await mkdir(join(runner.agentDir, "prompts"), { recursive: true });
	await writeFile(
		join(runner.agentDir, "prompts", "opsx-verify.md"),
		`---\ndescription: replacement verify template\n---\n${REGENERATED_BODY} $ARGUMENTS\n`,
	);
	await writeFile(
		join(runner.agentDir, "prompts", "probe-close.md"),
		"---\ndescription: probe closer template\n---\nLeave the workflow. $ARGUMENTS\n",
	);

	const evidenceFile = join(runner.workRoot, "verify-report-probe.json");
	// The realistic configuration: the session selects the routing model, so a step's run really
	// resolves (`requestResolved`) and a continuing step survives the clarification answer. On a
	// physical model the routing rule "a step that never resolved a request is over before the next
	// input" applies, which is recorded as a limitation beside this evidence.
	await writeFile(
		join(runner.agentDir, "settings.json"),
		`${JSON.stringify({ defaultProvider: COMPAT_PROVIDER, defaultModel: FAKE_MODEL_ID }, null, "\t")}\n`,
	);
	const env = computeManagedEnv({
		env: runner.env({
			ANTHROPIC_API_KEY: "verify-report-fake-key",
			[FAKE_PROVIDER_ENV]: provider.baseUrl,
			[PROBE_ENV]: evidenceFile,
		}),
		agentDir: runner.agentDir,
		packageDir: staged.set.packageDir,
	}) as Record<string, string | undefined>;

	// The store the last two verifications name: registered into the same isolated HOME the session
	// runs with, so the session's own `openspec` calls resolve `--store vs1` against it (d-verify3 C-1).
	const store = await stageStore({
		env: runner.env(),
		cwd: runner.workRoot,
		root: join(runner.workRoot, `store-${STORE_ID}`),
	});

	// Capture the wire boundary at agent_settled, before the next RPC prompt is sent. A later
	// request carrying this prompt or its nudge in conversation history is not evidence for this run.
	let regeneratedRequestCount = 0;
	const probed = await runStagedRpcProbe({
		command: [
			staged.set.piExecutable,
			"--mode",
			"rpc",
			"--no-session",
			"--no-extensions",
			"-e",
			join(import.meta.dir, "fixtures", "verify-report-probe.ts"),
			"-e",
			join(import.meta.dir, "fixtures", "custom-provider.ts"),
			"-e",
			staged.extensionPath,
		],
		cwd: runner.workRoot,
		env,
		stages: [
			{ requests: [{ id: "model-1", type: "set_model", provider: "spirits", modelId: "auto" }] },
			// The fake model answers this pinned verification without saving. Pi must expand the
			// replacement template, then deliver exactly one nudge before this prompt settles.
			{
				requests: [promptRequest("regenerated-verify", `/opsx-verify ${REGENERATED_ARGS}`)],
				waitFor: (records, since) => {
					if (!settledSince(records, since)) return false;
					regeneratedRequestCount = provider.requests.length;
					return true;
				},
				timeoutMs: RPC_TIMEOUT_MS,
			},
			// 1. Verify with a named change: tool visible, tool call saves the body.
			promptStep("verify-save", `/opsx-verify alpha ${SAVE_MARKER}`),
			// 2. A different expanded command closes the step; the tool goes back out.
			promptStep("close-step", "/probe-close done"),
			promptStep("plain-run", "plain tools probe please"),
			// 3. Verify with no resolvable name: the settle stays pending, nothing is demanded.
			promptStep("verify-ask", `/opsx-verify ${ASK_MARKER}`),
			// 4. The answer pins; this run's settle buys exactly one nudge continuation.
			promptStep("answer-pin", "alpha"),
			// 5. A later input naming the other listed change must not move the pinned target.
			promptStep("move-attempt", "beta"),
			// 6. A second save still lands under alpha (the next number), and beta stays untouched.
			promptStep("save-again", `save the verification report again ${SAVE2_MARKER}`),
			// 7. A store verification opened on a change the local root has and the store does not:
			// the name list is the store's, so nothing pins and the save in the same run is refused.
			promptStep("store-bait", `/opsx-verify beta --store ${STORE_ID} ${STORE_BAIT_MARKER} ${STORE_SAVE_MARKER}`),
			// 8. A store verification opened on the store's own change: it pins through the store's
			// list and its save resolves into the store's change directory.
			promptStep(
				"store-pin",
				`/opsx-verify ${STORE_CHANGE} --store ${STORE_ID} ${STORE_PIN_MARKER} ${STORE_SAVE_MARKER}`,
			),
			{ requests: [], waitFor: () => false, timeoutMs: 1_500 },
		],
		timeoutMs: RPC_TIMEOUT_MS,
	});

	const probe = await readProbe(evidenceFile);
	const reportPath = join(changeDirs.alpha!, "verify1.md");
	const savedFile = Bun.file(reportPath);
	const savedText = (await savedFile.exists()) ? await savedFile.text() : undefined;
	// The C-1 measurement: after the "beta" input, the next save must be alpha's verify2.md, and
	// beta's directory must hold no report at all.
	const secondReportPath = join(changeDirs.alpha!, "verify2.md");
	const secondSavedText = (await Bun.file(secondReportPath).exists())
		? await Bun.file(secondReportPath).text()
		: undefined;
	const betaReports = (await readdir(changeDirs.beta!)).filter((name) => /(^|\/)(d-)?verify\d+\.md$/.test(name));
	// The store measurement: the store's change directory holds the store report and nothing else, and
	// the local changes hold nothing the store verification wrote (the bait's refused save included).
	const storeDirNames = (await readdir(store.changeRoot)).sort();
	const storeReportPath = join(store.changeRoot, "verify1.md");
	const storeReportText = (await Bun.file(storeReportPath).exists())
		? await Bun.file(storeReportPath).text()
		: undefined;
	const alphaReports = (await readdir(changeDirs.alpha!)).filter((name) => /(^|\/)verify\d+\.md$/.test(name)).sort();

	const verifyRun = probe.runs.find((run) => run.prompt.includes(SAVE_MARKER));
	const answerRun = probe.runs.find((run) => run.prompt.trim() === "alpha");
	const plainRun = probe.runs.find((run) => run.prompt.includes("plain tools probe"));
	// The nudge continuation is the request whose **newest** user line is the nudge: the history of
	// every later request also carries the nudge text, so matching the body would count them all.
	const regeneratedTurns = provider.requests.slice(0, regeneratedRequestCount).map(lastUserText);
	const nudgeRequests = provider.requests
		.slice(regeneratedRequestCount)
		.filter((request) => lastUserText(request).includes(VERIFY_REPORT_NUDGE_MESSAGE));
	// A nudge may only come after the answer run: the request answering the bare "alpha" user line
	// must precede every nudge request. A pending settle buying a continuation is the failure this
	// rules out (the nudge request itself turns the nudge into the newest user message, so ordering
	// by time is what separates the two). The answer line is matched exactly — the nudge message
	// names the change too, and only a whole-line match tells the answer apart from the nudge.
	const answerRequest = provider.requests.findLast((request) => lastUserText(request).trim() === "alpha");
	const pendingRequestedNothing =
		answerRequest !== undefined && nudgeRequests.every((request) => request.receivedAt > answerRequest.receivedAt);

	const measurements = {
		probe,
		regeneratedVerification: {
			command: `/opsx-verify ${REGENERATED_ARGS}`,
			templateBody: `${REGENERATED_BODY} $ARGUMENTS`,
			newestUserMessagesThroughSettle: regeneratedTurns,
		},
		providerRequests: provider.requests.map((request) => ({
			kind: request.kind ?? null,
			atMs: Math.round(request.receivedAt),
			hasSaveMarker: carries(request, SAVE_MARKER),
			hasAskMarker: carries(request, ASK_MARKER),
			hasNudge: carries(request, VERIFY_REPORT_NUDGE_MESSAGE),
			hasSavedBody: carries(request, SAVED_BODY),
			lastUserIncludesAlpha: lastUserText(request).includes("alpha"),
			assistantEchoesSavedBody: assistantEchoes(request, SAVED_BODY),
			nudgeLastUser: lastUserText(request).slice(0, 60),
		})),

		savedFile: {
			path: reportPath,
			exists: savedText !== undefined,
			byteEqualToToolBody: savedText === SAVED_BODY,
		},
		secondSavedFile: {
			path: secondReportPath,
			exists: secondSavedText !== undefined,
			byteEqualToToolBody: secondSavedText === SAVED_BODY,
			betaReports,
		},
		storeVerification: {
			storeId: STORE_ID,
			storeRoot: store.storeRoot,
			changeRoot: store.changeRoot,
			directoryListing: storeDirNames,
			reportPath: storeReportPath,
			byteEqualToToolBody: storeReportText === STORE_SAVED_BODY,
			localReports: { alpha: alphaReports, beta: betaReports },
		},
		stderr: probed.stderr.slice(0, 800),
	};

	const verdicts = {
		"regenerated-template-expanded-and-nudged-once-in-same-run":
			regeneratedTurns.length === 2 &&
			regeneratedTurns[0]?.trim() === `${REGENERATED_BODY} ${REGENERATED_ARGS}` &&
			regeneratedTurns[1]?.includes(VERIFY_REPORT_NUDGE_MESSAGE) === true,
		"tool-declared-during-verify":
			verifyRun?.promptHasTool === true && verifyRun.activeTools.includes("spirits_verify_report_save"),
		"tool-hidden-in-plain-run":
			plainRun?.promptHasTool === false && !plainRun.activeTools.includes("spirits_verify_report_save"),
		"report-saved-whole-under-change": measurements.savedFile.exists && measurements.savedFile.byteEqualToToolBody,
		// The chat body equals the saved body: the assistant text (not the tool-call argument) that
		// the session continued from is in the later requests' history.
		"chat-echoes-saved-body": provider.requests.some((request) => assistantEchoes(request, SAVED_BODY)),
		"pending-settle-demanded-nothing": pendingRequestedNothing,
		"nudge-continued-exactly-once": nudgeRequests.length === 1,
		// The answer run still sees the save tool both ways it can be observed: a continuing step
		// keeps its window open (d-verify1 G-2: the active-tools half is asserted, not just recorded).
		"tool-visible-in-answer-run":
			answerRun?.promptHasTool === true && answerRun.activeTools.includes("spirits_verify_report_save"),
		// d-verify1 C-1: the input naming the other listed change after the pin must not move the
		// destination. The second save lands under alpha as the next number; beta holds no report.
		"later-change-name-did-not-move-target": secondSavedText === SAVED_BODY && betaReports.length === 0,
		// d-verify3 C-1: a verification opened with `--store` reads its list, its pin, and its save
		// from that store. The store's change saves into the store; the local-only change neither
		// pinned nor wrote anything anywhere (beta empty, alpha still at its two reports).
		"store-change-saved-into-the-store": storeReportText === STORE_SAVED_BODY,
		"store-listing-ignored-the-local-change":
			storeDirNames.join(",") === "proposal.md,verify1.md" &&
			betaReports.length === 0 &&
			alphaReports.join(",") === "verify1.md,verify2.md",
		// The bait run reached the save tool and the tool answered with the un-pinned refusal — a
		// measured refusal, not a run that never asked.
		"store-bait-save-was-refused": provider.requests.some((request) =>
			carries(request, VERIFY_REPORT_UNPINNED_REASON),
		),
	};
	const holds = Object.values(verdicts).every((value) => value === true);

	const evidence = {
		generatedAt: new Date().toISOString(),
		measuredSet: setId,
		bundle: { path: bundlePath, sha256: bundleSha256 },
		mode:
			"fixture set staged around the built bundle; the Pi half is the installed pi-" +
			setId.replace("pi-", "") +
			" artifact; the model half is the local fake provider (fake-provider success, not real-provider); " +
			"the --store route is measured end to end against a store registered with `openspec store setup` " +
			"into this run's isolated HOME (d-verify3 C-1; the d-verify2 G-2 limitation is closed)",
		"unpinned-close-notice":
			"the Decision 14 notice (a verification that closed with no target pinned says so once, and how to reopen it) is unit-covered, not measured here: every stage of this run either names its change on the opening line or replaces the step before it closes, so no un-pinned close happens. Cases: packages/spirits/test/verify-report-nudge.test.ts 'a deep verification that settles asking which change says no report was saved', 'a physical model session that answers an un-named verification is told once', 'the un-pinned close goes to stderr in stdout modes and stays silent on an abort' (print and json), plus the d-verify3 C-1 boundary that the close consumes its obligation: 'an aborted pinned deep verification is not announced by a later input', 'leaving a pinned verification through another command announces nothing later', 'a session start or tree move drops the window without the notice'",
		"io-failure-regressions":
			"d-verify3 C-2's two failure injections are unit regressions, not RPC measurements: " +
			"packages/spirits/test/verify-report-save.test.ts cases 'a directory gone before the numbering is a reason, not an exception', " +
			"'a write that fails after the temporary file exists removes the temporary file', and " +
			"'the saver turns a post-resolution I/O failure into a reason'",
		"run-judgement-definition":
			"a run exists per before_agent_start the probe records; a provider request carrying the nudge message is the one continuation the settle bought; the saved files are read from the staged work directory's openspec/changes/alpha/{verify1,verify2}.md, and openspec/changes/beta/ must hold no report after the move-attempt input",
		"host-facts-observed":
			"at every quiet settle the event context reports canContinue=false (it is computed before boundary drafts, with the assistant message last); the host re-checks continuation after committing the drafts, and the nudge custom_message reaches the wire as the newest user turn; the session runs on the spirits/auto routing model because a physical-model session ends an unresolved step at the next idle input (routing rule), which is outside this change",
		...verdicts,
		"all-holds": holds,
		measurements,
	};

	await mkdir(dirname(cli.out), { recursive: true });
	await writeFile(cli.out, `${JSON.stringify(evidence, null, "\t")}\n`);
	console.log(JSON.stringify({ out: cli.out, ...verdicts, "all-holds": holds }, null, "\t"));

	provider.stop();
	if (!cli.keep) await runner.cleanup();
	return holds ? 0 : 1;
}

await main().then((code) => process.exit(code));
