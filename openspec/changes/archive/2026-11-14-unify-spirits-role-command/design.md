# Design

## Context

managed 経路(`packages/spirits/src/managed-pi/` + `packages/spirits/src/{commands,routing}/`)は、公式 Pi 1.5.0 の管理バイナリに拡張 bundle として読み込まれる。既定経路(fork)の `--normal-model` / `--strong-model` / `--role` 相当を、拡張 API だけで再現してきた。

現在の形と、その制約:

- ロールは `routing/phase.ts` の 1 とおりの位相(直近の開始コマンドかロック)で決める。位相は run が settled すると消える。
- 設定キーは `models.role`(既定 role)と `models.strong`(strong の対象 1 本)だけ。normal の対象は Pi の既定モデルに固定で、ユーザーは選べない。
- `/spirits-model <provider/id> [level] [role]` が「セッションのモデル選択」「thinking レベル」「role」を 1 行で扱う。公式 Pi 1.5.0 には `/model` と `/thinking` があり、既定保存も行う。
- 振り分けは `pi.events.on("input")` でスラッシュ入力を受け取り、`before_agent_start` の `setModel` で解決する。
- 互換性マトリクス(`scripts/managed-pi-compat/`)は RPC モードで動く。`ctx.ui.custom()` は RPC では実装されていない(`rpc-mode.ts` の `custom()` は `undefined` を返す)。

公式 Pi に対する事前検証で確定した事実(すべて管理バイナリ `~/.spirits/managed-pi/current/pi/pi` と同梱 bundle の `node_modules/@earendil-works/pi-tui` で確認した):

| # | 事実 | 根拠 |
|---|---|---|
| V1 | `ctx.ui.custom()` と pi-tui の `SettingsList` / `SelectList` は managed の対話 TUI で動く。矢印・Enter・Esc の操作、`SettingsList` からの submenu 表示まで確認 | 検証用拡張を `--external '@earendil-works/pi-*'` で bundle して管理バイナリに読みさせ、tmux で操作。パネル行、`strong model` 行、`normal` の choices 列、選択枠の移動を画面で確認 |
| V2 | `SettingsList` の行は `{ id, label, description, currentValue, optionValues, optionCurrentIndex, onToggle, onSelect, customValue, formatValue }` を渡し、`submenu` は `(current, done) => Component & { dispose? }` を返す。サブメニューが開いている間、`SettingsList` は入力をすべてサブメニューへ渡すので、Esc で閉じるにはサブメニュー側が `done()` を呼ぶ必要がある(`SelectList` なら `onCancel` から)。`SelectList` の theme は `{ selectedPrefix, selectedText, description, scrollInfo, noMatch }` の 5 値が必須(欠くと `render` で落ち、拡張ごと死ぬ) | `packages/tui/src/components/settings-list.ts`(`handleInput` のサブメニュー委譲、`activateItem` の `done`)、`select-list.ts` の `SelectListTheme` と `render`、Pi の `settings-selector.ts` がサブメニューの cancel で `done()` を呼ぶ実装。theme を 2 値しか渡さない probe で `TypeError: undefined is not an object (evaluating 'str.length')` |
| V3 | `getArgumentCompletions` は `argumentPrefix: string` だけを受け取る。`ExtensionContext` は渡らない。返り値は `AutocompleteItem[]`(`{ value, label, description? }`)で、`label` を欠くと pi の `applyCompletion` が落ちる | `packages/coding-agent/src/core/extensions/types.ts` の `RegisteredCommand`、`packages/tui/src/autocomplete.ts:249`。`{ value }` のみを返す検証用拡張で `item.label.endsWith` が落ち、`label` を入れて解消した |
| V4 | `pi.getCommands()` は `input` ハンドラ内で使える。`{ name, description, source, sourceInfo }` を返し、スキルは `name: "skill:<name>"` / `source: "skill"`、プロンプトテンプレートは `name: "<name>"` / `source: "prompt"`、拡張コマンドは `source: "extension"`(`name` には拡張コマンドの invocation 名が入る)。`invocationName` と `kind` というフィールドは無い。一覧に無いコマンドは現れない | 管理バイナリの RPC で probe 拡張を動かし、`--approve`(project trusted)時に `skills=1 prompts=1` と `/skill:bar` `/foo` の解決を確認。フィールドの形は公式 1.5.0 バイナリの `getCommands` 実装(`_bindExtensionCore`)で確認 |
| V5 | `input` イベントはスキル・テンプレート展開前に届く。`text` は元の入力、`imagePaths` を伴う。`streamingBehavior` は idle では `undefined`(steer / follow-up の判定に使える) | 同上 |
| V6 | fake provider は thinking レベルを観測できる。RPC の `set_thinking_level high` が要求本文の `reasoning_effort: "high"` として届く | `scripts/managed-pi-compat/` に `set_thinking_level` を足して `/state/last-request` の body を確認 |
| V7 | 設定書き込み後の `ctx.reload()` は `session_start(reason="reload")` と `session_shutdown(reason="reload")` を伴う。`session_start` の reason の集合は `startup` / `reload` / `new` / `resume` / `fork`（`clear` も `sidechain` も無い）。`session_shutdown` は `quit` / `reload` / `new` / `resume` / `fork`。型名は無く、インラインの文字列型である | `packages/coding-agent/src/core/extensions/types.ts` 744 行（`SessionStartEvent.reason`）と同 812 行（`SessionShutdownEvent.reason`）、公式 `docs/extensions.md` の session lifecycle の節 |
| V8 | `@earendil-works/pi-tui` は公式バイナリの同梱 bundle で bare specifier として解決でき、`spirits.ts` の bundle で external に出せる。`HOST_EXTERNALS` には既に `@earendil-works/pi-tui` が入っている | `scripts/build-managed-pi-inputs.ts` 31 行の `HOST_EXTERNALS` |
| V9 | 対話 TUI かどうかは `ctx.mode === "tui"` で判定する。`ctx.hasUI` は TUI と RPC の両方で true で、RPC の `ctx.ui.custom()` は `undefined` を返す | `packages/coding-agent/src/core/extensions/types.ts` の `hasUI`（"true in TUI and RPC modes"）と `rpc-mode.ts` の `custom()`、公式 `docs/extensions.md` の "Use `ctx.mode === "tui"` to guard … `custom()`" |
| V10 | `ctrl+shift+<letter>` は端末が修飾キーを報告しないと `ctrl+<letter>` と同じバイト列になる。 Spirits 0.7.1 の実バイナリ + 実 TODO パネルで tmux 3.6 の `extended-keys off`（tmux 既定）で実測: 項目 1 件で展開中のパネルに対し `C-S-l` は Pi のモデル選択を開くだけで開閉せず、`SPIRITS_TODO_TOGGLE_KEY=ctrl+alt+t` に変えると同じ環境で `C-M-t` が折りたたみ（`1 pending`）と展開を切り替えた。probe 拡張では `extended-keys on` + `extended-keys-format csi-u` のときに `ctrl+shift+l` も発火し、`ctrl+alt+t` は `extended-keys off` でも `alt+t` も発火した（`ctrl+alt` は旧式の `ESC` + 0x14、`alt` は `ESC` + 文字で届く）。Pi は起動時に `Warning: tmux extended-keys is off.` を出す | tmux 3.6 + `spirits` 0.7.1 と probe 拡張の実測、`packages/tui/src/keys.ts` の `matchesKey`（`shift+ctrl` 節は kitty / modifyOtherKeys の照合のみで旧式の制御文字を見ない、`ctrl+alt` 節は旧式形式を見る）、`packages/coding-agent/src/modes/interactive/interactive-mode.ts` の tmux 警告 |
| V11 | 分岐間の移動（`/tree`、拡張からの `ctx.navigateTree()`）は `session_start` を伴わず、`session_tree`（`{ newLeafId, oldLeafId, summaryEntry?, fromExtension? }`）を拡張へ送る。移動後の `ctx.sessionManager.getBranch()` は移動先の葉までの経路を返すので、位相が読む「最新の `spirits_step`」は移動で変わる | `packages/coding-agent/src/core/extensions/types.ts` 840 行（`SessionTreeEvent`）。spirits の TODO パネルは既にこのイベントで描き直している（`packages/spirits/src/todo/widget.ts` 231 行）。d-verify3 W-2 で、V7 の洗い出しがこのイベントを扱っていなかったことが分かった |

