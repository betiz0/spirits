/**
 * Probe extension for the managed Pi compatibility runner.
 *
 * Every observation goes through the dedicated Pi's own runtime and extension API. The probe does
 * not wrap `registerTool`, because Pi hands each extension its own API object: a wrapper here could
 * never see another extension's registration. Tool presence is read from `pi.getAllTools()`, data
 * from `pi.getSettings()`, `ctx.sessionManager`, and `ctx.modelRegistry`, and writes go through
 * `pi.appendEntry()`, `pi.setModel()`, and `pi.setThinkingLevel()`. The runner never reads the agent
 * dir with Node.
 *
 * Commands that report state write JSON to `MANAGED_PI_COMPAT_PROBE_RESULT`.
 */

import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { identifyRuntime } from "../evidence.ts";

const STATE_ENV = "MANAGED_PI_COMPAT_PROBE_STATE";
const RESULT_ENV = "MANAGED_PI_COMPAT_PROBE_RESULT";
/**
 * Separate file for the labelled conversation/session/TODO states. `agent_settled` writes the
 * result file after every run, so a state recorded around a command must not share it.
 */
const PURPOSE_ENV = "MANAGED_PI_COMPAT_PROBE_PURPOSE";

/** Provider whose only credential is the `auth.json` copied into the isolated agent dir. */
const STORED_AUTH_PROVIDER = "compat-redacted";
/** Provider with no credential anywhere, so a configured status would mean the read leaked. */
const CONTROL_AUTH_PROVIDER = "compat-absent";
/** Command registered by the external extension copied into the agent dir. */
const EXTERNAL_EXTENSION_COMMAND = "compat-redacted-command";
/** TODO snapshots the spirits extension appends outside the conversation. */
const TODO_ENTRY_TYPE = "spirits_todo";
/** Runtime read attempts for the auth status, which an availability pass fills asynchronously. */
const AUTH_READ_ATTEMPTS = 10;
const AUTH_READ_DELAY_MS = 200;

interface AuthStatusRecord {
	configured: boolean;
	source?: string;
}

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

function readAppName(): string | undefined {
	const packageDir = process.env.PI_PACKAGE_DIR;
	if (!packageDir) return undefined;
	try {
		const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
			piConfig?: { name?: unknown };
		};
		return typeof pkg.piConfig?.name === "string" ? pkg.piConfig.name : undefined;
	} catch {
		return undefined;
	}
}

function writeJson(path: string | undefined, value: unknown): void {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function readStoredStates(path: string | undefined): Record<string, unknown> {
	if (!path) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { purposeStates?: Record<string, unknown> };
		return parsed.purposeStates ?? {};
	} catch {
		return {};
	}
}

/** The runtime that is executing this extension, named so a Bun host is not read as Node. */
function hostRuntime(): string {
	const globals = globalThis as { Bun?: { version?: string } };
	return identifyRuntime({
		bunVersion: globals.Bun?.version,
		nodeVersion: typeof process === "undefined" ? undefined : process.version,
	});
}

interface SettingsWriteApi {
	saveSettings?: (settings: unknown) => Promise<unknown> | unknown;
	updateSettings?: (settings: unknown) => Promise<unknown> | unknown;
	setSettings?: (settings: unknown) => Promise<unknown> | unknown;
}

/** Default model keys a saved `/model` choice would write. */
function readDefaultKeys(pi: ExtensionAPI): Record<string, string | undefined> {
	const settings = pi.getSettings() as Record<string, unknown>;
	const models = settings.models as Record<string, unknown> | undefined;
	const value = (entry: unknown) => (typeof entry === "string" ? entry : undefined);
	return {
		defaultProvider: value(settings.defaultProvider),
		defaultModel: value(settings.defaultModel),
		role: value(models?.role),
	};
}

/** Conversation, session ID, and TODO state, read through the dedicated Pi. */
function readClearState(ctx: ExtensionCommandContext) {
	const entries = ctx.sessionManager.getEntries();
	return {
		sessionId: ctx.sessionManager.getSessionId(),
		messageEntries: entries.filter((entry) => entry.type === "message").length,
		todoEntries: entries.filter((entry) => entry.type === "custom" && entry.customType === TODO_ENTRY_TYPE).length,
	};
}

