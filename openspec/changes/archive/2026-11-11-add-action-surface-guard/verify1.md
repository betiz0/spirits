# 検証レポート: add-action-surface-guard

対象: `openspec/changes/add-action-surface-guard/`(schema: `spec-driven`、mode: repo-local)
検証日: 2026-11-12 / 実装ブランチ: `feat/add-managed-pi-route`(未 commit)

### サマリー

| 観点 | 状態 |
| --- | --- |
| 完全性 | 33/33 タスク完了、要件 20 件(ADDED 17・MODIFIED 3)を仕様差分から抽出 |
| 正確性 | 20/20 要件に実装あり。シナリオ 77 件中 76 件を実装またはテストで確認、1 件はテスト無し(実装経路が存在しないことによる充足) |
| 一貫性 | 設計の決定 11 件中 9 件準拠、2 件に不整合(決定 7 の sed と段数の数え方、決定 11 の `nice -N`) |

検証の証拠: `bun test`(guard 系 6 ファイル)= 112 pass / 0 fail、`bun test`(packages/spirits 全体)= 1083 pass / 0 fail、ルート `npm run check` = exit 0。実装は読解と単発の分類実行で確認した。

### 要件と実装の対応

| 要件(差分) | 種別 | 実装 |
| --- | --- | --- |
| bash 呼び出しの実行前検査 | ADDED | `packages/spirits/src/guard/register.ts:42`、`src/guard/rules.ts:138` |
| 分類 S1 シェルの制御構文 | ADDED | `src/guard/rules.ts:164`、`src/guard/lex.ts:370`(予約語の分割) |
| 分類 S2 プログラム可能なフィルタと長いパイプ | ADDED | `src/guard/rules.ts:175`、`:40`(閾値) |
| 分類 S3 ヒアドキュメントによるファイル内容の生成 | ADDED | `src/guard/rules.ts:229`、`src/guard/lex.ts`(heredoc / `stdoutTargets`) |
| インタプリタの認識 | ADDED | `src/guard/rules.ts:261`(ラッパー `:79`)、`:345` |
| 分類 P1 他言語のインラインコード | ADDED | `src/guard/rules.ts:321` |
| 分類 P2 一時ディレクトリ配下のスクリプト実行 | ADDED | `src/guard/rules.ts:345`、`:361`(`$TMPDIR`)、`:392`(cwd 除外) |
| 分類の適用範囲 | ADDED | `src/guard/register.ts:56`、`src/guard/rules.ts:143` |
| 通すコマンド | ADDED | `src/guard/rules.ts:191`、`src/constants.ts:216` |
| 引用符を解釈する判定 | ADDED | `src/guard/lex.ts`(tokenizer、`parseError`)、`src/guard/rules.ts:140` |
| ブロック理由の内容 | ADDED | `src/guard/messages.ts:24`、`src/constants.ts` の `GUARD_CATEGORY_GUIDANCE` |
| 動作モードの切り替え | ADDED | `src/config.ts:95`、`src/guard/register.ts:50` |
| 判定の計測 | ADDED | `src/guard/metrics.ts:17`、`:55`、`src/guard/register.ts:63` |
| 計測にコマンド本文を含めない | ADDED | `src/guard/metrics.ts:40`(4 フィールドのみ) |
| ガードはセキュリティ境界ではない | ADDED | 構造上、`tool_call` の bash 以外と REPL import を触らない(`register.ts:52`) |
| ガードの失敗の局所化 | ADDED | `src/index.ts:150`(`optional`)、`register.ts:66`(catch) |
| ツール一覧と規則への掲載(MODIFIED) | MODIFIED | `src/tools.ts:48` |
| セル実行ログの出力と tool() のフィールド(MODIFIED) | MODIFIED | `src/repl/hostfns.ts:36`(`name: "bash"` で記録、`metrics.ts` は未変更) |
| sh ホスト関数 | ADDED | `src/repl/hostfns.ts:36`、`src/index.ts:144`、`src/tools.ts:102`(説明への連結) |
| code-mode プロンプトの適用(MODIFIED) | MODIFIED | `src/harness/prompt.ts:27`、`:30`(基準は `TSREPL_PROMPT_GUIDELINES` から生成) |

削除(REMOVED)・改名(RENAMED)の要件は無い。

### 重大

なし。タスクは 33/33 完了(`progress.remaining` = 0)、要件の実装欠落、削除済み振る舞いの残存、改名の欠落はいずれも見つからなかった。

### 警告

1. **仕様 S2 の sed 例外が実装より狭い**
   仕様と設計は「オプションが `-n` だけ」の行範囲 print を通すと定めるが、実装は `--quiet` / `--silent` も同じ扱いにしている(`packages/spirits/src/guard/rules.ts:54`、判定は `:207` の `isSedRangePrint`)。
   再現: `sed --quiet '1,50p' a.ts` → 分類 `[]`(仕様では S2)。
   推奨: `SED_QUIET_OPTIONS` を `["-n"]` に絞り `sed --quiet` が S2 になるテストを足すか、仕様と設計の例外条件に `--quiet` / `--silent` を明記する。実装と仕様のどちらを正とするかを決めて同一変更で揃える。

