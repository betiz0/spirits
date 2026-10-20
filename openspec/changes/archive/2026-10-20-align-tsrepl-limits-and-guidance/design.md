# Design

## Context

動機と測定値は `proposal.md` を参照する。設計に関係する現状の制約だけを書く。

- セル評価は `src/repl/cell.ts` が 1 か所の timeout 値を vm の同期 timeout と await 中の race の両方に使い、`src/repl/format.ts` が整形後のテキストへ 1 回だけ出力上限を掛ける(sync 関数)。
- `tool()` は `scope.toolContext.executeTool()` の結果を見て、`isError` を先に判定する。pi codemode の `toScriptValue`(`packages/coding-agent/src/extensions/codemode/execute.ts`)は構造化結果を優先し、エラーでもそれを返す。
- bash ツールは `promptSnippet` / `promptGuidelines` を宣言し、非ゼロ終了時に `isError: true` と `structuredContent { output, truncated, full_output_path?, exit_code, wall_time_seconds }` を同時に返す。pi は `ToolDefinition.promptSnippet` を `<tools>`、`promptGuidelines` を `<rules>` に載せる(`core/system-prompt.ts` の `buildRules`)。pi 既定の「Use bash for file operations like ls, rg, find」も同じ `<rules>` に入る。
- `rlm` は `src/rlm/hostfn.ts` が直列化・中断・usage を持ち、`src/rlm/spawn.ts` が子を走らせて `outcome` を返す。中断は `spawn.ts` が `params.signal` を購読して子を abort し、後始末を待って戻る。
- code-mode プロンプトは `src/harness/prompt.ts` の TS 定数で、`<agentDir>/prompts/spirits/code-mode.md` があるときはそちらが勝つ(`docs/spirits-m4-harness.md` の code-mode プロンプトの骨格が正)。
- vm はセキュリティ境界ではない(`openspec/config.yaml` の Hard rules)。モデル生成コードはユーザ権限で動く。

## Goals / Non-Goals

**Goals:**
- tsrepl の実行条件(timeout・出力上限)を bash と同じオーダーにし、切り捨てた出力を後から読めるようにする
- `tool()` の結果契約を pi codemode とそろえ、非ゼロ終了をデータの一種として扱えるようにする
- モデルが tsrepl と bash を選び分ける基準と使用例を、上書きされにくい場所に置く
- `rlm` 1 回の暴走(実行時間とトークン)に上限を入れる

**Non-Goals:**
- 子セッションのツール構成の変更(bash の開放)、`rlm` の非同期化、tsrepl 単独のツールロードアウト、モデル別のプロンプト追記、長時間コマンドの非同期ハンドル
- pi 既定の `<rules>` の書き換え(上流コアの変更を伴うため行わない)
- 出力上限・timeout・`rlm` 上限の設定可能化(既定値を変えるだけ)

## Decisions

### 1. `tool()` は pi codemode と同じく、宣言された構造化結果をエラー扱いでも返す

エラー扱い(`isError`)の結果は、そのツールが `outputSchema` を宣言していて `structuredContent !== undefined` のときだけ、例外にせず構造化結果を返す。宣言が無い、または構造化結果が無いときは、従来どおりエラーテキストを含む例外にする。エラー扱いでない結果は従来のままで、構造化結果があればそれを、無ければテキストを返す。

- 判定に使う宣言は `scope.toolContext.tools`(`ExtensionToolContext.tools`、「`executeTool` が呼べるツール」)から名前で引く。`runner.ts` の `createToolContext` の `tools` getter と、入れ子の `executeTool` の解決は、どちらも `agent-session.ts` の `_getCallableTools()` を使う(コードの読み取りによる確認)。bash は `outputSchema` を宣言するので、狙いの「rg の 0 件・テストの失敗をデータとして受け取る」はこの判定で満たされる。
- pi の `toScriptValue` との差: pi は成功時も `outputSchema` が無いと構造化結果を返さない。tsrepl は成功時の既存契約(構造化結果があれば返す)を残す。エラー扱いの分岐だけを pi と同じにするので、既存の成功系のセル・テストは変わらない。
- 代替案: 宣言を見ず、構造化結果の有無だけで判定する。宣言の無いツールが、エラー時に診断用の構造化結果を付けた場合もデータとして扱ってしまい、pi codemode と契約が分かれる。proposal の「pi codemode に寄せる」を優先して採らない。
- 影響: 非ゼロ終了を `catch` で検出していたセルは `exit_code` の確認に置き換わる。例外は構造化結果を伴わない失敗(存在しない・呼べないツール、引数不正、拒否、tsrepl 自身)と、宣言の無いツールの失敗で残る。bash は構造化結果の `output` を 1MB まで保持し、`full_output_path` も持つので、セル側は加工して小さく返す。

