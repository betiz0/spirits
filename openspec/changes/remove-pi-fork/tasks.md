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

- [x] 4.1 `managedRepairHint` を修復コマンド `spirits managed-pi repair` と旧版への戻し方 (タグからの再ビルド、`~/.spirits/bin` の退避) に置き換える。完了確認: `bun test test/managed-pi-release-assets.test.ts test/managed-pi-default-route.test.ts test/managed-pi-launch.test.ts` が成功し、`rg -n "SPIRITS_ROUTE=fork spirits" packages/spirits scripts` が 0 件。
  - 実測: 上記 3 ファイルで 29 pass / 0 fail。`rg -n "SPIRITS_ROUTE=fork spirits" packages/spirits scripts` -> 0 件 (exit 1)。`managedRepairHint` は `MANAGED_PI_ROLLBACK_HINT` (`~/.spirits/bin` の退避、`spirits-fork-final` からの再ビルド、`docs/spirits-host-upgrade.md`) を出す。
- [x] 4.2 `scripts/install.sh` から fork の案内とテーマ資産の取得・検証・配置・修復を外し、managed 一式の導入と失敗時の修復・旧版の戻し方を出す。`--uninstall` の案内に `~/.spirits/managed-pi` を含める。完了確認: `sh scripts/install.test.sh` が成功し、「テーマ資産を取得しない」「旧版のテーマ資産の残置」「managed 導入失敗時の非ゼロ」のケースを含む。`rg -n "SPIRITS_ROUTE|theme|dark\.json" scripts/install.sh` が 0 件。
  - 実測: `sh scripts/install.test.sh` -> 97 passed / 0 failed。`rg -n -i "theme\|SPIRITS_ROUTE\|dark\.json" scripts/install.sh` -> 0 件 (exit 1)。
  - ケース: 「テーマ資産を取得しない」= case 20 (互換資産を置いた配信元でも `dark.json` を要求せず `~/.spirits/bin/theme` を作らない)、「旧版のテーマ資産の残置」= case 6b と case 16 (旧版が残した `bin/dark.json` と `bin/theme/*` をそのまま置く)、「managed 導入失敗時の非ゼロ」= case 22 (終了 1、修復コマンド・旧版への戻し方・`spirits-fork-final`・手順書を表示し `SPIRITS_ROUTE` を表示しない、実行ファイルは残る)。
  - 副次: テーマ資産名の複製検査だった `test/theme-assets-contract.test.ts` は、配置しなくなった installer / smoke の分岐を消し、リリース yml の互換用添付と smoke の互換資産サーブの検査に残した (tasks に名の無い変更)。
- [ ] 4.3 `scripts/self-update-smoke.sh` を新しい自己更新 (実行ファイルのみ) と managed 一式の導入に合わせる。完了確認: `sh scripts/self-update-smoke.sh <old> <new> <version>` が成功する。
  - スクリプトは合わせた (テーマ資産の配置検証と修復フェーズを削除、4/5 引数を manifest / bundle に、旧自己更新向けの互換資産は有るときだけ配信し、更新後の 2 度目の `update` が資産を要求せずに 0 で「already up to date」になることを確認)。
  - 完了確認は未実施: コンパイル済みバイナリ 2 版と manifest / bundle が必要で、それを作る `scripts/build-binaries.ts` の書き換えは 11.1 (§11)。11.1 か 14.4 で実測するまで未完了のままにする。

## 5. 自己更新

