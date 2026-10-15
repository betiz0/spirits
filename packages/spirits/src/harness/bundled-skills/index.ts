/**
 * Bundled skills: definition, validation, on-disk supply, and `resources_discover` wiring.
 *
 * Bundled Markdown lives under `bundled-skills/<name>/` as real files and is inlined into
 * the compiled binary by Bun's `type: "text"` import (design Decision 2). On every
 * `resources_discover` (startup and `/reload`) the current version tree is written under
 * `<agentDir>/bundled-skills/<version>/` and handed to pi as `skillPaths`. pi merges the
 * returned paths after its default search paths and keeps the first name, so a same-name
 * user skill in `<agentDir>/skills/` wins (design Decision 3).
 *
 * Writes are idempotent (unchanged files are skipped) and atomic (temporary file plus
 * rename). A failure never propagates to the session start and never yields a partial
 * tree to pi: the handler returns no paths (design Decision 6).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	parseFrontmatter,
	type ExtensionAPI,
	type ResourcesDiscoverResult,
} from "@earendil-works/pi-coding-agent";
import { BUNDLED_SKILLS_STALE_AFTER_DAYS } from "../../constants.ts";
import { loadConfig, type EnvLike } from "../../config.ts";
import { resolveSpiritsVersion } from "../../version.ts";
import { bundledSkillsDir, bundledSkillsVersionDir } from "../paths.ts";
import { createBundledSkills } from "./definition.ts";

/** File that identifies a bundled skill directory and carries its frontmatter. */
const SKILL_FILE_NAME = "SKILL.md";

/** Frontmatter keys checked during validation. */
const FRONTMATTER_NAME_KEY = "name";
const FRONTMATTER_DESCRIPTION_KEY = "description";

/** Version directory used when the version cannot be a safe single path segment. */
const FALLBACK_VERSION_DIRECTORY = "dev";

/** Safe version: one non-empty path segment, excluding `.` and `..`. */
const SAFE_VERSION_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._+-]+$/;

/** Suffix for the temporary file renamed over the destination. */
const TEMP_FILE_SUFFIX = ".tmp";

/** Milliseconds in one day, for the stale-version grace period. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One file of a bundled skill. */
export interface BundledSkillFile {
	/** Path relative to the skill directory, with `/` separators. */
	path: string;
	content: string;
}

/** One bundled skill; `name` is both the directory name and the expected frontmatter name. */
export interface BundledSkill {
	name: string;
	files: readonly BundledSkillFile[];
}

export interface WriteBundledSkillsOptions {
	agentDir: string;
	version: string;
	skills: readonly BundledSkill[];
}

export interface RegisterBundledSkillsOptions {
	agentDir: string;
	/** Environment snapshot resolved once at registration. Defaults to `process.env`. */
	env?: EnvLike;
	/** Version to write; defaults to the running spirits version. */
	version?: string;
	/** Definition injection point for tests; defaults to the compiled assets. */
	skills?: readonly BundledSkill[];
}

/** Throw when a bundled skill lacks a SKILL.md, a frontmatter name or description, or a matching directory name. */
export function validateBundledSkills(skills: readonly BundledSkill[]): void {
	for (const skill of skills) {
		const entry = skill.files.find((file) => file.path === SKILL_FILE_NAME);
		if (entry === undefined) {
			throw new Error(`同梱スキル "${skill.name}" に ${SKILL_FILE_NAME} がありません。`);
		}
		const parsed = parseFrontmatter<Record<string, unknown>>(entry.content).frontmatter;
		const name = parsed[FRONTMATTER_NAME_KEY];
		const description = parsed[FRONTMATTER_DESCRIPTION_KEY];
		if (typeof name !== "string" || name.trim() === "") {
			throw new Error(`同梱スキル "${skill.name}" の frontmatter に name がありません。`);
		}
		if (typeof description !== "string" || description.trim() === "") {
			throw new Error(`同梱スキル "${skill.name}" の frontmatter に description がありません。`);
		}
		if (name !== skill.name) {
			throw new Error(
				`同梱スキル "${skill.name}" の frontmatter name "${name}" がディレクトリ名と一致しません。`,
			);
		}
	}
}

