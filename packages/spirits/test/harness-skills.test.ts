import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH } from "../src/constants.ts";
import { skillsDir } from "../src/harness/paths.ts";
import { deleteSkill, listSkills, saveSkill } from "../src/harness/skills.ts";

const DRAFT = { name: "release-check", description: "check a release", body: "run bun test" };

async function makeAgentDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "spirits-skills-"));
}

async function exists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

async function tree(root: string): Promise<string[]> {
	const result: string[] = [];
	async function walk(dir: string, prefix: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			result.push(rel);
			if (entry.isDirectory()) {
				await walk(path.join(dir, entry.name), rel);
			}
		}
	}
	await walk(root, "");
	return result;
}

/** Parse the frontmatter block the same way the list reader does. */
function frontmatterOf(content: string): { keys: string[]; description: string | undefined } {
	const lines = content.split("\n");
	expect(lines[0]).toBe("---");
	const end = lines.findIndex((line, index) => index > 0 && line === "---");
	const keys: string[] = [];
	let description: string | undefined;
	for (let i = 1; i < end; i++) {
		const line = lines[i] ?? "";
		const colon = line.indexOf(":");
		keys.push(line.slice(0, colon));
		if (line.startsWith("description:")) {
			description = line.slice("description:".length).trim();
		}
	}
	return { keys, description };
}

test("save writes frontmatter and body", async () => {
	const agentDir = await makeAgentDir();
	const saved = await saveSkill(agentDir, DRAFT);
	expect(saved.path).toBe(path.join(agentDir, "skills", "release-check", "SKILL.md"));
	const content = await readFile(saved.path, "utf8");
	const frontmatter = frontmatterOf(content);
	expect(frontmatter.keys).toEqual(["name", "description"]);
	expect(content).toContain("name: release-check");
	expect(content).toContain("run bun test");
});

test("save creates skills dir", async () => {
	const agentDir = await makeAgentDir();
	expect(await exists(skillsDir(agentDir))).toBe(false);
	await saveSkill(agentDir, DRAFT);
	expect(await exists(skillsDir(agentDir))).toBe(true);
});

test("save overwrites same name", async () => {
	const agentDir = await makeAgentDir();
	await saveSkill(agentDir, DRAFT);
	await saveSkill(agentDir, { ...DRAFT, body: "run bun test --watch" });
	await saveSkill(agentDir, { ...DRAFT, body: "second body" });
	const dir = path.join(skillsDir(agentDir), "release-check");
	expect(await readdir(dir)).toEqual(["SKILL.md"]);
	const content = await readFile(path.join(dir, "SKILL.md"), "utf8");
	expect(content).toContain("second body");
	expect(content).not.toContain("run bun test --watch");
});

test("save quotes description with special characters", async () => {
	const agentDir = await makeAgentDir();
	const description = 'fix: "quote" #tag\ndisable-model-invocation: true';
	const saved = await saveSkill(agentDir, { ...DRAFT, description });
	const content = await readFile(saved.path, "utf8");
	const frontmatter = frontmatterOf(content);
	expect(frontmatter.keys).toEqual(["name", "description"]);
	expect(content.split("\n").filter((line) => line.startsWith("description:"))).toHaveLength(1);
	expect(JSON.parse(frontmatter.description ?? "")).toBe(description);
});

test("save rejects invalid names", async () => {
	const agentDir = await makeAgentDir();
	const invalid = ["../evil", "Release-Check", "-bad", "a--b", "a".repeat(SKILL_NAME_MAX_LENGTH + 1)];
	for (const name of invalid) {
		await expect(saveSkill(agentDir, { ...DRAFT, name })).rejects.toThrow();
	}
	expect(await tree(agentDir)).toEqual([]);
});

test("save accepts name at max length", async () => {
	const agentDir = await makeAgentDir();
	const name = "a".repeat(SKILL_NAME_MAX_LENGTH);
	await saveSkill(agentDir, { ...DRAFT, name });
	expect(await exists(path.join(skillsDir(agentDir), name, "SKILL.md"))).toBe(true);
	await expect(saveSkill(agentDir, { ...DRAFT, name: `${name}a` })).rejects.toThrow();
});

