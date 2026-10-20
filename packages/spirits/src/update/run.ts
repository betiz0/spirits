/**
 * Self-update orchestration.
 *
 * The CLI entry intercepts `update` and calls `runSelfUpdate`. The function resolves the latest
 * stable release, decides whether to replace, downloads and verifies the artifact, and places it
 * atomically. For the `all` target it then runs `update --extensions` with the new binary.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RELEASE_ARTIFACT_NAME, THEME_ASSET_NAMES, UPDATE_TEMP_DIR_PREFIX } from "../constants.ts";
import { applyVerifiedBinary, applyVerifiedThemeAssets, type ThemeAssetPlacement } from "./apply.ts";
import { cleanStaleTempDirs, guardTempDir } from "./cleanup.ts";
import { downloadVerifiedArtifact } from "./download.ts";
import {
	checkRuntimeSupport,
	formatFailureMessage,
	formatOfflineMessage,
	formatNotWritableMessage,
	isDirectoryWritable,
	isOfflineEnv,
} from "./guards.ts";
import { releaseArtifactUrl, resolveLatestStableRelease, resolveReleaseBaseUrl, type SpiritsRelease } from "./release.ts";
import { hasThemeAssets, themeAssetPath, themeDirFor } from "./theme.ts";
import { resolveIdleTimeoutMs } from "./timeout.ts";
import type { EnvLike, FetchLike } from "./types.ts";
import { decideUpdate } from "./version.ts";

/** Written output sinks; tests collect lines instead of touching stdout. */
export interface UpdateIo {
	out(line: string): void;
	err(line: string): void;
}

/** Spawn request for the extension update that follows a successful `all` self-update. */
export interface ExtensionUpdateRequest {
	command: string[];
	cwd: string;
}

/** Runs the extension update and resolves with its exit code. */
export type SpawnExtensionUpdate = (request: ExtensionUpdateRequest) => Promise<number>;

/** Options accepted by `runSelfUpdate`. */
export interface RunUpdateOptions {
	/** pi's update target: `self` replaces the binary, `all` also updates extensions. */
	kind: "self" | "all";
	force: boolean;
	/** Original `-a` / `--approve` / `-na` / `--no-approve` token, forwarded to the extension update. */
	trustFlag?: string;
	env: EnvLike;
	fetch: FetchLike;
	/** Version currently installed. */
	installedVersion: string;
	/** Absolute path of the running executable; the replacement target. */
	execPath: string;
	compiled: boolean;
	platform: string;
	arch: string;
	io?: UpdateIo;
	spawnExtensionUpdate?: SpawnExtensionUpdate;
}

/** Outcome of `runSelfUpdate`. */
export interface UpdateResult {
	exitCode: number;
	replaced: boolean;
}

