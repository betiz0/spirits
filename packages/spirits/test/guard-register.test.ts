/**
 * The `tool_call` handler: what it blocks, what it leaves alone, and what it puts in the reason.
 */
import { expect, test } from "bun:test";
import type { ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { ENV_ACTION_GUARD } from "../src/constants.ts";
import { registerBashGuard } from "../src/guard/register.ts";
import { FakePi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const PROJECT = "/home/u/proj";

function context(cwd = PROJECT): ExtensionContext {
	return makeToolContext({ cwd });
}

function bashEvent(command: string, parentToolCallId?: string): unknown {
	return {
		type: "tool_call",
		toolCallId: parentToolCallId === undefined ? "call-1" : `${parentToolCallId}/1`,
		parentToolCallId,
		toolName: "bash",
		input: { command },
	};
}

/** Register the guard on a fake host and hand back the handler it subscribed. */
function guarded(options: {
	env?: Record<string, string | undefined>;
	pi?: FakePi;
}): { pi: FakePi; decide: (event: unknown, ctx?: ExtensionContext) => Promise<ToolCallEventResult | undefined> } {
	const pi = options.pi ?? new FakePi();
	registerBashGuard(pi, { env: options.env ?? { [ENV_ACTION_GUARD]: "enforce" } });
	const handler = pi.handlers.get("tool_call")?.[0];
	if (handler === undefined) throw new Error("the guard subscribed no tool_call handler");
	return {
		pi,
		decide: async (event, ctx) => (await handler(event, ctx ?? context())) as ToolCallEventResult | undefined,
	};
}

function guardEntries(pi: FakePi): unknown[] {
	return pi.entries.filter((entry) => entry.customType === "spirits_guard").map((entry) => entry.data);
}

// ---------------------------------------------------------------------------
// 4.1 the block reason
// ---------------------------------------------------------------------------

test("reason は分類 ID と書き換え例 1 行を返す", async () => {
	const { decide } = guarded({});
	const result = await decide(bashEvent("for f in src/*.ts; do wc -l \"$f\"; done"));
	expect(result?.block).toBe(true);
	expect(result?.reason).toContain("S1");
	expect(result?.reason).toContain("書き換え例");
});

test("reason はモードの切り替え方を教える", async () => {
	const { decide } = guarded({});
	const result = await decide(bashEvent("for f in src/*.ts; do wc -l \"$f\"; done"));
	expect(result?.reason).toContain(ENV_ACTION_GUARD);
});

test("reason は複数該当の全分類 ID を並べる", async () => {
	const { decide } = guarded({});
	const result = await decide(bashEvent("for f in *; do python3 -c 'print(1)'; done"));
	expect(result?.reason).toContain("S1");
	expect(result?.reason).toContain("P1");
});

test("reason はコマンド本文を再現しない", async () => {
	const { decide } = guarded({});
	const result = await decide(bashEvent(`python3 -c 'print("secret-token")'`));
	expect(result?.block).toBe(true);
	expect(result?.reason).toContain("P1");
	expect(result?.reason).not.toContain("secret-token");
	expect(result?.reason).not.toContain("python3");
});

// ---------------------------------------------------------------------------
// 4.3 reach, targets, and failure containment
// ---------------------------------------------------------------------------

test("適用範囲 直接呼び出しは S と P の両方", async () => {
	const { decide } = guarded({});
	expect((await decide(bashEvent("for i in 1 2; do echo $i; done")))?.block).toBe(true);
	expect((await decide(bashEvent("python3 -c 'print(1)'")))?.block).toBe(true);
});

test("適用範囲 入れ子呼び出しは P のみ", async () => {
	const { decide } = guarded({});
	// A cell building a shell loop is left alone.
	expect(await decide(bashEvent("for i in 1 2; do echo $i; done", "cell-1"))).toBeUndefined();
	// A cell reaching for another language is not.
	const nested = await decide(bashEvent("python3 -c 'print(1)'", "cell-1"));
	expect(nested?.block).toBe(true);
	expect(nested?.reason).toContain("P1");
});

test("適用範囲 bash 以外のツールは対象外", async () => {
	const { decide } = guarded({});
	const read = { type: "tool_call", toolCallId: "r1", toolName: "read", input: { path: "f.ts" } };
	expect(await decide(read)).toBeUndefined();
});

test("適用範囲 シェルに -c で渡すコードは対象外", async () => {
	const { decide } = guarded({});
	expect(await decide(bashEvent("bash -c 'for i in 1 2; do echo $i; done'"))).toBeUndefined();
});

test("適用範囲 該当しないコマンドは実行される", async () => {
	const { decide } = guarded({});
	expect(await decide(bashEvent("git status --short"))).toBeUndefined();
	expect(await decide(bashEvent("bun run check 2>&1 | tail -20"))).toBeUndefined();
});

test("適用範囲 SPIRITS_ACTION_GUARD の不正な値は enforce として止める", async () => {
	const { decide } = guarded({ env: { [ENV_ACTION_GUARD]: "strict" } });
	expect((await decide(bashEvent("for i in 1; do echo $i; done")))?.block).toBe(true);
});

test("適用範囲 warn は実行を止めない", async () => {
	const { decide, pi } = guarded({ env: { [ENV_ACTION_GUARD]: "warn" } });
	expect(await decide(bashEvent("for i in 1; do echo $i; done"))).toBeUndefined();
	expect(guardEntries(pi)).toHaveLength(1);
});

test("適用範囲 off は分類も記録もしない", async () => {
	const { decide, pi } = guarded({ env: { [ENV_ACTION_GUARD]: "off" } });
	expect(await decide(bashEvent("for i in 1; do echo $i; done"))).toBeUndefined();
	expect(guardEntries(pi)).toHaveLength(0);
});

test("失敗の局所化 判定が例外を投げても bash は止まらない", async () => {
	// A temporary-directory list that throws when the classifier reads it stands in for any failure
	// inside the guard. pi would block the tool if the exception reached it.
	const throwingHost = new FakePi();
	registerBashGuard(throwingHost, {
		env: {},
		tempDirectories: new Proxy([] as string[], {
			get(target, property) {
				if (property === "some") throw new Error("classifier boom");
				return Reflect.get(target, property) as never;
			},
		}),
	});
	const throwingHandler = throwingHost.handlers.get("tool_call")?.[0];
	if (throwingHandler === undefined) throw new Error("no handler");

	expect(await throwingHandler(bashEvent("python3 /tmp/probe.mjs"), context())).toBeUndefined();
});

test("失敗の局所化 記録の失敗は判定を変えない", async () => {
	const pi = new FakePi();
	pi.appendEntry = () => {
		throw new Error("append boom");
	};
	const { decide } = guarded({ pi });
	const result = await decide(bashEvent("for i in 1; do echo $i; done"));
	expect(result?.block).toBe(true);
});
