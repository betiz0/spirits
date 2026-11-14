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
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	MODEL_SPEC_SEPARATOR,
	type ActionGuardMode,
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_NORMAL_MODEL,
	SETTINGS_KEY_ROLE,
	SETTINGS_KEY_STEPS,
	SETTINGS_KEY_STRONG_MODEL,
	SETTINGS_KEY_THINKING,
	SETTINGS_KEY_TODO,
	SETTINGS_KEY_TODO_START_COLLAPSED,
	SETTINGS_KEY_TODO_TOGGLE_KEY,
	STEP_DEFINITIONS,
	THINKING_LEVELS,
	type ThinkingLevelName,
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

/** Model target read from the settings file: `provider/id`, or a bare model id. */
export interface ModelSpec {
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
export function readStrongModelSetting(settings: unknown): ModelSpec | undefined {
	return readModelSpecSetting(settings, SETTINGS_KEY_STRONG_MODEL);
}

/**
 * Read one `models.<key>` model reference. A missing key, a non-string, a blank value, or a spec with
 * an empty provider or model id is unset. `models.strong` and `models.normal` differ only in what the
 * caller does with the result, so they share the reading rule (spec `dual-model-routing` /
 * normal ロールの対象設定).
 */
export function readModelSpecSetting(settings: unknown, key: string): ModelSpec | undefined {
	const raw = settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), key);
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
	return readRoleName(settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), SETTINGS_KEY_ROLE));
}

/** One step's settings, as read from `models.steps.<name>`. Both parts are optional. */
export interface StepSettings {
	/** Role the step takes, already inside the role vocabulary. */
	role?: string;
	/** Thinking level the step asks for, already inside the level vocabulary. */
	thinking?: ThinkingLevelName;
}

/** Settings the router reads for one request. */
export interface RoutingSettings {
	/** Default role for a new session, from `models.role`. Absent when unset or invalid. */
	defaultRole?: string;
	/** Configured strong target. Absent when the key is unset, blank, or not a string. */
	strong?: ModelSpec;
	/** Configured normal target. Absent means pi's own default model fills it. */
	normal?: ModelSpec;
	/** Per-role thinking levels. Absent per role when unset or not a level word. */
	thinking?: { normal?: ThinkingLevelName; strong?: ThinkingLevelName };
	/** Per-step settings, holding only listed step names and only readable values. */
	steps?: Record<string, StepSettings>;
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
	const normal = readModelSpecSetting(settings, SETTINGS_KEY_NORMAL_MODEL);
	const defaultRole = readDefaultRoleSetting(settings);
	const defaultProvider = readStringSetting(settings, SETTINGS_KEY_DEFAULT_PROVIDER);
	const defaultModelId = readStringSetting(settings, SETTINGS_KEY_DEFAULT_MODEL);
	const thinking = readRoleThinkingSettings(settings);
	const steps = readStepSettings(settings);
	return {
		...(defaultRole ? { defaultRole } : {}),
		...(strong ? { strong } : {}),
		...(normal ? { normal } : {}),
		...(thinking ? { thinking } : {}),
		...(steps ? { steps } : {}),
		...(defaultProvider ? { defaultProvider } : {}),
		...(defaultModelId ? { defaultModelId } : {}),
	};
}

/**
 * Resolve one thinking level candidate. A missing key, a non-string, a blank value, or a word outside
 * the `off..max` vocabulary is unset; casing is ignored, because the command writes the same words it
 * reads. The caller decides what unset means and never notifies for it.
 */
export function readThinkingLevel(value: unknown): ThinkingLevelName | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return THINKING_LEVELS.find((level) => level === normalized);
}

/** Read `models.thinking.normal` and `models.thinking.strong`. Undefined when neither role carries one. */
export function readRoleThinkingSettings(settings: unknown): RoutingSettings["thinking"] | undefined {
	const thinking = settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), SETTINGS_KEY_THINKING);
	const normal = readThinkingLevel(settingsValue(thinking, MODEL_ROLE_NORMAL));
	const strong = readThinkingLevel(settingsValue(thinking, MODEL_ROLE_STRONG));
	if (!normal && !strong) return undefined;
	return { ...(normal ? { normal } : {}), ...(strong ? { strong } : {}) };
}

/** One settings value spirits could read from the file but cannot use. */
export interface IgnoredSetting {
	/** Key path shown to the user, spelled like the file nests it. */
	path: string;
	/** Why the value is not used, in the words the status report shows. */
	reason: string;
}

