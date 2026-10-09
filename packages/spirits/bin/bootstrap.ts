/**
 * First module evaluated by `spirits.ts`.
 *
 * Applies the Bun version gate, environment defaults, and `--version` / `-v` handling before pi
 * (and its runtime setup) is imported, so the gate message is not mixed with pi output and the
 * agent directory is in place before pi reads it.
 */

import { homedir } from "node:os";
import { checkBunVersion } from "./bun-gate.ts";
import { computeEnvDefaults } from "./env-defaults.ts";
import { VERSION_FLAGS, formatVersionLine, isCompiledRun, resolveSpiritsVersion } from "./version.ts";

function applyEnvDefaults(): void {
	const defaults = computeEnvDefaults(process.env, homedir());
	for (const [name, value] of Object.entries(defaults)) {
		process.env[name] = value;
	}
}

function run(): void {
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
}

run();
