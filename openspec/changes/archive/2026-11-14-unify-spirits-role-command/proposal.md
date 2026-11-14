# Proposal

## Why

managed 経路のロール操作が `/spirits-role`（ロールのロック）と `/spirits-model`（モデル・thinking レベル・ロールを 1 行）に分かれ、さらに OpenSpec の各コマンドと同梱スキルはロールを変えないため、ステップごとに使い分けたいモデルを指定する手段が無い。`/spirits-model` の役割は公式 Pi 1.5.0 の `/model`（セッション選択と既定保存）と `/thinking`（既定保存）で足り、振り分けの設定はロール単位でないと表現できない。モデル選択系を `/spirits-role` 1 コマンドに集約し、ステップ（スラッシュコマンドで始まる作業区間）単位のロール・thinking レベル設定と、稼働状況の確認手段をそこに載せる。

## What Changes

- **`/spirits-role` を「対象 項目 値」の文法に拡張する**。`/spirits-role`（パネル）、`status`、`<role>`（従来どおりのロック）、`<role> model <ref>`、`<role> thinking <level>`、`<step> role <role|unset>`、`<step> thinking <level|unset>`。値に `unset` を書くと設定キーを削除する。書き込みは既存の設定書き込み手順（同じロック、global のみ）を使い、`ctx.reload()` で反映する。**BREAKING**（引数の意味が変わる。ただし従来形 `/spirits-role <role>` はそのまま有効）。
- **`/spirits-model` を廃止する**。コマンド登録・ハンドラ・定数・テスト・文書の記載を削除し、モデル参照の解決（`provider/id` 完全一致 → 部分一致 1 件、virtual model は api 値で除外）は `/spirits-role <role> model <ref>` が引き継ぐ。別名と非推奨期間は設けない。**BREAKING**。
- **ロールにモデルと thinking レベルを持たせる**（設定は Pi の global settings の `models` 配下）。既存の `models.role` / `models.strong` に加え、`models.normal`（normal のモデル。未設定なら Pi の既定モデル）、`models.thinking.<role>`（ロールの thinking レベル。未設定ならセッションの選択値）を追加する。`models.normal` が設定済みで使えないときは run ごとに 1 回通知する（strong と同じ扱い）。
- **ステップ設定を追加する**。`models.steps.<step>` に `role` と `thinking`（どちらも省略可）を持つ。ステップ一覧は定数で、OpenSpec の 12 コマンド（`/opsx-*` と対応する `/skill:openspec-*`）、`/skill:sprt-opsx-review-change`、`/skill:sprt-opsx-verify-deep`、`/skill:sprt-architecture-guards`。ステップの既定ロールは 2 つのレポート系スキルが `strong`、ほかは「未指定（ロックに従う）」。
- **ステップの継続を導入する**。継続するステップは run が settled した後も有効で、質問への回答や追加指示が同じロール・thinking レベルで走る。継続しないのは既存の 2 スキル（settled でロックへ戻る）。ステップは別ステップの開始、一覧に無いスキル・テンプレートの起動、`/spirits-role <role>`、`/spirits-clear`、セッション開始（新規・復帰・分岐作成）で終わる。managed 経路の再読み込みではロックと継続中のステップを保ち、ステップが終わりるときは「ステップなし」を記録するので、終わったステップは復元しない。分岐間の移動（`/tree`）では、ステップを移動先の分岐の最新の記録に合わせる。
- **解決順をリクエストごとに決める**（ロール: ステップ → ステップの既定 → ロック／モデル: ロールの対象、strong は normal へフォールバック／thinking: ステップ → 実際に応答するロール → セッションの選択値。対象モデルへの丸めは Pi に任せる）。`rlm` の子は親の run と同じ解決を受け取る。
- **`/spirits-role` の対話 TUI パネルを追加する**。1 行 1 設定項目で、選択行の説明文に解決結果を出す。部品は pi-tui の `SettingsList` / `SelectList` と `ctx.ui.custom()` を使い、独自の grid 部品は作らない。対話 TUI であることの判定は `ctx.mode`（`hasUI` は RPC でも true になる）。対話 TUI 以外では一覧を開かず `status` と同じ出力を出す。ロールのモデルの行は `SelectList` の候補（`ctx.modelRegistry.getAvailable()` から振り分け用モデルを除く）から選べる。補完ではモデルを選べない。パネルは固有の状態を持たず、できる操作はすべてコマンド文法でもできる。
- **`/spirits-role status` を追加する**。振り分けが有効か、ロック、現在のステップと継続の有無、直近のリクエストのロール・物理モデル・要求した thinking レベル、normal と strong の解決結果と出どころ、既定と異なるステップ設定、読み取れずに無視した設定値を 1 件の通知に出す。
- **設定時の警告を追加する**。strong をロック／ステップに設定したときに strong のモデルが未設定または使えない場合、設定は行ったうえで normal で走る旨と設定コマンドを 1 行伝える。セッションが物理モデルを選んでいる場合は振り分けが働いていないことと `spirits/auto` で有効になることを伝える。
- **公式 `/model` の既定保存の観測方法を決める**。RPC の `set_model` はセッションのモデル選択だけを変え、既定保存は対話 TUI のモデル選択画面（Ctrl+S）にしかない。したがって既定保存は RPC から観測できない行として `not-run` と理由を記録し、セッション選択は RPC で観測する。
- **互換性ランナーと文書を整備する**。`MODEL_PURPOSES` 3 行（`thinking-level` / `role-selection` / `default-save`）と `docs/spirits-managed-pi.md` の機能表・既知の制約・劣化通知の文言を、`/spirits-model` に依らない新しい手段と状態に置き換える。
- **TODO パネルの開閉キーの既定値を変える**。既定の `ctrl+shift+l` は、修飾キーを報告しない端末では `ctrl+l` と同じバイト列になる。実測では tmux（既定の `extended-keys off`）で `ctrl+shift+l` がモデル選択を開き、 spirits の開閉は発火しなかった。tmux を `extended-keys on` / `extended-keys-format csi-u` にすると発火するため、キー選択が端末の修飾キー報告に依存している。加えて WezTerm など端末側が `ctrl+shift+<letter>` を自用することがある。既定を `ctrl+alt+p` に変える（実測で `extended-keys off` の tmux でも発火し、Pi のどの組み込みキーとも衝突しない）。`todo.toggleKey` と `SPIRITS_TODO_TOGGLE_KEY` で上書きできる規則は変えない。**BREAKING**（既定キーが変わる。設定で旧キーに戻せる）。
- **アーキテクチャの許可表を更新する**。パネルが `@earendil-works/pi-tui` を import する必要があるため、`spirits:commands` の許可先に `packages/tui` を正本（`docs/architecture/convention-registry.md`）と検査に同一変更で反映する。
- **CHANGELOG は作らない**。spirits には CHANGELOG の前例が無く、移行表は `docs/spirits-managed-pi.md` と `docs/spirits-managed-pi-design.md` に書く。
- **Pi 上流コアへの変更は行わない**（差分なし）。開閉キーは spirits 側の既定値と設定で直す。Pi のキー照合自体は端末が修飾キーを送らないと `ctrl+shift+<letter>` を `ctrl+<letter>` と区別できないため、 spirits 側で回避するほかない。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `managed-commands`: managed 限定のコマンド登録から `/spirits-model` を外す。`/spirits-role` の文法（対象 項目 値）、ロール別のモデルと thinking レベルの設定、ステップ設定、TUI パネル、`status`、設定時の警告、`unset` によるキー削除、モデル参照の引き継ぎを追加・変更する。`/spirits-model` の 1 行選択は削除（Reason / Migration を差分に書く）。
- `dual-model-routing`: ワークフローのステップ別ロールをロール指定付きのステップ一覧へ置き換え、ステップの開始・継続・終了、thinking レベルの解決、ロール別モデル（`models.normal`）とステップ設定の読み取り、再読み込みを跨いだロックと継続中ステップの維持、`rlm` の子への受け渡しを変更する。
- `managed-pi-compatibility`: role と clear と model の互換性マトリクスから `/spirits-model` 由来の目的と代替手段を外し、`/spirits-role` の新しい文法・パネル・status を観測対象に含める。対話端末限定の一覧は RPC で観測できないため、その旨を記録する。
- `architecture-conventions`: 層の許可表に `spirits:commands` → `packages/tui` を載せ、`spirits:routing` が `packages/coding-agent` のみへ依存できることを保つ。あわせて「spirits と Pi 上流の境界を強制する」の例外文が全層に `packages/tui` を許可したままだと矛盾するので、`routing` の例外を同じ変更で書く。
- `session-todo`: 既定の開閉キーを `ctrl+shift+l` から `ctrl+alt+p` へ変える。要件として「既定の開閉キーは、端末が修飾キーを別途報告しなくても他のキーと区別できること」を追加し、既定キーを出すシナリオを新しいキーに追従させる。

