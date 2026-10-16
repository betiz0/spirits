/**
 * Convention rules (design decisions 6, 7, 11 and the convention table of decision 12).
 *
 * Every violation carries the convention ID that the registry must define. Structural
 * failures (unreadable registry, unusable tsconfig) are reported by the caller without
 * a rule ID.
 */
import { relative } from "node:path";
import { isInternalSpecifier, resolveInternalSpecifier } from "./resolve.ts";
import { isDevFile } from "./layers.ts";
import type { RegistryData, Violation } from "./registry.ts";
import type { DupNode, Edge } from "./scan.ts";

/** Rule IDs the checker can report; each must have a section in the registry. */
export const REPORTABLE_RULE_IDS = [
	"ARCH-LAYER",
	"ARCH-LAYER-UNKNOWN",
	"ARCH-REPL",
	"ARCH-SPIRITS-LAYER",
	"ARCH-PI-BOUNDARY",
	"ARCH-SRC-DEV",
	"ARCH-RESOLVE",
	"ARCH-CYCLE",
	"ARCH-DUP",
] as const;

export interface ResolvedEdge {
	edge: Edge;
	/** Absolute path of the resolved target, or undefined when unresolvable. */
	target: string | undefined;
}

export interface DuplicationGroup {
	text: string;
	locations: string[];
}

export interface RuleContext {
	repoRoot: string;
	/** All scanned files (absolute paths). */
	files: string[];
	edges: Edge[];
	dupNodes: DupNode[];
	/** The root tsconfig's `paths`. */
	paths: Record<string, readonly string[]>;
	/** Repo-relative file path -> layer. */
	layerOf: Map<string, string>;
	/** Effective allow directions per layer. */
	effectiveAllow: Map<string, Set<string>>;
	registry: RegistryData;
	/** Layer lookup for resolution targets outside the scan set (a `.json` file or a
	 *  file beyond the tsconfig scope is still layer-judged; verify2 W-2). */
	layerForTarget: (repoRelativePath: string) => string | undefined;
}

export interface RuleReport {
	violations: Violation[];
	/** Actual file-level cycles as sorted repo-relative path lists. */
	cycles: string[][];
	duplication: {
		baseline: number;
		count: number;
		groups: DuplicationGroup[];
	};
	stats: { valueEdgeCount: number; typeEdgeCount: number };
}

const SPIRITS_SRC_PREFIX = "packages/spirits/src/";
const SPIRITS_BIN_PREFIX = "packages/spirits/bin/";

