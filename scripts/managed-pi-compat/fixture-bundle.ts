/**
 * A managed set built around an extension bundle the caller supplies.
 *
 * `--mode fixture` measures the installed managed set, which is a released bundle. Reviewing a change to
 * the extension with that set would report the behaviour of the code that shipped without the change, so
 * the runner needs a set whose spirits artifacts are the ones just built.
 *
 * The Pi half of the set is copied rather than linked. `verifyManagedSet` reads the overlay package out
 * of the Pi directory and creates one when it is missing, and a link would let that write land in the
 * user's installed set — the run's whole point is that it touches nothing outside its own roots.
 * `pi.tar.gz` is left out: the fixture route launches the extracted tree, and the tarball is only read
 * when an official artifact is being verified from scratch.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { managedManifestPath, managedSetDir } from "../../packages/spirits/src/managed-pi/layout.ts";
import { loadManagedManifest, type ManagedManifest } from "../../packages/spirits/src/managed-pi/manifest.ts";
import { sha256Hex } from "../../packages/spirits/src/managed-pi/overlay.ts";
import { verifyManagedSet, writeInstalledStateForSet, type VerifiedManagedSet } from "../../packages/spirits/src/managed-pi/verify.ts";

/** The extension the staged set runs, with the digest the set records for it. */
export interface StagedBundle {
	set: VerifiedManagedSet;
	extensionPath: string;
	extensionSha256: string;
}

/**
 * Stage a managed set around `bundle`, in the run's own work root.
 *
 * The installed manifest pins the Pi artifact and the overlay, and those pins carry over unchanged. The
 * extension entry is re-pinned to the bundle that was just written, because a manifest that named another
 * bundle would fail verification — and the point of the staged set is that its extension is this one.
 * Pinning is not attestation: the fixture route measures behaviour, and the official route is what
 * checks an artifact against the release digest.
 */
export async function stageFixtureBundle(options: {
	/** The managed root whose installed set supplies the Pi artifact. */
	artifactRoot: string;
	setId: string;
	/** The extension bundle to run instead of the installed one. */
	bundle: string;
	/** The run's work root, which the runner cleans up. */
	workRoot: string;
}): Promise<StagedBundle> {
	const root = join(options.workRoot, "managed-set");
	const setDir = managedSetDir(root, options.setId);
	await rm(root, { recursive: true, force: true });
	await mkdir(setDir, { recursive: true });
	await cp(managedSetDir(options.artifactRoot, options.setId) + "/pi", join(setDir, "pi"), { recursive: true });

	const installed = await loadManagedManifest(managedManifestPath(options.artifactRoot, options.setId));
	const bytes = await readFile(options.bundle);
	const extensionSha256 = sha256Hex(bytes);
	const manifest: ManagedManifest = {
		...installed,
		extension: { ...installed.extension, artifact: { ...installed.extension.artifact, sha256: extensionSha256 } },
	};
	await writeFile(join(setDir, "spirits-extension.js"), bytes);
	await writeFile(managedManifestPath(root, options.setId), `${JSON.stringify(manifest, null, "\t")}\n`);
	// The same verifier the install path uses, so a staged set that would not launch fails here rather
	// than in the middle of an item.
	await writeInstalledStateForSet(setDir, manifest);
	return { set: await verifyManagedSet(root, options.setId), extensionPath: join(setDir, "spirits-extension.js"), extensionSha256 };
}