### 2. timeout を「セル全体の timeout」と「同期実行の watchdog」に分ける

`resolveCellTimeouts(timeout)` が 2 つの値を返す。

- `cellMs`: 指定時のみ。500ms 未満は 500ms、2147483647ms 超は 2147483647ms にクランプ。未指定は `undefined` で、race はタイマーを張らない。
- `syncMs`: 同期実行(vm)の watchdog。`min(cellMs ?? 30000, 30000)`。既定 30000ms で、大きい timeout を指定しても同期ハングは 30000ms で止まる。

打ち切りの区別は既存の手がかりを使う。vm は `ERR_SCRIPT_EXECUTION_TIMEOUT` を投げ、race は `TimeoutError` を投げるため、前者を「同期実行の上限」、後者を「セル全体の timeout」のメッセージに割り当てる。どちらのメッセージも、timeout の要件が定める 3 項目(打ち切った旨、不整合になり得る旨、`reset: true` の案内)を含める。既存テスト `timeout sync loop` は「打ち切り」「不整合」「reset: true」を確認しているので、watchdog のメッセージにもその語を残す。

- 代替案: 同期 watchdog も `cellMs` に追従させる(現実装の延長)。2147483647ms を指定したセルの同期ループは Esc でも止められずプロセスが応答しなくなるので、watchdog はセル全体の timeout と切り離す。
- 代替案: bash と同じく不正値で例外にする。既存のクランプ挙動とテストを残し、新しい失敗経路を作らないほうが小さい。
- 呼び出し元(Esc)の中断は `toolContext.signal` 経由で従来どおり効く。timeout 未指定でも効くことをテストで確認する。
- 単位は ms のままとする(bash は秒)。tsrepl の呼び出し側・説明文・テストが ms で揃っており、同じ `timeout` という名前で単位を変えても得られるものが無い。

### 3. `rlm` の実行時間上限は hostfn で持ち、例外で知らせる

`src/rlm/depth.ts` に `RLM_MAX_CHILD_DURATION_MS = 120000` を置き、`rlm/hostfn.ts` が `spawn()` を呼ぶときだけ有効な子用の中断シグナルを作る(`AbortSignal.any([scope.signal, capController.signal])`)。タイマー発火後に `spawn` が戻ったら、`outcome` が `completed` ならその最終回答を返す(完了を優先し、上限の例外は投げない)。そうでなければ、上限で打ち切った旨と上限値を含む例外を投げる。`rlm_usage` の `outcome` は `aborted` のまま `durationMs` と中断時点の tokens を記録する。直列化の待機時間は上限に含めない(`waitTurn` の後でタイマーを開始する)。

- 例外にする理由: 現行 spec は、子の失敗(生成・prompt・プロバイダエラー)を例外で返す。回答が得られなかった打ち切りを文字列で返すと、セルの後続コードが案内文を子の回答として扱っても検出できない。例外ならセル内で `catch` でき、`catch` しなければセルが error になって打ち切りが明示される。
- 代替案: 文字列を返す、または固定の接頭辞付き文字列を返す。回答と区別するために呼び出し側の判定が要るので採らない。
- 代替案: `spawn.ts` に `timeoutMs` を渡し、`RlmRunResult` に区別用の場を増やす。境界が「親の中断を受け取る場所」から「複数の中断理由を持つ場所」に変わって `outcome` の意味が広がるので、hostfn で持つ。
- 部分テキストは添えない。添えるには `abort` 経路のテキスト契約を変えて `spawn.ts` の aborted 結果に部分テキストを載せる必要があり、途中の回答が最終回答として読まれるリスクもある。子のツール呼び出し回数上限(`budget`)が部分テキストを返すのは打ち切り前に本文が組み上がっている場合に限られ、時間上限ではその保証がない。
- `outcome` に新しい値(`timeout`)は足さない。`rlm_usage` の列挙は 4 値のままにし、区別は例外の文と `durationMs` で足りる。
- 継ぎ目(テスト用の注入): `CreateRlmHostFnOptions` に実行時間上限の注入値を追加する。製品コードからは既定値しか渡さない。
  - 置かない代替案: 実時間 120000ms を待つテスト、またはタイマーの差し替え。前者は実用にならず、後者は `AbortSignal.any` と vm 内のタイマーを同時に制御できるか Bun で未確認(🟡)。rlm には `SpawnFn` / `SpawnSdk` をテストのために注入する先例があり、同じ方法に合わせる。
  - 撤回条件: 上限を設定可能にする change(Open Questions 参照)で、この注入値を正式な設定値の受け口に置き換える。置き換えたら「テスト用」の位置づけを外す。

