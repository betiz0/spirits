/**
 * Check the spirits type mirror against the pinned host artifact.
 *
 * `packages/spirits/src/types/*.d.ts` is a hand-written mirror of the host's published types: the
 * mirror keeps the type check isolated from the host's own Node-targeted declarations (design D3).
 * A mirror that no longer matches the host hides an export that does not exist, so the mirror is
 * checked against the `.d.ts` files of the extracted host artifact.
 *
 * What is checked, per mirrored declaration:
 *
 * - the name exists in the host's exported types (a rename or a removal is a failure),
 * - every member the mirror declares exists on the host declaration, following its `extends` chain,
 * - a member whose type is spelled with literals and primitives only has to be spelled the same way
 *   on both sides. A member type that names another declaration is compared by presence, because the
 *   mirror deliberately narrows those to the fields spirits reads.
 *
 * The host may declare more than the mirror does; an addition is not a failure. Names spirits defines
 * for its own use are listed in {@link SPIRITS_LOCAL_NAMES} with the reason they have no host side.
 *
 * Usage:
 *
 *   bun scripts/check-pi-type-mirror.ts --artifact-root <extracted host package> [--mirror <file>]...
 *
 * `--artifact-root` is the extraction of the pinned host artifact (the directory that holds
 * `dist/index.d.ts`). Without it, the mirror is only parsed and the name check is skipped.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** One declaration read out of a `.d.ts` file. */
export interface Declaration {
	/** `interface`, `type`, `function`, or `const`. */
	kind: string;
	name: string;
	/** Names of an `extends` clause, for following the host's own inheritance. */
	extends: string[];
	/** Member name to the declaration text that follows it, in source order. */
	members: Map<string, string>;
	/** Normalized declaration text, for a declaration without members. */
	text: string;
}

/** One difference between the mirror and the host. */
export interface Issue {
	/** `missing-export`, `missing-member`, or `type-mismatch`. */
	kind: string;
	/** The mirrored declaration the issue belongs to. */
	name: string;
	/** The member the issue belongs to, when it has one. */
	member?: string;
	/** What the mirror asked for and what the host holds. */
	detail: string;
}

/**
 * Mirror names that have no host declaration because spirits defines them.
 *
 * Each entry states why there is nothing to compare against: a name the mirror invents to keep a
 * host type out of the type check, or a view that stands in for a host module the mirror does not
 * import. An entry that no longer needs to be here fails the check with `stale-local-name`, so this
 * list cannot quietly grow stale in the other direction either.
 */
export const SPIRITS_LOCAL_NAMES: Readonly<Record<string, string>> = {
	PiModel: "spirits' own view of a model entry; the host names it after its provider types",
	TUI: "stands in for the host terminal object, which the mirror keeps out of the type check",
};

/** Primitives and literal spellings a member type may be built from and still be compared. */
const CLOSED_TYPE_TOKENS = new Set([
	"string",
	"number",
	"boolean",
	"bigint",
	"symbol",
	"object",
	"unknown",
	"never",
	"void",
	"null",
	"undefined",
	"any",
	"readonly",
	"typeof",
	"keyof",
	"extends",
	"in",
	"Record",
	"Partial",
	"Readonly",
	"Array",
	"Promise",
]);

/** Strip comments, then collapse every run of whitespace to one space. */
function stripComments(source: string): string {
	let out = "";
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
			out += " ";
			continue;
		}
		if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index + 2);
			index = end === -1 ? source.length : end;
			continue;
		}
		if (char === "=" && next === ">") {
			// Arrow functions spelled with `=>` would otherwise read as a closing angle bracket, so the
			// operator becomes one character that no depth counter touches.
			out += "\u21d2";
			index += 2;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			const quote = char;
			out += char;
			index++;
			while (index < source.length) {
				out += source[index];
				if (source[index] === "\\") {
					out += source[index + 1] ?? "";
					index += 2;
					continue;
				}
				if (source[index] === quote) {
					index++;
					break;
				}
				index++;
			}
			continue;
		}
		out += char;
		index++;
	}
	return out.replace(/\s+/g, " ").trim();
}

