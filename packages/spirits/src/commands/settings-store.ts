/**
 * Lock-stepped writes to pi's global settings file.
 *
 * The extension API hands out settings but never takes them back, so persisting a choice means
 * writing the file pi itself writes. Doing that safely is a matter of following the same procedure
 * pi follows (`FileSettingsStorage.withLock` and `SettingsManager.persistScopedSettings` in
 * `core/settings-manager.ts`): take a proper-lockfile lock on the settings path with
 * `{ realpath: false }`, retry while another holder has it, read what is on disk under the lock,
 * merge *only* the fields being changed, write, release. Unknown keys survive because the merge
 * starts from the file's current content, which is what lets `models.strong` and `models.role` live
 * next to pi's own keys.
 *
 * `withFileMutationQueue` is deliberately not used: it serializes writes inside one process, while
 * the writer that matters here is a different spirits process — another `spirits` run, or the host it
 * spawns, sharing the same agent dir. Only the file lock is inter-process.
 *
 * Only the global file is written. The project file belongs to a trust decision pi prompts for.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockSync } from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { SETTINGS_FILE_NAME } from "../constants.ts";

/** Lock retries before giving up, and the pause between them. Pi's own numbers. */
const MAX_LOCK_ATTEMPTS = 10;
const LOCK_RETRY_DELAY_MS = 20;

/** Lock options matching pi: the settings path is used as given, never resolved through a symlink. */
const LOCK_OPTIONS = { realpath: false } as const;

/** Fields to persist. A plain-object value merges into the object on disk key by key. */
export type SettingsPatch = Readonly<Record<string, unknown>>;

/** Inputs of one write. `settingsPath` is injectable so a test drives the same code pi would run. */
export interface SettingsWriteOptions {
	settingsPath: string;
	fields: SettingsPatch;
}

/**
 * A nested settings location, spelled the way the settings file nests: `["models", "steps",
 * "opsx-propose", "role"]`. At least one element.
 */
export type SettingsPath = readonly string[];

/** Inputs of one path-addressed write. `value` of `undefined` deletes the key the path names. */
export interface SettingsPathWriteOptions {
	settingsPath: string;
	path: SettingsPath;
	value: unknown;
}

/**
 * Decide a patch from the settings object currently on disk.
 *
 * The decision is handed the file's own content rather than the host's effective settings, because the
 * question it answers — "is there anything left to write?" — is about that file. Returning `undefined`
 * leaves the file untouched.
 */
export type SettingsPatchDecider = (current: Record<string, unknown>) => SettingsPatch | undefined;

/** Remove the byte-order mark the way pi does before parsing the settings file. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" && error !== null && "code" in error && String((error as { code?: unknown }).code) === code
	);
}

function sleepSync(ms: number): void {
	const start = Date.now();
	while (Date.now() - start < ms) {
		// Busy wait, exactly like pi's synchronous retry: the callers are extension command handlers
		// that already run to completion before the session continues.
	}
}

/**
 * Take the settings lock, retrying while another process holds it.
 *
 * `ELOCKED` is the contention pi retries too; anything else (including a lock that will never be
 * released) is raised so the caller sees a failed write instead of a silently lost one.
 */
function acquireLockWithRetry(path: string): () => void {
	let lastError: unknown;
	for (let attempt = 1; attempt <= MAX_LOCK_ATTEMPTS; attempt++) {
		try {
			return lockSync(path, LOCK_OPTIONS);
		} catch (error) {
			if (!isErrorCode(error, "ELOCKED") || attempt === MAX_LOCK_ATTEMPTS) throw error;
			lastError = error;
			sleepSync(LOCK_RETRY_DELAY_MS);
		}
	}
	throw (lastError as Error) ?? new Error(`could not lock ${path}`);
}

/** Merge one patch into the settings object read from disk, changing only the patched fields. */
function mergeFields(current: Record<string, unknown>, fields: SettingsPatch): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...current };
	for (const [field, value] of Object.entries(fields)) {
		if (isPlainObject(value)) {
			const base = isPlainObject(current[field]) ? (current[field] as Record<string, unknown>) : {};
			merged[field] = { ...base, ...value };
		} else {
			merged[field] = value;
		}
	}
	return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the settings file as an object. Absent or empty reads as `{}`; invalid JSON raises. */
export function readSettingsFile(settingsPath: string): Record<string, unknown> {
	if (!existsSync(settingsPath)) return {};
	const text = readFileSync(settingsPath, "utf-8");
	if (text.trim() === "") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(text));
	} catch (error) {
		throw new Error(
			`${settingsPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Refusing to overwrite it.`,
		);
	}
	if (!isPlainObject(parsed)) throw new Error(`${settingsPath} does not hold a settings object.`);
	return parsed;
}

/**
 * Read the settings file under the lock and hand the content to `decide`.
 *
 * The lock is taken *before* the file is read, and a file that does not exist is not created until
 * there is something to write into it. Both halves matter for the same reason: proper-lockfile locks
 * `${path}.lock`, which it makes itself, so the settings file need not exist to be locked — and a
 * writer that created `{}` on its way to the lock could land an empty settings file over a first save
 * another process had just finished, or leave a file behind when it won the lock and found nothing to
 * write. Reading under the lock is what makes the existence check and the read one atomic fact.
 *
 * The transform returning `undefined` is the one case the file is not rewritten, which is what lets a
 * write that turns out to change nothing leave the file's bytes and modification time alone. A file
 * that does not exist and a merge that produced nothing are the same case: there is no content to
 * create.
 */
