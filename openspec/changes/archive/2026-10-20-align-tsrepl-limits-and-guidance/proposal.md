# Proposal

## Why

tsrepl は M1 で REPL 本体を実装し、M3/M4 で rlm・メモリ・スキルを載せたが、実運用では bash が 4142 回、tsrepl は 179 回(約 3%、9 セッション)しか使われていない(`~/.spirits/agent/sessions` の 71 セッション集計、2026-10-18 時点)。tsrepl の 179 セルのうち 149 セルは `tool("bash")` を呼ぶだけで、うち 137 セルは出力を加工しておらず、1 セルで bash を 2 回以上呼ぶセルは 0 件だった。つまり tsrepl は「bash を呼ぶための別ツール」としてしか使われていない。

原因は tsrepl の上限と契約が bash より狭いこと、およびモデルがツールを選ぶ材料が無いことにある。tsrepl には promptSnippet / promptGuidelines が無く `<tools>` に載らない一方で `<rules>` には pi 既定の "Use bash for file operations like ls, rg, find" が入る。上限は timeout 既定 30000ms / 最大 120000ms、出力 8000 文字で、bash(timeout 既定なし、2000 行または 50KB、全文を一時ファイルへ保存)より短い。`tool()` は `isError` を先に判定して例外にするため、rg の 0 件・テストの失敗・`git diff --exit-code` の非ゼロ終了でセルが例外になり、出力を取り出せない(rlm は 2 回とも 120000ms で中断し、各回 約 90 万〜150 万トークンを消費している)。

今この change で扱う理由は、利用の誘導(ツール宣言と使用例)と上限の見直しを先に入れないと、tsrepl の利用が増えたときに、rlm の 1 回あたり 90 万トークン超の消費と `tool()` の例外が同じ規模で増えるためである。あわせて、効果を次の change で判断できるように、セル単位の実行ログをセッションへ残す。

## What Changes

- `tool()` の契約を pi codemode の `toScriptValue` に寄せる。エラー扱いの結果でも、そのツールが `outputSchema` を宣言していて `structuredContent` があればそれを返し、例外は構造化結果が無い失敗、宣言の無いツールの失敗、存在しない・呼べないツール、引数不正、拒否に限る。**BREAKING**(非ゼロ終了を検出していた既存セルのコードは `exit_code` の確認に置き換わる)
- セル全体の打ち切りを既定なしにする。`timeout` は任意指定で、上限を 2147483647ms に上げる。最初の `await` より前の同期実行には vm の watchdog(既定 30000ms、timeout 指定時はその値と 30000ms の小さい方)を常にかける。Esc による中断は従来どおり。**BREAKING**(既定の 30000ms 打ち切りに頼っていたセルは、timeout を指定しない限り待ち続ける)
- `rlm` 1 回の呼び出しに実行時間上限 120000ms を設け、超えたら子を中断して、上限で打ち切った旨を含む例外を投げる(`rlm_usage` の `outcome` は `aborted`)。実行の形(同期・直列)は変えない。**BREAKING**(従来は 120000ms のセル timeout まで待ち続けていたため、長い委譲は例外で止まる)
- 出力上限を bash と同規模へ引き上げ、切り捨てたときは全文を一時ファイルに保存してそのパスを結果に書く(先頭と末尾を残して中間を切る形は変えない)。
- 成功して value を返したセルの値を `globalThis._` に入れる。エラーになったセルは `_` を変えない。`reset` で `_` も消える。
- tsrepl に promptSnippet と promptGuidelines を追加し、`<tools>` と `<rules>` に掲載する。guidelines の基準は「2 つ以上のコマンドを続けて実行する / 出力の一部だけを取り出す / 結果を次の手順で使う場合は tsrepl」「1 回だけ実行して出力をそのまま読むコマンドは bash」の 2 点だけ。`rlm` が生成する子セッションの tsrepl は guidelines を空にする。
- code-mode プロンプトの「tsrepl を主要な実行面として使う」行を、上の選択基準に沿った記述へ書き直す(tsrepl を唯一または最優先の実行面とする表現を残さない)。`DEFAULT_CODE_MODE_PROMPT` に `tool("bash")` の使用例を検索・JSON・テストの 3 件、合計 15 行以内で追加する。
- tsrepl のツール説明、`timeout` パラメータの説明、`rlm` のガイダンスの timeout の記述を新しい上限に合わせる。
- 効果測定の基盤として、セルを 1 回実行するたびにカスタムエントリ `tsrepl_cell`(outcome、所要時間、timeout、`tool()` 呼び出しの結果と終了コード、出力の切り捨て、`_` の設定など。コード・出力・引数の中身は含めない)をセッションへ記録する。集計スクリプトはこの change では追加せず、蓄積したログから次の改修プランを別途検討する。