/** Split on `separator` at bracket depth zero. */
function splitTopLevel(text: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "(" || char === "<" || char === "[" || char === "{") depth++;
		if (char === ")" || char === ">" || char === "]" || char === "}") depth--;
		if (depth === 0 && text.startsWith(separator, index)) {
			parts.push(current);
			current = "";
			index += separator.length - 1;
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * One spelling of a type, with the freedom the two files have taken removed.
 *
 * Member separators inside an object type (`;`, `,`, a trailing one, a newline) and the space around
 * the punctuation are not differences in the type, so they are folded away. The arrow operator stays
 * as the single character {@link stripComments} writes it into every parsed source.
 */
function normalizeSpelling(type: string): string {
	return type
		.replace(/\s+/g, " ")
		.replace(/;/g, ",")
		.replace(/,\s*}/g, "}")
		.replace(/\s*([<>{}(),:\[\]|])\s*/g, "$1");
}

/**
 * Normalized spelling of a type, comparable between the mirror and the host.
 *
 * Union branches are sorted, because the two files list them in their own order. Returns `undefined`
 * when the type names a declaration the other side cannot be compared against.
 */
export function normalizedType(type: string): string | undefined {
	const branches = splitTopLevel(type, "|");
	const normalized: string[] = [];
	for (const branch of branches) {
		const bare = branch.endsWith("[]") ? branch.slice(0, -2) : branch;
		const token = bare.replace(/\?$/, "").trim();
		if (token === "") return undefined;
		// A literal, a number, or a primitive may be compared. Anything else names a declaration whose own
		// spelling the mirror is free to narrow.
		if (/^".*"$/.test(token) || /^'.*'$/.test(token) || /^-?\d+(\.\d+)?$/.test(token)) {
			normalized.push(normalizeSpelling(token).replace(/^'(.*)'$/, '"$1"'));
			continue;
		}
		const base = token.replace(/<.*>$/, "");
		if (!CLOSED_TYPE_TOKENS.has(base)) return undefined;
		normalized.push(normalizeSpelling(token));
	}
	return [...new Set(normalized)].sort().join("|");
}

/** Read the members of an object type body (the text between the braces). */
function parseMembers(body: string): Map<string, string> {
	const members = new Map<string, string>();
	for (const part of splitTopLevel(body, ";")) {
		const match = /^(\[key:\s*string\]|[A-Za-z_$][\w$]*|"[^"]+")(\??)\s*(.*)$/s.exec(part);
		if (!match) continue;
		const name = match[1].startsWith("[key:") ? "[key: string]" : match[1];
		const rest = match[3] ?? "";
		// A method declaration carries its own signature; keep the whole thing as the type.
		const type = rest.startsWith(":") ? rest.slice(1).trim() : rest;
		members.set(name, type);
	}
	return members;
}

/**
 * Read the members of a class body.
 *
 * Emitted declarations end every property and method signature with `;`, which is also the separator the
 * comments were stripped into. Modifiers, overloads, and constructor signatures are not members of the
 * type a mirror stands for, and private names are invisible to it.
 */