### 4. 出力上限は文字数のまま 51200 に上げ、切り捨て時は全文を一時ファイルへ

`OUTPUT_LIMIT = 51200`、先頭 30720 / 末尾 20480(比率 60/40 は現状維持)。単位は JavaScript の文字列長。

- 代替案: bash と同じ UTF-8 バイト数。バイトで切るとマルチバイトの途中で切れて安全な境界計算が必要になり、日本語主体の出力では上限が 51200 バイト = 約 17000 文字と現在より狭くなる。ASCII 主体のログ・検索結果では 51200 文字は bash の 50KB と同じオーダー。
- 代替案: bash と同じ行数上限(2000 行)も追加する。軸が 2 本になるとマーカーの文言が曖昧になり、先頭と末尾を残す現在の形と相性が悪い。

切り捨てた全文の保存は `format.ts` の同期処理のままにはしない。`applyOutputLimit` は切り捨て前の全文と切り捨て情報を返し、`Repl.run` が `async` の側でファイルを書いてから結果テキストにパスを追記する。書けないときはセルの結果を変えず、パスの代わりに理由を書く。

- 保存先: `os.tmpdir()` に `spirits-tsrepl-<hex>.txt`、モード 0600、排他作成(`flag: "wx"`)。共有の tmp に同名のファイルやシンボリックリンクが既にあれば上書きせず、保存できなかった扱いにする(モード 0600 は新規作成時にしか効かないため)。削除は行わず OS の tmp 掃除に任せる(bash と同じ寿命)。pi の `writeOutputFile` は同じ做法だが未エクスポートなので、spirits 側に小さなヘルパを持つのみでコアは触らない。
- 代替案: spirits のエージェントディレクトリに保存する。セッションをまたいで残り、保持期間の規則を追加することになる。
- 継ぎ目(テスト用の注入): 保存処理は REPL の生成オプションとして差し替え可能にする(既定は tmp への書き込み)。書き込み失敗時の挙動はセル成否を変えないため、失敗を注入できる形が要る。
  - 置かない代替案: `TMPDIR` を書けない場所に向けて失敗させる。同一プロセスで並行するテストに環境変数の変更が漏れ、`os.tmpdir()` が Bun で呼び出しごとに環境変数を読むかも未確認(🟡)。採らない。
  - 撤回条件: 保存先を設定可能にする、または保存を pi のヘルパへ寄せられる(`writeOutputFile` が公開される)ときに、この差し替え口を統合して外す。

### 5. `_` は成功セルの value をホスト側から代入する

セルが成功して value を返したとき、REPL が vm コンテキストの `_` に代入する。ホスト側からの `vm.Context` オブジェクトへの代入が、後続のセルから `globalThis._` として読めることは、実装時に Bun でテスト(tasks 4.1)して確かめる。失敗した場合は、セルの末尾で IIFE の内側から `globalThis._` へ代入する形に切り替える。value を返さないセル・失敗したセルは触らない。`reset` はコンテキストごと作り直すので自然に消える。

- 代替案: 成功したセルは必ず代入する(value が undefined でも)。`print` だけのセルで `_` が消えるほうが不自然なので、value があるときだけ代入する。
- 代替案: `last()` のようなホスト関数にする。`_.length` のように続けられる変数のほうが使いやすく、既存の「`globalThis` に残る値」の模型にも乗る。

### 6. ツール一覧と規則への掲載は tsrepl の宣言で行い、子セッションには規則を載せない

`src/tools.ts` に `promptSnippet`(1 行)と `promptGuidelines`(2 項目)を置き、`createTsreplTool` に `promptGuidelines` の上書き引数を追加して、`rlm` の子が作る tsrepl には空配列を渡す。子は bash を持たないので「bash を使え」という基準は child では実行不能な指示になる。snippet は子にも載る(子の `<tools>` にも tsrepl が掲載される)。spec の条件は「`rlm` が生成する子セッションの tsrepl は空」とし、親セッションで bash を使えるかどうかの判定は持たない。

