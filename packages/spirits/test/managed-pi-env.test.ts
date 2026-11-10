import { expect, test } from "bun:test";
import { join } from "node:path";
import { computeManagedEnv, managedSessionDir } from "../src/managed-pi/environment.ts";

const PACKAGE_DIR = "/managed/current/pi";
const AGENT_DIR = "/home/tester/.spirits/managed-pi/agent";

const SESSION_DIR = join(AGENT_DIR, "sessions");

function compute(env: Record<string, string | undefined>) {
	// The isolated route hands in its fixed session directory.
	return computeManagedEnv({ env, packageDir: PACKAGE_DIR, agentDir: AGENT_DIR, sessionDir: SESSION_DIR });
}

/** The default route passes no session directory. */
function computeDefault(env: Record<string, string | undefined>) {
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

test("pins session storage and the package directory", () => {
	const env = compute({ PI_PACKAGE_DIR: "/tmp/decoy" });
	expect(env.SPIRITS_CODING_AGENT_SESSION_DIR).toBe(join(AGENT_DIR, "sessions"));
	expect(managedSessionDir(AGENT_DIR)).toBe(join(AGENT_DIR, "sessions"));
	expect(env.PI_PACKAGE_DIR).toBe(PACKAGE_DIR);
});

test("leaves the session directory alone when the caller pins none", () => {
	// Pi reads the session directory as the directory itself, not as a parent of the per-project
	// directory it derives from the working directory. Pinning the default route's agent directory
	// here would move new sessions out of the `<agent dir>/sessions/<encoded cwd>/` layout the fork
	// route already wrote, so the default route passes nothing and the inherited value stays.
	expect(computeDefault({}).SPIRITS_CODING_AGENT_SESSION_DIR).toBeUndefined();
	expect(computeDefault({ SPIRITS_CODING_AGENT_SESSION_DIR: "/data/sessions" }).SPIRITS_CODING_AGENT_SESSION_DIR).toBe(
		"/data/sessions",
	);
	// The agent directory is still the resolved one, and the old name is still removed.
	expect(computeDefault({}).SPIRITS_CODING_AGENT_DIR).toBe(AGENT_DIR);
	expect(computeDefault({}).PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
});

test("sets no identity variable, because the official binary reads none", () => {
	// Pi takes the app name and the config directory from `piConfig` in the package.json beside the
	// executable (`APP_NAME = piConfigName || "pi"`), so the overlay is the only thing that can set
	// them. A variable here would be dead on the managed route and would imply a knob that does not
	// exist; the fork route is the one that honors these, and it is not this function's caller.
	const env = compute({ PI_APP_NAME: "elsewhere", PI_CONFIG_DIR: ".elsewhere" });
	expect(env.PI_APP_NAME).toBeUndefined();
	expect(env.PI_CONFIG_DIR).toBeUndefined();
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
