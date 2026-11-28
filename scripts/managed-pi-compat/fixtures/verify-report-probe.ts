/**
 * Observation probe for the verification report saving measurement.
 *
 * `verify-report.ts` drives the just-built spirits bundle over RPC with the fake provider. This
 * extension is the only place that can see two of the four facts that evidence needs:
 *
 * - whether `spirits_verify_report_save` is **declared to the model** at a run's start
 *   (`getActiveTools()` and the rendered system prompt on `before_agent_start`), and
 * - how each run settled (`agent_settled`'s abort flag).
 *
 * The other two facts (the saved file and the nudge request) are read by the driver from disk and
 * from the fake provider's request log. Everything observed goes to the JSON file named by
 * `MANAGED_PI_COMPAT_VERIFY_REPORT`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EVIDENCE_ENV = "MANAGED_PI_COMPAT_VERIFY_REPORT";
/** The tool whose declaration window is measured; spelled here so the probe stands alone. */
const SAVE_TOOL = "spirits_verify_report_save";

interface Evidence {
	mode: string;
	runs: Array<{
		/** Full fixture prompt so the driver can identify the run by its marker. */
		prompt: string;
		messageType: string;
		activeTools: string[];
		promptHasTool: boolean;
	}>;
	settles: Array<{ entries: number; canContinue: boolean }>;
	settled: Array<{ aborted: boolean }>;
}

function emptyEvidence(): Evidence {
	return { mode: "", runs: [], settles: [], settled: [] };
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

export default function verifyReportProbe(pi: ExtensionAPI): void {
	const path = process.env[EVIDENCE_ENV];
	pi.on("agent_before_settle", (event) => {
		mutate(path, (evidence) => {
			evidence.settles.push({ entries: event.entries?.length ?? 0, canContinue: event.context.canContinue });
		});
	});
	pi.on("before_agent_start", (event, ctx) => {
		const prompt = event.messageType === "user" ? event.prompt : "";
		mutate(path, (evidence) => {
			evidence.mode = ctx.mode;
			evidence.runs.push({
				prompt,
				messageType: event.messageType,
				activeTools: pi.getActiveTools(),
				promptHasTool: event.systemPrompt.includes(SAVE_TOOL),
			});
		});
	});
	pi.on("agent_settled", (event) => {
		mutate(path, (evidence) => {
			evidence.settled.push({ aborted: event.aborted });
		});
	});
}
