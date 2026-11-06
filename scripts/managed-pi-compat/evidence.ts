/**
 * Result judgement and evidence for the managed Pi compatibility runner.
 *
 * The runner distinguishes "the runner processed every item" from "the compatibility requirements
 * were met". A fixture run never becomes compatibility evidence, and a missing or limited required
 * observation is never reported as success just because nothing failed.
 */

import type { CompatResult, CompatState } from "./runner.ts";

/** Execution mode recorded on every result. */
export type RunMode = "fixture" | "official";

/** Runtime and required-API presence, kept separate between runner and Pi host. */
export interface RuntimeEvidence {
	/** Runner-side runtime, for example `bun 1.4.4`. */
	runner: string;
	/** Pi host-side runtime; `unknown` when it could not be observed. */
	host: string;
	/** Required extension APIs and whether the host exposed them; `unknown` when unobserved. */
	requiredApis: Record<string, boolean | "unknown">;
}

/** One observation paired with the evidence that would confirm it. */
export interface ObservationEvidence {
	observation: string;
	expectedEvidence: string;
}

/** Result-level evidence attached to the saved JSON. */
export interface CompatEvidence {
	mode: RunMode;
	/** True when the runner processed every item (no item stayed `not-run`). */
	runnerCompleted: boolean;
	/** True only for an official run whose required observations are all `confirmed`. */
	compatibilityMet: boolean;
	/** Observations that must be `confirmed` for `compatibilityMet`. */
	requiredObservations: readonly string[];
	/** Observation-to-evidence map. */
	observationEvidence: readonly ObservationEvidence[];
	/** Runner and Pi host runtimes, and required API presence. */
	runtime: RuntimeEvidence;
	/** Target commit of the measured bundle, when recorded. */
	targetCommit?: string;
	/** Whether the working tree had changes, when recorded. */
	workingTreeClean?: boolean;
	/** Official Pi version from the manifest. */
	piVersion?: string;
	/** Official artifact tarball SHA256. */
	artifactSha256?: string;
	/** SHA256 of the extracted official executable. */
	executableSha256?: string;
	/** Target-commit extension bundle version. */
	bundleVersion?: string;
	/** Target-commit extension bundle SHA256. */
	bundleSha256?: string;
	/** Manifest set id. */
	manifestSetId?: string;
	/** SHA256 of the manifest file. */
	manifestSha256?: string;
	/** Overlay version from the manifest. */
	overlayVersion?: string;
	/** Overlay SHA256 from the manifest. */
	overlaySha256?: string;
	/**
	 * True when the seeded `~/.spirits/agent` fixture in the temporary HOME kept its content and
	 * modification times across every launch. The managed route must never write there.
	 */
	existingAgentDirUnchanged?: boolean;
	/** Per-item command and captured output log, redacted before saving. */
	logs?: ReadonlyArray<{ item: string; command?: readonly string[]; stdout?: string; stderr?: string }>;
}

/**
 * Observations that must be `confirmed` before an official run may claim compatibility. A missing
 * or limited item makes `compatibilityMet` false even when `failed=0`.
 *
 * Only items the dedicated Pi can actually measure are listed. The existing agent dir write-back
 * compatibility and the rlm child abort stay out: the product cannot observe them yet, so they are
 * recorded separately as `not-run` and never decide the compatibility verdict.
 */
export const REQUIRED_OBSERVATIONS: readonly string[] = [
	"managed extension load",
	"agent dir precedence",
	"package dir decoy does not change identity",
	"help touches only the isolated home",
	"api key and proxy survive",
	"bundled SKILL.md is raw markdown",
	"host version",
	"managed tsrepl simple cell",
	"managed tsrepl Bun.Transpiler cell",
	"managed tsrepl node:vm cell",
	"cell failure is not reported as a load failure",
	"model tool call reaches tsrepl",
	"no real credentials are read",
	"rlm physical model child",
	"rlm child usage",
	"data read compatibility",
	"dedicated Pi write path",
	"role/clear/model matrix",
];

