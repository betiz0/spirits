/**
 * The role of a managed session, and the `/spirits-role` grammar that sets it.
 *
 * A session's own role lives in the `spirits_role` entry this surface writes. The host keeps a state
 * entry of its own (`pi.virtual-model-state`), and its reader takes `{ provider, modelId, state }` from
 * the newest matching record, so an extension that wrote a role-shaped record there would risk the
 * state the host keeps in it. Releases before the fork deletion wrote their role in exactly that entry, so
 * {@link forkRoleRecord} reads it at session start and never writes it back: the one-way handoff that
 * lets a session an older release started continue with the role it had.
 *
 * The badge goes on `ui.setStatus()`. The official footer renders extension statuses on its own status
 * line, alphabetically by key, and `docs/spirits-managed-pi.md` says so.
 *
 * The grammar below is pure: it turns a line of arguments into an intent, or into a request for the
 * usage line. Nothing here touches the session or the settings file, so every branch of the grammar is
 * reachable from a test.
 */

import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ExtensionModelRegistry, PiModel, ThinkingLevel } from "../types/host.ts";
import type { IgnoredSetting, ModelSpec, RoutingSettings } from "../config.ts";
import { readRoleName } from "../config.ts";
import {
	HOST_COMMANDS,
	MODEL_ROLES,
	MODEL_ROLE_NORMAL,
	MODEL_ROLE_STRONG,
	PI_VIRTUAL_MODEL_API,
	MODEL_SPEC_SEPARATOR,
	ROLE_BADGE_NONE,
	ROLE_BADGE_OFF,
	ROLE_ENTRY_TYPE,
	ROLE_MODEL_DISPLAY_MAX_LENGTH,
	ROLE_MODEL_ELLIPSIS_AFTER,
	ROLE_MODEL_STATUS_KEY,
	ROLE_STATUS_KEY,
	ROUTING_MODEL_REFERENCE,
	ROUTING_STATE_ENTRY_TYPE,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_NORMAL_MODEL,
	SETTINGS_KEY_ROLE,
	SETTINGS_KEY_STEPS,
	SETTINGS_KEY_THINKING,
	STEP_DEFINITIONS,
	THINKING_LEVELS,
	ROLE_SAVE_WORD,
	isRoutingModel,
} from "../constants.ts";
import type { ThinkingLevelName } from "../constants.ts";
import { resolveRequestPlan } from "../routing/plan.ts";
import type { RequestPlanInput } from "../routing/plan.ts";
import { modelKey, resolveNormalTarget, resolveStrongTarget } from "../routing/resolve.ts";