- 代替案: 親も子も同じ文言にする。子にとって使えないツール名を指示するので外す。
- 代替案(継ぎ目を置かない): 上書き引数を作らず、子用の別のツール定義を `rlm/` に持つ。tsrepl の定義(パラメータ、説明、実行)が二重になるので採らない。上書き引数は呼び出し元が 1 か所(`rlm/hostfn.ts`)で、既定の呼び出しは変わらない。
- 撤回条件: 子セッションに bash を開放する change(対象外に挙げたもの)が入った時点で、この上書き引数を外し、子も親と同じ宣言にする。
- pi 既定の「Use bash for file operations like ls, rg, find」は消さない。`<rules>` に 2 基準が並ぶが、tsrepl 側は「加工が要るときは tsrepl」という条件付きの基準に限定して衝突を広げない。

### 7. 使用例は code-mode プロンプト、判定基準はツール宣言に置く。実行面の行はその基準に合わせる

検索・JSON・テストの 3 例(合計 15 行以内)を `DEFAULT_CODE_MODE_PROMPT` に追記し、成否の判定基準は `promptGuidelines` に置く。あわせて `DEFAULT_CODE_MODE_PROMPT` の 1 行目「主要な実行面は `tsrepl` です。」を、`promptGuidelines` の選択基準に沿った記述(連続実行・加工・結果の受け渡しは tsrepl、単発で出力をそのまま読むコマンドは bash)に書き直す。同じ指示を 2 か所に別の言い方で置くと、tsrepl を使うかどうかの方向が食い違うためである。continual-harness の要件の箇条と `docs/spirits-m4-harness.md` の骨格 1(「ファイル操作・検索も極力セル内コードで」)も同じ change で直す。

- 代替案: 基準も例も code-mode プロンプトだけに置く。`<agentDir>/prompts/spirits/code-mode.md` の上書きで消えるため、基準はツールの宣言側に置く。上書きファイルが旧文言の「主要な実行面」を持つ場合は、この change では書き換えない(ユーザのファイルであり、`spirits_prompt_set` のバックアップで比較できる)。
- 代替案: 実行面の行を削除して基準をツール宣言だけにする。code-mode プロンプトだけを見るモデルに tsrepl の位置づけが残らなくなるので、書き直しにする。
- 例の書き方は「値を小さく返す」ことを示す(`exit_code` と行数だけを返す等)。`tool("bash")` を呼ぶだけの 149 セルを減らすのが狙いなので、加工する例だけを載せる。
- 例のコマンドにシェルのパイプを使わない。pi の bash は `pipefail` を付けずに `bash -c` で実行するため、`bun test 2>&1 | tail -40` の `exit_code` は `tail` の終了コードになり、テストが失敗しても 0 になる。切り出しや絞り込みはセル内の JS で行う(tsrepl を使う理由そのもの)。
- 選択基準の行は `TSREPL_PROMPT_GUIDELINES` から組み立てる(harness → shared の依存は許可されている)。手で書いた 2 つの文言は、片方だけを直しても検出できず、この Decision が避けたい食い違いがそのまま起こり得るため。
  - 代替案: 文言は別々に書き、各 guideline の要点が既定プロンプトに含まれることをテストで確かめる。言い換えの自由は残るが、テストが要点の照合に留まり食い違いを見落とし得るので採らない。

### 8. 効果測定は集計スクリプトではなく、セル単位のログを残して後から判断する

セル 1 回ごとに、カスタムエントリ `tsrepl_cell` を `pi.appendEntry` でセッションへ記録する。フィールドは tsrepl の spec「セル実行ログの記録」に従う(outcome、所要時間、timeout、`tool()` ごとの `isError` / `structured` / `exitCode` / `threw`、出力の切り捨てと保存結果、`_` の設定、各種の文字数)。コード・value・printed・出力・`tool()` の引数は記録しない。この change では高度な効果測定のテストや集計スクリプトは作らず、ログが貯まってから改修プランを別途立てる。

- 記録の受け渡しは `rlm/hostfn.ts` と同じ形(`pi: Pick<ExtensionAPI, "appendEntry">` を生成オプションで受ける)にし、`registerTsrepl` が `pi` を渡す。`rlm` の子の tsrepl には渡さない(子はインメモリで、ルートの `rlm_usage` に集約される)。
- `Repl.run` は結果に計測値を添えて返し、`tool()` の呼び出し記録は `HostFnScope` 経由でセルごとの配列へ集める。`tools.ts` の `execute` が計測値からエントリを作る。
- 代替案: 新しい集計スクリプトを `scripts/` に置く。既存の `scripts/tool-stats.ts` などがセッション JSONL からツール呼び出しを数えているが、セルの中の `tool()` 呼び出しや打ち切り種別は JSONL の tool call からは分からない。ログを先に残すほうが小さく、集計は後続の change で既存スクリプトの拡張か新規かを選べる。
- 代替案: `SPIRITS_DEV=1` の stderr ログ(`createDevLogger`)を使う。セッション JSONL に残らず、過去セッションと突き合わせられないので、効果の比較に使えない。
- リスク: 記録がセルごとに 1 件増える。エントリは数百バイトで LLM コンテキストへは送られず、`rlm_usage` と同じ扱いにする。

