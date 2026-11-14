# 検証レポート: unify-spirits-role-command

使用する変更: `unify-spirits-role-command`（別の変更を見るには `/opsx-verify <other>`）

## サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 41/41 タスク完了、ADDED+MODIFIED 32 要件（削除 2 件を確認、改名 0 件） |
| 正確性 | 32/32 要件をカバー（うち 2 要件は部分一致・要修正） |
| 一貫性 | 問題あり（警告 5、提案 4） |

実行した確認:

- `openspec validate --strict`: 有効
- 関連ユニットテスト 16 ファイル: 232 pass / 0 fail
- `npm run check`: エラー・警告なし
- `/spirits-model` の登録・定数・コード参照が消えていること、移行表が docs にあること
- ステップ表と `STEP_DEFINITIONS` の一致、`ctrl+alt+p` への既定値変更、`registry:layers` の更新

## 重大

なし。

## 警告

### 1. `/spirits-role status` とパネルの「ロック」が実効ロールを表示している

- `packages/spirits/src/commands/register.ts:185`, `:201` が `lock: deps.phase.current()` を使う。
- `packages/spirits/src/routing/phase.ts:170` の `current()` は `active?.defaultRole ?? lock` を返すため、既定ロールが `strong` のステップ実行中は、セッションのロックが `normal` でも `lock: strong` と表示される。仕様は「ロック」と「現在のステップ」を別項目として出すことを求めている。
- 推奨: `RoutingPhase` に生のロックを返す `lock()` を追加し、`statusReport` とパネルのロック行で使う。`normal` ロック＋`sprt-opsx-review-change` 実行中に `lock: normal` / `step: sprt-opsx-review-change` になるテストを追加する。

### 2. パネルのモデル候補が api ではなく provider/id で振り分け用モデルを除外している

- `packages/spirits/src/commands/role-panel.ts:76-79` が `provider === "spirits" && id === "auto"` で除外する。
- 仕様「振り分け用モデルの除外は api 値で行う」は `api === "pi-virtual"` を求め、名前に依存してはならない。`role.ts` の `resolveModelTarget` は api で判定しているが、パネルで選んだ値はその解決を通らず直接保存される。`spirits/auto` 以外の名前の仮想モデルが候補に出て保存され得る。
- 推奨: `model.api !== PI_VIRTUAL_MODEL_API` で除外する共通述語を使い、`provider: "other", id: "virtual-x", api: "pi-virtual"` が候補に出ないテストを追加する。

### 3. `ARCH-PI-BOUNDARY` の内容・例外文が `registry:layers` と食い違ったまま

- `docs/architecture/convention-registry.md:162-163` は「src の全層が packages/tui へ依存可能」のままで、`registry:layers` の `spirits:routing`（`docs/architecture/convention-registry.md:39`）と矛盾する。
- 仕様は「`routing` への許可は `packages/coding-agent` だけ」「例外文は `registry:layers` と食い違わないように同じ変更で更新する」を MUST で求めている。
- 推奨: 内容と例外文を「`routing` を除く全層」に直し、`routing` は `packages/coding-agent` のみ許可する旨を明記する。

### 4. パネル書き込み失敗の理由が一覧内に出ない

- `packages/spirits/src/commands/role-panel.ts:285` は失敗理由を `ctx.ui.notify()` で外に出し、一覧にはエラー行がない。
- 仕様は「書き込みに失敗した項目は表示を元の値に戻し、理由を一覧内に出す」を求めている。
- 推奨: 失敗理由を保持する行（または選択行の説明欄）を一覧内に表示し、`rows()` のテストで理由が出ることを確認する。

### 5. `status` が strong の「使用不可の理由」を出さない

- `packages/spirits/src/commands/role.ts:373-380` は `target: "unusable"` とだけ表示し、資格情報が無いのかカタログに無いのかを出さない。
- 仕様は「未設定と使用不可の区別とその理由」を求めている。
- 推奨: `resolveStrongTarget` が失敗理由（カタログ不在／資格情報なし／仮想モデル）を返し、`roleResolutionLine` に載せる。理由ごとのテストを追加する。

## 提案

### 1. design.md の V2 と D11 が実際の pi-tui 型と異なる

- `openspec/changes/unify-spirits-role-command/design.md:20` は `SelectList` theme を `{ selectedBg, text, selectedText, description, footer }` の 6 値とするが、実際は `{ selectedPrefix, selectedText, description, scrollInfo, noMatch }` の 5 値。D11 の「footer を提供」も実際の型にない。
- 推奨: design.md の V2/D11 を実際の型へ修正する（実装側は正しい型に一致している）。

### 2. 未使用の `stepForStarter`

- `packages/spirits/src/routing/phase.ts:107` の関数がどこからも使われていない。推奨: 削除する。

### 3. ステップ編集の「2 段選択」が別々の行になっている

- タスク 5.4 はステップの 2 段 `SelectList` submenu を求めるが、実装は `<step> role` 行と `<step> thinking` 行を独立に編集する。仕様の結果（ロール削除後に thinking が残る）は満たすが、タスクの記述とはずれている。推奨: 連結した submenu にするか、タスク／design の表現を実装に合わせる。

### 4. README の文言

- `packages/spirits/README.md:316` の「モデル選択を清空する」は意図が読み取りにくい。推奨: 「モデル選択を開く」などへ直す。

## 最終評価

重大な問題はありません。考慮すべき警告は 5 つあります。アーカイブの準備ができています（改善点が指摘されています）。提案は 4 件あります。端末実観測に依存するシナリオ（TODO 既定キー、`/spirits-role` 一覧）はタスク 7.3 / 9.3 の記録に依拠しており、今回の検証では再実行していません。
