/**
 * The role of a managed session: where it is stored, how it is inherited from a fork, and how it
 * reaches the screen.
 *
 * The fork route records the role in pi's `pi.virtual-model-state` entry, because the fork's role
 * patch is what writes that entry. On the official Pi that entry belongs to the core: its own
 * reader takes `{ provider, modelId, state }` from the newest matching record, and an extension
 * writing a role-shaped record there risks the state the core keeps in it. So the managed route
 * writes its own `spirits_role` entry and only *reads* pi's record, at session start, when spirits
 * has written nothing on the branch — the one-way handoff that lets a session a fork started
 * continue on the managed route with the role it had.
 *
 * The badge goes on `ui.setStatus()`. The official footer renders extension statuses on its own
 * status line, alphabetically by key, which is a different place from the fork's badge next to the
 * model name. It is not the fork badge, and `docs/spirits-managed-pi.md` says so.
 */

import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	MODEL_ROLES,
	ROLE_ENTRY_TYPE,
	ROLE_STATUS_KEY,
	ROUTING_STATE_ENTRY_TYPE,
} from "../constants.ts";

/** Control characters, including the escape that starts a terminal sequence. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** A role name in the vocabulary spirits registers, lowercased. Anything else is not a role. */
export function asRoleName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return MODEL_ROLES.includes(normalized) ? normalized : undefined;
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
