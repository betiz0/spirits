# Spec Delta

## ADDED Requirements

### Requirement: 分類 P3 Python の実行
分類 P3 は、Python 系のコマンドを起動するコマンドに該当しなければならない。(SHALL) 対象は、コマンド名が python 系(要件「インタプリタの認識」が python と認識する名前)、pip 系(`pip`、`pip3`、`pipx`)、`uv`、`uvx`、`pytest`、`poetry`、`hatch`、`pdm`、`tox`、`ipython`、`jupyter` のいずれかであるもの、およびコマンド名が `.py` で終わるもの(`*.py` の直接実行)とする。
コマンド名は、要件「インタプリタの認識」と同じく、パス付きの名前、先頭の環境変数代入、ラッパーを読み飛ばして決める。P3 は引数やオプションを問わず、対象プロジェクト自身の実行・テストコマンドも例外としない。

#### Scenario: Python のインラインコード以外の起動も該当する
- **WHEN** `cat x.json | python3 -m json.tool`、`python3 scripts/check.py`、`python3 --version`、`/usr/bin/python3 ~/x.py` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: Python のツールチェーンが該当する
- **WHEN** `pip install requests`、`pipx run black .`、`uv run pytest`、`uvx ruff check`、`pytest -q`、`poetry install` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: Python のプロジェクト管理と対話環境が該当する
- **WHEN** `hatch run test`、`pdm install`、`tox -e py312`、`ipython`、`jupyter nbconvert --to script a.ipynb` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: .py の直接実行が該当する
- **WHEN** `./scratch.py` と `scripts/run.py --flag` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: ラッパーと環境変数代入の後ろも該当する
- **WHEN** `env PYTHONPATH=. python3 x.py`、`timeout 30 pytest -q`、`nohup python3 server.py` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: Python を引数として扱うだけのコマンドは該当しない
- **WHEN** `rg -n python src`、`ls scripts/*.py`、`cat setup.py` をそれぞれ分類する
- **THEN** いずれも P3 に該当しない

#### Scenario: インラインコードは P1 と P3 の両方に該当する
- **WHEN** `python3 -c 'print(1)'` を分類する
- **THEN** P1 と P3 の両方に該当する

### Requirement: シェルの -c と eval の文字列の再判定
システムは、シェル(`bash`、`sh`、`zsh`、`dash`、`ksh`)に `-c` で渡した文字列、および `eval` の引数を空白でつないだ文字列を、コマンド文字列として分類し直さなければならない。(SHALL) `-c` は、`-lc` や `-ec` のように他の 1 文字オプションと組み合わせた形も含む。
分類し直して該当した分類は、外側のコマンドの分類に加える。適用する分類の範囲(直接か入れ子か)は外側の呼び出しのものを引き継ぐ。分類し直した文字列の中のシェルの `-c` と `eval` も同じ規則で分類し直す。段数は、bash ツールに渡されたコマンド文字列を 0 段目とし、分類し直すたびに 1 段増やして数える。3 段目までは分類し直し、4 段目以降は分類し直さない。
外側のシェルで変数展開やコマンド置換を受ける文字列は、全体を分類し直さない。単一引用符やエスケープにより外側では展開されない `$` は、その段では文字どおりに扱う。(SHALL)

#### Scenario: シェルの -c の中の Python が該当する
- **WHEN** `bash -c "python3 -c 'print(1)'"` と `sh -lc 'pytest -q'` をそれぞれ分類する
- **THEN** 前者は P1 と P3、後者は P3 に該当する

#### Scenario: eval の中の Python が該当する
- **WHEN** `eval "python3 x.py"` を分類する
- **THEN** P3 に該当する

#### Scenario: 直接の呼び出しではシェルの -c の中に S も適用する
- **WHEN** `bash -c 'for i in 1 2; do echo $i; done'` を分類する
- **THEN** S1 に該当する

