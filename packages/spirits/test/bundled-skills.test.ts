import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ResourcesDiscoverResult } from "@earendil-works/pi-coding-agent";
import { createBundledSkills } from "../src/harness/bundled-skills/definition.ts";
import {
	registerBundledSkills,
	resolveBundledSkillsVersion,
	validateBundledSkills,
	writeBundledSkills,
	type BundledSkill,
} from "../src/harness/bundled-skills/index.ts";
import { bundledSkillsDir, bundledSkillsVersionDir, skillsDir } from "../src/harness/paths.ts";
import { formatSkillsForPrompt, loadSkills } from "./pi-runtime/load-skills.ts";

const FIXTURE_SKILL: BundledSkill = {
	name: "fixture-skill",
	files: [
		{
			path: "SKILL.md",
			content: "---\nname: fixture-skill\ndescription: fixture description\n---\n\nfixture body\n",
		},
		{ path: "references/extra.md", content: "extra reference\n" },
	],
};

type ResourcesHandler = () => Promise<ResourcesDiscoverResult | void> | ResourcesDiscoverResult | void;

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-bundled-skills-"));
}

async function exists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

function captureResourcesHandlers(
	agentDir: string,
	options: { env?: Readonly<Record<string, string | undefined>>; version?: string; skills?: readonly BundledSkill[] } = {},
): ResourcesHandler[] {
	const handlers: ResourcesHandler[] = [];
	const pi = {
		on(event: string, handler: unknown): () => void {
			if (event === "resources_discover") {
				handlers.push(handler as ResourcesHandler);
			}
			return () => {};
		},
	} as unknown as ExtensionAPI;
	registerBundledSkills(pi, { agentDir, ...options });
	return handlers;
}

/** Return the compiled definition files keyed by their skill-relative path. */
function definitionFiles(): Map<string, string> {
	const skill = createBundledSkills().find((candidate) => candidate.name === "sprt-architecture-guards");
	expect(skill).toBeDefined();
	return new Map((skill?.files ?? []).map((file) => [file.path, file.content]));
}

test("bundled skill frontmatter is valid", () => {
	expect(() => validateBundledSkills([FIXTURE_SKILL])).not.toThrow();
	expect(() => validateBundledSkills(createBundledSkills())).not.toThrow();

	expect(() => validateBundledSkills([{ name: "no-file", files: [] }])).toThrow();
	expect(() =>
		validateBundledSkills([
			{ name: "no-name", files: [{ path: "SKILL.md", content: "---\ndescription: x\n---\n\nbody\n" }] },
		]),
	).toThrow();
	expect(() =>
		validateBundledSkills([
			{ name: "no-description", files: [{ path: "SKILL.md", content: "---\nname: no-description\n---\n\nbody\n" }] },
		]),
	).toThrow();
	expect(() =>
		validateBundledSkills([
			{
				name: "directory-name",
				files: [
					{ path: "SKILL.md", content: "---\nname: other-name\ndescription: x\n---\n\nbody\n" },
				],
			},
		]),
	).toThrow();
});

test("writes bundled skill files under the version directory", async () => {
	const agentDir = await makeAgentDir();
	const versionDir = await writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] });
	expect(versionDir).toBe(bundledSkillsVersionDir(agentDir, "1.2.3"));
	expect(await readFile(path.join(versionDir, "fixture-skill", "SKILL.md"), "utf8")).toBe(
		FIXTURE_SKILL.files[0]?.content,
	);
	expect(await readFile(path.join(versionDir, "fixture-skill", "references", "extra.md"), "utf8")).toBe(
		"extra reference\n",
	);
	// The bundled tree must stay out of the user skills directory (verify2 W-3).
	expect(await exists(path.join(skillsDir(agentDir), "fixture-skill"))).toBe(false);
});

test("does not rewrite identical files", async () => {
	const agentDir = await makeAgentDir();
	const versionDir = await writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] });
	const file = path.join(versionDir, "fixture-skill", "SKILL.md");
	const past = new Date(1_000_000_000_000);
	await utimes(file, past, past);

	await writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] });

	expect((await stat(file)).mtimeMs).toBe(past.getTime());
	expect(await readFile(file, "utf8")).toBe(FIXTURE_SKILL.files[0]?.content);
});

test("removes stale version directories", async () => {
	const agentDir = await makeAgentDir();
	const stale = bundledSkillsVersionDir(agentDir, "0.0.1");
	await mkdir(path.join(stale, "old-skill"), { recursive: true });
	await writeFile(path.join(stale, "old-skill", "SKILL.md"), "old\n");
	const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
	await utimes(stale, eightDaysAgo, eightDaysAgo);

	await writeBundledSkills({ agentDir, version: "0.0.2", skills: [FIXTURE_SKILL] });

	expect(await readdir(bundledSkillsDir(agentDir))).toEqual(["0.0.2"]);
	expect(await exists(stale)).toBe(false);
});

