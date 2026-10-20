# Proposal

## Why

インストール済みの 0.6.0 では `/settings` が `ENOENT: ... <install>/theme/dark.json` で落ちる。spirits の単一バイナリ配布は pi の組み込みテーマを同梱していないが、pi は Bun バイナリのとき `<実行ファイルの隣>/theme/{dark,light}.json` を読む。従来の設計は「テーマ切替が system テーマへ劣化する」と想定していたが、実際には設定画面全体が開かない。既定の system テーマは起動時にコード生成されるため、起動と `tsrepl` だけは正常に見える。

## What Changes

- **ビルド**: `scripts/build-binaries.ts` が `packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `dist/theme/` へコピーし、各ファイルの `.sha256` を生成する。古い `dist/theme` は作り直す。
- **リリース**: `spirits-release.yml` が `theme/dark.json`、`theme/light.json`、それぞれの `.sha256` を既存のバイナリ資産と一緒に添付する。
- **インストーラ**: `~/.spirits/bin/theme/{dark,light}.json` を配置する。すべての資産を検証してから配置する。同版の再実行では、テーマ資産が欠けている場合だけ実行ファイルを置換せずにテーマ資産を修復する。
- **自己更新**: バイナリと同じリリースのテーマ資産を取得・検証し、テーマを先、バイナリを最後に配置する。最新版のときもテーマ資産が欠けていれば実行ファイルを置換せずに修復する。
- **互換性**: 既存の `spirits-linux-x64` と `.sha256` は残す。旧版の updater はバイナリだけを置換するため、その直後はテーマが欠けたままになる。安定版へ更新した場合は次回の `spirits update`（新版）または `install.sh` の再実行が修復し、prerelease は `VERSION` を指定した `install.sh` が同じ版の資産を配置する。この移行手順を README に書く。
- **互換性（移行ウィンドウ）**: install.sh は main から取得されるため、テーマ必須化後の install.sh に対し、テーマ資産を持たないリリース（0.6.0 以前）を指定したインストールは失敗する。`VERSION` を指定しない再実行も、最新として解決されたリリースがテーマ資産を持たない間は同版修復の取得先が無いため失敗する（変更前は「already up to date」で成功していた）。該当版を導入するにはそのタグの install.sh を使う旨を README に書く。マージ後は速やかに次版をリリースし、install.sh の取得元と最新 stable の不一致の窓を閉じる。
- **ドキュメント**: 手動ダウンロード/検証、更新修復、アンインストール（`theme/` を含む）、単一バイナリの制約を更新する。設計書の「theme を同梱しない」記述を、テーマだけ同梱する記述へ改める。
- **BREAKING**: 配布物が純粋な単一ファイルではなくなる。バイナリだけをコピーした場合は起動と `tsrepl` は動くが `/settings` は壊れたままなので、`theme/` も配置する必要がある。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `binary-distribution`: リリース成果物、チェックサム検証、配置と冪等性、アンインストール案内、およびインストール後に組み込みテーマが解決できること。
- `self-update`: 取得・検証する成果物、最新版時のテーマ修復、テーマ資産の原子的配置、旧版からの移行。

## Impact

- コード: `scripts/build-binaries.ts`、`scripts/install.sh`、`scripts/install.test.sh`、`scripts/self-update-smoke.sh`、`packages/spirits/src/constants.ts`、`packages/spirits/src/update/`、`packages/spirits/test/update-*`、`.github/workflows/spirits-release.yml`
- ドキュメント: `packages/spirits/README.md`、`docs/spirits-design.md`、`docs/spirits-m2-distribution.md`
- リリース成果物: `dark.json`、`light.json`、`dark.json.sha256`、`light.json.sha256` を追加。`spirits-linux-x64` と `.sha256` は変更しない。
- インストール配置: `~/.spirits/bin/theme/` を追加。
- 現行 spec: `openspec/specs/binary-distribution/spec.md` の Purpose をテーマ資産を含む配布物への記述へ更新した。既存 capability の delta は Purpose を運べないため直接編集で反映しており、本変更の実装コミットに含めて archive まで維持する。
- 依存関係: 追加なし。install.sh は引き続き `curl` と `sha256sum` だけを要求する。
- Pi 上流コアへの差分: なし。`packages/coding-agent` その他のコアパッケージは変更せず、既存のテーマ JSON をビルド時にコピーするだけ。
- 利用者影響: `/settings` が再び開き、dark/light を選択できる。今回より前のバイナリから更新した直後は、テーマ修復のためにもう一度 `spirits update` または `install.sh` が必要。
