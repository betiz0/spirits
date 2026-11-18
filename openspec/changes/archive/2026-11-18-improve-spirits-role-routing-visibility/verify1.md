## 検証レポート: improve-spirits-role-routing-visibility

### サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 32/33 タスク完了（未完了 1 件: 10.4）、要件 16 件（ADDED 4 / MODIFIED 12） |
| 正確性 | 16/16 要件に実装の証拠、82/82 シナリオに実装とテストの証拠（53 + 29） |
| 一貫性 | 設計の決定 1〜10 に準拠。リスク欄の 1 記述だけ実装とずれ（警告） |

ストアは未使用（`openspec list --json` の `root.source` は `nearest`）。REMOVED / RENAMED 要件は無し。`unavailableTrackingFiles` は無く、スキップしたチェックはありません。

---

### 重大

1. **タスク 10.4 が未完了（実 TUI 観察と design への書き戻し）**
   - `openspec/changes/improve-spirits-role-routing-visibility/tasks.md:64`
   - 内容は `[off]` 表示、`/model` での復帰、10 秒カウントダウン付き確認、Esc 中止、`--resume` での badge を実 footer で観察し、確認待ち中の別入力・セッション切替の扱いを design の Open Questions に書き戻すこと。
   - これは design の Open Questions 第 2 項（`design.md:155`）とリスク欄（`design.md:147`）が「tasks 10.4 の実測で確かめる」と明記している未観測事項そのものです。コードとユニットテストは揃っていますが、ホストの実挙動（入力の直列化・待ち中のセッション切替）は証拠がありません。
   - 推奨: `scripts/tmux-verify.sh run` / `check` で 4 点を観察し、結果を `design.md` の Open Questions に反映したうえで 10.4 を完了にする。観察で待ち越えが起きるなら `stepStartDeclined`（`packages/spirits/src/commands/register.ts:441`）の待ち後の扱いを見直す。

---

### 警告

1. **確認の中止処理が design の Mitigation 文と一致しない**
   - `openspec/changes/.../design.md:147` は「待ちの後で位相を読み直してから戻し」と書きますが、実装は入力前スナップショットへ戻すだけです（`packages/spirits/src/routing/phase.ts:319` の `undoInput`、呼び出しは `packages/spirits/src/commands/register.ts:429`）。待ちの間に位相が別要因で動いた場合、スナップショット復元はその変化を上書きします。
   - 決定 7 の本文（`design.md:114`）はスナップショット復元を採用しており、リスク欄だけが別の運用を示しています。
   - 推奨: 10.4 の観察結果に合わせ、`design.md:147` の Mitigation を実装（スナップショット復元）に合わせて書き直すか、`undoInput` を「待ち後に現在の位相を読み直してから戻す」形に直す。どちらでも、決定 7 とリスク欄の文言を一致させる。

---

### 提案

1. **登録順（routing の `input` → commands の `input`）を名指しで固定するテストが無い**
   - 決定 2（`design.md:62`）とタスク 3.3 は「登録順を入れ替えると落ちるケース」を求めています。現状は確認系テスト（`test/routing-integration.test.ts:186` 以降）が full wiring 経由で暗黙に依存しているだけで、順序そのものを名指す表明がありません。
   - 推奨: `test/routing-integration.test.ts` に「commands の `input` が routing の後である」ことを 1 ケースで表明する（例: 開始直後の phase を読むハンドラ順の確認）。

2. **thinking レベルが変わらない操作での表示正しさを固定するテストが無い**
   - リスク欄（`design.md:141`）は「レベルが変わらない操作では描き直しが起きなくても表示は正しい」ことをテストで確認するとしていますが、`test/managed-commands.test.ts:202` は変化する場合のみです。
   - 推奨: `thinking_level_select` を発火させない（または同一レベルで発火させる）ケースで badge が変わらないことを 1 ケース追加。

3. **一覧の「保存対象がスコープ外」記述と spec の「スコープの診断は一覧に出さない」の関係が読み取りにくい**
   - `packages/spirits/src/commands/role-panel.ts:542` は保存済み対象がセッションのスコープ外であることを行の説明に出します。spec の禁止は振り分け用モデルのスコープ診断と有効化操作（`specs/managed-commands/spec.md:255`）を指すと読めますが、文言が近く誤読を招きます。
   - 推奨: spec 側か role-panel のコメントに「保存対象がセッションのスコープ外である事実は許可される」と一行補う。

---

### 参照した証拠

- 要件の実装: `packages/spirits/src/commands/role.ts:611`（`roleBadgeState`）、`:672`（`roleBadgeLines`）、`:641`（`roleModelDisplay`）、`packages/spirits/src/commands/register.ts:230`（`drawBadge`）、`:391`/`:395`（`model_select` / `thinking_level_select`）、`:403`（`session_start` の復元）、`:441`（`stepStartDeclined`）、`packages/spirits/src/routing/phase.ts:178`（`restoredStepEntry`）、`:319`（`undoInput`）、`packages/spirits/src/commands/role-panel.ts:368`（lead と仮定法）、`packages/spirits/src/constants.ts`（key・語彙・桁・待ち時間）。
- シナリオの証拠: `test/managed-commands.test.ts`（badge 語彙・24 文字境界・off/none・model/thinking 切替・長い ID）、`test/managed-role-panel.test.ts`（lead・仮定法・1 度だけ・スコープ・ロック保存失敗・一覧/badge/report の一致）、`test/managed-role-status.test.ts`（セッションのモデル・4 状態の案内）、`test/managed-role-warning.test.ts`（警告の 1 行・実行可能な手順・strong 半のみ）、`test/routing-integration.test.ts`（確認 11 件・再描画・手編集の reload 境界）、`test/routing-phase.test.ts`（`undoInput` 4 件）、`test/routing-phase-reload.test.ts`（復帰・再読み込み・分岐移動・新規セッション）、`test/extension-degradation.test.ts`（key 片方の書込み失敗）。
- 検証コマンド: `bun run check` 報告 0 件、`bun test` 1332 pass / 0 fail、`bash scripts/test-clean-env.sh` 125 pass / 0 fail、`openspec validate … --strict` 有効。

---

### 最終評価

**1 個の重大な問題が見つかりました。アーカイブする前に修正してください。**（タスク 10.4 の実 TUI 観察と design への書き戻し）。加えて警告 1 件、提案 3 件があります。
