# Tasks

## 1. 更新コア(リリース解決・版比較・タイムアウト)

- [x] 1.1 `src/update/release.ts` に最新 stable `spirits-v*` リリースの解決を実装し、`cd packages/spirits && bun test test/update-release.test.ts` で draft / prerelease / pi タグ除外、ベース URL 上書き、stable リリース未検出のケースが通ることを確認する
- [x] 1.2 インストール済みバージョンと解決済みバージョンの比較と `--force` を含めた置換判定(置換 / 最新 / 最新より新しい)を `Bun.semver.order()` で純関数として実装し、`cd packages/spirits && bun test test/update-version.test.ts` で `0.2.0` と `0.3.0`、`0.3.0` 同士、`0.4.0-rc.1` と `0.3.0` の各組を `--force` の有無で確認する
- [x] 1.3 `src/constants.ts` に `DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS` と `ENV_UPDATE_IDLE_TIMEOUT_SECONDS` を追加し、無通信タイムアウト付きの要求処理を実装し、`cd packages/spirits && bun test test/update-timeout.test.ts` で次を確認する: 未設定・`0`・`-1`・`1.5`・`abc` が 10 秒、`2` が 2 秒に解決される。応答を止める fixture で上限経過後に失敗する。上限より短い間隔で送り続け、全体では上限を超える fixture で失敗しない

## 2. ダウンロード・検証・原子的配置・後始末

- [x] 2.1 実行ファイルと `.sha256` を取得し、ストリーム計算した sha256 を照合する処理を実装し、`cd packages/spirits && bun test test/update-download.test.ts` で、成功のケースと、不一致で一時ファイルが残らないケースが通ることを確認する
- [x] 2.2 インストール先ディレクトリ内の `.spirits-tmp-<pid>/` へ保存し、実行ビットを付与して rename する原子的配置を実装し、`cd packages/spirits && bun test test/update-apply.test.ts` で次を確認する: 実行ビットが付与される。rename 失敗時に元ファイルと実行ビットが残り、一時ディレクトリが消える。2 つの配置を同時に実行した後、配置先がどちらかの検証済み内容と一致し、実行ビットを持つ
- [x] 2.3 失敗時と SIGINT / SIGTERM 時の一時ディレクトリ削除と、開始時の残骸削除(PID が存在しないものだけ)を実装し、`cd packages/spirits && bun test test/update-cleanup.test.ts` で次を確認する: 終了済み PID の残骸が削除される。生存中の子プロセスの PID を持つ一時ディレクトリが残る。停止した fixture からダウンロード中の子プロセスへ SIGINT と SIGTERM をそれぞれ送ると、非ゼロで終了し、元ファイルが変わらず、一時ディレクトリが残らない
  - verify2 指摘(C-2): 残骸削除を拒否ガード通過後・リリース解決の前に移し、最新版(no-op)の `runSelfUpdate` でも終了済み PID の残骸が削除されることを `runSelfUpdate` 経由のテストで確認する。現状は掃除関数の単体テストのみで、no-op 経路では `cleanStaleTempDirs` が呼ばれない
- [x] 2.4 未コンパイル実行・非 Linux/x64・書込不可・`PI_OFFLINE`・リリース解決失敗・ダウンロード失敗・無通信タイムアウトの判定とメッセージを実装し、`cd packages/spirits && bun test test/update-guard.test.ts` で次を確認する: 各ケースが非ゼロで終了し、`PI_OFFLINE` 以外はインストーラ再実行の案内を含む。`PI_OFFLINE` の `1` / `TRUE` / `yes` では解除方法を含む文を返し、fixture への要求が 0 件になる。`PI_OFFLINE=0` では拒否しない
  - verify2 指摘(C-1): 書込不可の拒否を no-op 判定(最新・最新より新しい)より前に移し、インストール済みが最新版でも配置先が書込不可なら非ゼロで拒否することを `runSelfUpdate` のテストで確認する。現状は置換経路でのみ検査される。root では `access(W_OK)` が 0o555 を通過するため、事前検査と一時ディレクトリ作成の二本立ての整理もあわせて行う

## 3. CLI 分類と bootstrap 統合

- [x] 3.1 `update` の引数を self / all / pass-through に分類する純関数を pi の `parsePackageCommand` に合わせて実装し、`cd packages/spirits && bun test test/update-classify.test.ts` で次の表駆動ケースが通ることを確認する
  - self: `update`、`update self`、`update pi`、`update --self`、`update --force`、`update -a`、`update -na`、`update self --self`
  - all: `update --all`、`update --self --extensions`、`update self --extensions`、`update --all --force`、`update --all -a`
  - pass-through: `update --extensions`、`update --models`、`update --extension <src>`、`update <src>`、`update --help`、`update self -h`、`update --all --self`、`update --self --models`、`update self extra`、`update --self --unknown`、値なしの `update --extension`、`update --offline`、`update -l`
