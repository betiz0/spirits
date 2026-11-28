# Deep Verification Report: enforce-verification-report-saving

- 検証対象: `233bada5a5de4c4a5f906ef10d9c3fdc5ff614fe`（基点コミット = HEAD、未コミット変更: あり 21 パス）
- テストコマンド: `bash scripts/test-clean-env.sh`（check / `bun test` / install / tmux-verify）／`bun run check`（AGENTS.md の順に従う。`openspec/config.yaml` には test 定義なし）
- strict 検証: `openspec validate enforce-verification-report-saving --strict` → 成功（この検証中に実行、exit 0。S-1・S-2 の成果物修正後にも再実行して成功）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: あり。13 層化と `spirits:verify` の登記、`ARCH-REPL` / `ARCH-SPIRITS-LAYER` の層列挙、`ARCH-PI-BOUNDARY` 例外文を `routing` と `verify` を締める方向のみ。許可表の拡大・強度の引き下げ・例外追加は無し）
- verify1 レポート: `verify1.md`（Phase C で読んだ）
- モード: 再検証（前回レポート: `d-verify3.md`）。前回の検証が未コミット状態で行われていたため、ルールに従い差分を絞らず全体を検証し直した
- 保存手段: **このランタイムに `spirits_verify_report_save` は存在しない**（インストール済みの 0.8.4 バンドルは本変更前で、`rg -l spirits_verify_report_save ~/.spirits` はセッション JSON 以外 0 ヒット）。仕様シナリオ「保存手段が無効な環境では出力で終わる」に従ってチャット出力のみとし、ファイル作成は行わない予定だった。利用者の明示的な指示（「直接保存」）により、読み取り専用の例外としてこの 1 ファイルを `write` で作成した。実装・テスト・既存成果物はこの検証で変更していない（S-1・S-2 の修正は利用者の指示を受けた別の工程として下記「判定後の修正記録」に書く）

## 判定

**BLOCKED**（CRITICAL 0・WARNING 0・SPEC 2）

実装・テスト・実測はすべて通っており、archive を止めていたのは成果物側の記述誤り 2 件だけだった。両件は判定後に対象ファイルを実装へ合わせて修正済み（下記）。

## 集計

| 観点 | 結果 |
|---|---|
| strict 検証 | 成功 |
| テスト | 成功 1586 / 失敗 0（unit 125 ファイル）、install シェル 97 / 0、tmux-verify 125 / 0、`bash scripts/test-clean-env.sh` exit 0 |
| 規約検査 | 成功（`bun run check` exit 0 = biome + `tsc -p tsconfig.scripts.json` + `packages/spirits` 型検査。`test/architecture-conventions.test.ts` は本変更で未修正のまま緑） |
| 要件 | 意図どおり 14 / 全 14（`verification-report-saving` 11 + `sprt-opsx-verify-deep` 3） |
| シナリオ | 挙動を確認 53 / 全 53、テストが実質 51 / 全 53（深い検証スキルのプロンプト契約 2 件は `test/bundled-skills.test.ts` の本文アサーションのみ） |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件（変更 21 パスはすべてタスク 1.1〜7.3 に紐づく） |
| 継ぎ目 | 追加 5 件（Decision あり 5 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 0 件 |
| タスク | 完了 20 / 全 20（チェック済み全項目に実装とテストを確認） |

## 継ぎ目一覧

| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `spirits:verify` 層（新ディレクトリ） | 境界 | `packages/spirits/src/verify/` | Decision 2 | ARCH-SPIRITS-LAYER / ARCH-REPL / ARCH-PI-BOUNDARY | なし |
| N-2 | entry → verify（`optional()`） | 拡張点 | `packages/spirits/src/index.ts:204` | Decision 2 | ARCH-SPIRITS-LAYER | なし |
| N-3 | verify → routing（`phase.step()` / `stepStartedByInput()` / `parseCommandInput`） | 境界（基点に無い向きの import） | `packages/spirits/src/verify/register.ts:36` | Decision 12・14（コマンド行解析の集約） | ARCH-SPIRITS-LAYER | なし |
| N-4 | `spirits_verify_report_save` ツール（登録 API 経由） | 拡張点 | `packages/spirits/src/verify/tool.ts:55` | Decision 1・6・12 | なし | G-1 |
| N-5 | openspec CLI 解決（`Bun.spawn`）+ 解決関数の注入 | 外部依存 | `packages/spirits/src/verify/change-root.ts:57` | Decision 3・13 | なし | G-2 |

