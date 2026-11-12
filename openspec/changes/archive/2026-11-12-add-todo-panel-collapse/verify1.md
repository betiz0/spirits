# 検証レポート: add-todo-panel-collapse

検証日: 2026-11-11
スキーマ: `spec-driven`
変更ルート: `openspec/changes/add-todo-panel-collapse/`

## サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 12/12 タスク完了、要件 7 件（MODIFIED 1 / ADDED 6、REMOVED・RENAMED なし）を確認 |
| 正確性 | 7/7 要件をカバー（シナリオは 37 件中 34 件を実装・テストで確認、残り 3 件は証拠が限定的） |
| 一貫性 | 準拠（design の主要決定 6 件すべて一致、コメント整形の指摘 1 件） |

検証に使ったコマンド:

- `cd packages/spirits && bun run check` → 成功（`tsc --noEmit` のみ出力）
- `cd packages/spirits && bun test test/config.test.ts test/todo-widget.test.ts test/todo-tool.test.ts test/todo-persistence.test.ts test/extension-degradation.test.ts test/harness-install.test.ts` → 82 pass / 0 fail
- `rg -n "todo.toggleKey|SPIRITS_TODO_TOGGLE_KEY|todo.startCollapsed" packages/spirits/README.md` → 4 件（タスク 3.3 の 3 件以上を満たす）

## 完全性

### タスクの完了

- `taskTrackingConfigured: true`、`progress: 12/12`、`remaining: 0`。
- 未完了タスクなし。重大な問題なし。
- 手動確認タスク 4.2 / 4.3 はチェック済みで、コード側にも対応する実装（`session_start` でのリセット、`registerShortcut` へのキー委譲）がある。

### 仕様範囲

- 仕様差分: `specs/session-todo/spec.md`。
- MODIFIED 1 件: 「TODO パネルはエディタとフッターの間に表示される」。
- ADDED 6 件:
  - TODO パネルはキー入力で開閉できる
  - 開閉キーは設定ファイル、環境変数、既定値の順に決まる
  - 開閉キーは構文だけを検証する
  - 開閉キーと組み込みキーの衝突は Pi の規則に従う
  - 折りたたみ時は件数サマリだけを表示する
  - 開閉状態はセッション開始時に既定へ戻る
- REMOVED / RENAMED はなし。削除・改名の逆確認は対象外。

### 要件実装マッピング

| 要件 | 区分 | 実装 | 状態 |
|---|---|---|---|
| TODO パネルはエディタとフッターの間に表示される | MODIFIED | `packages/spirits/src/todo/widget.ts:61`（展開描画）、`widget.ts:149`（状態で描画選択） | 実装あり |
| TODO パネルはキー入力で開閉できる | ADDED | `widget.ts:133`（状態）、`widget.ts:232`（ショートカット）、`widget.ts:228`（`session_start` リセット） | 実装あり |
| 開閉キーは設定ファイル、環境変数、既定値の順に決まる | ADDED | `packages/spirits/src/config.ts:213`（`resolveTodoConfig`）、`packages/spirits/src/index.ts:168`（ロード時解決） | 実装あり |
| 開閉キーは構文だけを検証する | ADDED | `config.ts:196`（`TOGGLE_KEY_PATTERN`）、`config.ts:202`（正規化後に採用） | 実装あり |
| 開閉キーと組み込みキーの衝突は Pi の規則に従う | ADDED | `widget.ts:232` が解決済みキーを `pi.registerShortcut` に渡し、衝突判定は Pi の `getShortcuts` に委譲（`packages/coding-agent/src/core/extensions/runner.ts:674`）。型ミラーは上流と一致（`packages/coding-agent/src/core/extensions/types.ts:1655`） | 実装あり |
| 折りたたみ時は件数サマリだけを表示する | ADDED | `widget.ts:98`（`renderTodoSummaryLines`）、`widget.ts:43`（` pending` 接尾辞） | 実装あり |
| 開閉状態はセッション開始時に既定へ戻る | ADDED | `widget.ts:228`（`session_start` で `reset`）、`widget.ts:231`（`session_tree` はリセットせず再描画のみ） | 実装あり |

## 正確性

### 要件の実装

すべての ADDED / MODIFIED 要件に対応する実装がある。仕様と実装の食い違いは検出しなかった。

- 折りたたみサマリは `pending` の全件数を使い、展開時の `+N more` のような残数ではない（`widget.ts:98-112`）。仕様の「未完了は上限で割った残りではない」と一致。
- 全件完了時は既存の `✓ all done`、0 件時は空配列を返し、呼び出し側がウィジェットを消す（`widget.ts:100-104`, `widget.ts:165-168`）。
- 開閉キーの解決順は 設定ファイル → 環境変数 → 既定値。構文不一致・非文字列は次へ進む（`config.ts:213-222`）。
- 設定ファイル読み取りはロード時に 1 回だけ。例外は `{}` として扱い、TODO の登録を落とさない（`index.ts:72-80`, `index.ts:168`）。
- `startCollapsed` は真偽値 `true` のときだけ true（`config.ts:220`）。

