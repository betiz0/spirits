# Design

## Context

M1 の `packages/spirits` は `tsrepl` ツールを 1 つ持ち、`HostFnRegistry` でホスト関数を公開する。`createTsreplTool`(`src/tools.ts`)が `new HostFnRegistry(createBuiltinHostFns())` と `Repl` を内部で生成するため、追加のホスト関数を差し込む口がない。`src/index.ts` は `registerTsrepl(pi)` を呼ぶだけ。ツール説明は固定文字列 `TSREPL_DESCRIPTION` で、`HostFnEntry.description` はどこからも読まれていない。

M3 が依存する上流 API は次のとおり(コード参照)。

- `createAgentSession(options)` は `packages/coding-agent/src/core/sdk.ts:175` にあり、`packages/coding-agent/src/index.ts:257` から公開されている。`model` / `thinkingLevel` / `cwd` / `agentDir` / `tools` / `customTools` / `resourceLoader` / `settingsManager` / `sessionManager` を受け取る。`customTools` はローダーとは独立に `AgentSession` へ渡される(`sdk.ts:444`)。モデルと認証は `modelRuntime` 省略時に新規生成される(`sdk.ts:180-182`)。
- `DefaultResourceLoader`(`index.ts:244`)は `noExtensions` / `noSkills` / `noPromptTemplates` / `noContextFiles` を受け取る(`resource-loader.ts:275-306`)。`getAgentDir` と `SettingsManager` も公開されている(`index.ts:8`、`:315`)。
- `AgentSession` は `prompt`(`agent-session.ts:1921`)、`abort`(`:2387`)、`waitForIdle`(`:2399`)、`getLastAssistantText`(`:4297`)、`getSessionStats`(`:4134`)、`subscribe`(`:1339`)、`dispose`(`:1363`)、`messages`(`:1584`)、`sessionId`(`:1604`)を持つ。usage は `SessionStats.tokens` / `.cost` で取得できる。
- プロバイダエラーでは `prompt()` は reject せず、最終アシスタントメッセージの `stopReason` が `error`、`errorMessage` に原因が入る(`modes/print-mode.ts:141-147` が同じ判定をしている)。`getLastAssistantText()` は本文の無いメッセージに対して空文字列を返す。
- `SessionManager.inMemory(cwd)` は `session-manager.ts:1804`。`AgentSessionEvent` に `tool_execution_start`(`toolCallId` / `toolName` / `args`)が含まれ、`ctx.executeTool` 経由の入れ子呼び出しは `parentToolCallId` を伴う。
- `ExtensionAPI.appendEntry(customType, data)` は `extensions/types.ts:1692`(LLM へ送らないカスタムエントリ)。`ExtensionToolContext`(ツール実行時の `ctx`)には `cwd` / `signal` / `model` / `thinkingLevel?` があるが `appendEntry` はない。`ExtensionAPI` は拡張セットアップ時に受け取る `pi`。
- セルの `scope.signal` は、呼び出し元のツール中断とセルの timeout を合成したシグナルで、セル終了時にも abort される(`repl/registry.ts`、`repl/cell.ts`)。

実行時 import の解決は M3 で新たに問題になる。`packages/spirits/tsconfig.json` の `paths` は `@earendil-works/pi-coding-agent` を型ミラー `.d.ts` へ向け、`node_modules` 側のパッケージは `dist` が無い。M2 スパイク(`docs/spikes/compiled-extensions.md`、試行表の「指定なし」行)では、この状態の素の `bun` 実行が `Cannot find module` で失敗した。仮想モジュール経路が効くのは拡張ローダが読み込む拡張だけで、組み込み spirits を `bin/spirits.ts` から静的 import する経路では効かない。M1 までは型 import のみで、この問題が表に出なかった。

設計の一次根拠は `docs/spirits-design.md`(§4.3)と `docs/spirits-m3-rlm.md`。モデルへの使い方の案内は `docs/prime-agent-rlm-instruction.md` を参照して TypeScript 向けに改修する。本ドキュメントは、これらの決定を実装へ落とす際の判断と、これらから変えた点だけを扱う。

## Goals / Non-Goals

**Goals:**

- `rlm` の登録経路、子セッション生成、深度伝播、abort 伝播、直列化、usage 記録、モデルへの案内の方式を確定する。
- 実 SDK を呼ぶ `spawn` とテスト可能な `rlm` ホスト関数を分離し、深さ・上限・中断・直列化のロジックを実 LLM なしで固定できる境界を決める。
- pi の実行時 import を `bun test`・開発時起動・コンパイルバイナリの 3 形態で解決する方式を決める。
- SDK 検証(子セッション生成、usage 取得、abort、実行時解決)の位置づけと、失敗時の分岐を決める。

**Non-Goals:**

- M4 の memory / skill 注入、M5 の非同期 fan-out / ハンドル返却。
- 子セッションのモデル変更多態、子セッション個別 timeout、子セッションの永続化。
- `--api-key` で与えた認証や拡張が登録したプロバイダの子セッションへの継承(コアへの `[spirits]` パッチが要るため)。
- リポジトリ全体のバックエンド集計ツール(コストダッシュボード等)。

## Decisions

### 1. 登録経路: `createTsreplTool` に追加ホスト関数を渡し、説明をツール説明へ合成する

