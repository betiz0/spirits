# Design

## Context

現状、リポジトリは pi v1.0.0 のフォークで、root は npm workspaces + `package-lock.json` + vitest を維持し、`bun.lock` を持たない。`packages/spirits` は M1 でルート workspace から除外した自己完結の Bun パッケージ(`bun.lock`、`bun test`、`tsc --noEmit`)。M2 で確認した上流の前提は次のとおり。

- pi の起動経路は `packages/coding-agent/src/bun/cli.ts`(side-effect で sandbox-env-setup / runtime-setup を読み込み)→ `src/cli.ts`(`setupCli()` → `main(argv)`)。`main` と `MainOptions` は `@earendil-works/pi-coding-agent` の index から公開済み。
- `main(args, { extensionFactories })` に渡した `builtin: true` の拡張は、設定で無効化されない限り既定で有効になり、`builtin:<name>` として `-e` からも参照できる(`core/resource-loader.ts`、`core/package-manager.ts`)。
- ソース実行・コンパイルバイナリの両方で、ディスク上の拡張へ `typebox` / pi パッケージを渡すのは `core/extensions/virtual-modules.ts` の仮想モジュール経路。
- バイナリ時のパス解決は `config.ts` の `getPackageDir() = dirname(process.execPath)`。`VERSION`・`APP_NAME`・`CONFIG_DIR_NAME` は実行ファイル隣の `package.json` から読み、無ければ `0.0.0` / `pi` / `.pi`。`getAgentDir()` は環境変数 `PI_CODING_AGENT_DIR`(APP_NAME=pi のとき)で上書きでき、外部拡張は `getAgentDir()/extensions` から自動探索される。認証・設定・セッションも `getAgentDir()` 配下に置かれ、pi が管理する fd / rg の置き場 `getBinDir()` は `getAgentDir()/bin`(`getShellEnv()` が bash ツールの PATH 先頭に追加する)。
- `VERSION` は `config.ts` のモジュール評価時に確定する `const` で、実行ファイル隣(または `PI_PACKAGE_DIR`)の `package.json` が無いと `0.0.0` になる。`index.ts` から export されており、`main.ts` の `--version`、User-Agent、クラッシュログ、バグレポート、インストール統計の ping(`pi.dev/api/report-install`)に使われる。`0.0.0` のままだと、対話モードは起動時に pi の最新版確認(`utils/version-check.ts`)を行い、通知(`Run pi update`)を出す。`PI_SKIP_VERSION_CHECK` が設定されていれば最新版確認は行われない。`-v` は `--version` の別名(`cli/args.ts`)。bun-binary の `update` は pi のリリースページを案内する(`config.ts` の `getSelfUpdateUnavailableInstruction`)。
- 起動アセット: `theme/` が無いと `getBuiltinThemes()` は失敗するが、`initTheme` は catch して system テーマへフォールバックする。`getAvailableThemes()` は設定セレクタ表示時にのみ呼ばれる。したがって bare binary でも起動と `tsrepl` は成立するが、テーマ切替・HTML エクスポート等は劣化する。
- 既存 `.github/workflows/build-binaries.yml` が `v*` タグで pi のリリースを作り、`stage-github-release` が Release を操作する。spirits が同じタグ体系に乗ると競合する。
- root `tsconfig.json` の `paths` は `@earendil-works/pi-coding-agent/*` を `packages/coding-agent/src/*` へ解決する。一方 `packages/spirits/tsconfig.json` は root を継承せず、`@earendil-works/pi-coding-agent` を型宣言ファイルへ向ける。pi の `package.json` の `exports` は `dist` のみを指し、`bun/runtime-setup` などの subpath を公開していない。そのため、spirits の `bin` からソースを解決する方法は未検証で、タスク 1.2 のスパイクで確定する(Decision 1)。

設計の一次根拠は `docs/spirits-design.md`(§4.5 配布構成、§5.4 lockfile、§6 セキュリティ、§8 非機能、§9 構成、§10 フェーズ)と `docs/spirits-m2-distribution.md`。本ドキュメントは両者の決定を実装へ落とす際の判断と、両者から変えた点だけを扱う。

## Goals / Non-Goals

**Goals:**

