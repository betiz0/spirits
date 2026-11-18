# Verification & Review: improve-spirits-role-routing-visibility

> 注記 (2026-11-17): 本書は改訂前 (16:37 時点) の成果物に対するレビューで、指摘 R-1〜R-21 と Q-1〜Q-9 は同日の改訂で反映済み。改訂後の再レビュー (o-openspec-change-review) の指摘 R-1〜R-12 と Q-1〜Q-3 も反映済み。現在の成果物の判定には使わない。

対象: `openspec/changes/improve-spirits-role-routing-visibility/`
状態: 実装未着手 (`git status --porcelain` は本 change dir の untracked のみ、HEAD `fa269ce49`、`packages/spirits/src` の差分 0)

本書は 2 つの読み取り専用レビューをまとめる。

- 第 1 部 `/opsx-verify` — 実装が変更成果物 (specs / tasks / design) と一致しているかの検証
- 第 2 部 実装前レビュー (sprt-opsx-review-change) — 成果物間の不整合・検証不能な要求・archive 時の欠落リスク・追加する継ぎ目の判断記録

---

# 第 1 部 検証レポート (/opsx-verify)

## サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 0/26 タスク完了、11 要件のうち **4 要件が未実装** |
| 正確性 | 新規・変更シナリオ 31 件のテスト **0 件**、要件マッピング 7 件は差分句が未実装 |
| 一貫性 | 未検証（実装差分が 0 のため判定対象なし） |

前提として、これは「実装が壊れている」ではなく **実装が開始されていない** 状態。

## 重大（アーカイブ前に修正が必要）

### C-1 未完了タスク 26 件（`tasks.md`）

| 群 | 未完了 | 内容 |
|---|---|---|
| 1 | 1.1 / 1.2 / 1.3 | `constants.ts` に語彙と 2 key、badge 組み立ての 4 状態化、導出の一元化 |
| 2 | 2.1 / 2.2 / 2.3 / 2.4 | 描画の置換、`model_select`・`thinking_level_select` 購読、`input` の順序 pin、`index.ts:151` の `onRole` 配線除去 |
| 3 | 3.1 / 3.2 / 3.3 | 2 key の並び順、モデル名の省略、off 時の消去 |
| 4 | 4.1 / 4.2 / 4.3 | 一覧に現在モデル、仮定法、案内の重複防止 |
| 5 | 5.1 / 5.2 / 5.3 | status にモデル名、スコープ診断、警告文の綴りの定数化 |
| 6 | 6.1 / 6.2 | ステップ開始時通知、通知文の手順 |
| 7 | 7.1 / 7.2 / 7.3 | README 4 か国、`docs/spirits-managed-pi-design.md`、表面の違いの文書 |
| 8 | 8.1〜8.5 | `bun run check` / `bun test` / `test-clean-env.sh` / `tmux-verify` / `validate --strict` |

推奨: `/opsx-apply improve-spirits-role-routing-visibility` を起動して群 1 から実装し、各群の検証コマンドをその場で回す。

### C-2 未実装の要件 4 件

| 要件 | 差分の内容 | 証拠 |
|---|---|---|
| `badge は状態の射影を決められた時点で描き直す`（ADDED） | `model_select` / `thinking_level_select` の購読と射影描画 | `rg "model_select|thinking_level_select" packages/spirits/src` → 0 件。badge は今も route 駆動（`packages/spirits/src/index.ts:151` `onRole: (role, ctx) => badge.update(role, ctx)`） |
| `badge は応答する物理モデルを別の status key に出す`（ADDED） | 第 2 status key と順序・省略 | status key は `packages/spirits/src/constants.ts:382` の `ROLE_STATUS_KEY = "spirits"` 1 本のみ |
| `ステップ開始時に振り分けが無効であることを伝える`（ADDED） | 開始時 1 回通知 | `constants.ts:434-440` の `NOTIFY_KEY_*` は既存 3 件のみ（strong/normal/previous）で、ステップ開始のキーなし |
| `role badge は拡張の status 行に出す`（MODIFIED） | `[off]` / `[!]` / レベル併記 | `rg "\[off\]|BADGE_" packages/spirits/src` → 0 件。現行は物理モデル選択中もロックのロールを描く（`commands/register.ts:322`、`:344` にガードなし）＝差分の「物理モデル選択中はロールを出さない」に**現挙動が矛盾** |

推奨: 群 1→2→3 の順で実装し、C-2 の 4 件は 1.2 / 2.1 / 2.2 / 3.1〜3.3 で同時に閉じる。

## 警告（修正が必要）

### W-1 差分で足した句が未実装の要件 7 件（土台の挙動は実装済み）

| 要件 | 欠落している句 | 該当箇所 | 推奨 |
|---|---|---|---|
| `/spirits-role status は稼働状況を出す` | 現在のモデル名／スコープ診断 | `commands/role.ts:315` は `routing: on/off` のみ。`rg "scopedModels|currentModel" packages/spirits/src/commands` → 0 件 | 5.1・5.2 を実装し `ctx.scopedModels` を status 収集に入れる |
| `一覧の説明は実際の解決結果を示す` | off 時の先頭記述と仮定法 | `commands/role-panel.ts:572` は `It answers with ${modelKey(...)}` を無条件で出す | 4.1・4.2 を実装（`routingOff` は snapshot に既に在る） |
| `物理モデル選択中の設定変更は…` | 実行可能な手順 | `commands/role.ts:364` が `"spirits/auto"` をリテラルで埋め込み、スコープ有無を見ない | 5.3 で綴りを constants に寄せ、5.2 の診断を共用 |
| `一覧のロックの行は保存に失敗しても…` | badge の綴り（`[strong low]`） | `commands/register.ts:138` は `badge.update(command.role, ctx)` でロール名のみ | 1.2 / 1.3 の導出に置き換えれば同時に閉じる |
| `ロールの記録と復元`（dual） | 「badge は履歴でなく射影」、off 時はロールを出さない、旧形式/読めない記録の扱い | 記録・復元本体（`ROLE_ENTRY_TYPE`、`inheritedRole`、`restoreLock`）は実装済み。射影化は C-2 に依存 | C-2 の 1 件目が済めばシナリオ 5 件が同時に満たされる |
| `再読み込みをまたぐロックと継続中のステップ`（dual） | 要求レベルを同じ解決から描く | `test/routing-phase-reload.test.ts:201` は現行綴り `[strong]` を期待 | 1.2 後に `routing-phase-reload.test.ts:188,214,410,414` の期待値を新綴りへ |
| `分岐の移動でステップを…`（dual） | 同上 | `test/routing-phase-reload.test.ts:414` | 同上（`session_tree` の購読自体は `commands/register.ts:321` に在る） |

