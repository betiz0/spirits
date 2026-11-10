/**
 * Check that a built managed bundle carries the release's version.
 *
 * The release workflow builds the binary and the bundle with the same `--version`, and the runtime
 * pairs them: the launcher resolves the managed set from its own embedded version, and the bundle's
 * version decides the header and the `bundled-skills/<version>/` directory. A bundle published under
 * one tag while it embeds another version is not detectable at install time, so the release fails
 * here instead.
 *
 * Usage:
 *   bun scripts/check-managed-pi-bundle-version.ts \
 *     --bundle dist/spirits-managed-pi-extension.js \
 *     --manifest dist/spirits-managed-pi-manifest.json \
 *     --version 0.7.0
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseManagedManifest } from "../packages/spirits/src/managed-pi/manifest.ts";
import { assertEmbeddedVersion } from "./build-managed-pi-inputs.ts";

function parseArg(args: readonly string[], name: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${name}=`));
	if (inline) return inline.slice(name.length + 1);
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	return args[index + 1];
}

/** One check's outcome. */
export interface BundleVersionCheck {
	ok: boolean;
	reasons: string[];
}

/** Compare a built bundle and its manifest against the version the release is publishing. */
export function checkManagedBundleVersion(
	bundle: string,
	manifestValue: unknown,
	version: string,
): BundleVersionCheck {
	const reasons: string[] = [];
	let manifest;
	try {
		manifest = parseManagedManifest(manifestValue);
	} catch (error) {
		reasons.push(error instanceof Error ? error.message : String(error));
	}
	if (manifest !== undefined && manifest.extension.version !== version) {
		reasons.push(
			`the manifest records extension version ${manifest.extension.version}, not ${version}`,
		);
	}
	try {
		assertEmbeddedVersion(bundle, version);
	} catch (error) {
		reasons.push(error instanceof Error ? error.message : String(error));
	}
	return { ok: reasons.length === 0, reasons };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const bundlePath = parseArg(args, "--bundle");
	const manifestPath = parseArg(args, "--manifest");
	const version = parseArg(args, "--version");
	if (!bundlePath || !manifestPath || !version) {
		console.error(
			"Usage: bun scripts/check-managed-pi-bundle-version.ts --bundle <bundle.js> --manifest <manifest.json> --version <version>",
		);
		process.exit(2);
	}
	const bundle = await readFile(resolve(bundlePath), "utf8");
	const manifestValue: unknown = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
	const result = checkManagedBundleVersion(bundle, manifestValue, version);
	if (!result.ok) {
		for (const reason of result.reasons) console.error(`Managed bundle version check failed: ${reason}`);
		process.exit(1);
	}
	console.log(`Managed bundle embeds version ${version}.`);
}
