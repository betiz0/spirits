/**
 * The writes behind `/spirits-role` and behind the settings list.
 *
 * Both surfaces change the same settings, and the spec makes that an identity rather than a
 * coincidence: a list edit must be the same write the command performs (spec `managed-commands` /
 * 一覧での編集は コマンドと同じ書き込みを行う). So both call the functions here, and neither holds a
 * write of its own.
 *
 * Three operations live here. Two change one setting — the lock, and a role or step item. The third,
 * `save`, writes what the session currently *selects* (its lock and its model) into pi's global
 * settings, and it is one operation rather than two calls because the spec asks for a single
 * comparison against the file and a single write (`/spirits-role save`).
 *
 * What belongs here is one change and whether the settings file took it. The notice text, the
 * warnings, and `ctx.reload()` stay with the caller: the command reports every line as it lands, while
 * the list waits until it closes, which is the one difference the spec allows between them.
 */

import type { RoutingSettings } from "../config.ts";
import { readRoutingSettings } from "../config.ts";
import {
	isRoutingModel,
	PI_VIRTUAL_MODEL_API,
	ROLE_SAVE_SUGGESTION_MAX,
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
} from "../constants.ts";
import { settingPath, type SettingItem } from "./role.ts";
import { modelKey, resolveNormalTarget, resolveStrongTarget, type ModelLookup } from "../routing/resolve.ts";
import type { SettingsPatch, SettingsPatchDecider, SettingsPath } from "./settings-store.ts";

/** Where a change landed and what went there (`undefined` deleted it). */
export interface SettingChange {
	readonly path: SettingsPath;
	readonly value: unknown;
}

/** One change and whether the settings file took it. */
export interface RoleWrite {
	/** What changed, in the words shown back. */
	message: string;
	/** True when the file holds the change, which is what makes a reload worth doing. */
	saved: boolean;
	/** Why the file refused, when it refused. A refusal is not a decline: see {@link declined}. */
	failure?: string;
	/**
	 * Why the operation wrote nothing by choice, when it did.
	 *
	 * A decline is neither a failure nor a no-op: the file was never asked, and the notice's kind and the
	 * row's lead are different for it (spec `managed-commands` / 物理モデルを選択中は `save` が global 設定を
	 * 見送る). The text is the reason only — it names no procedure, because what a session can be told to
	 * run is a fact about its mode and its catalog, which only the surfaces know (design Decision 5).
	 * Never set together with {@link failure}.
	 */
	declined?: string;
	/**
	 * Where the change landed and what went there (`undefined` deleted it).
	 *
	 * A list of them rather than one because `save` moves the default model's two keys together with the
	 * role, and the caller has to fold all three. The caller needs this because pi's settings keep their
	 * pre-write values until the reload, and a notice about what was just written cannot read them without
	 * it (design Decision 4).
	 */
	wrote: readonly SettingChange[];
	/**
	 * Why part of the change was left out, when it was.
	 *
	 * Only `save` has a part to leave out — the default model, when saving it would leave a new session
	 * with no normal target — and the reason travels with the write that did land rather than replacing it.
	 */
	skipped?: string;
}

/** The side effects one change needs. Both surfaces inject these; neither writes a file itself. */
export interface RoleWriteDeps {
	/** Lock the session role: the phase, plus the session record a resume reads back. */
	lockRole(role: string): void;
	/** Merge a flat patch into pi's global settings file. */
	patchSettings(patch: SettingsPatch): void;
	/** Change one nested key of pi's global settings file. `undefined` deletes it. */
	patchSettingsPath(path: SettingsPath, value: unknown): void;
	/**
	 * Write what a decider finds different in pi's global settings file, once, under its lock.
	 *
	 * The return value is the settings object the file holds afterwards, or `undefined` when the decider
	 * declined to write it. This is the only entry `save` writes through, and the decider is what keeps the
	 * comparison and the write inside the same lock — see `patchGlobalSettingsIfChanged`.
	 */
	saveSettings(decide: SettingsPatchDecider): Record<string, unknown> | undefined;
}

