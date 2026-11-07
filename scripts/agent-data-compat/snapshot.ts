/**
 * Tree snapshots and diffs for agent directories.
 *
 * A snapshot records the content digest of every file plus a parsed view for JSON and JSONL, so a
 * rewrite by the other host shows up as a digest change with the exact content delta next to it.
 * Modification times are recorded but never compared: only content changes are a compatibility
 * finding.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** One recorded path inside a snapshot. */
export interface FileRecord {
	/** Path relative to the snapshot root, with `/` separators. */
	path: string;
	type: "file" | "dir" | "symlink" | "other";
	size: number;
	mtimeMs: number;
	/** Content digest of a regular file. */
	sha256?: string;
	/** Parsed object of a `.json` file, absent when it does not parse. */
	json?: unknown;
	/** Parse failures, kept as evidence instead of silently dropping the record. */
	parseError?: string;
	/** JSONL records of a `.jsonl` file, one parsed object per non-empty line. */
	jsonl?: unknown[];
	/** Number of lines in a text file. */
	lines?: number;
}

/** A change between two snapshots. */
export interface FileChange {
	path: string;
	kind: "added" | "removed" | "modified";
	beforeSha256?: string;
	afterSha256?: string;
	/** JSON keys added, removed, and changed (top level) for a modified `.json` file. */
	json?: { added: string[]; removed: string[]; changed: string[] };
	/** JSONL entries added or removed for a modified `.jsonl` file. */
	jsonl?: { added: number; removed: number; firstDivergence: number | null; prefixKept: boolean };
}

/** Result of comparing two snapshots. */
export interface SnapshotDiff {
	added: string[];
	removed: string[];
	modified: FileChange[];
	unchanged: string[];
}

function sha256(buffer: ArrayBuffer): string {
	return new Bun.CryptoHasher("sha256").update(new Uint8Array(buffer)).digest("hex");
}

function parseJsonText(text: string): { json?: unknown; jsonl?: unknown[]; parseError?: string } {
	// A whole-document parse first: a session file also starts with `{` on its first line, so a prefix
	// test cannot tell the two apart. A file that only parses line by line is JSONL.
	try {
		return { json: JSON.parse(text.trim()) };
	} catch {
		// not a single JSON document, fall through to JSONL
	}
	// A line that does not parse is recorded as a raw marker.
	const records: unknown[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			records.push({ unparseable: line.slice(0, 200) });
		}
	}
	return { jsonl: records };
}

/** Snapshot every path under `root` (symlinks are recorded, never followed). */
export async function snapshotTree(root: string): Promise<FileRecord[]> {
	const records: FileRecord[] = [];
	const walk = async (dir: string): Promise<void> => {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		for (const name of names.sort()) {
			const path = join(dir, name);
			const info = await lstat(path);
			const relativePath = path.slice(root.length + 1);
			if (info.isDirectory()) {
				records.push({ path: relativePath, type: "dir", size: 0, mtimeMs: Math.round(info.mtimeMs) });
				await walk(path);
				continue;
			}
			if (!info.isFile()) {
				records.push({ path: relativePath, type: "other", size: info.size, mtimeMs: Math.round(info.mtimeMs) });
				continue;
			}
			const buffer = await readFile(path);
			const record: FileRecord = {
				path: relativePath,
				type: "file",
				size: info.size,
				mtimeMs: Math.round(info.mtimeMs),
				sha256: sha256(buffer.buffer as ArrayBuffer),
			};
			if (/\.(json|jsonl|md|txt)$/i.test(name)) {
				const parsed = parseJsonText(buffer.toString("utf8"));
				record.lines = buffer.toString("utf8").split("\n").length;
				if (parsed.json !== undefined) record.json = parsed.json;
				if (parsed.jsonl !== undefined) record.jsonl = parsed.jsonl;
				if (parsed.parseError !== undefined) record.parseError = parsed.parseError;
			}
			records.push(record);
		}
	};
	await walk(root);
	return records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Find one record by its relative path. */
export function findRecord(records: readonly FileRecord[], path: string): FileRecord | undefined {
	return records.find((record) => record.path === path);
}

function keysOf(value: unknown): string[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value as Record<string, unknown>);
}