function parseClassMembers(body: string): Map<string, string> {
	const members = new Map<string, string>();
	for (const part of splitTopLevel(body, ";")) {
		const entry = part.replace(/^(?:public|private|protected|static|readonly|declare|override|abstract|async)\s+/g, "");
		if (entry === "" || entry.startsWith("#") || entry.startsWith("constructor")) continue;
		const match = /^([A-Za-z_$][\w$]*)(\??)\s*([(:<].*)$/s.exec(entry);
		if (!match) continue;
		const name = match[1]!;
		const rest = match[3] ?? "";
		if (!members.has(name)) members.set(name, rest.startsWith(":") ? rest.slice(1).trim() : rest);
	}
	return members;
}

/** The body between the first `{` and its matching `}`. */
function blockBody(text: string, from: number): { body: string; end: number } {
	let depth = 0;
	for (let index = from; index < text.length; index++) {
		const char = text[index];
		if (char === "{") depth++;
		if (char !== "}") continue;
		depth--;
		if (depth === 0) return { body: text.slice(from + 1, index), end: index + 1 };
	}
	return { body: text.slice(from + 1), end: text.length };
}

/** One `export { local as exported }` clause entry, with the module it came from when it has one. */
export interface ExportSpecifier {
	/** The name the module publishes. */
	exported: string;
	/** The name it declares or re-exports under. */
	local: string;
	/** Module specifier the local name comes from, when the clause re-exports. */
	from?: string;
}

/** What one `.d.ts` file declares and publishes. */
export interface ParsedFile {
	declarations: Map<string, Declaration>;
	exports: ExportSpecifier[];
	/** `export * from "..."` specifiers. A namespaced `export * as x` is not a name export. */
	stars: string[];
}

/** Parse one `.d.ts` source into the declarations and re-exported names it publishes. */
export function parseDeclarationFile(source: string): ParsedFile {
	const text = stripComments(source);
	const declarations = new Map<string, Declaration>();
	const exports_: ExportSpecifier[] = [];
	const stars: string[] = [];
	const exportFrom = /(?:^|;)\s*export\s+(?:declare\s+)?(?:type\s+)?\{([^}]*)\}\s*(?:from\s*"([^"]+)")?/g;
	for (const match of text.matchAll(exportFrom)) {
		for (const entry of splitTopLevel(match[1] ?? "", ",")) {
			const parts = entry.replace(/^type\s+/, "").split(/\s+as\s+/);
			const local = (parts[0] ?? "").trim();
			const exported = (parts[1] ?? parts[0] ?? "").trim();
			if (exported === "" || exported === "default") continue;
			exports_.push({ exported, local, ...(match[2] ? { from: match[2] } : {}) });
		}
	}
	const starFrom = /(?:^|;)\s*export\s+\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*"([^"]+)"/g;
	for (const match of text.matchAll(starFrom)) {
		if (match[1]) stars.push(match[1]);
	}

	// Declarations are read in source order, with brace matching so nested objects stay intact.
	let index = 0;
	while (index < text.length) {
		const rest = text.slice(index);
		const declaration = /^export\s+(declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)/.exec(rest);
		if (declaration) {
			const name = declaration[3]!;
			const kind = declaration[2]!;
			const afterName = index + declaration[0].length;
			if (kind === "interface") {
				const brace = text.indexOf("{", afterName);
				if (brace === -1) break;
				const header = text.slice(afterName, brace);
				const { body, end } = blockBody(text, brace);
				const extendsNames = splitTopLevel(header.replace(/^\s*extends\s*/, ""), ",").map(
					(part) => part.replace(/<.*>$/, "").trim(),
				);
				const inherits = /^\s*extends\s+/.test(header);
				declarations.set(name, {
					kind,
					name,
					extends: inherits ? extendsNames : [],
					members: parseMembers(body),
					text: "",
				});
				index = end;
				continue;
			}
			const equals = text.indexOf("=", afterName);
			if (equals === -1) break;
			const start = equals + 1;
			const brace = text.indexOf("{", start);
			const semicolon = text.indexOf(";", start);
			// Only an object type read as members. `type JsonValue = null | { [key: string]: JsonValue }`
			// has a brace inside a union, and reading its body as the declaration's members would compare
			// one union branch against the whole type.
			const objectFirst = text.slice(start, brace).trim() === "";
			if (objectFirst && brace !== -1 && brace < semicolon) {
				const { body, end } = blockBody(text, brace);
				declarations.set(name, { kind, name, extends: [], members: parseMembers(body), text: "" });
				index = end;
				continue;
			}
			const value = text.slice(start, semicolon === -1 ? text.length : semicolon);
			declarations.set(name, { kind, name, extends: [], members: new Map(), text: value.trim() });
			index = semicolon === -1 ? text.length : semicolon + 1;
			continue;
		}
		const valueDeclaration =
			/^export\s+(declare\s+)?(function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(rest);
		if (valueDeclaration) {
			const kind = valueDeclaration[2]!;
			const name = valueDeclaration[3]!;
			const afterName = index + valueDeclaration[0].length;
			const end = topLevelStatementEnd(text, afterName);
			const statement = text.slice(afterName, end).trim();
			// A class carries its members in a body, and a published class is often what a mirrored
			// interface stands for (`AgentSession`, `KeybindingsManager`).
			const declaration: Declaration = { kind, name, extends: [], members: new Map(), text: statement };
			if (kind === "class") {
				const brace = statement.indexOf("{");
				const heritage = statement.slice(0, brace).match(/extends\s+([A-Za-z_$][\w$]*)/);
				if (heritage?.[1]) declaration.extends = [heritage[1]];
				if (brace !== -1) {
					const body = blockBody(statement, brace).body;
					declaration.members = parseClassMembers(body);
				}
			}
			declarations.set(name, declaration);
			index = end;
			continue;
		}
		index++;
	}
	return { declarations, exports: exports_, stars };
}

