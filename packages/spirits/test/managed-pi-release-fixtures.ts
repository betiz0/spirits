/**
 * A release server for the default route and the managed release assets.
 *
 * The fixture serves one managed manifest plus the official Pi tarball and extension bundle it
 * points at, so `installManagedSetFromRelease` and the default route can be driven against a
 * temporary HOME without a real release, credential, or provider.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MANAGED_PI_EXTENSION_ASSET_NAME,
	MANAGED_PI_MANIFEST_ASSET_NAME,
} from "../src/constants.ts";
import { managedRoot } from "../src/managed-pi/layout.ts";
import { firstSupportedManifest, type ManagedManifest } from "../src/managed-pi/manifest.ts";
import { createOverlayPackageJson, sha256Hex } from "../src/managed-pi/overlay.ts";
import { OFFICIAL_PACKAGE } from "./managed-pi-fixtures.ts";

/** The stand-in Pi records its arguments and the environment entries that decide storage. */
const RECORDING_PI_SCRIPT = `#!/bin/sh
printf '%s\\n' "$*" > "\${PI_ARGS_FILE:-/dev/null}"
env | grep -E '^(SPIRITS_CODING_AGENT_DIR|SPIRITS_CODING_AGENT_SESSION_DIR|PI_PACKAGE_DIR|PI_CODING_AGENT_DIR|PI_CODING_AGENT_SESSION_DIR|PI_APP_NAME|ANTHROPIC_API_KEY)=' | sort > "\${PI_ENV_FILE:-/dev/null}"
if [ -n "\${PI_SETTINGS_FILE:-}" ]; then
	mkdir -p "\${SPIRITS_CODING_AGENT_DIR:?}"
	printf '{"theme":"dark"}\\n' > "\${PI_SETTINGS_FILE}"
fi
exit "\${PI_EXIT_CODE:-0}"
`;

const EXTENSION_BODY = "export default function spirits() {}\n";

export interface ReleaseFixture {
	/** Temporary HOME. `~/.spirits/{agent,bin,managed-pi,backups}` are created under it. */
	home: string;
	/** Base URL the fixture serves the release assets from. */
	baseUrl: string;
	root: string;
	requests: string[];
	manifest: ManagedManifest;
}

export interface ReleaseFixtureOptions {
	/**
	 * Serve the manifest in the shape `scripts/build-managed-pi-inputs.ts` ships: the extension
	 * artifact URL is the bare release asset name, resolved against the manifest URL's own
	 * directory by the fetcher. Absolute-URL manifests hid that `repair` (which only has the
	 * stored manifest) could not resolve relative URLs.
	 */
	relativeExtensionUrl?: boolean;
}

const managedReleaseFixtures: Array<{ stop(): Promise<void> }> = [];

export async function makeReleaseFixture(options: ReleaseFixtureOptions = {}): Promise<ReleaseFixture> {
	const work = await mkdtemp(join(tmpdir(), "spirits-default-route-"));
	const source = join(work, "source", "pi");
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "package.json"), OFFICIAL_PACKAGE);
	await writeFile(join(source, "pi"), RECORDING_PI_SCRIPT);
	await chmod(join(source, "pi"), 0o755);
	const archive = join(work, "pi.tar.gz");
	const tar = Bun.spawnSync({ cmd: ["tar", "-czf", archive, "-C", join(work, "source"), "."] });
	if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
	const archiveBytes = new Uint8Array(await Bun.file(archive).arrayBuffer());
	const overlay = createOverlayPackageJson(OFFICIAL_PACKAGE);

	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path.endsWith(MANAGED_PI_MANIFEST_ASSET_NAME)) {
				return new Response(`${JSON.stringify(manifest, null, "\t")}\n`);
			}
			if (path.endsWith("/pi.tar.gz")) return new Response(archiveBytes);
			if (path.endsWith("/spirits-managed-pi-extension.js")) return new Response(EXTENSION_BODY);
			return new Response("not found", { status: 404 });
		},
	});
	const baseUrl = `http://127.0.0.1:${server.port}`;
	const base = firstSupportedManifest({
		version: "0.1.0",
		url: `${baseUrl}/spirits-managed-pi-extension.js`,
		sha256: sha256Hex(EXTENSION_BODY),
	});
	const manifest: ManagedManifest = {
		...base,
		pi: { version: base.pi.version, artifact: { url: `${baseUrl}/pi.tar.gz`, sha256: sha256Hex(archiveBytes) } },
		extension: options.relativeExtensionUrl
			? {
					...base.extension,
					artifact: {
						url: MANAGED_PI_EXTENSION_ASSET_NAME,
						sha256: sha256Hex(EXTENSION_BODY),
					},
				}
				: base.extension,
		overlay: { ...base.overlay, sha256: overlay.sha256 },
	};
	managedReleaseFixtures.push({
		stop: async () => {
			server.stop(true);
			await rm(work, { recursive: true, force: true });
		},
	});
	return { home: work, root: managedRoot(work), requests, manifest, baseUrl };
}

/** Stop every fixture server and remove every temporary directory a fixture created. */
export async function stopManagedReleaseFixtures(): Promise<void> {
	for (const fixture of managedReleaseFixtures) await fixture.stop();
}