`CreateTsreplToolOptions` に `hostFns?: readonly HostFnEntry[]` を追加し、`createTsreplTool` は `new HostFnRegistry(createBuiltinHostFns())` の後に `hostFns` を `register` する。あわせて、`hostFns` の各エントリの `description` を、`TSREPL_DESCRIPTION` の後ろに空行区切りで連結したものをツール説明とする(組込関数の説明は `TSREPL_DESCRIPTION` に既にあるため連結しない)。`hostFns` が空または未指定なら説明は `TSREPL_DESCRIPTION` と同一になる。`registerTsrepl` はオプションをそのまま引き渡す。`src/index.ts` が `rlm` エントリを渡す。

- 選択肢: `HostFnRegistry` を `index.ts` で生成し、`Repl` を直接組み立てる。
- 理由: `Repl` と `ReplContext` は `createTsreplTool` が所有しており、組み立てを外へ出すと M1 のツール定義(説明文、スキーマ、dev ログ)を複製することになるため却下。
- 選択肢: `createTsreplTool` を変更せず、`rlm` を別ツールとして `pi.registerTool` する。
- 理由: `rlm` は REPL セルから呼ぶ関数であり、モデルに公開する別ツールではないため却下。
- 選択肢: `HostFnEntry` に案内用の専用フィールド(`guidance` など)を足す。
- 理由: `repl/registry.ts`(REPL コア)の変更になる。既存の `description` フィールドは未使用で、そのまま案内文の置き場にできるため却下。
- 選択肢: ツールの `promptGuidelines` で案内する。
- 理由: system prompt の共通ガイドライン節に置かれ、`tool()` など tsrepl 内の関数の説明と離れる。案内の対象は tsrepl の中の関数なので、ツール説明の本文に置く方が読み手に近いため却下。
- 補足: 変更は `src/tools.ts` と `src/index.ts` に閉じ、`repl/` コア(`registry.ts` / `context.ts` / `cell.ts`)は変更しない。`docs/spirits-m3-rlm.md` §2 の「M1 コアのコード変更は不要」は、レジストリ方式と `repl/` コアを指す。登録の配線とツール説明の合成に限り `tools.ts` を変える(「設計書からの変更点」参照)。

### 2. 子セッションは `createAgentSession` + インメモリセッション + 絞ったリソースローダー

`rlm/spawn.ts` が `createAgentSession` を次のオプションで呼ぶ。

- `cwd`: 親 `ctx.cwd`(ファイルシステム共有。設計書 §4.3)
- `model`: 親 `ctx.model`(継承)。`undefined` なら子を生成せず、モデル未設定を示す例外とする
- `thinkingLevel`: 親 `ctx.thinkingLevel` が設定されていれば渡す。未設定なら渡さない
- `customTools`: 呼び出し側(`hostfn.ts`)が作った深度 +1 の `tsrepl`(`[childTool]`)
- `tools`: `["tsrepl"]`(子の有効ツールは `tsrepl` だけ)
- `sessionManager`: `SessionManager.inMemory(cwd)`(子は永続化しない)
- `settingsManager`: 渡さない。`DefaultResourceLoader` と `createAgentSession` がそれぞれ既定の `SettingsManager.create(cwd, agentDir)` を作る。どちらの `agentDir` も `getAgentDir()` に行き着き(`sdk.ts:136-138`、`config.ts:566`)、同じ設定ファイルを読む
- `resourceLoader`: `new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true })`。`reload()` を呼んでから渡す。`noContextFiles` は指定しない(AGENTS.md などは子にも渡る)

`agentDir` は `getAgentDir()`(`PI_CODING_AGENT_DIR` / `~/.pi/agent`)で、親と同じ解決経路を通る。`modelRuntime` は渡さないため、子の認証は「エージェントディレクトリの auth.json / models.json と環境変数」に限られる。親に `--api-key` で与えた認証(親の `ModelRuntime` にだけ設定される。`main.ts:834`)と拡張が登録したプロバイダは子に引き継がれない。これは M3 の制約として spec と README に明記する。親の `ModelRuntime` を渡すには上流内部への `[spirits]` パッチが要り、「Pi 上流コアへの差分なし」が崩れるため採らない。子完了後は `finally` で `session.dispose()` する。

- 選択肢: 子セッションを永続化する(`SessionManager.create`)。
- 理由: 再帰の各段がユーザのセッション一覧に現れ、usage が親子のファイルに二重に残る。子を残す必要がないため却下。
- 選択肢: 親の `resourceLoader` を子へ渡して reload を避ける。
- 理由: `ExtensionToolContext` から親のローダーを取得する公開 API がなく、上流内部へ踏み込むため却下。
- 選択肢: 既定の `DefaultResourceLoader` のまま、すべてのリソースを子に読み込ませる。
- 理由: 外部拡張が `rlm` 呼び出しのたびに読み込まれて副作用を起こし、M4 導入後は skill が子の system prompt に自動で入って spec の「自動配線しない」(MUST)と衝突しうるため却下。
- 選択肢: `noContextFiles` も指定して子を最小構成にする。
- 理由: 子がプロジェクトの規約(AGENTS.md)を知らずに作業し、親と食い違うため却下。
- 選択肢: `noExtensions` が `customTools` まで落とす可能性に備えて、子の `tsrepl` を拡張として登録する。
- 理由: `customTools` はローダーと独立に渡される(`sdk.ts:444`)ため不要。スパイクで確認する(Decision 12)。
- 選択肢: 1 つの `SettingsManager` を作り、ローダーと `createAgentSession` に共有する。
- 理由: 両者は同じ `cwd`・`agentDir` から同じ設定ファイルを読むため挙動の差が無い。`SpawnSdk` に `SettingsManager` のファクトリを足し、同一性をテストで固定する費用に見合わないため却下。