- コンパイル用エントリ、ビルドスクリプト、install.sh、リリース workflow の方式を確定する。
- root `bun.lock` を最小限導入しつつ、既存の npm ベース CI / workflow を壊さない境界を確定する。
- 単一バイナリで実現しない機能(assets、拡張の依存解決)を明示し、スパイクと README に落とす。

**Non-Goals:**

- pi コア(`packages/*/src`)の変更。必要な場合は分離コミット方針だけを定める。
- リポジトリ全体の npm → Bun 完全移行(`package-lock.json` 削除、CI / vitest / 公開 workflow の置換)。
- macOS / Windows ターゲット、自動アップデート、npm 公開。
- M3 以降の機能の設計。

## Decisions

### 1. コンパイル用エントリは公開 `main` を組み込み拡張付きで呼ぶ

`packages/spirits/bin/spirits.ts` をエントリとし、次の順で処理する。

1. 最初に評価される `bin/bootstrap.ts` で開発時 Bun ゲート、`--version` / `-v` の処理、環境既定値(`PI_CODING_AGENT_DIR` と `PI_SKIP_VERSION_CHECK`、Decision 3 と 4)の設定を行う。
2. sandbox-env-setup / runtime-setup を side-effect import し、`setupCli()` を呼ぶ(上流 `bun/cli.ts` と同じ初期化)。
3. `main(argv, { extensionFactories: [{ name: "spirits", factory: spiritsExtension, builtin: true }] })` へ委譲する。

pi 本体の初期化は subpath import(`@earendil-works/pi-coding-agent/bun/runtime-setup` など)で取り込む。ソースへの解決方式は、タスク 1.2 のスパイク(2026-10-08、Bun 1.4.2)で確定した。**Bun.build は `tsconfig` オプションに root `tsconfig.json` を指定(a)**、**未コンパイル実行は `packages/spirits/bin/tsconfig.json` が root `tsconfig.json` を extends することで、Bun が entry の最近傍 tsconfig として同じ `paths` を使う(b)**。pi の `exports` は `dist` と一部 subpath しか公開しないため、既存の `packages/spirits/tsconfig.json`(`paths` が bare 指定を d.ts へ向ける)だけでは実行時に `Cannot find module` になった。`npm run build` の dist を入力にする候補 (c) は、(a)(b) で足りたため不採用。詳細と再現手順は `docs/spikes/compiled-extensions.md` の「コンパイル解決」節に記録した。型検査は従来どおり `packages/spirits/tsconfig.json` の `paths` で `src/types/pi-coding-agent.d.ts` へ解決し、pi ソースを巻き込まない。subpath import 用の ambient module 宣言を追加する。`bin/**` は型検査対象に含める。

制約: 静的 import は評価の前に解決されるため、古い Bun で pi のソースの解決や構文解釈に失敗すると、`bootstrap.ts` のゲートメッセージが表示される前に失敗する可能性がある。タスク 1.4 で Bun 1.3.14 / 1.4.1 の未コンパイル起動を実測したところ、どちらもゲートが先に動き(1.3.14 は `1.4.0` 必須のメッセージと終了コード 1、1.4.1 は `1.4.2` 推奨の警告後に継続)、この問題は発生しなかった。動的 import で回避することは、本リポジトリの規約(インライン import の禁止)で採れない。

- 選択肢: 上流 `src/bun/cli.ts` を relative import する。
- 理由: 同ファイルは import 時に `main` を即実行するため extensionFactories を渡せず、tsc が上流ソース一式を型検査へ巻き込み、M1 で回避した `@types/bun` と pi の Node 型の衝突が再発するため却下。
- 選択肢: `-e builtin:spirits` を argv に注入し、組込拡張を設定から有効化する。
- 理由: `builtin:spirits` の登録元(extension factory)が存在せず、上流 CLI エントリは `MainOptions` を受け取らないため却下。
- 選択肢: 公開 `main` だけを呼び、runtime-setup を省略する。
- 理由: OAuth フロー、Bedrock プロバイダ、codemode の QuickJS wasm がバイナリで動かなくなり、pi との同等性が崩れるため却下。

### 2. バージョン埋め込みと `--version`

