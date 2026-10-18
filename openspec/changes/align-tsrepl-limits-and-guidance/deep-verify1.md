## Deep Verification Report: align-tsrepl-limits-and-guidance

- 検証日時: 2026-10-18（verify2、`sprt-opsx-verify-deep`）
- 検証対象: `8dcaf83a2..8dcaf83a2`（未コミット変更: あり。この change の実装はすべて未コミット）
- テストコマンド: `cd packages/spirits && bun test`、`npm run check`（リポジトリルート）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし）
- verify1 レポート: `openspec/changes/align-tsrepl-limits-and-guidance/verify1.md`
- モード: 通常

### 判定
**FAIL**

### 集計
| 観点 | 結果 |
|---|---|
| テスト | 成功 607 / 失敗 0（`npm run check` exit 0） |
| 規約検査 | 成功 9 / 失敗 0（`architecture-conventions.test.ts` は bun test 内で成功。ARCH-DUP の基数 61 も一致） |
| 要件 | 意図どおり 15 / 全 16 |
| シナリオ | 挙動を確認 62 / 全 62、テストが実質的 55 / 全 62 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 2 群 |
| 継ぎ目 | 追加 7 件（Decision あり 7 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 2 件 |
| タスク | 完了 31 / 全 31 |

タスク 9.3 は実機の記録で確認した。`~/.spirits/agent/sessions/--home-betiz-project-spirits--/2026-10-18T06-40-54-412Z_01a14dbd-ea8c-71f8-88bd-e2fe0867610c.jsonl` の `tsrepl_cell` は次の 3 件。

- bash が `exitCode` 1 で `threw` 偽
- 次のセルで `_` を読んでいる
- timeout 未指定の `timeout_sync` が `durationMs` 30001

この記録は、30 秒 watchdog のシナリオ 2 件の実行時の証拠にもなる。

### 継ぎ目一覧
| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `ReplOptions.writeOutput`（書き出し先の注入） | 拡張点 | `packages/spirits/src/repl/cell.ts:49` | 4 | なし | なし |
| N-2 | `CreateRlmHostFnOptions.maxChildDurationMs` | 拡張点 | `packages/spirits/src/rlm/hostfn.ts:36` | 3 | なし | なし |
| N-3 | `CreateTsreplToolOptions.promptGuidelines` | 拡張点 | `packages/spirits/src/tools.ts:89` | 6 | なし | なし |
| N-4 | `CreateTsreplToolOptions.pi` | 拡張点 | `packages/spirits/src/tools.ts:94` | 8 | なし | なし |
| N-5 | `HostFnScope.recordToolCall` と `repl/metrics.ts`（registry → metrics の型依存） | 境界 | `packages/spirits/src/repl/registry.ts:23` | 8 | ARCH-REPL | なし |
| N-6 | `repl/spill.ts` | 境界 | `packages/spirits/src/repl/spill.ts` | 4 | ARCH-LAYER-UNKNOWN（`repl/` に所属、通過） | なし |
| N-7 | `CallableToolInfo`（上流 `AgentTool` の一部を写した型） | 抽象型 | `packages/spirits/src/types/pi-coding-agent.d.ts:307` | 1 | なし | なし |

フォーク元（pi コア）の変更はない。テストから pi の `core/system-prompt` への deep import は、既存の `test/pi-runtime/` の方式（`model-command-args` など）に 1 件足しただけなので、継ぎ目には数えていない。

### 指摘

#### CRITICAL
- **[C-1] 使用例のテストの例で、`exit_code` がテストではなく `tail` の終了コードになる**
  - 場所: `packages/spirits/src/harness/prompt.ts:38`
  - 根拠: 例は `tool("bash", { command: "bun test 2>&1 | tail -40" })` で、返り値に `run.exit_code` を使う。pi の bash は `bash -c` で実行し、`pipefail` を付けない（`packages/coding-agent/src/utils/shell.ts:21`）。そのためテストが失敗しても `exit_code` は 0 になる。`bash -c 'sh -c "exit 3" 2>&1 | tail -40'` で終了コード 0 を確認した。この例は、continual-harness の要件「エラー扱いのツール結果でも構造化結果が返り、終了コードを確認する必要があること」と、tasks 6.3「いずれも `exit_code` を確認して値を小さく返す形」を示すためのもの。それなのに誤った成否判定を教える。モデルがこの形を写して `exit_code === 0` で合否を決めると、失敗したテストを成功と判定する。
  - 修正先: 実装
  - 推奨: パイプを外して `"bun test 2>&1"` とし、末尾の切り出しはセル内の JS で行う（例: `run.output.split("\n").slice(-40)`）。tsrepl の方針「加工はセルで行う」とも合う。あわせて `test/harness-prompt.test.ts` の `default includes tool call examples` に、例のコマンドが `| tail` などのパイプを含まないことのアサートを足す。

