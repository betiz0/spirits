import { expect, test } from "bun:test";
import { applyHostIdentity, hostDescriptor, hostExecutablePath, hostPackageDir, MANIFEST_HOST_KIND_PI, OFFICIAL_PI_HOST, type HostPackageJson } from "../src/managed-pi/host.ts";
import { ENV_MANAGED_AGENT_DIR, ENV_MANAGED_SESSION_DIR, ENV_PACKAGE_DIR, ENV_SKIP_VERSION_CHECK, ENV_TELEMETRY, SPIRITS_APP_NAME } from "../src/constants.ts";

test("the official Pi descriptor names the host and its paths", () => {
	expect(OFFICIAL_PI_HOST.id).toBe("pi");
	expect(OFFICIAL_PI_HOST.packageName).toBe("@earendil-works/pi-coding-agent");
	expect(hostPackageDir("/home/u/.spirits/managed-pi/current")).toBe(
		"/home/u/.spirits/managed-pi/current/pi",
	);
	expect(hostExecutablePath("/home/u/.spirits/managed-pi/current")).toBe(
		"/home/u/.spirits/managed-pi/current/pi/pi",
	);
});

test("the official Pi loads the bundle with -e", () => {
	expect(OFFICIAL_PI_HOST.extensionArgs("/set/spirits-extension.js")).toEqual([
		"-e",
		"/set/spirits-extension.js",
	]);
});

test("the official Pi identity is the package.json piConfig.name overlay", () => {
	expect(OFFICIAL_PI_HOST.identity.field).toBe("piConfig.name");
	expect(OFFICIAL_PI_HOST.identity.kind).toBe("piConfig.name");
});

test("a manifest without a host kind selects the official Pi", () => {
	expect(hostDescriptor().id).toBe(MANIFEST_HOST_KIND_PI);
	expect(hostDescriptor(MANIFEST_HOST_KIND_PI)).toBe(OFFICIAL_PI_HOST);
});

test("an unknown manifest host kind is refused", () => {
	expect(() => hostDescriptor("bolt")).toThrow("Unsupported managed host kind: bolt");
});

test("the descriptor carries the environment names the child is built from", () => {
	expect(OFFICIAL_PI_HOST.env).toMatchObject({
		agentDir: ENV_MANAGED_AGENT_DIR,
		sessionDir: ENV_MANAGED_SESSION_DIR,
		packageDir: ENV_PACKAGE_DIR,
		skipVersionCheck: ENV_SKIP_VERSION_CHECK,
		telemetry: ENV_TELEMETRY,
	});
	expect(OFFICIAL_PI_HOST.env.removed).toEqual([
		"PI_CODING_AGENT_DIR",
		"PI_CODING_AGENT_SESSION_DIR",
		"PI_APP_NAME",
		"PI_CONFIG_DIR",
	]);
});

test("the identity overlay writes only the name field and keeps the rest", () => {
	const official: HostPackageJson = {
		name: "@earendil-works/pi-coding-agent",
		version: "1.5.0",
		piConfig: { configDir: ".pi" },
		bin: { pi: "dist/bundle/cli.js" },
	};
	const overlaid = applyHostIdentity(official, OFFICIAL_PI_HOST.identity);
	expect(overlaid.piConfig).toEqual({ configDir: ".pi", name: SPIRITS_APP_NAME });
	expect(overlaid.name).toBe("@earendil-works/pi-coding-agent");
	expect(overlaid.version).toBe("1.5.0");
	expect(overlaid.bin).toEqual({ pi: "dist/bundle/cli.js" });
	expect(official.piConfig).toEqual({ configDir: ".pi" });
});

test("the identity overlay fills the default config directory", () => {
	const overlaid = applyHostIdentity({ name: "pi", version: "1.5.0" }, OFFICIAL_PI_HOST.identity);
	expect(overlaid.piConfig).toEqual({ configDir: ".pi", name: SPIRITS_APP_NAME });
});

test("an overlay over a foreign config directory keeps the artifact value", () => {
	const overlaid = applyHostIdentity(
		{ name: "pi", version: "1.5.0", piConfig: { configDir: ".custom", name: "pi" } },
		OFFICIAL_PI_HOST.identity,
	);
	expect(overlaid.piConfig).toEqual({ configDir: ".custom", name: SPIRITS_APP_NAME });
});