今回（d-verify3 以降）に増えた構造は N-3 の import 先（`parseCommandInput`）と probe の `prompt` 記録だけで、新しい層・interface・公開 API・拡張点は追加されていない。Decision 14 の通知は既存ハンドラ（`input` / `agent_settled`）の内側で完結する。

## 指摘

### CRITICAL

なし。

前回の C-1（固定済み検証の obligation が窓口の終了後も残り、後続の無関係な入力が「対象を固定されないまま終わった」通知を出す）は解消を確認した。`packages/spirits/src/verify/register.ts:110-116` は `closing` を取り出して `obligation = undefined` を先に済ませ、通知するかどうかだけを後で判定する。回帰テスト 3 件（`packages/spirits/test/verify-report-nudge.test.ts:352`、`:373`、`:391`）が「後続入力の通知 0 件」「stderr 0 件」「レポート 0 件」を直接アサートし、未固定側の従来挙動（`test/verify-report-nudge.test.ts:280`、`:311` の 1 件）も同時に固定している。

追加で追った経路（いずれも破綻なし）: 督促 1 回後に中断された固定済み検証（`agent_settled` の aborted で obligation を消費、後続入力は黙る）／同一種の検証で開き直す場合（`register.ts:150-155` が `pin.clear()` より先に旧検証の終了処理をする）／非対話モードの未保存 settle（stderr 通知のみで obligation を消費するため、ステップが閉じても二重通知にならない）。

### WARNING

なし。

### SPEC

- **[S-1] design と tasks が実在しない定数名を検査の根拠としていた**
  - 場所: `openspec/changes/enforce-verification-report-saving/design.md`（Decision 14 末尾）、`tasks.md` タスク 2.1 の d-verify3(2nd) W-3 文
  - 根拠: 両箇所は案内文定数として `VERIFY_REPORT_STEP_NOT_OPEN_REASON` を挙げていたが、その名前はリポジトリに存在しない（`rg VERIFY_REPORT_STEP_NOT_OPEN_REASON packages` → 0 件）。実在は `VERIFY_REPORT_NOT_VERIFYING_REASON`（`packages/spirits/src/constants.ts:963`）で、実際の検査 `packages/spirits/test/constants-verify-report.test.ts:51`「the reopening guidance names the commands the step table opens a verification with」は `VERIFY_REPORT_NOT_VERIFYING_REASON` / `VERIFY_REPORT_UNPINNED_REASON` / `VERIFY_REPORT_UNPINNED_NOTICE` を `STEP_DEFINITIONS` の starters と照合している。tasks 2.1 の「→ 消化済み」行は正しい名前を使っており、同じ成果物内で 2 つの名前が併存していた。発生源は `d-verify3.md:96-99` の記述で、design へコピーされた
  - 重大度の理由: 実装と検査は意図どおりで、正すべきは成果物の側。design の主張を検査で追跡できない状態は archive 後に残る
  - 修正先: spec
  - 推奨: design と tasks 2.1 の `VERIFY_REPORT_STEP_NOT_OPEN_REASON` を `VERIFY_REPORT_NOT_VERIFYING_REASON` へ直す（実装側の改名を望むなら `constants.ts:963`、`tool.ts:16`、`test/constants-verify-report.test.ts:19,55` を同一変更で追従させる）

- **[S-2] 実測ランナーの自己記述と tasks の記録が、実際に出す判定セットと食い違っていた**
  - 場所: `scripts/managed-pi-compat/verify-report.ts:7-9`（「measures the five things」）と同 `:10-24`（列挙は 6 項目）、`tasks.md` タスク 7.1（「11 判定 all-holds」「`bundle.sha256` … `054e52ad693c…`」）、タスク 6.1（「version を 1.2 → 1.3 にした」）
  - 根拠: ランナーは現在 12 の判定を出す（`regenerated-template-expanded-and-nudged-once-in-same-run` が加わった）。docstring は「five things」と書き 6 項目を列挙して今回の主張を持たしない。`openspec/changes/enforce-verification-report-saving/evidence/verify-report.json` の `bundle.sha256` は `ea78fd4d0f66…`（現在の dist と一致）で、tasks に写った `054e52ad693c…` は前のバンドルのまま。同系統で SKILL.md の frontmatter は 1.1 → 1.3（1.2 はコミット前の中間値）
  - 重大度の理由: 挙動と実測（12 判定 all-holds）は正しい。ただし evidence と tasks は archive 判断の履歴なので、「どの判定がどの要求を見たか」が読めない状態を残さない
  - 修正先: spec（tasks の記録）と計測スクリプトの docstring
  - 推奨: docstring の項目数を直し、今回の差し替えテンプレート主張を追記して各項目に判定キー名を対応させる。tasks 7.1 に 12 判定と `ea78fd4d0f66…` の記録を足し、6.1 の version 記述を 1.1 → 1.3 に直す

