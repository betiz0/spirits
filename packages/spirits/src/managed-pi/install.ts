/**
 * Install one verified managed set.
 *
 * Everything is downloaded into a temporary directory under the managed root. All checksums,
 * the overlay, and the extracted executable are verified before the directory is moved into
 * `releases/` and `current` is switched. A failure removes only the temporary directory and
 * never touches the default `~/.spirits/bin` or `~/.spirits/agent`.
 */

import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MANAGED_PI_SET_EXTENSION_NAME, MANAGED_PI_SET_MANIFEST_NAME } from "../constants.ts";
import { guardTempDir } from "../update/cleanup.ts";
import { resolveIdleTimeoutMs } from "../update/timeout.ts";
import type { EnvLike, FetchLike } from "../update/types.ts";
import { downloadManagedArtifact, resolveManagedArtifactUrl } from "./artifact.ts";
import {
	commitReleaseDir,
	managedTempDir,
	prepareManagedRoot,
	switchCurrent,
} from "./layout.ts";
import { hostExecutablePath, hostPackageDir, OFFICIAL_PI_HOST, type HostDescriptor } from "./host.ts";
import type { ManagedManifest } from "./manifest.ts";
import { writeOverlayPackage } from "./overlay.ts";
import { writeInstalledStateForSet } from "./verify.ts";

/** Output sinks; tests collect lines instead of touching stdout. */
export interface ManagedIo {
	out(line: string): void;
	err(line: string): void;
}

/** Options for installing a managed set. */
export interface InstallManagedSetOptions {
	root: string;
	manifest: ManagedManifest;
	fetch: FetchLike;
	env?: EnvLike;
	timeoutMs?: number;
	/** Base URL for relative manifest artifact URLs. */
	baseUrl?: string;
	io?: ManagedIo;
	/** Host the set installs. Defaults to the official Pi. */
	host?: HostDescriptor;
}

/** Result of an install or update attempt. */
export interface ManagedInstallResult {
	ok: boolean;
	setId: string;
	exitCode: number;
}

const DEFAULT_IO: ManagedIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

/** Name the host artifact is stored under inside the temporary directory. */
const HOST_ARCHIVE_NAME = "pi.tar.gz";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Extract a `.tar.gz` into `destination` with the system tar implementation. */
export async function extractTarGz(archivePath: string, destination: string): Promise<void> {
	await mkdir(destination, { recursive: true });
	const result = Bun.spawnSync({
		cmd: ["tar", "-xzf", archivePath, "-C", destination],
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(`Could not extract ${archivePath}: ${result.stderr.toString().trim()}`);
	}
}

/**
 * Store artifact URLs resolved against the release base URL.
 *
 * A release manifest names its assets relatively (the release directory is implied by the manifest
 * URL), but `repair` re-installs from the *stored* manifest alone, with no release URL in hand.
 * Writing the resolved absolute URLs at install time is what keeps `repair` able to fetch the same
 * set the release shipped; the checksums are untouched.
 */
function withResolvedArtifactUrls(manifest: ManagedManifest, baseUrl: string | undefined): ManagedManifest {
	if (baseUrl === undefined) return manifest;
	const resolve = (artifact: { url: string; sha256: string }): { url: string; sha256: string } => ({
		url: resolveManagedArtifactUrl(artifact.url, baseUrl),
		sha256: artifact.sha256,
	});
	return {
		...manifest,
		pi: { ...manifest.pi, artifact: resolve(manifest.pi.artifact) },
		extension: { ...manifest.extension, artifact: resolve(manifest.extension.artifact) },
		assets: manifest.assets.map((asset) => ({ ...asset, url: resolveManagedArtifactUrl(asset.url, baseUrl) })),
	};
}

function assertAssetName(name: string): void {
	if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
		throw new Error(`Unsafe managed asset name: ${name}`);
	}
}

/** Perform an install. Throws on any verification or placement failure. */
export async function installManagedSet(options: InstallManagedSetOptions): Promise<ManagedInstallResult> {
	const io = options.io ?? DEFAULT_IO;
	const timeoutMs = options.timeoutMs ?? resolveIdleTimeoutMs(options.env ?? process.env);
	const host = options.host ?? OFFICIAL_PI_HOST;
	const setId = options.manifest.setId;
	await prepareManagedRoot(options.root);
	const tempDir = managedTempDir(options.root);
	await rm(tempDir, { recursive: true, force: true });
	const guard = guardTempDir(tempDir);
	try {
		await mkdir(tempDir, { recursive: true });
		const archivePath = join(tempDir, HOST_ARCHIVE_NAME);
		await downloadManagedArtifact({
			fetch: options.fetch,
			artifact: options.manifest.pi.artifact,
			destinationPath: archivePath,
			baseUrl: options.baseUrl,
			timeoutMs,
		});
		await extractTarGz(archivePath, tempDir);
		await chmod(hostExecutablePath(tempDir, host), 0o755);

		await writeOverlayPackage(hostPackageDir(tempDir, host), options.manifest.overlay.sha256, host);

		const extensionPath = join(tempDir, MANAGED_PI_SET_EXTENSION_NAME);
		await downloadManagedArtifact({
			fetch: options.fetch,
			artifact: options.manifest.extension.artifact,
			destinationPath: extensionPath,
			baseUrl: options.baseUrl,
			timeoutMs,
		});
		await chmod(extensionPath, 0o644);

		for (const asset of options.manifest.assets) {
			assertAssetName(asset.name);
			await downloadManagedArtifact({
				fetch: options.fetch,
				artifact: asset,
				destinationPath: join(tempDir, asset.name),
				baseUrl: options.baseUrl,
				timeoutMs,
			});
		}

		const stored = withResolvedArtifactUrls(options.manifest, options.baseUrl);
		await Bun.write(join(tempDir, MANAGED_PI_SET_MANIFEST_NAME), `${JSON.stringify(stored, null, "\t")}\n`);
		await writeInstalledStateForSet(tempDir, options.manifest, host);
		await commitReleaseDir(options.root, setId, tempDir);
		await switchCurrent(options.root, setId);
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	} finally {
		guard.dispose();
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}

	io.out(
		`Installed managed Pi ${options.manifest.pi.version} with spirits extension ${options.manifest.extension.version}.`,
	);
	io.out(`Managed root: ${options.root}`);
	return { ok: true, setId, exitCode: 0 };
}

/** Install while turning failures into the managed route's user-visible message. */
export async function runInstallManagedSet(options: InstallManagedSetOptions): Promise<ManagedInstallResult> {
	const io = options.io ?? DEFAULT_IO;
	try {
		return await installManagedSet({ ...options, io });
	} catch (error) {
		io.err(`Managed Pi install failed: ${errorMessage(error)}`);
		return { ok: false, setId: options.manifest.setId, exitCode: 1 };
	}
}

