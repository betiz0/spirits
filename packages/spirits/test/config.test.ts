import { expect, test } from "bun:test";
import {
	ACTION_GUARD_MODE_ENFORCE,
	ACTION_GUARD_MODE_OFF,
	ACTION_GUARD_MODE_WARN,
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
	DEFAULT_TODO_MAX_LINES,
	DEFAULT_TODO_TOGGLE_KEY,
	ENV_ACTION_GUARD,
	ENV_BUNDLED_SKILLS,
	ENV_MEMORY_CHAR_LIMIT,
	ENV_MEMORY_LINE_LIMIT,
	ENV_MEMORY_PREVIEW_LINES,
	ENV_TODO_MAX_LINES,
	ENV_TODO_TOGGLE_KEY,
} from "../src/constants.ts";
import {
	loadConfig,
	readActionGuardMode,
	readDefaultRoleSetting,
	readRoutingSettings,
	readStrongModelSetting,
	resolveTodoConfig,
} from "../src/config.ts";

test("defaults when unset", () => {
	expect(loadConfig({})).toEqual({
		memory: {
			previewLines: DEFAULT_MEMORY_PREVIEW_LINES,
			injectionCharLimit: DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
			fileLineLimit: DEFAULT_MEMORY_FILE_LINE_LIMIT,
		},
		todo: { maxLines: DEFAULT_TODO_MAX_LINES, toggleKey: DEFAULT_TODO_TOGGLE_KEY, startCollapsed: false },
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

// spec "session-todo / 開閉キーは設定ファイル、環境変数、既定値の順に決まる"
test("開閉キーの既定値", () => {
	expect(DEFAULT_TODO_TOGGLE_KEY).toBe("ctrl+shift+l");
	expect(resolveTodoConfig({}, {})).toEqual({
		maxLines: DEFAULT_TODO_MAX_LINES,
		toggleKey: DEFAULT_TODO_TOGGLE_KEY,
		startCollapsed: false,
	});
	expect(loadConfig({}).todo.toggleKey).toBe(DEFAULT_TODO_TOGGLE_KEY);
});

test("設定ファイルの開閉キーが環境変数より優先される", () => {
	expect(
		resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+shift+j" }, { todo: { toggleKey: "ctrl+shift+k" } }).toggleKey,
	).toBe("ctrl+shift+k");
	expect(resolveTodoConfig({}, { todo: { toggleKey: "ctrl+shift+k" } }).toggleKey).toBe("ctrl+shift+k");
	expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+shift+j" }, {}).toggleKey).toBe("ctrl+shift+j");
});

test("設定ファイルの開閉キーが構文不正なら環境変数を使う", () => {
	for (const value of ["", "   ", "ctrl+", "ctrl l", "shift+ctrl+", 1, true, null, ["ctrl+k"]]) {
		expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+shift+j" }, { todo: { toggleKey: value } }).toggleKey).toBe(
			"ctrl+shift+j",
		);
	}
	// `todo` がオブジェクトでない場合も項目が無いものとして扱う。
	expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+shift+j" }, { todo: "ctrl+k" }).toggleKey).toBe(
		"ctrl+shift+j",
	);
});

test("すべての候補が構文不正なら既定値", () => {
	for (const value of ["", "ctrl+", " ctrl ++ ", "ctrl+k l", "shift+ctrl+"]) {
		expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: value }, {}).toggleKey).toBe(DEFAULT_TODO_TOGGLE_KEY);
	}
	expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+" }, { todo: { toggleKey: "" } }).toggleKey).toBe(
		DEFAULT_TODO_TOGGLE_KEY,
	);
});

test("記号の基底キーを受け付ける", () => {
	for (const value of ["alt+,", "ctrl+.", "super+/", "ctrl+shift+-", "alt+9", "ctrl+`", "shift+~"]) {
		expect(resolveTodoConfig({}, { todo: { toggleKey: value } }).toggleKey).toBe(value);
	}
	// `+` は pi がキー id を分割するため基底キーにできず、候補ごと飛ばす。
	expect(resolveTodoConfig({}, { todo: { toggleKey: "ctrl++" } }).toggleKey).toBe(DEFAULT_TODO_TOGGLE_KEY);
});

test("大文字と前後の空白を正規化する", () => {
	expect(resolveTodoConfig({}, { todo: { toggleKey: " Ctrl+Shift+K " } }).toggleKey).toBe("ctrl+shift+k");
	expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "\tALT+L\n" }, {}).toggleKey).toBe("alt+l");
});

test("存在しないキー名はそのまま採用する", () => {
	expect(resolveTodoConfig({}, { todo: { toggleKey: "ctrl+foo" } }).toggleKey).toBe("ctrl+foo");
	expect(resolveTodoConfig({}, { todo: { toggleKey: "ctrl+shift+notakey" } }).toggleKey).toBe("ctrl+shift+notakey");
});

test("startCollapsed は真偽値 true のときだけ true", () => {
	expect(resolveTodoConfig({}, { todo: { startCollapsed: true } }).startCollapsed).toBe(true);
	for (const value of ["true", 1, "1", false, null, undefined, {}]) {
		expect(resolveTodoConfig({}, { todo: { startCollapsed: value } }).startCollapsed).toBe(false);
	}
	// 環境変数を持たないため、環境だけでは折りたたまれない。
	expect(resolveTodoConfig({ [ENV_TODO_TOGGLE_KEY]: "ctrl+k" }, {}).startCollapsed).toBe(false);
	expect(resolveTodoConfig({}, "not an object").startCollapsed).toBe(false);
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

// spec "action-surface-guard / 動作モードの切り替え": 既定 enforce、3 つの完全一致、それ以外は enforce。
test("action guard mode defaults to enforce", () => {
	expect(readActionGuardMode({})).toBe(ACTION_GUARD_MODE_ENFORCE);
});

test("action guard mode takes each mode on an exact match", () => {
	expect(readActionGuardMode({ [ENV_ACTION_GUARD]: "enforce" })).toBe(ACTION_GUARD_MODE_ENFORCE);
	expect(readActionGuardMode({ [ENV_ACTION_GUARD]: "warn" })).toBe(ACTION_GUARD_MODE_WARN);
	expect(readActionGuardMode({ [ENV_ACTION_GUARD]: "off" })).toBe(ACTION_GUARD_MODE_OFF);
});

test("action guard mode resolves anything else to enforce", () => {
	for (const value of ["strict", "Warn", "", " enforce", "enforce ", "off\n", "OFF", "warn "]) {
		expect(readActionGuardMode({ [ENV_ACTION_GUARD]: value })).toBe(ACTION_GUARD_MODE_ENFORCE);
	}
});

test("bundled skills are enabled unless SPIRITS_BUNDLED_SKILLS=0", () => {
	expect(loadConfig({}).bundledSkills.enabled).toBe(true);
	for (const value of ["1", "true", "yes", ""]) {
		expect(loadConfig({ [ENV_BUNDLED_SKILLS]: value }).bundledSkills.enabled).toBe(true);
	}
	expect(loadConfig({ [ENV_BUNDLED_SKILLS]: "0" }).bundledSkills.enabled).toBe(false);
});
