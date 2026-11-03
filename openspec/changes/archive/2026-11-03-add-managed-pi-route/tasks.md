# Tasks

## 0. 規約正本の登録

- [x] 0.1 `docs/architecture/convention-registry.md` に `spirits:managed-pi` を登録する。`registry:layers` の許可向きは `spirits:shared`、`spirits:update`(再利用する資産に限定)、Pi に限定し、`registry:layer-members` に `packages/spirits/src/managed-pi/` を加え、`spirits:bin` の許可表に `spirits:managed-pi` を追加する。層の数と兄弟層の説明も更新する。検証: 正本の層表・所属表・bin 許可表の 3 箇所に `spirits:managed-pi` が現れ、`cd packages/spirits && bun test test/architecture-conventions.test.ts` の `real repo: every reportable rule id exists in the registry` が成功すること
- [x] 0.2 `packages/spirits/src/managed-pi/` のファイルが `ARCH-LAYER-UNKNOWN` にならず、`update` 以外の兄弟層へ依存すると `ARCH-SPIRITS-LAYER` になることを fixture で固定する。検証: `cd packages/spirits && bun test test/architecture-conventions.fixtures.test.ts` の新ケース `managed-pi layer is recognized` と `managed-pi sibling dependency is rejected` が成功すること

## 1. Manifest と成果物の対応付け

- [x] 1.1 `packages/spirits/src/managed-pi/` に manifest の型と読み込み・検証を追加する。Pi の版、platform、artifact URL/SHA256、拡張 bundle の版/SHA256、overlay の版/SHA256、asset 一覧を持ち、欠落・型不正・未知の platform を拒否する。検証: `cd packages/spirits && bun test test/managed-pi-manifest.test.ts` の `manifest accepts the first supported set` / `manifest rejects a missing checksum` / `manifest rejects an unsupported platform` が成功すること
- [x] 1.2 artifact URL の解決と manifest との照合を実装する。ストリームでの SHA256 計算と部分ファイルの削除は、`src/update/download.ts` の `downloadVerifiedArtifact` から期待ダイジェストを直接受け取る関数へ切り出して再利用し、既存のチェックサム URL 経路はその関数を呼ぶ形に保つ。fixture HTTP サーバで成功・不一致・取得失敗を確認する。検証: `bun test test/managed-pi-artifact.test.ts` の `artifact checksum matches` / `artifact checksum mismatch writes no file` / `artifact fetch failure is reported` が成功し、`bun test test/update-download.test.ts` が変更なく成功すること
- [x] 1.3 公式 artifact の展開後に、`piConfig.name=spirits` と `configDir=.pi` を持つ overlay の `package.json` を生成する。公式 artifact の元チェックサムと overlay のチェックサムを別項目で記録し、起動時に overlay の同一性を検証する。検証: `bun test test/managed-pi-overlay.test.ts` の `overlay preserves the official artifact name and version` / `overlay adds the spirits piConfig` / `overlay checksum mismatch is rejected` が成功すること
- [x] 1.4 最初の対応セット(Pi 1.5.0、Linux x64、公式 artifact の検証済み SHA256)と manifest の更新方法を `docs/spirits-managed-pi.md` に記載する。検証: 文書のコマンド例を読み、manifest の全項目が説明され、`spirits-v*` の既定配布物と混同しない記載になっていること
- [x] 1.5 既存の自己更新経路を回帰として固定する。`src/update/download.ts` の変更後も、チェックサム URL 経路が一致・不一致・部分ファイル削除で従来どおり動くことをテストで固定する。検証: `cd packages/spirits && bun test test/update-download.test.ts test/update-apply.test.ts test/update-run.test.ts` が成功すること

## 2. 管理領域の配置・導入・更新

