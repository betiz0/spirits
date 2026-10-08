import { expect, test } from "bun:test";
import { replacePiVersion } from "../../../scripts/replace-pi-version.ts";

test("replaces VERSION declaration", () => {
	const source = [
		'import { readFileSync } from "node:fs";',
		'export const VERSION: string = pkg.version || "0.0.0";',
		"",
	].join("\n");
	const result = replacePiVersion(source, "1.0.0");
	expect(result).toContain('export const VERSION: string = "1.0.0";');
	expect(result).not.toContain('pkg.version || "0.0.0"');
	expect(result).toContain('import { readFileSync } from "node:fs";');
});

test("throws when declaration not found", () => {
	expect(() => replacePiVersion("export const VERSION = 1;", "1.0.0")).toThrow();
});
