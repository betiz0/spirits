# Design

## Context

対象はすべて `packages/coding-agent` の対話モードで、Pi 上流コアに当たる。`docs/spirits-design.md` §5 の規律(コア差分の最小化、`[spirits]` 独立コミット)に従う。

現状の関連箇所:

- `interactive-mode.ts` の `setupEditorSubmitHandler()` が `/model` と `/thinking` を文字列で判定し、`handleModelCommand(searchTerm)` と `handleThinkingCommand(searchTerm)` を呼ぶ。`handleModelCommand` は完全一致なら `session.setModel(model, { persist: false })`、不一致なら `showModelSelector(searchTerm)` を開く。
- `showModelSelector` と `showThinkingSelector` は、selector の Enter を `persist: false`、`app.models.save` / `app.thinking.save`(どちらも既定 ctrl+s)を `persist: true` として扱う。
- `session.setModel(model, { persist: true })` は既定モデルを、`session.setThinkingLevel(level, { persist: true })` はグローバル既定 thinking レベルを設定ファイルに書く。`setThinkingLevel` は対象モデルがサポートしないレベルを黙って丸める。
- `CustomEditor.handleInput` は、拡張機能のショートカット → interrupt / exit / 履歴 → 登録済み app action → `Editor` の順にキーを処理する。入力欄では ctrl+s はどこにも割り当てられていない。
- 拡張機能がエディタを差し替えると、`interactive-mode.ts` は `onSubmit` と `CustomEditor` のハンドラ(`onEscape`、`actionHandlers` など)を新しいエディタへコピーする。
- 引数補完(`packages/tui` の `autocomplete.ts`)は、最初の空白より後の引数全体を `getArgumentCompletions(prefix)` に渡し、確定した候補の `value` で引数全体を置き換える。

## Goals / Non-Goals

**Goals:**

- `packages/tui` を変更しない。上流と衝突しうる範囲を `packages/coding-agent` に限定する。
- `interactive-mode.ts` への変更は既存の分岐とメソッドを拡張する形に留め、新しいロジックは新規ファイルに置く。
- 上流追従の merge で変更が失われた場合に、`./test.sh` で検知できる。

**Non-Goals:**

- `src/experimental/`(実験的クライアント)の `/model` と `/thinking` は変更しない。
- モデル別 thinking レベル設定(`setModelThinkingLevel`)への保存は行わない。保存先はグローバル既定だけとする。
- 新しいキーバインド ID は追加しない。
- RPC の `set_model`、CLI の `--model` などの対話モード以外の経路は変更しない。
- selector の操作ヒント文は変更しない。
- `packages/coding-agent/CHANGELOG.md` は更新しない。上流の changelog であり、既存の `[spirits]` コミット(`/clear` など)も更新していない。

## Decisions

### 1. 保存キーは `CustomEditor` の判定フックで受ける

**選択**: `CustomEditor` に `(data: string) => boolean` 型の公開フィールドを 1 つ追加する(名前は実装時に決める。以下「保存キーフック」)。`handleInput` で拡張機能ショートカットの判定の直後に呼び、true が返ればキーを消費する。フックは入力データを受け取るだけで、コマンドの知識を持たない。`interactive-mode.ts` 側のフックが次のように判定する。

```
data が app.models.save に一致 かつ 入力が "/model" または "/model ..." → /model を保存指定で実行、true
data が app.thinking.save に一致 かつ 入力が "/thinking" または "/thinking ..." → /thinking を保存指定で実行、true
それ以外 → false (キーは従来どおり Editor へ流れる)
```

入力は `getExpandedText()` で読み、`handleFollowUp` と同様に貼り付けマーカーを展開する。実行前に入力欄を空にする。Enter での `/model` と同じく履歴には追加しない。

**理由**: alt+Enter の `app.message.followUp` は、すでに「`CustomEditor` がキーを受け、`interactive-mode.ts` が本文を読んで処理する」形で実装されている。同じ形を取ると `packages/tui` に触れない。入力データを受け取るので、`/model` には `app.models.save`、`/thinking` には `app.thinking.save` と、コマンドごとにキーバインド ID を区別できる。

**代替案 A**: `Editor.onSubmit` を `(text, { persist })` に拡張する。不採用。`packages/tui` の公開 API を変えるうえ、`onSubmit` を直接呼ぶ経路(`handleFollowUp`、拡張機能が差し替えたエディタへの `onSubmit` のコピー)は第 2 引数を渡さない。

**代替案 B**: `onAction("app.models.save", ...)` で app action として登録する。不採用。理由は 2 つある。

