# Tasks

## 1. Pi core: `/clear`

- [x] 1.1 `packages/coding-agent/src/core/agent-session-runtime.ts` に `clearConversation()` を追加する(design Decision 6 の手順 1〜6)。`test/suite/agent-session-runtime.test.ts` の runtime 生成手順に倣い、`test/suite/agent-session-runtime-clear.test.ts` を新規作成する。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-runtime-clear.test.ts` で、次のケースが成功する。
  - "re-roots the branch and copies custom entries in order"
  - "keeps the runtime model and thinking level after reopen"(既定値に保存しないモデル選択)
  - "sends only the new user message after clear"(compaction エントリがある状態から始め、faux provider の factory で次の要求の messages を確認する)
  - "reports zero context usage after clear"
  - "keeps the session id and file and leaves the previous branch on disk"
  - "reopening the file restores the cleared branch"
  - "navigating to the previous leaf restores the old conversation"
  - "refuses while streaming and keeps queued messages"
  - "refuses while compacting"
  - "succeeds on a session without messages"
  - "keeps the same AgentSession and emits no session_start or session_shutdown"
- [x] 1.2 `interactive-mode.ts` に `/clear` の入力分岐と `handleClearContextCommand()` を追加する。既存の `handleClearCommand()`(`/new`)は変更しない。`slash-commands.ts` の `BUILTIN_SLASH_COMMANDS` に `clear` を追加する。`test/interactive-mode-clone-command.test.ts` と同じく prototype を呼ぶ形で、`test/interactive-mode-clear-command.test.ts` を新規作成する。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-mode-clear-command.test.ts` で、次のケースが成功する。
  - "clears the chat and shows a confirmation"
  - "shows the streaming warning and keeps the chat"
  - "shows the compaction warning and keeps the chat"
  - "lists clear in BUILTIN_SLASH_COMMANDS"
- [x] 1.3 リポジトリルートで `npm run check` を実行し、エラー・警告・info を 0 にする。検証: `npm run check` が終了コード 0

## 2. spirits: 型ミラーと設定

- [x] 2.1 型と実行時の解決を追加する。
  - `src/types/pi-coding-agent.d.ts` に `setWidget`(文字列配列と factory の 2 形式)、`WidgetPlacement`、`ExtensionWidgetOptions`、`SessionTreeEvent` と `on("session_tree", …)` を追加する。
  - `src/types/pi-tui.d.ts` に `truncateToWidth` を宣言し、`tsconfig.json` の `paths` に `@earendil-works/pi-tui` を追加する。
  - `src/todo/tsconfig.json`(ルート設定を継承)を作成する。

  検証: `cd packages/spirits && bun run check` が終了コード 0
- [x] 2.2 `src/constants.ts` に `DEFAULT_TODO_MAX_LINES = 5` と `ENV_TODO_MAX_LINES = "SPIRITS_TODO_MAX_LINES"` を、`src/config.ts` に `todo.maxLines` を追加する(既存の `readLimit` を使う)。`README.md` の環境変数表に 1 行追加する。検証:
  - `cd packages/spirits && bun test test/config.test.ts` の "todo max lines defaults to 5"、"todo max lines reads SPIRITS_TODO_MAX_LINES"、"todo max lines falls back on 0, abc, -1" が成功する
  - `rg -n "SPIRITS_TODO_MAX_LINES" packages/spirits/README.md` が 1 件一致する

## 3. spirits: TODO 状態とツール

- [x] 3.1 `src/todo/state.ts` を作成する(design Decision 1〜3)。ブランチからのスナップショットの解決と、操作列の適用(順次適用、全か無か、`nextId` による再利用しない採番、`updates[i]` 形式の位置と理由)を行う。verify2 W-2: `readSnapshot` は ID の重複と空白だけのテキストを含む記録も不正として無視する。検証: `cd packages/spirits && bun test test/todo-state.test.ts` で、次のケースが成功する。
  - "add assigns sequential ids from 1"
  - "deleted ids are not reused"
  - "update changes only the given text or done"
  - "later operations see earlier results in the same call"
  - "invalid call applies nothing"(存在しない ID、同じ呼び出しで削除済みの ID、空白だけの text、text も done も無い update、空の updates。それぞれ位置と理由を返す)
  - "resolves the latest snapshot on the branch"
  - "ignores malformed snapshots"(ID の重複、空白だけのテキストを含む記録を malformed に追加)
  - "resolves copied entries after a re-rooted branch"(`/clear` 後と同じ形のブランチ)
