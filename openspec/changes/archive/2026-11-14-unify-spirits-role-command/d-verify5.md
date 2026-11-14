## Deep Verification Report: unify-spirits-role-command

- 検証日: 2026-11-13
- 検証対象: `3c3962f97`(main との merge-base)..`f71b6746b`(HEAD)。未コミット変更あり。前回(d-verify4)も未コミット状態だったので、差分の基点は確定できない。そこで d-verify4 以降に更新された 7 ファイル(`routing/router.ts`、`routing/phase.ts`、`routing/register.ts`、`commands/role-panel.ts`、`test/routing-phase-reload.test.ts`、`test/routing-request-plan.test.ts`、`test/managed-role-panel.test.ts`)を中心に、全体を検証し直した。
- テストコマンド:
  - `cd packages/spirits && bun test`
  - `cd packages/spirits && bun run check`(= `tsc --noEmit`。CI の `spirits-ci.yml` が実行するもの)
  - ルートの `npm run check`
  - `bun scripts/build-managed-pi-inputs.ts --version 0.0.0-0 --out /tmp/spirits-compat-bundle`
  - `bun scripts/managed-pi-compat/run.ts --mode fixture --bundle /tmp/spirits-compat-bundle/spirits-managed-pi-extension.js --out /tmp/spirits-compat.json`
  - tasks.md と `scenario-coverage.md` の `bun test <file> -t "<name>"` を 1 件ずつ実行
- verify1 レポート: なし
- モード: 再検証(前回レポート: `d-verify4.md`)

再現は scratchpad の一時テスト(probe)で行った。リポジトリと `~/.spirits` は変更していない。

### 判定
**PASS WITH WARNINGS**

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 1267 / 失敗 0<br>`packages/spirits` の `bun run check` 成功(出力なし)<br>ルートの `npm run check` 成功(エラー・警告なし)<br>互換ランナー(作業ツリーの bundle を fixture モードで測定)完走: confirmed=33 / limited=0 / unavailable=0 / not-run=3 / failed=1<br>tasks + scenario-coverage の `-t` 指定 成功 200 / 失敗 0 |

互換ランナーの `not-run=3` は fixture モードの既存項目(existing agent dir write-back、settings write compatibility、direct execute probe)、`failed=1` は `rlm child abort` で、d-verify1 C-14 で変更前の bundle でも同じ形が出ることが確認済み。どちらもこの change の起因ではない。
| 要件 | 意図どおり 42 / 全 42 |
| シナリオ | 挙動を確認 183 / 全 183、テストが実質的 181 / 全 183(2 件は `manual:` 7.3 と 8.3) |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| タスク | 完了 47 / 全 47 |

### 前回(d-verify4)の指摘の再検証
| 前回 | 結果 | 根拠 |
|---|---|---|
| C-1 型エラー | 解消 | `bun run check` が成功。`router.ts` は `plan.thinkingLevel ?? request.thinkingLevel` を返し、テストのキャストは `ThinkingLevel`。CI が実行する `packages/spirits` の `bun run check` も成功 |
| C-2 ロックの行と badge | 解消 | `RolePanel.apply` は `finally` で `this.read(this.changes).lock` から badge を描く。`driveScreen` の `failAppend` は本物の `registerManagedCommands` 経由で `FakePi.appendEntry` だけを投げさせ、`setRole` → `appendEntry` の順序を通る |
| C-3 一覧に無い名前の記録 | 解消 | `followStepRecord` は一覧に無い名前で `active = undefined` にし、記録を足さない。`a tree move to an unlisted step record ends the step` が追加された |
| C-4 フォーク経路の移動 | 解消 | `session_tree` の追従を `!registerModelRoles` のときだけ登録。`a fork-route tree move keeps the step` が追加され、`handlersFor("session_tree")` の期待値は削除された |
| W-1 行の一致テスト | 解消 | `the model row and the lock row agree with the route`、`a tree move redraws the badge` が追加された |
| W-2 unset strong の行 | 解消 | `modelRow` は unset のとき `targets.normal.target` を名指す。`an unset strong model row names the model that answers` が追加された |
| W-3 `/tree` のテスト | 解消 | status と decision で検証。記録の無い分岐のケース(`a tree move to a branch with no step record ends the step`)が足された |
| S-1 spec の追従 | 解消 | 9.8 の `scenario-coverage.md` が 183=183 で一致し、表の `bun test` がすべて成功 |
| S-2 型検査の検証 | 解消 | 9.1 に `cd packages/spirits && bun run check` が入った |
| G-1 文言の食い違い | 解消 | `SESSION_LEVEL_WORDS` に統一され、`levelRow` と `stepRow` が同じ文言を使う |

