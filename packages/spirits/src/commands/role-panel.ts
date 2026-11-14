/**
 * The `/spirits-role` settings list.
 *
 * One row per setting, a description that says what that setting resolves to, and a `SelectList` for
 * anything with more than two choices. pi-tui's `SettingsList` supplies the cursor, the wrapping, and
 * the submenu plumbing, and `ctx.ui.custom()` hosts the whole thing, so the screen behaves the way pi's
 * own settings screen does (design Decision 11).
 *
 * The list holds no state of its own: every row is read from the settings and the phase, and every edit
 * goes through the same writes the command performs — which is what makes a list edit and a command line
 * one behavior rather than two that happen to agree. What the list adds over the command is one thing: a
 * model picked out of the catalog, because a command completion never sees the catalog and this does.
 *
 * Two things the screen owes the fact that pi keeps the settings it read at startup:
 *
 * - A row shows the model that would answer, not the value that was saved. The resolution comes from the
 *   same lookup the route uses, so a target the catalog cannot use reads as unusable here exactly as it
 *   does in a request (spec `managed-commands` / 一覧の説明は実際の解決結果を示す).
 * - A row refreshes its value and its description together after a write, reading the settings with this
 *   list's own writes folded in. `pi.getSettings()` will not see them until the reload that closes the
 *   screen, and a description left on the old target would name a model that no longer answers.
 *
 * {@link RolePanel} is the part under test — it reads a snapshot, builds rows, and applies edits with no
 * terminal involved. {@link openRolePanel} is the thin pi-tui adapter on top of it.
 */

import type { ExtensionCommandContext, ExtensionModelRegistry, PiModel, SlashCommandInfo, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getKeybindings,
	SelectList,
	SettingsList,
	type SelectListTheme,
	type SelectItem,
	type SettingItem as TuiSettingItem,
	type SettingsListTheme,
} from "@earendil-works/pi-tui";
import type { IgnoredSetting, RoutingSettings } from "../config.ts";
import type { ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLES, MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG, PI_VIRTUAL_MODEL_API, STEP_DEFINITIONS, THINKING_LEVELS } from "../constants.ts";
import type { StepDefinition } from "../constants.ts";
import type { ActiveStep } from "../routing/phase.ts";
import { resolveRequestPlan } from "../routing/plan.ts";
import { resolveRequestRole } from "../routing/router.ts";
import { modelKey } from "../routing/resolve.ts";
import {
	formatModelKey,
	roleResolutionLines,
	roleSettingWarning,
	type LastRequestReport,
	type RoleResolutionLine,
	type SettingItem,
	targetAnswers,
} from "./role.ts";
import { applyRoleLock, applyRoleSetting, strongIsUsable, type RoleWrite, type RoleWriteDeps } from "./role-write.ts";
import type { SettingsPath } from "./settings-store.ts";

/** The word that returns a setting to unset, the same word the command takes. */
const UNSET = "unset";

/** What normal's model row shows when nothing is saved, because pi's own default is what answers. */
const PI_DEFAULT_LABEL = "pi default";

/** Joins the two halves of a step row's value, `<role> / <thinking>`, and splits them back apart. */
const STEP_VALUE_SEPARATOR = " / ";

/** Rows the main list shows at once; the rest scrolls, as on pi's own settings screen. */
const MAIN_VISIBLE_ROWS = 12;

/** Choices a submenu shows at once. */
const SUBMENU_VISIBLE_ROWS = 8;

/** Leads the reason a write refused, which the list shows inside itself rather than as a notice. */
const FAILURE_PREFIX = "not saved: ";

/**
 * Leads the reason a redraw refused a row whose write landed.
 *
 * The two failures are opposite facts about the session, so they do not share a prefix: one row that says
 * `not saved` about a change the session took takes the change back on screen (d-verify5 W-1).
 */
const REDRAW_FAILURE_PREFIX = "not redrawn: ";

/**
 * What a row says for the level pi itself holds when nothing of ours is set and the snapshot carried no
 * session selection to name.
 *
 * The role's level row and a step's row both land here, and they used to spell it two ways — one of them
 * calling the level `off` (d-verify4 G-1).
 */
const SESSION_LEVEL_WORDS = "the session's level";

/** The row id of the session lock, the one row that names no setting. */
const LOCK_ROW = "lock";

/** The row id prefix of a step's row, which names the step and then the item. */
const STEP_ROW = "step:";

/** The choices a submenu stage offers, `unset` last where the setting has one. */
const ROLE_CHOICES: readonly string[] = [...MODEL_ROLES, UNSET];
const THINKING_CHOICES: readonly string[] = [...THINKING_LEVELS, UNSET];

