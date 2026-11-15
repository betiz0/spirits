/**
 * The host a compatibility run measures.
 *
 * The runner knows two hosts of its own: the managed set installed on the machine, and the fixed
 * official artifact it extracts and digests. Acceptance runs against another build (a Pi-Bolt branch,
 * a staging artifact) need the same matrix without a code change, so such a host arrives described:
 * an executable, the package dir it owns, and the extension bundle it carries.
 *
 * A substituted host is never the fixed official artifact. The run records it under its own mode, its
 * identification rides along in the evidence, and `compatibilityMet` stays false for it.
 */
import { isAbsolute } from "node:path";

/** Expand a leading `~` to the home directory. */
export function expandHome(path: string, home: string): string {
	return path.replace(/^~(?=\/|$)/, home);
}

/** What a host descriptor file may contain. Values stay unknown until judged. */
export interface HostDescriptorFile {
	label?: unknown;
	executable?: unknown;
	packageDir?: unknown;
	bundle?: unknown;
	piVersion?: unknown;
	note?: unknown;
}

/** A host the runner can launch. Every path is absolute. */
export interface HostDescriptor {
	/** How the run identifies this host in the evidence. */
	label: string;
	/** The executable the runner spawns. */
	executable: string;
	/** The package dir the host owns; its theme and assets are measured from here. */
	packageDir: string;
	/** The extension bundle the run loads into the host. */
	bundle: string;
	/** The host version the run expects to read back. */
	piVersion: string;
	/** Free-text note carried into the evidence, e.g. where the build came from. */
	note?: string;
}

function required(record: HostDescriptorFile, key: keyof HostDescriptorFile, source: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`host descriptor ${source}: "${key}" is required and must be a non-empty string`);
	}
	return value.trim();
}

function absolute(value: string, key: string, source: string, home: string): string {
	const expanded = expandHome(value, home);
	if (!isAbsolute(expanded)) throw new Error(`host descriptor ${source}: "${key}" must be an absolute path`);
	return expanded;
}

/**
 * Parse a host descriptor. A descriptor that names less than the whole host is refused: a run that
 * could not say what it launched must not produce a matrix.
 */
export function parseHostDescriptor(text: string, source: string, home: string): HostDescriptor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`host descriptor ${source} is not valid JSON: ${(error as Error).message}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`host descriptor ${source} must be a JSON object`);
	}
	const record = parsed as HostDescriptorFile;
	const descriptor: HostDescriptor = {
		label: required(record, "label", source),
		executable: absolute(required(record, "executable", source), "executable", source, home),
		packageDir: absolute(required(record, "packageDir", source), "packageDir", source, home),
		bundle: absolute(required(record, "bundle", source), "bundle", source, home),
		piVersion: required(record, "piVersion", source),
	};
	if (typeof record.note === "string" && record.note.trim() !== "") descriptor.note = record.note.trim();
	return descriptor;
}

/** The identification written into the evidence for a substituted host. */
export function substitutedIdentity(descriptor: HostDescriptor): {
	label: string;
	executable: string;
	packageDir: string;
	bundle: string;
	piVersion: string;
	note?: string;
} {
	return {
		label: descriptor.label,
		executable: descriptor.executable,
		packageDir: descriptor.packageDir,
		bundle: descriptor.bundle,
		piVersion: descriptor.piVersion,
		...(descriptor.note === undefined ? {} : { note: descriptor.note }),
	};
}
