/**
 * The guard's classifications, scenario by scenario.
 *
 * Every case names the command as the model writes it, so a change to a rule shows up as a category
 * appearing or disappearing rather than as a renamed internal.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { GuardCategoryId } from "../src/constants.ts";
import { classify, type GuardScope, type PipelineThresholds } from "../src/guard/rules.ts";

const PROJECT = "/home/u/proj";

function scope(cwd = PROJECT): GuardScope {
	return { cwd, tempDirectories: ["/tmp", "/var/tmp", tmpdir()] };
}

function categories(command: string, options: { cwd?: string; nested?: boolean; thresholds?: PipelineThresholds } = {}) {
	return classify(command, scope(options.cwd), { nested: options.nested, thresholds: options.thresholds }).categories;
}

function expectHit(command: string, expected: GuardCategoryId[], options: Parameters<typeof categories>[1] = {}): void {
	expect(categories(command, options), command).toEqual(expected);
}

function expectPass(command: string, options: Parameters<typeof categories>[1] = {}): void {
	expectHit(command, [], options);
}

// ---------------------------------------------------------------------------
// 3.1 S1: shell control syntax and function definitions
// ---------------------------------------------------------------------------

test("S1 制御構文の語が単純コマンドの位置", () => {
	expectHit("for d in openspec/changes/*/; do ls \"$d\"; done", ["S1"]);
	expectHit("while read -r line; do echo \"$line\"; done < f.txt", ["S1"]);
	expectHit("until test -f ready; do sleep 1; done", ["S1"]);
	expectHit("if [ -f f.ts ]; then head f.ts; fi", ["S1"]);
	expectHit("case $name in a) echo 1;; esac", ["S1"]);
	expectHit("select x in a b; do echo $x; done", ["S1"]);
});

test("S1 関数定義が該当する", () => {
	expectHit("run_case() { name=$1; echo \"$name\"; }; run_case a", ["S1"]);
	expectHit("function run_case { echo x; }; run_case", ["S1"]);
	expectHit("function run_case() { echo x; }", ["S1"]);
});

test("S1 引用符内のキーワードは該当しない", () => {
	expectPass('rg "for (" src');
	expectPass('grep -n "case:" notes.md');
	expectPass("rg -n 'while (' packages");
	// A control word as an argument is a word, not a command position.
	expectPass("echo for");
	expectPass("printf 'if\\n'");
});

test("S1 入れ子の呼び出しには適用しない", () => {
	expectPass("for i in 1 2; do echo $i; done", { nested: true });
	expectPass("run_case() { echo x; }", { nested: true });
});

// ---------------------------------------------------------------------------
// 3.2 S2: programmable filters and long pipelines
// ---------------------------------------------------------------------------

test("S2 awk / jq / xargs が該当する", () => {
	expectHit("awk '{print $1}' /proc/loadavg", ["S2"]);
	expectHit("gawk '{print $1}' f.txt", ["S2"]);
	expectHit("mawk '{print $1}' f.txt", ["S2"]);
	expectHit("jq .version package.json", ["S2"]);
	expectHit("find . -name '*.ts' | xargs rm", ["S2"]);
});

test("S2 行範囲の print の sed は該当しない", () => {
	expectPass("sed -n '1,50p' packages/spirits/src/tools.ts");
	expectPass("sed -n '1,50p' a.ts | head -5");
});

test("S2 表示コマンドだけの sed は該当しない", () => {
	// spec のシナリオの形。複数範囲・パターンの範囲・1 行・`$`・正規表現の中の `;`。
	expectPass("sed -n '100,140p;195,215p' a.ts");
	expectPass("sed -n '/^## 7\\./,/^## 8\\./p' tasks.md");
	expectPass("sed -n '58p' a.ts");
	expectPass("sed -n '1,$p' a.ts");
	expectPass("sed -n '/a;b/,/c/p' a.ts");
	// 区切りの末尾と、ファイル名を複数並べた形。
	expectPass("sed -n '1,2p;' a.ts");
	expectPass("sed -n '1,5p' a.ts b.ts");
	// `\/` は区切りを終えない。
	expectPass("sed -n '/a\\/b/,/c/p' a.ts");
});