### 3. 子の失敗は最終メッセージの `stopReason` で判定する

`spawn.ts` は `await session.prompt(prompt)` の後、`session.messages` の末尾のアシスタントメッセージを調べる。`stopReason` が `error` なら `errorMessage` を原因とする `error` 結果にする。`stopReason` が `aborted` で、`spawn.ts` が abort を要求していない場合も、予期しない中断として `error` 結果にする。それ以外なら `getLastAssistantText()` を最終回答とする。`prompt()` や `createAgentSession()` が例外を投げた場合も `error` 結果にし、`hostfn.ts` が原因を含む例外としてセルに投げる。

- 選択肢: `getLastAssistantText()` の戻り値だけを信じる。
- 理由: プロバイダエラーで空文字列が返り、失敗が成功として見えるため却下。

### 4. `rlm` の公開は追加ツールではなくホスト関数

`createRlmHostFn` は `HostFnEntry`(`name: "rlm"`、`description` は Decision 14 の案内文)を返し、`create(scope)` が非公開の深度・上限を閉じ込めた async 関数を返す。子の tsrepl にも同じ経路で `rlm` を登録する(深度 +1)。

- 選択肢: `rlm` を codemode / direct ツールとして登録する。
- 理由: REPL セル内の式として呼ぶ契約(設計書 §4.1 のホスト関数表)に反し、`await rlm(...)` がセルから書けなくなるため却下。

### 5. 深度はクロージャの内部値、`maxDepth` は引き下げのみ、引数は検証する

`createRlmHostFn` は `depth` と `maxDepth` を引数で受け取り、`HostFnEntry.create` のクロージャに閉じる。`rlm` 呼び出しは次の順に処理する。

1. 引数の検証(prompt は空白でない文字列、opts は省略またはキーが `maxDepth` だけのオブジェクト、`maxDepth` は有限の非負整数)。違反は例外
2. `depth >= maxDepth` なら、上限値を含むガイダンス付きの例外
3. 親 `ctx.model` が無ければ例外
4. 直列化の待機(Decision 6)
5. 子の上限 `childMax = opts.maxDepth !== undefined ? Math.min(maxDepth, opts.maxDepth) : maxDepth` で `spawn` を呼ぶ

1〜3 は子を生成せず、待機もしない。いずれの結果も `rlm_usage` に記録する(Decision 9)。ルートの上限は `DEFAULT_MAX_DEPTH = 2` で固定する。`opts.maxDepth` はルートからの絶対深度の上限として扱う。

- 選択肢: 深度を `globalThis` の内部シンボルか REPL コンテキストに置く。
- 理由: モデルが `globalThis` に代入できるため改竄経路になる。クロージャなら REPL コンテキストから書き換えられないため却下(設計書 M3 §4「モデルから深度を書き換えられる経路は作らない」)。
- 選択肢: `opts.maxDepth` が継承値を超える場合はエラーにする。
- 理由: 仕様は「継承値を超えてはならない」とし、値の丸めで満たせる。エラーにすると、モデルが上限を意識せず指定しただけでセルが失敗するため却下(クランプを採用)。
- 選択肢: 不正な引数を補正する(非有限なら継承値、負値なら 0、`String()` で prompt を変換)。
- 理由: `Math.min(2, NaN)` は NaN になり、`depth >= NaN` が常に false で深度上限が無効になる。補正は誤用を黙って通し、検証もしにくいため却下(例外を採用)。

### 6. `rlm` の呼び出しは REPL ごとに直列化する

`createRlmHostFn` のクロージャに Promise チェーン(キュー)を 1 本持ち、`rlm` の呼び出しはこのキューで 1 つずつ実行する。キューは `createRlmHostFn` のインスタンス(= 1 つの tsrepl = 1 つの REPL)ごとに持ち、セルをまたいで共有する。深度の異なる REPL のキューは共有しない。待機中の呼び出しは、`scope.signal` が abort された時点で、子を生成せずに終了する(`outcome: "aborted"`)。キューから取り出した時点で `signal.aborted` なら、同じく子を生成しない。

- 選択肢: 並行呼び出しを許可する。
- 理由: `Promise.all` で複数の子が cwd を共有して同時に書き込み、競合する。M5 の「並列が必要だったか」の判断材料が M3 の時点で変わる。利用者の判断により却下。
- 選択肢: 実行中の呼び出しがある間の新しい呼び出しを例外にする。
- 理由: `Promise.all([rlm(a), rlm(b)])` という自然な書き方がエラーになる。利用者の判断により却下。
- 選択肢: キューを全深度で共有する。
- 理由: 親の `rlm` が子の完了を待つ間、子の `rlm` が孫を起動できずデッドロックするため却下。

### 7. abort は `spawn` がシグナルのリスナーで子へ伝播する

`hostfn.ts` は `scope.signal` を `spawn` に渡す。`spawn` は `signal` に `abort` リスナーを付け、発火時に実行中の子 `session.abort()` を呼ぶ。`session.prompt()` の待機は中断で終わる。中断時は `await session.abort()` してから `dispose()` する。リスナーは完了時に必ず除去する。`signal` は呼び出し元のツール中断とセルの timeout を合成したものなので、timeout でも子は止まる。

