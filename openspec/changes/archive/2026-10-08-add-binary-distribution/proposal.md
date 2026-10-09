# Proposal

## Why

spirits の M1 成果 `tsrepl` は、現状「pi をソースから起動して `-e packages/spirits/src/index.ts` で読み込む」開発者向けの形でしか動かず、Bun / Node を持たないエンドユーザ環境へ届ける手段がない。全体設計書 `docs/spirits-design.md` §4.5 が確定させた配布形態は「`bun build --compile` 単一バイナリ + `curl install.sh`、Linux x86_64 のみ」であり、M3 以降の機能もこの配布形態に載る。M2 で配布経路を先に確定し、以降のフェーズが手動セットアップなしで試せる状態にする。

## What Changes

- `packages/spirits/bin/spirits.ts` を追加する。コンパイル用エントリで、spirits 拡張を組み込み拡張として既定ロードした pi CLI を起動する薄いラッパ。処理は次の 4 つだけ。(1) 開発時のみ `Bun.version` ゲート(`< 1.4.0` 拒否、`< 1.4.2` 警告、コンパイル済みはスキップ)、(2) 環境既定値の設定(設定ディレクトリを `~/.spirits/agent` にし、pi の最新版確認と更新通知を抑止する)、(3) 組み込み spirits 拡張の登録、(4) pi の CLI エントリへの委譲(引数はそのまま透過)。`--version` と `-v` はビルド時に埋め込んだ spirits バージョンと内包 Bun バージョンを表示する。
- `scripts/build-binaries.ts` を追加する。git tag からバージョンを引き継ぎ、`bun build --compile --target=bun-linux-x64` で `dist/spirits-linux-x64` を生成し、`dist/spirits-linux-x64.sha256` を同時生成する。pi 側の `VERSION` は、実行ファイル隣の `package.json` に頼らず、ビルド時に pi コアのバージョンへ置換する。
- `scripts/install.sh` を追加する。POSIX sh で動作し、`curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh` で実行できる。Linux x86_64 検査(依存コマンド検査より先)、`VERSION`(`0.1.0` 形式。`spirits-v` を前置してタグを得る)指定、または draft と prerelease を除く `spirits-v*` リリースの先頭(Releases API の一覧 `per_page=100`)の解決、バイナリと `.sha256` の一時ディレクトリへのダウンロード、`sha256sum -c` による検証(失敗時は絶対に配置しない)、`~/.spirits/bin/spirits` への配置(上書き=アップグレード、冪等)、PATH 未通し時の shell rc 追記行の案内(自動編集はしない)、成功時の利用開始コマンドと実行環境の Bun バージョン(参考情報)の表示。`--uninstall` 指定時は、Linux x86_64 検査の直後に、配置済みバイナリとデータディレクトリの削除コマンドを標準出力へ案内して終了コード 0 で終了する(ファイルと shell rc は変更せず、依存コマンドとネットワークを要求しない)。
- `.github/workflows/spirits-release.yml` を追加する。`spirits-v*` タグ push のみをトリガ(手動起動は持たない)に、ubuntu-latest + 固定 Bun(1.4.2+)で依存導入 → テスト → ビルド → チェックサム → スモーク → 専用 GitHub Release へ添付し、リリースノートに内包 Bun バージョンを記載する。バージョン部に `-` を含むタグの Release は prerelease として公開する。
- root に `bun.lock` を導入し、release workflow の `bun install --frozen-lockfile` を成立させる。`.github/workflows/spirits-ci.yml` を追加し、spirits の `bun test` / 型検査と root bun.lock の整合を検証する。
- スパイク `docs/spikes/compiled-extensions.md` を追加する。bin の実装前に pi ソースの解決方式(コンパイル解決)を最小バイナリで確定し、コンパイルバイナリで、(1) バンドル済み spirits 拡張のロード、(2) `~/.spirits/agent/extensions/` の外部 TS 拡張のロード、(3) 外部拡張からのバンドル済み pi パッケージ import、(4) 外部拡張の独自 node_modules 依存が無い場合の案内表示、(5) `-e` で指定した拡張と組み込み拡張の併存、(6) 外部拡張から読んだ pi の `VERSION` が置換後の値であること、を実機確認する。
- `packages/spirits/README.md` と `docs/spirits-m2-distribution.md` に、インストール手順(手動ダウンロード検証の代替手順を含む)、タグ/リリース単位、単一バイナリの制約を反映する。