設計の一次根拠は `docs/spirits-design.md` と `docs/spirits-managed-pi-design.md`(§コマンド対応表、§マトリクス再定義)。本ファイルは HOW に限る。

## Goals / Non-Goals

**Goals:**

- ロール・モデル・thinking レベル・ステップの設定を 1 コマンドと 1 画面に集約し、設定した値が実際に効くことをセッション中で確認できる形にする。
- ステップごとにロールと thinking レベルを決め、既定ロールとロックとの優先順位を決める。
- スキルだけでなくプロンプトテンプレートで始まるステップも扱えるようにする。名前を取り出す規則自体は Pi の展開と同じままにし、Pi が展開しない入力ではステップを開始しない。
- 正しく動く pi に一切変更を加えない(`packages/coding-agent/src/**` および `packages/tui/src/**` の差分ゼロ)。

**Non-Goals:**

- 公式の対話 TUI に `Tab` 補完以外の表示変更を加えない。パネルは spirits のコマンドが呼んだときだけ開く。
- RPC / print モードでのパネル動作(パネルは対話 TUI 限定)。
- 3 つ目以降のロール、ロールの階層化、セッション単位のモデル上書き。
- フォーク経路（`--normal-model` / `--strong-model` / `--role`）の挙動変更。

## Decisions

### D1: ロールは `normal` / `strong` の 2 つを保つ
- 選択肢: (a) 2 ロール維持、(b) `cheap` などの 3 つ目、(c) ステップにモデル参照を直接書く。
- 採用: (a)。ロールは「モデル解決の関数」であり、`resolveTargetRole` と notification の分岐は 2 値を前提にしている。ステップがモデルを直接持つと、strong の fallback・子の解決・status 表示が「ロール経由」と「直指定」に分岐する。
- 代替: (c) は「このステップだけ特定モデル」を素直に書けるが、`models.steps.<name>` にモデル解決を移すことになり、振り分けの単一入口が壊れる。ステップはロールと thinking のみ持つ。

### D2: ステップは run settled 後も継続する
- 選択肢: (a) 継続(ロックされるか別のステップが始まるか一覧にないスキルが起動するまで)、(b) run 単位。
- 採用: (a)。`opsx-propose` は途中で質問して終了し、回答で続きを書く。run 単位では回答の run が normal に落ち、生成物がロールの違うモデルで書かれる。現行の「開始コマンドを持ち越さない」規則は、一覧に無い入力を strong に持ち越さないためのものなので、一覧内のステップには適用しない。
- 代替: (b) は位相が単純で、終了条件のテストも減る。持ち越しによる取り違えリスクは、`/spirits-clear`・一覧外スキル・新セッションで終わることを spec のシナリオにして潰す。

### D3: `models.normal` を追加する
- 選択肢: (a) 追加、(b) Pi の既定モデルのみ。
- 採用: (a)。`spirits/auto` を Pi 既定にすると新規セッションがすべて spirits 依存になり、拡張が読み込まれない状態での起動が失敗する。既定モデルに物理モデルを置いたままだと normal を選べない。
- 代替: (b) は設定キーを増やさないが、normal の対象を選べない。`normal の対象の解決` 要件で「未設定なら Pi の既定」を残すことで、設定しない限り従来と同じ挙動に保つ。