#### Scenario: 入れ子の呼び出しではシェルの -c の中に S を適用しない
- **WHEN** tsrepl のセルから `sh("bash -c 'for i in 1 2; do echo $i; done'")` を実行する
- **THEN** コマンドは実行される

#### Scenario: 入れ子の呼び出しでもシェルの -c の中に P を適用する
- **WHEN** tsrepl のセルから `sh("bash -c 'python3 x.py'")` を実行する
- **THEN** コマンドは実行されず、理由に `P3` が含まれる

#### Scenario: 入れ子のシェルの -c も分類し直す
- **WHEN** `bash -c "sh -c 'python3 x.py'"` を分類する
- **THEN** P3 に該当する

#### Scenario: 3 段目までは分類し直す
- **WHEN** `eval eval eval python3 x.py` を分類する(`python3 x.py` は 3 段目)
- **THEN** P3 に該当する

#### Scenario: 4 段目以降は分類し直さない
- **WHEN** `eval eval eval eval python3 x.py` を分類する(`python3 x.py` は 4 段目)
- **THEN** どの分類にも該当しない

#### Scenario: 実行時に決まる文字列は分類し直さない
- **WHEN** `bash -c "$(cat cmd.txt)"` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 外側で変数を展開する文字列と固定文字列を区別する
- **WHEN** `bash -c "echo $X; pytest"` と `eval "echo $X; pytest"` を、それぞれ外側の二重引用符を単一引用符にした形と比較する
- **THEN** 二重引用の形は再分類せず、単一引用の形は再分類して P3 に該当する

#### Scenario: シェル自身のオプションだけを読む
- **WHEN** `bash scripts/run.sh -c "pytest"`、`bash -- scripts/run.sh -c "pytest"`、`bash -c -x "pytest"` を分類する
- **THEN** 最初の二つには該当なし、最後は P3 に該当する

#### Scenario: シェルにスクリプトファイルを渡す実行は分類し直さない
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `bash scripts/run.sh` を分類する
- **THEN** どの分類にも該当しない

### Requirement: ガードの対象外とする迂回
システムは、ガードをモデルの挙動の誘導として実装し、セキュリティの回避手段を塞ぐことを要求してはならない。(MUST) 他ツールや REPL の import 経由の迂回、実行時まで決まらないコマンド名、シェルに渡すスクリプトファイルの中身、およびラッパー以外のコマンド(`sudo`、`docker`、`ssh` など)に引数として渡したコマンドは、ガードの対象としない。

#### Scenario: 迂回を塞がない
- **WHEN** tsrepl のセルで `use("node:child_process")` を呼ぶ
- **THEN** ガードは介入せず、tsrepl の import 許可判定だけが適用される

#### Scenario: 実行時に決まるコマンド名は対象にしない
- **WHEN** bash で `PY=python3; $PY --version` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: ラッパー以外のコマンドの引数は対象にしない
- **WHEN** `sudo pip install requests`、`docker run python:3.12 python x.py`、`ssh host "python3 x.py"` をそれぞれ分類する
- **THEN** いずれも P3 に該当しない

## MODIFIED Requirements

### Requirement: 分類 S2 プログラム可能なフィルタと長いパイプ
段数は、パイプでつながれたコマンドの数とする。許可フィルタは head / tail / wc / grep / rg / sort / uniq / cut / tr / cat / nl / column とする。
分類 S2 は、次のいずれかに該当しなければならない。(SHALL)
- awk(gawk、mawk を含む)、jq、xargs を単純コマンドの位置に置く
- sed の使用。ただし、オプションが `-n` だけで、スクリプトが表示コマンドだけからなり、残りがファイル名だけの形は除く。表示コマンドは、アドレス 1 つ、または `,` でつないだアドレス 2 つの直後に `p` を置いたもので、`;` で複数つなげてよい。アドレスは 10 進整数、`$`、`/正規表現/` のいずれかとする
- 3 段以上のパイプで、2 段目以降に許可フィルタ以外のコマンドを含む(1 段目は任意のコマンド)

