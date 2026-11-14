// spec "dual-model-routing / ワークフローのステップ別ロール": the table in the spec and
// `STEP_DEFINITIONS` are one list, and a step name must never read as a role name.
import { expect, test } from "bun:test";
import { MODEL_ROLES, MODEL_ROLE_STRONG, STEP_DEFINITIONS } from "../src/constants.ts";

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
