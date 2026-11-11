/**
 * CLI entry points for `spirits managed-pi`, after the arguments have been classified.
 *
 * `install` and `update` resolve the manifest the same way the other routes do: from the release
 * of the running binary, never from the newest release. `SPIRITS_MANAGED_PI_MANIFEST_URL` still
 * overrides the URL for fixtures and pinned mirrors. The commands then run install, update,
 * repair, help, or launch. Every failure returns a non-zero code and prints a recovery command;
 * no branch falls back to the default route.
 */

import { ENV_MANAGED_PI_MANIFEST_URL } from "../constants.ts";
import { releaseTagForVersion } from "../update/release.ts";
import type { EnvLike, FetchLike } from "../update/types.ts";
import { resolveIdleTimeoutMs } from "../update/timeout.ts";
import { fetchManagedJson } from "./artifact.ts";
import type { ManagedPiAction } from "./classify.ts";
import { installManagedSet, type ManagedIo } from "./install.ts";
import { launchManagedPi, MANAGED_PI_HELP, type ManagedSpawn } from "./launch.ts";
import { parseManagedManifest, type ManagedManifest } from "./manifest.ts";
import { fetchManagedManifestOfRelease } from "./release-assets.ts";
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
	/**
	 * Version embedded in the running binary. `install` and `update` resolve the manifest of
	 * `spirits-v<version>`, so the set always comes from the release the command runs from.
	 */
	version: string;
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

/**
 * Fetch and validate the manifest for `install`/`update`.
 *
 * Default: the release of the running binary (`spirits-v<version>`). The newest release is never
 * the default: a set from a newer release would pair with a binary it was not built against.
 * `SPIRITS_MANAGED_PI_MANIFEST_URL` wins when set, so fixtures and pinned mirrors keep working
 * unchanged; its base URL is the manifest URL's own directory.
 */
export async function fetchManagedManifest(options: {
	env: EnvLike;
	fetch: FetchLike;
	timeoutMs: number;
	version: string;
}): Promise<ManagedManifestSource> {
	const override = options.env[ENV_MANAGED_PI_MANIFEST_URL];
	if (override === undefined || override === "") {
		return await fetchManagedManifestOfRelease({
			tag: releaseTagForVersion(options.version),
			env: options.env,
			fetch: options.fetch,
			timeoutMs: options.timeoutMs,
		});
	}
	const manifest = parseManagedManifest(await fetchManagedJson(options.fetch, override, options.timeoutMs));
	return { manifest, baseUrl: new URL(".", override).toString() };
}

/** True when the requested Pi version is the one the manifest pins. */
export function matchesRequestedPiVersion(manifest: ManagedManifest, version: string | undefined): boolean {
	return version === undefined || manifest.pi.version === version;
}

async function runInstallOrUpdate(options: ManagedCommandOptions): Promise<number> {
	const io = options.io ?? DEFAULT_IO;
	const timeoutMs = resolveIdleTimeoutMs(options.env);
	const source = await fetchManagedManifest({
		env: options.env,
		fetch: options.fetch,
		timeoutMs,
		version: options.version,
	});
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