build スクリプトが `git tag`(`spirits-v*`)からバージョンを解決し、`Bun.build` の `define` で `SPIRITS_VERSION` を埋め込む。`bin/bootstrap.ts` が `--version` または `-v` を検出したら、`main` へ入る前に `spirits <version> (Bun <Bun.version>)` を出力して終了する(pi の `-v` は `--version` の別名で、横取りしないと `VERSION` の `0.0.0` が表示されるため)。実行時に外部ファイル(`package.json`)は読まない。コンパイルされていない実行では `SPIRITS_VERSION` が未定義になるため、`typeof` ガードで `0.0.0-dev` にフォールバックする。バージョン解決と表示形式は `bin/version.ts` に切り出した純関数(タスク 1.3)とし、import 時に `run()` を実行せず単体テストで固定する。同じく `VERSION` が `0.0.0` のままであることによる pi の最新版確認と更新通知は、`bin/env-defaults.ts` が `PI_SKIP_VERSION_CHECK=1` を設定して抑止する。`update` サブコマンドは pi にそのまま渡され、pi のリリースページを案内する。spirits の更新は install.sh の再実行で行う旨を README に明記する。

pi 側の `VERSION` は、ビルド時に pi コアのバージョンへ置換する。`scripts/build-binaries.ts` が `Bun.build` の `plugins`(`onLoad`)で `packages/coding-agent/src/config.ts` を読み込み、`export const VERSION: string = pkg.version || "0.0.0";` の宣言を、`packages/coding-agent/package.json` の `version`(現在 1.0.0)のリテラルを代入する宣言に置き換える。置換の本体は `scripts/replace-pi-version.ts` の純関数とし、置換対象の宣言が見つからなければ例外を投げてビルドを失敗させる。この値は pi コアのバージョンで、spirits のバージョン(`SPIRITS_VERSION`)とは別の値になる。`spirits --version` / `-v` が表示するのは `SPIRITS_VERSION` のため、横取りは引き続き必要。pi.dev の最新 pi との比較による更新通知も、`PI_SKIP_VERSION_CHECK=1` による抑止が引き続き必要。インストール統計の ping の扱いは、本 change では変更しない。

- 選択肢: `install.sh` が `~/.spirits/bin/package.json` を生成する。
- 理由: 成果物の外に検証されないファイルが増え、手動ダウンロード手順にも追記が要り、上で却下した実行ファイル隣の `package.json` に近いため却下。
- 選択肢: 起動時に `bootstrap` が `package.json` を書き出し、`PI_PACKAGE_DIR` で指す。
- 理由: 起動のたびにファイルを書き、pi のパッケージ解決先(テーマ、アセット、docs)が変わるため却下。
- 選択肢: pi コアに `VERSION` の setter を追加する。
- 理由: 上流差分を増やし、M2 の目的に対して割に合わないため却下(Decision 9 と同じ判断)。

- 選択肢: 実行ファイル隣の `package.json` から `VERSION` を読む。
- 理由: 単一バイナリ配布と install.sh のダウンロード対象(バイナリ + `.sha256` のみ)に反するため却下。
- 選択肢: `package.json` の version を更新して tag と同期する。
- 理由: M2 は tag 駆動でバージョンを決めるため二重管理になるため却下(将来 `spirits update` を入れるときに再検討)。

### 3. 設定ディレクトリは `~/.spirits/agent`

`bin/env-defaults.ts` は `PI_CODING_AGENT_DIR` が未設定なら `join(home, ".spirits", "agent")` を設定する(設定済みならその値を尊重する。その場合は pi と同じディレクトリを共有しうる)。結果として `getAgentDir()` が `~/.spirits/agent` になり、外部拡張の自動探索は `~/.spirits/agent/extensions/`、セッション・認証・設定も `~/.spirits/agent/` 配下に置かれる。pi が管理する fd / rg の置き場 `getBinDir()` は `~/.spirits/agent/bin` となり、インストール先 `~/.spirits/bin/spirits` とは別のディレクトリになる。M3 以降の設計書(`~/.spirits/agent/skills/`、`~/.spirits/agent/memory/`)とも一致する。

- 選択肢: `PI_CODING_AGENT_DIR` を `~/.spirits` にする。
- 理由: `getBinDir()` が `~/.spirits/bin` となってインストール先と重なり、pi が置く fd / rg が利用者の PATH に載るバイナリと同居する。bash ツールの PATH 先頭にも追加されるため却下。
- 選択肢: 実行ファイル隣に `piConfig` 入りの `package.json` を配置する。
- 理由: 配布ファイルが増え、install.sh の成果物と検証対象が増えるため却下。
- 選択肢: 何も設定せず pi 既定の `~/.pi/agent` を使う。
- 理由: pi 本体と設定・拡張が混ざり、設計書のインストール先とも一致しないため却下。