段数の数え方は、次の要件「パイプの段数の数え方」による。

#### Scenario: awk が該当する
- **WHEN** `awk '{print $1}' /proc/loadavg` を分類する
- **THEN** S2 に該当する

#### Scenario: 行範囲の print の sed は該当しない
- **WHEN** `sed -n '1,50p' packages/spirits/src/tools.ts` を分類する
- **THEN** S2 に該当しない

#### Scenario: 表示コマンドだけの sed は該当しない
- **WHEN** `sed -n '100,140p;195,215p' a.ts`、`sed -n '/^## 7\./,/^## 8\./p' tasks.md`、`sed -n '58p' a.ts`、`sed -n '1,$p' a.ts`、`sed -n '/a;b/,/c/p' a.ts` をそれぞれ分類する
- **THEN** いずれも S2 に該当しない

#### Scenario: 行範囲の print の形に合わない sed が該当する
- **WHEN** `sed -n -e '1,50p' a.ts`、`sed '1,50p' a.ts`(`-n` なし)、`sed --quiet '1,50p' a.ts`、`sed -n '1,50p;w out.txt' a.ts`、`sed -n '/a/,/b/{p}' a.ts` をそれぞれ分類する
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

### Requirement: インタプリタの認識
分類 P1、P2、P3 は、python、node、bun、deno、perl、ruby、php をインタプリタとして認識しなければならない。(SHALL) 次の形も、同じインタプリタとして認識しなければならない。(SHALL)
- パス付きの名前(`/usr/bin/python3`)と版付きの名前(`python3`、`python3.12`)
- 単純コマンドの先頭にある環境変数代入(`PYTHONPATH=. python3 -c ...`)
- ラッパー `env`、`timeout`、`nice`、`nohup`、`uv run` の後ろ。ラッパーは、ラッパー自身のオプションと値(`nice` の `-n N` と `-N`(`-` と 10 進整数)を含む)を読み飛ばした後の最初の語を実際のコマンドとして扱う。

ラッパーはこの 5 つに限る。`bash` / `sh` などのシェルは、インタプリタとしてもラッパーとしても認識しない。シェルに `-c` で渡した文字列は、要件「シェルの -c と eval の文字列の再判定」に従う。ラッパーのオプションを読み飛ばせない場合は、該当なしとして通さなければならない。(MUST)

#### Scenario: パス付きと版付きの名前を認識する
- **WHEN** `/usr/bin/python3 -c 'print(1)'` と `python3.12 -c 'print(1)'` をそれぞれ分類する
- **THEN** いずれも P1 に該当する

#### Scenario: 環境変数代入の後ろを認識する
- **WHEN** `PYTHONPATH=. python3 -c 'print(1)'` を分類する
- **THEN** P1 に該当する

#### Scenario: ラッパーの後ろを認識する
- **WHEN** `env PYTHONPATH=. python3 -c 'print(1)'`、`timeout 30 python3 -c 'print(1)'`、`nohup python3 -c 'print(1)'`、`uv run python -c 'print(1)'` をそれぞれ分類する
- **THEN** いずれも P1 に該当する

#### Scenario: ラッパーの後ろのスクリプトを認識する
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `nice -n 5 python3 /tmp/check.py` を分類する
- **THEN** P2 に該当する

#### Scenario: nice の -N を読み飛ばす
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `nice -5 python3 /tmp/check.py` と `nice -10 python3 -c 'print(1)'` をそれぞれ分類する
- **THEN** 前者は P2、後者は P1 に該当する

#### Scenario: ラッパーの後ろが通すコマンドなら通す
- **WHEN** `env FOO=1 bun test` と `timeout 30 bun test` をそれぞれ分類する
- **THEN** どの分類にも該当しない

#### Scenario: シェルは認識しない
- **WHEN** 作業ディレクトリが `/home/u/proj` のとき `bash /tmp/run.sh` を分類する
- **THEN** どの分類にも該当しない

