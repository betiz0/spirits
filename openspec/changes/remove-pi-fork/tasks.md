# Tasks

## 1. 実装開始の前提 (人間が行う作業)

- [x] 1.1 fork 最終コミット (`origin/main` = `4243f3d87`、`spirits-v0.7.2` と同じ commit) に annotated タグ `spirits-fork-final` を打つ。ローカルの `main` は遅れているので commit を明示して打つ。エージェントは実行しない。完了確認: `git rev-parse spirits-fork-final^{commit}` が `4243f3d87ce2f10106e0abdf0400114e5b312f63` を返し、`git tag -l 'spirits-fork-final'` が 1 件だけ返る。
  - 実施は人間。確認の実測:
    - `git rev-parse spirits-fork-final^{commit}` -> `4243f3d87ce2f10106e0abdf0400114e5b312f63`
    - `git ls-remote origin refs/tags/spirits-fork-final^{}` -> `4243f3d87ce2f10106e0abdf0400114e5b312f63 refs/tags/spirits-fork-final^{}` (区切りはタブ)

## 2. ホスト記述子と固定値

- [x] 2.1 `packages/spirits/src/managed-pi/host.ts` に `HostDescriptor` (id、packageName、executablePath、packageDirName、extensionArgs、identity、env 名、manifest host 種別) を追加し、テスト `test/managed-pi-host.test.ts` を新設する。完了確認: `bun test test/managed-pi-host.test.ts` が成功し、公式 Pi の記述子が `pi` / `pi/pi` / `-e` / `piConfig.name` を返す。
- [x] 2.2 `packages/spirits/src/constants.ts` に `PINNED_PI` (版、artifact 名、sha256、overlay 版) を追加し、`MANAGED_PI_FIRST_*` をそこから導出する。完了確認: `bun test test/managed-pi-manifest.test.ts` が成功し、固定値が manifest の `pi.version` / `pi.artifact.sha256` に反映される。
- [x] 2.3 `spawnManagedSet` / `install.ts` / `verify.ts` / `layout.ts` / `overlay.ts` / `environment.ts` を記述子経由にし、固定パスとホスト名を直書きしない。完了確認: `bun test test/managed-pi-launch.test.ts test/managed-pi-install.test.ts test/managed-pi-layout.test.ts test/managed-pi-integration.test.ts test/managed-pi-repair.test.ts test/managed-pi-overlay.test.ts test/managed-pi-env.test.ts` が成功する。

## 3. 起動役を薄くする

- [x] 3.1 `packages/spirits/bin/spirits.ts` から `@earendil-works/pi-coding-agent` の import を外し、検証済み managed ホストを spawn するだけにする。参照が無くなる `src/types/pi-subpaths.d.ts` を削除する。完了確認: `rg -n "@earendil-works" packages/spirits/bin` が 0 件、`test -e packages/spirits/src/types/pi-subpaths.d.ts` が失敗し、`bun test test/managed-pi-bootstrap.test.ts` が成功する。
- [x] 3.2 `packages/spirits/bin/bootstrap.ts` の fork 分岐を外し、未コンパイルも managed を起動する。一式が未導入のとき、コンパイル済みは同じリリースから取得して起動し、未コンパイルは導入方法を表示して非ゼロで終了する (design D12)。完了確認: `bun test test/managed-pi-default-route.test.ts test/managed-pi-bootstrap.test.ts` が成功し、「未導入時の自動取得 (コンパイル済み)」と「未コンパイルでの未導入」のケースを含む。`rg -n "ENV_ROUTE|ROUTE_FORK_VALUE" packages/spirits/bin packages/spirits/src` のヒットが `constants.ts` の定義と、3.5 の拒否判定の 1 か所だけになる。
- [x] 3.3 `packages/spirits/bin/startup.ts` の fork の戻し先の文言を外し、旧版への戻し方に置き換える。完了確認: `rg -n "SPIRITS_ROUTE=fork spirits" packages/spirits/bin packages/spirits/src` が 0 件、`bun test test/managed-pi-default-route.test.ts` が成功する。
- [x] 3.4 `--help` / `-h` を起動役が処理し、spirits 自身の help を出す。`--` より後は `--` を除いてホストへ渡す。完了確認: `bun test test/managed-pi-bootstrap.test.ts` の「起動役の help」と「`--` 以降の透過」のケースが成功する (コンパイル済みバイナリでの確認は 14.3)。
- [x] 3.5 `SPIRITS_ROUTE=fork` が設定されたままホストを起動しようとした場合、廃止の理由、`unset SPIRITS_ROUTE`、旧版への戻し方を表示して非ゼロで終了する。`update`、`managed-pi`、`--version` / `-v`、`--help` / `-h` は通常どおり処理する (design D7)。完了確認: `bun test test/managed-pi-default-route.test.ts` の「SPIRITS_ROUTE=fork」と「SPIRITS_ROUTE=fork でもサブコマンドは動く」のケースが成功する。

