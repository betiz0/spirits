/**
 * Build the spirits linux-x64 single-file binary and its SHA256 checksum.
 *
 * The binary is a launcher. It carries no host sources and no host packages: it starts the managed
 * host installed under `~/.spirits/managed-pi` and passes that host the extension bundle. Nothing
 * here reads the fork's sources, so the build stays valid after they leave the repository.
 *
 * The build also writes the theme assets a *previous* release's `spirits update` downloads before it
 * replaces its binary (design D8). This release's launcher, installer and self-update read neither
 * asset, and the release keeps attaching them only so existing users can update.
 *
 * Usage:
 *   bun scripts/build-binaries.ts --version 0.1.0
 *
 * Version resolution order: `--version <value>` (or `--version=<value>`), `SPIRITS_VERSION`, then
 * `git describe --tags --match 'spirits-v*'`.
 */

import { copyFile, mkdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { THEME_ASSET_NAMES, THEME_ASSETS_DIR_NAME } from "../packages/spirits/src/constants.ts";

/** Repository root. */
const ROOT = resolve(import.meta.dir, "..");

/** Compile target; only linux-x64 ships (design Decision 6). */
const COMPILE_TARGET = "bun-linux-x64";

/** Output directory and file name. `.gitignore` excludes dist/. */
const DIST_DIR = resolve(ROOT, "dist");
const OUTFILE = resolve(DIST_DIR, "spirits-linux-x64");

/**
 * The only entrypoint. The launcher imports neither the host package nor a worker: pi runs the
 * extension in its own process, so there is nothing else to bundle.
 */
const ENTRYPOINTS = [resolve(ROOT, "packages/spirits/bin/spirits.ts")];

/**
 * The pinned copy of pi's built-in themes, and the directory they are published in next to the
 * binary. `scripts/compat-theme/` holds the copy so the release keeps working after the fork's
 * source tree is gone; the values are compared against the `spirits-fork-final` tag by the change's
 * gates.
 */
const THEME_SOURCE_DIR = resolve(ROOT, "scripts/compat-theme");
const THEME_DIST_DIR = resolve(DIST_DIR, THEME_ASSETS_DIR_NAME);

/** Git tag prefix for spirits releases. */
const GIT_TAG_PREFIX = "spirits-v";
const GIT_TAG_PATTERN = `${GIT_TAG_PREFIX}*`;

/** Trailing `-<commits>-g<sha>` appended by `git describe` for non-tag commits. */
const GIT_DESCRIBE_DISTANCE_SUFFIX = /-\d+-g[0-9a-f]+$/;

function parseVersionArg(args: readonly string[]): string | undefined {
	const inline = args.find((arg) => arg.startsWith("--version="));
	if (inline !== undefined) {
		const value = inline.slice("--version=".length);
		if (!value) throw new Error("--version requires a value");
		return value;
	}
	const index = args.indexOf("--version");
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error("--version requires a value");
	return value;
}

function describeFromGit(): string {
	const proc = Bun.spawnSync({
		cmd: ["git", "describe", "--tags", "--match", GIT_TAG_PATTERN],
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error("Cannot determine version: pass --version, set SPIRITS_VERSION, or create a spirits-v* tag");
	}
	const described = proc.stdout.toString().trim();
	if (!described.startsWith(GIT_TAG_PREFIX)) {
		throw new Error(`Unexpected git describe output: ${described}`);
	}
	return described.slice(GIT_TAG_PREFIX.length).replace(GIT_DESCRIBE_DISTANCE_SUFFIX, "");
}

function resolveVersion(): string {
	const fromArg = parseVersionArg(process.argv.slice(2));
	if (fromArg !== undefined) return fromArg;
	const fromEnv = process.env.SPIRITS_VERSION;
	if (fromEnv) return fromEnv;
	return describeFromGit();
}

async function buildBinary(version: string): Promise<void> {
	const result = await Bun.build({
		entrypoints: ENTRYPOINTS,
		define: { SPIRITS_VERSION: JSON.stringify(version) },
		compile: {
			target: COMPILE_TARGET,
			outfile: OUTFILE,
			autoloadBunfig: false,
			autoloadDotenv: false,
		},
		throw: false,
	});
	if (!result.success) {
		for (const log of result.logs) {
			console.error(log.message);
		}
		throw new Error("Bun.build failed");
	}
}

async function writeChecksum(path: string): Promise<void> {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(await Bun.file(path).arrayBuffer());
	const line = `${hasher.digest("hex")}  ${basename(path)}\n`;
	await Bun.write(`${path}.sha256`, line);
}

/** Copy the compatibility theme assets and write each checksum, replacing stale files from earlier builds. */
async function writeThemeAssets(): Promise<void> {
	await rm(THEME_DIST_DIR, { recursive: true, force: true });
	await mkdir(THEME_DIST_DIR, { recursive: true });
	for (const name of THEME_ASSET_NAMES) {
		const destination = resolve(THEME_DIST_DIR, name);
		await copyFile(resolve(THEME_SOURCE_DIR, name), destination);
		await writeChecksum(destination);
	}
}

async function main(): Promise<void> {
	const version = resolveVersion();
	console.log(`Building ${basename(OUTFILE)} (spirits ${version})`);
	await buildBinary(version);
	await writeChecksum(OUTFILE);
	await writeThemeAssets();
	console.log(`Built ${OUTFILE} and ${OUTFILE}.sha256`);
	console.log(`Copied compatibility theme assets to ${THEME_DIST_DIR}`);
}

await main();
