## Deep Verification Report: unify-spirits-role-command

- 検証日: 2026-11-13
- 検証対象: `f71b6746b`(HEAD)+ 未コミット変更(未コミット変更: あり)。`main` との merge-base は `3c3962f97` だが、`main..HEAD` のコミットは archive 済みの別 change のものなので、HEAD からの作業ツリー差分と未追跡ファイルに絞った。コードの最終更新は 2026-11-13 11:06 で、通常の verify(`verify2.md`)と同じコードを見ている。
- テストコマンド: `cd packages/spirits && bun test`、`npm run check`。補助として `bun scripts/managed-pi-compat/run.ts --mode fixture --bundle <作業ツリーの bundle>`
- verify1 レポート: `verify2.md`(旧 `verify3.md`)。利用者の指示で Phase B の前に読んだため、独立性は完全ではない
- モード: 再検証(前回レポート: `d-verify1.md`、旧 `verify2.md`)。前回は未コミット状態での検証だったため、全体を検証し直した

再現は一時ディレクトリの probe テスト(P1〜P9)で行った。リポジトリと `~/.spirits` は変更していない。

### 判定
**FAIL / BLOCKED**(BLOCKED の S-1 は利用者が決定済み。下の「利用者の判断」)

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 1214 / 失敗 0。`npm run check` 成功。互換ランナー(作業ツリーの bundle、sha256 `7cce2e67…`)は confirmed 33 / failed 1 / not-run 3。failed の `rlm child abort` は変更前の bundle(`d9effea3…`)でも同じ形で出るため、既存の失敗と確定 |
| 要件 | 意図どおり 34 / 全 39 |
| シナリオ | 挙動を確認 168 / 172(乖離 3、未再現 1: TODO キーの端末実打鍵はタスク 7.3 の記録による)、テストが実質的 約 163 / 172 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| タスク | 完了 42 / 全 42(チェック済みで未達: 5.3、5.3 / 5.4 の検証名、8.2) |

### 前回(d-verify1)の指摘の再検証
| 前回 | 結果 | 根拠 |
|---|---|---|
| C-1 Esc | 解消 | P2 / P3。本物の `SettingsList` 経由で Esc を送ると一覧へ戻り、画面全体は閉じない |
| C-2 status の normal | 解消 | `roleResolutionLines` がルーティングと同じ解決を使う |
| C-3 ロック表示 | 解消 | P4 で `lock: normal` と `runs strong` |
| C-4 reload 後の badge | 解消 | `register.ts:199-201`、`a reload draws the badge from the step setting` |
| C-5 誤警告 | 解消 | P5 |
| C-6 api 除外 | 解消 | `role-panel.ts:138-142` |
| C-7 無視した値 | 解消 | `readIgnoredSettings` |
| C-8 例外文 | 解消 | `convention-registry.md:163` |
| C-9 `set_model` | 解消 | `session-model-selection` が `available` |
| C-10 文書 | 解消 | `spirits-managed-pi.md:157-167` |
| C-11 行の説明 | 一部未解消 | ステップ行が未対応(新 C-2) |
| C-12 失敗理由 | 解消 | 理由がその行の説明に出る |
| C-13 アサーション | 解消 | 削られた検証が戻っている |
| C-14 rlm abort | 解消(この変更の起因ではない) | 変更前の bundle でも同じ失敗を実測 |
| W-1〜W-6 | 解消 | W-4 は既知の制約として文書化済み |
| S-1 / S-2 / S-5 | 解消 | design の記述が実物と一致、`--bundle` も実際に効く |
| S-3(決定済み) | 未解消 | 新 C-1 |
| S-4(決定済み) | コマンドは解消、一覧は未解消 | 新 C-2 |
| G-1〜G-3 | 解消 | |

### 指摘

#### CRITICAL

- **[C-1] 一覧のステップが 1 ステップ 2 行のまま(全 35 行)**
  - 場所: `packages/spirits/src/commands/role-panel.ts:263-289`、`test/managed-role-panel.test.ts:95`
  - 根拠: 要件「対話端末で設定と稼働の一覧を開く」の SHALL(1 ステップ 1 行)、d-verify1 S-3 の決定、design D11、tasks 5.3(行数 `1 + 2*2 + STEP_DEFINITIONS.length`)のどれとも食い違う(P1: rows = 35)。シナリオ「ステップの 2 段選択」の「その行の表示と説明」も満たさない。テストのほうは 2 行を前提にしている。
  - 修正先: 実装
  - 推奨: ステップを 1 行 `step:<name>` にまとめ、値を `<role> / <thinking>` にする。Enter でロールを選ばせ、確定したら同じ行の thinking の候補を開く。テストの行数も直す。