### 4. 開発時 Bun ゲートは純関数として実装する

`bin/bun-gate.ts` にバージョン文字列とコンパイル済みフラグを受け取る純関数を置く。関数は判定結果(拒否 / 警告 / 通過)とメッセージ、拒否時の終了コードを返し、`bin/bootstrap.ts` がその結果に従って終了・警告・継続する。テストは関数を直接呼び、実ランタイムのバージョンを切り替えずに 3 分岐(拒否 / 警告 / スキップ)とメッセージ・終了コードを固定する。環境既定値(`PI_CODING_AGENT_DIR`、`PI_SKIP_VERSION_CHECK`)の設定も、`env` と `home` を引数に取る純関数として `bin/env-defaults.ts` に置き、同様に直接テストする。実際の旧 Bun での起動確認は、タスク 1.4 で一時的に用意できる場合に限る。

- 選択肢: 実際に古い Bun を用意してプロセス起動で検証する。
- 理由: CI に複数の旧 Bun が必要になり、コンパイル済み判定の再現も難しいため却下。

### 5. build スクリプトはソースから直接コンパイルする

`scripts/build-binaries.ts` を Bun スクリプトとして追加し、`Bun.build` を `entrypoints: [bin, 画像リサイズ worker, codemode worker]`、`compile: { target: "bun-linux-x64", outfile, autoloadBunfig: false }`、`define`、pi の `VERSION` を置換するプラグイン(Decision 2)、および `tsconfig: root tsconfig.json`(Decision 1 の (a))で呼ぶ。出力は `dist/spirits-linux-x64` とし、`Bun.CryptoHasher("sha256")` で `dist/spirits-linux-x64.sha256` を `sha256sum -c` 互換形式で生成する。バージョンは `--version` 引数または `SPIRITS_VERSION`、無ければ `git describe --tags --match 'spirits-v*'` から取る。ソースコンパイルは gitignore 対象の `packages/ai/src/providers/data/*.json` を静的に import するため、リリース workflow はビルド前に `bun packages/ai/scripts/generate-models.ts --strict --data-only` でモデルデータを hydrate する(タスク 5.2 のリモート実行で検出)。

- 選択肢: 上流 `scripts/build-binaries.sh` を流用する。
- 理由: 6 プラットフォームの pi アーカイブ生成と `npm run build` が前提で、spirits の単一ターゲットには過剰なため却下。
- 選択肢: 先に pi の `npm run build`(dist 生成)を実行してから compile する。
- 理由: CI 時間が伸び、M1 の「上流パッケージをバンドルしない」境界を崩すため却下。タスク 1.2 でソース解決が compile で成立したため、このフォールバック(Decision 1 の候補 (c))は使わない。将来ソース解決が壊れた場合の退避先として Risks に残す。

### 6. リリースは `spirits-v*` 専用タグ + 専用 Release

`.github/workflows/spirits-release.yml` を追加し、`spirits-v*` タグ push のみをトリガに、ubuntu-latest + 固定 Bun(1.4.2)のインストール → テスト → ビルド → チェックサム → スモーク(`sha256sum -c` と `--version`)→ 専用 Release 添付を行う。バージョンは `GITHUB_REF_NAME` から `spirits-v` を除いて得る。リリースノートに内包 Bun バージョンを記載する。バージョン部に `-` を含むタグは prerelease として公開する(検証用タグ `spirits-v0.0.0-test` が install.sh の latest 解決に拾われないようにするため)。install.sh は Releases API の一覧から、draft と prerelease を除く `spirits-v*` の先頭を最新として解決する(Decision 11)。

- 選択肢: 既存 `build-binaries.yml` を拡張し、`v*` タグで pi と spirits を同じ Release に添付する。
- 理由: install.sh の latest 解決が pi リリースを拾い、pi のリリース処理(下書き作成・公開)と副作用が競合するため却下。
- 選択肢: タグ push に加えて `workflow_dispatch` でも起動できるようにする。
- 理由: 手動起動ではタグ名が得られず、ブランチ名がバージョンや Release 名に入る事故を防ぐ入力検証が必要になる。M2 はタグ push だけで足りるため却下。

