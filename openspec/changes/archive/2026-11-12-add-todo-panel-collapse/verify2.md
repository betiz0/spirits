## Deep Verification Report: add-todo-panel-collapse

- 検証日: 2026-11-12
- 検証対象: `bef1458cf`..`bef1458cf`（未コミット変更: あり）。ブランチ上の 36 コミットはすべて archive 済みの別 change で、この change の差分は未コミットの 16 ファイルだけのため、`git merge-base HEAD main`（`3c3962f97`）ではなく HEAD を基点とした
- テストコマンド: `cd packages/spirits && bun run check && bun test`
- verify1 レポート: `openspec/changes/add-todo-panel-collapse/verify1.md`
- モード: 通常

### 判定
PASS WITH WARNINGS

### 集計
| 観点 | 結果 |
|---|---|
| テスト | 成功 1118 / 失敗 0（`tsc --noEmit` 成功。skip / only の追加、テスト・アサーションの削除なし） |
| 要件 | 意図どおり 7 / 全 7 |
| シナリオ | 挙動を確認 37 / 全 37、テストが実質的 34 / 全 37 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| タスク | 完了 12 / 全 12（全タスクで実装を確認） |

テストが実質的でない 3 件は、「Pi の予約キーとの衝突」（手動確認のみ）、「Pi の予約外の組み込みキーとの衝突」（W-1）、「設定の変更は `/reload` で反映される」（W-2）。

Pi 側の前提は、fork（`packages/coding-agent` 1.1.0）と managed Pi 1.5.0 のバイナリの両方で同じ実装であることを確認した。

- `registerShortcut` は登録時にキー名を検証しない（`ctrl+foo` で読み込みは失敗しない）
- `ctrl+l` は予約キー（`app.model.select`）、`ctrl+]` は予約外（`tui.editor.jumpForward`）
- 衝突判定は小文字化したキー文字列の一致
- `matchesKey` は未知のキー名に false を返し、`alt+,` は `SYMBOL_KEYS` で照合される
- `/reload` とセッション置換の前に `resetExtensionUI()` が `onExtensionShortcut` を `undefined` に戻し、その後 `setupExtensionShortcuts` で新しいランタイムのショートカットを張る

### 指摘

#### CRITICAL
なし

#### WARNING
- **[W-1] シナリオ「Pi の予約外の組み込みキーとの衝突」に自動テストも手動確認タスクもない**
  - 場所: `openspec/changes/add-todo-panel-collapse/tasks.md:25`、`packages/spirits/src/todo/widget.ts:232`
  - 根拠: タスク 4.3 は `ctrl+l` だけを対象にしている。挙動は TUI 再現で spec どおり（警告が出て、開閉キーが優先され、文字ジャンプは始まらない）と確認したが、成果物に確認の記録が残らない
  - 修正先: tasks
  - 推奨: tasks 4.3 に `todo.toggleKey` を `ctrl+]` にした確認を加え、結果を記録する
- **[W-2] シナリオ「設定の変更は `/reload` で反映される」に直接のテストがない**
  - 場所: `packages/spirits/test/extension-degradation.test.ts:57`
  - 根拠: 読み込み時に設定ファイルを読むことはテスト済み。一方、読み込み後に設定ファイルを書き換えても登録済みのキーが変わらないこと、読み直すと新しいキーで登録されることを確かめるテストがない。タスク 4.2 の手動確認は開閉状態のリセットだけを見ている。挙動はコードと TUI 再現で正しいと確認した
  - 修正先: 実装（テスト）
  - 推奨: 同じ一時 agent dir で 1 回目を読み込み、`settings.json` の `todo.toggleKey` を書き換え、1 回目の `pi.shortcuts` が変わらないことを assert してから 2 回目を読み込み（`/reload` は factory を呼び直す）、2 回目の `pi.shortcuts` が新しいキーであることを assert する

#### SPEC
なし

#### SUGGESTION
- **[G-1] テスト用の一時ディレクトリが削除されない**
  - 場所: `packages/spirits/test/extension-degradation.test.ts:58`
  - 根拠: `mkdtemp` で作った agent dir を削除していない。検証時点で `/tmp/spirits-todo-settings-*` が 18 個残っていた
  - 推奨: `loadWithSettingsFile` が `agentDir` も返し、各テストの `finally` で `rm(agentDir, { recursive: true, force: true })` を呼ぶ
- **[G-2] 「session_start で既定へ戻る」の後半は前提と期待結果が同じ状態**
  - 場所: `packages/spirits/test/todo-widget.test.ts:360`
  - 根拠: 後半は `toggle()` で先に折りたたんでから `session_start` を発火するため、後半だけではリセットが無くても通る。前半と合わせれば誤りは検出できる
  - 推奨: `collapsedState.toggle()` を削除し、展開状態から `startCollapsed: true` のリセットで折りたたまれることを確認する
- **[G-3] 修飾キー無しの印字可能キーも開閉キーとして受け付ける**
  - 場所: `packages/spirits/src/config.ts:196`
  - 根拠: spec どおり修飾キー 0 個も受け付けるため `toggleKey: "l"` が採用される。Pi は拡張ショートカットを文字入力より先に判定する（`custom-editor.ts` の `handleInput` 冒頭）ので、エディタで `l` を入力できなくなる
  - 推奨: README の構文説明にこの影響を書く。または、修飾キーの無い 1 文字キーを構文不正とするよう spec を改める
