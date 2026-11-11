import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lex, type LexedCommand, type LexResult, stdoutTargets } from "../src/guard/lex.ts";

/** Words of the nth command, as plain strings. */
function words(result: LexResult, index = 0): string[] {
	return (result.commands[index]?.words ?? []).map((word) => word.text);
}

/** The stage counts of every pipeline, in source order. */
function stageCounts(result: LexResult): number[] {
	return result.pipelines.map((pipeline) => pipeline.length);
}

function command(result: LexResult, index = 0): LexedCommand {
	const found = result.commands[index];
	if (!found) throw new Error(`no command at ${index}`);
	return found;
}

test("lex simple command words", () => {
	const result = lex("git status --short");
	expect(result.parseError).toBe(false);
	expect(words(result)).toEqual(["git", "status", "--short"]);
	expect(stageCounts(result)).toEqual([1]);
});

test("lex strips quotes and keeps the word whole", () => {
	const result = lex('echo "hello world"');
	expect(words(result)).toEqual(["echo", "hello world"]);
});

test("lex splits sequences on ; && || and newline", () => {
	expect(stageCounts(lex("ls ; pwd"))).toEqual([1, 1]);
	expect(stageCounts(lex("ls && pwd"))).toEqual([1, 1]);
	expect(stageCounts(lex("ls || pwd"))).toEqual([1, 1]);
	expect(stageCounts(lex("ls\npwd"))).toEqual([1, 1]);
});

test("lex counts pipeline stages", () => {
	expect(stageCounts(lex("git status --short | head -20 | cat"))).toEqual([3]);
});

test("lex marks the stages after the first", () => {
	const result = lex("rg foo src | sort | head");
	expect(command(result, 0).stdinFromPipe).toBe(false);
	expect(command(result, 1).stdinFromPipe).toBe(true);
});

test("lex drops leading assignments from the words", () => {
	const result = lex("PYTHONPATH=. FOO=1 python3 -c 'print(1)'");
	expect(command(result).assignments.map((word) => word.text)).toEqual(["PYTHONPATH=.", "FOO=1"]);
	expect(words(result)).toEqual(["python3", "-c", "print(1)"]);
});

test("lex keeps an = argument after the command word", () => {
	const result = lex("make FOO=1");
	expect(command(result).assignments).toEqual([]);
	expect(words(result)).toEqual(["make", "FOO=1"]);
});

test("lex reads a command that only looks like an assignment", () => {
	const result = lex("echo=1 run");
	expect(command(result).assignments.map((word) => word.text)).toEqual(["echo=1"]);
	expect(words(result)).toEqual(["run"]);
});

test("lex reads stdout redirect targets", () => {
	const result = lex("ls > /tmp/out.txt");
	expect(command(result).redirects).toEqual([
		{
			fd: null,
			output: true,
			append: false,
			duplicate: false,
			target: expect.objectContaining({ text: "/tmp/out.txt" }),
		},
	]);
	expect(stdoutTargets(command(result)).map((target) => target.text)).toEqual(["/tmp/out.txt"]);
});

test("lex reads appended and numbered stdout redirects", () => {
	const append = lex("ls >> notes.md");
	expect(command(append).redirects[0].append).toBe(true);
	const numbered = lex("ls 1> /tmp/out.txt");
	expect(command(numbered).redirects[0].fd).toBe(1);
	// The `1` is the descriptor, not an argument.
	expect(words(numbered)).toEqual(["ls"]);
});

test("lex reads a stderr redirect as something other than stdout", () => {
	const result = lex("npm run check 2>&1 | tail -40");
	expect(command(result).redirects.map((redirect) => redirect.fd)).toEqual([2]);
	expect(stdoutTargets(command(result))).toEqual([]);
});

// ---------------------------------------------------------------------------
// 2.2 quotes and escapes
// ---------------------------------------------------------------------------

test("引用符内のキーワードは演算子にならない", () => {
	const result = lex('rg "for (" src');
	expect(result.parseError).toBe(false);
	expect(words(result)).toEqual(["rg", "for (", "src"]);
	expect(stageCounts(result)).toEqual([1]);
});

test("引用符内のパイプは段数に数えない", () => {
	const result = lex('echo "a | b | c | d"');
	expect(stageCounts(result)).toEqual([1]);
	expect(words(result)).toEqual(["echo", "a | b | c | d"]);
});

test("引用符内のwhileと括弧", () => {
	const result = lex("rg -n 'while (' packages");
	expect(words(result)).toEqual(["rg", "-n", "while (", "packages"]);
});

test("引用符内のケースラベル", () => {
	const result = lex('grep -n "case:" notes.md');
	expect(words(result)).toEqual(["grep", "-n", "case:", "notes.md"]);
});

test("複合引用符内のバックスラッシュはescapeとして読む", () => {
	const result = lex('echo "a \\| b"');
	expect(words(result)).toEqual(["echo", "a \\| b"]);
});

