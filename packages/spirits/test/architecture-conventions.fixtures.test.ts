/**
 * Fixture tests for the architecture-conventions check (design decision 13).
 *
 * Every convention is exercised against a small synthetic repository under
 * `test/fixtures/architecture/`: each fixture has its own `package.json`,
 * `tsconfig.json`, `packages/`, and registry, and is checked through the same entry
 * point as the real repository. The real repository scan runs once in `beforeAll` and
 * is shared; the hook and every test carry an explicit 30 second timeout (decision 5).
 */
import { beforeAll, expect, test } from "bun:test";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { assignLayers, buildLayerModel, isDevFile } from "./architecture/layers.ts";
import { checkArchitectureConventions, type CheckReport } from "./architecture/check.ts";
import { findRepoRoot } from "./architecture/repo.ts";
import { loadRegistry } from "./architecture/registry.ts";
import { REPORTABLE_RULE_IDS } from "./architecture/rules.ts";
import { scanRepository, type ScanResult } from "./architecture/scan.ts";
import { isInternalSpecifier, resolveInternalSpecifier } from "./architecture/resolve.ts";

const REAL_ROOT = findRepoRoot(import.meta.dir)!;
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "architecture");
const fixtureRoot = (name: string): string => join(FIXTURES_DIR, name);

let realScan: ScanResult;
let realReport: CheckReport;

beforeAll(async () => {
	realScan = await scanRepository(REAL_ROOT);
	realReport = await checkArchitectureConventions(REAL_ROOT);
}, 30_000);

async function checkFixture(name: string, registryRelPath = "docs/architecture/convention-registry.md"): Promise<CheckReport> {
	const root = fixtureRoot(name);
	return await checkArchitectureConventions(root, join(root, registryRelPath));
}

async function analyzeFixture(name: string) {
	const root = fixtureRoot(name);
	const scan = await scanRepository(root);
	const load = loadRegistry(join(root, "docs/architecture/convention-registry.md"), REPORTABLE_RULE_IDS);
	const model = buildLayerModel(root, load.data!);
	const files = scan.files.map((file) => relative(root, file)).sort();
	const assigned = assignLayers(root, files, model, load.data!);
	return { root, scan, load, model, assigned };
}

function fixturePaths(name: string): Record<string, readonly string[]> {
	const root = fixtureRoot(name);
	return JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")).compilerOptions.paths;
}

// --------------------------------------------------------------- 1.1 registry

test("registry: missing file fails", async () => {
	const report = await checkArchitectureConventions(
		fixtureRoot("clean"),
		join(fixtureRoot("clean"), "docs/architecture/missing.md")
	);
	expect(report.violations.length).toBeGreaterThan(0);
	expect(report.violations[0]!.message).toContain("REGISTRY");
}, 30_000);

test("registry: missing block fails", async () => {
	const report = await checkFixture("registry-missing-block");
	expect(report.violations.some((v) => v.message.includes("registry:duplication"))).toBe(true);
}, 30_000);

test("registry: invalid JSON fails", async () => {
	const report = await checkFixture("registry-invalid-json");
	expect(report.violations.some((v) => v.message.includes("not valid JSON"))).toBe(true);
}, 30_000);

test("registry: non-integer baseline fails", async () => {
	const report = await checkFixture("registry-bad-baseline");
	expect(report.violations.some((v) => v.message.includes("baseline"))).toBe(true);
}, 30_000);

test("registry: allow table value that is not a string array fails", async () => {
	const report = await checkFixture("registry-allow-not-array");
	expect(report.violations.some((v) => v.message.includes("not a string array"))).toBe(true);
}, 30_000);

test("registry: unknown layer in allow table or member table fails", async () => {
	const report = await checkFixture("registry-unknown-layer");
	expect(report.violations.length).toBeGreaterThan(0);
	expect(report.violations[0]!.message).toContain("unknown layer");

	// an allow-table key that is not a known layer (spec scenario: `spirits:typo`)
	const unknownKey = await checkFixture("registry-unknown-allow-key");
	expect(
		unknownKey.violations.some((v) => v.message.includes("unknown layer") && v.message.includes("spirits:typo"))
	).toBe(true);

	// a member-table layer that the allow table does not list
	const memberMismatch = await checkFixture("registry-member-allow-mismatch");
	expect(
		memberMismatch.violations.some(
			(v) => v.message.includes("member table layer missing from allow table") && v.message.includes("packages/ghost")
		)
	).toBe(true);
}, 30_000);

