/**
 * Precondition experiment for `add-managed-spirits-commands` (official Pi 1.5.0 + fake provider).
 *
 * Runs the A (change-wide) and B (/spirits-clear approach) checks the design lists and writes a
 * JSON result. Isolated HOME, isolated agent dir, local fake provider only.
 */

import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeManagedEnv } from "../../../packages/spirits/src/managed-pi/environment.ts";
import { writeOverlayPackage } from "../../../packages/spirits/src/managed-pi/overlay.ts";
import { createOfficialLaunchVerifier, loadOfficialArtifact } from "../../../scripts/managed-pi-compat/official.ts";
import { startFakeProvider, type FakeProviderRequest } from "../../../scripts/managed-pi-compat/fake-provider.ts";
import { runStagedRpcProbe, type RpcRecord, type RpcStep } from "../../../scripts/managed-pi-compat/rpc.ts";

/**
 * Paths are resolved from this file, so the probe runs from any checkout. `--artifact-root` names a
 * directory holding `manifest.json` and `pi-linux-x64.tar.gz`; `--out` writes the result JSON.
 */
const HERE = import.meta.dir;
const REPO = resolve(HERE, "../../..");
const ARTIFACT_ROOT = argValue(process.argv.slice(2), "--artifact-root") ?? "/tmp/mp3-artifact";
const OUT_PATH = argValue(process.argv.slice(2), "--out") ?? join(HERE, "precondition-results.json");
const PROVIDER_FIXTURE = join(HERE, "precondition-provider.ts");
const EXPERIMENT_EXTENSION = join(HERE, "precondition-extension.ts");

