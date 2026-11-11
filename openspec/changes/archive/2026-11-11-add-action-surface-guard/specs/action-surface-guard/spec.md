# Spec Delta

## Purpose

モデルが bash で他言語のスクラッチコードやシェルのプログラミングを書こうとしたとき、実行前にそれを検出して tsrepl のセルへ導く。対象のプロジェクト自身の実行・テストコマンドは制限しない。

## ADDED Requirements

### Requirement: bash 呼び出しの実行前検査
システムは、bash ツールの呼び出しを実行前に受け取り、コマンド文字列を分類して、該当する呼び出しを実行してはならない。(MUST) 実行を止めたときは、理由をモデルへ返さなければならない。(SHALL)
分類に該当しない呼び出しは、従来どおり実行する。

#### Scenario: 分類に該当したら実行しない
- **WHEN** bash で `for f in packages/spirits/src/*.ts; do wc -l "$f"; done` を実行する
- **THEN** コマンドは実行されず、結果はエラーで、理由に分類 ID `S1` が含まれる

#### Scenario: 該当しなければ実行する
- **WHEN** bash で `git status --short` を実行する
- **THEN** 分類は行われず、コマンドの実行結果が返る

### Requirement: 分類 S1 シェルの制御構文
分類 S1 は、単純コマンドの位置に for / while / until / if / case / select のいずれかがあるコマンド、またはシェル関数の定義(`name() { ... }` 形式と `function name { ... }` 形式)を含むコマンドに該当しなければならない。(SHALL)

#### Scenario: for ループが該当する
- **WHEN** `for d in openspec/changes/*/; do ls "$d"; done` を分類する
- **THEN** S1 に該当する

#### Scenario: 関数定義が該当する
- **WHEN** `run_case() { name=$1; echo "$name"; }; run_case a` を分類する
- **THEN** S1 に該当する

#### Scenario: function キーワードの関数定義が該当する
- **WHEN** `function run_case { echo x; }; run_case` を分類する
- **THEN** S1 に該当する

### Requirement: 分類 S2 プログラム可能なフィルタと長いパイプ
段数は、パイプでつながれたコマンドの数とする。許可フィルタは head / tail / wc / grep / rg / sort / uniq / cut / tr / cat / nl / column とする。
分類 S2 は、次のいずれかに該当しなければならない。(SHALL)
- awk(gawk、mawk を含む)、jq、xargs を単純コマンドの位置に置く
- sed の使用。ただし、オプションが `-n` だけで、スクリプトが `A,Bp`(A と B は 10 進整数)の 1 つだけで、残りがファイル名だけの形は除く
- 3 段以上のパイプで、2 段目以降に許可フィルタ以外のコマンドを含む(1 段目は任意のコマンド)

段数の数え方は、次の要件「パイプの段数の数え方」による。

#### Scenario: awk が該当する
- **WHEN** `awk '{print $1}' /proc/loadavg` を分類する
- **THEN** S2 に該当する

#### Scenario: 行範囲の print の sed は該当しない
- **WHEN** `sed -n '1,50p' packages/spirits/src/tools.ts` を分類する
- **THEN** S2 に該当しない

#### Scenario: 行範囲の print の形に合わない sed が該当する
- **WHEN** `sed -n '5p' a.ts`、`sed -n '1,$p' a.ts`、`sed -n -e '1,50p' a.ts`、`sed '1,50p' a.ts`(`-n` なし)、`sed --quiet '1,50p' a.ts` をそれぞれ分類する
- **THEN** いずれも S2 に該当する

#### Scenario: 置換の sed が該当する
- **WHEN** `sed -i 's/foo/bar/' a.ts` を分類する
- **THEN** S2 に該当する

#### Scenario: 2 段のパイプは該当しない
- **WHEN** `rg -n TODO src | head -20`、`cat a.txt | grep foo`、`git log --oneline | tee /tmp/log.txt` をそれぞれ分類する
- **THEN** いずれも S2 に該当しない

#### Scenario: 許可フィルタだけの 3 段以上は該当しない
- **WHEN** `cat a.txt | grep foo | sort | uniq -c | head -3` と `rg foo src | cut -d: -f1 | head` をそれぞれ分類する
- **THEN** いずれも S2 に該当しない

