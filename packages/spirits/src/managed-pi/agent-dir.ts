/**
 * Isolated agent directory for the managed Pi route.
 *
 * The experiment writes to `<managed root>/agent` and to nowhere else. Everything that could point
 * the launch back at the existing `~/.spirits/agent` — an explicit path, a symlink, a containing
 * path, or a Pi option that selects a session or a store — is refused before Pi is spawned, with no
 * fallback to the default route.
 *
 * These are pre-spawn path checks, not an OS security boundary: a concurrent process can still move
 * filesystem entries after a check, and arbitrary file access from tools or extensions is not
 * contained here.
 */

import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	ENV_MANAGED_AGENT_DIR,
	MANAGED_PI_AGENT_DIR_NAME,
	SPIRITS_AGENT_DIR_NAME,
	SPIRITS_CONFIG_DIR_NAME,
} from "../constants.ts";
import { managedSessionDir } from "./environment.ts";

/** Rejection case, shown verbatim so a user can tell which guard stopped the launch. */
export type ManagedAgentRejection =
	| "existing agent directory containment"
	| "symlink in the managed agent path"
	| "outside the managed root"
	| "not a directory"
	| "owned by another user"
	| "explicit agent directory is not the managed agent directory"
	| "unsupported managed-pi argument";

/** Raised before spawn when the isolated agent dir or a launch option would reach outside it. */
export class ManagedAgentGuardError extends Error {
	readonly rejection: ManagedAgentRejection;

	constructor(rejection: ManagedAgentRejection, message: string) {
		super(message);
		this.name = "ManagedAgentGuardError";
		this.rejection = rejection;
	}
}

/** Paths the guards compare against, all resolved from one managed root and one home. */
export interface ManagedAgentPaths {
	/** Canonical managed root that must contain the agent dir. */
	root: string;
	/** Isolated agent dir: `<managed root>/agent`. */
	agentDir: string;
	/** Session dir pinned inside the isolated agent dir. */
	sessionDir: string;
	/** The existing `~/.spirits/agent`, canonical, which the managed route must never use. */
	existingAgentDir: string;
}

/** Caller-side inputs for the resolver. */
export interface ResolveManagedAgentPathsOptions {
	home: string;
	root: string;
	/**
	 * Caller environment taken before the wrapper applies its own defaults. The wrapper default
	 * `~/.spirits/agent` is therefore absent and never mistaken for an explicit selection.
	 */
	env: Readonly<Record<string, string | undefined>>;
}

/** A caller option that can select existing data or a session store outside the isolated area. */
interface GuardedOption {
	name: string;
	alternative: string;
}

/**
 * Pi options that carry a path or select a session outside the isolated store (Decision 5).
 * `--continue`, `--resume`, `--session-id`, and `--no-session` stay bounded by the pinned session
 * dir and are not listed here.
 */
const GUARDED_OPTIONS: readonly GuardedOption[] = [
	{
		name: "--session",
		alternative: "use --session-id <id>, --continue, or --resume, which stay inside the managed session dir",
	},
	{
		name: "--fork",
		alternative: "start a new session; --continue and --resume stay inside the managed session dir",
	},
	{ name: "--session-dir", alternative: "drop the option; the managed session dir is pinned under the managed agent dir" },
	{ name: "--export", alternative: "copy the saved session out of the managed session dir afterwards" },
];

/** Shared tail of every rejection: fixed dir, untouched existing dir, safe start, no fallback. */
function rejectionMessage(
	paths: Pick<ManagedAgentPaths, "agentDir" | "existingAgentDir">,
	rejection: ManagedAgentRejection,
	rejected: string,
	alternative?: string,
): string {
	const lines = [
		`Managed Pi launch refused: ${rejection}.`,
		`Rejected: ${rejected}`,
		`Fixed managed agent directory: ${paths.agentDir}`,
		`The existing agent directory ${paths.existingAgentDir} was not changed.`,
	];
	if (alternative) {
		lines.push(`Safe alternative: ${alternative}`);
	}
	lines.push(
		`Safe start: leave ${ENV_MANAGED_AGENT_DIR} unset (or set it to ${paths.agentDir}), run \`spirits managed-pi install\`, then \`spirits managed-pi\`.`,
		"Existing data stays available through the normal `spirits` command.",
		`To reset the experiment, exit and remove ${paths.agentDir} or the whole managed root; this does not remove ${paths.existingAgentDir}.`,
		"There is no fallback: neither the default spirits route nor a child process was started.",
	);
	return lines.join("\n");
}

