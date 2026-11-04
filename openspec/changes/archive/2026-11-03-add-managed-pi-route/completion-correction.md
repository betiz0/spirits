# 完了記録の訂正: add-managed-pi-route

`2026-11-03-add-managed-pi-route` の `tasks.md` は全項目が `- [x]` の完了扱いになっている。その記録は
そのまま残す(チェックボックスも本文も書き換えない)。このファイルは、`guard-managed-pi-agent-writes`
の作業中に行った再実行にもとづいて、完了記録の到達範囲を訂正するものだ。

前提: 元の作業が実行されなかったとは主張しない。結果 JSON・ログ・CI 実行記録が残っていないことは、
未実行の証拠ではなく、裏付けが得られないという事実だけを意味する。

## 1. 今回の再実行で確認できたこと

実行環境と識別子:

| 項目 | 値 |
|---|---|
| プラットフォーム | Linux x86_64 |
| Bun | 1.4.4 |
| Node.js | 26.13.0 |
| OpenSpec CLI | 1.16.0(`npx --yes` の一時キャッシュ) |
| 対象コミット | `dcfe940e8 feat(spirits): add the experimental managed Pi route` |
| ブランチ | `feat/add-managed-pi-route` |
| fixture managed set | set id `pi-1.5.0`、manifest の Pi 版 `1.5.0`、extension 版 `0.1.0` |

再実行して確認できたのは次だけである。

- `cd packages/spirits && bun test` の managed 系と `test/env-defaults.test.ts` が成功する。
- `cd packages/spirits && bun run check` が成功する。
- `bun scripts/managed-pi-compat/run.ts --artifact-root <fixture-root> --out <tmp>/result.json` が
  終了コード 0 で完走し、`confirmed` / `limited` / `not-run` を区別して結果 JSON を書く。内訳は
  `confirmed=20`、`limited=2`(`rlm auto parent` と `data write compatibility`)、`not-run=2`
  (`bundled SKILL.md is raw markdown` と `rlm child abort`)、`failed=0`。
- 変更前のコード(`dcfe940e8` の `packages/spirits/src/managed-pi/environment.ts`)では、
  `SPIRITS_CODING_AGENT_DIR` の明示値が優先され、未設定なら `~/.spirits/agent` が子プロセスの保存先に
なっていた。つまり managed 起動は既定の agent dir に書き込めた。これを記録する。
- 上記 runner 実行はテスト用の一時 HOME、一時 agent dir、fixture の Pi スクリプト
  (`FAKE_RPC_PI_SCRIPT`)に対して行った。公式 Pi 実体は使っていない。

## 2. 以前の完了チェックを裏付けられないこと

次の証拠はどこにも見つからなかった。見つからないという事実は、元のチェックが失敗したことも、
走らなかったことも、どちらも証明しない。

- 元の結果 JSON と実行ログ(`/tmp/spirits-pi-investigation` はこのマシンに存在しない)
- CI の実行記録(archived design 自身が CI の Bun 1.4.2 条件を再現できなかった旨を記述している)
- managed の release 資産(`spirits-managed-pi-extension.js` / `spirits-managed-pi-manifest.json` の
  実体と checksum)
- `openspec validate` の実行出力

証拠が無いまま `- [x]` になっているチェック:

| チェック | 区分 | 理由 |
|---|---|---|
| 10.3 `openspec validate add-managed-pi-route --strict` が成功 | 証拠なし | アーカイブ済みの変更名は現在の CLI では解決できない(`Unknown item 'add-managed-pi-route'`)。当時の validate 出力も残っていない |
| 10.4 fixture root で install → update → launch → runner を順に実行し既定経路のスモーク成功 | 証拠なし | 結果 JSON・ログが残っていない。現在この経路を覆うのは `test/managed-pi-integration.test.ts` の再実行結果であり、元の 10.4 の実行記録ではない |

## 3. 実測で未達と判明したこと

以下は再実行したコードとテストの読み取り結果がチェック本文と一致しない。区分は「矛盾」である。