- [x] 5.1 `src/update/classify.ts` を、Pi の `update` 文法による分類から、自己更新形 (`update`、`self`、`pi`、`--self` と `--force`、`-a` / `--approve`、`-na` / `--no-approve`) かどうかの判定に置き換える。自己更新形以外は `spirits managed-pi update` と `spirits -- update <引数>` を案内して非ゼロで終了する (design D11)。完了確認: `bun test test/update-classify.test.ts test/update-routing.test.ts` が成功し、`--extensions`、`--all`、`--unknown`、`-h` が案内と非ゼロになり、`-a` が自己更新になるケースを含む。
  - 実測: `bun test test/update-classify.test.ts test/update-routing.test.ts` -> 成功。`classifyUpdateArgs` は `not-update` / `self-update(force)` / `refusal(args)` のどれかで、`-a`・`--approve`・`-na`・`--no-approve` は受理して自己更新の挙動を変えない (転送先は無い)。
  - `runLauncher` に `update-refusal` を追加 (自己更新もホスト起動もせず、`formatUpdateRefusalMessage` を stderr に出して 1)。`--` 以降の `update --extensions` は従来どおりホストへ渡る。案内文は `spirits managed-pi update` と `spirits -- update <実行した引数>`。
  - 自己更新の実行は `LauncherRuntime.runUpdate` の seam 越しにし、テストが実行中のバイナリを置き換えないようにした (tasks に名の無い変更)。
- [x] 5.2 `src/update/run.ts` からテーマ資産の取得・修復と `runExtensionUpdate` を外し、`src/update/theme.ts` と `test/update-theme.test.ts` を削除する (design D8)。完了確認: `bun test test/update-run.test.ts test/update-download.test.ts test/update-apply.test.ts` が成功し、「テーマ資産を取得しない」ケースで fetch に `dark.json` / `light.json` の要求が無い。`rg -n "theme|runExtensionUpdate" packages/spirits/src/update` が 0 件。
  - 実測: 上記 3 ファイルを含む update 系のテストで 49 pass / 0 fail。`rg -n "theme|runExtensionUpdate" packages/spirits/src/update` -> 0 件 (exit 1)。
  - 「テーマ資産を取得しない」ケースは、テーマ資産を添付したリリースへ更新したときにリリース一覧・実行ファイル・その `.sha256` 以外の要求が 0 件で、既存の `theme/` の中身が変わらないことを確認している。
  - 副次: 使われなくなる `applyVerifiedThemeAssets` を `src/update/apply.ts` から削除し、`test/update-apply.test.ts` のテーマ配置ケース、`test/update-cleanup.test.ts` と `test/update-guard.test.ts` の `kind` 指定を削った (tasks に名の無い変更)。

## 6. 拡張の fork 経路を削除する

- [x] 6.1 `src/routing/register.ts` の `registerModelRoles` 分岐、`ROUTING_STATE_ENTRY_TYPE` の書き込み、`onStepChange` の fork 分岐、`session_tree` の条件登録を外す。完了確認: `bun test test/routing-register.test.ts test/routing-managed-compat.test.ts test/routing-phase-wiring.test.ts` が成功する。
  - 実測: 上記 3 ファイルで 21 pass / 0 fail。`registerDualModelRouting` の返り値は `phase` だけ (`roleApi` と `RoutingRecordData` / `latestRoutingRecord` / `isUnaskedSession` / 限定互換の notify は削除)。`onStepChange` は常に `spirits_step` を追記し、`session_tree` は無条件登録、セッション開始では何も追記しない。
  - 追記 (2026-11-14): 7 は型ミラーの更新ではなく公式型への切り替えになった (design D3)。`registerModelRoles` は公式 1.5.0 の公開面に存在しないので、`test/routing/fake-pi.ts` の空実装は 7.5 で型ミラーごと削除する。
  - tasks に名の無い削除: `test/pi-runtime/model-roles-api.test.ts` は fork の role 登録 API と fork ソースの `model-command-args` を pin するテストで、この分岐の削除で失敗するため 8.1 より前に削除した (`routing-record-pin.test.ts` は 8.1 のまま残す)。
  - テストの作り替え: `routing-register.test.ts` の fork 専用のケース (既定ロールを host の状態 entry に書く、`registerModelRoles` の登録、`/model` の onSelect) を削り、ロックは `phase.setRole` で行う。`routing-managed-compat.test.ts` は「公式ホストで何も報告せず、何も書かずにロードされる」検査に作り替えた。`test/routing/fake-pi.ts` から `modelRoles` と `withoutRoleApi` を削除 (`registerModelRoles` はホスト型 mirror が要求するため空実装として残し、当時は 7.1 の mirror 更新で消すとしていた)。`routing-integration.test.ts` は `src/index.ts` と同じ 2 層配線を自分で行い (`patchSettings` は noop)、ロックは `phase.setRole` で立てる。