### 7. root `bun.lock` は導入し、npm フローは段階的に残す

root で `bun install` を実行して `bun.lock` をコミットし、spirits の release workflow は `bun install --frozen-lockfile` で依存導入する。既存の `ci.yml`・`build-binaries.yml`・公開 workflow は npm のままとし、`package-lock.json` も当面残す。完全移行(`package-lock.json` 削除、CI / vitest 置換、npm audit の置換)は別 change とする。

- 選択肢: 設計書 §5.4 のとおり M2 で完全移行する。
- 理由: 既存 workflow が `npm ci` に依存し、テストランナー置換・npm audit・公開処理まで波及する。M2 の完了条件(バイナリ配布)と無関係な破壊範囲を増やすため却下。
- 選択肢: root `bun.lock` を作らず release workflow を npm のままにする。
- 理由: ユーザ判断(a)に反し、`bun install --frozen-lockfile` を前提とするリリース手順を満たせないため却下。

### 8. spirits CI は新規 workflow として追加する

`.github/workflows/spirits-ci.yml` を追加し、`packages/spirits/**`・`scripts/` 配下のビルド/インストールスクリプト・`bun.lock`・`.github/workflows/spirits-*.yml` の変更時に `bun install --frozen-lockfile`(root)、`packages/spirits` の `bun install --frozen-lockfile`(`packages/spirits` は root の workspace から除外されており、`@types/bun` 等は自身の node_modules に入るため)と `bun test` / `bun run check`、`sh -n scripts/install.sh` と `sh scripts/install.test.sh` を実行する。バイナリのフルビルドは release workflow に任せ、通常 CI では行わない。

- 選択肢: 既存 `ci.yml` にジョブを足す。
- 理由: 上流管理ファイルの変更を増やし、上流マージ時の衝突面が広がるため却下。新規ファイルなら `[spirits]` 差分として分離しやすい。

### 9. 単一バイナリで assets を持たない(設計書どおり)

theme / assets / export-html / photon wasm / TUI native prebuilds は同梱せず、バイナリ単体を配布する。起動と `tsrepl` は system テーマのフォールバックで成立する。制約は `packages/spirits/README.md` に明記し、必要になった時点で assets 同梱を別 change とする。

- 選択肢: tar.gz に assets を同梱して配布する。
- 理由: install.sh の成果物・検証対象が増え、M2 の単一バイナリ方針と完了条件から外れるため却下。
- 選択肢: `compile.assets` で theme / assets / export-html / `package.json` をバイナリへ埋め込み、`PI_PACKAGE_DIR` を `$bunfs` のパスへ向ける。
- 理由: `node:fs` から `$bunfs` を読める前提が未検証で、TUI native prebuilds のような dlopen 対象は埋め込めない。M2 の完了条件に含まれないため今回は採らず、スパイクの副次確認候補として記録する。
- 選択肢: pi コアへ theme 埋め込み用の setter を追加する。
- 理由: 上流差分を増やし、M2 の目的(配布経路の確立)に対して割に合わないため却下。

### 10. 外部拡張のロードは上流の仕組みをそのまま使う

組み込み spirits 拡張は `InlineExtension` として `main` に渡す。外部拡張は上流 loader が `getAgentDir()/extensions`(`~/.spirits/agent/extensions/`)から探索し、仮想モジュールで pi パッケージを供給する。bin 側にロード順の調整は入れない。拡張の依存不足は loader のエラーとして拡張パス付きで stderr に報告され、`main` の diagnostics 処理が非ゼロ終了させる(pi 上流の挙動。タスク 1.6 で実測)。起動は継続しない。`--help` は help 分岐が diagnostics より先に exit 0 するためエラーを出さない。README には「バイナリはパッケージマネージャを内包しないため、依存解決には別途 Bun が必要」と、依存不足の拡張があると起動に失敗する旨を記載する。

- 選択肢: 外部拡張の依存解決を spirits 側で代行する。
- 理由: バイナリにパッケージマネージャを内包する必要があり、設計書 §4.5 の制約に反するため却下。
- 選択肢: スパイク結果に関わらず bin 側で明示的に拡張をプリロードする。
- 理由: 上流の探索・仮想モジュール経路と二重になり、スパイクで問題が出たときだけ調整する方が差分を抑えられるため却下。