生成中の abort を取りこぼさない。問題: リスナーは子セッションの生成後にしか付けられないため、`reload()` と `createAgentSession` の間に届いた abort は見えない。さらに idle のセッションへの `session.abort()` は何も止めないため、生成後に abort 済みのシグナルを見つけて `abort()` を呼んでも、続く `prompt()` が最後まで走る。例: 生成中にセルの timeout が来ると、子は親が中断された後も最大 50 回のツール呼び出しを実行し、直列化キューも占有する。解決: `spawn` は `reload()` の前と `createAgentSession` の後で `signal.aborted` を確認し、真なら `prompt()` を呼ばずに `aborted` 結果を返して dispose する。生成前に返す場合は `sessionId` null・usage 0、生成後は生成済みセッションの `sessionId` と usage を載せる。これは abort の要件を満たすために必須で、省略できる複雑さではない。`session.dispose()` の例外は握りつぶす(確定した結果と usage を失わないため)。

`prompt()` の事前処理中の abort も取りこぼす。問題: 上流の `prompt()` は、エージェントの実行を始める前に入力ハンドラ・認証確認・`before_agent_start` を await する。この間は実行中のランが無く(`activeRun` 未設定)、`session.abort()` は何も止めない。さらに実行の開始時に中断フラグが初期化される(`agent-session.ts:1776`)ため、事前処理中に出した abort は完全に失われる。例: `prompt()` の認証確認の await 中にセルの timeout が来ると、abort は空振りして子が最後まで走る。解決: `subscribe` で `agent_start` を受けた時点で abort 要求済みなら、`session.abort()` を出し直す(この時点ではランがあり、abort が効く)。これは現実に踏む経路が確認できていない防御である。子の認証が設定済みなら事前処理はマイクロタスクだけで進み、タイマーやキー入力は割り込めないため、確認の結果によっては不要になる。数行で済むので入れ、必須かどうかはタスク 3.2 の上流コード確認で決着させる。

セルは同じシグナルの abort で即座に reject し、結果は tsrepl の中断・timeout のエラーになる(`repl/cell.ts` の `raceTermination`)。このため `rlm` の戻り値はセルの結果に現れない。`rlm` は未処理の reject を避けるため、中断時は中断旨の文字列で resolve する(spec は戻り値を要件にしない)。

- 選択肢: `Promise.race` で親シグナルと子完了を競わせ、子は放置する。
- 理由: 子が動き続けて課金とファイル書き込みが継続するため却下。
- 選択肢: 子セッションの prompt に親シグナルをそのまま渡す。
- 理由: `AgentSession.prompt` は `AbortSignal` を受け取らないため却下。
- 選択肢: 中断時に例外で reject する。
- 理由: `rlm()` を await せずに呼んだセルでは、reject を受ける側が無く未処理の reject になるため却下。
- 選択肢: 生成後に abort 済みのシグナルを見つけたら `session.abort()` を呼び、そのまま `prompt()` する。
- 理由: idle のセッションに対する `abort()` は何も止めず、続く `prompt()` が最後まで走るため却下。
- 選択肢: `prompt()` の呼び出し直前にだけ `signal.aborted` を再確認する。
- 理由: 呼び出し後の事前処理中に届く abort は見えないため却下。

### 8. ツール呼び出し上限は子の `tool_execution_start` を数える

`spawn.ts` は子の `session.subscribe` で `tool_execution_start` かつ `parentToolCallId` が無いイベントを数える。`RLM_MAX_TOOL_CALLS`(既定 50)を超える回数目(51 回目)のイベントで `session.abort()` を呼び、`getLastAssistantText()` で部分テキストを取得して、上限超過の旨と部分テキストを含む文字列を `budget` 結果として返す。ちょうど 50 回で完了する子は打ち切らない。

子の有効ツールは `tsrepl` だけなので、現状は `parentToolCallId` を伴う呼び出しは起きない。将来 `tool()` の対象が増えたときに、モデル発行の呼び出し回数という意図を保つための条件として残す。

- 選択肢: `parentToolCallId` を伴う入れ子呼び出しも数える。
- 理由: `tsrepl` の 1 セル内の `tool()` 呼び出しが複数回数えられ、モデル発行の呼び出し回数という意図とずれるため却下。
- 選択肢: `createAgentSession` にツール呼び出し上限を渡す。
- 理由: そのようなオプションが存在しないため却下(M3 §4 の「設定値」は spirits 側の定数)。

### 9. usage は `hostfn.ts` が親の `pi.appendEntry("rlm_usage", ...)` に記録する

`rlm` の呼び出し 1 回につき、`hostfn.ts` が `pi.appendEntry("rlm_usage", entry)` を 1 回だけ呼ぶ。`spawn.ts` は `pi` を持たず、結果(`RlmRunResult`)に usage を載せて返す。`pi` は拡張セットアップ時に `createRlmHostFn` へ渡して捕捉し、子の `createRlmHostFn` にも同じルートの `pi` を渡す。このため、全深度の記録がルートセッションに集まる。

```
RlmRunResult = {
  outcome: "completed" | "aborted" | "budget" | "error",
  text: string,              // completed: 最終回答 / budget: 途中結果サマリ / aborted: 中断旨 / error: 使わない
  errorMessage?: string,     // error のとき
  sessionId: string | null,  // 子を生成していなければ null
  tokens: { input, output, cacheRead, cacheWrite, total },
  cost: number,
}
```

エントリは `{ depth, sessionId, provider, modelId, tokens, cost, durationMs, outcome }`。`depth` は生成する(した)子の深度(呼び出し側 + 1)、`durationMs` は `rlm` の呼び出し開始から戻りまで(直列化の待機を含む)。`provider` / `modelId` は親 `ctx.model` から取る。子を生成しなかった呼び出しは `outcome: "error"`、`sessionId: null`、tokens と cost は 0。