### シナリオの対象範囲

- MODIFIED 9 シナリオ: 展開描画・上限・全完了・0 件・切り詰め・ツール成功後の更新・`/reload` 後の再表示を含め、既存テストと `session_start` の理由別テストでカバー（`packages/spirits/test/todo-widget.test.ts:180-290`）。
- ADDED の折りたたみ 5 シナリオ、開閉 4 シナリオ、開始状態 6 シナリオ: テストで直接カバー（`todo-widget.test.ts:342-500`, `packages/spirits/test/config.test.ts:86-149`）。
- キー決定の 8 シナリオ: 既定値・優先順・構文不正・全候補不正・読めない設定ファイルはテストでカバー（`config.test.ts:86-149`, `packages/spirits/test/extension-degradation.test.ts:239-262`）。
- 構文だけの検証 3 シナリオ: 記号の基底キー・大文字/空白・存在しないキー名の解決はテストでカバー（`config.test.ts:121-146`）。押下時の挙動は解決済みキー 1 つを登録する構造から導かれるが、個別の押下テストはない。
- 衝突 2 シナリオ: 予約キー `ctrl+l` はタスク 4.3 の手動確認と Pi の予約リスト（`runner.ts:97-115`）で裏付け。予約外キー `ctrl+]` は自動テストも手動確認タスクもなく、直接の証拠がない（下記警告）。

## 一貫性

### 設計の遵守

design の決定 6 件すべてと実装が一致する。

1. 状態はロード時に 1 つ生成し、ツールとパネルへ注入（`index.ts:168-171`, `widget.ts:133`）。
2. 折りたたみはスナップショットからの純粋関数（`widget.ts:98`）。
3. キーは設定 → 環境変数 → 既定値、構文のみ検証（`config.ts:196-222`, `constants.ts` の新規定数）。
4. `startCollapsed` は設定ファイルの真偽値 `true` のみ、リセットは `session_start` のみ（`widget.ts:226-231`）。
5. ショートカットは TUI かつ項目 1 件以上のときだけ状態を変える。0 件では何もしない（`widget.ts:232-244`）。
6. 設定ファイルは entry 層で 1 回読み、例外は空設定（`index.ts:72-80`）。

`ExtensionAPI.registerShortcut` のミラーは上流のシグネチャと一致し、`KeyId` のミラーも設計どおり `string` に広げられている（`packages/spirits/src/types/pi-coding-agent.d.ts:500`, `packages/spirits/src/types/pi-tui.d.ts:14`）。

### コードパターンの一貫性

- 新規定数は `constants.ts` に集約され、マジック文字列の直書きはない。
- テストは既存の `FakePi` / `makeToolContext` / `renderWidget` パターンを踏襲している。
- 唯一の逸脱は `index.ts` 冒頭コメントの整形（下記提案）。

## 優先度別の問題

### 重大

なし。

### 警告

1. **シナリオ「Pi の予約外の組み込みキーとの衝突」の証拠がない**
   `ctrl+]` が組み込みキーと衝突したとき、警告が出て開閉キーが優先されることを確認するテストも手動確認もない。タスク 4.3 は予約キー `ctrl+l` のみを対象にしている。実装は衝突判定を Pi に委譲しており（`widget.ts:232`, `runner.ts:674-707`）、コードの欠落ではない。
   - 推奨: `ctrl+]` を `todo.toggleKey` にして起動し、「警告が出る」「開閉キーが優先される」を手動確認する。あるいは、Pi の衝突規則に委譲する設計であることを tasks / design に明記して、このシナリオを Pi 側の責務として扱う。

### 提案

1. **`index.ts` 冒頭コメントの行頭が崩れている**
   `packages/spirits/src/index.ts:8-10` の 2 行目以降に ` * ` がなく、コメントブロックの整形が他と揃っていない。内容は正しい。
   - 推奨: 各続き行を ` * ` で始める。

2. **「設定ファイルでの変更」の逆方向を直接テストしていない**
   `ctrl+shift+k` が登録されることは確認済みだが、同じ実行で `ctrl+shift+l` を押しても切り替わらないことを直接検証していない。
   - 推奨: `registerTodoPanel` 後に `fireShortcut("ctrl+shift+l", ...)` を呼び、状態が変わらないことをテストする。

3. **`/reload` で設定変更が反映されるシナリオは自動テストがない**
   実装はロード時読み取りで正しく、`session_start` の `reload` 理由はテスト済み。設定ファイル書き換え後の再読み込み自体はタスク 4.2 の手動確認に依存している。
   - 推奨: 可能なら一時 agent dir の設定を書き換えて拡張を再ロードする結合テストを追加する。難しければ手動確認の記録を残す。

## 最終評価

重大な問題はありません。考慮すべき警告は 1 つ、提案は 3 つあります。アーカイブの準備ができています（改善点の指摘あり）。