### 11. install.sh の実装方針

POSIX sh(`set -eu`、`local` や `pipefail` は使わない)。プラットフォーム検査(`uname -s` / `uname -m`)を依存コマンドの検査より先に実行する。非対応プラットフォームでは、`curl` / `sha256sum` の不足よりも先に Linux x86_64 専用である旨を表示して終了する。`curl -fsSL` でバイナリと `.sha256` を一時ディレクトリへ取得 → `sha256sum -c` → `mkdir -p "$HOME/.spirits/bin"` → 検証済みファイルを `mv` + `chmod 755` で配置する。検証失敗時は trap で一時ディレクトリを削除し、配置処理に到達しない。進捗と失敗理由は stderr に出す。

`--uninstall` はプラットフォーム検査の直後に処理し、`~/.spirits/bin/spirits` と `~/.spirits/agent/` を削除するためのコマンドを標準出力へ案内して終了コード 0 で終了する。ファイルと shell rc は変更せず、`curl` / `sha256sum` とネットワークアクセスを要求しない(データディレクトリには認証情報・セッションが含まれるため自動削除しない)。

- 配布 URL: `curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh`。`main` の版が配られる(未リリースの変更も利用者に届く)。インストーラはリリース成果物の名前とチェックサムだけに依存するため、成果物と食い違うのは配置方法の変更に限られる。リポジトリが公開されていることを前提とする(未確認)。
- バージョン指定: `VERSION=0.1.0` の形式で、`spirits-v` を前置してタグ `spirits-v0.1.0` を得る。`spirits --version` の表示と同じ値で指定できる。
- latest 解決: `GET <API 基底 URL>/repos/<owner>/<repo>/releases?per_page=100` の一覧から、draft と prerelease を除き `tag_name` が `spirits-v` で始まる先頭のものを選ぶ。一覧が作成日時の新しい順で返ることに依存する(GitHub REST API のドキュメントと実際の応答で、タスク 2.1 で確認する)。同じリポジトリに pi の `v*` リリースがあるため、先頭 100 件に `spirits-v*` が無い場合は「未検出」として扱い、`VERSION` 指定を案内する。
- 成功時の Bun 表示: 実行環境の `PATH` 上の `bun --version` を参考情報として表示し、無ければ拡張の依存解決に別途 Bun が必要な旨を表示する。バイナリの実行や中身の参照は行わず、`bun` の有無で成否は変えない。内包 Bun のバージョンは `spirits --version` とリリースノートで示す。
- 既定値: owner/repo は `betiz0/spirits`。GitHub の owner/repo・API 基底 URL・ダウンロード基底 URL はスクリプト内定数とし、テスト用に環境変数(`SPIRITS_API_BASE_URL`、`SPIRITS_RELEASE_BASE_URL`)で上書きできるようにする。

- 選択肢: 常に GitHub の本番 URL へ固定する。
- 理由: チェックサム破損・latest 未検出・非対応プラットフォームの検証が実リリースに依存し、テスト不能になるため却下。
- 選択肢: jq を前提にする。
- 理由: 素の Linux 環境に無い可能性があり、一覧の解釈はトップレベルキー(字下げ 2)の走査で足りるため却下。この走査は GitHub の整形済み JSON に依存する(Risks 参照)。
- 選択肢: semver の最大を最新とする。
- 理由: POSIX sh で semver を比較する処理が要り(`sort -V` は GNU 拡張)、M2 の規模に対して過剰なため却下。古い系列へパッチを後から出すと、それが最新として選ばれる。
- 選択肢: GitHub の `/releases/latest` を使う。
- 理由: pi の `v*` リリースが latest になりうるため却下。

### 12. スパイクは実装の冒頭で行い、結果を分岐ゲートにしない

スパイクは 2 段で行う。まず bin の実装に入る前に、pi ソースの解決方式を最小バイナリで確定する(タスク 1.2、Decision 1)。次にビルドスクリプトが動いた後で、`docs/spikes/compiled-extensions.md` に (1) バンドル済み spirits 拡張のロード、(2) `~/.spirits/agent/extensions/` の外部 TS 拡張ロード、(3) 外部拡張からのバンドル済み pi パッケージ import、(4) 依存不足時の挙動、(5) `-e` で指定した拡張と組み込み拡張の併存、(6) 外部拡張から読んだ pi の `VERSION` が置換後の値であること、をコンパイルバイナリで確認して記録する(タスク 1.6)。pi の `VERSION` 置換プラグインがコンパイルで効くかは、1 段目(タスク 1.2)で併せて確認する。(2)(3) が壊れる場合のみ bin のロード方法を調整し、(4) は上流どおり拡張パス付きエラーで exit 1 になる実測(タスク 1.6)を README に記載して許容する。結果は成否に関わらず記録する。