### W-2 新規・変更シナリオ 31 件に対応するテストが無い

`rg "\[off\]|\[!\]|\[strong [a-z]+\]|model_select|thinking_level_select" packages/spirits/test` → 0 件。
内訳: 差分のシナリオ 51 件のうち 新規 17 + 本文変更 14 + 不変 20（不変分は `test/routing-phase-reload.test.ts:117,146,161,302,333,355,372,389` などの既存ケースが対応）。

| 要件 | 未カバーのシナリオ数 |
|---|---|
| `badge は状態の射影を決められた時点で描き直す` | 4（全件） |
| `badge は応答する物理モデルを別の status key に出す` | 4（全件） |
| `ステップ開始時に振り分けが無効であることを伝える` | 3（全件） |
| `role badge は拡張の status 行に出す` | 変更 3 + 新規 3 |
| `/spirits-role status は稼働状況を出す` | 変更 2 + 新規 1 |
| `一覧の説明は実際の解決結果を示す` | 新規 1 |
| `物理モデル選択中の設定変更は…` | 新規 1 |
| `一覧のロックの行は…` | 変更 2 |
| `ロールの記録と復元`（dual） | 変更 5 |
| `再読み込みをまたぐ…` / `分岐の移動…`（dual） | 変更 1 + 変更 1 |

推奨: tasks 1.2・2.1〜2.4・3.1〜3.3・4.1〜4.3・5.1〜5.3・6.1〜6.2 ごとに、その場でテストを追加してから実装する（タスク文にテストファイル名を明記済み）。

### W-3 旧綴りを pin している既存テスト 12 箇所が、実装時に必ず落ちる

`packages/spirits/test/managed-commands.test.ts:115,135,147,159`、`managed-role-panel.test.ts:896,924,947`、`routing-integration.test.ts:82,86`、`routing-phase-reload.test.ts:188,214,410,414`（`[strong]` / `[normal]`）。
推奨: 実装と同一コミットで期待値を更新する。`managed-commands.test.ts:135` はタスク 2.1 の差し替え対象そのもの。

### W-4 文書 5 か所が古い badge の意味（直近リクエストの履歴・1 リクエスト遅れる）を説明したまま

`README.md:111`、`README.ja.md:111`、`README.zh.md:107`、`README.de-CH.md:107`、`docs/spirits-managed-pi-design.md:104,276`。
推奨: タスク 7.1・7.2 を、badge 実装と同じ群の完了時（群 2 の終わり）に前倒しで実施する。放置すると仕様と文書が逆方向に動く。

## 提案

- **P-1** `commands/role.ts:364` の `roleSettingWarning` は `routingModel` 引数を持つが、`register.ts`・`role-panel.ts` のいずれも渡していない（`commands/register.ts:184-193`、`commands/role-panel.ts:427-433,471-479,578-585`）。タスク 5.3 で引数を削除するか実際に綴りを渡すか、どちらかに寄せる。
- **P-2** 一覧の説明文を仮定法にすると行が長くなる。説明文は選択時のみ表示されるが、`MAIN_VISIBLE_ROWS = 12`（`commands/role-panel.ts:66`）の画面で巻き取られうる。実装時に off 時の先頭文は 1 文に抑える。

## 未検証のチェックと理由

| チェック | 理由 |
|---|---|
| 設計の遵守 | `design.md` の 9 判断はいずれも目標状態の記述で、比較対象の実装差分が 0。Context 節の現状記述（`index.ts:151` の route 駆動、`role.ts:364` のリテラル）は現状コードと一致していることのみ確認 |
| コードパターンの一貫性 | 実装変更が特定できないため（同上） |

## 第 1 部 最終評価

**重大 2 件（未完了タスク 26 件／未実装要件 4 件）。アーカイブする前に修正してください。** 警告 4 件、提案 2 件。設計の遵守とコードパターンの一貫性は未検証（実装差分が無いため）。

`openspec validate improve-spirits-role-routing-visibility --strict` は通っており、計画アーティファクト側は準備完了。次の操作は `/opsx-apply improve-spirits-role-routing-visibility`。

---

# 第 2 部 実装前レビュー

## 収集ログ