/** One row of the list, before it becomes a pi-tui row. */
export interface RolePanelRow {
	/** Row id: `lock`, `<role>.<item>`, or `step:<name>`. */
	id: string;
	label: string;
	/** What the row resolves to. Shown while the row is selected. */
	description: string;
	/** Value shown at the right of the row. Never blank: an unset row says so. */
	currentValue: string;
	/** Every value the row's submenu offers. Empty means the row has nothing to offer. */
	values: string[];
	/** True for a row that chooses among the catalog's models, which decides what an edit accepts. */
	models?: boolean;
	/**
	 * Set for a step row, which is one setting shown as a pair: the row's `role` and `thinking` halves.
	 *
	 * The row id names the step, not either half, because the spec makes the pair one setting item — one
	 * row, then a role list, then a level list (spec `managed-commands` / 一覧のステップの行は 2 段で選ぶ).
	 */
	step?: string;
}

/** Split a row's `<role> / <thinking>` value back into its halves, `unset` for a half that is unset. */
export function stepRowValue(value: string): { role: string; thinking: string } {
	const [role, thinking] = value.split(STEP_VALUE_SEPARATOR).map((part) => part.trim());
	return { role: role || UNSET, thinking: thinking || UNSET };
}

/** One write this list made, kept so the rows read as the file will read once the reload lands. */
export interface PendingWrite {
	path: SettingsPath;
	value: unknown;
}

/**
 * The inputs the rows are read from, re-read on every screen draw.
 *
 * The list's own writes come back as the argument: the settings the host reports stay as they were until
 * the reload, and a row that kept describing those would describe a session nobody is in.
 */
export type PanelRead = (pending: readonly PendingWrite[]) => RolePanelSnapshot;

/** Everything the rows are read from, gathered once per screen. */
export interface RolePanelSnapshot {
	/** Role the session is locked to — the lock, not the role the running step happens to take. */
	lock: string;
	/** Effective settings, with this list's writes folded in. */
	settings: RoutingSettings;
	/**
	 * The catalog, which is what turns a saved model reference into "answers", "unusable", or "unreadable".
	 *
	 * Required because a row that cannot check says something false: the difference between a model that
	 * answers and one that does not is the whole content of the description (spec `managed-commands` /
	 * 一覧の説明は実際の解決結果を示す).
	 */
	lookup: ExtensionModelRegistry;
	/** Step in effect, for the rows that report it. */
	step?: ActiveStep;
	/** Thinking level the session selected, which is what a role or step level overrides. */
	sessionThinkingLevel?: ThinkingLevel;
	/** The last request the routing answered. */
	last?: LastRequestReport;
	/** Physical model of the last successful response, the last normal candidate. */
	previous?: PiModel;
	/** True when the session sits on a physical model, so no routing is in force. */
	routingOff?: boolean;
	/** Values the settings file holds that routing will not read. */
	ignored?: readonly IgnoredSetting[];
	/** Models a role's model row can offer, in `provider/id` spelling. */
	modelChoices: readonly string[];
	/** Steps none of whose starter commands this session has. */
	missingStarters: ReadonlySet<string>;
}

/** What the models a role can be pointed at: pi's available models, minus every virtual entry. */
export function modelChoices(models: readonly PiModel[]): string[] {
	// Excluded by api, the same test the routing lookup uses: a virtual entry routes requests instead of
	// answering them, and another extension's virtual model is not named `spirits/auto`.
	return models.filter((model) => model.api !== PI_VIRTUAL_MODEL_API).map(formatModelKey);
}

/**
 * The steps this session cannot start, from the commands `pi.getCommands()` reports.
 *
 * A step with no starter is still worth listing — the user may install that skill tomorrow — so the row
 * says what is missing instead of disappearing (spec `managed-commands` / 開始コマンドが無いステップ).
 *
 * Only what pi expands counts, which is the same filter the phase uses to open a step (design
 * Decision 9): an extension command of the same name is handled before pi fires `input`, so counting it
 * here would show a starter while no input can ever start that step.
 */
export function missingStartersFor(commands: readonly SlashCommandInfo[]): Set<string> {
	const available = new Set(commands.filter((command) => command.source !== "extension").map((command) => command.name));
	const missing = new Set<string>();
	for (const step of STEP_DEFINITIONS) {
		if (!step.starters.some((starter) => available.has(starter.startsWith("/") ? starter.slice(1) : starter))) {
			missing.add(step.name);
		}
	}
	return missing;
}