/** Lock the role and save it as the default role, the way `/spirits-role <role>` does. */
export function applyRoleLock(deps: RoleWriteDeps, role: string): RoleWrite {
	// The session takes the lock first: a file that refuses must not take the lock the user just asked
	// for back out from under them.
	deps.lockRole(role);
	const write = saveFile(() => deps.patchSettings({ models: { role } }), `role locked to ${role}`, "the default role");
	return { ...write, wrote: [{ path: [SETTINGS_KEY_MODELS, SETTINGS_KEY_ROLE], value: role }] };
}

/**
 * Change one role or step setting.
 *
 * `value` of `undefined` is the `unset` word, and it deletes the key — which is what makes an unset of
 * a step's thinking level leave that step's role alone. A model reference arrives already resolved to
 * `provider/id`, because resolving one needs the catalog, which only the caller has.
 */
export function applyRoleSetting(deps: RoleWriteDeps, setting: SettingItem, value: string | undefined): RoleWrite {
	const shown = value === undefined ? `${setting.name} ${setting.item} unset` : `${setting.name} ${setting.item} ${value}`;
	const path = settingPath(setting);
	const write = saveFile(() => deps.patchSettingsPath(path, value), `set ${shown}`, "the setting");
	return { ...write, wrote: [{ path, value }] };
}

/** Run one file write and describe the outcome the same way in both surfaces. */
function saveFile(write: () => void, applied: string, what: string): Omit<RoleWrite, "wrote"> {
	try {
		write();
		return { message: applied, saved: true };
	} catch (error) {
		// The session keeps what pi already accepted. Undoing it would take the user's own action away
		// over a settings-file problem, and reloading would re-read the defaults that never landed.
		const reason = error instanceof Error ? error.message : String(error);
		// `save` has no "this part applied" clause to lead with — nothing applied — so the refusal stands alone
		// rather than opening the sentence with a dangling separator.
		return { message: applied === "" ? `${what} was not saved: ${reason}` : `${applied}; ${what} was not saved: ${reason}`, saved: false, failure: reason };
	}
}

// ---------------------------------------------------------------------------
// `save`: the session's own selection, written into pi's global settings
// ---------------------------------------------------------------------------

/**
 * What the session holds that `save` can put into the global file.
 *
 * `role` is the phase's lock, not the role a running step happens to take: a step's role is temporary
 * and making it a default would be making a side effect permanent (design Decision 4). `model` is the
 * model the session selected, which may be the routing model; `undefined` is a session that selected
 * none, which has no default model to state.
 */
export interface SessionSelection {
	role: string;
	model?: { provider: string; id: string; api?: string };
}

/** A default model reference in the two keys pi reads it from. */
interface DefaultModel {
	provider: string;
	modelId: string;
}

/**
 * What `save` would write into one settings object, and what it would leave out.
 *
 * The same decision builds the list's preview and the command's write, and the commit re-runs it on the
 * file's content under the lock rather than trusting the preview: another process may have landed the
 * same change in between, and writing the preview's patch over it would undo that write with a value
 * this session merely happens to agree with (design Decision 5).
 */
interface SaveDecision {
	/** Why nothing is written at all, when the selection is one `save` declines. */
	declined?: string;
	/** The patch that would land, absent when the object already holds the selection. */
	patch?: SettingsPatch;
	/** The keys the patch touches, in the order they read as a sentence. */
	writes: readonly SettingChange[];
	/** The default model the selection stands for, absent when the model keys stay out. */
	model?: DefaultModel;
	/** Why the default model is left out, when it is. */
	skipped?: string;
}

/**
 * Decide what `save` would change in `current`.
 *
 * The role is always fair game: `models.role` is a default, and the session's lock is the value the user
 * chose for it. The default model's two keys are not, because a global default is read by every session
 * that starts afterwards, including ones with no conversation behind them — which is what makes the
 * routing model's safety check below necessary.
 */
