import { expect, test } from "bun:test";
import vm from "node:vm";
import { Repl } from "../src/repl/cell.ts";
import { ReplContext } from "../src/repl/context.ts";
import { HostFnRegistry, type HostFnEntry } from "../src/repl/registry.ts";
import { makeToolContext } from "./support.ts";

function makeContext(registry: HostFnRegistry): ReplContext {
	return new ReplContext({
		registry,
		resolveHostFn: (name) => (name === "late" ? () => "late" : undefined),
	});
}

async function run(context: ReplContext, code: string): Promise<unknown> {
	const script = new vm.Script(code, { filename: "tsrepl-cell.js" });
	return await script.runInContext(context.context);
}

test("allowed globals", async () => {
	const context = makeContext(new HostFnRegistry());
	const value = await run(
		context,
		"[setTimeout, clearTimeout, fetch, URL, TextEncoder, TextDecoder, structuredClone].map((f) => typeof f).join(',')",
	);
	expect(value).toBe("function,function,function,function,function,function,function");
});

test("hidden globals", async () => {
	const context = makeContext(new HostFnRegistry());
	const value = await run(context, "[typeof process, typeof Bun, typeof require, typeof console].join(',')");
	expect(value).toBe("undefined,undefined,undefined,undefined");
});

test("late registration after reset", async () => {
	const registry = new HostFnRegistry();
	const context = makeContext(registry);
	expect(await run(context, "typeof late")).toBe("undefined");

	const late: HostFnEntry = { name: "late", description: "registered after creation", create: () => () => "late" };
	registry.register(late);
	expect(await run(context, "typeof late")).toBe("undefined");

	context.reset();
	expect(await run(context, "typeof late")).toBe("function");
});

test("custom host function end to end", async () => {
	const registry = new HostFnRegistry();
	registry.register({ name: "hello", description: "returns hi", create: () => () => "hi" });
	const repl = new Repl(registry);
	const result = await repl.run({ code: "return hello()" }, makeToolContext());
	expect(result.isError).toBe(false);
	expect(result.details.value).toBe('"hi"');
});