function guardError(
	paths: Pick<ManagedAgentPaths, "agentDir" | "existingAgentDir">,
	rejection: ManagedAgentRejection,
	rejected: string,
	alternative?: string,
): ManagedAgentGuardError {
	return new ManagedAgentGuardError(rejection, rejectionMessage(paths, rejection, rejected, alternative));
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** True when `child` is `parent` or below it. Both must be absolute, normalized paths. */
function isWithin(parent: string, child: string): boolean {
	if (parent === child) return true;
	const rel = relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** True when one path equals or contains the other, in either direction. */
function overlaps(first: string, second: string): boolean {
	return isWithin(first, second) || isWithin(second, first);
}

/**
 * Canonical path of `path`: the real path of the deepest existing ancestor plus the remaining
 * components, so a not-yet-created agent dir still resolves deterministically.
 */
async function canonicalPath(path: string): Promise<string> {
	const absolute = resolve(path);
	const missing: string[] = [];
	let current = absolute;
	for (;;) {
		try {
			const existing = await realpath(current);
			return missing.length === 0 ? existing : join(existing, ...missing);
		} catch (error) {
			if (!isMissing(error)) throw error;
			const parent = dirname(current);
			if (parent === current) return absolute;
			missing.unshift(basename(current));
			current = parent;
		}
	}
}

/** Reject a symlinked component at or under the managed root, up to and including `agentDir`. */
async function assertNoSymlinkUnderRoot(paths: ManagedAgentPaths, agentDir: string): Promise<void> {
	const parts = relative(paths.root, agentDir).split(sep).filter((part) => part.length > 0);
	let current = paths.root;
	for (const part of parts) {
		current = join(current, part);
		let info;
		try {
			info = await lstat(current);
		} catch (error) {
			if (isMissing(error)) return;
			throw error;
		}
		if (info.isSymbolicLink()) {
			throw guardError(paths, "symlink in the managed agent path", current);
		}
	}
}

/** An existing entity must be a real directory, owned by the current user where that is exposed. */
async function assertRealAgentDirectory(paths: ManagedAgentPaths): Promise<void> {
	let info;
	try {
		info = await lstat(paths.agentDir);
	} catch (error) {
		if (isMissing(error)) return;
		throw error;
	}
	if (!info.isDirectory()) {
		throw guardError(paths, "not a directory", paths.agentDir);
	}
	if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
		throw guardError(paths, "owned by another user", paths.agentDir);
	}
}

/**
 * Accept an explicit `SPIRITS_CODING_AGENT_DIR` only when it is the fixed isolated agent dir.
 *
 * A relative or tilde value is never resolved against the working directory or the home: the
 * managed route has exactly one experiment area, so anything other than the fixed path is refused.
 * An empty value is not the fixed path either, so it is refused rather than treated as unset.
 */
async function assertExplicitAgentDir(paths: ManagedAgentPaths, explicit: string | undefined): Promise<void> {
	if (explicit === undefined) return;
	const rejection = "explicit agent directory is not the managed agent directory" as const;
	if (!isAbsolute(explicit) || explicit === "~" || explicit.startsWith("~/")) {
		throw guardError(paths, rejection, explicit);
	}
	if ((await canonicalPath(explicit)) !== paths.agentDir) {
		throw guardError(paths, rejection, explicit);
	}
}

/**
 * Resolve the isolated agent dir, then reject anything that could point the launch outside it.
 *
 * Nothing is created here: a rejected path or a rejected explicit value leaves the filesystem
 * unchanged, so the caller creates the directory only after every guard has passed.
 */
export async function resolveManagedAgentPaths(
	options: ResolveManagedAgentPathsOptions,
): Promise<ManagedAgentPaths> {
	const root = await canonicalPath(options.root);
	const agentDir = join(root, MANAGED_PI_AGENT_DIR_NAME);
	const existingAgentDir = await canonicalPath(join(resolve(options.home), SPIRITS_CONFIG_DIR_NAME, SPIRITS_AGENT_DIR_NAME));
	const paths: ManagedAgentPaths = {
		root,
		agentDir,
		sessionDir: managedSessionDir(agentDir),
		existingAgentDir,
	};
	const canonicalAgent = await canonicalPath(agentDir);
	if (overlaps(canonicalAgent, existingAgentDir)) {
		throw guardError(paths, "existing agent directory containment", canonicalAgent);
	}
	if (!isWithin(root, canonicalAgent)) {
		throw guardError(paths, "outside the managed root", canonicalAgent);
	}
	await assertNoSymlinkUnderRoot(paths, agentDir);
	await assertRealAgentDirectory(paths);
	await assertExplicitAgentDir(paths, options.env[ENV_MANAGED_AGENT_DIR]);
	return paths;
}

/** Create the isolated agent dir with owner-only permissions, and only when it is missing. */
export async function ensureManagedAgentDir(paths: ManagedAgentPaths): Promise<void> {
	let info;
	try {
		info = await lstat(paths.agentDir);
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	if (info === undefined) {
		await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
		// `mkdir` masks the mode with the process umask, so pin the owner-only mode explicitly.
		await chmod(paths.agentDir, 0o700);
	}
	await assertNoSymlinkUnderRoot(paths, paths.agentDir);
	await assertRealAgentDirectory(paths);
}

/**
 * Reject a managed launch whose forwarded Pi options can reach existing data or an outside store.
 *
 * The caller's arguments are never rewritten: the option name and a safe alternative are shown and
 * the launch stops.
 */
export function assertManagedLaunchArgs(args: readonly string[], paths: ManagedAgentPaths): void {
	for (const arg of args) {
		const guarded = GUARDED_OPTIONS.find((option) => arg === option.name || arg.startsWith(`${option.name}=`));
		if (!guarded) continue;
		throw guardError(paths, "unsupported managed-pi argument", arg, guarded.alternative);
	}
}