集計規約: 子はインメモリで、各子セッションの `getSessionStats()` はその子自身の usage だけを含む。このため、1 回のルートセッションの総コストは「ルートセッション自身の usage + そのセッションの JSONL にある全 `rlm_usage`(depth で絞らない)」になり、二重計上は起きない。`outcome` と `durationMs` は、M5 の判断ゲート(`docs/spirits-m5-phase2.md` §4 の呼び出し回数・総待ち時間)の入力になる。

`spawn` が結果ではなく例外で終わった場合(後始末や usage 取得の想定外の失敗)も、`hostfn.ts` が `outcome` `error`・`sessionId` null・tokens と cost 0 の `rlm_usage` を 1 件記録してから再 throw する。「呼び出し 1 回につき 1 件」を例外経路でも保つため。

- 選択肢: `scope.toolContext.sessionManager` に直接 `appendCustomEntry` する。
- 理由: `ExtensionToolContext.sessionManager` は読み取り専用インターフェースで追記 API を公開せず、M1 設計の `pi.appendEntry` 経路(設計書 §4.4)から外れるため却下。
- 選択肢: 子の usage を親の `usage` エントリとして `appendUsage` する。
- 理由: 親の集計に子が混ざり、depth で区別できなくなるため却下。
- 選択肢: `spawn.ts` が `pi.appendEntry` を呼ぶ。
- 理由: 子を生成しない呼び出し(引数不正、深度上限、モデル未設定)は `spawn` に到達せず、記録の責務が 2 か所に分かれて二重記録や記録漏れの原因になるため却下。
- 選択肢: `depth` を呼び出し側の深度(0 以上)にする。
- 理由: 深度 0 はルートセッション自身を指す値として空けておく方が、集計規約を「ルートの usage + 全 `rlm_usage`」の 1 文で書けるため却下。
- 選択肢: `spawn` の例外は記録せずに伝播させる。
- 理由: 後始末などの想定外の失敗で、その呼び出しが `rlm_usage` から漏れるため却下。

### 10. `spawn` を注入し、実 LLM なしでロジックをテストする

`createRlmHostFn({ pi, depth, maxDepth, spawn })` の `spawn` は `(params: SpawnParams) => Promise<RlmRunResult>` 型とし、本番は `rlm/spawn.ts` の `spawnChildSession` を渡す。`SpawnParams` は `{ prompt, cwd, model, thinkingLevel?, signal, childTool }` で、`childTool` は `hostfn.ts` が呼び出しごとに作る深度 +1 の `tsrepl`(`createTsreplTool({ hostFns: [createRlmHostFn({ pi, depth: depth + 1, maxDepth: childMax, spawn })] })`)。呼び出しごとに新しい `tsrepl` を作るため、子の REPL は独立したコンテキストになる。

`spawnChildSession(params, sdk)` の `sdk` は `{ createAgentSession, createSessionManager, createResourceLoader }` を束ねた `SpawnSdk` で、既定値は pi の実体。テストは `spawn` をフェイクに差し替え、深さ判定・`maxDepth` クランプ・引数検証・直列化・usage 記録・戻り値整形を検証する。`spawnChildSession` は `sdk` をフェイクに差し替え、子 `AgentSession` のフェイクに対する abort・上限・失敗判定・dispose・生成条件を検証する。実 SDK の経路は SDK スパイクと interactive smoke で確認する。

- 選択肢: `hostfn.ts` が `spawn.ts` を直接 import する。
- 理由: 実プロバイダ認証なしではユニットテストできず、`bun test` が課金・ネットワークへ依存するため却下。
- 選択肢: `spawn` の代わりに子 `AgentSession` 自体を注入する。
- 理由: `createAgentSession` の呼び出し条件(cwd / model / tools / sessionManager / resourceLoader)の検証ができず、SDK 差分の吸収先が定まらないため却下。
- 選択肢: `spawnChildSession` を差し替え不能にし、実 SDK だけで検証する。
- 理由: abort・上限・失敗判定・usage の分岐が実プロバイダ依存になり `bun test` で固定できないため却下(SDK 呼び出しを注入可能にする)。

### 11. 型はローカルミラーを拡張する

`src/types/pi-coding-agent.d.ts` に次を追加する。実行時 import は、Decision 12 の方式で実体を解決する。

- `createAgentSession` / `CreateAgentSessionOptions`(使用面のみ) / `SessionManager.inMemory` / `DefaultResourceLoader`(コンストラクタオプションと `reload`) / `getAgentDir`
- `AgentSession`(`prompt` / `abort` / `getLastAssistantText` / `getSessionStats` / `subscribe` / `dispose` / `sessionId` / `messages`) / `AgentSessionEvent`(使用面のみ) / `SessionStats`
- 最小の `PiModel`(`provider` / `id`) / `ExtensionAPI.appendEntry` / `ExtensionContext.model` / `ExtensionContext.thinkingLevel`

`SettingsManager` はミラーに置かない(Decision 2)。ミラー冒頭のコメントは、`spawn.ts` が実行時に pi の実体を import する現状(Decision 12)に合わせて書く。

- 選択肢: pi ソースの型を直接使う。
- 理由: M1 で却下済み(`@types/bun` と pi の Node 型の衝突。M1 design Decision 12)。
- 選択肢: pi-ai の `Model` 型を `paths` へ追加する。
- 理由: ミラーに `PiModel`(`provider` / `id`)だけを置けば足り、pi-ai の型解決を増やす必要がないため却下。

### 12. 実行時 import の解決: `src/rlm/tsconfig.json` で root の paths を使う

