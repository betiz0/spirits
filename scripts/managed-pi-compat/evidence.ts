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

/**
 * The version of the harness that produced a result.
 *
 * The runner lives outside the measured bundle, so the bundle's target commit says nothing about
 * which judgement produced the numbers. Both are recorded: `targetCommit` is what was measured,
 * `runnerProvenance` is what measured it.
 */
export interface RunnerProvenance {
	/** `git rev-parse HEAD` of the checkout that executed the runner. */
	commit: string;
	/** SHA256 of `git diff HEAD` output, so a dirty tree is comparable across runs. */
	diffSha256: string;
	/** Untracked files under the repository root at execution time. */
	untracked: string[];
	/** True when the diff is empty and nothing is untracked. */
	clean: boolean;
}

/**
 * Build the runner provenance from git output.
 *
 * The caller reads the three values; this only judges them, so the judgement stays testable without a
 * repository. An unreadable value stays `unknown` and marks the provenance not clean.
 */
export function buildRunnerProvenance(git: { commit?: string; diff?: string; status?: string }): RunnerProvenance {
	const commit = git.commit?.trim() ?? "";
	const diff = git.diff ?? "";
	const untracked = (git.status ?? "")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.startsWith("??"))
		.map((line) => line.slice(3).trim());
	return {
		commit: commit === "" ? "unknown" : commit,
		diffSha256: digestHex(diff),
		untracked,
		clean: commit !== "" && diff.trim().length === 0 && untracked.length === 0,
	};
}

