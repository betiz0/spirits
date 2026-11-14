## Deep Verification Report: unify-spirits-role-command

- 検証日: 2026-11-12
- 検証対象: `f71b6746b`(HEAD)+ 未コミット変更(未コミット変更: あり)。`main` との merge-base は `3c3962f97` だが、`main..HEAD` のコミットは archive 済みの別 change のものなので、HEAD からの作業ツリー差分と未追跡ファイルに絞った。再検証では、前回の検証が未コミット状態だったため全体を検証し直す。
- テストコマンド: `cd packages/spirits && bun test`、`npm run check`。補助として `bun scripts/managed-pi-compat/run.ts --mode fixture`
- verify1 レポート: `openspec/changes/unify-spirits-role-command/verify1.md`
- モード: 通常

### 判定
**FAIL / BLOCKED**(BLOCKED の S-3 / S-4 は利用者が決定済み。下の「利用者の判断」)

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 1197 / 失敗 0。`npm run check` 成功。互換ランナー(作業ツリーの bundle で測定)は confirmed 33 / failed 1 / not-run 3 |
| 要件 | 意図どおり 23 / 全 32 |
| シナリオ | 挙動を確認 153 / 157、テストが実質的 約 141 / 157 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 2 件 |
| タスク | 完了 40 / 全 41(5.1 はチェック済みだが例外文が未更新) |

再現は一時ディレクトリの probe テスト(P1〜P7)と、作業ツリーの bundle を入れた一時 managed root で行った。リポジトリと `~/.spirits` は変更していない。

### 指摘

#### CRITICAL

- **[C-1] 一覧のサブメニューを Esc で閉じられない。モデル 0 件の案内からは一覧へ戻れない**
  - 場所: `packages/spirits/src/commands/role-panel.ts:309-326`
  - 根拠: `SettingsList.handleInput` はサブメニューが開いている間、入力をすべてサブメニューへ渡す(`packages/tui/src/components/settings-list.ts:222-227`)。spirits は `list.onCancel = () => {}` で Esc を捨て、モデル 0 件の案内部品は `handleInput: () => {}` で `close` も受け取らない。Pi の `showExtensionCustom` も Esc を横取りしない。Pi の設定画面はサブメニューの cancel で `done()` を呼ぶ。
  - 修正先: 実装
  - 推奨: `choiceList` に `close` を渡し、`list.onCancel = () => close()`、案内部品も Esc で `close()` する。部品単位のテストを追加する。

- **[C-2] status の normal の解決結果が実際のルーティングと食い違う**
  - 場所: `packages/spirits/src/commands/role.ts:373-398`、`packages/spirits/src/commands/register.ts:188-189`
  - 根拠: probe P4。`models.normal = "nowhere/nothing"` で status は `normal: nowhere/nothing (models.normal)`、実際の要求は `compat-fake/fake-model` へ行く。出どころの「直近の成功レスポンス」は一度も出ず、既定モデルが無くて直近の成功レスポンスがあるときも `unset` と出る。strong の使用不可にも理由が無い。要件「`/spirits-role status` は稼働状況を出す」
  - 修正先: 実装
  - 推奨: ルーティングと同じ解決関数(`resolveNormalTarget` / `resolveStrongTarget`)の結果を使い、出どころと失敗理由と代わりに応答するモデルを出す。

- **[C-3] status と一覧の「ロック」にステップの既定ロールが出る**
  - 場所: `packages/spirits/src/commands/register.ts:185`、`:201`、`packages/spirits/src/commands/role-panel.ts:153`
  - 根拠: probe P3。ロック normal で `/skill:sprt-opsx-verify-deep` の run 中に status を出すと `lock: strong`(`current()` が `defaultRole ?? lock`)。拡張コマンドは run 中も即時実行される(`agent-session.ts:2014`)。
  - 修正先: 実装
  - 推奨: `RoutingPhase.lock()` を足して status と一覧に使う。

- **[C-4] 再読み込み後の badge が引き継いだ位相と一致しない**
  - 場所: `packages/spirits/src/commands/register.ts:262`
  - 根拠: probe P1。`models.steps.opsx-propose.role = strong`、ロック normal、`opsx-propose` 継続中に reload すると badge は `[normal]` を描き、次のリクエストは strong(`fake-strong`)へ行く。要件「再読み込みをまたぐロックと継続中のステップ」。既存テスト `routing-phase-reload.test.ts:121` は一覧の既定ロールの場合だけを見る。
  - 修正先: 実装
  - 推奨: `resolveRequestRole(step, readSettings(), current())` で描く。

