# spirits M2 設計書: 配布基盤

- フェーズ: M2 / 版 v1.0 / 2026-10-07
- 前提文書: spirits 設計書 v0.4(§4.5)、M1 設計書

## 1. 目的

M1 の成果を含む spirits 全体を `bun build --compile` で単一バイナリ化し、Linux x86_64 環境へ install.sh で配布できる状態にする。

## 2. 依存関係ルール

**許可:** M1(REPL ツール単体で動作確認済みであること)、Pi 上流のコンパイルバイナリ機構(仮想モジュール経路)

**禁止:**

- M3 以降(rlm, harness)の存在を前提に bin エントリを書かない。bin は「spirits 拡張を既定ロードして pi を起動する」責務だけを持ち、拡張内に何のツールが登録済みかを知らない
- install.sh はバイナリの中身(M3/M4 機能)に依存しない。配布責務のみ

## 3. スコープ

やる:

- `packages/spirits/bin/`: コンパイル用エントリ。pi CLI を spirits 拡張既定ロードで起動する薄いラッパ
- `scripts/build-binaries.ts`: linux-x64 コンパイル(ソースから)+ SHA256 チェックサム生成 + バージョン埋め込み
- `scripts/install.sh`: 下記仕様
- GitHub Actions リリース workflow(`spirits-v*` タグ push → ビルド → Release へ添付)
- スパイク: コンパイルバイナリでの拡張バンドル + `~/.spirits/agent/extensions/` 外部拡張の混在ロード実機検証

やらない:

- macOS / Windows ターゲット(v0.3 で範囲外確定)
- 自動アップデート機構 / `spirits update` コマンド(将来検討)
- npm 公開

## 4. bin エントリ設計

- `bin/spirits.ts` がエントリ。処理は 3 ステップのみ:
  1. 開発時のみ `Bun.version` ゲート(<1.4.0 拒否、<1.4.2 警告。コンパイル済みではスキップ)
  2. 組み込み spirits 拡張パッケージをロード対象に追加(仮想モジュール経路)
  3. pi CLI エントリへ処理を委譲(引数はそのまま透過)
- バージョン表示(`spirits --version` / `-v`)用に、ビルド時埋め込みの `SPIRITS_VERSION` と内包 Bun バージョンを出力
- 環境既定値として `PI_CODING_AGENT_DIR=~/.spirits/agent`(未設定時のみ)と `PI_SKIP_VERSION_CHECK=1` を設定し、pi の更新通知を抑止する
- pi コアの `VERSION` はビルド時に `packages/coding-agent/package.json` の version へ置換する(実行ファイル隣の `package.json` は使わない)

## 5. ビルド・リリース設計

### build-binaries.ts

- `bun build --compile --target=bun-linux-x64` で `dist/spirits-linux-x64` を生成
- 入力はソース(`packages/spirits/bin/spirits.ts` + image-resize / codemode worker)。`Bun.build` の `tsconfig` に root `tsconfig.json` を指定して pi ソースを解決する(pi の `dist` は使わない)
- `packages/ai/src/providers/data/*.json` は gitignore 対象のため、ビルド前に `bun packages/ai/scripts/generate-models.ts --strict --data-only` で hydrate する(タスク 5.2 のリモート実行で検出)
- バージョンは `--version` 引数 / `SPIRITS_VERSION` / `git describe --tags --match 'spirits-v*'` の順で解決して `define` で埋め込む
- pi コアの `VERSION` を `packages/coding-agent/package.json` の version へ置換する(置換対象が無ければビルド失敗)
- 同時に `spirits-linux-x64.sha256` を `<hex>  <basename>` 形式で生成

### lockfile

root に `bun.lock` を導入し、リリース workflow は `bun install --frozen-lockfile` で依存導入する。既存 npm workflow と `package-lock.json` は当面残し、完全移行は別 change とする(設計書 §5.4 の段階移行)。

### GitHub Actions リリース workflow

