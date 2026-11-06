import { expect, test } from "bun:test";
import {
	buildObservationEvidence,
	computeCompatibilityMet,
	computeRunnerCompleted,
	OBSERVATION_EVIDENCE,
	REQUIRED_OBSERVATIONS,
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

test("unobservable items are not required", () => {
	// The rlm child abort and the existing agent dir write-back cannot be observed on the dedicated
	// Pi yet, so they must not decide the verdict (spec: 必須観測の範囲).
	expect(REQUIRED_OBSERVATIONS).not.toContain("rlm child abort");
	expect(REQUIRED_OBSERVATIONS).not.toContain("existing agent dir write-back compatibility");
	const withUnobserved: CompatResult[] = [
		...confirmedResults(),
		{ name: "rlm child abort", state: "not-run" },
		{ name: "existing agent dir write-back compatibility", state: "not-run" },
	];
	expect(computeRunnerCompleted(withUnobserved)).toBe(false);
	expect(computeCompatibilityMet("official", withUnobserved)).toBe(true);
});

test("failed=0 does not imply compatibility", () => {
	const results = confirmedResults().map((result) =>
		result.name === "dedicated Pi write path" ? { ...result, state: "limited" as const } : result,
	);
	expect(results.some((result) => result.state === "failed")).toBe(false);
	expect(computeCompatibilityMet("official", results)).toBe(false);
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