## 4. 失敗表示とインストーラ

- [ ] 4.1 `managedRepairHint` を修復コマンド `spirits managed-pi repair` と旧版への戻し方 (タグからの再ビルド、`~/.spirits/bin` の退避) に置き換える。完了確認: `bun test test/managed-pi-release-assets.test.ts test/managed-pi-default-route.test.ts test/managed-pi-launch.test.ts` が成功し、`rg -n "SPIRITS_ROUTE=fork spirits" packages/spirits scripts` が 0 件。
- [ ] 4.2 `scripts/install.sh` から fork の案内とテーマ資産の取得・検証・配置・修復を外し、managed 一式の導入と失敗時の修復・旧版の戻し方を出す。`--uninstall` の案内に `~/.spirits/managed-pi` を含める。完了確認: `sh scripts/install.test.sh` が成功し、「テーマ資産を取得しない」「旧版のテーマ資産の残置」「managed 導入失敗時の非ゼロ」のケースを含む。`rg -n "SPIRITS_ROUTE|theme|dark\.json" scripts/install.sh` が 0 件。
- [ ] 4.3 `scripts/self-update-smoke.sh` を新しい自己更新 (実行ファイルのみ) と managed 一式の導入に合わせる。完了確認: `sh scripts/self-update-smoke.sh <old> <new> <version>` が成功する。

## 5. 自己更新

- [ ] 5.1 `src/update/classify.ts` を、Pi の `update` 文法による分類から、自己更新形 (`update`、`self`、`pi`、`--self` と `--force`、`-a` / `--approve`、`-na` / `--no-approve`) かどうかの判定に置き換える。自己更新形以外は `spirits managed-pi update` と `spirits -- update <引数>` を案内して非ゼロで終了する (design D11)。完了確認: `bun test test/update-classify.test.ts test/update-routing.test.ts` が成功し、`--extensions`、`--all`、`--unknown`、`-h` が案内と非ゼロになり、`-a` が自己更新になるケースを含む。
- [ ] 5.2 `src/update/run.ts` からテーマ資産の取得・修復と `runExtensionUpdate` を外し、`src/update/theme.ts` と `test/update-theme.test.ts` を削除する (design D8)。完了確認: `bun test test/update-run.test.ts test/update-download.test.ts test/update-apply.test.ts` が成功し、「テーマ資産を取得しない」ケースで fetch に `dark.json` / `light.json` の要求が無い。`rg -n "theme|runExtensionUpdate" packages/spirits/src/update` が 0 件。

## 6. 拡張の fork 経路を削除する

