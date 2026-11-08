/**
 * `/spirits-model <ref> [level] [role]`: one line that picks the model, the thinking level, and the
 * role on a host whose `/model` has no role vocabulary.
 *
 * The official Pi keeps `/model` for itself (`cli/args.ts` parses `-m`, and the interactive command
 * takes a search term). Rather than fight it, spirits registers a separate command and reaches the
 * same three pieces of state through documented extension API:
 *
 * - the session model through `pi.setModel()`, which pi keeps for the session;
 * - the thinking level through `pi.setThinkingLevel()`;
 * - the role through the routing phase, plus the persistence below.
 *
 * Argument grammar is positional from the right, because a model reference is the only part that can
 * contain spaces: take a trailing role name if the last token is one, then a trailing thinking level
 * if what is left ends in one, and treat the rest as the reference. `anthropic/claude-sonnet-4-5
 * high strong` and `sonnet strong` both parse; `sonnet high` names a level, not a model.
 *
 * Persistence goes to pi's global settings file (`defaultProvider`, `defaultModel`,
 * `defaultThinkingLevel`, and `models.role` — the same keys the fork route writes), and the command
 * then calls `ctx.reload()` so the next `ctx.model`, the footer, and any later `/model` see the
 * choice. `reload()` replaces this extension runtime and pi marks the command's `pi` handle stale
 * afterwards, so nothing touches them once it resolves; that is why it is the last statement in
 * every path that runs it.
 */

import type { ExtensionCommandContext, PiModel, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import {
	SETTINGS_KEY_DEFAULT_MODEL,
	SETTINGS_KEY_DEFAULT_PROVIDER,
	SETTINGS_KEY_MODELS,
	SETTINGS_KEY_ROLE,
	SETTINGS_KEY_THINKING_LEVEL,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
} from "../constants.ts";
import { ALL_THINKING_LEVELS } from "../routing/register.ts";
import { asRoleName } from "./role.ts";
import type { SettingsPatch } from "./settings-store.ts";

/** What one `/spirits-model` line asked for. */
export interface ModelCommandRequest {
	/** Model reference: `provider/id` or a search term. Absent when only a level or role was given. */
	ref?: string;
	level?: ThinkingLevel;
	role?: string;
}

/** Parse the command line, taking the role and then the thinking level off the right end. */
export function parseModelCommandArgs(args: string): ModelCommandRequest {
	let tokens = args.trim().length > 0 ? args.trim().split(/\s+/) : [];
	let role: string | undefined;
	let level: ThinkingLevel | undefined;

	// Both tail slots are optional and independent, so each one is taken from whatever the previous
	// slot left: `… high strong` gives up `strong` then `high`, while `… high` gives up only `high`.
	const lastRole = asRoleName(tokens[tokens.length - 1] ?? "");
	if (lastRole) {
		role = lastRole;
		tokens = tokens.slice(0, -1);
	}
	const lastLevel = tokens[tokens.length - 1]?.toLowerCase();
	if (lastLevel !== undefined && (ALL_THINKING_LEVELS as readonly string[]).includes(lastLevel)) {
		level = lastLevel as ThinkingLevel;
		tokens = tokens.slice(0, -1);
	}
	const ref = tokens.join(" ");
	return ref === "" ? { level, role } : { ref, level, role };
}

/** A model reference resolved against the models pi has available. */
export type ModelTargetResult = { model: PiModel } | { error: string };

/**
 * Resolve a reference to one available model: exact `provider/id` first, then a case-insensitive
 * substring of `provider/id` or of the bare id.
 *
 * `spirits/auto` is excluded: it is the routing pseudo-model, and picking it by hand is what pi's
 * own `/model` already does.
 */
export function resolveModelTarget(models: readonly PiModel[], ref: string): ModelTargetResult {
	const wanted = ref.trim().toLowerCase();
	if (wanted === "") return { error: "no model reference given" };

	const candidates = models.filter((model) => !(model.provider === ROUTING_PROVIDER_ID && model.id === ROUTING_MODEL_ID));
	const exact = candidates.find((model) => `${model.provider}/${model.id}`.toLowerCase() === wanted);
	if (exact) return { model: exact };

	const matches = candidates.filter(
		(model) => `${model.provider}/${model.id}`.toLowerCase().includes(wanted) || model.id.toLowerCase().includes(wanted),
	);
	if (matches.length === 1) return { model: matches[0] };
	if (matches.length === 0) return { error: `no model matches "${ref}"` };
	return { error: `"${ref}" matches ${matches.length} models, be more specific: ${matches.slice(0, 5).map(formatModelKey).join(", ")}` };
}

/** Reference shown to the user: what they can type back. */
export function formatModelKey(model: Pick<PiModel, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

/** Side effects of one command line, all injected so a test can watch them. */
export interface ModelCommandActions {
	setModel(model: PiModel): Promise<boolean>;
	setThinkingLevel(level: ThinkingLevel): void;
	/** Lock the session role and record it on the session branch. */
	lockRole(role: string): void;
	/** Merge the persistence patch into pi's global settings file. */
	patchSettings(patch: SettingsPatch): void;
}

/** The settings patch one command line produces: only the parts the user named. */
export function modelCommandSettings(request: ModelCommandRequest, model: PiModel): SettingsPatch {
	const patch: Record<string, unknown> = {
		[SETTINGS_KEY_DEFAULT_PROVIDER]: model.provider,
		[SETTINGS_KEY_DEFAULT_MODEL]: model.id,
	};
	if (request.level) patch[SETTINGS_KEY_THINKING_LEVEL] = request.level;
	if (request.role) patch[SETTINGS_KEY_MODELS] = { [SETTINGS_KEY_ROLE]: request.role };
	return patch;
}

/**
 * Apply one parsed command line and return the line shown to the user.
 *
 * `setModel` is the gate: when the host refuses the model, the thinking level, the role, and the
 * settings file are left alone, so a failed selection cannot leave the session and the settings
 * disagreeing.
 */
export async function applyModelCommand(
	actions: ModelCommandActions,
	request: ModelCommandRequest,
	model: PiModel,
): Promise<string> {
	if (!(await actions.setModel(model))) return `could not switch to ${formatModelKey(model)}`;
	if (request.level) actions.setThinkingLevel(request.level);
	if (request.role) actions.lockRole(request.role);
	actions.patchSettings(modelCommandSettings(request, model));
	const shown = [formatModelKey(model)];
	if (request.level) shown.push(request.level);
	if (request.role) shown.push(request.role);
	return `using ${shown.join(" ")}`;
}

/**
 * The `/spirits-model` handler. `reload` is what the command context provides; passing it in keeps
 * the ordering rule visible: it is always the last thing the handler does.
 */
export function createModelCommandHandler(
	actions: ModelCommandActions,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
	return async (args, ctx) => {
		const request = parseModelCommandArgs(args);
		if (!request.ref) {
			ctx.ui.notify("use /spirits-model <model> [level] [role]. pi's /model stays yours for browsing.", "info");
			return;
		}
		const target = resolveModelTarget(ctx.modelRegistry.getAvailable(), request.ref);
		if ("error" in target) {
			ctx.ui.notify(target.error, "error");
			return;
		}
		const message = await applyModelCommand(actions, request, target.model);
		ctx.ui.notify(message, message.startsWith("using ") ? "info" : "warning");
		if (!message.startsWith("using ")) return;
		// Last statement: `reload()` retires this command's `pi` handle and context.
		await ctx.reload();
	};
}
