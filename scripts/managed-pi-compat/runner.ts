/**
 * Isolated runner for managed Pi compatibility checks.
 *
 * Every check gets a temporary HOME, agent dir, working directory, and managed root. Results use
 * five distinct states; a skipped or failed check is never reported as confirmed. The saved JSON
 * and the human-readable summary are redacted before they touch the disk.
 */

import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	ensureManagedAgentDir,
	resolveManagedAgentPaths,
} from "../../packages/spirits/src/managed-pi/agent-dir.ts";
import {
	buildObservationEvidence,
	COMPATIBILITY_MET_DEFINITION,
	computeCompatibilityMet,
	computeRunnerCompleted,
	type CompatEvidence,
	countStates,
	formatStateCounts,
	identifyRuntime,
	matrixPurposeCounts,
	nonRequiredIssues,
	ROLE_CLEAR_MODEL_ITEM,
	SUMMARY_READING_NOTES,
	requiredObservationsNotMet,
	type RunMode,
	redactSecrets,
	REQUIRED_OBSERVATIONS,
	RUNNER_COMPLETED_DEFINITION,
} from "./evidence.ts";

/** Result state of one compatibility item. */
export type CompatState = "confirmed" | "limited" | "unavailable" | "not-run" | "failed";

/** Command and captured output of one executed item. */
export interface ItemLog {
	command?: readonly string[];
	stdout?: string;
	stderr?: string;
}

/** Keep one log field bounded so a verbose run cannot bloat the saved evidence. */
const LOG_FIELD_LIMIT = 8000;

/** One log entry, with the command that executed the item and only the output that exists. */
function itemLog(name: string, fallback: readonly string[], log?: ItemLog): ItemLog & { item: string } {
	return {
		item: name,
		command: log?.command?.length ? [...log.command] : [...fallback],
		...(log?.stdout === undefined ? {} : { stdout: log.stdout }),
		...(log?.stderr === undefined ? {} : { stderr: log.stderr }),
	};
}

/**
 * Fingerprint of a directory tree: relative path, size, and modification time. Content edits and
 * rewrites change it, so an unchanged fingerprint is evidence that nothing wrote to the tree.
 */
async function fingerprintTree(root: string): Promise<string> {
	const entries: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		for (const name of names.sort()) {
			const path = join(dir, name);
			const info = await lstat(path);
			if (info.isDirectory()) await walk(path);
			else entries.push(`${path.slice(root.length)}:${info.size}:${Math.round(info.mtimeMs)}`);
		}
	};
	await walk(root);
	return entries.join("\n");
}

/** Redacted stand-in for a pre-existing agent dir, which the managed route must leave untouched. */
const EXISTING_AGENT_SEED: Record<string, string> = {
	"settings.json": '{ "theme": "dark" }\n',
	"sessions/project/s1.jsonl": '{ "type": "session" }\n',
};

/** Shorten one captured log field so a verbose run stays inside the saved evidence. */
function boundLogField(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value.length <= LOG_FIELD_LIMIT) return value;
	return `${value.slice(0, LOG_FIELD_LIMIT)}\n... truncated ${value.length - LOG_FIELD_LIMIT} characters`;
}

/** One compatibility result. */
export interface CompatResult {
	name: string;
	state: CompatState;
	detail?: string;
	data?: unknown;
	/** Execution-mode label; fixture results are always `fixture-only`. */
	label?: string;
}

/** One line of a summary issue list. */
function issueLine(result: CompatResult): string {
	return `- [${result.state}] ${result.name}${result.detail ? `: ${result.detail}` : ""}`;
}

/**
 * The summary lines that qualify a `confirmed` reading. The matrix note carries the measured purpose
 * count when the run recorded purposes, and drops the count when it did not.
 */
function notesLines(results: readonly CompatResult[]): string[] {
	const counts = matrixPurposeCounts(results);
	return SUMMARY_READING_NOTES.map((note) => {
		if (note.item !== ROLE_CLEAR_MODEL_ITEM || counts === undefined) return `- Note: ${note.text}`;
		return `- Note: ${note.text} This run observed ${counts.observed} of ${counts.total} purposes.`;
	});
}

/** The item that records the existing agent dir immutability check. */
export const EXISTING_AGENT_DIR_ITEM = "existing agent dir untouched";

