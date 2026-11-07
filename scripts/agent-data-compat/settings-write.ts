/**
 * The documented test write for `settings.json`, and the evidence that it matches Pi's own writer.
 *
 * Neither host exposes a persistent settings write to an extension: `pi.getSettings()` is read-only,
 * the RPC protocol has no settings command, and the interactive `/settings` and `/model` writes are
 * TUI-only. The compatibility question still has to be measured, so the runner performs a test write
 * with the same procedure Pi uses, and records how that procedure was derived:
 *
 *  1. `proper-lockfile` `lockSync(path, { realpath: false })` with the same ELOCKED retry budget
 *     (10 attempts, 20 ms) as `FileSettingsStorage.acquireLockSyncWithRetry`.
 *  2. Read the current text under the lock, `stripBom`, `JSON.parse`, then `migrateSettings`.
 *  3. Copy the current file keys, overwrite only the fields under test, merge nested keys per field.
 *  4. `writeFileSync(path, JSON.stringify(merged, null, 2))`, then release.
 *
 * Steps 2 to 4 are `SettingsManager.persistScopedSettings`. `fidelity()` hashes the corresponding
 * code in the fork checkout and in the official upstream tag and reports whether they are identical,
 * so the reader can see the test write replays the same code both hosts use, rather than a guess.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";

/** Field values written by the test write. Nested maps patch one key inside a top-level object. */
export interface TestWriteFields {
	/** Top-level fields written as-is. */
	fields: Record<string, unknown>;
	/** Nested patches: `{ models: { strong: "provider/model" } }`. */
	nested?: Record<string, Record<string, unknown>>;
}

/** What the test write changed. */
export interface TestWriteResult {
	before: string | undefined;
	after: string;
	/** Keys present after the write that the file did not have before. */
	addedKeys: string[];
	/** Keys the file had before and lost. */
	removedKeys: string[];
}

/** Strip a UTF-8 BOM, matching `packages/coding-agent/src/utils/text.ts`. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `SettingsManager.migrateSettings`, copied verbatim from both sources (verified identical). */
function migrateSettings(settings: Record<string, unknown>): Record<string, unknown> {
	if ("queueMode" in settings && !("steeringMode" in settings)) {
		settings.steeringMode = settings.queueMode;
		delete settings.queueMode;
	}
	if (!("transport" in settings) && typeof settings.websockets === "boolean") {
		settings.transport = settings.websockets ? "websocket" : "sse";
		delete settings.websockets;
	}
	if ("skills" in settings && typeof settings.skills === "object" && settings.skills !== null && !Array.isArray(settings.skills)) {
		const skillsSettings = settings.skills as { enableSkillCommands?: unknown; customDirectories?: unknown };
		if (skillsSettings.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
			settings.enableSkillCommands = skillsSettings.enableSkillCommands;
		}
		if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0) {
			settings.skills = skillsSettings.customDirectories;
		} else {
			delete settings.skills;
		}
	}
	if ("retry" in settings && typeof settings.retry === "object" && settings.retry !== null && !Array.isArray(settings.retry)) {
		const retrySettings = settings.retry as Record<string, unknown>;
		const providerSettings =
			typeof retrySettings.provider === "object" && retrySettings.provider !== null
				? (retrySettings.provider as Record<string, unknown>)
				: undefined;
		if (
			typeof retrySettings.maxDelayMs === "number" &&
			(providerSettings?.maxRetryDelayMs === undefined || providerSettings?.maxRetryDelayMs === null)
		) {
			retrySettings.provider = { ...(providerSettings ?? {}), maxRetryDelayMs: retrySettings.maxDelayMs };
		}
		delete retrySettings.maxDelayMs;
	}
	return settings;
}

/** `FileSettingsStorage.acquireLockSyncWithRetry`, same attempt count and delay. */
function acquireLockWithRetry(path: string): () => void {
	const maxAttempts = 10;
	const delayMs = 20;
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return lockfile.lockSync(path, { realpath: false });
		} catch (error) {
			const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
			if (code !== "ELOCKED" || attempt === maxAttempts) throw error;
			lastError = error;
			const start = Date.now();
			while (Date.now() - start < delayMs) {
				// Busy wait, exactly like the synchronous writer in Pi.
			}
		}
	}
	throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
}

