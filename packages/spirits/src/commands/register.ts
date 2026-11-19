/**
 * Wiring of the managed command surface.
 *
 * The host takes no part in the role, the step, or the conversation boundary, so this surface is what
 * puts them on a session. It registers:
 *
 * - `/spirits-role`, which locks the role, sets a role or step target and thinking level, reports how
 *   the routing is running, and opens the settings list on a terminal;
 * - `/spirits-clear`, the conversation boundary;
 * - the `context` handler that keeps cleared conversation out of the LLM context;
 * - the `session_before_compact` handler that stops a compaction from summarizing it back in;
 * - the footer badge, refreshed on every session start.
 *
 * Everything with a side effect goes through `pi`, the injected settings writer, or the routing phase,
 * so a test can drive the whole surface without pi.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "../types/host.ts";
import { readIgnoredSettings, readRoutingSettings } from "../config.ts";
import { globalSettingsPath, readSettingsFile } from "./settings-store.ts";
import type { RoutingSettings } from "../config.ts";
import {
	CLEAR_ENTRY_TYPE,
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_ROLE,
	MODEL_ROLES,
	MODEL_ROLE_STRONG,
	ROLE_ENTRY_TYPE,
	ROLE_SAVE_WORD,
	EXTENSION_MODE_PRINT,
	EXTENSION_MODE_TUI,
	ROUTING_MODEL_REFERENCE,
	INPUT_SOURCE_INTERACTIVE,
	STEP_CONFIRM_CANCEL,
	STEP_CONFIRM_CONTINUE,
	STEP_CONFIRM_TIMEOUT_MS,
	STEP_CONFIRM_TIMEOUT_SLACK_MS,
	STEP_DEFINITIONS,
	STEP_ENTRY_TYPE,
	THINKING_LEVELS,
	isRoutingModel,
} from "../constants.ts";
import type { RoutingPhase } from "../routing/phase.ts";
import { stepEntryDisposition } from "../routing/phase.ts";
import { resolveRequestRole } from "../routing/router.ts";
import { latestSuccessfulModel, modelKey } from "../routing/resolve.ts";
import { alreadyCleared, boundaryCompactionResult, clearedMessageCount } from "./clear.ts";
import type { InputEvent } from "@earendil-works/pi-coding-agent";
import {
	createRoleBadge,
	formatModelKey,
	formatRoleStatus,
	routingModelGuide,
	roleBadgeLines,
	roleBadgeState,
	roleResolutionLines,
	roleSettingWarning,
	resolveModelTarget,
	stepSettingLines,
	inheritedRole,
	parseRoleCommand,
	type LastRequestReport,
	type RoleBadge,
	type RoleCommand,
	type RoleStatusReport,
} from "./role.ts";
import { RolePanel, missingStartersFor, modelChoices, openRolePanel } from "./role-panel.ts";
import {
	applyRoleLock,
	applyRoleSave,
	applyRoleSetting,
	strongIsUsable,
	type RoleWriteDeps,
	type SessionSelection,
	type SettingChange,
} from "./role-write.ts";
import {
	patchGlobalSettings,
	patchGlobalSettingsIfChanged,
	patchGlobalSettingsPath,
	writePathValue,
} from "./settings-store.ts";
import type { SettingsPatch, SettingsPatchDecider, SettingsPath } from "./settings-store.ts";

/** What the command surface needs from the host. */
export interface ManagedCommandsDeps {
	/**
	 * The step methods the command surface reads and ends. `beginSession` and `handleInput` belong to the
	 * routing layer that owns the phase, so this surface never reaches for them.
	 */
	phase: Pick<
		RoutingPhase,
		| "current"
		| "lock"
		| "setRole"
		| "restoreLock"
		| "restoreStep"
		| "step"
		| "endStep"
		| "undoInput"
		| "undoToken"
		| "rejectStep"
		| "stepStartedByInput"
	>;
	/** Footer badge, shared with the route's role reporting. A test can leave it out. */
	badge?: RoleBadge;
	/** The last request the routing answered, for `status`. */
	lastRequest?: () => LastRequestReport | undefined;
	/** Effective settings, read per command so a report and a warning cannot read a stale file. */
	readSettings?: () => RoutingSettings;
	/**
	 * Settings writers. Production writes pi's global file through `settings-store.ts`; a test replaces
	 * them to watch the writes without touching a file. Both surfaces — the command and the settings list
	 * — go through these two, which is what makes a list edit and a command line one behavior.
	 */
	patchSettings?: (patch: SettingsPatch) => void;
	patchSettingsPath?: (path: SettingsPath, value: unknown) => void;
	/**
	 * The conditional write `save` performs: compare the global file against the session under the file's
	 * own lock and write the difference once. A test replaces it to watch what the save decided without
	 * touching a file.
	 */
	saveSettings?: (decide: SettingsPatchDecider) => Record<string, unknown> | undefined;
	/**
	 * The read of pi's global settings file behind the `save` row's preview.
	 *
	 * A test seam, not a production switch: the default is `globalSettingsPath()`'s real file, injected for
	 * the same reason the two writers are — a test drives the preview without pointing the extension at a
	 * real agent directory. Withdraw it once a test can isolate the agent dir for a whole file (design
	 * Decision 5).
	 */
	readGlobalSettings?: () => Record<string, unknown>;
	/**
	 * The clocks of the step-start confirmation, in milliseconds.
	 *
	 * The defaults are the wait the product promises; a test hands a pair of its own so the boundary between
	 * "the wait ran out" and "the user closed it" is measured in tens of milliseconds rather than ten seconds.
	 */
	stepConfirmClock?: { timeoutMs: number; slackMs: number };
}

