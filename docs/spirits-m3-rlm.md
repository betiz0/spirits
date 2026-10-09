# spirits M3 設計書: rlm(同期再帰エージェント)

- フェーズ: M3 / 版 v1.1 / 2026-10-08
- 前提文書: spirits 設計書 v0.4(§4.3)、M1 設計書
- 実装確定: `openspec/changes/add-rlm/`(proposal / design / specs / tasks)
- SDK 検証: `docs/spikes/sdk-agent-session.md`

## 1. 目的

REPL セル内から子エージェントを同期的に起動できる `rlm()` を実装し、RLM 的な「コードからの再帰呼び出し」を成立させる。

## 2. 依存関係ルール

**許可:**

- M1 の HostFnRegistry(rlm をここに登録する)。登録の配線とツール説明の合成に限り `src/tools.ts` の `hostFns` オプションを変更し、`repl/` コアのレジストリ方式は変えない
- Pi SDK の `createAgentSession()` 関連 API(実行時の import は `src/rlm/tsconfig.json` で root の `paths` を使って解決する)
- M2 の配布基盤(テストをコンパイルバイナリ上でも回すことは可)

**禁止:**

- M4 の harness(memory/skill)を子セッションへ自動配線しない。M3 の子セッションは「親と同じ tsrepl + 深度+1」だけを持つ素朴なもの。memory 注入の要不要は M4 で判断する
- M5 の非同期 fan-out を見越した公開 API にしない(戻り値は最終回答の文字列のみ。handle 型を乱さないため)

## 3. スコープ

やる:

- `rlm/spawn.ts`: `createAgentSession()` ラッパ(子セッション生成・prompt 投入・最終回答取得・usage 取得・abort 伝播・ツール呼び出し上限)
- `rlm/depth.ts`: 深度の伝播と上限のクランプ、ツール呼び出し予算の判定
- `rlm/guidance.ts`: モデル向けの案内文
- `rlm/hostfn.ts`: 引数検証、深度・モデル判定、直列化、`rlm_usage` の記録
- `rlm()` ホスト関数の Registry 登録(M1 の `hostFns` 拡張点経由。`description` はツール説明へ合成する)
- コスト・トークン集計の親への伝播(`pi.appendEntry` による `rlm_usage` 記録)
- 中断連鎖: 親セッション中断時に active な子セッションへ abort を伝播

やらない:

- 非同期 fan-out / ハンドル返却 / `agent_message`(M5 採否対象)
- 子セッションへの memory/skill 注入(M4)
- 子セッションのモデル変更多態(親継承のみ。opt は M5 以降)

## 4. 設計

### rlm(prompt, opts?)

シグネチャ: `rlm(prompt: string, opts?: { maxDepth?: number }): Promise<string>`

内部動作:

1. 引数を検証する(prompt は空白でない文字列、opts は `maxDepth` だけを持つオブジェクト、`maxDepth` は有限の非負整数)。違反は子を生成せず例外
2. 現在深度 d と適用中の上限 L を判定し、`d >= L` なら上限値を含むガイダンス付きの例外(「問題を分割せず、この層で処理せよ」)
3. 親の `ctx.model` が未設定なら例外
4. 同じ REPL の先行呼び出しを待つ(直列化。待機中の abort は子を生成せず中断旨で終了)
5. `createAgentSession()` で子セッション生成:
   - `SessionManager.inMemory(cwd)` で子を**インメモリ**とし、セッション一覧に残さない
   - モデル(親に thinking level があればそれも)を継承し、cwd を共有する
   - ツール構成は `tsrepl`(深度+1 で Registry 登録された REPL)のみ。親の REPL 変数は**引き継がない**(コンテキスト分離。Prime Agent の「子は Python 状態にアクセスできない」設計に準拠)
   - 拡張・skill・プロンプトテンプレートを読み込まず、AGENTS.md などのコンテキストファイルは読み込む
   - 認証は親と同じエージェントディレクトリの認証情報・モデル定義と環境変数に限る。`--api-key` と拡張が登録したプロバイダは継承しない
6. prompt を投入し完了を await(同期)。子の最終アシスタントメッセージを返却
7. 呼び出しごとに `rlm_usage` カスタムエントリを 1 件、ルートセッションへ記録
8. 親の abort シグナルを子に接続し、abort の完了を待ってから子を破棄(dispose)する

### 深度伝播の方式

深度と上限は `createRlmHostFn` の**クロージャ**に保持し、`HostFnEntry.description` に `buildRlmGuidance` の案内文を設定する。子セッションの tsrepl を登録する際に「親深度+1」と子の上限を焼き込む。モデルから深度を書き換えられる経路は作らない。

`opts.maxDepth` はルートからの絶対深度として扱い、呼び出し側に適用されている上限より大きい値は上限へ**クランプ**する(エラーにしない)。ルートの上限は 2 で固定し、M3 は変更手段を提供しない。

### 直列化

`createRlmHostFn` のクロージャに Promise キューを 1 本持ち、同じ REPL(同じインスタンス)からの `rlm` 呼び出しを 1 つずつ**直列**に実行する。深度の異なるセッションのキューは共有せず、親の `rlm` が子の完了を待つ間に子の `rlm` が孫を起動してもデッドロックしない。待機中の呼び出しは `scope.signal` の abort で子を生成せず、中断旨の文字列で resolve する。