test("バックスラッシュで引用符を逃がす", () => {
	const result = lex("echo don\\'t");
	expect(words(result)).toEqual(["echo", "don't"]);
});

test("部分展開の語はdynamicとして印を付ける", () => {
	const result = lex("echo $(echo hi) `date`");
	expect(command(result).words[1].dynamic).toBe(true);
	expect(command(result).words[2].dynamic).toBe(true);
	expect(command(result).words[1].text).toBe("$(echo hi)");
});

test("部分展開内の引用符で閉じたと誤認しない", () => {
	const result = lex(`echo "$(printf 'a)b')" after`);
	expect(result.parseError).toBe(false);
	expect(words(result)).toEqual(["echo", "$(printf 'a)b')", "after"]);
});

test("閉じ引用符の無い入力はparseError", () => {
	expect(lex('echo "unclosed').parseError).toBe(true);
	expect(lex("echo 'unclosed").parseError).toBe(true);
	expect(lex('echo "unclosed" extra "tail').parseError).toBe(true);
});

test("閉じの無い部分展開はparseError", () => {
	expect(lex("echo $(unterminated").parseError).toBe(true);
});

test("コメントは語として数えない", () => {
	const result = lex("ls # list files\npwd");
	expect(words(result, 0)).toEqual(["ls"]);
	expect(words(result, 1)).toEqual(["pwd"]);
});

test("コメント記号は語の途中では効かない", () => {
	const result = lex("rg 'a#b' src");
	expect(words(result)).toEqual(["rg", "a#b", "src"]);
});

// ---------------------------------------------------------------------------
// 2.3 heredocs
// ---------------------------------------------------------------------------

test("ヒアドキュメントの本文はマーカー行までで、演算子を数えない", () => {
	const result = lex("cat <<'EOF'\nbody with > and | inside\nEOF");
	expect(result.parseError).toBe(false);
	expect(result.commands.length).toBe(1);
	expect(words(result)).toEqual(["cat"]);
	expect(command(result).heredocs.length).toBe(1);
	expect(command(result).heredocs[0].marker).toBe("EOF");
	expect(command(result).heredocs[0].quoted).toBe(true);
	expect(command(result).heredocs[0].body).toEqual(["body with > and | inside"]);
});

test("ヒアドキュメントのマーカーは引用符の有無を区別する", () => {
	expect(command(lex('cat <<"EOF"\nx\nEOF')).heredocs[0].quoted).toBe(true);
	expect(command(lex("cat <<EOF\nx\nEOF")).heredocs[0].quoted).toBe(false);
});

test("ヒアドキュメント << は行頭のタブを除く", () => {
	const result = lex("cat <<-EOF\n\tbody\n\tEOF");
	expect(command(result).heredocs[0].body).toEqual(["body"]);
});

test("ヒアドキュメントは本文内のリダイレクト先を作らない", () => {
	const result = lex("cat <<'EOF'\n> not a redirect | nor this\nEOF");
	expect(command(result).redirects).toEqual([]);
	expect(command(result).heredocs[0].body).toEqual(["> not a redirect | nor this"]);
});

test("ヒアドキュメントの後ろに付いたリダイレクトを読む", () => {
	const result = lex("cat <<'EOF' >> notes.md\nbody\nEOF");
	expect(command(result).redirects.length).toBe(1);
	expect(command(result).redirects[0].output).toBe(true);
	expect(command(result).redirects[0].append).toBe(true);
	expect(command(result).redirects[0].target?.text).toBe("notes.md");
});

test("ヒアドキュメントはコマンドに紐づく", () => {
	const result = lex("git commit -F - <<'EOF'\nmessage\nEOF");
	expect(words(result, 0)).toEqual(["git", "commit", "-F", "-"]);
	expect(command(result).heredocs.length).toBe(1);
});

test("複数のヒアドキュメントを順番に読む", () => {
	const result = lex("diff <(cat <<'A'\nfirst\nA\n) <<'B'\nsecond\nB\n");
	const heredocs = result.commands.flatMap((entry) => entry.heredocs);
	expect(heredocs.map((heredoc) => heredoc.marker)).toEqual(["A", "B"]);
	expect(heredocs.map((heredoc) => heredoc.body)).toEqual([["first"], ["second"]]);
});

// ---------------------------------------------------------------------------
// 2.1 rework (C-1, W-2, W-5): line continuations, reserved words, and groups
// ---------------------------------------------------------------------------

test("行の継続は語を途切れにしない", () => {
	const result = lex("rg -n TODO src | \\\nsort | \\\nhead");
	expect(result.parseError).toBe(false);
	expect(stageCounts(result)).toEqual([3]);
	expect(words(result, 0)).toEqual(["rg", "-n", "TODO", "src"]);
	expect(words(result, 1)).toEqual(["sort"]);
	expect(words(result, 2)).toEqual(["head"]);
});

