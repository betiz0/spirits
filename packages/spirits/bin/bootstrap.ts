/**
 * First module evaluated by `spirits.ts`.
 *
 * Applies the Bun version gate, environment defaults, and `--version` / `-v` handling before pi
 * (and its runtime setup) is imported, so the gate message is not mixed with pi output and the
 * agent directory is in place before pi reads it.
 *
 * It also intercepts the `update` invocations that target the program itself. The uncompiled
 * rejection happens before the first `await`, so a source run never loads pi.
 */

import { homedir } from "node:os";
import { SPIRITS_APP_NAME } from "../src/constants.ts";
import { classifyManagedPiArgs, type ManagedPiAction } from "../src/managed-pi/classify.ts";
import { managedRoot } from "../src/managed-pi/layout.ts";
import { classifyUpdateArgs, type UpdateClassification } from "../src/update/classify.ts";
import { formatUncompiledMessage } from "../src/update/guards.ts";
import { runSelfUpdate } from "../src/update/run.ts";
import { checkBunVersion } from "./bun-gate.ts";
import { computeEnvDefaults } from "./env-defaults.ts";
import {
	chooseStartupRoute,
	copyCallerEnv,
	installManagedSetAfterUpdate,
	runDefaultManaged,
	runManagedStartup,
} from "./startup.ts";
import { VERSION_FLAGS, formatVersionLine, isCompiledRun, resolveSpiritsVersion } from "./version.ts";

function applyEnvDefaults(): void {
	// Must run before pi resolves APP_NAME so `SPIRITS_CODING_AGENT_DIR` and the other derived names
	// match the env defaults computed below.
	process.env.PI_APP_NAME = SPIRITS_APP_NAME;
	const defaults = computeEnvDefaults(process.env, homedir());
	for (const [name, value] of Object.entries(defaults)) {
		process.env[name] = value;
	}
}

/** One run's classification of the explicit routes. */
interface StartupClassification {
	update: UpdateClassification;
	managed: ManagedPiAction;
}

/** Run the synchronous pre-pi startup and classify the CLI arguments. */
function run(): StartupClassification {
	const gate = checkBunVersion(Bun.version, isCompiledRun());
	if (gate.decision === "reject") {
		console.error(gate.message);
		process.exit(gate.exitCode);
	}
	if (gate.decision === "warn") {
		console.error(gate.message);
	}
	applyEnvDefaults();
	if (VERSION_FLAGS.has(process.argv[2] ?? "")) {
		console.log(formatVersionLine(resolveSpiritsVersion(), Bun.version));
		process.exit(0);
	}
	const update = classifyUpdateArgs(process.argv.slice(2));
	const managed = classifyManagedPiArgs(process.argv.slice(2));
	if (!isCompiledRun() && (update.target !== "pass-through" || managed.kind !== "none")) {
		console.error(formatUncompiledMessage());
		process.exit(1);
	}
	return { update, managed };
}

// Taken before `run()` applies the normal route's defaults, so the wrapper's own
// `SPIRITS_CODING_AGENT_DIR` injection is never read as an explicit managed selection. The normal
// route keeps using the defaulted `process.env`; only this copy reaches the managed command.
const snapshotEnv = copyCallerEnv(process.env);

const { update: classification, managed } = run();

// The explicit experimental route is handled before pi is imported. Its launch form never falls
// through to the default compiled spirits path.
if (managed.kind !== "none") {
	const exitCode = await runManagedStartup({
		snapshot: snapshotEnv,
		action: managed,
		root: managedRoot(homedir()),
		fetch,
		home: homedir(),
	});
	process.exit(exitCode);
}

// Everything except `update` of the program itself falls through to the route selection below.
const target = classification.target;
if (isCompiledRun() && target !== "pass-through") {
	const result = await runSelfUpdate({
		kind: target,
		force: classification.force,
		trustFlag: classification.trustFlag,
		env: process.env,
		fetch,
		installedVersion: resolveSpiritsVersion(),
		execPath: process.execPath,
		compiled: isCompiledRun(),
		platform: process.platform,
		arch: process.arch,
	});
	if (result.exitCode !== 0) {
		process.exit(result.exitCode);
	}
	// The managed set follows the binary it belongs to. A failed managed install reports the repair
	// command and the fork escape hatch and turns the exit code non-zero, while the binary the update
	// already placed stays in place.
	const managedExitCode = await installManagedSetAfterUpdate({
		snapshot: snapshotEnv,
		root: managedRoot(homedir()),
		fetch,
		installedVersion: resolveSpiritsVersion(),
		...(result.releaseTag !== undefined ? { releaseTag: result.releaseTag } : {}),
	});
	process.exit(managedExitCode);
}

// The default route starts managed and never imports the fork's pi. `SPIRITS_ROUTE=fork`, and any
// source run, keep the path below.
if (chooseStartupRoute(snapshotEnv, isCompiledRun()) === "managed") {
	const exitCode = await runDefaultManaged({
		snapshot: snapshotEnv,
		args: process.argv.slice(2),
		root: managedRoot(homedir()),
		home: homedir(),
		version: resolveSpiritsVersion(),
		fetch,
	});
	process.exit(exitCode);
}