- [x] 6.2 `src/index.ts` の `routing.roleApi` の条件を外し、`registerManagedCommands` を常に登録する。完了確認: `bun test test/extension-degradation.test.ts test/managed-commands.test.ts` が成功する。
  - 実測: 上記 2 ファイルで成功 (6.3 / 6.4 と合わせて 76 pass / 0 fail)。`managed-commands.test.ts` の「fork 経路は 0 件、公式 Pi では 2 件」のケースは「どのロードでも 2 件」に置き、`extension-degradation.test.ts` の `routing.roleApi` の主張は「virtual model が 1 件登録される」に置いた。
- [x] 6.3 `src/commands/role.ts` の `forkRoleRecord` を読み取り専用の旧データ互換として残し、ホストの状態 entry に書き戻さない。完了確認: `bun test test/managed-role-command.test.ts test/managed-role-status.test.ts` が成功する。
  - 実測: 上記 2 ファイルで成功。`ROUTING_STATE_ENTRY_TYPE` を読むのは `forkRoleRecord` だけで、書き込み元は src に 0 件 (`rg -n "appendEntry\(ROUTING_STATE_ENTRY_TYPE" src` -> 0 件)。role の書き込みは `spirits_role` (`src/commands/register.ts`) だけ。doc comment は旧 fork の旧データの読み取り互換として書き直した。
- [x] 6.4 `src/constants.ts` の `MANAGED_PI_FORK_ROUTE_HINT` を削除する。`ENV_ROUTE` / `ROUTE_FORK_VALUE` は 3.5 の拒否判定のために残す。`src/managed-pi/environment.ts` の fork 期の env 除去は残す。完了確認: `bun test test/managed-pi-env.test.ts` が成功し、`rg -n "MANAGED_PI_FORK_ROUTE_HINT" packages/spirits` が 0 件。
  - 実測: `bun test test/managed-pi-env.test.ts` -> 成功。`rg -n "MANAGED_PI_FORK_ROUTE_HINT" packages/spirits` -> 0 件 (exit 1)。`ENV_ROUTE` / `ROUTE_FORK_VALUE` の読み手は `default-route.ts` の `forkRouteRefusal` だけで、その旨を doc comment に更新した。
- [x] 6.5 `src/commands/settings-store.ts` の fork の文言を「別の spirits プロセス」に更新する。完了確認: `rg -n -i "fork" packages/spirits/src/commands packages/spirits/src/routing packages/spirits/src/index.ts` のヒットが `forkRoleRecord` とその旧データ互換を説明するコメント (「旧 fork」を含む行) だけになる。
  - 実測: ヒットは 6 行で、`forkRoleRecord` の宣言と呼び出しと `{@link forkRoleRecord}` の行、そして「旧 fork」を含むコメント 3 行だけ。その他 (`index.ts` の badge とコマンド登録のコメント、`commands/register.ts` の 2 箇所、`routing/phase.ts` の "forked") も fork の語を消して更新した。

## 7. 公式型への切り替え