test("save rejects empty or blank description or body", async () => {
	const agentDir = await makeAgentDir();
	for (const value of ["", "   ", "\n"]) {
		await expect(saveSkill(agentDir, { ...DRAFT, description: value })).rejects.toThrow();
		await expect(saveSkill(agentDir, { ...DRAFT, body: value })).rejects.toThrow();
	}
	expect(await tree(agentDir)).toEqual([]);
});

test("list returns saved skills", async () => {
	const agentDir = await makeAgentDir();
	await saveSkill(agentDir, DRAFT);
	await saveSkill(agentDir, { name: "second-skill", description: "another description", body: "body" });
	expect(await listSkills(agentDir)).toEqual([
		{ name: "release-check", description: "check a release" },
		{ name: "second-skill", description: "another description" },
	]);
});

test("list returns directory names", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "foo");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), '---\nname: bar\ndescription: "dir check"\n---\n\nbody\n');
	const skills = await listSkills(agentDir);
	expect(skills).toEqual([{ name: "foo", description: "dir check" }]);
	expect(JSON.stringify(skills)).not.toContain("bar");
});

test("list ignores dirs without SKILL.md", async () => {
	const agentDir = await makeAgentDir();
	await mkdir(path.join(skillsDir(agentDir), "empty-dir"), { recursive: true });
	expect(await listSkills(agentDir)).toEqual([]);
});

test("list reads quoted description", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "quoted");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "SKILL.md"),
		'---\nname: quoted\ndescription: "hello: world"\n---\n\nbody\n',
	);
	expect(await listSkills(agentDir)).toEqual([{ name: "quoted", description: "hello: world" }]);
});

test("list returns empty when missing", async () => {
	const agentDir = await makeAgentDir();
	expect(await listSkills(agentDir)).toEqual([]);
});

test("list tolerates missing frontmatter", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "plain");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), "# plain skill\n");
	expect(await listSkills(agentDir)).toEqual([{ name: "plain", description: "" }]);
});

test("list returns empty description for block scalars", async () => {
	const agentDir = await makeAgentDir();
	const cases: Array<[string, string]> = [
		["folded", ">"],
		["folded-strip", ">-"],
		["literal", "|"],
	];
	for (const [name, indicator] of cases) {
		const dir = path.join(skillsDir(agentDir), name);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${indicator}\n---\n\nbody\n`);
	}
	const skills = await listSkills(agentDir);
	expect(skills.map((skill) => skill.name)).toEqual(["folded", "folded-strip", "literal"]);
	for (const skill of skills) {
		expect(skill.description).toBe("");
	}
	expect(JSON.stringify(skills)).not.toContain(">");
});

test("list returns empty description for continuation lines", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "continued");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "SKILL.md"),
		"---\nname: continued\ndescription: first line\n  second line\n---\n\nbody\n",
	);
	expect(await listSkills(agentDir)).toEqual([{ name: "continued", description: "" }]);
});

test("list reads single quoted description", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "single");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "SKILL.md"), "---\nname: single\ndescription: 'it''s fine'\n---\n\nbody\n");
	expect(await listSkills(agentDir)).toEqual([{ name: "single", description: "it's fine" }]);
});

test("list strips trailing comment of plain description", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "plain-comment");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "SKILL.md"),
		"---\nname: plain-comment\ndescription: plain text # note\n---\n\nbody\n",
	);
	expect(await listSkills(agentDir)).toEqual([{ name: "plain-comment", description: "plain text" }]);
});

test("save rejects description over max length", async () => {
	const agentDir = await makeAgentDir();
	await saveSkill(agentDir, {
		...DRAFT,
		name: "at-limit",
		description: "d".repeat(SKILL_DESCRIPTION_MAX_LENGTH),
	});
	expect(await exists(path.join(skillsDir(agentDir), "at-limit", "SKILL.md"))).toBe(true);
	await expect(
		saveSkill(agentDir, {
			...DRAFT,
			name: "over-limit",
			description: "d".repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1),
		}),
	).rejects.toThrow();
	expect(await exists(path.join(skillsDir(agentDir), "over-limit"))).toBe(false);
});

test("list strips tab comment of plain description", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "tab-comment");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "SKILL.md"),
		"---\nname: tab-comment\ndescription: plain text\t# note\n---\n\nbody\n",
	);
	expect(await listSkills(agentDir)).toEqual([{ name: "tab-comment", description: "plain text" }]);
});

test("list returns empty description for plain values pi does not read as strings", async () => {
	const agentDir = await makeAgentDir();
	const values = [
		"fix: the thing",
		"foo:",
		"true",
		"FALSE",
		"null",
		"~",
		"123",
		"0x1f",
		".inf",
		"[a, b]",
		"{a: b}",
		"&anchor x",
		"*alias",
		"!tag x",
		"#comment",
		"`x",
		"@x",
		"%x",
		"- x",
		"? x",
	];
	const names: string[] = [];
	for (const [index, value] of values.entries()) {
		const name = `bad-${String(index).padStart(2, "0")}`;
		names.push(name);
		const dir = path.join(skillsDir(agentDir), name);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${value}\n---\n\nbody\n`);
	}
	const skills = await listSkills(agentDir);
	expect(skills.map((skill) => skill.name)).toEqual(names);
	for (const skill of skills) {
		expect(skill.description).toBe("");
	}
});

test("list keeps plain values pi reads as strings", async () => {
	const agentDir = await makeAgentDir();
	const cases: Array<[string, string]> = [
		["colon-inside", "a:b"],
		["dash-prefix", "-x"],
		["question-prefix", "?x"],
		["version", "1.2.3"],
		["yes", "yes"],
		["url", "http://x.example/a"],
	];
	for (const [name, value] of cases) {
		const dir = path.join(skillsDir(agentDir), name);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${value}\n---\n\nbody\n`);
	}
	const byName = new Map((await listSkills(agentDir)).map((skill) => [skill.name, skill.description]));
	for (const [name, value] of cases) {
		expect(byName.get(name)).toBe(value);
	}
});

