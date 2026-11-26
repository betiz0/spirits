/**
 * Precondition probe for the routing context-fit gate.
 *
 * The gate plans to await `ctx.compact()` from an idle `input` handler, to return
 * `{ action: "handled" }` without starting a run, and to rely on the host's queue and abort path
 * while that wait is open. Each of those is a host behaviour the pinned artifact has to confirm
 * before the product code is written, and the probe is the only place that observes them.
 *
 * The probe drives behaviour through marker text in the prompt, because RPC carries no test hook:
 * - `FITGATE-WAIT`    await `ctx.compact()` inside the input handler, then continue the input.
 * - `FITGATE-HANDLED` return `{ action: "handled" }` from the input handler.
 * Commands:
 * - `/fitgate-state <label>` write entry counts (compaction entries especially) under a label.
 * - `/fitgate-send`        send an extension-sourced user message, for the `input` shape list.
 *
 * Everything is written to the JSON file named by `MANAGED_PI_COMPAT_FITGATE`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

const EVIDENCE_ENV = "MANAGED_PI_COMPAT_FITGATE";

/** Prompt marker: await a manual compaction inside the input handler. */
export const FITGATE_WAIT_MARKER = "FITGATE-WAIT";
/** Prompt marker: return `{ action: "handled" }` from the input handler. */
export const FITGATE_HANDLED_MARKER = "FITGATE-HANDLED";
/** Marker the /fitgate-send extension message carries, so its provider request is findable. */
export const FITGATE_EXTENSION_MARKER = "FITGATE-EXTENSION-SOURCED";
/** Prompt template body marker, so the expanded request is findable in the provider body. */
export const FITGATE_TEMPLATE_MARKER = "FITGATE-TEMPLATE-EXPANDED";

/** How often the wait timeline samples the session state. */
const WAIT_POLL_MS = 50;
/** How much of an input text the record keeps. */
const TEXT_LIMIT = 60;

interface WaitRecord {
	marker: string;
	outcome:
		| { kind: "complete"; summaryChars: number; estimatedTokensAfter: number | null }
		| { kind: "error"; message: string };
	timeline: Array<{ atMs: number; phase: string; isIdle: boolean; pending?: boolean }>;
}

interface Evidence {
	sessionModes: string[];
	commands: Array<{ name: string; source: string }>;
	inputs: Array<{
		text: string;
		source: string;
		streamingBehavior: string | null;
		mode: string;
		hasUI: boolean;
		isIdle: boolean;
		/** Whether the probe's own compaction wait was open when this input reached its handler. */
		gateWaitActive: boolean;
	}>;
	compacts: WaitRecord[];
	handled: Array<{ text: string }>;
	states: Record<
		string,
		{
			messageEntries: number;
			compactionEntries: number;
			model?: { provider: string; id: string };
		}
	>;
	sent: Array<{ text: string }>;
}

function emptyEvidence(): Evidence {
	return { sessionModes: [], commands: [], inputs: [], compacts: [], handled: [], states: {}, sent: [] };
}

function readEvidence(path: string): Evidence {
	try {
		return { ...emptyEvidence(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<Evidence>) };
	} catch {
		return emptyEvidence();
	}
}

function mutate(path: string | undefined, change: (evidence: Evidence) => void): void {
	if (!path) return;
	const evidence = readEvidence(path);
	change(evidence);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(evidence, null, "\t")}\n`);
}

/** Await the host manual compaction and sample what the session looks like while it runs. */
async function compactAndWait(ctx: ExtensionContext): Promise<Pick<WaitRecord, "outcome" | "timeline">> {
	const startedAt = Date.now();
	const timeline: WaitRecord["timeline"] = [{ atMs: 0, phase: "enter", isIdle: ctx.isIdle() }];
	const outcome = await new Promise<WaitRecord["outcome"]>((resolve) => {
		let timer: ReturnType<typeof setInterval> | undefined;
		let settled = false;
		const finish = (value: WaitRecord["outcome"]): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearInterval(timer);
			timeline.push({ atMs: Date.now() - startedAt, phase: "settled", isIdle: ctx.isIdle() });
			resolve(value);
		};
		timer = setInterval(() => {
			timeline.push({
				atMs: Date.now() - startedAt,
				phase: "waiting",
				isIdle: ctx.isIdle(),
				pending: ctx.hasPendingMessages(),
			});
		}, WAIT_POLL_MS);
		ctx.compact({
			onComplete: (result) =>
				finish({
					kind: "complete",
					summaryChars: result.summary?.length ?? 0,
					estimatedTokensAfter: result.estimatedTokensAfter ?? null,
				}),
			onError: (error) => finish({ kind: "error", message: error.message }),
		});
	});
	return { outcome, timeline };
}

export default function fitGateProbe(pi: ExtensionAPI): void {
	const evidencePath = process.env[EVIDENCE_ENV];
	/**
	 * Stands for the gate's planned "ahead compaction in flight" flag (design D4/D10).
	 *
	 * The queue precondition asks whether an input that arrives while a gate compaction is open can
	 * even see that the gate is busy. This module-level flag is what such a handler would read.
	 */
	let gateWaitActive = false;

	pi.on("session_start", (_event, ctx) => {
		mutate(evidencePath, (evidence) => {
			evidence.sessionModes.push(ctx.mode);
			evidence.commands = pi.getCommands().map((command) => ({ name: command.name, source: command.source }));
		});
	});

	pi.on("input", async (event, ctx) => {
		mutate(evidencePath, (evidence) => {
			evidence.inputs.push({
				text: event.text.slice(0, TEXT_LIMIT),
				source: event.source,
				streamingBehavior: event.streamingBehavior ?? null,
				mode: ctx.mode,
				hasUI: ctx.hasUI,
				isIdle: ctx.isIdle(),
				gateWaitActive,
			});
		});
		if (event.text.includes(FITGATE_WAIT_MARKER)) {
			gateWaitActive = true;
			let waited: Awaited<ReturnType<typeof compactAndWait>>;
			try {
				waited = await compactAndWait(ctx);
			} finally {
				gateWaitActive = false;
			}
			mutate(evidencePath, (evidence) => {
				evidence.compacts.push({ marker: event.text.slice(0, TEXT_LIMIT), ...waited });
			});
			return { action: "continue" };
		}
		if (event.text.includes(FITGATE_HANDLED_MARKER)) {
			mutate(evidencePath, (evidence) => {
				evidence.handled.push({ text: event.text.slice(0, TEXT_LIMIT) });
			});
			return { action: "handled" };
		}
		return { action: "continue" };
	});

	pi.registerCommand("fitgate-state", {
		description: "Record message and compaction entry counts under a label",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const label = args.trim() === "" ? "current" : args.trim();
			const entries = ctx.sessionManager.getEntries();
			mutate(evidencePath, (evidence) => {
				evidence.states[label] = {
					messageEntries: entries.filter((entry) => entry.type === "message").length,
					compactionEntries: entries.filter((entry) => entry.type === "compaction").length,
					model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
				};
			});
		},
	});

	pi.registerCommand("fitgate-send", {
		description: "Send a user message from the extension, for the input-shape list",
		handler: async () => {
			const text = `${FITGATE_EXTENSION_MARKER} answer ok`;
			mutate(evidencePath, (evidence) => {
				evidence.sent.push({ text });
			});
			await pi.sendUserMessage(text);
		},
	});
}
