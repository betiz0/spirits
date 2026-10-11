import { describe, expect, test } from "vitest";
import { APP_NAME, ENV_AGENT_DIR, resolveAppIdentity } from "../src/config.ts";

describe("resolveAppIdentity", () => {
	test("uses PI_APP_NAME and PI_CONFIG_DIR when set", () => {
		const identity = resolveAppIdentity(
			{ name: "configured-name", configDir: ".configured" },
			{ PI_APP_NAME: "spirits", PI_CONFIG_DIR: ".spirits" },
		);

		expect(identity).toEqual({ appName: "spirits", appTitle: "spirits", configDirName: ".spirits" });
	});

	test("falls back to package.json piConfig when env is unset", () => {
		const identity = resolveAppIdentity({ name: "tau", configDir: ".tau" }, {});

		expect(identity).toEqual({ appName: "tau", appTitle: "tau", configDirName: ".tau" });
	});

	test("falls back to pi defaults when env and piConfig are unset", () => {
		const identity = resolveAppIdentity(undefined, {});

		expect(identity).toEqual({ appName: "pi", appTitle: "π", configDirName: ".pi" });
	});

	test("ignores empty env values", () => {
		const identity = resolveAppIdentity(undefined, { PI_APP_NAME: "", PI_CONFIG_DIR: "" });

		expect(identity).toEqual({ appName: "pi", appTitle: "π", configDirName: ".pi" });
	});
});

describe("module identity", () => {
	test("derives env var names from APP_NAME", () => {
		expect(ENV_AGENT_DIR).toBe(`${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`);
	});
});
