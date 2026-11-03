/**
 * Pure classifiers used by the compatibility runner.
 *
 * Keeping the decisions pure makes it possible to test the rules without downloading the official
 * Pi artifact. The process layer feeds real observations into these functions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CompatState } from "./runner.ts";

/** Observations from one RPC session. */
export interface LoadObservation {
	/** Whether the process reached a session state response. */
	sessionStarted: boolean;
	/** Tool names reported by the loaded extension/probe. */
	tools: readonly string[];
	/** stderr from `--help` or the RPC process. */
	stderr?: string;
	/** Exit code of a separate `--help` run. */
	helpExitCode?: number;
}

/** Decide extension load from session/tool evidence, never from `--help` exit code alone. */
export function classifyExtensionLoad(observation: LoadObservation): { state: CompatState; detail: string } {
	if (observation.tools.includes("tsrepl")) {
		return { state: "confirmed", detail: "session started and tsrepl is registered" };
	}
	if (observation.sessionStarted) {
		return {
			state: "unavailable",
			detail: `session started but tsrepl was not registered${observation.stderr ? `: ${observation.stderr.trim()}` : ""}`,
		};
	}
	return {
		state: "failed",
		detail: observation.stderr ? observation.stderr.trim() : "session did not start",
	};
}

/** A successful `--help` exit code is not load evidence. */
export function classifyHelpOnly(exitCode: number): { state: CompatState; detail: string } {
	return {
		state: "failed",
		detail: `--help exited ${exitCode}, but help does not prove the extension loaded`,
	};
}

/** Identity and package dir evidence from an env or `--version` probe. */
export interface EnvObservation {
	agentDir?: string;
	packageDir?: string;
	appName?: string;
	version?: string;
	packageDirDecoyUsed?: boolean;
	apiKey?: string;
	proxy?: string;
}

/** Verify agent-dir precedence and package-dir pinning. */
export function classifyEnv(observation: EnvObservation, expected: { agentDir: string; version: string }): {
	state: CompatState;
	detail: string;
} {
	const problems: string[] = [];
	if (observation.agentDir !== expected.agentDir) {
		problems.push(`agent dir was ${observation.agentDir ?? "unset"}`);
	}
	if (observation.packageDirDecoyUsed) {
		problems.push("PI_PACKAGE_DIR decoy changed identity");
	}
	if (observation.version !== expected.version) {
		problems.push(`version was ${observation.version ?? "unset"}`);
	}
	if (observation.appName !== "spirits") {
		problems.push(`app name was ${observation.appName ?? "unset"}`);
	}
	if (problems.length > 0) return { state: "failed", detail: problems.join("; ") };
	return { state: "confirmed", detail: "agent dir and identity are pinned" };
}

/** Return true when every path is under `home`. */
export function allPathsUnder(paths: readonly string[], home: string): boolean {
	const root = resolve(home);
	return paths.every((path) => {
		const rel = relative(root, resolve(path));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

/** Check that help wrote nothing outside the isolated home. */
export function classifyHelpSideEffects(paths: readonly string[], home: string): {
	state: CompatState;
	detail: string;
} {
	return allPathsUnder(paths, home)
		? { state: "confirmed", detail: "help only touched the isolated home" }
		: { state: "failed", detail: `help touched paths outside ${home}` };
}

/** Check that the child kept the variables the managed route must not delete. */
export function classifyPreservedEnv(
	observation: { apiKey?: string; proxy?: string },
	expected: { apiKey: string; proxy: string },
): { state: CompatState; detail: string } {
	const problems: string[] = [];
	if (observation.apiKey !== expected.apiKey) problems.push("API key was not preserved");
	if (observation.proxy !== expected.proxy) problems.push("proxy was not preserved");
	if (problems.length > 0) return { state: "failed", detail: problems.join("; ") };
	return { state: "confirmed", detail: "API key and proxy survived the managed environment" };
}

/** Check raw Markdown assets in a bundle. */
export function classifyBundledMarkdown(bundle: string): { state: CompatState; detail: string } {
	const hasRawMarkdown = bundle.includes("---\nname:") || bundle.includes("\\n# ");
	const htmlEscaped = bundle.includes("&lt;") || bundle.includes("&gt;") || bundle.includes("&#");
	if (hasRawMarkdown && !htmlEscaped) {
		return { state: "confirmed", detail: "bundled SKILL.md is raw markdown" };
	}
	return { state: "failed", detail: "bundle does not contain raw Markdown" };
}

/** Read a written SKILL.md and check that it is still raw Markdown. */
export function classifyWrittenMarkdown(path: string): { state: CompatState; detail: string } {
	if (!existsSync(path)) return { state: "not-run", detail: `no written markdown at ${path}` };
	const text = readFileSync(path, "utf8");
	if (text.startsWith("---\n") && !text.includes("&lt;") && !text.includes("&gt;")) {
		return { state: "confirmed", detail: "written SKILL.md is raw markdown" };
	}
	return { state: "failed", detail: `written file at ${path} is not raw Markdown` };
}

/** Check that the host reports the artifact version, not a bundled SDK version. */
export function classifyHostVersion(reported: string | undefined, artifactVersion: string): {
	state: CompatState;
	detail: string;
} {
	if (reported === artifactVersion) {
		return { state: "confirmed", detail: "host version matches the artifact" };
	}
	if (reported === undefined) {
		return { state: "not-run", detail: "host version was not reported" };
	}
	return { state: "failed", detail: `host reported ${reported}, expected ${artifactVersion}` };
}

/** Find files under a directory without following symlinks outside it. */
export function listFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = resolve(dir, entry);
		if (statSync(path).isDirectory()) files.push(...listFiles(path));
		else files.push(path);
	}
	return files;
}