### 子セッションの中断

親セルの `scope.signal` を `spawn` に渡し、abort 時に実行中の子へ `session.abort()` を呼ぶ。`abort()` の完了を待ってから `dispose()` する。セルの timeout も同じシグナルへ合成されるため、子の実行時間にも適用される。中断時のセルの結果は tsrepl の既存の中断・timeout のエラーに従う。

### タイムアウトとコスト上限

- 子セッションに個別 timeout は設けない(中断はユーザ操作/セル timeout に委譲)
- 1 rlm 呼び出しあたりの子のモデル発行ツール呼び出し回数を `RLM_MAX_TOOL_CALLS`(既定 50)で制限する。`parentToolCallId` を持たない `tool_execution_start` だけを数え、51 回目で子を abort して、上限超過の旨と部分テキストを途中結果サマリとして返す

### コスト・トークン集計

`rlm` の呼び出し 1 回につき `rlm_usage` カスタムエントリを 1 件、ルートセッションへ記録する。フィールドは `depth`(子の深度。呼び出し側 +1)、`sessionId`、`provider`、`modelId`、`tokens`(input / output / cacheRead / cacheWrite / total)、`cost`、`durationMs`(呼び出し開始から戻るまで。直列化の待機を含む)、`outcome`(`completed` / `aborted` / `budget` / `error`)。子を生成しなかった呼び出しも `error` または `aborted` として記録する。

集計規約は「ルートセッション自身の usage + そのセッションの JSONL にある全 `rlm_usage`」。子は**インメモリ**で自身の usage だけを含むため二重計上は起きない。`rlm_usage` は LLM コンテキストへ送らない。

## 5. SDK 検証タスク(M3 冒頭で実施)

`docs/spikes/sdk-agent-session.md` に、Bun 1.4.2 + 実プロバイダで次を確認して記録した(すべて成功。Pi 上流コアへの変更は不要)。

1. 拡張内から子 AgentSession を生成し、custom tsrepl を登録して prompt を実行できる
2. 子の usage を `getSessionStats()` で取得できる
3. `session.abort()` で実行中の子を止められる
4. `src/rlm/tsconfig.json` により、pi 実行時 import が `bun test`・ソース起動・`-e` 起動で解決できる
5. `noExtensions` / `noSkills` / `noPromptTemplates` のローダーでも custom tsrepl が有効で、コンテキストファイルが読み込まれる
6. `pi.appendEntry` のカスタムエントリがメッセージ列に含まれない

## 6. テスト計画

| # | ケース | 期待 | 対応 |
|---|---|---|---|
| 1 | `await rlm("2+3は?")` | 子の最終回答が文字列で返る | `test/rlm-cell.test.ts` / `test/rlm-hostfn.test.ts` |
| 2 | 深度 2 のセッションが `rlm` を呼ぶ | 上限 2 を含む深度エラー + ガイダンス | `test/rlm-hostfn.test.ts` |
| 3 | 子から親 REPL の変数を参照 | 不可(未定義エラー)であること | `test/rlm-hostfn.test.ts` |
| 4 | 子セッションの usage 記録 | `rlm_usage` エントリがルート JSONL に存在 | `test/rlm-hostfn.test.ts` |
| 5 | 子実行中に親を中断 | 子も中断し、セルは tsrepl の中断エラー | `test/rlm-spawn.test.ts` / `test/rlm-cell.test.ts` |
| 6 | ツール呼び出し回数上限超過 | 打ち切り + 途中サマリ返却 | `test/rlm-spawn.test.ts` |
| 7 | 引数検証と `opts.maxDepth` のクランプ | 子を生成せず例外 / 子の上限が継承値以下 | `test/rlm-depth.test.ts` / `test/rlm-hostfn.test.ts` |
| 8 | 直列化 | `Promise.all` でも子は同時に 1 つ | `test/rlm-hostfn.test.ts` |
| 9 | interactive smoke(完了条件) | 実プロバイダで再帰・中断・timeout・usage を確認 | `.pi/skills/interactive-testing.md` |

## 7. 完了条件

- REPL 内で `rlm()` による再帰呼び出しが安定動作(深度 2 までの入れ子を含む)
- 上記テスト全件パス
- `bun test` と `bun run check` が成功し、`openspec validate add-rlm --strict` が成功する

## 8. リスク

- **SDK API の変動**(上流は活発開発中)→ spawn.ts を薄いラッパに集中させ、API 差分の吸収を 1 ファイルに限定
- **子セッションのコスト錯綜**: 親子で同時に課金計上され二重計上に見える可能性 → `rlm_usage` に `depth` を含め、「ルートセッション自身の usage + 全 `rlm_usage`」を集計規約として README 化
- **直列化による待ち時間の合計**: 複数の `rlm` を呼ぶセルで timeout に達しやすい → 案内文に「直列で待ち時間が合計される」と明記
- **子の 1 ターンが長い場合**: 既定 timeout 30000ms で足りない可能性 → 案内文と README に `timeout` の拡大(最大 120000ms)を記載