### D4: 解決時の挙動は変えず、設定時の警告だけを加える
- 選択肢: (a) 解決時は現行のまま（未設定なら無言、設定済みで使えなければ run ごと 1 回通知）+ 設定時警告、(b) 解決時も未設定なら通知、(c) 解決時も毎回通知。
- 採用: (a)。解決時の通知規則は現行の確定動作のままにする。すなわち strong と normal のどちらも、**未設定なら無言**、**設定済みで使えないときは run ごとに 1 回**通知し、同一 run 内で同じ理由を繰り返さない。`models.normal` にも同じ規則を移す（proposal の「strong と同じ扱い」）。一方で設定時に黙っていると「効いていない」ことが分からないので、設定時に限り 1 行で設定コマンドを教える。設定は取り消さない。
- 設定時の警告の範囲(d-verify1 S-4 の決定):
  - strong 未解決の警告は、コマンドで strong をロックしたときと、ステップのロールに strong を設定したときだけ出す。strong の対象そのものを設定したときは出さない。
  - 物理モデル選択中の警告は、コマンドによるすべての設定変更(ロック、ロールの model / thinking、ステップの role / thinking、`unset`)で 1 行出す。
  - 一覧での編集は通知を出さず、同じ内容をロックの行と該当行の説明に出す。一覧を閉じるまで通知が積み重なるのを避けるため。
- 警告の判定は、書き込んだ値を反映した設定で行う。`pi.getSettings()` は Pi の `SettingsManager` がメモリに持つ値の複製で、`ctx.reload()` まで書き込み前の値を返す(`settings-manager.ts` の `getSettings()` は `structuredClone(this.settings)`)。そのまま読むと、`/spirits-role strong model <ref>` の直後に「strong が使えない」と誤って警告する。読み取った設定に、書き込んだ経路と値を重ねた設定で判定する。
- 代替: (c) は run 中の通知が継続ステップでは毎回になり会話を汚す。(b) は未設定の通常利用（normal は既定モデルで足りる人）に毎回警告を出すことになる。

### D5: `/spirits-model` は alias なしで削除する
- 選択肢: (a) 削除のみ、(b) `/spirits-model` を残して非推奨通知、(c) `/spirits-model <ref>` を公式 `/model` の委譲にする。
- 採用: (a)。公式 `/model` と `/thinking` が同じ目的を満たし、`/spirits-model` の残りの機能(role、既定保存)は `/spirits-role` と公式コマンドに移る。spirits は開発段階で設定キーの互換も保たない方針(`docs/spirits-managed-pi-design.md` の方針と同じ)。
- 代替: (b) は移行の案内になるが、2 つの構文が並存し、補完一覧とマトリクスに幽霊行が残る。

### D6: 設定は `models` の入れ子にし、`unset` はキー削除で表す
- 形: `models.role` / `models.normal` / `models.strong` / `models.thinking.{normal,strong}` / `models.steps.<name>.{role,thinking}`。
- 選択肢: (a) 入れ子、(b) `models.step.opsx-propose.role` のような平坦キー。
- 採用: (a)。**既存の `patchGlobalSettings` / `patchSettingsFile`（`commands/settings-store.ts`）の `mergeFields` は 1 段マージ**（`{ ...base, ...value }`）なので、`{models:{steps:{a:{…}}}}` を渡すと `models.steps` 以下が丸ごと置き換わる。多段の経路マージとキー削除は 1.2 で新規に作る（経路を配列で受け取り、途中オブジェクトを複製しながら 1 キーだけ変える / 削除する）。`unset` はキー削除とし、`"unset"` という文字列値や空文字を「未設定」の意味にしない（読み取り側は型違い・空を未設定として扱うが、保存側は削除する）。
- 代替: (b) は `mergeFields` の再帰で階層が増えるだけで、`steps` の列挙にキー名の文字列走査が必要になる。

### D7: コマンド構文は「対象 項目 値」、モデル参照だけ行末まで取る
- 形: `/spirits-role <role>` / `status` / `<role> model <ref>` / `<role> thinking <level>` / `<step> <role|thinking> <value|unset>`。
- 選択肢: (a) 対象-項目-値、(b) `/spirits-model` と同じ位置構文(右から積む)。
- 採用: (a)。`getArgumentCompletions` は接頭辞だけしか見ないので、位置だけで 3 つの意味を区別する構文は補完を作れない。`<ref>` は行末まで取り、ID に空白を含むモデル（`Local/Qwen3.8 Flash Next` など）に対応する。照合するのは `provider/id` と ID で、表示名（モデルの `name`）は照合しない（旧 `/spirits-model` と同じ規則。d-verify3 S-1 の決定で、以前の「表示名」の記述を改めた）。
- 代替: (b) は入力が短いが、`unset` と level の区別が位置依存になり、補完が出せない。

### D8: 補完は固定語彙だけ出し、モデル参照は補完しない
- 1 語目: `status` / ロール名 / ステップ名。2 語目: 項目名。3 語目: ロール名 / thinking レベル / `unset`。`model` の値は補完では出さない。
- 理由: V3 のとおり `getArgumentCompletions` は `ExtensionContext` を受け取らないため、`model` の候補に必要な「解決できるモデル一覧」が取得できない。
- 代替: 補完ではモデル一覧を取得できないが、**パネルでは取得できる**。一覧はコマンドハンドラの `ExtensionContext` から開くので `ctx.modelRegistry.getAvailable()` が使える。よってパネルの `model` 行は `SelectList` でモデルを選ばせ、選べないのは補完だけ、という分担になる（D11）。補完側にも一覧を持たせるなら拡張起動時のスナップショットをキャッシュして `provider` 追加・資格情報変化に追随する仕組みが要るので行わない。
- 補完項目は必ず `value` と `label` を埋める(V3 のクラッシュ回避)。

### D9: ステップの開始コマンドの判定は `pi.getCommands()` を使う
- 一覧の各行について、開始コマンドが `pi.getCommands()` の `name`(`source` が `extension` 以外)に存在するかを見る。拡張コマンドは Pi が `input` イベントより前に処理するので、ステップの開始コマンドにはならない。
- 理由: V4 のとおりスキルは `skill:<name>`、テンプレートは `<name>` で返り、project trusted で無い状態では 0 件になる。ディレクトリを自分でスキャンすると、trusted 判定・`--no-skills` などのホスト側の判断を再現してしまう。
- 代替: 起動時に skill を走査して照合する案は、trusted でないディレクトリの扱いを誤り、`opencode` のような別ホストのスキル配置にも依存する。
- 展開時の名前抽出は Pi と同じ規則(スキルは最初の半角スペース、テンプレートは最初の空白文字)で実装し、一覧の照合だけ `getCommands()` を使う。