export function decideSave(selection: SessionSelection, current: Record<string, unknown>, lookup: ModelLookup): SaveDecision {
	const declined = saveDeclination(selection);
	// The decline reads the selection and nothing else, so the file is never consulted for it — which is
	// what lets a missing or unreadable file decline the same way an ordinary one does.
	if (declined !== undefined) return { writes: [], declined };
	const settings = readRoutingSettings(current);
	const model = saveableModel(selection.model, current, lookup);
	const writes: SettingChange[] = [];
	const patch: Record<string, unknown> = {};
	if (settings.defaultRole !== selection.role) {
		patch[SETTINGS_KEY_MODELS] = { [SETTINGS_KEY_ROLE]: selection.role };
		writes.push({ path: [SETTINGS_KEY_MODELS, SETTINGS_KEY_ROLE], value: selection.role });
	}
	if (model && (rawDefault(current, SETTINGS_KEY_DEFAULT_PROVIDER) !== model.provider || rawDefault(current, SETTINGS_KEY_DEFAULT_MODEL) !== model.modelId)) {
		patch[SETTINGS_KEY_DEFAULT_PROVIDER] = model.provider;
		patch[SETTINGS_KEY_DEFAULT_MODEL] = model.modelId;
		writes.push(
			{ path: [SETTINGS_KEY_DEFAULT_PROVIDER], value: model.provider },
			{ path: [SETTINGS_KEY_DEFAULT_MODEL], value: model.modelId },
		);
	}
	return {
		...(Object.keys(patch).length > 0 ? { patch } : {}),
		writes,
		...(model ? { model } : {}),
		...(model === undefined && selection.model === undefined ? { skipped: NO_MODEL_REASON } : {}),
		...(model === undefined && selection.model !== undefined ? { skipped: normalUnreachableReason(lookup) } : {}),
	};
}

/** The row's and the notice's shared words for a session that selected no model. */
const NO_MODEL_REASON = "no model is selected, so nothing was saved as the default model";

/**
 * Why `save` declines while the session holds a physical model.
 *
 * A session on a physical model answers without asking spirits, so its selection is not what the routing
 * would run on, and copying it into the global defaults would hand the off state to every session that
 * starts afterwards. The sentence leads with what did not happen — a decline is not the file refusing,
 * so it does not take the list's `not saved:` lead — and it names no procedure, because what a session
 * can be told to run is a fact about its mode and its catalog, which only the surfaces know.
 */
const PHYSICAL_SELECTION_DECLINE =
	"save declined: a physical model is selected, and save writes only what the routing runs on";

/**
 * Why `save` declines while the session holds a virtual model that is not the routing one.
 *
 * The physical sentence would be false for this selection: another extension's virtual model does ask its
 * own extension to route, and a reader told "a physical model is selected" would go looking for a model the
 * selector does not show them. The honest fact is that the model in front of them is not the one spirits
 * routes, so the sentence names it (spec `managed-commands` / 物理モデルを選択中は `save` が global 設定を
 * 見送る: 他拡張の仮想モデルも振り分け用ではない).
 */
function otherVirtualDecline(model: { provider: string; id: string }): string {
	return `save declined: ${modelKey(model)} is a virtual model, but not the one spirits routes`;
}

/**
 * Why `save` writes nothing for this selection, or undefined when it may write.
 *
 * The predicate is {@link isRoutingModel} on the selection — identifier and virtual api together — the
 * same test the badge, `status`, the setting warning, and the step-start confirmation use, so the surfaces
 * cannot call a session routed while `save` calls it off (design Decision 1). Which sentence says so
 * follows the selection's own kind, because the reason has to agree with what the selector shows.
 *
 * A session that selected no model is not a declined selection: it has no default model to state, and its
 * `models.role` save stays.
 *
 * The list reads this too, because the `save` row's decline has to lead its description before the
 * global file's read failure does (spec `managed-commands` / `save` の見送りは一覧の行と通知に出す).
 */
export function saveDeclination(selection: SessionSelection): string | undefined {
	const model = selection.model;
	if (model === undefined || isRoutingModel(model)) return undefined;
	return model.api === PI_VIRTUAL_MODEL_API ? otherVirtualDecline(model) : PHYSICAL_SELECTION_DECLINE;
}

/**
 * The model `save` would write, or why it writes none.
 *
 * Reached only for the routing model: {@link decideSave} declines every other selection before it asks
 * this, so a physical selection never arrives here to be written as given (design Decision 1).
 *
 * The routing model is the one selection that can break a session that has not spoken yet. `spirits/auto`
 * answers a normal request only through `models.normal`, and the session the user is looking at may be
 * resolving normal out of its own successful responses or out of a project file that a new session will
 * not read. So the check is made against the global file with the new defaults folded in and with no
 * history at all — exactly the settings a session started after this write reads — using the routing's
 * own resolver so the promise and the request cannot come apart (design Decision 3).
 */