- action ハンドラは引数を受け取らない。`app.models.save` と `app.thinking.save` は既定で同じ ctrl+s なので、先に登録した側だけが呼ばれ、`/thinking` と `/model` をキーバインド ID で区別できない。
- action はキーを無条件に消費する。利用者が保存キーを編集キー(例: ctrl+k)に割り当てると、`/model` 以外の入力でも編集操作が効かなくなる。

### 2. `/model` の引数は最後の語だけを thinking レベル候補にする

**選択**: 引数を空白で分け、2 語以上あり、最後の語が thinking レベル名(`THINKING_LEVEL_OPTIONS`、大文字小文字を区別しない)のときだけ、最後の語を thinking レベル、それより前をモデルの検索語にする。判定はモデルに依存しない名前の集合で行い、対象モデルがそのレベルをサポートするかは、モデルを決めた後に検証する(Decision 3)。解析は純粋関数として新規ファイル `src/modes/interactive/model-command-args.ts` に置く。

```
"anthropic/claude-sonnet-4-5 high" → { searchTerm: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }
"claude sonnet"                    → { searchTerm: "claude sonnet" }
"high"                             → { searchTerm: "high" }
""                                 → {}
```

**理由**: 現状の `/model claude sonnet` のような複数語の検索を壊さない。新しいロジックを新規ファイルに置くと、上流が `interactive-mode.ts` を書き換えても衝突しない。

**代替案**: 1 語目をモデル、2 語目を thinking レベルと位置で決める。不採用。`/model claude sonnet` の `sonnet` が不正な thinking レベルとして扱われ、既存の複数語検索が壊れる。

### 3. thinking レベルは適用前に対象モデルで検証し、失敗したら何も変えない

**選択**: 適用するモデルが決まった時点で、そのモデルがサポートするレベル(`getSupportedThinkingLevels`)に指定レベルが含まれるかを確認する。含まれなければエラーを表示し、`setModel` も `setThinkingLevel` も呼ばない。含まれれば `setModel(model, { persist })` → `setThinkingLevel(level, { persist })` の順に呼ぶ。完全一致の場合も selector 経由の場合も同じ検証を使う。

**理由**: `setThinkingLevel` は未サポートのレベルを黙って丸めるので、`xhigh` を指定したのに `high` で保存される、といった誤りに利用者が気付けない。検証を先に行えば、失敗時に状態が半分だけ変わることもない。

**代替案**: モデルは適用し、thinking レベルだけ丸めて警告する。不採用。完全一致と selector 経由とで結果が揃わず、保存指定のときは丸めた値が既定として残る。

### 4. selector に移った場合は thinking レベルと保存指定を引き継ぐ

**選択**: `showModelSelector` に、保留中の thinking レベルと保存指定を省略可能な引数として渡す。selector で選ばれたときの保存指定は「コマンドの保存指定 OR selector で ctrl+s を押したか」とし、`persist === true || selectorPersist` と書く。コマンドの保存指定が false や未指定でも、selector の ctrl+s は有効のままにする。thinking レベルは Decision 3 の検証を通してからモデルと同じ保存指定で適用する。キャンセル時は何も変えない。`/thinking` の selector(`showThinkingSelector`)も同じく保存指定を引き継ぐ。

**理由**: ctrl+s で `/model sonn high` を送った利用者は保存を意図しているので、selector で Enter を押しても保存されるべきである。

**代替案**: selector に移った後は selector のキーだけで保存を決める。不採用。最初の ctrl+s が黙って無視され、利用者が保存されたと誤解する。

### 5. 2 語目の補完は既存の `/model` 補完クロージャで分岐する

**選択**: `createBaseAutocompleteProvider` の `/model` の `getArgumentCompletions` で、引数に空白があり、最後の空白より前が利用可能なモデルに完全一致するとき(`findExactModelReferenceMatch`。カタログの再取得はせず、同期のキャッシュだけを見る)、そのモデルがサポートする thinking レベルを、最後の語で絞り込んで返す。候補の `value` は `"<1 語目> <level>"` にする。引数補完は確定時に引数全体を `value` で置き換えるので、1 語目が残る。それ以外は従来の処理を行う。分岐の判定と候補生成は `model-command-args.ts` に置き、クロージャからは呼び出すだけにする。

**理由**: `packages/tui` の補完の仕組みを変えずに 2 語目を補完できる。

**代替案**: `packages/tui` の補完を語単位の置き換えに対応させる。不採用。tui の公開 API の変更になり、他のコマンドの補完にも影響する。

### 6. 拡張機能が差し替えたエディタへ保存キーフックをコピーする

