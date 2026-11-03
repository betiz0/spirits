/**
 * Isolated runner for managed Pi compatibility checks.
 *
 * Every check gets a temporary HOME, agent dir, working directory, and managed root. Results use
 * five distinct states; a skipped or failed check is never reported as confirmed.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Result state of one compatibility item. */
export type CompatState = "confirmed" | "limited" | "unavailable" | "not-run" | "failed";

/** One compatibility result. */
export interface CompatResult {
	name: string;
	state: CompatState;
	detail?: string;
	data?: unknown;
}

/** Runner environment and lifecycle. */
export interface CompatRunner {
	readonly workRoot: string;
	readonly home: string;
	readonly agentDir: string;
	readonly managedRoot: string;
	/** Environment with isolated HOME, XDG dirs, and agent dir. Extra values are merged last. */
	env(extra?: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;
	/** Record an item without running it. */
	notRun(name: string, detail?: string): CompatResult;
	/** Run one item; a thrown error becomes `failed`. A returned state is stored as-is. */
	run(
		name: string,
		check: () => Promise<{ state: CompatState; detail?: string; data?: unknown }>,
	): Promise<CompatResult>;
	results(): readonly CompatResult[];
	writeResult(path?: string): Promise<string>;
	cleanup(): Promise<void>;
}

/** Create an isolated runner. */
export async function createCompatRunner(options: { workRoot?: string } = {}): Promise<CompatRunner> {
	const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), "spirits-managed-compat-")));
	const home = join(workRoot, "home");
	const agentDir = join(home, ".spirits", "agent");
	const managedRoot = join(workRoot, "managed-pi");
	const cwd = join(workRoot, "project");
	await Promise.all([home, agentDir, managedRoot, cwd].map((path) => mkdir(path, { recursive: true })));
	const recorded: CompatResult[] = [];
	return {
		workRoot,
		home,
		agentDir,
		managedRoot,
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
		async run(name, check) {
			try {
				const value = await check();
				const result = { name, ...value };
				recorded.push(result);
				return result;
			} catch (error) {
				const result = {
					name,
					state: "failed" as const,
					detail: error instanceof Error ? error.message : String(error),
				};
				recorded.push(result);
				return result;
			}
		},
		results() {
			return [...recorded];
		},
		async writeResult(path = join(workRoot, "compat-result.json")) {
			await Bun.write(path, `${JSON.stringify({ results: recorded, cwd }, null, "\t")}\n`);
			return path;
		},
		async cleanup() {
			await rm(workRoot, { recursive: true, force: true });
		},
	};
}