- [x] 7.1 4 種の食い違いを、型の表記だけの差か managed 上の実行時の挙動差かを実測で分類する。対象は (1) `getSettings()` の戻り値 (`BrandingSettings` と公式 `Settings`)、(2) コマンドハンドラの `Promise<void>` (ミラーは `Promise<void> | void`)、(3) `ToolDefinition` のジェネリクスと省略可能なフィールド、(4) `KeyId` (ミラーは `string`、公式は template-literal union)。完了確認: 4 行の表 (項目 / 型差 / 実行時差 / 根拠) をこのタスクの下に残し、`packages/spirits` を公式パッケージへ解決した scratch tsconfig で `tsc --noEmit` を実行した結果と、該当箇所を公式ホストで実行した結果を根拠にする。挙動差が出た項目は 7.2 の対象として列挙する。
  - 実測は `/tmp/spikenm/node_modules` と、そこへ `packages/spirits` を解決させた scratch tsconfig を使う。実装のコードは変更しない。
  - 既知の出発点: `getSettings()` のミラーは spirits 独自の `ExtensionSettings` (`models` キーを含む) を返し、公式は `Settings` を返す。コマンドハンドラのミラーは `Promise<void> | void`、公式は `Promise<void>`。`ToolDefinition` のミラーは公式の部分集合で、ジェネリクスの既定は同じ。`KeyId` はミラーが `string`、公式は key list からの template-literal union。
  - 測定の型 (2026-11-14): scratch tsconfig `packages/spirits/tsconfig.s71.json` (`paths` を `/tmp/spikenm/node_modules/@earendil-works/{pi-coding-agent,pi-tui}/dist/index.d.ts` に向け、`src/types/pi-{coding-agent,tui}.d.ts` を exclude) で `tsc --noEmit -p tsconfig.s71.json` -> 315 件 (src 37 / test 278)。内訳は TS2305 63 / TS2740 71 / TS2322 51 / TS2345 51 / TS2416 21 / TS2769 13 / TS2741 12 / TS2339 11 / TS7006 10 / TS2724 5 / TS2739 5 / TS2420 1。
  - 測定の runtime (2026-11-14): `bun scripts/build-managed-pi-inputs.ts --version 0.0.0-s71 --out /tmp/s71/dist` の bundle と、`~/.spirits/managed-pi/current/pi/pi --mode rpc --no-session --no-extensions` に probe 拡張と互換ランナーの fake provider (`fixtures/custom-provider.ts`) を `-e` で足した isolated な HOME / agent dir / cwd で起動し、`set_model compat-fake/fake-model` -> `prompt` した。agent dir の `settings.json` には `quietStartup` と spirits 独自キー `models` / `todo` を書いた。provider が受けた 1 件目の request body から、モデルに渡った system prompt (6110 文字) を取り出した。

  | 項目 | 型の差 (実測) | managed 上の実行時の差 (実測) | 分類 |
  | --- | --- | --- | --- |
  | (1) `getSettings()` の戻り値 | 公式は `Settings` を返す。`quietStartup` は公式型に在るので `src/branding/header.ts` は型 error 無し。spirits 独自キー `models` / `todo` は公式型に無いが、`Record<string, unknown>` への受け渡しは error にならなかった (src の `getSettings` 周辺は 0 件) | `pi.getSettings()` は書き込んだ未知キーをそのまま返した (`keys = [quietStartup, models, todo]`、`models.normal/strong` と `todo.startCollapsed` の値も保持) | 型の表記のみ |
  | (2) コマンドハンドラの戻り値 | 公式は `handler: (args, ctx) => Promise<void>`。`async` 無しハンドラは TS2322 (`src/commands/register.ts(289,3)`、1 件のみ) | `async` 無し (sync `void`) ハンドラを `/s71sync` として登録し、RPC `prompt` の `/s71sync` で実行できた (マーカー ファイルが書かれた)。公式は `await command.handler(...)` なので sync でも例外にならない | 型の表記のみ |
  | (3) `ToolDefinition` のジェネリクスと省略可能 field | `ToolDefinition<TObject<...>, undefined>` を既定 (`ToolDefinition<TSchema, unknown>`) の配列に入れると TS2322。原因は `renderCall` の `args: unknown` の反変で、ジェネリクスを省略して配列に束ねた箇所に限られる (`src/harness/tools.ts(111,*)` 4 件、`src/rlm/spawn.ts(140,18)` 1 件)。`promptSnippet` / `promptGuidelines` / `prepareArguments` は公式に在る (`AgentToolBase`、`prepareArguments` は `tool-definition-wrapper.js:10` で実行時も透過) | `registerTool` は spirits の `tsrepl` / `manage_todos` を受け付け、`getAllTools()` に `promptGuidelines` が出た。モデルに渡った system prompt の `<tools>` に promptSnippet、`<rules>` に promptGuidelines が入った | 型の表記のみ |
  | (4) `KeyId` | 公式は template-literal union。`string` を渡すと TS2345 (`src/todo/widget.ts(232,22)` の 1 件)。文字列リテラル (`"ctrl+shift+l"`) はそのまま入る | `pi.registerShortcut("ctrl+shift+l", ...)` は公式ホストで例外も diagnostic も出さず登録された。公式の shortcut 登録は key を小文字化して Map に持つだけで、列挙への照合はしない | 型の表記のみ |
  | (5) `registerTool` の `promptSnippet` / `promptGuidelines` が system prompt に届くか | 型上は (3) に含む。公式 `ToolDefinition` の省略可能な `promptSnippet` / `promptGuidelines` として宣言されている | 届く。spirits 由来の案内は `tsrepl` 6 箇所 / `manage_todos` 2 箇所 / `## spirits code-mode` セクション内の `rlm` 3 箇所として、provider が受けた system prompt に入った。`ctx.getSystemPrompt()` を `session_start` で読んだ値 (2808 文字) には code-mode セクションが入らないため、`<spirits>` 節は agent start 以降に組み込まれることも同時に確認した | 実行時の差なし |

  - 挙動差は 0 件。よって 7.2 は「該当なし」。
  - 7.4 / 7.5 で追加で対応が必要な型差 (上記 4 件に含まれない、実測で出たもの): 公式の `.` は spirits が import している名前のうち `PiModel` (27 件) / `ThinkingLevel` (11 件) / `ExtensionModelRegistry` (7 件) / `AgentMessage` (5 件) / `ReadonlySessionManager` (4 件) / `ExtensionMode` (4 件) / `AutocompleteItem` (2 件) / `AgentToolCallOutcome` (2 件) / `JsonValue` (2 件) / `Component` (1 件) / `TUI` (1 件) / `RegisteredCommandOptions` (1 件) / `CallableToolInfo` (1 件) を再 export しない。うち `Component` / `TUI` / `AutocompleteItem` / `KeyId` / `Container` / `Text` / `Spacer` / `Loader` / `SettingsList` / `SelectList` は `@earendil-works/pi-tui` の `.` に在り、残りは公式面から誘導する (`ExtensionContext["model"]`、`ReturnType<ExtensionAPI["getThinkingLevel"]>`、`ExtensionContext["modelRegistry"]`、`ExtensionContext["sessionManager"]`、`ExtensionContext["mode"]`)。`@earendil-works/pi-ai` や `@earendil-works/pi-agent-core` を直接 import しないため、`src/types/` に host 型を誘導する 1 ファイルを置く。
