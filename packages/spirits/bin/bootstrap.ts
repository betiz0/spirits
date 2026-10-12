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
import { classifyUpdateArgs, type UpdateClassification } from "../src/update/classify.ts";
import { formatUncompiledMessage } from "../src/update/guards.ts";
import { runSelfUpdate } from "../src/update/run.ts";
import { checkBunVersion } from "./bun-gate.ts";
import { computeEnvDefaults } from "./env-defaults.ts";
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

/** Run the synchronous pre-pi startup and classify the CLI arguments. */
function run(): UpdateClassification {
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
	const classification = classifyUpdateArgs(process.argv.slice(2));
	if (!isCompiledRun() && classification.target !== "pass-through") {
		console.error(formatUncompiledMessage());
		process.exit(1);
	}
	return classification;
}

const classification = run();

// Everything else (help, extensions-only update, invalid combinations) falls through to pi.
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
	process.exit(result.exitCode);
}
