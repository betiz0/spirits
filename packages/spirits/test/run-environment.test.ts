/**
 * The environment the run gave itself.
 *
 * The host takes its identity out of the `package.json` at its package directory and derives from that
 * name the variable it reads for the agent directory (`test/preload.ts`). Three tests measured the caller
 * instead of the code before that pinning existed: from a running spirits the host read
 * `SPIRITS_CODING_AGENT_DIR`, while a clean CI host read `PI_CODING_AGENT_DIR` and ignored the agent
 * directory each test pointed at (Spirits CI #16). These are the assertions for the pinning itself, so a
 * regression fails here naming the cause instead of showing up somewhere else as a mystery.
 */

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { ENV_AGENT_DIR, ENV_PACKAGE_DIR, SPIRITS_APP_NAME } from "../src/constants.ts";
import { computeManagedEnv } from "../src/managed-pi/environment.ts";
import { OFFICIAL_PI_HOST } from "../src/managed-pi/host.ts";
import { INERT_ENV_NAMES } from "./runtime-env.ts";
import { installedHostPackageDir } from "./host/package-dir.ts";

/** A path only this file names, to ask the host which variable it reads for the agent directory. */
const AGENT_DIR_PROBE = join(tmpdir(), "spirits-run-identity-probe");

/** The `package.json` the host reads its identity out of. */
function hostManifest(): { name?: unknown; piConfig?: { name?: unknown } } {
	return JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8")) as {
		name?: unknown;
		piConfig?: { name?: unknown };
	};
}

/** Restore an environment variable to the value it held before the probe replaced it. */
function withEnv<T>(name: string, value: string, run: () => T): T {
	const previous = process.env[name];
	process.env[name] = value;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
}

test("the host identity is the product overlay, staged outside the install", () => {
	const manifest = hostManifest();
	// `piConfig.name` is the field the product overlay writes and the only field the host reads for it.
	expect(manifest.piConfig?.name).toBe(SPIRITS_APP_NAME);
	// The overlay keeps the upstream name, so the staged package still says which host it came from.
	expect(manifest.name).toBe(OFFICIAL_PI_HOST.packageName);
	// The run stages the identity instead of reading `node_modules`, so an un-overlaid install cannot
	// decide a result and nothing here writes an overlay into an installed package.
	expect(resolve(getPackageDir())).not.toBe(resolve(installedHostPackageDir(OFFICIAL_PI_HOST.packageName)));
});

test("the host reads the agent directory out of the spirits variable", () => {
	// The CI failure was `getAgentDir()` answering `$HOME/.pi/agent`: without the identity the host
	// reads `PI_CODING_AGENT_DIR`, so the directory a test pointed at was ignored.
	withEnv(ENV_AGENT_DIR, AGENT_DIR_PROBE, () => {
		expect(getAgentDir()).toBe(AGENT_DIR_PROBE);
	});
});

test("the agent directory belongs to the run, not to a home directory", () => {
	expect(process.env[ENV_AGENT_DIR]).toBe(getAgentDir());
	expect(existsSync(getAgentDir())).toBe(true);
	// A default of `$HOME/.pi/agent` or `$HOME/.spirits/agent` would read a developer's settings and
	// skills into the run, so the agent directory has to be the one the preload staged.
	expect(resolve(getAgentDir()).startsWith(resolve(tmpdir()))).toBe(true);
});

test("no caller value survives in a spirits or pi variable", () => {
	// Storage and app-name names the host descriptor removes, the session directory the launcher alone
	// decides, and the session facts a running host injects. A test that needs one sets it and restores
	// it, so a value here came from the caller or from a test that did not clean up.
	for (const name of INERT_ENV_NAMES) {
		expect(process.env[name], name).toBeUndefined();
	}
});

test("the environment already satisfies the launcher's own rule", () => {
	// One rule for the product and the run: `computeManagedEnv` decides the pinned names, the removed
	// names, and the host's own update check and telemetry. A difference means the run is describing its
	// caller again, or the preload invented values the launcher would not have produced.
	const pinned = computeManagedEnv({ env: { ...process.env }, packageDir: getPackageDir(), agentDir: getAgentDir() });
	const differences = Object.entries(pinned).filter(([name, value]) => process.env[name] !== value);
	expect(differences).toEqual([]);
	expect(process.env[ENV_PACKAGE_DIR]).toBe(getPackageDir());
});