## Impact

- **Pi 上流コアへの差分: なし。** `packages/coding-agent`、`packages/ai`、`packages/tui` のソースは変更しない。
- コード（`packages/spirits/`）:
  - `src/constants.ts`: `models` 配下の新キー（`normal` / `thinking` / `steps`）、ステップ一覧の定数、継続の既定、パネル・status の文言、`COMMAND_SPIRITS_MODEL` の削除、ステップ用の session entry 種別。
  - `src/config.ts`: `RoutingSettings` に normal の対象・ロール別 thinking・ステップ設定を追加し、既存と同じ読み取り規則（型違い・空・語彙外は未設定）で読む。
  - `src/routing/`（`phase.ts` / `router.ts` / `resolve.ts` / `child.ts` / `register.ts`）: ステップ位相、解決順、normal の `models.normal` 優先、thinking の解決、子への受け渡し。
  - `src/commands/`: `model.ts` を削除し、参照解決は新しい役割（`/spirits-role <role> model`）へ移す。`role.ts` に文法解釈・status・警告、`role-panel.ts`（新）に `SettingsList` ベースのパネル、`settings-store.ts` に多段のマージとキー削除（既存 `mergeFields` は 1 段マージなので新実装）、`register.ts` に登録と補完。
  - `src/types/`: `pi-coding-agent.d.ts` に `ctx.mode`、`ctx.ui.custom()`、`pi.getCommands()`、`getArgumentCompletions` の型、`pi-tui.d.ts` に `SettingsList` / `SelectList` の型ミラー。
  - `src/index.ts`: パネルとコマンドの配線。
