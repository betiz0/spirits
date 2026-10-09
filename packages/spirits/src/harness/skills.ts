/**
 * Skill CRUD on `<agentDir>/skills/<name>/SKILL.md`.
 *
 * Skills are written in the Agent Skills format: frontmatter with exactly `name` and
 * `description` plus the body. `description` is written as a JSON string literal, which
 * is valid YAML double-quoted scalar syntax, so newlines, `: `, `#`, and quotes round-trip
 * without producing extra keys. Listing and deleting use the directory name as the
 * identifier, so hand-written skills with a mismatched frontmatter `name` stay addressable.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SKILL_DESCRIPTION_MAX_LENGTH, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "../constants.ts";
import { skillsDir } from "./paths.ts";

/** File name inside each skill directory. */
const SKILL_FILE_NAME = "SKILL.md";

/** Frontmatter delimiter line. */
const FRONTMATTER_DELIMITER = "---";

/** Frontmatter key for the skill name. */
const FRONTMATTER_NAME_KEY = "name";

/** Frontmatter key for the skill description. */
const FRONTMATTER_DESCRIPTION_KEY = "description";

/** Double quote; a value starting with it is a JSON string literal. */
const DOUBLE_QUOTE = '"';

/** Single quote; a value starting with it is a YAML single-quoted scalar. */
const SINGLE_QUOTE = "'";

/** Block scalar indicators; their contents stay unreadable (returned as ""). */
const BLOCK_SCALAR_FOLDED = ">";
const BLOCK_SCALAR_LITERAL = "|";

/** YAML indicator characters that cannot start a plain scalar. */
const PLAIN_FORBIDDEN_FIRST = ["[", "{", "]", "}", ",", "&", "*", "!", "#", "%", "@", "`"] as const;

/** Prefixes that turn a plain scalar into a map key or sequence entry. */
const PLAIN_FORBIDDEN_PREFIXES = ["- ", "? ", ": "] as const;

/** `key: value` inside a plain scalar parses as a nested map, not a string. */
const MAP_SEPARATOR = ": ";

/** A trailing `:` also starts a nested map. */
const MAP_TRAILING = ":";

/** Characters that may precede a comment marker. */
const COMMENT_PRECEDER_SPACE = " ";
const COMMENT_PRECEDER_TAB = "\t";

/** Comment marker. */
const COMMENT_PREFIX = "#";

// YAML 1.2 core schema scalars that resolve to a non-string. Patterns mirror the
// design table and were checked against pi's `yaml` parser.
const NULL_PATTERN = /^(?:~|null|Null|NULL)$/;
const BOOLEAN_PATTERN = /^(?:true|True|TRUE|false|False|FALSE)$/;
const INTEGER_PATTERN = /^[-+]?[0-9]+$/;
const OCTAL_PATTERN = /^0o[0-7]+$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;
const FLOAT_PATTERN = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INFINITY_PATTERN = /^[-+]?\.(?:inf|Inf|INF)$/;
const NAN_PATTERN = /^\.(?:nan|NaN|NAN)$/;

export interface SkillDraft {
	name: string;
	description: string;
	body: string;
}

export interface SkillSummary {
	name: string;
	description: string;
}

export interface SkillLocation {
	name: string;
	path: string;
}

/** Validate a skill name, returning it unchanged or throwing before any filesystem access. */
export function validateSkillName(name: unknown): string {
	if (typeof name !== "string") {
		throw new Error("スキル名は文字列でなければなりません。");
	}
	if (name.length > SKILL_NAME_MAX_LENGTH) {
		throw new Error(`スキル名は ${SKILL_NAME_MAX_LENGTH} 文字以下でなければなりません。`);
	}
	if (!SKILL_NAME_PATTERN.test(name)) {
		throw new Error(`スキル名 "${name}" は ${SKILL_NAME_PATTERN.source} の形式に一致しません。`);
	}
	return name;
}

/** Write (or overwrite) `<skills>/<name>/SKILL.md`. */
export async function saveSkill(agentDir: string, draft: SkillDraft): Promise<SkillLocation> {
	const name = validateSkillName(draft.name);
	if (typeof draft.description !== "string" || draft.description.trim() === "") {
		throw new Error("スキルの description は空または空白のみにできません。");
	}
	if (draft.description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
		throw new Error(`スキルの description は ${SKILL_DESCRIPTION_MAX_LENGTH} 文字以下でなければなりません。`);
	}
	if (typeof draft.body !== "string" || draft.body.trim() === "") {
		throw new Error("スキルの body は空または空白のみにできません。");
	}
	const dir = path.join(skillsDir(agentDir), name);
	const file = path.join(dir, SKILL_FILE_NAME);
	const content = [
		FRONTMATTER_DELIMITER,
		`${FRONTMATTER_NAME_KEY}: ${name}`,
		`${FRONTMATTER_DESCRIPTION_KEY}: ${JSON.stringify(draft.description)}`,
		FRONTMATTER_DELIMITER,
		"",
		draft.body,
		"",
	].join("\n");
	await mkdir(dir, { recursive: true });
	await writeFile(file, content, "utf8");
	return { name, path: file };
}