- [ ] 6.1 `src/routing/register.ts` の `registerModelRoles` 分岐、`ROUTING_STATE_ENTRY_TYPE` の書き込み、`onStepChange` の fork 分岐、`session_tree` の条件登録を外す。完了確認: `bun test test/routing-register.test.ts test/routing-managed-compat.test.ts test/routing-phase-wiring.test.ts` が成功する。
- [ ] 6.2 `src/index.ts` の `routing.roleApi` の条件を外し、`registerManagedCommands` を常に登録する。完了確認: `bun test test/extension-degradation.test.ts test/managed-commands.test.ts` が成功する。
- [ ] 6.3 `src/commands/role.ts` の `forkRoleRecord` を読み取り専用の旧データ互換として残し、ホストの状態 entry に書き戻さない。完了確認: `bun test test/managed-role-command.test.ts test/managed-role-status.test.ts` が成功する。
- [ ] 6.4 `src/constants.ts` の `MANAGED_PI_FORK_ROUTE_HINT` を削除する。`ENV_ROUTE` / `ROUTE_FORK_VALUE` は 3.5 の拒否判定のために残す。`src/managed-pi/environment.ts` の fork 期の env 除去は残す。完了確認: `bun test test/managed-pi-env.test.ts` が成功し、`rg -n "MANAGED_PI_FORK_ROUTE_HINT" packages/spirits` が 0 件。
- [ ] 6.5 `src/commands/settings-store.ts` の fork の文言を「別の spirits プロセス」に更新する。完了確認: `rg -n -i "fork" packages/spirits/src/commands packages/spirits/src/routing packages/spirits/src/index.ts` のヒットが `forkRoleRecord` とその旧データ互換を説明するコメント (「旧 fork」を含む行) だけになる。

## 7. 型ミラーの照合

- [ ] 7.1 `scripts/check-pi-type-mirror.ts` を追加し、固定したホスト artifact の `.d.ts` と `src/types/*.d.ts` の export / member を照合する。テスト `test/pi-type-mirror.test.ts` を新設し、改名・型変更・追加のみの fixture を置く。完了確認: 公式 Pi 1.5.0 の展開先を渡して成功し、`bun test test/pi-type-mirror.test.ts` で改名と型変更の fixture が失敗、追加のみの fixture が成功と判定される。
- [ ] 7.2 型ミラーの doc comment を「固定 artifact と照合する」に更新する。完了確認: `bun test test/pi-runtime/virtual-model-api.test.ts` が成功し、`src/types/pi-coding-agent.d.ts` の先頭コメントが更新されている。

## 8. pin テストの再編

- [ ] 8.1 `test/pi-runtime/model-roles-api.test.ts` と `routing-record-pin.test.ts` を削除する。完了確認: `ls test/pi-runtime` に 2 件が無い。
- [ ] 8.2 `branding-art-colors.test.ts` / `child-model-source-pin.test.ts` / `system-prompt-defaults.test.ts` の確認内容を、互換性ランナーの公式モードの観測項目として実装し、`test/pi-runtime/` から削除する (design D4)。完了確認: `bun test test/managed-pi-compat-runner.test.ts` が成功し、3 件に対応する観測項目が公式モードのマトリクスに載っている。`ls test/pi-runtime` に 3 件が無く、`rg -n "packages/coding-agent" packages/spirits/test/pi-runtime` が 0 件。
- [ ] 8.3 `packages/spirits` で `bun add --dev --exact @earendil-works/pi-coding-agent@1.5.0 @earendil-works/pi-tui@1.5.0` を実行し、lockfile を更新する。完了確認: `packages/spirits/package.json` の devDependencies に 2 件が完全一致の版で載り、`bun install --frozen-lockfile` が成功する。実パッケージへの解決の確認は 14.2 で行う (root の `paths` が残る間は Pi のソースへ解決されるため)。

## 9. アーキテクチャ検査

- [ ] 9.1 `test/architecture/resolve.ts` の `@earendil-works/*` の解決を root `paths` から固定ホスト公開パッケージの解決へ変更する。完了確認: `bun test test/architecture-conventions.test.ts test/architecture-conventions.fixtures.test.ts` が成功する。
- [ ] 9.2 `test/fixtures/architecture/resolve` の期待値を固定ホスト公開パッケージの解決結果へ更新する。完了確認: 同じテストが成功する。
- [ ] 9.3 `docs/architecture/convention-registry.md` の層と境界をホスト公開パッケージに更新し、`registry:bin-deep-imports` と `test/architecture/registry.ts` の対応する読み取りを削除する。完了確認: `bun test test/architecture-conventions.test.ts` が成功し、`rg -n "packages/coding-agent|packages/tui|bin-deep-imports" docs/architecture/convention-registry.md packages/spirits/test/architecture` が 0 件。

## 10. 互換性ランナー

