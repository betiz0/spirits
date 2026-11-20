# Tasks

## 1. ガードの判定: sed の表示コマンド

- [x] 1.1 `guard/rules.ts` の sed の例外を、表示コマンド(10 進・`$`・`/正規表現/` のアドレス、`,`、`p`、`;` 区切り)の構文解析に置き換える(design 決定 6)。`test/guard-classify.test.ts` に、要件 S2 の「表示コマンドだけの sed は該当しない」と「行範囲の print の形に合わない sed が該当する」のシナリオを加える。既存の `sed -n '5p'` / `sed -n '1,$p'` を S2 とする期待値は、通る側へ直す。`cd packages/spirits && bun test test/guard-classify.test.ts` が通ることを確認する

## 2. ガードの判定: Python の分類 P3

- [x] 2.1 `constants.ts` の `GuardCategoryId` と `SCRATCH_CODE_CATEGORIES` に `P3` を加え、同じタスクで `GUARD_CATEGORY_GUIDANCE` に P3 の項目(Python はどの形でも実行しない旨とセル例)を加える。`bun run check` の型検査が通ること、`bun test test/guard-metrics.test.ts` が `P3` を記録できることを確認する
- [x] 2.2 `guard/rules.ts` の `findInterpreter` のラッパー読み飛ばしを共通化し、ラッパー `nohup` を加える(design 決定 4)。要件「インタプリタの認識」の `nohup` のシナリオを加え、「前置きの time と !」の期待値を `time bun --version` に直す。既存の P1 / P2 のテストを含めて `bun test test/guard-classify.test.ts` が通ることを確認する 差し戻し W-2: `constructor hello` で例外を出さない。ラッパー表は自身のキーだけを検索し、未知名は分類なしとする。
- [x] 2.3 P3 を実装する。python 系の判定は `INTERPRETER_PATTERNS` の python の項目を参照し、ツール名の一覧(`pip`、`pip3`、`pipx`、`uv`、`uvx`、`pytest`、`poetry`、`hatch`、`pdm`、`tox`、`ipython`、`jupyter`)と `.py` の接尾辞を足す(design 決定 3)。要件「分類 P3 Python の実行」と「通すコマンド」の全シナリオを `test/guard-classify.test.ts` に加え、通ることを確認する 差し戻し S-2: コマンド位置の引用された固定名 `"pytest" -q` は P3 とし、引数 `rg "pytest" src` と動的な名前は通す。
- [x] 2.4 既存のテストとフィクスチャの期待値を P3 に合わせる。対象は次の 3 つ。`fixtures/guard/hit-cases.json` の python の事例は、期待値 `["P1"]` などに `P3` を足す。`fixtures/guard/pass-cases.json` に P3 に該当する事例があれば hit 側へ移し、コメントの「other-language interpreter」の説明を更新する。`test/guard-classify.test.ts` の、python を通すことを期待している既存のケースは書き換える。`bun test test/guard-classify.test.ts test/guard-lex.test.ts` が通ることを確認する 差し戻し W-3: Python の既存4ケースで P1 の不在だけでなく分類配列が `["P3"]` と一致することを検証する。

## 3. ガードの判定: シェルの -c と eval

- [x] 3.1 `classify` に、シェル(`bash` / `sh` / `zsh` / `dash` / `ksh`)の `-c` と `eval` の文字列の分類し直しを加える。`nested` は引き継ぎ、`dynamic` の語、解析できない文字列、4 段目以降は分類し直さない(design 決定 5)。要件「シェルの -c と eval の文字列の再判定」と「ガードの対象外とする迂回」の全シナリオを `test/guard-classify.test.ts` に加え、通ることを確認する 差し戻し C-1 / S-1: `bash scripts/run.sh -c "pytest"`（`--` 付きも）は分類なし、`bash -c -x "pytest"` は P3。外側で変数展開される文字列と単一引用で固定された文字列を shell -c / eval の両方で対照テストする。
- [x] 3.2 REMOVED「ガードはセキュリティ境界ではない」の移行として、既存のテストを直す。`test/guard-register.test.ts` の「適用範囲 シェルに -c で渡すコードは対象外」(`bash -c 'for ...'` が通ることを確かめている)は、S1 に該当することを確かめる形に書き換える。`test/guard-integration.test.ts` の旧要件名のコメントは「ガードの対象外とする迂回」に直す。入れ子の呼び出しのシナリオ(セルの `sh()` からの `bash -c` と `pytest`)を `test/guard-integration.test.ts` に加え、`bun test test/guard-integration.test.ts test/guard-register.test.ts` が通ることを確認する
- [x] 3.3 実セッションログを新旧の `classify` で比べる。入力は `~/.spirits/agent/sessions/` 配下で 2026-11-11 以降に更新された `*.jsonl` で、読み取り専用で開き、書き込みも削除もしない。assistant メッセージの bash の `toolCall` から `arguments.command` を取り出す。使い捨てのスクリプトは scratchpad に置き、変更前の `classify`(`git show HEAD:packages/spirits/src/guard/rules.ts` などで得たもの)と変更後の `classify` の両方にかける。新たに該当するようになった件数を分類ごとに数え、中身を確認する。誤検出はフィクスチャ `hit-cases.json` / `pass-cases.json` に事例として加えて直す。件数と判断(design 決定 5 の撤回条件に当たるか)を、このタスクの下に 3 行程度で追記する