pi の値(`createAgentSession` など)を実行時に import するのは `rlm/spawn.ts` だけとし、`hostfn.ts` / `depth.ts` / `guidance.ts` は型 import のみにする。`packages/spirits/src/rlm/tsconfig.json` を置き、root の `tsconfig.json`(`../../../../tsconfig.json`)を `extends` する。Bun は import 元ファイルの最も近い `tsconfig.json` の `paths` で解決するため、`spawn.ts` の pi import は pi ソース(`packages/coding-agent/src`)に解決される。M2 の `bin/tsconfig.json` と同じ方式で、`bun test`・`bun packages/spirits/bin/spirits.ts`・`-e` 起動で同じ解決経路になる。型検査は `packages/spirits/tsconfig.json` の `paths`(ミラー)のままで変わらない。コンパイルは `scripts/build-binaries.ts` が root の `tsconfig.json` を使うため追加対応は要らない。

`spawn.ts` を import するテストは pi のソースを読み込むため、起動が重くなり、ルートの依存導入(`npm ci --ignore-scripts`、CI では既存のルート `bun install --frozen-lockfile`)が前提になる。`hostfn.ts` などのテストは `spawn.ts` を import しないので影響を受けない。

- 選択肢: `src/` に値の import を置かず、`bin/` から SDK の関数を注入する。
- 理由: `bin/` はコンパイル用エントリで、binary-distribution の「M3 以降の機能を参照しない」(MUST)に触れる。
- 選択肢: テストは `mock.module` で差し替え、開発時起動は `-e` 経路だけに限定する。
- 理由: `bin/spirits.ts` から起動したときの `rlm` が動作対象外になり、実環境と異なる解決経路でテストが通るため却下。
- 補足: AGENTS.md が動的 import を禁止しているため、動的 import による回避は採らない。この方式が動くことは SDK スパイク(Decision 13)の項目 4 で確認し、動かなければ作業を止めてユーザへ確認する。

### 13. SDK スパイクを実装の冒頭に置く

`docs/spikes/sdk-agent-session.md` に、Bun 1.4.2 + 実プロバイダで次を確認して記録する。

1. 拡張内から子 `AgentSession` を生成して custom `tsrepl` を登録し、prompt を実行できる
2. 子の usage を `getSessionStats()` で取得できる
3. `session.abort()` で実行中の子を止められる
4. `src/rlm/tsconfig.json` により、`spawn.ts` 相当の pi 実行時 import が `bun test`・ソース起動(`bin/spirits.ts`)・`-e` 起動で解決でき、`bun test` の起動時間が許容範囲に収まる
5. `noExtensions` / `noSkills` / `noPromptTemplates` を指定したローダーでも custom `tsrepl` が有効で、コンテキストファイルは読み込まれる
6. `pi.appendEntry` で追加したカスタムエントリが、セッションのメッセージ列(`buildSessionContext().messages`)に含まれない

動かない項目は、`spawn.ts` の代替実装(別 API 経路、またはコアへの `[spirits]` 最小パッチ候補)を記録し、作業を止めてユーザへ確認する。

- 選択肢: スパイクを省き、SDK を信頼して `spawn.ts` から書き始める。
- 理由: `docs/spirits-m3-rlm.md` §5 が冒頭の SDK 検証を要求し、`createAgentSession` を拡張から呼ぶ経路、実行時解決、usage / abort は未検証のため却下。

### 14. モデルへの案内: Prime Agent の方式を同期・TypeScript 向けに改修する

案内文は `rlm/guidance.ts` の `buildRlmGuidance({ depth, maxDepth })` が組み立て、`createRlmHostFn` が `HostFnEntry.description` に設定する。Decision 1 により tsrepl のツール説明へ合成される。文面は定数・テンプレートとして `guidance.ts` に集約し、上限値は `depth.ts` の定数を参照する(数値の二重定義を避ける)。

`docs/prime-agent-rlm-instruction.md` の要素を、次のように採否する。

| Prime Agent の要素 | spirits (M3) での扱い |
|---|---|
| `rlm` は最初からグローバルに在る(カーネルのプリロード) | 採用。「`rlm` は最初から利用可能」と書く(ホスト関数として登録済み) |
| `buildRlmPrompt` の仕様説明(戻り値、オプション) | 採用。戻り値は文字列、オプションは `maxDepth` だけ。未知のオプションは失敗する旨も書く |
| 戻り値はハンドル。非ブロッキング、並列起動、ポーリング禁止(`LONG_RUNNING_WORK_PROMPT`) | 不採用。M3 は同期・文字列返却・直列実行で、M5 の領域。逆に「直列で待ち時間が合計される」と書く |
| 委譲の基準(文脈量の多い並列調査・独立した実装は委譲、単発で既知の操作はインライン) | 採用。「並列」は除く |
| fan-in は子にファイルを書かせて読む | 採用(変形)。回答は文字列で返るが、結果は 8000 文字で切り捨てられるため、長い結果はファイルに書かせてパスを返させる |
| 子 doctrine(`buildChildAgentDoctrine`、深度 1 以上) | 採用(変形)。「`rlm` で起動された子である」「最終アシスタントメッセージが親へ文字列で返る」「親の変数は見えない」。`agent_message` は無いので返信手段は書かない |
| 再帰が無効なとき `rlm` の API を案内しない | 採用。深度が上限以上のセッションでは使い方を書かず、「深度上限により `rlm` を呼べない」だけを書く |
| `name` / モデル指定 / `thinking` オプション、`find_models`、`list_subagents`、`delete_subagent` | 不採用(非目標。モデルは親継承のみ。子はハンドルを持たない) |
| `agent_message` / `agent_observe` / refine / Continual Harness の案内 | 不採用(M4 / M5) |
| Python 固有の指示(`uv pip`、`bash()` ハンドル、`call_skill` を発明しない) | 該当なし。ただし「`rlm` 以外の委譲用ラッパーを作らない」は書かない(不要) |

