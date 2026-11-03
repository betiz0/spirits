import { expect, test } from "bun:test";
import { computeManagedEnv } from "../src/managed-pi/environment.ts";

const HOME = "/home/tester";
const PACKAGE_DIR = "/managed/current/pi";

function compute(env: Record<string, string | undefined>) {
	return computeManagedEnv({ env, home: HOME, packageDir: PACKAGE_DIR });
}

test("agent dir default and override", () => {
	expect(compute({})["SPIRITS_CODING_AGENT_DIR"]).toBe("/home/tester/.spirits/agent");
	expect(compute({ SPIRITS_CODING_AGENT_DIR: "/tmp/managed-agent" })["SPIRITS_CODING_AGENT_DIR"]).toBe(
		"/tmp/managed-agent",
	);
});

test("old agent dir name is removed", () => {
	const env = compute({ PI_CODING_AGENT_DIR: "/tmp/old-agent" });
	expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
	expect(env.SPIRITS_CODING_AGENT_DIR).toBe("/home/tester/.spirits/agent");
});

test("package dir is pinned", () => {
	const env = compute({ PI_PACKAGE_DIR: "/tmp/decoy" });
	expect(env.PI_PACKAGE_DIR).toBe(PACKAGE_DIR);
});

test("api key and proxy are preserved", () => {
	const env = compute({ ANTHROPIC_API_KEY: "secret", HTTPS_PROXY: "http://proxy.test" });
	expect(env.ANTHROPIC_API_KEY).toBe("secret");
	expect(env.HTTPS_PROXY).toBe("http://proxy.test");
});

test("version check and telemetry defaults match the compiled route", () => {
	expect(compute({}).PI_SKIP_VERSION_CHECK).toBe("1");
	expect(compute({}).PI_TELEMETRY).toBe("0");
	expect(compute({ PI_TELEMETRY: "1" }).PI_TELEMETRY).toBe("1");
});