function mutateUnderLock(
	settingsPath: string,
	transform: (current: Record<string, unknown>) => Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const dir = dirname(settingsPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const release = acquireLockWithRetry(settingsPath);
	try {
		const existed = existsSync(settingsPath);
		const merged = transform(readSettingsFile(settingsPath));
		if (merged === undefined) return undefined;
		if (!existed && Object.keys(merged).length === 0) return merged;
		writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8");
		return merged;
	} finally {
		release();
	}
}

/** Read the settings file, transform it under the lock, and write the result back. */
function writeUnderLock(settingsPath: string, transform: (current: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
	// The transforms behind this call always answer with an object; the `undefined` case belongs to
	// `patchSettingsFileIfChanged`, which is the only writer allowed to leave the file alone.
	return mutateUnderLock(settingsPath, transform) as Record<string, unknown>;
}

/** Merge `fields` into the settings file and return the written object. */
export function patchSettingsFile(options: SettingsWriteOptions): Record<string, unknown> {
	return writeUnderLock(options.settingsPath, (current) => mergeFields(current, options.fields));
}

/**
 * Change exactly one nested key of a settings object, and return a new object.
 *
 * `mergeFields` is a one-level merge, so `{ models: { steps: { a: { role } } } }` would replace every
 * other step. A path write instead copies each object along the path and touches the one key it names
 * — which is what lets a step setting live beside its siblings and pi's own keys. A value of
 * `undefined` deletes the key and leaves the rest of its object alone; a path that runs through a
 * non-object replaces that branch, because there is nothing to keep inside it. An absent path element
 * on a delete is a no-op, so an `unset` of something never set costs nothing.
 *
 * `current` is `unknown` because the other caller is the host's settings object, which declares the
 * keys pi knows and passes the rest through; anything that is not an object reads as an empty one.
 */
export function writePathValue(current: unknown, path: SettingsPath, value: unknown): Record<string, unknown> {
	if (path.length === 0) throw new Error("a settings path needs at least one key");
	const base = isPlainObject(current) ? current : {};
	const [head, ...rest] = path;
	if (rest.length === 0) {
		const next: Record<string, unknown> = { ...base };
		if (value === undefined) delete next[head];
		else next[head] = value;
		return next;
	}
	const branch = isPlainObject(base[head]) ? (base[head] as Record<string, unknown>) : undefined;
	if (branch === undefined && value === undefined) return { ...base };
	return { ...base, [head]: writePathValue(branch ?? {}, rest, value) };
}

/** Change exactly one nested key of the settings file. `value` of `undefined` deletes it. */
export function patchSettingsPath(options: SettingsPathWriteOptions): Record<string, unknown> {
	return writeUnderLock(options.settingsPath, (current) => writePathValue(current, options.path, options.value));
}

/**
 * Merge a patch decided from the file's own content, once, and leave the file alone when nothing changed.
 *
 * This is the entry a write that must not repeat what is already there goes through: comparing against
 * the host's effective settings would be comparing against a merge with the project file the writer does
 * not own, and comparing before taking the lock would let another process land the same change in
 * between and get overwritten. `decide` therefore runs inside the lock, and the single write it may ask
 * for is the only write this function performs.
 *
 * Returns the settings object the file holds afterwards, or `undefined` when `decide` declined to write.
 */
export function patchSettingsFileIfChanged(
	options: { settingsPath: string; decide: SettingsPatchDecider },
): Record<string, unknown> | undefined {
	return mutateUnderLock(options.settingsPath, (current) => {
		const patch = options.decide(current);
		return patch === undefined ? undefined : mergeFields(current, patch);
	});
}

/** pi's global settings path, resolved through pi's own agent-dir lookup. */
export function globalSettingsPath(): string {
	return join(getAgentDir(), SETTINGS_FILE_NAME);
}

/** Merge `fields` into pi's global settings file. */
export function patchGlobalSettings(fields: SettingsPatch): Record<string, unknown> {
	return patchSettingsFile({ settingsPath: globalSettingsPath(), fields });
}

/**
 * Change exactly one nested key of pi's global settings file, deleting it when `value` is
 * `undefined`. This is the only writer a nested spirits key should go through.
 */
export function patchGlobalSettingsPath(path: SettingsPath, value: unknown): Record<string, unknown> {
	return patchSettingsPath({ settingsPath: globalSettingsPath(), path, value });
}

/**
 * Merge a patch into pi's global settings file only if the file's own content still differs from it.
 *
 * See {@link patchSettingsFileIfChanged}: the decider sees the file as it is under the lock, and a
 * decision of "nothing to write" costs the file neither a rewrite nor a modification time.
 */
export function patchGlobalSettingsIfChanged(decide: SettingsPatchDecider): Record<string, unknown> | undefined {
	return patchSettingsFileIfChanged({ settingsPath: globalSettingsPath(), decide });
}
