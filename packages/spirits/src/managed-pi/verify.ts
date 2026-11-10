/**
 * Integrity verification for an installed managed set.
 *
 * The manifest pins the downloadable artifacts. After extraction the executable has no tarball
 * digest of its own, so install writes a small `installed.json` with the executable digest. Launch
 * verifies the state, the overlay, the bundle, and the executable before spawning anything.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { MANAGED_PI_FORK_ROUTE_HINT, MANAGED_PI_PLATFORM, MANAGED_PI_REPAIR_COMMAND } from "../constants.ts";
import { readAndCreateOverlay, sha256Hex } from "./overlay.ts";
import { loadManagedManifest, type ManagedManifest } from "./manifest.ts";
import {
	managedExtensionPath,
	managedInstalledStatePath,
	managedManifestPath,
	managedPiDir,
	managedPiExecutable,
	managedSetDir,
} from "./layout.ts";

/** Raised when the installed set is missing, corrupt, or does not match its manifest. */
export class ManagedSetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManagedSetError";
	}
}

/** State written after a successful install or update. */
export interface ManagedInstalledState {
	schemaVersion: 1;
	setId: string;
	piExecutableSha256: string;
	extensionSha256: string;
	overlaySha256: string;
}

/** A verified managed set ready to launch. */
export interface VerifiedManagedSet {
	root: string;
	setId: string;
	manifest: ManagedManifest;
	piExecutable: string;
	packageDir: string;
	extensionPath: string;
}

async function fileSha256(path: string): Promise<string> {
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
	} catch (error) {
		throw new ManagedSetError(
			`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return sha256Hex(bytes);
}

/** Write the installed state for a set directory that already contains the files. */
export async function writeInstalledStateForSet(setDir: string, manifest: ManagedManifest): Promise<void> {
	const state: ManagedInstalledState = {
		schemaVersion: 1,
		setId: manifest.setId,
		piExecutableSha256: await fileSha256(join(setDir, "pi", "pi")),
		extensionSha256: await fileSha256(join(setDir, "spirits-extension.js")),
		overlaySha256: (await readAndCreateOverlay(join(setDir, "pi"))).sha256,
	};
	if (state.extensionSha256 !== manifest.extension.artifact.sha256) {
		throw new ManagedSetError("The extension bundle does not match the manifest checksum.");
	}
	if (state.overlaySha256 !== manifest.overlay.sha256) {
		throw new ManagedSetError("The generated overlay does not match the manifest checksum.");
	}
	await Bun.write(join(setDir, "installed.json"), `${JSON.stringify(state, null, "\t")}\n`);
}

/** Write the installed state after all files have been verified. */
export async function writeInstalledState(root: string, setId: string): Promise<void> {
	const manifest = await loadManagedManifest(managedManifestPath(root, setId));
	await writeInstalledStateForSet(managedSetDir(root, setId), manifest);
}

async function readInstalledState(root: string, setId: string): Promise<ManagedInstalledState> {
	const path = managedInstalledStatePath(root, setId);
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new ManagedSetError(
			`The managed set is not installed or its state is unreadable: ${path} (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ManagedSetError(`The managed set state is not an object: ${path}`);
	}
	const state = parsed as Record<string, unknown>;
	const fields = ["setId", "piExecutableSha256", "extensionSha256", "overlaySha256"] as const;
	for (const field of fields) {
		if (typeof state[field] !== "string") {
			throw new ManagedSetError(`The managed set state has no ${field}: ${path}`);
		}
	}
	if (state.schemaVersion !== 1 || state.setId !== setId) {
		throw new ManagedSetError(`The managed set state is for another set: ${path}`);
	}
	return state as unknown as ManagedInstalledState;
}

/** Verify every recorded part of a set and return the paths launch needs. */
export async function verifyManagedSet(root: string, setId: string): Promise<VerifiedManagedSet> {
	const manifest = await loadManagedManifest(managedManifestPath(root, setId));
	if (manifest.setId !== setId) {
		throw new ManagedSetError(`The installed manifest is for ${manifest.setId}, not ${setId}.`);
	}
	const state = await readInstalledState(root, setId);
	const extensionPath = managedExtensionPath(root, setId);
	const piExecutable = managedPiExecutable(root, setId);
	const packageDir = managedPiDir(root, setId);

	const extensionSha = await fileSha256(extensionPath);
	if (extensionSha !== manifest.extension.artifact.sha256 || extensionSha !== state.extensionSha256) {
		throw new ManagedSetError("The installed extension bundle does not match its recorded checksum.");
	}
	const overlay = await readAndCreateOverlay(packageDir);
	if (overlay.sha256 !== manifest.overlay.sha256 || overlay.sha256 !== state.overlaySha256) {
		throw new ManagedSetError("The installed overlay package.json does not match its recorded checksum.");
	}
	const executableSha = await fileSha256(piExecutable);
	if (executableSha !== state.piExecutableSha256) {
		throw new ManagedSetError("The managed Pi executable does not match its recorded checksum.");
	}
	const mode = (await stat(piExecutable)).mode;
	if ((mode & 0o111) === 0) {
		throw new ManagedSetError("The managed Pi executable is not executable.");
	}
	return { root, setId, manifest, piExecutable, packageDir, extensionPath };
}

/** Platform identifier used by the manifest, derived from the runtime platform and arch. */
export function managedPlatformId(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
	return `${platform}-${arch}`;
}

/**
 * Reject a set that was copied from another platform before spawning anything.
 *
 * The manifest itself is platform-pinned, so this catches both an unsupported artifact and a
 * managed root copied to a machine the release was not built for.
 */
export function assertSupportedManagedPlatform(
	manifestPlatform: string,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): void {
	if (manifestPlatform !== MANAGED_PI_PLATFORM) {
		throw new ManagedSetError(
			`The managed set targets ${manifestPlatform}; this build supports ${MANAGED_PI_PLATFORM}.`,
		);
	}
	const actual = managedPlatformId(platform, arch);
	if (actual !== MANAGED_PI_PLATFORM) {
		throw new ManagedSetError(
			`Unsupported platform ${actual}: the managed Pi route supports ${MANAGED_PI_PLATFORM} only.`,
		);
	}
}

/** Return a human-readable reason suitable for a failure message. */
export function managedSetFailureMessage(reason: string): string {
	return `${reason}\nRun \`spirits managed-pi install\` to install or repair the managed Pi set.`;
}

/**
 * Reason plus the two ways out: the repair command and the fork escape hatch.
 *
 * Every managed failure the user can act on shows both. Naming only the repair command would leave a
 * user who cannot reach the network looking at a command that also fails, with the way back hidden.
 */
export function managedRepairHint(reason: string): string {
	return [
		reason,
		`Repair: ${MANAGED_PI_REPAIR_COMMAND}`,
		`Start the previous fork route with: ${MANAGED_PI_FORK_ROUTE_HINT}`,
	].join("\n");
}
