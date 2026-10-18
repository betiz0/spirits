# Tasks

## 1. ヘッダへのアート追加

- [x] 1.1 `HeaderThemeColor` を `"accent" | "border" | "dim" | "muted"` に拡張し、`packages/spirits/src/branding/header.ts` に ASCII アート定数(4 行)を追加する。検証: `bun test packages/spirits/test/branding-header.test.ts` が成功すること(既存ケースが壊れていないこと)
- [x] 1.2 `SpiritsHeader.render()` の返す行配列の先頭にアート 4 行を追加し、1 行目 `border` / 2 行目 `accent` / 3 行目 `dim` / 4 行目 `muted` を `theme.fg()` 経由で適用する。検証: 新ケース `colors each art line with a distinct theme token` が成功すること(`fg()` の第1引数を記録する fake theme を使い、アート 4 行に渡ったトークン名が互いに異なることをアサートする)
- [x] 1.3 折りたみ状態と展開状態の両方でアート 4 行が表示されることを確認するテストケースを追加する。検証: 新ケース `shows the art lines in collapsed and expanded help` が成功すること
- [x] 1.4 `product-identity` MODIFIED 要件(アート最上部 → ワードマークとバージョン → キーヒント → オンボーディングの順)を検証する。検証: 既存ケース `shows the spirits wordmark and version without pi onboarding` に順序とアート存在のアサートを追加し、同ケースが成功すること
- [x] 1.5 テーマ変更追従を検証する。検証: 新ケース `art colors follow the theme color resolution` が成功すること(トークン→色の対応を入れ替えた fake theme でアート行の出力が変わり、アート本文の文字列は変わらないことをアサートする)
- [x] 1.6 ビルトインテーマで解決後の色が別解であることを検証する。`packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `loadThemeFromPath` で `truecolor` と `256color` の両方で読み、`ART_LINES` の 4 トークンの `theme.fg(token, "")` 出力が 4 種類であることをアサートする。検証: 新ケース `art tokens resolve to distinct colors in built-in themes` が成功すること

## 2. 正本ドキュメントの更新

- [x] 2.1 `docs/spirits-design.md` の製品 identity 節の TUI ヘッダ記述に、アート 4 行と行別トークン(`border` / `accent` / `dim` / `muted`)を追記する。検証: `rg -n "ASCII アート" docs/spirits-design.md` が TUI ヘッダの行を返すこと
- [x] 2.2 `docs/spirits-design.md` の TUI ヘッダ記述から、アート本文と行別トークンの割り当てを除き、`colorful-startup-mark` への参照に置き換える(正本の二重化を避ける)。同じ行の脱字「オンボーディング文この順で」を「オンボーディング文をこの順で」に直す。検証: `rg -n "ASCII アート" docs/spirits-design.md` が TUI ヘッダの行を返し、`rg -n -F '| Spirits' docs/spirits-design.md` が何も返さないこと

## 3. 統合確認

- [x] 3.1 `cd packages/spirits && bun test` がすべて成功し(リポジトリルートからの `bun test packages/spirits/` は `packages/spirits/bunfig.toml` の preload を読まないため使わない)、リポジトリルートで `npm run check` が exit 0 であることを確認する
- [x] 3.2 `bun scripts/build-binaries.ts --version <version>` で `dist/spirits-linux-x64` を再ビルドし、`dist/spirits-linux-x64.sha256` が更新されていることを確認する
- [x] 3.3 `.pi/skills/interactive-testing.md` に従い tmux で再ビルドした `spirits` を対話起動し、(a) ヘッダ最上部にアート 4 行、(b) 4 行が互いに違う色、(c) 展開キーでキーヒント展開後もアートが残る、を目視確認する