#### WARNING
- **[W-1] 正本ドキュメントが、成功時の `tool()` の契約を spec と違う形で書いている**
  - 場所: `docs/spirits-m1-repl.md:67`
  - 根拠: 「結果は pi codemode の `toScriptValue` と同じ契約で、そのツールが `outputSchema` を宣言していれば `structuredContent` を、そうでなければテキストを返す」とある。一方、design Decision 1 は「tsrepl は成功時の既存契約（構造化結果があれば返す）を残す」とし、spec と実装（`hostfns.ts` の `runTool`、成功時は宣言を見ない）もそれに従う。宣言の無いツールが成功時に構造化結果を返す場合、ドキュメントはテキスト、実装は構造化結果になる。
  - 修正先: 実装（docs）
  - 推奨: 「エラー扱いのときだけ pi codemode と同じく `outputSchema` の宣言を見る。成功時は構造化結果があればそれを、無ければテキストを返す」と書き直す。

- **[W-2] `spill: "saved"` を検証するテストがない**
  - 場所: `packages/spirits/test/cell.test.ts:313`
  - 根拠: シナリオ「切り捨ての記録」は `spill` が `saved` になることを求める。テストがアサートしているのは `failed`（`:274`）と `null`（`:213`）だけ。
  - 修正先: 実装（テスト）
  - 推奨: `truncated output is spilled to a temp file` に `expect(result.metrics.spill).toBe("saved")` と `expect(result.metrics.truncated).toBe(true)` を足す。

- **[W-3] 上限値を説明文に直書きしており、定数と二重になっている**
  - 場所: `packages/spirits/src/tools.ts:26`、`:28`、`:49`
  - 根拠: 説明文に `51200`、`2147483647`、`30000` を文字列で書いている。正の値は `OUTPUT_LIMIT`（`format.ts:17`）、`MAX_TIMEOUT` と `DEFAULT_SYNC_WATCHDOG`（`cell.ts:34,37`）にある。同じ差分の `rlm/guidance.ts` は `RLM_MAX_CHILD_DURATION_MS` を埋め込んでいるので、書き方がそろっていない。テスト `description states the new limits` も同じ文字列で照合するため、定数だけを変えても検出できない。
  - 修正先: 実装
  - 推奨: テンプレート文字列で 3 つの定数を埋め込み、テストも定数から期待値を作る。

- **[W-4] ツール選択の基準を 2 か所に別々に書いている**
  - 場所: `packages/spirits/src/tools.ts:40`、`packages/spirits/src/harness/prompt.ts:24`
  - 根拠: design Decision 7 は、方向が食い違わないよう 2 か所を同じ基準にそろえる狙い。ただし文言はそれぞれ手で書いており、結び付けるテストもない。片方だけを直しても検出されない。
  - 修正先: 実装
  - 推奨: `prompt.ts` の行を `TSREPL_PROMPT_GUIDELINES` から組み立てる（harness → shared の依存は ARCH-SPIRITS-LAYER で許可されている）。あるいは、各 guideline の要点が既定プロンプトに含まれることを確かめるテストを足す。

- **[W-5] 別の change の差分が作業ツリーに混ざっている（製品の挙動は変えない）**
  - 場所:
    - `packages/spirits/src/types/pi-coding-agent.d.ts` の `bindExtensions`、`ExtensionBindings`、`getModel`、`modelRuntime`、`noTools`、`sessionStartEvent`
    - `test/rlm-spawn.test.ts`
    - `test/routing-integration.test.ts`
    - `test/routing-register.test.ts`
    - `test/pi-runtime/routing-record-pin.test.ts`
    - `.pi/skills/interactive-testing.md`、`scripts/tmux-verify.sh`、`scripts/tmux-verify.test.sh`
  - 根拠: いずれもこの change の要件・タスク・Decision に紐づかない。前半は dual-model-routing（`add-model-role-setting`）由来。tmux のランナーは `harden-verification-cleanup` 由来（`scripts/tmux-verify.sh:12` がその design を参照し、archive も未追跡で残っている）。
  - 修正先: 実装（コミットの範囲）
  - 推奨: この change のコミットには入れない。`pi-coding-agent.d.ts` は、`CallableToolInfo`、`tools` の型、`createBashTool`、`sessionEntryToContextMessages` のハンクだけをステージする。残りはそれぞれの change のコミットにまとめる。