- トリガ: `spirits-v*` タグ push のみ(手動起動は持たない)
- ランナー: ubuntu-latest のみ、Bun は 1.4.2 でピン留め(設計書 §8)
- 手順: `bun install --frozen-lockfile` → `bun packages/ai/scripts/generate-models.ts --strict --data-only`(モデルデータ hydrate) → `bun test` → ビルド → チェックサム → スモーク → 専用 GitHub Release へ添付 → リリースノートに内包 Bun バージョン記載
- バージョン部に `-` を含むタグ(例: `spirits-v0.3.0-rc.1`)の Release は prerelease として公開する

## 6. install.sh 仕様

POSIX sh 準拠。`curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh` で動作し、`main` の版が配られる。

1. `uname -s` が Linux、`uname -m` が x86_64 であることを検査(依存コマンド検査より先)。不一致は「このバージョンは Linux x86_64 専用」と表示して exit 1
2. バージョン決定: `VERSION=0.1.0` 形式の指定があればタグ `spirits-v0.1.0` を使う。無ければ Releases API の一覧(`per_page=100`)から draft と prerelease を除き、`tag_name` が `spirits-v` で始まる先頭を latest として解決する(pi の `v*` リリースは無視)
3. `spirits-linux-x64` と `.sha256` を一時ディレクトリへダウンロード
4. `sha256sum -c` で検証。**検証失敗時は絶対に配置しない**(一時ファイル削除して exit 1)
5. `~/.spirits/bin/spirits` へ配置し実行ビット付与(上書き=アップグレード、冪等)
6. `~/.spirits/bin` が PATH に無ければ shell rc への追記行を案内(自動編集はしない)
7. 成功時に利用開始コマンドと、実行環境の `bun --version` を表示(無ければ拡張の依存解決に別途 Bun が必要な旨)。`bun` の有無で成否は変えない
8. `--uninstall` 指定時は、バイナリとデータディレクトリの削除コマンドを案内(ファイルは自動削除しない)。依存コマンドとネットワークは要求せず、終了コード 0

owner/repo(`betiz0/spirits`)、API 基底 URL、ダウンロード基底 URL は定数とし、テスト用に `SPIRITS_API_BASE_URL` / `SPIRITS_RELEASE_BASE_URL` で上書きできる。README には「pipe to sh が不安な向きには、バイナリと .sha256 を手動ダウンロードして検証する手順」を併記する。

## 7. スパイクタスク(M2 冒頭で実施)

コンパイルバイナリで以下を実機確認し `docs/spikes/compiled-extensions.md` に記録:

1. spirits 拡張(バンドル済み)が仮想モジュール経路でロードされる
2. `~/.spirits/agent/extensions/` に置いた外部 TS 拡張がロードされる
3. 外部拡張からバンドル済み pi パッケージを import できる
4. 外部拡張に独自 node_modules 依存が必要な場合の挙動(依存不足は拡張パス付きエラーで exit 1。`pi -ne` の案内が stderr に出る)

結果は `docs/spikes/compiled-extensions.md` に記録する。

不達の場合: 2/3 が壊れるなら bin エントリ側のロード順を調整、4 は仕様上の制約として README に明記して許容。

## 8. 完了条件

- クリーンな linux-x64 環境(Docker コンテナ等)で install.sh → `spirits` 起動 → `tsrepl` が動く
- チェックサム検証を壊した場合に配置されないことを手動確認
- スパイク記録済み
- theme / assets / export-html 非同梱の制約(依存解決には別途 Bun が必要)が README に記載されている

## 9. リスク

- **上流のコンパイル機構の変動**: 上流がバイナリ配布をやめた/方式変更した場合に追随コストが出る → bin エントリを上流のエントリへの薄い委譲に留めて影響を局所化
- **glibc 依存**: bun-linux-x64 バイナリは glibc 環境前提。musl(Alpine)は対象外と README 明記(追加ターゲット化は要望が出てから)
- **theme / assets 非同梱による機能劣化**: テーマ切替や HTML エクスポートが system テーマ等へフォールバックする → README に制約を明記し、必要になった時点で assets 同梱を別 change とする
- **外部拡張の依存不足**: 起動時に拡張パス付きエラーで非ゼロ終了する(pi 上流の diagnostics 処理) → README に記載し、依存解決には別途 Bun が必要な旨を案内する
