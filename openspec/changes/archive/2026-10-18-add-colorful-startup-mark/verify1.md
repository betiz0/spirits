# 検証レポート: add-colorful-startup-mark

検証日時: 2026-10-18（verify1、`/opsx-verify`）
スキーマ: `spec-driven`（proposal / specs / design / tasks すべて存在、意図的なスキップなし → 未検証のチェックなし）

## サマリー

| 観点 | 状態 |
|--------------|--------------|
| 完全性 | 9/9 タスク完了、要件 3 件（ADDED 2 / MODIFIED 1、REMOVED・RENAMED なし）すべてに実装 |
| 正確性 | 3/3 要件をマッピング、シナリオ 4 件中 3 件を専用テストで検証（警告 1） |
| 一貫性 | design の 4 決定すべてに準拠、pi 上流コアは無変更 |

## 証拠

- `openspec instructions apply` の `progress`: total 9 / complete 9 / remaining 0（`taskTrackingConfigured: true`、`unavailableTrackingFiles` なし）
- 再実行した検証:
  - `bun test packages/spirits/test/branding-header.test.ts` → 11 pass / 0 fail（タスク 1.1〜1.5）
  - `bun test packages/spirits/` → 563 pass / 0 fail（59 files、タスク 3.1）
  - `npm run check`（リポジトリルート）→ EXIT=0（タスク 3.1）
- `openspec validate add-colorful-startup-mark --strict` → 有効（タスク 3.1 の補助）
- `rg -n "ASCII アート" docs/spirits-design.md` → 186 行目の TUI ヘッダ節を返す（タスク 2.1）
- `dist/spirits-linux-x64` から埋め込みソースを抽出し、`ART_LINES` が最終形（1 行目 `border` / 2 行目 `accent` / 3 行目 `dim` / 4 行目 `muted`）で入っていることを確認。`sha256sum dist/spirits-linux-x64` と `dist/spirits-linux-x64.sha256` が一致（タスク 3.2）
- `loadThemeFromPath()` で `Theme.fg()` の解決値を実測し、design Decision 2 の表と完全一致することを確認。`border` / `accent` / `dim` / `muted` は dark/light × truecolor/256 の 4 とおりすべてで 4 種別解（タスク 3.3 の (b) を機械的に裏付け）
- 仕様の内訳: `specs/colorful-startup-mark/spec.md` ADDED 2（シナリオ 3）、`specs/product-identity/spec.md` MODIFIED 1（シナリオ 1）

## 要件実装マッピング

| 要件 | 実装 | テスト |
|---|---|---|
| colorful-startup-mark / 起動ヘッダに ASCII アートを表示する（ADDED） | `packages/spirits/src/branding/header.ts:83-88`（`ART_LINES`）、`:112,116,119`（`render()` 先頭） | `packages/spirits/test/branding-header.test.ts:103-113`（折りたみ・展開の両状態で 4 行） |
| colorful-startup-mark / ASCII アートの各行に異なるカラーを使う（ADDED） | `header.ts:14`（`HeaderThemeColor` 4 語）、`:83-88`（行別トークン）、`:112`（`theme.fg()` 経由） | 同 `:89-101`（トークン名の相違）、`:115-126`（テーマ解決への追従） |
| product-identity / TUI 起動ヘッダの spirits 化（MODIFIED） | `header.ts:116,119`（アート → ワードマーク+バージョン → キーヒント → オンボーディングの順） | 同 `:69-87`（アートが index 0、順序アサート、`Pi can explain` 非表示） |

## 設計の遵守

- **Decision 1**（アートを `render()` 先頭に、両状態で共通）: `header.ts:112,116,119` — 折りたみ/展開の両分岐で同じ `art` を先頭に展開。新 component は作っていない。準拠
- **Decision 2**（4 行 4 トークン + 解決値表）: `header.ts:83-88` — design の表と実測値が全カラーモードで一致。準拠
- **Decision 3**（`HeaderThemeColor` を 4 語に拡張、pi コア変更なし）: `header.ts:14` は tasks と同一の 4 語。`git status packages/coding-agent` はクリーン。`border` は pi の `ThemeColor` 既存語（`packages/coding-agent/src/modes/interactive/theme/theme.ts:57-61`）。準拠
- **Decision 4**（2 capability 分担）: `specs/colorful-startup-mark/spec.md` はアート本文と行別色のみを規定し、`quietStartup`・展開追従の重複記述なし。準拠

## 重大

なし。

## 警告

1. **シナリオ「各行に異なるカラーを適用」が色差を検証していない** — `packages/spirits/test/branding-header.test.ts:89-101` は 4 行に渡った**トークン名**の相違だけをアサートしており、要件「4 つの行すべてが互いに異なるテーマカラーで描画される」の実体（解決後の色が異なること）は検証していない。この区別は理論上の穴ではなく、実装中に `borderAccent` が dark 256 で `accent` と同一化し、truecolor でも ΔRGB(7,10,2) で知覚不能という形で実際に発生している（design.md Decision 2「差し替えの記録」）。現行の `border` は全モードで別解だが（実測済み）、次回トークンを差し替えたときに同種の退行を捕まえられない。
   - 推奨: `loadThemeFromPath("<repo>/packages/coding-agent/src/modes/interactive/theme/dark.json", mode)` を `mode` = `truecolor` と `256` で読み、`ART_LINES` の 4 トークンの `theme.fg(tok, "")` 出力が 4 種別解であることをアサートするテストを追加する（`light.json` でも同様）。

## 提案

1. **配布物の theme ディレクトリ欠落（本変更の範囲外）** — `getThemesDir()` は Bun バイナリで実行ファイル隣の `theme/` を要求する（`packages/coding-agent/src/config.ts:421-424`）が、`scripts/build-binaries.ts` は `theme/` を生成しない。named テーマのロード失敗は `initTheme()` が握りつぶして system テーマへ silent fallback する（`packages/coding-agent/src/modes/interactive/theme/theme.ts:756-770`）。タスク 3.3 の目視確認は `dist/theme/{dark,light}.json` を手作業でコピーした状態（mtime 11:43、ビルドは 11:37）で成立させており、クリーンなビルド直後の `dist/` からは再現しない。spec・design はいずれもこの要求を書いていないため本変更の不合格にはしない。
   - 推奨: `theme/{dark,light}.json` をビルド成果物に含める変更を別 change で立てる（`binary-distribution` capability に要求として propose する）。
2. **`installBrandingHeader` 直前の JSDoc 重複（HEAD 既存）** — `packages/spirits/src/branding/header.ts:123-132` にほぼ同一のコメントブロックが 2 つ並ぶ。本変更の差分ではなく HEAD 側に既にあるため、整理するなら別の変更で。

## アーカイブ時の注意

- `openspec/specs/product-identity/spec.md:21-27` は delta 前の文言のまま（意図どおり。archive の同期対象）。
- ワークツリーには本変更外の未コミット変更が混在する（`packages/spirits/src/types/*.d.ts`、`packages/spirits/test/routing-*.test.ts`、`packages/spirits/test/rlm-spawn.test.ts`、`.pi/prompts|skills`、README 群）。コミットは本変更の 3 ファイル（`packages/spirits/src/branding/header.ts`、`packages/spirits/test/branding-header.test.ts`、`docs/spirits-design.md`）と変更ディレクトリに絞る。

## 最終評価

重大な問題なし。警告 1 件（シナリオ「各行に異なるカラーを適用」の色差未検証）、提案 2 件。スキップしたチェックなし。**アーカイブの準備ができました（改善点が指摘されています）。**