## Risks / Trade-offs

- [Risk] timeout の既定が無くなり、ハングしたセルがアシスタントのターンを止め続ける → Mitigation: 同期実行の watchdog は常に掛かる。Esc の中断は従来どおり `AbortError` になり、セルの中断シグナルは `tool("bash")` などの子実行にも伝播する。timeout 未指定で待機できることを示す回帰テストを置く。
- [Risk] 過去に書いたセル・Skill・プロンプトが `tool()` の例外で非ゼロ終了を検出していた → Mitigation: 例外は構造化結果を伴わない失敗と宣言の無いツールの失敗で残り、`try/catch` は有効なまま。`tsrepl_cell` の `toolCalls` で `threw` と `exitCode` を後から集計し、減っていることを確認する。
- [Risk] `<rules>` に pi 既定の「Use bash for file operations like ls, rg, find」と tsrepl の基準が並ぶ → Mitigation: pi 既定の規則は上流コア変更になるので消さず、tsrepl 側は条件付きの 2 項目だけに限定する。上書きされにくい場所(ツール宣言)に基準を置いているのも同じ理由。
- [Risk] 出力上限 51200 文字で 1 ターンの文脈が肥大する → Mitigation: 切り捨て時は全文をファイルへ逃がし、セルの return は小さくする運用を code-mode の例で示す。bash が同じオーダーの出力を返しているため、相対的な悪化は小さい。
- [Risk] `<agentDir>/prompts/spirits/code-mode.md` の上書きがあると使用例が効かない → Mitigation: 判定基準はツール宣言側にあり上書きに影響されない。`spirits_prompt_set` がバックアップを取るため比較は可能。docs の骨格説明に「例はビルトイン側のもの」という注記を残す。
- [Risk] `rlm` の 120000ms 上限が正当な長時間の委譲を切り、消費済みトークンを無駄にする。例外になるため、`catch` しないセルは error で止まる → Mitigation: 子は結果をファイルへ書いてパスを返す運用と、委譲の単位を小さくするガイダンスを同じ説明に載せる。`outcome: aborted` の `durationMs` と tokens を集計し、上限自体の再設計は非同期化の change に委ねる。
- [Risk] 構造化結果を返すと bash の 1MB 出力がセル内に入り、そのまま返すと tsrepl の上限で切れる → Mitigation: 例は `exit_code` と行数だけを返す形にし、全文が必要なら `full_output_path` を読むことをガイダンスに書く。

## Migration Plan

- 実装は tasks.md のセクション順(1 → 9)に進める。28 超のタスクがあり 1 セッションに収まらない場合は、セクション単位で区切ってよい(各セクションの検証は独立している)。設定・マイグレーション・データ移行はなし(`_` は新しい永続変数で、既存セッションの再作成は不要)。
- 挙動の非互換は、`tool()` の非ゼロ終了、timeout 既定の廃止、`rlm` の実行時間上限の 3 点(proposal の BREAKING)。リリース時にコードモードのプロンプト例と tsrepl のツール説明が新しい契約を示す。
- ロールバックは revert でよい。一時ファイルは消さなくても OS の tmp 掃除で無くなる。

## Open Questions

- 出力上限・`rlm` の実行時間上限を `settings`/環境変数で変更可にするかは、`tsrepl_cell` と `rlm_usage` のログを見てから判断する(今回は既定値の固定)。
- `tsrepl_cell` の集計手段(既存の `scripts/` の拡張か新規か)と、そこから立てる改修プランは、ログが貯まってから別の change で決める。
- セル全体の timeout は、最初の `await` より前の同期部分が終わってから数え始める(race のタイマーは `runInContext` が戻った後に張る。基点からの挙動)。timeout 1000 で同期 900ms + 待機 900ms のセルは打ち切られない。spec に明記するか、計測の起点をセルの開始にそろえるかは別の change で決める(deep-verify1 G-3)。