- `openspec --version` → **2.0.0**
- `openspec status --change improve-spirits-role-routing-visibility --json` → schemaName `spec-driven`、planningHome.root `/home/betiz/projects/spirits`、changeRoot `openspec/changes/improve-spirits-role-routing-visibility`、artifacts `proposal/specs/design/tasks` すべて存在（`isPlanningComplete: true`）、`applyRequires: ["tasks"]`
- schemaName が `spec-driven` のため `openspec instructions <artifact>` による審査基準の読み替えは不要（未実行）
- `openspec validate improve-spirits-role-routing-visibility --strict` → 終了 0、報告 0 件
- `.openspec.yaml` → `schema: spec-driven` / `created: 2026-11-17`。**skip_specs 無し / retire_capabilities 無し**
- `openspec/config.yaml` → rules あり（proposal 4 / specs 4 / design 4 / tasks 2）。specs rules「内部関数名やライブラリ選定は design へ」「アーキテクチャ規約は正本を正とする」、design rules「代替案を必ず 1 つ併記」「ホスト挙動の決定は対象版の公式 artifact か実測で確認したことを書く」、tasks rules「検証方法明記」「依存順」
- **規約正本**: `docs/architecture/convention-registry.md`（全文読了）。`registry:layers` の許可: `spirits:routing → spirits:shared, host:pi-coding-agent` のみ / `spirits:commands → spirits:shared, spirits:routing, host:pi-coding-agent, host:pi-tui` / `spirits:entry → 全層`。ARCH-DUP 基数 0（60 文字以上かつ 10 行以上の関数本文が対象）
- 読んだ成果物: `proposal.md`、`design.md`、`tasks.md`、`specs/managed-commands/spec.md`、`specs/dual-model-routing/spec.md`
- 読んだ現行 spec: `openspec/specs/managed-commands/spec.md`、`openspec/specs/dual-model-routing/spec.md`。存在しなかった現行 spec は **なし**
- 他の active change: `openspec list --json` → 本変更 1 件のみ。同一 capability の競合 delta なし
- 更新順（change dir は untracked なので `git log` 対象外、`ls -l` の mtime）: proposal 15:45:52 → specs/dual 15:50:58 → specs/managed 15:55:42 → design 15:55:49 → tasks 15:55:55。**上流が下流より前の順序**
- 既存実装の探索語と範囲（`packages/spirits/src`、`packages/spirits/test`、ホスト `packages/spirits/node_modules/@earendil-works/pi-coding-agent/dist`）: `createRoleBadge` / `roleBadgeText` / `isPhysicalSelection` / `roleSettingWarning` / `ROUTING_MODEL_ID` / `RoutingHooks` / `onRole` / `model_select` / `thinking_level_select` / `scopedModels` / `statuses` / `setStatus` / `defaultRole` / `set_model`

## validate結果

V-1 報告なし（ERROR/WARNING/INFO なし、終了 0）。`Archive would refuse this delta` / `ignored by validation` / `Could not check archive merge conflicts` のいずれも出力されなかった。

## 継ぎ目一覧

| # | 継ぎ目 | 種別 | 出典 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | badge 値の単一導出（設定・位相・セッションのモデル → 語彙）を「1 か所」に置く | 境界 / 抽象型 | tasks 1.3、design Decision 1「同じ 1 関数の結果を共有する」 | 「1. badge は履歴ではなく射影とする」（**配置の記述なし**） | ARCH-SPIRITS-LAYER | R-3 |
| N-2 | `RoleBadge` の書き込み API 変更（`update(role, ctx)` → 語彙 + 第 2 key）と entry の配線 | 抽象型 | `src/commands/role.ts:520-533`、tasks 1.2 / 2.1 / 2.4 | なし | ARCH-SPIRITS-LAYER（entry 経由は許可内） | R-3 |
| N-3 | ホストイベント購読 `model_select` / `thinking_level_select`（routing に置く予定） | 拡張点（イベント購読） | tasks 2.2、design Decision 2 | 「2. 描き直しはイベント駆動」（**購読する層と badge への経路なし**） | ARCH-SPIRITS-LAYER | R-3 |
| N-4 | 第 2 の拡張 status key（表示契約 + 定数 + 桁上限） | 拡張点（`ui.setStatus`）/ 公開表示契約 | specs ADDED `badge は応答する物理モデルを別の status key に出す`、design Decision 4 | 「4. 物理モデルの表示は provider を落として自前で省略する」（**撤回条件なし**） | なし | R-4、R-12 |
| N-5 | ステップ開始通知の導線 + 「1 セッション 1 回」フラグ（メモリ状態） | 拡張点（通知）/ 状態 | tasks 6.1「`routing/register.ts` と `commands/register.ts` の間に」、design Decision 7 | 「7. ステップ開始時の通知は…」（**配置なし**） | ARCH-SPIRITS-LAYER | R-3、R-5 |
| N-6 | 振り分け有効・無効判定の唯一化 | 境界（新共有部品）or 既存重複の継続 | design Decision 5「同じ判定を使う」、`src/commands/register.ts:349`、`src/routing/child.ts:72-74` | 「5. 振り分けの有効・無効はセッションのモデルで判定する」（**配置と「重複を許容する」代替案なし**） | ARCH-SPIRITS-LAYER、ARCH-DUP | R-9 |
| N-7 | 「実行可能な手順」テキストの生成（警告 / status / ステップ通知） | 境界 or 予定された重複 | design Decision 6、tasks 5.2 / 5.3 / 6.2、`src/commands/role.ts:349` | 「6. スコープの診断はセッションのスコープ集合を読む」（**共有か重複か未記述**） | ARCH-DUP | R-8、R-6 |

## 指摘

### [R-1] Blocker | B6 / E3

- 対象: `specs/dual-model-routing/spec.md` `ロールの記録と復元` / Scenario `復帰後にロールが戻る`、`specs/managed-commands/spec.md` `role badge は拡張の status 行に出す` / Scenario `制御文字を含む role は描画しない`
- 問題: 本文で badge を「履歴でなく射影」に切り替えた一方、残した既存シナリオ 2 件は「記録された role が badge に届く」前提のままで、期待値が相反する。
- 根拠: 新 MUST「badge は直近のリクエストの履歴ではなく、次のリクエストの解決の射影とする。(MUST)」に対し `復帰後にロールが戻る` の THEN は「記録されたロールは strong として復元されて**拡張の status 行に表示され**」、`制御文字を含む role は描画しない` の WHEN は「**記録された role** が制御文字だけからなる」。既定ロール normal + 記録 strong の復帰では射影（normal）と THEN（strong）が両立しない。
- 照合先: `src/index.ts:151`（`onRole: (role, ctx) => badge.update(role, ctx)`）、`src/commands/register.ts:322` / `:344`（session_start / session_tree で記録ロールを描く現行経路）
- 確度: 確認済
- 判断: **要判断** → Q-1

