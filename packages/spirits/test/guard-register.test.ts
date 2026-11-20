/**
 * The `tool_call` handler: what it blocks, what it leaves alone, and what it puts in the reason.
 */
import { expect, test } from "bun:test";
import { asExtensionApi } from "./host/fake-pi.ts";
import type { ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { ENV_ACTION_GUARD, type GuardCategoryId } from "../src/constants.ts";
import { blockReason } from "../src/guard/messages.ts";
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
	registerBashGuard(asExtensionApi(pi), { env: options.env ?? { [ENV_ACTION_GUARD]: "enforce" } });
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

// spec "シェルの -c と eval の文字列の再判定": `-c` の文字列は外側の呼び出しと同じ扱いで読み直す。
test("適用範囲 シェルに -c で渡した文字列も判定する", async () => {
	const { decide } = guarded({});
	const loop = await decide(bashEvent("bash -c 'for i in 1 2; do echo $i; done'"));
	expect(loop?.block).toBe(true);
	expect(loop?.reason).toContain("S1");
	const inlined = await decide(bashEvent(`bash -c "python3 -c 'print(1)'"`));
	expect(inlined?.block).toBe(true);
	expect(inlined?.reason).toContain("P1");
	expect(inlined?.reason).toContain("P3");
	// 入れ子の呼び出しでは S 系を適用しないので、ループは実行される。
	expect(await decide(bashEvent("bash -c 'for i in 1 2; do echo $i; done'", "cell-1"))).toBeUndefined();
	// P 系は入れ子でも残る。
	const nested = await decide(bashEvent("bash -c 'python3 x.py'", "cell-1"));
	expect(nested?.block).toBe(true);
	expect(nested?.reason).toContain("P3");
});

// spec "ブロック理由の内容": 各行が行き先を書く。読み取りは read、書き換えは edit / write、
// 出力の加工と使い捨てのコードはセル。Python を実行する例はどの行にも出さない。
const ALL_CATEGORIES: GuardCategoryId[] = ["S1", "S2", "S3", "P1", "P2", "P3"];

test("reason は読み取りと書き換えの行き先を示す", () => {
	const s2 = blockReason(["S2"]);
	expect(s2).toContain("read");
	expect(s2).toContain("edit");
	expect(s2).toContain("tsrepl");
	const s3 = blockReason(["S3"]);
	expect(s3).toContain("write");
	expect(s3).toContain("edit");
});

test("reason の P3 は例外がないことを示す", () => {
	const reason = blockReason(["P3"]);
	expect(reason).toContain("P3");
	expect(reason).toContain("どの形も例外");
	expect(reason).toContain("tsrepl");
	expect(reason).toContain(ENV_ACTION_GUARD);
});

test("reason に Python の実行例を含めない", () => {
	for (const id of ALL_CATEGORIES) {
		const reason = blockReason([id]);
		expect(reason, id).toContain("書き換え例");
		expect(reason, id).not.toContain("python3 ");
		expect(reason, id).not.toContain("pytest");
		expect(reason, id).not.toContain("pip install");
	}
});

/** 各行の書き換え例が持つべき行き先の形。spec "ブロック理由の内容" の分け方そのままに書く。 */
const EXAMPLE_DESTINATIONS: Readonly<Record<GuardCategoryId, readonly string[]>> = {
	S1: ["await sh("],
	S2: ["await sh("],
	// セルで `fs.writeFile` をする例は行き先ではない。説明が書く write / edit の形にする。
	S3: ["write(", "edit("],
	P1: ["await sh("],
	P2: ["await sh("],
	P3: ["use("],
};

/** ある分類の理由から `書き換え例:` の行だけを取り出す。 */
function writeExample(id: GuardCategoryId): string {
	return blockReason([id]).split("\n").find((line) => line.includes("書き換え例:")) ?? "";
}

test("reason の書き換え例は行き先の形をしている", () => {
	for (const id of ALL_CATEGORIES) {
		const example = writeExample(id);
		for (const destination of EXAMPLE_DESTINATIONS[id]) {
			expect(example, `${id}: ${example}`).toContain(destination);
		}
		expect(example, id).not.toMatch(/`bash|\bbash -/);
		// 読み取りは read、書き込みは write / edit が行き先なので、例が bash でファイルを扱わない。
		expect(example, id).not.toMatch(/\bcat\s/);
		expect(example, id).not.toMatch(/writeFile|appendFile/);
	}
});

test("reason の共通文はセルの bash 呼び出しの案内だけ", async () => {
	const { decide } = guarded({});
	const result = await decide(bashEvent("for f in src/*.ts; do wc -l \"$f\"; done"));
	expect(result?.reason).toContain("セルから bash を呼ぶ最短形は `sh(command)`");
	// 行き先は分類の行が持つので、共通文が tsrepl へ誘導しない。
	expect(result?.reason).not.toContain("同じ処理は tsrepl のセルに書いてください");
});

// spec "ガードの対象外とする迂回": ラッパー以外のコマンドに引数として渡したコマンドは読まない。
test("適用範囲 ラッパー以外のコマンドに渡したコマンドは対象外", async () => {
	const { decide } = guarded({});
	expect(await decide(bashEvent("sudo pip install requests"))).toBeUndefined();
	expect(await decide(bashEvent("docker run python:3.12 python x.py"))).toBeUndefined();
	expect(await decide(bashEvent('ssh host "python3 x.py"'))).toBeUndefined();
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
