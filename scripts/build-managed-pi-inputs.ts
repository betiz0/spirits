/**
 * Build the managed Pi extension bundle and its manifest.
 *
 * The bundle keeps the host packages external so the extension uses the managed Pi's SDK instance,
 * and inlines Markdown assets as strings so the official Pi's jiti loader never has to understand
 * `with { type: "text" }`.
 *
 * The version is embedded twice on purpose: as `extension.version` in the manifest, and as the
 * `SPIRITS_VERSION` build-time constant inside the bundle. The bundle is what the managed route
 * loads, so the startup header and the `bundled-skills/<version>/` directory it writes come from the
 * same value the manifest records. Without the define the bundle reports `0.0.0-dev` and writes its
 * skills into a development directory next to the released one.
 *
 * Usage:
 *   bun scripts/build-managed-pi-inputs.ts --version 0.1.0 [--out dist]
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
	MANAGED_PI_EXTENSION_ASSET_NAME,
	MANAGED_PI_FIRST_PI_VERSION,
	MANAGED_PI_MANIFEST_ASSET_NAME,
} from "../packages/spirits/src/constants.ts";
import { firstSupportedManifest, type ManagedManifest } from "../packages/spirits/src/managed-pi/manifest.ts";
import { sha256Hex } from "../packages/spirits/src/managed-pi/overlay.ts";

const ROOT = resolve(import.meta.dir, "..");
const ENTRYPOINT = resolve(ROOT, "packages/spirits/src/index.ts");
const TSCONFIG = resolve(ROOT, "tsconfig.json");
const HOST_EXTERNALS = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

/** Inputs of one build. */
export interface BuildManagedInputsOptions {
	/** spirits version recorded in the manifest. */
	version: string;
	/** Output directory. */
	outDir: string;
}

/** Output paths and manifest produced by a build. */
export interface BuildManagedInputsResult {
	bundlePath: string;
	manifestPath: string;
	manifest: ManagedManifest;
	bundleSha256: string;
}

function parseArg(args: readonly string[], name: string): string | undefined {
	const inline = args.find((arg) => arg.startsWith(`${name}=`));
	if (inline) return inline.slice(name.length + 1);
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	return args[index + 1];
}

/**
 * Check that the define reached the bundle.
 *
 * A define that silently did not apply leaves the bare `SPIRITS_VERSION` identifier behind and the
 * bundle falls back to the development version, so the identifier is the thing being tested for. The
 * version string itself is checked in the same place: a bundle built for another version would
 * otherwise still pass.
 */
export function assertEmbeddedVersion(bundle: string, version: string): void {
	if (bundle.includes("SPIRITS_VERSION")) {
		throw new Error("The bundle still references SPIRITS_VERSION, so the version define was not applied.");
	}
	if (!bundle.includes(JSON.stringify(version))) {
		throw new Error(`The bundle does not embed the version ${version}.`);
	}
}

function readSpiritsVersion(): string {
	const fromEnv = process.env.SPIRITS_VERSION;
	return fromEnv && fromEnv.length > 0 ? fromEnv : "0.0.0";
}

/** Build the bundle and write the manifest plus both checksum files. */
export async function buildManagedInputs(options: BuildManagedInputsOptions): Promise<BuildManagedInputsResult> {
	const outDir = resolve(options.outDir);
	// Replace only the managed inputs. The release workflow writes the compiled binary and theme
	// assets to the same directory, so clearing `outDir` would delete already-built public artifacts.
	await mkdir(outDir, { recursive: true });
	for (const name of [
		MANAGED_PI_EXTENSION_ASSET_NAME,
		MANAGED_PI_MANIFEST_ASSET_NAME,
		`${MANAGED_PI_EXTENSION_ASSET_NAME}.sha256`,
		`${MANAGED_PI_MANIFEST_ASSET_NAME}.sha256`,
	]) {
		await rm(join(outDir, name), { force: true });
	}
	const result = await Bun.build({
		entrypoints: [ENTRYPOINT],
		outdir: outDir,
		naming: MANAGED_PI_EXTENSION_ASSET_NAME,
		target: "bun",
		format: "esm",
		external: HOST_EXTERNALS,
		loader: { ".md": "text" },
		tsconfig: TSCONFIG,
		define: { SPIRITS_VERSION: JSON.stringify(options.version) },
		throw: false,
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log.message);
		throw new Error("The managed extension bundle failed to build.");
	}
	const bundlePath = join(outDir, MANAGED_PI_EXTENSION_ASSET_NAME);
	const bundle = await readFile(bundlePath, "utf8");
	for (const host of HOST_EXTERNALS) {
		if (!bundle.includes(`"${host}"`) && !bundle.includes(`'${host}'`)) {
			throw new Error(`The bundle does not import the host package ${host}; externalization may have failed.`);
		}
	}
	if (bundle.includes('with { type: "text" }')) {
		throw new Error("The bundle still contains a with { type: \"text\" } import.");
	}
	assertEmbeddedVersion(bundle, options.version);
	const bundleSha256 = sha256Hex(bundle);
	const manifest = firstSupportedManifest({
		version: options.version,
		url: MANAGED_PI_EXTENSION_ASSET_NAME,
		sha256: bundleSha256,
	});
	const manifestPath = join(outDir, MANAGED_PI_MANIFEST_ASSET_NAME);
	const manifestText = `${JSON.stringify(manifest, null, "\t")}\n`;
	await Bun.write(manifestPath, manifestText);
	await Bun.write(`${bundlePath}.sha256`, `${bundleSha256}  ${basename(bundlePath)}\n`);
	const manifestSha256 = sha256Hex(manifestText);
	await Bun.write(`${manifestPath}.sha256`, `${manifestSha256}  ${basename(manifestPath)}\n`);
	return { bundlePath, manifestPath, manifest, bundleSha256 };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const version = parseArg(args, "--version") ?? readSpiritsVersion();
	const outDir = parseArg(args, "--out") ?? join(ROOT, "dist");
	const built = await buildManagedInputs({ version, outDir });
	console.log(`Built ${built.bundlePath} (${built.bundleSha256})`);
	console.log(`Pinned Pi ${MANAGED_PI_FIRST_PI_VERSION} in ${built.manifestPath}`);
}