- **[C-5] `/spirits-role strong model <ref>` の直後に「strong has no usable model」と誤警告する**
  - 場所: `packages/spirits/src/commands/register.ts:162-177`
  - 根拠: probe P2。strong 未設定で `strong model compat-fake/fake-strong` を実行すると、保存したうえで「strong has no usable model … set one with /spirits-role strong model」と出る。`pi.getSettings()` は reload まで古い値を返す(`settings-manager.ts:589` は `structuredClone(this.settings)`)。fake host は設定を固定で返すのでテストでは見えない。
  - 修正先: 実装
  - 推奨: 書き込んだ値を反映した設定で判定し、strong の対象そのものの設定では警告しない。

- **[C-6] 一覧のモデル候補の除外が api 値でなく provider/id に依存する**
  - 場所: `packages/spirits/src/commands/role-panel.ts:76-79`
  - 根拠: probe P5。`{provider:"other", id:"router", api:"pi-virtual"}` が候補に出る。要件「振り分け用モデルの除外は api 値で行う」(MUST NOT)
  - 修正先: 実装
  - 推奨: `model.api !== PI_VIRTUAL_MODEL_API` で除外する。

- **[C-7] status の無視した設定値が `models.strong` / `models.role` を検査しない**
  - 場所: `packages/spirits/src/config.ts:260-302`
  - 根拠: probe P7。`models.strong = {provider, modelId}`(README が案内する形)で status は「strong: unset (models.strong is not set)」、無視一覧にも出ない。`models.role: "teleport"` も黙って無視される。
  - 修正先: 実装
  - 推奨: strong / role も検査し、「書かれているが読めない」を未設定と区別する。

- **[C-8] `ARCH-PI-BOUNDARY` の例外文が未更新(タスク 5.1 はチェック済み)**
  - 場所: `docs/architecture/convention-registry.md:163`
  - 根拠: 「`src/` の全層が `packages/tui` へ依存することは許可する」のまま。architecture-conventions の MUST(同じ変更で例外文を更新)とタスク 5.1。
  - 修正先: 実装(文書)
  - 推奨: 「`routing` を除く全層。`routing` は `packages/coding-agent` のみ」に直す。

- **[C-9] 互換マトリクスが `set_model` によるセッションのモデル選択を記録しない**
  - 場所: `scripts/managed-pi-compat/matrix.ts:341-385`、`scripts/managed-pi-compat/run.ts:1366`
  - 根拠: `setModelResult` を集めるが使わない。しかも `spirits/auto` を選んだ後に `fake-model` と比較している。シナリオ「model の記録」
  - 修正先: 実装
  - 推奨: `set_model` と `get_state` の読み戻しを観測する目的を 1 行足し、ロールの対象とは別に記録する。

- **[C-10] 文書に公式 `/model`・`/thinking` との代替関係と、ロールの対象とセッション選択の区別が無い。移行表が spec の Migration と矛盾する**
  - 場所: `docs/spirits-managed-pi.md:144-165`、`:184`
  - 根拠: どちらの文もどこにも無い。移行表は `spirits-model <ref>`(セッション選択)を `/spirits-role normal model <ref>`(ロールの対象)に対応させる。spec の REMOVED Migration はセッション選択を公式 `/model` へ移す。要件「専用コマンドの表面の違いを文書に残す」
  - 修正先: 実装(文書)
  - 推奨: 2 文を加え、移行表の 1〜2 行目を公式 `/model` / `/thinking` に直す。

- **[C-11] 一覧の選択行の説明に、実際の解決結果と警告が出ない**
  - 場所: `packages/spirits/src/commands/role-panel.ts:166-176`、`:216-232`
  - 根拠: 設定済みで使えない strong に「Strong answers with X」と出る。ステップ行は実際に応答するモデルを示さない。docs(`spirits-managed-pi.md:154`)は「直近の物理モデル名を含む」と書くが、スナップショットに `lastRequest` が無い。要件「対話端末で設定と稼働の一覧を開く」
  - 修正先: 実装
  - 推奨: スナップショットに解決結果と `lastRequest` を加えて説明に出す。

