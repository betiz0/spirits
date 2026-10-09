/**
 * YAML round-trip checks against pi's own frontmatter parser.
 *
 * `bun test` must not depend on a YAML library, so the saved `description` is verified by
 * reading the file back with `parseFrontmatter` from pi. This directory carries a
 * `tsconfig.json` (root paths) so Bun resolves the pi sources at run time; the type check
 * uses the mirror in `src/types/pi-coding-agent.d.ts`.
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { listSkills, saveSkill } from "../../src/harness/skills.ts";

/** Characters that a naive `description: <text>` writer would break on. */
const DESCRIPTION = [
	'fix: "quote" #tag',
	"disable-model-invocation: true",
	"\ttab-indented",
	"\u2028line-separator",
	"\ud800lone-surrogate",
	"---",
	"tail",
].join("\n");

test("saved description round-trips through pi frontmatter parser", async () => {
	const agentDir = await mkdtemp(path.join(tmpdir(), "spirits-skills-yaml-"));
	const saved = await saveSkill(agentDir, {
		name: "round-trip",
		description: DESCRIPTION,
		body: "run bun test",
	});
	const content = await readFile(saved.path, "utf8");
	const parsed = parseFrontmatter<Record<string, unknown>>(content);
	expect(Object.keys(parsed.frontmatter)).toEqual(["name", "description"]);
	expect(parsed.frontmatter["description"]).toBe(DESCRIPTION);
});

test("hand-written descriptions match pi for readable forms", async () => {
	const agentDir = await mkdtemp(path.join(tmpdir(), "spirits-skills-yaml-"));
	const cases: Array<[string, string]> = [
		["double", 'description: "hello: world"'],
		["single", "description: 'it''s fine'"],
		["plain", "description: plain text # note"],
	];
	for (const [name, line] of cases) {
		const dir = path.join(agentDir, "skills", name);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n${line}\n---\n\nbody\n`);
	}
	const listed = await listSkills(agentDir);
	const byName = new Map(listed.map((skill) => [skill.name, skill.description]));
	for (const [name] of cases) {
		const content = await readFile(path.join(agentDir, "skills", name, "SKILL.md"), "utf8");
		const parsed = parseFrontmatter<{ description?: string }>(content);
		expect(byName.get(name)).toBe(parsed.frontmatter.description);
	}
	expect(byName.get("single")).toBe("it's fine");
	expect(byName.get("plain")).toBe("plain text");
});

test("list descriptions never differ from pi", async () => {
	const agentDir = await mkdtemp(path.join(tmpdir(), "spirits-skills-yaml-"));
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
		"a:b",
		"-x",
		"?x",
		"1.2.3",
		"yes",
		"http://x.example/a",
	];
	const cases: Array<[string, string]> = values.map((value, index) => [
		`value-${String(index).padStart(2, "0")}`,
		value,
	]);
	cases.push(
		["double", '"hello: world"'],
		["single", "'it''s fine'"],
		["plain-comment", "plain text # note"],
		["tab-comment", "plain text\t# note"],
	);
	for (const [name, value] of cases) {
		const dir = path.join(agentDir, "skills", name);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${value}\n---\n\nbody\n`);
	}
	const byName = new Map((await listSkills(agentDir)).map((skill) => [skill.name, skill.description]));
	for (const [name] of cases) {
		const content = await readFile(path.join(agentDir, "skills", name, "SKILL.md"), "utf8");
		let piValue = "";
		try {
			const parsed = parseFrontmatter<{ description?: unknown }>(content);
			piValue = typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : "";
		} catch {
			piValue = "";
		}
		const listed = byName.get(name);
		// The list may return pi's string or "", but never a different non-empty string.
		if (piValue === "") {
			expect(listed).toBe("");
		} else {
			expect(listed === piValue || listed === "").toBe(true);
		}
	}
});
