/**
 * Launch builders for the two hosts under test.
 *
 * The fork host is the compiled `spirits` binary with the extension already inside it. The managed
 * host is the official Pi executable from the verified artifact, with the overlay `package.json`
 * applied and the spirits extension bundle loaded through `-e`. Both get an isolated HOME, the same
 * XDG pinning, and no inherited agent-dir variables.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeManagedEnv } from "../../packages/spirits/src/managed-pi/environment.ts";
import { sha256Hex, writeOverlayPackage } from "../../packages/spirits/src/managed-pi/overlay.ts";
import {
	buildOfficialIdentity,
	createOfficialLaunchVerifier,
	loadOfficialArtifact,
	type OfficialArtifact,
	type OfficialIdentity,
} from "../managed-pi-compat/official.ts";

/** The probe extension loaded into both hosts. */
export const PROBE_EXTENSION = join(import.meta.dirname, "probe-extension.ts");

/** Where the probe writes. */
export interface ProbePaths {
	dump: string;
	systemPrompt: string;
}

/** A host launch: command plus the exact environment it runs with. */
export interface HostLaunch {
	host: "fork" | "managed";
	label: string;
	command: string[];
	env: Record<string, string | undefined>;
	/** Where this launch's probe writes its dump and its system-prompt records. */
	probe: ProbePaths;
	/** Re-checked before the process starts; the managed host re-verifies its executable digest. */
	verify: () => Promise<void>;
}

/** Environment shared by both hosts: isolated HOME, no version checks, no telemetry. */
export function baseEnv(home: string, extra: Record<string, string | undefined>): Record<string, string | undefined> {
	return {
		PATH: process.env.PATH,
		HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_STATE_HOME: join(home, ".local", "state"),
		PI_SKIP_VERSION_CHECK: "1",
		PI_TELEMETRY: "0",
		// Nothing may reach a real provider endpoint.
		ANTHROPIC_API_KEY: undefined,
		OPENAI_API_KEY: undefined,
		...extra,
	};
}

/** Environment entries the probe extension reads. */
export function probeEnv(paths: ProbePaths, markers: readonly string[], fakeUrl: string): Record<string, string> {
	return {
		ADC_DUMP: paths.dump,
		ADC_SYSTEM_PROMPT: paths.systemPrompt,
		ADC_MARKERS: markers.join(","),
		ADC_FAKE_URL: fakeUrl,
	};
}

/** Fork launch: compiled `spirits` binary, RPC mode, probe extension only. */
export function forkLaunch(input: {
	binary: string;
	home: string;
	agentDir: string;
	probe: ProbePaths;
	markers: readonly string[];
	fakeUrl: string;
	extraExtensions?: readonly string[];
}): HostLaunch {
	const env = baseEnv(input.home, {
		SPIRITS_CODING_AGENT_DIR: input.agentDir,
		SPIRITS_CODING_AGENT_SESSION_DIR: join(input.agentDir, "sessions"),
		...probeEnv(input.probe, input.markers, input.fakeUrl),
	});
	return {
		host: "fork",
		label: "fork",
		probe: input.probe,
		command: [
			input.binary,
			"--mode",
			"rpc",
			...(input.extraExtensions ?? []).flatMap((path) => ["-e", path]),
			"-e",
			PROBE_EXTENSION,
		],
		env,
		verify: async () => {},
	};
}

/** Managed launch: official Pi executable plus the spirits bundle, with the pinned agent dir. */
export function managedLaunch(input: {
	artifact: OfficialArtifact;
	bundle: string;
	home: string;
	agentDir: string;
	probe: ProbePaths;
	markers: readonly string[];
	fakeUrl: string;
	/**
	 * Session directory to pin. The isolated managed route pins `<agent dir>/sessions`; the default
	 * route leaves it unset so Pi keeps its own layout under the agent directory. Pass `undefined`
	 * for the default route and the measurement sees what the default launch actually computes.
	 */
	sessionDir?: string;
}): HostLaunch {
	const env = computeManagedEnv({
		env: baseEnv(input.home, probeEnv(input.probe, input.markers, input.fakeUrl)),
		agentDir: input.agentDir,
		packageDir: input.artifact.packageDir,
		...(input.sessionDir !== undefined ? { sessionDir: input.sessionDir } : {}),
	});
	return {
		host: "managed",
		label: "managed",
		probe: input.probe,
		command: [input.artifact.executablePath, "--mode", "rpc", "-e", PROBE_EXTENSION, "-e", input.bundle],
		env,
		verify: createOfficialLaunchVerifier(input.artifact),
	};
}

/** The same host's one-shot settings write: `<host> install <local package dir>`. */
export function settingsWriteCommand(launch: HostLaunch, localPackageDir: string): string[] {
	const command = [...launch.command];
	// Drop `--mode rpc` and the extension arguments: `install` is a CLI subcommand of the same binary.
	const binary = command[0] as string;
	return [binary, "install", localPackageDir];
}

/** A local pi package with no network fetch, used to trigger a real settings write. */
export async function createLocalPackage(dir: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "package.json"),
		`${JSON.stringify({ name: "adc-local-pkg", version: "1.0.0", description: "compat probe package", pi: { extensions: ["./ext.ts"] } }, null, "\t")}\n`,
	);
	await writeFile(
		join(dir, "ext.ts"),
		"export default function adcLocalPkg(pi: { registerCommand: (name: string, options: unknown) => void }): void {\n\tvoid pi;\n}\n",
	);
	return dir;
}

/** Verified inputs for one run, with every digest the evidence has to name. */
export interface HostInputs {
	forkBinary: string;
	forkSha256: string;
	forkVersion: string;
	bundle: string;
	bundleSha256: string;
	artifact: OfficialArtifact;
	identity: OfficialIdentity;
}

async function fileSha256(path: string): Promise<string> {
	return sha256Hex(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

/** Verify the artifact against the product trust root and collect the digests of every input. */
export async function prepareInputs(input: {
	forkBinary: string;
	artifactRoot: string;
	bundle: string;
	workRoot: string;
	commit: string;
	workingTreeClean: boolean;
}): Promise<HostInputs> {
	const forkFile = Bun.file(input.forkBinary);
	if (!(await forkFile.exists())) throw new Error(`fork binary not found: ${input.forkBinary}`);
	const forkSha256 = await fileSha256(input.forkBinary);
	const versionRun = Bun.spawn({ cmd: [input.forkBinary, "--version"], stdout: "pipe", stderr: "pipe", env: {} });
	const forkVersion = (await new Response(versionRun.stdout).text()).trim();
	const artifact = await loadOfficialArtifact({ artifactRoot: input.artifactRoot, workRoot: input.workRoot });
	await writeOverlayPackage(artifact.packageDir, artifact.manifest.overlay.sha256);
	const bundleSha256 = await fileSha256(input.bundle);
	const identity = buildOfficialIdentity({
		manifest: artifact.manifest,
		manifestSha256: artifact.manifestSha256,
		artifactSha256: artifact.artifactSha256,
		executableSha256: artifact.executableSha256,
		bundleSha256,
		bundleVersion: artifact.manifest.extension.version,
		targetCommit: input.commit,
		workingTreeClean: input.workingTreeClean,
	});
	return {
		forkBinary: input.forkBinary,
		forkSha256,
		forkVersion,
		bundle: input.bundle,
		bundleSha256,
		artifact,
		identity,
	};
}