- 選択肢: スパイクを省略し、上流の仮想モジュール経路を信頼する。
- 理由: `docs/spirits-design.md` §11 が「spirits 拡張のバンドル + 外部拡張混在は要検証」としており、実機確認が M2 の完了条件(スパイク記録済み)に含まれるため却下。

## 設計書からの変更点

本 change は次の点で `docs/spirits-m2-distribution.md` / `docs/spirits-design.md` と異なる。設計書への反映はタスク 4.2 で行う。

| 項目 | 設計書 | 本 change |
|---|---|---|
| リリーストリガ | `v*` タグ | `spirits-v*` タグ(既存 pi リリースとの分離)。手動起動は持たない |
| install.sh の latest | Releases の latest | draft と prerelease を除く `spirits-v*` の一覧先頭(`per_page=100`) |
| `VERSION` の書式 | 記述なし | `0.1.0`(`spirits-v` を前置してタグを得る) |
| install.sh の配布 URL | `<url>/install.sh` | `https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh` |
| install.sh の成功時の Bun 表示 | 内包 Bun バージョン | 実行環境の `bun --version`(参考情報。無ければ別途 Bun が必要な旨)。内包 Bun は `spirits --version` とリリースノートで示す |
| prerelease | 記述なし | バージョン部に `-` を含むタグは prerelease として公開 |
| lockfile | `bun.lock` 全面移行、`package-lock.json` 削除 | root `bun.lock` 導入のみ。npm フローと `package-lock.json` は残し、完全移行は別 change |
| build の入力 | 記述なし | pi の `dist` を使わず、ソースからコンパイルする(解決方式はタスク 1.2 で確定。不達なら dist を入力にする) |
| 設定ディレクトリ | `~/.spirits/extensions/`、`~/.spirits/bin/spirits` | 外部拡張は `~/.spirits/agent/extensions/`、インストール先は `~/.spirits/bin/spirits`。`PI_CODING_AGENT_DIR=~/.spirits/agent` で実現し、pi の管理バイナリ置き場(`<agentDir>/bin`)とインストール先を分ける |
| pi の更新通知 | 記述なし | `PI_SKIP_VERSION_CHECK=1` で抑止し、`-v` も `--version` と同じ出力にする。更新は install.sh の再実行 |
| pi 側の `VERSION` | 記述なし | ビルド時に pi コアのバージョン(`packages/coding-agent/package.json`)へ置換する。実行ファイル隣の `package.json` は使わない |
| assets | 記述なし(単一バイナリ) | 非同梱による機能劣化を明記し、README に制約を記載 |

## Risks / Trade-offs