### SUGGESTION

- **[G-1] probe がツール名を素のリテラルでもつ**（`scripts/managed-pi-compat/fixtures/verify-report-probe.ts:22`）。製品側で改名されると `tool-declared-during-verify` が false で落ちる（誤合格にはならない）ので実害はないが、ランナー本体は `packages/spirits/src/constants.ts` を import している（`scripts/managed-pi-compat/verify-report.ts:34-38`）ので、probe も同じ import にできる
- **[G-2] 要件「検証対象は入力から固定し…」の「曖昧」句に専任テストがない**。`packages/spirits/src/verify/pin.ts:66` は一覧の完全一致だけを見て曖昧性は検出しない。曖昧は openspec の解決側に委譲され、CLI が非ゼロで返せば `change-root.ts:97` 経由で保存が理由付き拒否になる（`packages/spirits/test/verify-report-change-root.test.ts:50`「every CLI failure shape is a reason, not a write」で汎用にカバー）。design に「曖昧性は openspec の解決結果で決まる（spirits は検出しない）」を 1 行固定すれば同じ問いの再発を防げる
- **[G-3] pin のテスト名が現行の実態と食い違う**: `packages/spirits/test/verify-report-pin.test.ts:65`「the store travels with the pinning line only (d-verify1 W-1)」は、d-verify2 C-1 以降の「開行の store も保持する」挙動と矛盾する語。テスト内容自体は正しく、`:82`（保持 store の採用）と `:100`（優先順）で担保済み。名前のみの問題

### 参考（本変更の欠陥ではない）

- 直前の apply セッションで tmux の `timeout-extended` が 1 回だけ復帰時間 2477 ms（期待 2500..5500）で落ち、単独再実行・全スイート再実行の両方で緑。タイミング余裕の問題で、この変更の経路は関与しない
- `spawnOpenspec` のタイムアウト分岐で、レースに負けた側のストリーム読み取りが未処理の rejection を出さないかを `PATH` にハングする `openspec` を噛ませて実測（kill 後の読み取りは解決扱い、unhandled rejection 0 件、exit 0）。破綻経路は確認できなかった

## 前回の指摘の再検証（d-verify1 / d-verify2 / d-verify3）

| ID | 内容 | 状態 | 根拠 |
|---|---|---|---|
| d-verify3 **C-1** | 固定済み検証の obligation が終了後も残り、後続入力が誤通知を出す | 解消 | `register.ts:110-116`（消費を判定より先）+ `verify-report-nudge.test.ts:352,373,391` |
| d-verify3 W-1 | 未固定拒否理由の案内内容が未検査 | 解消 | `verify-report-tool.test.ts:86-93`（「ask which change」「reopen the verification with the change named」両コマンド語を文案そのものにアサート） |
| d-verify3 W-2 | SKILL.md の開き直し案内に本文アサーション無し | 解消 | `bundled-skills.test.ts:292-295`。本文契約なので実行検証ではない（集計 51/53 の内訳） |
| d-verify3 W-3 | コマンド語の 3 重複と `STEP_DEFINITIONS` の無連結 | 解消（ただし記録の定数名が誤りで、それが上記 S-1） | `constants-verify-report.test.ts:48-58` |
| d-verify3 G-1 | `session_start` / `session_tree` の黙秘と `json` モードが未検査 | 解消 | `verify-report-nudge.test.ts:391`（両イベントで通知 0 件）、`:334`（`print` / `json` をループ、stderr 1 回・`notices` 空） |
| d-verify1 C-1 / W-1 / W-2 / W-3 / W-4 / W-5、d-verify2 C-1 / G-1 / G-2、d-verify3 C-1 / C-2 | 再固定漏れ・store 配線・プロンプト再生成・非対話保存・未使用定数・コマンド行の 2 実装・開行 store・`link` 改名・store E2E・一覧 store・保存 I/O 失敗 | 解消（前回確認済み。現行差分でもコードとテストの所在を再確認） | `pin.ts:66,73`、`change-root.ts:150-166`、`report-name.ts:86-120`、`save.ts:29-35`、`routing/phase.ts:225-253`、evidence 12 判定 all-holds |
| 4.3（今回の C-1） | 検証を開き直す入力で旧検証の終了処理を先に行う | 解消 | `register.ts:150-155` + `verify-report-register.test.ts:105`（同種・深い検証の両経路で通知 1 回、`targets === ["beta"]`、系列別ファイル名、離脱後の再通知なし） |
| 5.1 / 7.1（今回の W-1） | 実ホストで差し替え本文＋展開引数＋督促 1 回 | 解消 | `verify-report.ts` の `regenerated-verify` stage と判定 `regenerated-template-expanded-and-nudged-once-in-same-run`。evidence の `measurements.regeneratedVerification.newestUserMessagesThroughSettle` に差し替え本文＋`alpha VERIFY-REPORT-REGENERATED` と督促文の 2 件 |
| 7.2 / 7.3 | 全スイート・静的検査 | 解消 | この検証で `bash scripts/test-clean-env.sh` exit 0、`bun run check` exit 0 |