M3 固有の内容として、次を加える。セル timeout が子の実行時間にも適用されること(`timeout` を大きく指定する。最大 120000ms)、子のツールは `tsrepl` だけでファイル操作は `use("node:fs")` で行うこと、深度上限と現在の深度、ツール呼び出し回数の上限(50)。

案内文の骨子(実装時に文面を確定する。語句は spec の Scenario が検査する):

```
## rlm: 子エージェントへの委譲
- `await rlm(prompt)` は子エージェントを同期的に起動し、最終回答の文字列を返します。`rlm` は最初から使えます。
- 子は親の REPL 変数を見られません。必要な情報は prompt か、cwd 配下のファイルで渡してください。子のツールは tsrepl だけで、ファイル操作は `use("node:fs")` で行います。
- 結果は 8000 文字で切り捨てられます。長い結果は、子にファイルへ書かせ、パスだけを返させてください。
- 文脈量の多い調査や独立した実装は委譲し、単発で既知の検索・編集・コマンドは自分で実行してください。
- 呼び出しは直列に実行され(Promise.all でも 1 つずつ)、待ち時間は合計されます。セルの timeout が子の実行時間にも適用されるため、`timeout` を大きく指定してください(最大 120000ms)。
- 再帰の深度上限は {maxDepth}、現在の深度は {depth} です。上限に達した層で呼ぶと例外になるので、その層で直接処理してください。`rlm(prompt, { maxDepth })` の `maxDepth` はルートからの絶対深度で、子孫の上限を下げられます(上げることはできません)。
- 子のツール呼び出しが {RLM_MAX_TOOL_CALLS} 回を超えると打ち切られ、途中結果が返ります。
```

- 選択肢: Prime Agent の文面をそのまま移植する。
- 理由: 非同期ハンドル・`agent_message` 前提の指示が M3 の同期契約と矛盾し、モデルが存在しない API を呼ぶため却下。
- 選択肢: README だけに書く。
- 理由: モデルは README を読まないため、`rlm` が使われないか誤用されるため却下。

### 15. 完了条件の interactive smoke

`bun test` は fakes で論理を固定する。実 SDK の再帰(`await rlm("2+3は?")` が子の回答を返す、深度 2 までの入れ子、直列化、timeout での中断、`rlm_usage` の記録、モデルが案内文に従って `rlm` を使うこと)は、`.pi/skills/interactive-testing.md` の手順(tmux)で実プロバイダを使い、`spirits` バイナリまたはソース起動から確認する。子の所要時間も記録し、既定 timeout 30000ms で足りるかを見る。

- 選択肢: `bun test` に実プロバイダを要求する。
- 理由: 課金とネットワークに依存し、AGENTS.md のテスト方針(`packages/coding-agent/test/suite/` は faux provider、実 API を使わない)に反するため却下。

## 設計書からの変更点

本 change は次の点で `docs/spirits-m3-rlm.md` / `docs/spirits-design.md` と異なる。設計書への反映はタスクで行う。

