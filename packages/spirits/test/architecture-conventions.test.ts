/**
 * Real-repository check: the actual repository is passed through the same entry point
 * as the fixture tests, and must produce no violations. The check runs once in
 * `beforeAll` and is shared; the hook and every test carry an explicit 30 second
 * timeout (design decision 5).
 */
import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { checkArchitectureConventions, type CheckReport } from "./architecture/check.ts";
import { findRepoRoot } from "./architecture/repo.ts";
import { loadRegistry } from "./architecture/registry.ts";
import { REPORTABLE_RULE_IDS } from "./architecture/rules.ts";

const REAL_ROOT = findRepoRoot(import.meta.dir)!;
const REAL_REGISTRY = join(REAL_ROOT, "docs", "architecture", "convention-registry.md");

let report: CheckReport;

beforeAll(async () => {
	report = await checkArchitectureConventions(REAL_ROOT, REAL_REGISTRY);
}, 30_000);

test("real repo: no violations", () => {
	expect(report.violations).toEqual([]);
}, 30_000);

test("real repo: cycles and duplication match the registry", () => {
	const load = loadRegistry(REAL_REGISTRY);
	expect(load.violations).toEqual([]);
	const registry = load.data!;
	const registeredCycles = new Set(registry.cycles.map((cycle) => [...cycle].sort().join("\n")));
	expect(report.cycles.length).toBe(registeredCycles.size);
	for (const cycle of report.cycles) {
		expect(registeredCycles.has(cycle.join("\n"))).toBe(true);
	}
	expect(report.duplication.count).toBe(registry.duplicationBaseline);
}, 30_000);

test("real repo: every reportable rule id exists in the registry", () => {
	const load = loadRegistry(REAL_REGISTRY, REPORTABLE_RULE_IDS);
	expect(load.violations).toEqual([]);
}, 30_000);
