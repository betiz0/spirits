import { expect, test } from "bun:test";
import {
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
	DEFAULT_TODO_MAX_LINES,
	ENV_BUNDLED_SKILLS,
	ENV_MEMORY_CHAR_LIMIT,
	ENV_MEMORY_LINE_LIMIT,
	ENV_MEMORY_PREVIEW_LINES,
	ENV_TODO_MAX_LINES,
} from "../src/constants.ts";
import { loadConfig, readDefaultRoleSetting, readRoutingSettings, readStrongModelSetting } from "../src/config.ts";

test("defaults when unset", () => {
	expect(loadConfig({})).toEqual({
		memory: {
			previewLines: DEFAULT_MEMORY_PREVIEW_LINES,
			injectionCharLimit: DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
			fileLineLimit: DEFAULT_MEMORY_FILE_LINE_LIMIT,
		},
		todo: { maxLines: DEFAULT_TODO_MAX_LINES },
		bundledSkills: { enabled: true },
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

test("todo max lines defaults to 5", () => {
	expect(DEFAULT_TODO_MAX_LINES).toBe(5);
	expect(loadConfig({}).todo.maxLines).toBe(5);
});

test("todo max lines reads SPIRITS_TODO_MAX_LINES", () => {
	expect(loadConfig({ [ENV_TODO_MAX_LINES]: "3" }).todo.maxLines).toBe(3);
});

test("todo max lines falls back on 0, abc, -1", () => {
	for (const value of ["0", "abc", "-1"]) {
		expect(loadConfig({ [ENV_TODO_MAX_LINES]: value }).todo.maxLines).toBe(DEFAULT_TODO_MAX_LINES);
	}
});

test("reads a provider-qualified strong model setting", () => {
	expect(readStrongModelSetting({ models: { strong: "anthropic/claude-opus-4-7" } })).toEqual({
		provider: "anthropic",
		modelId: "claude-opus-4-7",
	});
	expect(readStrongModelSetting({ models: { strong: " anthropic / claude-opus-4-7 " } })).toEqual({
		provider: "anthropic",
		modelId: "claude-opus-4-7",
	});
});

test("keeps a bare strong model id unqualified", () => {
	expect(readStrongModelSetting({ models: { strong: "claude-opus-4-7" } })).toEqual({
		modelId: "claude-opus-4-7",
	});
	// Only the first separator splits the provider, so ids containing one survive.
	expect(readStrongModelSetting({ models: { strong: "openrouter/anthropic/claude-opus-4-7" } })).toEqual({
		provider: "openrouter",
		modelId: "anthropic/claude-opus-4-7",
	});
});

test("treats a blank strong model setting as unset", () => {
	for (const value of ["", "   ", "\t", "anthropic/", "/claude-opus-4-7"]) {
		expect(readStrongModelSetting({ models: { strong: value } })).toBeUndefined();
	}
	expect(readStrongModelSetting({})).toBeUndefined();
	expect(readStrongModelSetting({ models: {} })).toBeUndefined();
	expect(readStrongModelSetting(undefined)).toBeUndefined();
});

test("ignores a non-string strong model setting", () => {
	for (const value of [42, true, null, ["anthropic/claude-opus-4-7"]]) {
		expect(readStrongModelSetting({ models: { strong: value } })).toBeUndefined();
	}
	expect(readStrongModelSetting({ models: "anthropic/claude-opus-4-7" })).toBeUndefined();
	expect(readStrongModelSetting({ models: ["strong"] })).toBeUndefined();
});

test("reads routing settings from a pi settings object", () => {
	expect(readRoutingSettings({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" })).toEqual({
		defaultProvider: "anthropic",
		defaultModelId: "claude-sonnet-4-5",
	});
	expect(readRoutingSettings({ defaultProvider: "anthropic", models: { strong: " claude-opus-4-7 " } })).toEqual({
		defaultProvider: "anthropic",
		strong: { modelId: "claude-opus-4-7" },
	});
	expect(readRoutingSettings({})).toEqual({});
});

// spec "dual-model-routing / 既定ロールの読み取り": strong / 大文字小文字 / 設定が無い / banana / 空
test("reads the default role from models.role", () => {
	expect(readDefaultRoleSetting({ models: { role: "strong" } })).toBe("strong");
	expect(readDefaultRoleSetting({ models: { role: "STRONG" } })).toBe("strong");
	expect(readDefaultRoleSetting({ models: { role: " Normal " } })).toBe("normal");
});

test("treats an unusable default role setting as unset", () => {
	for (const value of ["banana", "", "   ", 42, true, null, ["strong"]]) {
		expect(readDefaultRoleSetting({ models: { role: value } })).toBeUndefined();
	}
	expect(readDefaultRoleSetting({})).toBeUndefined();
	expect(readDefaultRoleSetting({ models: {} })).toBeUndefined();
	expect(readDefaultRoleSetting({ models: "strong" })).toBeUndefined();
	expect(readDefaultRoleSetting(undefined)).toBeUndefined();
});

test("carries the default role into the routing settings", () => {
	expect(readRoutingSettings({ defaultProvider: "anthropic", models: { role: "STRONG" } })).toEqual({
		defaultProvider: "anthropic",
		defaultRole: "strong",
	});
	expect(readRoutingSettings({ models: { role: "banana" } })).toEqual({});
});

test("bundled skills are enabled unless SPIRITS_BUNDLED_SKILLS=0", () => {
	expect(loadConfig({}).bundledSkills.enabled).toBe(true);
	for (const value of ["1", "true", "yes", ""]) {
		expect(loadConfig({ [ENV_BUNDLED_SKILLS]: value }).bundledSkills.enabled).toBe(true);
	}
	expect(loadConfig({ [ENV_BUNDLED_SKILLS]: "0" }).bundledSkills.enabled).toBe(false);
});
