# Design

## Context

TODO パネルの表示は `packages/spirits/src/todo/widget.ts` の `updateTodoPanel` と `refreshTodoPanel` が担い、状態は `sessionManager.getBranch()` から毎回復元する。パネルの再描画経路は現在 3 つある。

- `session_start`（`registerTodoPanel`）
- `session_tree`（`registerTodoPanel`）
- `manage_todos` の成功時（`createManageTodosTool`）

この変更で、開閉キーのハンドラが 4 つ目の経路になる。

ツール登録とパネル登録は別関数で、共有しているのは各関数が個別に呼ぶ `loadConfig(process.env).todo` の値だけである。開閉状態をどちらからも読める場所に置く必要がある。

Pi 拡張 API について、この設計が前提にする事実は次のとおり（いずれもコードで確認済み）。

- 拡張は解決済みのアプリキーバインドを読めない（`ExtensionContext` は `KeybindingsManager` を公開しない）。
- ショートカットは `pi.registerShortcut(shortcut: KeyId, { description?, handler })` で登録する。`KeyId` は pi-tui のテンプレートリテラル型で、設定から読んだ文字列は検証後に `KeyId` として渡す。
- 登録したショートカットは `setupExtensionShortcuts` が拾い、`CustomEditor.handleInput` の先頭で `matchesKey` により発火する。したがって発火はエディタにフォーカスがあるときだけである。
- `pi.getSettings()` は拡張の読み込み中に呼ぶと例外を投げる（`loader.ts` の `notInitialized`）。開閉キーは読み込み時に決まっている必要があるため、`getSettings()` では読めない。
- Pi は拡張ショートカットと組み込みキーの衝突を `runner.ts` の `getShortcuts` で判定する。予約キーと衝突したショートカットは警告付きで登録されず、予約外の組み込みキーとの衝突は警告付きで拡張側が優先される。
- spirits は Pi の型を直接参照せず、`src/types/pi-coding-agent.d.ts` のローカルミラーで型検査する。ミラーには現在 `registerShortcut` が無い。

保存済みスナップショットの形 `{ nextId, items: [{ id, text, done }] }` と `manage_todos` の入出力は、この変更で変えない。

docs/spirits-design.md と docs/spirits-m*.md には本変更に対応する記述が無い（フェーズ外の独立 capability `session-todo` の変更）。

## Goals / Non-Goals

**Goals:**

- 開閉状態を 4 つの再描画経路すべてで一貫して適用する。
- 折りたたみ表示を保存状態から独立した純粋な描画として実装する。
- 開閉キーと初期状態を spirits の設定（グローバル settings.json。開閉キーは環境変数でも指定可）に載せる。

**Non-Goals:**

- TODO のデータモデル変更（階層化、読み取り専用 op の追加）。
- 開閉状態のセッションへの永続化（ブランチごとの復元）。
- Pi 上流コアのキーバインドテーブルへの追加。
- 開閉用のスラッシュコマンド追加（設計上の代替手段としては記録する）。
- プロジェクト設定からの開閉キー・初期状態の読み取り。
- 実行中の設定変更の即時反映（`/reload` で反映する）。

## Decisions

### Decision 1: 開閉状態は拡張ロード時に 1 つ生成し、ツールとパネルへ注入する

`createTodoPanelState(startCollapsed)` が返す小さな状態オブジェクト（`collapsed()`、`toggle()`、`reset(startCollapsed)`）を `index.ts` で 1 つ作る。`index.ts` は解決済みの TODO 設定と状態を、`registerManageTodos` と `registerTodoPanel` の両方へ渡す。両関数は自分で `loadConfig` を呼ばない。

- 代替案: `widget.ts` のモジュール変数。実装は最短だが、テスト間で状態が漏れ、どちらの `register` が先に走るかに暗黙に依存する。
- 代替案: セッション custom entry に開閉状態を保存。resume や `/tree` で復元できるが、UI 操作のたびにセッションへ書き込みが増え、要件の「セッション開始時に既定へ戻す」と矛盾する。
- 採用理由: 状態と設定の所有者が 1 つに定まり、登録順に依存せず、テストが状態を明示的に作れる。`session_start` で `reset()` を呼べばライフサイクルも 1 か所で説明できる。