- **[W-6] continual-harness の 2 シナリオのテストが部分的**
  - 場所: `packages/spirits/test/pi-runtime/system-prompt-defaults.test.ts:20`、`packages/spirits/test/harness-install.test.ts:124`、`packages/spirits/test/harness-prompt.test.ts:60`
  - 根拠:
    - 「既存プロンプトの維持」のテストは、`buildSystemPrompt` に snippet と guidelines を手で渡している。登録したツールの宣言が、セッション開始時に pi から実際に読まれる経路は通らない。
    - 「ルートセッションへの適用」のテストは、セクションに `bash` が含まれることを見ていない（`harness-install`）。また「唯一または最優先」の表現は `/主要な.*実行面/` しか検査しておらず、「最優先」「唯一」を見ていない。
  - 修正先: 実装（テスト）
  - 推奨: `harness-install.test.ts:124` に `expect(...sections["spirits"]).toContain("bash")` を足す。`harness-prompt.test.ts` に `not.toMatch(/最優先|唯一/)` を足す。

- **[W-7] `timeout: Infinity` を未指定と同じに扱っている**
  - 場所: `packages/spirits/src/repl/cell.ts:111`
  - 根拠: spec は「2147483647ms を超える値は 2147483647ms にクランプする」とする。実装は `!Number.isFinite` なので `cellMs` は `undefined` になり、ログの `timeoutMs` は null になる。JSON で `Infinity` は表せないので、モデルからは来ない。プログラムから呼ぶ場合だけの問題。
  - 修正先: 実装 または spec
  - 推奨: `NaN` だけを未指定とし、`Infinity` は `MAX_TIMEOUT` にクランプする。

#### SPEC
なし

#### SUGGESTION
- **[G-1] 空の「Bundled skills」見出しが残っている**
  - 場所: `packages/spirits/src/constants.ts:115-117`
  - 推奨: この 3 行を削除する。
- **[G-2] 一時ファイルを書くときに排他作成の指定がない**
  - 場所: `packages/spirits/src/repl/spill.ts:29`
  - 根拠: `writeFile` は既定の `flag: "w"` で書く。名前は 32bit の乱数なので、共有の `/tmp` に既にあるファイルやシンボリックリンクを上書きし得る。その場合、モード 0600 も適用されない。
  - 推奨: `{ mode: SPILL_FILE_MODE, flag: "wx" }` にする。
- **[G-3] セル全体の timeout は、同期部分が終わってから数え始める**
  - 場所: `packages/spirits/src/repl/cell.ts:210`
  - 根拠: race のタイマーは `runInContext` が戻った後に張る。たとえば timeout 1000 で同期 900ms + 待機 900ms のセルは打ち切られない。この挙動は基点からあり、今回の変更によるものではない。
  - 推奨: 次の change で spec に一文足すか、計測の起点をセルの開始にそろえる。

### verify1 との突き合わせ
- verify1 だけが指摘した項目:
  - W1（`rg "主要な実行面"` が 0 件にならない）: 採るが、修正は不要。残っているのは本仕様 `openspec/specs/continual-harness/spec.md:390` の旧文言で、archive で置き換わる。archive 後に同じ `rg` を再実行すれば足りる。
  - W2（tmux ランナーが未追跡）: 事実は正しい。ただしこの change のものではない（`harden-verification-cleanup` 由来）。この change のコミットに入れる推奨は採らず、W-5 に含めた。
  - G3（d.ts の混在）: W-5 に統合した。
  - G4（`Infinity`）: 採用し、spec の文言どおりでないので W-7 に上げた。
- 両方が指摘した項目: W3（`spill: "saved"`）は W-2、G1（空見出し）は G-1、G2（`bash` の確認なし）は W-6 に含めた。
- verify2 だけが指摘した項目:
  - C-1: verify1 は、例に `exit_code` の文字列があるかを照合しただけで、その値がどのコマンドの終了コードかを追わなかったと推定する。
  - W-1: docs は `rg` の該当行があるかだけを確認し、文意を spec と比べていない。
  - W-3、W-4: 重複の観点が verify1 に無い。
  - G-2、G-3: 横断的な観点（セキュリティ、時間の境界）が verify1 に無い。
- 重大度の食い違い: 「重大なし」と「準備完了」は採らない。C-1 は、例が教える成否判定が実際に誤る具体的な経路があるため CRITICAL とした。

### 次の手順
- FAIL: C-1 を apply で直し、このスキルを再検証モードで実行する。W-1〜W-6 も同じ apply で直すことを推奨する。