/** List skills that have a `SKILL.md`, by directory name, sorted ascending. */
export async function listSkills(agentDir: string): Promise<SkillSummary[]> {
	const dir = skillsDir(agentDir);
	let names: string[];
	try {
		names = (await readdir(dir)).filter(isValidSkillName).sort(compareNames);
	} catch {
		return [];
	}
	const skills: SkillSummary[] = [];
	for (const name of names) {
		const file = path.join(dir, name, SKILL_FILE_NAME);
		// Follows symlinks: a skill directory symlinked into `skills/` is listed too.
		if (!(await isFile(file))) {
			continue;
		}
		let description = "";
		try {
			description = parseDescription(await readFile(file, "utf8"));
		} catch {
			// An unreadable SKILL.md still lists the skill with an empty description.
		}
		skills.push({ name, description });
	}
	return skills;
}

/** Remove `<skills>/<name>`. Throws when the skill does not exist. */
export async function deleteSkill(agentDir: string, name: unknown): Promise<SkillLocation> {
	const valid = validateSkillName(name);
	const dir = path.join(skillsDir(agentDir), valid);
	let exists = false;
	try {
		exists = (await stat(dir)).isDirectory();
	} catch {
		exists = false;
	}
	if (!exists) {
		throw new Error(`スキル "${valid}" は存在しません。`);
	}
	await rm(dir, { recursive: true });
	return { name: valid, path: dir };
}

async function isFile(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isFile();
	} catch {
		return false;
	}
}

/** Names outside the skill name rule cannot be saved or deleted, so they are not listed. */
function isValidSkillName(name: string): boolean {
	return name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_PATTERN.test(name);
}

/** Read `description:` from the frontmatter; `""` when absent or unparseable. */
function parseDescription(content: string): string {
	const lines = content.split("\n");
	if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
		return "";
	}
	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
	if (endIndex < 0) {
		return "";
	}
	const prefix = `${FRONTMATTER_DESCRIPTION_KEY}:`;
	for (let i = 1; i < endIndex; i++) {
		const line = lines[i] ?? "";
		if (!line.startsWith(prefix)) {
			continue;
		}
		return decodeDescription(line.slice(prefix.length).trim(), lines[i + 1] ?? "");
	}
	return "";
}

/**
 * Decode one `description:` value the same way pi's YAML parser reads the readable
 * forms. Block scalars and continuation lines return `""` rather than a misleading
 * fragment, and the result never includes quote characters or comments. Plain values
 * that pi resolves to a non-string (or rejects) are also `""`, so the list never
 * disagrees with pi with a non-empty string.
 */
function decodeDescription(raw: string, nextLine: string): string {
	if (raw.startsWith(DOUBLE_QUOTE)) {
		try {
			const parsed: unknown = JSON.parse(raw);
			return typeof parsed === "string" ? parsed : "";
		} catch {
			return "";
		}
	}
	if (raw.startsWith(SINGLE_QUOTE)) {
		return decodeSingleQuoted(raw);
	}
	if (raw.startsWith(BLOCK_SCALAR_FOLDED) || raw.startsWith(BLOCK_SCALAR_LITERAL)) {
		return "";
	}
	if (isIndented(nextLine)) {
		return "";
	}
	return decodePlain(raw);
}

/** Decode a plain scalar, or `""` when pi would not read it as that exact string. */
function decodePlain(raw: string): string {
	if (raw === "") {
		return "";
	}
	if (PLAIN_FORBIDDEN_FIRST.some((char) => raw.startsWith(char))) {
		return "";
	}
	if (PLAIN_FORBIDDEN_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
		return "";
	}
	const value = stripTrailingComment(raw).trim();
	if (value === "" || value.includes(MAP_SEPARATOR) || value.endsWith(MAP_TRAILING)) {
		return "";
	}
	if (resolvesToNonString(value)) {
		return "";
	}
	return value;
}

/** True when the YAML 1.2 core schema resolves the scalar to a non-string value. */
function resolvesToNonString(value: string): boolean {
	return (
		NULL_PATTERN.test(value) ||
		BOOLEAN_PATTERN.test(value) ||
		INTEGER_PATTERN.test(value) ||
		OCTAL_PATTERN.test(value) ||
		HEX_PATTERN.test(value) ||
		FLOAT_PATTERN.test(value) ||
		INFINITY_PATTERN.test(value) ||
		NAN_PATTERN.test(value)
	);
}

/** YAML single-quoted scalar: `''` is one quote; nothing but a comment may follow. */
function decodeSingleQuoted(raw: string): string {
	let value = "";
	for (let i = 1; i < raw.length; i++) {
		const char = raw[i];
		if (char !== SINGLE_QUOTE) {
			value += char;
			continue;
		}
		if (raw[i + 1] === SINGLE_QUOTE) {
			value += SINGLE_QUOTE;
			i += 1;
			continue;
		}
		const rest = raw.slice(i + 1).trim();
		if (rest !== "" && !rest.startsWith(COMMENT_PREFIX)) {
			return "";
		}
		return value;
	}
	return "";
}

/** A continuation line is indented; pi reads it as part of the scalar. */
function isIndented(line: string): boolean {
	return line.startsWith(" ") || line.startsWith("\t");
}

/** A plain scalar ends at a comment marker: whitespace followed by `#`. */
function stripTrailingComment(raw: string): string {
	for (let i = 0; i + 1 < raw.length; i++) {
		const char = raw[i];
		if (
			(char === COMMENT_PRECEDER_SPACE || char === COMMENT_PRECEDER_TAB) &&
			raw[i + 1] === COMMENT_PREFIX
		) {
			return raw.slice(0, i);
		}
	}
	return raw;
}

/** Plain code-unit ordering; locale-aware ordering would depend on the environment. */
function compareNames(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
