# Tasks

取り込み対象: pi `v1.1.0` (`abe508e1b89912adde45528136c3221eb69acdd7`)。基点 `a276dabe5`。

## 1. 取り込み準備

- [x] 1.1 `git remote add upstream https://github.com/earendil-works/pi.git` と `git config remote.upstream.tagOpt --no-tags` を実行し、`git remote -v` の `upstream` が `earendil-works/pi` を指し、`git config --get remote.upstream.tagOpt` が `--no-tags` を返すことを確認
- [x] 1.2 `git fetch upstream tag v1.1.0` を実行し、次の 3 点を確認: `git rev-parse v1.1.0^{commit}` が `abe508e1b89912adde45528136c3221eb69acdd7` を返す。`git merge-base main v1.1.0` が `a276dabe5` で始まる。`git tag -l 'v*'` が `v1.1.0` だけを返す

## 2. merge と競合解決

- [x] 2.1 `git merge --no-ff --no-commit v1.1.0` を実行し、`git status` の衝突が `README.md` と `packages/coding-agent/test/config.test.ts` の 2 ファイルだけであることを確認
- [x] 2.2 `README.md` の衝突を spirits 版で解決する。`git checkout --ours -- README.md` と `git add README.md` を実行し、`git diff HEAD -- README.md` が空 (merge 前の spirits 版と同一) であることを確認
- [x] 2.3 `packages/coding-agent/test/config.test.ts` の衝突を、双方のテストブロックを残して解決し、`git diff --check` が空になることを確認 (テストの実行は 3.5)
- [x] 2.4 自動マージされたコアファイルの diff を目視する。対象は `config.ts`、`cli/args.ts`、`cli/auth-command.ts`、`main.ts`、`core/sdk.ts`、`core/agent-session-runtime.ts`、`core/slash-commands.ts`、`core/provider-attribution.ts`、`modes/interactive/interactive-mode.ts`、`modes/interactive/components/config-selector.ts`、`package-manager-cli.ts`、`extensions/mcp/cli.ts`。続けて次の fork 差分が残っていることを `grep` で確認: `resolveAppIdentity`、`formatBannerLine`、`formatUpdateCommandLine`、`handleClearContextCommand`、`clearConversation`、`slash-commands.ts` の `name: "clear"`、`sdk.ts` と `main.ts` の `hasExistingSessionData`、`getSessionHeaders` の `isInstallTelemetryEnabled` 条件、`formatAuthCommandHelp`、bun-binary ガード (`detectInstallMethod() === "bun-binary"`)、`config-selector.ts` の `getSettingsPath()`、`extensions/mcp/cli.ts` の `getAgentDir()`
- [x] 2.5 型スタブと上流 Extension API の差分を照合する。`grep -hoE '^export (declare )?(interface|type|function|const|class) [A-Za-z0-9_]+' packages/spirits/src/types/*.d.ts` でスタブが宣言する export 名を列挙する。`git diff a276dabe5 v1.1.0 -- packages/coding-agent/src packages/tui/src` で、それらの定義とメンバに削除・改名・型の変更が無いことを確認する。上流で追加されただけのメンバはスタブに足さない。食い違いがあれば、スタブを直す `fix:` コミットを 6 章の後に追加する (design Decision 10)

## 3. lockfile、モデルデータ、merge の確定

