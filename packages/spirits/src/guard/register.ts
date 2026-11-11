/**
 * The `tool_call` handler that applies the guard.
 *
 * The handler is the only place that knows the three things the rules need from outside the command
 * string: the mode, the session working directory, and the reach of the call. Everything it decides
 * is wrapped so that a failure inside the guard cannot reach pi: pi blocks a tool when a `tool_call`
 * handler throws, and a guard bug must not cost the user their bash.
 */

import { tmpdir } from "node:os";
import { ACTION_GUARD_MODE_ENFORCE, ACTION_GUARD_MODE_OFF } from "../constants.ts";
import { readActionGuardMode, type EnvLike } from "../config.ts";
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { blockReason } from "./messages.ts";
import { recordGuardDecision, type AppendEntry } from "./metrics.ts";
import { classify, type GuardScope } from "./rules.ts";

/** The one tool the guard looks at. */
const BASH_TOOL_NAME = "bash";

/** Temporary directories the OS uses when the environment does not name one. */
const SYSTEM_TEMPORARY_DIRECTORIES: readonly string[] = ["/tmp", "/var/tmp"];

export interface BashGuardOptions {
	/** Environment the mode is read from. Defaults to the process environment. */
	env?: EnvLike;
	/** Session sink the decision is recorded to. Omit to classify without recording. */
	appendEntry?: AppendEntry;
	/**
	 * Temporary directories, resolved once here. `TMPDIR` is the operator's spelling of the same
	 * place, and the rules also read the `$TMPDIR` form inside a path operand.
	 */
	tempDirectories?: readonly string[];
}

/**
 * Subscribe the guard to `tool_call`.
 *
 * The mode is resolved once, so a change to the environment mid-session does not move the goal posts
 * under a running conversation.
 */
export function registerBashGuard(pi: Pick<ExtensionAPI, "on" | "appendEntry">, options: BashGuardOptions = {}): void {
	const mode = readActionGuardMode(options.env ?? (process.env as EnvLike));
	const tempDirectories = options.tempDirectories ?? defaultTempDirectories();
	const appendEntry = options.appendEntry ?? ((type: string, data: unknown): void => pi.appendEntry(type, data));

	pi.on("tool_call", (event, ctx) => {
		try {
			// `off` classifies nothing, so it records nothing either.
			if (mode === ACTION_GUARD_MODE_OFF) return undefined;
			if (event.toolName !== BASH_TOOL_NAME) return undefined;
			const command: unknown = event.input.command;
			if (typeof command !== "string" || command === "") return undefined;
			// pi sets `parentToolCallId` on a call another tool issued, which is how a cell's `tool()`
			// or `sh()` reaches here. The S family stops at the model's own calls.
			const nested = event.parentToolCallId !== undefined;
			const scope: GuardScope = { cwd: ctx.cwd, tempDirectories };
			const verdict = classify(command, scope, { nested });
			if (verdict.categories.length === 0) return undefined;

			const blocked = mode === ACTION_GUARD_MODE_ENFORCE;
			recordGuardDecision({ categories: verdict.categories, mode, blocked, nested }, appendEntry);
			if (!blocked) return undefined;
			const result: ToolCallEventResult = { block: true, reason: blockReason(verdict.categories) };
			return result;
		} catch {
			// A guard failure is a miss. Letting the exception out would make pi block the tool.
			return undefined;
		}
	});
}

/** The temporary directories the guard treats as scratch space. */
function defaultTempDirectories(): readonly string[] {
	const fromEnvironment = process.env.TMPDIR;
	const directories = [...SYSTEM_TEMPORARY_DIRECTORIES];
	const resolved = fromEnvironment === undefined || fromEnvironment === "" ? tmpdir() : fromEnvironment;
	if (!directories.includes(resolved)) directories.push(resolved);
	return directories;
}