/** The usage line shown for a line the grammar cannot read, and for an item that needs one. */
// The line names how a step ends as well as how a setting is written: a continuing step keeps its role
// and its model after the run, so a user who wonders why the answers stayed strong has to be told the
// way out at the moment the command refuses their line.
const USAGE =
	"use /spirits-role <normal|strong> to lock, /spirits-role <role> model <provider/id>, /spirits-role <role|step> thinking <level>, /spirits-role <step> role <role>, /spirits-role save (it takes no item or value), unset to clear, or status. a step ends on a role lock, on /spirits-clear, or when another step starts.";

/** Register the managed commands and the context handlers. */
export function registerManagedCommands(pi: ExtensionAPI, deps: ManagedCommandsDeps): void {
	const badge = deps.badge ?? createRoleBadge();
	const readSettings = deps.readSettings ?? (() => readRoutingSettings(pi.getSettings()));

	/** The writes the command and the list share, so neither can have a settings file of its own. */
	const writes: RoleWriteDeps = {
		lockRole: (role) => {
			// The phase is the lock pi obeys for the rest of the session; the entry is what a resume reads
			// back. Both here, so a lock is never half-applied. Locking ends the running step, which the
			// phase reports through its own hook.
			deps.phase.setRole(role);
			pi.appendEntry(ROLE_ENTRY_TYPE, { role });
		},
		patchSettings: deps.patchSettings ?? patchGlobalSettings,
		patchSettingsPath: deps.patchSettingsPath ?? patchGlobalSettingsPath,
		saveSettings: deps.saveSettings ?? patchGlobalSettingsIfChanged,
	};

	/**
	 * Run one parsed command line.
	 *
	 * The order is fixed by the spec: the session change, then the settings file, then the notice, then
	 * `ctx.reload()` as the last statement. A file that refuses keeps the session change and skips the
	 * reload, because the defaults a reload would read are the unchanged ones.
	 */
	async function run(command: RoleCommand, ctx: ExtensionCommandContext): Promise<void> {
		switch (command.kind) {
			case "usage": {
				ctx.ui.notify(`${command.reason}\n${USAGE}`, "warning");
				return;
			}
			case "status": {
				ctx.ui.notify(formatRoleStatus(statusReport(ctx)), "info");
				return;
			}
			case "save": {
				// A save writes a file and nothing else: no lock, no model change, no thinking change, no
				// session record, and no reload. A reload would re-read the project defaults over the lock and
				// the step this session holds, and the host refuses one while a response is running, so the
				// command reports and stops (spec `managed-commands` / save はディスク上の結果と実効状態を区別する).
				const write = applyRoleSave(writes, selectionOf(ctx), ctx.modelRegistry);
				// The notice's kind follows the outcome: a write that landed and a file that already agreed are
				// both information, and only a refusal is an error.
				ctx.ui.notify(write.message, write.failure ? "error" : "info");
				if (!write.saved) return;
				warnAfterChange({ askingForStrong: false, wrote: write.wrote }, ctx);
				return;
			}
			case "panel": {
				// `hasUI` is true in RPC mode too, where `custom()` returns nothing at all, so the mode is
				// what decides whether the list can open (design Decision 11).
				if (ctx.mode !== EXTENSION_MODE_TUI) {
					// print is the one mode that must stay silent: its stdout is the model's answer, and an
					// argumentless `/spirits-role` has no answer to add to it (design Decision 9).
					if (ctx.mode === EXTENSION_MODE_PRINT) return;
					ctx.ui.notify(formatRoleStatus(statusReport(ctx)), "info");
					return;
				}
				await openRolePanel(ctx, panel(ctx));
				return;
			}
			case "lock": {
				const write = applyRoleLock(writes, command.role);
				// The badge follows the lock at once: the reload below redraws it on the new runtime, and a
				// reload that never happens must not leave the old runtime showing the previous role.
				drawBadge(ctx, command.role);
				ctx.ui.notify(write.message, write.saved ? "info" : "error");
				if (!write.saved) return;
				warnAfterChange({ askingForStrong: command.role === MODEL_ROLE_STRONG, wrote: write.wrote }, ctx);
				await ctx.reload();
				return;
			}
			case "set": {
				const setting = command.setting;
				let value = command.value;
				if (setting.item === "model" && value !== undefined) {
					const target = resolveModelTarget(ctx.modelRegistry.getAvailable(), value);
					if ("error" in target) {
						ctx.ui.notify(`${target.error}\n${USAGE}`, "warning");
						return;
					}
					value = formatModelKey(target.model);
				}
				const write = applyRoleSetting(writes, setting, value);
				ctx.ui.notify(write.message, write.saved ? "info" : "error");
				if (!write.saved) return;
				// Every setting change gets the same look: the strong half of the notice only applies to a
				// change that asked for strong, the routing-is-off half to any change at all.
				warnAfterChange({ askingForStrong: isStrongChange(setting, value), wrote: write.wrote }, ctx);
				await ctx.reload();
				return;
			}
		}
	}

	/**
	 * Say the one thing a change needs, without taking the change back.
	 *
	 * Two notices exist and each has its own trigger: any command change while the session sits on a
	 * physical model says the routing is not in force, and only a change that asked for strong says when
	 * strong has nothing to run on. Setting strong's own target is never that second notice (spec
	 * `managed-commands` / 設定時の警告は書き込んだ値で判定し).
	 *
	 * The judgment reads the settings with this command's own write folded in: `pi.getSettings()` serves
	 * the values from before the write until the reload, so `/spirits-role strong model <ref>` would
	 * otherwise be told that the target it just wrote does not exist (design Decision 4).
	 */
	/**
	 * pi's global settings file for the `save` row's preview, or the reason it could not be read.
	 *
	 * Read on every draw, the same way the rest of the snapshot is: another process can save between two
	 * redraws, and the preview has to be the one the file supports. A failure is carried as a reason rather
	 * than raised, because the ordinary rows read through the host and must stay usable.
	 */
	function globalPreview(): { globalSettings: Record<string, unknown> } | { globalSettingsError: string } {
		try {
			return { globalSettings: (deps.readGlobalSettings ?? (() => readSettingsFile(globalSettingsPath())))() };
		} catch (error) {
			return { globalSettingsError: error instanceof Error ? error.message : String(error) };
		}
	}

	/**
	 * What this session selects, in the two facts `save` writes.
	 *
	 * The lock is the phase's, not the running step's role: a step's role is temporary and making it a
	 * default would be making a side effect permanent (design Decision 4). The model is the host's
	 * selection, which may be the routing model or nothing at all.
	 */
	function selectionOf(ctx: ExtensionCommandContext): SessionSelection {
		const model = ctx.model;
		return {
			role: deps.phase.lock(),
			...(model?.provider !== undefined && model.id !== undefined ? { model: { provider: model.provider, id: model.id } } : {}),
		};
	}

	function warnAfterChange(
		change: { askingForStrong: boolean; wrote: readonly SettingChange[] },
		ctx: ExtensionCommandContext,
	): void {
		// A change now lands on more than one key — `save` writes the role and the model pair together — so
		// the fold is over a list. An empty list is a write that changed nothing, which reads the settings as
		// they stand.
		const settings =
			change.wrote.length > 0
				? readRoutingSettings(
						change.wrote.reduce<unknown>(
							(current, part) => writePathValue(current, part.path, part.value),
							pi.getSettings(),
						),
					)
					: readSettings();
		const physicalModelSelected = isPhysicalSelection(ctx);
		const warning = roleSettingWarning({
			setStrong: change.askingForStrong,
			strongUnresolved: change.askingForStrong && !strongIsUsable(settings, ctx.modelRegistry),
			physicalModelSelected,
			// Scope matters only for the instruction attached to a physical selection. A save on the routing
			// model must leave the host's scope entirely outside the operation (spec `managed-commands` /
			// save はモデルスコープを変更しない).
			scoped: physicalModelSelected && routingModelOutOfScope(ctx),
			interactive: ctx.mode === EXTENSION_MODE_TUI,
		});
		if (warning) ctx.ui.notify(warning, "warning");
	}

	/**
	 * Draw the badge from the state the session is in right now. This is the badge's only writing point.
	 *
	 * The value is the same resolution the route, the list, and `status` read, taken at the moment of
	 * drawing — the settings, the lock, the running step, and the session's model. Nothing writes a role the
	 * route reported, so a session that sends no request still reads the truth and the line cannot promise a
	 * role the next request will not use (spec `managed-commands` /
	 * badge は状態の射影を決められた時点で描き直す).
	 *
	 * `lockedRole` overrides the phase's role for the one caller that cannot wait for a re-read: the list
	 * draws the badge right after applying a lock, and the read that would confirm the lock is the read that
	 * may just have failed (d-verify5 W-1).
	 */
	function drawBadge(ctx: ExtensionContext, lockedRole?: string): void {
		const role = lockedRole ?? deps.phase.current();
		// Read first and outside the try: the session's model is a property rather than a call, so the one
		// fact the fallback below needs is the one fact it can still have.
		const physical = isPhysicalSelection(ctx);
		try {
			const step = deps.phase.step();
			const previous = latestSuccessfulModel(ctx.sessionManager.getBranch(), ctx.modelRegistry).model;
			badge.update(
				roleBadgeLines(
					roleBadgeState({
						routingEnabled: !physical,
						settings: readSettings(),
						phaseRole: role,
						...(step ? { step } : {}),
						lookup: ctx.modelRegistry,
						...(ctx.thinkingLevel ? { sessionThinkingLevel: ctx.thinkingLevel } : {}),
						...(previous ? { previous } : {}),
					}),
				),
				ctx,
			);
		} catch {
			// A projection reads the host, and the host can refuse one in the middle of a change — the settings
			// file that went unreadable right after the write landed. The line still has to agree with what the
			// session holds, and the lock it holds is the one fact that needs no read: draw the role alone and
			// let the model come back with the next draw (d-verify5 W-1).
			badge.update(roleBadgeLines(physical ? { kind: "off" } : { kind: "role", role }), ctx);
		}
	}

	/** Whether a settings change asks for strong: a step set to strong, and nothing else. */
	function isStrongChange(setting: { target: "role" | "step"; name: string; item: string }, value: string | undefined): boolean {
		return setting.target === "step" && setting.item === "role" && value === MODEL_ROLE_STRONG;
	}

	/** Everything `status` shows, gathered from the phase, the settings, and the host. */
	function statusReport(ctx: ExtensionCommandContext): RoleStatusReport {
		const settings = readSettings();
		const step = deps.phase.step();
		// Ignored values are the settings file's own words, so they are read from the raw settings object
		// rather than from the routing view that already dropped them. They also tell a written-but-
		// unreadable target apart from one that was never set.
		const ignored = readIgnoredSettings(pi.getSettings());
		const previous = latestSuccessfulModel(ctx.sessionManager.getBranch(), ctx.modelRegistry).model;
		// The same targets the route would resolve, the last successful response included: a report that
		// read the settings instead would call an unusable target the answer.
		const targets = roleResolutionLines(settings, ctx.modelRegistry, { ...(previous ? { previous } : {}), ignored });
		const physical = isPhysicalSelection(ctx);
		return {
			routingEnabled: !physical,
			sessionModel: physical && ctx.model ? modelKey(ctx.model) : ROUTING_MODEL_REFERENCE,
			routingModelInScope: !routingModelOutOfScope(ctx),
			interactive: ctx.mode === EXTENSION_MODE_TUI,
			lock: deps.phase.lock(),
			...(step
				? { step: { name: step.name, continuing: step.continuing, role: resolveRequestRole(step, settings, deps.phase.current()) } }
				: {}),
			...(deps.lastRequest ? { last: deps.lastRequest() } : {}),
			normal: targets.normal,
			strong: targets.strong,
			stepSettings: stepSettingLines(settings),
			ignored: ignored.map((entry) => `${entry.path}: ${entry.reason}`),
		};
	}

	/**
	 * The settings list, reading the same sources the command reads.
	 *
	 * The read runs again on every screen draw, and the list's own writes come back as `written`. They are
	 * folded into the raw settings object with `writePathValue`, the same primitive the write itself uses,
	 * because `pi.getSettings()` will not carry them until the reload that closes the screen — and a row
	 * that kept describing the startup settings would describe a session the user has already left (spec
	 * `managed-commands` / 書き込んだ直後の行の説明).
	 */
	function panel(ctx: ExtensionCommandContext): RolePanel {
		return new RolePanel(
			(written) => {
				const raw = written.reduce<unknown>((settings, change) => writePathValue(settings, change.path, change.value), pi.getSettings());
				const settings = readRoutingSettings(raw);
				const previous = latestSuccessfulModel(ctx.sessionManager.getBranch(), ctx.modelRegistry).model;
				const last = deps.lastRequest?.();
				const step = deps.phase.step();
				const ignored = readIgnoredSettings(raw);
				return {
					lock: deps.phase.lock(),
					...(step ? { step } : {}),
					settings,
					lookup: ctx.modelRegistry,
					...(ctx.thinkingLevel ? { sessionThinkingLevel: ctx.thinkingLevel } : {}),
					...(last ? { last } : {}),
					...(previous ? { previous } : {}),
					routingOff: isPhysicalSelection(ctx),
					...(ctx.model ? { currentModel: modelKey(ctx.model) } : {}),
					ignored,
					// The command completion cannot see the catalog and so cannot offer models; this screen
					// can, and it is where a user who typed a reference wrong comes to fix it. The candidates are
					// every model that can answer: the session's model scope is no part of the choice, because the
					// routing and the command line never limit a target by it, and a scope of `spirits/auto` alone
					// would leave the row nothing to offer — not even the way back to `unset`.
					modelChoices: modelChoices(ctx.modelRegistry.getAvailable()),
					missingStarters: missingStartersFor(pi.getCommands()),
					// The `save` row previews the file, not the effective settings, and the host's read is the
					// wrong one for it: `pi.getSettings()` merges the trusted project file the save never writes
					// to. A file that will not read costs the preview and not the screen.
					...globalPreview(),
					saveSelection: selectionOf(ctx),
				};
			},
			writes,
			// A lock is a lock wherever it came from, so the list draws the badge the command draws it —
			// including when the settings file refused to save it. The role the list hands over is the lock it
			// applied, which is the one fact the draw can use even when its own re-read is what failed
			// (d-verify5 W-1).
			{ lockDrawn: (role) => drawBadge(ctx, role), sessionLock: () => deps.phase.lock() },
		);
	}

	pi.registerCommand(COMMAND_SPIRITS_ROLE, {
		description: "Lock the role, set a role or step target and thinking level, or show how routing runs",
		getArgumentCompletions: (argumentPrefix) => roleCompletions(argumentPrefix),
		handler: async (args, ctx) => {
			await run(parseRoleCommand(args), ctx);
		},
	});

	pi.registerCommand(COMMAND_SPIRITS_CLEAR, {
		description: "Drop the conversation before this point from the model context",
		handler: async (_args, ctx) => {
			if (alreadyCleared(ctx.sessionManager.getBranch())) {
				ctx.ui.notify("already cleared: nothing new to drop from the context", "info");
				return;
			}
			pi.appendEntry(CLEAR_ENTRY_TYPE, { at: Date.now() });
			// Clearing ends the running step: the conversation it belonged to is out of the context. The
			// badge follows the phase back down.
			deps.phase.endStep();
			drawBadge(ctx);
			ctx.ui.notify("conversation cleared from the model context", "info");
		},
	});

	pi.on("context", (event, ctx) => {
		// Fires on every prompt with the conversation pi rebuilt from the session file, so a command at
		// the end of a finished turn, a resume, and an automatic compaction all land here.
		const drop = clearedMessageCount(ctx.sessionManager);
		// Out of range means the projection and the message list no longer agree — another extension's
		// context handler removed messages ahead of this one. Slicing then would cut conversation that
		// outlived the boundary, and an empty list would send a prompt with no conversation at all, so
		// leave the request alone (design Decision 4: the filter only ever shrinks what pi had).
		if (drop <= 0 || drop >= event.messages.length) return;
		return { messages: event.messages.slice(drop) };
	});

	pi.on("session_before_compact", (event, ctx) => boundaryCompactionResult(event, ctx.sessionManager));

	// A tree move is not a session start: the branch changes under the runtime that is still running. The
	// routing layer has already put the step of the branch it landed on back (it runs first, because it
	// registers first); redraw the badge for that phase, because nothing else fires on a move (design
	// Decision 12).
	pi.on("session_tree", (_event, ctx) => {
		drawBadge(ctx);
	});

	// The host owns the session's model and thinking level and spirits writes neither, so a change made
	// through `/model` or `/thinking` reaches this surface only as an event. Without these two the badge
	// would go on describing the resolution of a model the session has left (spec `managed-commands` /
	// モデル切り替えで badge が従う, thinking レベルの切り替えで badge が従う).
	pi.on("model_select", (_event, ctx) => {
		drawBadge(ctx);
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		// pi fires this only when the resolved level really changed, a model switch's rounding included. A
		// change that leaves the level alone fires nothing, and the badge is already right.
		drawBadge(ctx);
	});

	// A run ending is a state change like the two above, and the routing layer's own handler closes a step
	// that does not continue on this same event. Without a redraw here the line would go on naming the step's
	// role after the phase had come back to the lock, which is the same disagreement between the line and the
	// next request this surface exists to close (spec `managed-commands` /
	// badge は状態の射影を決められた時点で描き直す: ステップの終了時).
	pi.on("agent_settled", (_event, ctx) => {
		drawBadge(ctx);
	});

	pi.on("session_start", (event, ctx) => {
		// This handler runs after the routing layer's own start handler, which put the default role on the
		// phase. A session with a record of its own — one this surface wrote, or one an older spirits wrote
		// — takes that lock back, because `models.role` is a default and not a session's state. The running
		// step comes back from the branch's records on every kind of start, so a session reopened in the
		// middle of a step continues on it instead of on the lock, which is the same misunderstanding about
		// what the session was doing that this whole surface exists to close (design Decision 10).
		// A start writes nothing about a step it puts back: the records already say what runs on this branch,
		// and writing "no step" on a branch the user merely reopened would make the next reload believe the
		// step had ended. The one start that does write is the rejection of a step it refuses to put back.
		const branch = ctx.sessionManager.getBranch();
		const inherited = inheritedRole(branch);
		if (inherited) deps.phase.restoreLock(inherited);
		const disposition = stepEntryDisposition(branch, event.reason);
		if (disposition?.kind === "restore") {
			deps.phase.restoreStep(disposition.step);
		} else if (disposition?.kind === "reject") {
			// The one start that does write. A record left open by a step that ends with its run says the run
			// was interrupted, and an interrupted run returns to the lock — but the open record would stay the
			// newest thing the branch says, and the next reload replaces the runtime rather than the
			// conversation, so it would put that step back. Recording the rejection is what keeps the answer
			// (design Decision 10).
			deps.phase.rejectStep();
		}
		// The badge is drawn from the state that came back, so a session reopened in the middle of a strong
		// step reads as that step rather than as the lock it started on.
		drawBadge(ctx);
	});

	pi.on("input", async (event, ctx) => {
		// Registered after the routing layer's own `input` handler — `src/index.ts` registers routing first —
		// which is what lets this one read the step the input just opened. An idle input on a step's starter
		// changes the state the badge projects, and the line has to follow it before the run rather than wait
		// for a request to report one.
		// The token is read before anything is waited for: it names this input, and it is the only thing the
		// rollback below may act on. Another extension's input that starts a step of its own, or a move between
		// branches while the confirmation is open, is a change this ask has no claim on (design Decision 7).
		const token = deps.phase.undoToken();
		if (await stepStartDeclined(event, ctx)) {
			// The input is taken back, and with it the step it opened — while nothing else has moved the phase:
			// the phase goes back where the input found it, so the next request runs on the role the session was
			// on before the line was typed (spec `managed-commands` / 中止すれば入力前に戻る).
			deps.phase.undoInput(token);
			drawBadge(ctx);
			return { action: "handled" as const };
		}
		drawBadge(ctx);
	});

	/**
	 * Whether the user stopped an input that was about to start a step the routing cannot honour.
	 *
	 * A step set to a role is a wish about which model answers, and a session on a physical model answers
	 * without asking spirits. That is the one place this surface refuses to be silent about a setting it is
	 * about to ignore, and the one place it is allowed to make the user wait (spec `managed-commands` /
	 * ステップ開始時に振り分けが無効なら確認してから進める).
	 */
	async function stepStartDeclined(event: InputEvent, ctx: ExtensionContext): Promise<boolean> {
		// Only a person at a terminal is asked, and only once per step start: an input that joined a run
		// already going asks nothing, and an input an extension sent has no one behind it to answer.
		if (ctx.mode !== EXTENSION_MODE_TUI || event.source !== INPUT_SOURCE_INTERACTIVE) return false;
		if (isPhysicalSelection(ctx) === false || !deps.phase.stepStartedByInput()) return false;
		const step = deps.phase.step();
		if (!step || !stepIsWorthConfirming(step.name)) return false;

		// The two clocks: the host's own countdown on the dialog, and one of ours a little earlier, which is
		// the only way to tell a dialog that ran out from one the user closed. A confirmation this surface
		// cannot read is a confirmation it must not wait for, so a host that refuses the dialog lets the input
		// through (spec `managed-commands` / 確認を出せなければ待たずに進む).
		const wait = stepConfirmWait(deps.stepConfirmClock);
		let answer: string | undefined;
		try {
			answer = await ctx.ui.select(
				`${step.name} would run on ${expectedRole(step)}, and routing is off, so it answers on ${ctx.model ? modelKey(ctx.model) : "a model this session selected"}. ${routingModelGuide({ scoped: routingModelOutOfScope(ctx), interactive: true })}. Run it anyway?`,
				[STEP_CONFIRM_CONTINUE, STEP_CONFIRM_CANCEL],
				{ timeout: wait.timeout, signal: wait.signal },
			);
		} catch {
			return false;
		} finally {
			wait.stop();
		}
		// No choice is two facts: the host's dialog closes with nothing chosen when it runs out and when the
		// user presses Esc, and only one of those is an answer.
		if (answer === undefined) return !wait.timedOut();
		return answer === STEP_CONFIRM_CANCEL;
	}

	/**
	 * The role the step was set to, which is the one the user is being told is not used.
	 *
	 * A step with only a thinking level set still expects a role, and it is the one the phase carries; a step
	 * with a role set expects that one (spec `managed-commands` / 既定ロールのあるステップでも確認する).
	 */
	function expectedRole(step: NonNullable<ReturnType<RoutingPhase["step"]>>): string {
		return resolveRequestRole(step, readSettings(), deps.phase.current());
	}

	/**
	 * Whether a step carries a role someone chose, which is what makes the wait worth asking for.
	 *
	 * A step that follows the lock asks nothing of the routing, so stopping it would be stopping the user
	 * over a setting they never set (spec `managed-commands` / 期待されるロールの無いステップでは確認しない).
	 */
	function stepIsWorthConfirming(name: string): boolean {
		const entry = readSettings().steps?.[name];
		if (entry?.role !== undefined || entry?.thinking !== undefined) return true;
		return STEP_DEFINITIONS.find((step) => step.name === name)?.defaultRole !== undefined;
	}
}

