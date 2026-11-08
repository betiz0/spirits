/**
 * Wiring of the managed command surface.
 *
 * The three commands exist only where the host has no role vocabulary — the caller decides that by
 * checking `registerModelRoles`, because that is the one difference between the fork route and the
 * managed route that the bundle can see. This module assumes it is being called on the managed
 * route and registers:
 *
 * - `/spirits-model <ref> [level] [role]`, `/spirits-role <role>`, `/spirits-clear`;
 * - the `context` handler that keeps cleared conversation out of the LLM context;
 * - the `session_before_compact` handler that stops a compaction from summarizing it back in;
 * - the footer badge, refreshed on every session start.
 *
 * Everything with a side effect goes through `pi`, the injected settings writer, or the routing
 * phase, so a test can drive the whole surface without pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CLEAR_ENTRY_TYPE,
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_MODEL,
	COMMAND_SPIRITS_ROLE,
	ROLE_ENTRY_TYPE,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
} from "../constants.ts";
import type { RoutingPhase } from "../routing/phase.ts";
import { alreadyCleared, boundaryCompactionResult, clearedMessageCount } from "./clear.ts";
import { createModelCommandHandler, type ModelCommandActions } from "./model.ts";
import { asRoleName, createRoleBadge, inheritedRole, type RoleBadge } from "./role.ts";
import { patchGlobalSettings, type SettingsPatch } from "./settings-store.ts";

/** What the command surface needs from the host. */
export interface ManagedCommandsDeps {
	/** Role phase of this runtime's routing registration; a command locks it and pi keeps the lock. */
	phase: Pick<RoutingPhase, "current" | "setRole">;
	/** Footer badge, shared with the route's role reporting. A test can leave it out. */
	badge?: RoleBadge;
	/** Settings writer. Production merges into pi's global file; a test collects the patches. */
	patchSettings?: (patch: SettingsPatch) => void;
}

/** Register the managed-only commands and context handlers. */
export function registerManagedCommands(pi: ExtensionAPI, deps: ManagedCommandsDeps): void {
	const badge = deps.badge ?? createRoleBadge();
	const patch = deps.patchSettings ?? patchGlobalSettings;

	function lockRole(role: string): void {
		// The phase is the lock pi obeys for the rest of the session; the entry is what a resume of
		// this session reads back. Both are written here so a lock is never half-applied.
		deps.phase.setRole(role);
		pi.appendEntry(ROLE_ENTRY_TYPE, { role });
	}

	const actions: ModelCommandActions = {
		setModel: (model) => pi.setModel(model),
		setThinkingLevel: (level) => pi.setThinkingLevel(level),
		lockRole,
		patchSettings: (patchFields) => patch(patchFields),
	};

	pi.registerCommand(COMMAND_SPIRITS_MODEL, {
		description: "Pick the model, thinking level, and spirits role (pi's /model stays unchanged)",
		handler: createModelCommandHandler(actions),
	});

	pi.registerCommand(COMMAND_SPIRITS_ROLE, {
		description: "Lock the session role to normal or strong",
		handler: async (args, ctx) => {
			const role = asRoleName(args);
			if (!role) {
				ctx.ui.notify(`spirits role is ${deps.phase.current()}. use /spirits-role normal or strong.`, "info");
				return;
			}
			lockRole(role);
			patch({ [SETTINGS_KEY_MODELS]: { [SETTINGS_KEY_ROLE]: role } });
			ctx.ui.notify(`role locked to ${role}`, "info");
			// Last statement: `reload()` retires this command's `pi` handle and context, and the new
			// runtime picks the written default role up on its own session start.
			await ctx.reload();
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
			badge.update(deps.phase.current(), ctx);
			ctx.ui.notify("conversation cleared from the model context", "info");
		},
	});

	pi.on("context", (event, ctx) => {
		// Fires on every prompt with the conversation pi rebuilt from the session file, so a command
		// at the end of a finished turn, a resume, and an automatic compaction all land here.
		const drop = clearedMessageCount(ctx.sessionManager);
		// Out-of-range means the projection and the message list no longer agree — another extension's
		// context handler removed messages ahead of this one. Slicing then would cut conversation that
		// outlives the boundary, and an empty list would send a prompt with no conversation at all, so
		// leave the request alone (design Decision 4: the filter only ever shrinks what pi had).
		if (drop <= 0 || drop >= event.messages.length) return;
		return { messages: event.messages.slice(drop) };
	});

	pi.on("session_before_compact", (event, ctx) => boundaryCompactionResult(event, ctx.sessionManager));

	pi.on("session_start", (_event, ctx) => {
		// A resumed session takes its lock back from the entries this command surface wrote, and a
		// session a fork started takes it from the role record the fork left. Only a session with no
		// record of its own falls through to the configured default, which routing has already put on
		// the phase. This is what keeps the lock per session while `models.role` stays a default.
		const inherited = inheritedRole(ctx.sessionManager.getBranch());
		if (inherited) deps.phase.setRole(inherited);
		badge.update(deps.phase.current(), ctx);
	});
}
