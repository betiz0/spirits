# 検証レポート: align-tsrepl-limits-and-guidance

検証日時: 2026-10-18（verify1、`/opsx-verify`）
スキーマ: `spec-driven`（proposal / specs(3 capability) / design / tasks すべて存在、意図的なスキップなし → 未検証のチェックなし）
REMOVED・RENAMED なし → 正確性のチェックは適用対象。ADDED 8 / MODIFIED 8 の計 16 要件、シナリオ 62 件。

## サマリー

| 観点 | 状態 |
|--------------|--------------|
| 完全性 | 31/31 タスク完了（残り 0）、16 要件すべてに実装の証拠 |
| 正確性 | 16/16 要件をマッピング、シナリオ 62 件中 56 件を専用テストで検証（6 件は実装のみ・間接検証） |
| 一貫性 | design の 8 決定すべてに準拠、pi 上流コアは無変更、軽微な規約問題 2 件 |

## 証拠

- `openspec instructions apply` の `progress`: total 31 / complete 31 / remaining 0（`taskTrackingConfigured: true`、`unavailableTrackingFiles` なし）
- 再実行した検証:
  - `cd packages/spirits && bun test` → 607 pass / 0 fail（61 files、タスク 9.1）
  - `npm run check`（リポジトリルート）→ exit 0（タスク 9.1）
  - `openspec validate align-tsrepl-limits-and-guidance --strict` → 有効（タスク 9.2）
- tasks に列挙された 58 のテスト名はすべて実在することを確認（`rg` でテスト名を照合、欠落 0）。内訳: `hostfns`(4 新規) / `cell`(新規 15・更新 4) / `format`(更新 4・新規 1) / `tools`(新規 11) / `context`(既存 2) / `rlm-depth`(新規 1) / `rlm-hostfn`(新規 6) / `rlm-guidance`(新規 1) / `rlm-cell`(更新 2) / `harness-prompt`(新規 2) / `pi-runtime/system-prompt-defaults`(新規 1 ファイル)
- ドキュメントの検証（タスク 7.1〜7.3）:
  - `docs/spirits-m1-repl.md:53`（timeout 行）・`:67`（`tool()` の契約）・`:68`（出力捕捉と 51200）・`:69`（タイムアウト 2 系統）・`:77`（出力上限と全文ファイル）。`rg -n "120000" docs/spirits-m1-repl.md` → 0 件
  - `docs/spirits-m3-rlm.md:81`（120000ms 上限、`outcome: aborted`、直列化待ちを含まない、完了優先）・`:126`。`rg -n "個別 timeout は設けない"` → 0 件
  - `docs/spirits-m4-harness.md:77`（`promptSnippet` / `promptGuidelines` と子の guidelines 空）・`:85`（基準はツール宣言、例はビルトイン側、上書き時の影響）。`rg -n "極力セル内コード"` → 0 件
- pi 上流コア差分: `git status packages/coding-agent packages/agent packages/ai packages/tui` → クリーン。`src/rlm/spawn.ts` も未変更（design Decision 3 の「境界を変えない」どおり）

## 要件実装マッピング

### tsrepl（MODIFIED 5 / ADDED 7）

