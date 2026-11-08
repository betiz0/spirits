/**
 * End-to-end evidence for `add-managed-spirits-commands`: the three commands driven through a real
 * managed Pi host — the official Pi 1.5.0 executable, the spirits overlay, and the extension bundle.
 *
 * Everything is local: an isolated HOME, an isolated agent dir, and the repo's fake provider. No real
 * credential or endpoint is reachable.
 *
 * The session runs on `spirits/auto` so the role is observable: a locked `strong` role makes the next
 * request arrive at `models.strong`, which is a different model id at the endpoint. The conversation
 * markers (`alpha`, `beta`, …) make the LLM context observable the same way, because the fake provider
 * records the request body it was sent.
 *
 * Usage:
 *
 *   bun openspec/changes/add-managed-spirits-commands/evidence/managed-commands-probe.ts \
 *     --pi-dir /tmp/pi150bin/pi --bundle dist/spirits-managed-pi-extension.js --out out.json
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeOverlayPackage } from "../../../../packages/spirits/src/managed-pi/overlay.ts";
import { startFakeProvider } from "../../../../scripts/managed-pi-compat/fake-provider.ts";
import { runStagedRpcProbe, type RpcRecord } from "../../../../scripts/managed-pi-compat/rpc.ts";

const HERE = import.meta.dir;
const PI_DIR = arg("--pi-dir") ?? "/tmp/pi150bin/pi";
const BUNDLE = arg("--bundle") ?? resolve(HERE, "../../../../dist/spirits-managed-pi-extension.js");
const OUT = arg("--out") ?? join(HERE, "managed-commands-results.json");
const PROVIDER_FIXTURE = resolve(HERE, "../../../../scripts/managed-pi-compat/fixtures/custom-provider.ts");
const WATCH = join(HERE, "managed-commands-watch.ts");

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

interface Outcome {
	id: string;
	passed: boolean;
	detail: string;
}

const outcomes: Outcome[] = [];
function check(id: string, passed: boolean, detail: string): void {
	outcomes.push({ id, passed, detail });
	console.log(`${passed ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

/** The user turns of one provider request, as text. */
function userTurns(request: { body?: unknown }): string[] {
	const messages = (request.body as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];
	const text = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.flatMap((part) => {
					const one = part as { type?: string; text?: string };
					return one.type === "text" && one.text ? [one.text] : [];
				})
				.join(" ");
		}
		return JSON.stringify(content);
	};
	return messages.filter((message) => message.role === "user").map((message) => text(message.content));
}

function uiRequests(records: readonly RpcRecord[], method: string): string[] {
	return records
		.filter((record) => record.type === "extension_ui_request" && record.method === method)
		.map((record) => JSON.stringify(record));
}

const ROOT = "/tmp/spirits-managed-commands";
const home = join(ROOT, "home");
const agentDir = join(home, ".spirits", "agent");
const cwd = join(ROOT, "cwd");
const piDir = join(ROOT, "pi");
const watchLog = join(ROOT, "watch.jsonl");

await rm(ROOT, { recursive: true, force: true });
await mkdir(agentDir, { recursive: true });
await mkdir(cwd, { recursive: true });

// The identity of a managed Pi comes from the overlay package.json next to the executable: that is
// what makes the official binary read `SPIRITS_CODING_AGENT_DIR` and the `.spirits` config dir.
await cp(PI_DIR, piDir, { recursive: true });
const overlay = await writeOverlayPackage(piDir);

const SEED = {
	quietStartup: true,
	// pi's own default model, so `spirits/auto` has a normal target from the first turn.
	defaultProvider: "compat-fake",
	defaultModel: "fake-model",
	// A key another owner wrote inside the same object spirits also writes.
	models: { strong: "compat-fake/fake-strong" },
	enabledModels: ["compat-fake/fake-model", "compat-fake/fake-strong"],
	spiritsForeign: { keep: true },
};
await writeFile(join(agentDir, "settings.json"), JSON.stringify(SEED, null, 2));

const provider = startFakeProvider({ name: "unused", arguments: {} }, { reply: () => ({ kind: "text", text: "ok" }) });
await new Promise((resolveSleep) => setTimeout(resolveSleep, 200));

const ask = (marker: string) => ({
	requests: [{ id: `p-${marker}`, type: "prompt", message: `${marker} question` }],
	waitFor: (records: readonly RpcRecord[], since: number) =>
		records.slice(since).some((record) => record.type === "agent_end"),
	timeoutMs: 40_000,
});
const command = (line: string) => ({ requests: [{ id: `c-${line}`, type: "prompt", message: line }], timeoutMs: 20_000 });

