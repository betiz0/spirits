# Proposal

## Why

TODO パネルは未完了項目を最大行数まで常時表示するため、項目が多いセッションではエディタ直下の領域を占有し続ける。進捗を確認したいときだけ開き、作業中は 1 行に畳んでおけるようにしたい。今のパネルには開閉の概念がなく、非表示にする唯一の方法は TODO を全件削除することだけである。

## What Changes

- 対話 TUI で、キー入力により TODO パネルを展開と折りたたみの間で切り替えられるようにする。既定キーは `ctrl+shift+l`。
- 折りたたみ時は項目行を出さず、未完了件数と完了件数だけを 1 行で表示する（例: `3 pending · 2 done`）。
- すべて完了しているときの折りたたみ表示は、展開時と同じ `✓ all done` の 1 行とする。TODO が 0 件のときは、折りたたみ状態でもパネルを表示しない。TODO が 0 件のときに開閉キーを押しても、開閉状態は変えない。
- 開閉状態は実行時にのみ保持し、セッション開始（startup / reload / new / resume / fork）で設定された既定へ戻す。既定は展開とし、spirits のグローバル設定ファイル（`<agentDir>/settings.json`。既定で `~/.spirits/agent/settings.json`）の `todo.startCollapsed` が `true` のときだけ折りたたみで開始する。
- 開閉キーは、設定ファイルの `todo.toggleKey`、環境変数 `SPIRITS_TODO_TOGGLE_KEY`、既定キーの順に決める。値が無いか構文として解釈できない候補は飛ばして次の候補を使う。構文は正しいが存在しないキー名はそのまま使い、そのキーでは開閉しない。
- 開閉キーが Pi の組み込みキーと衝突した場合は Pi の衝突規則に従う（予約キーなら開閉キーは登録されず Pi が警告する。予約外なら開閉キーが組み込みキーより優先される）。将来の Pi の更新で衝突した場合は、設定ファイルでキーを変更して回避する。
- 開閉の切り替え自体は TODO の保存状態を変更しない（セッションへ custom entry を追加しない）。
- `manage_todos` の成功時、パネルは現在の開閉状態を保ったまま新しい状態を表示する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `session-todo`: パネルの表示規則を展開時の規則として限定し、開閉操作・折りたたみサマリ・既定状態とキーの設定を追加する。

## Impact

- コード:
  - `packages/spirits/src/todo/widget.ts`（サマリ描画、開閉状態、ショートカット登録）
  - `packages/spirits/src/todo/tool.ts`（現在の開閉状態での更新）
  - `packages/spirits/src/config.ts` と `packages/spirits/src/constants.ts`（既定値、設定キー、環境変数、TODO 設定の解決）
  - `packages/spirits/src/index.ts`（ロード時の設定ファイル読み取り、共有状態の生成と受け渡し）。設定ファイルの読み取りは `packages/spirits/src/commands/settings-store.ts` の既存関数を再利用する
  - `packages/spirits/src/types/pi-coding-agent.d.ts`（Pi 拡張 API のローカル型ミラーに `registerShortcut` を追加）
- テスト: `packages/spirits/test/todo-widget.test.ts`、`config.test.ts`、`extension-degradation.test.ts`、`ExtensionAPI` を実装するテスト用フェイク（`test/routing/fake-pi.ts`、`test/todo-tool.test.ts`、`test/harness-install.test.ts` の `FakePi`。`registerShortcut` を追加）ほか関連テスト。
- API: 外部ツール `manage_todos` の入出力は変更しない。Pi 拡張向けの内部 API として開閉状態と描画関数が増える。
- 依存関係: 追加なし。
- 設定: グローバル設定ファイルに `todo.toggleKey`（文字列）と `todo.startCollapsed`（真偽値）、環境変数 `SPIRITS_TODO_TOGGLE_KEY` を追加する。既存の `SPIRITS_TODO_MAX_LINES` はそのまま。
- ドキュメント: `packages/spirits/README.md` の TODO 設定の表に、新しい設定 3 つ（決定順、構文、衝突時の扱い）を追記する。
- Pi 上流コアへの差分: なし。キーは Pi の keybindings テーブルではなく spirits 側の設定として扱い、`pi.registerShortcut` に渡す。