/**
 * The two clocks one confirmation runs.
 *
 * The dialog gets the full wait so its countdown reads as the wait the settings name, and this surface's own
 * timer goes {@link STEP_CONFIRM_TIMEOUT_SLACK_MS} earlier and aborts the dialog. A dialog closed by that
 * abort is a timeout and lets the input through; a dialog closed before it is the user's answer and stops it.
 */
function stepConfirmWait(clock?: { timeoutMs: number; slackMs: number }): { timeout: number; signal: AbortSignal; timedOut(): boolean; stop(): void } {
	const timeout = clock?.timeoutMs ?? STEP_CONFIRM_TIMEOUT_MS;
	const controller = new AbortController();
	let expired = false;
	const timer = setTimeout(() => {
		expired = true;
		controller.abort();
	}, timeout - (clock?.slackMs ?? STEP_CONFIRM_TIMEOUT_SLACK_MS));
	return {
		timeout,
		signal: controller.signal,
		timedOut: () => expired,
		stop: () => clearTimeout(timer),
	};
}

/**
 * Whether the session runs on a model spirits does not route.
 *
 * The comparison itself is {@link isRoutingModel}, shared with the child-model resolution, so the badge,
 * the list, `status`, and the warnings cannot disagree about whether a session is routed.
 */
export function isPhysicalSelection(ctx: Pick<ExtensionContext, "model">): boolean {
	// A session that selected nothing is not a physical selection: it is the absence of one, and the
	// routing-off notice is about a model the user chose (spec `managed-commands` /
	// save はディスク上の結果と実効状態を区別する: モデル未選択のセッションを物理モデルの選択として扱わない).
	return ctx.model !== undefined && !isRoutingModel(ctx.model);
}

