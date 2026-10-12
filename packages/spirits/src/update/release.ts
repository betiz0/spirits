/**
 * Latest stable spirits release resolution.
 *
 * Uses the same release contract as `scripts/install.sh`: the newest non-draft, non-prerelease
 * release whose tag starts with `spirits-v`.
 */

import {
	DEFAULT_GITHUB_API_BASE_URL,
	DEFAULT_GITHUB_RELEASE_BASE_URL,
	ENV_UPDATE_API_BASE_URL,
	ENV_UPDATE_RELEASE_BASE_URL,
	GITHUB_OWNER,
	GITHUB_REPO,
	RELEASE_TAG_PREFIX,
} from "../constants.ts";
import { fetchWithIdleTimeout } from "./timeout.ts";
import type { EnvLike, FetchLike } from "./types.ts";

/** One GitHub API page holds at most 100 releases; one request suffices for the newest stable. */
const RELEASES_PAGE_SIZE = 100;

/** Accept header for the GitHub REST API. */
const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";

/** A resolved release tag and its version. */
export interface SpiritsRelease {
	/** Tag name, e.g. `spirits-v0.3.0`. */
	tag: string;
	/** Version without the tag prefix, e.g. `0.3.0`. */
	version: string;
}

/** Options accepted by `resolveLatestStableRelease`. */
export interface ResolveReleaseOptions {
	env: EnvLike;
	fetch: FetchLike;
	/** Idle timeout for the API request. Unit: milliseconds. */
	timeoutMs: number;
}

/** Shape of the release fields read from the GitHub API. */
interface GitHubRelease {
	tag_name?: unknown;
	draft?: unknown;
	prerelease?: unknown;
}

/** Thrown when the release list contains no stable `spirits-v*` release. */
export class NoStableReleaseError extends Error {
	constructor() {
		super(`No stable ${RELEASE_TAG_PREFIX}* release found.`);
		this.name = "NoStableReleaseError";
	}
}

/** GitHub API base URL, honoring the fixture override. */
export function resolveApiBaseUrl(env: EnvLike): string {
	const value = env[ENV_UPDATE_API_BASE_URL];
	return value ? value : DEFAULT_GITHUB_API_BASE_URL;
}

/** Release download base URL, honoring the fixture override. */
export function resolveReleaseBaseUrl(env: EnvLike): string {
	const value = env[ENV_UPDATE_RELEASE_BASE_URL];
	return value ? value : DEFAULT_GITHUB_RELEASE_BASE_URL;
}

/** URL of the artifact for a tag; the checksum lives at `<url>.sha256`. */
export function releaseArtifactUrl(tag: string, artifactName: string, releaseBaseUrl: string): string {
	return `${releaseBaseUrl}/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${artifactName}`;
}

/** Return the first stable `spirits-v*` tag from a newest-first tag list. */
export function selectLatestStableTag(tags: readonly string[]): string | undefined {
	return tags.find((tag) => tag.startsWith(RELEASE_TAG_PREFIX));
}

/** Convert a tag to its version, or `undefined` when the tag is not a spirits release. */
export function tagToVersion(tag: string): string | undefined {
	if (!tag.startsWith(RELEASE_TAG_PREFIX)) return undefined;
	const version = tag.slice(RELEASE_TAG_PREFIX.length);
	return version.length > 0 ? version : undefined;
}

function stableTagsFromPayload(payload: unknown): string[] {
	if (!Array.isArray(payload)) {
		throw new Error("Unexpected releases response: expected a JSON array.");
	}
	const tags: string[] = [];
	for (const entry of payload) {
		if (typeof entry !== "object" || entry === null) continue;
		const release = entry as GitHubRelease;
		if (release.draft === true || release.prerelease === true) continue;
		if (typeof release.tag_name === "string") tags.push(release.tag_name);
	}
	return tags;
}

/** Resolve the newest stable `spirits-v*` release; throws when none exists. */
export async function resolveLatestStableRelease(options: ResolveReleaseOptions): Promise<SpiritsRelease> {
	const url = `${resolveApiBaseUrl(options.env)}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=${RELEASES_PAGE_SIZE}`;
	const response = await fetchWithIdleTimeout(
		options.fetch,
		url,
		{ headers: { accept: GITHUB_ACCEPT_HEADER } },
		options.timeoutMs,
	);
	if (!response.ok) {
		throw new Error(`Releases API request failed with HTTP ${response.status}.`);
	}
	const tags = stableTagsFromPayload(await response.json());
	const tag = selectLatestStableTag(tags);
	if (tag === undefined) {
		throw new NoStableReleaseError();
	}
	const version = tagToVersion(tag);
	if (version === undefined) {
		throw new NoStableReleaseError();
	}
	return { tag, version };
}