function argValue(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
/** An extension command writes its file and answers nothing, so a command stage waits a fixed settle. */
const COMMAND_SETTLE_MS = 2500;
const TIMEOUT_MS = 90_000;

interface Outcome {
	id: string;
	passed: boolean | null;
	detail: string;
	data?: unknown;
}

const outcomes: Outcome[] = [];

function record(id: string, passed: boolean | null, detail: string, data?: unknown): void {
	outcomes.push({ id, passed, detail, ...(data === undefined ? {} : { data }) });
	console.log(`${passed === null ? "INFO" : passed ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

function readState(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function requestTexts(requests: readonly FakeProviderRequest[]): string[] {
	return requests.map((request) => JSON.stringify((request.body as { messages?: unknown })?.messages ?? ""));
}

function firstRequestWith(texts: string[], marker: string): string | undefined {
	return texts.find((text) => text.includes(marker));
}

async function listFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		let names: string[] = [];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(dir, name);
			if (name.endsWith(".jsonl")) found.push(path);
			else await walk(path);
		}
	};
	await walk(root);
	return found;
}

/** A minimal fake endpoint whose usage always overflows the fixture's small context window. */
function startBigUsageProvider(usageTokens: number): { baseUrl: string; requests: string[]; stop(): void } {
	const requests: string[] = [];
	const server = Bun.serve({
		host: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
			const body = await request.json().catch(() => undefined);
			requests.push(JSON.stringify((body as { messages?: unknown } | undefined)?.messages ?? ""));
			const messages = (body as { messages?: Array<{ content?: unknown }> } | undefined)?.messages ?? [];
			const echoed = JSON.stringify(messages.at(-1)?.content ?? "").slice(0, 60);
			const events = [
				`data: ${JSON.stringify({ id: "u1", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }] })}\n\n`,
				`data: ${JSON.stringify({ id: "u2", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta: { content: `answer ${echoed}` }, finish_reason: null }] })}\n\n`,
				`data: ${JSON.stringify({ id: "u3", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: usageTokens, completion_tokens: 2, total_tokens: usageTokens + 2 } })}\n\n`,
				"data: [DONE]\n\n",
			];
			return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
		},
	});
	return { baseUrl: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop() };
}

async function main(): Promise<void> {
	const work = await mkdtemp(join(tmpdir(), "spirits-pre-"));
	const bundleDir = join(work, "bundle");
	await mkdir(bundleDir, { recursive: true });

	const build = await Bun.build({
		entrypoints: [EXPERIMENT_EXTENSION],
		outdir: bundleDir,
		naming: "exp-bundle.js",
		target: "bun",
		format: "esm",
		external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"],
		throw: false,
	});
	if (!build.success) {
		for (const log of build.logs) console.error(log.message);
		throw new Error("experiment bundle build failed");
	}
	const bundleText = await Bun.file(join(bundleDir, "exp-bundle.js")).text();
	record(
		"A1.bundle-inlines-proper-lockfile",
		bundleText.includes("proper-lockfile") || bundleText.includes("ELOCKED"),
		`the bundle carries the locker inline (${bundleText.length} bytes)`,
	);

	const artifact = await loadOfficialArtifact({ artifactRoot: ARTIFACT_ROOT, workRoot: join(work, "stage") });
	await writeOverlayPackage(artifact.packageDir, artifact.manifest.overlay.sha256);
	const verify = createOfficialLaunchVerifier(artifact);

	const home = join(work, "home");
	const agentDir = join(work, "managed-pi", "agent");
	const cwd = join(work, "project");
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });

	const envFor = (extra: Record<string, string | undefined>) =>
		computeManagedEnv({
			env: {
				PATH: process.env.PATH,
				HOME: home,
				XDG_CONFIG_HOME: join(home, ".config"),
				XDG_DATA_HOME: join(home, ".local", "share"),
				XDG_CACHE_HOME: join(home, ".cache"),
				XDG_STATE_HOME: join(home, ".local", "state"),
				ANTHROPIC_API_KEY: undefined,
				OPENAI_API_KEY: undefined,
				...extra,
			},
			agentDir,
			packageDir: artifact.packageDir,
		});

	const launch = (extraArgs: readonly string[]) => [
		artifact.executablePath,
		"--mode",
		"rpc",
		...extraArgs,
		"--no-extensions",
		"-e",
		PROVIDER_FIXTURE,
		"-e",
		join(bundleDir, "exp-bundle.js"),
	];

	const prompt = (id: string, message: string) => ({ id, type: "prompt", message });
	const commandStep = (id: string, name: string, args = ""): RpcStep => ({
		requests: [prompt(id, args === "" ? `/${name}` : `/${name} ${args}`)],
		waitFor: () => false,
		timeoutMs: COMMAND_SETTLE_MS,
	});
	const settled = () => (records: readonly RpcRecord[], since: number) =>
		records.slice(since).some((entry) => entry.type === "agent_settled");

	const runStaged = async (
		statePath: string,
		stages: RpcStep[],
		options: { env?: Record<string, string | undefined>; args?: readonly string[] } = {},
	) => {
		await verify();
		return runStagedRpcProbe({
			command: launch(options.args ?? []),
			cwd,
			env: envFor({ EXP_STATE: statePath, EXP_BOUNDARY: "1", ...options.env }),
			stages,
			timeoutMs: TIMEOUT_MS,
		});
	};

	// ---- A: role API, ctx.reload(), and the locked write -----------------------------------------
	const stateA = join(work, "state-a.json");
	const settingsPayload = {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		defaultThinkingLevel: "high",
		models: { strong: "compat-fake/fake-strong", role: "strong", expKey: "kept" },
	};
	await runStaged(stateA, [
		{ requests: [{ id: "state-1", type: "get_state" }] },
		commandStep("write-1", "exp-settings-write", JSON.stringify(settingsPayload)),
		commandStep("reload-1", "exp-reload"),
		{ requests: [{ id: "state-2", type: "get_state" }] },
	]);
	const stateAData = readState(stateA);
	record("A3.registerModelRoles-absent", stateAData.roleApi === false, `registerModelRoles present on the official host: ${String(stateAData.roleApi)}`);
	const surface = (stateAData.reloadReadback as { surface?: Record<string, boolean> } | undefined)?.surface ?? {};
	record(
		"A2.command-context-surface",
		surface.reload === true && surface.setStatus === true && surface.projection === true && surface.appendEntry === true && surface.setModel === true,
		`command ctx and api: ${JSON.stringify(surface)}`,
	);
	const starts = (stateAData.sessionStarts as Array<{ reason: string; settings: Record<string, unknown>; level?: string; model?: { provider: string; id: string } }> | undefined) ?? [];
	const reloaded = starts.filter((start) => start.reason === "reload").at(-1);
	const reloadedSettings = reloaded?.settings ?? {};
	record(
		"A2.reload-applies-written-settings",
		reloadedSettings.defaultModel === "fake-model" &&
			(reloadedSettings.models as Record<string, unknown> | undefined)?.role === "strong" &&
			reloadedSettings.defaultThinkingLevel === "high",
		`the session_start after ctx.reload() reads settings=${JSON.stringify(reloadedSettings)} thinkingLevel=${String(reloaded?.level)} model=${JSON.stringify(reloaded?.model)}`,
		{ starts },
	);

	// ---- A1: the same path raced with a real SettingsManager in another process -------------------
	const hammer = join(work, "hammer.ts");
	await writeFile(
		hammer,
		`
