/**
 * The writes behind `/spirits-role` and behind the settings list.
 *
 * Both surfaces change the same settings, and the spec makes that an identity rather than a
 * coincidence: a list edit must be the same write the command performs (spec `managed-commands` /
 * 一覧での編集は コマンドと同じ書き込みを行う). So both call the two functions here, and neither holds a
 * write of its own.
 *
 * What belongs here is one change and whether the settings file took it. The notice text, the
 * warnings, and `ctx.reload()` stay with the caller: the command reports every line as it lands, while
 * the list waits until it closes, which is the one difference the spec allows between them.
 */

import type { RoutingSettings } from "../config.ts";
import { SETTINGS_KEY_MODELS, SETTINGS_KEY_ROLE } from "../constants.ts";
import { settingPath, type SettingItem } from "./role.ts";
import { resolveStrongTarget, type ModelLookup } from "../routing/resolve.ts";
import type { SettingsPatch, SettingsPath } from "./settings-store.ts";

/** One change and whether the settings file took it. */
export interface RoleWrite {
	/** What changed, in the words shown back. */
	message: string;
	/** True when the file holds the change, which is what makes a reload worth doing. */
	saved: boolean;
	/** Why the file refused, when it refused. */
	failure?: string;
	/**
	 * Where the change landed and what went there (`undefined` deleted it).
	 *
	 * The caller needs this because pi's settings keep their pre-write values until the reload, and a
	 * notice about what was just written cannot read them without it (design Decision 4).
	 */
	wrote?: { path: SettingsPath; value: unknown };
}

/** The side effects one change needs. Both surfaces inject these; neither writes a file itself. */
export interface RoleWriteDeps {
	/** Lock the session role: the phase, plus the session record a resume reads back. */
	lockRole(role: string): void;
	/** Merge a flat patch into pi's global settings file. */
	patchSettings(patch: SettingsPatch): void;
	/** Change one nested key of pi's global settings file. `undefined` deletes it. */
	patchSettingsPath(path: SettingsPath, value: unknown): void;
}

/** Lock the role and save it as the default role, the way `/spirits-role <role>` does. */
export function applyRoleLock(deps: RoleWriteDeps, role: string): RoleWrite {
	// The session takes the lock first: a file that refuses must not take the lock the user just asked
	// for back out from under them.
	deps.lockRole(role);
	const write = saveFile(() => deps.patchSettings({ models: { role } }), `role locked to ${role}`, "the default role");
	return { ...write, wrote: { path: [SETTINGS_KEY_MODELS, SETTINGS_KEY_ROLE], value: role } };
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
	return { ...write, wrote: { path, value } };
}

/** Run one file write and describe the outcome the same way in both surfaces. */
function saveFile(write: () => void, applied: string, what: string): RoleWrite {
	try {
		write();
		return { message: applied, saved: true };
	} catch (error) {
		// The session keeps what pi already accepted. Undoing it would take the user's own action away
		// over a settings-file problem, and reloading would re-read the defaults that never landed.
		const reason = error instanceof Error ? error.message : String(error);
		return { message: `${applied}; ${what} was not saved: ${reason}`, saved: false, failure: reason };
	}
}

/** Whether strong resolves right now, which is the question a warning about strong asks. */
export function strongIsUsable(settings: RoutingSettings, lookup: ModelLookup): boolean {
	if (!settings.strong) return false;
	return resolveStrongTarget({ lookup, spec: settings.strong, defaultProvider: settings.defaultProvider }) !== undefined;
}
