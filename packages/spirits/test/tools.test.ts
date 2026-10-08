import { expect, test } from "bun:test";
import { createTsreplTool } from "../src/tools.ts";
import { makeToolContext } from "./support.ts";

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
		return first.text;
	}
	return "";
}

test("tool schema", () => {
	const tool = createTsreplTool();
	expect(tool.name).toBe("tsrepl");
	expect(tool.exposure).toBe("direct");
	expect(tool.executionMode).toBe("sequential");

	const schema = tool.parameters as unknown as {
		type: string;
		properties: Record<string, unknown>;
		required?: string[];
	};
	expect(schema.type).toBe("object");
	expect(Object.keys(schema.properties).sort()).toEqual(["code", "description", "reset", "timeout"]);
	expect(schema.required ?? []).toContain("code");
});

test("tool description", () => {
	const tool = createTsreplTool();
	expect(tool.description).toContain("globalThis");
});

test("success result", async () => {
	const tool = createTsreplTool();
	const result = await tool.execute(
		"id",
		{ code: "print(1); return 2" },
		undefined,
		undefined,
		makeToolContext(),
	);
	expect(result.isError).toBeFalsy();
	const text = textOf(result);
	expect(text).toContain("1");
	expect(text).toContain("2");
});

test("error result", async () => {
	const tool = createTsreplTool();
	const result = await tool.execute(
		"id",
		{ code: "throw new Error('boom')" },
		undefined,
		undefined,
		makeToolContext(),
	);
	expect(result.isError).toBe(true);
	expect(textOf(result)).toContain("boom");
});

test("two calls serialized", async () => {
	const tool = createTsreplTool();
	const first = tool.execute(
		"a",
		{ code: "await new Promise((r) => setTimeout(r, 100)); print('A')" },
		undefined,
		undefined,
		makeToolContext(),
	);
	const second = tool.execute("b", { code: "print('B')" }, undefined, undefined, makeToolContext());
	const [r1, r2] = await Promise.all([first, second]);
	expect(r1.details.printed).toBe("A");
	expect(r2.details.printed).toBe("B");
});

test("dev log enabled", async () => {
	const lines: string[] = [];
	const tool = createTsreplTool({ dev: { env: "1", sink: (line) => lines.push(line) } });
	await tool.execute(
		"id",
		{ code: "return 1", description: "first" },
		undefined,
		undefined,
		makeToolContext(),
	);
	const log = lines.join("\n");
	expect(log).toContain("first");
	expect(log).toContain("ok");
	expect(log).toContain("elapsed=");
});

test("dev log disabled", async () => {
	const lines: string[] = [];
	const tool = createTsreplTool({ dev: { env: "0", sink: (line) => lines.push(line) } });
	await tool.execute("id", { code: "return 1" }, undefined, undefined, makeToolContext());
	expect(lines).toEqual([]);
});
