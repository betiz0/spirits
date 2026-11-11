/**
 * The guard as the agent loop meets it.
 *
 * The unit tests judge the classifier and the handler separately. This file wires the real extension
 * entry point onto a fake host and runs commands through a bash executor shaped like pi's, with the
 * `tool_call` handlers in between — the same order pi uses: ask the handlers, and if one blocks, hand
 * the model a text-only error result (`createErrorToolResult` in `packages/agent/src/agent-loop.ts`).
 */

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import type { AgentToolCallOutcome, ExtensionToolContext, JsonValue } from "@earendil-works/pi-coding-agent";
import { ENV_ACTION_GUARD } from "../src/constants.ts";
import spiritsExtension from "../src/index.ts";
import { FakePi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const TSREPL_CALL_ID = "cell-1";

/** The session directory the guard judges relative paths against. Only the guard reads it. */
const PROJECT = "/home/u/proj";

interface Session {
	runBash: (command: string, parentToolCallId?: string) => Promise<AgentToolCallOutcome>;
	runCell: (code: string) => Promise<{ text: string; value: JsonValue | undefined; isError: boolean | undefined }>;
	guardRecords: () => Record<string, unknown>[];
}

/**
 * A loaded extension plus a bash executor and a cell runner that both pass their calls through the
 * registered `tool_call` handlers.
 */
function session(mode: "enforce" | "warn" | "off"): Session {
	process.env[ENV_ACTION_GUARD] = mode;
	let pi: FakePi;
	try {
		pi = new FakePi();
		spiritsExtension(pi);
	} finally {
		delete process.env[ENV_ACTION_GUARD];
	}
	const tsrepl = pi.tools.find((tool) => tool.name === "tsrepl");
	if (tsrepl === undefined) throw new Error("the extension registered no tsrepl tool");
	const handlers = pi.handlers.get("tool_call") ?? [];
	if (handlers.length === 0) throw new Error("the extension subscribed no tool_call handler");

	const execute = async (name: string, args: unknown, parentToolCallId?: string): Promise<AgentToolCallOutcome> => {
		const command = String((args as { command?: unknown }).command ?? "");
		for (const handler of handlers) {
			const verdict = (await handler(
				{
					type: "tool_call",
					toolCallId: parentToolCallId === undefined ? "bash-1" : `${parentToolCallId}/1`,
					parentToolCallId,
					toolName: name,
					input: args,
				},
				context as never,
			)) as { block?: boolean; reason?: string } | undefined;
			if (verdict?.block === true) {
				// pi's `createErrorToolResult`: the reason as text, no structured content.
				return {
					toolCall: {},
					result: { content: [{ type: "text", text: verdict.reason ?? "blocked" }], details: {} },
					isError: true,
				};
			}
		}
		return run(command);
	};

	const context: ExtensionToolContext = makeToolContext({
		cwd: PROJECT,
		// The shape pi's bash declares, which is what lets a non-zero exit come back as data.
		tools: [{ name: "bash", outputSchema: { type: "object" } }],
		executeTool: (name, args) => execute(name, args, TSREPL_CALL_ID),
	});

	return {
		runBash: (command, parentToolCallId) => execute("bash", { command }, parentToolCallId),
		runCell: async (code) => {
			const result = await tsrepl.execute("cell-1", { code }, undefined, undefined, context);
			const details = result.details as unknown as { value?: JsonValue };
			return { text: textOf(result), value: details?.value, isError: result.isError };
		},
		guardRecords: () =>
			pi.entries.filter((entry) => entry.customType === "spirits_guard").map((entry) => entry.data as Record<string, unknown>),
	};
}

/** pi's bash tool: the command runs in bash, and stdout plus stderr is the output. */
function run(command: string): AgentToolCallOutcome {
	const started = Date.now();
	const process = spawnSync("bash", ["-c", command], { encoding: "utf8" });
	const output = `${process.stdout ?? ""}${process.stderr ?? ""}`;
	const exitCode = process.status ?? 1;
	const structured = {
		output,
		truncated: false,
		exit_code: exitCode,
		wall_time_seconds: (Date.now() - started) / 1000,
	};
	return {
		toolCall: {},
		result: {
			content: [{ type: "text", text: exitCode === 0 ? output : `Command exited with code ${exitCode}` }],
			details: {},
			structuredContent: structured,
		},
		isError: exitCode !== 0,
	};
}

function textOf(result: { content: readonly unknown[] }): string {
	return result.content
		.map((item) => {
			const record = item as { type?: string; text?: string };
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.filter((text) => text !== "")
		.join("\n");
}

test("a shell loop is blocked and a plain command is not", async () => {
	const { runBash, guardRecords } = session("enforce");

	const loop = await runBash("for i in a b; do printf '%s' \"$i\"; done");
	expect(loop.isError).toBe(true);
	expect(textOf(loop.result)).toContain("S1");

	const status = await runBash("git status --short");
	expect(status.isError).toBe(false);

	expect(guardRecords()).toEqual([{ category: ["S1"], mode: "enforce", blocked: true, nested: false }]);
});

test("a cell runs bash through sh", async () => {
	const { runCell } = session("enforce");
	const result = await runCell('const r = await sh("echo one"); return r.exit_code === 0 && r.output.includes("one")');
	expect(result.isError).toBe(false);
	expect(String(result.value)).toBe("true");
});

test("a cell reaching for another language is blocked with the reason", async () => {
	const { runCell, guardRecords } = session("enforce");
	const result = await runCell(
		'try { await tool("bash", { command: "python3 -c \'print(1)\'" }) } catch (e) { return String(e) }',
	);
	expect(result.isError).toBe(false);
	expect(String(result.value)).toContain("P1");
	expect(guardRecords()[0]).toEqual({ category: ["P1"], mode: "enforce", blocked: true, nested: true });
});

test("a shell loop inside a cell still runs", async () => {
	const { runCell, guardRecords } = session("enforce");
	const result = await runCell('const r = await sh("for i in a b; do printf %s $i; done"); return [r.exit_code, r.output]');
	expect(result.isError).toBe(false);
	expect(String(result.value)).toContain("ab");
	expect(guardRecords()).toEqual([]);
});

// spec "ガードはセキュリティ境界ではない": the guard sits on the bash tool, not on the cell.
test("迂回を塞がない: a cell that imports node:child_process is left alone", async () => {
	const { runCell, guardRecords } = session("enforce");
	const result = await runCell(
		'const cp = await use("node:child_process"); const r = cp.spawnSync("bash", ["-c", "for i in a b; do printf %s $i; done"], { encoding: "utf8" }); return [r.status, r.stdout]',
	);
	expect(result.isError).toBe(false);
	expect(String(result.value)).toContain("ab");
	// ガードは介入しないので、判定の記録も 0 件である。
	expect(guardRecords()).toEqual([]);
});

test("warn runs everything and records the hit", async () => {
	const { runBash, guardRecords } = session("warn");
	const loop = await runBash("for i in a b; do printf '%s' \"$i\"; done");
	expect(loop.isError).toBe(false);
	expect(guardRecords()).toEqual([{ category: ["S1"], mode: "warn", blocked: false, nested: false }]);
});

test("off blocks nothing and records nothing", async () => {
	const { runBash, runCell, guardRecords } = session("off");
	const loop = await runBash("for i in a b; do printf '%s' \"$i\"; done");
	expect(loop.isError).toBe(false);
	const inline = await runCell('const r = await sh("python3 -c \'print(1)\'"); return r.exit_code === 0');
	expect(inline.isError).toBe(false);
	expect(String(inline.value)).toBe("true");
	expect(guardRecords()).toEqual([]);
});