/** Default output sinks: stderr for refusals and failures, stdout for results. */
const DEFAULT_IO: UpdateIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Run the installed binary with `update --extensions`, inheriting stdio. */
async function spawnExtensionUpdate(request: ExtensionUpdateRequest): Promise<number> {
	const child = Bun.spawn(request.command, {
		cwd: request.cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await child.exited;
}

async function runExtensionUpdate(
	options: RunUpdateOptions,
	io: UpdateIo,
): Promise<number> {
	if (options.kind !== "all") return 0;
	const command = [options.execPath, "update", "--extensions"];
	if (options.trustFlag !== undefined) {
		command.push(options.trustFlag);
	}
	const spawn = options.spawnExtensionUpdate ?? spawnExtensionUpdate;
	try {
		return await spawn({ command, cwd: process.cwd() });
	} catch (error) {
		io.err(`Failed to run the extension update: ${errorMessage(error)}`);
		return 1;
	}
}

/** Create this run's temporary directory; `undefined` after reporting the failure. */
async function createTempDir(installDir: string, io: UpdateIo): Promise<string | undefined> {
	const tempDir = join(installDir, `${UPDATE_TEMP_DIR_PREFIX}${process.pid}`);
	try {
		await mkdir(tempDir, { recursive: true });
	} catch (error) {
		io.err(formatFailureMessage(`Could not create the temporary directory: ${errorMessage(error)}`));
		return undefined;
	}
	return tempDir;
}

/** Download and verify every built-in theme asset into `tempDir`. */
async function downloadThemeAssets(options: {
	fetch: FetchLike;
	tempDir: string;
	release: SpiritsRelease;
	releaseBaseUrl: string;
	timeoutMs: number;
}): Promise<ThemeAssetPlacement[]> {
	const assets: ThemeAssetPlacement[] = [];
	for (const assetName of THEME_ASSET_NAMES) {
		const url = releaseArtifactUrl(options.release.tag, assetName, options.releaseBaseUrl);
		const downloadedPath = themeAssetPath(options.tempDir, assetName);
		await downloadVerifiedArtifact({
			fetch: options.fetch,
			artifactUrl: url,
			checksumUrl: `${url}.sha256`,
			destinationPath: downloadedPath,
			timeoutMs: options.timeoutMs,
		});
		assets.push({ downloadedPath, assetName });
	}
	return assets;
}

/** Repair missing theme assets on the current version without touching the binary. */
async function repairThemeAssets(options: {
	run: RunUpdateOptions;
	io: UpdateIo;
	release: SpiritsRelease;
	themeDir: string;
	timeoutMs: number;
}): Promise<UpdateResult> {
	const tempDir = await createTempDir(dirname(options.run.execPath), options.io);
	if (tempDir === undefined) return { exitCode: 1, replaced: false };
	const guard = guardTempDir(tempDir);
	try {
		const assets = await downloadThemeAssets({
			fetch: options.run.fetch,
			tempDir,
			release: options.release,
			releaseBaseUrl: resolveReleaseBaseUrl(options.run.env),
			timeoutMs: options.timeoutMs,
		});
		await applyVerifiedThemeAssets({ themeDir: options.themeDir, assets });
	} catch (error) {
		options.io.err(formatFailureMessage(`Update failed: ${errorMessage(error)}`));
		return { exitCode: 1, replaced: false };
	} finally {
		guard.dispose();
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
	options.io.out(`spirits ${options.run.installedVersion} is already up to date; repaired the missing theme assets`);
	return { exitCode: await runExtensionUpdate(options.run, options.io), replaced: false };
}

/**
 * Update the installed binary, then optionally update extensions.
 *
 * Returns the process exit code. Refusals and failures print to stderr and never touch the
 * installed binary. `all` spawns the extension update only after a zero self-update result
 * (including the no-op cases).
 */
export async function runSelfUpdate(options: RunUpdateOptions): Promise<UpdateResult> {
	const io = options.io ?? DEFAULT_IO;

	const runtimeSupport = checkRuntimeSupport({
		compiled: options.compiled,
		platform: options.platform,
		arch: options.arch,
	});
	if (!runtimeSupport.ok) {
		io.err(runtimeSupport.message);
		return { exitCode: 1, replaced: false };
	}

	if (isOfflineEnv(options.env)) {
		io.err(formatOfflineMessage());
		return { exitCode: 1, replaced: false };
	}

	// The pre-check is the fast path; creating the temporary directory below is the authoritative
	// check because root may pass `access(W_OK)` on a directory it cannot really write.
	const installDir = dirname(options.execPath);
	if (!(await isDirectoryWritable(installDir))) {
		io.err(formatNotWritableMessage(installDir));
		return { exitCode: 1, replaced: false };
	}

	// Every refusal guard passed: clean leftovers from earlier updates and installers before
	// touching the network, so the no-op paths and resolution failures clean up as well.
	await cleanStaleTempDirs(installDir);

	const timeoutMs = resolveIdleTimeoutMs(options.env);
	let release: Awaited<ReturnType<typeof resolveLatestStableRelease>>;
	try {
		release = await resolveLatestStableRelease({ env: options.env, fetch: options.fetch, timeoutMs });
	} catch (error) {
		io.err(formatFailureMessage(`Could not resolve the latest release: ${errorMessage(error)}`));
		return { exitCode: 1, replaced: false };
	}

	const decision = decideUpdate(options.installedVersion, release.version, options.force);
	const themeDir = themeDirFor(options.execPath);
	if (decision === "up-to-date") {
		if (await hasThemeAssets(themeDir)) {
			io.out(`spirits ${options.installedVersion} is already up to date`);
			return { exitCode: await runExtensionUpdate(options, io), replaced: false };
		}
		return repairThemeAssets({ run: options, io, release, themeDir, timeoutMs });
	}
	if (decision === "newer") {
		io.out(
			`spirits ${options.installedVersion} is newer than the latest stable release (${release.version})`,
		);
		return { exitCode: await runExtensionUpdate(options, io), replaced: false };
	}

	const tempDir = await createTempDir(installDir, io);
	if (tempDir === undefined) return { exitCode: 1, replaced: false };
	const guard = guardTempDir(tempDir);
	try {
		const releaseBaseUrl = resolveReleaseBaseUrl(options.env);
		const binaryUrl = releaseArtifactUrl(release.tag, RELEASE_ARTIFACT_NAME, releaseBaseUrl);
		await downloadVerifiedArtifact({
			fetch: options.fetch,
			artifactUrl: binaryUrl,
			checksumUrl: `${binaryUrl}.sha256`,
			destinationPath: join(tempDir, RELEASE_ARTIFACT_NAME),
			timeoutMs,
		});
		// Themes first, binary last: a placement failure leaves the installed executable in place.
		const assets = await downloadThemeAssets({
			fetch: options.fetch,
			tempDir,
			release,
			releaseBaseUrl,
			timeoutMs,
		});
		await applyVerifiedThemeAssets({ themeDir, assets });
		await applyVerifiedBinary({
			tempDir,
			downloadedPath: join(tempDir, RELEASE_ARTIFACT_NAME),
			targetPath: options.execPath,
		});
	} catch (error) {
		io.err(formatFailureMessage(`Update failed: ${errorMessage(error)}`));
		return { exitCode: 1, replaced: false };
	} finally {
		guard.dispose();
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}

	io.out(`Updated spirits from ${options.installedVersion} to ${release.version}`);
	return { exitCode: await runExtensionUpdate(options, io), replaced: true };
}
