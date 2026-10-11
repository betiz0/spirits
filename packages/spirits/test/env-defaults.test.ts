import { expect, test } from "bun:test";
import { join } from "node:path";
import { computeEnvDefaults } from "../bin/env-defaults.ts";
import { ENV_AGENT_DIR, ENV_SKIP_VERSION_CHECK, ENV_TELEMETRY } from "../src/constants.ts";

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
