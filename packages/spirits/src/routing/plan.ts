/**
 * One request's resolution, decided once and read by everything that has to agree on it.
 *
 * The router, the `rlm` child resolution, and the settings list all answer the same question — which
 * role answers, with which model, and at which thinking level — and each one used to compose the
 * answer from the same parts by hand. Composing it again is how the list came to promise a model or a
 * level the route would not send (design Decision 15), so the composition lives here and the callers
 * read its result.
 *
 * The function has no side effects: notices, the error for a missing normal target, and the
 * `onResolved` callback stay with the route, because they belong to a request rather than to a
 * resolution.
 */

import type { PiModel, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import type { RoutingSettings } from "../config.ts";
import { MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG } from "../constants.ts";
import type { ActiveStep } from "./phase.ts";
import { type ModelLookup, type NormalSource, resolveNormalTarget, resolveStrongTarget } from "./resolve.ts";

/**
 * The role a request runs on: the step's own setting, then the role the phase settled on — which is
 * the step's default role, or the session lock (spec `dual-model-routing` / ワークフローのステップ別
 * ロール).
 */
export function resolveRequestRole(step: ActiveStep | undefined, settings: RoutingSettings, phaseRole: string): string {
	return (step ? settings.steps?.[step.name]?.role : undefined) ?? phaseRole;
}

/**
 * The thinking level a request carries: the step's setting, then the setting of the role that actually
 * answers, then pi's own session selection.
 *
 * The role passed in is the one the request settles on, so a strong request that fell back to normal
 * takes normal's level. Rounding the level to what the physical model offers is pi's job, not ours
 * (spec `dual-model-routing` / ロールとステップの thinking レベルの解決).
 */
export function resolveRequestThinkingLevel<Session extends ThinkingLevel | undefined>(
	settings: RoutingSettings,
	role: string,
	sessionLevel: Session,
	step?: ActiveStep,
): ThinkingLevel | Session {
	const stepLevel = step ? settings.steps?.[step.name]?.thinking : undefined;
	const roleLevel = settings.thinking?.[role === MODEL_ROLE_STRONG ? "strong" : "normal"];
	return stepLevel ?? roleLevel ?? sessionLevel;
}

/** Where the answering model came from: the strong setting, or one of normal's three landings. */
export type PlanModelSource = "strong" | NormalSource;

/** Everything one request resolves to, before any notice or error is attached to it. */
export interface RequestPlan {
	/** Role the request asked for: the step's setting, the step's default, or the session lock. */
	role: string;
	/** Role that answers: the requested role, or normal when strong had nothing to run on. */
	answerRole: string;
	/** Model that answers. Absent only when no normal target resolves, which the route turns into an error. */
	model?: PiModel;
	/** Where {@link model} came from. */
	source?: PlanModelSource;
	/**
	 * Normal's resolution when normal answered, with the landing and whether the setting fell through to
	 * it. Absent when strong answered: normal was never asked.
	 */
	normal?: { model: PiModel; source: NormalSource; fellFromSpec: boolean };
	/** True when the request asked for strong and no usable strong target answered (unset or unusable). */
	strongUnavailable: boolean;
	/** True when `models.normal` is set but could not be used, so the answer came from further down. */
	normalUnusable: boolean;
	/** True when no normal target resolves at all. */
	normalMissing: boolean;
	/** Thinking level the request carries, resolved for {@link answerRole}. */
	thinkingLevel?: ThinkingLevel;
}

/** Inputs of one resolution. Every one is read at the request, so an edit takes effect on the next. */
export interface RequestPlanInput {
	/** Step the request runs in, or undefined for a session on the lock alone. */
	step?: ActiveStep;
	settings: RoutingSettings;
	/** Role the phase settled on: the running step's default role, or the lock. */
	phaseRole: string;
	lookup: ModelLookup;
	/** Level the session selected, the last candidate for a request that has no setting of its own. */
	sessionThinkingLevel?: ThinkingLevel;
	/** Physical model of the latest successful response, the last normal candidate. */
	previous?: { model: PiModel };
}

/**
 * Resolve one request.
 *
 * The order is the one the route has always used: a requested strong with a usable target answers on
 * strong; everything else answers on normal, whose target walks from `models.normal` to pi's default
 * to the latest successful response. The level follows the answering role, so a strong request that
 * fell back to normal carries normal's level rather than the strong level it asked for.
 */
export function resolveRequestPlan(input: RequestPlanInput): RequestPlan {
	const { step, settings, phaseRole, lookup, sessionThinkingLevel, previous } = input;
	const role = resolveRequestRole(step, settings, phaseRole);
	const levelFor = (answerRole: string): ThinkingLevel | undefined =>
		resolveRequestThinkingLevel(settings, answerRole, sessionThinkingLevel, step);

	if (role === MODEL_ROLE_STRONG && settings.strong) {
		const strong = resolveStrongTarget({ lookup, spec: settings.strong, defaultProvider: settings.defaultProvider });
		if (strong) {
			return {
				role,
				answerRole: MODEL_ROLE_STRONG,
				model: strong,
				source: "strong",
				strongUnavailable: false,
				normalUnusable: false,
				normalMissing: false,
				thinkingLevel: levelFor(MODEL_ROLE_STRONG),
			};
		}
	}

	const normal = resolveNormalTarget({
		lookup,
		...(settings.normal ? { spec: settings.normal } : {}),
		...(settings.defaultProvider ? { defaultProvider: settings.defaultProvider } : {}),
		...(settings.defaultModelId ? { defaultModelId: settings.defaultModelId } : {}),
		...(previous ? { previous } : {}),
	});
	return {
		role,
		answerRole: MODEL_ROLE_NORMAL,
		...(normal ? { model: normal.model, source: normal.source, normal } : {}),
		strongUnavailable: role === MODEL_ROLE_STRONG,
		normalUnusable: normal?.fellFromSpec === true && settings.normal !== undefined,
		normalMissing: normal === undefined,
		thinkingLevel: levelFor(MODEL_ROLE_NORMAL),
	};
}