- [x] 3.1 root で `npm install --ignore-scripts` を実行し、`packages/env` が workspace に入り、`node_modules/@earendil-works/pi-*` の symlink が維持されることを確認
- [x] 3.2 `npm install --package-lock-only --ignore-scripts` で `package-lock.json` を再生成し、`node scripts/generate-coding-agent-install-lock.mjs --check` が成功することを確認
- [x] 3.3 root で `bun install --ignore-scripts` を実行して `bun.lock` を更新し、続けて `bun install --frozen-lockfile --ignore-scripts` が成功することを確認
- [x] 3.4 `bun packages/ai/scripts/generate-models.ts --strict --data-only` でモデルデータを hydrate し、次の 2 点を確認: コマンドが終了コード 0 で終わり `packages/ai/src/providers/data/.manifest.json` が生成される。`git diff v1.1.0 -- packages/ai/src/models.generated.ts` が空 (上流版を採用している)
- [x] 3.5 `packages/coding-agent` で `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/config.test.ts` が成功することを確認
- [x] 3.6 merge を確定する。まず次の 3 点を確認: `git diff --cached --stat` のステージ内容が上流の変更、競合の解決、lockfile だけである。`scripts/build-binaries.ts` と `.github/workflows/spirits-ci.yml` に spirits 側の変更が無い。`git diff --cached -- package-lock.json` で追加・更新されたパッケージに `hasInstallScript` を持つものが無い (あれば利用者に報告して止める)。そのうえで `PI_ALLOW_LOCKFILE_CHANGE=1 git commit --no-edit` を実行し、pre-commit が成功し、`git log -1 --format=%P` が 2 つの親 (取り込み前の main と `v1.1.0`) を返すことを確認

## 4. バイナリの .env 無効化 (BREAKING)

- [x] 4.1 `scripts/build-binaries.ts` の `compile` に `autoloadDotenv: false` を追加し、`bun scripts/build-binaries.ts --version 0.3.0-dev` が `dist/spirits-linux-x64` と `.sha256` を生成することを確認
- [x] 4.2 spec の .env シナリオを再現する。起動時に `process.env` を JSON でファイルへ書き出し、続けて `process.exit(0)` で終了する拡張を作る。実行ごとに cwd 用と agent dir 用の空の一時ディレクトリを別々に作り、agent dir 用を `SPIRITS_CODING_AGENT_DIR` に指定して (利用者の `~/.spirits/agent` を読ませない)、cwd 用を cwd にして `dist/spirits-linux-x64 -e <拡張> -p probe` で起動する。各実行で記録ファイルが作られたこと (拡張が動いたこと) を確かめたうえで、次の 3 点を確認:
  - (a) cwd の `.env` に `SPIRITS_DOTENV_PROBE=1` を置いて起動すると、記録に `SPIRITS_DOTENV_PROBE` が無い
  - (b) `NODE_ENV=production` を設定し、cwd の `.env.local` に `SPIRITS_DOTENV_LOCAL_PROBE=1`、`.env.production` に `SPIRITS_DOTENV_MODE_PROBE=1` を置いて起動すると、記録にどちらも無い
  - (c) シェルで `SPIRITS_DOTENV_PROBE=1` を設定した対照実行では、記録に `SPIRITS_DOTENV_PROBE=1` がある
- [x] 4.3 README 5 件に、**BREAKING** として次の 2 点を各言語で追記する: バイナリが起動ディレクトリの `.env` 系ファイルを読まないこと。移行方法 (シェルで `export` するか、起動コマンドの前に環境変数を指定する)。追記先は、`README.md` の Known limitations、`README.ja.md` の「既知の制約」、`README.zh.md` の「已知限制」、`README.de-CH.md` の「Bekannte Einschränkungen」、`packages/spirits/README.md` の「単一バイナリの制約」。`grep -n 'BREAKING.*\.env' README.md README.ja.md README.zh.md README.de-CH.md packages/spirits/README.md` が 5 ファイルのそれぞれから 1 行以上を返すことを確認
- [x] 4.4 `git add scripts/build-binaries.ts README.md README.ja.md README.zh.md README.de-CH.md packages/spirits/README.md` の後、`git commit -m "fix: disable .env autoload in spirits binaries"` を実行する。次の 2 点を確認: `git show --stat HEAD` がこの 6 ファイルだけを含む。`git show HEAD~1:scripts/build-binaries.ts` に `autoloadDotenv` が無い (merge コミットに含まれていない)

## 5. CI トリガ

