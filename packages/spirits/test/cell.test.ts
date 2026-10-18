import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { Repl, type ReplOptions, resolveCellTimeouts } from "../src/repl/cell.ts";
import { HostFnRegistry } from "../src/repl/registry.ts";
import { createBuiltinHostFns } from "../src/repl/hostfns.ts";
import { makeToolContext } from "./support.ts";

function newRepl(options: ReplOptions = {}): Repl {
	return new Repl(new HostFnRegistry(createBuiltinHostFns()), options);
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

test("timeout resolution", () => {
	expect(resolveCellTimeouts(undefined)).toEqual({ cellMs: undefined, syncMs: 30000 });
	expect(resolveCellTimeouts(0)).toEqual({ cellMs: 500, syncMs: 500 });
	expect(resolveCellTimeouts(1000)).toEqual({ cellMs: 1000, syncMs: 1000 });
	expect(resolveCellTimeouts(120000)).toEqual({ cellMs: 120000, syncMs: 30000 });
	expect(resolveCellTimeouts(1e12)).toEqual({ cellMs: 2147483647, syncMs: 30000 });
	// Only "not a number" and NaN mean unspecified. Infinity clamps to the maximum.
	expect(resolveCellTimeouts(Number.POSITIVE_INFINITY)).toEqual({ cellMs: 2147483647, syncMs: 30000 });
	expect(resolveCellTimeouts(Number.NaN)).toEqual({ cellMs: undefined, syncMs: 30000 });
});

test("timeout resolution of a non-number", () => {
	// The parameter type is `number`, but a JSON caller can send anything.
	expect(resolveCellTimeouts("5000" as unknown as number)).toEqual({ cellMs: undefined, syncMs: 30000 });
});

test("timeout upper clamp", () => {
	expect(resolveCellTimeouts(6000000000).cellMs).toBe(2147483647);
	expect(resolveCellTimeouts(5000).cellMs).toBe(5000);
	expect(resolveCellTimeouts(undefined).cellMs).toBeUndefined();
});

test("no default cell timeout", async () => {
	const repl = newRepl();
	const result = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 1500)); return 1" },
		makeToolContext(),
	);
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe("1");
});

test("sync watchdog message differs from cell timeout message", async () => {
	const repl = newRepl();
	const sync = await repl.run({ code: "while (true) {}", timeout: 1000 }, makeToolContext());
	const cell = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 60000))", timeout: 1000 },
		makeToolContext(),
	);
	expect(sync.isError).toBe(true);
	expect(cell.isError).toBe(true);
	expect(sync.text).not.toBe(cell.text);
	expect(sync.text).toContain("同期実行");
	expect(sync.text).toContain("`await`");
	expect(cell.text).not.toContain("同期実行");
	for (const text of [sync.text, cell.text]) {
		expect(text).toContain("打ち切り");
		expect(text).toContain("不整合");
		expect(text).toContain("reset: true");
	}
});

test("abort without timeout", async () => {
	const repl = newRepl();
	const controller = new AbortController();
	const ctx = makeToolContext({ signal: controller.signal });
	const promise = repl.run({ code: "await new Promise((r) => setTimeout(r, 60000))" }, ctx);
	await new Promise((resolve) => setTimeout(resolve, 100));
	controller.abort();
	const result = await promise;
	expect(result.isError).toBe(true);
	expect(result.text).toContain("AbortError");
	expect(result.text).toContain("中断");
});

test("cell metrics for success and error", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	const ok = await repl.run({ code: 'print("p"); return "v"', timeout: 5000 }, ctx);
	expect(ok.metrics.outcome).toBe("ok");
	expect(ok.metrics.timeoutMs).toBe(5000);
	expect(ok.metrics.reset).toBe(false);
	expect(ok.metrics.codeChars).toBe('print("p"); return "v"'.length);
	expect(ok.metrics.printedChars).toBe(1);
	expect(ok.metrics.valueChars).toBe('"v"'.length);
	expect(ok.metrics.outputChars).toBe(ok.raw.length);
	expect(ok.metrics.truncated).toBe(false);
	expect(ok.metrics.spill).toBeNull();
	expect(ok.metrics.underscoreSet).toBe(true);
	expect(ok.metrics.toolCalls).toEqual([]);
	expect(ok.metrics.durationMs).toBeGreaterThanOrEqual(0);

	const failed = await repl.run({ code: 'throw new Error("x")', reset: true }, ctx);
	expect(failed.metrics.outcome).toBe("error");
	expect(failed.metrics.reset).toBe(true);
	expect(failed.metrics.underscoreSet).toBe(false);
});

