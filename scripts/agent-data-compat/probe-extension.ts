/**
 * The in-host probe, loaded with `-e` into both the fork binary and the managed Pi.
 *
 * Everything in the dump is read through the host's own runtime and extension API: `getSettings()`,
 * `ctx.sessionManager.getEntries()`, `ctx.modelRegistry`, `getAllTools()`, `getCommands()`. The
 * runner never reads the agent dir to produce these numbers, so a value in the dump is a statement
 * about what the host itself sees.
 *
 * The extension deliberately has no value imports from the host package: the same file has to load
 * in the compiled fork binary and in the official Pi, and only type imports are guaranteed to be
 * erased in both.
 *
 * Output files come from the environment:
 *  - `ADC_DUMP`          JSON written by the `/adc-dump` command
 *  - `ADC_SYSTEM_PROMPT` JSONL, one record per provider request, with the rendered system prompt
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const DUMP_ENV = "ADC_DUMP";
const SYSTEM_PROMPT_ENV = "ADC_SYSTEM_PROMPT";
const FAKE_URL_ENV = "ADC_FAKE_URL";
const MARKERS_ENV = "ADC_MARKERS";

/** Provider that only exists when `<agentDir>/models.json` was read. */
const FILE_PROVIDER = "compat-fake";
/** Provider that only exists when this extension registered it. */
const EXTENSION_PROVIDER = "compat-ext";
// A model id that no `models.json` provider uses, so a request naming it can only come from this
// extension and a request naming the models.json model proves the file was read.
const EXTENSION_MODEL = "ext-model";
/** Provider with an entry in `auth.json` but no model definition anywhere. */
const STORED_ONLY_PROVIDER = "compat-stored-only";
/** Provider with no credential and no definition. */
const ABSENT_PROVIDER = "compat-absent";

interface AuthStatusRecord {
	configured: boolean;
	source?: string;
}

function writeJson(path: string | undefined, value: unknown): void {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function appendJson(path: string | undefined, value: unknown): void {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function digest(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, 16);
}

/** Host runtime, named so a Bun host is not read as Node. */
function hostRuntime(): string {
	const globals = globalThis as { Bun?: { version?: string } };
	if (globals.Bun?.version) return `bun ${globals.Bun.version}`;
	return `node ${process.version}`;
}

/** Version of the package directory the host was started with, when it is readable. */
function packageVersion(): string | undefined {
	const packageDir = process.env.PI_PACKAGE_DIR;
	if (!packageDir) return undefined;
	try {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
			name?: string;
			version?: string;
		};
		return `${pkg.name ?? "unknown"}@${pkg.version ?? "unknown"}`;
	} catch {
		return undefined;
	}
}

/** A comparable view of one session entry. Message bodies are digested, not copied. */
function summarizeEntry(entry: Record<string, unknown>): Record<string, unknown> {
	const base: Record<string, unknown> = {
		type: entry.type,
		id: entry.id,
		parentId: entry.parentId,
		timestamp: entry.timestamp,
	};
	if (entry.customType !== undefined) base.customType = entry.customType;
	if (entry.data !== undefined) base.data = entry.data;
	if (entry.message && typeof entry.message === "object") {
		const message = entry.message as Record<string, unknown>;
		const serialized = JSON.stringify(message);
		base.message = {
			role: message.role,
			sha256: digest(serialized),
			chars: serialized.length,
			preview: serialized.slice(0, 160),
		};
	}
	// Entry-level fields outside the base, the message, and the custom payload: `model_change`
	// carries `provider` and `modelId`, `thinking_level_change` carries `level`.
	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (["type", "id", "parentId", "timestamp", "customType", "data", "message"].includes(key)) continue;
		extra[key] = value;
	}
	if (Object.keys(extra).length > 0) base.extra = extra;
	return base;
}