test("keeps recently used version directories", async () => {
	const agentDir = await makeAgentDir();
	const recent = bundledSkillsVersionDir(agentDir, "0.0.1");
	await mkdir(path.join(recent, "old-skill"), { recursive: true });
	await writeFile(path.join(recent, "old-skill", "SKILL.md"), "old\n");

	// The tree was just written, so a concurrent session of that version must survive.
	await writeBundledSkills({ agentDir, version: "0.0.2", skills: [FIXTURE_SKILL] });

	expect(await exists(path.join(recent, "old-skill", "SKILL.md"))).toBe(true);
});

test("touches the current version directory on every write", async () => {
	const agentDir = await makeAgentDir();
	const versionDir = await writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] });
	const past = new Date(1_000_000_000_000);
	await utimes(versionDir, past, past);

	// Identical content: no file is rewritten, but the directory mtime must advance.
	await writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] });

	expect((await stat(versionDir)).mtimeMs).toBeGreaterThan(past.getTime());
});

test("touches the current version directory before writing files", async () => {
	const agentDir = await makeAgentDir();
	const versionDir = bundledSkillsVersionDir(agentDir, "1.2.3");
	await mkdir(versionDir, { recursive: true });
	// A file where the skill directory must be created makes the write fail.
	await writeFile(path.join(versionDir, "fixture-skill"), "blocked\n");
	const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
	await utimes(versionDir, eightDaysAgo, eightDaysAgo);

	await expect(writeBundledSkills({ agentDir, version: "1.2.3", skills: [FIXTURE_SKILL] })).rejects.toThrow();

	expect((await stat(versionDir)).mtimeMs).toBeGreaterThan(eightDaysAgo.getTime());
});

test("sanitizes unsafe version strings", async () => {
	for (const version of ["0.1/0", "..", ".", "", "a b"]) {
		expect(resolveBundledSkillsVersion(version)).toBe("dev");
		const agentDir = await makeAgentDir();
		const versionDir = await writeBundledSkills({ agentDir, version, skills: [FIXTURE_SKILL] });
		expect(versionDir).toBe(bundledSkillsVersionDir(agentDir, "dev"));
		// Nothing may be created outside the version directory (e.g. via `..`).
		expect(await exists(path.join(agentDir, "fixture-skill"))).toBe(false);
		expect(await exists(path.join(bundledSkillsDir(agentDir), "fixture-skill"))).toBe(false);
		expect(await exists(path.join(versionDir, "fixture-skill", "SKILL.md"))).toBe(true);
	}
	expect(resolveBundledSkillsVersion("1.2.3")).toBe("1.2.3");
	expect(resolveBundledSkillsVersion("0.0.0-dev")).toBe("0.0.0-dev");
	expect(resolveBundledSkillsVersion("1.0.0+build.5")).toBe("1.0.0+build.5");
});

test("disabled by SPIRITS_BUNDLED_SKILLS=0 writes nothing and returns no paths", async () => {
	const agentDir = await makeAgentDir();
	const handlers = captureResourcesHandlers(agentDir, {
		env: { SPIRITS_BUNDLED_SKILLS: "0" },
		version: "9.9.9",
		skills: [FIXTURE_SKILL],
	});
	expect(handlers).toHaveLength(1);
	expect(await handlers[0]?.()).toEqual({});
	expect(await exists(bundledSkillsDir(agentDir))).toBe(false);
});

test("returns the current version directory as a skill path", async () => {
	const agentDir = await makeAgentDir();
	const handlers = captureResourcesHandlers(agentDir, { env: {}, version: "9.9.9", skills: [FIXTURE_SKILL] });
	expect(handlers).toHaveLength(1);
	const result = await handlers[0]?.();
	expect(result).toEqual({ skillPaths: [bundledSkillsVersionDir(agentDir, "9.9.9")] });
	expect(await exists(path.join(bundledSkillsVersionDir(agentDir, "9.9.9"), "fixture-skill", "SKILL.md"))).toBe(
		true,
	);
});

test("returns no skill paths when writing fails", async () => {
	const agentDir = await makeAgentDir();
	// A file where the bundled root directory must be created makes every write fail.
	await writeFile(path.join(agentDir, "bundled-skills"), "not a directory\n");
	const handlers = captureResourcesHandlers(agentDir, { env: {}, version: "9.9.9", skills: [FIXTURE_SKILL] });
	expect(handlers).toHaveLength(1);
	expect(await handlers[0]?.()).toEqual({});
});

