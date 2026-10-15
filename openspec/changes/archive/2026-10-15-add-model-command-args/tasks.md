# Tasks

テストの実行は `packages/coding-agent` で行う。以下、`VITEST` は `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run` を指す。

## 1. 引数解析と thinking レベル候補(新規ファイル)

- [x] 1.1 `src/modes/interactive/model-command-args.ts` を新規作成し、`/model` の引数を検索語と thinking レベルに分ける純粋関数を実装する(design Decision 2)。thinking レベル名の集合には `THINKING_LEVEL_OPTIONS` を使う。`test/model-command-args.test.ts` を新規作成する。検証: `VITEST test/model-command-args.test.ts` で、次のケースが成功する。
  - "splits a trailing thinking level from the model term"
  - "matches thinking level names case-insensitively"
  - "keeps a multi-word search term when the last word is not a level"
  - "treats a single level-like word as the model term"
  - "returns no search term for empty arguments"
- [x] 1.2 同じファイルに、`/model` の引数補完で 2 語目の thinking レベル候補を作る関数を追加する(design Decision 5)。引数に空白があり、最後の空白より前がモデル一覧に完全一致(`findExactModelReferenceMatch`)するときだけ、そのモデルがサポートするレベルを最後の語で絞り込み、`value` を `"<1 語目> <level>"` にして返す。それ以外は「該当なし」を返し、呼び出し側が従来の補完を行う。検証: `VITEST test/model-command-args.test.ts` で、次のケースが成功する。
  - "suggests supported thinking levels after an exact model match"
  - "keeps the model reference in the completion value"
  - "suggests only off for a non-reasoning model"
  - "returns no level suggestions when the first word is not an exact match"
  - "returns no level suggestions without a trailing word separator"

## 2. CustomEditor の保存キーフック

- [x] 2.1 `src/modes/interactive/components/custom-editor.ts` に `(data: string) => boolean` 型の公開フィールドを追加し、`handleInput` で拡張機能ショートカットの判定の直後に呼ぶ(design Decision 1)。true ならキーを消費し、false なら従来の処理を続ける。`test/custom-editor-submit-shortcut.test.ts` を新規作成する(`custom-editor-history-keybindings.test.ts` と同じく `VirtualTerminal` 上に作る)。検証: `VITEST test/custom-editor-submit-shortcut.test.ts` で、次のケースが成功する。
  - "consumes the key when the hook returns true"
  - "passes the key to the editor when the hook returns false"
  - "checks extension shortcuts before the hook"
  - "runs the hook before registered app actions"

## 3. 対話モードへの配線

- [x] 3.1 `interactive-mode.ts` の `handleModelCommand` に保存指定の引数を追加し、1.1 の関数で引数を解析する。完全一致したら、thinking レベルを対象モデルで検証してから(design Decision 3)、`setModel` → `setThinkingLevel` を同じ保存指定で呼ぶ。保存時は既定として保存した旨のステータスを出す。`showModelSelector` に保留中の thinking レベルと保存指定を渡せるようにし、選択時の保存指定を「コマンドの保存指定 OR selector の保存キー」にし、`persist === true || selectorPersist` と書く(design Decision 4)。`test/interactive-mode-model-command.test.ts` を新規作成し、既存の `interactive-mode-*.test.ts` と同じく `InteractiveMode.prototype.<method>.call(fakeThis, ...)` で呼ぶ。検証: `VITEST test/interactive-mode-model-command.test.ts` で、次のケースが成功する。
  - "sets model and thinking level for an exact match without persisting"
  - "persists model and global thinking default when requested"
  - "persists only the model when no level is given"
  - "rejects an unsupported thinking level and changes nothing"
  - "opens the selector with the model term when there is no exact match"
  - "applies the pending thinking level after a selector choice"
  - "carries the persist request into the selector"
  - "rejects an unsupported level chosen through the selector and changes nothing"
  - "changes nothing when the selector is cancelled"
  - "persists the model from a bare /model through the selector"(`handleModelCommand(undefined, true)` の後、selector で Enter を押すと `setModel` が `{ persist: true }` で呼ばれ、`setThinkingLevel` は呼ばれない)
  - "shows the saved model and thinking level in the status"(`showStatus` が `Default model: anthropic/claude-sonnet-4-5 · Default thinking level: high` で呼ばれる)
  - "keeps the selector save key when the command did not ask to persist"(`handleModelCommand("sonn high", false)` の後、selector で保存キーを押すと `setModel` と `setThinkingLevel` が `{ persist: true }` で呼ばれる)