/** Runner environment and lifecycle. */
export interface CompatRunner {
	readonly workRoot: string;
	readonly home: string;
	readonly agentDir: string;
	readonly managedRoot: string;
	/** The existing `~/.spirits/agent` that the managed route must never touch. */
	readonly existingAgentDir: string;
	/** Execution mode recorded on the result. */
	readonly mode: RunMode;
	/** Evidence gathered during the run and merged into the saved result. */
	readonly evidence: Partial<CompatEvidence>;
	/** Environment with isolated HOME, XDG dirs, and agent dir. Extra values are merged last. */
	env(extra?: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;
	/** Record an item without running it. */
	notRun(name: string, detail?: string): CompatResult;
	/**
	 * Run one item; a thrown error becomes `failed`. A returned state is stored as-is. A returned
	 * `log` is kept out of the result and recorded in `logs` instead, so every executed item leaves
	 * the command it ran and the output it produced.
	 */
	run(
		name: string,
		check: () => Promise<{
			state: CompatState;
			detail?: string;
			data?: unknown;
			log?: ItemLog;
		}>,
	): Promise<CompatResult>;
	results(): readonly CompatResult[];
	/**
	 * Compare the seeded existing agent dir against its pre-launch fingerprint, record the item, and
	 * return it. A changed tree is `failed`, so the run's exit code reflects it.
	 */
	verifyExistingAgentDir(): Promise<CompatResult>;
	setMode(mode: RunMode): void;
	setEvidence(evidence: Partial<CompatEvidence>): void;
	/** Record one item's command/output for the evidence log. */
	recordLog(
		item: string,
		entry: { command?: readonly string[]; stdout?: string; stderr?: string },
	): void;
	/** Build the full evidence object from the recorded results. */
	buildEvidence(): CompatEvidence;
	/** Write the redacted result JSON and the summary next to it. */
	writeResult(path?: string): Promise<string>;
	cleanup(): Promise<void>;
}

function redactValue(value: unknown): unknown {
	if (typeof value === "string") return redactSecrets(value);
	if (Array.isArray(value)) return value.map(redactValue);
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) result[key] = redactValue(entry);
		return result;
	}
	return value;
}

function redactResults(results: readonly CompatResult[], mode: RunMode): CompatResult[] {
	return results.map((result) => ({
		label: mode === "fixture" ? "fixture-only" : "official",
		...result,
		...(result.detail === undefined ? {} : { detail: redactSecrets(result.detail) }),
		...(result.data === undefined ? {} : { data: redactValue(result.data) }),
	}));
}

function renderSummary(evidence: CompatEvidence, results: readonly CompatResult[]): string {
	const counts = countStates(results);
	const blocking = requiredObservationsNotMet(results, evidence.requiredObservations);
	const outside = nonRequiredIssues(results, evidence.requiredObservations);
	const provenance = evidence.runnerProvenance;
	const lines = [
		"# Managed Pi compatibility result",
		"",
		`- Mode: ${evidence.mode}`,
		`- Label: ${evidence.mode === "fixture" ? "fixture-only" : "official"}`,
		`- Runner completed: ${evidence.runnerCompleted} (${RUNNER_COMPLETED_DEFINITION})`,
		`- Compatibility met: ${evidence.compatibilityMet} (${COMPATIBILITY_MET_DEFINITION})`,
		`- Results: ${formatStateCounts(counts)}`,
		...notesLines(results),
		...(evidence.existingAgentDirUnchanged === undefined
			? []
			: [`- Existing agent dir untouched: ${evidence.existingAgentDirUnchanged}`]),
		...(provenance === undefined
			? []
			: [
					`- Runner version: ${provenance.commit} (diff sha256 ${provenance.diffSha256}, ${provenance.untracked.length} untracked, clean=${provenance.clean})`,
				]),
		...(evidence.targetCommit === undefined ? [] : [`- Measured bundle commit: ${evidence.targetCommit}`]),
		"",
		"## Required observations not confirmed",
		"",
		...(blocking.length > 0 ? blocking.map(issueLine) : ["- none"]),
		"",
		"## Outside the required list, not confirmed",
		"",
		...(outside.length > 0 ? outside.map(issueLine) : ["- none"]),
		"",
		"## Items",
		"",
	];
	for (const result of results) {
		lines.push(issueLine(result));
	}
	lines.push("", "## Required observations", "");
	for (const name of evidence.requiredObservations) {
		const observed = results.find((result) => result.name === name);
		lines.push(`- ${name}: ${observed?.state ?? "missing"}`);
	}
	return `${lines.join("\n")}\n`;
}