- **[C-2] 一覧のステップ行の説明が、実際に応答するモデルと警告を出さない**
  - 場所: `role-panel.ts:270-275`、`:341-347`
  - 根拠: P1。strong 未設定のまま一覧で `opsx-propose` のロールを strong にすると、行の説明は「Runs strong, which you set.」のままで、`strong has no usable model` はどの行にも出ない。ロックの行にも出ないのは、`lockWarning` がロックと実行中のステップしか見ないため。次の 2 要件に反する。
    - 「一覧の説明は実際の解決結果を示す」(MUST: 設定値の写しにしない)
    - 「設定時の警告は…一覧では行の説明で伝える」(SHALL: 該当する行にも出す)
  - 修正先: 実装
  - 推奨: ステップ行でも `resolveRequestRole` と各ロールの解決結果を使い、実際に応答するモデル、継続の有無、strong 未解決の警告を説明に出す。strong の model 行にも同じ警告を出す。

- **[C-3] 開き直したセッションで、終わったはずのステップが reload で復活する**
  - 場所: `src/routing/phase.ts:246-249`、`src/commands/register.ts:318-321`
  - 根拠: P6 で startup / resume / fork の 3 経路とも再現した。経路は次のとおり。
    1. 継続ステップの最中に pi を終了する。セッション記録には `spirits_step {step:"opsx-propose"}` が残る。
    2. そのセッションを新しいプロセスで開く。メモリ上にステップが無いので、`end()` は「ステップなし」を記録しない。
    3. 設定を変えると `ctx.reload()` が走り、`spiritsStepEntry` が古い記録を読んで `restoreStep("opsx-propose")` する。

    要件「再読み込みをまたぐロックと継続中のステップ」の MUST(セッション開始で終わったステップを復元しない)と、design D12 に反する。
  - 修正先: 実装
  - 推奨: reload 以外の `session_start` で、ブランチの最新の `spirits_step` が null でなければ `{ step: null }` を追記する。この経路を検証するテストも足す。

- **[C-4] tasks 5.3 / 5.4 の検証に挙がっているテスト名 10 件が実在しない**
  - 場所: `tasks.md` の 5.3 と 5.4 の検証
  - 根拠: たとえば `bun test test/managed-role-panel.test.ts -t "a step row edits role then thinking"` は `matched 0 tests` で失敗する。存在しないのは次の 10 件: `an unusable target row names the model that answers`、`the lock row shows the lock during a strong-default step`、`the lock row carries the warnings a command would notify`、`escape closes a choice list without writing`、`escape closes the empty model notice`、`a step row edits role then thinking`、`escape on the second stage keeps the thinking level`、`the model row drops every virtual model by its api`、`a failed write shows its reason inside the list`、`a saved edit refreshes the row description`。tasks.md 冒頭の「ケース名は実在するものと同一にする」に反する。
  - 修正先: 実装(テスト)
  - 推奨: その名前でテストを作る。5.4 の Esc の検証は、指定どおり `openRolePanel` が組み立てた `SettingsList` に Esc を送って行う。

- **[C-5] tasks 8.2 の「status の行」が互換マトリクスに無い**
  - 場所: `scripts/managed-pi-compat/matrix.ts:31-142`
  - 根拠: タスクは「role / thinking / ステップ設定 / status / 一覧の行を定義する」だが、`/spirits-role status` を観測する目的が無い。ランナーの駆動にも無い。
  - 修正先: 実装、またはタスク(利用者の判断で実装に決定)
  - 推奨: status を RPC で駆動して出力を読む目的を 1 行足す。

- **[C-6] badge 描画のテストが、成果物で説明されないまま削除された**
  - 場所: 削除されたのは `test/managed-commands.test.ts` の `a role lock shows on the badge before the reload it asks for`。挙動は `register.ts:134`
  - 根拠: シナリオ「role を選んだときに描画する」を検証するテストが無くなった。タスク 6.2 が説明しているのは `/spirits-model` のテストの削除だけ。挙動そのものは正しい。
  - 修正先: 実装(テスト)
  - 推奨: `/spirits-role strong` の後で `statuses.get(ROLE_STATUS_KEY) === "[strong]"` を確かめるケースを戻す。

- **[C-7] 一覧が拡張コマンドを開始コマンドとして数える**
  - 場所: `role-panel.ts:150-159`(`register.ts:265` で名前だけを渡している)
  - 根拠: P8。拡張コマンド `opsx-propose` しか無いセッションで、一覧は「開始コマンドが有る」と表示するが、ステップは開始しない(`phase.ts:215` は `source !== "extension"` で除外している)。シナリオ「開始コマンドが無いステップ」(スキルとテンプレートに 1 つも無い場合)に反する。
  - 修正先: 実装
  - 推奨: `missingStartersFor` に `source !== "extension"` で絞った一覧を渡す。