test("registry: public package layer in the allow table fails", async () => {
	// public package directions are derived from package.json; writing them in the
	// registry duplicates the management (decision 2, verify2 C-2)
	const report = await checkFixture("registry-public-package-key");
	expect(
		report.violations.some(
			(v) => v.message.includes("public package") && v.message.includes("packages/app") && v.message.includes("package.json")
		)
	).toBe(true);
}, 30_000);

test("registry: file matching two layers fails", async () => {
	const report = await checkFixture("registry-multi-match");
	expect(report.violations.some((v) => v.message.includes("more than one"))).toBe(true);
}, 30_000);

test("root discovery: same root from another cwd", async () => {
	const fromTest = findRepoRoot(import.meta.dir);
	const fromSrc = findRepoRoot(join(REAL_ROOT, "packages", "spirits", "src"));
	const fromDeep = findRepoRoot(join(REAL_ROOT, "packages", "coding-agent", "test"));
	expect(fromTest).toBe(REAL_ROOT);
	expect(fromSrc).toBe(REAL_ROOT);
	expect(fromDeep).toBe(REAL_ROOT);

	const previousCwd = process.cwd();
	process.chdir("/tmp");
	try {
		const report = await checkArchitectureConventions(REAL_ROOT);
		expect(report.violations).toEqual(realReport.violations);
	} finally {
		process.chdir(previousCwd);
	}
}, 30_000);

// --------------------------------------------------------------- 1.2 registry

test("registry: every convention section has strength, content, exceptions, method and rationale", () => {
	const load = loadRegistry(join(REAL_ROOT, "docs/architecture/convention-registry.md"), REPORTABLE_RULE_IDS);
	expect(load.violations).toEqual([]);
}, 30_000);

// ------------------------------------------------------------------ 2.1 scan

test("scan: zero files fails", async () => {
	const scan = await scanRepository(fixtureRoot("scan-empty"));
	expect(scan.error).toBeDefined();
	expect(scan.error).toContain("no files");
}, 30_000);

test("scan: unusable tsconfig fails", async () => {
	const scan = await scanRepository(fixtureRoot("scan-bad-tsconfig"));
	expect(scan.error).toBeDefined();
	expect(scan.error).toContain("unusable tsconfig");
}, 30_000);

test("scan: analyzer startup failure fails", async () => {
	const scan = await scanRepository(fixtureRoot("clean"), async () => {
		throw new Error("startup failed");
	});
	expect(scan.error).toBeDefined();
	expect(scan.error).toContain("analyzer failed to start");
}, 30_000);

test("scan: fixtures are not part of the real repo scan", () => {
	expect(realScan.error).toBeUndefined();
	expect(realScan.files.every((file) => !file.includes("test/fixtures/architecture"))).toBe(true);
}, 30_000);

// ----------------------------------------------------------------- 2.2 edges

test("edges: import type and export type from are type edges", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	for (const specifier of ["./a.ts", "./b.ts", "./c.ts"]) {
		const matching = scan.edges.filter((edge) => edge.specifier === specifier);
		expect(matching.length).toBeGreaterThan(0);
		expect(matching.every((edge) => edge.type === "type")).toBe(true);
	}
}, 30_000);

test("edges: type-position import() is a type edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const matching = scan.edges.filter((edge) => edge.specifier === "./k.ts");
	expect(matching.length).toBeGreaterThan(0);
	expect(matching.every((edge) => edge.type === "type")).toBe(true);
}, 30_000);

test("edges: all-inline-type import is a value edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const matching = scan.edges.filter((edge) => edge.specifier === "./d.ts");
	expect(matching.length).toBeGreaterThan(0);
	expect(matching.every((edge) => edge.type === "value")).toBe(true);
}, 30_000);

test("edges: mixed inline type import is a value edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const matching = scan.edges.filter((edge) => edge.specifier === "./e.ts");
	expect(matching.length).toBeGreaterThan(0);
	expect(matching.every((edge) => edge.type === "value")).toBe(true);
}, 30_000);

test("edges: literal dynamic import is a value edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const matching = scan.edges.filter((edge) => edge.specifier === "./i.ts");
	expect(matching.length).toBeGreaterThan(0);
	expect(matching.every((edge) => edge.type === "value")).toBe(true);
}, 30_000);

