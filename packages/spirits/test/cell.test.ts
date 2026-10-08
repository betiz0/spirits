import { expect, test } from "bun:test";
import { clampTimeout, Repl } from "../src/repl/cell.ts";
import { HostFnRegistry } from "../src/repl/registry.ts";
import { createBuiltinHostFns } from "../src/repl/hostfns.ts";
import { makeToolContext } from "./support.ts";

function newRepl(): Repl {
	return new Repl(new HostFnRegistry(createBuiltinHostFns()));
}

test("persists globalThis", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "globalThis.x = 1" }, ctx);
	const result = await repl.run({ code: "return x" }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe("1");
});

test("undeclared assignment persists", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "y = 2" }, ctx);
	const result = await repl.run({ code: "return y" }, ctx);
	expect(result.details.value).toBe("2");
});

test("declarations stay in cell", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "const z = 1" }, ctx);
	const result = await repl.run({ code: "return typeof z" }, ctx);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"undefined"');
});

test("top-level await", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: "const v = await Promise.resolve(7);\nreturn v" }, makeToolContext());
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe("7");
});

test("return value", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: "return 40 + 2" }, makeToolContext());
	expect(result.details.value).toBe("42");
});

test("no-return cell", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: "const y = 1" }, makeToolContext());
	expect(result.isError).toBe(false);
	expect(result.details.value).toBeUndefined();
	expect(result.text).toBe("(no output)");
});

test("syntax error not executed", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	const failed = await repl.run({ code: "globalThis.ran = 1\nconst y = ;" }, ctx);
	expect(failed.isError).toBe(true);
	expect(failed.text).toContain("行: 2");
	expect(failed.text).toContain("const y = ;");

	const after = await repl.run({ code: "return typeof ran" }, ctx);
	expect(after.details.value).toBe('"undefined"');
});

test("runtime error keeps context", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "globalThis.a = 1" }, ctx);
	const failed = await repl.run({ code: "const o: any = null;\nreturn o.x" }, ctx);
	expect(failed.isError).toBe(true);
	expect(failed.text).toContain("TypeError");
	expect(failed.text).toContain("行: 2");
	expect(failed.text).toContain("return o.x");

	const after = await repl.run({ code: "return a" }, ctx);
	expect(after.details.value).toBe("1");
});

test("reset clears values", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "globalThis.x = 1" }, ctx);
	const result = await repl.run({ code: "return typeof x", reset: true }, ctx);
	expect(result.details.value).toBe('"undefined"');
});

test("host functions after reset", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: 'print("ok"); return typeof use', reset: true }, makeToolContext());
	expect(result.details.printed).toBe("ok");
	expect(result.details.value).toBe('"function"');
});

test("hidden globals through pipeline", async () => {
	const repl = newRepl();
	const result = await repl.run(
		{
			code: "return [typeof process, typeof Bun, typeof require, typeof __dirname, typeof __filename, typeof module, typeof exports, typeof console].join(',')",
		},
		makeToolContext(),
	);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined"');
});

test("timeout sync loop", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: "while (true) {}", timeout: 500 }, makeToolContext());
	expect(result.isError).toBe(true);
	expect(result.text).toContain("打ち切り");
	expect(result.text).toContain("不整合");
	expect(result.text).toContain("reset: true");
});

test("timeout await", async () => {
	const repl = newRepl();
	const started = Date.now();
	const result = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 60000))", timeout: 500 },
		makeToolContext(),
	);
	expect(Date.now() - started).toBeLessThan(5000);
	expect(result.isError).toBe(true);
	expect(result.text).toContain("打ち切り");
	expect(result.text).toContain("reset: true");
});

test("timeout lower clamp", async () => {
	const repl = newRepl();
	const result = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 300)); return 1", timeout: 0 },
		makeToolContext(),
	);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe("1");
});

test("timeout upper clamp", () => {
	expect(clampTimeout(600000)).toBe(120000);
	expect(clampTimeout(5000)).toBe(5000);
	expect(clampTimeout(undefined)).toBe(30000);
});

test("late print discarded", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	const late = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 1000)); print('late')", timeout: 500 },
		ctx,
	);
	expect(late.isError).toBe(true);
	const now = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 1000)); print('now')", timeout: 3000 },
		ctx,
	);
	expect(now.details.printed).toBe("now");
});

test("late out discarded", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	const late = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 1000)); out('late')", timeout: 500 },
		ctx,
	);
	expect(late.isError).toBe(true);
	const now = await repl.run({ code: "out('now')" }, ctx);
	expect(now.details.value).toBe('"now"');
});

test("external abort cuts await", async () => {
	const repl = newRepl();
	const controller = new AbortController();
	const ctx = makeToolContext({ signal: controller.signal });
	const timer = setTimeout(() => controller.abort(), 100);
	try {
		const started = Date.now();
		const result = await repl.run(
			{ code: "await new Promise((r) => setTimeout(r, 60000))", timeout: 30000 },
			ctx,
		);
		expect(Date.now() - started).toBeLessThan(5000);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("打ち切り");
		expect(result.text).toContain("不整合");
		expect(result.text).toContain("reset: true");
	} finally {
		clearTimeout(timer);
	}
});

test("timeout message not misclassified", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: 'await use("./timeout-utils.ts")' }, makeToolContext());
	expect(result.isError).toBe(true);
	expect(result.text).toContain("./timeout-utils.ts");
	expect(result.text).not.toContain("打ち切り");
});