### 指摘

#### CRITICAL
なし。

#### WARNING

- **[W-1] design が名指す `refresh` の例外捕捉が未検証で、その経路では書き込みが成立した的行が旧値のまま `not saved` を出す**
  - 場所: `packages/spirits/src/commands/role-panel.ts:599-621`(`write`)、`packages/spirits/src/commands/role-panel.ts:590-597`(`refresh`)、`packages/spirits/src/commands/role-panel.ts:349-353`(badge を描く `finally`)
  - 根拠: design の Risks は「`onSelect` 内の例外は catch して panel 内の通知行に出す（`openRolePanel` の `write` と `refresh` で捕まえる）」。既存の `an exception in an edit stays inside the list`(`packages/spirits/test/managed-role-panel.test.ts:799`)は `lockRole` 自体を投げさせており、書き込みが失敗する側しか通らない。書き込みが成立した後に panel の read が投げる経路は未検証なので、probe(`pi.getSettings` を N 回目以降投げさせ、一覧の lock 行から strong を選ぶ)で実測した。
    - read が badge を描く `finally`(352 行)で投げる場合: `phase.lock()` は `strong`、`spirits_role` のセッション記録も追記済み、`models.role` の patch も呼ばれている。それなのに badge は一度も描かれず(`ui.setStatus` 0 件)、`ctx.reload()` も 0 回。行は `role lock normal` に `not saved: ...` が乗る。
    - read が `refresh()`(602 行)で投げる場合: lock は `strong`、badge は `[strong]`、reload は 1 回走るが、行は `role lock normal` + `not saved: ...` のまま。
    - 例外は画面の外へ出ない(`handleInput` は投げない)。悪いのは表示と文言だけだが、行が「書き換わった後のセッション」を示すという `RolePanel` の前提(`role-panel.ts:16-20`)と、d-verify4 C-2 で作った「行と badge はセッションのロックとずれない」の要求に、読み戻しが失敗した経路では反している。
    - なお read が環境の入力で投げられるのは考えにくい。read が引く host 呼び出しは `pi.getSettings()`(`packages/coding-agent/src/core/settings-manager.ts:589-591` の `structuredClone(this.settings)`)、`ctx.sessionManager.getBranch()`(`packages/coding-agent/src/core/session-manager.ts:1469` の in-memory の Map 辿り)、`ctx.modelRegistry.getAvailable()`(`packages/coding-agent/src/core/model-registry.ts:68`)で、ファイル I/O を伴わない。設定ファイルの書き込みが `EACCES` を返すのとは事情が違う。CRITICAL にしない理由ここ。
  - 修正先: テスト + 実装
  - 推奨: まず `driveScreen` に `failRead: number` を足し、`pi.getSettings` を N 回目以降投げさせて、badge が描かれるか・reload が走るか・行が新しい値を出すかを検証する。実装側は `write` の catch で `panel.edit` が返しえた場合を分け、成立後は `saved` を保ったまま「保存できたが行を描き直せない」旨の理由だけを出す。

- **[W-2] `docs/spirits-managed-pi.md` が `defaultThinkingLevel` を spirits が読むと書いているが、コードは読まない**
  - 場所: `docs/spirits-managed-pi.md:115`
  - 根拠: 「`defaultThinkingLevel` は pi の `/thinking` が握った既定値であり、spirits は読むだけで書かない」。`rg -n "defaultThinkingLevel|SETTINGS_KEY_THINKING_LEVEL" packages/spirits/src` は型ミラー(`packages/spirits/src/types/pi-coding-agent.d.ts:123`)の 1 件だけ。`readRoutingSettings`(`packages/spirits/src/config.ts:205-222`)は `models.role` / `models.strong` / `models.normal` / `models.thinking` / `models.steps` / `defaultProvider` / `defaultModel` を読み、このキーは読まない。 Spirits がこのキーを引くのは互換ランナーの fixture(`scripts/managed-pi-compat/fixtures/probe-extension.ts:117`)だけ。読み書き本体は pi 側(`packages/coding-agent/src/core/settings-manager.ts:891-896`)。この文は本変更が追加した(`git diff` の `+` 行)。
  - 補足: 値自体はルーティングに効く。pi が起動時にこのキーからセッションの thinking level を決めるので(`packages/coding-agent/src/core/model-resolver.ts:670`、`:683-684`)、spirits の解決の最後の 1 段「pi のセッション選択」を通じて間接的に届く。悪影響は無く、誤りなのは「spirits が読む」という主語だけ。
  - 修正先: ドキュメント
  - 推奨: 「spirits はこのキーを読まない。pi がこのキーからセッションの thinking level を決め、spirits の解決は `models.thinking.*` → `models.steps.*.thinking` → そのセッション選択の順」と書く。