| 要件 | 実装 | テスト |
|---|---|---|
| timeout（MODIFIED） | `src/repl/cell.ts:105-115`（`resolveCellTimeouts` / `clampCellTimeout`）、`:210`（race は `cellMs` のときだけタイマー）、`:379-395`（打ち切りメッセージの 3 項目） | `test/cell.test.ts:112,121,134,144,152,158,188`、`test/tools.test.ts:98` |
| 出力上限（MODIFIED） | `src/repl/format.ts:17-19`（51200 / 30720 / 20480）、`:56-63`（`applyOutputLimit`）、`src/repl/cell.ts:252-268`（切り捨て時のみ書き出し＋パス追記）、`src/repl/spill.ts:27-40` | `test/format.test.ts:36,44,53,64,131`、`test/cell.test.ts:313,329,342` |
| tool() によるツール呼び出し（MODIFIED） | `src/repl/hostfns.ts:101-127`（`isError` でも `outputSchema` 宣言 + `structuredContent` なら構造化結果を返す）、`:129-131`（宣言の判定は `toolContext.tools`） | `test/hostfns.test.ts:129,144,152,163,171,182,192,203,229` |
| ツールパラメータと結果（MODIFIED） | `src/tools.ts:45-56`（code / timeout 省略可 / reset / description）、`:132-150`（結果テキスト） | `test/tools.test.ts:28,98,216,231` |
| コンテキストのグローバル（MODIFIED） | `src/repl/context.ts:14-21`（許可リスト不変）、`:55-62`（`_` はホスト側唯一の globalThis 書き込み＝ホストグローバルでない） | `test/context.test.ts:20,29` |
| 同期実行の watchdog（ADDED） | `src/repl/cell.ts:105-115`（`syncMs = min(cellMs ?? 30000, 30000)`）、`:206`（vm に常に `syncMs`）、`:381-393`（同期専用の文言と `await` 分割の提案） | `test/cell.test.ts:144`（5 入力の解決値）、`:168`（timeout 1000 で実際に発火・文言が別） |
| 直前の value の保持（ADDED） | `src/repl/context.ts:60`、`src/repl/cell.ts:213-218`（value を返した成功セルのみ代入） | `test/cell.test.ts:278,288,297,305` |
| ツール一覧と規則への掲載（ADDED） | `src/tools.ts:33-44`（1 行 snippet / 2 項目 guidelines）、`:120-122`、`src/rlm/hostfn.ts:123-127`（子は `promptGuidelines: []`、snippet は残る） | `test/tools.test.ts:49,78` |
| セル実行ログの記録（ADDED） | `src/constants.ts:127`、`src/tools.ts:138-143`（1 セル 1 件、例外は握りつぶす）、`:165`（`registerTsrepl` が `pi` を渡す）、`src/rlm/hostfn.ts:123-127`（子には渡さない） | `test/tools.test.ts:114,160,173,184,207` |
| セル実行ログに中身を含めない（ADDED） | `src/repl/metrics.ts`（文字数と分類のみ）、`src/tools.ts:159-161`（コピーして記録） | `test/tools.test.ts:143` |
| セル実行ログの実行フィールド（ADDED） | `src/repl/metrics.ts:10,26-42`、`src/repl/cell.ts:66-88` | `test/cell.test.ts:201,224` |
| セル実行ログの出力と tool() のフィールド（ADDED） | `src/repl/metrics.ts:13-21,36-41,46-52`、`src/repl/hostfns.ts:75-86`（呼び出し開始時に記録し `threw` を後から立てる） | `test/cell.test.ts:236,266` |

### rlm（MODIFIED 2 / ADDED 1）

| 要件 | 実装 | テスト |
|---|---|---|
| rlm の制約の案内（MODIFIED） | `src/rlm/guidance.ts:50-52`（直列・実行時間上限 120000 と例外・深度・子のツール呼び出し上限）、`:51`（指定したセル timeout も子に適用） | `test/rlm-guidance.test.ts:5,16` |
| 深度と登録状況に応じた案内（MODIFIED） | `src/rlm/guidance.ts:26-40`（深度上限到達時は使用例なし・呼べない旨のみ、`depth >= 1` で子向け） | `test/rlm-cell.test.ts:81,88` |
| rlm 呼び出しの実行時間上限（ADDED） | `src/rlm/depth.ts:18`、`src/rlm/hostfn.ts:120`（`waitTurn` 後にタイマー開始）、`:129-152`（`AbortSignal.any`、完了優先、`aborted` 記録と例外）、`:178-201` | `test/rlm-depth.test.ts:17`、`test/rlm-hostfn.test.ts:384,503,521,535,550,567,585` |

### continual-harness（MODIFIED 1）

| 要件 | 実装 | テスト |
|---|---|---|
| code-mode プロンプトの適用（MODIFIED） | `src/harness/prompt.ts:24`（ツール選択の基準。旧「主要な実行面」は削除）、`:25-26`（`_` と `exit_code`）、`:27-40`（検索・JSON・テストの 3 例、コード例 12 行） | `test/harness-prompt.test.ts:47,54,63`、`test/pi-runtime/system-prompt-defaults.test.ts:20`（`<tools>` に bash と tsrepl、`<rules>` に pi 既定の bash 規則の残存） |

## 設計の遵守