/** Status wording for a session whose host context has no selected model. */
const NO_MODEL_SELECTED_LABEL = "no model is selected";

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
	/** Write the session's own selection into pi's global settings. It takes no item and no value. */
	| { kind: "save" }
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
	// `save` is the one target that names an action rather than something to change, so it owns no item
	// and no value — and a line that continues it names nothing (spec `managed-commands` /
	// save に項目や値を続けない).
	if (head === ROLE_SAVE_WORD) {
		if (tokens.length > 1) {
			return { kind: "usage", reason: `${ROLE_SAVE_WORD} takes no item or value: ${tokens.slice(1).join(" ")}` };
		}
		return { kind: "save" };
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

	return { kind: "usage", reason: `${tokens[0]} is not a role, a step, status, or ${ROLE_SAVE_WORD}` };
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
 * Newest role an older release wrote in the host's routing-state entry, or undefined. Read-only by
 * design: the managed route never appends to that entry, so the host keeps it alone.
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
 * The role a session inherits at start: spirits' own record first, then an older release's record,
 * then nothing. The caller falls back to `normal` when this is undefined.
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
	/** The model the session holds, in `provider/id` spelling; absent when no model is selected. */
	sessionModel?: string;
	/** False when the session's model scope leaves the routing model out, which changes the way out. */
	routingModelInScope: boolean;
	/**
	 * False when the session's catalog does not hold the routing model at all — the routing failed to
	 * register — which leaves no procedure worth naming. Read through {@link routingModelAvailable}.
	 */
	routingModelAvailable: boolean;
	/** True on a terminal, the only place a host operation can be named to someone who can run it. */
	interactive: boolean;
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
	const sessionSelection = report.sessionModel === undefined ? NO_MODEL_SELECTED_LABEL : `${report.sessionModel} is selected`;
	const lines: string[] = [
		// The verdict and the model behind it, because "off" is a fact about the session's selection and the
		// user needs to see which selection that was.
		`routing: ${report.routingEnabled ? "on" : "off"} (${sessionSelection})`,
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
	// The way out. Every off session is told how to get out of the state where one exists: the report is the
	// one surface long enough to hold the procedure, and the list sends the reader here (spec
	// `managed-commands` / 振り分けを有効にする手順は対話端末で実行できるものを名指す: スコープが設定されていなくても手順が出る).
	// The report's own job here is to say whether routing is on. What may be named alongside it is the shared
	// decision of {@link routingEnablementLines}, the same one the `save` decline and the setting warning read.
	if (!report.routingEnabled) {
		lines.push(...routingEnablementLines(enablementFacts(report)));
	}
	return lines.join("\n");
}

/** The facts that decide whether a notice may name a procedure, or only state why it cannot. */
export interface RoutingEnablementFacts {
	/** True when the catalog holds the routing virtual model, which is what a selector can select. */
	available: boolean;
	/** True when the session limits its models and that limit leaves the routing model out. */
	scoped: boolean;
	/** True on a terminal, the only session someone can be told to run something. */
	interactive: boolean;
}

/** The same three facts, read off a report so `status` does not restate them at each branch. */
function enablementFacts(report: RoleStatusReport): RoutingEnablementFacts {
	return {
		available: report.routingModelAvailable,
		scoped: !report.routingModelInScope,
		interactive: report.interactive,
	};
}

/** The scope fact on its own: what a session nobody operates is told, and the second fact of an unregistered catalog. */
const MODEL_SCOPE_FACT = routingModelGuide({ scoped: true, interactive: false });

/**
 * The way out of an off session, in the one sentence a notice has room for.
 *
 * Registration, scope, and mode are the only inputs, and every surface that offers a way out reads them
 * through here: the `save` decline, the setting-change warning, and `status`. Two of them have one line and
 * take this string; `status` has room for the facts apart and takes {@link routingEnablementLines}. The
 * point of one place is that a session cannot be told to run an operation another surface knows it cannot
 * run (spec `managed-commands` / 振り分けを有効にする手順は対話端末で実行できるものを名指す).
 */
export function routingEnablement(facts: RoutingEnablementFacts): string {
	if (!facts.available) return ROUTING_MODEL_UNAVAILABLE;
	return routingModelGuide(facts);
}

/**
 * The same decision as the lines `status` prints, which is where two facts can be said apart.
 *
 * An unregistered catalog and an excluding scope are independent facts, so a collision states both — but
 * neither one makes an unavailable procedure usable, so no operation is named. A session nobody is driving
 * is told the scope fact and nothing else: the scope is a fact about the session, not a task for whoever
 * may be scripting it.
 */
export function routingEnablementLines(facts: RoutingEnablementFacts): string[] {
	if (!facts.available) return facts.scoped ? [MODEL_SCOPE_FACT, ROUTING_MODEL_UNAVAILABLE] : [ROUTING_MODEL_UNAVAILABLE];
	if (!facts.interactive) return facts.scoped ? [MODEL_SCOPE_FACT] : [];
	return [`to enable: ${routingEnablement(facts)}`];
}

/**
 * How the routing model gets selected, in the host's own operations where there is someone to run them.
 *
 * The routing is in force only while the session holds `spirits/auto`, so every off session has to be told
 * how to change that, and the honest answer depends on whether the session limits its models: a scope
 * excludes the routing model as surely as a missing provider does, and naming the selector alone would name
 * a list the model is not in. The scope switch is named as the operation, not as a key: the host draws the
 * key in the selector's own hint, and a word of ours would go stale the day the binding moves (spec
 * `managed-commands` / 物理モデルを選択している間の設定変更は振り分けが働いていないことを伝える:
 * 対話端末でないセッションでは操作を名指さない).
 *
 * The strings carry no trailing period: the report, the warning, and the confirmation each close the
 * sentence their own way.
 */
export function routingModelGuide(options: { scoped: boolean; interactive: boolean }): string {
	const fact = options.scoped
		? `${ROUTING_MODEL_REFERENCE} is not in this session's model scope`
		: `${ROUTING_MODEL_REFERENCE} is not the model this session selected`;
	if (!options.interactive) return `${fact}, and routing is in force only while it is selected`;
	return options.scoped
		? `${fact}: switch ${HOST_COMMANDS.model}'s scope to all models, or run ${HOST_COMMANDS.scopedModels} to add it`
		: `select ${ROUTING_MODEL_REFERENCE} with ${HOST_COMMANDS.model} to put this to work`;
}

/**
 * Why no procedure can be named: the routing model is not in this session's catalog at all.
 *
 * The routing registers as a virtual model, and an extension that failed to register leaves nothing for a
 * selector to select. Telling someone to open a list that does not hold the model sends them to a screen
 * that proves the advice wrong (spec `managed-commands` / 振り分け用モデルが未登録なら手順を名指さない).
 */
export const ROUTING_MODEL_UNAVAILABLE = `${ROUTING_MODEL_REFERENCE} is not in this session's model catalog, so routing cannot be turned on here`;

/**
 * Whether this session can be told to select the routing model at all.
 *
 * The check every notice that names a procedure runs first, so `status` and a `save` decline cannot name an
 * operation that reaches for a model the session does not have (spec `managed-commands` /
 * 振り分け用モデルが未登録なら手順を名指さない). It reads the registry's whole list rather than the session's
 * available list on purpose: the question is whether anything registered `spirits/auto` at all, and a scope
 * that leaves it out is a different fact with its own procedure — the available list answers both questions
 * with `no`, which would replace the scope's advice with the wrong one.
 */
export function routingModelAvailable(models: readonly PiModel[]): boolean {
	return models.some((model) => isRoutingModel(model));
}

/** The one thing worth saying about a strong that nothing resolves to, or undefined when strong is usable. */
export function strongSettingWarning(setStrong: boolean, strongUnresolved: boolean): string | undefined {
	if (!setStrong || !strongUnresolved) return undefined;
	return `strong has no usable model, so these requests run ${MODEL_ROLE_NORMAL}. set one with /spirits-role ${MODEL_ROLE_STRONG} model <provider/id>.`;
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
	/** True when the session limits its models, which is what makes the selector answer different. */
	scoped: boolean;
	/** True on a terminal, the only session that can be told to press something. */
	interactive: boolean;
	/** False when the catalog holds no routing model, which leaves no procedure worth naming. */
	routingModelAvailable: boolean;
}): string | undefined {
	const parts: string[] = [];
	const strong = strongSettingWarning(options.setStrong, options.strongUnresolved);
	if (strong) parts.push(strong);
	if (options.physicalModelSelected) {
		parts.push(
			`routing is off while a physical model is selected; ${routingEnablement({
				available: options.routingModelAvailable,
				scoped: options.scoped,
				interactive: options.interactive,
			})}.`,
		);
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
	// An unreadable `models.normal` is a diagnosis, not a replacement for the answer: the row still has
	// to name the model that answers, because a request is on its way and the user is reading this line
	// to find out what will handle it (spec `managed-commands` / 読めない normal でも実際に応答するモデルを出す).
	const normalLine: RoleResolutionLine = normalUnreadable
		? {
				role: MODEL_ROLE_NORMAL,
				target: answers ?? "unresolved",
				source: `${SETTINGS_KEY_MODELS}.${SETTINGS_KEY_NORMAL_MODEL} ${normalUnreadable}${answers ? `; running ${normalLanding(normal!.source)}` : ""}`,
			}
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
 * What the next request would run on, decided once and drawn by everything that shows it.
 *
 * The badge used to be a record: the route reported the role it had used and that report was drawn, so
 * the line stayed on whatever the last request had been until a request came along, and it never said
 * anything about whether the routing was in force at all. It is now a projection — the same resolution
 * the route, the list, and `status` read, taken from the settings, the phase, and the session's model at
 * the moment of drawing — which is what lets it name the role, the level, and the model before the user
 * sends the request they are asking about.
 */

/**
 * What the projection reads. Every one of these is read at the draw, never cached.
 *
 * The list is {@link RequestPlanInput}'s, not a second one written beside it: the badge promises the
 * resolution a request reaches, so a fact the resolution gains has to reach the badge without anyone
 * remembering to add it in two places. Two differences, both stated here:
 *
 * - `routingEnabled`, which a plan has no use for because a plan only runs where routing is in force.
 * - `previous`, boxed by the plan and plain where it is read, which is the only shape that differs.
 */
export type RoleBadgeInput = Omit<RequestPlanInput, "previous"> & {
	/** False when the session runs on a physical model, which is the one reason for `[off]`.
	 *  The caller decides it with {@link isRoutingModel} on the session's selection. */
	routingEnabled: boolean;
	/** Physical model of the latest successful response, the last normal candidate. */
	previous?: PiModel;
};

/** The state the badge is a picture of. */
export type RoleBadgeState =
	/**
	 * Routing is in force and something answers: the role that answers, what it asks for, and its model.
	 *
	 * The model is absent only where a draw could not resolve one — a host that refused the read the
	 * resolution needs — because a role the session really holds is worth drawing on its own.
	 */
	| { kind: "role"; role: string; model?: PiModel; thinkingLevel?: ThinkingLevel }
	/** The session runs on a physical model, so nothing routes here. */
	| { kind: "off" }
	/** Routing is in force and no role resolves to a model, so nothing can answer whatever is asked. */
	| { kind: "none" };

/**
 * Project the badge from the same plan the route would produce.
 *
 * The role drawn is the role that *answers*, not the one a step asked for: a step set to a strong that
 * has nothing to run on answers on normal, and a badge that named strong would name a role no request
 * uses (spec `managed-commands` / badge は応答する物理モデルを別の status key に出す:
 * strong が落ちれば応答モデルも従う).
 */
export function roleBadgeState({ routingEnabled, previous, ...rest }: RoleBadgeInput): RoleBadgeState {
	if (!routingEnabled) return { kind: "off" };
	const plan = resolveRequestPlan({ ...rest, ...(previous ? { previous: { model: previous } } : {}) });
	// `modelMissing` is the one state with nothing to answer on, and it is the only one that says so.
	if (!plan.model) return { kind: "none" };
	return {
		kind: "role",
		role: plan.answerRole,
		model: plan.model,
		...(plan.thinkingLevel ? { thinkingLevel: plan.thinkingLevel } : {}),
	};
}

/** The ellipsis that stands for the tail of a model id too long for the footer. */
const MODEL_ID_ELLIPSIS = "\u2026";

/**
 * The answering model as the footer shows it: the id without its provider, its head when it is long.
 *
 * The provider is dropped because the footer truncates the end of the whole status line, so a long
 * reference would take the space of the other extensions' statuses and of this one too. Leaving the
 * truncation to the footer would lose the same characters in a way nobody configured.
 */
export function roleModelDisplay(model: Pick<PiModel, "id">): string {
	const id = model.id ?? "";
	if (id.length <= ROLE_MODEL_DISPLAY_MAX_LENGTH) return id;
	return `${id.slice(0, ROLE_MODEL_ELLIPSIS_AFTER)}${MODEL_ID_ELLIPSIS}`;
}

/** The two status lines the badge occupies, `undefined` where nothing is drawn. */
export interface RoleBadgeLines {
	/** The role line: `[strong high]`, `[off]`, `[!]`, or nothing. */
	readonly role: string | undefined;
	/** The answering model, or nothing where the badge has no model to name. */
	readonly model: string | undefined;
}

/**
 * One printable bracketed word: control characters and the escape that opens a terminal sequence are
 * removed, and a word that leaves nothing behind prints nothing. Without the strip, a value that reached
 * a resolution from a hand-edited settings file or a foreign session entry could reformat the terminal.
 */
function badgeWord(word: string): string | undefined {
	const printable = word.replace(CONTROL_CHARACTERS, "").trim();
	return printable === "" ? undefined : `[${printable}]`;
}

/**
 * Draw the state onto the two lines.
 *
 * The role and its level are one word, because they answer one question. The model is a separate line
 * and is left out wherever there is no answering model — the routing is off, or nothing resolves — since
 * the host's own stats row already names the physical model a session sits on.
 */
export function roleBadgeLines(state: RoleBadgeState): RoleBadgeLines {
	if (state.kind === "off") return { role: badgeWord(ROLE_BADGE_OFF), model: undefined };
	if (state.kind === "none") return { role: badgeWord(ROLE_BADGE_NONE), model: undefined };
	// A level that resolves to nothing is not a level to draw: `strong` alone is the honest line, and the
	// session's own selection is only absent when pi has none either.
	const word = state.thinkingLevel ? `${state.role} ${state.thinkingLevel}` : state.role;
	return { role: badgeWord(word), model: state.model ? roleModelDisplay(state.model) : undefined };
}

/** The footer status lines the managed route shows the role and the answering model on. */
export interface RoleBadge {
	/** Draw the two lines, clearing whichever of them holds nothing. */
	update(lines: RoleBadgeLines, ctx: Pick<ExtensionContext, "ui">): void;
}

/**
 * Build the badge. It holds no state: every draw is a fresh projection the caller hands it.
 *
 * The two keys are written independently on purpose. The footer is one host surface shared with other
 * extensions, and a host that refuses a write to one key loses that key alone — the role still reads, and
 * the request still gets routed (spec `managed-commands` / 片方の key の書き込みが失敗しても他方は描く).
 */
export function createRoleBadge(): RoleBadge {
	return {
		update(lines, ctx) {
			try {
				ctx.ui.setStatus(ROLE_STATUS_KEY, lines.role);
			} catch {
				// The role line is lost; the model line and the request are not.
			}
			try {
				ctx.ui.setStatus(ROLE_MODEL_STATUS_KEY, lines.model);
			} catch {
				// The model line is lost; the role line and the request are not.
			}
		},
	};
}