/** Run every convention rule over the scanned repository. */
export function runRules(context: RuleContext): RuleReport {
	const { repoRoot, files, edges, paths, layerOf, effectiveAllow, registry } = context;
	const rel = (file: string) => relative(repoRoot, file);
	const fileSet = new Set(files);
	const violations: Violation[] = [];

	// Resolve every internal specifier once; external specifiers are never judged.
	const resolved = new Map<string, ResolvedEdge>();
	for (const edge of edges) {
		let target: string | undefined;
		if (isInternalSpecifier(edge.specifier)) {
			target = resolveInternalSpecifier(repoRoot, paths, edge.from, edge.specifier);
			if (target !== undefined && target !== repoRoot && !target.startsWith(`${repoRoot}/`)) {
				target = undefined;
			}
		}
		resolved.set(edgeKey(edge), { edge, target });
	}

	// ARCH-RESOLVE: internal specifiers must resolve to files inside the repository.
	for (const { edge, target } of resolved.values()) {
		if (isInternalSpecifier(edge.specifier) && target === undefined) {
			violations.push({
				ruleId: "ARCH-RESOLVE",
				message: `ARCH-RESOLVE: unresolved internal specifier: ${rel(edge.from)} (${edge.specifier})`,
			});
		}
	}

	// Layer judgment uses src-originated edges only (decision 11). Resolution targets
	// outside the scan set (`.json`, beyond the tsconfig scope) are still judged.
	const layerFor = (absolutePath: string): string | undefined => {
		if (fileSet.has(absolutePath)) return layerOf.get(rel(absolutePath));
		return context.layerForTarget(rel(absolutePath));
	};
	const layerEdges: { from: string; to: string; type: "value" | "type"; specifier: string }[] = [];
	for (const { edge, target } of resolved.values()) {
		const fromRel = rel(edge.from);
		if (isDevFile(fromRel)) continue;
		if (target === undefined) continue;
		const toRel = rel(target);
		if (isDevFile(toRel)) {
			violations.push({
				ruleId: "ARCH-SRC-DEV",
				message: `ARCH-SRC-DEV: src imports a dev file (${edge.type}): ${fromRel} -> ${toRel} (${edge.specifier})`,
			});
			continue;
		}
		const fromLayer = layerFor(edge.from);
		const toLayer = layerFor(target);
		if (fromLayer === undefined || toLayer === undefined) continue;
		if (fromLayer === toLayer) continue;
		layerEdges.push({ from: edge.from, to: target, type: edge.type, specifier: edge.specifier });
		const allow = effectiveAllow.get(fromLayer);
		if (allow && !allow.has(toLayer)) {
			const ruleId =
				fromLayer === "spirits:repl"
					? "ARCH-REPL"
					: fromLayer.startsWith("spirits:")
						? "ARCH-SPIRITS-LAYER"
						: "ARCH-LAYER";
			violations.push({
				ruleId,
				message: `${ruleId}: ${edge.type} dependency not allowed: ${fromLayer} -> ${toLayer}: ${fromRel} -> ${toRel} (${edge.specifier})`,
			});
		}
	}

	// ARCH-PI-BOUNDARY: spirits src imports Pi as bare specifiers only; bin deep
	// imports must exactly match the registry allowlist.
	const usedBinDeepImports = new Set<string>();
	for (const { edge } of resolved.values()) {
		const fromRel = rel(edge.from);
		if (!fromRel.startsWith("packages/spirits/")) continue;
		if (!edge.specifier.startsWith("@earendil-works/")) continue;
		const subpath = edge.specifier.slice("@earendil-works/".length);
		const isDeep = subpath.includes("/");
		if (!isDeep) continue;
		if (fromRel.startsWith(SPIRITS_SRC_PREFIX)) {
			violations.push({
				ruleId: "ARCH-PI-BOUNDARY",
				message: `ARCH-PI-BOUNDARY: src deep import of a Pi package: ${fromRel} (${edge.specifier})`,
			});
		} else if (fromRel.startsWith(SPIRITS_BIN_PREFIX)) {
			if (!registry.binDeepImports.includes(edge.specifier)) {
				violations.push({
					ruleId: "ARCH-PI-BOUNDARY",
					message: `ARCH-PI-BOUNDARY: bin deep import not in the allowlist: ${fromRel} (${edge.specifier})`,
				});
			} else {
				usedBinDeepImports.add(edge.specifier);
			}
		}
	}
	for (const entry of registry.binDeepImports) {
		if (!usedBinDeepImports.has(entry)) {
			violations.push({
				ruleId: "ARCH-PI-BOUNDARY",
				message: `ARCH-PI-BOUNDARY: bin allowlist entry is not used by any import: ${entry}`,
			});
		}
	}

	// ARCH-CYCLE (layer graph): the value-dependency graph between layers must be acyclic.
	const layerCycles = findLayerCycles(layerEdges, layerFor);
	for (const cycle of layerCycles) {
		violations.push({
			ruleId: "ARCH-CYCLE",
			message: `ARCH-CYCLE: layer graph cycle: ${cycle.join(" -> ")}`,
		});
	}

	// ARCH-CYCLE (file level): strongly connected components of the value graph.
	const cycles = findFileCycles(resolved, rel, fileSet);
	const actualCycleKeys = new Set(cycles.map((cycle) => cycle.join("\n")));
	const registeredCycleKeys = new Set(registry.cycles.map((cycle) => [...cycle].sort().join("\n")));
	for (const cycle of cycles) {
		if (!registeredCycleKeys.has(cycle.join("\n"))) {
			violations.push({
				ruleId: "ARCH-CYCLE",
				message: `ARCH-CYCLE: unregistered file cycle: ${cycle.join(", ")}`,
			});
		}
	}
	for (const registered of registry.cycles) {
		const key = [...registered].sort().join("\n");
		if (!actualCycleKeys.has(key)) {
			violations.push({
				ruleId: "ARCH-CYCLE",
				message: `ARCH-CYCLE: registered cycle no longer exists: ${registered.join(", ")}`,
			});
		}
	}

	// ARCH-DUP: duplicate group count must equal the registry baseline.
	const groupsByText = new Map<string, DuplicationGroup>();
	for (const node of context.dupNodes) {
		if (isDevFile(rel(node.file))) continue;
		const group = groupsByText.get(node.text) ?? { text: node.text, locations: [] };
		group.locations.push(`${rel(node.file)}:${node.line}`);
		groupsByText.set(node.text, group);
	}
	const groups = [...groupsByText.values()].filter((group) => group.locations.length >= 2);
	const count = groups.length;
	if (count !== registry.duplicationBaseline) {
		const detail = groups
			.map((group) => `    ${group.locations.join(", ")}: ${group.text.slice(0, 80)}`)
			.join("\n");
		violations.push({
			ruleId: "ARCH-DUP",
			message:
				count > registry.duplicationBaseline
					? `ARCH-DUP: duplicate group count ${count} exceeds the registry baseline ${registry.duplicationBaseline}; current groups:\n${detail}`
					: `ARCH-DUP: duplicate group count ${count} is below the registry baseline ${registry.duplicationBaseline}; lower the baseline in the registry to ${count}`,
		});
	}

	const valueEdgeCount = edges.filter((edge) => edge.type === "value").length;
	const typeEdgeCount = edges.length - valueEdgeCount;

	return {
		violations: dedupeViolations(violations),
		cycles,
		duplication: { baseline: registry.duplicationBaseline, count, groups },
		stats: { valueEdgeCount, typeEdgeCount },
	};
}

