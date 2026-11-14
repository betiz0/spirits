import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MANAGED_PI_EXTENSION_ASSET_NAME,
	MANAGED_PI_MANIFEST_ASSET_NAME,
	RELEASE_ARTIFACT_NAME,
	THEME_ASSET_NAMES,
} from "../src/constants.ts";
import { firstSupportedManifest } from "../src/managed-pi/manifest.ts";
import { sha256Hex } from "../src/managed-pi/overlay.ts";
import { buildManagedInputs } from "../../../scripts/build-managed-pi-inputs.ts";
import { checkManagedBundleVersion } from "../../../scripts/check-managed-pi-bundle-version.ts";

test("build inputs include manifest and bundle checksums", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-build-"));
	try {
		const result = await buildManagedInputs({ version: "9.9.9", outDir: dir });
		expect(result.bundlePath).toBe(join(dir, MANAGED_PI_EXTENSION_ASSET_NAME));
		expect(result.manifestPath).toBe(join(dir, MANAGED_PI_MANIFEST_ASSET_NAME));
		expect(result.manifest.extension.artifact.sha256).toBe(sha256Hex(await readFile(result.bundlePath, "utf8")));
		expect(await readFile(`${result.manifestPath}.sha256`, "utf8")).toContain(MANAGED_PI_MANIFEST_ASSET_NAME);
		expect(await readFile(`${result.bundlePath}.sha256`, "utf8")).toContain(MANAGED_PI_EXTENSION_ASSET_NAME);
		const bundle = await readFile(result.bundlePath, "utf8");
		for (const host of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
			expect(bundle).toContain(host);
		}
		expect(bundle).not.toContain('with { type: "text" }');
		expect(bundle).toContain("sprt-architecture-guards");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 30_000);

// The panel imports `SettingsList` and `SelectList` from pi-tui. The managed Pi already loaded both,
// and a bundle that carried its own copy would draw a list whose theme and key handling belong to a
// different module instance than the host's. Externalizing is what keeps them the same instance, and a
// bundler quietly succeeding at inlining is the failure this guards.
test("keeps pi-tui external", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-build-tui-"));
	try {
		const result = await buildManagedInputs({ version: "9.9.9", outDir: dir });
		const bundle = await readFile(result.bundlePath, "utf8");

		// The host package is named as an import rather than a bundled module.
		expect(bundle).toContain('"@earendil-works/pi-tui"');
		// pi-tui's own implementation is not inlined: its widget classes are the host's, not ours.
		expect(bundle).not.toContain("class SettingsList");
		expect(bundle).not.toContain("class SelectList");
		// The names the bundle pulls in are the ones the panel calls.
		expect(bundle).toContain("SettingsList");
		expect(bundle).toContain("SelectList");
		// The same holds for the host package that owns the list themes.
		expect(bundle).not.toContain("getSettingsListTheme() {");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 60_000);

test("the bundle embeds the version the manifest records", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-build-version-"));
	try {
		const result = await buildManagedInputs({ version: "9.9.9-test", outDir: dir });
		const bundle = await readFile(result.bundlePath, "utf8");
		expect(result.manifest.extension.version).toBe("9.9.9-test");
		// A define that did not apply leaves the bare identifier behind and the bundle falls back to
		// `0.0.0-dev`, which would name the bundled-skills directory after a development build.
		expect(bundle).not.toContain("SPIRITS_VERSION");
		expect(bundle).not.toContain("0.0.0-dev");
		expect(bundle).toContain('"9.9.9-test"');
		expect(checkManagedBundleVersion(bundle, JSON.parse(await readFile(result.manifestPath, "utf8")), "9.9.9-test").ok).toBe(
			true,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 30_000);

test("the version check rejects a bundle built for another version", () => {
	const bundle = `const version = "0.7.0"; export const line = () => version;`;
	const manifest = firstSupportedManifest({
		version: "0.7.0",
		url: "spirits-managed-pi-extension.js",
		sha256: "0".repeat(64),
	});
	expect(checkManagedBundleVersion(bundle, manifest, "0.7.0").ok).toBe(true);
	const mismatch = checkManagedBundleVersion(bundle, manifest, "0.8.0");
	expect(mismatch.ok).toBe(false);
	expect(mismatch.reasons.join("\n")).toContain("0.8.0");
	// The identifier surviving means the define was never applied.
	const undefine = checkManagedBundleVersion(
		'const v = SPIRITS_VERSION ?? "0.0.0-dev";',
		{ ...manifest, extension: { ...manifest.extension, version: "0.8.0" } },
		"0.7.0",
	);
	expect(undefine.ok).toBe(false);
	expect(undefine.reasons.join("\n")).toContain("SPIRITS_VERSION");
});

test("existing binary outputs are unchanged", () => {
	expect(RELEASE_ARTIFACT_NAME).toBe("spirits-linux-x64");
	expect(THEME_ASSET_NAMES).toEqual(["dark.json", "light.json"]);
});

test("build inputs preserve existing release assets", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-build-preserve-"));
	try {
		await mkdir(join(dir, "theme"), { recursive: true });
		await writeFile(join(dir, RELEASE_ARTIFACT_NAME), "compiled-binary");
		await writeFile(join(dir, "theme", "dark.json"), "{}");
		await writeFile(join(dir, "theme", "light.json"), "{}");
		await buildManagedInputs({ version: "9.9.9", outDir: dir });
		expect(await readFile(join(dir, RELEASE_ARTIFACT_NAME), "utf8")).toBe("compiled-binary");
		expect(await readFile(join(dir, "theme", "dark.json"), "utf8")).toBe("{}");
		expect(await readFile(join(dir, "theme", "light.json"), "utf8")).toBe("{}");
		expect(await Bun.file(join(dir, MANAGED_PI_EXTENSION_ASSET_NAME)).exists()).toBe(true);
		expect(await Bun.file(join(dir, MANAGED_PI_MANIFEST_ASSET_NAME)).exists()).toBe(true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 30_000);

test("release workflow attaches the managed inputs without dropping defaults", async () => {
	const workflow = await readFile("../../.github/workflows/spirits-release.yml", "utf8");
	for (const artifact of [MANAGED_PI_EXTENSION_ASSET_NAME, MANAGED_PI_MANIFEST_ASSET_NAME, RELEASE_ARTIFACT_NAME]) {
		expect(workflow).toContain(`dist/${artifact}`);
	}
	expect(workflow).toContain("dist/theme/dark.json");
	expect(workflow).toContain("dist/theme/light.json");
	expect(workflow).toContain("bun scripts/build-managed-pi-inputs.ts");
	expect(workflow).toContain("bun scripts/check-managed-pi-bundle-version.ts");
	expect(workflow).toContain('--version "${GITHUB_REF_NAME#spirits-v}"');
});
