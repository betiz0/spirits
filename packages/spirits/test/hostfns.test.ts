import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentToolCallOutcome, ExtensionToolContext, JsonValue } from "@earendil-works/pi-coding-agent";
import { Repl } from "../src/repl/cell.ts";
import { createBuiltinHostFns, resolveImportTarget } from "../src/repl/hostfns.ts";
import { HostFnRegistry } from "../src/repl/registry.ts";
import { makeScope, makeToolContext } from "./support.ts";

function newRepl(toolContext: ExtensionToolContext = makeToolContext()): { repl: Repl; ctx: ExtensionToolContext } {
	return { repl: new Repl(new HostFnRegistry(createBuiltinHostFns())), ctx: toolContext };
}

function textResult(text: string, structuredContent?: JsonValue, isError = false): AgentToolCallOutcome {
	return {
		toolCall: {},
		result: { content: [{ type: "text", text }], details: undefined, structuredContent },
		isError,
	};
}

test("out value", () => {
	const { scope, state } = makeScope();
	const entry = createBuiltinHostFns().find((e) => e.name === "out");
	expect(entry).toBeDefined();
	const out = entry!.create(scope);
	expect(out(42)).toBeUndefined();
	expect(state.value).toBe(42);
});

test("no return", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'out("x")' }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"x"');
});

test("print capture", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'print("a", 1)' }, ctx);
	expect(result.details.printed).toBe("a 1");
});

test("print circular", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: "const o: any = {}; o.self = o; print(o)" }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.printed).toContain("[Circular]");
});

test("console reference", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'console.log("x")' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("ReferenceError");
	expect(result.text).toContain("print");
});

test("use node builtin", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'const fs = await use("node:fs"); return typeof fs.readFileSync' }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"function"');
});

test("use cwd relative", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "spirits-use-"));
	try {
		writeFileSync(path.join(dir, "m.ts"), "export const v = 1;\n");
		const { repl, ctx } = newRepl(makeToolContext({ cwd: dir }));
		const result = await repl.run({ code: 'return (await use("./m.ts")).v' }, ctx);
		expect(result.isError).toBe(false);
		expect(result.details.value).toBe("1");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("use rejects remote", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'await use("https://example.com/m.ts")' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("https://example.com/m.ts");
	expect(result.text).toContain("M1");
});

test("use rejects bare", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'await use("typebox")' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("typebox");
});

test("use rejects outside cwd", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'await use("../outside.ts")' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("../outside.ts");
});

test("use missing module", async () => {
	const { repl, ctx } = newRepl();
	const result = await repl.run({ code: 'await use("./no-such.ts")' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("./no-such.ts");
});

test("use allows dot-prefixed in-cwd path", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "spirits-use-dot-"));
	try {
		mkdirSync(path.join(dir, "..cache"));
		writeFileSync(path.join(dir, "..cache", "m.ts"), "export const v = 1;\n");
		const { repl, ctx } = newRepl(makeToolContext({ cwd: dir }));
		const result = await repl.run({ code: 'return (await use("./..cache/m.ts")).v' }, ctx);
		expect(result.isError).toBe(false);
		expect(result.details.value).toBe("1");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveImportTarget allows builtins and cwd paths", () => {
	expect(resolveImportTarget("node:fs", "/tmp/work")).toBe("node:fs");
	expect(resolveImportTarget("bun:ffi", "/tmp/work")).toBe("bun:ffi");
	expect(resolveImportTarget("./m.ts", "/tmp/work")).toContain("/tmp/work/m.ts");
});

test("tool text result", async () => {
	const calls: string[] = [];
	const ctx = makeToolContext({
		executeTool: async (name) => {
			calls.push(name);
			return textResult("hi");
		},
	});
	const { repl } = newRepl(ctx);
	const result = await repl.run({ code: 'return await tool("echo", { text: "hi" })' }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"hi"');
	expect(calls).toEqual(["echo"]);
});

test("tool structured result", async () => {
	const ctx = makeToolContext({ executeTool: async () => textResult("", { n: 1 }) });
	const { repl } = newRepl(ctx);
	const result = await repl.run({ code: 'return (await tool("count", {})).n' }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe("1");
});

test("tool unknown catch", async () => {
	const ctx = makeToolContext({ executeTool: async (name) => textResult(`unknown tool ${name}`, undefined, true) });
	const { repl } = newRepl(ctx);
	const result = await repl.run(
		{ code: 'try { await tool("no_such_tool", {}) } catch (e) { return String(e) }' },
		ctx,
	);
	expect(result.isError).toBe(false);
	expect(result.details.value).toContain("no_such_tool");
});

test("tool uncaught error", async () => {
	const ctx = makeToolContext({ executeTool: async (name) => textResult(`unknown tool ${name}`, undefined, true) });
	const { repl } = newRepl(ctx);
	const result = await repl.run({ code: 'await tool("no_such_tool", {})' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("no_such_tool");
});

test("tool self call", async () => {
	let calls = 0;
	const ctx = makeToolContext({
		executeTool: async () => {
			calls += 1;
			return textResult("nested");
		},
	});
	const { repl } = newRepl(ctx);
	const result = await repl.run({ code: 'await tool("tsrepl", { code: "return 1" })' }, ctx);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("tsrepl");
	expect(calls).toBe(0);
});
