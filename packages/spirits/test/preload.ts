/**
 * The environment every test file runs in.
 *
 * The host takes its identity out of the `package.json` beside its executable (official `config.ts`:
 * `APP_NAME = piConfigName || "pi"`), and from that name it derives the variable it reads for the agent
 * directory — `SPIRITS_CODING_AGENT_DIR` under the overlay, `PI_CODING_AGENT_DIR` without one. Every run
 * therefore has a host identity, and without this file the run takes it from the caller: `bun test`
 * started from a running spirits inherits the launcher's `PI_PACKAGE_DIR` (the installed overlay) and
 * reads the agent directory out of `SPIRITS_CODING_AGENT_DIR`, while the same command on a clean CI host
 * resolves the un-overlaid package in `node_modules`, reads `PI_CODING_AGENT_DIR`, and ignores the agent
 * directory every test points at. Three tests changed state with the caller that way (Spirits CI #16).
 *
 * The environment is pinned here, before any test file imports the host:
 *
 * - every `PI_*` and `SPIRITS_*` variable the caller exported is dropped, so a run measures the suite and
 *   not the session that started it;
 * - the identity is given the only way the product gives it: the overlay `package.json` that
 *   `managed-pi/overlay.ts` generates for an extracted artifact, staged as a host package directory and
 *   pointed at with `PI_PACKAGE_DIR`. There is no second identity path for tests;
 * - the agent directory is an empty directory in that staging, so a run neither reads nor writes a
 *   developer's `~/.pi` or `~/.spirits`;
 * - the remaining names are pinned by `computeManagedEnv`, the launcher's own rule.
 *
 * The host is deliberately not imported here: importing it is what computes the identity constants out of
 * the environment, so the environment has to be final first. The staging holds nothing but links into the
 * installed package and two generated files, and it is removed when the run exits.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChildEnv, computeManagedEnv } from "../src/managed-pi/environment.ts";
import { OFFICIAL_PI_HOST } from "../src/managed-pi/host.ts";
import { createOverlayPackageJson } from "../src/managed-pi/overlay.ts";
import { isCallerEnvName } from "./runtime-env.ts";
import { installedHostPackageDir } from "./host/package-dir.ts";

/** Directory prefix of the staged run environment inside the temp directory. */
const STAGING_PREFIX = "spirits-test-run-";

/** Directory name of the agent directory inside the staging. */
const AGENT_DIR_NAME = "agent";

/** File name the host reads its identity from. */
const PACKAGE_JSON_FILE_NAME = "package.json";

/** Remove every caller variable that describes a spirits or pi run instead of this test process. */
function dropCallerRuntimeEnv(): void {
	for (const name of Object.keys(process.env)) {
		if (isCallerEnvName(name)) delete process.env[name];
	}
}

/**
 * A host package directory at `dir`: the installed host package with the product overlay applied.
 *
 * Every entry of the installed package is linked except `package.json`, which is the generated overlay.
 * The links matter because the host resolves more than its identity out of its package directory (its
 * version, themes, docs and examples), and linking `package.json` would write the overlay into the
 * install itself. Removing a staging entry removes the link, never the target.
 */
function stageHostPackage(dir: string): string {
	const installedDir = installedHostPackageDir(OFFICIAL_PI_HOST.packageName);
	mkdirSync(dir, { recursive: true });
	for (const entry of readdirSync(installedDir)) {
		if (entry === PACKAGE_JSON_FILE_NAME) continue;
		symlinkSync(join(installedDir, entry), join(dir, entry));
	}
	const overlay = createOverlayPackageJson(readFileSync(join(installedDir, PACKAGE_JSON_FILE_NAME), "utf8"));
	writeFileSync(join(dir, PACKAGE_JSON_FILE_NAME), overlay.content);
	return dir;
}

const staging = mkdtempSync(join(tmpdir(), STAGING_PREFIX));
process.on("exit", () => rmSync(staging, { recursive: true, force: true }));

dropCallerRuntimeEnv();
const agentDir = join(staging, AGENT_DIR_NAME);
mkdirSync(agentDir, { recursive: true });
const packageDir = stageHostPackage(join(staging, OFFICIAL_PI_HOST.packageDirName));
applyChildEnv(process.env, computeManagedEnv({ env: { ...process.env }, packageDir, agentDir }));