**選択**: エディタ差し替え時に `onEscape` などをコピーしている箇所で、同じ duck typing の条件の下で保存キーフックもコピーする。差し替え後のエディタが既にフックを持っていれば上書きしない(既存のハンドラと同じ扱い)。対象は `actionHandlers` を持つ(`CustomEditor` を継承した)エディタに限る。継承しないエディタには他のアプリのキーバインドと同様にフックが渡らず、ctrl+s は何も起こさない(Enter での送信は従来どおり動く)。

**理由**: このコピーがないと、エディタを差し替える拡張機能を使う環境では保存キーが働かない。継承しないエディタを対象外にするのは、既存のコピー箇所の条件と、`docs/tui.md` の「`CustomEditor` を継承するとアプリのショートカットが保たれる」という説明に合わせるためである。

**代替案**: 保存キーフックを `actionHandlers` に混ぜてコピーを省く。不採用。Decision 1 の代替案 B と同じ問題がある。

### 7. 回帰テストは新規ファイルに置く

**選択**: 次の 3 ファイルを新規作成する。

- `test/model-command-args.test.ts`: 引数解析と thinking レベル候補の純粋関数のテスト
- `test/custom-editor-submit-shortcut.test.ts`: 保存キーフックの呼び出し順と消費のテスト。既存の `custom-editor-history-keybindings.test.ts` と同じく、`VirtualTerminal` 上に `CustomEditor` を作る。
- `test/interactive-mode-model-command.test.ts`: `/model`、`/thinking`、保存キーの判定、selector への引き継ぎのテスト。既存の `interactive-mode-*.test.ts` と同じく `InteractiveMode.prototype.<method>.call(fakeThis, ...)` で呼ぶ。

**理由**: 既存のテストファイルに追記すると、上流が同じファイルを変えたときに衝突する。新規ファイルなら衝突せず、上流追従の検証手順にある `./test.sh` で必ず実行される(upstream-tracking spec)。merge でこの変更が失われればテストが失敗する。

**代替案**: `packages/spirits` にテストを置く。不採用。spirits のテストは型ミラー越しに `bun test` で動き、`InteractiveMode` や `CustomEditor` の内部を直接呼べない。

## Risks / Trade-offs

- [Risk] 上流が `interactive-mode.ts` の `/model` 分岐や `handleModelCommand` を書き換え、merge の競合解決でこの変更が消える → Mitigation: Decision 7 のテストが `./test.sh` で失敗する。解析と補完のロジックは新規ファイルにあるので、競合しうるのは `interactive-mode.ts` の配線部分だけに限られる。
- [Risk] `/model qwen max` のように、検索語の最後の語が thinking レベル名と同じ(`max`、`high` など)場合、従来の複数語検索ではなく thinking レベルの指定として扱われる → Mitigation: モデル ID(`qwen-max`)を入力すれば従来どおり検索できる。この振る舞いの変化は proposal の Impact と `docs/models.md` に記載する。
- [Risk] 補完候補を表示中に保存キーを押すと、選択中の候補ではなく入力済みの文字列が送られる → Mitigation: 入力が完全一致しなければ selector が開くので、そこで選び直せる。保存指定は selector に引き継がれる(Decision 4)。
- [Risk] 拡張機能が ctrl+s をショートカットとして登録すると、拡張機能のショートカットが先に判定されるため保存キーが働かない → Mitigation: 既存の優先順位(拡張機能ショートカットが先)を維持する。利用者は `app.models.save` / `app.thinking.save` を別のキーに変更できる。
- [Risk] `CustomEditor` を継承しないエディタに差し替える拡張機能では、保存キーが働かない → Mitigation: `docs/tui.md` が `CustomEditor` の継承を求めており、他のアプリのキーバインドも同じ制約を持つ。Enter での `/model` と `/thinking` は従来どおり動く。
- [Risk] 対象モデルにモデル別 thinking レベル設定があると、グローバル既定に保存した thinking レベルより次回起動時にそちらが優先される → Mitigation: 保存先はグローバル既定とすることを利用者と合意済み。`docs/models.md` に優先順位を記載する。
- [Risk] ctrl+s を端末のフロー制御(XOFF)が奪う → Mitigation: 対話モードは raw モードで動き、既存の selector も ctrl+s を使っている。新たなリスクではない。
- [Risk] 保存指定で selector に移った場合、selector の操作ヒントは「Enter で選択」のままで、Enter でも保存されることが表示されない → Mitigation: 選択後のステータス表示で既定として保存したことを示す。ヒント文の変更は Non-Goal とする。

## Migration Plan

設定ファイルの形式は変わらないので、移行は不要である。ロールバックは `[spirits]` コミット 1 つを revert する。
