import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyAutoChild,
	classifyChildAbort,
	classifyChildAnswer,
	classifyChildCreation,
	classifyChildUsage,
	classifyFixtureInsufficiency,
	classifyPhysicalChild,
	isVirtualRequestedModel,
	rlmUsageOutcome,
	writeRlmFixture,
	type ChildAbortObservation,
} from "../../../scripts/managed-pi-compat/rlm.ts";

/** The five measured phases of one child abort, with the named ones overridden. */
function abortPhases(overrides: Partial<ChildAbortObservation> = {}): ChildAbortObservation {
	return {
		abortSent: true,
		abortAccepted: true,
		cellAborted: true,
		childSeen: true,
		childStopped: true,
		usageAtSettled: 0,
		usageAfterStop: 0,
		pollWindowMs: 15000,
		...overrides,
	};
}

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

test("a missing abort does not change the physical child judgement", () => {
	expect(
		classifyPhysicalChild({ childCreated: true, finalAnswer: "ok", usageRecorded: true, abortReported: false }).state,
	).toBe("confirmed");
});

test("rlm fixture provides auth and model settings", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-rlm-fixture-"));
	try {
		const agentDir = join(dir, "agent");
		const fixture = await writeRlmFixture({ agentDir });
		expect(fixture.settings).toMatchObject({ defaultProvider: "compat-fake", defaultModel: "fake-model" });
		expect(fixture.settings.models).toMatchObject({ strong: "compat-fake/fake-model", role: "normal" });
		expect(fixture.auth).toEqual({ "compat-fake": { type: "api_key", key: "fake" } });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("rlm fixture also writes the child agent dir", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-rlm-fixture-"));
	try {
		const agentDir = join(dir, "agent");
		const childDir = join(dir, "home", ".pi", "agent");
		await writeRlmFixture({ agentDir, childAgentDirs: [childDir], providerBaseUrl: "http://127.0.0.1:1" });
		expect(await Bun.file(join(childDir, "auth.json")).json()).toEqual({
			"compat-fake": { type: "api_key", key: "fake" },
		});
		expect(await Bun.file(join(childDir, "models.json")).json()).toMatchObject({
			providers: { "compat-fake": { baseUrl: "http://127.0.0.1:1" } },
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("physical model child", () => {
	const result = classifyPhysicalChild({
		childCreated: true,
		finalAnswer: "ok",
		usageRecorded: true,
		abortReported: true,
	});
	expect(result.state).toBe("confirmed");
});

test("auto parent is confirmed only on a physical child request", () => {
	const result = classifyAutoChild({
		childCreated: true,
		finalAnswer: "child answer",
		usageRecorded: true,
		childRequestedModel: "fake-model",
	});
	expect(result.state).toBe("confirmed");
	expect(result.detail).toContain("fake-model");
});

test("an auto child request that still names the virtual model fails", () => {
	// Answer, usage and a created child are not enough: the request itself is what proves the parent
	// resolved a physical target rather than handing the virtual selection to a child that cannot route.
	const result = classifyAutoChild({
		childCreated: true,
		finalAnswer: "child answer",
		usageRecorded: true,
		childRequestedModel: "auto",
	});
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("virtual model");
	expect(isVirtualRequestedModel("spirits/auto")).toBe(true);
	expect(isVirtualRequestedModel("AUTO")).toBe(true);
	expect(isVirtualRequestedModel("fake-model")).toBe(false);
	expect(isVirtualRequestedModel(undefined)).toBe(false);
});

test("a complete fixture whose auto child never started fails", () => {
	const result = classifyAutoChild({ childCreated: false, usageRecorded: false, error: "No API key found for spirits" });
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("no child request reached the provider");
	expect(result.detail).toContain("No API key found for spirits");
});

test("a host that never sent a child request does not fail the auto parent", () => {
	// A fixture host answers with fixed events and never opens a provider request. With nothing to read
	// the item is unexercised, not a product defect.
	const result = classifyAutoChild({ childCreated: true, finalAnswer: "", usageRecorded: false });
	expect(result.state).toBe("not-run");
	expect(result.detail).toContain("never exercised");
	expect(result.detail).toContain("requested model=none");
});

test("an auto parent with no resolvable child target is not a product defect", () => {
	const result = classifyAutoChild({
		childCreated: false,
		usageRecorded: false,
		error: "spirits/auto has no child model: tried normal; defaultProvider and defaultModel are not set",
	});
	expect(result.state).toBe("not-run");
	expect(result.detail).toContain("fixture insufficiency");
});

test("child generation, answer, usage, and abort are judged separately", () => {
	const observation = { childCreated: true, finalAnswer: "ok", usageRecorded: false, abortReported: undefined };
	expect(classifyChildCreation(observation).state).toBe("confirmed");
	expect(classifyChildAnswer(observation).state).toBe("confirmed");
	expect(classifyChildUsage(observation).state).toBe("limited");
	// The abort item measures its own five phases and never borrows this observation.
	expect(classifyChildAbort(abortPhases({ usageAfterStop: 1 })).state).toBe("confirmed");
});

test("child abort is judged from the five phases, not from a single read", () => {
	// The chain worked and no record appeared at either read point: measured, so limited.
	expect(classifyChildAbort(abortPhases()).state).toBe("limited");
	const settled = classifyChildAbort(abortPhases({ usageAtSettled: 1 }));
	expect(settled.state).toBe("confirmed");
	expect(settled.detail).toContain("at agent_settled");
	// The record only appeared after the child stopped, which a single settle read cannot see.
	const afterStop = classifyChildAbort(abortPhases({ usageAfterStop: 1 }));
	expect(afterStop.state).toBe("confirmed");
	expect(afterStop.detail).toContain("after the child stopped");
	// `confirmed` is conditional on the read happening after the parent turn ends.
	expect(afterStop.detail).toContain("conditional on reading after the parent turn ends");
	expect(classifyChildAbort(abortPhases()).detail).toContain("abort sent=true, abort accepted=true");
});

test("an exercised child abort is never recorded as not-run", () => {
	const exercised = [
		abortPhases(),
		abortPhases({ usageAtSettled: 1 }),
		abortPhases({ usageAfterStop: 1 }),
		abortPhases({ childStopped: false }),
		abortPhases({ cellAborted: false }),
		abortPhases({ abortAccepted: false }),
	];
	for (const phases of exercised) expect(classifyChildAbort(phases).state).not.toBe("not-run");
});

test("child abort separates a refused abort from a child that never stopped", () => {
	expect(classifyChildAbort(abortPhases({ abortAccepted: false })).state).toBe("unavailable");
	const stuck = classifyChildAbort(abortPhases({ childStopped: false }));
	expect(stuck.state).toBe("failed");
	expect(stuck.detail).toContain("15000ms after the abort");
	expect(classifyChildAbort(abortPhases({ cellAborted: false })).state).toBe("failed");
});

test("a run whose host never created a child is not-run, not a confirmed abort", () => {
	// A fixture host answers with fixed events and creates no child session. Recording that as a
	// product abort would turn a fixture event into compatibility evidence.
	const noChild = classifyChildAbort(abortPhases({ childSeen: false, childStopped: false, usageAtSettled: 1, usageAfterStop: 1 }));
	expect(noChild.state).toBe("not-run");
	expect(noChild.detail).toContain("no child session reached the provider");
	expect(noChild.detail).toContain("child seen=false");
});

test("an abort that was never sent is not-run with its reason", () => {
	const fixtureGap = classifyChildAbort(abortPhases({ abortSent: false, error: "auth.json is missing" }));
	expect(fixtureGap.state).toBe("not-run");
	expect(fixtureGap.detail).toContain("fixture insufficiency");
	const neverSent = classifyChildAbort(abortPhases({ abortSent: false }));
	expect(neverSent.state).toBe("not-run");
	expect(neverSent.detail).toContain("never sent");
});

test("rlm_usage outcome is read from the entry payload", () => {
	// pi.appendEntry stores the payload under `data`, so a check on entry.outcome never matches and
	// silently turns a recorded abort into an unobserved one.
	expect(rlmUsageOutcome({ type: "custom", customType: "rlm_usage", data: { outcome: "aborted" } })).toBe("aborted");
	expect(rlmUsageOutcome({ type: "custom", customType: "rlm_usage", data: null })).toBeUndefined();
	expect(rlmUsageOutcome({ type: "custom", customType: "rlm_usage" })).toBeUndefined();
	expect(rlmUsageOutcome({ outcome: "error" })).toBe("error");
});

test("fixture insufficiency is not a product defect", () => {
	expect(classifyFixtureInsufficiency("auth.json is missing").state).toBe("not-run");
	expect(classifyFixtureInsufficiency("child exploded").state).toBe("limited");
	expect(classifyChildCreation({ childCreated: false, error: "settings.json missing" }).state).toBe("not-run");
});

test("an auto child that answered without usage is not confirmed", () => {
	const result = classifyAutoChild({
		childCreated: true,
		finalAnswer: "ok",
		usageRecorded: false,
		childRequestedModel: "fake-model",
	});
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("no rlm_usage record");
});