test("継続する改行は区切りにしない", () => {
	// `|` の直後の改行は同じコマンドの続きで、python3 はパイプの標準入力を受ける。
	expect(stageCounts(lex("echo x |\npython3"))).toEqual([2]);
	expect(command(lex("echo x |\npython3"), 1).stdinFromPipe).toBe(true);
	expect(stageCounts(lex("a &&\nb"))).toEqual([1, 1]);
	expect(stageCounts(lex("a ||\nb"))).toEqual([1, 1]);
	// 演算子の直後ではない改行は従来どおり区切りになる。
	expect(stageCounts(lex("a\nb"))).toEqual([1, 1]);
});

test("構文語は段に数えない", () => {
	expect(stageCounts(lex("time bun test 2>&1 | tail -20"))).toEqual([2]);
	expect(stageCounts(lex("! git diff --quiet | head"))).toEqual([2]);
	expect(stageCounts(lex("{ git status --short; git log -1; } | head"))).toEqual([2]);
	const conditional = lex("if python3 --version; then :; fi");
	// `if` と `then` は段を作らないので、python3 はパイプから標準入力を受けない。
	expect(stageCounts(conditional)).toEqual([1, 1]);
	expect(command(conditional, 0).stdinFromPipe).toBe(false);
	// 記録は残るので S1 の判定に使える。`then` と `fi` も command 位置の構文語。
	expect(conditional.controlWords).toEqual(["if", "then", "fi"]);
	expect(lex("for f in a; do :; done").controlWords).toContain("for");
	// グループの中身はグループ自身の段として残る。
	expect(lex("{ rg x | sort | tee f; }").groupPipelines).toHaveLength(1);
});

test("function 形式も関数定義として印付ける", () => {
	expect(command(lex("function run_case { echo x; }"), 0).functionDefinition).toBe(true);
	expect(command(lex("function run_case() { echo x; }"), 0).functionDefinition).toBe(true);
	// `function` 自身は語にも段にもならない。
	expect(words(lex("function run_case { echo x; }"), 0)).toEqual(["run_case"]);
	expect(stageCounts(lex("function run_case { echo x; }"))).toEqual([1]);
});

// ---------------------------------------------------------------------------
// 2.4 commands taken from real session logs, sanitized
// ---------------------------------------------------------------------------

interface PassFixtureFile {
	comment: string;
	cases: { command: string; firstWords: string[] }[];
}

const PASS_FIXTURE = new URL("./fixtures/guard/pass-cases.json", import.meta.url);

function passCases(): PassFixtureFile["cases"] {
	return (JSON.parse(readFileSync(PASS_FIXTURE, "utf8")) as PassFixtureFile).cases;
}

test("実ログの通過ケースは字句解析でき、期待どおりの先頭の語を読む", () => {
	const cases = passCases();
	expect(cases.length).toBeGreaterThanOrEqual(40);
	for (const item of cases) {
		const result = lex(item.command);
		expect(result.parseError, item.command).toBe(false);
		const firstWords = result.commands.map((entry) => entry.words[0]?.text ?? "");
		expect(firstWords, item.command).toEqual(item.firstWords);
	}
});

test("実ログの通過ケースに秘密のパターンを含めない", () => {
	const secret = /\/home\/|\/Users\/|[A-Za-z0-9_-]{32,}|@[A-Za-z0-9.-]+\.[a-z]{2,}/;
	expect(JSON.stringify(passCases())).not.toMatch(secret);
});

// ---------------------------------------------------------------------------
// shapes the guard needs from pipelines and functions
// ---------------------------------------------------------------------------

test("段数は連結をまたがない", () => {
	expect(stageCounts(lex("a && b | c | d; e"))).toEqual([1, 3, 1]);
});

test("段数はパイプ単位で、|| はパイプを閉じる", () => {
	const result = lex("a | b || c | d");
	expect(stageCounts(result)).toEqual([2, 2]);
});

test("関数定義を判別できる", () => {
	const result = lex("run_case() { name=$1; echo \"$name\"; }; run_case a");
	expect(command(result, 0).functionDefinition).toBe(true);
	expect(command(result, 0).words.map((word) => word.text)).toEqual(["run_case"]);
});

test("括弧は副シェルの区切りとして扱う", () => {
	const result = lex("(cd /tmp && ls) | head");
	expect(command(result, 0).functionDefinition).toBe(false);
	expect(result.commands.length).toBeGreaterThan(1);
});

test("リダイレクト先が別のディスクリプタのときは書き出し先として数えない", () => {
	const result = lex("echo one >&2");
	expect(command(result).redirects[0].fd).toBeNull();
	expect(command(result).redirects[0].output).toBe(true);
	expect(command(result).redirects[0].duplicate).toBe(true);
	expect(stdoutTargets(command(result))).toEqual([]);
});
