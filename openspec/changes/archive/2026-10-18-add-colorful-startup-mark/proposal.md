# Proposal

## Why

現在の起動ヘッダは `spirits` のワードマークとバージョン、キーヒントだけで、ASCII アートは含まれていない。pi 由来のロゴも spirits のセッションでは表示されない(`ctx.ui.setHeader` がカスタムヘッダに差し替えるため、pi の built-in ロゴはマウントされない)。その結果、起動画面に spirits 固有の图形が無く、pi との区別が視覚的に伝わらない。ヘッダは毎回表示されるので、同じ画面で最も安くアイデンティティを伝えられる。フェーズ(M1〜M5)に依存しない変更で、対象も spirits 拡張 1 ファイルに収まるため、今まとめて整える。

## What Changes

- 起動ヘッダの最上部に Spirits の ASCII アート(4 行)をカラー表示で追加する
- 4 行すべてに互いに異なるテーマカラーを割り当てるため、`HeaderThemeColor` に 4 種目のトークンを追加する
- バージョン表記とキーヒントはアートの下に配置(従来レイアウトを維持)
- 仕様を分担し、ヘッダ全体の構成(アート最上部 → ワードマーク+バージョン → キーヒント → オンボーディング)は `product-identity`、アート本体と行別の色は `colorful-startup-mark` が単独で規定する
- `docs/spirits-design.md` の TUI ヘッダの記述を新しい構成に更新する

## Capabilities

### New Capabilities

- `colorful-startup-mark`: 起動ヘッダに表示する Spirits ASCII アートの内容と、行ごとのテーマカラーの規則

### Modified Capabilities

- `product-identity`: 起動ヘッダの構成に、最上部の ASCII アートを追加する

## Impact

- 影響コード: `packages/spirits/src/branding/header.ts`(`SpiritsHeader.render()` にアート 4 行を追加、`HeaderThemeColor` を拡張)
- 影響テスト: `packages/spirits/test/branding-header.test.ts`(アート行・行別カラー・展開状態・順序のアサート)
- 影響ドキュメント: `docs/spirits-design.md`(製品 identity 節の TUI ヘッダ記述)
- pi 上流コア差分: なし(spirits 拡張の `ctx.ui.setHeader` のみを使用。pi の `ThemeColor` と `Theme.fg()` は読み取りのみで、トークンの追加やコア変更は行わない)
- 依存関係: なし
- システム: テーマカラー 4 トークン(ビルトインテーマでは `border` / `accent` / `dim` / `muted`)をアート各行に割り当てて描画
