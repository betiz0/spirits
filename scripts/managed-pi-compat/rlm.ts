/**
 * rlm child-session compatibility classification and fixture.
 *
 * Physical-model children and `spirits/auto` parents are separate items. Child creation, final
 * answer, usage, and abort are judged separately so one missing piece never hides another. An
 * auto-parent failure is a known limitation, not a pass. A missing fixture is never reported as a
 * product defect.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompatState } from "./runner.ts";

/** Observations from one child-session probe. */
export interface RlmChildObservation {
	childCreated: boolean;
	finalAnswer?: string;
	usageRecorded?: boolean;
	abortReported?: boolean;
	error?: string;
}

/**
 * The `outcome` of one `rlm_usage` entry.
 *
 * `pi.appendEntry("rlm_usage", data)` stores the payload under `entry.data`, so a check that reads
 * `entry.outcome` never matches and silently turns a recorded abort into an unobserved one.
 */
export function rlmUsageOutcome(entry: Record<string, unknown>): string | undefined {
	const data: unknown = entry.data;
	if (data !== null && typeof data === "object") {
		const outcome = (data as { outcome?: unknown }).outcome;
		if (typeof outcome === "string") return outcome;
	}
	return typeof entry.outcome === "string" ? entry.outcome : undefined;
}

/** Error text that means the fixture was insufficient, not that the product is broken. */
const FIXTURE_MARKERS = [
	"auth.json",
	"settings.json",
	"models.json",
	"fixture",
	"no current managed set",
	"not installed",
];

/** True when the error text points at a missing or incomplete fixture. */
export function isFixtureInsufficiency(error?: string): boolean {
	if (!error) return false;
	const text = error.toLowerCase();
	return FIXTURE_MARKERS.some((marker) => text.includes(marker));
}

/** Record a fixture insufficiency as `not-run`/`limited`, never as a product failure. */
export function classifyFixtureInsufficiency(error?: string): { state: "not-run" | "limited"; detail: string } {
	if (isFixtureInsufficiency(error)) {
		return { state: "not-run", detail: `fixture insufficiency: ${error}` };
	}
	return { state: "limited", detail: `child did not complete: ${error ?? "unknown error"}` };
}

/** Classify child creation on its own. */
export function classifyChildCreation(observation: RlmChildObservation): { state: CompatState; detail: string } {
	if (observation.childCreated) return { state: "confirmed", detail: "child session was created" };
	if (isFixtureInsufficiency(observation.error)) {
		return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
	}
	return { state: "failed", detail: observation.error ?? "child session was not created" };
}

/** Classify the child's final answer on its own. */
export function classifyChildAnswer(observation: RlmChildObservation): { state: CompatState; detail: string } {
	if (observation.finalAnswer) return { state: "confirmed", detail: "child returned a final answer" };
	if (!observation.childCreated) return { state: "not-run", detail: "no child session was created" };
	if (isFixtureInsufficiency(observation.error)) {
		return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
	}
	return { state: "limited", detail: "child completed without a final answer" };
}

/** Classify the child's usage record on its own. */
export function classifyChildUsage(observation: RlmChildObservation): { state: CompatState; detail: string } {
	if (observation.usageRecorded) return { state: "confirmed", detail: "rlm_usage was recorded by the child" };
	if (!observation.childCreated) return { state: "not-run", detail: "no child session was created" };
	if (isFixtureInsufficiency(observation.error)) {
		return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
	}
	return { state: "limited", detail: "child completed without an rlm_usage record" };
}

/**
 * The five phases one child abort is measured in.
 *
 * Reading the entries once at `agent_settled` cannot tell "the product wrote nothing" from "the
 * read happened before the write". The harness therefore records the chain end to end: the request,
 * its arrival in the parent cell, the child's own stop, and the usage entries at both the settle and
 * after the stop.
 */
export interface ChildAbortObservation {
	/** The RPC abort request was written to the host. */
	abortSent: boolean;
	/** False when the host answered the abort with a refusal (no abort surface). */
	abortAccepted?: boolean;
	/** The parent cell came back with the abort notice. */
	cellAborted: boolean;
	/** A child session reached the provider at all, so something could be aborted. */
	childSeen: boolean;
	/** The child's in-flight provider request closed, so the child stopped. */
	childStopped: boolean;
	/** `rlm_usage` entries carrying an abort outcome at the run's `agent_settled`. */
	usageAtSettled: number;
	/** `rlm_usage` entries carrying an abort outcome in the read taken after the child stopped. */
	usageAfterStop: number;
	/** Poll window that was allowed, so a stop that never happened is quantified. */
	pollWindowMs?: number;
	/** Reason the abort could not be exercised at all (no launch, fixture insufficiency). */
	error?: string;
}

/**
 * Classify the child abort on its own, in the five existing states.
 *
 * `not-run` is only for an abort that never happened, or for a run where no child existed to abort
 * (a fixture host emits fixed events and never creates a child session). Once a child was running
 * the item reports what was measured: `confirmed` when the aborted run left its `rlm_usage` record at
 * either read point, `limited` when the chain worked (cell aborted, child stopped) but no record
 * appeared, and `failed` when the abort never reached the cell or the child refused to stop. A host
 * with no abort surface is `unavailable`.
 */