### [R-2] Blocker | B4 / B6

- 対象: `specs/managed-commands/spec.md` `一覧のロックの行は保存に失敗してもセッションのロックを示す` の Scenario 2 件、`specs/dual-model-routing/spec.md` `ロールの記録と復元` の Scenario `旧形式の記録はロール未決定` / `読み取れない記録はロール未決定` / `復帰では既定ロールを記録しない`
- 問題: GIVEN にセッションのモデルが無く、同じ差分の新 MUST「振り分けが無効なセッションではロール名と要求レベルを出さず `[off]` だけ」と衝突しうる（現行テストの fake ctx は物理モデルを渡すため、そのまま実装すると期待値が `[off]` 側へ倒れる）。
- 根拠: 例 `ロックの保存が失敗する` GIVEN「normal がロックされ、設定の書き込みが失敗し、strong の thinking レベルが low に設定されている」/ THEN「badge は `[strong low]` と描画される」— モデルの固定なし。他の新規・変更シナリオ（`strong で走ったあとは strong を出す` など）は GIVEN に `spirits/auto` が選択され を持つ
- 確度: 確認済
- 判断: 機械的 → GIVEN に `spirits/auto` が選択され を追記し、無効側の期待が必要ならシナリオを分ける
- Blocker とした理由: 現行テスト `managed-role-panel.test.ts:896,924,947`、`routing-phase-reload.test.ts:188,214,410,414` が物理モデル ctx で `[strong]` を通しており、期待値を推測で書き換えることになる

### [R-3] Blocker | F2 / F5

- 対象: `design.md` Decisions 1・2・7、`tasks.md` 1.3 / 2.2 / 2.4 / 6.1（N-1・N-2・N-3・N-5）
- 問題: 追加する継ぎ目の配置と駆動経路の判断記録が無く、tasks の記述は規約正本の層許可と衝突しうる。
- 根拠: tasks 2.2「`packages/spirits/src/routing/register.ts` で `model_select` と `thinking_level_select` を購読して**再描画を呼び**」、tasks 6.1「導線を `routing/register.ts` と `commands/register.ts` の**間に**追加」。`docs/architecture/convention-registry.md` の `registry:layers` は `spirits:routing → ["spirits:shared","host:pi-coding-agent"]` のみで routing→commands を認めない（ARCH-SPIRITS-LAYER、強度 SHALL）。design Decision 1 は「同じ 1 関数の結果を共有する」まで、Decision 2 は「どのイベントで描くか」だけで、**継ぎ目を追加しない案**（例: 購読を `commands/register.ts` に置く — commands は host と routing の両方へ許可済みで `src/commands/register.ts:29-45` が既に routing を import している）、**対価の箇所の実証**、**撤回条件**がない
- 照合先: `docs/architecture/convention-registry.md`（registry:layers / ARCH-SPIRITS-LAYER）、`src/index.ts:143-163`（既存の hooks 配線）
- 確度: 確認済
- 判断: **要判断** → Q-3

### [R-4] Major | B4 / E2

- 対象: `specs/managed-commands/spec.md` `badge は応答する物理モデルを別の status key に出す`、Scenario `桁数を超えるモデル ID は省略する`、`design.md` Decision 4、tasks 1.1 / 3.2
- 問題: 「既定の桁数」が数値として決まっておらず、「省略した旨が分かる」の表記も決まっていないため、テストが書けない（検証不能）。
- 根拠: spec「既定の桁数を超えるときは末尾を省略して示す。(SHALL)」/ design「既定の桁数 (定数)」/ tasks 1.1「応答モデル表示の既定桁数」— 数値は成果物全体で未記述（`rg -n "桁"` で 8 箇所すべて変数扱い）
- 確度: 確認済
- 判断: **要判断** → Q-4

### [R-5] Major | B5 / E2

- 対象: `specs/managed-commands/spec.md` `ステップ開始時に振り分けが無効であることを伝える`、Scenario `設定の無いステップでは伝えない`、tasks 6.1
- 問題: 「そのステップにロールまたは thinking レベルの**設定がある**」が明示設定（`models.steps.<name>`）を指し、一覧の既定ロールが strong のステップが通知対象から外れる。変更の動機（強いモデルで走ると誤解する）が残る。
- 根拠: `src/constants.ts:421-422` は `sprt-opsx-review-change` と `sprt-opsx-verify-deep` を `defaultRole: MODEL_ROLE_STRONG` で登録しており、設定なしで strong の期待が生じる。差分のシナリオは「そのステップのロールと thinking レベルは未設定である」で伝えないことを固定している
- 確度: 確認済
- 判断: **要判断** → Q-5

### [R-6] Major | B5

- 対象: `specs/managed-commands/spec.md` の手順を名指す 3 要件（`/spirits-role status` / `物理モデル選択中の設定変更…` / `ステップ開始時に…`）、tasks 5.2 / 6.2
- 問題: 名指す手順が対話端末の操作（`/model` の selector、`/scoped-models`）前提で、対話端末でない managed セッションでの出し方が未定義。
- 根拠: ホスト側で `/model`・`/scoped-models` は `dist/modes/interactive/interactive-mode.js` と `dist/core/slash-commands.js` の対話スラッシュ、RPC は型付きコマンド `set_model`（`dist/modes/rpc/rpc-mode.js:365`）。現行 spec 側も `一覧は対話端末で設定と稼働の一覧を開く` および `専用コマンドの表面の違いを文書に残す` で「対話端末でしか使えない操作」を区別している（差分はこの語彙を引き受けていない）
- 照合先: `openspec/specs/managed-commands/spec.md:137`、`design.md` Decision 8
- 確度: 確認済（対話限定であること）/ 推定（spirits 側の非対話経路で status・通知が実際にどう出るかは未観測）
- 判断: **要判断** → Q-6