/** Resolve the version directory name, replacing unsafe values with `dev`. */
export function resolveBundledSkillsVersion(version: string): string {
	return SAFE_VERSION_PATTERN.test(version) ? version : FALLBACK_VERSION_DIRECTORY;
}

/**
 * Write the current version tree and return its path.
 *
 * Unchanged files keep their bytes and timestamps. The current version directory is
 * touched on every write (even when no file changes) and before any file is written, so
 * a write that fails midway still marks this version as in use for concurrent sessions
 * of other versions. Stale version directories older than `BUNDLED_SKILLS_STALE_AFTER_DAYS`
 * are removed best-effort and never block the write.
 */
export async function writeBundledSkills(options: WriteBundledSkillsOptions): Promise<string> {
	validateBundledSkills(options.skills);
	const version = resolveBundledSkillsVersion(options.version);
	const versionDir = bundledSkillsVersionDir(options.agentDir, version);
	await mkdir(versionDir, { recursive: true });
	const now = new Date();
	await utimes(versionDir, now, now);
	for (const skill of options.skills) {
		for (const file of skill.files) {
			await writeFileIfChanged(path.join(versionDir, skill.name, file.path), file.content);
		}
	}
	await removeStaleVersionDirectories(options.agentDir, version, now);
	return versionDir;
}

/**
 * Register the `resources_discover` handler that supplies the bundled skills.
 *
 * A no-op when `SPIRITS_BUNDLED_SKILLS=0`. The handler writes on every call, so `/reload`
 * picks up the current version without a second wiring path (design Decision 9).
 */
export function registerBundledSkills(pi: ExtensionAPI, options: RegisterBundledSkillsOptions): void {
	const config = loadConfig(options.env ?? process.env);
	const version = options.version ?? resolveSpiritsVersion();
	const skills = options.skills ?? createBundledSkills();
	pi.on("resources_discover", async (): Promise<ResourcesDiscoverResult> => {
		if (!config.bundledSkills.enabled) {
			return {};
		}
		try {
			const versionDir = await writeBundledSkills({ agentDir: options.agentDir, version, skills });
			return { skillPaths: [versionDir] };
		} catch {
			// Skipping the paths keeps a partial tree out of this session and the session start intact.
			return {};
		}
	});
}

/** Write `content` unless the destination already holds exactly the same bytes. */
async function writeFileIfChanged(destination: string, content: string): Promise<void> {
	if (await fileEquals(destination, content)) {
		return;
	}
	await mkdir(path.dirname(destination), { recursive: true });
	const temporary = `${destination}.${randomUUID()}${TEMP_FILE_SUFFIX}`;
	try {
		await writeFile(temporary, content, "utf8");
		await rename(temporary, destination);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

async function fileEquals(file: string, content: string): Promise<boolean> {
	try {
		return (await readFile(file, "utf8")) === content;
	} catch {
		return false;
	}
}

/** Remove non-current version directories last written at least the grace period ago; failures are ignored. */
async function removeStaleVersionDirectories(
	agentDir: string,
	currentVersion: string,
	now: Date,
): Promise<void> {
	const root = bundledSkillsDir(agentDir);
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	const threshold = now.getTime() - BUNDLED_SKILLS_STALE_AFTER_DAYS * MS_PER_DAY;
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === currentVersion) {
			continue;
		}
		const target = path.join(root, entry.name);
		let updatedAt: number;
		try {
			updatedAt = (await stat(target)).mtimeMs;
		} catch {
			continue;
		}
		if (updatedAt > threshold) {
			continue;
		}
		await rm(target, { recursive: true, force: true }).catch(() => {});
	}
}