### D10: パネルは `packages/spirits/src/commands/` に置き、`commands` 層に `packages/tui` を許可する
- 選択肢: (a) `commands` 層に置き許可表へ `packages/tui` を追加、(b) 新しい `panel` 層を作る、(c) `routing` 層に置く。
- 採用: (a)。パネルはコマンドの UI にすぎず、設定書き込みとロール解決という既存の `commands` の責任を再利用する。`spirits:entry` はすでに `packages/tui` を許可しており、新層の許可表エントリは分岐を増やすだけ。`docs/architecture/convention-registry.md` と規約検査を同じ変更で更新する。
- 代替: (b) は「UI は独立」という境界を明示できるが、`commands` からの設定書き込み API を公開し直す必要がある。(c) は `routing` が `packages/tui` を import することになり、モデル解決だけの層でなくなる。

### D11: パネルは `SettingsList` + `SelectList` を `ctx.ui.custom()` で開き、対話 TUI 判定は `ctx.mode` で行う
- 選択肢: (a) pi-tui の既存部品、(b) `Text` + `Container` による自前の二段表示。
- 採用: (a)。V1 で動作確認済み。`SettingsList` が行選択・`description` 表示・左右キーでの値変更・submenu を持っており、`SelectList` が choices とスクロール表示を提供する。キー処理と再描画を自前で実装すると公式 TUI の挙動とズレる。
- サブメニューの閉じ方: `SettingsList` はサブメニューが開いている間の入力をすべてサブメニューへ渡す(V2)。`SelectList` の `onCancel` で `done()` を呼び、Esc で値を変えずに一覧へ戻す。モデル 0 件の案内部品も Esc で `done()` を呼ぶ。どちらも欠くと、利用者は一覧から抜けられなくなる。
- ステップの行(d-verify1 S-3 の決定): 1 ステップを 1 行にし、ロールと thinking レベルの組を 1 つの設定項目として扱う。Enter でロールの `SelectList` を開き、確定すると `/spirits-role <step> role <value>` と同じ書き込みをしてから、現在値を選択した thinking の `SelectList` を続けて開く。2 段目の確定は `/spirits-role <step> thinking <value>` と同じ書き込み、2 段目の Esc は thinking を変えずに閉じる。行の値は `<role> / <thinking>` の形で両方を示す。
- 行の説明は、ルーティングと同じ解決で求めた結果を出す。設定値の写しを出すと、設定済みで使えない対象を「応答する」と表示してしまう。解決の組み立ては D15 の関数に任せ、一覧の中で構成要素の関数（`resolveRequestRole`、`resolveNormalTarget`、`resolveStrongTarget`、`resolveRequestThinkingLevel`）を並べ直さない。thinking レベルは実際に応答するロールで解決する（strong が使えなければ normal のレベル。d-verify3 C-1）。ロックの行には生のロックと直近のリクエスト(ロール・物理モデル・要求した thinking)を出す。書き込みに成功した行は、値と説明の両方を新しい解決結果へ更新する。
- ステップの行の説明も同じ解決で求める(d-verify2 C-2)。そのステップが走ったときのロール、実際に応答するモデル(strong が解決できなければ normal の対象)、有効な thinking レベル(応答するロールで解決したもの。d-verify3 C-1)、継続するかどうかを出す。4 つとも D15 の関数の返り値から作る。ロールの thinking レベルの行も、strong が解決できないときは「strong の要求は normal で走り、normal のレベルを載せる」と出す。ロールが strong なのに strong が解決できないときは、strong 未解決の警告をその行に出す。strong の `model` 行も同じ警告を出す。ロックの行だけに警告を出すと、実行中でないステップを一覧で strong にしたときに、警告がどの行にも出ない。
- 開始コマンドの有無の判定(`missingStartersFor`)は、ステップの開始(D9)と同じく、`pi.getCommands()` のうち `source` が `extension` 以外の名前だけを使う(d-verify2 C-7)。拡張コマンドと同名の開始コマンドを「有る」と表示すると、ステップが始まらないのに始まるように見える。
- 一覧での書き込み失敗は、`ctx.ui.notify` ではなく、その行の説明か一覧の通知行に理由を出す(spec の「理由を一覧の中に出す」)。
- 一覧の編集と再描画の中で投げられた例外（ロックの記録の `pi.appendEntry`、再描画時の `pi.getSettings()` / `getAvailable()` / `getCommands()`）は、`openRolePanel` の `write` と `refresh` で捕まえ、その行の説明に理由を出して一覧を開いたままにする（d-verify3 W-1）。pi-tui は `handleInput` を try なしで呼び（`packages/tui/src/tui.ts` 1110-1115 行）、抜けた例外は pi の `uncaughtException` の処理（`interactive-mode.ts` 4517 行）でプロセスごと終わる。コマンドで同じ操作をした場合は、コマンドのエラーとして報告されるだけで済む。
- ロックの行で設定の書き込みだけが失敗したとき(d-verify2 S-1 の決定)は、セッションへ適用したロックを取り消さない。コマンドの `/spirits-role <role>` と同じ扱いである。行は書き込み前の値に戻さず、適用後のロックと保存失敗の理由を示し、badge もそのロールで描く。書き込み前の値へ戻すのは設定の項目の行だけである。
- ロックの行は、失敗の種類によらず、値と badge を「その時点の `phase.lock()`」から作る(d-verify4 C-2)。ロックの適用は 2 段で、`phase.setRole()` の後に `pi.appendEntry()` で記録を追記する。そのため、追記が例外を投げた時点で、セッションはもう新しいロックにある。
  - 誤動作の例: normal のロック → 一覧で strong を選ぶ → `setRole("strong")` → `appendEntry` が例外 → catch は行の説明だけを直す。その結果、ロックの行は `normal` のまま、badge は描かれず、`phase.lock()` は `strong` になる。
  - 規則: ロックの行の編集では、例外の有無にかかわらず、`finally` で `phase.lock()` のロールを使って badge を描き、行の値を作り直す。失敗の理由は行の説明に出す。
