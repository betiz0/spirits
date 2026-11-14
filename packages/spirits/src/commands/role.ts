/**
 * The role of a managed session, and the `/spirits-role` grammar that sets it.
 *
 * The fork route records the role in pi's `pi.virtual-model-state` entry, because the fork's role
 * patch is what writes that entry. On the official Pi that entry belongs to the core: its own reader
 * takes `{ provider, modelId, state }` from the newest matching record, and an extension writing a
 * role-shaped record there risks the state the core keeps in it. So the managed route writes its own
 * `spirits_role` entry and only *reads* pi's record, at session start, when spirits has written
 * nothing on the branch — the one-way handoff that lets a session a fork started continue on the
 * managed route with the role it had.
 *
 * The badge goes on `ui.setStatus()`. The official footer renders extension statuses on its own status
 * line, alphabetically by key, which is a different place from the fork's badge next to the model
 * name. It is not the fork badge, and `docs/spirits-managed-pi.md` says so.
 *
 * The grammar below is pure: it turns a line of arguments into an intent, or into a request for the
 * usage line. Nothing here touches the session or the settings file, so every branch of the grammar is
 * reachable from a test.
 */

import type { ExtensionContext, ExtensionModelRegistry, PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { IgnoredSetting, ModelSpec, RoutingSettings } from "../config.ts";
import { readRoleName } from "../config.ts";
import {
	MODEL_ROLES,
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	PI_VIRTUAL_MODEL_API,
	MODEL_SPEC_SEPARATOR,
	ROLE_ENTRY_TYPE,
	ROLE_STATUS_KEY,
	ROUTING_STATE_ENTRY_TYPE,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_NORMAL_MODEL,
	SETTINGS_KEY_ROLE,
	SETTINGS_KEY_STEPS,
	SETTINGS_KEY_THINKING,
	STEP_DEFINITIONS,
	THINKING_LEVELS,
} from "../constants.ts";
import type { ThinkingLevelName } from "../constants.ts";
import { modelKey, resolveNormalTarget, resolveStrongTarget } from "../routing/resolve.ts";

/** Control characters, including the escape that starts a terminal sequence. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** A role name in the vocabulary spirits registers, lowercased. Anything else is not a role. */
export function asRoleName(value: unknown): string | undefined {
	return readRoleName(value);
}

/** A thinking level in pi's vocabulary, lowercased. Anything else is not a level. */
export function asThinkingLevel(value: unknown): ThinkingLevelName | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return THINKING_LEVELS.find((level) => level === normalized);
}

/** A step name from the step list, matched without regard to case. Anything else is not a step. */
export function asStepName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return STEP_DEFINITIONS.find((step) => step.name === normalized)?.name;
}

/** The word that returns a setting to unset, matched case-insensitively like every other word. */
const UNSET_WORD = "unset";

/** The word that asks for the running report. */
const STATUS_WORD = "status";

/** One setting the command can change, named by the object it belongs to and the item of it. */
export type SettingItem =
	| { target: "role"; name: string; item: "model" | "thinking" }
	| { target: "step"; name: string; item: "role" | "thinking" };

/** What one `/spirits-role` line asked for. */
export type RoleCommand =
	/** No arguments: the settings list on a terminal, the running report anywhere else. */
	| { kind: "panel" }
	| { kind: "status" }
	| { kind: "lock"; role: string }
	/** Change one setting. `value` is `undefined` for `unset`, which deletes the key. */
	| { kind: "set"; setting: SettingItem; value: string | undefined }
	/** Anything the grammar cannot read, including a missing item or an empty value. */
	| { kind: "usage"; reason: string };

/** Split a command line into words, or an empty list for a line that is only space. */
function words(args: string): string[] {
	const trimmed = args.trim();
	return trimmed === "" ? [] : trimmed.split(/\s+/);
}

/** The model reference of a `model` item: the rest of the line, spaces and all. */
function restOfLine(tokens: readonly string[], from: number): string {
	return tokens.slice(from).join(" ");
}