- [Risk] Bun の `--compile` が pi のソース一式(worker、wasm、動的 import)を正しく埋め込めない、または spirits の `bin` から pi のソースへ解決できない → Mitigation: 冒頭のスパイク(タスク 1.2)で最小バイナリを作り、`--version`・`--help`・起動を確認する。解決できない場合は上流同様に `npm run build` の dist を入力にするフォールバック(Decision 1 の候補 (c))へ切り替え、build スクリプトと release workflow に dist のビルド手順を加える。worker 依存機能の実機確認はタスク 1.6 で行う。
- [Risk] `VERSION` の置換が、上流の `config.ts` の宣言の変更で効かなくなる、または `Bun.build` のプラグインがコンパイルで効かない → Mitigation: 置換対象が見つからなければビルドを失敗させ、置換関数を単体テストで固定する。プラグインがコンパイルで効くかはタスク 1.2 で確認し、効かない場合は Decision 2 の代替案(`install.sh` による `package.json` の生成など)を利用者に再確認する。
- [Risk] ソースコンパイルが gitignore 対象の生成物(モデルデータ)を必要とする → Mitigation: リリース workflow で hydrate ステップ(`bun packages/ai/scripts/generate-models.ts --strict --data-only`)を実行する。ローカルビルド前にも同じ hydrate が必要。
- [Risk] 単一バイナリで theme / assets / export-html が無く一部機能が劣化する → Mitigation: 起動と `tsrepl` は system テーマで成立することをスパイクで確認し、README に制約を明記する。assets 同梱は別 change 候補とする。
- [Risk] `PI_CODING_AGENT_DIR` の上書きや `~/.spirits/agent` のレイアウトが pi の将来変更で壊れる → Mitigation: 環境変数名とパスを bin 内の定数へ集約し、スパイクで `~/.spirits/agent/extensions/` のロードを実機確認する。
- [Risk] 外部拡張の仮想モジュール解決がコンパイルバイナリで壊れる → Mitigation: スパイク項目 (2)(3)。壊れた場合のみ bin のロード方法を調整し、結果をスパイク記録に残す。
- [Risk] root `bun.lock` と `package-lock.json` の二重管理が drift する → Mitigation: spirits CI と release workflow の `--frozen-lockfile` で不整合を検出する。完全移行を別 change として明記する。
- [Risk] `sha256sum -c` が失敗する形式(改行・パス)でチェックサムを出力する → Mitigation: 出力形式を `<hex>  <basename>` に固定し、install.sh 側とリリース smoke の両方で検証する。
- [Risk] install.sh の latest 解決が API レート制限や unauthenticated 制限で失敗する → Mitigation: `VERSION` 指定と手動ダウンロード検証手順を README に併記し、進捗・失敗理由を stderr に表示する(タスク 2.1、2.2)。
- [Risk] 同じリポジトリの pi の `v*` リリースが増え、`per_page=100` の先頭に `spirits-v*` が入らなくなる → Mitigation: 未検出として扱い、`VERSION` 指定を案内する。頻発する場合は別 change でページングまたは専用リポジトリを検討する。
- [Risk] jq を使わない一覧の解釈が GitHub の応答の整形(トップレベルキーの字下げ)に依存する → Mitigation: fixture は実際の応答を採取して作り(タスク 2.1)、実リリースでの解決を 5.2 で確認する。
- [Risk] `main` の install.sh が未リリースの変更を利用者に配る → Mitigation: インストーラはリリース成果物の名前とチェックサムだけに依存する設計とし、検証失敗時は配置しない。README に `main` の版が配られる旨を記載する。
- [Risk] リポジトリが非公開だと、未認証の `curl` による install.sh とリリース成果物の取得が失敗する → Mitigation: 公開を前提とし、README に明記する。公開設定は未確認のため、タスク 5.2 の前に確認する。
- [Risk] `spirits update` が pi のリリースページを案内する → Mitigation: README に更新は install.sh の再実行である旨を明記する。コマンドの横取りは `spirits update` の非目標に反するため M2 では行わない。
- [Risk] GitHub Actions の `setup-bun` で固定した 1.4.2 とローカル Bun の差で compile 結果が変わる → Mitigation: workflow でバージョンをピンし、リリースノートに内包 Bun を記録する。
- [Risk] `bun install` が既存の `node_modules` を置換し、npm 前提の開発環境へ影響する → Mitigation: 追加は lockfile のみで npm scripts は変えない。npm 経路と Bun 経路の両方を CI で維持する。
- [Risk] `spirits-v*` と `v*` のタグ運用を間違えると、どのリリースにも spirits アセットが無い状態になる → Mitigation: release workflow のトリガと install.sh の解決条件を同じ prefix にし、README にタグ命名を明記する。
- [Risk] リリースビルドが `[spirits]` 以外のコミットに混ざり上流マージが難しくなる → Mitigation: workflow / `bun.lock` / スクリプト追加を `[spirits]` プレフィックスの 1 コミットに分離する。

## Migration Plan

- 既存の pi 利用者・開発フローへの影響はない。M2 は追加ファイルと `bun.lock` の追加であり、既存 npm workflow は変更しない。
- ロールバックは追加した bin / scripts / workflow / `bun.lock` の削除で完了する。公開済み spirits Release は個別に削除できる。
- `bun.lock` のコミットは pre-commit の lockfile チェック対象になるため、コミット時に `PI_ALLOW_LOCKFILE_CHANGE=1` が必要になる(AGENTS.md の運用ルール)。

## Open Questions

なし。