/**
 * The setting a row id names, or undefined when the id names no setting.
 *
 * `lock` is the one row that changes the session rather than a setting, and the `step:` form is what
 * keeps a step and a role with the same name from naming the same row.
 */
export function rowSetting(rowId: string): SettingItem | undefined {
	if (rowId.startsWith(STEP_ROW)) {
		const [name, item] = rowId.slice(STEP_ROW.length).split(".");
		if (!STEP_DEFINITIONS.some((step) => step.name === name)) return undefined;
		return item === "role" || item === "thinking" ? { target: "step", name, item } : undefined;
	}
	const [name, word] = rowId.split(".");
	if (name !== MODEL_ROLE_NORMAL && name !== MODEL_ROLE_STRONG) return undefined;
	return word === "model" || word === "thinking" ? { target: "role", name, item: word } : undefined;
}

/** The value word a row hands back, with `unset` turned into "delete the key". */
export function rowValue(value: string): string | undefined {
	return value === UNSET ? undefined : value;
}

/** What the caller wants the screen to do besides write. */
export interface RolePanelHooks {
	/**
	 * Draw the badge for a lock the list applied.
	 *
	 * A command draws the badge whether or not the settings file took the lock, and a list edit is the same
	 * change, so it draws it the same way (spec `managed-commands` /
	 * 一覧のロックの行は保存に失敗してもセッションのロックを示す).
	 */
	lockDrawn?: (role: string) => void;
	/**
	 * The lock the session holds, read without the settings.
	 *
	 * The badge follows a lock the list applied, and it has to do that even when the rows cannot be read
	 * back: the same settings read builds the rows, and a read that raises must not take the badge down
	 * with it (d-verify5 W-1).
	 */
	sessionLock?: () => string;
}

/**
 * The value a row carries after a write that landed while its redraw failed.
 *
 * The rows are rebuilt by reading the host, and the read is what raised. The half this edit wrote is
 * known, and the other half of a step row is still what the row held, so the row can carry the change
 * without the read (d-verify5 W-1).
 */
function landedValue(previous: string, rowId: string, value: string): string {
	if (!rowId.startsWith(STEP_ROW)) {
		// A role's model row spells an unset normal as pi's default, which is what it will show once the rows
		// are read again, so the row says that now too.
		return value === UNSET && rowId === `${MODEL_ROLE_NORMAL}.model` ? PI_DEFAULT_LABEL : value;
	}
	const [role, thinking] = previous.split(STEP_VALUE_SEPARATOR);
	return rowId.endsWith(".role")
		? `${value}${STEP_VALUE_SEPARATOR}${thinking ?? UNSET}`
		: `${role ?? UNSET}${STEP_VALUE_SEPARATOR}${value}`;
}

/**
 * The list's content and edits, without a terminal.
 *
 * The snapshot is re-read on every call, so an edit shows up on the next redraw and the screen cannot
 * display a value the settings file does not hold.
 */
export class RolePanel {
	/** Writes that reached the settings file, in the order the user made them. */
	private readonly changes: PendingWrite[] = [];
	/**
	 * The reason the last edit refused, carried by the row that refused it.
	 *
	 * A list edit goes wrong inside the list, so its reason belongs there rather than in notices stacking
	 * up behind a screen the user is still looking at (spec `managed-commands` / 理由を一覧の中に出す).
	 */
	private refused: { rowId: string; reason: string } | undefined;
	/** Re-read on every call, so the screen cannot show a value the file does not hold. */
	private readonly read: PanelRead;
	/** The same writes the command performs. */
	private readonly writes: RoleWriteDeps;
	/** What the screen does besides writing: draw the badge, the way the command does. */
	private readonly hooks: RolePanelHooks;

	constructor(read: PanelRead, writes: RoleWriteDeps, hooks: RolePanelHooks = {}) {
		this.read = read;
		this.writes = writes;
		this.hooks = hooks;
	}

	/** Whether anything this list changed is waiting to be read back by a reload. */
	hasWrites(): boolean {
		return this.changes.length > 0;
	}

	/** Every row, in screen order: the lock, the two roles, then each step's two items. */
	rows(): RolePanelRow[] {
		const refused = this.refused;
		if (!refused) return this.buildRows();
		// The refusal rides on the row that caused it and disappears on the next redraw, so a corrected
		// write clears it without any code remembering to.
		return this.buildRows().map((row) =>
			row.id === refused.rowId ? { ...row, description: `${FAILURE_PREFIX}${refused.reason}. ${row.description}` } : row,
		);
	}