test("S2 行範囲の print の形に合わない sed が該当する", () => {
	expectHit("sed -n -e '1,50p' a.ts", ["S2"]);
	expectHit("sed -i 's/a/b/' f", ["S2"]);
	expectHit("sed 's/foo/bar/' a.ts", ["S2"]);
	// The exception names `-n` alone, so the same range script without it is a hit.
	expectHit("sed '1,50p' a.ts", ["S2"]);
	expectHit("sed --quiet '1,50p' a.ts", ["S2"]);
	expectHit("sed --silent '1,50p' a.ts", ["S2"]);
	// 表示コマンド以外が 1 つでも入る、またはアドレスが読めない形は通さない。
	expectHit("sed -n '1,50p;w out.txt' a.ts", ["S2"]);
	expectHit("sed -n '/a/,/b/{p}' a.ts", ["S2"]);
	expectHit("sed -n '1,50d' a.ts", ["S2"]);
	expectHit("sed -n 's/a/b/p' a.ts", ["S2"]);
	expectHit("sed -n '1, 50p' a.ts", ["S2"]);
	expectHit("sed -n 'p' a.ts", ["S2"]);
	expectHit("sed -n '/unclosed,2p' a.ts", ["S2"]);
	// 表示スクリプトに見えた語がスクリプトでないと分かる形。
	expectHit("sed -n '1,50p' -e '2p' a.ts", ["S2"]);
});

test("S2 2 段のパイプは該当しない", () => {
	expectPass("rg -n TODO src | head -20");
	expectPass("cat a.txt | grep foo");
	expectPass("git log --oneline | tee /tmp/log.txt");
});

test("S2 許可フィルタだけの 3 段以上は該当しない", () => {
	expectPass("cat a.txt | grep foo | sort | uniq -c | head -3");
	expectPass("rg foo src | cut -d: -f1 | head");
});

test("S2 3 段以上で許可フィルタ以外を含むと該当する", () => {
	expectHit("rg -n TODO src | sort | tee /tmp/todo.txt", ["S2"]);
	expectHit("git status --short | sed 's/^/  /' | cat", ["S2"]);
});

test("S2 閾値の定数を切り替えると判定が変わる", () => {
	const filterOnlyChain = "cat a.txt | grep foo | sort | uniq -c | head -3";
	expectPass(filterOnlyChain);
	// 許可フィルタだけの連鎖を通す判断を切ると、同じコマンドが 3 段のパイプとして該当になる。
	expectHit(filterOnlyChain, ["S2"], {
		thresholds: { stageThreshold: 3, filterOnlyPipelinesPass: false },
	});
	// 段数の閾値だけを上げると、2 段の連鎖は依然として通る。
	expectPass("rg -n TODO src | head -20", { thresholds: { stageThreshold: 2, filterOnlyPipelinesPass: true } });
	expectHit("rg -n TODO src | head -20", ["S2"], {
		thresholds: { stageThreshold: 2, filterOnlyPipelinesPass: false },
	});
});

test("S2 入れ子の呼び出しには適用しない", () => {
	expectPass("awk '{print $1}' /proc/loadavg", { nested: true });
	expectPass("rg -n TODO src | sort | tee /tmp/todo.txt", { nested: true });
});

// ---------------------------------------------------------------------------
// 3.3 S3: heredoc written out to a file
// ---------------------------------------------------------------------------

const HEREDOC_BODY = "\nfirst line\nsecond line\nEOF\n";

