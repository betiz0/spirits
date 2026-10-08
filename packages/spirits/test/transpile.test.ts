import { expect, test } from "bun:test";
import { transpileCell, wrapCell } from "../src/repl/transpile.ts";

test("syntax error line", () => {
	const result = transpileCell("globalThis.ran = 1\nconst y = ;");
	expect(result.ok).toBe(false);
	if (!result.ok) {
		expect(result.line).toBe(2);
		expect(result.lineText).toBe("const y = ;");
	}
});

test("await with return", () => {
	const result = transpileCell("const v = await Promise.resolve(7);\nreturn v");
	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.code).toContain("async");
		expect(result.code).toContain("return v");
	}
});

test("wrap cell adds async iife", () => {
	expect(wrapCell("return 1")).toBe("(async (require, __dirname, __filename) => {\nreturn 1\n})()");
});

test("shadow require dirname filename", () => {
	const result = transpileCell("return [typeof require, typeof __dirname, typeof __filename].join(',')");
	expect(result.ok).toBe(true);
	if (result.ok) {
		// The IIFE parameters must be present, and the transpiler must not inject its
		// own `var __dirname` / `var __filename` bindings that would shadow them.
		expect(result.code).toContain("__dirname");
		expect(result.code).toContain("__filename");
		expect(result.code).not.toContain('var __dirname = ""');
		expect(result.code).not.toContain('var __filename = "input.ts"');
	}
});
