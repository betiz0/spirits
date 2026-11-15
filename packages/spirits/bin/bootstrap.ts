/**
 * Launcher classification and dispatch.
 *
 * The launcher owns the arguments that are spirits' own (`--version`, `--help`, `update`,
 * `managed-pi`) and starts the verified managed host with everything else. It imports no host code:
 * the host comes from the managed set on disk, so a compiled launcher carries no Pi sources.
 *
 * `runLauncher` returns an exit code instead of calling `process.exit`, so a test drives the same
 * dispatch the entry point does.
 */

import { homedir } from "node:os";
import { classifyManagedPiArgs, type ManagedPiAction } from "../src/managed-pi/classify.ts";
import type { ManagedIo } from "../src/managed-pi/install.ts";
import { hostExecutablePath, OFFICIAL_PI_HOST, type HostDescriptor } from "../src/managed-pi/host.ts";
import { managedCurrentPath, managedRoot } from "../src/managed-pi/layout.ts";
import type { ManagedSpawn } from "../src/managed-pi/launch.ts";
import { classifyHostCommandArgs, classifyUpdateArgs } from "../src/update/classify.ts";
import {
	formatHostCommandRefusalMessage,
	formatUncompiledMessage,
	formatUpdateRefusalMessage,
} from "../src/update/guards.ts";
import { runSelfUpdate, type RunUpdateOptions, type UpdateResult } from "../src/update/run.ts";
import type { FetchLike } from "../src/update/types.ts";
import { checkBunVersion } from "./bun-gate.ts";
import { computeEnvDefaults } from "./env-defaults.ts";
import {
	copyCallerEnv,
	installManagedSetAfterUpdate,
	runDefaultManaged,
	runManagedStartup,
} from "./startup.ts";
import { VERSION_FLAGS, formatVersionLine, isCompiledRun, resolveSpiritsVersion } from "./version.ts";

/** Flags the launcher answers itself, so the host never sees a bare `--help`. */
export const HELP_FLAGS = new Set(["--help", "-h"]);

/** Separator that hands everything after it to the host. */
export const PASSTHROUGH_SEPARATOR = "--";

/** Help the launcher prints for `--help`. The host's own help is behind the separator. */
const SPIRITS_HELP = [
	"spirits - a coding agent that runs on a pinned official Pi host",
	"",
	"Usage:",
	"  spirits <host arguments...>                start the host with the spirits extension",
	"  spirits -- <host arguments...>             same, arguments handed over verbatim",
	"  spirits update [self|pi|--self] [--force]  replace this binary, then the managed set",
	"  spirits managed-pi <command>               manage the pinned host set:",
	"                                               install | update | repair | help",
	"",
	"`spirits --version` prints the spirits version. The host reads its own flags behind the",
	"separator, for example `spirits -- --help`. The host's commands (install, remove, list, config,",
	"auth, mcp, and its own update) are not reachable here: the launcher loads the spirits bundle",
	"first, and the host dispatches a command only from its own first argument. Run them on the host",
	"executable under `~/.spirits/managed-pi/current/`.",
].join("\n");

/** Runs the self-update; the launcher calls {@link runSelfUpdate} unless a test replaced it. */
export type SelfUpdateRunner = (options: RunUpdateOptions) => Promise<UpdateResult>;

/** What the launcher does with one argument list. */
export type LauncherPlan =
	| { kind: "version" }
	| { kind: "help" }
	| { kind: "managed"; action: ManagedPiAction }
	/** Replace the executable. */
	| { kind: "update"; force: boolean }
	/**
	 * An `update` that is not a self-update form: neither self-update nor host launch. The launcher
	 * prints the two commands that do the rest and exits non-zero, because passing the arguments on
	 * would make an unhandled flag look like a succeeded update.
	 */
	| { kind: "update-refusal"; args: string[] }
	/**
	 * A command the host dispatches only from its own first argument. Refusing it is the only option that
	 * neither runs the host command nor starts a model turn the caller did not ask for.
	 */
	| { kind: "host-command-refusal"; word: string; args: string[] }
	/** Hand these arguments to the verified managed host. */
	| { kind: "host"; args: string[] };

/** Arguments the host receives: the launcher's own separator is dropped, nothing else is touched. */
function hostArgs(argv: readonly string[]): string[] {
	return argv[0] === PASSTHROUGH_SEPARATOR ? [...argv.slice(1)] : [...argv];
}

/**
 * Classify one launcher run.
 *
 * The order is the precedence: a spirits flag first, then the `managed-pi` subcommand, then the
 * `update` family (self-update form or refusal), and everything else is a host launch. Because the
 * subcommands are decided here, they never reach the host and never consult the removed fork route.
 *
 * Everything behind the pass-through separator stays a host launch, so host flags and messages reach
 * the host untouched. A host *command* does not: the bundle argument comes first, and the host dispatches
 * `install`, `list`, or `update` only from its own first argument (measured on the pinned host, where
 * `spirits -- update --extensions` reports an unknown option, `spirits -- update` starts a model turn, and
 * `<host> list -e <bundle>` rejects the bundle flag). Both refusals therefore name the host executable.
 */
