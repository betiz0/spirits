/**
 * Layer 3 configuration: values the operator can change per environment.
 *
 * The memory limits are read once at extension load. Invalid values fall back to the
 * Layer 2 defaults instead of failing startup (design Decision 11).
 *
 * The strong model target also comes from the operator, but from pi's settings file rather than
 * the environment, so it is resolved on every read and never cached (design Decision 1).
 */

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
	MODEL_SPEC_SEPARATOR,
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_STRONG_MODEL,
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

/** Settings the router reads for one request. */
export interface RoutingSettings {
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
	const defaultProvider = readStringSetting(settings, SETTINGS_KEY_DEFAULT_PROVIDER);
	const defaultModelId = readStringSetting(settings, SETTINGS_KEY_DEFAULT_MODEL);
	return {
		...(strong ? { strong } : {}),
		...(defaultProvider ? { defaultProvider } : {}),
		...(defaultModelId ? { defaultModelId } : {}),
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
		todo: {
			maxLines: readLimit(env, ENV_TODO_MAX_LINES, DEFAULT_TODO_MAX_LINES),
		},
		bundledSkills: {
			enabled: readEnabled(env, ENV_BUNDLED_SKILLS),
		},
	};
}
