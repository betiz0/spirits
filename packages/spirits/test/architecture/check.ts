/**
 * Entry point of the architecture-conventions check (design decision 13).
 *
 * `checkArchitectureConventions(repoRoot, registryPath, launch?)` takes a repository
 * root and a registry path and returns the violations; the real-repository check and
 * the fixture tests share this entry. The analyzer launch function is injectable so a
 * startup failure can be reproduced without touching the filesystem.
 */
import { join, relative } from "node:path";
import { assignLayers, buildLayerModel, layerForPath, listPackages } from "./layers.ts";
import { loadRegistry, type Violation } from "./registry.ts";
import { REPORTABLE_RULE_IDS, runRules } from "./rules.ts";
import { scanRepository, type LaunchAnalyzer } from "./scan.ts";
import type { RegistryData } from "./registry.ts";

export const DEFAULT_REGISTRY_PATH = join("docs", "architecture", "convention-registry.md");

export interface CheckReport {
	violations: Violation[];
	fileCount: number;
	valueEdgeCount: number;
	typeEdgeCount: number;
	/** Repo-relative src file path -> layer. */
	layerOf: Map<string, string>;
	/** Actual file-level cycles (sorted repo-relative path lists). */
	cycles: string[][];
	duplication: { baseline: number; count: number };
}

function emptyReport(registry?: RegistryData): CheckReport {
	return {
		violations: [],
		fileCount: 0,
		valueEdgeCount: 0,
		typeEdgeCount: 0,
		layerOf: new Map(),
		cycles: [],
		duplication: { baseline: registry?.duplicationBaseline ?? 0, count: 0 },
	};
}

/**
 * Check the repository at `repoRoot` against the convention registry. Registry
 * problems and scan failures are structural violations reported without a rule ID.
 */
export async function checkArchitectureConventions(
	repoRoot: string,
	registryPath: string = join(repoRoot, DEFAULT_REGISTRY_PATH),
	launch?: LaunchAnalyzer,
): Promise<CheckReport> {
	const registryLoad = loadRegistry(registryPath, REPORTABLE_RULE_IDS);
	if (registryLoad.violations.length > 0) {
		return { ...emptyReport(), violations: registryLoad.violations };
	}
	const registry = registryLoad.data!;

	const scan = await scanRepository(repoRoot, launch);
	if (scan.error !== undefined) {
		return { ...emptyReport(registry), violations: [{ message: scan.error }] };
	}

	const model = buildLayerModel(repoRoot, registry);
	if (model.registryViolations.length > 0) {
		return { ...emptyReport(registry), violations: model.registryViolations };
	}

	const repoRelativeFiles = scan.files.map((file) => relative(repoRoot, file)).sort();
	const assigned = assignLayers(repoRoot, repoRelativeFiles, model, registry);

	const violations: Violation[] = [];
	for (const file of assigned.multiMatchFiles) {
		violations.push({
			message: `REGISTRY: file matches more than one registry:layer-members layer: ${file}`,
		});
	}
	for (const file of assigned.unknownFiles) {
		violations.push({
			ruleId: "ARCH-LAYER-UNKNOWN",
			message: `ARCH-LAYER-UNKNOWN: src file belongs to no layer: ${file}`,
		});
	}

	const byDir = new Map(listPackages(repoRoot).map((pkg) => [pkg.dir, pkg]));
	const ruleReport = runRules({
		repoRoot,
		files: scan.files,
		edges: scan.edges,
		dupNodes: scan.dupNodes,
		paths: scan.rootPaths ?? {},
		layerOf: assigned.layerOf,
		effectiveAllow: model.effectiveAllow,
		registry,
		layerForTarget: (repoRelativePath) => layerForPath(repoRelativePath, byDir, model, registry),
	});

	return {
		violations: [...violations, ...ruleReport.violations],
		fileCount: scan.files.length,
		valueEdgeCount: ruleReport.stats.valueEdgeCount,
		typeEdgeCount: ruleReport.stats.typeEdgeCount,
		layerOf: assigned.layerOf,
		cycles: ruleReport.cycles,
		duplication: { baseline: ruleReport.duplication.baseline, count: ruleReport.duplication.count },
	};
}