/**
 * List the `models` values a user set that routing will ignore.
 *
 * Reading stays silent (a bad value must not spam every request), so the only place a user can learn
 * that `models.steps.opsx-sync.role: true` does nothing is `status`. This walk reports exactly what the
 * readers above drop: a key outside the step list, a value outside either vocabulary, a blank, a type
 * that is not a string. It reports nothing the user did not write, and it never rewrites the file.
 */
export function readIgnoredSettings(settings: unknown): IgnoredSetting[] {
	const models = settingsValue(settings, SETTINGS_KEY_MODELS);
	const ignored: IgnoredSetting[] = [];
	if (models === undefined) return ignored;
	if (!isSettingsObject(models)) return [{ path: SETTINGS_KEY_MODELS, reason: "the models key is not an object" }];

	// A value that is written but unreadable is a different fact from a key that is absent, so each key
	// the routing reads is checked against its own reader. `models.role` and `models.strong` are the two
	// the router has read longest, and they were the two a user could not ask about.
	if (models[SETTINGS_KEY_ROLE] !== undefined && !readDefaultRoleSetting(settings)) {
		ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_ROLE}`, reason: "not a role name" });
	}
	if (models[SETTINGS_KEY_STRONG_MODEL] !== undefined && !readModelSpecSetting(settings, SETTINGS_KEY_STRONG_MODEL)) {
		ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STRONG_MODEL}`, reason: "not a provider/id or model id" });
	}
	if (models[SETTINGS_KEY_NORMAL_MODEL] !== undefined && !readModelSpecSetting(settings, SETTINGS_KEY_NORMAL_MODEL)) {
		ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL}`, reason: "not a provider/id or model id" });
	}
	const thinking = models[SETTINGS_KEY_THINKING];
	if (thinking !== undefined) {
		if (!isSettingsObject(thinking)) {
			ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_THINKING}`, reason: "not an object of role names" });
		} else {
			for (const [role, value] of Object.entries(thinking)) {
				if (!MODEL_ROLES.includes(role)) {
					ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_THINKING}.${role}`, reason: "not a role name" });
				} else if (!readThinkingLevel(value)) {
					ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_THINKING}.${role}`, reason: "not a thinking level" });
				}
			}
		}
	}
	const steps = models[SETTINGS_KEY_STEPS];
	if (steps === undefined) return ignored;
	if (!isSettingsObject(steps)) {
		ignored.push({ path: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STEPS}`, reason: "not an object of step names" });
		return ignored;
	}
	for (const [name, entry] of Object.entries(steps)) {
		const path = `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STEPS}.${name}`;
		// Matched exactly, the way `readStepSettings` reads them: a key spelled differently is a step that
		// is not on the list, not a step whose settings were misread.
		const listed = STEP_DEFINITIONS.some((step) => step.name === name);
		if (!listed) {
			ignored.push({ path, reason: "not a step on the list" });
			continue;
		}
		if (!isSettingsObject(entry)) {
			ignored.push({ path, reason: "not an object of role and thinking" });
			continue;
		}
		for (const [item, value] of Object.entries(entry)) {
			const usable = item === SETTINGS_KEY_ROLE ? readRoleName(value) : item === SETTINGS_KEY_THINKING ? readThinkingLevel(value) : undefined;
			if (usable === undefined) ignored.push({ path: `${path}.${item}`, reason: `not a usable ${item}` });
		}
	}
	return ignored;
}

/** Whether a settings value is the kind of object a settings key nests into. */
function isSettingsObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve one role name candidate against the role vocabulary, ignoring casing. */
export function readRoleName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return MODEL_ROLES.includes(normalized) ? normalized : undefined;
}

/**
 * Read `models.steps.<name>` for every step on the list.
 *
 * A name that is not on the list is dropped, so a stale or hand-written entry cannot route a request.
 * A value that is not a role word or a level word is dropped on its own, leaving the step's other part
 * readable. The settings file is never written back, and nothing is notified (spec `dual-model-routing`
 * / ステップ設定の読み取り).
 */
export function readStepSettings(settings: unknown): Record<string, StepSettings> | undefined {
	const steps = settingsValue(settingsValue(settings, SETTINGS_KEY_MODELS), SETTINGS_KEY_STEPS);
	if (typeof steps !== "object" || steps === null || Array.isArray(steps)) return undefined;
	const result: Record<string, StepSettings> = {};
	for (const definition of STEP_DEFINITIONS) {
		const entry = settingsValue(steps, definition.name);
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const role = readRoleName(settingsValue(entry, SETTINGS_KEY_ROLE));
		const thinking = readThinkingLevel(settingsValue(entry, SETTINGS_KEY_THINKING));
		if (!role && !thinking) continue;
		result[definition.name] = { ...(role ? { role } : {}), ...(thinking ? { thinking } : {}) };
	}
	return Object.keys(result).length > 0 ? result : undefined;
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