/** Create an isolated runner. */
export async function createCompatRunner(options: { workRoot?: string; mode?: RunMode } = {}): Promise<CompatRunner> {
	const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), "spirits-managed-compat-")));
	const home = join(workRoot, "home");
	const managedRoot = join(workRoot, "managed-pi");
	const cwd = join(workRoot, "project");
	await Promise.all([home, managedRoot, cwd].map((path) => mkdir(path, { recursive: true })));
	// Resolve and create the isolated agent dir through the product guard, so the runner follows the
	// fixed managed agent dir instead of its own explicit-path choice.
	const paths = await resolveManagedAgentPaths({ home, root: managedRoot, env: {} });
	await ensureManagedAgentDir(paths);
	const agentDir = paths.agentDir;
	const existingAgentDir = paths.existingAgentDir;
	// Seed the existing agent dir in the temporary HOME so the immutability claim in the evidence is
	// a measurement: something is there to overwrite, and its timestamps are known beforehand.
	for (const [relative, content] of Object.entries(EXISTING_AGENT_SEED)) {
		const path = join(existingAgentDir, relative);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
	}
	const existingBefore = await fingerprintTree(existingAgentDir);
	// Both the item and the evidence field read the tree through here, so they cannot disagree.
	const measureExistingUnchanged = async (): Promise<boolean> =>
		(await fingerprintTree(existingAgentDir)) === existingBefore;
	const recorded: CompatResult[] = [];
	let mode: RunMode = options.mode ?? "fixture";
	let evidence: Partial<CompatEvidence> = {};
	const logs: Array<ItemLog & { item: string }> = [];
	// An item that runs in this process still needs a command in the log: the runner invocation is
	// what executed it.
	const runnerCommand: readonly string[] = [process.execPath, ...process.argv.slice(1)];
	// One bookkeeping path, so an item recorded outside `run()` (the existing agent dir check) still
	// lands in the results and the log list.
	const recordRun: CompatRunner["run"] = async (name, check) => {
		try {
			const { log, ...value } = await check();
			const result = { name, ...value };
			recorded.push(result);
			logs.push(itemLog(name, runnerCommand, log));
			return result;
		} catch (error) {
			const result = {
				name,
				state: "failed" as const,
				detail: error instanceof Error ? error.message : String(error),
			};
			recorded.push(result);
			logs.push(itemLog(name, runnerCommand));
			return result;
		}
	};
	const buildEvidence = (): CompatEvidence => {
		const results = redactResults(recorded, mode);
		const runtime = {
			runner: identifyRuntime({
				bunVersion: typeof Bun === "undefined" ? undefined : Bun.version,
				nodeVersion: process.version,
			}),
			host: "unknown",
			requiredApis: {},
			...(evidence.runtime ?? {}),
		};
		return {
			mode,
			runnerCompleted: computeRunnerCompleted(results),
			runnerCompletedDefinition: RUNNER_COMPLETED_DEFINITION,
			compatibilityMet: computeCompatibilityMet(mode, results),
			compatibilityMetDefinition: COMPATIBILITY_MET_DEFINITION,
			requiredObservations: REQUIRED_OBSERVATIONS,
			observationEvidence: buildObservationEvidence(results),
			...evidence,
			runtime,
			logs: logs.map((entry) => ({
				...entry,
				...(entry.stdout === undefined ? {} : { stdout: redactSecrets(boundLogField(entry.stdout) ?? "") }),
				...(entry.stderr === undefined ? {} : { stderr: redactSecrets(boundLogField(entry.stderr) ?? "") }),
			})),
		};
	};
	return {
		workRoot,
		home,
		agentDir,
		managedRoot,
		existingAgentDir,
		get mode() {
			return mode;
		},
		get evidence() {
			return evidence;
		},
		env(extra = {}) {
			return {
				PATH: process.env.PATH,
				HOME: home,
				XDG_CONFIG_HOME: join(home, ".config"),
				XDG_DATA_HOME: join(home, ".local", "share"),
				XDG_CACHE_HOME: join(home, ".cache"),
				XDG_STATE_HOME: join(home, ".local", "state"),
				SPIRITS_CODING_AGENT_DIR: agentDir,
				PI_CODING_AGENT_DIR: undefined,
				...extra,
			};
		},
		notRun(name, detail) {
			const result = { name, state: "not-run" as const, ...(detail ? { detail } : {}) };
			recorded.push(result);
			return result;
		},
		run(name, check) {
			return recordRun(name, check);
		},
		async verifyExistingAgentDir() {
			const unchanged = await measureExistingUnchanged();
			return await recordRun(EXISTING_AGENT_DIR_ITEM, async () =>
				unchanged
					? {
						state: "confirmed" as const,
						detail:
							"the seeded existing agent dir kept its content and modification times across every launch",
						data: { existingAgentDir },
					}
					: {
						state: "failed" as const,
						detail: `a managed launch changed ${existingAgentDir}; the managed route must never write there`,
						data: { existingAgentDir },
					}
			);
		},
		results() {
			return [...recorded];
		},
		setMode(next) {
			mode = next;
		},
		setEvidence(next) {
			evidence = { ...evidence, ...next };
		},
		recordLog(item, entry) {
			logs.push(itemLog(item, runnerCommand, entry));
		},
		buildEvidence() {
			return buildEvidence();
		},
		async writeResult(path = join(workRoot, "compat-result.json")) {
			const results = redactResults(recorded, mode);
			const full: CompatEvidence = {
				...buildEvidence(),
				existingAgentDirUnchanged: await measureExistingUnchanged(),
			};
			await mkdir(dirname(path), { recursive: true });
			await Bun.write(path, `${JSON.stringify({ ...full, results, cwd }, null, "\t")}\n`);
			const summaryPath = join(dirname(path), "managed-pi-compat-result.md");
			await Bun.write(summaryPath, renderSummary(full, results));
			return path;
		},
		async cleanup() {
			await rm(workRoot, { recursive: true, force: true });
		},
	};
}
