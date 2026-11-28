/**
 * Resolving a change through the `openspec` CLI, the way the verification steps themselves do.
 *
 * The store declaration, the nearest-root walk, and the config pointer are openspec's rules; a
 * second implementation of them here would be a second truth to drift (design Decision 3 of the
 * report-saving change). So this module only runs the CLI and reads its JSON:
 *
 * - `openspec status --change <name> --json [--store <id>]` → `changeRoot`, the save directory.
 * - `openspec list --json [--store <id>]` → the change names, which is what pins a verification
 *   target to an exact name (design Decision 12).
 *
 * Both readers take the same store: a pin looked up in one store and saved in another would send a
 * report to a change the verification never ran against (design Decision 3, d-verify3 C-1).
 *
 * The resolvers take the spawn step as an injected function (design Decision 13): production wires
 * the real `spawnOpenspec`, and a test hands in a fake that answers with each failure shape. No
 * global registry and no public seam.
 */

import {
	OPENSPEC_CLI_TIMEOUT_REASON,
	OPENSPEC_CLI_TIMEOUT_MS,
	OPENSPEC_CLI_UNAVAILABLE_REASON,
} from "../constants.ts";

/** What one CLI run answers: its stdout, a non-zero exit, a timeout, or no process at all. */
export type OpenspecRun =
	| { kind: "output"; stdout: string }
	| { kind: "exit"; code: number; stderr: string }
	| { kind: "timeout" }
	| { kind: "unavailable" };

/** Runs one openspec command and waits at most the timeout for it. Injectable by design. */
export type OpenspecRunner = (args: readonly string[], timeoutMs: number) => Promise<OpenspecRun>;

/** Why a resolution stopped, in the words the tool hands back to the model. */
export interface ResolveFailure {
	kind: "error";
	reason: string;
}

/** Where a named change lives, or why this does not know. */
export type ChangeRootResult = { kind: "ok"; changeRoot: string } | ResolveFailure;

/** Resolves one change name to its directory; `storeId` is only for an explicitly named store. */
export type ChangeRootResolver = (changeName: string, storeId?: string) => Promise<ChangeRootResult>;

/** The change names of one resolution: the named store's, or the nearest root's when none is named. */
export type ChangeNameLister = (storeId?: string) => Promise<string[]>;

/**
 * Run one openspec command through `Bun.spawn`, killing it at the timeout.
 *
 * The command is run from the process's working directory, which is where the openspec CLI finds
 * the nearest `openspec/` root — the same rule the verification steps' own CLI calls follow.
 */
export const spawnOpenspec: OpenspecRunner = async (args, timeoutMs) => {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn({ cmd: ["openspec", ...args], stdout: "pipe", stderr: "pipe" });
	} catch {
		return { kind: "unavailable" };
	}
	const killer = setTimeout(() => proc.kill(), timeoutMs);
	// The spawn above asked for pipes; the subprocess type only widens `stdout` / `stderr` to the
	// inherit forms generically, so the pipe shape is named once here.
	const streams = proc as unknown as { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> };
	try {
		const winner = await Promise.race([
			proc.exited.then(async (code) => ({
				done: true as const,
				code,
				stdout: await new Response(streams.stdout).text(),
				stderr: await new Response(streams.stderr).text(),
			})),
			new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false as const }), timeoutMs)),
		]);
		if (!winner.done) return { kind: "timeout" };
		if (winner.code !== 0) return { kind: "exit", code: winner.code, stderr: winner.stderr.trim() };
		return { kind: "output", stdout: winner.stdout };
	} catch {
		proc.kill();
		return { kind: "unavailable" };
	} finally {
		clearTimeout(killer);
	}
};

/** Why the CLI's answer was not usable, phrased once for both readers below. */
function unusable(run: OpenspecRun): string | undefined {
	if (run.kind === "unavailable") return OPENSPEC_CLI_UNAVAILABLE_REASON;
	if (run.kind === "timeout") return OPENSPEC_CLI_TIMEOUT_REASON;
	if (run.kind === "exit") return `the openspec CLI failed (exit ${run.code}): ${run.stderr}`;
	return undefined;
}

/** Read `changeRoot` out of `openspec status --change <name> --json` output. */
export function parseChangeRoot(stdout: string): ChangeRootResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return { kind: "error", reason: "the openspec CLI did not return readable JSON." };
	}
	const root =
		typeof parsed === "object" && parsed !== null
			? (parsed as { changeRoot?: unknown }).changeRoot
			: undefined;
	if (typeof root !== "string" || root === "") {
		return { kind: "error", reason: "the openspec CLI answered without a changeRoot." };
	}
	return { kind: "ok", changeRoot: root };
}

/**
 * The change-root resolver the verify layer wires by default.
 *
 * `run` and `timeoutMs` are the injection points of design Decision 13; no product caller passes
 * them.
 */
export function createOpenspecChangeRootResolver(
	options: { run?: OpenspecRunner; timeoutMs?: number } = {},
): ChangeRootResolver {
	const run = options.run ?? spawnOpenspec;
	const timeoutMs = options.timeoutMs ?? OPENSPEC_CLI_TIMEOUT_MS;
	return async (changeName, storeId) => {
		const args = ["status", "--change", changeName, "--json"];
		if (storeId !== undefined) args.push("--store", storeId);
		const result = await run(args, timeoutMs);
		if (result.kind !== "output") {
			return { kind: "error", reason: unusable(result) ?? OPENSPEC_CLI_UNAVAILABLE_REASON };
		}
		return parseChangeRoot(result.stdout);
	};
}

/** Read the change names out of `openspec list --json` output; an unreadable answer is no names. */
export function parseChangeNames(stdout: string): string[] {
	try {
		const parsed: unknown = JSON.parse(stdout);
		if (typeof parsed !== "object" || parsed === null) return [];
		const changes = (parsed as { changes?: unknown }).changes;
		if (!Array.isArray(changes)) return [];
		return changes
			.map((entry) => (typeof entry === "object" && entry !== null ? (entry as { name?: unknown }).name : undefined))
			.filter((name): name is string => typeof name === "string" && name !== "");
	} catch {
		return [];
	}
}

/**
 * The exact change-name list the verification target is pinned against (design Decision 12):
 * only a name in this list, matched whole, can pin a verification. The list is read from the same
 * store the save resolves against, so a store-only change pins and a change the store does not have
 * does not (d-verify3 C-1).
 */
export function createOpenspecChangeNameLister(
	options: { run?: OpenspecRunner; timeoutMs?: number } = {},
): ChangeNameLister {
	const run = options.run ?? spawnOpenspec;
	const timeoutMs = options.timeoutMs ?? OPENSPEC_CLI_TIMEOUT_MS;
	return async (storeId) => {
		const args = ["list", "--json"];
		if (storeId !== undefined) args.push("--store", storeId);
		const result = await run(args, timeoutMs);
		if (result.kind !== "output") return [];
		return parseChangeNames(result.stdout);
	};
}
