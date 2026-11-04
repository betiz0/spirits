/**
 * CLI entry points for `spirits managed-pi`, after the arguments have been classified.
 *
 * The command resolves the manifest from the latest spirits release (or a fixture URL), then runs
 * install, update, repair, help, or launch. Every failure returns a non-zero code and prints a
 * recovery command; no branch falls back to the default route.
 */

import {
	ENV_MANAGED_PI_MANIFEST_URL,
	MANAGED_PI_MANIFEST_ASSET_NAME,
} from "../constants.ts";
import type { EnvLike, FetchLike } from "../update/types.ts";
import { resolveIdleTimeoutMs } from "../update/timeout.ts";
import {
	releaseArtifactUrl,
	resolveLatestStableRelease,
	resolveReleaseBaseUrl,
} from "../update/release.ts";
import { fetchManagedJson } from "./artifact.ts";
import type { ManagedPiAction } from "./classify.ts";
import { installManagedSet, type ManagedIo } from "./install.ts";
import { launchManagedPi, MANAGED_PI_HELP, type ManagedSpawn } from "./launch.ts";
import { parseManagedManifest, type ManagedManifest } from "./manifest.ts";
import { repairManagedSet } from "./repair.ts";
import { readCurrentSet } from "./layout.ts";
import { updateManagedSet } from "./update.ts";

/** Options for a managed command. */
export interface ManagedCommandOptions {
	root: string;
	action: ManagedPiAction;
	env: EnvLike;
	fetch: FetchLike;
	home: string;
	cwd?: string;
	io?: ManagedIo;
	/** Test-only spawn seam handed to the launch path; production uses the real spawner. */
	spawn?: ManagedSpawn;
}

/** Resolved manifest plus the base URL its relative assets use. */
export interface ManagedManifestSource {
	manifest: ManagedManifest;
	baseUrl: string;
}

const DEFAULT_IO: ManagedIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

/** Resolve the manifest URL from a fixture override or the latest stable spirits release. */
export async function resolveManagedManifestUrl(options: {
	env: EnvLike;
	fetch: FetchLike;
	timeoutMs: number;
}): Promise<string> {
	const override = options.env[ENV_MANAGED_PI_MANIFEST_URL];
	if (override) return override;
	const release = await resolveLatestStableRelease({
		env: options.env,
		fetch: options.fetch,
		timeoutMs: options.timeoutMs,
	});
	return releaseArtifactUrl(release.tag, MANAGED_PI_MANIFEST_ASSET_NAME, resolveReleaseBaseUrl(options.env));
}

/** Fetch and validate the manifest. */
export async function fetchManagedManifest(options: {
	env: EnvLike;
	fetch: FetchLike;
	timeoutMs: number;
}): Promise<ManagedManifestSource> {
	const url = await resolveManagedManifestUrl(options);
	const manifest = parseManagedManifest(await fetchManagedJson(options.fetch, url, options.timeoutMs));
	const baseUrl = new URL(".", url).toString();
	return { manifest, baseUrl };
}

/** True when the requested Pi version is the one the manifest pins. */
export function matchesRequestedPiVersion(manifest: ManagedManifest, version: string | undefined): boolean {
	return version === undefined || manifest.pi.version === version;
}

async function runInstallOrUpdate(options: ManagedCommandOptions): Promise<number> {
	const io = options.io ?? DEFAULT_IO;
	const timeoutMs = resolveIdleTimeoutMs(options.env);
	const source = await fetchManagedManifest({ env: options.env, fetch: options.fetch, timeoutMs });
	if (!matchesRequestedPiVersion(source.manifest, options.action.kind === "install" ? options.action.version : undefined)) {
		io.err(
			`Unsupported managed Pi combination: the release pins Pi ${source.manifest.pi.version}, not the requested version.`,
		);
		return 1;
	}
	const common = {
		root: options.root,
		manifest: source.manifest,
		fetch: options.fetch,
		env: options.env,
		timeoutMs,
		baseUrl: source.baseUrl,
		io,
	};
	const result =
		options.action.kind === "install"
			? await installManagedSet(common)
			: await updateManagedSet(common);
	return result.exitCode;
}

/** Run one classified managed command. */
export async function runManagedCommand(options: ManagedCommandOptions): Promise<number> {
	const io = options.io ?? DEFAULT_IO;
	switch (options.action.kind) {
		case "none":
			return 0;
		case "help":
			io.out(MANAGED_PI_HELP);
			return 0;
		case "invalid":
			io.err(options.action.message);
			io.out(MANAGED_PI_HELP);
			return 1;
		case "install":
		case "update":
			try {
				return await runInstallOrUpdate(options);
			} catch (error) {
				io.err(`Managed Pi ${options.action.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
				return 1;
			}
		case "repair": {
			try {
				const setId = await readCurrentSet(options.root);
				if (!setId) {
					io.err("The managed Pi set is not installed. Run `spirits managed-pi install`.");
					return 1;
				}
				const result = await repairManagedSet({
					root: options.root,
					setId,
					fetch: options.fetch,
					timeoutMs: resolveIdleTimeoutMs(options.env),
					io,
				});
				return result.exitCode;
			} catch (error) {
				io.err(`Managed Pi repair failed: ${error instanceof Error ? error.message : String(error)}`);
				return 1;
			}
		}
		case "launch": {
			const result = await launchManagedPi({
				root: options.root,
				args: options.action.args,
				env: options.env,
				home: options.home,
				cwd: options.cwd,
				io,
				spawn: options.spawn,
			});
			return result.exitCode;
		}
	}
}
