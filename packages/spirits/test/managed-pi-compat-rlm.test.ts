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
	writeRlmFixture,
} from "../../../scripts/managed-pi-compat/rlm.ts";

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
	expect(classifyChildAbort({ childCreated: true, abortReported: false }).state).toBe("not-run");
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

test("auto parent with normal/strong settings", () => {
	const result = classifyAutoChild({
		childCreated: false,
		usageRecorded: false,
		error: "virtual model unavailable",
	});
	expect(result.state).toBe("limited");
	expect(result.detail).toContain("known limitation");
});

test("child generation, answer, usage, and abort are judged separately", () => {
	const observation = { childCreated: true, finalAnswer: "ok", usageRecorded: false, abortReported: undefined };
	expect(classifyChildCreation(observation).state).toBe("confirmed");
	expect(classifyChildAnswer(observation).state).toBe("confirmed");
	expect(classifyChildUsage(observation).state).toBe("limited");
	expect(classifyChildAbort(observation).state).toBe("not-run");
});

test("child abort is observed through rlm_usage", () => {
	expect(classifyChildAbort({ childCreated: true, abortReported: true }).state).toBe("confirmed");
	expect(classifyChildAbort({ childCreated: true, abortReported: undefined }).state).toBe("not-run");
	expect(classifyChildAbort({ childCreated: true, abortReported: false }).state).toBe("not-run");
});

test("fixture insufficiency is not a product defect", () => {
	expect(classifyFixtureInsufficiency("auth.json is missing").state).toBe("not-run");
	expect(classifyFixtureInsufficiency("child exploded").state).toBe("limited");
	expect(classifyChildCreation({ childCreated: false, error: "settings.json missing" }).state).toBe("not-run");
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