- [x] 7.2 7.1 で挙動差が出た項目の修正 (該当する場合)。完了確認: 該当項目ごとに、公式ホストで期待する挙動を確認するテストを追加し、`bun test` が通る。挙動差が 0 件なら「該当なし」を確認して閉じる。
  - 2026-11-14: 該当なし。7.1 の表の挙動差は 0 件で、型の表記だけを 7.4 で直した。
- [x] 7.3 テスト用 fake の共通ヘルパーを公式型に合わせた部分 mock として追加する。`test/routing/fake-pi.ts` などの局所 fake を、公式 `ExtensionAPI` / `ExtensionContext` の部分実装として型検査できる `test/host/fake-pi.ts` (仮) に寄せる。完了確認: helper が公式型で `tsc` を通り、既存の `bun test test/routing` が成功する。
  - 2026-11-14: helper は `test/routing/fake-pi.ts` の `registerReportedRouting()`。role はルート結果から消えた (7.4) ので、role を読む test は `lastRole()` を使う。局所 fake を公式 `ExtensionAPI` の部分実装へまとめる残りは 7.5 で扱う。
- [x] 7.4 `packages/spirits` に公式パッケージを devDependency として追加し、src を実型へ張り替える。`package.json` に `@earendil-works/pi-coding-agent@1.5.0` / `@earendil-works/pi-tui@1.5.0` を完全一致で追加し、`packages/spirits/tsconfig.json` の `paths` を削除、sub-tsconfig は root ではなく `packages/spirits/tsconfig.json` を継承する。`src/` の import と型注釈を公式型に合わせる。完了確認: `packages/spirits` で `bun -e 'console.log(import.meta.resolve("@earendil-works/pi-coding-agent"))'` が root workspace の `packages/coding-agent` ではなく `packages/spirits/node_modules` または root の `node_modules` にある実体を返し、`packages/spirits/node_modules/@earendil-works/pi-coding-agent` が `packages/coding-agent` への symlink でないこと、`src` だけの `tsc --noEmit` が 0 件、`rg -n "src/types/pi-" packages/spirits/src` が 0 件。
  - `src` だけの `tsc` は一時的な config で行い、7.5 で削除する。
  - 実測 (2026-11-14): `packages/spirits/tsconfig.src-only.json` (2 つの mirror を exclude) での `bun x tsc -p tsconfig.src-only.json` -> 0 件。解決は `import.meta.resolve` の probe で `packages/spirits/node_modules/@earendil-works/pi-coding-agent/dist/index.js` と `.../pi-tui/dist/index.js`。どちらも実体ディレクトリで symlink ではない。`rg -n "src/types/pi-" packages/spirits/src` -> 0 件。
  - 型の表記だけでは済まない src の変更 3 件: (a) `/spirits-clear` のハンドラを `async` にした (公式の handler は `Promise<void>`。7.1 (2) で sync でも動くことは実測済み)。(b) ルート結果の `role` をやめ、`RouteDecision` として `onRoute` に報告した (spec `dual-model-routing` / ModelRoute の role は使わない)。role の記録・表示の挙動は変わらない。(c) tool は `defineTool()` で組み立てて `BuiltTool` とし、host の erased な tool list (`createAgentSession()` の `customTools`) にはその形ではめる。`as` による型の上書きは src に 0 件。
