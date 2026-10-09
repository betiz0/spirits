import { expect, test } from "bun:test";
import {
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
	ENV_MEMORY_CHAR_LIMIT,
	ENV_MEMORY_LINE_LIMIT,
	ENV_MEMORY_PREVIEW_LINES,
} from "../src/constants.ts";
import { loadConfig } from "../src/config.ts";

test("defaults when unset", () => {
	expect(loadConfig({})).toEqual({
		memory: {
			previewLines: DEFAULT_MEMORY_PREVIEW_LINES,
			injectionCharLimit: DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
			fileLineLimit: DEFAULT_MEMORY_FILE_LINE_LIMIT,
		},
	});
});

test("env overrides each limit", () => {
	const config = loadConfig({
		[ENV_MEMORY_PREVIEW_LINES]: "5",
		[ENV_MEMORY_CHAR_LIMIT]: "500",
		[ENV_MEMORY_LINE_LIMIT]: "10",
	});
	expect(config.memory).toEqual({ previewLines: 5, injectionCharLimit: 500, fileLineLimit: 10 });
});

test("invalid values fall back to default", () => {
	const invalid = ["abc", "0", "-1", "1.5", "05", "+5", " 5", "", "9".repeat(30)];
	for (const value of invalid) {
		expect(loadConfig({ [ENV_MEMORY_PREVIEW_LINES]: value }).memory.previewLines).toBe(
			DEFAULT_MEMORY_PREVIEW_LINES,
		);
		expect(loadConfig({ [ENV_MEMORY_CHAR_LIMIT]: value }).memory.injectionCharLimit).toBe(
			DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
		);
		expect(loadConfig({ [ENV_MEMORY_LINE_LIMIT]: value }).memory.fileLineLimit).toBe(
			DEFAULT_MEMORY_FILE_LINE_LIMIT,
		);
	}
});

test("limits resolve independently", () => {
	const config = loadConfig({ [ENV_MEMORY_CHAR_LIMIT]: "999" });
	expect(config.memory.injectionCharLimit).toBe(999);
	expect(config.memory.previewLines).toBe(DEFAULT_MEMORY_PREVIEW_LINES);
	expect(config.memory.fileLineLimit).toBe(DEFAULT_MEMORY_FILE_LINE_LIMIT);
});
