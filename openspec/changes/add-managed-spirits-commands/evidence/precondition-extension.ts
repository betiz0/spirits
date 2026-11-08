/**
 * Precondition experiment extension for the official Pi 1.5.0.
 *
 * Bundled (proper-lockfile inlined) and loaded with `-e`. Every command reports through the JSON
 * file named by EXP_STATE, merging into it so several commands and events share one record.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockSync } from "proper-lockfile";

const STATE_ENV = "EXP_STATE";
const BOUNDARY_ENTRY = "spirits_clear";
const CLEARED_SUMMARY = "EXP-CLEARED-SUMMARY: content before the /spirits-clear boundary is out of context.";

interface State {
	loaded?: boolean;
	roleApi?: boolean;
	hasReload?: boolean;
	hasSetStatus?: boolean;
	hasProjection?: boolean;
	settingsWrite?: unknown;
	reloadReadback?: unknown;
	lock?: unknown;
	boundary?: unknown[];
	hooks?: Array<{ reason: string; firstKeptEntryId: string; intercepted: boolean }>;
	status?: unknown[];
	compacted?: unknown[];
	contextPrefix?: number[];
	contextEvents?: unknown[];
	sessionStarts?: unknown[];
	surface?: unknown;
	errors?: string[];
}

function readState(): State {
	const path = process.env[STATE_ENV];
	if (!path) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as State;
	} catch {
		return {};
	}
}

function update(patch: (state: State) => void): void {
	const path = process.env[STATE_ENV];
	if (!path) return;
	const state = readState();
	patch(state);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`);
}

function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** pi's FileSettingsStorage.withLock + persistScopedSettings procedure, same path, same library. */
function writeSettings(fields: Record<string, unknown>): { ok: boolean; detail: string } {
	const path = join(process.env.SPIRITS_CODING_AGENT_DIR ?? join(process.env.HOME ?? "", ".spirits/managed-pi/agent"), "settings.json");
	const maxAttempts = 10;
	const delayMs = 20;
	let release: (() => void) | undefined;
	try {
		for (let attempt = 1; ; attempt++) {
			try {
				release = lockSync(path, { realpath: false });
				break;
			} catch (error) {
				const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
				if (code !== "ELOCKED" || attempt >= maxAttempts) throw error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// busy wait, exactly like pi's synchronous retry
				}
			}
		}
		const current = existsSync(path) ? (JSON.parse(stripBom(readFileSync(path, "utf8"))) as Record<string, unknown>) : {};
		const merged: Record<string, unknown> = { ...current };
		for (const [key, value] of Object.entries(fields)) {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				merged[key] = { ...(current[key] as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) };
			} else {
				merged[key] = value;
			}
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(merged, null, 2), "utf-8");
		return { ok: true, detail: path };
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? `${error.name} ${error.message}` : String(error) };
	} finally {
		release?.();
	}
}

/** Index of the newest boundary entry on the branch, or -1. */
function boundaryIndex(branch: Array<{ type: string; customType?: string }>): number {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as { type: string; customType?: string };
		if (entry.type === "custom" && entry.customType === BOUNDARY_ENTRY) return index;
	}
	return -1;
}

/** How many LLM messages the projection builds from entries at or before the boundary. */
function prefixCount(ctx: ExtensionContext): number {
	const branch = ctx.sessionManager.getBranch() as Array<{ id: string; type: string; customType?: string }>;
	const at = boundaryIndex(branch);
	if (at < 0) return 0;
	const order = new Map<string, number>();
	branch.forEach((entry, index) => order.set(entry.id, index));
	let prefix = 0;
	for (const projected of ctx.sessionManager.buildSessionProjection().entries) {
		const index = order.get(projected.sourceEntry.id);
		if (index === undefined || index > at) continue;
		// The `context` event hands over the conversation without the system messages, so the count
		// must skip them too: pi keeps the prompt/tool loadout message as a `system` entry.
		prefix += projected.messages.filter((message) => message.role !== "system").length;
	}
	return prefix;
}