- **Decision 1**（`tool()` は宣言された構造化結果をエラー扱いでも返す）: `hostfns.ts:116` が `structured !== undefined && declaresOutputSchema(...)`。成功時は従来契約（宣言を見ずに構造化結果を優先）を維持。pi の `outputSchema` ゲートは不採用。準拠
- **Decision 2**（timeout を 2 つに分ける）: `resolveCellTimeouts` の式は design の `min(cellMs ?? 30000, 30000)` と一致。vm に `syncMs`、race に `cellMs`、単位は ms のまま。`ERR_SCRIPT_EXECUTION_TIMEOUT` / `TimeoutError` の判別（`cell.ts:360-377`）でメッセージを分離し、両者に 3 項目を残す。準拠
- **Decision 3**（上限は hostfn が持ち、例外で知らせる）: 定数は `depth.ts:18`、`AbortSignal.any([caller, timer])` は `hostfn.ts:185`。`spawn.ts` は無変更で `outcome` の意味も 4 値のまま、部分テキストも添えない。注入値は `maxChildDurationMs` のみで製品コードは既定値しか渡さない。準拠
- **Decision 4**（51200 と全文の一時ファイル）: `applyOutputLimit` が同期で `raw` と切り捨て情報を返し、`Repl.#spillFormatted`（async）が書いてからパスを追記。保存先は `os.tmpdir()/spirits-tsrepl-<hex>.txt`・モード 0600・削除なし、書き出し先は `ReplOptions.writeOutput` で注入可能。pi の `writeOutputFile` は使わず spirits 側に小さなヘルパのみ。準拠
- **Decision 5**（`_` はホスト側から代入）: `context.ts:60` の `setUnderscore`。tasks 4.1 が要求した「ホスト側代入が後続セルから読めるか」は `test/cell.test.ts:278` が実際に読み返して裏付けており、IIFE 内代入への切替は不要だった。`reset` はコンテキスト再生成で自然に消える（`:305`）。準拠
- **Decision 6**（掲載はツール宣言、子は規則を載せない）: snippet は常に宣言、guidelines は上書き引数（呼び出し元は `rlm/hostfn.ts` の 1 か所）。bash の有無の判定は持たない。pi 既定の「Use bash for file operations...」は消していない（pi コア無変更）。準拠
- **Decision 7**（例はビルトイン、基準は宣言）: 3 例はいずれも `exit_code` を確認して値を小さく返す形で、空行を除く 12 行（上限 15）。docs の骨格 1 と continual-harness の箇条も同じ change で更新済み。準拠
- **Decision 8**（集計スクリプトではなくログ）: `pi: Pick<ExtensionAPI, "appendEntry">` を生成オプションで受け、`registerTsrepl` のみ渡す。`Repl.run` が計測値を添えて返し、`tool()` の記録は `HostFnScope.recordToolCall` 経由。`scripts/` に集計スクリプトは追加していない（tasks 8.3 のスコープどおり）。準拠

## シナリオカバレッジの限界（6 シナリオ）

- `セル実行ログの出力と tool() のフィールド / 切り捨ての記録`: `truncated` 真は検証済み（`test/cell.test.ts:266`）だが `spill` が `saved` のアサートがない（`failed` と null のみ）。→ 警告 3
- `同期実行の watchdog / timeout 未指定でも watchdog が掛かる`・`大きい timeout でも watchdog は 30000ms`: 30 秒を待つ実行時テストはない。`resolveCellTimeouts` の解決値（`:144`）と `timeout: 1000` での実発火（`:168`）、vm に常に `syncMs` を渡す実装（`cell.ts:206`）で間接担保
- `出力上限 / 上限ちょうど`: `format.ts` 層の `truncate keeps head and tail ratio`（`:53`）で検証。セル実行でちょうど 51200 文字を作るケースはない
- `rlm 呼び出しの実行時間上限 / 上限内での完了`: 専用の一本はなく、`does not count queue wait toward the limit`（`:550`）と `completion wins over a fired limit timer`（`:535`）が同じ完了経路を通る
- `continual-harness / ルートセッションへの適用`: `bash` の含有と「唯一または最優先の実行面」の否定は `test/harness-prompt.test.ts:54`（spirits セクションではなくプロンプト全体に対して）。`test/harness-install.test.ts:124` は `tsrepl` のみ。→ 提案 2

## 重大

なし。

## 警告

1. **タスク 6.3 の検証コマンドが現状 0 件にならない** — `rg -n "主要な実行面" packages/spirits openspec/specs docs` が `openspec/specs/continual-harness/spec.md:390` で 1 件返す。実装側は書き換え済み（`src/harness/prompt.ts:24`、`test/harness-prompt.test.ts:54`）で、残るのは本仕様側の旧文言（この change の MODIFIED が置換する側）。タスクは完了マークされているが、コマンドの合格はアーカイブ（または sync）の後に成立つ。
   - 推奨: archive 後に同じ `rg` を再実行して 0 件を確認し、旧文言が消えたことを `openspec/specs/continual-harness/spec.md` で見届ける。