> 2026-11-11 以降に更新された 22 セッション、assistant の bash 呼び出し 5393 件、記録済みのブ
> ロック 181 件。新たに該当するようになったのは S1 が 1 件(`bash -c` に渡した `for` ループ。ブ
> ロック実績の 0.6% で、中身は実際の制御構文だから誤検出ではない)と P3 が 103 件(すべて既に別
> の分類で止まっており、追加のブロックは 0 件)。逆に sed の表示例外で S2 が 52 件減った(全て
> `sed -n` の範囲表示)。撤回条件(新たに S 系が 1 割超かつ誤りが半数)には当たらない。
> 差し戻し(C-1 / S-1)の実装後に同じ方法で測り直した: 22 セッション、bash 呼び出し 5,554 件、新たに該当 S1 1 件と P3 103 件、sed の表示例外で S2 が 53 件減った。数えた件数は増えても、判定を変えた内訳は同じで、撤回条件には当たらない。

## 4. ブロック理由

- [x] 4.1 `GUARD_CATEGORY_GUIDANCE` の S1〜P2 の説明と書き換え例を、分類ごとの行き先に直す(S2 は read / edit / セル、S3 は write / edit、P1 / P2 は Python を含まないセル例)。`guard/messages.ts` の `CELL_NOTE` は `sh(command)` の案内だけに縮める(design 決定 7)。要件「ブロック理由の内容」の全シナリオを `test/guard-register.test.ts` または `test/guard-integration.test.ts` に加え、通ることを確認する 差し戻し C-2 / W-1: S3 は説明だけでなく「書き換え例:」の後ろも write / edit にする。P1 は `sh()` でコマンドの JSON 出力を扱う例とし、`cat` によるファイル読み取りを勧めない。例自体をテストする。
- [x] 4.2 `packages/spirits/README.md` の「bash コマンドのガード」の節を更新する。書く内容は、P3 の追加、シェルの `-c` と `eval` の分類し直し、sed の表示の例外、ラッパーへの `nohup` の追加、「プロジェクト自身のランナーは止めない」の Python の例外、Python のプロジェクトでの回避は `SPIRITS_ACTION_GUARD` だけであること。読み返して、要件の分類 ID と例が一致することを確認する

## 5. tsrepl の説明文と提案文

- [x] 5.1 `repl/context.ts` に、提供しないグローバル(`process`、`Bun`、`require`)と代わりの手段の一覧を置く。`repl/format.ts` の `suggestFix` は、その名前の `ReferenceError` で一覧の提案を返すようにする。提案は `await use("node:...")` を軸にし、`Bun` には「`sh()` はルートのセッションのみ」を添える(design 決定 8)。要件「未提供のホストグローバルへの参照の提案」の全シナリオを `test/format.test.ts`、`test/cell.test.ts`、`test/rlm-cell.test.ts` に加え、`bun test test/format.test.ts test/cell.test.ts test/rlm-cell.test.ts` が通ることを確認する 差し戻し C-3: エラー種別と識別子全体で照合する。通常の Error に含まれる説明文や `$process` には専用提案を出さず、実セルの `require("fs")` の TypeError は対象とする。

> 実装時の発見: `require("fs")` のように不在のグローバルを**呼んだ**場合は `ReferenceError` ではなく
> `TypeError: require is not a function. (In 'require("fs")', 'require' is undefined)` になる。要件の文言は
> `ReferenceError` だが THEN は error の内容なので、提案の名前検索は `X is not defined` と `'X' is undefined`
> の両方の表記から引き、エラー種別によらず同じ提案が出るようにした
- [x] 5.2 `tools.ts` の `TSREPL_DESCRIPTION` の `use()` の行を、`node:` / `bun:` / 相対パスのすべての例が `await use(...)` の形になるように書き換える。「セルに無いもの」の行は、5.1 の一覧の名前から作る。要件「ツール説明の use() の書き方」のシナリオを `test/tools.test.ts` に加え、通ることを確認する
- [x] 5.3 `TSREPL_PROMPT_GUIDELINES` を 4 項目に置き換え(design 決定 1)、`TSREPL_PROMPT_SNIPPET` を新しい線引き(出力をコードで扱うときに使う)に合わせる。要件「ツール一覧と規則への掲載」の全シナリオを `test/tools.test.ts` で確認する。4 項目の合計が 534 文字以内であることを確かめるテストを加え、`bun test test/tools.test.ts test/rlm-hostfn.test.ts` が通ることを確認する

