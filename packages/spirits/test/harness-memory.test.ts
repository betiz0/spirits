import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
} from "../src/constants.ts";
import type { MemoryLimits } from "../src/config.ts";
import { buildMemorySummary, createNoteHostFn } from "../src/harness/memory.ts";
import { memoryDir, notesPath } from "../src/harness/paths.ts";
import type { HostFnEntry } from "../src/repl/registry.ts";
import { makeScope } from "./support.ts";

const DEFAULT_LIMITS: MemoryLimits = {
	previewLines: DEFAULT_MEMORY_PREVIEW_LINES,
	injectionCharLimit: DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	fileLineLimit: DEFAULT_MEMORY_FILE_LINE_LIMIT,
};

const FIXED_NOW = new Date("2024-01-02T03:04:05.000Z");

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-memory-"));
}

async function writeMemoryFile(agentDir: string, name: string, lines: string[]): Promise<string> {
	const dir = memoryDir(agentDir);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, name);
	await writeFile(file, `${lines.join("\n")}\n`);
	return file;
}

async function exists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

async function summaryOf(agentDir: string, limits: MemoryLimits = DEFAULT_LIMITS): Promise<string> {
	return (await buildMemorySummary(agentDir, limits)) ?? "";
}

class FakePi {
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}
}

function noteEntry(agentDir: string, pi: FakePi): HostFnEntry {
	return createNoteHostFn({ pi, agentDir, now: () => FIXED_NOW });
}

async function callNote(entry: HostFnEntry, text: unknown): Promise<string> {
	return (await entry.create(makeScope().scope)(text)) as string;
}

function hasLoneSurrogate(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				return true;
			}
			i++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// buildMemorySummary
// ---------------------------------------------------------------------------

test("no memory dir yields no section", async () => {
	const agentDir = await makeAgentDir();
	expect(await buildMemorySummary(agentDir, DEFAULT_LIMITS)).toBeUndefined();
});

test("preview includes first lines and path", async () => {
	const agentDir = await makeAgentDir();
	const file = await writeMemoryFile(agentDir, "other.md", ["line-01-marker", "line-02-marker"]);
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("line-01-marker");
	expect(summary).toContain(file);
	expect(summary).toContain("先頭");
});

test("line after preview limit is omitted", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: DEFAULT_MEMORY_PREVIEW_LINES + 1 }, (_, index) => {
		if (index === DEFAULT_MEMORY_PREVIEW_LINES - 1) {
			return "at-limit-marker";
		}
		if (index === DEFAULT_MEMORY_PREVIEW_LINES) {
			return "after-limit-marker";
		}
		return `filler-${index}`;
	});
	await writeMemoryFile(agentDir, "other.md", lines);
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("at-limit-marker");
	expect(summary).not.toContain("after-limit-marker");
});