	/** The rows as the session reads, before a refused edit is written on one of them. */
	private buildRows(): RolePanelRow[] {
		const current = this.read(this.changes);
		const settings = current.settings;
		const step = current.step;
		// The role the running step actually takes, which is its own setting, then the step list's default,
		// then the lock. `current.lock` alone would say a strong-default step runs on the lock.
		const stepRole = step ? resolveRequestRole(step, settings, step.defaultRole ?? current.lock) : current.lock;
		// The resolution the route would reach right now, so a row never promises a model that would not
		// answer and never calls an unreadable value unset.
		const targets = roleResolutionLines(settings, current.lookup, {
			...(current.previous ? { previous: current.previous } : {}),
			...(current.ignored ? { ignored: current.ignored } : {}),
		});
		const warning = lockWarning(current, stepRole, settings);
		const rows: RolePanelRow[] = [
			{
				id: LOCK_ROW,
				label: "role lock",
				description:
					`Requests run on the locked role unless a step says otherwise. ` +
					(step
						? `The ${step.name} step is running and runs ${stepRole}; it ${step.continuing ? "continues after its run" : "ends with its run"}.`
						: "No step is running.") +
					// The way out of a step belongs on the row a user reads when the session is running on a
					// model they did not pick (design Risks).
					" A continuing step ends on a role lock or on /spirits-clear." +
					" " +
					(current.last
						? `Last request: ${current.last.role} on ${current.last.model}${current.last.thinkingLevel ? ` at ${current.last.thinkingLevel}` : ""}.`
						: "No request since the last reload.") +
					// The list says nothing out loud, so the notice a command would send belongs here
					// (spec `managed-commands` / 設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える).
					// Spaced, because the sentence before it does not end in one.
					(warning ? ` ${warning}` : ""),
				currentValue: current.lock,
				values: [...MODEL_ROLES],
			},
		];
		for (const role of [MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG] as const) {
			rows.push(modelRow(role, current, targets));
			rows.push(levelRow(role, current));
		}
		for (const definition of STEP_DEFINITIONS) rows.push(stepRow(definition, current, targets));
		return rows;
	}

	/**
	 * Apply one submenu choice to a row, then redraw the rows with whatever the write left behind.
	 *
	 * The caller gets the write back, because a step's second stage depends on the first: a role the file
	 * refused has to leave the level list closed (spec `managed-commands` / 一覧のステップの行は 2 段で選ぶ).
	 */
	edit(rowId: string, value: string): RoleWrite {
		const write = this.apply(rowId, value);
		// A step writes through the half of it the submenu chose, and the refusal has to land on the one row
		// that shows both halves.
		this.refused = write.saved ? undefined : { rowId: rowOfSetting(rowId), reason: write.failure ?? write.message };
		// The host's settings will not carry this until the reload that closes the screen, so the list
		// carries it itself: that is what lets a row's description show the new resolution.
		if (write.saved && write.wrote) this.changes.push(write.wrote);
		return write;
	}

	/** The write one row choice stands for, before its outcome is remembered for the next redraw. */
	private apply(rowId: string, value: string): RoleWrite {
		if (rowId === LOCK_ROW) {
			// The lock lands in the phase at once, so the next read already shows it; there is nothing to
			// fold in the way a settings path needs. The badge follows it whatever the file says, because the
			// session really is locked and the command draws it the same way (spec `managed-commands` /
			// 一覧のロックの行は保存に失敗してもセッションのロックを示す).
			//
			// Applying a lock is two steps — the phase, then the session record — and the second one can throw
			// where the first already landed. So the badge is drawn in a `finally`, and from the phase rather
			// than from `value`: after a failed record the two agree, and before one they would not
			// (d-verify4 C-2).
			try {
				return applyRoleLock(this.writes, value);
			} finally {
				// From the phase rather than from the rows: the read that builds them also reads the settings
				// file, and a read that raises there must not leave the lock undrawn (d-verify5 W-1).
				this.hooks.lockDrawn?.(this.hooks.sessionLock?.() ?? this.read(this.changes).lock);
			}
		}
		const setting = rowSetting(rowId);
		if (!setting) {
			// A row id this panel did not build means the caller and the row list disagree, which is a bug
			// rather than a user error. Saying so beats writing to a path nobody named.
			return { message: `${rowId} is not a setting row`, saved: false, failure: "unknown row" };
		}
		// A model row accepts only a reference it offered, so an empty catalog — or any value the row never
		// listed — writes nothing (spec `managed-commands` / 利用できるモデルが無いときの候補).
		if (setting.item === "model") {
			const row = this.rows().find((candidate) => candidate.id === rowId);
			if (!row || row.values.length === 0 || !row.values.includes(value)) {
				return { message: `no models available, so nothing to set`, saved: false, failure: "no choice offered" };
			}
		}
		return applyRoleSetting(this.writes, setting, rowValue(value));
	}
}