function saveableModel(
	selection: SessionSelection["model"],
	current: Record<string, unknown>,
	lookup: ModelLookup,
): DefaultModel | undefined {
	if (!selection) return undefined;
	const model: DefaultModel = { provider: selection.provider, modelId: selection.id };
	// The prospective defaults, read the way a new session reads them: no `previous` model, because a
	// session that has not asked anything has none.
	const prospective = readRoutingSettings({
		...current,
		[SETTINGS_KEY_DEFAULT_PROVIDER]: model.provider,
		[SETTINGS_KEY_DEFAULT_MODEL]: model.modelId,
	});
	// `models.normal` is not completed on the user's behalf: writing a routing target into a role setting
	// would change a setting this operation was never asked to touch.
	const normal = resolveNormalTarget({
		lookup,
		...(prospective.normal ? { spec: prospective.normal } : {}),
		...(prospective.defaultProvider ? { defaultProvider: prospective.defaultProvider } : {}),
		...(prospective.defaultModelId ? { defaultModelId: prospective.defaultModelId } : {}),
	});
	// A model only the current project can reach is not a global default: another project starts without
	// the extension that registered its provider, and the `models.normal` this write is betting on would
	// name nothing there. The host publishes no provenance, so the one list it does publish — the
	// providers an extension registered — is the line between the two, and a provider on it is declined
	// even when a global extension put it there (design Decision 3).
	if (!normal || !answersGlobally(normal.model, lookup)) return undefined;
	return model;
}

/** The value a settings object holds for a key, exactly as written — no trim, no type check. */
function rawDefault(settings: Record<string, unknown>, key: string): unknown {
	return settings[key];
}

/** Whether a model is reachable by a session that has nothing but the global file behind it. */
function answersGlobally(model: { provider: string }, lookup: ModelLookup): boolean {
	const registered = lookup.getRegisteredProviderIds?.();
	// Provenance is the question, and a host that cannot answer it leaves the model unproven rather than
	// proven. The safe side is declining: a wrong yes writes a default no other project can resolve
	// (spec `managed-commands` / 振り分け用モデルは保存後の global 設定で normal が解決できる場合だけ保存する).
	if (registered === undefined) return false;
	return !registered.includes(model.provider);
}

/**
 * Why the routing model cannot be saved as the default, with the way out.
 *
 * The fix is a `models.normal` the global file can resolve on its own, so the reason names the command
 * that writes one and offers a few of the models this session can actually answer with — the ones the
 * user has in front of them, spelled the way the command takes them.
 */
function normalUnreachableReason(lookup: ModelLookup): string {
	const suggestions = lookup
		.getAvailable()
		.filter((model) => model.api !== PI_VIRTUAL_MODEL_API && answersGlobally(model, lookup))
		.slice(0, ROLE_SAVE_SUGGESTION_MAX)
		.map(modelKey);
	return (
		`the routing model needs a global models.normal a new session can resolve on its own, so the default model was left alone. ` +
		`Set one with /spirits-role normal model <provider/id>${suggestions.length > 0 ? ` (for example ${suggestions.join(", ")})` : ""}.`
	);
}

/** The selection as the message names it: the role, and the model when one is being saved. */
function describeSelection(selection: SessionSelection, decision: SaveDecision): string {
	const parts = [`${SETTINGS_KEY_ROLE} ${selection.role}`];
	if (decision.model) parts.push(`default model ${modelKey(decision.model)}`);
	return parts.join(", ");
}

/**
 * Save the session's selection into pi's global settings, once.
 *
 * The session is not touched: no model change, no thinking change, no step change, no session record.
 * `save` answers "what should the next session start with?", and the session the user is in has already
 * answered that for itself (design Decision 4).
 *
 * The decision runs inside `deps.saveSettings`, which holds the file's lock, so the comparison and the
 * write describe the same content. A file that refuses is reported and earns no reload.
 */
