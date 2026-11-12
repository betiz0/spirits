# TUI スモーク記録(タスク 4.2 / 4.3)

- 実施日: 2026-11-12
- 対象: `bef1458cf` + working tree(未コミット)。この change の差分は未コミットで、HEAD には本変更の実装が含まれない
- 実装の検証状態: `cd packages/spirits && bun run check` 成功(`tsc --noEmit`)、`bun test` 1119 pass / 0 fail
- 実行手段: `scripts/tmux-verify.sh run`(`.pi/skills/interactive-testing.md` の手順)。各ケースの終了後に `scripts/tmux-verify.sh check --session <name>` を実行し、3 ケースとも `clean`
- 設定はすべて一時 agent dir(`<work>/agent/settings.json`)に置き、`~/.spirits` の設定は変更していない
- セッション: `SessionManager.create` で作っていないセッションファイルに `spirits_todo` を 1 件書き込み、未完了 3 件(#1 alpha task、#2 beta task、#3 gamma task)と完了 2 件(#4、#5)の状態にした
- 環境変数: `SPIRITS_CODING_AGENT_DIR=<work>/agent`、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j`
- 起動コマンド:

  ```
  bun packages/spirits/bin/spirits.ts --session-dir <work>/sess --session <work>/sess/<file>.jsonl
  ```

- 起動直後に「Trust project folder?」のダイアログが出るため、`Down Down Enter`(Trust (this session only))で消してから操作した
- 端末が kitty keyboard protocol を交渉しない(tmux の extended-keys が off)ため、`tmux send-keys -t "=$S:" -H 1b 5b 3f 37 75`(`ESC [ ? 7 u`)を 1 回注入して kitty を有効化してから `ctrl+shift+<letter>` を送った。`ctrl+shift+j` は `ESC [ 106 ; 6 u`、`ctrl+shift+k` は `ESC [ 107 ; 6 u`。`ctrl+l` は `tmux send-keys C-l`、`ctrl+]` は `-H 1d`(レガシーの制御文字)で送った

## 4.2 `toggleKey: ctrl+shift+k` + `startCollapsed: true`、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j`

`{"todo":{"toggleKey":"ctrl+shift+k","startCollapsed":true}}`。tmux セッション `todo42-a6184433`。
verify2.md の「TUI 再現の記録」1〜5 の転記ではなく、working tree で再実行した結果。

操作は上の表の順に送った(`ctrl+shift+<letter>` は kitty 注入後)。

| # | 操作 | 結果 | 抜粋 |
|---|---|---|---|
| 1 | 起動 | 成功。1 行サマリで開始 | `3 pending · 2 done` |
| 2 | `ctrl+shift+k`(設定ファイルのキー) | 成功。展開される | `○ #1 alpha task` / `○ #2 beta task` / `○ #3 gamma task` / `2 done` |
| 3 | `ctrl+shift+j`(環境変数のキー) | 成功。切り替わらず展開のまま | `○ #1 alpha task` / `○ #2 beta task` / `○ #3 gamma task` / `2 done` |
| 4 | `ctrl+shift+k` | 成功。折りたためる | `3 pending · 2 done` |
| 5 | `ctrl+shift+k` | 成功。展開される | `○ #1 alpha task` / `○ #2 beta task` / `○ #3 gamma task` / `2 done` |
| 6 | `/reload` | 成功。既定(折りたたみ)へ戻る | ` Reloaded keybindings, extensions, skills, prompts, themes, and context files` / `3 pending · 2 done` |

## 4.3-1 `toggleKey: ctrl+l`(Pi の予約キーとの衝突)

`{"todo":{"toggleKey":"ctrl+l","startCollapsed":true}}`。tmux セッション `todo43l-d5bd58f3`。
`/reload` ではなく起動時の確認。

| # | 操作 | 結果 | 抜粋 |
|---|---|---|---|
| 1 | 起動 | 成功。衝突の警告が表示され、パネルは 1 行サマリ | `[Extension issues]` / `  builtin:spirits` / `    Extension shortcut 'ctrl+l' from builtin:spirits conflicts with built-in` / `shortcut. Skipping.` / `3 pending · 2 done` |
| 2 | `ctrl+l` | 成功。モデル選択が開く | `Only showing models from configured providers. Use /login to add providers.` / `→ ✓ moonshotai/kimi-k2.6 [openrouter]` / `(1/705)` |
| 3 | `Escape` | 成功。パネルは切り替わっていない | `3 pending · 2 done` |
| 4 | `ctrl+l` をもう一度 → `Escape` | 成功。再びモデル選択が開き、パネルは `3 pending · 2 done` のまま | 2 と同じ |

## 4.3-2 `toggleKey: ctrl+]`(予約外の組み込みキーとの衝突)

`{"todo":{"toggleKey":"ctrl+]","startCollapsed":true}}`。tmux セッション `todo43r-33015232`。
`/reload` ではなく起動時の確認。

| # | 操作 | 結果 | 抜粋 |
|---|---|---|---|
| 1 | 起動 | 成功。衝突の警告が表示され、開閉キーが優先されると示される | `[Extension issues]` / `  builtin:spirits` / `    Extension shortcut conflict: 'ctrl+]' is built-in shortcut for` / `tui.editor.jumpForward and builtin:spirits. Using builtin:spirits.` / `3 pending · 2 done` |
| 2 | `ctrl+]` | 成功。パネルが展開される | `○ #1 alpha task` / `○ #2 beta task` / `○ #3 gamma task` / `2 done` |
| 3 | `xyz7` を入力 | 成功。エディタの文字ジャンプは始まらず、文字がエディタに入った | `xyz7`(エディタ行)/ 続く項目行はそのまま |
| 4 | `ctrl+]` | 成功。折りたためる | `xyz7` / `3 pending · 2 done` |
