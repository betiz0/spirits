import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_RPC_PI_SCRIPT } from "./managed-pi-fixtures.ts";
import {
	classifyAuxiliaryProbe,
	classifyCellFailure,
	classifyCellOutcome,
	classifyNormalToolPath,
	createProbeTsreplTool,
	executeCapturedTsrepl,
	NO_REACHABLE_TOOL_DEFINITION,
} from "../../../scripts/managed-pi-compat/tsrepl.ts";
import { runRpcProbe } from "../../../scripts/managed-pi-compat/rpc.ts";

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

test("model tool call reaches tsrepl through the normal path", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-tsrepl-path-"));
	try {
		const script = join(dir, "fake-pi.ts");
		await writeFile(script, FAKE_RPC_PI_SCRIPT, { mode: 0o755 });
		const result = await runRpcProbe({
			command: [script, "--mode", "rpc", "--no-session"],
			cwd: dir,
			env: { PATH: process.env.PATH, HOME: dir },
			requests: [{ id: "prompt-1", type: "prompt", message: "run one tsrepl cell" }],
			waitFor: (records) => records.some((record) => record.type === "agent_settled"),
		});
		const classified = classifyNormalToolPath(result.records, "tsrepl");
		expect(classified.state).toBe("confirmed");
		expect(classified.data?.bypassedPiHooks).toBe(false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("direct execute probe is auxiliary and optional", async () => {
	// A direct call still bypasses the Pi permission and hook path, so it is never the normal path.
	const result = await executeCapturedTsrepl(createProbeTsreplTool(), "return 1 + 1", process.cwd());
	const classified = classifyAuxiliaryProbe({ toolRegistered: true, direct: result });
	expect(classified.state).toBe("confirmed");
	expect(classified.data?.bypassedPiHooks).toBe(true);
	expect(classified.data?.toolRegistered).toBe(true);
	// The official Pi gives every extension its own API object, so no tool definition is reachable
	// across extensions. The item is then `not-run` with a reason, registered tool or not.
	const registered = classifyAuxiliaryProbe({ toolRegistered: true });
	expect(registered.state).toBe("not-run");
	expect(registered.detail).toContain(NO_REACHABLE_TOOL_DEFINITION);
	expect(registered.data?.bypassedPiHooks).toBe(true);
	expect(classifyAuxiliaryProbe({ toolRegistered: false }).state).toBe("not-run");
});

test("cell failure is not reported as a load failure", async () => {
	const result = await executeCapturedTsrepl(createProbeTsreplTool(), "throw new Error('cell boom')", process.cwd());
	expect(result.isError).toBe(true);
	expect(result.text).toContain("cell boom");
});

test("a fixture host that skips cell code is not-run", () => {
	expect(
		classifyCellOutcome({ value: 2, expected: 2, isError: false, text: "[value] 2", fixtureHost: true }).state,
	).toBe("confirmed");
	expect(
		classifyCellOutcome({
			value: undefined,
			expected: 2,
			isError: false,
			text: "",
			fixtureHost: true,
		}).state,
	).toBe("not-run");
	expect(
		classifyCellOutcome({ value: undefined, expected: 2, isError: false, text: "", fixtureHost: false }).state,
	).toBe("failed");
	// A fixture host that answers the tool call with an empty body skipped the cell entirely.
	expect(classifyCellOutcome({ value: "", expected: 2, isError: false, text: "", fixtureHost: true }).state).toBe(
		"not-run",
	);
	expect(classifyCellFailure(true, true).state).toBe("confirmed");
	expect(classifyCellFailure(false, true).state).toBe("not-run");
	expect(classifyCellFailure(false, false).state).toBe("failed");
});