- [x] 3.2 `src/todo/tool.ts` に `manage_todos` を作成し、`src/index.ts` で登録する。
  - パラメータは TypeBox の `op` で判別する union にする。
  - `exposure: "direct"`、`executionMode: "sequential"` にする。
  - `promptSnippet` と `promptGuidelines` を設定する。
  - 成功時は `pi.appendEntry("spirits_todo", snapshot)` を 1 回呼ぶ。
  - 結果のテキストと `details` を返し、不正時は `isError` を返す。

  検証: `cd packages/spirits && bun test test/todo-tool.test.ts` で、次のケースが成功する。
  - "registers manage_todos as a direct sequential tool"
  - "spiritsExtension registers manage_todos"
  - "appends one snapshot per successful call"
  - "returns isError and appends nothing for an invalid call"
  - "result lists all items with ids"
  - "guidelines say ids are assigned by the tool"
- [x] 3.3 セッションファイル往復の結合テストを追加する(verify2 W-1)。`manage_todos` の成功が実際のセッションファイルへ追記され、再オープン後にブランチから状態が復元されてパネルに表示されること、末尾が不正な記録のとき直前の有効な状態へフォールバックすることを、実ファイル経由で確認する。検証: `cd packages/spirits && bun test test/todo-persistence.test.ts` で、次のケースが成功する。
  - "tool call persists to the session file and restores after reopen"
  - "restores the last valid snapshot when the latest record is malformed"

## 4. spirits: TODO パネル

- [x] 4.1 `src/todo/widget.ts` に描画関数を作成する(design Decision 5 の描画規則)。入力はスナップショット、N、幅で、出力は行。検証: `cd packages/spirits && bun test test/todo-widget.test.ts` で、次のケースが成功する。
  - "pending items first up to max lines"
  - "hidden pending and done counts share one line"
  - "all done renders a single line"
  - "no items renders nothing"
  - "lines are truncated to width"(全角文字を含む)
- [x] 4.2 widget の更新契機を実装する。
  - `manage_todos` の成功後に更新する。
  - `session_start` と `session_tree` のハンドラで再描画する。
  - `ctx.mode === "tui"` のときだけ描画する。
  - `placement: "belowEditor"` を指定する。

  検証: `cd packages/spirits && bun test test/todo-widget.test.ts` で、次のケースが成功する。
  - "successful tool call updates the widget"
  - "session_start renders the branch state for every reason"
  - "session_tree re-renders for the new leaf"
  - "empty branch clears the widget"
  - "uses the configured max lines"
  - "non-tui modes set no widget"
- [x] 4.3 spirits 全体を確認する。検証: `cd packages/spirits && bun run check && bun test` が終了コード 0

## 5. 対話 TUI での確認

- [x] 5.1 LLM を呼ばずに、tmux で TUI の表示を確認する。
  - 準備: 一時ディレクトリを `SPIRITS_CODING_AGENT_DIR` に指定する。セッションファイルを手で用意する。内容は、会話 2 往復と、未完了 7 件・完了 1 件の `spirits_todo`。
  - 起動: `bun packages/spirits/bin/spirits.ts --session <file>` を tmux(80x24)で起動する。
  - 確認する表示:
    - 起動直後: `tmux capture-pane -p` で、パネルがエディタとフッターの間にあり、項目行が 5 行と件数行 1 行であること。
    - `/clear` 入力後: チャット表示が完了メッセージだけになり、パネルが変わらないこと。フッターのコンテキスト使用量はモデルと認証の有無で表示が変わるので、ここでは確認せず 1.1 で確認する。
    - `/tree` で以前の末端を選んだ後: 会話が戻ること。

  検証: 各時点の `capture-pane` 出力に上記の内容が含まれる。

## Workflow follow-up

- Pi core の変更(タスク 1.1、1.2)は、`[spirits]` プレフィックス付きの独立コミットに分離する。
- アーカイブ前に `openspec validate add-session-todo-and-clear --strict` が成功することを確認する。