import { SettingsManager } from "${REPO}/packages/coding-agent/src/index.ts";
const agentDir = process.argv[2];
const cwd = process.argv[3];
const rounds = Number(process.argv[4] ?? "60");
process.env.PI_APP_NAME = "spirits";
const manager = SettingsManager.create(cwd, agentDir);
const errors: string[] = [];
for (let index = 0; index < rounds; index++) {
  try {
    manager.setThinkingLevel(index % 2 === 0 ? "low" : "medium");
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error));
  }
}
await manager.flush();
process.stdout.write(JSON.stringify({ rounds, errors }));
`,
	);
	const settingsPath = join(agentDir, "settings.json");
	const stateRace = join(work, "state-race.json");
	const hammerChild = Bun.spawn(["bun", hammer, agentDir, cwd, "200"], { stdout: "pipe", stderr: "pipe", env: envFor({}) });
	await runStaged(stateRace, [commandStep("race-1", "exp-race", "200")]);
	const hammerOut = await hammerChild.stdout.text();
	const hammerErr = await hammerChild.stderr.text();
	await hammerChild.exited;
	const racedText = await Bun.file(settingsPath).text();
	const raceState = readState(stateRace);
	const raced = JSON.parse(racedText) as Record<string, unknown>;
	record(
		"A1.race-with-settings-manager-keeps-both-sides",
		racedText.includes("raceIndex") && racedText.includes("defaultThinkingLevel") && racedText.includes("expKey"),
		`the file parsed after 200 extension writes raced against 200 SettingsManager writes; models=${JSON.stringify(raced.models)} defaultThinkingLevel=${String(raced.defaultThinkingLevel)}`,
		{ hammerOut: hammerOut.slice(0, 300), hammerErr: hammerErr.slice(0, 300), extensionLock: raceState.lock },
	);
	const leftovers = await readdir(agentDir);
	record("A1.lock-released", !leftovers.some((name) => name.endsWith(".lock")), `lock leftovers: ${leftovers.filter((name) => name.endsWith(".lock")).join(",") || "none"}`);

	// ---- B(a): is ctx.compact() usable as /spirits-clear? ---------------------------------------
	const provider = startFakeProvider({ name: "none", arguments: {} }, { reply: () => ({ kind: "text", text: "fake answer" }) });
	const shortEnv = { MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: provider.baseUrl };
	const stateShort = join(work, "state-short.json");
	const shortRun = await runStaged(stateShort, [
		{ requests: [{ id: "set-model", type: "set_model", provider: "compat-fake", modelId: "fake-model" }] },
		{ requests: [prompt("p1", "MARKER-ONE answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		{ requests: [{ id: "compact-1", type: "compact" }] },
	], { env: shortEnv });
	const compactShort = shortRun.records.find((entry) => entry.type === "response" && entry.id === "compact-1");
	record(
		"B(a).short-conversation-fails",
		compactShort?.success === false && String(compactShort?.error ?? "").includes("Nothing to compact"),
		`compact on a short conversation answered success=${String(compactShort?.success)} error=${String(compactShort?.error ?? "")}`,
	);
	record(
		"B(a).hook-not-reached-when-unprepared",
		((readState(stateShort).hooks as unknown[] | undefined) ?? []).length === 0,
		`session_before_compact fired ${((readState(stateShort).hooks as unknown[] | undefined) ?? []).length} time(s) for the short conversation`,
	);

	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1, reserveTokens: 1024 } }, null, 2));
	// A reply of its own for the summarization request, so a summary that stays in the context is
	// told apart from the ordinary assistant turns.
	const summaryProvider = startFakeProvider({ name: "none", arguments: {} }, {
		reply: (body) =>
			JSON.stringify(body ?? "").toLowerCase().includes("summar")
				? { kind: "text", text: "SUMMARY-MARKER-9000"
				  }
				: { kind: "text", text: "fake answer" },
	});
	const longEnv = { MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: summaryProvider.baseUrl };
	const stateLong = join(work, "state-long.json");
	const longRun = await runStaged(stateLong, [
		{ requests: [{ id: "set-model", type: "set_model", provider: "compat-fake", modelId: "fake-model" }] },
		{ requests: [prompt("p1", "MARKER-ONE answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		{ requests: [prompt("p2", "MARKER-TWO answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		{ requests: [{ id: "compact-1", type: "compact" }] },
		{ requests: [{ id: "compact-2", type: "compact" }] },
		{ requests: [prompt("p3", "AFTER-COMPACT-PROMPT answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
	], { env: longEnv });
	const compact1 = longRun.records.find((entry) => entry.type === "response" && entry.id === "compact-1");
	const compact2 = longRun.records.find((entry) => entry.type === "response" && entry.id === "compact-2");
	const longState = readState(stateLong);
	const longHooks = (longState.hooks as unknown[] | undefined) ?? [];
	const afterCompact = firstRequestWith(requestTexts(summaryProvider.requests), "AFTER-COMPACT-PROMPT");
	record(
		"B(a).hook-reachable-when-prepared",
		compact1?.success === true && longHooks.length > 0,
		`with compaction.keepRecentTokens=1 compact succeeded (success=${String(compact1?.success)}) and the hook fired ${longHooks.length} time(s)`,
		{ hooks: longHooks, error: compact1?.error },
	);
	record(
		"B(a).second-compact-fails",
		compact2?.success === false && String(compact2?.error ?? "").includes("Already compacted"),
		`compact right after a compaction answered success=${String(compact2?.success)} error=${String(compact2?.error ?? "")}`,
	);
	record(
		"B(a).summary-message-stays-in-context",
		(afterCompact ?? "").includes("SUMMARY-MARKER-9000"),
		`the request after a real compaction still carries the summary text: ${String((afterCompact ?? "").slice(0, 240))}`,
	);
	summaryProvider.stop();

	// ---- B(b): the boundary entry ----------------------------------------------------------------
	const clearProvider = startFakeProvider({ name: "none", arguments: {} }, { reply: () => ({ kind: "text", text: "fake answer" }) });
	const clearEnv = { MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: clearProvider.baseUrl };
	const stateClear = join(work, "state-clear.json");
	await runStaged(stateClear, [
		{ requests: [{ id: "set-model", type: "set_model", provider: "compat-fake", modelId: "fake-model" }] },
		{ requests: [prompt("p1", "MARKER-ONE answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		commandStep("clear-1", "exp-clear"),
		{ requests: [prompt("p2", "MARKER-TWO answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		commandStep("clear-2", "exp-clear"),
		commandStep("clear-3", "exp-clear"),
		{ requests: [prompt("p3", "MARKER-THREE answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
	], { env: clearEnv });
	const texts = requestTexts(clearProvider.requests);
	const two = firstRequestWith(texts, "MARKER-TWO");
	const three = firstRequestWith(texts, "MARKER-THREE");
	record(
		"B(b).boundary-drops-earlier-context",
		two !== undefined && !two.includes("MARKER-ONE"),
		`the request after the clear carries MARKER-TWO without MARKER-ONE: ${String(two?.slice(0, 200))}`,
	);
	record("B(b).works-on-a-short-conversation", two !== undefined, "a one-exchange conversation with no compaction preparation still cleared");
	record(
		"B(b).two-consecutive-clears",
		three !== undefined && !three.includes("MARKER-TWO") && !three.includes("MARKER-ONE"),
		`after three clears the request carries only MARKER-THREE: ${String(three?.slice(0, 200))}`,
	);
	clearProvider.stop();

	// resume in a new process from the same session file
	const sessionFiles = await listFiles(join(agentDir, "sessions"));
	const resumeProvider = startFakeProvider({ name: "none", arguments: {} }, { reply: () => ({ kind: "text", text: "fake answer" }) });
	await runStaged(join(work, "state-resume.json"), [
		{ requests: [{ id: "set-model", type: "set_model", provider: "compat-fake", modelId: "fake-model" }] },
		{ requests: [prompt("p4", "MARKER-FOUR answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
	], { env: { MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: resumeProvider.baseUrl }, args: ["--continue"] });
	const resumeText = requestTexts(resumeProvider.requests).find((text) => text.includes("MARKER-FOUR"));
	record(
		"B(b).boundary-survives-resume",
		resumeText !== undefined && !resumeText.includes("MARKER-ONE") && !resumeText.includes("MARKER-TWO"),
		`after --continue (${sessionFiles.length} session file(s)) the request carries MARKER-FOUR without the cleared markers: ${String(resumeText?.slice(0, 200))}`,
	);

	// automatic compaction must not bring the cleared conversation back.
	//
	// The repository fake endpoint answers with `total_tokens: 4`, and pi's threshold check prefers
	// provider usage over its own estimate, so the threshold never fires against it. This endpoint
	// answers with a usage the small fixture window cannot hold, which is what fires the automatic
	// path (`_runAutoCompaction("threshold")`).
	const bigUsage = startBigUsageProvider(1200);
	const autoState = join(work, "state-auto.json");
	const autoRun = await runStaged(autoState, [
		{ requests: [{ id: "set-model", type: "set_model", provider: "compat-fake", modelId: "fake-model" }] },
		{ requests: [prompt("p5", "MARKER-FIVE answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		commandStep("clear-auto", "exp-clear"),
		commandStep("prefix-cleared", "exp-prefix"),
		{ requests: [prompt("p6", `MARKER-SIX answer ok`)], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		{ requests: [prompt("p7", "MARKER-SEVEN answer ok")], waitFor: settled(), timeoutMs: TIMEOUT_MS },
		commandStep("prefix-after-compaction", "exp-prefix"),
		{ requests: [{ id: "stats-1", type: "get_session_stats" }] },
	], { env: { MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: bigUsage.baseUrl, EXP_CONTEXT_WINDOW: "2000" } });
	const autoData = readState(autoState);
	const autoHooks = (autoData.hooks as Array<{ reason: string; intercepted: boolean }> | undefined) ?? [];
	const seven = bigUsage.requests.find((text) => text.includes("MARKER-SEVEN"));
	record(
		"B(b).automatic-compaction-fired",
		autoHooks.length > 0,
		`session_before_compact fired ${autoHooks.length} time(s), reasons ${autoHooks.map((hook) => hook.reason).join(",") || "none"}, intercepted ${autoHooks.filter((hook) => hook.intercepted).length}`,
		{ hooks: autoHooks, compacted: autoData.compacted },
	);
	record(
		"B(b).cleared-content-does-not-return",
		seven !== undefined && !seven.includes("MARKER-FIVE") && !seven.includes("MARKER-FOUR"),
		`the request after the automatic compaction carries no cleared marker: ${String(seven?.slice(0, 240))}`,
	);
	const prefixes = (readState(autoState).contextPrefix as number[] | undefined) ?? [];
	const stats = JSON.stringify(autoRun.records.find((entry) => entry.id === "stats-1") ?? {}).slice(0, 240);
	record(
		"B(b).projection-shrinks-after-the-intercepted-compaction",
		prefixes.length >= 2 && prefixes[0] > 0 && prefixes[prefixes.length - 1] === 0,
		`prefix counts read inside the host: cleared ${JSON.stringify(prefixes)} (before the automatic compaction, after it); host stats ${stats}`,
	);
	record(
		"B(b).extension-supplied-note-used",
		autoHooks.some((hook) => hook.intercepted) && String(JSON.stringify(autoData.compacted ?? "")).includes("EXP-CLEARED-SUMMARY"),
		`compaction entries recorded by the host: ${String(JSON.stringify(autoData.compacted ?? []).slice(0, 200))}`,
	);

	resumeProvider.stop();
	bigUsage.stop();

	await writeFile(OUT_PATH, `${JSON.stringify({ outcomes, work, artifactRoot: ARTIFACT_ROOT }, null, "\t")}\n`);
	const failed = outcomes.filter((outcome) => outcome.passed === false).length;
	console.log(`\ntotal=${outcomes.length} pass=${outcomes.filter((o) => o.passed === true).length} fail=${failed}`);
	console.log(`results: ${OUT_PATH}`);
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
});