const run = await runStagedRpcProbe({
	command: [join(piDir, "pi"), "--mode", "rpc", "-e", PROVIDER_FIXTURE, "-e", BUNDLE, "-e", WATCH],
	cwd,
	env: {
		HOME: home,
		SPIRITS_CODING_AGENT_DIR: agentDir,
		PI_SKIP_VERSION_CHECK: "1",
		PI_TELEMETRY: "0",
		MANAGED_PI_COMPAT_FAKE_PROVIDER_URL: provider.baseUrl,
		CX_WATCH_LOG: watchLog,
	},
	stages: [
		{ requests: [{ id: "models", type: "get_available_models" }] },
		{ requests: [{ id: "auto", type: "set_model", provider: "spirits", modelId: "auto" }] },
		ask("alpha"),
		command("/spirits-clear"),
		ask("beta"),
		command("/spirits-role strong"),
		ask("gamma"),
		command("/spirits-role normal"),
		ask("delta"),
		command("/spirits-model compat-fake/fake-strong high strong"),
		ask("epsilon"),
	],
	timeoutMs: 240_000,
});

const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
const models = provider.requests.map((request) => ({ model: request.model, users: userTurns(request) }));
const notices = uiRequests(run.records, "notify");
const statuses = uiRequests(run.records, "setStatus");
const shots = existsSync(watchLog)
	? readFileSync(watchLog, "utf8")
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as { why: string; file: unknown; effective: unknown })
	: [];
const requestFor = (marker: string) => models.find((entry) => entry.users.some((text) => text.startsWith(`${marker} question`)));

for (const [marker, entry] of models.entries()) console.log(`request ${marker}: ${entry.model} ${JSON.stringify(entry.users)}`);

// --- /spirits-clear -------------------------------------------------------------------------
const alpha = requestFor("alpha");
const beta = requestFor("beta");
const gamma = requestFor("gamma");
check("clear: the turn before the command carried the conversation", alpha !== undefined && alpha.users.length === 1, JSON.stringify(alpha?.users ?? []));
check(
	"clear: the turn after it carries nothing from before the command",
	beta !== undefined && beta.users.length === 1 && beta.users[0]?.startsWith("beta question") === true,
	JSON.stringify(beta?.users ?? []),
);
check(
	"clear: the boundary holds for later turns too",
	gamma !== undefined && !gamma.users.some((text) => text.startsWith("alpha question")),
	JSON.stringify(gamma?.users ?? []),
);

// --- the role is the one that routed ----------------------------------------------------------
check("role: a normal turn routed to the default model", alpha?.model === "fake-model", String(alpha?.model));
check("role: /spirits-role strong made the next request use models.strong", gamma?.model === "fake-strong", String(gamma?.model));
const delta = requestFor("delta");
check("role: /spirits-role normal sent the following request back to the default", delta?.model === "fake-model", String(delta?.model));
check(
	"role: the lock survived the reload the command ran",
	shots.some((shot) => shot.why === "session_start" && JSON.stringify(shot.file).includes('"role":"strong"')),
	`${shots.length} snapshots; roles seen: ${shots.map((shot) => (shot.file as { models?: { role?: string } })?.models?.role ?? "-").join(",")}`,
);

// --- /spirits-model -----------------------------------------------------------------------------
const epsilon = requestFor("epsilon");
check(
	"model: the reference switched the model the provider saw",
	epsilon?.model === "fake-strong" && notices.some((message) => message.includes("using compat-fake/fake-strong high strong")),
	`${epsilon?.model}; ${notices.filter((message) => message.includes("using")).join(" | ") || "no switch notice"}`,
);
check(
	"model: pi's default model keys were persisted",
	settings.defaultProvider === "compat-fake" && settings.defaultModel === "fake-strong" && settings.defaultThinkingLevel === "high",
	JSON.stringify({ defaultProvider: settings.defaultProvider, defaultModel: settings.defaultModel, defaultThinkingLevel: settings.defaultThinkingLevel }),
);
check("model: models.role was persisted", (settings.models as { role?: string } | undefined)?.role === "strong", JSON.stringify(settings.models));
check(
	"model: keys spirits did not name survived the write",
	JSON.stringify(settings.spiritsForeign) === JSON.stringify({ keep: true }) &&
		(settings.models as { strong?: string } | undefined)?.strong === "compat-fake/fake-strong" &&
		JSON.stringify(settings.enabledModels) === JSON.stringify(["compat-fake/fake-model", "compat-fake/fake-strong"]),
	JSON.stringify(settings),
);

// --- badge and route identity -----------------------------------------------------------------
check(
	"badge: the role reached the extension status line",
	statuses.some((entry) => entry.includes("normal") || entry.includes("strong")),
	statuses.slice(0, 4).join(" | ") || "no setStatus request",
);
check(
	"route: the bundle ran on the official executable with no role API",
	notices.some((message) => message.includes("host has no role API")),
	notices.find((message) => message.includes("role API"))?.slice(0, 80) ?? "no degraded notice",
);

const result = {
	generatedBy: "managed-commands-probe.ts",
	overlaySha256: overlay.sha256,
	outcomes,
	passed: outcomes.filter((outcome) => outcome.passed).length,
	failed: outcomes.filter((outcome) => !outcome.passed).length,
	providerRequests: models,
	settings,
	notices,
	statusRequests: statuses,
	watch: shots,
};
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${result.passed} pass, ${result.failed} fail -> ${OUT}`);
provider.stop();