- TODO 開閉キー: `src/constants.ts` の `DEFAULT_TODO_TOGGLE_KEY`、`packages/spirits/README.md` の設定表と注意書き。
- アーキテクチャ: `docs/architecture/convention-registry.md` の `registry:layers` で `spirits:commands` に `packages/tui` を追加し、同一変更で `packages/spirits/test/architecture/` の検査・fixture を追従させる。
- 設定の互換性: `models.role` / `models.strong` は不変。`models.normal` / `models.thinking` / `models.steps` は追加のみで、未設定なら現行の挙動。fork 経路（role API あり）にはコマンドを登録せず、同じ振り分けコードが新しい設定キーを読む。
- テスト: `packages/spirits/test/` の `config`（既定の開閉キーを含む）、`routing-*`、`routing-phase-wiring`、`routing-router`、`routing-resolve`、`routing-child-model`、`managed-commands`、`managed-commands-clear`、`extension-degradation`、`architecture-conventions`、`managed-pi-build-inputs`、`managed-pi-compat-*` を追従。`/spirits-model` のケースは削除または `/spirits-role` 形へ書き換える。
- ハーネス: `scripts/managed-pi-compat/`（`matrix.ts` の目的定義、`run.ts` の駆動と観測、`rpc.ts` の `set_thinking_level` / `set_model` 送信、`fake-provider.ts` の要求本文の記録、`fixtures/custom-provider.ts` の thinking 対応モデル定義、`fixtures/probe-extension.ts` の読み戻し）。
- docs: `docs/spirits-managed-pi.md`（機能表・限定互換モード・既知の制約・互換性ランナーの観測・`/spirits-model` からの移行表）、`docs/spirits-managed-pi-design.md` の `/spirits-model` を挙げる箇所と移行表、`packages/spirits/README.md` の設定キー（`models.normal` / `models.thinking` / `models.steps`）と TODO 開閉キーの既定値。
- 非目標: run の途中でのロール切り替え（アーティファクト単位）、3 つ目以降のロール、ステップへのモデルの直接指定、自然言語の依頼・モデルによるスキルの自動読み込み・`openspec` CLI 呼び出しのステップ化、一覧に無いコマンドのステップ化、fork 経路へのコマンド追加、badge の表記変更、project 設定への書き込み、Pi 上流コアの変更。