/** Edges are keyed by importer, specifier, and kind: a file may hold both a value
 * and a type edge for the same specifier, and keying by specifier alone would let the
 * later type edge erase the value edge (decision 11; verify2 C-1). */
function edgeKey(edge: Edge): string {
	return `${edge.from}${edge.specifier}${edge.type}`;
}

function dedupeViolations(violations: Violation[]): Violation[] {
	const seen = new Set<string>();
	const result: Violation[] = [];
	for (const violation of violations) {
		const key = `${violation.ruleId ?? ""} ${violation.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(violation);
	}
	return result;
}

/** Cycles in the layer value graph (src-originated value edges between layers). */
function findLayerCycles(
	layerEdges: { from: string; to: string; type: "value" | "type"; specifier: string }[],
	layerFor: (absolutePath: string) => string | undefined,
): string[][] {
	const valueLayerEdges = layerEdges.filter((entry) => entry.type === "value");
	const adjacency = new Map<string, Set<string>>();
	for (const entry of valueLayerEdges) {
		const fromLayer = layerFor(entry.from);
		const toLayer = layerFor(entry.to);
		if (fromLayer === undefined || toLayer === undefined || fromLayer === toLayer) continue;
		const targets = adjacency.get(fromLayer) ?? new Set<string>();
		targets.add(toLayer);
		adjacency.set(fromLayer, targets);
	}

	const state = new Map<string, number>();
	const stack: string[] = [];
	const cycles: string[][] = [];
	const visit = (node: string): void => {
		state.set(node, 1);
		stack.push(node);
		for (const target of adjacency.get(node) ?? []) {
			if (state.get(target) === 1) {
				cycles.push(stack.slice(stack.indexOf(target)).concat(target));
			} else if (!state.has(target)) {
				visit(target);
			}
		}
		stack.pop();
		state.set(node, 2);
	};
	for (const node of [...adjacency.keys()].sort()) {
		if (!state.has(node)) visit(node);
	}
	return cycles;
}

/** Strongly connected components of the file value graph; cycles are components of
 * two or more files, or a single file importing itself. */
function findFileCycles(
	resolved: Map<string, ResolvedEdge>,
	rel: (file: string) => string,
	fileSet: Set<string>,
): string[][] {
	const adjacency = new Map<string, string[]>();
	for (const { edge, target } of resolved.values()) {
		if (edge.type !== "value") continue;
		if (target === undefined || !fileSet.has(edge.from) || !fileSet.has(target)) continue;
		if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
		adjacency.get(edge.from)!.push(target);
	}

	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	let counter = 0;
	const components: string[][] = [];

	const strongConnect = (start: string): void => {
		const work: [string, number][] = [[start, 0]];
		index.set(start, counter);
		low.set(start, counter);
		counter++;
		stack.push(start);
		onStack.add(start);
		while (work.length > 0) {
			const [vertex, pointer] = work[work.length - 1];
			const successors = adjacency.get(vertex) ?? [];
			if (pointer < successors.length) {
				work[work.length - 1][1] = pointer + 1;
				const successor = successors[pointer];
				if (!index.has(successor)) {
					index.set(successor, counter);
					low.set(successor, counter);
					counter++;
					stack.push(successor);
					onStack.add(successor);
					work.push([successor, 0]);
				} else if (onStack.has(successor)) {
					low.set(vertex, Math.min(low.get(vertex)!, index.get(successor)!));
				}
			} else {
				if (low.get(vertex) === index.get(vertex)) {
					const component: string[] = [];
					let member: string;
					do {
						member = stack.pop()!;
						onStack.delete(member);
						component.push(member);
					} while (member !== vertex);
					components.push(component);
				}
				work.pop();
				if (work.length > 0) {
					const parent = work[work.length - 1][0];
					low.set(parent, Math.min(low.get(parent)!, low.get(vertex)!));
				}
			}
		}
	};

	for (const file of [...fileSet].sort()) {
		if (!index.has(file)) strongConnect(file);
	}

	return components
		.filter((component) => component.length >= 2 || (component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0])))
		.map((component) => component.map(rel).sort());
}