test("notes.md shows last lines", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: 25 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`);
	await writeMemoryFile(agentDir, "notes.md", lines);
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("line-25");
	expect(summary).not.toContain("line-01");
});

test("notes.md excerpt labeled as tail", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "notes.md", ["tail-line"]);
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("末尾");
});

test("section capped at char limit", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", ["a".repeat(5000)]);
	await writeMemoryFile(agentDir, "b.md", ["b".repeat(5000)]);
	const summary = await summaryOf(agentDir);
	expect(summary.length).toBeLessThanOrEqual(DEFAULT_MEMORY_INJECTION_CHAR_LIMIT);
	expect(summary).toContain("切り詰め");
});

test("truncation notice stays within limit", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", ["a".repeat(5000)]);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit: 300 });
	expect(summary.length).toBeLessThanOrEqual(300);
	expect(summary).toContain("切り詰め");
});

test("exact limit is not truncated", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", ["short line"]);
	const exact = await summaryOf(agentDir);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit: exact.length });
	expect(summary).toBe(exact);
	expect(summary).not.toContain("切り詰め");
});

test("truncation keeps surrogate pairs", async () => {
	const agentDir = await makeAgentDir();
	const emojiLine = "😀".repeat(300);
	await writeMemoryFile(agentDir, "emoji.md", [emojiLine]);
	const full = await summaryOf(agentDir);
	// Where the emoji run starts in the uncapped summary; limits near it make the cut
	// land inside the run instead of inside the file heading.
	const emojiStart = full.length - emojiLine.length;
	// Derive the truncation-notice length from a truncated summary instead of
	// duplicating the Layer 1 wording: the common prefix is the kept body.
	const justShort = await summaryOf(agentDir, {
		...DEFAULT_LIMITS,
		injectionCharLimit: full.length - 1,
	});
	let common = 0;
	while (common < justShort.length && justShort[common] === full[common]) {
		common++;
	}
	const noticeLength = justShort.length - common;
	expect(noticeLength).toBeGreaterThan(0);
	let cutAfterHighSurrogate = false;
	for (let offset = 1; offset <= 4; offset++) {
		const injectionCharLimit = emojiStart + noticeLength + offset;
		const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit });
		expect(summary.length).toBeLessThanOrEqual(injectionCharLimit);
		expect(hasLoneSurrogate(summary)).toBe(false);
		const rawCut = emojiStart + offset;
		const beforeCut = full.charCodeAt(rawCut - 1);
		if (beforeCut >= 0xd800 && beforeCut <= 0xdbff) {
			cutAfterHighSurrogate = true;
		}
	}
	// At least one raw cut lands right after a high surrogate, so the loop exercises
	// the pair-preserving adjustment instead of passing on heading text alone.
	expect(cutAfterHighSurrogate).toBe(true);
});

test("notes.md survives truncation", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", ["a".repeat(5000)]);
	await writeMemoryFile(agentDir, "notes.md", ["latest-note"]);
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("latest-note");
});

test("oversized file listed as cleanup candidate", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: DEFAULT_MEMORY_FILE_LINE_LIMIT + 1 }, (_, i) => `line-${i}`);
	const memoryFile = await writeMemoryFile(agentDir, "big.md", lines);
	const before = await readFile(memoryFile, "utf8");
	const summary = await summaryOf(agentDir);
	const after = await readFile(memoryFile, "utf8");
	expect(summary).toContain("整理候補");
	expect(summary).toContain("big.md");
	expect(summary).toContain(String(DEFAULT_MEMORY_FILE_LINE_LIMIT + 1));
	// Summarizing must never rewrite the file it reports on.
	expect(after).toBe(before);
});

test("custom line limit lists candidate with count", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: 11 }, (_, i) => `line-${i}`);
	await writeMemoryFile(agentDir, "big.md", lines);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, fileLineLimit: 10 });
	expect(summary).toContain("big.md");
	expect(summary).toContain("11 行");
	expect(summary).toContain("- big.md（11 行）");
});

test("exactly line limit is not a candidate", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: DEFAULT_MEMORY_FILE_LINE_LIMIT }, (_, i) => `line-${i}`);
	await writeMemoryFile(agentDir, "exact.md", lines);
	const summary = await summaryOf(agentDir);
	expect(summary).not.toContain("整理候補");
});

test("non-md files ignored", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "big.txt", ["x"]);
	expect(await buildMemorySummary(agentDir, DEFAULT_LIMITS)).toBeUndefined();
});

test("custom limits applied", async () => {
	const agentDir = await makeAgentDir();
	const lines = Array.from({ length: 10 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`);
	await writeMemoryFile(agentDir, "other.md", lines);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, previewLines: 5, fileLineLimit: 3 });
	expect(summary).toContain("line-05");
	expect(summary).not.toContain("line-06");
	expect(summary).toContain("整理候補");
});

test("unreadable file skipped", async () => {
	const agentDir = await makeAgentDir();
	const dir = memoryDir(agentDir);
	await mkdir(dir, { recursive: true });
	await symlink(path.join(agentDir, "missing-target"), path.join(dir, "x.md"));
	await writeFile(path.join(dir, "ok.md"), "readable-line\n");
	const summary = await summaryOf(agentDir);
	expect(summary).toContain("readable-line");
	expect(summary).not.toContain("x.md");
});

test("file heading states full text is in the file", async () => {
	const agentDir = await makeAgentDir();
	const notes = await writeMemoryFile(agentDir, "notes.md", ["note-line"]);
	const other = await writeMemoryFile(agentDir, "other.md", ["other-line"]);
	const summary = await summaryOf(agentDir);
	for (const file of [notes, other]) {
		const heading = summary
			.split("\n")
			.find((line) => line.startsWith("### ") && line.includes(file));
		expect(heading).toBeDefined();
		expect(heading).toContain("全文はこのファイル");
	}
});

/** 20 lines of 300 characters with `note-NN` markers, enough to overflow the default cap. */
function longNoteLines(): string[] {
	return Array.from({ length: 20 }, (_, index) => {
		const marker = `note-${String(index + 1).padStart(2, "0")}`;
		return `${marker}-${"x".repeat(300 - marker.length - 1)}`;
	});
}

test("notes.md alone over limit keeps newest", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "notes.md", longNoteLines());
	const summary = await summaryOf(agentDir);
	expect(summary.length).toBeLessThanOrEqual(DEFAULT_MEMORY_INJECTION_CHAR_LIMIT);
	expect(summary).toContain("note-20");
	expect(summary).not.toContain("note-01");
});

test("notes.md heading shows included line count", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "notes.md", longNoteLines());
	const summary = await summaryOf(agentDir);
	const included = summary.split("\n").filter((line) => /^note-\d\d/.test(line)).length;
	const match = summary.match(/末尾 (\d+) 行 \/ 全 20 行/);
	expect(match).not.toBeNull();
	expect(Number(match?.[1])).toBe(included);
	expect(included).toBeLessThan(20);
});

test("notes.md newest line cut when nothing fits", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "notes.md", ["n".repeat(5000)]);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit: 500 });
	expect(summary.length).toBeLessThanOrEqual(500);
	expect(summary).toContain("切り詰め");
});