/**
 * The row a setting write belongs to.
 *
 * A step is one row shown as a pair, so the two halves a submenu writes refuse the same row.
 */
function rowOfSetting(rowId: string): string {
	if (!rowId.startsWith(STEP_ROW)) return rowId;
	const rest = rowId.slice(STEP_ROW.length);
	const dot = rest.lastIndexOf(".");
	return dot === -1 ? rowId : `${STEP_ROW}${rest.slice(0, dot)}`;
}

/** The notice a lock change would get, worded as the command words it, for the lock row's description. */
function lockWarning(current: RolePanelSnapshot, stepRole: string, settings: RoutingSettings): string | undefined {
	return roleSettingWarning({
		setStrong: current.lock === MODEL_ROLE_STRONG || stepRole === MODEL_ROLE_STRONG,
		strongUnresolved: !strongIsUsable(settings, current.lookup),
		physicalModelSelected: current.routingOff === true,
	});
}

/**
 * The row for one role's model: the saved reference as the value, the model that would answer as the
 * description.
 *
 * Those differ exactly when the saved reference cannot be used, and the description is where the user
 * finds that out (spec `managed-commands` / 一覧の説明は実際の解決結果を示す).
 *
 * Both roles' resolutions go in, because a role with nothing set does not answer, and the row has to say
 * what does: an unset strong runs on normal's model, and naming only "normal" leaves the user to work out
 * which model that is (d-verify4 W-2).
 */
function modelRow(
	role: string,
	current: RolePanelSnapshot,
	targets: { normal: RoleResolutionLine; strong: RoleResolutionLine },
): RolePanelRow {
	const target = targets[role === MODEL_ROLE_STRONG ? MODEL_ROLE_STRONG : MODEL_ROLE_NORMAL];
	const spec = role === MODEL_ROLE_STRONG ? current.settings.strong : current.settings.normal;
	// The four states a target can be in say four different things, and the resolution — not the settings
	// file — is what tells them apart. A value the reader dropped is not unset, a target the catalog cannot
	// use is not an answer, and a normal request with nothing saved can still be answering on pi's default
	// or on the last successful response.
	const description =
		target.target === "unreadable"
			? `${role} holds a value routing cannot read: ${target.source}`
			: target.target === "unset"
				? `${role} has no model of its own, so a ${role} request runs normal${
						targetAnswers(targets.normal) ? ` on ${targets.normal.target}` : ""
					}. Set one here, or with /spirits-role ${role} model <provider/id>.`
				: target.target === "unusable"
					? `${role} cannot use what is set: ${target.source}`
					: target.target === "unresolved"
						? `Nothing answers ${role} requests: ${target.source}`
						: `${role} answers with ${target.target} (${target.source}).`;
	// The same warning a command sends for strong, on the row that sets strong's target: a user who sets a
	// step to strong from the list needs it there too, where no notice is allowed (design Decision 4).
	const strongWarning =
		role === MODEL_ROLE_STRONG
			? roleSettingWarning({
					setStrong: true,
					strongUnresolved: !strongIsUsable(current.settings, current.lookup),
					physicalModelSelected: current.routingOff === true,
				})
				: undefined;
	return {
		id: `${role}.model`,
		label: `${role} model`,
		description: strongWarning ? `${description} ${strongWarning}` : description,
		currentValue: spec ? modelKey(spec) : role === MODEL_ROLE_NORMAL ? PI_DEFAULT_LABEL : UNSET,
		// With no catalog there is nothing to pick, and `unset` is not a substitute for one: a row that
		// offered it would let the screen write where the user chose nothing.
		values: current.modelChoices.length === 0 ? [] : [...current.modelChoices, UNSET],
		models: true,
	};
}