- **[C-12] 一覧の書き込み失敗の理由が一覧の中に出ない** `[要確認]`
  - 場所: `packages/spirits/src/commands/role-panel.ts:285`
  - 根拠: 理由を `ctx.ui.notify` で一覧の外に出す。要件は「理由を一覧内に出す」、design Risks は「panel 内の通知行」。テスト `a failed write restores the row` は行モデルだけを見る。
  - 修正先: 実装、または spec
  - 推奨: 行の説明か通知行に出す。
  - 要確認: tmux で書き込み失敗を起こし、一覧表示中に通知が見えるか。

- **[C-13] 成果物で説明されていないアサーションの削除**
  - 場所: `packages/spirits/test/routing-phase-wiring.test.ts:74-83`(前提の `expect(role()).toBe(MODEL_ROLE_STRONG)` を削除)、`packages/spirits/test/routing-phase.test.ts:245`(末尾 3 行の削除)、削除されたケース `enters strong for a target skill while locked on strong`
  - 根拠: 前提の検証が無いので、ステップが始まらなくても最後の normal 判定が通る。
  - 修正先: 実装(テスト)
  - 推奨: `phase.step()?.name` で前提を検証する(`role()` はリクエストを解決済みにする)。削った検証を戻す。

- **[C-14] 互換ランナーの `rlm child abort` が failed**(既存の失敗の可能性) `[要確認]`
  - 場所: `scripts/managed-pi-compat/run.ts`
  - 根拠: 作業ツリーの bundle でも、インストール済みの旧 bundle でも同じ失敗(`abort accepted=unknown, cell aborted=false`)。archive 済みの switch-default-to-managed の証跡では confirmed。
  - 修正先: 実装(原因次第)
  - 推奨: 変更前のコミットの bundle で同じ fixture を測って切り分ける。
  - 要確認: 環境依存か、この change より前のコミットの退行か。

#### WARNING

- **[W-1]** 大文字を含むステップ名のキーが黙って無視され、status にも出ない。`packages/spirits/src/config.ts:291`(probe P6。読み取り側は大文字小文字を区別し、無視一覧側は小文字にしてから照合する)。推奨: 無視一覧側も区別して照合し、「一覧に無いステップ名」として出す。
- **[W-2]** 文書の誤り。`README.md:247`(未対応のオブジェクト形式)、`README.md:316`(「モデル選択を清空する」。正しくは開く)、`constants.ts` の DEFAULT_TODO_TOGGLE_KEY の JSDoc(`clearing the model`)、`docs/spirits-managed-pi.md:293`(thinking の判定手段を `set_thinking_level` と書くが、実際は `/spirits-role normal thinking`)。
- **[W-3]** 中身の無い、または弱いテスト。`managed-role-status.test.ts:146`(status を呼ばない)、`managed-role-warning.test.ts:38`(`patchSettings` が何もしないので保存を検証しない)、`routing-phase-reload.test.ts:121`(名前に反して status を見ない)。
- **[W-4]** status の直近のリクエストが、設定コマンドの reload のたびに消える(`packages/spirits/src/index.ts:139`)。
- **[W-5]** 挙動を変えない spec 外の変更。`routing/resolve.ts:47`(比較の左右とコメント整形)、`constants.ts:326-335`(JSDoc の重複)。
- **[W-6]** 一覧で編集した後、行の説明文が更新されない(`role-panel.ts:268-288`)。

#### SPEC

- **[S-1]** design V4/D9 とタスク 3.1 は `pi.getCommands()` が `invocationName` / `kind` を返すと書くが、公式 Pi 1.5.0 は `{name, description, source, sourceInfo}`。実装は実物に合っている。
- **[S-2]** design V2/D11 の `SelectList` theme の記述が実際の型(`selectedPrefix, selectedText, description, scrollInfo, noMatch`)と違う。footer は無い。
- **[S-3]** シナリオ「ステップの 2 段選択」(1 行で role → thinking)と「1 行 1 設定項目」が食い違う。実装は role と thinking を別の行にしている。
- **[S-4]** 「設定時は振り分けの効きを伝える」の適用範囲が曖昧(物理モデル警告は全変更か strong 関連だけか、一覧の編集を含むか)。実装はコマンドのロックと strong 関連だけで、一覧では何も出さない。
- **[S-5]** タスク 8.2 の検証コマンドは fixture モードでインストール済みの bundle を測る(`--bundle` は無視される)。インストール済みの旧 bundle では thinking `unavailable`、role-model と step 設定が `not-run`。作業ツリーの bundle を入れた `--artifact-root` で再測すると 3 つとも `available`。