test("edges: no-substitution template dynamic import is a value edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const matching = scan.edges.filter((edge) => edge.specifier === "./j.ts");
	expect(matching.length).toBeGreaterThan(0);
	expect(matching.every((edge) => edge.type === "value")).toBe(true);
}, 30_000);

test("edges: non-literal dynamic import is not an edge", async () => {
	const scan = await scanRepository(fixtureRoot("edges"));
	const fromMain = scan.edges.filter((edge) => edge.from === join(fixtureRoot("edges"), "main.ts"));
	const specifiers = new Set(fromMain.map((edge) => edge.specifier));
	expect(specifiers).toEqual(
		new Set(["./a.ts", "./b.ts", "./c.ts", "./d.ts", "./e.ts", "./f.ts", "./h.ts", "./i.ts", "./j.ts", "./k.ts"])
	);
}, 30_000);

// --------------------------------------------------------------- 2.3 resolve

test("resolve: pi-coding-agent from spirits src resolves to packages/coding-agent", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/spirits/src/repl/cell.ts");
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "@earendil-works/pi-coding-agent")).toBe(
		join(root, "packages/pi-coding-agent/src/index.ts")
	);
}, 30_000);

test("resolve: spirits stub paths are not used", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/spirits/src/repl/cell.ts");
	const resolved = resolveInternalSpecifier(root, fixturePaths("resolve"), from, "@earendil-works/pi-coding-agent");
	expect(resolved).not.toBe(join(root, "packages/spirits/src/types/stub.ts"));
}, 30_000);

test("resolve: exact key wins over wildcard", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/mod/src/entry.ts");
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "@earendil-works/pi-lib")).toBe(
		join(root, "packages/lib/src/exact.ts")
	);
}, 30_000);

test("resolve: extensions and index files are probed in order", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/mod/src/entry.ts");
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "./mod")).toBe(
		join(root, "packages/mod/src/mod.ts")
	);
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "./util")).toBe(
		join(root, "packages/mod/src/util/index.ts")
	);
}, 30_000);

test("resolve: multiple path targets are tried in order", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/second/src/only.ts");
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "@earendil-works/pi-multi/only")).toBe(
		join(root, "packages/second/src/only.ts")
	);
}, 30_000);

test("resolve: non-internal specifier in paths stays external", () => {
	const root = fixtureRoot("resolve");
	const from = join(root, "packages/mod/src/entry.ts");
	expect(isInternalSpecifier("typebox")).toBe(false);
	expect(resolveInternalSpecifier(root, fixturePaths("resolve"), from, "typebox")).toBeUndefined();
}, 30_000);

test("resolve: unresolved internal specifier is a violation", async () => {
	const report = await checkFixture("unresolved");
	expect(report.violations.some((v) => v.ruleId === "ARCH-RESOLVE")).toBe(true);
}, 30_000);

test("resolve: external specifier is not judged", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.ruleId === "ARCH-RESOLVE")).toEqual([]);
}, 30_000);

// ---------------------------------------------------------------- 2.4 layers

test("layers: public package direction derives from package.json", async () => {
	const { model } = await analyzeFixture("clean");
	expect(model.effectiveAllow.get("packages/util")?.has("packages/pi-core")).toBe(true);
}, 30_000);

test("layers: private package and experimental layer use the registry", async () => {
	const report = await checkFixture("layer-violations");
	expect(report.violations.filter((v) => v.message.includes("packages/app/src/experimental/index.ts"))).toEqual([]);
}, 30_000);

test("layers: experimental dirs derive from tsconfig.build.json exclude", async () => {
	const { model } = await analyzeFixture("layer-violations");
	expect(model.experimentalLayers).toContain("packages/app:experimental");
}, 30_000);

test("layers: non-directory exclude entries are not experimental dirs", async () => {
	const { model } = await analyzeFixture("clean");
	expect(model.experimentalLayers).toEqual([]);
}, 30_000);

test("layers: spirits files map to eight layers and index.ts is entry", async () => {
	const { assigned } = await analyzeFixture("clean");
	const layers = new Set(assigned.layerOf.values());
	for (const layer of [
		"spirits:repl",
		"spirits:rlm",
		"spirits:harness",
		"spirits:todo",
		"spirits:update",
		"spirits:shared",
		"spirits:entry",
		"spirits:bin",
	]) {
		expect(layers.has(layer)).toBe(true);
	}
	expect(assigned.layerOf.get("packages/spirits/src/index.ts")).toBe("spirits:entry");
}, 30_000);