- **[W-3] `docs/spirits-managed-pi-design.md` のマトリクス目的が 9 のままで、`matrix.ts` の 13 目的と食い違う**
  - 場所: `docs/spirits-managed-pi-design.md:90`(§2 見出し「9 目的ごとの方式」)、`:120`(`role-selection` の行)、`:257`(「9 目的 | 9/9 | 7/9」)、`:291`(「9 目的マトリクスの再定義」)
  - 根拠: `scripts/managed-pi-compat/matrix.ts` の目的は role 5(`skill-strong-phase` / `model-role-vocabulary` / `role-badge` / `step-role-settings` / `role-status-report`)、clear 3、model 5(`thinking-level` / `role-model` / `session-model-selection` / `default-save` / `settings-list`)の 13。`docs/spirits-managed-pi.md:204` は「role 5 目的、`/clear` 3 目的、model 5 目的」と更新済み。design の §2 は role 3・clear 3・model 3 で、`:120` の `role-selection` は `matrix.ts` に既に無い id(model 側は `role-model`)。タスク 8.3 はこのファイルの「拡張コマンドの対応表とマトリクス目的」を新仕様に更新するとしており、対応表の 3 行は直されたが目的の列挙と件数が残っている。
  - 修正先: ドキュメント
  - 推奨: §2 と §7 の表を 13 目的に更新する。§10 に「本文は書き換えない。実装段階で判明した事実により、次の項を訂正する」という慣例があるので、4 項目めとして「マトリクスは role 5・clear 3・model 5 の 13 目的になり、`role-selection` は `role-model` に置き換わった」を追記する形でもよい。

#### SPEC
なし。

#### SUGGESTION

- **[G-1] `packages/spirits/README.md` の解決順が `models.role` をロックより後ろに並べている**
  - 場所: `packages/spirits/README.md:252`
  - 根拠: 「ロールについて ステップ設定 → ステップの既定ロール → セッションのロック → `models.role`」。`resolveRequestRole`(`packages/spirits/src/routing/plan.ts:26-28`)は `ステップの設定 ?? phaseRole` で、`phaseRole` にはセッションのロックか `step.defaultRole ?? lock` が入る(`packages/spirits/src/commands/role-panel.ts:280`、`:514`)。`models.role` は `session_start` のロック初期化(`packages/spirits/src/routing/register.ts:232-238`)と `packages/spirits/src/index.ts:158` のフォールバック phase でしか読まれない。spec は `dual-model-routing` の 6 行めで「ステップの設定、ステップの既定ロール、セッションのロックの順」であり、「全体の既定ロール (`models.role`) とは別物」と明記している。README の 4 つ目の矢印は spec にも実装にも無い。
  - 推奨: 「ステップ設定 → ステップの既定ロール → セッションのロック（起動時に `models.role` から初期化）」に直す。

### 指摘の確認
4 件はレポートを書いた後に事実確認をやり直した。W-1 は一時テスト(probe)で 2 とおりの読み戻し失敗を再現し、badge・reload・行の値を実測で確かめた(リポジトリのテストと実装は未変更)。W-2 と W-3 は `rg` でキーと目的 id の在処を全数確認し、W-2 は誤りの範囲が「spirits が読む」という主語だけだと分かったので、間接的に効く経路を補足に書いた。G-1 は spec `dual-model-routing` の本文と実装の両方で裏を取った。

### verify1 との突き合わせ
verify1 のレポートが渡されていないので省略した。

### 次の手順
- PASS WITH WARNINGS: archive に進める。WARNING は校正が推奨されるが、archive を止めるものではない。