### [R-7] Major | B6

- 対象: `specs/managed-commands/spec.md` `一覧の説明は実際の解決結果を示す` の新文「すべての行の説明の先頭に無効であることと現在のモデルを述べ」、`openspec/specs/managed-commands/spec.md:451` `設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える`（差分化されていない）
- 問題: 同一の行の説明に「off 記述 + 現在のモデル」「保存に失敗した旨と理由」「警告と同じ内容」の 3 系統が乗る順序・長さが未定義で、行の合成規則を持つ要件を MODIFIED していない。
- 根拠: 現行要件「一覧での編集では警告の通知を出さない。(MUST NOT) 代わりに、同じ内容をロックの行と該当する行の説明に出す。(SHALL)」+ 差分の新 MUST「すべての行の説明の先頭に…」が同じ行に重なる。tasks 4.3 は「ロックの行と strong のモデルの行で二重に出ない」ことしか検査しない
- 確度: 確認済
- 判断: **要判断** → Q-7

### [R-8] Major | F4

- 対象: `tasks.md` 5.2 / 5.3 / 6.2、`design.md` Decision 6（N-7）
- 問題: 「実行可能な手順」の文言を 3 か所（設定時警告・status 診断・ステップ開始通知）で別々に作る予定になっており、design に重複の理由も共有化の判断もない。
- 根拠: 既存の警告生成は `src/commands/role.ts:349-366`（`roleSettingWarning`）。差分は status（tasks 5.2）、警告（tasks 5.3）、通知（tasks 6.2）の 3 か所に同じ「スコープ有・無で切り替わる手順文」を課す。design Decision 6 は入力（`scopedModels` を読む）だけを決め、実装の数を Decide していない
- 照合先: `docs/architecture/convention-registry.md` ARCH-DUP（基数 0）
- 確度: 確認済
- 判断: **要判断** → Q-8

### [R-9] Major | D4 / F4

- 対象: `design.md` Decision 5、`tasks.md`（対応タスクなし）（N-6）
- 問題: 「比較による判定を唯一の正とする」に対応するタスクが無く、現状は同じ比較が 2 か所に重複している。
- 根拠: `src/commands/register.ts:349-350`（`isPhysicalSelection`、非 export）と `src/routing/child.ts:72-74`（同じ provider/id 比較）。唯一化して routing 側から読むには shared 層の新しい共通部品が必要（新しい向きの継ぎ目）だが、tasks 1.1〜1.3 は badge 語彙と導出しか扱わない。ARCH-DUP は 1 行の比較なので基数 0 のまま（検査対象は 60 文字以上・10 行以上）
- 確度: 確認済
- 判断: **要判断** → Q-9

### [R-10] Major | B6

- 対象: `specs/managed-commands/spec.md` `一覧の説明は実際の解決結果を示す` の末尾文「『一覧の説明の thinking レベルは要求に載るレベルを示す』の一致も同じ仮定に対するものとする」
- 問題: 解釈を変えられた側の要件（現行 `openspec/specs/managed-commands/spec.md:284`）を MODIFIED せず、別ブロックからの注記だけで上書きしている。archive 後、その要件単体でテストを書くと振り分け無効時に落ちる。
- 根拠: 差分に `一覧の説明の thinking レベルは要求に載るレベルを示す` の MODIFIED ブロックは無い（差分の MODIFIED は 5 要件、該当なし）
- 確度: 確認済
- 判断: 機械的 → 当該要件を MODIFIED に含め、同じ but 文を本文へ書く

### [R-11] Major | D3 / D6 / A5

- 対象: `tasks.md` 2.2 / 3.3 / 5.1 / 5.2 / 6.2、`proposal.md` Impact のテスト列挙
- 問題: 実装前に必要なテスト基盤の追加がタスク化されておらず、影響を受ける badge 期待値の洗い出しに漏れがある。
- 根拠: `scopedModels` はテスト全体で 0 件（`rg -n "scopedModels|thinkingLevel" packages/spirits/test` は thinkingLevel のみ）で fake ctx に無い。`model_select` / `thinking_level_select` を発火する payload factory も 0 件（`test/routing/fake-pi.ts` は汎用 `on()`/`fire()` と `inputEvent` のみ、:139-169）。badge 文字列を pin している `test/managed-role-panel.test.ts:896,924,947` が tasks 2.4 の更新対象（routing-integration / routing-phase-reload）と Impact のテスト一覧のどちらにも無い
- 確度: 確認済
- 判断: 機械的 → fake ctx の `scopedModels` と 2 イベントの payload factory をタスク群 2 より前に置き、Impact と tasks 2.4 に `managed-role-panel.test.ts` を追記する

### [R-12] Major | B5

- 対象: `specs/managed-commands/spec.md` `badge は応答する物理モデルを別の status key に出す`、tasks 3.1〜3.3
- 問題: 書き込み口が 2 本になったときの `ui.setStatus` 失敗の降格挙動が未定義。
- 根拠: 既存の降格検査は `ui.setStatus` が例外を投げるホストを想定している（`test/extension-degradation.test.ts:168-196`）。差分は新 key の追記のみで、第 1 key が描けて第 2 key が落ちる状態（その逆）の要求を持たない
- 確度: 確認済
- 判断: 機械的 → 既存の降格要件で足りるならその旨を 1 文、足りないなら SHALL を追加する

### [R-13] Minor | A3

- 対象: `proposal.md` What Changes
- 問題: **BREAKING** 指定が「badge を `[off]` に置き換える」1 件で、一覧の説明文・status の新項目・復帰時の表示（R-1）も挙動を変える MODIFIED なのに未指定。
- 根拠: BREAKING は 4 番目の項目にのみ付与。一覧の「応答する」→仮定法、status へのモデル名追加は既存出力の変更
- 確度: 確認済
- 判断: 機械的 → 対象項目に BREAKING を追記（Minor とした理由: データ・API 非互換ではなく表示文言の後方互換の問題のため）