/** The row for one role's thinking level. */
function levelRow(role: string, current: RolePanelSnapshot): RolePanelRow {
	// The level on the row is the one a request on this role carries. When strong has nothing to run on,
	// a strong request runs normal, so the row has to name normal's level rather than strong's setting
	// (spec `managed-commands` / 一覧の説明の thinking レベルは要求に載るレベルを示す).
	const plan = resolveRequestPlan({
		settings: current.settings,
		phaseRole: role,
		lookup: current.lookup,
		...(current.sessionThinkingLevel ? { sessionThinkingLevel: current.sessionThinkingLevel } : {}),
		...(current.previous ? { previous: { model: current.previous } } : {}),
	});
	// Nothing of ours is set for this role and the snapshot carried no session selection, so the row points
	// at pi's own selection rather than naming one — and rather than calling it `off`, which is one of the
	// seven levels it might not be (d-verify4 G-1).
	const level = plan.thinkingLevel ?? SESSION_LEVEL_WORDS;
	const description =
		role === MODEL_ROLE_STRONG && plan.strongUnavailable
			? `strong requests run normal and carry ${level}. Set a usable strong model with /spirits-role ${role} model <provider/id>. pi rounds a level the model cannot take.`
			: `${role} requests ask for ${level}. pi rounds a level the model cannot take.`;
	return {
		id: `${role}.thinking`,
		label: `${role} thinking`,
		description,
		currentValue: (role === MODEL_ROLE_STRONG ? current.settings.thinking?.strong : current.settings.thinking?.normal) ?? UNSET,
		values: [...THINKING_CHOICES],
	};
}

/**
 * Apply one submenu choice to a row, then redraw the rows with whatever the write left behind.
 *
 * The write comes back because a step's second stage depends on the first: a role the file refused has to
 * send the user back to the row that says why, not on to the level list.
 */
type Writer = (rowId: string, value: string) => RoleWrite;

/**
 * The row a step's pair of settings gets.
 *
 * One row, one submenu, and a description that reads as the route does: the role the step takes, the
 * model that answers on it, the level its requests ask for, and whether the step outlives its run. The
 * settings pair alone would describe neither the step that follows the lock nor the one set to a strong
 * that has nothing to run on (spec `managed-commands` / 一覧の説明は実際の解決結果を示す, design Decision 11).
 */
function stepRow(
	definition: StepDefinition,
	current: RolePanelSnapshot,
	targets: { normal: RoleResolutionLine; strong: RoleResolutionLine },
): RolePanelRow {
	const entry = current.settings.steps?.[definition.name];
	// The step read the way the route reads it, so a step that is not running is described by the same
	// resolution a request in it would take.
	const view: ActiveStep = {
		name: definition.name,
		...(definition.defaultRole ? { defaultRole: definition.defaultRole } : {}),
		continuing: definition.continuing,
		starters: definition.starters,
	};
	// The row reads the same resolution the route would, so the model and the level it names are the ones a
	// request in this step would send. A strong that falls back to normal shows normal's model and level.
	const plan = resolveRequestPlan({
		step: view,
		settings: current.settings,
		phaseRole: definition.defaultRole ?? current.lock,
		lookup: current.lookup,
		...(current.sessionThinkingLevel ? { sessionThinkingLevel: current.sessionThinkingLevel } : {}),
		...(current.previous ? { previous: { model: current.previous } } : {}),
	});
	const level = plan.thinkingLevel ?? SESSION_LEVEL_WORDS;
	// A step set to strong does not answer on strong when strong has nothing to run on, and the row is
	// where that shows: the warning a command sends has no place to go while the user is reading a list.
	const answers = plan.role === MODEL_ROLE_STRONG && targetAnswers(targets.strong) ? targets.strong : targets.normal;
	const sentences: string[] = [
		entry?.role
			? `Runs ${plan.role}, which you set.`
			: definition.defaultRole
				? `Runs ${definition.defaultRole}, its step-list default. Unset follows the lock (${current.lock}).`
				: entry
					? `No role is set, so ${definition.name} follows the lock (${current.lock}).`
					: `Nothing is set, so ${definition.name} follows the lock (${current.lock}).`,
		plan.model ? `It answers with ${modelKey(plan.model)}.` : `Nothing answers it: ${answers.source}.`,
		`It asks for ${level}.`,
		definition.continuing
			? "It continues after its run, until a role lock, /spirits-clear, or another step."
			: "It ends with its run.",
	];
	const strongWarning =
		plan.role === MODEL_ROLE_STRONG && plan.strongUnavailable
			? roleSettingWarning({
					setStrong: true,
					strongUnresolved: true,
					physicalModelSelected: current.routingOff === true,
				})
			: undefined;
	if (strongWarning) sentences.push(strongWarning);
	if (current.missingStarters.has(definition.name)) sentences.push("This session has none of its starter commands.");
	return {
		id: `${STEP_ROW}${definition.name}`,
		step: definition.name,
		label: definition.name,
		description: sentences.join(" "),
		// The pair as one value, the halves spelled the way the command spells them.
		currentValue: `${entry?.role ?? UNSET}${STEP_VALUE_SEPARATOR}${entry?.thinking ?? UNSET}`,
		// The submenu offers the role first and the level second, so the row's own list is the first stage.
		values: [...ROLE_CHOICES],
	};
}

