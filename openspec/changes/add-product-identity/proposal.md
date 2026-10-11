# Proposal

## Why

M1–M4 の実装が完了し、現在は M5 の判断材料を集めるドッグフーディング段階にある。`spirits` 実行ファイル名・データディレクトリ・`spirits --version` は spirits を名乗る一方、CLI バナー、TUI ヘッダ、agent dir の環境変数名は pi のままである。

原因はコンパイルバイナリに実行ファイル隣の `package.json` が無いため、pi の rebrand 機構(`piConfig`)が読めないことにある。M2 は env-defaults でパスだけを回避したため、製品名と内部識別子がずれた状態でドッグフーディングを続けている。M5 の判断材料(セッション・表示・ログ)とリリース成果物を一貫させるため、M5 の前に identity を spirits へ揃える。

## What Changes

- Pi コアの `config.ts` に app 名と設定ディレクトリの環境変数 override(`PI_APP_NAME` / `PI_CONFIG_DIR`)を追加する。既定値は現状のまま(未設定時は package.json → フォールバック)。
- `packages/spirits/bin/bootstrap.ts` が pi を import する前に `PI_APP_NAME=spirits` を設定する。設定ディレクトリ名は `.pi` のまま維持し、pi エコシステムの project 設定とリポジトリの `.pi/` 開発リソースを引き続き読む。
- これにより `APP_NAME` / `APP_TITLE` / `ENV_AGENT_DIR` が派生で spirits になり、agent dir の override 環境変数は `SPIRITS_CODING_AGENT_DIR` になる。env-defaults は未設定時に `~/.spirits/agent/` を設定し、`PI_SKIP_VERSION_CHECK=1` は継続する。
- TUI ヘッダを spirits 拡張が `ctx.ui.setHeader` で差し替え、ワードマーク・バージョン(`SPIRITS_VERSION`、ソース実行時 `0.0.0-dev`)・キーヒント・オンボーディング文を表示する。`quietStartup` を尊重し、起動ヘルプの展開(`setExpanded`)に同期する。
- CLI help のバナー説明文、agent dir 表示、散在する pi 文言を、非 pi ディストリビューションでは spirits を表示するようコアを修正する。agent dir 表示は解決済みの agent dir を使う。
- `spirits update` は pi の releases ではなく spirits の更新手段(install.sh の再実行)を案内し、help の update 記載を spirits 用に合わせる。
- env-defaults で `PI_TELEMETRY=0` を既定にし、pi.dev への install レポートと pi 名義の provider attribution ヘッダを送らない。テレメトリの有効化は環境変数 `PI_TELEMETRY=1` の明示指定のみとし、settings.json での opt-in は既定の無効化に上書きされる。コア `provider-attribution.ts` の `x-opencode-client` ヘッダは、非 pi ディストリビューションでは明示有効化時のみ付与する(pi 実行時の挙動は変えない)。
- `openspec/config.yaml` の Roadmap/rules を、製品 identity の変更をフェーズ外の change として扱えるよう更新する。

**BREAKING**: agent dir の override 環境変数が `PI_CODING_AGENT_DIR` から `SPIRITS_CODING_AGENT_DIR` に変わる。旧名は読まない。既定パス `~/.spirits/agent/` は変わらず、既存データはそのまま使われる。あわせてテレメトリが既定で無効になり、settings.json での有効化は効かなくなる(再開は `PI_TELEMETRY=1`)。

## Capabilities

### New Capabilities

- `product-identity`: CLI バナー/TUI ヘッダの表示、実行時の環境識別(agent dir の環境変数)、テレメトリと provider 名義を spirits として一貫させる振る舞い。

### Modified Capabilities

- `binary-distribution`: 設定ディレクトリ要件の環境変数名を、アプリ名から派生する `SPIRITS_CODING_AGENT_DIR` に変更する。更新通知抑止の要件に、help の update 記載と `spirits update` の案内先が spirits の更新手段(install.sh)を示すことを追加する。

## Impact

- **Pi 上流コアへの差分: あり。** `packages/coding-agent/src/config.ts`(env override)、`cli/args.ts` / `package-manager-cli.ts` / `extensions/mcp/cli.ts` / `modes/interactive/components/config-selector.ts`(help・agent dir 表示)、`modes/interactive/interactive-mode.ts`(散在文言)、`core/provider-attribution.ts`(`x-opencode-client` ヘッダのゲート)。1 変更 = 1 コミットに分離し `[spirits]` プレフィックスを付ける。
- `packages/spirits`: bootstrap(env 設定)、env-defaults / constants(agent dir の env 名)、TUI ヘッダモジュール、バージョン解決の `src/` 移動、型ミラー拡張、テスト、README。
- 設定ディレクトリ: `CONFIG_DIR_NAME` は `.pi` のまま。project 設定と `~/.pi/agent` の pi 側挙動は変えない。
- 依存追加: なし(`keyHint` / `keyText` / `rawKeyHint` は既存 export、色はテーマトークンを使う)。
- ドキュメント: `openspec/config.yaml`(Roadmap/rules)、`docs/spirits-design.md`、`packages/spirits/README.md`、`README.*` の環境変数名。