### [R-14] Minor | D2

- 対象: `tasks.md` 5.1 / 4.1 / 4.2 / 4.3
- 問題: 検証方法が spec のシナリオ名 + 「相当のケース」で、テストケース名が示されていない。
- 根拠: tasks 5.1「`物理モデルを選んでいれば無効と出る` 相当のケース」。実際のケース名は `reports routing disabled on a physical model`（`test/managed-role-status.test.ts:84`）。tasks 1.2・2.1 は既存ケース名を引用しており、同ファイル内でレベルが不揃い
- 確度: 確認済
- 判断: 機械的 → 引用をテスト名に置き換える

### [R-15] Minor | D2

- 対象: `tasks.md` 7.3
- 問題: 検査コマンド `rg -n "scoped-models" packages/spirits/src` は spirits 側を検索するため、操作名の存在確認として機能しない。
- 根拠: `rg -c "scoped-models" packages/spirits/src` → 0 hits。実在はホスト側（`dist/core/slash-commands.js`、`dist/modes/interactive/components/scoped-models-selector.js`）にある
- 確度: 確認済
- 判断: 機械的 → 検査をホストのコマンド一覧またはセッション実測に絞る

### [R-16] Minor | D5 / A6

- 対象: `tasks.md` 4.3
- 問題: 「案内がロックの行と strong のモデルの行で二重に出ない」ことに対応するシナリオが仕様差分に無い（tasks のみに現れる検査）。
- 根拠: `一覧の説明は実際の解決結果を示す` のシナリオ 3 件に重複防止の記述なし
- 確度: 確認済
- 判断: 機械的 → シナリオを 1 件追加するか、R-7 の合成規則に吸収する

### [R-17] Minor | D1

- 対象: `tasks.md` `## Workflow follow-up`
- 問題: bare bullets で `- [ ] X.Y` 形式でなく、openspec の進捗集計（26 件）に入らない。
- 根拠: `openspec instructions apply` の `progress.total: 26` に本節の 2 項目は含まれない
- 確度: 確認済
- 判断: 機械的 → タスク番号を付けるか、Note 見出しへ移す

### [R-18] Minor | B5

- 対象: `specs/managed-commands/spec.md` `role badge は拡張の status 行に出す` / Scenario `応答するロールが無いときはその旨を出す`
- 問題: `[!]`（応答ロール無し）のときに第 2 status key を消すかどうかが未定義（消去の定義は「振り分けが無効なとき」のみ、tasks 3.3 も off 限定）。
- 根拠: 第 2 key 要件「振り分けが無効なセッションでは物理モデルの表示を出さない。(MUST)」— 有効だが応答が無いケースが無い
- 確度: 確認済
- 判断: 機械的 → 「応答する物理モデルが無いときも出さない」を追記

### [R-19] Minor | E3

- 対象: `specs/managed-commands/spec.md` `一覧の説明は実際の解決結果を示す`（現在のモデル）、同 `badge は応答する物理モデルを別の status key に出す`（provider を除いた ID）
- 問題: 一覧に出す「現在のモデル」の表記形式が第 2 key と揃う規定がなく、2 面で provider 有無が食い違いうる。
- 根拠: 第 2 key は「provider を除いたモデル ID」、一覧は「現在のモデル」（形式の指定なし）
- 確度: 確認済
- 判断: 機械的 → 第 2 key と同じ整形を使う旨を書く（一覧は幅に余裕があるので provider 付き可ならその旨を明記）

### [R-20] Minor | B6

- 対象: `specs/managed-commands/spec.md` `role badge は拡張の status 行に出す`
- 問題: 現行 3 文目「role の選択が終わったときに badge を描画し、拡張の再読み込み後に…もう一度描画」に相当する義務が新規 ADDED 要件へ移り、描画時点が 2 要件に分散した。
- 根拠: 現行 `openspec/specs/managed-commands/spec.md:77`。義務自体は ADDED `badge は状態の射影を決められた時点で描き直す` の時点列（入力ごと / モデル変更 / thinking 変更 / `/spirits-role` の後 / セッション開始 / 分岐移動）でカバーされる
- 確度: 確認済
- 判断: 機械的 → MODIFIED 側に「描画時点は『badge は状態の射影を決められた時点で描き直す』に従う」の 1 行を置く

### [R-21] Minor | config rules (design)

- 対象: `design.md` Context
- 問題: 設計の一次根拠として `docs/spirits-managed-pi-design.md` を挙げており、`openspec/config.yaml` の design rules が求める `docs/spirits-design.md` / `docs/spirits-m*.md` との対応が書かれていない。
- 根拠: rules「設計の一次根拠は docs/spirits-design.md と対応する docs/spirits-m*.md を参照し、重複記述を避ける」。design が参照する文書は Context の `docs/spirits-managed-pi-design.md:104,276` のみ
- 確度: 推定（routing / managed 経路の一次根拠がどちらの文書系か、成果物に根拠がない）
- 判断: 機械的 → rules との対応を 1 行明記する（managed 経路は phase 外なので `docs/spirits-managed-pi-design.md` が正である旨）

## 利用者の判断事項

### [Q-1] 対応: R-1

- 問い: 復帰したセッションで、記録されたロールを badge に表示し続けますか。
- 選択肢:
  1. 記録は `status` の「直近のリクエスト」だけに使い、badge の入力から外す — 復帰直後の badge は既定ロール/ロックの解決になり、「復帰後に strong が戻る」表示は消える（追加の BREAKING。既存 THEN 2 件の書き換えが必要）
  2. 射影の入力に記録ロールも加える（ロック解決より低優先）— 既存シナリオはそのまま通るが、「履歴ではない」の MUST を緩めることになり、badge の意味が 2 系統残る
  3. 復帰直後だけ記録ロールを描き、次の入力で射影へ切り替える — 表示は段階的だが、仕様に「復帰後 1 回目だけ」の状態が増える
