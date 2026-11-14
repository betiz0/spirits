/**
 * Self-update orchestration.
 *
 * The launcher intercepts the self-update forms of `update` and calls `runSelfUpdate`. The function
 * resolves the latest stable release, decides whether to replace, downloads and verifies the
 * executable, and places it atomically. Nothing else is fetched: the host and the spirits extension
 * bundle come from the managed set, which the launcher installs from the release this run reports.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RELEASE_ARTIFACT_NAME, UPDATE_TEMP_DIR_PREFIX } from "../constants.ts";
import { applyVerifiedBinary } from "./apply.ts";
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
import {
	releaseArtifactUrl,
	releaseTagForVersion,
	resolveLatestStableRelease,
	resolveReleaseBaseUrl,
} from "./release.ts";
import { resolveIdleTimeoutMs } from "./timeout.ts";
import type { EnvLike, FetchLike } from "./types.ts";
import { decideUpdate } from "./version.ts";

/** Written output sinks; tests collect lines instead of touching stdout. */
export interface UpdateIo {
	out(line: string): void;
	err(line: string): void;
}

/** Options accepted by `runSelfUpdate`. */
export interface RunUpdateOptions {
	/** `--force` re-downloads even when the installed version matches. */
	force: boolean;
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
}

/** Outcome of `runSelfUpdate`. */
export interface UpdateResult {
	exitCode: number;
	replaced: boolean;
	/**
	 * Release the launcher binary that will run after this call belongs to, e.g. `spirits-v0.7.0`.
	 *
	 * The caller uses it as the source of the managed set, so the set always matches the binary rather
	 * than the newest release: after a replacement that is the release just installed, on the no-op
	 * paths it is the installed version's own release. `undefined` when no release was resolved (a
	 * refusal or a resolution failure), because then nothing was decided.
	 */
	releaseTag?: string;
}

/** Default output sinks: stderr for refusals and failures, stdout for results. */
const DEFAULT_IO: UpdateIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

/**
 * Update the installed binary.
 *
 * Returns the process exit code. Refusals and failures print to stderr and never touch the installed
 * binary.
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
	if (decision === "up-to-date") {
		io.out(`spirits ${options.installedVersion} is already up to date`);
		return { exitCode: 0, replaced: false, releaseTag: release.tag };
	}
	if (decision === "newer") {
		io.out(
			`spirits ${options.installedVersion} is newer than the latest stable release (${release.version})`,
		);
		return {
			exitCode: 0,
			replaced: false,
			// The running binary stays on its own (newer, usually prerelease) release, so the managed
			// set is taken from that tag rather than from the older stable release.
			releaseTag: releaseTagForVersion(options.installedVersion),
		};
	}

	const tempDir = await createTempDir(installDir, io);
	if (tempDir === undefined) return { exitCode: 1, replaced: false };
	const guard = guardTempDir(tempDir);
	try {
		const binaryUrl = releaseArtifactUrl(release.tag, RELEASE_ARTIFACT_NAME, resolveReleaseBaseUrl(options.env));
		await downloadVerifiedArtifact({
			fetch: options.fetch,
			artifactUrl: binaryUrl,
			checksumUrl: `${binaryUrl}.sha256`,
			destinationPath: join(tempDir, RELEASE_ARTIFACT_NAME),
			timeoutMs,
		});
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
	return { exitCode: 0, replaced: true, releaseTag: release.tag };
}
