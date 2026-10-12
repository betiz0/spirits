# Proposal

## Why

`spirits update` は現在、更新を実行せずインストーラ再実行を案内するだけである(M2 で「将来検討」として先送りした事項)。install.sh の再実行はアップグレードとして動作するが、同版でも常に約 94MB をダウンロードし、`/tmp` からの `mv` はファイルシステムをまたぐ場合に非原子的で、中断すると壊れたバイナリが残り得る。また、配布済み 0.1.0 バイナリは identity 修正前のビルドのため、`spirits update` が pi 名義のエラーと pi のリリース URL を表示する。インストール済み利用者が CLI だけで安全に最新版へ更新でき、同じ版では無駄なダウンロードをしないようにする。

## What Changes

- **BREAKING** `spirits update` は案内を表示するだけでなく、実行ファイルを置き換えるようになる。pi の `update` の文法で対象が self になる形(`update`、`--self`、`self`、`pi`、およびこれらに `--force`、`-a` / `-na` を加えた形)は、GitHub Releases から最新 stable `spirits-v*` を解決し、sha256 を検証してから `process.execPath` を原子的に置換する
- pi の文法で対象が all になる形(`--all`、self と `--extensions` の組み合わせ)は、自己更新の後に、インストール先の実行ファイルで `update --extensions` を実行する。自己更新が置換せずに成功した場合も実行し、`-a` / `-na` を引き継ぐ
- 拡張・モデル・単一ソースが対象になる形、`--help` を含む形、pi がエラーとする形は、pi の既存処理へそのまま渡す(既存挙動を変えない)
- 同版なら `up to date` を表示して 0 で終了する。インストール済みが最新 stable より新しい場合(prerelease)も置換せず 0 で終了する。`--force` はどちらの場合も最新 stable を再取得して置換する
- 非コンパイル実行(bun 直実行)、非 Linux/x64、インストール先が書込不可、リリース解決・ダウンロードの失敗は、理由とインストーラ再実行の手段を表示して非ゼロで終了する
- `PI_OFFLINE` が有効な場合、ネットワークにアクセスせず、オフライン指定のため更新しない旨と解除方法を表示して非ゼロで終了する
- 自己更新の HTTP 要求は、無通信が 10 秒続くと失敗とする。上限は `SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS`(正の整数)で上書きできる
- 自己更新と install.sh は、失敗時と SIGINT / SIGTERM 時に一時ファイルを削除する。SIGKILL などで残った一時ファイルは、次回の自己更新または install.sh の実行時に削除する(実行中の別プロセスのものは除く)
- **BREAKING** install.sh は latest 解決時に限り、インストール済みバイナリの `--version` を確認し、同版ならダウンロードを省略して `最新である旨` を表示する。そのため、同版の再実行では上書きしなくなる。修復には `VERSION=x.y.z` を明示する(常に再配置する)。版を判定できない場合はダウンロードへ進む。版が異なれば、インストール済みが新しい prerelease でも置換する(`spirits update` とは異なる)
- install.sh はダウンロードと検証をインストール先ディレクトリ内の一時領域で行い、配置を `rename` で原子的にする
- リリース CI は、古い版としてビルドしたバイナリを、fixture 経由でリリース対象のバイナリへ自己更新させ、`--version` の変化を確認する
- 起動時の更新通知、`--check`、自動更新は対象外(必要になれば別 change)

## Capabilities

### New Capabilities

- `self-update`: `spirits update` による自己更新。版の解決と比較、チェックサム検証、原子的置換、一時ファイルの後始末、自己更新できない環境・オフライン・失敗時の案内、無通信タイムアウト、`update` 引数のルーティングと拡張更新との組み合わせ。

### Modified Capabilities

- `binary-distribution`: 起動要件の引数透過から自己更新を除外する。更新通知抑止の要件から「更新は install.sh の再実行」を外し、`spirits update` の表示を自己更新の結果に変える。配置と冪等性の要件に、install.sh の同版スキップ、原子的配置、一時ファイルの後始末を加える。後段非依存の要件で、エントリの責務に自己更新への振り分けを、installer の依存先に `--version` を加える。

## Impact

- コード: `packages/spirits/src/update/*`(新規)、`packages/spirits/src/constants.ts`(タイムアウト既定値と環境変数名)、`packages/spirits/bin/bootstrap.ts`、`packages/spirits/test/update-*.test.ts`(新規)、`scripts/install.sh`、`scripts/install.test.sh`、`scripts/self-update-smoke.sh`(新規)、`.github/workflows/spirits-release.yml`
- ドキュメント: `README.md`、`packages/spirits/README.md`、`docs/spirits-design.md`、`docs/spirits-m2-distribution.md`
- API: 更新経路の CLI 挙動(`spirits update`)と、環境変数 `SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS`(新規)。pi の `update` 引数の文法と、`--extensions` / `--models` の挙動は維持する
- 依存: 追加なし。版比較には Bun 組み込みの `Bun.semver.order()` を使う
- Pi 上流コアへの差分: なし。判定と実行は `packages/spirits/bin/bootstrap.ts` で完結し、pi コアの非 pi バイナリ向けガードは変更しない
- リリース前提: `spirits-m2-verify` にある identity 修正を同一リリースに含める必要がある。0.1.0 から更新する利用者は、最初の 1 回だけ install.sh の再実行が必要
