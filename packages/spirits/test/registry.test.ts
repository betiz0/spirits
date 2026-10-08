import { expect, test } from "bun:test";
import { HostFnRegistry, type HostFnEntry, type HostFnScope } from "../src/repl/registry.ts";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

const scope: HostFnScope = {
	signal: new AbortController().signal,
	toolContext: {} as ExtensionToolContext,
	print: () => {},
	setValue: () => {},
	finished: false,
};

function entry(name: string): HostFnEntry {
	return { name, description: `${name} fn`, create: () => () => name };
}

test("register and list", () => {
	const registry = new HostFnRegistry([entry("print")]);
	registry.register(entry("hello"));
	expect(registry.list().map((e) => e.name)).toEqual(["print", "hello"]);
	expect(registry.has("hello")).toBe(true);
	expect(registry.get("hello")?.create(scope)()).toBe("hello");
});

test("duplicate name throws", () => {
	const registry = new HostFnRegistry();
	registry.register(entry("hello"));
	expect(() => registry.register(entry("hello"))).toThrow();
});

test("builtin name throws", () => {
	const registry = new HostFnRegistry([entry("print")]);
	expect(() => registry.register(entry("print"))).toThrow();
});
