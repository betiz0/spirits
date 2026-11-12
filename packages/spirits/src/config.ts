/**
 * Layer 3 configuration: values the operator can change per environment.
 *
 * The memory limits are read once at extension load. Invalid values fall back to the
 * Layer 2 defaults instead of failing startup (design Decision 11).
 *
 * The strong model target and the default role also come from the operator, but from pi's settings
 * file rather than the environment, so they are resolved on every read and never cached
 * (design Decision 1).
 */

import {
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
	DEFAULT_TODO_MAX_LINES,
	DEFAULT_TODO_TOGGLE_KEY,
	ACTION_GUARD_MODES,
	ACTION_GUARD_MODE_ENFORCE,
	ENV_ACTION_GUARD,
	ENV_BUNDLED_SKILLS,
	ENV_MEMORY_CHAR_LIMIT,
	ENV_MEMORY_LINE_LIMIT,
	ENV_MEMORY_PREVIEW_LINES,
	ENV_TODO_MAX_LINES,
	ENV_TODO_TOGGLE_KEY,
	MODEL_ROLES,
	MODEL_SPEC_SEPARATOR,
	type ActionGuardMode,
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
	SETTINGS_KEY_STRONG_MODEL,
	SETTINGS_KEY_TODO,
	SETTINGS_KEY_TODO_START_COLLAPSED,
	SETTINGS_KEY_TODO_TOGGLE_KEY,
} from "./constants.ts";

/** Resolved memory limits. Unit: lines, JS string length, lines. */
export interface MemoryLimits {
	/** Excerpt lines per file. */
	previewLines: number;
	/** Character cap for the whole `spirits_memory` section. */
	injectionCharLimit: number;
	/** Line count above which a file is listed as a cleanup candidate. */
	fileLineLimit: number;
}

/** Resolved settings for the session TODO panel. */
export interface TodoConfig {
	/** TODO item lines shown before the counts line. Unit: lines. */
	maxLines: number;
	/** Key that collapses and expands the panel, in pi's `ctrl+shift+l` spelling. */
	toggleKey: string;
	/** True only when the settings file sets `todo.startCollapsed` to the boolean `true`. */
	startCollapsed: boolean;
}

/** Resolved settings for the bundled skills. */
export interface BundledSkillsConfig {
	/** False only when `SPIRITS_BUNDLED_SKILLS=0`; unset or any other value keeps them enabled. */
	enabled: boolean;
}

/** Resolved configuration for the continual harness. */
export interface SpiritsConfig {
	memory: MemoryLimits;
	todo: TodoConfig;
	bundledSkills: BundledSkillsConfig;
}

/** Positive decimal integers only: rejects empty, signs, decimals, and leading zeros. */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/** The only value of a feature switch that disables the feature. */
const DISABLED_FLAG_VALUE = "0";

/** Environment shape accepted by `loadConfig`. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

function readLimit(env: EnvLike, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || !POSITIVE_INTEGER_PATTERN.test(raw)) {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) {
		return fallback;
	}
	return value;
}

/** Read a feature switch where only `0` disables the feature (unset and other values enable it). */
function readEnabled(env: EnvLike, name: string): boolean {
	return env[name] !== DISABLED_FLAG_VALUE;
}

/**
 * Resolve the bash guard mode. Unlike the numeric limits, an unusable value is not a silent fallback
 * to "the loosest reading": only an exact match on one of {@link ACTION_GUARD_MODES} selects that
 * mode, so a typo, a blank, a cased variant, and a padded value all keep blocking.
 */
export function readActionGuardMode(env: EnvLike): ActionGuardMode {
	const raw = env[ENV_ACTION_GUARD];
	return ACTION_GUARD_MODES.find((mode) => mode === raw) ?? ACTION_GUARD_MODE_ENFORCE;
}

/** Strong model target read from the settings file. */
export interface StrongModelSpec {
	/** Provider part of the setting. Absent when the setting names only a model id. */
	provider?: string;
	/** Model id part of the setting. */
	modelId: string;
}

/** Read one key of a settings object whose shape the caller does not control. */
function settingsValue(settings: unknown, key: string): unknown {
	if (typeof settings !== "object" || settings === null) return undefined;
	return (settings as Record<string, unknown>)[key];
}

/** Read a top-level settings key that must be a non-blank string. */
function readStringSetting(settings: unknown, key: string): string | undefined {
	const raw = settingsValue(settings, key);
	if (typeof raw !== "string") return undefined;
	return raw.trim() ? raw.trim() : undefined;
}

/**
 * Resolve the spirits `models.strong` setting (design Decision 1). pi keeps unknown settings keys,
 * so the value is whatever the file holds: a missing key, a non-string, a blank value, or a spec
 * with an empty provider or model id is unset.
 */
export function readStrongModelSetting(settings: unknown): StrongModelSpec | undefined {
	const raw = settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), SETTINGS_KEY_STRONG_MODEL);
	if (typeof raw !== "string") return undefined;
	const value = raw.trim();
	if (!value) return undefined;
	const separator = value.indexOf(MODEL_SPEC_SEPARATOR);
	if (separator === -1) return { modelId: value };
	const provider = value.slice(0, separator).trim();
	const modelId = value.slice(separator + MODEL_SPEC_SEPARATOR.length).trim();
	if (!provider || !modelId) return undefined;
	return { provider, modelId };
}