test("limit below truncation notice returns plain prefix", async () => {
	const agentDir = await makeAgentDir();
	await writeMemoryFile(agentDir, "a.md", ["x".repeat(5000)]);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit: 10 });
	expect(summary.length).toBe(10);
	expect(summary).not.toContain("切り詰め");
});

test("truncation keeps cleanup candidates before notes", async () => {
	const agentDir = await makeAgentDir();
	const bigLines = Array.from({ length: DEFAULT_MEMORY_FILE_LINE_LIMIT + 1 }, (_, i) => `big-${i}`);
	await writeMemoryFile(agentDir, "big.md", bigLines);
	await writeMemoryFile(agentDir, "notes.md", ["latest-note"]);
	const summary = await summaryOf(agentDir, { ...DEFAULT_LIMITS, injectionCharLimit: 180 });
	expect(summary.length).toBeLessThanOrEqual(180);
	expect(summary).toContain("整理候補");
	expect(summary).toContain("big.md");
});

// ---------------------------------------------------------------------------
// createNoteHostFn
// ---------------------------------------------------------------------------

test("note appends timestamped line", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	const result = await callNote(noteEntry(agentDir, pi), "build requires bun 1.4.2");
	const content = await readFile(notesPath(agentDir), "utf8");
	expect(content).toContain(FIXED_NOW.toISOString());
	expect(content).toContain("build requires bun 1.4.2");
	expect(content.trimEnd().split("\n").length).toBe(1);
	expect(result).toContain(notesPath(agentDir));
});

test("note creates memory dir", async () => {
	const agentDir = await makeAgentDir();
	expect(await exists(memoryDir(agentDir))).toBe(false);
	await callNote(noteEntry(agentDir, new FakePi()), "created");
	expect(await exists(memoryDir(agentDir))).toBe(true);
	expect(await exists(notesPath(agentDir))).toBe(true);
});

test("note returns path", async () => {
	const agentDir = await makeAgentDir();
	const result = await callNote(noteEntry(agentDir, new FakePi()), "path check");
	expect(result).toContain(notesPath(agentDir));
});

test("note normalizes newlines to one line", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	const entry = noteEntry(agentDir, pi);
	await callNote(entry, "first");
	await callNote(entry, "a\nb\r\nc");
	const content = await readFile(notesPath(agentDir), "utf8");
	const lines = content.split("\n").filter((line) => line !== "");
	expect(lines.length).toBe(2);
	expect(lines[1]).toEndWith("a b c");
});

test("note starts a new line when notes.md lacks a trailing newline", async () => {
	const agentDir = await makeAgentDir();
	const file = notesPath(agentDir);
	await mkdir(memoryDir(agentDir), { recursive: true });
	await writeFile(file, "prior note");
	await callNote(noteEntry(agentDir, new FakePi()), "new note");
	const content = await readFile(file, "utf8");
	expect(content.split("\n")).toEqual([
		"prior note",
		`- ${FIXED_NOW.toISOString()} new note`,
		"",
	]);
});

test("note adds no blank line after a trailing newline", async () => {
	const agentDir = await makeAgentDir();
	const file = notesPath(agentDir);
	await mkdir(memoryDir(agentDir), { recursive: true });
	await writeFile(file, "prior note\n");
	await callNote(noteEntry(agentDir, new FakePi()), "new note");
	const content = await readFile(file, "utf8");
	expect(content.split("\n")).toEqual([
		"prior note",
		`- ${FIXED_NOW.toISOString()} new note`,
		"",
	]);
});

test("note rejects blank input", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	const entry = noteEntry(agentDir, pi);
	await expect(callNote(entry, "   ")).rejects.toThrow();
	await expect(callNote(entry, "\n\n")).rejects.toThrow();
	expect(await exists(notesPath(agentDir))).toBe(false);
	expect(pi.entries.length).toBe(0);
});

test("note rejects non-string", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	await expect(callNote(noteEntry(agentDir, pi), 42)).rejects.toThrow();
	expect(await exists(notesPath(agentDir))).toBe(false);
	expect(pi.entries.length).toBe(0);
});

test("note appends session entry", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	await callNote(noteEntry(agentDir, pi), "entry check");
	expect(pi.entries.length).toBe(1);
	expect(pi.entries[0].customType).toBe("spirits_memory");
});

test("note entry records normalized text", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	await callNote(noteEntry(agentDir, pi), "a\nb\r\nc");
	const data = pi.entries[0].data as { text: string; timestamp: string; file: string };
	expect(data.text).toBe("a b c");
	expect(data.timestamp).toBe(FIXED_NOW.toISOString());
	expect(data.file).toBe(notesPath(agentDir));
});

test("note writes nothing on invalid", async () => {
	const agentDir = await makeAgentDir();
	const pi = new FakePi();
	const entry = noteEntry(agentDir, pi);
	await expect(callNote(entry, "")).rejects.toThrow();
	await expect(callNote(entry, 0)).rejects.toThrow();
	expect(await exists(notesPath(agentDir))).toBe(false);
	expect(pi.entries.length).toBe(0);
});