- [ ] 7.5 test を公式型へ張り替える。7.3 の helper を使い、各テストの import と型注釈を公式型に合わせる。非公開 subpath を import する 4 テスト (branding-art-colors / child-model-source-pin / system-prompt-defaults / routing-record-pin) と `test/pi-runtime/pi-deep-imports.d.ts` は、このタスクで削除する (3 件の確認内容は §8 で互換性ランナーの公式モードへ移す)。完了確認: `packages/spirits` で `bun run check` が 0 件、`bun test` が全成功、`rg -n "@earendil-works/pi-coding-agent/(core|modes|cli)" packages/spirits/test` が 0 件。
- [ ] 7.6 型ミラーとチェッカーを削除する。`src/types/pi-coding-agent.d.ts`、`src/types/pi-tui.d.ts`、`scripts/check-pi-type-mirror.ts`、`test/pi-type-mirror.test.ts` を削除する。完了確認: 4 ファイルが無く、`bun run check` と `bun test` が成功し、`rg -n "src/types/pi-|check-pi-type-mirror" packages/spirits scripts` が 0 件。

## 8. pin テストの再編

- [ ] 8.1 `branding-art-colors.test.ts` / `child-model-source-pin.test.ts` / `system-prompt-defaults.test.ts` の確認内容を、互換性ランナーの公式モードの観測項目として実装する (design D4)。完了確認: `bun test test/managed-pi-compat-runner.test.ts` が成功し、3 件に対応する観測項目が公式モードのマトリクスに載っている。
- [ ] 8.2 `test/pi-runtime/routing-record-pin.test.ts` の削除を確認する (7.5 で削除済み)。`model-roles-api.test.ts` は 6.1 で削除済み。完了確認: `ls test/pi-runtime` に 2 件が無い。
- [ ] 8.3 残りの `test/pi-runtime/*` (`virtual-model-api` / `virtual-model-reload` / `settings-unknown-key` / `frontmatter` / `harness-skills-yaml` / `bundled-skills`) を、公式パッケージの公開面だけで検証する形にする。完了確認: `bun test test/pi-runtime` が 0 fail、`rg -n "declare module \"@earendil-works|@earendil-works/pi-coding-agent/(core|modes)" packages/spirits/test` が 0 件。
- [ ] 8.4 `test/pi-runtime/pi-deep-imports.d.ts` の削除を確認する (7.5 で削除済み)。完了確認: `test -e packages/spirits/test/pi-runtime/pi-deep-imports.d.ts` が失敗し、`rg -n "declare module" packages/spirits/test` が 0 件。