- 判断材料: 現状の実装は `session_start` / `session_tree` で記録ロールを描く（`src/commands/register.ts:322,344`）。記録されたロールは run のロールではなく表示専用（dual 現行要件）。`status` は既に直近リクエストのロールを出す
- 推奨: 選択肢 1。表示と実解決の一致という変更目的に最も近く、情報は status に残る

### [Q-3] 対応: R-3（N-1 / N-2 / N-3 / N-5）

- 問い: badge の単一導出と、ホストイベントから再描画までの駆動を、どの層に置きますか。
- 選択肢:
  1. 購読も導出も `commands/register.ts` に置く（routing は変更しない）— 継ぎ目は増えない。routing 側の role 報告は `index.ts:151` の配線を外すだけで止まる。ただし badge の値に必要な解決を commands が routing へ読む方向になる（既存の許可済み方向）
  2. `routing/register.ts` が購読し、`index.ts` 経由（既存 `RoutingHooks` に 1 項目追加）で commands の badge を描く — tasks 2.2 の記述に近い。hooks という既存の拡張点が 1 太くなる
  3. 導出を共有モジュール（`src/constants.ts` ではなく新ファイル）に置き、commands / routing 双方から読む — 再利用性は出るが新しい共有境界。`registry:layer-members` と正本の編集が必要
  4. 導出を `routing/plan.ts` に置き commands が読む — 追加の継ぎ目は既存方向の延長。badge 語彙（表示語彙）が routing 層に入る
- 判断材料: `registry:layers` は `spirits:routing` の依存先を `spirits:shared` と `host:pi-coding-agent` のみに限定（ARCH-SPIRITS-LAYER、SHALL）。`spirits:commands` は `spirits:routing` と host 両方へ依存可で、`src/commands/register.ts:29-45` は既にその方向を使っている。ステップ開始通知（N-5）は routing が直接 `ctx.ui.notify` すれば導線不要（routing は host の `ui` を使える）
- 推奨: 選択肢 1（通知も routing 単独で出す）。追加の継ぎ目なしで済み、tasks 2.2 / 6.1 の記述をその方向に書き直せる

### [Q-4] 対応: R-4

- 問い: 応答モデル表示の桁上限と、省略されたことの示し方は何にしますか。
- 選択肢:
  1. 固定 N 文字 + 末尾 `…` — 表示は読めるが、長い ID の判別は落ちる
  2. provider 無し ID をそのまま出し footer の行省略に任せる（design が却下した案）— 実装は最も simple だが、行の末尾から削られ他の拡張表示にも影響する
  3. 先頭 + 末尾を表示（例 12+1 文字）— 長い ID の末尾（version/tag）を残せるが整形規則が増える
- 判断材料: footer は拡張 status 行全体を 1 行に並べ端末幅で末尾を省略する（`dist/modes/interactive/components/footer.js`）。実運用の設定で応答モデルになりうる ID の例: `ernie-5.5-flash-preview`（21 字）、`Qwen3.8 Flash Next`（18 字）。現状の badge 表示は `[strong high]` で約 13 字
- 推奨: 選択肢 1 の N=24 + `…`。上記の実 ID がほぼ収まり、`constants-steps.test.ts` の綴り検査に固定値として置ける

### [Q-5] 対応: R-5

- 問い: 明示設定が無くても既定ロールが strong のステップ（`sprt-opsx-review-change`、`sprt-opsx-verify-deep`）でも、振り分け無効時の通知を出しますか。
- 選択肢:
  1. 既定ロール strong のステップにも出す — 誤解の起きるケースを漏らさないが、「設定が無いステップでは伝えない」のシナリオを書き換え、通知頻度が増える
  2. 明示設定があるステップ限定のままとする — 通知は最小。既定 strong のステップで誤解が残る（今回の不具合と同型）
  3. 既定ロールがセッションのロックと異なるステップだけ出す — 中間案。判定規則の説明が増える
- 判断材料: `src/constants.ts:421-422` が `defaultRole: strong` を 2 ステップに持つ。提案の Why は「設定した strong が使われていない誤解」で、既定 strong のケースも含むかどうかは成果物で明示されていない
- 推奨: 選択肢 1（理由は Why の範囲と一致させるため）。ただし仕様シナリオ 2 件の書き換えが伴う

### [Q-6] 対応: R-6

- 問い: 対話端末以外の managed セッション（RPC / print）で、手順の案内はどう出しますか。
- 選択肢:
  1. 設定ファイル（`enabledModels`）と起動オプション（`--models`）への追記を名指す — どの経路でも実行可能だが、画面操作より重い案内になる
  2. 非対話では手順を出さず「スコープ外である事実」だけ出す — 短文だが利用者が次の動作を自力で探す
  3. 対話端末限定と明記し、非対話は「手順なし」のシナリオを仕様に加える — 実装が明確。文書（tasks 7.3）にも同じ区別が必要
- 判断材料: `/model` と `/scoped-models` は対話モードのスラッシュコマンド（`dist/modes/interactive/interactive-mode.js`、`dist/core/slash-commands.js`）。RPC は `set_model` の型付きコマンド（`dist/modes/rpc/rpc-mode.js:365`）。現行 spec は既に「対話端末でしか使えない操作」を区別している（`専用コマンドの表面の違いを文書に残す`）
- 推奨: 選択肢 1。RPC の set_model を知らずに使える利用者に届くため、設定編集の手順が最も実行可能性が高い

### [Q-7] 対応: R-7

