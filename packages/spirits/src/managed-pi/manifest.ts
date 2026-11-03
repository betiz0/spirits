/**
 * Manifest for the managed Pi experimental route.
 *
 * A manifest pins every artifact of one supported set: the official Pi tarball, the prebundled
 * spirits extension, the generated overlay package, and any assets. Loading is strict so a
 * missing checksum or an unsupported platform fails before anything is installed.
 */

import { readFile } from "node:fs/promises";
import {
	MANAGED_PI_FIRST_ARTIFACT_NAME,
	MANAGED_PI_FIRST_ARTIFACT_SHA256,
	MANAGED_PI_FIRST_OVERLAY_SHA256,
	MANAGED_PI_FIRST_OVERLAY_VERSION,
	MANAGED_PI_FIRST_PI_VERSION,
	MANAGED_PI_PLATFORM,
} from "../constants.ts";

/** One downloadable artifact with its expected SHA256. */
export interface ManagedArtifact {
	/** Absolute or release-relative URL. */
	url: string;
	/** Lowercase or uppercase SHA256 hex digest. */
	sha256: string;
}

/** One non-code asset shipped with the set. */
export interface ManagedAsset extends ManagedArtifact {
	/** File name inside the release set. */
	name: string;
}

/** Overlay metadata generated after extracting the official artifact. */
export interface ManagedOverlay {
	/** Overlay identity recorded in the manifest. */
	version: string;
	/** SHA256 of the generated `package.json`. */
	sha256: string;
}

/** A complete supported managed Pi set. */
export interface ManagedManifest {
	/** Manifest format version. */
	schemaVersion: 1;
	/** Stable set identifier, used as the release directory name. */
	setId: string;
	/** Supported platform, for example `linux-x64`. */
	platform: string;
	/** Official Pi artifact and version. */
	pi: {
		version: string;
		artifact: ManagedArtifact;
	};
	/** Prebundled spirits extension. */
	extension: {
		version: string;
		artifact: ManagedArtifact;
	};
	/** Generated package metadata overlay. */
	overlay: ManagedOverlay;
	/** Extra assets shipped next to the bundle. */
	assets: ManagedAsset[];
}

/** Raised when a manifest is missing, malformed, or unsupported. */
export class ManagedManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManagedManifestError";
	}
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ManagedManifestError(`Manifest field ${field} must be a non-empty string.`);
	}
	return value;
}

function requireSha256(value: unknown, field: string): string {
	const text = requireString(value, field);
	if (!SHA256_PATTERN.test(text)) {
		throw new ManagedManifestError(`Manifest field ${field} must be a SHA256 hex digest.`);
	}
	return text.toLowerCase();
}

function requireArtifact(value: unknown, field: string): ManagedArtifact {
	if (!isRecord(value)) {
		throw new ManagedManifestError(`Manifest field ${field} must be an object.`);
	}
	return {
		url: requireString(value.url, `${field}.url`),
		sha256: requireSha256(value.sha256, `${field}.sha256`),
	};
}

function requireAsset(value: unknown, index: number): ManagedAsset {
	const field = `assets[${index}]`;
	if (!isRecord(value)) {
		throw new ManagedManifestError(`Manifest field ${field} must be an object.`);
	}
	return {
		name: requireString(value.name, `${field}.name`),
		...requireArtifact(value, field),
	};
}

/** Validate and normalize a parsed manifest object. */
export function parseManagedManifest(value: unknown): ManagedManifest {
	if (!isRecord(value)) {
		throw new ManagedManifestError("Manifest must be a JSON object.");
	}
	if (value.schemaVersion !== 1) {
		throw new ManagedManifestError("Manifest schemaVersion must be 1.");
	}
	const platform = requireString(value.platform, "platform");
	if (platform !== MANAGED_PI_PLATFORM) {
		throw new ManagedManifestError(`Unsupported managed Pi platform: ${platform}.`);
	}
	const setId = requireString(value.setId, "setId");
	if (!SET_ID_PATTERN.test(setId)) {
		throw new ManagedManifestError(`Manifest field setId is not a safe release id: ${setId}.`);
	}
	if (!isRecord(value.pi)) {
		throw new ManagedManifestError("Manifest field pi must be an object.");
	}
	if (!isRecord(value.extension)) {
		throw new ManagedManifestError("Manifest field extension must be an object.");
	}
	if (!isRecord(value.overlay)) {
		throw new ManagedManifestError("Manifest field overlay must be an object.");
	}
	if (!Array.isArray(value.assets)) {
		throw new ManagedManifestError("Manifest field assets must be an array.");
	}
	return {
		schemaVersion: 1,
		setId,
		platform,
		pi: {
			version: requireString(value.pi.version, "pi.version"),
			artifact: requireArtifact(value.pi.artifact, "pi.artifact"),
		},
		extension: {
			version: requireString(value.extension.version, "extension.version"),
			artifact: requireArtifact(value.extension.artifact, "extension.artifact"),
		},
		overlay: {
			version: requireString(value.overlay.version, "overlay.version"),
			sha256: requireSha256(value.overlay.sha256, "overlay.sha256"),
		},
		assets: value.assets.map(requireAsset),
	};
}

/** Read and validate a manifest from disk. */
export async function loadManagedManifest(path: string): Promise<ManagedManifest> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		throw new ManagedManifestError(
			`Could not read the managed Pi manifest at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ManagedManifestError(
			`The managed Pi manifest at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseManagedManifest(parsed);
}

/**
 * The first supported set (Pi 1.5.0, Linux x64).
 *
 * The extension checksum is filled in by `scripts/build-managed-pi-inputs.ts`; this constant is the
 * code-level description of the official Pi and overlay half so tests and docs can refer to it.
 */
export function firstSupportedManifest(extension: { url: string; sha256: string; version: string }): ManagedManifest {
	return parseManagedManifest({
		schemaVersion: 1,
		setId: `pi-${MANAGED_PI_FIRST_PI_VERSION}`,
		platform: MANAGED_PI_PLATFORM,
		pi: {
			version: MANAGED_PI_FIRST_PI_VERSION,
			artifact: {
				url: `https://github.com/earendil-works/pi/releases/download/v${MANAGED_PI_FIRST_PI_VERSION}/${MANAGED_PI_FIRST_ARTIFACT_NAME}`,
				sha256: MANAGED_PI_FIRST_ARTIFACT_SHA256,
			},
		},
		extension: {
			version: extension.version,
			artifact: { url: extension.url, sha256: extension.sha256 },
		},
		overlay: {
			version: MANAGED_PI_FIRST_OVERLAY_VERSION,
			sha256: MANAGED_PI_FIRST_OVERLAY_SHA256,
		},
		assets: [],
	});
}