test("layers: unregistered spirits directory fails as unknown layer", async () => {
	const report = await checkFixture("unknown-layer");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-LAYER-UNKNOWN" && v.message.includes("newdir/unregistered.ts"))
	).toBe(true);
}, 30_000);

test("layers: private package missing from the registry fails as unknown layer", async () => {
	const report = await checkFixture("unknown-layer");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-LAYER-UNKNOWN" && v.message.includes("packages/newpkg/src/index.ts")
		)
	).toBe(true);
}, 30_000);

test("layers: dev files are classified", () => {
	expect(isDevFile("packages/spirits/test/foo.ts")).toBe(true);
	expect(isDevFile("packages/ai/test/foo.ts")).toBe(true);
	expect(isDevFile("packages/ai/examples/foo.ts")).toBe(true);
	expect(isDevFile("packages/ai/vitest.config.ts")).toBe(true);
	expect(isDevFile("packages/ai/scripts/run.ts")).toBe(true);
	expect(isDevFile("scripts/build.ts")).toBe(true);
	expect(isDevFile("tsconfig.json")).toBe(true);
	expect(isDevFile("vitest.base.ts")).toBe(true);
	expect(isDevFile("packages/spirits/src/index.ts")).toBe(false);
	expect(isDevFile("packages/ai/src/index.ts")).toBe(false);
	// paths outside packages/ that are neither root scripts/ nor root-level files
	// are not dev, but they are never scan targets either (verify2 G-3)
	expect(isDevFile("docs/architecture/convention-registry.md")).toBe(false);
}, 30_000);

// --------------------------------------------------------------- 3.1 layers

test("layer: allowed direction passes", async () => {
	const report = await checkFixture("clean");
	expect(
		report.violations.filter(
			(v) => v.ruleId === "ARCH-LAYER" || v.ruleId === "ARCH-SPIRITS-LAYER" || v.ruleId === "ARCH-REPL"
		)
	).toEqual([]);
}, 30_000);

test("layer: disallowed direction fails with rule id and paths", async () => {
	const report = await checkFixture("layer-violations");
	const violation = report.violations.find(
		(v) => v.ruleId === "ARCH-LAYER" && v.message.includes("packages/app/src/index.ts")
	);
	expect(violation).toBeDefined();
	expect(violation!.message).toContain("packages/app/src/index.ts");
	expect(violation!.message).toContain("packages/pi-core/src/index.ts");
}, 30_000);

test("layer: type edge is checked and labeled as type", async () => {
	const report = await checkFixture("layer-violations");
	const violation = report.violations.find((v) => v.ruleId === "ARCH-LAYER" && v.message.includes("type"));
	expect(violation).toBeDefined();
	expect(violation!.message).toContain("packages/app/src/type-only.ts");
}, 30_000);

test("layer: adding a workspace dependency allows the direction", async () => {
	// the clean fixture's util package declares pi-core in package.json and imports it
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.message.includes("packages/util"))).toEqual([]);
}, 30_000);

test("layer: undeclared workspace dependency fails", async () => {
	const report = await checkFixture("layer-violations");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-LAYER" && v.message.includes("packages/app/src/core/index.ts")
		)
	).toBe(true);
}, 30_000);

test("layer: external package is not judged", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.message.includes("typebox"))).toEqual([]);
}, 30_000);

test("layer: import from a dev file is not judged", async () => {
	const report = await checkFixture("layer-violations");
	expect(report.violations.filter((v) => v.message.includes("test/manual.ts"))).toEqual([]);
}, 30_000);

test("layer: experimental layer may import a registry-listed undeclared package", async () => {
	const report = await checkFixture("layer-violations");
	expect(
		report.violations.filter(
			(v) => v.message.includes("experimental/index.ts") && v.message.includes("pi-core")
		)
	).toEqual([]);
}, 30_000);

test("layer: experimental layer may import the same package", async () => {
	const report = await checkFixture("layer-violations");
	expect(
		report.violations.filter(
			(v) => v.message.includes("experimental/index.ts") && v.message.includes("core/index.ts")
		)
	).toEqual([]);
}, 30_000);

