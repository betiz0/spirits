/**
 * Wiring of the managed command surface.
 *
 * The commands exist only where the host has no role vocabulary, which the caller decides by checking
 * `registerModelRoles` — the one difference between the fork route and the managed route that the
 * bundle can see. This module assumes it is on the managed route and registers:
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

import type { AutocompleteItem, ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readIgnoredSettings, readRoutingSettings } from "../config.ts";
import type { RoutingSettings } from "../config.ts";
import {
	CLEAR_ENTRY_TYPE,
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_ROLE,
	MODEL_ROLES,
	MODEL_ROLE_STRONG,
	ROLE_ENTRY_TYPE,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
	STEP_DEFINITIONS,
	STEP_ENTRY_TYPE,
	THINKING_LEVELS,
} from "../constants.ts";
import type { RoutingPhase } from "../routing/phase.ts";
import { spiritsStepEntry } from "../routing/phase.ts";
import { resolveRequestRole } from "../routing/router.ts";
import { latestSuccessfulModel } from "../routing/resolve.ts";
import { alreadyCleared, boundaryCompactionResult, clearedMessageCount } from "./clear.ts";
import {
	formatModelKey,
	formatRoleStatus,
	roleBadgeText,
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
import { applyRoleLock, applyRoleSetting, strongIsUsable, type RoleWriteDeps } from "./role-write.ts";
import { patchGlobalSettings, patchGlobalSettingsPath, writePathValue } from "./settings-store.ts";
import type { SettingsPatch, SettingsPath } from "./settings-store.ts";

/** What the command surface needs from the host. */
export interface ManagedCommandsDeps {
	/**
	 * The step methods the command surface reads and ends. `beginSession` and `handleInput` belong to the
	 * routing layer that owns the phase, so this surface never reaches for them.
	 */
	phase: Pick<RoutingPhase, "current" | "lock" | "setRole" | "restoreLock" | "restoreStep" | "step" | "endStep">;
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
}

/** The usage line shown for a line the grammar cannot read, and for an item that needs one. */
// The line names how a step ends as well as how a setting is written: a continuing step keeps its role
// and its model after the run, so a user who wonders why the answers stayed strong has to be told the
// way out at the moment the command refuses their line.
const USAGE =
	"use /spirits-role <normal|strong> to lock, /spirits-role <role> model <provider/id>, /spirits-role <role|step> thinking <level>, /spirits-role <step> role <role>, unset to clear, or status. a step ends on a role lock, on /spirits-clear, or when another step starts.";

/** Register the managed commands and the context handlers. */
export function registerManagedCommands(pi: ExtensionAPI, deps: ManagedCommandsDeps): void {
	const badge = deps.badge ?? { update: (role: string, ctx: ExtensionCommandContext) => ctx.ui.setStatus("spirits", roleBadgeText(role)) };
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
			case "panel": {
				// `hasUI` is true in RPC mode too, where `custom()` returns nothing at all, so the mode is
				// what decides whether the list can open (design Decision 11).
				if (ctx.mode !== "tui") {
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
				badge.update(command.role, ctx);
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
	function warnAfterChange(
		change: { askingForStrong: boolean; wrote?: { path: SettingsPath; value: unknown } },
		ctx: ExtensionCommandContext,
	): void {
		const settings = change.wrote
			? readRoutingSettings(writePathValue(pi.getSettings(), change.wrote.path, change.wrote.value))
			: readSettings();
		const warning = roleSettingWarning({
			setStrong: change.askingForStrong,
			strongUnresolved: change.askingForStrong && !strongIsUsable(settings, ctx.modelRegistry),
			physicalModelSelected: isPhysicalSelection(ctx),
		});
		if (warning) ctx.ui.notify(warning, "warning");
	}

	/**
	 * The role the badge shows: the one the next request would run on.
	 *
	 * `phase.current()` folds in only the step list's default role, so a step whose role comes from
	 * `models.steps.<name>.role` would draw the lock while the route sent something else. The badge and
	 * the route have to read the same resolution (spec `dual-model-routing` / 再読み込みをまたぐ…:
	 * ステップ設定のロールを badge に出す).
	 */
	function badgeRole(): string {
		return resolveRequestRole(deps.phase.step(), readSettings(), deps.phase.current());
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
		return {
			routingEnabled: !isPhysicalSelection(ctx),
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
					ignored,
					// The command completion cannot see the catalog and so cannot offer models; this screen
					// can, and it is where a user who typed a reference wrong comes to fix it.
					modelChoices: modelChoices(ctx.modelRegistry.getAvailable()),
					missingStarters: missingStartersFor(pi.getCommands()),
				};
			},
			writes,
			// A lock is a lock wherever it came from, so the list draws the badge the command draws it —
			// including when the settings file refused to save it. The badge reads the phase directly, so a
			// settings read that fails mid-redraw leaves the running lock drawn (d-verify5 W-1).
			{ lockDrawn: (role) => badge.update(role, ctx), sessionLock: () => deps.phase.lock() },
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
		handler: (_args, ctx) => {
			if (alreadyCleared(ctx.sessionManager.getBranch())) {
				ctx.ui.notify("already cleared: nothing new to drop from the context", "info");
				return;
			}
			pi.appendEntry(CLEAR_ENTRY_TYPE, { at: Date.now() });
			// Clearing ends the running step: the conversation it belonged to is out of the context.
			deps.phase.endStep();
			badge.update(deps.phase.current(), ctx);
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
		badge.update(badgeRole(), ctx);
	});

	pi.on("session_start", (event, ctx) => {
		// This handler runs after the routing layer's own start handler, which put the default role on the
		// phase. A session with a record of its own — one this surface wrote, or a fork wrote — takes that
		// lock back, because `models.role` is a default and not a session's state. On a reload only, the
		// step that was still running comes back too: the record says whether one was, and a step that
		// ended appended the record that says it did not (design Decision 12).
		const branch = ctx.sessionManager.getBranch();
		// A step that ended must always leave a record of ending, and the phase's own `end()` only sees the
		// step this process holds. Quit in the middle of a continuing step, then open that session in a new
		// process: nothing is in memory, so nothing gets written, and the next settings write reloads the
		// runtime onto a record that still says the step is running. Every start that is not a reload closes
		// an open record for that reason (design Decision 12).
		if (event.reason !== "reload" && spiritsStepEntry(branch)) pi.appendEntry(STEP_ENTRY_TYPE, { step: null });
		const inherited = inheritedRole(branch);
		if (inherited) deps.phase.restoreLock(inherited);
		if (event.reason === "reload") {
			const step = spiritsStepEntry(branch);
			if (step) deps.phase.restoreStep(step);
		}
		badge.update(badgeRole(), ctx);
	});
}

/** Whether the session runs on a model spirits does not route. */
function isPhysicalSelection(ctx: ExtensionCommandContext): boolean {
	return !(ctx.model?.provider === ROUTING_PROVIDER_ID && ctx.model.id === ROUTING_MODEL_ID);
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