function valueOfKey(value: unknown, key: string): unknown {
	if (value === null || typeof value !== "object") return undefined;
	return (value as Record<string, unknown>)[key];
}

function jsonDelta(before: unknown, after: unknown): { added: string[]; removed: string[]; changed: string[] } {
	const beforeKeys = keysOf(before);
	const afterKeys = keysOf(after);
	const added = afterKeys.filter((key) => !beforeKeys.includes(key));
	const removed = beforeKeys.filter((key) => !afterKeys.includes(key));
	const changed = afterKeys.filter(
		(key) =>
			beforeKeys.includes(key) &&
			JSON.stringify(valueOfKey(before, key)) !== JSON.stringify(valueOfKey(after, key)),
	);
	return { added, removed, changed };
}

function jsonlDelta(
	before: readonly unknown[] | undefined,
	after: readonly unknown[] | undefined,
): { added: number; removed: number; firstDivergence: number | null; prefixKept: boolean } {
	const a = before ?? [];
	const b = after ?? [];
	let firstDivergence: number | null = null;
	for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
		if (JSON.stringify(a[index]) !== JSON.stringify(b[index])) {
			firstDivergence = index;
			break;
		}
	}
	return {
		added: Math.max(0, b.length - a.length),
		removed: Math.max(0, a.length - b.length),
		firstDivergence,
		// An append-only file keeps every earlier line byte-identical.
		prefixKept: firstDivergence === null && b.length >= a.length,
	};
}

/** Compare two snapshots by content. */
export function diffSnapshots(before: readonly FileRecord[], after: readonly FileRecord[]): SnapshotDiff {
	const diff: SnapshotDiff = { added: [], removed: [], modified: [], unchanged: [] };
	const afterByPath = new Map(after.map((record) => [record.path, record]));
	const beforeByPath = new Map(before.map((record) => [record.path, record]));
	for (const record of after) {
		const previous = beforeByPath.get(record.path);
		if (previous === undefined) {
			diff.added.push(record.path);
			continue;
		}
		if (previous.sha256 === record.sha256 || (previous.type === "dir" && record.type === "dir")) {
			diff.unchanged.push(record.path);
			continue;
		}
		const change: FileChange = {
			path: record.path,
			kind: "modified",
			beforeSha256: previous.sha256,
			afterSha256: record.sha256,
		};
		if (previous.json !== undefined || record.json !== undefined) change.json = jsonDelta(previous.json, record.json);
		if (previous.jsonl !== undefined || record.jsonl !== undefined) {
			change.jsonl = jsonlDelta(previous.jsonl, record.jsonl);
		}
		diff.modified.push(change);
	}
	for (const record of before) {
		if (!afterByPath.has(record.path)) diff.removed.push(record.path);
	}
	return diff;
}

/** A short, human-readable rendering of a snapshot diff. */
export function describeDiff(diff: SnapshotDiff): string[] {
	const lines: string[] = [];
	for (const path of diff.added) lines.push(`added ${path}`);
	for (const path of diff.removed) lines.push(`removed ${path}`);
	for (const change of diff.modified) {
		const parts = [`modified ${change.path}`];
		if (change.json) {
			if (change.json.added.length) parts.push(`keys+ ${change.json.added.join(",")}`);
			if (change.json.removed.length) parts.push(`keys- ${change.json.removed.join(",")}`);
			if (change.json.changed.length) parts.push(`keys~ ${change.json.changed.join(",")}`);
		}
		if (change.jsonl) {
			parts.push(
				`lines +${change.jsonl.added}/-${change.jsonl.removed} prefix=${change.jsonl.prefixKept ? "kept" : "rewritten"}`,
			);
			if (change.jsonl.firstDivergence !== null) parts.push(`firstDivergence=${change.jsonl.firstDivergence}`);
		}
		lines.push(parts.join(" "));
	}
	return lines;
}
