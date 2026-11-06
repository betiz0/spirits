/**
 * Official artifact verification and identity evidence.
 *
 * The official tarball digest in `MANAGED_PI_FIRST_ARTIFACT_SHA256` is the trust root. A manifest
 * that records another digest is not an official artifact: the runner refuses it before writing a
 * result. The extracted executable digest is an observation for change detection, not an
 * independent signature.
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { MANAGED_PI_FIRST_ARTIFACT_SHA256 } from "../../packages/spirits/src/constants.ts";
import { loadManagedManifest, type ManagedManifest } from "../../packages/spirits/src/managed-pi/manifest.ts";
import { sha256Hex } from "../../packages/spirits/src/managed-pi/overlay.ts";
import type { CompatState } from "./runner.ts";

/** Raised when the artifact root is not the official Pi artifact. */
export class OfficialArtifactError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OfficialArtifactError";
	}
}

/** Identity of one official run, recorded with the result. */
export interface OfficialIdentity {
	piVersion: string;
	artifactSha256: string;
	executableSha256: string;
	bundleVersion: string;
	bundleSha256: string;
	manifestSetId: string;
	manifestSha256: string;
	overlayVersion: string;
	overlaySha256: string;
	targetCommit?: string;
	workingTreeClean?: boolean;
}

/** A verified official artifact set extracted into an isolated area. */
export interface OfficialArtifact {
	manifest: ManagedManifest;
	manifestPath: string;
	manifestSha256: string;
	artifactTarballPath: string;
	artifactSha256: string;
	piDir: string;
	/** Package directory inside the extracted artifact (the official tarball nests it under `pi/`). */
	packageDir: string;
	executablePath: string;
	executableSha256: string;
}

/** Classify the manifest's recorded tarball digest against the official trust root. */
export function classifyOfficialArtifactSha(manifestSha256: string | undefined): {
	state: CompatState;
	detail: string;
} {
	if (manifestSha256 === undefined) {
		return { state: "failed", detail: "the manifest records no pi.artifact.sha256" };
	}
	if (manifestSha256.toLowerCase() !== MANAGED_PI_FIRST_ARTIFACT_SHA256) {
		return {
			state: "failed",
			detail: `manifest pi.artifact.sha256 ${manifestSha256} is not the official artifact`,
		};
	}
	return { state: "confirmed", detail: "manifest pi.artifact.sha256 matches the official artifact" };
}

/** Throw when the manifest's tarball digest is not the official artifact. */
export function assertOfficialArtifactSha(manifestSha256: string | undefined): void {
	const result = classifyOfficialArtifactSha(manifestSha256);
	if (result.state !== "confirmed") throw new OfficialArtifactError(result.detail);
}

/** Compare the requested bundle with the extension digest the manifest records. */
export function classifyOfficialBundleSha(manifest: ManagedManifest, bundleSha256: string): {
	state: CompatState;
	detail: string;
} {
	const expected = manifest.extension.artifact.sha256.toLowerCase();
	if (bundleSha256.toLowerCase() === expected) {
		return { state: "confirmed", detail: "the requested bundle is the manifest extension" };
	}
	return {
		state: "failed",
		detail: `bundle digest ${bundleSha256} is not the manifest extension.artifact.sha256 ${expected}`,
	};
}

/** Throw when the requested bundle is not the extension the manifest records. */
export function assertOfficialBundleSha(manifest: ManagedManifest, bundleSha256: string): void {
	const result = classifyOfficialBundleSha(manifest, bundleSha256);
	if (result.state !== "confirmed") throw new OfficialArtifactError(result.detail);
}

function tarballName(url: string): string {
	try {
		return basename(new URL(url).pathname);
	} catch {
		const parts = url.split("/");
		return parts[parts.length - 1] || "pi-linux-x64.tar.gz";
	}
}

async function fileSha256(path: string): Promise<string> {
	return sha256Hex(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

/** Verify the manifest, the tarball digest, and extract the official artifact. */
export async function loadOfficialArtifact(options: {
	artifactRoot: string;
	workRoot: string;
}): Promise<OfficialArtifact> {
	const manifestPath = join(options.artifactRoot, "manifest.json");
	const manifest = await loadManagedManifest(manifestPath);
	assertOfficialArtifactSha(manifest.pi.artifact.sha256);
	const manifestSha256 = await fileSha256(manifestPath);
	const artifactTarballPath = join(options.artifactRoot, tarballName(manifest.pi.artifact.url));
	const artifactSha256 = await fileSha256(artifactTarballPath);
	if (artifactSha256 !== manifest.pi.artifact.sha256.toLowerCase()) {
		throw new OfficialArtifactError(
			`artifact tarball digest ${artifactSha256} does not match the manifest ${manifest.pi.artifact.sha256}`,
		);
	}
	const piDir = join(options.workRoot, "official-stage");
	await rm(piDir, { recursive: true, force: true });
	await mkdir(piDir, { recursive: true });
	const extract = Bun.spawn({
		cmd: ["tar", "-xzf", artifactTarballPath, "-C", piDir],
		stdout: "ignore",
		stderr: "pipe",
	});
	const stderr = await new Response(extract.stderr).text();
	if ((await extract.exited) !== 0) {
		throw new OfficialArtifactError(`could not extract the official artifact: ${stderr.trim()}`);
	}
	// The official tarball nests the package under `pi/`; a fixture tarball may extract flat.
	const packageDir = existsSync(join(piDir, "pi")) ? join(piDir, "pi") : piDir;
	const executablePath = join(packageDir, "pi");
	const executableSha256 = await fileSha256(executablePath);
	return {
		manifest,
		manifestPath,
		manifestSha256,
		artifactTarballPath,
		artifactSha256,
		piDir,
		packageDir,
		executablePath,
		executableSha256,
	};
}

/**
 * Build the check run immediately before every Pi spawn.
 *
 * The extracted executable digest comes from the verified tarball. Recomputing it right before
 * launch detects a staged executable that changed after extraction. A mismatch throws, so the
 * runner neither spawns Pi nor writes a result.
 */
export function createOfficialLaunchVerifier(artifact: Pick<OfficialArtifact, "executablePath" | "executableSha256">): () => Promise<void> {
	return async () => {
		const current = await fileSha256(artifact.executablePath);
		if (current !== artifact.executableSha256) {
			throw new OfficialArtifactError(
				`the launch target changed after extraction: ${current} is not ${artifact.executableSha256}`,
			);
		}
	};
}

/** Build the identity evidence recorded with an official run. */
export function buildOfficialIdentity(input: {
	manifest: ManagedManifest;
	manifestSha256: string;
	artifactSha256: string;
	executableSha256: string;
	bundleSha256: string;
	bundleVersion?: string;
	targetCommit?: string;
	workingTreeClean?: boolean;
}): OfficialIdentity {
	return {
		piVersion: input.manifest.pi.version,
		artifactSha256: input.artifactSha256,
		executableSha256: input.executableSha256,
		bundleVersion: input.bundleVersion ?? "unknown",
		bundleSha256: input.bundleSha256,
		manifestSetId: input.manifest.setId,
		manifestSha256: input.manifestSha256,
		overlayVersion: input.manifest.overlay.version,
		overlaySha256: input.manifest.overlay.sha256,
		...(input.targetCommit ? { targetCommit: input.targetCommit } : {}),
		...(input.workingTreeClean === undefined ? {} : { workingTreeClean: input.workingTreeClean }),
	};
}
