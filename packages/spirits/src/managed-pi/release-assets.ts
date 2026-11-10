/**
 * The managed set of one spirits release.
 *
 * Every route that needs managed assets reads them from the release the running launcher binary
 * belongs to, never from the newest release. A launcher of version X and the bundle it loads have to
 * come from the same build: taking the newest manifest while an older binary runs pairs a fork-era
 * launcher with a bundle it was never tested against.
 *
 * The caller resolves the tag. `spirits update` knows the release it just installed, the default
 * route knows the version embedded in the binary, and `install.sh` pins the manifest URL of the tag
 * it is installing. This module only fetches, verifies, and places.
 */

import { MANAGED_PI_MANIFEST_ASSET_NAME } from "../constants.ts";
import { releaseArtifactUrl, resolveReleaseBaseUrl } from "../update/release.ts";
import { resolveIdleTimeoutMs } from "../update/timeout.ts";
import type { EnvLike, FetchLike } from "../update/types.ts";
import { fetchManagedJson } from "./artifact.ts";
import { installManagedSet, type ManagedIo, type ManagedInstallResult } from "./install.ts";
import { managedRepairHint } from "./verify.ts";
import { parseManagedManifest, type ManagedManifest } from "./manifest.ts";

/** Options for fetching the managed set of one release. */
export interface ManagedReleaseAssetOptions {
	root: string;
	/** Release tag, e.g. `spirits-v0.7.0`. */
	tag: string;
	env: EnvLike;
	fetch: FetchLike;
	timeoutMs?: number;
	io?: ManagedIo;
}

/** Fetch and validate the manifest of one release, with the base URL its assets resolve against. */
export async function fetchManagedManifestOfRelease(options: {
	tag: string;
	env: EnvLike;
	fetch: FetchLike;
	timeoutMs: number;
}): Promise<{ manifest: ManagedManifest; baseUrl: string; url: string }> {
	const url = releaseArtifactUrl(options.tag, MANAGED_PI_MANIFEST_ASSET_NAME, resolveReleaseBaseUrl(options.env));
	const manifest = parseManagedManifest(await fetchManagedJson(options.fetch, url, options.timeoutMs));
	return { manifest, baseUrl: new URL(".", url).toString(), url };
}

/**
 * Install the managed set of one release. Throws on any fetch or verification failure.
 *
 * The set lands under the managed root like `spirits managed-pi install` does; nothing in the
 * install directory or the agent directory is touched.
 */
export async function installManagedSetFromRelease(
	options: ManagedReleaseAssetOptions,
): Promise<ManagedInstallResult> {
	const timeoutMs = options.timeoutMs ?? resolveIdleTimeoutMs(options.env);
	const source = await fetchManagedManifestOfRelease({
		tag: options.tag,
		env: options.env,
		fetch: options.fetch,
		timeoutMs,
	});
	return await installManagedSet({
		root: options.root,
		manifest: source.manifest,
		baseUrl: source.baseUrl,
		fetch: options.fetch,
		env: options.env,
		timeoutMs,
		io: options.io,
	});
}

/**
 * Install the managed set of one release and turn failures into the user-visible refusal.
 *
 * Returns the exit code only: the caller decides whether a missing managed set is fatal (the default
 * route) or reported after a successful binary update (`spirits update`).
 */
export async function runManagedInstallFromRelease(
	options: ManagedReleaseAssetOptions,
): Promise<{ ok: boolean; exitCode: number }> {
	const io = options.io ?? { out: (line) => console.log(line), err: (line) => console.error(line) };
	try {
		await installManagedSetFromRelease(options);
		return { ok: true, exitCode: 0 };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		io.err(managedRepairHint(`Could not install the managed Pi set of ${options.tag}: ${reason}`));
		return { ok: false, exitCode: 1 };
	}
}
