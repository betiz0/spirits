/**
 * The action guard's verdicts on the managed route.
 *
 * The guard hangs on one pi hook (`tool_call`) and on one piece of pi bookkeeping: a tool call another
 * tool issued carries a nested call id. Both are host behaviour, so the verdicts are measured on a real
 * host: official Pi plus a bundle built from this checkout. The released bundle predates the guard,
 * which is why the bundle is built here rather than taken from the install.
 *
 * This file used to run the four commands twice — once on this checkout's pi with this checkout's
 * extension, once on the official artifact — and compare. The fork route is gone (remove-pi-fork
 * §10.1), so the verdicts the fork produced are written down below as the expectation, and the
 * managed route has to reach them. With no artifact on the machine the route reports `not-run`, which
 * is a recorded gap and never a pass.
 *
 * Nothing here talks to a real inference API: the fake provider replies with the tool calls, so a pass
 * is fake-provider compatibility, not real-provider compatibility.
 */

import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildManagedInputs } from "../../../scripts/build-managed-pi-inputs.ts";
import { startFakeProvider, type FakeReply } from "../../../scripts/managed-pi-compat/fake-provider.ts";
import { loadOfficialArtifact, OfficialArtifactError, type OfficialArtifact } from "../../../scripts/managed-pi-compat/official.ts";
import { runRpcProbe, type RpcRecord } from "../../../scripts/managed-pi-compat/rpc.ts";
import { ENV_ACTION_GUARD, MANAGED_PI_FIRST_ARTIFACT_NAME } from "../src/constants.ts";
import { computeManagedEnv } from "../src/managed-pi/environment.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const PROVIDER_EXTENSION = join(REPO, "scripts/managed-pi-compat/fixtures/custom-provider.ts");
/** The env var the fixture provider reads as its base URL. */
const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";
/** A key that is not a real credential; the fake endpoint ignores it. */
const FAKE_API_KEY = "compat-fake-key";
const RPC_TIMEOUT_MS = 120_000;

/** A bash call as the RPC stream reported it, in the order the model asked for them. */
interface Verdict {
	/** Whether the guard's block reason came back as the tool result. */
	blocked: boolean;
	/** The category ids named in that reason. */
	categories: string[];
	/** Whether pi gave the call a nested id (`<parent>/<n>`). */
	nested: boolean;
}

/** What the managed route measured, or why it could not. */
interface RouteOutcome {
	route: "managed";
	state: "confirmed" | "not-run";
	verdicts?: Verdict[];
	detail?: string;
}

/** The route results, so a run that skipped managed says so in the summary rather than in silence. */
const outcomes: RouteOutcome[] = [];

const CELL_CODE = `const r = await tool("bash", { command: "python3 -c 'print(1)'" }); return String(r)`;

/** The four fixed calls, in the order the fake model issues them. */
const CASES: readonly { tool: string; arguments: Record<string, unknown>; command: string }[] = [
	{ tool: "bash", arguments: { command: "for i in a b; do printf %s $i; done" }, command: "for i in a b; do printf %s $i; done" },
	{ tool: "bash", arguments: { command: "python3 -c 'print(1)'" }, command: "python3 -c 'print(1)'" },
	{ tool: "bash", arguments: { command: "git status --short" }, command: "git status --short" },
	{ tool: "tsrepl", arguments: { code: CELL_CODE }, command: "python3 -c 'print(1)'" },
];

/**
 * What the guard must do to those four.
 *
 * `S1` is a shell control-syntax command, `P1` an inline interpreter, the third call is free, and the
 * fourth is the `tsrepl` cell that calls `bash` through the tool surface: pi gives that call a nested
 * id, and the guard must use it to apply the process families. These are the verdicts the fork route
 * measured before it was removed; the expectation is theirs, the measurement is the host's.
 */
const EXPECTED: Verdict[] = [
	{ blocked: true, categories: ["S1"], nested: false },
	{ blocked: true, categories: ["P1"], nested: false },
	{ blocked: false, categories: [], nested: false },
	{ blocked: true, categories: ["P1"], nested: true },
];

/**
 * Run one route: the fake model issues the four calls in order, then answers in text.
 *
 * The verdicts are read off `tool_execution_end` records only — a blocked call is the guard's reason
 * text as a text-only error result, and a nested call is pi's `<parent>/<n>` id.
 */
async function runRoute(route: "managed", command: readonly string[], env: Record<string, string | undefined>): Promise<Verdict[]> {
	const provider = startFakeProvider({ name: CASES[0]!.tool, arguments: CASES[0]!.arguments }, {
		reply: (body): FakeReply => {
			const messages = (body as { messages?: { role?: string }[] }).messages ?? [];
			const step = messages.filter((message) => message.role === "tool").length;
			const item = CASES[step];
			return item === undefined ? { kind: "text", text: "done" } : { kind: "tool-call", toolCall: { name: item.tool, arguments: item.arguments } };
		},
	});
	try {
		const probe = await runRpcProbe({
			command,
			cwd: REPO,
			env: { ...env, [FAKE_PROVIDER_ENV]: provider.baseUrl, [ENV_ACTION_GUARD]: "enforce" },
			requests: [
				{ id: "model-1", type: "set_model", provider: "compat-fake", modelId: "fake-model" },
				{ id: "prompt-1", type: "prompt", message: "run the four commands in order" },
			],
			timeoutMs: RPC_TIMEOUT_MS,
			waitFor: (records) => records.some((record) => record.type === "agent_settled"),
		});
		const verdicts = probe.records.filter((record) => record.type === "tool_execution_end" && record.toolName === "bash").map(toVerdict);
		if (verdicts.length !== CASES.length) {
			throw new Error(`${route}: the stream carried ${verdicts.length} bash calls, expected ${CASES.length}. stderr: ${probe.stderr.slice(0, 400)}`);
		}
		return verdicts;
	} finally {
		provider.stop();
	}
}