- 例外は「書き込みが失敗した」と「書き込みが成功した後の読み戻しが失敗した」を区別する(d-verify5 W-1)。行の再描画と badge の描画は `pi.getSettings()` を含む読み戻しを通るため、書き込みが成立した後に投げ得る。その失敗を書き込みの失敗として扱ってはならない(「設定できたのに `not saved` と出る」は、行がセッションの事実を示すという上の規則に反する)。成立した書き込みはそのまま `changes` に残して再読み込みを走らせ、行には「保存できたが行を描き直せない」旨の理由を出す。badge の描画は `phase.lock()` だけを使い、設定の読み戻しが失敗しても描画が止まらないようにする。
- strong の対象が未設定のとき、strong の `model` 行の説明は、代わりに応答する normal の対象のモデルを名指す(d-verify4 W-2)。設定済みで使えないときと同じ扱いにする。
- 候補からの除外は、`resolveModelTarget` と同じく `model.api === PI_VIRTUAL_MODEL_API` で判定する。provider / id の比較では、他の拡張が登録した仮想モデルが候補に残る。
- 対話 TUI かどうかは `ctx.mode === "tui"` で判定する（V9）。`hasUI` は RPC でも true なので、これで判定すると RPC の `custom()` が `undefined` を返して何も表示されず、「対話 TUI 以外では稼働状況を出す」要件を満たせない。
- ロールの `model` 行は `SelectList` の choices に `ctx.modelRegistry.getAvailable()` の結果（振り分け用モデルを除く）を出して選ばせ、確定値はコマンドと同じ `provider/id` で保存する。補完では選べないがパネルでは選べる、という非対称を認める（spec の「一覧でできる操作はコマンドでもできる」は満たす）。
- 代替: (b) は「1 行 1 コマンド相当の文字列」という表示意図を自由に出せるが、`Cmd+K` 系と見た目が違う固定ダイアログになり、端末幅とスクロールの処理が増える。モデル行を表示専用にすることも検討したが、モデル変更がコマンド 1 行分の手入力になるため採用しない。

### D12: 位相の再読み込み横断は `spirits_step` custom entry の「現在有効なステップ」記録で行う
- entry には **ステップ名だけ** を書く（`{ step: "opsx-propose" }`）。ロールと thinking レベルは entry に固定せず、毎回設定から解決する。設定を変えると継続中ステップのロールも変わるのが期待であり、entry に書いた瞬間の値を保持すると「リクエストごとに解決する」という要件に反する。
- **ステップが終わりるときに必ず「ステップなし」の記録（`{ step: null }`）を追記する**。終了条件（別の開始コマンド、一覧に無いスキル・テンプレートの起動、`/spirits-role <role>`、`/spirits-clear`、セッションの開始）と run settled 後の非継続ステップの終了のどちらも、記録を残してから位相を戻す。読み取りはブランチの末尾から最後の `spirits_step` を見るので、「終わった」が記録されたブランチでは何も復元されない。
- セッションの開始(reason が `reload` 以外)では、実行環境のメモリにステップが無くても、ブランチの最新の `spirits_step` が null でなければ `{ step: null }` を追記する(d-verify2 C-3)。終了の記録は位相の `end()` が出すが、`end()` はメモリ上のステップしか見ない。新しいプロセスで開いたセッションのメモリにはステップが無いので、何も記録されない。誤動作の例: 継続ステップの最中に pi を終了する → 記録は `{ step: "opsx-propose" }` のまま → 新しいプロセスでそのセッションを開く(`end()` は何も記録しない)→ 設定変更で `ctx.reload()` → 最新の記録から `opsx-propose` が復元される。記録の無いブランチと、既に null で閉じたブランチには何も足さない。これはステップの記録であり、「ロールの記録と復元」の「リクエスト以外の理由でロールを記録しない」には当たらない。
- 復元するのは `session_start` の reason が `reload` のときだけ。`startup` / `new` / `resume` / `fork` では復元しない（V7 の実集合。`clear` も `sidechain` も存在しない）。Pi の `/clear` は新しいブランチへ会話を書き換えるため、reason に `clear` は無い。
- 分岐間の移動（V11、`session_tree`）では、ステップを移動先の分岐の最新の `spirits_step` に合わせる（d-verify3 W-2 の決定）。記録がステップ名ならそのステップを継続中として復元し（`restoreStep` と同じく、記録は足さない）、`{ step: null }` か記録なしならステップを終える。終えるときも記録は足さない。移動先の分岐の記録がすでにその分岐の状態を表しているからで、ここで `end()` を使うと終了の記録が移動先の葉に追記されてしまう。ロックは分岐に合わせない（fork 経路の「分岐間の移動ではロックを変えてはならない」と同じ）。badge は再読み込みのときと同じ解決で描き直す。
  - 誤動作の例（合わせない場合）: `/opsx-propose` → `/spirits-clear` → `/tree` で 2 つの記録のあいだへ移る → メモリにはステップが無いが、移動先の分岐の最新の記録は `opsx-propose` → 設定変更の `ctx.reload()` で `opsx-propose` が復元される。移動の直後と reload の後で位相が変わり、status と badge も途中で変わる。
  - 合わせる方を選んだ理由: 継続中の `opsx-propose` で 1 つ前の回答を書き直すために移動したとき、移動先の分岐はまだ `opsx-propose` の中にある。移動でステップを終える案では、書き直した回答がロックのロールで走る。
  - 記録の値の種類ごとの扱い(d-verify4 C-3)。spec の列挙に合わせ、種類ごとに 1 つのテストを持つ。
    - 一覧に載るステップ名: そのステップを継続中にする。
    - `{ step: null }`、記録なし、一覧に無い名前、読み取れない値: ステップを外す。
    - どの場合も記録は足さない。
  - 一覧に無い名前を `restoreStep` に渡してはならない。`restoreStep` は再読み込み用の関数で、一覧に無い名前を無視する(何もしない)。そのため移動前のステップが残り、再読み込みの後(新しい実行環境ではステップなし)と食い違う。
  - 追従は managed 経路だけで行う(d-verify4 C-4)。`session_tree` のハンドラは routing 層(`routing/register.ts`)にあり、この層はフォーク経路と共有される。フォーク経路は `spirits_step` を書かない(`onStepChange` が return する)ので、そこで追従すると、移動先は常に「記録なし」と読まれ、継続中のステップが消える。したがってハンドラは `registerModelRoles` が無いときだけ登録する。フォーク経路のステップは、「strong フェーズの維持と解除」の終了条件でだけ終わる。
