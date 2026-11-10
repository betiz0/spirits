import { expect, test } from "bun:test";
import { join } from "node:path";
import { computeEnvDefaults } from "../bin/env-defaults.ts";
import { ENV_AGENT_DIR, ENV_OLD_AGENT_DIR, ENV_SKIP_VERSION_CHECK, ENV_TELEMETRY } from "../src/constants.ts";
import { resolveAgentDir } from "../src/env-defaults.ts";

test("uses the agent dir environment variable name derived from the spirits app name", () => {
	expect(ENV_AGENT_DIR).toBe("SPIRITS_CODING_AGENT_DIR");
});

test("sets agent dir under ~/.spirits/agent when unset", () => {
	const defaults = computeEnvDefaults({}, "/home/user");
	expect(defaults[ENV_AGENT_DIR]).toBe(join("/home/user", ".spirits", "agent"));
});

test("keeps SPIRITS_CODING_AGENT_DIR when set", () => {
	const defaults = computeEnvDefaults({ [ENV_AGENT_DIR]: "/tmp/custom-agent" }, "/home/user");
	expect(defaults[ENV_AGENT_DIR]).toBeUndefined();
});

test("the shared agent dir rule is one place for both routes", () => {
	expect(resolveAgentDir({}, "/home/user")).toBe(join("/home/user", ".spirits", "agent"));
	expect(resolveAgentDir({ [ENV_AGENT_DIR]: "/tmp/custom-agent" }, "/home/user")).toBe("/tmp/custom-agent");
	// An empty value counts as unset, exactly like the fork route treats it.
	expect(resolveAgentDir({ [ENV_AGENT_DIR]: "" }, "/home/user")).toBe(join("/home/user", ".spirits", "agent"));
	// The fork's own variable name is never read as a storage choice: pi uses it internally and it
	// must not redirect spirits storage on either route.
	expect(resolveAgentDir({ [ENV_OLD_AGENT_DIR]: "/tmp/pi-agent" }, "/home/user")).toBe(
		join("/home/user", ".spirits", "agent"),
	);
	// The defaults the fork route applies agree with the rule.
	expect(computeEnvDefaults({}, "/home/user")[ENV_AGENT_DIR]).toBe(resolveAgentDir({}, "/home/user"));
});

test("disables pi version check", () => {
	const defaults = computeEnvDefaults({}, "/home/user");
	expect(defaults[ENV_SKIP_VERSION_CHECK]).toBe("1");
});

test("disables telemetry when PI_TELEMETRY is unset", () => {
	const defaults = computeEnvDefaults({}, "/home/user");
	expect(defaults[ENV_TELEMETRY]).toBe("0");
});

test("keeps an explicit PI_TELEMETRY value", () => {
	const defaults = computeEnvDefaults({ [ENV_TELEMETRY]: "1" }, "/home/user");
	expect(defaults[ENV_TELEMETRY]).toBeUndefined();
});