test("cell metrics distinguish timeouts", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	const sync = await repl.run({ code: "while (true) {}", timeout: 500 }, ctx);
	const waiting = await repl.run(
		{ code: "await new Promise((r) => setTimeout(r, 60000))", timeout: 500 },
		ctx,
	);
	expect(sync.metrics.outcome).toBe("timeout_sync");
	expect(waiting.metrics.outcome).toBe("timeout_cell");
});

test("cell metrics record tool calls", async () => {
	const ctx = makeToolContext({
		tools: [{ name: "sh", outputSchema: { type: "object" } }],
		executeTool: async (name) =>
			name === "sh"
				? {
						toolCall: {},
						result: {
							content: [{ type: "text", text: "boom" }],
							details: undefined,
							structuredContent: { exit_code: 2 },
						},
						isError: true,
					}
					: {
							toolCall: {},
							result: { content: [{ type: "text", text: `unknown tool ${name}` }], details: undefined },
							isError: true,
						},
	});
	const repl = newRepl();
	const result = await repl.run({ code: 'await tool("sh", {}); await tool("no_such_tool", {})' }, ctx);

	expect(result.metrics.outcome).toBe("error");
	expect(result.metrics.toolCalls).toEqual([
		{ name: "sh", isError: true, structured: true, exitCode: 2, threw: false },
		{ name: "no_such_tool", isError: true, structured: false, exitCode: null, threw: true },
	]);
});

test("cell metrics record truncation", async () => {
	const repl = newRepl({
		writeOutput: async () => {
			throw new Error("disk full");
		},
	});
	const result = await repl.run({ code: 'print("x".repeat(120000))' }, makeToolContext());
	expect(result.metrics.truncated).toBe(true);
	expect(result.metrics.spill).toBe("failed");
	expect(result.metrics.printedChars).toBe(120000);
});

test("underscore holds the last value", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "return 40 + 2" }, ctx);
	expect((await repl.run({ code: "return _" }, ctx)).details.value).toBe("42");

	await repl.run({ code: "return [1, 2, 3]" }, ctx);
	expect((await repl.run({ code: "return _.length" }, ctx)).details.value).toBe("3");
});

test("underscore survives a value-less cell", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "return 7" }, ctx);
	const printedOnly = await repl.run({ code: 'print("side")' }, ctx);
	expect(printedOnly.details.printed).toBe("side");
	expect((await repl.run({ code: "return _" }, ctx)).details.value).toBe("7");
});

test("underscore unchanged by a failing cell", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "return 7" }, ctx);
	expect((await repl.run({ code: 'throw new Error("x")' }, ctx)).isError).toBe(true);
	expect((await repl.run({ code: "return _" }, ctx)).details.value).toBe("7");
});

test("reset clears the underscore", async () => {
	const repl = newRepl();
	const ctx = makeToolContext();
	await repl.run({ code: "return 7" }, ctx);
	const after = await repl.run({ code: "return typeof _", reset: true }, ctx);
	expect(after.details.value).toBe('"undefined"');
});

test("truncated output is spilled to a temp file", async () => {
	const repl = newRepl();
	const result = await repl.run({ code: 'print("x".repeat(120000))' }, makeToolContext());
	const target = /\[全文: (\S+)\]/.exec(result.text)?.[1];
	try {
		expect(result.isError).toBe(false);
		expect(target).toBeDefined();
		expect(result.text).toContain("characters truncated");
		expect(result.metrics.truncated).toBe(true);
		expect(result.metrics.spill).toBe("saved");
		expect(await readFile(target as string, "utf8")).toBe(`[printed]\n${"x".repeat(120000)}`);
	} finally {
		if (target !== undefined) {
			await rm(target, { force: true });
		}
	}
});

test("spill failure keeps the truncation marker", async () => {
	const repl = newRepl({
		writeOutput: async () => {
			throw new Error("disk full");
		},
	});
	const result = await repl.run({ code: 'print("x".repeat(120000))' }, makeToolContext());
	expect(result.isError).toBe(false);
	expect(result.text).toContain("characters truncated");
	expect(result.text).toContain("disk full");
	expect(result.text).not.toContain("[全文:");
});

test("failed cell output is spilled too", async () => {
	const written: string[] = [];
	const repl = newRepl({
		writeOutput: async (fullText) => {
			written.push(fullText);
			return "/tmp/spirits-tsrepl-error-test.txt";
		},
	});
	const result = await repl.run({ code: 'throw new Error("e".repeat(120000))' }, makeToolContext());
	expect(result.isError).toBe(true);
	expect(result.text).toContain("characters truncated");
	expect(result.text).toContain("/tmp/spirits-tsrepl-error-test.txt");
	expect(written.length).toBe(1);
	expect(written[0]).toContain("[error]");
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