function toVerdict(record: RpcRecord): Verdict {
	const text = textOf(record);
	const blocked = text.includes("bash ガード");
	return {
		blocked,
		categories: blocked ? categoriesOf(text) : [],
		nested: String(record.toolCallId ?? "").includes("/"),
	};
}

/** The ids named on the reason's first line: `…（該当分類 S1, P1）。` */
function categoriesOf(reason: string): string[] {
	const head = reason.split("\n")[0] ?? "";
	const named = /該当分類 ([^）]+)/.exec(head);
	return named === null ? [] : named[1].split(",").map((id) => id.trim());
}

function textOf(record: RpcRecord): string {
	const content = (record.result as { content?: { type?: string; text?: string }[] } | undefined)?.content ?? [];
	return content.map((item) => (item.type === "text" ? (item.text ?? "") : "")).join("\n");
}

/**
 * The root `loadOfficialArtifact` accepts, built from the installed official set.
 *
 * The installer keeps the tarball as `pi.tar.gz` while the loader looks the manifest URL's own name
 * up in the root, so an installed set is staged into a directory that carries `manifest.json` and the
 * tarball under its release name. Nothing is rewritten: the tarball is a symlink, so the digest the
 * loader computes is the digest of the installed artifact.
 *
 * A root that already carries the release name (`SPIRITS_COMPAT_ARTIFACT_ROOT` normally does) is used
 * as it is. A root with neither is handed to the loader anyway, which is what reports it as a gap.
 */
async function stageOfficialArtifactRoot(workRoot: string): Promise<string> {
	const installed = process.env.SPIRITS_COMPAT_ARTIFACT_ROOT ?? join(homedir(), ".spirits/managed-pi/current");
	if (existsSync(join(installed, MANAGED_PI_FIRST_ARTIFACT_NAME))) return installed;
	const tarball = join(installed, "pi.tar.gz");
	if (!existsSync(tarball) || !existsSync(join(installed, "manifest.json"))) return installed;
	const staged = join(workRoot, "artifact-root");
	await mkdir(staged, { recursive: true });
	await cp(join(installed, "manifest.json"), join(staged, "manifest.json"));
	await symlink(tarball, join(staged, MANAGED_PI_FIRST_ARTIFACT_NAME));
	return staged;
}

/**
 * The managed route, or why there is none.
 *
 * The artifact is the installed official set (`~/.spirits/managed-pi/current`, or the root the runner
 * points at with `SPIRITS_COMPAT_ARTIFACT_ROOT`), and it is taken through `loadOfficialArtifact`: the
 * manifest digest and the tarball digest are both checked before anything is spawned, so a directory
 * that merely holds a `pi/pi` binary is not an official route. The extension is a bundle built here:
 * the released bundle predates the guard, and measuring it would measure the absence of the feature.
 */
async function managedRoute(
	workRoot: string,
): Promise<{ command: readonly string[]; env: Record<string, string | undefined> } | { reason: string }> {
	const artifactRoot = await stageOfficialArtifactRoot(workRoot);
	let artifact: OfficialArtifact;
	try {
		artifact = await loadOfficialArtifact({ artifactRoot, workRoot: join(workRoot, "official") });
	} catch (error) {
		// Anything the verification refuses is a gap to report, never a pass.
		const detail = error instanceof Error ? error.message : String(error);
		return {
			reason: error instanceof OfficialArtifactError ? detail : `no official artifact at ${artifactRoot}: ${detail}`,
		};
	}
	const executablePath = artifact.executablePath;
	const packageDir = artifact.packageDir;
	const home = join(workRoot, "managed-home");
	const agentDir = join(home, ".spirits/agent");
	const bundle = await buildManagedInputs({ version: "0.0.0-compat", outDir: join(workRoot, "bundle") });
	return {
		command: [executablePath, "--mode", "rpc", "--no-session", "--no-extensions", "-e", PROVIDER_EXTENSION, "-e", bundle.bundlePath],
		env: computeManagedEnv({
			env: { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: FAKE_API_KEY },
			agentDir,
			packageDir,
		}),
	};
}

// One test holds the verdicts and the route summary: a second test that read the outcomes the first
// one pushed would fail on its own, which hides a route that could not run.
test("the managed route reaches the guard verdicts and never a silent pass", async () => {
	const workRoot = await mkdtemp(join(tmpdir(), "spirits-guard-compat-"));
	try {
		const managed = await managedRoute(workRoot);
		if ("reason" in managed) {
			outcomes.push({ route: "managed", state: "not-run", detail: managed.reason });
			console.log(`managed route: not-run (${managed.reason})`);
		} else {
			const verdicts = await runRoute("managed", managed.command, managed.env);
			outcomes.push({ route: "managed", state: "confirmed", verdicts });
			expect(verdicts).toEqual(EXPECTED);
			// The nested call reaches the process families only because pi marked it as issued by another
			// tool, so its absence would mean the guard judged a call it could not attribute.
			expect(verdicts[3]?.nested).toBe(true);
		}

		// Exactly one outcome, and a route that did not run stays a named gap.
		expect(outcomes.map((outcome) => outcome.route)).toEqual(["managed"]);
		const managedOutcome = outcomes[0];
		expect(managedOutcome === undefined ? "missing" : managedOutcome.state).toBeOneOf(["confirmed", "not-run"]);
		if (managedOutcome?.state === "not-run") expect(managedOutcome.detail).toBeDefined();
	} finally {
		await rm(workRoot, { recursive: true, force: true });
	}
});
