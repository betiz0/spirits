## Deep Verification Report: add-colorful-startup-mark

- 検証対象: `df1675cc6..df1675cc6`（未コミット変更: あり。本変更分は `packages/spirits/src/branding/header.ts`、`packages/spirits/test/branding-header.test.ts`、`docs/spirits-design.md` の 3 ファイル）
- テストコマンド: `cd packages/spirits && bun test`、`npm run check`
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし）
- verify1 レポート: `openspec/changes/add-colorful-startup-mark/verify1.md`
- モード: 通常
- 検証日: 2026-10-18

### 判定
**BLOCKED**（CRITICAL 0、SPEC 1）

### 集計
| 観点 | 結果 |
|---|---|
| テスト | 成功 563 / 失敗 0（パッケージ直下から実行した場合。リポジトリルートからは 562 / 1、W-3） |
| 規約検査 | 成功 3 / 失敗 0（`architecture-conventions.test.ts`）、`npm run check` は EXIT 0 |
| 要件 | 意図どおり 3 / 全 3（色の要件は S-1 の条件付き） |
| シナリオ | 挙動を確認 4 / 全 4、テストが実質的 3 / 全 4 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| 継ぎ目 | 新規 0 件（既存の公開型の拡張 1 件、Decision あり） |
| 重複 | 新たな重複 1 件 |
| タスク | 完了 9 / 全 9 |

### 継ぎ目一覧
| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `HeaderThemeColor` に `"border"` を追加（既存の export 型の拡張） | 抽象型 | `packages/spirits/src/branding/header.ts:14` | Decision 3 | なし | なし（Decision 3 が挙げた対価は実現している: ANSI の直書きは無く、すべて `theme.fg()` を通る） |

新しい import、ディレクトリ、依存、pi コアの変更はない。

### 指摘

#### CRITICAL
なし。

#### WARNING
- **[W-1] シナリオ「各行に異なるカラーを適用」のテストが、解決後の色ではなくトークン名の違いしか見ていない**
  - 場所: `packages/spirits/test/branding-header.test.ts:89-101`
  - 根拠: アサートは `new Set(artColors).size === 4` だけで、対象はトークン名である。design Decision 2 には、トークン名が違っても解決後の色が同じになった実例（`borderAccent` と `accent` が 256 色で両方 `38;5;140`）が記録されている。現行の 4 トークンは `loadThemeFromPath` で dark/light × truecolor/256 を実測し、全モードで 4 色が別々になることを確認した。挙動は正しい。
  - 修正先: 実装（テスト）
  - 推奨: `packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `truecolor` と `256color` で読み込み、`ART_LINES` の 4 トークンについて `theme.fg(tok, "")` の出力が 4 種類あることをアサートするケースを足す。
- **[W-2] `docs/spirits-design.md` にアート本文と行ごとのトークン割り当てが複製されている**
  - 場所: `docs/spirits-design.md:186`
  - 根拠: アート 4 行の本文と `border`/`accent`/`dim`/`muted` の割り当ては、`colorful-startup-mark` spec と `header.ts:83-88` が正本である。docs にも同じ内容を書くと、トークンを差し替えたときに docs だけ古いまま残る。Decision 4 が spec 同士で避けた二重正本と同じ構造。タスク 2.1 の指示どおりの実装ではある。同じ行に脱字がある（「オンボーディング文この順で」→「オンボーディング文をこの順で」）。
  - 修正先: 実装（docs）
  - 推奨: 本文と割り当てを「ASCII アート(4 行、本文と行別の色は `colorful-startup-mark`)」程度の参照に置き換え、脱字を直す。
- **[W-3] タスク 3.1 の検証コマンドが、環境によってはテストの preload を通らない**
  - 場所: `openspec/changes/add-colorful-startup-mark/tasks.md:17`、`packages/spirits/bunfig.toml`
  - 根拠: リポジトリルートで `bun test packages/spirits/` を実行すると `packages/spirits/bunfig.toml` の preload（`PI_APP_NAME=spirits` を設定する）が読まれず、`harness-paths.test.ts:31` が `Received: "/home/betiz/.pi/agent"` で失敗する。`PI_APP_NAME=spirits` を付けるか、パッケージ直下から実行すると 563 件すべて通る。失敗するファイルは本変更と無関係。
  - 修正先: tasks
  - 推奨: 検証コマンドを `cd packages/spirits && bun test` に改める。

#### SPEC
- **[S-1] 色の要件が無条件の SHALL なのに、既定のシステムテーマでは成り立たない状態がある。その例外は design にしか書かれていない**
  - 場所: `openspec/changes/add-colorful-startup-mark/specs/colorful-startup-mark/spec.md:24-28`、`design.md:45`
  - 根拠: 既定のテーマ（system）で `generateSystemThemeColors` を実測した。
    - 端末が色を報告した後: 4 色別々
    - 色の報告待ち（saturation 0）: `accent` と `muted` が同じ `#9f9f9f` で 3 色
    - 背景色を報告しない端末: `dim` と `muted` がどちらも無色 + SGR 2 で 3 色

    design はこれを「テーマのカラー解決に従った結果」として許容しているが、archive 後に残る spec は「4 つの行すべてに互いに異なるテーマカラー」を無条件に要求している。「テーマカラー」がトークンを指すのか解決後の色を指すのかも曖昧（W-1 の原因でもある）。
  - 修正先: spec
  - 推奨: Requirement とシナリオを「4 行に互いに異なるテーマトークンを割り当て、ビルトインテーマ（dark/light）では全カラーモードで解決後の色が互いに異なる。端末色に依存するテーマで色が重なることは許容する」の形に書き直し、design の許容判断を spec に引き上げる。実装の変更は不要。

