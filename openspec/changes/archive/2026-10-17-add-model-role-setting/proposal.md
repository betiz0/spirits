# Proposal

## Why

`spirits/auto` はリクエストを normal / strong の 2 ロールへ振り分けるが、利用者が明示的にロールを選ぶ手段がない。現在は対象スキルの起動で自動に strong へ切り替わるだけで、`add-dual-model-routing` が 2 ロールを実装して以降、手動で strong を試すも normal に固定するもできない。`/model` の引数最後の語に `normal` / `strong` を受け、CTRL+s で既定ロールとして保存できれば、モデルの選択と同時に、かつ恒久的に利用者の意図を反映できる。

## What Changes

- **BREAKING** `/model` の引数最後の語が `normal` / `strong`（大文字小文字を区別しない）の場合、最後の語をロール名、それより前の部分をモデルの検索語として扱う。従来 `/model foo strong` は `foo strong` 全体を検索語にしていた。最後の語が thinking レベル名でもロール名でもない場合は、従来どおり引数全体を検索語として扱い、エラーにはしない
- thinking レベルとロールは `/model <model> <level> <role>` の順でだけ同時に指定できる
- `/model <model> <role>` を Enter で送ると、モデル切り替えと同時にセッションのロールを**ロック**する。ロック中の idle 入力ではロールを normal に戻さない
- **BREAKING** 対象スキル（`sprt-opsx-review-change` / `sprt-opsx-verify-deep`）の起動はロック中でも strong へ遷移し、run が settled したあとは normal ではなくロックしていたロールへ戻す（ロックと既定ロールが無ければ従来どおり normal）
- `/model <model> <role>` に CTRL+s を押すと、既定モデルの保存に加えて既定ロールを小文字に正規化して設定ファイルに保存する。保存したことの表示に `Default role: <role>` を加える
- 物理モデルを指定した場合もロールの設定と保存を行う。振り分けは `spirits/auto` が選択されているセッションにのみ適用されるので、設定したロールは `spirits/auto` を選び以降のリクエストから効く
- `/model` の 2 語目補完に `normal` / `strong` を加え、引数ヒントを `<provider/model> [level] [role]` にする
- セッションの開始時（起動、`/new`、復帰、分岐作成、再読み込み）に、ロックを既定ロールに置き換える。分岐間の移動ではロックを変えない。記録の無い新しいセッションで現在のモデルが `spirits/auto` のときだけ、そのロールをセッションに記録してバッジに出す
- pi コアに、拡張がロール語彙と既定ロールの保存先を登録する拡張 API を追加する

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `model-commands`: `/model` が末尾の語として thinking レベルとロールを受け、セッションのロールを設定し、CTRL+s で既定ロールとして保存する。selector 経由・2 語目補完・引数ヒント・保存表示にもロールを反映する
- `dual-model-routing`: セッションのロールをロックとして扱い、既定ロールをセッション開始時の初期ロールとして適用する

## Impact

- 影響コード:
  - `packages/spirits/src/routing/`（`phase.ts` のロック化、`register.ts` の開始時の適用とロール語彙の登録。`router.ts` は変更しない（`phase.current()` をそのまま読む））
  - `packages/spirits/src/config.ts`、`packages/spirits/src/constants.ts`（既定ロールの読み取りと設定キー）
  - `packages/spirits/src/types/`（`pi-coding-agent.d.ts`、`pi-subpaths.d.ts`: 登録 API と pin テスト用の型）
  - `packages/spirits/test/`（`config.test.ts`、`routing-phase.test.ts`、`routing-register.test.ts`、`routing-router.test.ts`、`routing-integration.test.ts`、`routing/fake-pi.ts`、`pi-runtime/model-roles-api.test.ts`、`harness-install.test.ts`、`todo-tool.test.ts`）
  - `packages/coding-agent/src/core/extensions/`（`types.ts`、`loader.ts`、`runner.ts`、`index.ts` にロール語彙の登録 API）
  - `packages/coding-agent/src/index.ts`（登録 API の型の export）
  - `packages/coding-agent/src/modes/interactive/model-command-args.ts`（末尾語のロール解析、2 語目補完）
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts`（ロールの拡張への通知、保存、ステータス表示）
  - `packages/coding-agent/src/core/settings-manager.ts`（既定ロールの保存）
  - `packages/coding-agent/src/core/slash-commands.ts`（`/model` の引数ヒント）
  - `packages/coding-agent/test/`（`model-command-args.test.ts`、`interactive-mode-model-command.test.ts`、`settings-manager.test.ts`、`custom-editor-submit-shortcut.test.ts`、`model-roles.test.ts`、`interactive-mode-status.test.ts`）
  - `packages/coding-agent/docs/extensions.md`（登録 API の説明）
  - `docs/spirits-core-diffs.md`（`[spirits]` コミットの登録簿）
  - `README.md` / `README.ja.md` / `README.de-CH.md` / `README.zh.md`（使い方と解除方法）
- pi 上流コア差分: あり。`[spirits]` プレフィックスのコミットで分離する。コアは `normal` / `strong` という語彙を知らず、拡張が登録した語彙を opaque な文字列として扱う（design Decision 1 と Decision 9）
- 依存関係: なし
- システム: 設定ファイルに、spirits 所有キー `models.strong` と同じ枠組みで `models.role` を追加する。コアは未知キーを保持する（design Decision 4）
- 後方互換: 既存の `/model` 引数の解釈が変わるのは、最後の語がちょうど `normal` / `strong` のときだけである。既定ロールは新規キーで、無い場合は従来どおり normal 開始