test("S3 ヒアドキュメントのファイル書き出しが該当する", () => {
	expectHit(`cat > /tmp/x.txt <<'EOF'${HEREDOC_BODY}`, ["S3"]);
	expectHit(`cat <<'EOF' >> notes.md${HEREDOC_BODY}`, ["S3"]);
	expectHit(`tee out.txt <<'EOF'${HEREDOC_BODY}`, ["S3"]);
	expectHit(`cat 1> /tmp/x.txt <<'EOF'${HEREDOC_BODY}`, ["S3"]);
});

test("S3 書き出し先が無いヒアドキュメントは該当しない", () => {
	expectPass(`cat <<'EOF'${HEREDOC_BODY}`);
	expectPass(`rg TODO <<'EOF'${HEREDOC_BODY}`);
});

test("S3 git commit へのヒアドキュメントは該当しない", () => {
	expectPass(`git commit -F - <<'EOF'${HEREDOC_BODY}`);
});

// ---------------------------------------------------------------------------
// 3.4 interpreter recognition
// ---------------------------------------------------------------------------

test("インタプリタの認識 パス付きと版付きの名前", () => {
	expectHit("/usr/bin/python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("python3.12 -c 'print(1)'", ["P1", "P3"]);
	expectHit("/usr/local/bin/node -e 'process.exit(0)'", ["P1"]);
});

test("インタプリタの認識 環境変数代入の後ろ", () => {
	expectHit("PYTHONPATH=. python3 -c 'print(1)'", ["P1", "P3"]);
});

test("インタプリタの認識 ラッパーの後ろ", () => {
	expectHit("env PYTHONPATH=. python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("timeout 30 python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("nohup python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("uv run python -c 'print(1)'", ["P1", "P3"]);
	expectHit("nohup python3 /tmp/check.py", ["P2", "P3"]);
	expectHit("nice -n 5 python3 /tmp/check.py", ["P2", "P3"]);
	expectHit("env -i python3 /tmp/check.py", ["P2", "P3"]);
	expectHit("timeout -s KILL 5 node /tmp/probe.mjs", ["P2"]);
});

test("インタプリタの認識 ラッパーの後ろが通すコマンドなら通す", () => {
	expectPass("env FOO=1 bun test");
	expectPass("timeout 30 bun test");
});

test("インタプリタの認識 シェルは認識しない", () => {
	expectPass("bash /tmp/run.sh");
	expectPass("sh /tmp/run.sh");
	expectPass("bash /tmp/run.py");
});

test("インタプリタの認識 nice の -N と前置きの time と !", () => {
	expectHit("nice -5 python3 /tmp/c.py", ["P2", "P3"]);
	expectHit("nice -10 python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("time python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit("! python3 -c 'print(1)'", ["P1", "P3"]);
	// 前置きの有無で判定が変わらないことは、通す側でも確かめる(spec の `time bun --version`)。
	expectPass("time bun --version");
	expectPass("time bun test");
	// 前置きはラッパー 5 つには数えないので、シェルへスクリプトを渡す実行はそのまま通る。
	expectPass("time bash /tmp/run.sh");
});

// 差し戻し W-2: ラッパー表は自身のキーだけを読む。Object.prototype の名前のコマンドで落ちない。
test("インタプリタの認識 ラッパー表の継承された名前は通常のコマンドとして通す", () => {
	for (const command of ["constructor hello", "toString x", "valueOf y", "hasOwnProperty z"]) {
		expectPass(command);
		expectPass(command, { nested: true });
	}
});

test("インタプリタの認識 未知のラッパーオプションは通す", () => {
	expectPass("env --unknown-flag python3 -c 'print(1)'");
	expectPass("timeout --foreground 30 python3 -c 'print(1)'");
	// `nohup` はオプション付きの形を読み飛ばさない。読み飛ばせないときは該当なしで通す。
	expectPass("nohup --unknown python3 -c 'print(1)'");
});

// ---------------------------------------------------------------------------
// 3.5 P1: inline code in another language
// ---------------------------------------------------------------------------

test("P1 python のインラインコードが該当する", () => {
	// python は名前でも止めるので、インラインコードは P1 と P3 の両方になる。
	expectHit("python3 -c 'import json; print(1)'", ["P1", "P3"]);
	expectHit(`python3 - <<'EOF'${HEREDOC_BODY}`, ["P1", "P3"]);
	expectHit("echo 'print(1)' | python3", ["P1", "P3"]);
});

test("P1 他のインタプリタのインラインコードが該当する", () => {
	expectHit('node -p "require(\'./package.json\').version"', ["P1"]);
	expectHit("node -e 'console.log(1)'", ["P1"]);
	expectHit("bun -e 'console.log(1)'", ["P1"]);
	expectHit("deno eval 'console.log(1)'", ["P1"]);
	expectHit("perl -e 'print 1'", ["P1"]);
	expectHit("ruby -e 'puts 1'", ["P1"]);
	expectHit("php -r 'echo 1;'", ["P1"]);
});

test("P1 モジュール実行とスクリプト実行は P1 ではない", () => {
	// P1 は該当しない。python の実行は名前側(P3)が止める。
	expectHit("python3 -m pytest -q", ["P3"]);
	expectHit("cat data.json | python3 -m json.tool", ["P3"]);
	expectHit("python3 scripts/check.py", ["P3"]);
	expectPass("node scripts/build.mjs");
});

test("P1 入れ子でも適用する", () => {
	expectHit("python3 -c 'print(1)'", ["P1", "P3"], { nested: true });
	expectHit("echo 'print(1)' | python3", ["P1", "P3"], { nested: true });
});

test("P1 オプションはインタプリタ自身のものだけ使う", () => {
	// 最初の非オプション語より後ろはスクリプト・モジュール・サブコマンドへの引数で、P1 ではない。
	// python は P3 が別に取りに行くので、ここでは P1 が出ないことだけを見る。
	// 差し戻し W-3: P1 が出ないことだけでなく、P3 だけになることを確かめる。
	for (const command of [
		"python3 -m pytest -c pytest.ini -q",
		"python3 scripts/check.py -c config.yaml",
		"cat data.json | python3 scripts/convert.py -",
		"time python3 --version",
	]) {
		expectHit(command, ["P3"]);
	}
	expectPass("node packages/coding-agent/dist/cli.js -p 'hello'");
	expectPass("bun build src/index.ts --outdir dist -e react");
	expect(categories("if python3 --version >/dev/null; then echo y; fi", { nested: true })).toEqual(["P3"]);
	// インタプリタの直後に付くものは従来どおり該当になる。
	expectHit("python3 -c 'print(1)'", ["P1", "P3"]);
	expectHit('node -p "1"', ["P1"]);
	expectHit("bun -e 'console.log(1)'", ["P1"]);
	expectHit("deno eval '1'", ["P1"]);
	expectHit("echo 'print(1)' |\npython3", ["P1", "P3"]);
});

// ---------------------------------------------------------------------------
// 3.6 P2: a scratch script under a temporary directory
// ---------------------------------------------------------------------------

test("P2 一時ディレクトリのスクリプト実行が該当する", () => {
	expectHit("python3 /tmp/check.py openspec", ["P2", "P3"]);
	expectHit("node /tmp/probe.mjs", ["P2"]);
	expectHit('python3 "$TMPDIR/check.py"', ["P2", "P3"]);
	expectHit("nice -n 5 python3 /tmp/c.py", ["P2", "P3"]);
	expectHit("bun /tmp/probe.mjs", ["P2"]);
});

test("P2 一時ディレクトリの TypeScript は該当しない", () => {
	expectPass("bun /tmp/check-session.ts");
	expectPass("node /tmp/probe.mts");
	expectPass("node /tmp/probe.cts");
});

test("P2 作業ディレクトリのスクリプトは該当しない", () => {
	// P2 は該当しない。python は名前側の P3 だけが該当する。
	expectHit("python3 scripts/check.py", ["P3"]);
	expectPass("node ./tools/probe.mjs");
});

test("P2 作業ディレクトリが一時ディレクトリ配下にある", () => {
	expectHit("python3 /tmp/work/scripts/check.py", ["P3"], { cwd: "/tmp/work" });
	expectHit("python3 /tmp/other.py", ["P2", "P3"], { cwd: "/tmp/work" });
	// 一時ディレクトリ配下のプロジェクトでも、python でないスクリプトは従来どおり通る。
	expectPass("node /tmp/work/scripts/probe.mjs", { cwd: "/tmp/work" });
});

test("P2 \`..\` を畳んだうえで作業ディレクトリ配下を除く", () => {
	expectHit("python3 /tmp/../home/u/proj/a.py", ["P3"]);
	expectHit("python3 /tmp/work/../other.py", ["P2", "P3"]);
	expectHit("python3 /tmp/x/../../home/u/proj/a.py", ["P3"]);
	expectHit("python3 work/../a.py", ["P3"], { cwd: "/tmp/work" });
	// python でないスクリプトはパスの解決だけを見る従来どおりの判定になる。
	expectPass("node /tmp/../home/u/proj/a.mjs");
	expectHit("node /tmp/work/../other.mjs", ["P2"]);
});

test("P2 相対パスは作業ディレクトリ基準で解決する", () => {
	expectHit("python3 a.py", ["P3"], { cwd: "/tmp/work" });
	expectHit("python3 check.py", ["P3"]);
	expectPass("node a.mjs", { cwd: "/tmp/work" });
});

// ---------------------------------------------------------------------------
// 3.6b P3: Python by name
// ---------------------------------------------------------------------------

test("P3 インラインコード以外の Python の起動が該当する", () => {
	expectHit("cat x.json | python3 -m json.tool", ["P3"]);
	expectHit("python3 scripts/check.py", ["P3"]);
	expectHit("python3 --version", ["P3"]);
	expectHit("/usr/bin/python3 ~/x.py", ["P3"]);
});

test("P3 Python のツールチェーンが該当する", () => {
	expectHit("pip install requests", ["P3"]);
	expectHit("pipx run black .", ["P3"]);
	expectHit("uv run pytest", ["P3"]);
	expectHit("uvx ruff check", ["P3"]);
	expectHit("pytest -q", ["P3"]);
	expectHit("poetry install", ["P3"]);
});

test("P3 Python のプロジェクト管理と対話環境が該当する", () => {
	expectHit("hatch run test", ["P3"]);
	expectHit("pdm install", ["P3"]);
	expectHit("tox -e py312", ["P3"]);
	expectHit("ipython", ["P3"]);
	expectHit("jupyter nbconvert --to script a.ipynb", ["P3"]);
});

test("P3 .py の直接実行が該当する", () => {
	expectHit("./scratch.py", ["P3"]);
	expectHit("scripts/run.py --flag", ["P3"]);
});

test("P3 ラッパーと環境変数代入の後ろも該当する", () => {
	expectHit("env PYTHONPATH=. python3 x.py", ["P3"]);
	expectHit("timeout 30 pytest -q", ["P3"]);
	expectHit("nohup python3 server.py", ["P3"]);
});

test("P3 Python を引数として扱うだけのコマンドは該当しない", () => {
	expectPass("rg -n python src");
	expectPass("ls scripts/*.py");
	expectPass("cat setup.py");
});

test("P3 インラインコードは P1 と P3 の両方に該当する", () => {
	expectHit("python3 -c 'print(1)'", ["P1", "P3"]);
});

test("P3 入れ子でも適用する", () => {
	expectHit("pytest -q", ["P3"], { nested: true });
	expectHit("python3 scripts/test.py", ["P3"], { nested: true });
	// S 系と違い、作業ディレクトリがどこでも判定は変わらない。
	expectHit("python3 x.py", ["P3"], { cwd: "/tmp/work" });
});

// spec "引用符を解釈する判定" の P3 の例外。コマンド位置の固定された名前は引用でも読む。
test("P3 引用されたコマンド名を読む 展開される名前は読まない", () => {
	expectHit(`"pytest" -q`, ["P3"]);
	expectHit(`"./scratch.py"`, ["P3"]);
	expectHit(`env "python3" x.py`, ["P3"]);
	// 引数の中の文字と、実行時に決まる名前は対象外。
	expectPass(`rg "pytest" src`);
	expectPass(`cat "setup.py"`);
	expectPass(`"$PY" -q`);
	expectPass(`$PY -q`);
});

test("P3 プロジェクト自身のテストも通さない", () => {
	expectHit("pytest", ["P3"]);
	expectHit("python3 -m pytest -q", ["P3"]);
	expectHit("cd /work/project && pytest -q", ["P3"]);
});

// ---------------------------------------------------------------------------
// 3.6c the strings a shell's -c and eval receive are classified again
// ---------------------------------------------------------------------------

test("シェルの -c の中の Python が該当する", () => {
	expectHit(`bash -c "python3 -c 'print(1)'"`, ["P1", "P3"]);
	expectHit("sh -lc 'pytest -q'", ["P3"]);
	// 1 文字オプションのまとまりの中の c でもよい。オプションを並べた形も同じ。
	expectHit("bash -ec 'pip install requests'", ["P3"]);
	expectHit(`bash --norc -c "python3 x.py"`, ["P3"]);
});

test("eval の中の Python が該当する", () => {
	expectHit('eval "python3 x.py"', ["P3"]);
	expectHit("eval pytest -q", ["P3"]);
});

test("直接の呼び出しではシェルの -c の中に S も適用する", () => {
	expectHit("bash -c 'for i in 1 2; do echo $i; done'", ["S1"]);
	expectHit("bash -c 'rg -n TODO src | sort | tee /tmp/todo.txt'", ["S2"]);
	expectHit("zsh -c 'awk \"{print \$1}\" /proc/loadavg'", ["S2"]);
});

test("入れ子の呼び出しではシェルの -c の中に S を適用しない", () => {
	expectPass("bash -c 'for i in 1 2; do echo $i; done'", { nested: true });
	expectPass("bash -c 'rg -n TODO src | sort | tee /tmp/todo.txt'", { nested: true });
});

test("入れ子の呼び出しでもシェルの -c の中に P を適用する", () => {
	expectHit("bash -c 'python3 x.py'", ["P3"], { nested: true });
});

test("入れ子のシェルの -c も分類し直す", () => {
	expectHit(`bash -c "sh -c 'python3 x.py'"`, ["P3"]);
	// 外側の二重引用符が `$i` を展開するので、内側の文字列はそのままでは読めない。展開の無い形を読む。
	expectHit(`bash -c "sh -c 'for i in a b; do true; done'"`, ["S1"]);
	expectPass(`bash -c "sh -c 'for i in a b; do true; done'"`, { nested: true });
	// 展開を受ける文字列は段を数えない。上の形が読めないのと同じ理由で該当なし。
	expectPass(`bash -c "sh -c 'for i in 1 2; do echo $i; done'"`);
});

// spec "シェル自身のオプションだけを読む"。`-c` がスクリプトの引数ならシェルの物ではない。
test("シェルの -c はオプション領域の中だけ読む", () => {
	expectPass(`bash scripts/run.sh -c "pytest"`);
	expectPass(`bash -- scripts/run.sh -c "pytest"`);
	// bash は `-c` の後ろにオプションを続けても、コマンド文字列を最初の非オプション語から読む。
	expectHit(`bash -c -x "pytest"`, ["P3"]);
	expectHit(`bash --norc -c "pytest"`, ["P3"]);
});

// spec "外側で変数を展開する文字列と固定文字列を区別する"。
test("外側で展開される文字列は分類し直さない", () => {
	expectPass(`bash -c "echo $X; pytest"`);
	expectHit(`bash -c 'echo $X; pytest'`, ["P3"]);
	expectPass(`eval "echo $X; pytest"`);
	expectHit(`eval 'echo $X; pytest'`, ["P3"]);
	// エスケープした `$` は展開ではない。
	expectHit(`bash -c "echo \\$X; pytest"`, ["P3"]);
});

test("分類し直すのは 3 段目までで 4 段目以降は分類しない", () => {
	// `python3 x.py` は 3 段目。ここまで读到だが、4 段目以降は見ない。
	expectHit("eval eval eval python3 x.py", ["P3"]);
	expectPass("eval eval eval eval python3 x.py");
	// シェルの入れ子でも数え方は同じ。内側の `python3 x.py` が 3 段目なら读到、4 段目なら読まない。
	expectHit(`bash -c "eval eval python3 x.py"`, ["P3"]);
	expectPass(`bash -c "eval eval eval python3 x.py"`);
});

test("実行時に決まる文字列は分類し直さない", () => {
	expectPass('bash -c "$(cat cmd.txt)"');
	expectPass("bash -c `cat cmd.txt`");
	expectPass('eval "$(cat cmd.txt)"');
	// 語が dynamic でなくても、コマンド名そのものが実行時に決まる形は対象外。
	expectPass("PY=python3; $PY --version");
});

test("シェルにスクリプトファイルを渡す実行は分類し直さない", () => {
	expectPass("bash scripts/run.sh");
	expectPass("sh -x scripts/run.sh");
	expectPass("bash /tmp/run.sh");
	// ラッパー以外のコマンドに引数として渡したコマンドも対象外。
	expectPass("sudo pip install requests");
	expectPass("docker run python:3.12 python x.py");
	expectPass('ssh host "python3 x.py"');
});

test("-c の読み直しは他の判定と足し合わせになる", () => {
	// 外側のパイプと内側のループは別の段として数える(字句解析は 1 つにまとめない)。
	expectHit("bash -c 'for i in 1 2; do echo $i; done' | awk '{print}'", ["S1", "S2"]);
	// `-c` の語そのものが Python を起動する形は無いので、外側の名前だけなら該当しない。
	expectPass("bash -c scripts/run.sh");
});

// ---------------------------------------------------------------------------
// 3.7 commands the guard must let through
// ---------------------------------------------------------------------------

test("通すコマンド 単発と連結", () => {
	for (const command of [
		"bun run check",
		"bun install",
		"npm run check",
		"cd /tmp && bun test packages/spirits/test/tools.test.ts 2>&1 | tail -20",
		"git status --short; git branch --show-current",
		"ls -la && pwd || echo failed",
	]) {
		expectPass(command);
	}
});

test("通すコマンド 絞り込みのパイプ", () => {
	for (const command of [
		"git status --short | head -20",
		"npm run check 2>&1 | tail -40",
		'find . -name "*.ts" | head -5',
		"rg foo src | cut -d: -f1 | head",
		"cat a.txt | grep foo | sort | uniq -c | head -3",
		"ls | head && ls | head && ls | head",
	]) {
		expectPass(command);
	}
});

test("通すコマンド 前置きとグループと行の継続とプロジェクトの実行", () => {
	for (const command of [
		"time bun test packages/spirits 2>&1 | tail -15",
		"time rg -n TODO src | head -20",
		"! git diff --quiet | head",
		"{ git status --short; git log -1 --oneline; } | head",
		"rg -n TODO src | \\\nsort | \\\nhead",
		"node packages/coding-agent/dist/cli.js -p 'hello'",
		"bun build src/index.ts --outdir dist -e react",
	]) {
		expectPass(command);
	}
});

test("通すコマンド 実ログの通過ケースも該当なし", () => {
	const file = new URL("./fixtures/guard/pass-cases.json", import.meta.url);
	const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: { command: string }[] }).cases;
	expect(cases.length).toBeGreaterThanOrEqual(40);
	for (const item of cases) {
		expectPass(item.command);
	}
});

// ---------------------------------------------------------------------------
// 3.8 stage counts are per pipeline
// ---------------------------------------------------------------------------

test("段数はパイプ単位で数える", () => {
	// one 3-stage pipeline: the 2nd and 3rd stages are not filters.
	expectHit("a && b | c | d; e", ["S2"]);
	// two 2-stage pipelines: neither reaches the threshold.
	expectPass("a | b || c | d");
	expectPass("ls | head && ls | head && ls | head");
});

test("段数に数えない", () => {
	// 前置きの `time` と `!` は次の語がコマンドで、グループは 1 段。
	expectPass("time bun test 2>&1 | tail -20");
	expectPass("! git diff --quiet | head");
	expectPass("{ git status --short; git log -1 --oneline; } | head");
	// 行の継続とパイプの後の改行は段を割らない。
	expectPass("rg -n TODO src | \\\nsort | \\\nhead");
	expectHit("rg x |\nsort |\ntee f", ["S2"]);
	// グループの中の連鎖はグループ自身の段数で数える。
	expectHit("{ rg x | sort | tee f; }", ["S2"]);
});

// ---------------------------------------------------------------------------
// 3.9 commands taken from real session logs, sanitized
// ---------------------------------------------------------------------------

interface HitFixtureFile {
	comment: string;
	cases: { command: string; expect: GuardCategoryId[] }[];
}

function hitCases(): HitFixtureFile["cases"] {
	const file = new URL("./fixtures/guard/hit-cases.json", import.meta.url);
	return (JSON.parse(readFileSync(file, "utf8")) as HitFixtureFile).cases;
}

/** The scope the fixture's paths were read against, as its comment states. */
const FIXTURE_SCOPE: GuardScope = { cwd: "/work/project/spirits", tempDirectories: ["/tmp", "/var/tmp"] };

test("実ログの分類 期待した分類 ID になる", () => {
	const cases = hitCases();
	expect(cases.length).toBeGreaterThanOrEqual(30);
	const seen = new Set<GuardCategoryId>();
	for (const item of cases) {
		const found = classify(item.command, FIXTURE_SCOPE, {}).categories;
		expect(found, item.command).toEqual(item.expect);
		for (const id of item.expect) seen.add(id);
	}
	// The fixture is only evidence for all six categories if it exercises all six.
	expect([...seen].sort()).toEqual(["P1", "P2", "P3", "S1", "S2", "S3"]);
});

test("実ログの分類に秘密のパターンを含めない", () => {
	const secret = /\/home\/|\/Users\/|[A-Za-z0-9_-]{32,}|@[A-Za-z0-9.-]+\.[a-z]{2,}/;
	expect(JSON.stringify(hitCases())).not.toMatch(secret);
});

// ---------------------------------------------------------------------------
// 3.10 the classifier never throws
// ---------------------------------------------------------------------------

test("例外を投げない 空文字列", () => {
	expect(() => classify("", scope(), {})).not.toThrow();
	expectPass("");
});

test("例外を投げない NUL を含む入力", () => {
	expectPass("echo a\0b");
	expect(() => classify("echo \0 | python3", scope(), {})).not.toThrow();
});

test("例外を投げない 入れ子が深い部分展開", () => {
	const deep = `${"$((".repeat(400)}1${")".repeat(400)}`;
	const verdict = classify(`echo ${deep}`, scope(), {});
	expect(verdict.categories).toEqual([]);
});

test("例外を投げない 4096 段のパイプ", () => {
	const stages = Array.from({ length: 4095 }, () => "grep -v x");
	stages.push("tee /tmp/out.txt");
	const verdict = classify(`cat f.txt | ${stages.join(" | ")}`, scope(), {});
	expect(verdict.parseError).toBe(false);
	expect(verdict.categories).toEqual(["S2"]);
});

test("例外を投げない 閉じられていない引用符は通す", () => {
	const verdict = classify('echo "unclosed | awk', scope(), {});
	expect(verdict.parseError).toBe(true);
	expect(verdict.categories).toEqual([]);
});
