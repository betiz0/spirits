import { expect, test } from "bun:test";
import { join } from "node:path";
import { computeManagedEnv, managedSessionDir } from "../src/managed-pi/environment.ts";

const PACKAGE_DIR = "/managed/current/pi";
const AGENT_DIR = "/home/tester/.spirits/managed-pi/agent";

function compute(env: Record<string, string | undefined>) {
	return computeManagedEnv({ env, packageDir: PACKAGE_DIR, agentDir: AGENT_DIR });
}

test("uses the resolved isolated agent directory", () => {
	expect(compute({})[ "SPIRITS_CODING_AGENT_DIR"]).toBe(AGENT_DIR);
	// A caller value is not a storage choice: the resolved isolated dir always wins.
	expect(compute({ SPIRITS_CODING_AGENT_DIR: "/home/tester/.spirits/agent" }).SPIRITS_CODING_AGENT_DIR).toBe(
		AGENT_DIR,
	);
	expect(compute({ SPIRITS_CODING_AGENT_DIR: "/tmp/managed-agent" }).SPIRITS_CODING_AGENT_DIR).toBe(AGENT_DIR);
});

test("pins identity and session storage", () => {
	const env = compute({ PI_APP_NAME: "elsewhere", PI_CONFIG_DIR: ".elsewhere", PI_PACKAGE_DIR: "/tmp/decoy" });
	expect(env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(AGENT_DIR, "sessions"));
	expect(managedSessionDir(AGENT_DIR)).toBe(join(AGENT_DIR, "sessions"));
	expect(env.PI_APP_NAME).toBe("spirits");
	expect(env.PI_CONFIG_DIR).toBe(".pi");
	expect(env.PI_PACKAGE_DIR).toBe(PACKAGE_DIR);
});

test("removes the old agent and session variables", () => {
	const env = compute({ PI_CODING_AGENT_DIR: "/tmp/old-agent", PI_CODING_AGENT_SESSION_DIR: "/tmp/old-sessions" });
	expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
	expect(env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
	expect(env.SPIRITS_CODING_AGENT_DIR).toBe(AGENT_DIR);
});

test("preserves api keys and proxy", () => {
	const env = compute({ ANTHROPIC_API_KEY: "secret", HTTPS_PROXY: "http://proxy.test", SPIRITS_API_BASE_URL: "https://api.test" });
	expect(env.ANTHROPIC_API_KEY).toBe("secret");
	expect(env.HTTPS_PROXY).toBe("http://proxy.test");
	expect(env.SPIRITS_API_BASE_URL).toBe("https://api.test");
});

test("pins version check and keeps an explicit telemetry value", () => {
	expect(compute({ PI_SKIP_VERSION_CHECK: "0" }).PI_SKIP_VERSION_CHECK).toBe("1");
	expect(compute({ PI_TELEMETRY: "1" }).PI_TELEMETRY).toBe("1");
});

test("defaults telemetry only when unset", () => {
	expect(compute({}).PI_TELEMETRY).toBe("0");
	expect(compute({ PI_TELEMETRY: "" }).PI_TELEMETRY).toBe("");
});
