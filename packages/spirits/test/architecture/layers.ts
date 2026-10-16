/**
 * Layer assignment and allow-table derivation (design decisions 1, 2, 3, 9).
 *
 * Layers exist for public packages (`packages/<dir>`), private packages and spirits
 * layers registered in `registry:layer-members`, and exception layers derived from
 * each public package's `tsconfig.build.json` `exclude`.
 *
 * Allow directions: public packages derive theirs from their `package.json` workspace
 * dependencies at check time (so a new dependency needs no registry edit); private
 * packages, exception layers, and spirits layers take theirs from `registry:layers`.
 * Exception layers additionally allow the package's own declared dependencies, the
 * same package's non-experimental part, and everything the registry lists for them.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RegistryData, Violation } from "./registry.ts";

export interface LayerModel {
	/** Effective allow directions per layer. */
	effectiveAllow: Map<string, Set<string>>;
	/** All exception layers found in the repository, as `packages/<dir>:experimental`. */
	experimentalLayers: string[];
	/** Exception directories per public package, as repo-relative `src/...` paths. */
	experimentalDirs: Map<string, string[]>;
	/** Structural violations found while validating the registry against the repo. */
	registryViolations: Violation[];
}

export interface PackageInfo {
	dir: string;
	name: string;
	private: boolean;
	/** Names of workspace dependencies (dependencies/optionalDependencies/peerDependencies). */
	dependencies: string[];
}

export interface AssignedLayers {
	/** Repo-relative file path -> layer. */
	layerOf: Map<string, string>;
	/** Repo-relative paths of src files that belong to no layer. */
	unknownFiles: string[];
	/** Repo-relative paths matching more than one `registry:layer-members` layer. */
	multiMatchFiles: string[];
}

/**
 * Dev files are excluded from layer judgment and duplication counting. The definition
 * follows the convention registry exactly: anything under a package's `test/` or
 * `examples/` directory, `packages/<dir>/*.config.ts`, `packages/ai/scripts/`, the
 * root `scripts/`, and root-level files. Paths outside `packages/` that are none of
 * those (e.g. `docs/`) are not dev, but they are never scan targets either, so they
 * are never layer-judged (verify2 G-3).
 */
export function isDevFile(repoRelativePath: string): boolean {
	const parts = repoRelativePath.split("/");
	if (parts[0] !== "packages") return parts[0] === "scripts" || parts.length === 1;
	if (parts.length >= 4 && (parts[2] === "test" || parts[2] === "examples")) return true;
	if (parts.length === 3 && parts[2].endsWith(".config.ts")) return true;
	if (parts[1] === "ai" && parts[2] === "scripts") return true;
	return false;
}

export function listPackages(repoRoot: string): PackageInfo[] {
	const packagesDir = join(repoRoot, "packages");
	if (!existsSync(packagesDir) || !statSync(packagesDir).isDirectory()) return [];
	const packages: PackageInfo[] = [];
	for (const dir of readdirSync(packagesDir).sort()) {
		const manifestPath = join(packagesDir, dir, "package.json");
		if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) continue;
		let manifest: {
			name?: unknown;
			private?: unknown;
			dependencies?: unknown;
			optionalDependencies?: unknown;
			peerDependencies?: unknown;
		};
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		} catch {
			continue;
		}
		const names = new Set<string>();
		for (const key of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
			const section = manifest[key];
			if (typeof section === "object" && section !== null) {
				for (const name of Object.keys(section as Record<string, unknown>)) names.add(name);
			}
		}
		packages.push({
			dir,
			name: typeof manifest.name === "string" ? manifest.name : dir,
			private: manifest.private === true,
			dependencies: [...names],
		});
	}
	return packages;
}

function experimentalDirsFor(repoRoot: string, pkg: PackageInfo): string[] {
	const configPath = join(repoRoot, "packages", pkg.dir, "tsconfig.build.json");
	if (!existsSync(configPath) || !statSync(configPath).isFile()) return [];
	let config: { exclude?: unknown };
	try {
		config = JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		return [];
	}
	const dirs: string[] = [];
	for (const entry of Array.isArray(config.exclude) ? config.exclude : []) {
		if (typeof entry !== "string") continue;
		if (!entry.startsWith("src/") || entry === "src") continue;
		if (/[*?]/.test(entry)) continue;
		const full = join(repoRoot, "packages", pkg.dir, entry);
		if (existsSync(full) && statSync(full).isDirectory()) dirs.push(entry);
	}
	return dirs;
}

/**
 * Build the layer model: enumerate packages and exception layers, validate the
 * registry's allow and member tables against the layer universe, and compute the
 * effective allow directions.
 */
