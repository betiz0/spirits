import { expect, test } from "bun:test";
import { FakePi } from "./routing/fake-pi.ts";
import { captureRegisteredTools, createProbeTsreplTool, executeCapturedTsrepl } from "../../../scripts/managed-pi-compat/tsrepl.ts";
import { createTsreplTool } from "../src/tools.ts";

test("probe captures tsrepl", () => {
	const pi = new FakePi();
	const captured = captureRegisteredTools(pi as never);
	const tool = createTsreplTool();
	pi.registerTool(tool);
	expect(captured.map((entry) => entry.name)).toContain("tsrepl");
});

test("probe marks the bypassed path", async () => {
	const tool = createProbeTsreplTool();
	const result = await executeCapturedTsrepl(tool, "return 1 + 1", process.cwd());
	expect(result.bypassedPiHooks).toBe(true);
});

test("simple cell returns 2", async () => {
	const result = await executeCapturedTsrepl(createProbeTsreplTool(), "return 1 + 1", process.cwd());
	expect(result.isError).toBe(false);
	expect(result.text).toContain("2");
});

test("Bun transpiler cell runs", async () => {
	const result = await executeCapturedTsrepl(
		createProbeTsreplTool(),
		"const n: number = 2; return n",
		process.cwd(),
	);
	expect(result.isError).toBe(false);
	expect(result.text).toContain("2");
});

test("vm cell runs", async () => {
	const result = await executeCapturedTsrepl(
		createProbeTsreplTool(),
		"const vm = await use('node:vm'); return vm.runInNewContext('1 + 2')",
		process.cwd(),
	);
	expect(result.isError).toBe(false);
	expect(result.text).toContain("3");
});

test("cell failure is not reported as a load failure", async () => {
	const result = await executeCapturedTsrepl(createProbeTsreplTool(), "throw new Error('cell boom')", process.cwd());
	expect(result.isError).toBe(true);
	expect(result.text).toContain("cell boom");
});