/**
 * Open the list, and reload once when it closes.
 *
 * One reload for a batch of edits rather than one per keystroke, and no reload at all for a browse that
 * changed nothing: a reload restarts the extension runtime, and a user who only looked should not pay
 * for it.
 */
export async function openRolePanel(ctx: ExtensionCommandContext, panel: RolePanel): Promise<boolean> {
	await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
		const items: TuiSettingItem[] = [];

		/**
		 * Show a refusal on the row that caused it, inside the list.
		 *
		 * pi-tui calls `handleInput` without a try (`packages/tui/src/tui.ts`), so an exception that escapes
		 * an edit ends the whole process through pi's `uncaughtException` handler. A failed edit belongs on
		 * the row the user is looking at, not in the terminal's crash output (design Decision 11).
		 */
		const showFailure = (rowId: string, error: unknown): void => {
			const reason = error instanceof Error ? error.message : String(error);
			const item = items.find((candidate) => candidate.id === rowOfSetting(rowId));
			if (item) item.description = `${FAILURE_PREFIX}${reason}. ${item.description}`;
		};

		/**
		 * Re-read every row into the rows the screen already holds.
		 *
		 * `SettingsList` keeps the objects it was handed and redraws those, so a saved edit has to move
		 * the value and the description together: the description is the resolution, and a stale one
		 * would name a model the session no longer uses.
		 */
		const refresh = (): void => {
			panel.rows().forEach((row, index) => {
				const item = items[index];
				if (!item) return;
				item.currentValue = row.currentValue;
				item.description = row.description;
			});
		};

		/**
		 * Say on the row that its change landed while the redraw could not read the session.
		 *
		 * The value the edit moved is carried by hand, because the read that would have moved it is the thing
		 * that failed, and a row left on the pre-edit value with `not saved` on it takes back a change the
		 * session made (d-verify5 W-1).
		 */
		const redrawFailed = (rowId: string, value: string, error: unknown): void => {
			const reason = error instanceof Error ? error.message : String(error);
			const item = items.find((candidate) => candidate.id === rowOfSetting(rowId));
			if (!item) return;
			item.currentValue = landedValue(item.currentValue, rowId, value);
			item.description = `${REDRAW_FAILURE_PREFIX}${reason}. ${item.description}`;
		};

		const write: Writer = (rowId, value) => {
			let write: RoleWrite;
			try {
				write = panel.edit(rowId, value);
			} catch (error) {
				// The write itself raised, or something after it raised while the rows still rebuilt.
				//
				// The rows are rebuilt first, because part of the change may well have landed — a lock is in the
				// phase before its record is appended — and a row left on the pre-edit value would contradict
				// the session (d-verify4 C-2). The reason then rides on the fresh description.
				try {
					refresh();
				} catch {
					// The redraw itself failed, so the rows keep what they held. The reason still goes on them.
				}
				showFailure(rowId, error);
				return {
					message: `set ${rowId} ${value}; the row was not saved`,
					saved: false,
					failure: error instanceof Error ? error.message : String(error),
				};
			}
			// The change is in the session. Re-reading the rows touches the host, and a read that raises here
			// says so on the row instead of undoing a save that happened (d-verify5 W-1).
			try {
				refresh();
			} catch (error) {
				redrawFailed(rowId, value, error);
			}
			return write;
		};

		for (const row of panel.rows()) {
			items.push({
				id: row.id,
				label: row.label,
				// The whole pair of a step row, so a redraw after one stage's write moves the value and the
				// description together; `SettingsList` reads these fields, not the row it was handed.
				description: row.description,
				currentValue: row.currentValue,
				// The `done` pi-tui hands in closes this submenu and returns to the list. The outer `done`
				// from `ctx.ui.custom()` ends the screen, so nothing a submenu does may call it — an Esc that
				// dismisses the whole settings screen instead of one choice list is the bug that proves it.
				submenu: (current, close) => rowSubmenu(row, current, theme, write, close),
			});
		}
		return new SettingsList(items, MAIN_VISIBLE_ROWS, settingsListTheme(theme), () => {}, () => done());
	});
	// The panel knows what reached the file, so a screen the user only looked through costs no restart.
	// Reading it here rather than threading a flag through the callbacks is what keeps the submenu code
	// about editing and nothing else.
	if (!panel.hasWrites()) return false;
	await ctx.reload();
	return true;
}

/**
 * The submenu one row opens.
 *
 * `close` is the callback pi-tui hands the submenu: it ends the submenu and returns to the list. Every
 * submenu has to be able to call it — the main list hands all of its input to the open submenu, so a
 * submenu with no way back is a screen the user is stuck in.
 */