- [x] 5.1 `.github/workflows/spirits-ci.yml` の `push` と `pull_request` の `paths` に、`packages/**`、`package.json`、`tsconfig.json`、`tsconfig.base.json` を追加する。`git diff` で両方に 4 項目が入っていることを確認する。あわせて、GitHub の filter pattern の規則 (`**` は `/` を含む 0 文字以上に一致) に照らして、次の 2 点を確認: `packages/**` は `packages/coding-agent/src/main.ts` に一致する。`tsconfig.base.json` は root の同名ファイルに一致する
- [x] 5.2 `git add .github/workflows/spirits-ci.yml` の後、`git commit -m "fix: run spirits CI on core and root config changes"` を実行し、`git show --stat HEAD` がこのファイルだけを含むことを確認

## 6. 上流追従手順の文書化

- [x] 6.1 `docs/spirits-upstream-sync.md` を作成し、次の項目を記載する。
  - `upstream` リモートの登録と `tagOpt --no-tags` の設定
  - 取り込み対象のタグまたは commit を change の tasks に記録すること
  - 取り込み対象のタグだけを fetch する方法
  - `git push --tags` と `git push --follow-tags` を使わず、`push.followTags` を有効にしない理由 (`build-binaries.yml` が `v*` タグで起動する)
  - `--no-commit` での merge
  - 型スタブと上流 Extension API の差分照合 (2.5 の手順)
  - コミット構成 (design Decision 10。検証で追加する `[spirits]` / `fix:` / `docs:` コミットの規則と、上流修正のバックポートの扱いを含む)
  - 検証コマンドとその順序 (design Decision 9。`npm run build:offline` による各パッケージの build と、`npm run build` を使わない理由、build の実行に利用者の承認が要ること、Rust toolchain と pi-env daemon の build の前提を含む)
  - fork で使わない上流 workflow (Environments) の無効化と、初回の実行を push 直後に cancel する手順 (design Decision 12)

  `docs/spirits-design.md` §5 の 3 項目目 (上流追従) に、この文書への参照を追加する。各項目と §5 の参照があることを `grep` で確認 (`docs:` コミット `6a101734e` の作成後に、検証順序の build と、`docs:` / バックポートのコミット規則が不足していると判明したため未完了に戻した。修正は 6.3 でコミットする)
- [x] 6.2 `git add docs/spirits-upstream-sync.md docs/spirits-design.md` の後、`git commit -m "docs: add upstream sync procedure"` を実行し、`git show --stat HEAD` がこの 2 ファイルだけを含むことを確認
- [x] 6.3 6.1 の修正を `git add docs/spirits-upstream-sync.md` の後、`git commit -m "docs: add offline build step to upstream sync procedure"` でコミットし、`git show --stat HEAD` が `docs/spirits-upstream-sync.md` だけを含むことを確認

## 7. 検証で判明した修正