- [ ] 10.1 `scripts/managed-pi-compat` から fork ホスト (`packages/coding-agent/src/cli.ts` を起動する経路) を外し、ホスト記述子を渡せるようにする。完了確認: `bun test test/managed-pi-compat-runner.test.ts test/managed-pi-compat-guard.test.ts` が成功する。
- [ ] 10.2 `--mode official` を既定にし、固定 artifact の展開と bundle の照合を必須観測にする。完了確認: `bun scripts/managed-pi-compat/run.ts --mode official --artifact-root <展開先> --bundle dist/spirits-managed-pi-extension.js --out /tmp/compat` が `Compatibility met` を出す。
- [ ] 10.3 `scripts/agent-data-compat/` を削除する (fork バイナリが必要で実行できない)。完了確認: `git ls-files scripts/agent-data-compat` が 0 件。

## 11. ビルドとリリース

- [ ] 11.1 `packages/coding-agent/src/modes/interactive/theme/{dark,light}.json` を `scripts/compat-theme/` にコピーする (12.1 の削除より前)。`scripts/build-binaries.ts` を起動役と互換用テーマ資産だけのビルドにし、config / worker / Pi の `tsconfig` paths / `replace-pi-version` の参照を外し、テーマの出力元を `scripts/compat-theme/` にする (design D8)。完了確認: `bun scripts/build-binaries.ts --version 0.0.0-0` が成功し、`rg -a -c "createAgentSession|InteractiveMode" dist/spirits-linux-x64` が 0 件、`cmp scripts/compat-theme/dark.json dist/theme/dark.json` が成功し、`(cd dist/theme && sha256sum -c dark.json.sha256 && sha256sum -c light.json.sha256)` が成功する。
- [ ] 11.2 `scripts/build-managed-pi-inputs.ts` の `TSCONFIG` と host externals を新しい構成に合わせる。完了確認: `bun scripts/build-managed-pi-inputs.ts --version 0.0.0 --out /tmp/managed` が成功し、manifest の `pi.version` が `PINNED_PI` と一致する。
- [ ] 11.3 `scripts/replace-pi-version.ts` と、spirits が使わない `scripts/*` を削除する。完了確認: `git ls-files scripts` が design の `scripts/` の「残す」と「追加」の一覧だけになる。
- [ ] 11.4 `.github/workflows/spirits-ci.yml` と `spirits-release.yml` を書き換え、hydrate のステップを外し、paths を `packages/spirits` / `scripts` / root 構成にする。互換用テーマ資産の検証と添付、自己更新 smoke 用の旧版バイナリのビルドは残す。完了確認: `rg -n "Hydrate model data|packages/ai|generate-models" .github/workflows` が 0 件、`rg -n "dist/theme/dark.json" .github/workflows/spirits-release.yml` が 1 件以上、`rg -n "0.0.0-0" .github/workflows/spirits-release.yml` が 1 件以上。
- [ ] 11.5 他の 13 workflow と `.github/APPROVED_CONTRIBUTORS` / `.github/ISSUE_TEMPLATE/` を削除する。完了確認: `ls .github/workflows` が `spirits-ci.yml` と `spirits-release.yml` の 2 件、`ls .github` が `workflows` だけ。

## 12. Pi のソースツリー削除と root 構成

- [ ] 12.1 `packages/` の spirits 以外の 14 パッケージ (1829 ファイル) を削除する。完了確認: `ls packages` が `spirits` だけ。
- [ ] 12.2 root `package.json` を `private: true` / `workspaces: ["packages/spirits"]` にし、`check` / `test` を `packages/spirits` へ委譲する。完了確認: `bun install --frozen-lockfile` が成功する。
- [ ] 12.3 `package-lock.json` と `packages/spirits/bun.lock` を削除し、root `bun.lock` を再生成する。完了確認: `git ls-files '*bun.lock' '*package-lock.json'` が `bun.lock` 1 件だけ。
- [ ] 12.4 root `tsconfig.json` / `tsconfig.base.json` / `biome.json` / `.husky/pre-commit` を spirits 単独の構成に書き換える。完了確認: `bun run check` が成功し、`rg -n "packages/(coding-agent|ai|tui|agent)" tsconfig.json tsconfig.base.json biome.json .husky/pre-commit` が 0 件。
- [ ] 12.5 `flake.nix` / `flake.lock` / `nix/` / `pi-test.*` / `test.sh` / `vitest.base.ts` を削除する。完了確認: `ls flake.nix flake.lock nix pi-test.sh pi-test.bat pi-test.ps1 test.sh vitest.base.ts` がすべて存在しないと報告する。
- [ ] 12.6 `.gitignore` / `.gitattributes` / `.npmrc` を更新する。完了確認: `rg -n "packages/(coding-agent|ai|tui|agent|durable|chord|env|mcp|evals|server|client|codemode|protocol|telemetry)" .gitignore .gitattributes` が 0 件。

