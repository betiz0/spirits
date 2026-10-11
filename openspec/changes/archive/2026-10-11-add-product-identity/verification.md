# Verification Record

`add-product-identity` の 7.2 / 7.3 と 6.5 の手動確認結果。実行環境: Linux x86_64, Bun 1.4.2, 2026-10-11。

## ビルド

```
bun scripts/build-binaries.ts --version 0.0.0-test
# -> dist/spirits-linux-x64 (spirits 0.0.0-test, pi 1.0.0)
```

ヘッダと `--version` の整合 (7.1/7.3):

- `spirits --version` -> `spirits 0.0.0-test (Bun 1.4.2)`
- 起動ヘッダ -> `spirits v0.0.0-test`

## 7.2 コンパイル済み表示と保存先

すべて空の HOME (`mktemp -d`) で実行。

| 確認 | コマンド | 結果 |
| --- | --- | --- |
| バナー/usage | `spirits --help` | `spirits - AI coding assistant`、`spirits update [source|self]   Update spirits, extensions, or model catalogs`。`Update pi` なし |
| update 案内 | `HTTPS_PROXY=http://192.0.2.1:9 spirits update` | 210ms で終了 (ネットワーク要求なし)。stderr に `Update spirits by re-running the installer that provided this installation.`、pi の releases URL なし |
| update help | `spirits update --help` | usage は `spirits update [source|self]`、例は `spirits update self`。`pi` ターゲットなし |
| auth help | `spirits auth --help` | `spirits auth ...` のみ。`pi auth` なし |
| 旧 env 名の無視 | `HOME=$TMP PI_CODING_AGENT_DIR=/tmp/old-agent spirits --approve` (TUI) | `$TMP/.spirits/agent/` を作成 (`settings.json` / `models-store.json` / `auth.json` / `sessions/`)。`/tmp/old-agent` は作成されず、`$TMP/.pi` も作成されない |
| project skill | `$PROJ/.pi/skills/spirits-verify-skill.md` を置き `cd $PROJ` で TUI 起動 | 起動リソースに `[Skills] spirits-verify-skill` が表示される |

補足: `spirits update` の `Location of spirits executable:` は Bun の仮想パス `/$bunfs/root/spirits-linux-x64` を表示する。実行ファイル自身の位置として意味は薄いが、案内自体 (installer 再実行、pi releases URL なし) は仕様どおり。

## 7.3 コンパイル済みシナリオ

プロキシ (`127.0.0.1:18080`) で `pi.dev:443` への CONNECT を記録。モデルカタログ取得のノイズは、実環境の新鮮な `models-store.json` をホームへコピーして抑止した。TUI は 8 秒起動して終了。

| シナリオ | 設定 | `pi.dev` への CONNECT |
| --- | --- | --- |
| 既定で送信しない | なし | 0 |
| 明示有効化 | `PI_TELEMETRY=1` | 1 |
| settings での opt-in の無効化 | `settings.json` に `enableInstallTelemetry: true`、env なし | 0 |

- 旧 env 名の無視・既定の保存先・ヘッダのバージョン整合・project skill 利用は上表 7.2 と同じ実行で確認済み。
- 更新通知: env-defaults が `PI_SKIP_VERSION_CHECK=1` を常時設定し、上記 8 秒間で pi.dev への接続は 0 件。TUI に "Update Available" は表示されない。
- `update` 案内: 上記 7.2 を参照。

## 6.5 起動ヘッダのフラッシュ

- 修正前: `PATH` から `fd` / `fdfind` / `rg` を除外し `HTTPS_PROXY=http://192.0.2.1:9` でダウンロードを遅延させると、pi ロゴ (`▀▀█` / `█▀ █ v1.0.0`) と `Pi can explain its own features ...` が `fd not found. Downloading...` と同時に 4 秒以上表示された (tmux `pipe-pane` ログで確認)。
- 修正後: 同じ遅延状態で pi ブランドは 0 件、`fd not found. Downloading...` のみ。通常 PATH では `spirits v0.0.0-test` とオンボーディング文が表示される。`APP_NAME=pi` の生 pi 実行では従来どおり即時に組み込みヘッダが表示される。

## 未実施

- `./test.sh` の再実行 (Workflow follow-up の verify2 C-4)。既知の未ビルド dist / 上流モデルメタデータ由来の失敗があるため、archive 前に別途実施する。
