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

/** Classify the child abort on its own; an unobserved abort is `not-run`, not a pass. */
export function classifyChildAbort(observation: RlmChildObservation): { state: CompatState; detail: string } {
	if (observation.abortReported === true) {
		return { state: "confirmed", detail: "child abort was observed through rlm_usage" };
	}
	if (observation.abortReported === false) {
		return {
			state: "not-run",
			detail: "the abort was exercised but no rlm_usage abort record was observed",
		};
	}
	if (isFixtureInsufficiency(observation.error)) {
		return { state: "not-run", detail: `fixture insufficiency: ${observation.error}` };
	}
	return { state: "not-run", detail: "child abort was not exercised" };
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