## 13. ドキュメントと openspec/config

- [ ] 13.1 `README.md` / `README.ja.md` / `README.zh.md` / `README.de-CH.md` を「Pi のフォーク」から「公式 Pi の固定 artifact をホストにする」に書き換える。`spirits update` の引数の変更と、旧版の利用者は `spirits update --all` ではなく `spirits update` を使う注意を載せる。完了確認: `rg -n "fork of \[Pi\]|をフォークし|分支（fork）|ein Fork von" README*.md` が 0 件、`rg -n "spirits -- update" README.md` が 1 件以上。
- [ ] 13.2 `AGENTS.md` / `CONTRIBUTING.md` / `SECURITY.md` / `LICENSE` を書き換える。完了確認: `rg -n "pi-monorepo|npm run check|test.sh" AGENTS.md CONTRIBUTING.md` が 0 件、`LICENSE` に spirits の著作権行と「Type mirrors and portions derived from Pi」がある。
- [ ] 13.3 `docs/spirits-design.md` §1 / §2 / §3 / §5 / §9 / §10 と `docs/spirits-default-launch.md` / `docs/spirits-managed-pi.md` を書き換える。完了確認: `rg -n "フォーク|upstream merge|SPIRITS_ROUTE=fork" docs/spirits-design.md docs/spirits-default-launch.md docs/spirits-managed-pi.md` のヒットが、旧版への戻し方と廃止の経緯を述べる行だけで、各ヒットをレビューで確認する。
- [ ] 13.4 `docs/spirits-host-upgrade.md` を追加し、`docs/spirits-upstream-sync.md` と `docs/spirits-core-diffs.md` を削除する。手順書は design「Pi の版更新手順」の順序、失敗時の中止、Rollback を含める。完了確認: `test -f docs/spirits-host-upgrade.md` が成功し、2 ファイルが無い。`rg -n "check-pi-type-mirror|build-managed-pi-inputs|managed-pi-compat/run.ts|tmux-verify|spirits-fork-final|SPIRITS_ROUTE=fork|generate-models" docs/spirits-host-upgrade.md` で 7 語すべてがヒットし、`check-pi-type-mirror` の行が `build-managed-pi-inputs` の行より前にある。
- [ ] 13.5 `docs/spirits-managed-pi-design.md` と `docs/agent-data-compat/README.md` に歴史的資料の注記を追記し、`docs/spikes/` を削除する。完了確認: `rg -l "歴史的資料" docs/spirits-managed-pi-design.md docs/agent-data-compat/README.md` が 2 件、`test -e docs/spikes` が失敗する。
- [ ] 13.6 `openspec/config.yaml` の context と rules をホスト artifact 前提に書き換える。完了確認: `rg -n "フォーク|\[spirits\]|Piコア|Pi上流コア" openspec/config.yaml` が 0 件、`openspec validate remove-pi-fork --strict` が成功する。
- [ ] 13.7 `.pi/extensions` / `.pi/git` / `.pi/npm` を削除する。完了確認: `ls .pi` が `prompts` と `skills` だけ。

## 14. 統合検証