- [x] 3.2 自己更新のオーケストレーション(最新時と最新より新しい時の no-op、`--force`、`PI_OFFLINE` の拒否、表示メッセージ、終了コード)を実装し、`cd packages/spirits && bun test test/update-run.test.ts` で各分岐の終了コードとメッセージを確認する
- [x] 3.3 `bin/bootstrap.ts` に top-level await の intercept を実装する。未コンパイル実行の拒否は最初の `await` より前に行う。次を確認する
  - `bun packages/spirits/bin/spirits.ts update; echo $?` が、ソース実行の拒否とインストーラ再実行の案内を表示し、非ゼロを返し、pi の出力を含まない
  - `bun packages/spirits/bin/spirits.ts --version` と `bun packages/spirits/bin/spirits.ts --help` の出力と終了コードが、変更前に取得したものと一致する
  - `bun packages/spirits/bin/spirits.ts update --help` が pi の update ヘルプを表示し、0 を返す
- [x] 3.4 all の実行で、自己更新の成功後(置換しない成功を含む)にインストール先の実行ファイルへ `update --extensions` を trust 指定付きで spawn し、失敗時は spawn しない処理を実装し、`cd packages/spirits && bun test test/update-routing.test.ts` で順序、終了コードの伝播、`-a` / `-na` の引き継ぎ、最新時の spawn、失敗時に spawn しないことを確認する

## 4. install.sh の原子的配置・後始末・同版スキップ

- [x] 4.1 install.sh のダウンロードと検証を `$INSTALL_DIR/.spirits-tmp-<pid>/` で行い、rename で配置するよう変更する。あわせて、失敗時と INT / TERM 時の削除、開始時の残骸削除(`kill -0` で生存していない PID のもののみ)を実装し、`sh scripts/install.test.sh` で次を確認する: 既存の全ケース。検証失敗時に既存ファイルが変わらず `.spirits-tmp-*` が残らない。ダウンロード中の SIGINT で既存ファイルが変わらず一時ディレクトリが残らない。終了済み PID の残骸が削除される。生存 PID の一時ディレクトリが残る。`--uninstall` では残骸も削除されない
- [x] 4.2 latest 解決時にインストール済みの `--version` の先頭行 `spirits <version>` を比較して、同版ならダウンロードを省略する処理を実装する。あわせて、判定不能時と版が異なる時(インストール済みが新しい prerelease の場合を含む)の配置、`VERSION=x.y.z` 明示時の常時配置、`up to date` / `X -> Y` の表示を実装する。`sh scripts/install.test.sh` で新ケース「同版の再実行」「VERSION 明示での再配置」「別バージョンへの再実行」「新しい prerelease からの置換」「`--version` 失敗時の配置」が通ることを確認する

## 5. ドキュメント

- [x] 5.1 `README.md` と `packages/spirits/README.md` の更新手順を書き換える。記載する内容: `spirits update` / `--all` / `--force`、`PI_OFFLINE` での拒否、`SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS`、install.sh の同版スキップと修復用の `VERSION=`、0.1.0 からの初回再インストール。`grep -n "No automatic updates\|installer の再実行を案内\|コマンドは未対応" README.md packages/spirits/README.md` が何も出力しないことを確認する
- [x] 5.2 `docs/spirits-design.md` の更新手段の記述(変更前の 159、172、188 行目)と、`docs/spirits-m2-distribution.md` の「将来検討」の記述(変更前の 32 行目)を、新しい更新手段に合わせて書き換える。``grep -n '`spirits update` は提供しない\|自動アップデート機構は持たない\|install.sh の再実行を案内する\|`spirits update` コマンド(将来検討)' docs/spirits-design.md docs/spirits-m2-distribution.md`` が何も出力しないことを確認する

## 6. リリース CI スモークと統合確認

- [x] 6.1 `scripts/self-update-smoke.sh <old> <new> <expected-version>` を追加する。このスクリプトは、新しい版を stable として掲載した fixture を `python3 -m http.server` で配信し、一時インストール先へコピーした古いバイナリで `update` を実行して、終了コード 0、`--version` が期待する版を含むこと、`.spirits-tmp-*` が残らないことを確認する。ローカルで `bun scripts/build-binaries.ts --version 0.0.0-0` の出力を `dist/` の外へ移し、`bun scripts/build-binaries.ts --version 0.0.1` の後に `sh scripts/self-update-smoke.sh <移した古いバイナリ> dist/spirits-linux-x64 0.0.1` が 0 で終わることを確認する
- [x] 6.2 `.github/workflows/spirits-release.yml` に、リリースビルドより前に `--version 0.0.0-0` で古いバイナリをビルドして `dist/` の外へ移す手順を追加する。既存のスモークに、`dist/spirits-linux-x64 --version` がタグの版を含むことの確認と、`scripts/self-update-smoke.sh` の実行を追加する。公開手順(`Create release`)を除くワークフローの各 `run` を、`GITHUB_REF_NAME=spirits-v0.0.1` としてローカルで同じ順に実行し、全て成功すること、最終的な `dist/spirits-linux-x64 --version` が `0.0.1` を含むことを確認する
- [x] 6.3 `cd packages/spirits && bun test` と `cd packages/spirits && bun run check` を実行して既存テストを含めて全て通ること、`grep -rn "rlm\|harness\|phase2\|config.ts" packages/spirits/src/update packages/spirits/bin/bootstrap.ts scripts/install.sh` が何も出力しないことを確認する
- [x] 6.4 ルートで `npm run check` を実行し、エラー・警告・info が無いことを確認する

## Workflow follow-up

- identity 修正 (`spirits-m2-verify`) を含むリリースを切り、リリースノートに「0.1.0 からは install.sh の再実行が 1 回必要」を記載する
- リリース後にコンパイル済みバイナリで `spirits update` の実機確認を行う
