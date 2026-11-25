// spec "dual-model-routing / ワークフローのステップ別ロール": the table in the spec and
// `STEP_DEFINITIONS` are one list, and a step name must never read as a role name.
import { expect, test } from "bun:test";
import {
	MODEL_ROLE_STRONG,
	MODEL_ROLES,
	PI_VIRTUAL_MODEL_API,
	ROLE_BADGE_NONE,
	ROLE_BADGE_OFF,
	ROLE_MODEL_DISPLAY_MAX_LENGTH,
	ROLE_MODEL_ELLIPSIS_AFTER,
	ROLE_MODEL_STATUS_KEY,
	ROLE_SAVE_WORD,
	ROLE_STATUS_KEY,
	ROUTING_MODEL_ID,
	ROUTING_MODEL_REFERENCE,
	ROUTING_PROVIDER_ID,
	STEP_CONFIRM_TIMEOUT_MS,
	STEP_CONFIRM_TIMEOUT_SLACK_MS,
	STEP_DEFINITIONS,
	isRoutingModel,
} from "../src/constants.ts";

/** The table of the `dual-model-routing` spec, written out as the spec states it. */
interface SpecRow {
	name: string;
	starters: string[];
	defaultRole: string | undefined;
	continuing: boolean;
}

const SPEC_TABLE: SpecRow[] = [
	{ name: "opsx-propose", starters: ["/opsx-propose", "/skill:openspec-propose"], defaultRole: undefined, continuing: true },
	{ name: "opsx-new", starters: ["/opsx-new", "/skill:openspec-new-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-continue", starters: ["/opsx-continue", "/skill:openspec-continue-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-ff", starters: ["/opsx-ff", "/skill:openspec-ff-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-apply", starters: ["/opsx-apply", "/skill:openspec-apply-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-verify", starters: ["/opsx-verify", "/skill:openspec-verify-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-archive", starters: ["/opsx-archive", "/skill:openspec-archive-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-bulk-archive", starters: ["/opsx-bulk-archive", "/skill:openspec-bulk-archive-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-sync", starters: ["/opsx-sync", "/skill:openspec-sync-specs"], defaultRole: undefined, continuing: true },
	{ name: "opsx-update", starters: ["/opsx-update", "/skill:openspec-update-change"], defaultRole: undefined, continuing: true },
	{ name: "opsx-explore", starters: ["/opsx-explore", "/skill:openspec-explore"], defaultRole: undefined, continuing: true },
	{ name: "opsx-onboard", starters: ["/opsx-onboard", "/skill:openspec-onboard"], defaultRole: undefined, continuing: true },
	{ name: "sprt-opsx-review-change", starters: ["/skill:sprt-opsx-review-change"], defaultRole: MODEL_ROLE_STRONG, continuing: false },
	{ name: "sprt-opsx-verify-deep", starters: ["/skill:sprt-opsx-verify-deep"], defaultRole: MODEL_ROLE_STRONG, continuing: false },
	{ name: "sprt-architecture-guards", starters: ["/skill:sprt-architecture-guards"], defaultRole: undefined, continuing: true },
];

test("matches the step table of the spec", () => {
	expect(STEP_DEFINITIONS.map((step) => ({
		name: step.name,
		starters: [...step.starters],
		defaultRole: step.defaultRole,
		continuing: step.continuing,
	}))).toEqual(SPEC_TABLE);
});

test("shares no name with the role vocabulary", () => {
	for (const step of STEP_DEFINITIONS) {
		expect(MODEL_ROLES.includes(step.name)).toBe(false);
	}
});

// spec "managed-commands / `save` は振り分け用のモデルを選択しているセッションの選択状況を global 既定に保存する": `save` is a word of
// the command's first position, the same position the role lock words and the step names occupy. A
// collision would make `/spirits-role save` mean something else depending on which table the command
// consults first, so the three vocabularies have to stay disjoint.
test("save does not collide with role or step words", () => {
	expect(MODEL_ROLES.includes(ROLE_SAVE_WORD)).toBe(false);
	expect(STEP_DEFINITIONS.some((step) => step.name === ROLE_SAVE_WORD)).toBe(false);
	// `status` is the other wordless first-position command, and the two are distinct.
	expect(ROLE_SAVE_WORD).not.toBe("status");
	// The word is what the command's own usage line and the list row both print, so one constant is the whole
	// vocabulary entry.
	expect(ROLE_SAVE_WORD).toBe("save");
});

test("names every step and starter once", () => {
	const names = STEP_DEFINITIONS.map((step) => step.name);
	expect(new Set(names).size).toBe(names.length);

	const starters = STEP_DEFINITIONS.flatMap((step) => [...step.starters]);
	expect(new Set(starters).size).toBe(starters.length);
	for (const starter of starters) {
		expect(starter.startsWith("/")).toBe(true);
	}
});

test("keeps the default role inside the role vocabulary", () => {
	for (const step of STEP_DEFINITIONS) {
		if (step.defaultRole === undefined) continue;
		expect(MODEL_ROLES.includes(step.defaultRole)).toBe(true);
	}
});

test("defaults only the two report steps to strong", () => {
	const strongSteps = STEP_DEFINITIONS.filter((step) => step.defaultRole === MODEL_ROLE_STRONG).map((step) => step.name);
	expect(strongSteps).toEqual(["sprt-opsx-review-change", "sprt-opsx-verify-deep"]);
	expect(STEP_DEFINITIONS.filter((step) => !step.continuing).map((step) => step.name)).toEqual(strongSteps);
});

// spec "managed-commands / badge は応答する物理モデルを別の status key に出す": ロールが先、応答モデルが後。
// The footer sorts extension statuses by key, so the order is a property of the two names, and the names
// have to stay distinct or the second write would replace the first.
test("keeps the two badge status keys distinct and in footer order", () => {
	const keys = [ROLE_STATUS_KEY, ROLE_MODEL_STATUS_KEY];
	expect(new Set(keys).size).toBe(keys.length);
	expect([...keys].sort()).toEqual(keys);
	// The model key carries the role key as its prefix, which is what pins the order rather than letting
	// it depend on one more name appearing later.
	expect(ROLE_MODEL_STATUS_KEY.startsWith(ROLE_STATUS_KEY)).toBe(true);
});

// The badge vocabulary and the routing model's spelling are what the spec and the docs say, and the
// warning line used to carry a copy of the reference that no session could select.
test("spells the badge words and the routing model as the spec does", () => {
	expect(ROLE_BADGE_OFF).toBe("off");
	expect(ROLE_BADGE_NONE).toBe("!");
	expect(ROUTING_MODEL_REFERENCE).toBe(`${ROUTING_PROVIDER_ID}/auto`);
	expect(ROUTING_MODEL_REFERENCE).toBe("spirits/auto");
});

test("keeps the display width and the confirmation wait at the stated values", () => {
	expect(ROLE_MODEL_DISPLAY_MAX_LENGTH).toBe(24);
	expect(ROLE_MODEL_ELLIPSIS_AFTER).toBe(23);
	expect(ROLE_MODEL_ELLIPSIS_AFTER).toBeLessThan(ROLE_MODEL_DISPLAY_MAX_LENGTH);
	expect(STEP_CONFIRM_TIMEOUT_MS).toBe(10_000);
	// The timer that decides a timeout has to fire inside the wait, or it decides nothing.
	expect(STEP_CONFIRM_TIMEOUT_SLACK_MS).toBeLessThan(STEP_CONFIRM_TIMEOUT_MS);
});

test("recognizes only the virtual model spirits routes as routed", () => {
	expect(isRoutingModel({ provider: ROUTING_PROVIDER_ID, id: ROUTING_MODEL_ID, api: PI_VIRTUAL_MODEL_API })).toBe(true);
	expect(isRoutingModel({ provider: ROUTING_PROVIDER_ID, id: ROUTING_MODEL_ID, api: "openai" })).toBe(false);
	expect(isRoutingModel({ provider: ROUTING_PROVIDER_ID, id: ROUTING_MODEL_ID })).toBe(false);
	expect(isRoutingModel({ provider: ROUTING_PROVIDER_ID, id: "manual", api: PI_VIRTUAL_MODEL_API })).toBe(false);
	expect(isRoutingModel({ provider: "other", id: ROUTING_MODEL_ID, api: PI_VIRTUAL_MODEL_API })).toBe(false);
	expect(isRoutingModel(undefined)).toBe(false);
});
