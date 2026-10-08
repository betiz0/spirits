/**
 * Build the spirits linux-x64 single-file binary and its SHA256 checksum.
 *
 * Usage:
 *   bun scripts/build-binaries.ts --version 0.1.0
 *
 * Version resolution order: `--version <value>` (or `--version=<value>`), `SPIRITS_VERSION`, then
 * `git describe --tags --match 'spirits-v*'`.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { replacePiVersion } from "./replace-pi-version.ts";

/** Repository root. */
const ROOT = resolve(import.meta.dir, "..");

/** Compile target; only linux-x64 ships (design Decision 6). */
const COMPILE_TARGET = "bun-linux-x64";

/** Output directory and file name. `.gitignore` excludes dist/. */
const DIST_DIR = resolve(ROOT, "dist");
const OUTFILE = resolve(DIST_DIR, "spirits-linux-x64");

/** Extra entrypoints bundled into the executable (workers resolved at runtime). */
const ENTRYPOINTS = [
	resolve(ROOT, "packages/spirits/bin/spirits.ts"),
	resolve(ROOT, "packages/coding-agent/src/utils/image-resize-worker.ts"),
	resolve(ROOT, "packages/coding-agent/src/extensions/codemode/worker.ts"),
];

/** Root tsconfig whose `paths` resolve pi workspace source (design Decision 1, candidate a). */
const TSCONFIG = resolve(ROOT, "tsconfig.json");

/** pi's config module and package manifest used for VERSION replacement. */
const PI_CONFIG_PATH = resolve(ROOT, "packages/coding-agent/src/config.ts");
const PI_PACKAGE_JSON_PATH = resolve(ROOT, "packages/coding-agent/package.json");

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
		throw new Error(
			"Cannot determine version: pass --version, set SPIRITS_VERSION, or create a spirits-v* tag",
		);
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

function readPiVersion(): string {
	const manifest = JSON.parse(readFileSync(PI_PACKAGE_JSON_PATH, "utf8")) as { version?: string };
	if (!manifest.version) {
		throw new Error(`${PI_PACKAGE_JSON_PATH} has no version`);
	}
	return manifest.version;
}

async function buildBinary(version: string, piVersion: string): Promise<void> {
	const result = await Bun.build({
		entrypoints: ENTRYPOINTS,
		tsconfig: TSCONFIG,
		define: { SPIRITS_VERSION: JSON.stringify(version) },
		plugins: [
			{
				name: "replace-pi-version",
				setup(build) {
					build.onLoad({ filter: /[\\/]coding-agent[\\/]src[\\/]config\.ts$/ }, (args) => ({
						contents: replacePiVersion(readFileSync(args.path, "utf8"), piVersion),
						loader: "ts",
					}));
				},
			},
		],
		compile: {
			target: COMPILE_TARGET,
			outfile: OUTFILE,
			autoloadBunfig: false,
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

async function writeChecksum(): Promise<void> {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(await Bun.file(OUTFILE).arrayBuffer());
	const line = `${hasher.digest("hex")}  ${basename(OUTFILE)}\n`;
	await Bun.write(`${OUTFILE}.sha256`, line);
}

async function main(): Promise<void> {
	const version = resolveVersion();
	const piVersion = readPiVersion();
	console.log(`Building ${basename(OUTFILE)} (spirits ${version}, pi ${piVersion})`);
	await buildBinary(version, piVersion);
	await writeChecksum();
	console.log(`Built ${OUTFILE} and ${OUTFILE}.sha256`);
}

await main();