function keySet(text: string | undefined): string[] {
	if (text === undefined) return [];
	try {
		const parsed = JSON.parse(stripBom(text)) as Record<string, unknown>;
		return Object.keys(parsed);
	} catch {
		return [];
	}
}

/**
 * The test write. Merges the given fields into `settingsPath` under a `proper-lockfile` lock, with
 * Pi's migrate-then-merge semantics, and returns the text before and after.
 */
export function testSettingsWrite(path: string, writes: TestWriteFields): TestWriteResult {
	const existed = existsSync(path);
	const release = existed ? acquireLockWithRetry(path) : undefined;
	let before: string | undefined;
	try {
		before = existed ? readFileSync(path, "utf-8") : undefined;
		const currentFileSettings = before
			? migrateSettings(JSON.parse(stripBom(before)) as Record<string, unknown>)
			: {};
		const merged: Record<string, unknown> = { ...currentFileSettings };
		for (const [field, value] of Object.entries(writes.fields)) merged[field] = value;
		for (const [field, patch] of Object.entries(writes.nested ?? {})) {
			const baseNested = (merged[field] as Record<string, unknown> | undefined) ?? {};
			merged[field] = { ...baseNested, ...patch };
		}
		const next = `${JSON.stringify(merged, null, 2)}`;
		writeFileSync(path, next, "utf-8");
		const afterKeys = keySet(next);
		const priorKeys = keySet(before);
		return {
			before,
			after: next,
			addedKeys: afterKeys.filter((key) => !priorKeys.includes(key)),
			removedKeys: priorKeys.filter((key) => !afterKeys.includes(key)),
		};
	} finally {
		if (release) release();
	}
}

/** Read the current settings text, or `undefined` when the file does not exist. */
export function readSettings(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

/** One hashed code region. */
export interface HashedRegion {
	name: string;
	sha256: string;
	lines: number;
}

/** Comparison of the writer code in the fork checkout and in the official tag. */
export interface WriterFidelity {
	officialTag: string;
	regions: Array<{ name: string; fork: HashedRegion; official: HashedRegion; identical: boolean }>;
	identical: boolean;
}

function hashRegion(source: string, startMarker: string, endMarker: string, name: string): HashedRegion {
	const start = source.indexOf(startMarker);
	if (start === -1) throw new Error(`settings writer region not found: ${name} (${startMarker})`);
	const end = source.indexOf(endMarker, start);
	if (end === -1) throw new Error(`settings writer region has no end: ${name}`);
	const body = source.slice(start, end);
	// Ignore indentation-only differences.
	const normalized = body
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n");
	return {
		name,
		sha256: createHash("sha256").update(normalized).digest("hex"),
		lines: normalized.split("\n").length,
	};
}

/** Hash the settings write path in both sources so the test write can be checked against it. */
export function writerFidelity(input: { forkSource: string; officialSource: string; officialTag: string }): WriterFidelity {
	const specs: Array<{ name: string; start: string; end: string }> = [
		{ name: "FileSettingsStorage", start: "export class FileSettingsStorage", end: "export class InMemorySettingsStorage" },
		{ name: "migrateSettings", start: "private static migrateSettings(", end: "\n\t}\n\n\t/** A copy of the effective settings" },
		{ name: "persistScopedSettings", start: "private persistScopedSettings(", end: "\n\t}\n\n\tprivate save(" },
	];
	const regions = specs.map((spec) => {
		const fork = hashRegion(input.forkSource, spec.start, spec.end, spec.name);
		const official = hashRegion(input.officialSource, spec.start, spec.end, spec.name);
		return { name: spec.name, fork, official, identical: fork.sha256 === official.sha256 };
	});
	return { officialTag: input.officialTag, regions, identical: regions.every((region) => region.identical) };
}