export function planLauncherArgs(argv: readonly string[], host: HostDescriptor = OFFICIAL_PI_HOST): LauncherPlan {
	const first = argv[0] ?? "";
	if (VERSION_FLAGS.has(first)) return { kind: "version" };
	if (HELP_FLAGS.has(first)) return { kind: "help" };
	const managed = classifyManagedPiArgs(argv);
	if (managed.kind !== "none") return { kind: "managed", action: managed };
	const update = classifyUpdateArgs(argv);
	if (update.kind === "self-update") return { kind: "update", force: update.force };
	if (update.kind === "refusal") return { kind: "update-refusal", args: update.args };
	const command = classifyHostCommandArgs(argv, host.commandWords);
	if (command.kind === "host-command") return { kind: "host-command-refusal", word: command.word, args: command.args };
	return { kind: "host", args: hostArgs(argv) };
}

/** Everything `runLauncher` needs. Each field defaults to the real process; tests replace what they check. */
export interface LauncherRuntime {
	argv: readonly string[];
	/** Environment the launcher applies its defaults to. */
	env: Record<string, string | undefined>;
	home: string;
	root: string;
	/** Version embedded in the running binary. */
	version: string;
	/** True for the compiled launcher; only it knows a release to fetch a set from. */
	compiled: boolean;
	bunVersion: string;
	fetch: FetchLike;
	io: ManagedIo;
	/** Test-only spawn seam forwarded to the host launch. */
	spawn?: ManagedSpawn;
	/** Test-only seam for the self-update, so a test never replaces the running binary. */
	runUpdate?: SelfUpdateRunner;
}

const DEFAULT_IO: ManagedIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

/** Apply the launcher's environment defaults in place, before the host or the update reads them. */
function applyEnvDefaults(env: Record<string, string | undefined>, home: string): void {
	for (const [name, value] of Object.entries(computeEnvDefaults(env, home))) {
		env[name] = value;
	}
}

/**
 * Run one launcher invocation and return the exit code.
 *
 * The caller's environment is copied before the defaults land, so the injected
 * `SPIRITS_CODING_AGENT_DIR` is never read as a selection the user made. Only `update` of the
 * program itself needs a compiled binary; a source run starts the managed host like any other.
 */
export async function runLauncher(runtime: Partial<LauncherRuntime> = {}): Promise<number> {
	const io = runtime.io ?? DEFAULT_IO;
	const env = runtime.env ?? process.env;
	const home = runtime.home ?? homedir();
	const root = runtime.root ?? managedRoot(home);
	const compiled = runtime.compiled ?? isCompiledRun();
	const version = runtime.version ?? resolveSpiritsVersion();
	const fetchImpl = runtime.fetch ?? fetch;
	const argv = runtime.argv ?? process.argv.slice(2);

	const gate = checkBunVersion(runtime.bunVersion ?? Bun.version, compiled);
	if (gate.decision === "reject") {
		io.err(gate.message);
		return gate.exitCode;
	}
	if (gate.decision === "warn") {
		io.err(gate.message);
	}

	const snapshot = copyCallerEnv(env);
	applyEnvDefaults(env, home);

	const plan = planLauncherArgs(argv);
	switch (plan.kind) {
		case "version":
			io.out(formatVersionLine(version, runtime.bunVersion ?? Bun.version));
			return 0;
		case "help":
			io.out(SPIRITS_HELP);
			return 0;
		case "managed":
			return await runManagedStartup({
				snapshot,
				action: plan.action,
				root,
				fetch: fetchImpl,
				home,
				version,
				io,
			});
		case "update-refusal":
			io.err(formatUpdateRefusalMessage(plan.args, `${hostExecutablePath(managedCurrentPath(root))} update`));
			return 1;
		case "host-command-refusal":
			io.err(
				formatHostCommandRefusalMessage(
					plan.word,
					plan.args,
					hostExecutablePath(managedCurrentPath(root)),
				),
			);
			return 1;
		case "update": {
			if (!compiled) {
				io.err(formatUncompiledMessage());
				return 1;
			}
			const update = runtime.runUpdate ?? runSelfUpdate;
			const result = await update({
				force: plan.force,
				env,
				fetch: fetchImpl,
				installedVersion: version,
				execPath: process.execPath,
				compiled,
				platform: process.platform,
				arch: process.arch,
			});
			if (result.exitCode !== 0) return result.exitCode;
			// The managed set follows the binary it belongs to. A failed install reports the repair
			// command and the rollback lines and turns the exit code non-zero, while the binary the
			// update already placed stays in place.
			return await installManagedSetAfterUpdate({
				snapshot,
				root,
				fetch: fetchImpl,
				installedVersion: version,
				io,
				...(result.releaseTag !== undefined ? { releaseTag: result.releaseTag } : {}),
			});
		}
		case "host":
			return await runDefaultManaged({
				snapshot,
				args: plan.args,
				root,
				home,
				version,
				compiled,
				fetch: fetchImpl,
				io,
				...(runtime.spawn ? { spawn: runtime.spawn } : {}),
			});
	}
}
