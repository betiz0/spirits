import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRuntimeEvidence,
	identifyRuntime,
	redactSecrets,
} from "../../../scripts/managed-pi-compat/evidence.ts";
import {
	assertOfficialArtifactSha,
	assertOfficialBundleSha,
	buildOfficialIdentity,
	classifyOfficialArtifactSha,
	classifyOfficialBundleSha,
	createOfficialLaunchVerifier,
	OfficialArtifactError,
} from "../../../scripts/managed-pi-compat/official.ts";
import { MANAGED_PI_FIRST_ARTIFACT_SHA256 } from "../src/constants.ts";
import { firstSupportedManifest } from "../src/managed-pi/manifest.ts";

test("official mode rejects a non-official artifact", () => {
	const wrong = "0".repeat(64);
	expect(classifyOfficialArtifactSha(wrong).state).toBe("failed");
	expect(classifyOfficialArtifactSha(wrong).detail).toContain("not the official artifact");
	expect(classifyOfficialArtifactSha(MANAGED_PI_FIRST_ARTIFACT_SHA256).state).toBe("confirmed");
	expect(() => assertOfficialArtifactSha(wrong)).toThrow(OfficialArtifactError);
	expect(() => assertOfficialArtifactSha(MANAGED_PI_FIRST_ARTIFACT_SHA256)).not.toThrow();
});

test("official mode records artifact and bundle identity", () => {
	const manifest = firstSupportedManifest({
		version: "0.1.0",
		url: "https://example.invalid/spirits-managed-pi-extension.js",
		sha256: "a".repeat(64),
	});
	const identity = buildOfficialIdentity({
		manifest,
		manifestSha256: "b".repeat(64),
		artifactSha256: MANAGED_PI_FIRST_ARTIFACT_SHA256,
		executableSha256: "c".repeat(64),
		bundleSha256: "d".repeat(64),
		bundleVersion: "0.1.0",
		targetCommit: "abc123",
		workingTreeClean: false,
	});
	expect(identity.piVersion).toBe(manifest.pi.version);
	expect(identity.artifactSha256).toBe(MANAGED_PI_FIRST_ARTIFACT_SHA256);
	expect(identity.executableSha256).toBe("c".repeat(64));
	expect(identity.bundleVersion).toBe("0.1.0");
	expect(identity.bundleSha256).toBe("d".repeat(64));
	expect(identity.manifestSetId).toBe(manifest.setId);
	expect(identity.manifestSha256).toBe("b".repeat(64));
	expect(identity.overlayVersion).toBe(manifest.overlay.version);
	expect(identity.overlaySha256).toBe(manifest.overlay.sha256);
	expect(identity.targetCommit).toBe("abc123");
	expect(identity.workingTreeClean).toBe(false);
});

test("official mode rejects a bundle that is not the manifest extension", () => {
	const manifest = firstSupportedManifest({
		version: "0.1.0",
		url: "https://example.invalid/spirits-managed-pi-extension.js",
		sha256: "a".repeat(64),
	});
	expect(classifyOfficialBundleSha(manifest, "b".repeat(64)).state).toBe("failed");
	expect(classifyOfficialBundleSha(manifest, "b".repeat(64)).detail).toContain("manifest extension.artifact.sha256");
	expect(classifyOfficialBundleSha(manifest, "a".repeat(64)).state).toBe("confirmed");
	expect(() => assertOfficialBundleSha(manifest, "b".repeat(64))).toThrow(OfficialArtifactError);
	expect(() => assertOfficialBundleSha(manifest, "a".repeat(64))).not.toThrow();
});

test("official mode re-verifies the executable before launch", async () => {
	const dirs: string[] = [];
	const dir = await mkdtemp(join(tmpdir(), "spirits-official-launch-"));
	dirs.push(dir);
	try {
		const executablePath = join(dir, "pi");
		await writeFile(executablePath, "official executable");
		const sha256 = new Bun.CryptoHasher("sha256").update("official executable").digest("hex");
		const verify = createOfficialLaunchVerifier({ executablePath, executableSha256: sha256 });
		await expect(verify()).resolves.toBeUndefined();
		await writeFile(executablePath, "replaced executable");
		await expect(verify()).rejects.toBeInstanceOf(OfficialArtifactError);
	} finally {
		for (const path of dirs) await rm(path, { recursive: true, force: true });
	}
});

test("evidence redaction removes secrets", () => {
	const text = [
		"ANTHROPIC_API_KEY=sk-live-secret-value",
		"authorization: Bearer abcdef123456",
		"proxy=http://user:password@proxy.invalid:8080",
		"x-api-key: super-secret-key",
	].join("\n");
	const redacted = redactSecrets(text);
	expect(redacted).not.toContain("sk-live-secret-value");
	expect(redacted).not.toContain("abcdef123456");
	expect(redacted).not.toContain("password");
	expect(redacted).not.toContain("super-secret-key");
	expect(redacted).toContain("ANTHROPIC_API_KEY=***");
	expect(redacted).toContain("Bearer ***");
});

test("runtime and required api presence are recorded separately", () => {
	const evidence = buildRuntimeEvidence({
		runnerRuntime: "bun 1.4.4",
		requiredApis: { getSettings: true, appendEntry: undefined, setThinkingLevel: false },
	});
	expect(evidence.runner).toBe("bun 1.4.4");
	expect(evidence.host).toBe("unknown");
	expect(evidence.requiredApis).toEqual({
		getSettings: true,
		appendEntry: "unknown",
		setThinkingLevel: false,
	});
	const withHost = buildRuntimeEvidence({
		runnerRuntime: identifyRuntime({ bunVersion: "1.4.4" }),
		hostRuntime: identifyRuntime({ bunVersion: "1.4.2" }),
		requiredApis: {},
	});
	expect(withHost.host).toBe("bun 1.4.2");
	// A Bun host reports the Node-compatibility version through `process.version`, so the value has
	// to name the runtime that actually ran the host.
	expect(identifyRuntime({ bunVersion: "1.4.2", nodeVersion: "v24.3.0" })).toBe("bun 1.4.2");
	expect(identifyRuntime({ nodeVersion: "v24.3.0" })).toBe("node v24.3.0");
	expect(identifyRuntime({})).toBe("unknown");
	expect(buildRuntimeEvidence({ runnerRuntime: identifyRuntime({ bunVersion: "1.4.4" }) }).runner).toBe("bun 1.4.4");
});
