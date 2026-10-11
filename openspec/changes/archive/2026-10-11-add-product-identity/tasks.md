# Tasks

## 1. プロジェクト設定と設計ドキュメント

- [x] 1.1 `openspec/config.yaml` の Roadmap/rules に、フェーズ外の変更として `product-identity` を扱える記述を追加し、古い参照(`docs/design.md` / `docs/phases/`)を実在の `docs/spirits-design.md` / `docs/spirits-m*.md` に直す。`openspec validate add-product-identity` が通り、`openspec show add-product-identity` で設定が読めることを確認する。
  - verify2 指摘(W-1/W-2): `openspec/config.yaml:32` の rules.proposal[1] が、未引用の `例: product-identity` を含むため YAML がマッピングとして解釈し、CLI に無視されている(`openspec instructions apply` が警告)。スカラー全体を引用符で囲み、警告が消えることを同コマンドで確認する。あわせて、旧 config のコピーでどのタスクにも対応しない `docs/config.yaml` を削除する。
- [x] 1.2 `docs/spirits-design.md` に本変更の決定(env override の導入、`CONFIG_DIR_NAME` は `.pi` 維持、拡張ヘッダ、テレメトリ既定オフと settings opt-in の無効化、`x-opencode-client` ヘッダのゲート、`SPIRITS_CODING_AGENT_DIR` への BREAKING)を反映し、`rg -n 'PI_APP_NAME|SPIRITS_CODING_AGENT_DIR|PI_TELEMETRY|x-opencode-client' docs/spirits-design.md` の出力が proposal/design の用語と一致することを確認する。

## 2. コア: identity の環境変数 override

- [x] 2.1 `packages/coding-agent/src/config.ts` に `PI_APP_NAME` / `PI_CONFIG_DIR` の override を追加し、env 設定時に `APP_NAME` / `APP_TITLE` / `CONFIG_DIR_NAME` が上書きされ、未設定時は package.json → フォールバックのままであることを新規テスト `packages/coding-agent/test/app-identity.test.ts` で確認する(実行: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/app-identity.test.ts`)。
- [x] 2.2 `packages/coding-agent/docs/environment-variables.md` に `PI_APP_NAME` / `PI_CONFIG_DIR` を追記し、`rg -n 'PI_APP_NAME|PI_CONFIG_DIR' packages/coding-agent/src/config.ts packages/coding-agent/docs/environment-variables.md` で両者の変数名が一致することを確認する。
- [x] 2.3 コア差分を `[spirits]` プレフィックスの独立コミットとして分離し、`git log --oneline -1` でメッセージを確認する。

## 3. コア: 表示・送信の spirits 対応

- [x] 3.1 `packages/coding-agent/src/cli/args.ts` のバナー説明文を `APP_NAME !== "pi"` で分岐し、pi 実行時の文言が変わらないことと、spirits 実行時に `read, bash, edit, write tools` が spirits の説明として出ないことを `test/args.test.ts` への新規ケースで確認する(実行: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/args.test.ts`)。
- [x] 3.2 agent dir を表示する 5 箇所(`cli/args.ts` の 2 箇所、`package-manager-cli.ts`、`extensions/mcp/cli.ts`、`modes/interactive/components/config-selector.ts`)を解決済み `getAgentDir()` の値に統一し、`SPIRITS_CODING_AGENT_DIR` 設定時の表示が実値と一致することを確認する。
- [x] 3.3 再開・クラッシュなどの散在する pi 文言を `APP_NAME` に置換し、既存 `test/format-resume-command.test.ts` へのケース追加と `rg -n '"start pi|restart pi' packages/coding-agent/src` の残存確認(0 件)で検証する(実行: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/format-resume-command.test.ts`)。
- [x] 3.4 `getSelfUpdateUnavailableInstruction` の bun-binary 文言を非 pi ディストリビューション向けに一般化し、あわせて `cli/args.ts` の update 行の説明(`Update pi, extensions, or model catalogs`)と `[source|self|pi]` を非 pi 表示に修正する。`spirits update` が pi のリリース URL ではなく installer の再実行を案内することを `test/config.test.ts` へのケース追加で、`spirits --help` に `Update pi` が含まれないことを `test/args.test.ts` へのケース追加で確認する(実行: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/config.test.ts test/args.test.ts`)。
  - verify2 指摘(C-1/C-2): helper 分岐は入れたがコマンド経路が未対応。`spirits update` は `package-manager-cli.ts:1038` → `getSelfUpdatePlan()` → Pi API(`pi.dev/api/latest-version`) を先に問い合わせ、通常経路では installer 案内に到達しない(オフラインでは `Could not determine latest spirits version.` で失敗、Pi に新版がなければ `already up to date` で終了)。非 pi Bun バイナリでは Pi 照会の前に分岐し、installer 再実行を案内して終了させる。さらに `spirits update --help` が `[source|self|pi]` / `Update pi only` を表示する(`package-manager-cli.ts:273,341-358`)ため、`getPackageCommandUsage("update")` と help 本文も非 pi 分岐にする。`spirits update` がネットワーク要求なしに案内を出すコマンドレベルのテストと、update help に pi が出ないテストを追加する。
