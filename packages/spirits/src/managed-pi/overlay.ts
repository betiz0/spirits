/**
 * Managed overlay: the small `package.json` change that gives the official Pi artifact the
 * spirits identity without touching the artifact's executable or package layout.
 *
 * The official artifact checksum and the overlay checksum stay separate values: the manifest
 * records the original tarball digest, while the installed set records the generated file.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SPIRITS_APP_NAME } from "../constants.ts";

/** Official package metadata fields the overlay keeps. */
interface OfficialPackageJson {
	name?: unknown;
	version?: unknown;
	piConfig?: { configDir?: unknown; name?: unknown; [key: string]: unknown };
	[key: string]: unknown;
}

/** Result of generating an overlay package.json. */
export interface ManagedOverlayResult {
	/** `name` preserved from the official artifact. */
	name: string;
	/** `version` preserved from the official artifact. */
	version: string;
	/** SHA256 of the generated file. */
	sha256: string;
	/** Generated file content. */
	content: string;
}

/** Raised when the official package metadata cannot produce a valid overlay. */
export class ManagedOverlayError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManagedOverlayError";
	}
}

/** SHA256 hex digest of bytes or text. */
export function sha256Hex(content: string | Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

function parseOfficialPackage(text: string): OfficialPackageJson {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ManagedOverlayError(
			`The official artifact package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ManagedOverlayError("The official artifact package.json is not an object.");
	}
	return parsed as OfficialPackageJson;
}

/**
 * Produce the overlay package.json.
 *
 * Only `piConfig.name` is added and `configDir` is kept (defaulting to `.pi`). Everything else is
 * carried along so the official name and version remain visible.
 */
export function createOverlayPackageJson(officialText: string): ManagedOverlayResult {
	const original = parseOfficialPackage(officialText);
	if (typeof original.name !== "string" || original.name.length === 0) {
		throw new ManagedOverlayError("The official artifact package.json has no name.");
	}
	if (typeof original.version !== "string" || original.version.length === 0) {
		throw new ManagedOverlayError("The official artifact package.json has no version.");
	}
	const configDir =
		typeof original.piConfig?.configDir === "string" && original.piConfig.configDir.length > 0
			? original.piConfig.configDir
			: ".pi";
	const overlay: OfficialPackageJson = {
		...original,
		piConfig: {
			...(original.piConfig ?? {}),
			configDir,
			name: SPIRITS_APP_NAME,
		},
	};
	const content = `${JSON.stringify(overlay, null, "\t")}\n`;
	return {
		name: original.name,
		version: original.version,
		sha256: sha256Hex(content),
		content,
	};
}

/** Read the official package.json and return the generated overlay content. */
export async function readAndCreateOverlay(piDir: string): Promise<ManagedOverlayResult> {
	const path = join(piDir, "package.json");
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		throw new ManagedOverlayError(
			`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return createOverlayPackageJson(text);
}

/** Write the overlay package.json into an extracted package and verify its digest. */
export async function writeOverlayPackage(piDir: string, expectedSha256?: string): Promise<ManagedOverlayResult> {
	const overlay = await readAndCreateOverlay(piDir);
	if (expectedSha256 !== undefined && overlay.sha256 !== expectedSha256.toLowerCase()) {
		throw new ManagedOverlayError(
			`Overlay checksum mismatch: expected ${expectedSha256}, got ${overlay.sha256}.`,
		);
	}
	await writeFile(join(piDir, "package.json"), overlay.content);
	return overlay;
}

/** Verify that an installed overlay `package.json` still has the recorded digest. */
export async function verifyOverlayPackage(path: string, expectedSha256: string): Promise<void> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		throw new ManagedOverlayError(
			`Could not read the installed overlay at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const actual = sha256Hex(text);
	if (actual !== expectedSha256.toLowerCase()) {
		throw new ManagedOverlayError(
			`Overlay checksum mismatch: expected ${expectedSha256}, got ${actual}.`,
		);
	}
}