対象外(別の change で扱う): 子セッションのツール構成(bash の開放)、rlm の非同期化(spawn / collect と完了通知)、tsrepl だけをモデルに見せるモード、モデル別のプロンプト追記、長時間コマンドの非同期ハンドル、`tsrepl_cell` ログの集計スクリプトと分析。

## Capabilities

### New Capabilities

- (なし)

### Modified Capabilities

- `tsrepl`: 「timeout」「出力上限」「tool() によるツール呼び出し」「ツールパラメータと結果」「コンテキストのグローバル」を MODIFIED。「同期実行の watchdog」「直前の value の保持」「ツール一覧と規則への掲載」「セル実行ログの記録」「セル実行ログに中身を含めない」「セル実行ログの実行フィールド」「セル実行ログの出力と tool() のフィールド」を ADDED。
- `rlm`: 「rlm の制約の案内」「深度と登録状況に応じた案内」を MODIFIED。ADDED で「rlm 呼び出しの実行時間上限」。
- `continual-harness`: 「code-mode プロンプトの適用」を MODIFIED(実行面の記述をツール選択の基準へ書き直し、ツール選択の使用例を追記し、Pi 既定のセクション維持のシナリオを tsrepl がツール一覧に載った事実と矛盾しない文言に直す)。

## Impact

- 影響コード(すべて `packages/spirits/`):
  - `src/repl/hostfns.ts`(`tool()` の結果判定と呼び出し記録)、`src/repl/registry.ts`(呼び出し記録の受け渡し)
  - `src/repl/cell.ts`(timeout の解決、同期 watchdog、`_` の設定、セルの計測値の返却)、`src/repl/format.ts`(出力上限、切り捨て情報の返却)
  - `src/repl/context.ts`(`_` を置かないための変更はなし。リセットで消えることをテストで担保)
  - `src/tools.ts`(promptSnippet / promptGuidelines、`TSREPL_DESCRIPTION` と `timeout` パラメータの説明、`tsrepl_cell` の記録)、`src/constants.ts`(エントリ種別名)
  - `src/harness/prompt.ts`(実行面の行の書き直しと使用例)
  - `src/rlm/depth.ts`(実行時間上限の定数)、`src/rlm/hostfn.ts`(上限の実行、子の tsrepl の guidelines)、`src/rlm/guidance.ts`(案内)
- 影響テスト: `packages/spirits/test/{hostfns,cell,format,tools,context,rlm-depth,rlm-hostfn,rlm-guidance,rlm-cell,harness-prompt,harness-install}.test.ts`
- 影響ドキュメント: `docs/spirits-m1-repl.md`(§4 ツール定義の表、§5 の項目4 `tool()` と項目6 タイムアウト)、`docs/spirits-m3-rlm.md`(タイムアウトとコスト上限)、`docs/spirits-m4-harness.md`(code-mode プロンプトの骨格 1 と分担の注記)
- pi 上流コア差分: **なし**。pi の `ToolDefinition.promptSnippet` / `promptGuidelines`、`ExtensionToolContext.executeTool` / `tools`、`structuredContent`、`ExtensionAPI.appendEntry` は既存の公開 API を読み取る・呼ぶだけ。一時ファイルは pi の `writeOutputFile` を使わず spirits 側で `os.tmpdir()` に書く(未エクスポートのため)。
- 依存関係: なし(新規依存なし)。
- システム: 効果の測定は上の 71 セッションの集計値を基準にする。リリース後は `tsrepl_cell` エントリを集計して、出力を加工したセルの割合、1 セル内で bash を複数回呼ぶセルの数、`timeout_cell` / `timeout_sync` で打ち切った件数、`tool()` が例外になった件数と `exitCode` が非 0 だった件数を比較する。集計手段はログが貯まってから決める。