- [ ] 14.1 root で `bun run check` を実行し、エラー・警告・info が 0 件であることを確認する。完了確認: コマンドの終了コード 0。
- [ ] 14.2 `packages/spirits` で `bun test` を実行し、全テストが成功することを確認する。ホストが実パッケージへ解決されることも確認する。完了確認: `bun test` の終了コード 0、`pi-runtime` の 0 件マッチが無い。`packages/spirits` で `bun -e 'console.log(import.meta.resolve("@earendil-works/pi-coding-agent"))'` が `node_modules` 配下のパスを返す。
- [ ] 14.3 `bun scripts/build-binaries.ts` で起動役をビルドし、バイナリの挙動を確認する。完了確認: `dist/spirits-linux-x64 --version` が `spirits <version> (Bun <bun>)` を返して終了コード 0。`dist/spirits-linux-x64 --help` が spirits の help を出して終了コード 0。`dist/spirits-linux-x64 -- --help` がホストの help を出す。
- [ ] 14.4 `sh scripts/self-update-smoke.sh <old> <new> <version>` で、旧版から新版への自己更新と managed 一式の導入を確認する。完了確認: スクリプトの終了コード 0。
- [ ] 14.5 一つ前のリリース (spirits-v0.7.2) の実行ファイルから `spirits update` を実行し、新しい版と managed 一式が導入されることを確認する。リリース前は、新しい成果物 (互換用テーマ資産を含む) を置いた検証用配信元を `SPIRITS_API_BASE_URL` と `SPIRITS_RELEASE_BASE_URL` で指す。完了確認: 隔離 HOME で `spirits update` の終了コードが 0、`--version` が新しい版になり、`~/.spirits/managed-pi/current` が存在する。
- [ ] 14.6 互換性ランナーの公式モードを実行し、必須観測に `failed` が無く、`not-run` が成功として扱われていないことを確認する。完了確認: 結果の `Compatibility met` が真。
- [ ] 14.7 tmux 検証ランナーでビルドした起動役を起動し、ヘッダ・`/spirits-clear`・`tsrepl` を確認する。`spirits -- update --extensions` がホストの `update` として処理されるかも確認し、処理されない場合は 5.1 の案内文を実測に合わせる。完了確認: `scripts/tmux-verify.sh check` の終了コード 0 と、`spirits -- update --extensions` の結果の記録。
- [ ] 14.8 既存の `~/.spirits/agent` と `~/.spirits/managed-pi` を隔離 HOME にコピーして起動し、設定・セッション・managed 一式がそのまま使えることを確認する。完了確認: コピーした agent dir で `spirits` が起動し、managed の `current` が検証を通過する。
- [ ] 14.9 `openspec validate remove-pi-fork --strict` が成功し、`openspec status --change remove-pi-fork` が全アーティファクト done であることを確認する。完了確認: コマンドの終了コード 0。

## Workflow follow-up

- 人間の作業 (エージェントは実行しない。実装の完了後に行う):
  - リリース資産を手元に退避してから、GitHub の Settings で「Leave fork network」を実行し、Issues を有効にする。確認: `gh repo view betiz0/spirits --json isFork,hasIssuesEnabled` で `isFork=false`、`hasIssuesEnabled=true`。
  - spirits で使わないワークフローの無効化状態を確認する。確認: `gh workflow list --all` で `spirits-ci.yml` と `spirits-release.yml` 以外が `disabled_manually` または存在しない。
  - 役目を終えたブランチ (`feat/add-managed-pi-route`、`feat/add-bundled-skills`、`spirits-m2-verify`) を削除する。実装を別ブランチへ移した後に行う。確認: `git branch -a` に 3 本が無く、3 本とも `origin/main` に含まれていたこと。
- アーカイブ前に `openspec validate remove-pi-fork --strict` を通す。
- アーカイブは `openspec archive remove-pi-fork` で行い、結果の spec 差分が本仕様へ反映され、`upstream-tracking` / `model-role-badge` / `model-commands` / `session-clear` の本仕様が削除されていることを確認する。
- アーカイブ後、`openspec/specs/` 側で本仕様の Purpose を更新する (binary-distribution、managed-pi、self-update、product-identity、managed-commands、dual-model-routing、architecture-conventions、managed-pi-compatibility)。確認: 各 spec の Purpose に「Pi のフォーク」「組み込みテーマ資産を含む配布物」「拡張更新との組み合わせ」「role 登録 API の有無で経路を分け」等の旧前提が無い。