| 項目 | 設計書 | 本 change |
|---|---|---|
| M1 コア変更 | 不要 | `repl/` コアは変更しない。`tools.ts` に `hostFns` オプションとツール説明の合成を追加する |
| 子セッションの永続化 | 記述なし | `SessionManager.inMemory()`。子はセッション一覧に残さない |
| 子のリソース | 記述なし | 拡張・skill・プロンプトテンプレートを読み込まない。コンテキストファイルは読む |
| 認証の継承 | 「親から継承」 | エージェントディレクトリの認証情報・モデル定義と環境変数に限る。`--api-key` と拡張のプロバイダは非対応 |
| ツール呼び出し上限 | 「設定値(既定 50)」 | 定数 `RLM_MAX_TOOL_CALLS = 50`。`parentToolCallId` の無い `tool_execution_start` だけを数え、51 回目で打ち切る |
| 深度の保持 | 「REPL コンテキストの非公開内部値」 | `HostFnEntry` のクロージャに閉じ込める(REPL コンテキストには置かない) |
| 深度の定義 | 曖昧(§4 は呼び出し側、§6 #2 は 1 段ずれる読み) | ルートを 0、子は呼び出し側 + 1。深度 d のセッションから `d >= 上限` で `rlm` を呼ぶとエラー |
| `opts.maxDepth` の引き上げ | 「禁止」 | 継承値へクランプする(エラーにしない)。ルートからの絶対深度 |
| 引数の扱い | 記述なし | 不正な prompt / opts / maxDepth は例外 |
| 並行呼び出し | 記述なし | REPL ごとに直列化 |
| 中断時の戻り値 | 「中断旨を返す」 | 観測契約から外す。セルの結果は tsrepl の中断・timeout のエラー。子は abort して破棄する |
| 子のモデル | 親継承 | 親 `ctx.model` を渡す。未設定ならエラー。thinking level も親にあれば継承 |
| usage 記録のタイミング | 子の完了後 | `rlm` 呼び出しごとに 1 件。中断・上限超過・エラー・子を生成しなかった呼び出しも記録 |
| `rlm_usage` の内容と集計 | depth を含む。「depth=0 のみ合計」 | `depth` は子の深度(1 以上)。`sessionId` / `outcome` / `durationMs` を追加。集計は「ルートの usage + 全 `rlm_usage`」 |
| モデルへの案内 | 記述なし | ツール説明に案内文を合成(Decision 14) |
| 実行時 import | 記述なし | `src/rlm/tsconfig.json` で解決(Decision 12) |
| 実 SDK の検証 | `docs/spikes/sdk-agent-session.md` に記録 | 同左(項目を 6 つに拡張)。`bun test` は fakes、実 SDK はスパイクと interactive smoke |
| テスト計画 §6 #2 | 「maxDepth=2 で孫を生成しようとする」 | 「深度 2 のセッションが `rlm` を呼ぶ」に読み替える |
| 全体設計書 §8 のコスト可視化 | 「Pi 側の既存集計に乗せる」 | `rlm_usage` カスタムエントリ + README の集計規約 |

## Risks / Trade-offs

- [Risk] `src/rlm/tsconfig.json` による実行時解決が、`bun test` またはソース起動で動かない、または `bun test` の起動が遅すぎる → Mitigation: SDK スパイクの項目 4 で最初に確認し、動かなければ作業を止めてユーザへ確認する。コンパイルバイナリは interactive smoke と M2 のコンパイル済み拡張ロード確認(項目 3)で検証する。
- [Risk] 子セッションの `DefaultResourceLoader` reload が再帰ごとに走り遅い/副作用がある → Mitigation: 拡張・skill・テンプレートを無効にして読み込み量を減らす。interactive smoke で起動時間を記録し、必要なら将来 change でローダー再利用を検討する。M3 では正しさを優先する。
- [Risk] abort 伝播で、`session.abort()` の完了前に `dispose()` して子の後始末が競合する → Mitigation: 中断時は `await session.abort()` してから `dispose()` する。テストで「abort が呼ばれる」「abort の完了後に dispose される」を固定する。
- [Risk] 親の abort が子セッションの生成中に届き、リスナーが付く前のため `session.abort()` が空振りして子が最後まで走る → Mitigation: 生成の前後で `signal.aborted` を確認し、真なら `prompt()` を開始しない(Decision 7)。テストで「生成前の abort」「生成中の abort」を固定する。
- [Risk] 親の abort が `prompt()` の事前処理中に届き、上流の `abort()` が効かず中断フラグも初期化されて子が最後まで走る → Mitigation: `agent_start` で abort 要求済みなら `abort()` を出し直す(Decision 7)。テストで固定し、事前処理が実 IO を待つ経路の有無を上流コードで確認してスパイク文書に記録する。
- [Risk] usage の二重計上が集計側で起きる → Mitigation: 子はインメモリで各子の usage は自身の分だけ。`rlm_usage` の集計規約(ルートの usage + 全 `rlm_usage`)を README に記載する。
- [Risk] `SessionStats` の形や `getLastAssistantText` の挙動、`stopReason` の扱いが上流で変わる → Mitigation: 使用面を `spawn.ts` の 1 ファイルに集約し、型ミラーを上流 API 追加時に同期する。
- [Risk] 子が読み込む AGENTS.md が、子に無いツール(`read` / `bash` など)の使用を指示して混乱する → Mitigation: 子向けの案内に「ツールは tsrepl だけ」と明記する。コンテキストファイルを子に渡さない選択はプロジェクト規約の欠落を招くため採らない。interactive smoke で挙動を確認する。
- [Risk] 深度や上限の定数が散らばり、変更時に食い違う → Mitigation: 定数は `rlm/depth.ts` に集約し、案内文も同じ定数を参照する(constants-discipline の FILE-LOCAL / PROJECT-GLOBAL 分類)。
- [Risk] `opts.maxDepth` のクランプが意図せず子孫の上限を下げ、モデルが委譲できなくなる → Mitigation: 深度上限エラーのガイダンスと案内文に現在の上限値を含め、interactive smoke で挙動を確認する。
- [Risk] 既定の timeout 30000ms では子が完了せず、親セルごと打ち切られる(子の 1 ターンにかかる時間は未計測) → Mitigation: 案内文と README に「`timeout` を大きく指定する」(最大 120000ms)と既知の制約を記載する。interactive smoke で所要時間を記録し、不足なら後続 change で timeout の扱いを見直す。
- [Risk] 直列化により、複数の `rlm` を呼ぶセルの待ち時間が合計され、timeout に達しやすくなる → Mitigation: 案内文に「直列で待ち時間が合計される」と明記する。並列化の採否は M5 の判断ゲートで扱う。
- [Risk] 親に `--api-key` で認証した場合、子が認証できず失敗する → Mitigation: 失敗は `stopReason: "error"` の例外として原因付きでセルに返る(Decision 3)。README に既知の制約として記載する。
- [Risk] 案内文が不足または過剰で、モデルが `rlm` を使わない、または誤用する → Mitigation: 文面を `guidance.ts` の定数に集約して修正しやすくし、interactive smoke でモデルの使い方を確認する。

## Migration Plan

- 既存の `tsrepl` 利用者への影響はない(`hostFns` 未指定時は M1 と同じツール説明・挙動)。ロールバックは `src/rlm/`(`tsconfig.json` を含む)の削除、`tools.ts` / `index.ts` / 型ミラーの revert、README と設計書の差分戻しで完了する。
- 子セッションはインメモリのため、既存のセッション JSONL 形式は変わらない。`rlm_usage` は既存のカスタムエントリ形式で追加される。

## Open Questions

なし。