/** End of a declaration body: the `;` at depth zero, or the end of its block. */
function topLevelStatementEnd(text: string, from: number): number {
	let depth = 0;
	for (let index = from; index < text.length; index++) {
		const char = text[index];
		if (char === "(" || char === "<" || char === "[" || char === "{") depth++;
		if (char === ")" || char === ">" || char === "]" || char === "}") {
			depth--;
			if (depth === 0 && char === "}") return index + 1;
			continue;
		}
		if (char === ";" && depth === 0) return index + 1;
	}
	return text.length;
}

/** The declaration file the package publishes as its type entry. */
function entryTypesFile(artifactRoot: string): string {
	const manifest = join(artifactRoot, "package.json");
	if (existsSync(manifest)) {
		const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { types?: string; typings?: string };
		const declared = parsed.types ?? parsed.typings;
		if (declared) {
			const path = resolve(artifactRoot, declared);
			if (existsSync(path)) return path;
		}
	}
	const fallback = join(artifactRoot, "dist", "index.d.ts");
	if (existsSync(fallback)) return fallback;
	throw new Error(`no published .d.ts entry under ${artifactRoot}`);
}

/** Resolve a relative module specifier in a declaration file to the `.d.ts` on disk. */
function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
	if (!specifier.startsWith(".")) return undefined;
	const base = resolve(dirname(fromFile), specifier);
	// Declaration files re-export through the runtime specifier (`./types.js`), so the `.js` the
	// package emits becomes the `.d.ts` sitting next to it.
	const withoutExtension = base.replace(/\.(m?js|cjs|ts)$/, "");
	const candidates = [
		base.endsWith(".d.ts") ? base : `${withoutExtension}.d.ts`,
		join(withoutExtension, "index.d.ts"),
	];
	return candidates.find((candidate) => existsSync(candidate));
}

/**
 * The types one declaration file publishes, following its own re-export chains.
 *
 * The name maps to the declaration that ultimately backs it, or to `undefined` when the chain leaves
 * the package (an external dependency) or the declaration cannot be read: the name then counts as
 * exported, and only the member check is skipped.
 */