> 4 項目の合計は 522 文字で上限 534 文字に収まっている(`test/tools.test.ts` の
> `prompt guidelines stay inside the character budget`)。

## 6. code-mode プロンプト

- [x] 6.1 `harness/prompt.ts` の既定プロンプトで、`sh("cat package.json")` の例を `await use("node:fs/promises")` で読む例に置き換え、`use()` の行を `await use(...)` の形にする(design 決定 9)。要件「code-mode プロンプトの適用」の全シナリオを `test/harness-prompt.test.ts` で確認し、通ることを確認する 差し戻し C-4: 委譲条件の変更とその文言を固定するアサーションを取り除き、基点の委譲方針を維持する。
- [x] 6.2 規則の文面を照合している箇所(`scripts/managed-pi-compat/fixtures/probe-extension.ts`、`scripts/managed-pi-compat/host-surfaces.ts` など)を洗い出し、新しい文面に合わせる。`bun test test/managed-pi-compat-guard.test.ts` が通ることを確認する

> 洗出し結果: `scripts/managed-pi-compat` の 2 ファイルは規則の文面を持っておらず、登録ツールの
> `promptGuidelines` を実行時に取り出してシステムプロンプトと突合する作り(`host-surfaces.ts` の
> `guideline never reached the prompt` 検査)だから、4 項目への置き換えは自動的に追従する。プロンプト
> 本文の sha256 を期待値として持つ箇所も無く、修正は不要だった。`bun test test/managed-pi-compat-guard.test.ts`
> と `test/managed-pi-compat-host-surfaces.test.ts` は通る
- [x] 6.3 `docs/spirits-m4-harness.md` の「promptGuidelines で規則の 3 項目を宣言し」を 4 項目に直し、`rg -n "3 項目" docs/spirits-m4-harness.md` で規則の項目数の古い記述が残っていないことを確認する 差し戻し C-4: 文書からも今回追加した委譲条件を取り除く。4 項目の規則とファイル読み取り例の説明は維持する。

## 7. 利用者向けの文書と本仕様の Purpose

- [x] 7.1 ルートの `README.md` に、次の 3 点を短く書く。Python のプロジェクトでの利用は推奨しないこと。ガードが Python の実行(プロジェクト自身のテストを含む)を止めること。回避は `SPIRITS_ACTION_GUARD=warn` / `off` であること。読み返して、`packages/spirits/README.md` の記述と矛盾しないことを確認する
- [x] 7.2 `openspec/specs/action-surface-guard/spec.md` の Purpose「対象のプロジェクト自身の実行・テストコマンドは制限しない」に、Python の実行は例外として止める旨を加える(既存の機能の Purpose は、仕様差分では反映されないため)。対象仕様と全体の検証は次の基準で行う 差し戻し S-3: `openspec validate action-surface-guard --type spec --strict` が成功し、全仕様では基点 `1201c0d26` に対して新規診断がないこと。同じ CLI で両ツリーの `openspec validate --specs --strict` の結果を取り、件数だけでなく仕様名・要件・診断内容を比較して記録する。
> 差し戻し S-3 の検証: `openspec validate action-surface-guard --type spec --strict` は成功。全仕様は `openspec validate --specs --strict` を基点ツリー(`git archive 1201c0d26 openspec` を /tmp に展開)と現ツリーでそれぞれ実行し、成功 11 / 失敗 20 件、診断 27 件(仕様名・要件位置・Warning 文面)が両ツリーで完全一致した。新規診断は 0 件で、件数だけでなく内容の比較でも悪化はない。9 件の失敗は全て本変更が触っていない仕様の「要件文が長すぎます(>500 文字)」で、基点から続く既存の警告。

> `spec/action-surface-guard` と変更 `rebalance-action-surface-guidance` は strict で通る。`openspec validate --specs --strict` は 20 件中 9 件失敗するが、全て本変更が触っていない仕様(binary-distribution、dual-model-routing、managed-commands など)の「要件文が長すぎます(>500 文字)」警告で、本変更前のコミットでも同じ。

## 8. 統合確認

- [x] 8.1 リポジトリのルートで `bun run check` が報告なしで通り、`cd packages/spirits && bun test` が通ることを確認する
- [x] 8.2 `bash scripts/test-clean-env.sh` で、CI と同じ環境のテストが通ることを確認する
- [x] 8.3 `openspec validate rebalance-action-surface-guidance --strict` が通ることを確認する

## Workflow follow-up

- 導入から数日後に、ブロック件数とブロックされた意図の内訳を、今回と同じ方法で測り直す。