/**
 * Resolve the spirits `models.role` setting (add-model-role-setting design Decision 4). Same rule as
 * `models.strong`: a missing key, a non-string, or a blank value is unset. Anything that is not a
 * role name, in any casing, is unset too, and the caller falls back to normal without a notice.
 */
export function readDefaultRoleSetting(settings: unknown): string | undefined {
	const raw = settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), SETTINGS_KEY_ROLE);
	if (typeof raw !== "string") return undefined;
	const value = raw.trim().toLowerCase();
	return MODEL_ROLES.includes(value) ? value : undefined;
}

/** Settings the router reads for one request. */
export interface RoutingSettings {
	/** Default role for a new session, from `models.role`. Absent when unset or invalid. */
	defaultRole?: string;
	/** Configured strong target. Absent when the key is unset, blank, or not a string. */
	strong?: StrongModelSpec;
	/** Provider of pi's default model, the normal target. */
	defaultProvider?: string;
	/** Model id of pi's default model, the normal target. */
	defaultModelId?: string;
}

/**
 * Read the settings the router needs. pi owns `defaultProvider` and `defaultModel`; `models.strong`
 * is a spirits key that pi only carries along (design Decision 1).
 */
export function readRoutingSettings(settings: unknown): RoutingSettings {
	const strong = readStrongModelSetting(settings);
	const defaultRole = readDefaultRoleSetting(settings);
	const defaultProvider = readStringSetting(settings, SETTINGS_KEY_DEFAULT_PROVIDER);
	const defaultModelId = readStringSetting(settings, SETTINGS_KEY_DEFAULT_MODEL);
	return {
		...(defaultRole ? { defaultRole } : {}),
		...(strong ? { strong } : {}),
		...(defaultProvider ? { defaultProvider } : {}),
		...(defaultModelId ? { defaultModelId } : {}),
	};
}

/**
 * Key syntax accepted for the panel toggle key: modifiers in any order, then one base key. The base
 * key is a run of alphanumerics or a single ASCII symbol except `+`, because pi splits a key id on
 * `+` and cannot read `ctrl++`. The symbol ranges are 0x21-0x2F (minus `+`), 0x3A-0x40, 0x5B-0x60,
 * and 0x7B-0x7E. Whether the base key names a real key is not checked: pi-tui keeps its key list in
 * types only, and a spirits-side list would duplicate it (design Decision 3).
 */
const TOGGLE_KEY_PATTERN = /^(?:(?:ctrl|shift|alt|super)\+)*(?:[a-z0-9]+|[!-*,-/:-@[-`{-~])$/;

/** Normalize a toggle key candidate to lowercase without surrounding space, or unset it. */
function readToggleKey(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return TOGGLE_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

/**
 * Resolve the TODO panel settings (design Decision 3/4). The toggle key is the first candidate that
 * parses: `todo.toggleKey` in the settings file, then `SPIRITS_TODO_TOGGLE_KEY`, then the default, so
 * a blank or unparseable candidate never claims the key. A candidate that parses but names no real
 * key is kept as given, because the alternative would silently reclaim the default key the user gave
 * up. `startCollapsed` is true only for the boolean `true`; an unreadable settings object reaches this
 * function as whatever the caller holds and reads as expanded.
 */
export function resolveTodoConfig(env: EnvLike, settings: unknown): TodoConfig {
	const todo = settingsValue(settings, SETTINGS_KEY_TODO);
	return {
		maxLines: readLimit(env, ENV_TODO_MAX_LINES, DEFAULT_TODO_MAX_LINES),
		toggleKey:
			readToggleKey(settingsValue(todo, SETTINGS_KEY_TODO_TOGGLE_KEY)) ??
			readToggleKey(env[ENV_TODO_TOGGLE_KEY]) ??
			DEFAULT_TODO_TOGGLE_KEY,
		startCollapsed: settingsValue(todo, SETTINGS_KEY_TODO_START_COLLAPSED) === true,
	};
}

/** Resolve the harness configuration, falling back to defaults for absent or invalid values. */
export function loadConfig(env: EnvLike): SpiritsConfig {
	return {
		memory: {
			previewLines: readLimit(env, ENV_MEMORY_PREVIEW_LINES, DEFAULT_MEMORY_PREVIEW_LINES),
			injectionCharLimit: readLimit(env, ENV_MEMORY_CHAR_LIMIT, DEFAULT_MEMORY_INJECTION_CHAR_LIMIT),
			fileLineLimit: readLimit(env, ENV_MEMORY_LINE_LIMIT, DEFAULT_MEMORY_FILE_LINE_LIMIT),
		},
		// No settings file: `loadConfig` only reads the environment, so the file-only candidates are unset.
		todo: resolveTodoConfig(env, {}),
		bundledSkills: {
			enabled: readEnabled(env, ENV_BUNDLED_SKILLS),
		},
	};
}