function publishedExports(
	file: string,
	parsed: Map<string, ParsedFile>,
	active: Set<string>,
): Map<string, Declaration | undefined> {
	const published = new Map<string, Declaration | undefined>();
	if (active.has(file)) return published;
	active.add(file);
	const fileParsed = parsed.get(file) ?? parseDeclarationFile(readFileSync(file, "utf8"));
	parsed.set(file, fileParsed);
	// The declarations the file exports itself are its exports; a clause list alone misses them, and a
	// module that only declares `export interface Widget {}` would publish nothing through `export *`.
	for (const declaration of fileParsed.declarations.values()) {
		published.set(declaration.name, declaration);
	}
	for (const entry of fileParsed.exports) {
		if (!entry.from) {
			published.set(entry.exported, fileParsed.declarations.get(entry.local));
			continue;
		}
		const target = resolveSpecifier(file, entry.from);
		if (!target) {
			published.set(entry.exported, undefined);
			continue;
		}
		published.set(entry.exported, publishedExports(target, parsed, active).get(entry.local));
	}
	for (const specifier of fileParsed.stars) {
		const target = resolveSpecifier(file, specifier);
		if (!target) continue;
		for (const [name, declaration] of publishedExports(target, parsed, active)) {
			if (!published.has(name)) published.set(name, declaration);
		}
	}
	active.delete(file);
	return published;
}

/**
 * Every declaration file the package publishes: the type entry plus each `exports` subpath that names
 * a declaration file. Spirits imports host subpaths (`.../core/extensions` and friends), so a subpath's
 * types belong to the API the mirror may stand for.
 */
function publishedFiles(artifactRoot: string): string[] {
	const files = [entryTypesFile(artifactRoot)];
	const manifest = join(artifactRoot, "package.json");
	if (!existsSync(manifest)) return files;
	const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { exports?: unknown };
	const targets: string[] = [];
	const collect = (value: unknown): void => {
		if (typeof value === "string") {
			if (value.endsWith(".d.ts") || value.endsWith(".ts")) targets.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) collect(item);
			return;
		}
		if (value !== null && typeof value === "object") {
			for (const item of Object.values(value as Record<string, unknown>)) collect(item);
		}
	};
	collect(parsed.exports);
	for (const target of targets) {
		const path = resolve(artifactRoot, target.replace(/^\./, ""));
		if (existsSync(path)) files.push(path);
	}
	return files;
}

/** The host types a mirror is compared against. */
export interface HostDeclarations {
	/**
	 * The names a published entry point exports, with the declaration behind each one. A mirror member
	 * is compared against these exactly.
	 */
published: Map<string, Declaration>;
	/**
	 * Every declaration in the artifact, by name, including the internal types the mirror stands in for
	 * (`ReadonlySessionManager` and friends are not part of the published surface, but the host does hand
	 * objects of these shapes to the extension at runtime).
	 */
	byName: Map<string, Declaration[]>;
}

/** Every `.d.ts` file under a directory, in path order. */
function declarationFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...declarationFiles(path));
		else if (path.endsWith(".d.ts")) found.push(path);
	}
	return found;
}

/**
 * The host's declarations: the published surface, resolved from the package's own entry points, plus
 * every declaration the artifact holds.
 *
 * The two are kept apart because they answer different questions. A name the entry points do not publish
 * is not host API spirits may import, so it is checked loosely: the declaration only has to exist and
 * carry the member. A name the artifact does not hold at all is a rename or a removal, and the mirror
 * cannot be right about it.
 */
export function readHostDeclarations(artifactRoot: string): HostDeclarations {
	const parsedFiles = new Map<string, ParsedFile>();
	const published = new Map<string, Declaration>();
	for (const file of publishedFiles(artifactRoot)) {
		for (const [name, declaration] of publishedExports(file, parsedFiles, new Set())) {
			if (published.has(name)) continue;
			published.set(name, declaration ?? {
				kind: "reexport",
				name,
				extends: [],
				members: new Map(),
				text: "",
			});
		}
	}
	const byName = new Map<string, Declaration[]>();
	const dist = join(artifactRoot, "dist");
	for (const file of declarationFiles(existsSync(dist) ? dist : artifactRoot)) {
		const parsed = parsedFiles.get(file) ?? parseDeclarationFile(readFileSync(file, "utf8"));
		parsedFiles.set(file, parsed);
		for (const declaration of parsed.declarations.values()) {
			const existing = byName.get(declaration.name);
			if (existing) existing.push(declaration);
			else byName.set(declaration.name, [declaration]);
		}
	}
	return { published, byName };
}

