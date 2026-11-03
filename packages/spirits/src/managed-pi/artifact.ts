/**
 * Artifact resolution and verified downloads for the managed route.
 *
 * A manifest can carry absolute URLs or paths relative to a release base URL. The streamed hash
 * and partial-file cleanup are shared with self-update through `downloadArtifactWithDigest`.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { downloadArtifactWithDigest } from "../update/download.ts";
import { fetchWithIdleTimeout } from "../update/timeout.ts";
import type { FetchLike } from "../update/types.ts";
import type { ManagedArtifact } from "./manifest.ts";

/** Resolve a manifest URL against an optional release base URL. */
export function resolveManagedArtifactUrl(url: string, baseUrl?: string): string {
	try {
		return new URL(url).toString();
	} catch {
		if (!baseUrl) {
			throw new Error(`Artifact URL is relative and no release base URL was provided: ${url}`);
		}
		return new URL(url, `${baseUrl.replace(/\/$/, "")}/`).toString();
	}
}

/** Options for downloading one manifest artifact. */
export interface DownloadManagedArtifactOptions {
	fetch: FetchLike;
	artifact: ManagedArtifact;
	destinationPath: string;
	baseUrl?: string;
	timeoutMs: number;
}

/** Download and verify one artifact. The destination's parent must already exist. */
export async function downloadManagedArtifact(options: DownloadManagedArtifactOptions): Promise<void> {
	await mkdir(dirname(options.destinationPath), { recursive: true });
	await downloadArtifactWithDigest({
		fetch: options.fetch,
		artifactUrl: resolveManagedArtifactUrl(options.artifact.url, options.baseUrl),
		expectedSha256: options.artifact.sha256,
		destinationPath: options.destinationPath,
		timeoutMs: options.timeoutMs,
	});
}

/** Fetch a JSON document such as the manifest, with the same idle timeout as downloads. */
export async function fetchManagedJson(
	fetchImpl: FetchLike,
	url: string,
	timeoutMs: number,
): Promise<unknown> {
	const response = await fetchWithIdleTimeout(fetchImpl, url, {}, timeoutMs);
	if (!response.ok) {
		throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
	}
	return await response.json();
}