- 問い: 一覧の行の説明に 3 系統の文言が乗るとき、順序と長さをどう決めますか。スコープ診断は行にも出しますか status 限定にしますか。
- 選択肢:
  1. 先頭 = 振り分け無効 + 現在のモデル、2 番目 = 失敗/警告、3 番目 = 応答モデルの仮定法。診断（スコープ）は status 限定 — 行は短いが、一覧からスコープ問題の解決に進めない
  2. 選択肢 1 に加え、スコープ診断も該当行（ロック行 / 対象行）に出す — 一覧で完結するが行が長くなる（既存の選択時のみ表示される領域）
  3. 失敗理由と警告内容を 1 文に統合し、off 記述を先頭に固定 — 文言生成規則の整理が必要（`設定時の警告は…` の MODIFIED が必要）
- 判断材料: 一覧の説明文は選択時のみ表示される（`src/commands/role-panel.ts`）。`MAIN_VISIBLE_ROWS = 12`（`src/commands/role-panel.ts:66`）で画面幅の制約あり。現行要件が行に「警告と同じ内容」を既に要求している（`openspec/specs/managed-commands/spec.md:451`）
- 推奨: 選択肢 1（行の長さを抑え、診断は status に寄せる）。一覧に診断を出すなら 7.3 の文書更新も必要になる

### [Q-8] 対応: R-8

- 問い: 「実行可能な手順」の文言生成を共有部品にしますか、3 か所で重複させますか。
- 選択肢:
  1. 共有の案内生成（commands 内）を警告・status・通知の 3 か所から呼ぶ — 一貫するが、通知が routing にある場合 Q-3 の駆動経路の選択に響く
  2. 3 か所で重複させる（design に理由を書く）— 層を跨ぐ共有を避けられる。文言が経路ごとにズレるリスク
  3. 警告と status だけ共有し、通知は短文の別文言にする — 通知の簡潔さと一貫性の中間
- 判断材料: 既存の警告生成は `src/commands/role.ts:349-366`。ARCH-DUP は 60 文字以上・10 行以上の関数本文が対象なので、小さな案内生成の重複は検査に上がらない（基数 0 のまま）
- 推奨: 選択肢 1 ただし配置は Q-3 の選択肢 1（commands 内）と組み合わせる

### [Q-9] 対応: R-9

- 問い: 振り分け有効・無効の判定（provider/id 比較）を唯一にしますか、既存の重複 2 本のままにしますか。
- 選択肢:
  1. `commands` 内の関数を export し、routing からは使わない（判定を使う面を commands に寄せる）— 継ぎ目なし。routing 側の既存比較（`src/routing/child.ts:72-74`）は残る
  2. 判定を shared（constants または新規 shared ファイル）に移し双方から読む — 「唯一の正」を満たす。shared に表示・挙動の語彙が増える（新ファイルなら `registry:layer-members` 編集）
  3. 重複を許容し、design Decision 5 の「唯一の正」の文言を実態に合わせる — 変更は最小。判定規則が変わる時に 2 か所直すべき箇所が残る
- 判断材料: 比較は 2 行で ARCH-DUP の対象外。既存 2 か所: `src/commands/register.ts:349-350`、`src/routing/child.ts:72-74`。routing は shared に依存できる（`registry:layers`）
- 推奨: 選択肢 2（constants 内の 1 関数）。Decision 5 の要求を満たしつつ新しい層境界を増やさない

## 観点チェック

指摘なし: A1、A2、A4、B1、B2、B3、B7（REMOVED なし）、B8（RENAMED なし）、B9（新規 capability なし・既存差分に Purpose なし）、B10（delta に内部名・型名・ライブラリ名の混入なし: `resolveRequestPlan` / `ExtensionContext` / `scopedModels` / `setStatus` いずれも 0 hits）、B11（他の active change なし）、B12（ADDED 3 要件は現行 spec に同名なし）、B13（全要件が削除される capability なし）、C1（9 Decision すべてに代替案）、C2、C3（Risks すべて Mitigation 付き。データ移行なし）、C4（Open Questions は本変更の specs/tasks を変えない）、D7、E1、F3（将来要求のみの抽象化なし）、F6（正本の本文複製なし）。

MODIFIED の Scenario 完全性（B6）は機械的に確認: managed-commands 5 要件で現行シナリオ 13 件すべて内包（欠落 0）、dual-model-routing 3 要件で現行 21 件すべて内包（欠落 0）、ヘッダ名は現行 spec と完全一致。

## 第 2 部 総評

- **Blocker**: R-1、R-2、R-3
- **要判断**: Q-1、Q-3、Q-4、Q-5、Q-6、Q-7、Q-8、Q-9
- **継ぎ目**: 7 件（N-1〜N-7）。うち人間の設計判断が必要なのは N-1 / N-2 / N-3 / N-5（Q-3）、N-6（Q-9）、N-7（Q-8）、N-4 は数値の判断（Q-4）と降格の扱い（R-12）
- **実装開始**: **NO**（Blocker 3 件。加えて要判断 8 件が未回答のため、Blocker 解消後も回答後に YES となる）
- 未確認事項:
  - `openspec validate --strict` は INFO を出さず、archive マージ衝突を示すメッセージも無かったため、**archive 時の衝突は未検証**（現行 spec との本文差分は手動照合済みで、MODIFIED のヘッダ・シナリオ欠落は 0 件）
  - 審査基準スキルの frontmatter の compatibility 表記が読み取り範囲になく、CLI **2.0.0** との対応関係を確認できていない
  - `model_select` の `source: "restore"` の発火箇所は dist 内で確認できず（design も未確認と明記）。Q-1 の選択には影響しないが、復帰経路の再描画を `session_start` に頼る前提は実測していない
  - 非対話経路で status 通知と手順案内が実際にどう出るかは未観測（R-6 の判断材料の一部は推定）
  - 実装は未着手（HEAD `fa269ce49`、src の差分 0）のため、本レビューは計画アーティファクトみの判定