### Requirement: 前置きの time と !
システムは、単純コマンドの前に置かれた `time` と `!` を、シェルの予約語として読み飛ばし、前置きが無いときと同じに分類しなければならない。(SHALL) 両者はラッパー(`env`、`timeout`、`nice`、`nohup`、`uv run`)には数えない。

#### Scenario: 前置きの time と ! は判定を変えない
- **WHEN** `time python3 -c 'print(1)'`、`! python3 -c 'print(1)'`、`time bun --version` をそれぞれ分類する
- **THEN** 前の 2 つは P1 に該当し、`time bun --version` はどの分類にも該当しない

### Requirement: 分類の適用範囲
システムは、分類 S を、モデルが直接呼び出した bash にだけ適用しなければならない。(SHALL) 他のツールが入れ子で実行した bash 呼び出しには分類 S を適用しない。
システムは、分類 P(P1、P2、P3)を、直接の呼び出しと入れ子の呼び出しの両方に適用しなければならない。(SHALL)
入れ子の呼び出しをブロックしたときの理由は、呼び出し元のツールへエラーとして返らなければならない。(SHALL)

#### Scenario: 入れ子では S を適用しない
- **WHEN** tsrepl のセルから `tool("bash", { command: "for i in 1 2; do echo $i; done" })` を実行する
- **THEN** コマンドは実行される

#### Scenario: 入れ子でも P を適用する
- **WHEN** tsrepl のセルから `tool("bash", { command: "python3 -c 'print(1)'" })` を実行する
- **THEN** コマンドは実行されず、理由に分類 ID が含まれる

#### Scenario: 入れ子でも P3 を適用する
- **WHEN** tsrepl のセルから `sh("pytest -q")` を実行する
- **THEN** コマンドは実行されず、理由に `P3` が含まれる

#### Scenario: 入れ子のブロックはセルでは例外になる
- **WHEN** tsrepl のセル `try { await tool("bash", { command: "python3 -c 'print(1)'" }) } catch (e) { return String(e) }` を実行する
- **THEN** value に分類 ID `P1` を含む理由が入る

### Requirement: 通すコマンド
システムは、分類 S と P のいずれにも該当しない bash 呼び出しを実行しなければならない。(MUST) 次の形は、分類 P3 に該当するものを除き、どの分類にも該当しない。
- 単発のコマンド、`&&`、`||`、`;` での連結
- 2 段までのパイプ
- 2 段目以降が許可フィルタだけの、3 段以上のパイプ
- 上記の形に `time` と `!` を前置きしたもの、`{ ...; }` と `( ... )` で囲んだグループを 1 段とするパイプ
- 対象プロジェクト自身の実行・テストコマンド(bun、npm など)。スクリプトやモジュールへ `-c`、`-e`、`-p`、`-` などの引数を渡す実行を含む
- 作業ディレクトリ配下の既存スクリプトの実行

#### Scenario: 連結した単発コマンドを通す
- **WHEN** `cd /tmp && bun test packages/spirits/test/tools.test.ts 2>&1 | tail -20` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: プロジェクト自身のツールチェーンを通す
- **WHEN** `bun run check`、`bun install`、`npm test` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: Python のツールチェーンは通さない
- **WHEN** `pytest` と `python3 -m pytest -q` をそれぞれ分類する
- **THEN** いずれも P3 に該当する

#### Scenario: 絞り込みのパイプを通す
- **WHEN** `git status --short | head -20` と `npm run check 2>&1 | tail -40` をそれぞれ分類する
- **THEN** いずれもどの分類にも該当しない

#### Scenario: 前置きとグループのパイプを通す
- **WHEN** `time bun test packages/spirits 2>&1 | tail -15` と `{ git status --short; git log -1 --oneline; } | head` をそれぞれ分類する
- **THEN** いずれもどの分類にも該当しない