export function rowSubmenu(
	row: RolePanelRow,
	current: string,
	theme: Theme,
	write: Writer,
	close: (selected?: string, options?: { navigateTo?: string }) => void,
): Component {
	if (row.values.length === 0) return notice(`${row.label} has no choices to offer right now.`, settingsListTheme(theme), close);
	if (row.step === undefined) {
		return choiceList(
			row.values,
			current,
			theme,
			(value) => {
				write(row.id, value);
				close();
			},
			close,
		);
	}
	return stepStages(row.step, stepRowValue(current), theme, write, close);
}

/**
 * The two stages of a step row, inside one submenu.
 *
 * The step is one row, so its second list opens in the same submenu rather than on a row of its own — the
 * screen the user came back to is the step's row, with the value and the description the first write
 * produced. Both stages close through the same callback, so Esc means the same thing on either: back to
 * the list, with whatever the earlier stage already wrote left in place (spec `managed-commands` /
 * 一覧のステップの行は 2 段で選ぶ).
 */
function stepStages(
	name: string,
	current: { role: string; thinking: string },
	theme: Theme,
	write: Writer,
	close: (selected?: string) => void,
): Component {
	// The stage the screen is showing. `SettingsList` hands every key to this component while the submenu
	// is open, so swapping the stage cannot leak a keystroke to the list behind it.
	let stage = roleStage();

	function roleStage(): Component {
		return choiceList(
			[...ROLE_CHOICES],
			current.role,
			theme,
			(value) => {
				const result = write(`${STEP_ROW}${name}.role`, value);
				// A role the settings file refused goes back to the list, where the row now says why. Opening
				// the level list on top of it would hide the reason behind another choice.
				if (!result.saved) {
					close();
					return;
				}
				stage = thinkingStage();
			},
			close,
		);
	}

	function thinkingStage(): Component {
		return choiceList(
			[...THINKING_CHOICES],
			current.thinking,
			theme,
			(value) => {
				write(`${STEP_ROW}${name}.thinking`, value);
				close();
			},
			close,
		);
	}

	return {
		render: (width) => stage.render(width),
		invalidate: () => stage.invalidate(),
		handleInput: (data) => stage.handleInput?.(data),
	};
}

/** A `SelectList` of `values`, preselecting `current`, calling `onPick` on Enter and `onCancel` on Esc. */
function choiceList(
	values: readonly string[],
	current: string,
	theme: Theme,
	onPick: (value: string) => void,
	onCancel: () => void,
): SelectList {
	const items: SelectItem[] = values.map((value) => ({
		value,
		label: value,
		description: value === UNSET ? "back to unset" : undefined,
	}));
	const list = new SelectList(items, SUBMENU_VISIBLE_ROWS, selectListTheme(theme));
	const index = values.indexOf(current);
	if (index >= 0) list.setSelectedIndex(index);
	list.onSelect = (selected) => onPick(selected.value);
	// An empty cancel is what turns a choice screen into a trap, because the main list forwards every key
	// here while it is open (spec `managed-commands` / 各 submenu は Esc で閉じられる).
	list.onCancel = onCancel;
	return list;
}

/** The one-line submenu for a row with nothing to offer. Esc closes it like any other choice list. */
function notice(text: string, theme: SettingsListTheme, close: () => void): Component {
	return {
		render: () => [theme.description(`  ${text}`), theme.description("  Esc goes back")],
		invalidate: () => {},
		handleInput: (data) => {
			// Matched through pi's keybindings rather than a literal byte, so the gesture stays the one the
			// user configured everywhere else.
			if (getKeybindings().matches(data, "tui.select.cancel")) close();
		},
	};
}

/**
 * The main list's colors, built from the theme the host handed the screen.
 *
 * pi builds the same five fields for its own settings screen, and `SettingsList` reads every one of them
 * while it renders, so a partially filled theme throws inside the extension instead of drawing half a
 * list. Taking the colors from the theme the factory received, rather than from pi's theme singleton, is
 * what lets the screen be built outside a terminal — which is how this file is tested.
 */
export function settingsListTheme(theme: Theme): SettingsListTheme {
	return {
		label: (text, selected) => (selected ? theme.fg("accent", text) : text),
		value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
		description: (text) => theme.fg("dim", text),
		cursor: theme.fg("accent", "\u2192 "),
		hint: (text) => theme.fg("dim", text),
	};
}

/** A submenu's colors, under the same rule: all five fields, always, all from the host theme. */
export function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("muted", text),
		noMatch: (text) => theme.fg("muted", text),
	};
}