## verify1 との突き合わせ

- verify1 の提案 1（プロンプト再生成のテスト）: 採用済み。単体（`verify-report-nudge.test.ts:160`、同名テンプレートの本文そのものを差し替えて展開）と実測（`regenerated-template-expanded-and-nudged-once-in-same-run`）の 2 層で满足
- verify1 の提案 2（print モード保存のテスト）: 採用済み（`verify-report-tool.test.ts:127`）
- verify1 のレポート自体が古い: 19/19 タスク、13 要件 36 シナリオ、evidence 8 判定、`wx + rename`、`firstArgumentFromInput`、SKILL.md v1.2 を前提にしている。Decision 5 の `link` 統一・`parseCommandInput` 集約・判定 12 キーへ更新済みなので、verify1 の記述を現行実装の証拠としては使えない（履歴として残置でよい）
- verify1 が見逃した点: verify1 はキーワードと静的読み合わせ中心で、obligation と pin の寿命をまたぐ経路（d-verify1 C-1、d-verify3 C-1 はいずれもそこ）を 2 回とも拾えていない。verify2 の担当範囲として妥当
- 重大度の食い違い: なし（verify1 の 2 件は任意の提案、本報告は CRITICAL 0・WARNING 0・SPEC 2）

## 判定後の修正記録（利用者の指示によるもの）

判定 BLOCKED を下した同一セッションで、S-1・S-2 を**成果物側を実装へ合わせて**修正した（実装・テストの挙動変更は無し）。

- `design.md`（Decision 14 末尾）と `tasks.md` タスク 2.1: `VERIFY_REPORT_STEP_NOT_OPEN_REASON` → `VERIFY_REPORT_NOT_VERIFYING_REASON`（差し替え注記つき）
- `scripts/managed-pi-compat/verify-report.ts` の docstring: 主張を 7 項目に整え、各項目が判定するキー名を明記。`evidence/verify-report.json` の真偽キー 12 個と 1:1 で一致することを確認（欠落 0・余剰 0）
- `tasks.md` タスク 7.1: 「12 判定 all-holds / `bundle.sha256 = ea78fd4d0f66…`（現在の dist と一致）」を追記。11 判定と `054e52ad693c…` は d-verify3(2nd) ラウンドの実測値として残置
- `tasks.md` タスク 6.1: version を 1.1 → 1.3 に修正。タスク 7.2: 今回の全スイート再実行結果（unit 1586 / install 97 / tmux 125、exit 0）と tmux の 1 回失敗→緑を追記
- `tasks.md` Workflow follow-up: 採番規則（前ラウンドが名乗った `d-verify4` はレポート未保存なので連番を消費しない）と本報告の記録
- 修正後の再検証: `bun run check` exit 0、`openspec validate enforce-verification-report-saving --strict` 成功、`bun test test/verify-report-nudge.test.ts test/verify-report-register.test.ts test/constants-verify-report.test.ts` 36 pass / 0 fail

## 次の手順

1. CRITICAL・WARNING は 0、SPEC 2 はいずれも成果物の記述で修正済み。**S-1・S-2 の修正を含む状態でこのスキルを再検証モードで再実行する**（連番規則上、次の保存は `d-verify5.md`）。見込みは PASS（G-1〜G-3 は SUGGESTION で判定に影響しない）
2. G-1〜G-3 を同時に消化するかは利用者の判断（いずれも挙動を変えない）
3. PASS / PASS WITH WARNINGS になってから `/opsx-archive`（本仕様 2 件の同期を伴う）