test("layer: non-experimental src importing an undeclared package fails", async () => {
	const report = await checkFixture("layer-violations");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-LAYER" && v.message.includes("packages/app/src/index.ts")
		)
	).toBe(true);
}, 30_000);

// --------------------------------------------------------------- 3.2 spirits

test("spirits: repl importing a later layer fails", async () => {
	const report = await checkFixture("spirits-violations");
	const replViolations = report.violations.filter((v) => v.ruleId === "ARCH-REPL");
	// static import
	expect(
		replViolations.some((v) => v.message.includes("../rlm/spawn.ts") && v.message.includes("value"))
	).toBe(true);
	// type-only import
	expect(replViolations.some((v) => v.message.includes("type") && v.message.includes("../todo/store.ts"))).toBe(
		true
	);
	// dynamic import
	expect(
		replViolations.filter((v) => v.message.includes("../todo/store.ts") && v.message.includes("value")).length
	).toBeGreaterThan(0);
}, 30_000);

test("spirits: repl to pi-coding-agent passes", async () => {
	// repl may import Pi (packages/coding-agent / packages/tui) as a bare specifier;
	// the clean fixture's cell.ts imports @earendil-works/pi-core exactly so (verify2 W-1)
	const report = await checkFixture("clean");
	expect(
		report.violations.filter(
			(v) => v.message.includes("packages/spirits/src/repl/cell.ts") && v.message.includes("@earendil-works/pi-core")
		)
	).toEqual([]);
}, 30_000);

test("spirits: rlm to repl passes", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.message.includes("packages/spirits/src/rlm/spawn.ts"))).toEqual([]);
}, 30_000);

test("spirits: harness to todo fails", async () => {
	const report = await checkFixture("spirits-violations");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-SPIRITS-LAYER" && v.message.includes("harness/todo-import.ts")
		)
	).toBe(true);
}, 30_000);

test("spirits: harness to rlm fails", async () => {
	const report = await checkFixture("spirits-violations");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-SPIRITS-LAYER" && v.message.includes("harness/rlm-import.ts")
		)
	).toBe(true);
}, 30_000);

test("spirits: rlm to entry fails", async () => {
	const report = await checkFixture("spirits-violations");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-SPIRITS-LAYER" && v.message.includes("rlm/entry-import.ts"))
	).toBe(true);
}, 30_000);

// ------------------------------------------------------------- 3.3 boundary

test("boundary: src deep import fails", async () => {
	const report = await checkFixture("boundary-violations");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-PI-BOUNDARY" && v.message.includes("deep-import.ts"))
	).toBe(true);
}, 30_000);

test("boundary: bin deep import outside the allowlist fails", async () => {
	const report = await checkFixture("boundary-violations");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-PI-BOUNDARY" && v.message.includes("runtime/env"))
	).toBe(true);
}, 30_000);

test("boundary: bin allowlisted deep import passes", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.ruleId === "ARCH-PI-BOUNDARY")).toEqual([]);
}, 30_000);

test("boundary: unused bin allowlist entry fails", async () => {
	const report = await checkFixture("boundary-violations");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-PI-BOUNDARY" && v.message.includes("bun/setup"))
	).toBe(true);
}, 30_000);

test("boundary: bare specifier passes", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.message.includes("@earendil-works/pi-core"))).toEqual([]);
}, 30_000);

// ------------------------------------------------------------------ 3.4 dev

test("dev: src importing test fails", async () => {
	const report = await checkFixture("dev-violations");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-SRC-DEV" && v.message.includes("value") && v.message.includes("test-import.ts")
		)
	).toBe(true);
}, 30_000);

test("dev: src importing test with import type fails", async () => {
	const report = await checkFixture("dev-violations");
	expect(
		report.violations.some(
			(v) =>
				v.ruleId === "ARCH-SRC-DEV" && v.message.includes("type") && v.message.includes("test-type-import.ts")
		)
	).toBe(true);
}, 30_000);

test("dev: test importing src is not judged", async () => {
	const report = await checkFixture("clean");
	expect(report.violations.filter((v) => v.message.includes("packages/spirits/test/smoke.ts"))).toEqual([]);
}, 30_000);