- 理由: ロックは既に `models.role`（設定）と `spirits_role`（セッション記録）の二重化で reload を跨いでいる。ステップも同じ型に載せ、終了を明示的に記録することで「最新の記録が継続中か否か」だけを問えばよい形にする。
- 誤動作の例（終了記録が無い場合）: `/opsx-propose` で entry → `/spirits-clear` でステップ終了（記録なし）→ 設定変更で `ctx.reload()` → 最新の `spirits_step` が `opsx-propose` なので終わったはずのステップが復元される。
- 代替: 終了時に entry を削除する案は、セッションファイルが追記専用なので削除できない。タイムスタンプで期限を持つ案は、reload の時刻と照合する必要が出て割に合わない。設定ファイルに current step を書くとセッション横断で漏れる。何も書かないと、設定書き込みごとに走る `ctx.reload()` でステップが消え、パネルで編集するたびに位相が壊れる。

### D13: ステップ一覧は `constants.ts` の 1 箇所に置き、spec と一致させる
- `{ name, defaultRole, continuing, starters: [...] }` の配列を 1 箇所に置き、spec の表との一致をテストする。
- 理由: 現在の一覧は phase.ts に 3 名前ハードコードで、spec の表と二重管理だった。
- 代替: `SKILL.md` や skill 名のパターンから動的列挙すると、bundled skill の追加が無断でステップになり、既定ロールを決められない。

### D14: TODO 開閉キーの既定を `ctrl+alt+p` に変える
- 選択肢: (a) `ctrl+alt+p`、(b) `ctrl+shift+l` のまま据え置き、設定で変えられる旨だけ強調する、(c) `alt+<letter>`。
- 採用: (a)。`ctrl+shift+<letter>` は、端末が Kitty keyboard protocol か xterm modifyOtherKeys で修飾キーを別途報告しない限り `ctrl+<letter>` と同じバイト列になる。`matchesKey` は `shift+ctrl` 節で旧式の制御文字を見ないため、`ctrl+shift+l` は `ctrl+l` のバイト列（0x0c）では決して一致せず、Pi の `app.model.select` が同じバイト列を既に握っている。実測（V10）では tmux 既定の `extended-keys off` でモデル選択が開き、`extended-keys on` + `csi-u` で発火した。 Spirits は Linux 単一バイナリで、tmux 経由の利用が前提に近いので、既定が環境依存で黙って効かないのは置けない。
- 実バイナリでの確認（V10）: 0.7.1 の実パネルで、`extended-keys off` の tmux では `C-S-l` がモデル選択を開くだけで開閉せず、`SPIRITS_TODO_TOGGLE_KEY=ctrl+alt+t` にすると同じ環境で `C-M-t` が `1 pending` への折りたたみと展開を切り替えた。既定値を変えるだけの修正で直ることが、 Spirits のコードを入れずに確かめられている。
- `ctrl+alt+p` は旧式でも `ESC` + 0x10 で届く（`matchesKey` の `ctrl+alt` 節は旧式形式を見る）。Pi の組み込みでは `ctrl+alt+]`（`tui.editor.jumpBackward`）だけが同じ系列で、衝突しない。素の `ctrl+p`（`app.model.cycleForward` など）は別のバイト列なので、両方は干渉しない。
- 2026-11-12 の実測（作業ツリーのバンドルを公式 Pi 1.5.0 + overlay の管理ルートで対話実行し、`extended-keys off` の tmux から `send-keys`）: 26 文字すべての `ctrl+alt+<letter>` ショートカットを probe 拡張で登録するとすべて発火し、組み込みとの衝突 warning は `ctrl+alt+]` だけだった。`ctrl+alt+<digit>`、`ctrl+alt+space`、`,`、`.` は 1 度も発火しない（`rawCtrlChar()` が英字と `[ \ ] _ -` 以外に `null` を返すため、旧式形式が存在しない）。`ctrl+alt+t` を既定キーとして開閉が両方向に動くことも同じ環境で確認した。
- `t` を避けた理由: 旧式形式としては同じく有効だが、Ubuntu のデスクトップ既定で `Ctrl+Alt+T` がターミナル起動に握られており、ターミナル外（Wayland/X のセッション）で spirits を動かす人にはキー自体が届かない。基底キーの制御バイトが別のキー名と重なる `h`（`ESC+0x08` = alt+Backspace）、`m`（`ESC+0x0d` = alt+Enter、Pi の追加発言キュー）、`i`（`ESC+0x09` = alt+Tab）、`j`（`ESC+0x0a` の行送り）、`[`（`ESC ESC`）も外し、残った 22 文字から衝突报告の実測がない `p` を選んだ。Pi 自身の既定も `windowsKeybindings` のときだけ `alt+<letter>` に逃げ、それ以外の端末では `shift+ctrl+p` のように修飾キー報告を前提にしている。
- 代替: (b) は「設定を変えないと動かない」状態を既定のまま置くことになる。(c) の `alt+t` は `ESC` + `t` で届くが、Escape 直後の `t` 入力と区別できず、中断の直後にパネルが化ける。Pi もアプリ層の既定で素の `alt+<letter>` を Linux では避けている。どちらも端末側・デスクトップ環境側の自用（Ubuntu の `Ctrl+Alt+T` でターミナル起動など）を完全には避けられないので、README に「効かないときは `todo.toggleKey` に端末が送る別のキーを書く」を残す。
- Pi 側の照合は変更しない（上流コア変更禁止）。 spirits 側の既定値と設定で回避する。