## 9. アーキテクチャ検査

- [ ] 9.1 `test/architecture/resolve.ts` の `@earendil-works/*` の解決を root `paths` から固定ホスト公開パッケージの解決へ変更する。あわせて `packages/spirits` にホスト型の再宣言 (型ミラー) と ambient module 宣言が無いことを検査する。完了確認: `bun test test/architecture-conventions.test.ts test/architecture-conventions.fixtures.test.ts` が成功し、`rg -n "declare module \"@earendil-works" packages/spirits" が 0 件。
- [ ] 9.2 `test/fixtures/architecture/resolve` の期待値を固定ホスト公開パッケージの解決結果へ更新する。完了確認: 同じテストが成功する。
- [ ] 9.3 `docs/architecture/convention-registry.md` の層と境界をホスト公開パッケージに更新し、`registry:bin-deep-imports` と `test/architecture/registry.ts` の対応する読み取りを削除する。許可する subpath は `pi-coding-agent` の `.` / `./rpc-entry` と `pi-tui` の `.` に限り (`./rpc-entry` は型宣言が無いため型位置では使えない)、ambient module による非公開 subpath の再宣言を禁止することを規約に書く。完了確認: `bun test test/architecture-conventions.test.ts` が成功し、`rg -n "packages/coding-agent|packages/tui|bin-deep-imports" docs/architecture/convention-registry.md packages/spirits/test/architecture` が 0 件。

## 10. 互換性ランナー

- [ ] 10.1 `scripts/managed-pi-compat` から fork ホスト (`packages/coding-agent/src/cli.ts` を起動する経路) を外し、ホスト記述子を渡せるようにする。完了確認: `bun test test/managed-pi-compat-runner.test.ts test/managed-pi-compat-guard.test.ts` が成功する。
- [ ] 10.2 `--mode official` を既定にし、固定 artifact の展開と bundle の照合、および 8.1 で移した 3 観測 (theme の art color / child model / system prompt) を必須観測にする。完了確認: `bun scripts/managed-pi-compat/run.ts --mode official --artifact-root <展開先> --bundle dist/spirits-managed-pi-extension.js --out /tmp/compat` が `Compatibility met` を出す。
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
- [ ] 13.2 `AGENTS.md` / `CONTRIBUTING.md` / `SECURITY.md` / `LICENSE` を書き換える。完了確認: `rg -n "pi-monorepo|npm run check|test.sh" AGENTS.md CONTRIBUTING.md` が 0 件、`LICENSE` に spirits の著作権行と「portions derived from Pi」がある。
- [ ] 13.3 `docs/spirits-design.md` §1 / §2 / §3 / §5 / §9 / §10 と `docs/spirits-default-launch.md` / `docs/spirits-managed-pi.md` を書き換える。完了確認: `rg -n "フォーク|upstream merge|SPIRITS_ROUTE=fork" docs/spirits-design.md docs/spirits-default-launch.md docs/spirits-managed-pi.md` のヒットが、旧版への戻し方と廃止の経緯を述べる行だけで、各ヒットをレビューで確認する。
- [ ] 13.4 `docs/spirits-host-upgrade.md` を追加し、`docs/spirits-upstream-sync.md` と `docs/spirits-core-diffs.md` を削除する。手順書は design「Pi の版更新手順」の順序、失敗時の中止、Rollback を含める。完了確認: `test -f docs/spirits-host-upgrade.md` が成功し、2 ファイルが無い。`rg -n "bun install|bun run check|build-managed-pi-inputs|managed-pi-compat/run.ts|tmux-verify|spirits-fork-final|SPIRITS_ROUTE=fork|generate-models" docs/spirits-host-upgrade.md` で 8 語すべてがヒットし、`rg -n "check-pi-type-mirror|型ミラー" docs/spirits-host-upgrade.md` が 0 件。
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