非目標(`docs/spirits-m2-distribution.md` §3、`docs/spirits-design.md` §4.5): macOS / Windows ターゲット、自動アップデート機構 / `spirits update` コマンド、npm 公開。加えて本 change では、リポジトリ全体の npm → Bun 完全移行(`package-lock.json` の削除、既存 CI / vitest / 公開 workflow の置換)は行わない。root `bun.lock` の導入と spirits 経路の Bun 化に留め、完全移行は別 change とする。

## Capabilities

### New Capabilities

- `binary-distribution`: spirits を Linux x86_64 の単一バイナリとして配布・インストールする機能。次を、外部から観測できる振る舞いとして規定する。
  - コンパイル済み `spirits` の起動と、組み込み spirits 拡張の既定ロード、引数の透過
  - `spirits --version` / `-v` の出力(埋め込み spirits バージョンと内包 Bun バージョン)
  - pi の更新通知の抑止
  - 設定ディレクトリ `~/.spirits/agent`(インストール先 `~/.spirits/bin` との分離)
  - 開発時のみの Bun バージョンゲート
  - install.sh のプラットフォーム検査、バージョン解決、チェックサム検証、配置、PATH 案内、`--uninstall` の削除案内
  - `~/.spirits/agent/extensions/` の外部拡張ロードと、パッケージマネージャ非同梱時の案内
  - `spirits-v*` タグからのリリース成果物(バイナリ + チェックサム、内包 Bun バージョン記載、prerelease の扱い)
  - 後段フェーズ(M3 以降)機能への非依存

### Modified Capabilities

なし(`openspec/specs/` の既存仕様は `tsrepl` のみで、本 change は `tsrepl` の要件を変更しない)。

## Impact

- **change 単位とコミット単位は一致しない:** 本 change を適用するコミットには、M1 の成果(`packages/spirits/src/` の REPL 実装とテスト)が同居する。履歴の分割・書き換え(force-push)は行わず、change 単位とコミット単位を一致させない運用とする。M1 実装の内容は本 change では変更しない。
- 新規ファイル: `packages/spirits/bin/spirits.ts`、`scripts/build-binaries.ts`、`scripts/install.sh`、`.github/workflows/spirits-release.yml`、`.github/workflows/spirits-ci.yml`、`docs/spikes/compiled-extensions.md`。既存 `packages/*/src` のコードは変更しない。
- **Pi 上流コアへの差分: あり(リポジトリ直下の追加のみ)。** root `bun.lock` と新規 workflow を追加する。新規ファイルと `bun.lock` の追加であり、上流の `package-lock.json`・既存 workflow・`packages/*` のコードは変更しない。`[spirits]` プレフィックス付きの 1 コミットに分離する。
- 依存追加: なし(`packages/spirits` の `typebox` / `@types/bun` / `typescript` は M1 のまま)。root `bun.lock` は既存 `package.json` 群から生成する。
- 配布物: 単一バイナリ + `.sha256`。pi の sibling assets(`theme/`、`assets/`、`export-html/`、`photon_rs_bg.wasm`、TUI native prebuilds)は同梱しないため、テーマ切替・HTML エクスポート等の一部機能が劣化する。完了条件(起動と `tsrepl`)には影響しない。README とリスクに明記し、必要になった時点で配布構成の拡張を別 change とする。
- リリース単位: 既存 `.github/workflows/build-binaries.yml` が `v*` タグで pi のリリースを作るため、spirits は `spirits-v*` タグ + 専用 Release とする。install.sh は `spirits-v*` の latest を解決する。
- セキュリティ: install.sh は SHA256 検証を必須とし、検証失敗時は配置しない。pipe to sh の代替として手動ダウンロード検証手順を README に併記する(`docs/spirits-design.md` §6)。