- [x] 3.5 `packages/coding-agent/src/core/provider-attribution.ts` の `getSessionHeaders` について、`x-opencode-client` ヘッダの付与を `APP_NAME !== "pi"` のとき `isInstallTelemetryEnabled` が真の場合のみに変更する(`x-opencode-session` は維持)。pi 実行時は現状どおり付与されることと、非 pi 実行時は明示有効化時のみ付与されることを `test/sdk-openrouter-attribution.test.ts` へのケース追加で確認する(実行: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/sdk-openrouter-attribution.test.ts`)。
- [x] 3.6 コア差分を `[spirits]` プレフィックスの独立コミットとして分離し、`git log --oneline` で確認する。
- [x] 3.7 `spirits auth --help` が `Usage: pi auth ...` を表示する問題を修正する(verify2 指摘 C-3)。`packages/coding-agent/src/cli/auth-command.ts:39-43` の `printAuthCommandHelp` が `pi auth` 直書きなので `${APP_NAME}` 展開に変え、`spirits auth --help` に `pi auth` が含まれないことを `test/args.test.ts` または新規ケースで確認する。コア差分は `[spirits]` プレフィックスの独立コミットに分離する。なお design.md の Open Questions に、spec 要件と auth 表示の扱いの緊張を記録済み(3.4 とあわせて判断)。

## 4. fork: runtime identity

- [x] 4.1 `packages/spirits/src/constants.ts` の agent dir env 定数を派生名(`SPIRITS_CODING_AGENT_DIR`)に合わせ、`test/env-defaults.test.ts` を更新して `bun test test/env-defaults.test.ts` が通ることを確認する。
- [x] 4.2 `packages/spirits/bin/bootstrap.ts` が pi の import 前に `PI_APP_NAME=spirits` を設定し、`bun packages/spirits/bin/spirits.ts --help` のバナーが `spirits` になることを確認する。
- [x] 4.3 env-defaults に `PI_TELEMETRY=0` を追加し、`PI_TELEMETRY` 未設定時に `0` が設定されることと、`PI_TELEMETRY=1` の明示指定が優先されることを `bun test test/env-defaults.test.ts` のケースで確認する。
- [x] 4.4 `packages/spirits/README.md` と `README.*` の環境変数名・agent dir 説明・BREAKING に加え、テレメトリが既定オフで settings.json での opt-in は効かないこと(再開は `PI_TELEMETRY=1`)を記載する。`rg -n 'PI_CODING_AGENT_DIR' README.md README.ja.md README.zh.md README.de-CH.md packages/spirits/README.md` が旧名の説明だけを返すことと、`rg -n 'PI_TELEMETRY' packages/spirits/README.md` が再開方法の記載を返すことを確認する。

## 5. fork: バージョン解決の共用

- [x] 5.1 バージョン解決(`resolveSpiritsVersion` / `formatVersionLine`)を `packages/spirits/src/version.ts` へ移し、`bin/version.ts` を再エクスポートに変更する。`bun test test/version.test.ts test/bun-gate.test.ts` と `bun run check` が通ることを確認する。

## 6. fork: TUI ヘッダ

- [x] 6.1 `packages/spirits/src/types/pi-coding-agent.d.ts` に `session_start`、`ctx.mode`、`ctx.ui.setHeader`、`Theme`(`fg` の範囲)、`Component`、`getSettings`、`keyHint` / `keyText` / `rawKeyHint` の宣言を追加し、`bun run check` が通ることを確認する。
- [x] 6.2 ヘッダコンポーネントを実装し、render 出力に `spirits` と `resolveSpiritsVersion()` の値が含まれ `Pi can explain` が含まれないことを新規 `bun test test/branding-header.test.ts` で確認する。
- [x] 6.3 `quietStartup` 有効時に `setHeader` を呼ばないことと、`setExpanded` が起動ヘルプの展開状態に同期することを `test/branding-header.test.ts` へのケース追加で確認する(実行: `bun test test/branding-header.test.ts`)。
- [x] 6.4 `packages/spirits/src/index.ts` にヘッダを配線し、tmux で対話モードを起動して spirits ヘッダが表示され `Pi can explain` が出ないことを確認する(`.pi/skills/interactive-testing.md` の手順)。
- [x] 6.5 起動時に pi 組み込みヘッダが拡張ヘッダ適用前に描画されないことを確認する(verify2 指摘 W-4 [要確認])。`interactive-mode.ts:1062-1078` で BuiltInHeader を描画した後、`ensureTool` 待機を挟んで `session_start` で差し替わるため、fd/rg 取得が遅い環境では pi ロゴと "Pi can explain" が一瞬表示され得る。fd/rg キャッシュを削除するか遅延状態を作って tmux で観察し(`.pi/skills/interactive-testing.md` の手順)、見える場合は組み込みヘッダ構築を拡張の `session_start` 後まで遅らせる等で修正する。
  - 確認(修正前): PATH から `fd` / `fdfind` / `rg` を除外し `HTTPS_PROXY=http://192.0.2.1:9` でダウンロードを遅延させた状態で、pi ロゴ(`▀▀█` / `█▀ █ v1.0.0`)と "Pi can explain its own features ..." が "fd not found. Downloading..." と同時に約 4 秒以上表示されることを tmux の `pipe-pane` ログで確認。
  - 修正: 非 pi ディストリビューションでは `interactive-mode.ts` の組み込みヘッダのマウントを `rebindCurrentSession()` (session_start) 後まで遅らせ、拡張が設定した custom header があればそれを、なければ組み込みヘッダをマウントする。`APP_NAME === "pi"` の経路は従来どおり即時マウントを維持。
  - 確認(修正後): 同じ遅延状態で pi ブランドの表示は 0 件、`fd not found. Downloading...` のみ。通常 PATH では `spirits v0.0.0-dev` とオンボーディング文が表示され、`APP_NAME=pi` の生 pi 実行では従来どおり即時に組み込みヘッダが表示されることを tmux で確認。

## 7. 統合確認

- [x] 7.1 `bun scripts/build-binaries.ts --version 0.0.0-test` でビルドし、コンパイル済み `spirits --version` とヘッダのバージョンが一致し、空のホームで `~/.spirits/agent/` が作られ、install レポートの送信が発生しないこと(settings.json でテレメトリを有効化したホームでも同様)を確認する。
- [x] 7.2 コンパイル済み `spirits --help`(バナー・usage に `spirits`、`Update pi` の不在)、`spirits update`(installer 再実行の案内)、`PI_CODING_AGENT_DIR=/tmp/old` 指定時の保存先(`~/.spirits/agent/`)が proposal/spec どおりであることと、リポジトリの `.pi/skills/` に置いた skill が spirits セッションで利用可能であることを確認する。
  - 結果は `verification.md` に記録。`spirits update` はネットワークなしで installer 案内を出し、`update --help` / `auth --help` に pi 表示はない。旧 env 名は無視され `~/.spirits/agent/` が使われ、project skill が読み込まれる。
- [x] 7.3 コンパイル済みシナリオ(既定の保存先、旧 env 名の無視、更新通知非表示、ヘッダのバージョン整合、update 案内、project skill 利用)の確認を自動化するか、少なくとも 7.1/7.2 の手動確認結果を本 change に記録する(verify2 指摘 W-3)。
  - `verification.md` に記録。既定の保存先・旧 env 名の無視・更新通知非表示・ヘッダのバージョン整合・update 案内・project skill 利用に加え、`pi.dev` への install レポート送信の有無をプロキシで確認(既定 0 / `PI_TELEMETRY=1` 1 / settings opt-in 0)。

## Workflow follow-up

- 実装完了後、`openspec validate --strict add-product-identity` を通してからアーカイブする。
- コアの `[spirits]` コミットを上流マージしやすい単位で保ったことを確認する。
- verify2 指摘(C-4): 現環境の `./test.sh` は失敗する(ai の models-entry 2 件と pricing 2 件、coding-agent の experimental 11 スイート + 2791 fswatch、durable 31 スイート)。いずれも未ビルドの dist エントリ解決失敗と上流モデルメタデータ乖離が原因と推定され、本 change の差分はこれらのパッケージに触れていない。archive 前にビルド済み環境で `./test.sh` を再実行し、既存失敗であることを確定する。
- verify2 指摘(S-1): binary-distribution spec の「`spirits update` は install.sh の再実行を案内」と design Decision 6 の「spirits 中立な文言」が矛盾している。spec を「そのディストリビューションの installer 再実行の案内」に緩和するか、spirits 側で install.sh 明示の案内層を足すかを、design.md の Open Questions に沿って 3.4 の修正時に判断する。
