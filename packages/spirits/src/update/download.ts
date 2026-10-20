/**
 * Artifact download with streamed SHA256 verification.
 *
 * The checksum is fetched first; the artifact is then written to `destinationPath` while the hash
 * is computed. A mismatch (or any download failure) removes the partial file before throwing.
 */

import { open, rm } from "node:fs/promises";
import { fetchWithIdleTimeout } from "./timeout.ts";
import type { FetchLike } from "./types.ts";

/** SHA256 hex digest length in characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

/** Fields in a `sha256sum`-style checksum file are separated by whitespace. */
const CHECKSUM_FIELD_SEPARATOR = /\s+/;

/** Permission bits for the partial download; the caller raises them for executables or assets. */
const PARTIAL_FILE_MODE = 0o600;

/** Options accepted by `downloadVerifiedArtifact`. */
export interface DownloadVerifiedArtifactOptions {
	fetch: FetchLike;
	artifactUrl: string;
	checksumUrl: string;
	/** Path of the partial file; the caller owns its parent directory. */
	destinationPath: string;
	/** Idle timeout for each request. Unit: milliseconds. */
	timeoutMs: number;
}

/** Parse the expected sha256 from a `sha256sum`-style file; `undefined` when malformed. */
export function parseChecksumFile(text: string): string | undefined {
	const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
	if (firstLine.length === 0) return undefined;
	const [hash] = firstLine.split(CHECKSUM_FIELD_SEPARATOR);
	if (hash === undefined || !SHA256_HEX_PATTERN.test(hash)) return undefined;
	return hash.toLowerCase();
}

async function fetchOk(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<Response> {
	const response = await fetchWithIdleTimeout(fetchImpl, url, {}, timeoutMs);
	if (!response.ok) {
		throw new Error(`Request failed with HTTP ${response.status}.`);
	}
	return response;
}

/**
 * Download an artifact and its checksum, verify the streamed hash, and keep the verified file.
 *
 * Throws on a non-OK response, an invalid checksum file, a mismatch, or an idle timeout. The
 * partial file is removed on every failure path.
 */
export async function downloadVerifiedArtifact(options: DownloadVerifiedArtifactOptions): Promise<void> {
	const checksumResponse = await fetchOk(options.fetch, options.checksumUrl, options.timeoutMs);
	const expected = parseChecksumFile(await checksumResponse.text());
	if (expected === undefined) {
		throw new Error("The checksum file does not contain a SHA256 digest.");
	}

	const response = await fetchOk(options.fetch, options.artifactUrl, options.timeoutMs);
	if (response.body === null) {
		throw new Error("The artifact download returned an empty response body.");
	}

	const hasher = new Bun.CryptoHasher("sha256");
	const reader = response.body.getReader();
	const handle = await open(options.destinationPath, "w", PARTIAL_FILE_MODE);
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
			await handle.write(bytes);
			hasher.update(bytes);
		}
	} catch (error) {
		await handle.close().catch(() => {});
		await rm(options.destinationPath, { force: true }).catch(() => {});
		throw error;
	}
	await handle.close();

	const actual = hasher.digest("hex");
	if (actual !== expected) {
		await rm(options.destinationPath, { force: true }).catch(() => {});
		throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}.`);
	}
}