export function applyRoleSave(
	deps: RoleWriteDeps,
	selection: SessionSelection,
	lookup: ModelLookup,
): RoleWrite {
	// The decline is decided before the file is touched: a global settings file that does not exist must
	// not be created, and one that cannot be read must not be written to (spec `managed-commands` /
	// 物理モデルを選択中は `save` が global 設定を見送る).
	const declined = saveDeclination(selection);
	if (declined !== undefined) {
		return { message: declined, saved: false, wrote: [], declined };
	}
	let decided: SaveDecision | undefined;
	const outcome = saveFile(
		() => {
			deps.saveSettings((current) => {
				decided = decideSave(selection, current, lookup);
				return decided.patch;
			});
		},
		"",
		"the global settings file",
	);
	// A file that went unreadable before the decider ran has no decision to report on, and its reason is
	// the whole of what happened.
	if (outcome.failure !== undefined) return { message: outcome.message, saved: false, failure: outcome.failure, wrote: [] };
	const decision = decided ?? decideSave(selection, {}, lookup);
	const summary = describeSelection(selection, decision);
	const skipped = decision.skipped === undefined ? "" : `; ${decision.skipped}`;
	if (decision.writes.length === 0) {
		// Nothing to write is not a failure, and it is not a reload either — but a reason still has to show.
		return { message: `nothing to save: the global settings already hold ${summary}${skipped}`, saved: false, wrote: [], ...(decision.skipped ? { skipped: decision.skipped } : {}) };
	}
	return {
		message: `saved ${summary}${skipped}`,
		saved: true,
		wrote: decision.writes,
		...(decision.skipped ? { skipped: decision.skipped } : {}),
	};
}

/**
 * The `save` row's preview: what the global file holds now, and what the row would put there.
 *
 * Built from the file rather than from the host's effective settings, which merge the trusted project
 * file the save does not write to. The two readings are deliberately different sentences: this one is
 * about the disk, and the ordinary rows and `status` stay about what the session actually runs on (spec
 * `managed-commands` / save はディスク上の結果と実効状態を区別する).
 */
export function describeSavePreview(
	selection: SessionSelection,
	current: Record<string, unknown>,
	lookup: ModelLookup,
): string {
	// The preview is the decision read against the file, not a second predicate beside it: whatever the file
	// holds, a declined selection has nothing to preview.
	const decision = decideSave(selection, current, lookup);
	if (decision.declined !== undefined) return decision.declined;
	// The same writes that decide the patch also decide what the preview calls a change. Read the old raw
	// value only for its display; do not repeat the comparison that produced `decision.writes` here.
	const roleChanged = decision.writes.some(
		(change) => change.path[0] === SETTINGS_KEY_MODELS && change.path[1] === SETTINGS_KEY_ROLE,
	);
	const modelChanged = decision.writes.some(
		(change) => change.path[0] === SETTINGS_KEY_DEFAULT_PROVIDER || change.path[0] === SETTINGS_KEY_DEFAULT_MODEL,
	);
	// The two keys pi reads as written, so a padded value is shown as the file holds it (spec
	// `managed-commands` / `save` は振り分け用のモデルを選択しているセッションの選択状況を global 既定に保存する:
	// ディスクの既定値に前後の空白がある).
	const rawProvider = rawDefault(current, SETTINGS_KEY_DEFAULT_PROVIDER);
	const rawModel = rawDefault(current, SETTINGS_KEY_DEFAULT_MODEL);
	const from = typeof rawModel === "string" && rawModel !== "" ? `${typeof rawProvider === "string" ? rawProvider : ""}/${rawModel}` : "unset";
	const parts: string[] = [];
	parts.push(
		roleChanged
			? `${SETTINGS_KEY_ROLE} ${readRoutingSettings(current).defaultRole ?? "unset"} \u2192 ${selection.role}`
			: `${SETTINGS_KEY_ROLE} ${selection.role}`,
	);
	if (decision.model) {
		parts.push(
			modelChanged
				? `default model ${from} \u2192 ${modelKey(decision.model)}`
				: `default model ${modelKey(decision.model)}`,
		);
	} else if (decision.skipped) {
		parts.push(decision.skipped);
	}
	if (decision.writes.length === 0) return `nothing to save: the global settings already hold ${parts.join(", ")}`;
	return `saves ${parts.join(", ")} to pi's global settings`;
}

/** Whether strong resolves right now, which is the question a warning about strong asks. */
export function strongIsUsable(settings: RoutingSettings, lookup: ModelLookup): boolean {
	if (!settings.strong) return false;
	return resolveStrongTarget({ lookup, spec: settings.strong, defaultProvider: settings.defaultProvider }) !== undefined;
}