test("out-of-scope: .json target in another layer is judged with the layer rule id", async () => {
	// `packages/spirits/src/harness/data.json` is out of the scan (`.json` is excluded),
	// but it belongs to the spirits:harness layer, so repl importing it is ARCH-REPL
	const report = await checkFixture("out-of-scope");
	expect(
		report.violations.some(
			(v) =>
				v.ruleId === "ARCH-REPL" &&
				v.message.includes("packages/spirits/src/repl/cell.ts") &&
				v.message.includes("packages/spirits/src/harness/data.json")
		)
	).toBe(true);
}, 30_000);

test("out-of-scope: dev file beyond the tsconfig scope is judged as ARCH-SRC-DEV", async () => {
	// `packages/spirits/test/fixtures/fixture-file.ts` is beyond both tsconfigs' scope,
	// but it is a dev file, so src importing it is ARCH-SRC-DEV
	const report = await checkFixture("out-of-scope");
	expect(
		report.violations.some(
			(v) =>
				v.ruleId === "ARCH-SRC-DEV" &&
				v.message.includes("packages/spirits/src/config.ts") &&
				v.message.includes("packages/spirits/test/fixtures/fixture-file.ts")
		)
	).toBe(true);
}, 30_000);

// --------------------------------------------------------------- 3.5 cycles

test("cycles: new cycle fails", async () => {
	const report = await checkFixture("cycles", "docs/architecture/unregistered.md");
	expect(
		report.violations.some(
			(v) => v.ruleId === "ARCH-CYCLE" && v.message.includes("packages/app/src/a.ts") && !v.message.includes("no longer")
		)
	).toBe(true);
}, 30_000);

test("cycles: registered cycle passes", async () => {
	const report = await checkFixture("cycles");
	expect(report.violations).toEqual([]);
}, 30_000);

test("cycles: grown cycle fails", async () => {
	const report = await checkFixture("cycles-grown");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-CYCLE" && v.message.includes("packages/app/src/d.ts"))
	).toBe(true);
}, 30_000);

test("cycles: resolved cycle left in the registry fails", async () => {
	const report = await checkFixture("cycles-resolved");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-CYCLE" && v.message.includes("no longer exists"))
	).toBe(true);
}, 30_000);

test("cycles: layer graph cycle fails", async () => {
	const report = await checkFixture("cycles-layer");
	expect(
		report.violations.some((v) => v.ruleId === "ARCH-CYCLE" && v.message.includes("layer graph cycle"))
	).toBe(true);
}, 30_000);

test("cycles: cycle with both value and type imports of the same specifier is detected", async () => {
	// a.ts imports b.ts as a value and as a type; b.ts imports a.ts as a value.
	// Keying resolved edges by specifier alone would let the later type edge erase
	// the value edge and hide the value cycle (decision 11; verify2 C-1).
	const report = await checkFixture("cycles-mixed");
	expect(
		report.violations.some(
			(v) =>
				v.ruleId === "ARCH-CYCLE" &&
				v.message.includes("packages/app/src/a.ts") &&
				v.message.includes("packages/app/src/b.ts")
		)
	).toBe(true);
}, 30_000);

// ------------------------------------------------------------ 3.6 duplication

test("duplication: above the baseline fails", async () => {
	const report = await checkFixture("duplication", "docs/architecture/above-baseline.md");
	const violation = report.violations.find((v) => v.ruleId === "ARCH-DUP");
	expect(violation).toBeDefined();
	expect(violation!.message).toContain("exceeds");
}, 30_000);

test("duplication: below the baseline fails", async () => {
	const report = await checkFixture("duplication", "docs/architecture/below-baseline.md");
	const violation = report.violations.find((v) => v.ruleId === "ARCH-DUP");
	expect(violation).toBeDefined();
	expect(violation!.message).toContain("lower the baseline");
}, 30_000);

test("duplication: equal to the baseline passes", async () => {
	const report = await checkFixture("duplication");
	expect(report.violations).toEqual([]);
}, 30_000);

test("duplication: dev duplicates are not counted", async () => {
	const report = await checkFixture("duplication");
	// the fixture holds one src group and one dev group; only the src group counts
	expect(report.duplication.count).toBe(1);
	expect(report.duplication.baseline).toBe(1);
}, 30_000);

// ------------------------------------------------------------------ 4.2 meta

test("fixtures: no test-like filenames in the fixtures directory", async () => {
	const output = await Bun.$`find ${FIXTURES_DIR} -name '*.test.*' -o -name '*_test.*' -o -name '*.spec.*' -o -name '*_spec.*'`.text();
	expect(output.trim()).toBe("");
}, 30_000);