export default function experiment(pi: ExtensionAPI): void {
	update((state) => {
		state.loaded = true;
		state.roleApi = typeof (pi as unknown as { registerModelRoles?: unknown }).registerModelRoles === "function";
	});

	pi.on("session_start", (event, ctx) => {
		const settings = pi.getSettings() as Record<string, unknown>;
		update((state) => {
			state.hasReload = false;
			state.hasSetStatus = typeof ctx.ui.setStatus === "function";
			state.hasProjection = typeof ctx.sessionManager.buildSessionProjection === "function";
			state.sessionStarts = [
				...(state.sessionStarts ?? []).slice(-4),
				{
					reason: event.reason,
					settings: {
						defaultProvider: settings.defaultProvider,
						defaultModel: settings.defaultModel,
						defaultThinkingLevel: settings.defaultThinkingLevel,
						models: settings.models,
						compaction: settings.compaction,
					},
					level: pi.getThinkingLevel(),
					model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
				},
			];
		});
	});

	/** A1 + A2: locked write of pi's own keys and spirits' keys, then ctx.reload(). */
	pi.registerCommand("exp-settings-write", {
		description: "write settings through pi's locked procedure",
		handler: (args: string) => {
			const fields = JSON.parse(args === "" ? "{}" : args) as Record<string, unknown>;
			const result = writeSettings(fields);
			update((state) => {
				state.settingsWrite = { result, keys: Object.keys(fields) };
			});
		},
	});

	/** A1: many locked writes, to race an outside writer process. */
	pi.registerCommand("exp-race", {
		description: "repeat locked settings writes",
		handler: (args: string) => {
			const rounds = Number(args || "40");
			const failures: string[] = [];
			for (let index = 0; index < rounds; index++) {
				const result = writeSettings({ models: { strong: "compat-fake/fake-strong", role: "strong", raceIndex: index } });
				if (!result.ok) failures.push(`${index}: ${result.detail}`);
			}
			update((state) => {
				state.lock = { rounds, failures };
			});
		},
	});

	pi.registerCommand("exp-reload", {
		description: "reload and read the settings back",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			// pi invalidates this command's ctx and `pi` handle at `reload()`, so every value the
			// measurement needs is read before the call; the reload's own `session_start` reports the rest.
			const settings = pi.getSettings() as Record<string, unknown>;
			update((state) => {
				state.reloadReadback = {
					before: { defaultProvider: settings.defaultProvider, defaultModel: settings.defaultModel, defaultThinkingLevel: settings.defaultThinkingLevel, models: settings.models },
					surface: {
						reload: typeof ctx.reload === "function",
						setStatus: typeof ctx.ui.setStatus === "function",
						projection: typeof ctx.sessionManager.buildSessionProjection === "function",
						getSettings: typeof pi.getSettings === "function",
						appendEntry: typeof pi.appendEntry === "function",
						setModel: typeof pi.setModel === "function",
					},
				};
			});
			await ctx.reload();
		},
	});

	/** A read-only probe of what the next request would carry, for the boundary measurement. */
	pi.registerCommand("exp-prefix", {
		description: "report the boundary prefix count",
		handler: (_args: string, ctx: ExtensionCommandContext) => {
			const count = prefixCount(ctx);
			update((state) => {
				state.contextPrefix = [...(state.contextPrefix ?? []), count];
			});
		},
	});

	/** B(b): the boundary entry. */
	pi.registerCommand("exp-clear", {
		description: "append a conversation boundary",
		handler: (_args: string, ctx: ExtensionCommandContext) => {
			const branch = ctx.sessionManager.getBranch() as Array<{ id: string }>;
			const leafId = ctx.sessionManager.getLeafId() ?? "";
			pi.appendEntry(BOUNDARY_ENTRY, { at: Date.now(), beforeEntryId: leafId });
			ctx.ui.setStatus("spirits-exp", "[normal]");
			update((state) => {
				state.boundary = [...(state.boundary ?? []), { leafId, entries: branch.length }];
			});
		},
	});

	pi.registerCommand("exp-status", {
		description: "set the extension status line",
		handler: (args: string, ctx: ExtensionCommandContext) => {
			ctx.ui.setStatus("spirits-exp", args);
			update((state) => {
				state.status = [...(state.status ?? []), args];
			});
		},
	});

	if (process.env.EXP_BOUNDARY === "1") {
		pi.on("context", (event, ctx) => {
			const drop = prefixCount(ctx);
			const branch = ctx.sessionManager.getBranch() as Array<{ id: string; type: string; customType?: string }>;
			const projected = ctx.sessionManager.buildSessionProjection().entries;
			update((state) => {
				state.contextEvents = [
					...(state.contextEvents ?? []).slice(-6),
					{
						messages: event.messages.length,
						roles: event.messages.map((message) => message.role),
						drop,
						branch: branch.length,
						boundaryAt: boundaryIndex(branch),
						projected: projected.map((entry) => `${entry.sourceEntry.type}:${entry.messages.length}:${entry.messages.map((message) => `${message.role}(${JSON.stringify(message.content ?? "").slice(0, 40)})`).join("|")}`),
						event: event.messages.map((message) => `${message.role}(${JSON.stringify(message.content ?? "").slice(0, 40)})`),
						branchTypes: branch.map((entry) => `${entry.type}${entry.customType ? `/${entry.customType}` : ""}`),
					},
				];
			});
			if (drop <= 0 || drop >= event.messages.length) return undefined;
			return { messages: event.messages.slice(drop) };
		});

		pi.on("session_before_compact", (event, ctx) => {
			const branch = ctx.sessionManager.getBranch() as Array<{ id: string; type: string; customType?: string }>;
			const at = boundaryIndex(branch);
			let prevCompaction = -1;
			for (let index = branch.length - 1; index >= 0; index--) {
				if (branch[index].type === "compaction") {
					prevCompaction = index;
					break;
				}
			}
			const intercepts = at >= prevCompaction + 1;
			const keptEntryId = intercepts ? branch[at].id : event.preparation.firstKeptEntryId;
			update((state) => {
				state.hooks = [
					...(state.hooks ?? []),
					{ reason: event.reason, firstKeptEntryId: event.preparation.firstKeptEntryId, intercepted: intercepts },
				];
			});
			if (!intercepts) return undefined;
			return {
				compaction: {
					summary: CLEARED_SUMMARY,
					firstKeptEntryId: keptEntryId,
					tokensBefore: event.preparation.tokensBefore,
				},
			};
		});

		pi.on("session_compact", (event) => {
			update((state) => {
				state.compacted = [
					...(state.compacted ?? []),
					{ fromExtension: event.fromExtension, firstKeptEntryId: event.compactionEntry.firstKeptEntryId, summary: String(event.compactionEntry.summary).slice(0, 80) },
				];
			});
		});
	}
}