| チェック | 区分 | 実測 |
|---|---|---|
| 11.2 probe 拡張が `pi.registerTool` を包んで `tsrepl` を捕捉し、`probe captures tsrepl` / `probe marks the bypassed path` が「専用 Pi の probe 経路を記録する結果で成功」 | 矛盾 | `test/managed-pi-compat-tsrepl.test.ts` は `FakePi` と `executeCapturedTsrepl(..., process.cwd())` を runner プロセス内で呼ぶ。専用 Pi の子プロセスが記録した結果を input にしていない |
| 11.4 専用 Pi 上で `return 1 + 1` / `Bun.Transpiler` / `node:vm` のセルを実行し、セル項目が結果 JSON に現れる | 矛盾 | 名前指定された 4 テストは runner プロセス内の実行で、本文が証拠として認めない経路に該当する。子プロセス側は `FAKE_RPC_PI_SCRIPT` がコード文字列を見て固定文字列を返すだめで、変換と vm 実行が走った証拠にはならない |
| 11.6 fake provider のツール呼び出しを専用 Pi 上で end-to-end 実行 | 矛盾 | テストは fake provider へ直接 HTTP を投げ、捕捉したツールを runner プロセスで実行する。runner の `model tool call reaches tsrepl` が受取る `tool_execution_start` / `tool_execution_end` は fixture スクリプトが固定で出力するレコード |
| 11.8 rlm の物理モデルの子と `spirits/auto` の親を別項目にし、失敗を成功にしない | 矛盾 | 実測では `rlm child abort` が `not-run`、`rlm auto parent` が `limited` で、失敗を成功には扱っていない。一方で「子の生成・最終回答・`rlm_usage`・中断を確認した」という本文の到達範囲は未達で、`rlm_usage` は probe 拡張が合成した値 |
| 11.9 既存 agent dir の redact fixture を runner に配線し、読み取りと書き込みを別項目に | 矛盾 | 読み取りは redact 済み fixture の一時コピーを runner プロセスで読むだけ。書き込みは `classifyWrite({ requiresConversion: true })` を固定値で呼ぶ分岐で、専用 Pi への実際の書き込みを試みていない。結果が `limited` + `aborted` であることは書き込み互換の実測を意味しない |
| 11.10 role・`/clear`・`/model` の probe 結果で互換マトリクスを上書きし、role 行が専用 Pi 観測値になる | 矛盾 | 上書き値の供給元は fixture が返すツール一覧とコマンド一覧(`["tsrepl","manage_todos"]` と `[model, clear]`)。実 Pi の能力判定ではなく、`role/clear/model matrix` の `confirmed` は「上書きした」ことの意味にとどまる |
| 11.17 timeout 引き上げを CI 条件で見直し、戻せない場合は理由を design に記録 | 矛盾 | `test/architecture-conventions.fixtures.test.ts` は 30 秒が 75 箇所残る一方、`beforeAll` が 60 秒、1 件が 120 秒のまま。archived design 自身が「CI の Bun 1.4.2 を取得できず CI 条件を再現できていない」と記述しており、本文が要求する「CI 相当のコマンドで成功」は未達 |

追加の安全ギャップ(この変更の実装動機): managed 起動が既定の `~/.spirits/agent` を保存先にできたこと、
明示 `SPIRITS_CODING_AGENT_DIR` で任意の保存先を選べたこと、起動前にパス安全性(一致・包含・symlink・
managed root 外・ディレクトリ以外の実体)を拒否しないこと、`--session` / `--fork` / `--session-dir` /
`--export` 経由で既存 session や外部保存先を指せたこと。いずれも `guard-managed-pi-agent-writes` で
spawn 前の拒否に変更した。

## 4. 後続 change で対応すること

- 互換性ランナーの全面的な修正: probe 拡張の専用 Pi 上での捕捉確認、セル実行の変換と vm 経路の実測、
  fake provider の end-to-end 配線、rlm の子の生成・最終回答・`rlm_usage`・中断の実測、
  role・`/clear`・`/model` の実測とマトリクス供給元の変更、同梱 `SKILL.md` の実書き出し確認。
- 既存データの読み書き互換の実証。読み取り成功を書き込み成功にしない現行の区分を保ったまま、両方向を
  別 change で実証する。実証なしに既定経路の切り替え・既存データの継続利用・フォーク削除は行わない。
- rlm の認証継承、role・`/clear`・`/model` の代替実装、managed release 資産の配布と検証。
- 実行ログと結果 JSON の永続場所の決定(この訂正記録は再現コマンドと観測要約を保持するが、CI 成果物の
  保管場所は追加しない)。

## 根拠の範囲

読めたもの(この訂正の根拠):

- `openspec/changes/archive/2026-11-03-add-managed-pi-route/{proposal,design,tasks}.md` と `specs/`
- 現行コード: `packages/spirits/src/managed-pi/`(変更前の `dcfe940e8` を含む)、`packages/spirits/bin/`、
  `scripts/managed-pi-compat/`
- 現行テスト: `packages/spirits/test/managed-pi-*.test.ts`、`test/managed-pi-fixtures.ts`、
  `test/architecture-conventions.fixtures.test.ts`
- 現行ドキュメント: `docs/spirits-managed-pi.md`、`docs/spirits-design.md`、`packages/spirits/README.md`
- OpenSpec 設定: `openspec/config.yaml` と変更の `.openspec.yaml`
- この change の提案・仕様・設計(`openspec/changes/guard-managed-pi-agent-writes/`)と、上記環境での
  再実行結果

