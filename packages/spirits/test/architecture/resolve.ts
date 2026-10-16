/**
 * Internal specifier resolution (design decision 8).
 *
 * Internal specifiers (relative specifiers and `@earendil-works/*`) are resolved with
 * the root `tsconfig.json`'s `paths` only. The spirits package's own `paths` are
 * type-checking stubs and must never be used: spirits' imports of Pi resolve to the
 * upstream packages.
 *
 * Exact keys win over wildcard keys; when several targets are configured they are tried
 * in order; each target is probed as-is, then with `.ts`, `.tsx`, `/index.ts`, and
 * `/index.tsx` appended. An internal specifier that resolves to nothing is a violation;
 * the caller decides what to do with unresolvable specifiers.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A specifier is internal when it is relative or points into the workspace scope. */
export function isInternalSpecifier(specifier: string): boolean {
	return specifier.startsWith(".") || specifier.startsWith("@earendil-works/");
}

/** Probe candidate paths in the prescribed order and return the first existing file. */
export function probeFile(base: string): string | undefined {
	const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return undefined;
}

/**
 * Resolve an internal specifier imported from `fromFile` against `paths` from the root
 * tsconfig. Returns the absolute path of the target file, or `undefined` when the
 * specifier is external or cannot be resolved.
 */
export function resolveInternalSpecifier(
	repoRoot: string,
	paths: Record<string, readonly string[]>,
	fromFile: string,
	specifier: string,
): string | undefined {
	if (specifier.startsWith(".")) {
		return probeFile(resolve(dirname(fromFile), specifier));
	}
	if (specifier.startsWith("@earendil-works/")) {
		const targets: string[] = [];
		const exact = paths[specifier];
		if (exact) targets.push(...exact);
		let bestPrefix: string | null = null;
		for (const key of Object.keys(paths)) {
			if (!key.endsWith("/*")) continue;
			const prefix = key.slice(0, -1);
			if (specifier.startsWith(prefix) && (bestPrefix === null || prefix.length > bestPrefix.length)) {
				bestPrefix = prefix;
			}
		}
		if (bestPrefix !== null) {
			const suffix = specifier.slice(bestPrefix.length);
			const wildcardTargets = paths[`${bestPrefix}*`];
			if (wildcardTargets) {
				for (const target of wildcardTargets) targets.push(target.replace("*", suffix));
			}
		}
		for (const target of targets) {
			const resolved = probeFile(resolve(repoRoot, target));
			if (resolved !== undefined) return resolved;
		}
		return undefined;
	}
	return undefined;
}