2. **タスク 9.3 の検証ランナーがリポジトリに残らない** — `.pi/skills/interactive-testing.md` に検証ランナーの説明が 83 行追加されている（openspec CLI 由来の `.pi/prompts/*`・`.pi/skills/openspec-*` の再生成とは別），それが参照する `scripts/tmux-verify.sh` と `scripts/tmux-verify.test.sh` は未追跡。コミットしないとスキルが実在しないスクリプトへ次のセッションを誘導する。
   - 推奨: 両スクリプトを `git add scripts/tmux-verify.sh scripts/tmux-verify.test.sh` で明示ステージするか、スキル側の追記を本変更の範囲外として戻す。どちらにするか決めてからコミットする。
3. **`spill: "saved"` を検証しているテストがない** — 要件「セル実行ログの出力と tool() のフィールド」のシナリオ「切り捨ての記録」は `spill` が `saved` になることを要求するが、テストは `failed`（`test/cell.test.ts:274`）と `null`（`:213`）のみで、既定ライタ経由の `saved` を一度もアサートしていない。
   - 推奨: `test/cell.test.ts:313` の `truncated output is spilled to a temp file`（既定ライタを使う）に `expect(result.metrics.spill).toBe("saved")` を追加する。

## 提案

1. **`src/constants.ts:115-117` に空のセクション見出しが残る** — 「Bundled skills」バナーが `TSREPL_CELL_ENTRY_TYPE` の直前に残り、正しい見出しは `:126-128` に再設置されている。`:115-117` を削除する。
2. **タスク 6.5 の新ケースが別ファイルにある** — `system prompt keeps default tools and rules` は `test/pi-runtime/system-prompt-defaults.test.ts`（pi の `buildSystemPrompt` を呼ぶため subpath 解決が必要な場所。理由妥当）。ただし `test/harness-install.test.ts:124` は spirits セクションの `tsrepl` しか見ておらず、タスク 6.5 が挙げていた `bash` の確認がない。同テストへ `expect(...sections["spirits"]).toContain("bash")` を 1 行追加する。
3. **型宣言ファイルが別セッションの変更と同一ファイル** — `src/types/pi-coding-agent.d.ts` / `pi-subpaths.d.ts` に、本変更が必要とする `CallableToolInfo`・`createBashTool`・`sessionEntryToContextMessages`・`core/system-prompt` subpath と、routing 系ピンのための `bindExtensions` / `getModel` / `noTools` / `sessionStartEvent` / theme 宣言が混在する。コミット時は本変更相当のハンクだけをステージする（`git add -p` など）。
4. **`timeout` に `Infinity` を渡すと未指定として扱う** — `clampCellTimeout`（`cell.ts:117-122`）は `!Number.isFinite` で `undefined` を返す。仕様は「省略」と「指定値のクランプ」しか定めておらず、`Infinity` の扱いは未規定。既存のクランプ方針（不正値で失敗させない）とは整合するが、`timeoutMs: null` として記録される。必要なら次の変更で要件に一句追記する。

## アーカイブ時の注意

- `openspec/specs/continual-harness/spec.md:390` の旧文言は delta 前のまま（意図どおり。archive の同期対象）。同期が済むまで警告 1 は消えない。
- ワークツリーには本変更外の未コミット変更が混在する（`packages/spirits/src/types/*.d.ts`、`packages/spirits/test/{routing-integration,routing-register,rlm-spawn}.test.ts`、`test/pi-runtime/routing-record-pin.test.ts`、`.pi/prompts/*`、`.pi/skills/openspec-*`、README 4 言語、`bun.lock`、`openspec/changes/archive/*` 3 件と本仕様の未追跡 3 ディレクトリ、`scratch-ag/`、直下の `sprt-opsx-*.SKILL.md`）。
- 本変更でコミット対象になるのは `packages/spirits/src/{constants.ts,tools.ts,harness/prompt.ts,repl/{cell,context,format,hostfns,registry}.ts,repl/metrics.ts(新規),repl/spill.ts(新規),rlm/{depth,guidance,hostfn}.ts}`、`packages/spirits/test/{cell,format,hostfns,tools,registry,rlm-cell,rlm-depth,rlm-guidance,rlm-hostfn,harness-prompt}.test.ts`、`test/support.ts`、`test/pi-runtime/system-prompt-defaults.test.ts(新規)`、`docs/spirits-m{1,3,4}-*.md`、変更ディレクトリ、および警告 2 で残すなら `scripts/tmux-verify*.sh` と `.pi/skills/interactive-testing.md`。

## 最終評価

重大な問題なし。警告 3 件（タスク 6.3 の rg が本仕様側の残りで 0 件にならない / 9.3 の検証ランナーが未追跡 / `spill: "saved"` の未アサート）、提案 4 件。スキップしたチェックなし。**アーカイブの準備ができました（改善点が指摘されています）。**