### Decision 2: 折りたたみ描画はスナップショットからの純粋関数にする

`renderTodoSummaryLines(snapshot, width)` を追加し、既存の `renderTodoLines` は展開時専用として残す。`done` の接尾辞、区切り、`all done` の文言は既存の定数（`MESSAGE_DONE_SUFFIX`、`MESSAGE_COUNT_SEPARATOR`、`MESSAGE_ALL_DONE`）を共有し、`pending` の接尾辞は新しい定数として追加する。

- 代替案: 展開用の行を生成して先頭 1 行だけ出す。件数行の組み立て規則（`+N more` など）が折りたたみの意味と合わず、隠れた未完了件数と総未完了件数が混ざる。
- 代替案: 折りたたみ用サマリを別途保存する。保存状態と表示が二重管理になり、`manage_todos` 成功時の更新漏れが起きる。
- 採用理由: 表示は常に現在のスナップショットから導出され、`manage_todos` 成功時に何も足さなくても正しいサマリになる。

### Decision 3: 開閉キーは spirits の設定で持つ（設定ファイル → 環境変数 → 既定値）

`constants.ts` に次を追加する。

- `DEFAULT_TODO_TOGGLE_KEY = "ctrl+shift+l"`、`ENV_TODO_TOGGLE_KEY = "SPIRITS_TODO_TOGGLE_KEY"`
- 設定キー `SETTINGS_KEY_TODO = "todo"`、`SETTINGS_KEY_TODO_TOGGLE_KEY = "toggleKey"`、`SETTINGS_KEY_TODO_START_COLLAPSED = "startCollapsed"`

`config.ts` に純粋関数 `resolveTodoConfig(env, settings)` を追加する。`settings` は形の分からない値として受け取る（`readStrongModelSetting` と同じ扱い）。返す `TodoConfig` は `maxLines`、`toggleKey`、`startCollapsed` を持つ。`toggleKey` は設定ファイルの `todo.toggleKey`、環境変数、既定値の順に、最初に採用できた値とする。

値の検証は、前後の空白を除いて小文字化したうえで、次の構文に一致するときだけ採用する。