/**
 * Whether the session limits its models to a scope that leaves the routing model out.
 *
 * A scope is the host's own list, and a model outside it cannot be selected by name, so this is what tells
 * a warning between "pick it in the selector" and "the selector does not hold it" (spec
 * `managed-commands` / スコープ外の手順を名指す).
 */
export function routingModelOutOfScope(ctx: Pick<ExtensionContext, "scopedModels">): boolean {
	const scope = ctx.scopedModels;
	return scope.length > 0 && !scope.some((entry) => isRoutingModel(entry.model));
}

/** A completion candidate, always with the `label` pi renders and re-reads (`undefined` crashes it). */
function item(value: string, description?: string): AutocompleteItem {
	return { value, label: value, ...(description ? { description } : {}) };
}

/**
 * Argument completions for `/spirits-role`.
 *
 * pi hands a completion function nothing but the prefix — no context, so no model catalog — which is
 * why a model reference is the one value this never offers (design Decision 8).
 */
export function roleCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const prefix = argumentPrefix.toLowerCase();
	const trailing = prefix.endsWith(" ");
	const tokens = prefix.split(/\s+/).filter((token) => token !== "");
	// The word the user is typing: the last token when there is no space after it, otherwise nothing,
	// which means "offer every word of this level".
	const typing = trailing ? "" : (tokens.at(-1) ?? "");
	const level = trailing ? tokens.length : Math.max(tokens.length - 1, 0);
	const head = tokens[0] ?? "";
	const word = tokens[1] ?? "";

	const show = (candidates: AutocompleteItem[]): AutocompleteItem[] => candidates.filter((candidate) => candidate.value.startsWith(typing));

	if (level === 0) {
		return show([
			item("status", "how the routing is running"),
			// `save` is a word of the first level and has no second one, so it appears here and nowhere below.
			item(ROLE_SAVE_WORD, "write this session's selection to pi's global settings"),
			...MODEL_ROLES.map((role) => item(role, "lock the session role")),
			...STEP_DEFINITIONS.map((step) => item(step.name, "step settings")),
		]);
	}

	const isRole = MODEL_ROLES.includes(head);
	if (!isRole && !STEP_DEFINITIONS.some((step) => step.name === head)) return null;

	if (level === 1) {
		return show(
			isRole
				? [item("model", "the model this role answers with"), item("thinking", "the thinking level this role asks for")]
				: [item("role", "the role this step runs on"), item("thinking", "the thinking level this step asks for")],
		);
	}

	// The grammar is three words deep — object, item, value — so a prefix that already holds the value has
	// nothing left to complete, even with the space typed after it. A model reference is never completed:
	// pi gives a completion no context, so the catalog is not reachable from here at all.
	if (level > 2 || word === "model") return null;
	if (word === "role") return show([...MODEL_ROLES.map((role) => item(role)), item("unset", "follow the step default or the lock")]);
	if (word === "thinking") {
		return show([...THINKING_LEVELS.map((level) => item(level)), item("unset", "follow the role or the session selection")]);
	}
	return null;
}