test("keeps serving the current version when stale removal fails", async () => {
	const agentDir = await makeAgentDir();
	const stale = bundledSkillsVersionDir(agentDir, "0.0.1");
	await mkdir(path.join(stale, "old-skill"), { recursive: true });
	await writeFile(path.join(stale, "old-skill", "SKILL.md"), "old\n");
	const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
	await utimes(stale, eightDaysAgo, eightDaysAgo);
	// Read-only directory: removing its contents fails for a non-root user (verify2 W-3).
	await chmod(stale, 0o500);
	try {
		const handlers = captureResourcesHandlers(agentDir, { env: {}, version: "9.9.9", skills: [FIXTURE_SKILL] });
		expect(handlers).toHaveLength(1);
		const result = await handlers[0]?.();
		expect(result).toEqual({ skillPaths: [bundledSkillsVersionDir(agentDir, "9.9.9")] });
		expect(await exists(stale)).toBe(true);
	} finally {
		await chmod(stale, 0o700).catch(() => {});
	}
});

test("sprt-architecture-guards is hidden from the model-facing skill list", async () => {
	const agentDir = await makeAgentDir();
	await writeBundledSkills({ agentDir, version: "1.0.0", skills: createBundledSkills() });
	const result = loadSkills({
		cwd: agentDir,
		agentDir,
		skillPaths: [bundledSkillsVersionDir(agentDir, "1.0.0")],
		includeDefaults: false,
	});
	const skill = result.skills.find((candidate) => candidate.name === "sprt-architecture-guards");
	expect(skill).toBeDefined();
	expect(skill?.disableModelInvocation).toBe(true);
	expect(formatSkillsForPrompt(result.skills)).not.toContain("sprt-architecture-guards");
});

test("sprt-opsx-verify-deep is hidden from the model-facing skill list", async () => {
	const agentDir = await makeAgentDir();
	await writeBundledSkills({ agentDir, version: "1.0.0", skills: createBundledSkills() });
	const result = loadSkills({
		cwd: agentDir,
		agentDir,
		skillPaths: [bundledSkillsVersionDir(agentDir, "1.0.0")],
		includeDefaults: false,
	});
	const skill = result.skills.find((candidate) => candidate.name === "sprt-opsx-verify-deep");
	expect(skill).toBeDefined();
	expect(skill?.disableModelInvocation).toBe(true);
	expect(formatSkillsForPrompt(result.skills)).not.toContain("sprt-opsx-verify-deep");
});

test("sprt-opsx-review-change is visible in the model-facing skill list", async () => {
	const agentDir = await makeAgentDir();
	await writeBundledSkills({ agentDir, version: "1.0.0", skills: createBundledSkills() });
	const result = loadSkills({
		cwd: agentDir,
		agentDir,
		skillPaths: [bundledSkillsVersionDir(agentDir, "1.0.0")],
		includeDefaults: false,
	});
	const skill = result.skills.find((candidate) => candidate.name === "sprt-opsx-review-change");
	expect(skill).toBeDefined();
	expect(skill?.disableModelInvocation).toBe(false);
	expect(formatSkillsForPrompt(result.skills)).toContain("sprt-opsx-review-change");
});

test("references cover the four principles", () => {
	const principles = definitionFiles().get("references/principles.md") ?? "";
	for (const phrase of [
		"抽象化の追加",
		"重複の蓄積",
		"CI",
		"レビュー",
		"新しい継ぎ目",
		"正本",
		"成果指標",
		"導入前",
	]) {
		expect(principles).toContain(phrase);
	}
});

test("convention registry format lists required fields", () => {
	const registry = definitionFiles().get("references/convention-registry.md") ?? "";
	for (const field of ["規約 ID", "強度", "内容", "例外", "判定方法", "根拠"]) {
		expect(registry).toContain(field);
	}
	expect(registry).toContain("正本");
});

test("check generation reference covers required guidance", () => {
	const generation = definitionFiles().get("references/check-generation.md") ?? "";
	for (const phrase of [
		"依存方向",
		"重複",
		"継承",
		"型のみ",
		"AST",
		"scanImports",
		"OpenSpec",
		"テストランナー",
		"対象判定",
		"spirits",
	]) {
		expect(generation).toContain(phrase);
	}
});

test("dependency direction check includes type-only imports", () => {
	const generation = definitionFiles().get("references/check-generation.md") ?? "";
	const start = generation.indexOf("## 依存方向検査");
	expect(start).toBeGreaterThanOrEqual(0);
	const rest = generation.slice(start + 1);
	const nextSection = rest.indexOf("\n## ");
	const section = nextSection < 0 ? rest : rest.slice(0, nextSection);

	expect(section).toContain("型のみの import を含む");
	// No statement may limit the check target to value imports (verify2 W-2).
	expect(section).not.toContain("値の import が許可された向きだけ");
});

test("sprt-architecture-guards decides out-of-scope projects and asks when unsure", () => {
	const skill = definitionFiles().get("SKILL.md") ?? "";
	expect(skill).toContain("TypeScript");
	expect(skill).toContain("tsconfig.json");
	expect(skill).toContain("対象外");
	expect(skill).toContain("質問");
	expect(skill).toContain("作成・変更せずに終了");
	expect(skill).toContain("承認");
});