/**
 * Read one `/spirits-role` argument line.
 *
 * The shape is *object item value*, and only a model reference is open-ended, because it is the only
 * value that can contain a space. Every word — object, item, value — is matched without regard to
 * case. A line that names neither a role nor a step nor `status`, an item that does not belong to the
 * object, and an empty value all come back as `usage` so the caller changes nothing (spec
 * `managed-commands` / 対象 項目 値の文法で設定する).
 */
export function parseRoleCommand(args: string): RoleCommand {
	const tokens = words(args);
	if (tokens.length === 0) return { kind: "panel" };
	const head = tokens[0].toLowerCase();
	if (head === STATUS_WORD) {
		if (tokens.length > 1) return { kind: "usage", reason: `status takes no arguments: ${tokens.slice(1).join(" ")}` };
		return { kind: "status" };
	}

	const role = asRoleName(head);
	if (role) {
		if (tokens.length === 1) return { kind: "lock", role };
		const item = tokens[1].toLowerCase();
		if (item !== "model" && item !== "thinking") {
			return { kind: "usage", reason: `${role} takes model or thinking, not ${tokens[1]}` };
		}
		// Only a model reference runs to the end of the line: a level is one word, so a line with more
		// than the three parts names nothing (`normal thinking high strong` is not a level plus a role).
		if (item === "thinking" && tokens.length > 3) {
			return { kind: "usage", reason: `${role} thinking takes one level, not ${tokens.slice(2).join(" ")}` };
		}
		const raw = item === "model" ? restOfLine(tokens, 2) : (tokens[2] ?? "");
		if (raw === "") {
			return { kind: "usage", reason: `${role} ${item} needs a value, or ${UNSET_WORD} to clear it` };
		}
		if (item === "model") {
			// `unset` is the one word a model reference cannot be: it means "delete the key", and a model
			// actually named `unset` would have to be picked from the panel anyway.
			if (raw.toLowerCase() === UNSET_WORD) return { kind: "set", setting: { target: "role", name: role, item }, value: undefined };
			return { kind: "set", setting: { target: "role", name: role, item }, value: raw };
		}
		const level = asThinkingLevel(raw);
		if (!level) {
			if (raw.toLowerCase() === UNSET_WORD) return { kind: "set", setting: { target: "role", name: role, item }, value: undefined };
			return { kind: "usage", reason: `${raw} is not a thinking level: ${THINKING_LEVELS.join(", ")}, or ${UNSET_WORD}` };
		}
		return { kind: "set", setting: { target: "role", name: role, item }, value: level };
	}

	const step = asStepName(head);
	if (step) {
		if (tokens.length === 1) return { kind: "usage", reason: `${step} needs role or thinking, then a value` };
		const item = tokens[1].toLowerCase();
		if (item !== "role" && item !== "thinking") {
			return { kind: "usage", reason: `the ${step} step takes role or thinking, not ${tokens[1]}` };
		}
		// A step value is one word — a role name or a level — so anything after it is not part of the line.
		if (tokens.length > 3) return { kind: "usage", reason: `${step} ${item} takes one value, not ${tokens.slice(2).join(" ")}` };
		const raw = tokens[2] ?? "";
		if (raw === "") return { kind: "usage", reason: `${step} ${item} needs a value, or ${UNSET_WORD} to clear it` };
		if (raw.toLowerCase() === UNSET_WORD) return { kind: "set", setting: { target: "step", name: step, item }, value: undefined };
		if (item === "role") {
			const value = asRoleName(raw);
			if (!value) return { kind: "usage", reason: `${raw} is not a role: ${MODEL_ROLES.join(", ")}, or ${UNSET_WORD}` };
			return { kind: "set", setting: { target: "step", name: step, item }, value };
		}
		const level = asThinkingLevel(raw);
		if (!level) return { kind: "usage", reason: `${raw} is not a thinking level: ${THINKING_LEVELS.join(", ")}, or ${UNSET_WORD}` };
		return { kind: "set", setting: { target: "step", name: step, item }, value: level };
	}

	return { kind: "usage", reason: `${tokens[0]} is not a role, a step, or status` };
}