export function classifyChildAbort(observation: ChildAbortObservation): { state: CompatState; detail: string } {
	const phases = [
		`abort sent=${observation.abortSent}`,
		`abort accepted=${observation.abortAccepted ?? "unknown"}`,
		`child seen=${observation.childSeen}`,
		`cell aborted=${observation.cellAborted}`,
		`child stopped=${observation.childStopped}`,
		`usage at settle=${observation.usageAtSettled}`,
		`usage after stop=${observation.usageAfterStop}`,
	].join(", ");
	if (!observation.abortSent) {
		if (isFixtureInsufficiency(observation.error)) {
			return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
		}
		return { state: "not-run", detail: `the abort request was never sent (${phases})` };
	}
	if (observation.abortAccepted === false) {
		return { state: "unavailable", detail: `the dedicated Pi refused the abort request (${phases})` };
	}
	if (!observation.childSeen) {
		return {
			state: "not-run",
			detail:
				observation.error === undefined
					? `no child session reached the provider, so nothing was running when the abort arrived (${phases})`
					: `no child session was created: ${observation.error} (${phases})`,
		};
	}
	if (!observation.cellAborted) {
		return { state: "failed", detail: `the abort never reached the parent cell (${phases})` };
	}
	if (!observation.childStopped) {
		return {
			state: "failed",
			detail: `the child was still running ${observation.pollWindowMs ?? 0}ms after the abort (${phases})`,
		};
	}
	if (observation.usageAfterStop > 0 || observation.usageAtSettled > 0) {
		const point = observation.usageAtSettled > 0 ? "at agent_settled" : "only after the child stopped";
		// The condition belongs in the detail: a reader who measures at `agent_settled` alone would
		// report this same product as `limited`, so `confirmed` is only true for a later read.
		return {
			state: "confirmed",
			detail:
				`the aborted child recorded rlm_usage ${point}; conditional on reading after the parent turn ends, ` +
				`because the product appends rlm_usage once the aborted tool call unwinds (${phases})`,
		};
	}
	return {
		state: "limited",
		detail: `the abort reached the cell and the child stopped, but no rlm_usage abort record appeared at settle or after the stop (${phases})`,
	};
}

/**
 * Classify one physical-model child as a whole. The abort is a separate item (`classifyChildAbort`)
 * and never changes this judgement, so a missing abort observation cannot hide a working child.
 */
export function classifyPhysicalChild(observation: RlmChildObservation): {
	state: CompatState;
	detail: string;
} {
	if (!observation.childCreated) {
		if (isFixtureInsufficiency(observation.error)) {
			return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
		}
		return { state: "failed", detail: observation.error ?? "child session was not created" };
	}
	const problems: string[] = [];
	if (!observation.finalAnswer) problems.push("final answer");
	if (!observation.usageRecorded) problems.push("usage");
	if (problems.length > 0) {
		return { state: "limited", detail: `child completed without ${problems.join(", ")}` };
	}
	return { state: "confirmed", detail: "physical-model child completed with a final answer and usage" };
}

/**
 * Classify a child whose parent selected `spirits/auto`. Recorded separately and never as a success
 * (spec: an auto-parent child must not be treated as confirmed), because the child session loads no
 * extensions and therefore cannot route a virtual selection.
 */
export function classifyAutoChild(observation: RlmChildObservation): {
	state: CompatState;
	detail: string;
} {
	const error = observation.error?.replace(/\s+/g, " ").trim();
	if (observation.childCreated && observation.finalAnswer) {
		return {
			state: "limited",
			detail: "auto parent child answered; recorded separately from a physical-model parent and not a success",
		};
	}
	return {
		state: "limited",
		detail: `known limitation: ${error ?? "auto parent did not resolve a child virtual model"}`,
	};
}

export interface RlmFixtureOptions {
	agentDir: string;
	/**
	 * Additional agent dirs the child session reads. An rlm child loads no extensions and resolves
	 * its agent dir through the host's own lookup (`PI_CODING_AGENT_DIR`, else `<home>/.pi/agent`),
	 * which is not the spirits agent dir. The fixture must place auth and the provider registry there
	 * or the child cannot resolve the inherited model.
	 */
	childAgentDirs?: readonly string[];
	providerId?: string;
	modelId?: string;
	strongModel?: string;
	role?: string;
	/** Base URL of the local fake provider, written into `models.json` for the child session. */
	providerBaseUrl?: string;
}

export interface RlmFixture {
	settings: Record<string, unknown>;
	auth: Record<string, unknown>;
	models?: Record<string, unknown>;
}

/**
 * Write the child-facing auth and model settings into the isolated agent dir. The child inherits
 * the parent model, so the fixture makes both the physical model and `spirits/auto` resolvable.
 */
export async function writeRlmFixture(options: RlmFixtureOptions): Promise<RlmFixture> {
	const providerId = options.providerId ?? "compat-fake";
	const modelId = options.modelId ?? "fake-model";
	const strongModel = options.strongModel ?? `${providerId}/${modelId}`;
	const settings = {
		models: {
			strong: strongModel,
			role: options.role ?? "normal",
		},
		defaultProvider: providerId,
		defaultModel: modelId,
	};
	const auth = {
		[providerId]: { type: "api_key", key: "fake" },
	};
	const models = options.providerBaseUrl
		? {
				providers: {
					[providerId]: {
						name: "Compatibility fake provider",
						baseUrl: options.providerBaseUrl,
						apiKey: "fake",
						api: "openai-completions",
						models: [
							{
								id: modelId,
								name: "Fake model",
								reasoning: true,
								input: ["text"],
								contextWindow: 128000,
								maxTokens: 4096,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							},
						],
					},
				},
			}
		: undefined;
	for (const dir of [options.agentDir, ...(options.childAgentDirs ?? [])]) {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
		await writeFile(join(dir, "auth.json"), `${JSON.stringify(auth, null, "\t")}\n`);
		if (models) {
			await writeFile(join(dir, "models.json"), `${JSON.stringify(models, null, "\t")}\n`);
		}
	}
	return { settings, auth, ...(models ? { models } : {}) };
}