#### SUGGESTION
- **[G-1] 配布物に `theme/` ディレクトリが無い（本変更の範囲外）**
  - 場所: `scripts/build-binaries.ts`、`packages/coding-agent/src/config.ts:421-424`
  - 根拠: `dist/theme/` の mtime は 11:43:26 で、ビルドの 11:37:58 より後のため手で置かれたもの。ビルドスクリプトに theme の処理は無い。既定の system テーマは json を使わないため本要件の判定には影響しない。`dark`/`light` を明示指定したユーザーだけが、何も表示されないまま system テーマに戻る。
  - 推奨: `binary-distribution` の別 change で、ビルド成果物に `theme/{dark,light}.json` を含める。
- **[G-2] `installBrandingHeader` の直前に JSDoc が 2 つ重なっている（HEAD の時点で既にある）**
  - 場所: `packages/spirits/src/branding/header.ts:123-132`
  - 推奨: 別の変更で 1 つ目を削除する。
- **[G-3] コミットの範囲**
  - 根拠: ワークツリーの `src/types/*.d.ts`、`test/routing-*.test.ts`、`test/rlm-spawn.test.ts` の差分は mtime が 10-17 で、内容は dual-model-routing のもの。本変更の対象ではない。
  - 推奨: コミットは上の 3 ファイルと change ディレクトリに限る。

### verify1 との突き合わせ
- verify1 の警告 1 → W-1 として採用（解決値を独自に実測して確認）。
- verify1 の提案 1・2 → G-1・G-2 として採用。G-1 は既定テーマが json を使わないことを確かめ、本要件への影響が無いことを補足した。
- verify2 だけの指摘:
  - S-1: verify1 はビルトインテーマの json だけを実測し、既定の system テーマの状態ごとの解決値を見ていなかった。
  - W-2: verify1 は docs がタスクどおり更新されたかだけを確認し、重複の観点で見ていなかった。
  - W-3: verify1 の「563 pass」は `PI_APP_NAME` が既に設定された環境（pi/spirits のセッション内）で実行したため、preload が効かない問題が表に出なかったと推定される。

### 次の手順
- BLOCKED: S-1 の spec 修正を採るか判断する。採る場合は spec を直し、W-1 のテスト追加と W-2 の docs 修正を apply してから、このスキルを再検証モードで実行する。
