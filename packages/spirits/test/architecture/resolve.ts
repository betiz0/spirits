/**
 * Internal specifier resolution (design decision 8, remove-pi-fork design decision 5).
 *
 * A relative specifier resolves against the importing file, probed as-is, then with
 * `.ts`, `.tsx`, `/index.ts` and `/index.tsx` appended.
 *
 * `@earendil-works/*` is the host scope, and the host is a published package. Those
 * specifiers never resolve through the repository's tsconfig `paths`; they resolve
 * through the package's own published entry points:
 *
 * 1. walking up from the importing file to the repository root, the first
 *    `node_modules/@earendil-works/<name>` with a `package.json` (this is the pinned
 *    host package the runtime actually loads),
 * 2. otherwise a repository package whose `package.json` declares that name, which is
 *    how a synthetic fixture tree models a host package,
 * 3. the subpath then resolves through the package's `exports`; a package without
 *   `exports` falls back to its `types` / `main` fields for the bare entry.
 *
 * A package that exists but does not export the subpath reports `notExported` so the
 * caller can judge the boundary; a specifier that resolves nowhere is a violation, and
 * nothing silently drops an import. Exact `exports` keys win over `./*` patterns, and a
 * pattern with several targets is tried in declaration order.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Specifier prefix of the host packages. */
export const HOST_SCOPE = "@earendil-works/";

/** A specifier is internal when it is relative or points into the host scope. */
export function isInternalSpecifier(specifier: string): boolean {
	return specifier.startsWith(".") || specifier.startsWith(HOST_SCOPE);
}

/** Probe candidate paths in the prescribed order and return the first existing file. */
export function probeFile(base: string): string | undefined {
	const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return undefined;
}

interface HostManifest {
	name?: string;
	exports?: unknown;
	types?: unknown;
	typings?: unknown;
	main?: unknown;
}

function manifestAt(packageDir: string): HostManifest | undefined {
	const path = join(packageDir, "package.json");
	if (!existsSync(path) || !statSync(path).isFile()) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null ? (parsed as HostManifest) : undefined;
	} catch {
		return undefined;
	}
}

/** Directory of the host package, walking up from the importer, then the workspace. */
function findHostPackage(fromFile: string, repoRoot: string, packageName: string): string | undefined {
	let dir = dirname(fromFile);
	for (;;) {
		const candidate = join(dir, "node_modules", packageName);
		if (manifestAt(candidate)) return candidate;
		if (dir === repoRoot) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const packagesDir = join(repoRoot, "packages");
	if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) return undefined;
	for (const entry of readdirSync(packagesDir).sort()) {
		const candidate = join(packagesDir, entry);
		if (manifestAt(candidate)?.name === packageName) return candidate;
	}
	return undefined;
}

const TYPE_SUFFIXES = [".ts", ".mts", ".cts", ".d.ts"];

function isTypeDeclarationFile(path: string): boolean {
	return TYPE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** A file with a sibling declaration file carries types even when the target is `.js`. */
function declarationFor(target: string): string | undefined {
	const declaration = `${target.replace(/\.js$/, "")}.d.ts`;
	return existsSync(declaration) && statSync(declaration).isFile() ? declaration : undefined;
}

/** An `exports` value can be a string, a list of fallbacks, or a condition object. */
function targetsOf(value: unknown, seenCondition: boolean): { targets: string[]; typed: boolean } {
	if (typeof value === "string") return { targets: [value], typed: seenCondition || isTypeDeclarationFile(value) };
	if (Array.isArray(value)) {
		const targets: string[] = [];
		let typed = false;
		for (const entry of value) {
			const nested = targetsOf(entry, seenCondition);
			targets.push(...nested.targets);
			typed = typed || nested.typed;
		}
		return { targets, typed };
	}
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		// A condition object prefers the declaration, then the runtime conditions.
		for (const condition of ["types", "default", "import", "require"] as const) {
			if (!(condition in record)) continue;
			const nested = targetsOf(record[condition], seenCondition || condition === "types");
			if (nested.targets.length > 0) return nested;
		}
		// A nested key is itself a condition or a subpath pattern; only conditions apply here.
		for (const nested of Object.values(record)) {
			const resolved = targetsOf(nested, seenCondition);
			if (resolved.targets.length > 0) return resolved;
		}
	}
	return { targets: [], typed: false };
}

