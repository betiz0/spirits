/**
 * What the guard records, and what it must never record.
 *
 * The entry exists to answer one question later: how often does the guard hit, in which mode, and how
 * often does it block a nested call. Four fields answer it. Anything else in the entry would be the
 * user's command text sitting in the session file for no reason.
 */
import { expect, test } from "bun:test";
import { ACTION_GUARD_ENTRY_TYPE, ENV_ACTION_GUARD } from "../src/constants.ts";
import { registerBashGuard } from "../src/guard/register.ts";
import { buildGuardEntry, recordGuardDecision, type GuardDecision } from "../src/guard/metrics.ts";
import { sessionEntryToContextMessages, SessionManager } from "./pi-runtime/session-manager.ts";
import { FakePi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const DECISION: GuardDecision = { categories: ["S1"], mode: "enforce", blocked: true, nested: false };

function guardEntries(pi: FakePi): Record<string, unknown>[] {
	return pi.entries
		.filter((entry) => entry.customType === ACTION_GUARD_ENTRY_TYPE)
		.map((entry) => entry.data as Record<string, unknown>);
}

/** A guard on its own host, plus the call that reaches its handler the way pi does. */
function guarded(env: Record<string, string | undefined>): { pi: FakePi; decide: (command: string, parent?: string) => Promise<unknown> } {
	const pi = new FakePi();
	registerBashGuard(pi, { env });
	const handler = pi.handlers.get("tool_call")?.[0];
	if (handler === undefined) throw new Error("the guard subscribed no tool_call handler");
	return {
		pi,
		decide: (command, parent) =>
			Promise.resolve(
				handler(
					{
						type: "tool_call",
						toolCallId: parent === undefined ? "call-1" : `${parent}/1`,
						parentToolCallId: parent,
						toolName: "bash",
						input: { command },
					},
					makeToolContext({ cwd: "/home/u/proj" }),
				),
			),
	};
}

test("entry has exactly the four fields", () => {
	expect(Object.keys(buildGuardEntry(DECISION)).sort()).toEqual(["blocked", "category", "mode", "nested"]);
	expect(buildGuardEntry(DECISION)).toEqual({ category: ["S1"], mode: "enforce", blocked: true, nested: false });
});

test("build without a sink records nothing", () => {
	const pi = new FakePi();
	const entry = recordGuardDecision(DECISION);
	expect(entry.category).toEqual(["S1"]);
	expect(pi.entries).toEqual([]);
});

test("one entry per decision", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "enforce" });
	await decide("for i in 1; do echo $i; done");
	await decide("while read -r x; do echo $x; done");
	expect(guardEntries(pi)).toHaveLength(2);
});

test("nested flags the record", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "enforce" });
	await decide("python3 -c 'print(1)'", "cell-1");
	expect(guardEntries(pi)[0]).toEqual({ category: ["P1"], mode: "enforce", blocked: true, nested: true });
});

test("中身を含めない コマンド本文・出力・引数の値", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "enforce" });
	await decide(`python3 -c 'print("secret-token")' /tmp/secret-argument.py`);
	const recorded = JSON.stringify(pi.entries);
	expect(recorded).toContain(ACTION_GUARD_ENTRY_TYPE);
	for (const needle of ["secret-token", "secret-argument", "python3", "-c", "/tmp/"]) {
		expect(recorded, needle).not.toContain(needle);
	}
});

test("中身を含めない 分類 ID 以外の文字列を含まない", () => {
	const entry = buildGuardEntry({ categories: ["S2", "P1"], mode: "warn", blocked: false, nested: true });
	expect(entry).toEqual({ category: ["S2", "P1"], mode: "warn", blocked: false, nested: true });
});

test("該当なしは記録しない", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "enforce" });
	await decide("git status --short");
	expect(pi.entries).toEqual([]);
});

test("off は記録しない", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "off" });
	await decide("for i in 1; do echo $i; done");
	expect(pi.entries).toEqual([]);
});

test("warn は blocked 偽で記録する", async () => {
	const { pi, decide } = guarded({ [ENV_ACTION_GUARD]: "warn" });
	await decide("for i in 1; do echo $i; done");
	expect(guardEntries(pi)[0]).toEqual({ category: ["S1"], mode: "warn", blocked: false, nested: false });
});

test("記録の失敗は判定を変えない", () => {
	const entry = recordGuardDecision(DECISION, () => {
		throw new Error("append boom");
	});
	expect(entry.blocked).toBe(true);
});

// spec "tsrepl / セル実行ログの記録" と同じ手法: カスタムエントリはメッセージ列に現れない。
test("メッセージ列に含まれない", () => {
	const sessionManager = SessionManager.inMemory(process.cwd());
	recordGuardDecision(DECISION, (type, data) => sessionManager.appendCustomEntry(type, data));

	const custom = sessionManager.getBranch().filter((entry) => entry.type === "custom");
	expect(custom.length).toBe(1);
	expect(sessionEntryToContextMessages(custom[0])).toEqual([]);
});