#### WARNING
- **[W-1]** シナリオ「テンプレートとスキルで同じステップ」を検証するテストが無い。挙動は P7 で正しいと確認した。推奨: `{name:"opsx-ff", source:"prompt"}` を使うケースを足す。
- **[W-2]** シナリオ「SKILL の読み取りだけでは遷移しない」を検証するテストが無い。
- **[W-3]** Esc のテスト(`managed-role-panel.test.ts:310-349`)は `rowSubmenu` に自前の close を渡すだけで、`openRolePanel` での配線を見ていない。9.3 で実際に見つかった「外側の `done` を渡して画面ごと閉じる」不具合を、このテストでは検出できない。
- **[W-4]** status で strong が使えないとき、その行は代わりに応答するモデルを示すが、その出どころを示さない(`role.ts:470-477`)。出どころは同じ通知の normal の行に出ている。
- **[W-5]** design Risks の対策「`/spirits-clear` で終われることを usage とパネルに出す」が実装されていない(`register.ts:82-83`、ロックの行の説明)。
- **[W-6]** design の Migration Plan と proposal は移行表を 2 つの文書に書くとしているが、`docs/spirits-managed-pi-design.md` には移行表が無い。
- **[W-7]** 一覧の端の挙動が 2 つ。(a) 一覧でロックを変えたときに書き込みが失敗すると、ロックは変わるが badge は描き直されない。(b) ステップのロールの書き込みが失敗しても、2 段目の thinking の候補が開く(`role-panel.ts:474-478`)。
- **[W-8]** `docs/spirits-managed-pi.md:153` に誤記「workfow」がある。また「進行中の step を上書きする」と書いているが、ステップ設定はそのステップが走るたびに効くので、説明として正しくない。

#### SPEC
- **[S-1] 一覧のロックの行で書き込みが失敗したとき、2 つの要件が食い違う**
  - 場所: `specs/managed-commands/spec.md` の「一覧での編集はコマンドと同じ書き込みを行う」(失敗した行は表示を元の値に戻す)と、「`/spirits-role` は選んだ値を既定として保存する」(セッションへ適用した変更を取り消さない)
  - 根拠: P9。実装はロックを適用したまま、新しいロック(strong)と失敗理由を表示する。
  - 修正先: spec
  - 推奨: 例外を明記する。

#### SUGGESTION
- **[G-1]** 補完が 4 語目でも候補を返す(`register.ts:376`)。
- **[G-2]** strong が未設定または使えないとき、status は strong の要求に載る thinking レベル(normal のレベル)を示さない(`role.ts:454-477`)。
- **[G-3]** `onRole` が例外を投げると `onRequest` が呼ばれない(`routing/register.ts:161-171`)。

### verify1(`verify2.md`)との突き合わせ
| verify1 | 採否 | d-verify2 | 理由 |
|---|---|---|---|
| 警告 1(1 ステップ 1 行) | 採用・格上げ | C-1 | SHALL 違反で、決定済みの S-3 にも反する。タスク 5.3 もチェック済みなのに未達 |
| 警告 2(テンプレートのテスト) | 採用 | W-1 | 挙動は P7 で正しい |
| 警告 3(SKILL 読み取りのテスト) | 採用 | W-2 | |
| 提案 1(status の strong thinking) | 採用 | G-2 | |
| 提案 2(該当行の警告) | 採用・格上げ | C-2 | SHALL / MUST 違反。どの行にも出ないことを P1 で再現 |
| 提案 3(補完の 4 語目) | 採用 | G-1 | |

d-verify2 だけが挙げた項目と、verify1 が拾えなかったと推定される理由:
- C-3: 新しいプロセスで開き直した後の reload の経路を追わず、reload のテストが通ることで足りると判断した。
- C-4: テストをファイル単位で実行しただけで、タスクの `-t` 指定を実行していない。
- C-5: 目的の一覧とタスクの記述を照合していない。
- C-6: テスト差分の削除を見ていない。
- C-7: 一覧と位相で開始コマンドの判定条件を照合していない。
- S-1: 2 つの要件を同じ行に当てはめていない。

### 利用者の判断(2026-11-13)
- S-1: ロックの行は適用後のロックと保存失敗の理由を示す。spec に例外の要件を追加する。
- C-5: status の観測行を実装する。spec の「role の記録」シナリオに status を加える。
- 検証レポートの名前を付け替えた。旧 `verify2.md` → `d-verify1.md`、旧 `verify3.md` → `verify2.md`、このレポート → `d-verify2.md`。

### 反映先
- specs:
  - managed-commands: 要件「一覧のロックの行は保存に失敗してもセッションのロックを示す」を追加。「一覧での編集はコマンドと同じ書き込みを行う」の失敗時の表示を、設定の項目に限定した。
  - dual-model-routing: 「再読み込みをまたぐロックと継続中のステップ」にシナリオ「開き直したセッションでは後の再読み込みでも復元しない」を追加。
  - managed-pi-compatibility: 「role の記録」に `/spirits-role status` を追加。
- design: D11(ステップ行の説明、開始コマンドの判定、ロックの行の保存失敗)、D12(セッション開始時の終了記録)。成果物の中の「verify2」は「d-verify1」に置き換えた。
- tasks: 3.1、3.4、4.1、4.3、4.5、4.6、5.3、5.4、5.6、8.2、8.3、9.1、9.2、9.3 を未完了に戻し、各タスクに「d-verify2」の小項目と検証のテスト名を追加。

### 次の手順
- C-1〜C-7 と W・G 項目を apply で修正し、このスキルを再検証モード(前回レポート: このファイル)で実行する。