### Requirement: ブロック理由の内容
システムは、実行を止めたときに返す理由へ、該当した分類 ID、分類ごとの書き換え先の例 1 行、および利用者が環境変数 `SPIRITS_ACTION_GUARD` で動作モードを切り替えられる旨を含めなければならない。(SHALL) 書き換え先は、ファイルの読み取りなら read、ファイルの作成と書き換えなら edit / write、出力の加工と使い捨てのコードなら tsrepl のセルとする。
理由にコマンド本文を再現してはならない。(MUST) どの分類の理由にも、Python を実行する書き換え例を含めてはならない。(MUST)

#### Scenario: 理由に分類 ID と例が含まれる
- **WHEN** 分類 P1 に該当する bash 呼び出しがブロックされる
- **THEN** 理由に `P1` と、`sh()` または `tool("bash", ...)` を使うセルの例の 1 行と、`SPIRITS_ACTION_GUARD` が含まれる

#### Scenario: 読み取りと書き換えの行き先を示す
- **WHEN** 分類 S2 に該当する bash 呼び出しと、分類 S3 に該当する bash 呼び出しがそれぞれブロックされる
- **THEN** S2 の理由に read と edit が含まれ、S3 の理由に write または edit が含まれる

#### Scenario: P3 の理由は例外がないことを示す
- **WHEN** 分類 P3 に該当する bash 呼び出しがブロックされる
- **THEN** 理由に `P3` と、Python はどの形でも実行しない旨と、tsrepl のセルへの書き換え先が含まれる

#### Scenario: 理由に Python の実行例を含めない
- **WHEN** 分類 S1、S2、S3、P1、P2、P3 の理由をそれぞれ生成する
- **THEN** どの理由にも `python3 ` や `pytest` を実行する例は含まれない

#### Scenario: 複数の分類に該当する
- **WHEN** 分類 S1 と P1 の両方に該当する bash 呼び出しがブロックされる
- **THEN** 理由に `S1` と `P1` の両方が含まれる

#### Scenario: コマンド本文を再現しない
- **WHEN** `python3 -c 'print("secret-token")'` がブロックされる
- **THEN** 理由に `secret-token` は含まれない

### Requirement: 引用符を解釈する判定
システムは、コマンド文字列を、引用符・エスケープ・部分展開・ヒアドキュメントを解釈して分類しなければならない。(SHALL) 引用符内とヒアドキュメント本文の文字列を、コマンド名、制御構文、演算子として扱ってはならない。(MUST) ただし P3 に限り、コマンド位置の語が引用されていても、展開なしに確定する名前なら分類する。引数・ヒアドキュメント本文・実行時に決まる名前にはこの例外を適用しない。解析できないコマンド文字列は該当なしとして通さなければならない。(MUST)

#### Scenario: 引用符内のキーワードで発火しない
- **WHEN** `rg "for (" src` および `grep -n "case:" notes.md` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 引用符内の演算子を数えない
- **WHEN** `echo "a | b | c | d"` を分類する
- **THEN** どの分類にも該当しない

#### Scenario: 解析できない入力は通す
- **WHEN** 閉じられない引用符を含むコマンド文字列を分類する
- **THEN** 該当なしとし、実行を止めない

#### Scenario: P3 は固定された引用名と引数を区別する
- **WHEN** `"pytest" -q`、`rg "pytest" src`、`"$PY" -q` をそれぞれ分類する
- **THEN** 最初だけが P3 に該当する

## REMOVED Requirements

### Requirement: ガードはセキュリティ境界ではない
**Reason**: シェルに `-c` で渡した文字列を対象外とする記述が、要件「シェルの -c と eval の文字列の再判定」と矛盾する。誘導であってセキュリティ境界ではないという位置づけは、要件「ガードの対象外とする迂回」へ引き継ぐ。
**Migration**: シェルの `-c` と `eval` の文字列は再判定の対象になる。それ以外の対象外(他ツールや REPL の import 経由の迂回)は「ガードの対象外とする迂回」に残る。