- [x] 3.2 `handleThinkingCommand` に保存指定の引数を追加し、`selectThinkingLevel(level, persist)` に渡す。引数なしのときは `showThinkingSelector` に保存指定を引き継ぐ。selector で選ばれたときの保存指定は 3.1 と同じ規則(`persist === true || selectorPersist`)にする。検証: `VITEST test/interactive-mode-model-command.test.ts` で、次のケースが成功する。
  - "persists the thinking level as the global default when requested"
  - "does not persist an invalid thinking level"
  - "carries the persist request into the thinking selector"
  - "keeps the thinking selector save key when the command did not ask to persist"(`handleThinkingCommand(undefined, false)` の後、selector で保存キーを押すと `setThinkingLevel` が `{ persist: true }` で呼ばれる)
- [x] 3.3 `interactive-mode.ts` で既定エディタに保存キーフックを設定する(design Decision 1)。`app.models.save` に一致し入力が `/model` コマンドなら `/model` を、`app.thinking.save` に一致し入力が `/thinking` コマンドなら `/thinking` を、それぞれ保存指定で実行して true を返す。入力は `getExpandedText()` で読み、実行前に入力欄を空にする。それ以外は false を返す。`setCustomEditorComponent` の duck typing のコピー箇所でフックもコピーする。対象は `CustomEditor` を継承した(`actionHandlers` を持つ)エディタに限る(design Decision 6)。検証: `VITEST test/interactive-mode-model-command.test.ts` で、次のケースが成功する。
  - "save key submits /model with persistence and clears the editor"
  - "save key submits a bare /model with persistence"(入力が `/model` だけのとき、`handleModelCommand(undefined, true)` が呼ばれ、入力欄が空になる)
  - "save key submits /thinking with persistence"
  - "save key follows a rebound app.models.save"
  - "save key ignores non-command input and keeps the text"
  - "save key ignores /models"
  - "runs the copied save key hook against the extension editor text"(フックを spy に置き換えない。差し替えエディタに `/model anthropic/claude-sonnet-4-5 high` を入れて `onSaveKey("\x13")` を呼ぶと、`handleModelCommand` が `("anthropic/claude-sonnet-4-5 high", true)` で呼ばれ、差し替えエディタの `setText` が `""` で呼ばれる)
- [x] 3.4 `createBaseAutocompleteProvider` の `/model` の `getArgumentCompletions` から 1.2 の関数を呼び、該当があればその候補を返す(design Decision 5)。`src/core/slash-commands.ts` の `/model` の `argumentHint` を `<provider/model> [level]` にする。検証: `VITEST test/interactive-mode-model-command.test.ts` で、次のケースが成功する。
  - "completes thinking levels as the second /model argument"
  - "keeps the model reference when a level completion is applied"(`applyCompletion` を呼んだ後の入力行が `/model anthropic/claude-sonnet-4-5 high` になる)
  - "keeps fuzzy model completion for multi-word terms"
  - "shows the level in the /model argument hint"
- [x] 3.5 `docs/models.md`(`/model` の節)と `docs/usage.md`(`/model` の行)に、`/model <provider/model> <level>`、`app.models.save` / `app.thinking.save` キーでの保存、保存先がグローバル既定であること、モデル別 thinking レベル設定が優先されること、最後の語がレベル名なら thinking 指定として扱うことを追記する。検証: `rg -n "\[level\]|<level>" packages/coding-agent/docs/models.md packages/coding-agent/docs/usage.md` が両ファイルで 1 件以上一致する。

## 4. 統合確認

- [x] 4.1 リポジトリルートで `npm run check` を実行し、エラー・警告・info を 0 にする。検証: `npm run check` が終了コード 0
- [x] 4.2 リポジトリルートで `./test.sh` を実行し、非 e2e テストがすべて成功することを確認する。検証: `./test.sh` が終了コード 0
- [x] 4.3 `.pi/skills/interactive-testing.md` の手順(`scripts/tmux-verify.sh run`)で `./pi-test.sh --no-env` を起動し、実端末で保存キーの動作を確認する。agent dir には一時ディレクトリを使う(ソース実行では `PI_CODING_AGENT_DIR`)。その `models.json` に、到達しない `baseUrl` とダミーの `apiKey` を持つプロバイダを定義し、reasoning 対応モデルと非対応モデルを 1 つずつ置く。利用者の設定と認証情報は使わない。検証: 次の 4 点をすべて確認する。
  - `/model <reasoning 対応モデル> high` + ctrl+s の後、一時ディレクトリの `settings.json` で既定モデルと既定 thinking レベルが更新されている
  - `/thinking low` + ctrl+s の後、既定 thinking レベルが low になっている
  - `/model <非対応モデル> high` でエラーが表示され、`settings.json` が変わらない
  - `hello` + ctrl+s で入力欄の内容が残る

## Workflow follow-up

- コミットは利用者の依頼を受けてから行う。Pi コアの変更(`packages/coding-agent` 配下のソース、テスト、docs)は、`[spirits] feat(coding-agent): ...` の独立コミット 1 つにまとめる。
- verify の後に `/opsx:archive` でアーカイブし、`openspec/specs/model-commands/spec.md` が作成されたことを確認する。
