import { expect, test } from "bun:test";
import {
	buildObservationEvidence,
	CLEAR_BOUNDARY_ITEMS,
	COMPATIBILITY_MET_DEFINITION,
	computeCompatibilityMet,
	computeRunnerCompleted,
	countStates,
	formatStateCounts,
	matrixPurposeCounts,
	nonRequiredIssues,
	OBSERVATION_EVIDENCE,
	requiredObservationsNotMet,
	REQUIRED_OBSERVATIONS,
	ROLE_CLEAR_MODEL_ITEM,
	RUNNER_COMPLETED_DEFINITION,
	SUMMARY_READING_NOTES,
} from "../../../scripts/managed-pi-compat/evidence.ts";
import type { CompatResult } from "../../../scripts/managed-pi-compat/runner.ts";

function confirmedResults(): CompatResult[] {
	return REQUIRED_OBSERVATIONS.map((name) => ({ name, state: "confirmed" as const }));
}

test("runner completion and compatibility are separate", () => {
	const results = confirmedResults();
	expect(computeRunnerCompleted(results)).toBe(true);
	expect(computeCompatibilityMet("fixture", results)).toBe(false);
	expect(computeCompatibilityMet("official", results)).toBe(true);

	const withNotRun = results.map((result) =>
		result.name === "rlm child usage" ? { ...result, state: "not-run" as const } : result,
	);
	expect(computeRunnerCompleted(withNotRun)).toBe(false);
	expect(computeCompatibilityMet("official", withNotRun)).toBe(false);
});

test("a product gap does not remove an item from the required list", () => {
	// The child abort is measurable end to end. If the product does not deliver the record the item
	// says so and the verdict stays false; excluding it would hide the gap. Write-back compatibility
	// is the single item the base spec pins as unproven, so it stays out.
	expect(REQUIRED_OBSERVATIONS).toContain("rlm child abort");
	expect(REQUIRED_OBSERVATIONS).toContain("existing agent dir untouched");
	expect(REQUIRED_OBSERVATIONS).not.toContain("existing agent dir write-back compatibility");
	for (const state of ["limited", "unavailable", "not-run", "failed"] as const) {
		const results = confirmedResults().map((result) =>
			result.name === "rlm child abort" ? { ...result, state } : result,
		);
		expect(computeCompatibilityMet("official", results)).toBe(false);
	}
});

test("the summary separates required gaps from items outside the required list", () => {
	const results: CompatResult[] = confirmedResults().map((result) =>
		result.name === "rlm child usage" ? { ...result, state: "unavailable" as const } : result,
	);
	results.push({ name: "rlm auto parent", state: "limited" }, { name: "settings write compatibility", state: "not-run" });
	expect(requiredObservationsNotMet(results).map((result) => result.name)).toEqual(["rlm child usage"]);
	expect(nonRequiredIssues(results).map((result) => result.name)).toEqual([
		"rlm auto parent",
		"settings write compatibility",
	]);
	expect(computeCompatibilityMet("official", results)).toBe(false);
});

test("both judgement definitions name what they count", () => {
	expect(RUNNER_COMPLETED_DEFINITION).toContain("not-run");
	expect(COMPATIBILITY_MET_DEFINITION).toContain("required observation");
	expect(RUNNER_COMPLETED_DEFINITION).not.toBe(COMPATIBILITY_MET_DEFINITION);
	// The matrix row being confirmed says nothing about the other purposes, so the definition says so.
	expect(COMPATIBILITY_MET_DEFINITION).toContain("role, /clear, or /model");
});

test("the state breakdown always names all five labels", () => {
	const results: CompatResult[] = [
		{ name: "a", state: "confirmed" },
		{ name: "b", state: "confirmed" },
		{ name: "c", state: "limited" },
		{ name: "d", state: "not-run" },
	];
	expect(formatStateCounts(countStates(results))).toBe(
		"confirmed=2 limited=1 unavailable=0 not-run=1 failed=0",
	);
});

test("the summary notes qualify the two easy-to-overread confirmations", () => {
	const abort = SUMMARY_READING_NOTES.find((note) => note.item === "rlm child abort");
	expect(abort?.text).toContain("after the parent turn ends");
	expect(abort?.text).toContain("never at `agent_settled`");
	const matrix = SUMMARY_READING_NOTES.find((note) => note.item === ROLE_CLEAR_MODEL_ITEM);
	expect(matrix?.text).toContain("any purpose was observed");
	// The observed count comes from the item's own recorded purposes, not from the row states.
	const results: CompatResult[] = [
		{
			name: ROLE_CLEAR_MODEL_ITEM,
			state: "confirmed",
			data: {
				purposes: [
					{ id: "skill-strong-phase", state: "available" },
					{ id: "thinking-level", state: "limited" },
					{ id: "conversation-clear", state: "not-run" },
					{ id: "role-badge", state: "not-run" },
				],
			},
		},
	];
	expect(matrixPurposeCounts(results)).toEqual({ observed: 2, total: 4 });
	expect(matrixPurposeCounts([{ name: "managed extension load", state: "confirmed" }])).toBeUndefined();
});

test("failed=0 does not imply compatibility", () => {
	const results = confirmedResults().map((result) =>
		result.name === "dedicated Pi write path" ? { ...result, state: "limited" as const } : result,
	);
	expect(results.some((result) => result.state === "failed")).toBe(false);
	expect(computeCompatibilityMet("official", results)).toBe(false);
});

// The five boundary observations are what notices that a Pi update broke the clear filter, so an
// official run that cannot confirm them must not claim compatibility.
test("the clear boundary observations are required", () => {
	for (const name of Object.values(CLEAR_BOUNDARY_ITEMS)) {
		expect(REQUIRED_OBSERVATIONS).toContain(name);
	}
});

test("write path and write-back are separate items", () => {
	expect(REQUIRED_OBSERVATIONS).toContain("dedicated Pi write path");
	expect(REQUIRED_OBSERVATIONS).not.toContain("data write compatibility");
	expect(REQUIRED_OBSERVATIONS).not.toContain("existing agent dir write-back compatibility");
	expect(OBSERVATION_EVIDENCE["dedicated Pi write path"]).toContain("read back through the dedicated Pi");
	expect(OBSERVATION_EVIDENCE["existing agent dir write-back compatibility"]).toContain("existing agent dir");
	expect(OBSERVATION_EVIDENCE["dedicated Pi write path"]).not.toBe(
		OBSERVATION_EVIDENCE["existing agent dir write-back compatibility"],
	);
});

test("observation evidence map is emitted", () => {
	const evidence = buildObservationEvidence([
		{ name: "managed extension load", state: "confirmed" },
		{ name: "unlisted observation", state: "limited" },
	]);
	expect(evidence).toHaveLength(2);
	expect(evidence[0]?.observation).toBe("managed extension load");
	expect(evidence[0]?.expectedEvidence).toContain("session_start");
	expect(evidence[1]?.observation).toBe("unlisted observation");
	expect(evidence[1]?.expectedEvidence.length).toBeGreaterThan(0);
});