/** Members of a host declaration, with its `extends` chain resolved by name across the artifact. */
function hostMembers(
	lookup: Map<string, Declaration[]>,
	declaration: Declaration,
	seen = new Set<string>(),
): Map<string, string> {
	if (seen.has(declaration.name)) return new Map();
	seen.add(declaration.name);
	const members = new Map(declaration.members);
	for (const base of declaration.extends) {
		for (const parent of lookup.get(base) ?? []) {
			for (const [name, type] of hostMembers(lookup, parent, seen)) {
				if (!members.has(name)) members.set(name, type);
			}
		}
	}
	return members;
}

/**
 * The members a host declaration offers, flattening a type alias that names other declarations.
 *
 * `type ToolCallEvent = BashToolCallEvent | OtherToolCallEvent` has no members of its own, and the
 * mirror's view of it reads the members of the branches it handles. A union is wider than any branch,
 * so a member found in any branch counts as present.
 */
function flattenedHostMembers(lookup: Map<string, Declaration[]>, candidate: Declaration): Map<string, string> {
	const own = hostMembers(lookup, candidate);
	if (own.size > 0 || candidate.text === "") return own;
	const merged = new Map<string, string>();
	for (const reference of new Set(candidate.text.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
		for (const referenced of lookup.get(reference) ?? []) {
			for (const [name, type] of hostMembers(lookup, referenced, new Set([candidate.name]))) {
				if (!merged.has(name)) merged.set(name, type);
			}
		}
	}
	return merged;
}

/** Compare one mirror declaration with the host's view of the same name. */
function compareDeclaration(mirror: Declaration, host: HostDeclarations): Issue[] {
	const target = host.published.get(mirror.name);
	if (mirror.members.size === 0) return [];
	// `extends` is resolved across the whole artifact: the base is usually declared in another file, and
	// a published interface's members are its inherited members plus its own.
	const lookup = host.byName;
	const candidates = target ? [target] : host.byName.get(mirror.name) ?? [];
	if (candidates.length === 0) return [];
	const available = new Map<string, string>();
	for (const candidate of candidates) {
		for (const [name, type] of flattenedHostMembers(lookup, candidate)) {
			if (!available.has(name)) available.set(name, type);
		}
	}
	if (target?.kind === "reexport") return [];
	const issues: Issue[] = [];
	for (const [member, mirrorType] of mirror.members) {
		const hostType = available.get(member);
		if (hostType === undefined) {
			issues.push({
				kind: "missing-member",
				name: mirror.name,
				member,
				detail: `the mirror declares ${member} and the host ${mirror.name} does not`,
			});
			continue;
		}
		// Only the published surface is compared spelling for spelling. An internal declaration may be
		// matched against a same-named declaration from another module, whose spelling means something else.
		if (!target) continue;
		const mirrorSpelling = normalizedType(mirrorType);
		const hostSpelling = normalizedType(hostType);
		if (mirrorSpelling === undefined || hostSpelling === undefined) continue;
		if (mirrorSpelling !== hostSpelling) {
			issues.push({
				kind: "type-mismatch",
				name: mirror.name,
				member,
				detail: `mirror ${mirrorType} is not the host ${hostType}`,
			});
		}
	}
	return issues;
}

/** Compare the mirror's declarations with the host's. */
export function compareMirrorDeclarations(
	mirror: Map<string, Declaration>,
	host: HostDeclarations | undefined,
): Issue[] {
	const issues: Issue[] = [];
	const usedLocals = new Set<string>();
	for (const [name, declaration] of mirror) {
		if (host === undefined) continue;
		if (!host.published.has(name) && !host.byName.has(name)) {
			if (SPIRITS_LOCAL_NAMES[name] !== undefined) {
				usedLocals.add(name);
				continue;
			}
			issues.push({
				kind: "missing-export",
				name,
				detail: "the mirror declares it and the host has no such declaration",
			});
			continue;
		}
		issues.push(...compareDeclaration(declaration, host));
	}
	for (const name of Object.keys(SPIRITS_LOCAL_NAMES)) {
		if (host !== undefined && (host.published.has(name) || host.byName.has(name)) && !mirror.has(name)) {
			issues.push({
				kind: "stale-local-name",
				name,
				detail: "the mirror no longer declares it, so it needs no local exception",
			});
		}
	}
	return issues;
}

/** Read one mirror file's declarations. */
export function readMirrorDeclarations(path: string): Map<string, Declaration> {
	return parseDeclarationFile(readFileSync(path, "utf8")).declarations;
}

interface CliOptions {
	artifactRoots: string[];
	mirrors: string[];
}

function parseArgs(args: readonly string[]): CliOptions {
	const options: CliOptions = { artifactRoots: [], mirrors: [] };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--artifact-root") {
			const root = args[++index];
			if (root) options.artifactRoots.push(root);
			continue;
		}
		if (arg === "--mirror") {
			const mirror = args[++index];
			if (mirror) options.mirrors.push(mirror);
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/** Combine the host view of several packages, which is what the mirror stands in for. */
function mergeHosts(hosts: readonly HostDeclarations[]): HostDeclarations {
	const published = new Map<string, Declaration>();
	const byName = new Map<string, Declaration[]>();
	for (const host of hosts) {
		for (const [name, declaration] of host.published) {
			if (!published.has(name)) published.set(name, declaration);
		}
		for (const [name, declarations] of host.byName) {
			const existing = byName.get(name);
			if (existing) existing.push(...declarations);
			else byName.set(name, [...declarations]);
		}
	}
	return { published, byName };
}

export function checkTypeMirror(options: { artifactRoots?: readonly string[]; mirrors: readonly string[] }): Issue[] {
	const hosts = (options.artifactRoots ?? []).map((root) => readHostDeclarations(resolve(root)));
	const host = hosts.length > 0 ? mergeHosts(hosts) : undefined;
	const mirror = new Map<string, Declaration>();
	for (const path of options.mirrors) {
		for (const [name, declaration] of readMirrorDeclarations(resolve(path))) {
			mirror.set(name, declaration);
		}
	}
	return compareMirrorDeclarations(mirror, host);
}

function main(): number {
	const options = parseArgs(process.argv.slice(2));
	const defaultMirror = join(import.meta.dir, "..", "packages", "spirits", "src", "types");
	const mirrors = options.mirrors.length > 0
		? options.mirrors
		: ["pi-coding-agent.d.ts", "pi-tui.d.ts"].map((name) => join(defaultMirror, name)).filter((path) => existsSync(path));
	if (mirrors.length === 0) {
		console.error("no mirror files found");
		return 1;
	}
	let issues: Issue[];
	try {
		issues = checkTypeMirror({
			...(options.artifactRoots.length > 0 ? { artifactRoots: options.artifactRoots } : {}),
			mirrors,
		});
	} catch (error) {
		console.error(`type mirror check could not read its input: ${error instanceof Error ? error.message : error}`);
		return 1;
	}
	for (const issue of issues) {
		const member = issue.member === undefined ? "" : `.${issue.member}`;
		console.error(`${issue.kind}: ${issue.name}${member}: ${issue.detail}`);
	}
	const against = options.artifactRoots.length > 0 ? options.artifactRoots.join(", ") : "(no artifact)";
	if (issues.length > 0) {
		console.error(`${issues.length} type mirror issue(s) against ${against}`);
		return 1;
	}
	console.log(`type mirror matches ${mirrors.length} file(s) against ${against}`);
	return 0;
}

if (import.meta.main) process.exit(main());