#### Scenario: 3 段以上で許可フィルタ以外を含むと該当する
- **WHEN** `rg -n TODO src | sort | tee /tmp/todo.txt` を分類する
- **THEN** S2 に該当する

### Requirement: パイプの段数の数え方
システムは、パイプの段数を、`&&`、`||`、`;`、改行で区切られたパイプごとに数えなければならない。(SHALL) `|`、`&&`、`||` の直後の改行と、引用符の外の `\` + 改行(行の継続)は、区切りとして扱わない。単純コマンドの前に置かれた `time` と `!`、および `{` `}` `then` `do` などのシェルの構文語は、段に数えない。`{ ...; }` と `( ... )` で囲んだグループは、パイプの 1 段として数える。

#### Scenario: 段数は連結をまたいで数えない
- **WHEN** `ls | head && ls | head && ls | head` を分類する
- **THEN** 2 段のパイプが 3 本として扱われ、S2 に該当しない

#### Scenario: 前置きの time と ! は段に数えない
- **WHEN** `time bun test 2>&1 | tail -20` と `! git diff --quiet | head` をそれぞれ分類する
- **THEN** いずれも 2 段のパイプとして扱われ、S2 に該当しない

#### Scenario: グループは 1 段として数える
- **WHEN** `{ git status --short; git log -1 --oneline; } | head` を分類する
- **THEN** 2 段のパイプとして扱われ、S2 に該当しない

#### Scenario: 行の継続とパイプの後の改行は段を分けない
- **WHEN** 行末が `\` の 3 行 `rg -n TODO src | \`、`sort | \`、`head` を 1 つのコマンドとして分類し、続けて `rg x |`、`sort |`、`tee f` を改行でつないだ 3 行を分類する
- **THEN** 前者は許可フィルタだけの 3 段のパイプとして S2 に該当せず、後者は 3 段の 1 本のパイプとして S2 に該当する

### Requirement: 分類 S3 ヒアドキュメントによるファイル内容の生成
分類 S3 は、ヒアドキュメントの内容がファイルへ書き出されるコマンドに該当しなければならない。(SHALL) 書き出しは、ヒアドキュメントを標準入力に取るコマンドの標準出力を `>` または `>>`(`1>` を含む)でファイルへリダイレクトする形、およびヒアドキュメントを標準入力に取る tee とする。git commit へヒアドキュメントでメッセージを渡すコマンドは該当しない。

#### Scenario: ヒアドキュメントでのファイル書き出しが該当する
- **WHEN** `cat > /tmp/probe.mjs <<'EOF'` で始まり本文が続くコマンドを分類する
- **THEN** S3 に該当する

#### Scenario: リダイレクトがヒアドキュメント記号の後ろにある形と追記が該当する
- **WHEN** `cat <<'EOF' >> notes.md` で始まり本文が続くコマンドを分類する
- **THEN** S3 に該当する

#### Scenario: tee への書き出しが該当する
- **WHEN** `tee out.txt <<'EOF'` で始まり本文が続くコマンドを分類する
- **THEN** S3 に該当する

#### Scenario: 書き出し先が無いヒアドキュメントは該当しない
- **WHEN** `cat <<'EOF'` で始まり本文が続くコマンドを分類する
- **THEN** S3 に該当しない

#### Scenario: git commit へのヒアドキュメントは該当しない
- **WHEN** `git commit -F - <<'EOF'` でメッセージ本文が続くコマンドを分類する
- **THEN** S3 に該当しない

### Requirement: インタプリタの認識
分類 P1 と P2 は、python、node、bun、deno、perl、ruby、php をインタプリタとして認識しなければならない。(SHALL) 次の形も、同じインタプリタとして認識しなければならない。(SHALL)
- パス付きの名前(`/usr/bin/python3`)と版付きの名前(`python3`、`python3.12`)
- 単純コマンドの先頭にある環境変数代入(`PYTHONPATH=. python3 -c ...`)
- ラッパー `env`、`timeout`、`nice`、`uv run` の後ろ。ラッパーは、ラッパー自身のオプションと値(`nice` の `-n N` と `-N`(`-` と 10 進整数)を含む)を読み飛ばした後の最初の語を実際のコマンドとして扱う。

ラッパーはこの 4 つに限る。`bash` / `sh` などのシェルは、インタプリタとしてもラッパーとしても認識しない。ラッパーのオプションを読み飛ばせない場合は、該当なしとして通さなければならない。(MUST)

#### Scenario: パス付きと版付きの名前を認識する
- **WHEN** `/usr/bin/python3 -c 'print(1)'` と `python3.12 -c 'print(1)'` をそれぞれ分類する
- **THEN** いずれも P1 に該当する

#### Scenario: 環境変数代入の後ろを認識する
- **WHEN** `PYTHONPATH=. python3 -c 'print(1)'` を分類する
- **THEN** P1 に該当する

#### Scenario: ラッパーの後ろを認識する
- **WHEN** `env PYTHONPATH=. python3 -c 'print(1)'`、`timeout 30 python3 -c 'print(1)'`、`uv run python -c 'print(1)'` をそれぞれ分類する
- **THEN** いずれも P1 に該当する

#### Scenario: ラッパーの後ろのスクリプトを認識する
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `nice -n 5 python3 /tmp/check.py` を分類する
- **THEN** P2 に該当する

#### Scenario: nice の -N を読み飛ばす
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `nice -5 python3 /tmp/check.py` と `nice -10 python3 -c 'print(1)'` をそれぞれ分類する
- **THEN** 前者は P2、後者は P1 に該当する

#### Scenario: ラッパーの後ろが通すコマンドなら通す
- **WHEN** `env FOO=1 bun test` と `timeout 30 pytest -q` をそれぞれ分類する
- **THEN** どの分類にも該当しない

#### Scenario: シェルは認識しない
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `bash /tmp/run.sh` を分類する
- **THEN** どの分類にも該当しない

### Requirement: 前置きの time と !
システムは、単純コマンドの前に置かれた `time` と `!` を、シェルの予約語として読み飛ばし、前置きが無いときと同じに分類しなければならない。(SHALL) 両者はラッパー(`env`、`timeout`、`nice`、`uv run`)には数えない。

#### Scenario: 前置きの time と ! は判定を変えない
- **WHEN** `time python3 -c 'print(1)'`、`! python3 -c 'print(1)'`、`time python3 --version` をそれぞれ分類する
- **THEN** 前の 2 つは P1 に該当し、`time python3 --version` はどの分類にも該当しない

### Requirement: 分類 P1 他言語のインラインコード
分類 P1 は、インタプリタにコードを直接渡す実行に該当しなければならない。(SHALL) 対象は、python の `-c`、引数 `-`、およびスクリプトも `-m` も取らずにヒアドキュメントまたはパイプで標準入力を受ける形、node の `-e` / `-p`、bun の `-e`、deno の `eval`、perl の `-e`、ruby の `-e`、php の `-r` とする。
P1 の判定に使うオプションと引数 `-` は、インタプリタの直後から、最初のオプションでない語(スクリプト、python の `-m` のモジュール名、bun や deno のサブコマンド)の前までに現れるものだけとする。それより後ろの語は、スクリプト、モジュール、サブコマンドへの引数であり、P1 の判定に使わない。deno の `eval` は、この最初の語自体が該当の条件である。

#### Scenario: python -c が該当する
- **WHEN** `python3 -c 'import json; print(1)'` を分類する
- **THEN** P1 に該当する

#### Scenario: python へのヒアドキュメントが該当する
- **WHEN** `python3 - <<'EOF'` で始まり本文が続くコマンドを分類する
- **THEN** P1 に該当する

#### Scenario: python へのパイプでの入力が該当する
- **WHEN** `echo 'print(1)' | python3` を分類する
- **THEN** P1 に該当する

#### Scenario: パイプの後の改行を越えた入力が該当する
- **WHEN** `echo 'print(1)' |` の次の行に `python3` を置いた 2 行のコマンドを分類する
- **THEN** P1 に該当する

#### Scenario: node -p が該当する
- **WHEN** `node -p "require('./package.json').version"` を分類する
- **THEN** P1 に該当する

#### Scenario: モジュール実行とスクリプト実行は該当しない
- **WHEN** `python3 -m pytest -q`、`uv run pytest`、`cat data.json | python3 -m json.tool` をそれぞれ分類する
- **THEN** いずれも P1 に該当しない

#### Scenario: スクリプトとモジュールへの引数は判定に使わない
- **WHEN** `python3 -m pytest -c pytest.ini -q`、`python3 scripts/check.py -c config.yaml`、`cat data.json | python3 scripts/convert.py -`、`node packages/coding-agent/dist/cli.js -p 'hello'`、`bun build src/index.ts --outdir dist -e react` をそれぞれ分類する
- **THEN** いずれも P1 に該当しない

#### Scenario: 構文語の後ろのインタプリタは標準入力を受けない
- **WHEN** 入れ子の呼び出しとして `if python3 --version >/dev/null; then echo y; fi` を分類する
- **THEN** P1 に該当しない

### Requirement: 分類 P2 一時ディレクトリ配下のスクリプト実行
分類 P2 は、インタプリタで一時ディレクトリ配下の、TypeScript(`.ts`、`.mts`、`.cts`)以外のスクリプトを実行するコマンドに該当しなければならない。(SHALL)
一時ディレクトリは、`/tmp`、`/var/tmp`、およびガードの起動時に OS が示す一時ディレクトリ(環境変数 `TMPDIR` を含む)とする。パスを示す語が `$TMPDIR` または `${TMPDIR}` で始まる場合も、一時ディレクトリ配下とする。パスは `..` を畳み、相対パスは作業ディレクトリを基準に解決してから判定する。
ただし、セッションの作業ディレクトリ配下のパスは、一時ディレクトリ配下でも該当しない。(SHALL)
スクリプトは、インタプリタのオプションを読み飛ばした後の最初の語とする(`bun run` と `deno run` の `run` は読み飛ばす)。

#### Scenario: 一時ディレクトリの python スクリプトが該当する
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `python3 /tmp/check.py openspec` を分類する
- **THEN** P2 に該当する

#### Scenario: 一時ディレクトリの JavaScript が該当する
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `node /tmp/probe.mjs` を分類する
- **THEN** P2 に該当する

#### Scenario: TMPDIR 配下が該当する
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `python3 "$TMPDIR/check.py"` を分類する
- **THEN** P2 に該当する

#### Scenario: 一時ディレクトリの TypeScript は該当しない
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `bun /tmp/check-session.ts` を分類する
- **THEN** P2 に該当しない

#### Scenario: 作業ディレクトリのスクリプトは該当しない
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `python3 scripts/check.py` を分類する
- **THEN** P2 に該当しない

#### Scenario: 作業ディレクトリが一時ディレクトリ配下にある
- **WHEN** 作業ディレクトリが `/tmp/work` のとき `python3 /tmp/work/scripts/check.py` と `python3 /tmp/other.py` をそれぞれ分類する
- **THEN** 前者は P2 に該当せず、後者は P2 に該当する

### Requirement: 分類の適用範囲
システムは、分類 S を、モデルが直接呼び出した bash にだけ適用しなければならない。(SHALL) 他のツールが入れ子で実行した bash 呼び出しには分類 S を適用しない。
システムは、分類 P を、直接の呼び出しと入れ子の呼び出しの両方に適用しなければならない。(SHALL)
入れ子の呼び出しをブロックしたときの理由は、呼び出し元のツールへエラーとして返らなければならない。(SHALL)

#### Scenario: 入れ子では S を適用しない
- **WHEN** tsrepl のセルから `tool("bash", { command: "for i in 1 2; do echo $i; done" })` を実行する
- **THEN** コマンドは実行される

#### Scenario: 入れ子でも P を適用する
- **WHEN** tsrepl のセルから `tool("bash", { command: "python3 -c 'print(1)'" })` を実行する
- **THEN** コマンドは実行されず、理由に分類 ID が含まれる

#### Scenario: 入れ子のブロックはセルでは例外になる
- **WHEN** tsrepl のセル `try { await tool("bash", { command: "python3 -c 'print(1)'" }) } catch (e) { return String(e) }` を実行する
- **THEN** value に分類 ID `P1` を含む理由が入る

### Requirement: 通すコマンド
システムは、分類 S と P のいずれにも該当しない bash 呼び出しを実行しなければならない。(MUST) 次の形は、どの分類にも該当しない。
- 単発のコマンド、`&&`、`||`、`;` での連結
- 2 段までのパイプ
- 2 段目以降が許可フィルタだけの、3 段以上のパイプ
- 上記の形に `time` と `!` を前置きしたもの、`{ ...; }` と `( ... )` で囲んだグループを 1 段とするパイプ
- 対象プロジェクト自身の実行・テストコマンド(bun、npm、pytest、uv など)。スクリプトやモジュールへ `-c`、`-e`、`-p`、`-` などの引数を渡す実行を含む
- 作業ディレクトリ配下の既存スクリプトの実行

#### Scenario: 連結した単発コマンドを通す
- **WHEN** `cd /tmp && bun test packages/spirits/test/tools.test.ts 2>&1 | tail -20` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: プロジェクト自身のツールチェーンを通す
- **WHEN** `bun run check`、`bun install`、`pytest` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 絞り込みのパイプを通す
- **WHEN** `git status --short | head -20` と `npm run check 2>&1 | tail -40` をそれぞれ分類する
- **THEN** いずれもどの分類にも該当しない

#### Scenario: 前置きとグループのパイプを通す
- **WHEN** `time bun test packages/spirits 2>&1 | tail -15` と `{ git status --short; git log -1 --oneline; } | head` をそれぞれ分類する
- **THEN** いずれもどの分類にも該当しない

### Requirement: 引用符を解釈する判定
システムは、コマンド文字列を、引用符・エスケープ・部分展開・ヒアドキュメントを解釈して分類しなければならない。(SHALL) 引用符内とヒアドキュメント本文の文字列を、コマンド名、制御構文、演算子として扱ってはならない。(MUST) 解析できないコマンド文字列は該当なしとして通さなければならない。(MUST)

#### Scenario: 引用符内のキーワードで発火しない
- **WHEN** `rg "for (" src` および `grep -n "case:" notes.md` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 引用符内の演算子を数えない
- **WHEN** `echo "a | b | c | d"` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 解析できない入力は通す
- **WHEN** 閉じられない引用符を含むコマンド文字列を分類する
- **THEN** 該当なしとし、実行を止めない

### Requirement: ブロック理由の内容
システムは、実行を止めたときに返す理由へ、該当した分類 ID、tsrepl での書き換え例 1 行、および利用者が環境変数 `SPIRITS_ACTION_GUARD` で動作モードを切り替えられる旨を含めなければならない。(SHALL) 理由にコマンド本文を再現してはならない。(MUST)

#### Scenario: 理由に分類 ID と例が含まれる
- **WHEN** 分類 P1 に該当する bash 呼び出しがブロックされる
- **THEN** 理由に `P1` と、`sh()` または `tool("bash", ...)` を使うセルの例の 1 行と、`SPIRITS_ACTION_GUARD` が含まれる

#### Scenario: 複数の分類に該当する
- **WHEN** 分類 S1 と P1 の両方に該当する bash 呼び出しがブロックされる
- **THEN** 理由に `S1` と `P1` の両方が含まれる

#### Scenario: コマンド本文を再現しない
- **WHEN** `python3 -c 'print("secret-token")'` がブロックされる
- **THEN** 理由に `secret-token` は含まれない

### Requirement: 動作モードの切り替え
システムは、ガードの動作を `enforce`、`warn`、`off` の 3 モードから、環境変数 `SPIRITS_ACTION_GUARD` で設定できなければならない。(SHALL) 既定は `enforce` とする。この 3 つの値と完全に一致しない値(空文字列、大文字を含む値、前後に空白を含む値を含む)は `enforce` として扱う。
`warn` は実行を止めない。`off` は分類を行わない。

#### Scenario: 既定は enforce
- **WHEN** モードを設定せずに分類に該当する bash 呼び出しを実行する
- **THEN** 実行は止められる

#### Scenario: 不正な値は enforce になる
- **WHEN** `SPIRITS_ACTION_GUARD` に `strict`、`Warn`、空文字列をそれぞれ設定して分類に該当する bash 呼び出しを実行する
- **THEN** いずれも実行は止められる

#### Scenario: warn では実行を止めない
- **WHEN** `warn` に設定して分類に該当する bash 呼び出しを実行する
- **THEN** コマンドは実行され、モデルへは理由を返さない

#### Scenario: off では分類しない
- **WHEN** `off` に設定して分類に該当する bash 呼び出しを実行する
- **THEN** コマンドは実行され、判定の計測も記録されない

### Requirement: 判定の計測
システムは、bash 呼び出しの判定のうち分類に該当したものについて、カスタムエントリ `spirits_guard` をセッションへ 1 件記録しなければならない。(SHALL) 記録するフィールドは、該当した分類 ID の配列 `category`、動作モード `mode`、実行を止めたか `blocked`、入れ子の呼び出しか `nested` の 4 つに限る。
記録に失敗しても判定結果と実行結果を変えてはならない。(MUST) `spirits_guard` を LLM のコンテキストへ送ってはならない。(MUST)

#### Scenario: ブロックの記録
- **WHEN** `enforce` で分類 S1 に該当する bash 呼び出しをブロックする
- **THEN** `category` が `["S1"]`、`mode` が `enforce`、`blocked` が真、`nested` が偽のエントリが 1 件記録される

#### Scenario: 該当なしは記録しない
- **WHEN** どの分類にも該当しない bash 呼び出しを実行する
- **THEN** 判定の計測エントリは記録されない

#### Scenario: 記録の失敗が実行を変えない
- **WHEN** 記録が例外になる状態で分類に該当する bash 呼び出しを実行する
- **THEN** 判定どおりにブロックされる

#### Scenario: warn の記録
- **WHEN** `warn` で分類に該当する bash 呼び出しを実行する
- **THEN** ブロックせずに実行し、`mode` が `warn`、`blocked` が偽のエントリが記録される

#### Scenario: コンテキストへ送らない
- **WHEN** 分類に該当する bash 呼び出しを判定した後にセッションのエントリとメッセージ列を取得する
- **THEN** エントリに `spirits_guard` が 1 件追加され、メッセージ列にその内容は含まれない

### Requirement: 計測にコマンド本文を含めない
システムは、判定の計測エントリに、コマンド文字列、コマンドの出力、引数の値を含めてはならない。(MUST)

#### Scenario: 本文を記録しない
- **WHEN** `python3 -c 'print("secret-token")'` がブロックされる
- **THEN** 計測エントリのどのフィールドにも `python3` と `secret-token` は含まれない

### Requirement: ガードはセキュリティ境界ではない
システムは、ガードをモデルの挙動の誘導として実装し、セキュリティの回避手段を塞ぐことを要求してはならない。(MUST) 他ツールや REPL の import 経由の迂回、およびシェル自身に `-c` でコードを渡す実行は、ガードの対象としない。

#### Scenario: 迂回を塞がない
- **WHEN** tsrepl のセルで `use("node:child_process")` を呼ぶ
- **THEN** ガードは介入せず、tsrepl の import 許可判定だけが適用される

#### Scenario: シェルの -c は対象にしない
- **WHEN** bash で `bash -c 'for i in 1 2; do echo $i; done'` を実行する
- **THEN** 分類は行われず、コマンドは実行される

### Requirement: ガードの失敗の局所化
システムは、ガードの登録または判定の失敗が、tsrepl、`rlm`、メモリ、スキル、セッション TODO の利用に影響してはならない。(MUST) 判定またはハンドラの内部で例外が起きたときも、bash の実行を止めてはならない。(MUST) ガード無しで起動できた場合は、その旨を 1 回だけ利用者に伝える。

#### Scenario: 登録失敗でも他は動く
- **WHEN** ガードの登録が失敗して拡張を読み込む
- **THEN** tsrepl、`rlm`、メモリ、スキル、セッション TODO はそのまま使え、bash はガード無しで実行される

#### Scenario: 判定の例外は bash を止めない
- **WHEN** 判定が例外を投げる状態で bash の呼び出しを実行する
- **THEN** コマンドは実行され、ブロックされない