### D15: 要求の解決は 1 つの純関数にまとめ、ルーター・子・一覧が共有する
- 問題: 「どのロールを要求し、どのロールが応答し、どのモデルで、どの thinking レベルを載せるか」の組み立ては `createRoutingRoute` の中にしか無い。`rlm` の子と一覧は、構成要素の関数（`resolveRequestRole`、`resolveStrongTarget`、`resolveNormalTarget`、`resolveRequestThinkingLevel`）をそれぞれ並べ直していた。並べ直すたびに組み立ての一部が抜ける。d-verify1 C-11（使えない strong を「応答する」と表示）、d-verify2 C-2（ステップ行が設定値の写し）、d-verify3 C-1（thinking を要求したロールで解決）は、どれも一覧がルーターの結果と食い違う同じ種類の不具合である。
- 例（d-verify3 C-1）: strong 未設定、`thinking.strong=max`、`thinking.normal=low`、`opsx-propose` のロール strong。ルーターは normal で応答して `low` を載せるが、一覧は要求したロール（strong）で解決して「It asks for max」と出した。
- 採用: 副作用の無い関数を `routing/` に 1 つ置く。入力は、ステップ、設定、位相のロール、カタログ、セッションの thinking レベル、直近の成功レスポンス。返すのは、要求したロール、実際に応答するロール、応答するモデルとその出どころ、strong と normal の対象が使えなかったか、要求に載る thinking レベル（応答するロールで解決したもの）。
  - 通知（run ごとに 1 回）、例外（normal の対象が無い）、`onResolved` はルーターに残す。
  - 子は返り値のモデルとレベルを使い、エラー文の組み立てだけを自前で持つ。
  - 一覧のステップ行とロールの thinking 行は、返り値から文を作る。
- 型の扱い(d-verify4 C-1): 関数の返り値の thinking レベルは省略可とする(子と一覧は、セッションのレベルを持たないことがある)。一方、ルートの返り値の `ModelRoute.thinkingLevel` は必須である。ルートは、関数がレベルを返さないときに `request.thinkingLevel`(Pi が必ず渡すセッションの選択値)を返す。型を緩めて合わせてはならない。
- 検証: 期待値を手書きしない。条件の組み合わせごとに、ルーターの戻り値と、子・一覧の結果を突き合わせる（tasks 2.5）。期待値を手で書くと、テストを書く人と実装する人が同じ見落としを持つ。今回の 3 回目の食い違いがその例である。
- 代替: 構成要素の関数を並べる方式のまま、一覧のテストを増やす。上の理由で、同じ種類の食い違いを防げない。

## Risks / Trade-offs