- **[G-4] JSDoc の続き行に ` * ` が無い**
  - 場所: `packages/spirits/src/index.ts:9-10`
  - 推奨: 2 行とも ` * ` で始める
- **[G-5] 手動確認の結果が成果物に残っていない**
  - 場所: `openspec/changes/add-todo-panel-collapse/tasks.md:24-25`
  - 根拠: 実行記録（`/run/user/1000/spirits-verify/records/todo42-*.env`、`todo43-*.env`）はあるが、確認結果が無い
  - 推奨: 結果を change ディレクトリに記録する

### verify1 との突き合わせ
- verify1 だけが指摘した項目
  - 提案 2（旧キー `ctrl+shift+l` で切り替わらないことの直接テストが無い）: 不採用。`todo-widget.test.ts` の「設定されたキーでショートカットを登録する」が登録キーの一覧と `["ctrl+shift+k"]` の完全一致を確かめており、`ctrl+shift+l` が登録されないことは検証済み
- verify2 だけが指摘した項目
  - G-1: verify1 はテストを実行しただけで、実行後の副作用を見ていない
  - G-2: verify1 はテストの存在だけを確認し、アサーションが何を区別できるかを見ていない
  - G-3: verify1 は正規表現と spec を照合しただけで、Pi の入力処理の順序を追っていない
  - G-5: verify1 はチェックボックスと実装の存在から手動確認を完了と判断した
- 重大度が食い違う項目
  - verify1 の提案 3（`/reload` での反映にテストが無い）は W-2 に上げる。このスキルの基準で「シナリオに対応するテストがない」は WARNING
  - verify1 の警告 1 は W-1 と同じ。挙動は TUI 再現で正しいと確認した

検証中に「`/reload` で予約キーへ変えると古いショートカットのハンドラが残る」破綻経路を疑ったが、Pi が `resetExtensionUI()` でフックを外すため起こらない。TUI でも旧キーが反応しないことを確認し、取り下げた。

### TUI 再現の記録

- 実施日: 2026-11-12
- 対象: `bef1458cf` + working tree（未コミットの `add-todo-panel-collapse` 変更）
- ソース起動: `bun /home/betiz/project/spirits/packages/spirits/bin/spirits.ts --session-dir <tmp>/sess --session <tmp>/sess/<file>.jsonl`
- 環境: `SPIRITS_CODING_AGENT_DIR=<tmp>/agent`（`~/.spirits` は変更していない）、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j`。`scripts/tmux-verify.sh run --session v2r42` で起動し、終了後の `scripts/tmux-verify.sh check --session v2r42-bbd9a302` は `clean`
- セッション: 未完了 3 件（#1〜#3）と完了 2 件の TODO スナップショットを `test/pi-runtime/session-manager.ts` で事前に書き込んだ
- キー入力: `ctrl+shift+j` は `\e[106;6u`、`ctrl+shift+k` は `\e[107;6u`、`alt+,` は `\e,`、`ctrl+]` は `\x1d` を `tmux send-keys -l` で送った。`ctrl+l` は `tmux send-keys C-l`

| # | 設定 | 操作 | 結果 |
|---|---|---|---|
| 1 | `{"todo":{"toggleKey":"ctrl+shift+k","startCollapsed":true}}` | 起動 | 成功。パネルは `3 pending · 2 done` の 1 行 |
| 2 | 同上 | `ctrl+shift+j` | 成功。`3 pending · 2 done` のまま |
| 3 | 同上 | `ctrl+shift+k` | 成功。`○ #1 alpha task` `○ #2 beta task` `○ #3 gamma task` `2 done` に展開 |
| 4 | 同上 | `ctrl+shift+k` | 成功。`3 pending · 2 done` に戻る |
| 5 | 同上 | `ctrl+shift+k` で展開してから `/reload` | 成功。`3 pending · 2 done` に戻る |
| 6 | `{"todo":{"toggleKey":"ctrl+l","startCollapsed":true}}` に書き換え | `/reload` | `[Extension issues]` に `Extension shortcut 'ctrl+l' from builtin:spirits conflicts with built-in shortcut. Skipping.` |
| 7 | 同上 | 旧キー `ctrl+shift+k` | 成功。切り替わらない |
| 8 | 同上 | `ctrl+l` | 成功。モデル選択が開き、Escape 後もパネルは `3 pending · 2 done` |
| 9 | `{"todo":{"toggleKey":"ctrl+]"}}` に書き換え | `/reload` | `Extension shortcut conflict: 'ctrl+]' is built-in shortcut for ...` の警告。パネルは展開 |
| 10 | 同上 | `ctrl+]` の後に `x` | 成功。`3 pending · 2 done` に切り替わり、`x` はエディタに入った（文字ジャンプは始まらない） |
| 11 | `{"todo":{"toggleKey":"alt+,"}}` に書き換え | `/reload` の後に `alt+,` | 成功。展開から `3 pending · 2 done` に切り替わる |

1〜5 はタスク 4.2 の確認項目にあたる。6〜11 は `/reload` で読み直した結果で、タスク 4.3 が求める「起動時」の警告は確かめていない。
