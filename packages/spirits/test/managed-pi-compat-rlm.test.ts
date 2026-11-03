import { expect, test } from "bun:test";
import { classifyAutoChild, classifyPhysicalChild } from "../../../scripts/managed-pi-compat/rlm.ts";

test("physical model child completes", () => {
	expect(
		classifyPhysicalChild({ childCreated: true, finalAnswer: "ok", usageRecorded: true, abortReported: true }).state,
	).toBe("confirmed");
});

test("child usage is recorded", () => {
	expect(
		classifyPhysicalChild({ childCreated: true, finalAnswer: "ok", usageRecorded: false, abortReported: true }).detail,
	).toContain("usage");
});

test("child abort is reported", () => {
	expect(
		classifyPhysicalChild({ childCreated: true, finalAnswer: "ok", usageRecorded: true, abortReported: false }).detail,
	).toContain("abort");
});

test("auto parent is recorded separately", () => {
	const result = classifyAutoChild({ childCreated: true, finalAnswer: "ok", usageRecorded: true });
	expect(result.state).toBe("limited");
	expect(result.detail).toContain("separately");
});

test("auto parent failure is limited not confirmed", () => {
	const result = classifyAutoChild({ childCreated: false, usageRecorded: false, error: "virtual model unresolved" });
	expect(result.state).toBe("limited");
	expect(result.detail).toContain("known limitation");
});