/** The settings path one setting occupies in pi's settings file, as a `models.…` key path. */
export function settingPath(setting: SettingItem): readonly string[] {
	if (setting.target === "role") {
		return setting.item === "model" ? ["models", setting.name] : ["models", "thinking", setting.name];
	}
	return ["models", "steps", setting.name, setting.item];
}

/** The command line that would have produced this setting, shown back in reports and warnings. */
export function settingCommand(setting: SettingItem, value: string): string {
	return `/spirits-role ${setting.name} ${setting.item} ${value}`;
}

function entryData(entry: SessionEntry): Record<string, unknown> | undefined {
	if (entry.type !== "custom") return undefined;
	const data = entry.data;
	return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
}

/** Newest `spirits_role` entry on the branch, or undefined. */
export function spiritsRoleEntry(branch: readonly SessionEntry[]): string | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== ROLE_ENTRY_TYPE) continue;
		const role = asRoleName(entryData(entry)?.role);
		if (role) return role;
	}
	return undefined;
}

/**
 * Newest role a fork wrote in pi's routing-state entry, or undefined. Read-only by design: the
 * managed route never appends to that entry.
 */
export function forkRoleRecord(branch: readonly SessionEntry[]): string | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== ROUTING_STATE_ENTRY_TYPE) continue;
		const role = asRoleName(entryData(entry)?.role);
		if (role) return role;
	}
	return undefined;
}

/**
 * The role a session inherits at start: spirits' own record first, then a fork's record, then
 * nothing. The caller falls back to `normal` when this is undefined.
 */
export function inheritedRole(branch: readonly SessionEntry[]): string | undefined {
	return spiritsRoleEntry(branch) ?? forkRoleRecord(branch);
}

/** A model reference resolved against the models pi has available. */
export type ModelTargetResult = { model: PiModel } | { error: string };

/**
 * Resolve a reference to one available model: exact `provider/id` first, then a case-insensitive
 * substring of `provider/id` or of the bare id.
 *
 * Virtual models are excluded by their api, the same test the routing lookup uses: a virtual entry
 * routes requests instead of answering them, so it can never be a role target. Naming is not the test,
 * because the routing entry is free to be called anything. The rule is the one the retired
 * model-selection command used, so a reference that resolved then resolves now.
 */
export function resolveModelTarget(models: readonly PiModel[], ref: string): ModelTargetResult {
	const wanted = ref.trim().toLowerCase();
	if (wanted === "") return { error: "no model reference given" };

	const candidates = models.filter((model) => model.api !== PI_VIRTUAL_MODEL_API);
	const exact = candidates.find((model) => `${model.provider}/${model.id}`.toLowerCase() === wanted);
	if (exact) return { model: exact };

	const matches = candidates.filter(
		(model) => `${model.provider}/${model.id}`.toLowerCase().includes(wanted) || model.id.toLowerCase().includes(wanted),
	);
	if (matches.length === 1) return { model: matches[0] };
	if (matches.length === 0) return { error: `no model matches "${ref}"` };
	return {
		error: `"${ref}" matches ${matches.length} models, be more specific: ${matches.slice(0, 5).map(formatModelKey).join(", ")}`,
	};
}

