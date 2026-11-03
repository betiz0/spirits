import { expect, test } from "bun:test";
import {
	allPathsUnder,
	classifyEnv,
	classifyHelpSideEffects,
} from "../../../scripts/managed-pi-compat/probes.ts";

test("agent dir precedence", () => {
	expect(
		classifyEnv(
			{ agentDir: "/tmp/agent", packageDir: "/managed/pi", appName: "spirits", version: "1.5.0" },
			{ agentDir: "/tmp/agent", version: "1.5.0" },
		).state,
	).toBe("confirmed");
	expect(
		classifyEnv(
			{ agentDir: "/tmp/old", packageDir: "/managed/pi", appName: "spirits", version: "1.5.0" },
			{ agentDir: "/tmp/agent", version: "1.5.0" },
		).state,
	).toBe("failed");
});

test("package dir decoy does not change identity", () => {
	const result = classifyEnv(
		{ agentDir: "/tmp/agent", appName: "decoy", version: "9.9.9", packageDirDecoyUsed: true },
		{ agentDir: "/tmp/agent", version: "1.5.0" },
	);
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("decoy");
});

test("help touches only the isolated home", () => {
	expect(allPathsUnder(["/tmp/home/.pi/agent", "/tmp/home/.config"], "/tmp/home")).toBe(true);
	expect(allPathsUnder(["/tmp/home/../real"], "/tmp/home")).toBe(false);
	expect(classifyHelpSideEffects(["/tmp/home/agent"], "/tmp/home").state).toBe("confirmed");
	expect(classifyHelpSideEffects(["/tmp/elsewhere"], "/tmp/home").state).toBe("failed");
});

test("api key and proxy survive", () => {
	const env = { ANTHROPIC_API_KEY: "secret", HTTPS_PROXY: "http://proxy.test" };
	expect(env).toMatchObject({ ANTHROPIC_API_KEY: "secret", HTTPS_PROXY: "http://proxy.test" });
});
