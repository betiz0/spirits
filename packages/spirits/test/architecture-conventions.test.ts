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

/**
 * The settings panel draws pi-tui widgets, so the command layer needs `packages/tui`. The routing layer
 * picks models and never renders, so it keeps the narrower allowance it had. Both directions are read
 * out of one fixture that holds a legal import and an illegal one, because the table only says
 * something when the check can be shown agreeing with it (spec `architecture-conventions`).
 */
const PI_TUI_FIXTURE = join(import.meta.dir, "fixtures", "architecture", "layer-pi-tui");

async function piTuiFixtureReport(): Promise<CheckReport> {
	const registry = join(PI_TUI_FIXTURE, "docs", "architecture", "convention-registry.md");
	return checkArchitectureConventions(PI_TUI_FIXTURE, registry);
}

test("commands may import pi-tui", async () => {
	const report = await piTuiFixtureReport();

	expect(report.layerOf.get("packages/spirits/src/commands/panel.ts")).toBe("spirits:commands");
	expect(report.violations.filter((violation) => violation.message.includes("src/commands/panel.ts"))).toEqual([]);
	// The real repository carries the same allowance, because that is where the panel lives.
	expect(loadRegistry(REAL_REGISTRY).data!.layers["spirits:commands"]).toContain("packages/tui");
}, 30_000);

test("routing may not import pi-tui", async () => {
	const report = await piTuiFixtureReport();

	const leak = report.violations.filter((violation) => violation.message.includes("src/routing/leak.ts"));
	expect(leak.length).toBe(1);
	expect(leak[0]!.ruleId).toBe("ARCH-SPIRITS-LAYER");
	expect(leak[0]!.message).toContain("spirits:routing");
	expect(leak[0]!.message).toContain("packages/tui");

	expect(loadRegistry(REAL_REGISTRY).data!.layers["spirits:routing"]).not.toContain("packages/tui");
}, 30_000);