/** Reference shown to the user: what they can type back. */
export function formatModelKey(model: Pick<PiModel, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

/** The last request the route answered, as the routing layer remembered it. */
export interface LastRequestReport {
	role: string;
	/** Physical model that answered, already in `provider/id` spelling. */
	model: string;
	/** Thinking level the request asked for, before pi rounded it to the model. */
	thinkingLevel?: string;
}

/** Where a role's target came from, in the words `status` shows. */
export interface RoleResolutionLine {
	role: string;
	/** The target, or why there is none. */
	target: string;
	/** Which setting, or pi's default, or the last response. */
	source: string;
}

/** The words `target` holds when no model answers. Anything else is a model reference. */
const NO_ANSWER_TARGETS: readonly string[] = ["unset", "unusable", "unreadable", "unresolved"];

/**
 * Whether a resolution line names the model that answers, rather than the reason that none does.
 *
 * A row and a report line both spell the two in the same field, so the difference between "nothing is
 * saved" and "this answers" is one decision made here rather than four string comparisons repeated at
 * each reader.
 */
export function targetAnswers(line: RoleResolutionLine): boolean {
	return !NO_ANSWER_TARGETS.includes(line.target);
}

/** Everything `/spirits-role status` reports, gathered by the caller so the text stays testable. */
export interface RoleStatusReport {
	/** True when the session selected the routing model, so the routing is in force. */
	routingEnabled: boolean;
	lock: string;
	/** The running step, or undefined when the session runs on the lock alone. */
	step?: { name: string; continuing: boolean; role: string };
	last?: LastRequestReport;
	normal: RoleResolutionLine;
	strong: RoleResolutionLine;
	/** Step settings that differ from the step list's own defaults, already one line each. */
	stepSettings: readonly string[];
	/** Settings values routing ignores, already one line each. */
	ignored: readonly string[];
}

/**
 * Render the running report as one message.
 *
 * The order follows the question a user asks when routing is not doing what they set: is it on at all,
 * what is locked, what step is running, what the last request actually used, where each role's model
 * comes from, and what the settings file holds that routing will not read.
 */
export function formatRoleStatus(report: RoleStatusReport): string {
	const lines: string[] = [
		report.routingEnabled ? "routing: on (spirits/auto is selected)" : "routing: off (a physical model is selected)",
		`lock: ${report.lock}`,
	];
	if (report.step) {
		// The lock and the role the step runs on are two different answers, and a strong-default step is
		// exactly where they come apart.
		lines.push(
			`step: ${report.step.name} (${report.step.continuing ? "continuing" : "ends with the run"}) runs ${report.step.role}`,
		);
	} else {
		lines.push("step: none");
	}
	lines.push(
		report.last
			? `last request: ${report.last.role} on ${report.last.model}${report.last.thinkingLevel ? ` at ${report.last.thinkingLevel}` : ""}`
			// The last request lives in the extension's memory only, and a settings write reloads the
			// runtime, so "nothing" after a reload is a fact about the runtime, not about the session.
			: "last request: none since the last reload",
	);
	lines.push(`normal: ${report.normal.target} (${report.normal.source})`);
	lines.push(`strong: ${report.strong.target} (${report.strong.source})`);
	if (report.stepSettings.length > 0) lines.push(`step settings: ${report.stepSettings.join("; ")}`);
	if (report.ignored.length > 0) lines.push(`ignored settings: ${report.ignored.join("; ")}`);
	return lines.join("\n");
}

/**
 * The one line a setting change may need, or undefined when the change needs no notice.
 *
 * Only two things are worth saying at the moment of a change, and neither takes the change back: a
 * strong that nothing resolves to, and a session that is not on the routing model so no routing is in
 * force yet (spec `managed-commands` / 設定時は振り分けの効きを伝える). Notices at request time keep
 * their own rules; this is the only place a setting is commented on.
 */
export function roleSettingWarning(options: {
	/** What the line changed, for the wording and for the command shown back. */
	setStrong: boolean;
	/** True when nothing resolves strong: no `models.strong`, or a target pi cannot use. */
	strongUnresolved: boolean;
	/** True when the session has a physical model selected instead of the routing model. */
	physicalModelSelected: boolean;
	/** How the routing model is spelled to the user, so the line names something they can select. */
	routingModel?: string;
}): string | undefined {
	const parts: string[] = [];
	if (options.setStrong && options.strongUnresolved) {
		parts.push(`strong has no usable model, so these requests run ${MODEL_ROLE_NORMAL}. set one with /spirits-role ${MODEL_ROLE_STRONG} model <provider/id>.`);
	}
	if (options.physicalModelSelected) {
		parts.push(`routing is off while a physical model is selected; select ${options.routingModel ?? "spirits/auto"} to put this to work.`);
	}
	return parts.length === 0 ? undefined : parts.join(" ");
}

/** The settings key path of a role's target, spelled like the file nests it. */
export function roleTargetKeyPath(role: string): string {
	return role === MODEL_ROLE_STRONG
		? `${SETTINGS_KEY_MODELS}.${MODEL_ROLE_STRONG}`
		: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL}`;
}

/**
 * Why a configured model reference did not resolve, named well enough to fix.
 *
 * The three reasons a target cannot answer are different mistakes — a typo, the routing model itself,
 * a provider without credentials — and the catalog read is what tells them apart: `getAvailable()`
 * already hides an unauthenticated provider, so only `find()` sees it.
 */
export function unusableTargetReason(
	lookup: ExtensionModelRegistry,
	spec: ModelSpec,
	defaultProvider?: string,
): string {
	const provider = spec.provider ?? defaultProvider;
	if (!provider) return `names no provider, and the session has no default provider to read ${spec.modelId} against`;
	const model = lookup.find(provider, spec.modelId);
	if (!model) return `${provider}${MODEL_SPEC_SEPARATOR}${spec.modelId} is not in the model catalog`;
	if (model.api === PI_VIRTUAL_MODEL_API) return `${modelKey(model)} is the routing model itself`;
	if (!lookup.hasConfiguredAuth(model)) return `${modelKey(model)} has no credentials for ${provider}`;
	return `${modelKey(model)} is not available for selection`;
}

/** The thinking level a role asks for, appended to that role's source when it asks for one. */
function thinkingSuffix(settings: RoutingSettings, role: string): string {
	const level = settings.thinking?.[role === MODEL_ROLE_STRONG ? "strong" : "normal"];
	return level ? `, thinking ${level}` : "";
}

/** Where normal landed: the setting, pi's default model, or the last successful response. */
function normalLanding(source: "spec" | "default" | "previous"): string {
	return source === "spec"
		? `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL}`
		: source === "default"
			? "pi's default model"
			: "the last successful response";
}

/**
 * Resolve both roles with the router's own functions, so a report never shows a model that would not
 * answer.
 *
 * An unset target and an unusable one are different problems, and an unusable one names the reason and
 * the model that answers instead (spec `managed-commands` / status のロックと解決結果は実際の位相と解決を
 * 示す). Reading the settings and printing them would hide both: `models.strong` set to a retired model
 * reads back as a target that is never used.
 */
export function roleResolutionLines(
	settings: RoutingSettings,
	lookup: ExtensionModelRegistry,
	options: { previous?: PiModel; ignored?: readonly IgnoredSetting[] } = {},
): { normal: RoleResolutionLine; strong: RoleResolutionLine } {
	const { previous } = options;
	// A key the file holds but the readers drop is neither unset nor unusable-at-runtime: it is a value
	// routing never looked at, and the reason is the settings reader's own words.
	const unreadable = (path: string): string | undefined => options.ignored?.find((entry) => entry.path === path)?.reason;
	const normal = resolveNormalTarget({
		lookup,
		...(settings.normal ? { spec: settings.normal } : {}),
		...(settings.defaultProvider ? { defaultProvider: settings.defaultProvider } : {}),
		...(settings.defaultModelId ? { defaultModelId: settings.defaultModelId } : {}),
		...(previous ? { previous: { model: previous } } : {}),
	});
	const answers = normal ? modelKey(normal.model) : undefined;
	const normalSource = !normal
		? "nothing resolves normal: no usable target, default model, or successful response"
		: normal.source === "spec" || !settings.normal
			? `${normalLanding(normal.source)}${thinkingSuffix(settings, MODEL_ROLE_NORMAL)}`
			: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL} ${unusableTargetReason(lookup, settings.normal, settings.defaultProvider)}; running ${normalLanding(normal.source)}`;

	// What a strong request carries when strong has nothing to run on: the level of the role that answers,
	// which is normal. A report that showed only strong's own level would name a level no request sends
	// (spec `managed-commands` / status のロックと解決結果は実際の位相と解決を示す).
	const carriedByFallback = thinkingSuffix(settings, MODEL_ROLE_NORMAL).replace(/^, /, "; carries ");
	// Where the model that answers instead came from, because "it runs X" without a source leaves the user
	// looking for a setting that does not hold it.
	const answersSource = normal ? ` (${normalLanding(normal.source)})` : "";

	const normalUnreadable = !settings.normal ? unreadable(`${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL}`) : undefined;
	const normalLine: RoleResolutionLine = normalUnreadable
		? { role: MODEL_ROLE_NORMAL, target: "unreadable", source: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL} ${normalUnreadable}` }
		: { role: MODEL_ROLE_NORMAL, target: answers ?? "unresolved", source: normalSource };
	const strongKey = `${SETTINGS_KEY_MODELS}.${MODEL_ROLE_STRONG}`;

	if (!settings.strong) {
		const strongUnreadable = unreadable(strongKey);
		return {
			normal: normalLine,
			strong: strongUnreadable
				? { role: MODEL_ROLE_STRONG, target: "unreadable", source: `${strongKey} ${strongUnreadable}` }
				: { role: MODEL_ROLE_STRONG, target: "unset", source: `${strongKey} is not set${carriedByFallback}` },
		};
	}
	const strong = resolveStrongTarget({ lookup, spec: settings.strong, defaultProvider: settings.defaultProvider });
	if (strong) {
		return {
			normal: normalLine,
			strong: { role: MODEL_ROLE_STRONG, target: modelKey(strong), source: `${strongKey}${thinkingSuffix(settings, MODEL_ROLE_STRONG)}` },
		};
	}
	return {
		normal: normalLine,
		strong: {
			role: MODEL_ROLE_STRONG,
			target: "unusable",
			source:
				`${strongKey} ${unusableTargetReason(lookup, settings.strong, settings.defaultProvider)}` +
				`; runs ${answers ?? "nothing"}${answers ? answersSource : ""}${carriedByFallback}`,
		},
	};
}

/** The step settings that differ from the step list, one line each, in the list's own order. */
export function stepSettingLines(settings: RoutingSettings): string[] {
	const lines: string[] = [];
	for (const definition of STEP_DEFINITIONS) {
		const entry = settings.steps?.[definition.name];
		if (!entry) continue;
		const parts: string[] = [];
		if (entry.role && entry.role !== definition.defaultRole) parts.push(`${SETTINGS_KEY_ROLE} ${entry.role}`);
		if (entry.thinking) parts.push(`${SETTINGS_KEY_THINKING} ${entry.thinking}`);
		if (parts.length === 0) continue;
		lines.push(`${definition.name} ${parts.join(", ")}`);
	}
	return lines;
}

/** Key paths of the spirits setting keys, for reports that name where a value lives. */
export const SETTINGS_PATHS = {
	role: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_ROLE}`,
	steps: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_STEPS}`,
} as const;

/**
 * One printable line for a role: control characters and the escape that opens a terminal sequence
 * are removed, and a role that leaves nothing behind prints nothing. Without the strip, a role read
 * from a hand-edited settings file or a foreign session entry could reformat the terminal.
 */
export function roleBadgeText(role: string | undefined): string | undefined {
	if (role === undefined) return undefined;
	const printable = role.replace(CONTROL_CHARACTERS, "").trim();
	return printable === "" ? undefined : `[${printable}]`;
}

/** The footer status line the managed route shows the role on. */
export interface RoleBadge {
	/** Render `role`, or clear the line when there is nothing to show. */
	update(role: string | undefined, ctx: Pick<ExtensionContext, "ui">): void;
}

/** Build the badge. It holds no state: the role always comes from the session or the route. */
export function createRoleBadge(): RoleBadge {
	return {
		update(role, ctx) {
			ctx.ui.setStatus(ROLE_STATUS_KEY, roleBadgeText(role));
		},
	};
}