- [x] 2.1 `~/.spirits/managed-pi/releases/<set-id>/` と `current` のレイアウト、同一ルート内の一時ディレクトリ、`current` の symlink rename による原子的切り替えを実装する。検証: `bun test test/managed-pi-layout.test.ts` の `current switches atomically` / `failed switch keeps the previous set` / `temporary directory stays inside the managed root` が成功すること
- [x] 2.2 `managed-pi install` を実装し、fixture から artifact、bundle、asset を取得して全チェックサムを検証し、成功時だけ配置する。チェックサム不一致と欠落では既存 set を変更せず、`~/.spirits/bin` と `~/.spirits/agent` を置換しない。検証: `bun test test/managed-pi-install.test.ts` の `install places a verified set` / `install checksum failure leaves no new set` / `install does not touch the default install or agent dirs` が成功すること
- [x] 2.3 `managed-pi update` を実装し、新しい set の完了後だけ `current` を切り替える。更新失敗時に旧 set が起動可能なまま残ることを確認する。検証: `bun test test/managed-pi-update.test.ts` の `update switches after verification` / `failed update keeps the previous current` / `update does not check the network on launch` が成功すること
- [x] 2.4 破損・欠落した bundle を同じ manifest から再導入する復旧経路を実装する。検証: `bun test test/managed-pi-repair.test.ts` の `repair restores a missing extension bundle` / `repair keeps the pi version` が成功すること
- [x] 2.5 導入・明示更新・ロールバックの利用手順を `docs/spirits-managed-pi.md` と `packages/spirits/README.md` に追記する。検証: 文書に `managed-pi install`、`managed-pi update`、managed root の削除によるロールバック、既定経路を変更しない旨が含まれること

## 3. CLI 分類と起動 wrapper

- [x] 3.1 `bin/bootstrap.ts` で `managed-pi` を pi の import 前に分類し、`install` / `update` / 起動 / pass-through を純関数で返す。既存の `update`、`--version`、`--help`、通常起動の分類を変えない。検証: `cd packages/spirits && bun test test/managed-pi-cli.test.ts` の `classifies managed-pi install update and launch` / `keeps the existing update classification` / `keeps normal arguments unchanged` が成功すること
- [x] 3.2 起動環境の計算を純関数で実装する。明示された `SPIRITS_CODING_AGENT_DIR` を保持し、未指定なら `~/.spirits/agent`、`PI_PACKAGE_DIR` を managed Pi の package dir に固定し、`PI_CODING_AGENT_DIR` を除去し、`PI_SKIP_VERSION_CHECK=1` と `PI_TELEMETRY=0` を既存 route と同じ規則で既定化し、API キー・proxy などその他の変数を保持する。検証: `bun test test/managed-pi-env.test.ts` の `agent dir default and override` / `old agent dir name is removed` / `package dir is pinned` / `api key and proxy are preserved` が成功すること
- [x] 3.3 起動 wrapper を実装し、managed Pi の絶対パスだけを使い、PATH 上の `pi` を探索せず、stdio と終了コードを引き継ぐ。未導入・破損・非対応では理由と復旧コマンドを表示し、既定経路へ fallback しない。検証: `bun test test/managed-pi-launch.test.ts` の `launches the absolute managed path` / `does not search PATH` / `missing set does not fall back` / `exit code is propagated` が成功すること
- [x] 3.4 CLI の使い方、実験表示、失敗時の復旧手順を `docs/spirits-managed-pi.md` に追加する。検証: 文書の全コマンド例が実装した help と一致し、`managed-pi` が既定経路ではないことを明記していること

## 4. 拡張 bundle と配布入力の生成