2. **仕様 S1 の「シェル関数の定義」が `function` キーワード形式を取りこぼす**
   仕様は関数定義を S1 に含めるが、字句解析は `name()` 形式だけを定義として印付ける(`packages/spirits/src/guard/lex.ts:323`〜`:359`)。`function` は予約語として単独コマンドに割れる(`lex.ts:96` の一覧)ため、定義として認識されない。
   再現: `function run_case { echo hi; }` → 分類 `[]`(`run_case() { ... }` は `["S1"]`)。
   推奨: コマンド先頭の `function NAME` と `function NAME()` を `functionDefinition` として扱い、`packages/spirits/test/guard-classify.test.ts` の S1 ケースに両形式を追加する。

3. **予約語の前置きがパイプ段数を水増しして 2 段パイプを止める**
   段数は「パイプでつながれたコマンドの数」だが、`time` / `!` / `coproc` も予約語として段を閉じるため(`lex.ts:375`、`:378`)、前置きがあると 2 段パイプが 3 段と数えられる。
   再現: `time bun test 2>&1 | tail -5` → 分類 `["S2"]`(仕様「通すコマンド / 2 段までのパイプ」では通すべき)。`time rg -n TODO src | head -20` は偶然通る(2 段目以降が許可フィルタのため)。
   推奨: 段数を数える前に先頭の予約語(`time` / `!` / `coproc`)を読み飛ばす、または `#addWord` で段を閉じるのは制御構文の語だけにする。`time <2 段パイプ>` の回帰テストを `guard-classify.test.ts` に追加する。

4. **設計決定 11 の `nice -N` を実装が読まない**
   決定 11 の表は `nice` が `-n N` と `-N` を読み飛ばすと定めるが、実装は `-` 始まりの未知オプションで判定を諦める(`rules.ts:94`、`:296` の `readPastWrapper`)。
   再現: `nice -5 python3 /tmp/check.py` → 分類 `[]`(決定 11 では P2)。
   推奨: `nice` に `-<数字>` を許す 1 分岐を足し、`guard-classify.test.ts` の「インタプリタの認識 ラッパーの後ろ」に `nice -5` を加える。仕様の「読み飛ばせない場合は通す」に該当させて据え置くなら、決定 11 の表から `-N` を外す。

### 提案

1. `packages/spirits/test/pi-runtime/system-prompt-defaults.test.ts:6` の説明が「two guideline bullets」のまま。`src/tools.ts` は 3 項目になったので「three guideline bullets」に直す。
2. 命名の揺れ: タスク 4.6 と設計決定 5 は `optional("the bash guard", ...)`、実装は `optional("the bash action guard", ...)`(`src/index.ts:150`)。タスク 4.6 の検証 `-t "bash guard"` は対応するテスト(`extension-degradation.test.ts` の「a host that refuses tool_call …」)を選択しない。実装名に合わせてタスク・設計・テスト名を揃えるか、実装名を短くする。
3. `docs/architecture/convention-registry.md` の `ARCH-REPL` 本文(層の列挙)に `guard` が無い。`repl` → `guard` の import は実際には `ARCH-REPL` として報告される(起点が `spirits:repl` のため)ので、列挙に `guard` を足して判定と文書を一致させる。
4. `packages/spirits/test/managed-pi-compat-guard.test.ts:165` は official artifact を `<root>/pi/pi` の存在だけで判定しており、`scripts/managed-pi-compat/official.ts` の `loadOfficialArtifact`(tarball と digest の検証)を通していない。`managed` が通ったことが「検証済み artifact で通った」を意味しないので、`loadOfficialArtifact` を使い、`OfficialArtifactError` を `not-run` に写像する。
5. 同ファイルの 2 つ目のテストは 1 つ目のテストが積んだモジュール変数 `outcomes` に依存している(`:208`)。実行順に依存するので、`outcomes` の検査を 1 つ目のテスト内へ畳む。
6. 仕様シナリオ「迂回を塞がない」(`use("node:child_process")`)に対応するテストが無い。`tool_call` は bash 以外を素通しする(`guard-register.test.ts` の「bash 以外のツールは対象外」)ので実装は満たしているが、`use()` 経由の import にガードが関与しないことを 1 ケースで固定しておくと、将来 `tool_call` 以外のフックを足したときに退行が検出できる。

### 最終評価

重大な問題はありません。考慮すべき警告は 4 つあります。アーカイブの準備はできていますが、警告 1〜4 は仕様・設計と実装の判定が食い違う箇所なので、実装を直すか仕様・設計を直すかを決めてからアーカイブするのが安全です。提案は 6 件です。