- 修飾キー `ctrl` `shift` `alt` `super` を 0 個以上、それぞれ `+` を付けて並べる
- 基底キーは英数字の並び、または `+` と空白を除く ASCII 記号 1 文字
- 正規表現で表すと `` ^(?:(?:ctrl|shift|alt|super)\+)*(?:[a-z0-9]+|[!-*,-/:-@[-`{-~])$ ``（記号の文字クラスは `+` を除く 0x21〜0x2F、0x3A〜0x40、0x5B〜0x60、0x7B〜0x7E）

一致しない値、文字列でない値は未設定として扱い、次の候補へ進む。`+` を基底キーから除くのは、Pi の `parseKeyId` が `+` で分割するため `ctrl++` を解釈できないからである。基底キー名の実在は検証しない。pi-tui はキー一覧を実行時に公開しておらず（`SymbolKey` などは型だけ）、spirits 側に一覧を持つと二重管理になるためである。構文は正しいが未知のキーはそのまま登録し、発火しないキーとして扱う。

組み込みキーとの衝突は spirits 側では判定せず、Pi の `getShortcuts` の規則に任せる。

- 代替案: Pi コアの `KEYBINDINGS` に `app.todo.toggle` を追加。ユーザーが `keybindings.json` で再割り当てできるが、上流コアへの差分が増え、拡張側は解決済みキーを読めないため既定値を二重に持つことになる。AGENTS.md の「`DEFAULT_APP_KEYBINDINGS` に既定値を置く」規則は Pi コアのキーを対象とする。spirits は Pi コアを原則変更しない（config.yaml の Hard rules）ため、同じ目的（キーをハードコードせず設定可能にする）を spirits の設定で満たす。
- 代替案: `session_start` で `pi.getSettings()` を読み、その時点で `registerShortcut` する。プロジェクト設定を含むマージ済みの設定を読めるが、Pi が `session_start` の後に `setupExtensionShortcuts` を呼ぶという公開されていない順序に依存する。また `session_start` のたびに登録が重なる。
- 代替案: `widget.ts` にキー文字列を直書き。設定できず、変更には再ビルドが必要になる。
- 採用理由: Pi コア差分ゼロで、キーが読み込み時に確定する。ユーザーは設定ファイルで永続的に変更でき、環境変数で一時的に試せる。設定ファイルを環境変数より優先するのは、永続設定を正とする利用者の決定による。

### Decision 4: 初期状態は設定ファイル、リセットは `session_start` のみ

`todo.startCollapsed` は、設定ファイルの値が真偽値 `true` のときだけ true とし、それ以外（文字列 `"true"`、数値、未設定、読めない設定ファイル）は false とする。環境変数は設けない。`registerTodoPanel` の `session_start` ハンドラが最初に `state.reset(config.startCollapsed)` を呼び、その後に再描画する。`session_tree` ハンドラは再描画だけを行う。

- 代替案: 環境変数 `SPIRITS_TODO_START_COLLAPSED=1`。設定の経路がキー（設定ファイル）と初期状態（環境変数）に分かれる。
- 代替案: `/tree` でも既定へ戻す。ユーザーが畳んだ直後にブランチ移動だけで開いてしまい、要件の「ブランチ移動では開閉状態を変えない」に反する。
- 採用理由: TODO パネルの UI 設定が 1 つの設定ファイルに揃い、状態の変化点が「セッション開始」と「キー入力」の 2 つに限定される。

### Decision 5: ショートカットは TUI で、項目があるときだけ状態を変える

ハンドラは `ctx.mode !== "tui"` なら何もしない。TUI では現在のブランチからスナップショットを解決し、項目が 0 件なら状態を変えずに戻る。1 件以上なら `toggle()` して再描画する。`updateTodoPanel` の既存のモード判定もそのまま使う。print / RPC ではエディタが無く、ショートカットは発火しない。

- 代替案: 登録自体を `ctx.mode` で分岐。`registerShortcut` はロード時にしか呼べず、モードはセッション開始時に確定するため分岐できない。
- 代替案: 0 件でも状態を反転する。パネルが見えないまま状態が変わり、次に項目が現れたときに予期しない開閉状態で表示される。
- 採用理由: 登録は常に行い、実行時に無視する方が単純で、モードごとの登録漏れも起きない。0 件で何もしないことで、表示と状態がずれない。

### Decision 6: グローバル設定ファイルは `index.ts` がロード時に 1 回読む

`index.ts` は読み込み時に `readSettingsFile(globalSettingsPath())`（`commands/settings-store.ts`）を呼び、例外（JSON として解釈できない、オブジェクトでない、読み取り失敗）は空の設定 `{}` として扱う。結果を `resolveTodoConfig(process.env, settings)` に渡す。TODO はロードを失敗させてよいコア層だが、設定ファイルの破損で TODO 全体と同じ拡張の他の登録を失わないことを優先する。

- 代替案: `config.ts` に独自の読み取りを書く。パスの解決と BOM 除去を `settings-store.ts` と二重に持つ。
- 代替案: `todo` 層で読む。convention-registry の層規則で `todo` 層は `commands` 層を import できない。
- 採用理由: entry 層は `commands` 層を import でき、既存の読み取り関数（Pi と同じパス解決）をそのまま使える。

## Risks / Trade-offs

- [Risk] 既定キー `ctrl+shift+l` が端末側の既定の割り当てに消費され、pi に届かない。kitty の `kitty_mod+l`（next_layout）と WezTerm の `CTRL+SHIFT+L`（ShowDebugOverlay）がこのキーを使う（未検証の推定）。→ Mitigation: 設定ファイルの `todo.toggleKey`（または環境変数）で到達するキーへ変更する。README に例を載せる。既定値は維持する（利用者の決定）。
- [Risk] kitty keyboard protocol / modifyOtherKeys が交渉されない端末では、`ctrl+shift+<letter>` が `ctrl+<letter>` と区別されない（`matchesKey` は ctrl+shift の組み合わせを拡張シーケンスでしか判定しない）。→ Mitigation: Pi の既存ネゴシエーションに依存し、この変更では入力層を触らない。届かない場合は上記の設定で代替キーを指定する。legacy の `ctrl+l` は誤って開閉キーとして一致しないため、モデル選択は奪われない。
- [Risk] 構文は修飾キー 0 個も受け付けるため、修飾キーの無い 1 文字キー（例 `l`）を設定すると、エディタでその文字を入力できなくなる。Pi は拡張ショートカットを `CustomEditor.handleInput` の先頭で文字入力より先に判定する（深い検証 verify2 G-3）→ Mitigation: 構文は変えず、ユーザーの明示指定として採用する（存在しないキー名と同じ扱い）。README の構文説明にこの影響を記載する。代替案として修飾キーの無い 1 文字キーを構文不正とする方法があるが、`space` などの名前付きキーとの線引きが spec に増えるため採らない。
- [Risk] 折りたたみにより「次に何をすべきか」が見えなくなる → Mitigation: 既定は展開のまま。折りたたみ時も件数は残り、未完了があれば 0 件にはならない。
- [Risk] 構文は正しいが存在しないキー名を設定すると、ショートカットが黙って発火しない → Mitigation: 既定値へは戻さない（ユーザーの明示指定を尊重）。README に構文と例を載せる。影響は開閉操作だけに閉じる。
- [Risk] 開閉キーが Pi の予約キーと衝突すると開閉キーが無くなり、予約外の組み込みキーと衝突するとその組み込み操作が使えなくなる → Mitigation: Pi が起動時に警告を表示する。設定ファイルでキーを変更する。Pi の衝突判定は小文字化した文字列の一致で行うため、修飾キーの順序だけが違う同じキー（`shift+ctrl+x` と `ctrl+shift+x`）は衝突として検出されない。この制約を README に記載する。
- [Risk] 設定ファイルが壊れていると、開閉キーと初期状態が警告なしで既定値（または環境変数）に戻る → Mitigation: 拡張の読み込みは失敗させず、TODO 機能を保つことを優先する。Pi 自身も同じファイルを読むため、破損は Pi 側の挙動でも気付ける。
- [Risk] 同一プロセスで複数セッションを扱うテストや将来の並行セッションで状態が混ざる → Mitigation: 状態は拡張ロードごとに生成し、`session_start` で必ずリセットする。
- [Risk] 設定ファイルや環境変数の変更が実行中セッションへ反映されない → Mitigation: 既存の設定（`SPIRITS_TODO_MAX_LINES`）と同じ「ロード時に 1 回読む」挙動に揃える。`/reload` は拡張ランタイムを作り直す（`resourceLoader.reload()`）ため、新しいランタイムが読み直す。

## Migration Plan

保存データの形式は変えないため、既存セッションの TODO はそのまま読める。設定キー `todo` は新規で、Pi の `Settings` に同名のキーは無い。既存の設定ファイルには影響しない。ロールバックは `packages/spirits/src/todo/`、`config.ts`、`constants.ts`、`index.ts`、型ミラーの変更を戻すだけで、セッションファイルの移行は不要。設定ファイルに書かれた `todo` キーは、ロールバック後は読まれずに残る。

## Open Questions

- 端末が `ctrl+shift` を消費する環境向けの `/spirits-todo` コマンドを追加するか。追加する場合は spec の開閉要件に第 2 の入口として追記が必要になる。今回のタスクには含めない。
