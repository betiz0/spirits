import { expect, test } from "bun:test";
import {
	applyOutputLimit,
	formatFailure,
	formatRuntimeError,
	formatSuccess,
	OUTPUT_LIMIT,
} from "../src/repl/format.ts";
import { Repl } from "../src/repl/cell.ts";
import { createBuiltinHostFns } from "../src/repl/hostfns.ts";
import { HostFnRegistry } from "../src/repl/registry.ts";
import { makeToolContext } from "./support.ts";

test("result layout", () => {
	const result = formatSuccess("a 1", 42);
	expect(result.isError).toBe(false);
	expect(result.text).toBe("[printed]\na 1\n\n[value]\n42");
	expect(result.details.printed).toBe("a 1");
	expect(result.details.value).toBe("42");
	expect(result.details.truncated).toBe(false);

	const valueOnly = formatSuccess("", 42);
	expect(valueOnly.text).toBe("[value]\n42");

	const printedOnly = formatSuccess("a 1", undefined);
	expect(printedOnly.text).toBe("[printed]\na 1");

	const empty = formatSuccess("", undefined);
	expect(empty.text).toBe("(no output)");
	expect(empty.details.printed).toBeUndefined();
	expect(empty.details.value).toBeUndefined();
});

test("truncate exact limit", () => {
	const exact = "x".repeat(OUTPUT_LIMIT);
	const result = applyOutputLimit(exact);
	expect(result.truncated).toBe(false);
	expect(result.truncatedChars).toBe(0);
	expect(result.text).toBe(exact);
});

test("truncate over limit", () => {
	const result = applyOutputLimit("x".repeat(20000));
	expect(result.truncated).toBe(true);
	expect(result.truncatedChars).toBe(12000);
	expect(result.text.startsWith("x".repeat(4800))).toBe(true);
	expect(result.text.endsWith("x".repeat(3200))).toBe(true);
	expect(result.text).toContain("12000");
});

test("truncate error", () => {
	const result = formatFailure("e".repeat(20000));
	expect(result.isError).toBe(true);
	expect(result.details.truncated).toBe(true);
	expect(result.details.truncatedChars).toBe("[error]\n".length + 20000 - OUTPUT_LIMIT);
	expect(result.text).toContain("characters truncated");
});

test("runtime error excerpt", () => {
	const convertedCode = "(async () => {\n  const o = null;\n  return o.x;\n})();\n";
	const error = {
		name: "TypeError",
		message: "null is not an object (evaluating 'o.x')",
		stack: [
			"TypeError: null is not an object (evaluating 'o.x')",
			"    at <anonymous> (tsrepl-cell.js:3:11)",
			"    at tsrepl-cell.js:4:3",
			"    at runInContext (unknown)",
		].join("\n"),
	};
	const text = formatRuntimeError(error, convertedCode);
	expect(text).toContain("TypeError");
	expect(text).toContain("行: 2");
	expect(text).toContain("return o.x");
	expect(text).toContain("提案:");
});

test("host frames removed", () => {
	const convertedCode = "(async () => {\n  return missing;\n})();\n";
	const error = {
		name: "ReferenceError",
		message: "missing is not defined",
		stack: [
			"ReferenceError: missing is not defined",
			"    at <anonymous> (tsrepl-cell.js:2:10)",
			"    at runCell (/home/betiz/project/spirits/packages/spirits/src/repl/cell.ts:42:5)",
			"    at /home/betiz/project/spirits/packages/spirits/test/cell.test.ts:10:2",
		].join("\n"),
	};
	const text = formatRuntimeError(error, convertedCode);
	expect(text).not.toContain("packages/spirits/src");
	expect(text).not.toContain("cell.test.ts");
	expect(text).toContain("globalThis.missing");
});

test("console suggestion", () => {
	const convertedCode = "(async () => {\n  console.log(\"x\");\n})();\n";
	const error = {
		name: "ReferenceError",
		message: "console is not defined",
		stack: "ReferenceError: console is not defined\n    at <anonymous> (tsrepl-cell.js:2:3)",
	};
	const text = formatRuntimeError(error, convertedCode);
	expect(text).toContain("ReferenceError");
	expect(text).toContain("print");
});

test("circular value", () => {
	const value: Record<string, unknown> = { n: 1 };
	value.self = value;
	const result = formatSuccess("", value);
	expect(result.isError).toBe(false);
	expect(result.details.value).toContain("n");
	expect(result.details.value).toContain("[Circular]");
});

test("cell output truncation", async () => {
	const repl = new Repl(new HostFnRegistry(createBuiltinHostFns()));
	const result = await repl.run({ code: 'print("x".repeat(20000))' }, makeToolContext());
	expect(result.isError).toBe(false);
	expect(result.details.truncated).toBe(true);
	expect(result.details.truncatedChars).toBeGreaterThan(0);
	expect(result.text).toContain("characters truncated");
});