読めなかったもの(この訂正で断定に使わない):

- 元の `/tmp/spirits-pi-investigation` と、そこにあった監査作業ファイル
- 元の実行が産んだ結果 JSON・標準出力・標準エラーのログ
- CI の実行記録と Bun 1.4.2 環境の測定値
- managed の release 資産実体(`spirits-managed-pi-extension.js` / `spirits-managed-pi-manifest.json`)

上記が読めないことをもって、元の作業が走らなかったとは書かない。「走る条件を再現できない」と
「現在のコードとテストがチェック本文と一致しない」を上の表で分けている。

## この change が実装したこととの区別

`guard-managed-pi-agent-writes` が実装するのは、隔離 agent dir の解決・パス検査・明示指定の拒否・
継承環境の固定・起動引数の拒否・コマンド別の副作用の固定・ドキュメントとこの訂正記録までである。
既存データの読み書き互換は実証済みではなく、実証は上記の後続 change の条件である。ランナーの probe・
fake provider・rlm・データ分類の修正はこの change の対象外で、環境計算 API への追従だけを行っている。

## 検証の転記(タスク 4.6)

`guard-managed-pi-agent-writes` の統合確認で実行したコマンドと結果。実ユーザーデータ、実認証、実
provider は使っておらず、すべて一時 HOME と fixture、およびローカルファイル読み取りに留まる。
タスク 1.2 / 2.3 / 5.1-5.3 の実装後に再実行した最終結果である。

| コマンド | 結果 |
|---|---|
| `cd packages/spirits && bun test test/managed-pi-agent-dir.test.ts test/managed-pi-bootstrap.test.ts test/managed-pi-env.test.ts test/managed-pi-launch.test.ts test/managed-pi-install.test.ts test/managed-pi-update.test.ts test/managed-pi-repair.test.ts test/managed-pi-command.test.ts test/managed-pi-integration.test.ts` | 62 pass / 0 fail |
| `cd packages/spirits && bun test` | 750 pass / 0 fail(89 files、2327 expect) |
| `cd packages/spirits && bun run check`(`tsc --noEmit`) | 成功 |
| `npm run check`(リポジトリルート) | 成功(biome、pinned-deps、runtime-deps、ts-imports、entry-graphs、install-lock、tsc、browser-smoke) |
| `npx --yes @fission-ai/openspec@1.16.0 validate guard-managed-pi-agent-writes --strict` | `Change 'guard-managed-pi-agent-writes' is valid`(終了コード 0、リポジトリと lockfile は未変更) |
| `bun scripts/managed-pi-compat/run.ts --artifact-root <fixture-root> --out <tmp>/result.json` | 終了コード 0。`confirmed=20` / `limited=2` / `not-run=2` / `failed=0`。`data write compatibility` は `limited` + `aborted: the write requires a destructive conversion; write compatibility is not confirmed`。`<artifact-root>/agent` は作成されない |
| `git diff --name-only` と `git status --short` | 差分は `packages/spirits/`、`scripts/managed-pi-compat/`、`docs/`、`openspec/` のみ。`packages/coding-agent/`、`packages/ai/`、`packages/tui` の差分なし。`package.json` / lockfile の差分なし(新規依存なし) |
| 旧 `computeManagedEnv` の挙動確認(`git show dcfe940e8:packages/spirits/src/managed-pi/environment.ts`) | 明示 `SPIRITS_CODING_AGENT_DIR` 優先・未設定なら `~/.spirits/agent` を確認 |
| `openspec validate add-managed-pi-route --strict`(OpenSpec CLI 1.16.0) | `Unknown item 'add-managed-pi-route'`(アーカイブ済みため現在の CLI では解決不可。10.3 を「証拠なし」に分類した根拠) |

未確認のまま残す項目(この change で解決しない):

- 公式 Pi 1.5.0 実体に対する互換性ランナーの全項目(probe・fake provider・rlm・データ分類・マトリクス)は
  fixture の Pi スクリプトに対する観測であり、実 artifact では測定していない
- 既存 `~/.spirits/agent` の読み書き互換(上記 4 節の後続 change)
- CI の Bun 1.4.2 環境での `test/architecture-conventions.fixtures.test.ts` の実行時間(timeout を
  30 秒へ戻せるかの判断は未確訴のまま)
- managed release 資産(`spirits-managed-pi-extension.js` / `spirits-managed-pi-manifest.json`)の実体と
  checksum の配布確認
- 実ユーザーデータ・実認証・実 provider を使った起動(この change のテストと検証では使わない)