- [x] 7.1 npm 12 の `npm pack --json` の出力形式の変更に対応する。上流 main の `6fb2e7815` (fixes #10633) をバックポートし、`fix: support npm 12 pack JSON output` (`154106b18`) でコミットする。`git show --stat 154106b18` が `scripts/package-artifacts.mjs` と `scripts/package-artifacts.test.mjs` だけを含む (Pi コア外のため `fix:`) ことを確認。テストは 8.4 の `./test.sh` (`test:scripts`) で確認する
- [x] 7.2 上流 main の `ce950d78f` をバックポートする。`git cherry-pick --no-commit ce950d78f` を実行し、`git diff --cached --stat` が `packages/ai/scripts/generate-models.ts` と `packages/ai/test/supports-xhigh.test.ts` だけを含むことを確認する。追跡ファイル (`packages/ai/src/providers/*.models.ts`、`models.generated.ts`) は再生成せず、上流のコミットと同じ内容にする。`git commit -m "[spirits] fix(ai): use models.dev metadata for Claude 5.5 models" -m "(cherry picked from commit ce950d78f424dcaf9f5d6a03ce80ab141130eb1d)"` でコミットし、`packages/ai` で `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/supports-xhigh.test.ts` が成功することを確認
- [x] 7.3 verify2 W-1 への対応。`.env` 禁止の 3 シナリオを自動で再検証する `scripts/test-dotenv-smoke.sh` を追加する。引数でビルド済みバイナリのパスを受け取り、probe 拡張 (`session_start` で `process.env` を JSON へ書き出して `process.exit(0)`) を一時ファイルへ生成し、実行ごとに cwd 用と agent dir 用の空の一時ディレクトリを作って `SPIRITS_CODING_AGENT_DIR` と cwd を分離して起動する。次の 3 ケースを検証し、いずれかが失敗したら非ゼロで終了する: (a) cwd の `.env` の値を記録に含まない (b) `NODE_ENV=production` で cwd の `.env.local` と `.env.production` の値を含まない (c) シェルの環境変数は記録に含む。`docs/spirits-upstream-sync.md` の検証手順 10 にこのスクリプトの実行を追加する。`bash scripts/test-dotenv-smoke.sh dist/spirits-linux-x64` が 3 ケースの PASS を表示して終了コード 0 で終わることを確認し、`git add scripts/test-dotenv-smoke.sh docs/spirits-upstream-sync.md` の後 `git commit -m "fix: add .env autoload regression smoke test"` を実行する。`git show --stat HEAD` がこの 2 ファイルだけを含むことを確認する
- [x] 7.4 verify2 G-1 への対応。`README.md` の Known limitations にある `.env` 移行の例示 (`export SPIRITS_...`) に provider 固有の環境変数 (例: `ANTHROPIC_API_KEY`) の例を追加する。`rg -n 'ANTHROPIC_API_KEY' README.md` が移行例の行を返すことを確認し、`git add README.md` の後 `git commit -m "fix: clarify .env migration example in README"` を実行する。`git show --stat HEAD` が `README.md` だけを含むことを確認する

## 8. 統合検証と push

verify2 の W-1 / G-1 への対応 (7.3 / 7.4) で新しいコミットを追加するため、8.1〜8.13 を未完了に戻した。7.3 / 7.4 のコミット後に 8.1 から再実行する。

8.1〜8.9 のいずれかで修正が必要になった場合は、design Decision 10 の規則で修正コミットを追加し、8.1 から再実行する。

- [x] 8.1 root で `npm run build:offline` を実行する (AGENTS.md により実行には利用者の承認が必要。v1.1.0 の取り込みでは 2026-10-12 に承認済み)。終了コード 0 で終わり、`git status --short --untracked-files=no` が空 (live の再生成で追跡ファイルが書き換わっていない) であることを確認。`check:model-data` が失敗した場合は、`npm run build` に切り替えず止めて利用者に報告する
- [x] 8.2 root で `npm run check` を実行し、エラー・警告なしで完了することを確認
- [x] 8.3 pi-env daemon をビルドする。rustup が無ければ導入し、`rustup toolchain install 1.96.0` を実行する (`packages/env/daemon/rust-toolchain.toml` の指定)。root で `npm run build:daemon --workspace packages/env` を実行し、`packages/env/daemon/target/debug/pi-env` が存在し、`git status --short packages/env` が空 (ビルド成果物が追跡対象外) であることを確認
- [x] 8.4 root で `./test.sh` を実行し、非 e2e テストがすべて成功することを確認
- [x] 8.5 `packages/spirits` で `bun install --frozen-lockfile` → `bun test` → `bun run check` が成功することを確認
- [x] 8.6 `env -u SPIRITS_VERSION bun scripts/build-binaries.ts` を `--version` なしで実行する。`dist/spirits-linux-x64 --version` が終了コード 0 で終わり、先頭行のバージョンが次の値と一致することを確認: `git describe --tags --match 'spirits-v*'` の出力から、`spirits-v` と末尾の `-<n>-g<sha>` を除いた値 (現時点で `0.2.0`)
- [x] 8.7 旧版と新版のバイナリで self-update smoke を通す。次の手順を順に実行し、最後のコマンドが成功することを確認:
  1. `bun scripts/build-binaries.ts --version 0.2.0`
  2. `mv dist/spirits-linux-x64 /tmp/spirits-old`
  3. `rm -f dist/spirits-linux-x64.sha256`
  4. `bun scripts/build-binaries.ts --version 0.3.0`
  5. `sh scripts/self-update-smoke.sh /tmp/spirits-old dist/spirits-linux-x64 0.3.0`
- [x] 8.8 8.7 で作った `dist/spirits-linux-x64` で、binary-distribution の既存シナリオを再実行する。(b)〜(d) では実行ごとに空の一時ディレクトリを `HOME` に指定し、`env -u SPIRITS_CODING_AGENT_DIR` で起動する。起動は interactive-testing skill の tmux 手順で行い、起動画面を確認してから終了する。次の 4 点を確認:
  - (a) `dist/spirits-linux-x64 --help` が終了コード 0 で終わり、出力に `Update pi` を含まない
  - (b) `PI_CODING_AGENT_DIR` も unset で起動すると、`$HOME/.spirits/agent/` 配下に設定ファイル (`settings.json` など) が作られ、`$HOME/.pi` は作られない
  - (c) `PI_CODING_AGENT_DIR=<別の一時ディレクトリ>/old-agent` を設定して起動すると、`$HOME/.spirits/agent/` 配下に設定ファイルが作られ、`<別の一時ディレクトリ>/old-agent` は作られない
  - (d) ツールを登録し、読み込み時に sentinel ファイルを書く拡張を `$HOME/.spirits/agent/extensions/` に置いて起動すると、sentinel ファイルが作られ、起動画面に拡張のロード失敗が表示されない
- [x] 8.9 interactive-testing skill に従って tmux でビルド済みバイナリを起動し、ヘッダ表示・`/clear`・`tsrepl` の呼び出しが動作することを確認
- [x] 8.10 `git log --first-parent --format=%s origin/main..HEAD` を確認する。次の 9 件を含み、それ以外のコミットが無いこと:
  - merge コミット (`Merge tag 'v1.1.0'`)
  - `fix: disable .env autoload in spirits binaries`
  - `fix: run spirits CI on core and root config changes`
  - `docs: add upstream sync procedure`
  - `fix: support npm 12 pack JSON output`
  - `docs: add offline build step to upstream sync procedure`
  - `[spirits] fix(ai): use models.dev metadata for Claude 5.5 models`
  - `fix: add .env autoload regression smoke test`
  - `fix: clarify .env migration example in README`

  追加のコミットについて `git show --stat` で次を確認: `[spirits]` コミットは Pi コア (`packages/spirits/` を除く `packages/` 配下) だけを変更している。`fix:` コミットは Pi コアを変更していない。`docs:` コミットは `docs/` だけを変更している
- [x] 8.11 `git config --get push.followTags` が `true` を返さないことを確認してから、`git push origin main` (`--tags` / `--follow-tags` なし) を実行する。`git ls-remote --tags origin refs/tags/v1.1.0` が空であることを確認
- [x] 8.12 Environments (`env.yml`) は初回の push で無効化済み (`disabled_manually`)。再 push で Environments の新しい実行が起動しないことを `gh run list -R betiz0/spirits` で確認し、`gh workflow list --all -R betiz0/spirits` が Environments の状態として `disabled_manually` を返すことを再確認する (初回は run 38212689674 が cancel の前に completed / success で終わったため cancel は不要だった)
- [x] 8.13 Spirits CI と上流 CI (`ci.yml`) が成功することを確認

## Workflow follow-up

- 検証成功後にこの change をアーカイブする。
- v0.3.0 のタグ付け、リリース workflow の実行、`spirits update` の実リリース確認は別のリリース作業として行う。