export default function probeExtension(pi: ExtensionAPI): void {
	const readModel = (ctx: ExtensionCommandContext) =>
		ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;

	pi.on("session_start", (_event, ctx) => {
		const settings = pi.getSettings();
		const state: ProbeState = {
			sessionStarted: true,
			tools: pi.getAllTools().map((tool) => tool.name),
			commands: pi.getCommands().map((command) => command.name),
			hostVersion: VERSION,
			hostRuntime: hostRuntime(),
			appName: readAppName(),
			packageDir: process.env.PI_PACKAGE_DIR,
			agentDir: process.env.SPIRITS_CODING_AGENT_DIR,
			oldAgentDir: process.env.PI_CODING_AGENT_DIR,
			apiKey: process.env.ANTHROPIC_API_KEY,
			proxy: process.env.HTTPS_PROXY,
			settingsKeys: Object.keys(settings),
			sessionEntries: ctx.sessionManager.getEntries().length,
			model: readModel(ctx),
			thinkingLevel: pi.getThinkingLevel(),
			apis: {
				getSettings: typeof pi.getSettings === "function",
				appendEntry: typeof pi.appendEntry === "function",
				setModel: typeof pi.setModel === "function",
				setThinkingLevel: typeof pi.setThinkingLevel === "function",
				sessionManager: typeof ctx.sessionManager?.getEntries === "function",
				modelRegistry: typeof ctx.modelRegistry?.getProviderAuthStatus === "function",
				roleApi: typeof (pi as unknown as { registerModelRoles?: unknown }).registerModelRoles === "function",
			},
		};
		writeJson(process.env[STATE_ENV], state);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const entries = ctx.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "rlm_usage");
		writeJson(process.env[RESULT_ENV], { rlmUsage: entries });
	});

	/**
	 * The auxiliary observation. The direct `execute` path needs another extension's tool
	 * definition, which Pi does not expose, so `direct` stays absent and the runner records the
	 * item as `not-run` with this reason.
	 */
	pi.registerCommand("compat-auxiliary", {
		description: "Report whether tsrepl is registered and whether a definition is reachable",
		handler: (_args: string, _ctx: ExtensionCommandContext) => {
			writeJson(process.env[RESULT_ENV], {
				toolRegistered: pi.getAllTools().some((tool) => tool.name === "tsrepl"),
				direct: null,
			});
		},
	});

	pi.registerCommand("compat-data-read", {
		description: "Read settings and sessions through the dedicated Pi API",
		handler: (_args: string, ctx: ExtensionCommandContext) => {
			const settings = pi.getSettings();
			writeJson(process.env[RESULT_ENV], {
				settingsKeys: Object.keys(settings),
				sessionEntries: ctx.sessionManager.getEntries().length,
				model: readModel(ctx),
				thinkingLevel: pi.getThinkingLevel(),
			});
		},
	});

	/** Auth and external-extension reads, both through the dedicated Pi runtime. */
	pi.registerCommand("compat-data-sources", {
		description: "Read provider credentials and external extensions through the dedicated Pi",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			let stored: AuthStatusRecord | undefined;
			let control: AuthStatusRecord | undefined;
			for (let attempt = 0; attempt < AUTH_READ_ATTEMPTS; attempt++) {
				stored = ctx.modelRegistry.getProviderAuthStatus(STORED_AUTH_PROVIDER) as AuthStatusRecord;
				control = ctx.modelRegistry.getProviderAuthStatus(CONTROL_AUTH_PROVIDER) as AuthStatusRecord;
				if (stored.configured) break;
				await new Promise((resolve) => setTimeout(resolve, AUTH_READ_DELAY_MS));
			}
			const commands = pi.getCommands().map((command) => command.name);
			writeJson(process.env[RESULT_ENV], {
				auth: { stored, control },
				externalExtension: {
					commandName: EXTERNAL_EXTENSION_COMMAND,
					commandObserved: commands.includes(EXTERNAL_EXTENSION_COMMAND),
				},
				commands,
			});
		},
	});

	pi.registerCommand("compat-data-write", {
		description: "Write and read back a session entry through the dedicated Pi API",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const before = ctx.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "compat_probe").length;
			pi.appendEntry("compat_probe", { at: Date.now() });
			const after = ctx.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "compat_probe").length;
			writeJson(process.env[RESULT_ENV], {
				sessionWritten: true,
				sessionReadBack: after > before,
				entries: after,
			});
		},
	});

	pi.registerCommand("compat-model-write", {
		description: "Change model and thinking level through the dedicated Pi API",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const model = ctx.model;
			let modelChanged = false;
			if (model) {
				modelChanged = (await pi.setModel(model)) === true;
			}
			const previousLevel = pi.getThinkingLevel();
			const nextLevel = previousLevel === "low" ? "off" : "low";
			pi.setThinkingLevel(nextLevel);
			const readBack = pi.getThinkingLevel();
			writeJson(process.env[RESULT_ENV], {
				modelChanged,
				thinkingLevelChanged: readBack === nextLevel,
				model: readModel(ctx),
				thinkingLevel: readBack,
			});
		},
	});

	pi.registerCommand("compat-settings-write", {
		description: "Attempt a persistent settings write through the dedicated Pi API",
		handler: async () => {
			const candidate = pi as unknown as SettingsWriteApi;
			const write = candidate.saveSettings ?? candidate.updateSettings ?? candidate.setSettings;
			if (typeof write !== "function") {
				writeJson(process.env[RESULT_ENV], {
					available: false,
					detail: "the Pi extension API does not expose a persistent settings write",
				});
				return;
			}
			try {
				await write.call(pi, pi.getSettings());
				writeJson(process.env[RESULT_ENV], { available: true, written: true });
			} catch (error) {
				writeJson(process.env[RESULT_ENV], {
					available: true,
					written: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	});

	/**
	 * Conversation/session/TODO state under a named label, so one process can record the state
	 * before and after a `/clear` attempt and the runner reads both from one file.
	 */
	pi.registerCommand("compat-purpose-state", {
		description: "Record the session ID, conversation size, and TODO entries under a label",
		handler: (args: string, ctx: ExtensionCommandContext) => {
			const label = args.trim() === "" ? "current" : args.trim();
			// Merge from the file rather than module memory: a command that resets the session can
			// reload this extension, and the state recorded before it must survive for the comparison.
			const path = process.env[PURPOSE_ENV];
			writeJson(path, { purposeStates: { ...readStoredStates(path), [label]: readClearState(ctx) } });
		},
	});

	/**
	 * Read the session's model, thinking level, and pi's default keys back, without changing any of
	 * them. A product command owns the change; this only reports what the runtime holds afterwards,
	 * so an observation never measures the harness's own write.
	 */
	pi.registerCommand("compat-purpose-readback", {
		description: "Report the current model, thinking level, and saved default keys",
		handler: (_args: string, ctx: ExtensionCommandContext) => {
			writeJson(process.env[RESULT_ENV], {
				level: pi.getThinkingLevel(),
				model: readModel(ctx),
				defaults: readDefaultKeys(pi),
			});
		},
	});

	/**
	 * Model-purpose attempt: change the thinking level and the model through the runtime, then read
	 * the values and the default settings keys back.
	 */
	pi.registerCommand("compat-purpose-model", {
		description: "Attempt model and thinking level selection and read the saved defaults back",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const before = { level: pi.getThinkingLevel(), model: readModel(ctx), defaults: readDefaultKeys(pi) };
			let levelChanged = false;
			for (const level of ["low", "medium"] as const) {
				pi.setThinkingLevel(level);
				if (pi.getThinkingLevel() === level) {
					levelChanged = true;
					break;
				}
			}
			const target = ctx.modelRegistry
				.getAll()
				.find((model) => model.provider === "compat-fake" && model.id === "fake-model");
			let setModelResult = false;
			if (target) setModelResult = (await pi.setModel(target)) === true;
			const after = { level: pi.getThinkingLevel(), model: readModel(ctx), defaults: readDefaultKeys(pi) };
			writeJson(process.env[RESULT_ENV], {
				before,
				after,
				levelChanged,
				setModelResult,
				defaultsChanged: JSON.stringify(before.defaults) !== JSON.stringify(after.defaults),
			});
		},
	});
}