/** The `exports` entry for a subpath: exact key first, then the longest `./*` pattern. */
function exportEntry(exports: Record<string, unknown>, subpath: string): { targets: string[]; typed: boolean } | undefined {
	const exact = exports[subpath];
	if (exact !== undefined) return targetsOf(exact, false);
	let bestPattern: string | undefined;
	for (const key of Object.keys(exports)) {
		if (!key.endsWith("*") || key === "*") continue;
		const prefix = key.slice(0, -1);
		if (!subpath.startsWith(prefix)) continue;
		if (bestPattern === undefined || prefix.length > bestPattern.slice(0, -1).length) bestPattern = key;
	}
	if (bestPattern === undefined) return undefined;
	const suffix = subpath.slice(bestPattern.slice(0, -1).length);
	const entry = targetsOf(exports[bestPattern], false);
	return { targets: entry.targets.map((target) => target.replace("*", suffix)), typed: entry.typed };
}

export interface HostResolution {
	/** Package specifier as written, without the subpath. */
	packageName: string;
	/** Subpath inside the package: `.` or `./rpc-entry`. */
	subpath: string;
	/** Directory of the package that provided the entry points. */
	packageDir?: string;
	/** Resolved entry file, when the specifier resolves to an existing file. */
	file?: string;
	/** The package exists but does not export the subpath. */
	notExported?: boolean;
	/** The resolved entry carries a type declaration. */
	typed: boolean;
}

/**
 * A workspace package is usually linked into `node_modules` by a symlink. Following the
 * link keeps the target inside the package it really belongs to, so the layer judgment
 * sees a repository package instead of a phantom host. A package installed from the
 * registry is not a link and stays a host.
 */
function throughLink(packageDir: string, file: string): string {
	let realDir: string;
	try {
		realDir = realpathSync(packageDir);
	} catch {
		return file;
	}
	if (realDir === packageDir) return file;
	return join(realDir, relative(packageDir, file));
}

/**
 * Resolve a host specifier (`@earendil-works/<name>[/<subpath>]`) through the package's
 * published entry points. `subpath` is `.` for a bare specifier.
 */
export function resolveHostSpecifier(fromFile: string, repoRoot: string, specifier: string): HostResolution {
	const rest = specifier.slice(HOST_SCOPE.length);
	const slash = rest.indexOf("/");
	const packageName = slash < 0 ? `${HOST_SCOPE}${rest}` : `${HOST_SCOPE}${rest.slice(0, slash)}`;
	const subpath = slash < 0 ? "." : `.${rest.slice(slash)}`;
	const packageDir = findHostPackage(fromFile, repoRoot, packageName);
	if (packageDir === undefined) return { packageName, subpath, typed: false };
	const manifest = manifestAt(packageDir)!;
	const entry =
		typeof manifest.exports === "object" && manifest.exports !== null && !Array.isArray(manifest.exports)
			? exportEntry(manifest.exports as Record<string, unknown>, subpath)
			: undefined;
	if (entry === undefined) {
		// No `exports` map (or no entry for this subpath): the bare entry may still come
		// from the legacy fields; any subpath is then not published.
		if (subpath !== ".") return { packageName, subpath, packageDir, notExported: true, typed: false };
		const legacy = [manifest.types, manifest.typings, manifest.main];
		for (const candidate of legacy) {
			if (typeof candidate !== "string") continue;
			const file = probeFile(join(packageDir, candidate)) ?? declarationFor(join(packageDir, candidate));
			if (file !== undefined) return { packageName, subpath, packageDir, file: throughLink(packageDir, file), typed: true };
		}
		const index = probeFile(join(packageDir, "index"));
		return {
			packageName,
			subpath,
			packageDir,
			file: index === undefined ? undefined : throughLink(packageDir, index),
			notExported: index === undefined,
			typed: true,
		};
	}
	for (const target of entry.targets) {
		const base = join(packageDir, target);
		const file = probeFile(base) ?? declarationFor(base);
		if (file !== undefined) {
			return {
				packageName,
				subpath,
				packageDir,
				file: throughLink(packageDir, file),
				typed: entry.typed || isTypeDeclarationFile(file),
			};
		}
	}
	return { packageName, subpath, packageDir, typed: entry.typed };
}

/**
 * Resolve an internal specifier imported from `fromFile`. Returns the absolute path of
 * the target file, or `undefined` when the specifier is external or resolves nowhere.
 */
export function resolveInternalSpecifier(repoRoot: string, fromFile: string, specifier: string): string | undefined {
	if (specifier.startsWith(".")) return probeFile(resolve(dirname(fromFile), specifier));
	if (specifier.startsWith(HOST_SCOPE)) return resolveHostSpecifier(fromFile, repoRoot, specifier).file;
	return undefined;
}