export function buildLayerModel(repoRoot: string, registry: RegistryData): LayerModel {
	const packages = listPackages(repoRoot);
	const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));

	const experimentalLayers: string[] = [];
	const experimentalDirs = new Map<string, string[]>();
	for (const pkg of packages) {
		if (pkg.private) continue;
		const dirs = experimentalDirsFor(repoRoot, pkg);
		if (dirs.length > 0) {
			experimentalLayers.push(`packages/${pkg.dir}:experimental`);
			experimentalDirs.set(pkg.dir, dirs);
		}
	}

	const memberLayers = new Set(Object.keys(registry.layerMembers));
	const allowLayers = new Set(Object.keys(registry.layers));
	const universe = new Set<string>(experimentalLayers);
	for (const pkg of packages) universe.add(`packages/${pkg.dir}`);
	for (const layer of memberLayers) universe.add(layer);

	const registryViolations: Violation[] = [];
	for (const [layer, allow] of Object.entries(registry.layers)) {
		if (!universe.has(layer)) {
			registryViolations.push({ message: `REGISTRY: allow table references unknown layer: ${layer}` });
		}
		// Public package directions are derived from package.json at check time;
		// writing them in the registry would duplicate the management (decision 2, verify2 C-2).
		const pkg = layer.startsWith("packages/") ? byDir.get(layer.slice("packages/".length)) : undefined;
		if (pkg && !pkg.private) {
			registryViolations.push({
				message: `REGISTRY: allow table must not contain the public package layer ${layer}; derive its directions from package.json`,
			});
		}
		for (const target of allow) {
			if (!universe.has(target)) {
				registryViolations.push({ message: `REGISTRY: allow table of ${layer} references unknown layer: ${target}` });
			}
		}
	}
	for (const layer of memberLayers) {
		if (!allowLayers.has(layer)) {
			registryViolations.push({ message: `REGISTRY: member table layer missing from allow table: ${layer}` });
		}
	}

	const effectiveAllow = new Map<string, Set<string>>();
	for (const [layer, allow] of Object.entries(registry.layers)) {
		effectiveAllow.set(layer, new Set(allow));
	}
	for (const pkg of packages) {
		const layer = `packages/${pkg.dir}`;
		const allow = effectiveAllow.get(layer) ?? new Set<string>();
		if (!pkg.private) {
			for (const dependency of pkg.dependencies) {
				const target = packages.find((candidate) => candidate.name === dependency);
				if (target && !target.private) allow.add(`packages/${target.dir}`);
			}
		}
		effectiveAllow.set(layer, allow);
	}
	for (const layer of experimentalLayers) {
		const dir = layer.slice("packages/".length, -":experimental".length);
		const pkg = byDir.get(dir);
		if (!pkg) continue;
		const allow = effectiveAllow.get(layer) ?? new Set<string>();
		for (const dependency of pkg.dependencies) {
			const target = packages.find((candidate) => candidate.name === dependency);
			if (target && !target.private) allow.add(`packages/${target.dir}`);
		}
		allow.add(`packages/${pkg.dir}`);
		effectiveAllow.set(layer, allow);
	}

	return { effectiveAllow, experimentalLayers, experimentalDirs, registryViolations };
}

/** Member-table paths matching `repoRelativePath` (registered directories end with `/`). */
function matchMemberLayers(repoRelativePath: string, layerMembers: Record<string, string[]>): string[] {
	const matches: string[] = [];
	for (const [layer, paths] of Object.entries(layerMembers)) {
		for (const path of paths) {
			if (path.endsWith("/") ? repoRelativePath.startsWith(path) : repoRelativePath === path) {
				matches.push(layer);
				break;
			}
		}
	}
	return matches;
}

/**
 * Layer for a single repo-relative path, or `undefined` when it belongs to no layer.
 * Used both for scan targets and for resolution targets outside the scan set (a
 * `.json` file or a file beyond the tsconfig scope is still layer-judged; spec
 * requirement "走査対象外の解決先も層と dev の判定を受ける", verify2 W-2).
 */
export function layerForPath(
	repoRelativePath: string,
	byDir: Map<string, PackageInfo>,
	model: LayerModel,
	registry: RegistryData,
): string | undefined {
	const memberMatches = matchMemberLayers(repoRelativePath, registry.layerMembers);
	if (memberMatches.length > 1) return undefined;
	if (memberMatches.length === 1) return memberMatches[0];
	const parts = repoRelativePath.split("/");
	if (parts[0] !== "packages" || parts.length < 3) return undefined;
	const pkg = byDir.get(parts[1]);
	if (!pkg || pkg.private) return undefined;
	const dirs = model.experimentalDirs.get(pkg.dir) ?? [];
	const prefix = `packages/${pkg.dir}/`;
	const rest = repoRelativePath.slice(prefix.length);
	const experimental = dirs.some((dir) => rest === dir || rest.startsWith(`${dir}/`));
	return experimental ? `packages/${pkg.dir}:experimental` : `packages/${pkg.dir}`;
}

/**
 * Assign a layer to every scanned src file. Files matching a `registry:layer-members`
 * layer get it; public package files derive theirs from their package (or its
 * exception layer); private packages must be registered. Unregistered files are
 * reported as unknown rather than assigned to a default layer.
 */
export function assignLayers(
	repoRoot: string,
	repoRelativeFiles: readonly string[],
	model: LayerModel,
	registry: RegistryData,
): AssignedLayers {
	const packages = listPackages(repoRoot);
	const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));

	const layerOf = new Map<string, string>();
	const unknownFiles: string[] = [];
	const multiMatchFiles: string[] = [];

	for (const repoRelativePath of repoRelativeFiles) {
		if (isDevFile(repoRelativePath)) continue;
		const memberMatches = matchMemberLayers(repoRelativePath, registry.layerMembers);
		if (memberMatches.length > 1) {
			multiMatchFiles.push(repoRelativePath);
			continue;
		}
		if (memberMatches.length === 1) {
			layerOf.set(repoRelativePath, memberMatches[0]);
			continue;
		}
		const layer = layerForPath(repoRelativePath, byDir, model, registry);
		if (layer === undefined) {
			unknownFiles.push(repoRelativePath);
			continue;
		}
		layerOf.set(repoRelativePath, layer);
	}

	return { layerOf, unknownFiles, multiMatchFiles };
}
