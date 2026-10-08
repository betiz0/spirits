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

/** Version reported by `spirits --version` for uncompiled runs. */
const UNCOMPILED_SPIRITS_VERSION = "0.0.0-dev";

/** Flags that print the spirits version instead of starting pi. */
const VERSION_FLAGS = new Set(["--version", "-v"]);

/**
 * Injected at build time by `scripts/build-binaries.ts` via `Bun.build` `define`.
 *
 * Uncompiled runs have no such binding; `typeof` keeps the reference safe.
 */
declare const SPIRITS_VERSION: string | undefined;

/** Version embedded at build time, or the development fallback when uncompiled. */
export function resolveSpiritsVersion(): string {
	if (typeof SPIRITS_VERSION === "undefined") {
		return UNCOMPILED_SPIRITS_VERSION;
	}
	return SPIRITS_VERSION;
}

function isCompiledRun(): boolean {
	return typeof SPIRITS_VERSION !== "undefined";
}

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
		console.log(`spirits ${resolveSpiritsVersion()} (Bun ${Bun.version})`);
		process.exit(0);
	}
}

run();