- [継続ステップの取り違え] ユーザーが「ステップは終わった」と思って通常の質問を続け、強いモデルで課金される → Mitigation: `status` とパネルに現在のステップと継続中であることを常時出し、`/spirits-clear` で終われることを `usage` とパネル footer に出す。既定ロールは「未指定」(=ロック追従)が主で、strong 既定は review / deep verify の 2 ステップだけ。
- [パネルが拡張ごとクラッシュする] `SettingsList` / `SelectList` の theme や行の必須値を欠くと `render` 例外で拡張全体が死ぬ(V2) → Mitigation: theme と行生成を 1 つのビルダ関数に集約し、全必須キーを満たすユニットテストを持つ。`onSelect` 内の例外は catch して panel 内の通知行に出す（`openRolePanel` の `write` と `refresh` で捕まえる。tasks 5.4 の d-verify3 W-1。この対策は d-verify3 までどのタスクにも無かった）。catch した例外は、書き込みの成否と区別する。読み戻しの失敗を `not saved` にすると、行がセッションの事実を示さなくなる（d-verify5 W-1、tasks 5.4）。
- [解決の再合成による食い違い] 一覧や子がルーターの組み立てを並べ直すと、strong の fallback や thinking の解決の一部が抜け、画面とリクエストが食い違う（d-verify1 C-11、d-verify2 C-2、d-verify3 C-1） → Mitigation: D15 の関数を共有し、ルーターの戻り値との突き合わせテストで守る（tasks 2.5）。
- [分岐間の移動で位相と記録が食い違う] `/tree` で移ると、メモリのステップと移動先の分岐の記録が食い違い、後の reload で位相が変わる（d-verify3 W-2） → Mitigation: `session_tree` でステップを移動先の記録に合わせる（D12、tasks 3.7）。
- [routing 層のハンドラは両経路で共有される] `routing/register.ts` に足したイベントハンドラは、managed 経路とフォーク経路の両方で動く。managed 経路だけの記録(`spirits_step`)を前提にした処理がフォーク経路で走ると、記録が無いことを「ステップなし」と読んで位相を壊す(d-verify4 C-4) → Mitigation: managed 経路だけの処理は `registerModelRoles` の有無で登録を分ける。routing 層のハンドラのテストは、両経路で持つ(tasks 3.7)。
- [補完項目の形式] `label` 欠落で `applyCompletion` が死ぬ(V3) → Mitigation: 補完は必ず `{ value, label }` を返すヘルパ経由にし、`null` で候補なしを表す。
- [reload で位相が二重化される] 既存の `routing.register` は `session_start` で `models.role` を読み、`commands.register` は `session_start` で `spirits_role` の記録を当てる(read-modify-write)。ステップ復元を `session_start` に足すと、reason ごとに 2 つのハンドラが同じイベントを読むことになり、順序で結果が変わる → Mitigation: 復元対象の判定は reason を引数に取る純関数にし、`commands` 側の単一の `session_start` ハンドラで位相を確定させた後に routing へ渡す。テストで `reload` と `resume` の違いを検証する。
- [パネル書き込みと Pi の既定値の競合] パネルは既存の `patchGlobalSettings`（proper-lockfile）と同じ排他経路を使うため、Pi の `SettingsManager` と書き合いになっても片側のキーは失われない。多段マージとキー削除は新規実装なので、`models.steps` 1 件を変更してほかのステップと兄弟キーが残ること、Pi のキーが残ることを `packages/spirits/test/managed-commands.test.ts`（既存の `a settings write keeps the keys it was not told about, including pi's own` の隣）に追加する。
- [パネルのモデル一覧] `ctx.modelRegistry.getAvailable()` が一覧を開いた時点で空（認証が無い等）だと、`model` 行の submenu が空になる → Mitigation: 空のときは「利用可能なモデルが無い」という 1 行の submenu を出し、書き込みは行わない。選択候補から振り分け用モデルは api 値で除外する。
- [既定ロールの強い切替] `opsx-*` 実行中にモデル応答が変わり、従来 normal で走っていた人が strong 課金になる → Mitigation: 既定ロールは `sprt-opsx-*` の 2 つのみ strong。`models.normal` で明示できない人は、`/spirits-role <step> role unset` でロック追従に戻せる。
- [マトリクスの観測不能] パネルは RPC で観測できない(`custom()` が no-op) → Mitigation: 対応する行は `not-run` とし、detail に理由を残す。コマンド経路と同じ設定変化を RPC で観測できる行(`/spirits-role` 構文)で設定面の回帰を守る。
- [`/spirits-model` の即削除] 既存ユーザーの設定書き込み手順・ドキュメント・自分のショートカットが壊れる → Mitigation: `docs/spirits-managed-pi.md` の限定互換モードの表に移行表を書き、`docs/spirits-managed-pi-design.md` のコマンド対応表を同じ変更で更新する（spirits に CHANGELOG の前例は作らない）。
- [書き込み直後の設定読み取り] `pi.getSettings()` は `ctx.reload()` まで書き込み前の値を返す → Mitigation: 設定書き込みの直後に行う判定(警告、一覧の説明の更新)は、読み取った設定に書き込んだ経路と値を重ねたもので行う。fake host は設定を固定で返すので、テストでは「書き込みを `pi.settings` に反映しない」fake で誤警告が出ないことを確かめる(D4)。
- [一覧から抜けられない] サブメニューは入力をすべて受け取るので、Esc を処理しない部品を出すと一覧が閉じられなくなる → Mitigation: `SelectList` の `onCancel` とモデル 0 件の案内部品の両方で `done()` を呼び、Esc で閉じることを部品単位のテストで確かめる(D11)。
- [直近のリクエストの消失] `status` と一覧が出す直近のリクエストは拡張の実行環境のメモリにだけあり、設定書き込みに伴う `ctx.reload()` で消える → 受け入れる制約とする(d-verify1 W-4 の決定)。Pi のメッセージ記録は物理モデルしか持たず、要求した thinking レベルを持たないので、リクエストごとに spirits の記録を増やさない限り復元できない。`status` は「再読み込み以降にリクエストが無い」旨を出し、`docs/spirits-managed-pi.md` の既知の制約に書く。
- [互換ランナーが作業ツリーを測らない] `scripts/managed-pi-compat/run.ts` の fixture モードは `--bundle` を無視し、インストール済みの managed set の拡張を測る。作業ツリーの変更を測ったつもりで、旧い拡張の結果を記録してしまう → Mitigation: fixture モードで `--bundle` を受け付け、指定時はその bundle を入れた一時 managed root を作って測る。結果の `runtime` に測った拡張のパスと sha256 を残す。
- [既定の開閉キーが端末に届かない] `ctrl+shift+<letter>` は修飾キー報告を伴わない端末では `ctrl+<letter>` と区別できず、しかもそのバイト列は Pi が組み込みで使っている（`ctrl+l` はモデル選択） → Mitigation: 既定を `ctrl+alt+p` に変える（D14）。`todo.toggleKey` / `SPIRITS_TODO_TOGGLE_KEY` で変更できることを README に書く。

## Migration Plan

- 設定の読み取りは追加のみで、既存キー（`models.role`、`models.strong`）の形は変えない。`models.normal` と `models.thinking.*` と `models.steps.*` が無ければ未設定として動き、既存セッションの挙動は変わらない。
- `models.normal` 未設定時は従来どおり Pi の既定モデルが normal の対象なので、アップグレード直後の課金特性は変わらない。
- `/spirits-model` は削除し、旧設定キーは書き込まない。旧キーが残った設定ファイルは読み捨て、次の書き込みで新しい形になる。
- ドキュメント（`docs/spirits-managed-pi.md`、`docs/spirits-managed-pi-design.md`）と同じ変更で更新し、`/spirits-model` からの移行表も同じ 2 ファイルに書く。CHANGELOG は作らない。実測記録（`docs/agent-data-compat/` の result.json）は当時の観測なので書き換えない。`docs/spirits-managed-pi-design.md` の「拡張コマンドを足す」方針の表とマトリクス 9 目的の記述が `/spirits-model` 前提になっている。
- TODO 開閉キーの既定値は `ctrl+alt+p` に変わる。旧キーに慣れた人は `todo.toggleKey` に `ctrl+shift+l` を書けば元に戻せる（ただし端末が修飾キーを報告しなければ効かない）。README の設定表と注意書きを同じ変更で更新する。
- ロールバックは拡張 bundle の差し戻しで足りる(新しい設定キーは旧拡張が読み捨て、Pi の読み書きに影響しない)。

## Open Questions

- 一覧の行の順序、説明文の文案、`status` の項目順は、実装時に管理バイナリの対話 TUI で画面を見て詰める(要件は内容の網羅のみを決め、並び順は決めない)。