/** Evidence expected for each observation; unknown names get a generic description. */
export const OBSERVATION_EVIDENCE: Readonly<Record<string, string>> = {
	"managed extension load": "RPC session_start followed by tsrepl in the managed tool inventory",
	"agent dir precedence": "the managed Pi reported the fixed isolated agent dir",
	"package dir decoy does not change identity": "a decoy PI_PACKAGE_DIR did not change the reported version",
	"help touches only the isolated home": "the help run wrote nothing outside the temporary HOME",
	"api key and proxy survive": "the fake API key and proxy reached the managed process",
	"bundled SKILL.md is raw markdown": "the session wrote a SKILL.md that is raw Markdown",
	"host version": "the managed host reported the official artifact version",
	"managed tsrepl simple cell": "a cell returning 2 ran on the managed Pi",
	"managed tsrepl Bun.Transpiler cell": "a TypeScript cell ran through Bun.Transpiler on the managed Pi",
	"managed tsrepl node:vm cell": "a node:vm cell returned a value on the managed Pi",
	"cell failure is not reported as a load failure": "a throwing cell was recorded as a cell failure",
	"model tool call reaches tsrepl": "tool_execution_start/end for tsrepl were observed on the normal model path",
	"no real credentials are read": "only the fake bearer token reached the local provider",
	"rlm physical model child": "a physical-model child completed with a final answer",
	"rlm child usage": "the child recorded rlm_usage",
	"rlm child abort": "the child abort was observed through rlm_usage",
	"rlm auto parent": "the auto parent child was judged separately from the physical model",
	"auth read compatibility": "the provider auth status came from the dedicated Pi runtime reading the copied agent dir",
	"external extension read compatibility": "an extension in the copied agent dir was visible through the dedicated Pi runtime",
	"data read compatibility": "settings and sessions were read through the dedicated Pi",
	"dedicated Pi write path": "session, model, and thinking level were written and read back through the dedicated Pi",
	"existing agent dir write-back compatibility": "a write through the dedicated Pi was proven to land in an existing agent dir copy",
	"role/clear/model matrix": "each role/clear/model purpose came from a dedicated-Pi behaviour observation",
	"direct execute probe is auxiliary": "the managed tool inventory showed tsrepl; a direct execute would report bypassedPiHooks",
	"settings write compatibility": "a persistent settings write through the Pi extension API was attempted and read back",
};

/** True when the runner processed every recorded item. */
export function computeRunnerCompleted(results: readonly CompatResult[]): boolean {
	return results.length > 0 && results.every((result) => result.state !== "not-run");
}

/** True only for an official run whose required observations are all confirmed. */
export function computeCompatibilityMet(mode: RunMode, results: readonly CompatResult[]): boolean {
	if (mode !== "official") return false;
	const byName = new Map(results.map((result) => [result.name, result.state]));
	return REQUIRED_OBSERVATIONS.every((name) => byName.get(name) === "confirmed");
}

/** Build the observation-to-evidence map for the recorded items. */
export function buildObservationEvidence(results: readonly CompatResult[]): ObservationEvidence[] {
	return results.map((result) => ({
		observation: result.name,
		expectedEvidence: OBSERVATION_EVIDENCE[result.name] ?? "an observation recorded by the compatibility runner",
	}));
}

/** State counts by state name, used by the human-readable summary. */
export function countStates(results: readonly CompatResult[]): Record<CompatState, number> {
	const counts: Record<CompatState, number> = {
		confirmed: 0,
		limited: 0,
		unavailable: 0,
		"not-run": 0,
		failed: 0,
	};
	for (const result of results) counts[result.state] += 1;
	return counts;
}

/**
 * Name the runtime that actually executed a process.
 *
 * Bun answers `process.version` with its Node-compatibility version, so the Node version alone
 * cannot tell a Bun host from a Node host. Prefer the value that identifies the runtime and fall
 * back to `unknown` rather than a guess.
 */
export function identifyRuntime(source: { bunVersion?: string; nodeVersion?: string }): string {
	if (source.bunVersion) return `bun ${source.bunVersion}`;
	if (source.nodeVersion) return `node ${source.nodeVersion}`;
	return "unknown";
}

/**
 * Build the runtime evidence, keeping the runner and Pi host runtimes separate and recording
 * required API presence. Unobserved values become `unknown` instead of a guess.
 */
export function buildRuntimeEvidence(input: {
	runnerRuntime: string;
	hostRuntime?: string;
	requiredApis?: Record<string, boolean | undefined>;
}): RuntimeEvidence {
	const requiredApis: Record<string, boolean | "unknown"> = {};
	for (const [name, present] of Object.entries(input.requiredApis ?? {})) {
		requiredApis[name] = present === undefined ? "unknown" : present;
	}
	return {
		runner: input.runnerRuntime,
		host: input.hostRuntime ?? "unknown",
		requiredApis,
	};
}

/** Mask API keys, bearer tokens, and proxy credentials before anything is saved. */
export function redactSecrets(text: string): string {
	return text
		.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "sk-***")
		.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/g, "$1***")
		.replace(/\b((?:ANTHROPIC|OPENAI|GOOGLE|GEMINI|AWS|AZURE)[A-Z0-9_]*API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)=([^\s&"']+)/g, "$1=***")
		.replace(/\b((?:ANTHROPIC|OPENAI|GOOGLE|GEMINI)[A-Z0-9_]*API_KEY|TOKEN|SECRET|PASSWORD)\s*:\s*([^\s&"',}]+)/g, "$1: ***")
		.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/g, "$1***:***@")
		.replace(/("x-api-key"\s*:\s*")[^"]+(")/gi, "$1***$2")
		.replace(/("authorization"\s*:\s*")[^"]+(")/gi, "$1***$2")
		.replace(/\b(x-api-key)\s*:\s*([^\s&"',}]+)/gi, "$1: ***");
}