test("list includes symlinked skill dirs", async () => {
	const agentDir = await makeAgentDir();
	const target = await mkdtemp(path.join(tmpdir(), "spirits-skill-target-"));
	await writeFile(
		path.join(target, "SKILL.md"),
		'---\nname: linked\ndescription: "linked skill"\n---\n\nbody\n',
	);
	const dir = skillsDir(agentDir);
	await mkdir(dir, { recursive: true });
	await symlink(target, path.join(dir, "linked"));
	expect(await listSkills(agentDir)).toEqual([{ name: "linked", description: "linked skill" }]);
});

test("list excludes names outside the skill name rule", async () => {
	const agentDir = await makeAgentDir();
	const dir = path.join(skillsDir(agentDir), "My_Skill");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "SKILL.md"),
		'---\nname: My_Skill\ndescription: "should not show"\n---\n\nbody\n',
	);
	expect(await listSkills(agentDir)).toEqual([]);
});

test("delete removes skill dir", async () => {
	const agentDir = await makeAgentDir();
	const saved = await saveSkill(agentDir, DRAFT);
	const deleted = await deleteSkill(agentDir, DRAFT.name);
	expect(deleted.path).toBe(path.dirname(saved.path));
	expect(await exists(path.join(skillsDir(agentDir), DRAFT.name))).toBe(false);
});

test("delete missing errors", async () => {
	const agentDir = await makeAgentDir();
	await expect(deleteSkill(agentDir, "no-such-skill")).rejects.toThrow();
	expect(await tree(agentDir)).toEqual([]);
});

test("delete symlinked skill removes only the link", async () => {
	const agentDir = await makeAgentDir();
	const target = await mkdtemp(path.join(tmpdir(), "spirits-skill-target-"));
	const targetFile = path.join(target, "SKILL.md");
	await writeFile(targetFile, '---\nname: linked\ndescription: "linked"\n---\n\nbody\n');
	const dir = skillsDir(agentDir);
	await mkdir(dir, { recursive: true });
	const link = path.join(dir, "linked");
	await symlink(target, link);
	await deleteSkill(agentDir, "linked");
	expect(await exists(link)).toBe(false);
	expect(await exists(targetFile)).toBe(true);
});

test("invalid name leaves no files outside skills dir", async () => {
	const agentDir = await makeAgentDir();
	await mkdir(path.join(agentDir, "outside"), { recursive: true });
	await writeFile(path.join(agentDir, "outside", "keep.txt"), "keep");
	const before = await tree(agentDir);
	await expect(saveSkill(agentDir, { ...DRAFT, name: "../outside" })).rejects.toThrow();
	await expect(deleteSkill(agentDir, "../outside")).rejects.toThrow();
	expect(await tree(agentDir)).toEqual(before);
});
