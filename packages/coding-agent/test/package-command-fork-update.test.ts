import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 3.4: resolve the app identity as a spirits build does before src/config.ts is
// evaluated, and pin the install method to a compiled Bun binary.
vi.hoisted(() => {
	process.env.PI_APP_NAME = "spirits";
});

vi.mock("../src/config.ts", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...(actual as Record<string, unknown>),
		detectInstallMethod: () => "bun-binary",
	};
});

import { ENV_AGENT_DIR } from "../src/config.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";

describe("package commands in a non-pi Bun binary", () => {
	let tempDir: string;
	let originalAgentDir: string | undefined;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-package-fork-update-"));
		originalAgentDir = process.env[ENV_AGENT_DIR];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.env[ENV_AGENT_DIR] = tempDir;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		rmSync(tempDir, { recursive: true, force: true });
		process.exitCode = originalExitCode;
		if (originalAgentDir === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = originalAgentDir;
		}
	});

	afterAll(() => {
		delete process.env.PI_APP_NAME;
	});

	it("guides to the installer without querying pi releases", async () => {
		const fetchMock = vi.fn(() => {
			throw new Error("fetch must not be called for a non-pi Bun binary");
		});
		vi.stubGlobal("fetch", fetchMock);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePackageCommand(["update", "--self"])).resolves.toBe(true);

		expect(fetchMock).not.toHaveBeenCalled();
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stderr).toContain("re-running the installer");
		expect(stderr).not.toContain("github.com/earendil-works/pi/releases");
		expect(process.exitCode).toBe(1);
	});

	it("does not advertise a pi self-update target in update help", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePackageCommand(["update", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("spirits update [source|self]");
		expect(stdout).not.toContain("[source|self|pi]");
		expect(stdout).not.toContain("Update pi");
		expect(stdout).not.toContain("update pi ");
	});
});