#### SUGGESTION

- **[G-1]** 未使用の `stepForStarter` を削除する(`routing/phase.ts:107`)。
- **[G-2]** `restoreStep` が reload のたびに同じ `spirits_step` を追記する(`phase.ts:229-236`)。
- **[G-3]** タスク 4.1 の `-t "grammar"` では `leaves everything alone on an unparseable line` が実行されない。

### verify1 との突き合わせ

| verify1 | 採否 | verify2 | 理由 |
|---|---|---|---|
| 警告 1(ロック表示) | 採用 | C-3 | run 中の status で再現する |
| 警告 2(api 除外) | 採用 | C-6 | MUST NOT 違反。他の仮想モデルが候補に出るのを再現した |
| 警告 3(ARCH 例外文) | 採用 | C-8 | チェック済みタスクが未実装 |
| 警告 4(失敗理由) | 採用 | C-12 | 要件の文言からの乖離。画面確認まで `[要確認]` |
| 警告 5(strong の理由) | 採用・拡張 | C-2 | normal 側は使用可否すら見ていない |
| 提案 1(V2 theme) | 採用 | S-2 | |
| 提案 2(stepForStarter) | 採用 | G-1 | |
| 提案 3(2 段選択) | 採用 | S-3 | |
| 提案 4(README 文言) | 採用 | W-2 | |

verify2 だけが挙げた項目と、verify1 が拾えなかったと推定される理由:
- C-1: pi-tui の入力委譲まで追っていない。
- C-4: テスト名を信用した。テストは一覧の既定ロールの場合だけを見る。
- C-5: `pi.getSettings()` が reload まで古い値を返すことは fake host では再現しない。
- C-7: README の記述と読み取り関数を突き合わせていない。
- C-9 / S-5: 観測項目の使われ方を追っておらず、ランナーも実行していない。
- C-10: 「移行表がある」というキーワード一致で満たしたと判定した。
- C-11: 行が存在するかだけを見た。
- C-13: テスト差分を見ていない。
- C-14: ランナーを実行していない。
- S-1: design と実物のバイナリを照合していない。

### 利用者の判断(2026-11-12)

- S-3: 実装をシナリオに合わせる。ステップは 1 ステップ 1 行とし、ロールを選ぶと続けて thinking の候補を開く。spec で「ステップの行はロールと thinking の組を 1 項目として扱う」と定義し、「1 行 1 設定項目」と両立させる。
- S-4: コマンドは全変更で物理モデル警告を出す。strong 未解決の警告は strong のロックとステップ strong のときだけ。一覧では通知を出さず、ロックの行と該当行の説明に出す。
- W-4: 制約として文書化する。status は「再読み込み以降にリクエストが無い」旨を出す。

### 反映先

- specs: `managed-commands` は既存要件(一覧を開く、一覧での編集、status、設定時の警告、api 除外、badge の再描画)を改め、`openspec validate --strict` の要件文 500 文字制限に合わせて次の 7 要件を ADDED で分けた: 「一覧の説明は実際の解決結果を示す」「一覧のステップの行は 2 段で選ぶ」「一覧の候補は Esc で閉じられる」「status のロックと解決結果は実際の位相と解決を示す」「status は読めない設定値と再読み込み後のリクエストの有無を区別して出す」「物理モデル選択中の設定変更は振り分けが働いていないことを伝える」「設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える」。`dual-model-routing` は「ステップ設定の読み取り」「再読み込みをまたぐロックと継続中のステップ」を改めた
- design: V2、V4、D4、D9、D11、Risks
- tasks: 3.2、3.4、4.3、4.4、5.1、5.3、5.4、7.2、8.2、8.3、8.4、9.1、9.2、9.3 を未完了に戻した。9.5 を追加。3.1 と 4.1 は記述だけ修正した。

### 次の手順
- C-1〜C-14 と W 項目を apply で修正し、このスキルを再検証モード(前回レポート: このファイル)で実行する。