- [x] 4.1 `scripts/` に拡張 bundle のビルドを追加し、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox` を external に保ち、Markdown を文字列として埋め込む。検証: 生成した bundle に host package の実体が含まれず、`with { type: "text" }` が残らず、`bun build` が成功すること
- [x] 4.2 ビルド成果物から manifest を生成し、bundle と manifest の SHA256 を出力する。既存の `spirits-linux-x64`、`theme/`、install.sh、`spirits update` の出力契約を変更しない。検証: `bun test test/managed-pi-build-inputs.test.ts` の `build inputs include manifest and bundle checksums` / `existing binary outputs are unchanged` が成功すること
- [x] 4.3 release workflow に bundle と manifest の添付を追加し、既存の `spirits-linux-x64` と theme の添付・チェックサム・自己更新スモークを壊さない。検証: workflow の YAML を構文検査し、既存の公開物と新しい追加物の一覧をテストで照合すること
- [x] 4.4 bundle の契約(host external、text asset の埋め込み、SDK を二重化しないこと)を `docs/spirits-managed-pi.md` に記載する。検証: 文書に 3 つの host package 名と external の理由、text asset の扱いが含まれること

## 5. 不足 API の限定互換モード

- [x] 5.1 `packages/spirits/src/routing/` に host の任意 API の有無を判定する分岐を追加し、API がある場合は既存の登録経路をそのまま使う。検証: `cd packages/spirits && bun test test/routing-register.test.ts` の既存ケースがすべて成功し、新ケース `uses the existing role registration when available` が成功すること
- [x] 5.2 role API が無い host では、仮想モデル・skill フェーズ・既定 role の読み取りを残し、role 登録だけを省略し、起動時に制限内容を 1 回通知する。role フィールドやバッジが利用可能であるかのように表示しない。検証: `bun test test/routing-managed-compat.test.ts` の `loads without the role API` / `keeps skill-driven strong phase` / `reports the degraded role surface once` が成功すること
- [x] 5.3 既定経路の回帰を固定する。role API がある既存 host で `/model ... role`、既定 role 保存、role バッジの既存テストが変わらず成功することを確認する。検証: `cd packages/spirits && bun test test/routing-integration.test.ts test/pi-runtime/model-roles-api.test.ts` が成功し、`/model` の引数解析は `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/model-command-args.test.ts` が成功すること
- [x] 5.4 限定互換モードの利用者向け説明を `docs/spirits-managed-pi.md` に追加する。検証: 文書に「利用可」「制限付き」「利用不可」の意味と、起動時の通知内容が記載されていること

## 6. 互換性ランナー: プロセスと登録の確認

- [x] 6.1 `scripts/managed-pi-compat/` に、fixture HTTP サーバ、一時 HOME、一時 agent dir、一時 managed root、JSON 結果を扱うランナーの骨格を追加する。結果は `confirmed` / `limited` / `unavailable` / `not-run` / `failed` を区別する。検証: `bun test test/managed-pi-compat-runner.test.ts` の `runner isolates HOME and agent dir` / `runner records not-run separately` が成功すること
- [x] 6.2 専用 Pi を RPC モードで起動し、`session_start` 後の状態とツール一覧で拡張ロードを判定する。`--help` の exit 0 だけを成功条件にせず、stderr のロードエラーを記録する。検証: `bun test test/managed-pi-compat-load.test.ts` の `loads the extension after session start` / `help exit zero is not a load pass` が成功すること
- [x] 6.3 identity、agent dir の優先、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の decoy 耐性、`--help` の副作用、API キーと proxy の保持をランナーの項目として実装する。検証: `bun test test/managed-pi-compat-env.test.ts` の `agent dir precedence` / `package dir decoy does not change identity` / `help touches only the isolated home` / `api key and proxy survive` が成功すること
- [x] 6.4 同梱スキルの Markdown が raw のまま書き出されることを確認する項目を追加する。検証: `bun test test/managed-pi-compat-assets.test.ts` の `bundled SKILL.md is raw markdown` が成功すること
- [x] 6.5 ランナーの実行方法、結果の読み方、隔離と後始末を `docs/spirits-managed-pi.md` に記載する。検証: 文書のコマンドで fixture ランナーを起動でき、結果の全状態が説明されていること
- [x] 6.6 ランナーに、bundle 済み拡張が参照する host の版が専用 Pi artifact の版と一致し、bundle 内の別 SDK の版にはならないことを確認する項目を追加する。検証: `bun test test/managed-pi-compat-host-version.test.ts` の `host version matches the artifact` / `bundled sdk version is not reported` が成功すること

## 7. 互換性ランナー: tsrepl の実セル実行

- [x] 7.1 テスト用 probe 拡張を追加し、ロード時に `pi.registerTool` を包んで登録済み `tsrepl` の定義を捕捉し、probe コマンドから実 `execute` を呼べるようにする。捕捉した呼び出しが Pi の権限・フック経路を迂回することを結果に記録する。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `probe captures tsrepl` / `probe marks the bypassed path` が成功すること
- [x] 7.2 専用 Pi 上で `return 1 + 1`、`Bun.Transpiler` を使う TS セル、`node:vm` を使うセルを実行し、拡張ロード成功とセル実行成功を別項目で記録する。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `simple cell returns 2` / `Bun transpiler cell runs` / `vm cell runs` / `cell failure is not reported as a load failure` が成功すること
- [x] 7.3 fake provider 用のローカル HTTP サーバと custom provider fixture を追加し、モデルからの 1 回の `tsrepl` ツール呼び出しを end-to-end で実行する。外部の推論 API を呼ばず、fake provider の成功を実 provider の互換性確認として記録しない。検証: `bun test test/managed-pi-compat-fake-provider.test.ts` の `model tool call reaches tsrepl` / `no real credentials are read` / `fake provider success is not reported as real provider compatibility` が成功すること
- [x] 7.4 tsrepl 互換性の結果分類と、probe 経由の限界を `docs/spirits-managed-pi.md` に記載する。検証: 文書に「セル実行の確認」と「Pi のツール権限経路の確認」が別項目であることが書かれていること

## 8. 互換性ランナー: rlm 子セッション

- [x] 8.1 fake provider を使い、物理モデルを選択した親から rlm を呼び、子セッションの生成、最終回答、`rlm_usage`、中断を確認する項目を追加する。検証: `bun test test/managed-pi-compat-rlm.test.ts` の `physical model child completes` / `child usage is recorded` / `child abort is reported` が成功すること
- [x] 8.2 親が `spirits/auto` の場合を別項目にし、子が virtual model を解決できたか、失敗した場合は既知の制約かを記録する。成功していない項目を `confirmed` にしない。検証: `bun test test/managed-pi-compat-rlm.test.ts` の `auto parent is recorded separately` / `auto parent failure is limited not confirmed` が成功すること
- [x] 8.3 rlm の互換結果と既知の制約を `docs/spirits-managed-pi.md` に記載する。検証: 文書に物理モデルと `spirits/auto` の区別、fake provider の範囲、実 provider を使うテストはこの change の対象外であることが含まれること

## 9. 既存データと role・clear・model のマトリクス

- [x] 9.1 redact した既存 agent dir の fixture を作り、settings、auth、sessions、外部拡張の読み取りを一時コピーで確認する。実 `~/.spirits/agent` は変更しない。検証: `bun test test/managed-pi-compat-data.test.ts` の `reads settings and sessions from a redacted copy` / `never writes the real agent dir` が成功すること
- [x] 9.2 書き込み互換を読み取り互換と別項目にし、設定保存などの結果を `limited` または `not-run` として記録する。変換が必要な操作を検出した場合に中止する経路を確認する。検証: `bun test test/managed-pi-compat-data.test.ts` の `write compatibility is not confirmed by read success` / `conversion-requiring write is aborted` が成功すること
- [x] 9.3 role、`/clear`、`/model` の目的ごとの probe を追加し、専用 Pi での状態をマトリクスとして出力する。利用不可の項目には代替案と現行との操作・表示・内部方式の差異を付ける。検証: `bun test test/managed-pi-compat-matrix.test.ts` の `role items are classified separately` / `clear items include the session-id difference` / `model items separate level from role` が成功すること
- [x] 9.4 role・`/clear`・`/model` の目的、現行機構、専用経路の状態、代替案、差異を `docs/spirits-managed-pi.md` と `docs/spirits-design.md` の参照節に記載する。既存経路の機能を削除しないことを明記する。検証: 文書に 3 機能すべての目的と代替案があり、`openspec/specs/` の既存要件を変更しない旨が書かれていること

## 10. 統合確認

- [x] 10.1 `cd packages/spirits && bun test` が全件成功し、既存の routing、tsrepl、rlm、harness、update のテストを含めて回帰がないことを確認する
- [x] 10.2 `cd packages/spirits && bun run check` とリポジトリルートの `npm run check` が成功することを確認する
- [x] 10.3 `openspec validate add-managed-pi-route --strict` が成功することを確認する
- [x] 10.4 fixture の managed root で `managed-pi install` → `managed-pi update` → `managed-pi` 起動 → 互換性ランナーを順に実行し、既定の `spirits` 起動と `spirits update` の挙動が変わっていないことを確認する。検証: ランナーの結果が `confirmed` / `limited` / `unavailable` / `not-run` を区別し、既定経路のスモークが成功すること
- [x] 10.5 変更の差分を確認し、`packages/spirits/`、`scripts/`、`docs/`、`openspec/` 以外の Pi コアに差分がなく、`[spirits]` コアコミットを追加していないことを確認する。検証: `git diff --stat` と `git diff --name-only` に `packages/coding-agent/`、`packages/ai/`、`packages/tui/` が含まれないこと

## Workflow follow-up

- 互換性ランナーの結果をレビューし、role・`/clear`・`/model` の代替を実装する後続 change、限定 Pi パッチの要否、既定経路の切り替え、フォーク削除、本番配布への統合を別々に提案する。
- 実験経路の利用者向け注意(実験的であり、既定経路ではないこと)をリリースノートに記載する。

## 11. verify2 指摘対応

verify2 で、タスク 6.2-6.4, 6.6, 7.1-7.3, 8.1-8.2, 9.2-9.3 の検証が「分類関数と単体テスト」に留まり、ランナー項目・専用 Pi 上の実行・実データ分類に到達していないことを確認した。以下を満たすまで完了にしない。

- [x] 11.1 `scripts/managed-pi-compat/run.ts` に環境分離の実測項目を配線する。`PI_PACKAGE_DIR` decoy で `--version` を実行して `classifyEnv` に渡し、`--help` 前後の `listFiles(home)` を `classifyHelpSideEffects` に渡す。API キーと proxy の保持も同じ子プロセス観測で記録する。検証: `bun test test/managed-pi-compat-env.test.ts` に加え、`bun scripts/managed-pi-compat/run.ts` の結果 JSON に `agent dir precedence` / `package dir decoy does not change identity` / `help touches only the isolated home` / `api key and proxy survive` が `not-run` 以外で現れること
- [x] 11.2 専用 Pi に読み込む probe 拡張を `scripts/managed-pi-compat/fixtures/` に追加し、`pi.registerTool` を包んで `tsrepl` の登録を捕捉する。捕捉した定義を RPC から呼ぶコマンドを実装し、`captureRegisteredTools` が登録後の配列を返すよう修正する。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `probe captures tsrepl` / `probe marks the bypassed path` が、専用 Pi の probe 経路を記録する結果で成功すること
- [x] 11.3 専用 Pi の RPC で `session_start` 後のツール一覧を取得し、`tsrepl` の有無で拡張ロードを判定する。`--help` の exit code だけを成功条件にしない。検証: `bun test test/managed-pi-compat-load.test.ts` に加え、`bun scripts/managed-pi-compat/run.ts --artifact-root <managed-root>` の `managed extension load` が `confirmed` または理由付き `unavailable`/`failed` になること
- [x] 11.4 専用 Pi 上で `return 1 + 1`、`Bun.Transpiler`、`node:vm` のセルを実行し、拡張ロード成功とセル実行成功を別項目で記録する。runner プロセス内の実行は専用 Pi の証拠として扱わない。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `simple cell returns 2` / `Bun transpiler cell runs` / `vm cell runs` / `cell failure is not reported as a load failure` が専用 Pi 実行の結果で成功し、`run.ts` の結果 JSON にセル項目が現れること
- [x] 11.5 専用 Pi の probe から host の `VERSION` を観測し、manifest の Pi 版と比較する。観測できない場合は `not-run` にし、`confirmed` にしない。検証: `bun test test/managed-pi-compat-host-version.test.ts` の `host version matches the artifact` が観測値を入力にし、`run.ts` に自己比較が残っていないこと
- [x] 11.6 fake provider 用の custom provider fixture を `scripts/managed-pi-compat/fixtures/` に追加し、モデルからの 1 回の `tsrepl` ツール呼び出しを専用 Pi 上で end-to-end 実行する。fake provider の成功を実 provider の互換性として記録しない。検証: `bun test test/managed-pi-compat-fake-provider.test.ts` の `model tool call reaches tsrepl` / `no real credentials are read` / `fake provider success is not reported as real provider compatibility` が fixture 経由で成功すること
- [x] 11.7 同梱 `SKILL.md` を専用 Pi のセッション開始後に agent dir へ書き出し、raw Markdown であることを確認する。bundle 文字列の検査だけをシナリオの証拠にしない。検証: `bun test test/managed-pi-compat-assets.test.ts` の `bundled SKILL.md is raw markdown` が書き出しファイルを読むこと
- [x] 11.8 fake provider を使う rlm 子セッション項目を runner に追加する。物理モデルの子（生成、最終回答、`rlm_usage`、中断）と `spirits/auto` の親（解決可否、失敗時は `limited`）を別項目にし、失敗を成功にしない。検証: `bun test test/managed-pi-compat-rlm.test.ts` の 5 ケースに加え、`run.ts` の結果 JSON に両方の項目が現れること
- [x] 11.9 既存 agent dir の redact fixture を runner に配線し、読み取り互換と書き込み互換を別項目にする。変換が必要な操作は `failed` ではなく `aborted` の理由付き結果として記録し、実 `~/.spirits/agent` を変更しない。検証: `bun test test/managed-pi-compat-data.test.ts` の 4 ケースに加え、`run.ts` の結果 JSON に読み取りと書き込みの別項目が現れること
- [x] 11.10 role・`/clear`・`/model` の probe 結果で互換マトリクスを上書きする。静的な `COMPAT_MATRIX` だけを結果として報告しない。検証: `bun test test/managed-pi-compat-matrix.test.ts` に加え、`run.ts` の結果 JSON の role 行が専用 Pi 観測値になること
- [x] 11.11 破損した managed set の起動テストを追加する。`pi/pi` を書き換えた状態で `launchManagedPi` が非ゼロ・`launched: false`・spawn 未呼び出しになることを確認する。検証: `bun test test/managed-pi-launch.test.ts` の新ケース `corrupt executable does not fall back` が成功すること
- [x] 11.12 `src/managed-pi/command.ts` のテストを追加する。fixture manifest で `--version` 不一致時に exit 1・`releases/` 未作成になること、`repair` と `help` の分類・表示を確認する。検証: `bun test test/managed-pi-command.test.ts` の `unsupported version installs nothing` / `repair uses the installed manifest` / `help prints the experimental route` が成功すること
- [x] 11.13 managed 経路の起動前に `process.platform` / `process.arch` と `MANAGED_PI_PLATFORM` を照合し、非対応時は理由と復旧手順を表示して非ゼロで終了する。検証: `bun test test/managed-pi-launch.test.ts` の新ケース `unsupported platform is rejected before spawn` が成功すること
- [x] 11.14 `scripts/build-managed-pi-inputs.ts --out dist` が既存 `dist/spirits-linux-x64` / `dist/theme/` を削除しないよう、managed 資産だけを置換する。検証: `bun test test/managed-pi-build-inputs.test.ts` の新ケース `build inputs preserve existing release assets` が成功し、release workflow と同じ順で build した後も既存公開物が残ること
- [x] 11.15 fixture の managed root で `install` → `update` → `launch` → 互換性ランナーを最後まで実行する統合テストを追加する。検証: `bun test test/managed-pi-integration.test.ts` が成功し、既定 `spirits` と `spirits update` の既存テストが変わらず成功すること
- [x] 11.16 design D12 の依存見直しを決着させる。`src/managed-pi/command.ts` の manifest URL 解決を `src/managed-pi/` へ移し、`src/update/release.ts` への依存をなくす。または manifest と bundle を同じ release から取る契約を D12 の再利用資産として明記する。検証: 前者なら `grep -R "update/release" packages/spirits/src/managed-pi` が空で `bun test test/managed-pi-command.test.ts` が成功し、後者なら design D12 に 3 関数と理由が記載されていること
- [x] 11.17 既存テストの timeout 引き上げを CI 条件で見直す。CI の Bun 1.4.2 で `test/architecture-conventions.fixtures.test.ts` が 30 秒設定のまま成功するなら元に戻し、戻せない場合は理由を design に記録する。検証: CI 相当のコマンドで同テストが成功し、差分に理由が残っていること
