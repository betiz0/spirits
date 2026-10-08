import { expect, test } from "bun:test";
import { join } from "node:path";
import { computeEnvDefaults } from "../bin/env-defaults.ts";
import { ENV_AGENT_DIR, ENV_SKIP_VERSION_CHECK } from "../src/constants.ts";

test("sets agent dir under ~/.spirits/agent when unset", () => {
	const defaults = computeEnvDefaults({}, "/home/user");
	expect(defaults[ENV_AGENT_DIR]).toBe(join("/home/user", ".spirits", "agent"));
});

test("keeps PI_CODING_AGENT_DIR when set", () => {
	const defaults = computeEnvDefaults({ [ENV_AGENT_DIR]: "/tmp/custom-agent" }, "/home/user");
	expect(defaults[ENV_AGENT_DIR]).toBeUndefined();
});

test("disables pi version check", () => {
	const defaults = computeEnvDefaults({}, "/home/user");
	expect(defaults[ENV_SKIP_VERSION_CHECK]).toBe("1");
});