/** SHA256 of a string, lowercase hex. */
function digestHex(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * What `runnerCompleted` means. Recorded with the result so a reader never infers it from the name.
 */
export const RUNNER_COMPLETED_DEFINITION =
	"every recorded item was processed; false when any item stayed not-run. It says nothing about whether the observations passed.";

/** What `compatibilityMet` means, recorded with the result. */
export const COMPATIBILITY_MET_DEFINITION =
	"official mode only, and every required observation is confirmed. A required item that is limited, unavailable, not-run, or failed keeps it false; a fixture run is always false. It does not certify migration or deleting the fork: the base spec keeps the existing agent dir write-back and persistent settings write unproven, and those stay outside the required list. It also says nothing about whether role, /clear, or /model is available: the matrix item is confirmed as soon as any purpose is observed, so read its observed purpose count instead.";

/** Result-level evidence attached to the saved JSON. */
export interface CompatEvidence {
	mode: RunMode;
	/** True when the runner processed every item (no item stayed `not-run`). */
	runnerCompleted: boolean;
	/** Textual definition of `runnerCompleted`, recorded with the value. */
	runnerCompletedDefinition: string;
	/** True only for an official run whose required observations are all `confirmed`. */
	compatibilityMet: boolean;
	/** Textual definition of `compatibilityMet`, recorded with the value. */
	compatibilityMetDefinition: string;
	/** Observations that must be `confirmed` for `compatibilityMet`. */
	requiredObservations: readonly string[];
	/** Version of the harness that produced this result, separate from the measured bundle commit. */
	runnerProvenance?: RunnerProvenance;
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
 * The list holds the items the dedicated Pi can actually measure. A product-side gap is not a reason
 * to leave an item out: the child abort is measurable end to end, and if the product does not deliver
 * the record the item says so and the verdict stays false. `existing agent dir write-back
 * compatibility` is the one item kept out, by the base spec, which pins write-back compatibility as
 * unproven until a separate change demonstrates it.
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
	"rlm child abort",
	"data read compatibility",
	"dedicated Pi write path",
	"role/clear/model matrix",
	"existing agent dir untouched",
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
	"rlm child abort":
		"abort request sent, abort reaching the parent cell, the child's provider request closing, and the rlm_usage abort record at settle or after the stop",
	"existing agent dir untouched":
		"the seeded existing agent dir kept its content and modification times across every launch",
	"rlm auto parent": "the child's own request named a physical model, and the run returned a final answer and an rlm_usage record",
	"auth read compatibility": "the provider auth status came from the dedicated Pi runtime reading the copied agent dir",
	"external extension read compatibility": "an extension in the copied agent dir was visible through the dedicated Pi runtime",
	"data read compatibility": "settings and sessions were read through the dedicated Pi",
	"dedicated Pi write path": "session, model, and thinking level were written and read back through the dedicated Pi",
	"existing agent dir write-back compatibility": "a write through the dedicated Pi was proven to land in an existing agent dir copy",
	"role/clear/model matrix": "each role/clear/model purpose came from a dedicated-Pi behaviour observation",
	"direct execute probe is auxiliary": "the managed tool inventory showed tsrepl; a direct execute would report bypassedPiHooks",
	"settings write compatibility": "a persistent settings write through the Pi extension API was attempted and read back",
};

/** True when the runner processed every recorded item (see `RUNNER_COMPLETED_DEFINITION`). */
export function computeRunnerCompleted(results: readonly CompatResult[]): boolean {
	return results.length > 0 && results.every((result) => result.state !== "not-run");
}

/** True only for an official run whose required observations are all confirmed (see `COMPATIBILITY_MET_DEFINITION`). */
export function computeCompatibilityMet(mode: RunMode, results: readonly CompatResult[]): boolean {
	if (mode !== "official") return false;
	const byName = new Map(results.map((result) => [result.name, result.state]));
	return REQUIRED_OBSERVATIONS.every((name) => byName.get(name) === "confirmed");
}

/** Required observations that are not `confirmed`, in required-list order. */
export function requiredObservationsNotMet(
	results: readonly CompatResult[],
	required: readonly string[] = REQUIRED_OBSERVATIONS,
): CompatResult[] {
	return required
		.map((name) => results.find((result) => result.name === name))
		.filter((result): result is CompatResult => result !== undefined && result.state !== "confirmed");
}

/** Items outside the required list that did not come out `confirmed`. */
export function nonRequiredIssues(
	results: readonly CompatResult[],
	required: readonly string[] = REQUIRED_OBSERVATIONS,
): CompatResult[] {
	return results.filter((result) => !required.includes(result.name) && result.state !== "confirmed");
}

/** Build the observation-to-evidence map for the recorded items. */
export function buildObservationEvidence(results: readonly CompatResult[]): ObservationEvidence[] {
	return results.map((result) => ({
		observation: result.name,
		expectedEvidence: OBSERVATION_EVIDENCE[result.name] ?? "an observation recorded by the compatibility runner",
	}));
}

/** The five result states, in the order every breakdown prints them. */
export const COMPAT_STATE_LABELS: readonly CompatState[] = [
	"confirmed",
	"limited",
	"unavailable",
	"not-run",
	"failed",
];

/** State counts by state name, used by the human-readable summary. */
export function countStates(results: readonly CompatResult[]): Record<CompatState, number> {
	const counts = Object.fromEntries(COMPAT_STATE_LABELS.map((state) => [state, 0])) as Record<
		CompatState,
		number
	>;
	for (const result of results) counts[result.state] += 1;
	return counts;
}

/**
 * The state breakdown line, always naming all five labels.
 *
 * A breakdown that omits a state leaves the reader to guess whether it counted zero or was never
 * measured, so both the console line and the summary print `unavailable=0 failed=0` explicitly.
 */
export function formatStateCounts(counts: Record<CompatState, number>): string {
	return COMPAT_STATE_LABELS.map((state) => `${state}=${counts[state]}`).join(" ");
}

/** The item that judges role, `/clear`, and `/model` purposes. */
export const ROLE_CLEAR_MODEL_ITEM = "role/clear/model matrix";

/**
 * Observed and defined purpose counts of the matrix item, read from its own recorded data.
 *
 * `confirmed` on that item means "a purpose was observed on the dedicated Pi", so the count is the
 * only thing that separates "2 of 9 purposes seen" from "all 9 seen". Undefined when the item never
 * recorded purposes, so the summary never prints a count it did not measure.
 */
export function matrixPurposeCounts(
	results: readonly CompatResult[],
): { observed: number; total: number } | undefined {
	const purposes = (results.find((result) => result.name === ROLE_CLEAR_MODEL_ITEM)?.data as
		| { purposes?: unknown }
		| undefined)?.purposes;
	if (!Array.isArray(purposes)) return undefined;
	const observed = purposes.filter(
		(purpose) => (purpose as { state?: unknown } | undefined)?.state !== "not-run",
	).length;
	return { observed, total: purposes.length };
}

/**
 * Notes that qualify two `confirmed` judgements, printed at the head of the summary.
 *
 * Both readings are easy to over-read: the child-abort record depends on when the entries were read,
 * and the matrix row says nothing about the other purposes.
 */
export interface SummaryReadingNote {
	/** Which `confirmed` judgement the note qualifies. */
	item: "rlm child abort" | typeof ROLE_CLEAR_MODEL_ITEM;
	text: string;
}

export const SUMMARY_READING_NOTES: readonly SummaryReadingNote[] = [
	{
		item: "rlm child abort",
		text: "`rlm child abort` is confirmed conditionally: the product appends `rlm_usage` after the parent turn ends, so the record is readable in the read taken after the child stops, never at `agent_settled`.",
	},
	{
		item: ROLE_CLEAR_MODEL_ITEM,
		text: "`role/clear/model matrix` is confirmed when any purpose was observed on the dedicated Pi; the observed purpose count is printed next to it, and `compatibilityMet` does not follow from it.",
	},
];

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
