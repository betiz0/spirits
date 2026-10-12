# Proposal

## Why

spirits は Pi 上流 (`earendil-works/pi`) の fork であり、設計書 §5 は「`upstream` リモートを登録し main へ定期 merge」を定めているが、その運用は実際には整備されていない。基点 `a276dabe5` (pi v1.0.0) から最新リリース v1.1.0 まで 114 commits 遅れており、上流追従の手順・検証・回帰検出を先に確立しないまま差分が拡大すると、コアパッチの競合と意味的な乖離のコストが増え続ける。

## What Changes

- `upstream` リモートを登録し、Pi v1.1.0 (`abe508e1b`) を main へ取り込む merge 手順を確立する
- 上流追従の手順 (リモート登録、取り込み、コミット構成、検証) を `docs/spirits-upstream-sync.md` に文書化し、設計書 §5 から参照する
- 取り込み後の検証チェックリストを定める: lockfile 再生成、モデルデータ hydrate、`npm run build:offline` による各パッケージの build、`npm run check`、pi-env daemon の build と `./test.sh`、spirits の `bun test` / `check`、バイナリ build と self-update smoke、既存の binary-distribution シナリオのバイナリ smoke、`.env` 禁止の回帰 smoke (`scripts/test-dotenv-smoke.sh`)
- 取り込みのコミット構成を定める: merge コミットには競合解決と lockfile 再生成だけを含め、spirits 側の修正は個別のコミットにする
- `packages/` 配下と root の `package.json` / `tsconfig.json` / `tsconfig.base.json` の変更でも spirits テストが走るよう、`spirits-ci.yml` のトリガを修正する
- **BREAKING**: 上流 v1.1.0 が追加した `compile.autoloadDotenv: false` 相当を `scripts/build-binaries.ts` に取り込み、spirits バイナリが起動ディレクトリの `.env` 系ファイルを読まないようにする。`.env` に API キーなどを置いていた利用者は、シェルの環境変数で指定する必要がある。移行方法を root と翻訳版 (ja / zh / de-CH) の README、`packages/spirits/README.md` に記載する
- `README.md` の衝突は spirits 版を採用して解決し、上流が追加した開発者向けの記述は移植しない
- 既存の `[spirits]` コア差分 (identity override, `/clear`, package-manager ガード等) は merge で保持する。新たな Pi コア差分は原則として追加しない。検証で Pi コアの修正 (上流 API への適応、上流修正のバックポート) が必要になった場合に限り、`[spirits]` プレフィックスの独立コミットとして追加する
- merge で入る上流 workflow のうち、spirits で使わない Environments (`env.yml`) は GitHub の UI で無効化し、ファイルは残す
- v0.3.0 のタグ付けとリリース検証そのものは本変更の射程外とし、merge 完了後の main を spirits v0.3 開発ツリーとする

## Capabilities

### New Capabilities

- `upstream-tracking`: Pi 上流の取り込み手順とその文書化、取り込みのコミット構成、取り込み結果の検証、CI による回帰検出、spirits タグとバージョン注入の維持

### Modified Capabilities

- `binary-distribution`: **BREAKING** コンパイル済み spirits が起動ディレクトリの `.env` 系ファイルを読み込まない、という要求を追加する。v0.2.0 までのバイナリはこれらを読み込んでいた。配布物の構成、`spirits update` の振る舞い、version の注入規則は変わらない。

## Impact

- 影響コード: `package.json` / `package-lock.json` / `bun.lock` (lockfile)、`scripts/build-binaries.ts`、`scripts/test-dotenv-smoke.sh` (新規)、`.github/workflows/spirits-ci.yml`、`README.md` / `README.ja.md` / `README.zh.md` / `README.de-CH.md`、`packages/spirits/README.md`、および merge で入る上流の各パッケージソースと workflow
- 影響文書: `docs/spirits-upstream-sync.md` (新規)、`docs/spirits-design.md` §5 (参照の追加)
- 利用者への影響: **BREAKING** spirits バイナリは起動ディレクトリの `.env` 系ファイルを読まなくなる
- API / 依存: Pi コアが v1.0.0 → v1.1.0。全 workspace パッケージが 1.1.0 に揃い `install-lock` も追随する。新規パッケージ `packages/env` が加わる
- 開発環境: `./test.sh` の前提として、Rust toolchain 1.96.0 (rustup) と各パッケージの build (`npm run build:offline`) が必要になる。上流 `packages/env` のテストはビルド済みの pi-env daemon を、ほかのテストの一部はビルド済みの `dist/` を要求するため
- CI: merge で上流 workflow `env.yml` (Environments) が入る。GitHub の UI で無効化する
- **Pi 上流コアへの差分: 原則なし。** 検証で Pi コアの修正が必要になった場合に限り、`[spirits]` 独立コミットを追加する。v1.1.0 の取り込みでは、上流 main の `ce950d78f` (Claude 5.5 のモデルメタデータを models.dev に揃える修正) を `[spirits]` コミットでバックポートする。既存の `[spirits]` コア差分は merge で保持し、取り込みにより上流との差分はむしろ縮小する
- リリース: 完了時点の main が spirits v0.3 開発ツリーになる。タグ `spirits-v0.3.0` は本変更では打たない
