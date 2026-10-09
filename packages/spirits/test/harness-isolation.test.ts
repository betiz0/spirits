import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.join(import.meta.dir, "..", "src");

/** Static `from "x"` imports and dynamic `import("x")` specifiers. */
const IMPORT_PATTERN = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(full);
		}
	}
	return files;
}

function importsOf(file: string): string[] {
	const specifiers: string[] = [];
	for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
		const specifier = match[1] ?? match[2];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
	}
	return specifiers;
}

function assertNoHarnessImports(files: readonly string[]): void {
	for (const file of files) {
		for (const specifier of importsOf(file)) {
			expect(`${path.relative(SOURCE_ROOT, file)} -> ${specifier}`).not.toContain("harness");
		}
	}
}

test("rlm sources do not import harness", () => {
	assertNoHarnessImports(sourceFiles(path.join(SOURCE_ROOT, "rlm")));
});

test("repl and tools do not import harness", () => {
	assertNoHarnessImports([
		...sourceFiles(path.join(SOURCE_ROOT, "repl")),
		path.join(SOURCE_ROOT, "tools.ts"),
	]);
});

/** M5 names: parser, fan-out, handle, phase 2 modules must not be referenced from M4. */
const LATER_PHASE_PATTERN = /(parser|phase2|fan-?out|handle)/i;

test("harness does not import later-phase modules", () => {
	for (const file of sourceFiles(path.join(SOURCE_ROOT, "harness"))) {
		for (const specifier of importsOf(file)) {
			expect(`${path.relative(SOURCE_ROOT, file)} -> ${specifier}`).not.toMatch(LATER_PHASE_PATTERN);
		}
	}
});