export default function adcProbeExtension(pi: ExtensionAPI): void {
	// A provider that exists only if the host read this file, never `models.json`.
	const fakeUrl = process.env[FAKE_URL_ENV];
	if (fakeUrl) {
		pi.registerProvider(EXTENSION_PROVIDER, {
			name: "ADC extension provider",
			baseUrl: `${fakeUrl}/v1`,
			apiKey: "fake",
			api: "openai-completions",
			models: [
				{
					id: EXTENSION_MODEL,
					name: "ADC extension-only model",
					reasoning: true,
					input: ["text"],
					contextWindow: 128000,
					maxTokens: 4096,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		});
	}

	// The rendered system prompt is the product's own read of `memory/` and
	// `prompts/spirits/code-mode.md`, so the markers prove a cross-host read.
	// The fork's published types do not declare this event, so register through a loose signature.
	const onProviderRequest = pi.on as unknown as (
		event: string,
		handler: (event: { systemPrompt?: string }) => void | Promise<void>,
	) => void;
	onProviderRequest("before_provider_request", (event: { systemPrompt?: string }) => {
		const markers = (process.env[MARKERS_ENV] ?? "")
			.split(",")
			.map((marker) => marker.trim())
			.filter((marker) => marker.length > 0);
		const prompt = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
		const found: Record<string, boolean> = {};
		for (const marker of markers) found[marker] = prompt.includes(marker);
		const lines = prompt
			.split("\n")
			.filter((line) => line.includes("adc memory line") || line.includes("adc code-mode override"))
			.map((line) => line.slice(0, 200));
		appendJson(process.env[SYSTEM_PROMPT_ENV], {
			at: Date.now(),
			length: prompt.length,
			sha256: digest(prompt),
			markers: found,
			markerLines: lines,
		});
	});

	pi.registerCommand("adc-dump", {
		description: "Write the agent-dir state the host can read as JSON",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const entries = ctx.sessionManager.getEntries() as unknown as Array<Record<string, unknown>>;
			const byType: Record<string, number> = {};
			for (const entry of entries) {
				const key = entry.customType ? `custom:${String(entry.customType)}` : String(entry.type);
				byType[key] = (byType[key] ?? 0) + 1;
			}
			const auth: Record<string, unknown> = {};
			for (const provider of [FILE_PROVIDER, EXTENSION_PROVIDER, STORED_ONLY_PROVIDER, ABSENT_PROVIDER]) {
				const status = ctx.modelRegistry.getProviderAuthStatus?.(provider) as AuthStatusRecord | undefined;
				auth[provider] = status ?? null;
			}
			const available = (ctx.modelRegistry.getAll?.() ?? []) as Array<{ provider: string; id: string }>;
			const settings = pi.getSettings() as Record<string, unknown>;
			const candidate = pi as unknown as Record<string, unknown>;
			writeJson(process.env[DUMP_ENV], {
				host: {
					packageVersion: packageVersion(),
					hostRuntime: hostRuntime(),
					appNameEnv: process.env.PI_APP_NAME,
					agentDirEnv: process.env.SPIRITS_CODING_AGENT_DIR,
					sessionDirEnv: process.env.SPIRITS_CODING_AGENT_SESSION_DIR,
				},
				settings,
				settingsKeys: Object.keys(settings),
				thinkingLevel: pi.getThinkingLevel?.(),
				model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
				session: {
					sessionId: ctx.sessionManager.getSessionId?.(),
					count: entries.length,
					byType,
					entries: entries.map(summarizeEntry),
				},
				auth,
				models: available
					.filter((model) => model.provider === FILE_PROVIDER || model.provider === EXTENSION_PROVIDER)
					.map((model) => `${model.provider}/${model.id}`)
					.sort(),
				tools: pi.getAllTools().map((tool) => tool.name).sort(),
				commands: pi.getCommands().map((command) => command.name).sort(),
				apis: {
					getSettings: typeof candidate.getSettings === "function",
					// The role API decides whether the bundle may append a routing-state entry.
					registerModelRoles: typeof candidate.registerModelRoles === "function",
					appendEntry: typeof candidate.appendEntry === "function",
					settingsWrite: ["saveSettings", "updateSettings", "setSettings", "setSetting"].filter(
						(name) => typeof candidate[name] === "function",
					),
					credentialWrite: ["setApiKey", "storeCredential", "login"].filter(
						(name) => typeof candidate[name] === "function",
					),
					getProviderAuthStatus: typeof ctx.modelRegistry.getProviderAuthStatus === "function",
					getEntries: typeof ctx.sessionManager.getEntries === "function",
				},
			});
		},
	});
}
