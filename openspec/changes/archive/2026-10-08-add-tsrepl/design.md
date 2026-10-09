# Design

## Context

`packages/spirits` は未作成で、M1 が最初のコード追加になる。上流 pi の Extension API(`registerTool` / `ExtensionToolContext.executeTool`)は `packages/coding-agent/src/core/extensions/types.ts` に定義され、ツールは `exposure` でモデルへの公開方法を選ぶ。REPL 本体は `Bun.Transpiler` と `node:vm` に依存するため、テストは Node 上の vitest ではなく Bun 上で動かす必要がある。

現リポジトリの開発・検証は npm workspaces / `package-lock.json` / vitest である。ルート `package.json` の `workspaces` は `packages/*` を含むため、`packages/spirits` を置くだけで npm workspace の一員になり、CI(`npm ci` → `npm test`、Bun 未導入)の対象に入る。ルート `npm run check` の `tsc --noEmit` と biome も `packages/*/src` を対象にする。このチェックアウトのルートには `node_modules` が無く、pi をソースから動かすには `npm ci --ignore-scripts` が必要になる。

上流 API の確認結果(コード参照):

- `ctx.executeTool` で呼べるのは「有効な `direct` ツールと、登録済みの `codemode` / `deferred` ツール」(`core/agent-session.ts` の `_getCallableTools`)。`direct` で登録する tsrepl 自身も含まれる。上流の codemode ツールは自分自身だけを除外している(`extensions/codemode/tool.ts` の `getCodemodeCallableTools`)。
- ツール呼び出しの実行モードの既定は `"parallel"`(`packages/agent/src/agent.ts`)。`ToolDefinition.executionMode` で上書きできる。
- 拡張ローダは、ソース実行時もバイナリ実行時も `typebox` などを仮想モジュールとして渡す(`core/extensions/virtual-modules.ts`)。

Bun 1.4.2 の挙動(2026-10-07 に使い捨てスクリプトで確認):

- IIFE 内の `const` は次の Script から見えない。宣言なしの代入はコンテキストに残る。
- `Bun.Transpiler` は入力を ESM として解析する。トップレベル await と関数外の `return` が同じセルにあると「Top-level return cannot be used inside an ECMAScript module」で失敗する。`(async () => { … })()` で包んだ後なら成功する。
- 変換で空行と型だけの宣言が消え、行がずれる(7 行のセルが 2 行になる例を確認)。構文エラーは `position.line` / `lineText` に入力側の行を返す。
- `vm.createContext({})` には既定で `console` が入り、`setTimeout` / `fetch` / `URL` / `TextEncoder` / `structuredClone` / `process` / `Bun` は無い。`console` は `delete` で除去でき、除去後の参照は `ReferenceError` になる。
- `runInContext` の `timeout` は同期ループを `ERR_SCRIPT_EXECUTION_TIMEOUT` で止める。`await 0; while (true) {}` は止まらず、外側のタイマーも発火しない(プロセスが停止する)。
- `AsyncLocalStorage` のストアは、vm 内の `await` と、注入したホストの `setTimeout` を越えて伝播する。
- `Bun.inspect("a")` は引用符付きの `"a"` を返し、循環参照は `[Circular]` と表示する。
- `bun test` はテストファイルが 0 件だと終了コード 1 を返す(`--pass-with-no-tests` で 0)。
- ルート `workspaces` に `"!packages/spirits"` を加えると、npm は package-lock にそのディレクトリを含めず、`bun install` は `packages/spirits/bun.lock` を作る。否定パターンが無いと、ルートに `bun.lock` が作られる。

設計の一次根拠は `docs/spirits-design.md`(§4.1, §4.2, §6, §8, §9, §10)と `docs/spirits-m1-repl.md`。本ドキュメントは両者の決定を実装に落とす際の判断と、両者から変えた点だけを扱う。

## Goals / Non-Goals

**Goals:**

- `packages/spirits` の構成、ツール登録、セル評価、コンテキスト、ホスト関数登録口、整形の方針を確定する。
- ルートの npm/vitest/CI を壊さずに、Bun 依存の新パッケージを自己完結で検証できる境界を決める。
- vm ESM スパイクの位置づけと、結果による分岐を決める。

**Non-Goals:**

- M2 以降の機能(配布、rlm、Continual Harness、Phase 2)の設計。
- リポジトリ全体の bun.lock / CI 移行(別 change とする)。
- vm をセキュリティ境界にすること(設計書 §6 のとおり対象外)。
- `await` の後に始まる同期ループの中断。

## Decisions

### 1. パッケージ構成と置き場所

`packages/spirits/src/` を次に分割する。

- `index.ts`: 拡張エントリ
- `tools.ts`: tsrepl ツールの登録
- `repl/transpile.ts`: IIFE ラップと `Bun.Transpiler` 呼び出し
- `repl/context.ts`: vm コンテキストの生成、グローバルの注入、reset
- `repl/registry.ts`: `HostFnRegistry`
- `repl/hostfns.ts`: 組込ホスト関数 `out` / `print` / `use` / `tool`
- `repl/cell.ts`: セル評価パイプライン、timeout、セル単位の状態
- `repl/format.ts`: 結果テキストの整形、エラー整形、出力上限
- `repl/guards.ts`: 共通の型ガード(`isRecord`)
- `types/pi-coding-agent.d.ts`: 上流 Extension API のローカルミラー(型のみ)

- 選択肢: 既存 `packages/coding-agent` 内に実装を混ぜる。
- 理由: 上流への差分を最小化する方針(設計書 §5.1)と、M2 で `packages/spirits` をバイナリへバンドルする前提(設計書 §4.5, §9)に反するため却下。

### 2. ツール公開方法と実行モード

`exposure: "direct"` と `executionMode: "sequential"` を使う。設計書 `docs/spirits-m1-repl.md` の `exposure: "both"` は現行 API に存在しない値で、「モデルから直接呼べる主力ツール」という意図は `direct` で満たされる。直列化の理由は Decision 8 に書く。

- 選択肢: `exposure: "codemode"`(モデルへ宣言せず codemode から呼ぶ)。
- 理由: モデルとの主インターフェースを 1 ツールにする設計意図(設計書 §4.1)に反するため却下。

### 3. セル実行方式(Phase 1)

セルを `(async (require, __dirname, __filename) => {\n` と `\n})()` で包んでから `Bun.Transpiler({ loader: "ts" })` で変換し、`vm.Script`(ファイル名は固定の `tsrepl-cell.js`)にして、遅延生成した永続コンテキストで `runInContext` する。トップレベル await と `return` はこの IIFE が吸収する。引数は開行に置くため、行番号の補正は「1 を引く」に統一できる。

- 理由(引数で影にする): `Bun.Transpiler` は `typeof require` を `"function"` に定数畳み込みし、`__dirname` / `__filename` を参照するセルには `var __dirname = ""` / `var __filename = "input.ts"` を変換後コードへ注入する(Context の確認結果)。IIFE の引数で同名を束縛すると、セル内の `typeof` は `"undefined"` のまま保たれ、注入も行われない(確認済み)。

- 選択肢: 先に変換してから包む。
- 理由: `Bun.Transpiler` は入力を ESM として解析し、トップレベル await と `return` が同じセルにあると失敗する(Context の確認結果)ため却下。
- 選択肢: `vm.SourceTextModule` + `importModuleDynamically` による真の ESM 実行(Phase 2)。
- 理由: Bun 公式文書間で実装状況の記述が矛盾するため(設計書 §11)、スパイクで動作確認できるまで採用しない。スパイク結果は `docs/spikes/vm-esm.md` に記録し、動いても M1 では Phase 1 を維持して M5 の判断材料にする。ESM でもモジュールごとにスコープが分かれるため、宣言の永続化(Decision 4)は解決しない。

### 4. 戻り値と永続の範囲

セル内の `return <式>` または `out(<式>)` のみを value とする。最終式の自動捕捉はしない。

セルをまたいで残るのは `globalThis` に設定した値(`globalThis.x = …` と宣言なしの代入)だけとする。IIFE 内の `const` / `let` / `function` / `class` はセル内に閉じる。この規則は tsrepl のツール説明でモデルに示す。

- 選択肢: 軽量パーサで末尾の式文を検出して `return (...)` に書き換える(Phase 2)。
- 理由: パーサ導入は設計書 §4.2 で Phase 2 / M5 の採否対象とされており、M1 は構文解析なしで堅牢に動かすため却下。
- 選択肢: トップレベル宣言を `globalThis` への代入へ書き換える。
- 理由: 構文解析が必要で、M5 のパーサ採否と同時に判断すべきため却下。
- 選択肢: await / return を含まないセルだけ IIFE なしの Script で実行し、宣言をグローバル字句環境に残す。
- 理由: 同名の再宣言が SyntaxError になり、await の有無でセルの挙動が変わるため却下。

### 5. コンテキストの生成とグローバル

初回ツール呼び出し時に `vm.createContext()` を遅延生成し、`reset` で再生成する。生成時に次を行う。

- ホストの `setTimeout` / `clearTimeout` / `fetch` / `URL` / `TextEncoder` / `TextDecoder` / `structuredClone` を注入する。
- Bun が既定で入れる `console` を `delete` で除去する。
- 生成時点で登録されているホスト関数の呼び出し口を注入する(Decision 6)。

上記以外のホストのグローバル(`process` / `Bun` / `require` / `console` / `__dirname` / `__filename` など)は置かない。`require` は Bun.Transpiler の定数畳み込みを、`__dirname` / `__filename` は同 transpiler の変数注入を、それぞれ IIFE の引数による影で打ち消す(Decision 3)。必要なモジュールは `use("node:…")` で取り込む。

- 選択肢: ECMAScript の組込とホスト関数だけを置く。
- 理由: タイマーや fetch のような基本操作にも `use()` が必要になり、timeout の検証セルも書きにくいため却下。
- 選択肢: ホストの `globalThis` をほぼすべて公開する。
- 理由: 公開範囲を spec で検証できなくなり、`console` のように個別に除外すべきものを追い続けることになるため却下。

### 6. ホスト関数の登録口

`HostFnRegistry` のエントリは `{ name, description, create(scope) }` とする。`create` はセルごとの実行状態 `scope` を受け取り、そのセル用の関数を返す。`scope` は次を持つ。

- `signal`: ツール呼び出しの signal と timeout を合わせた AbortSignal
- `toolContext`: そのツール呼び出しの `ExtensionToolContext`
- `print(text)` / `setValue(v)`: セルの出力先
- `finished`: セルが終了したか

組込の `out` / `print` / `use` / `tool` も同じ経路で登録する。

- 既存の名前(組込を含む)と同じ名前の `register` は例外を投げる。
- コンテキストには、生成時点で登録済みの名前ごとに呼び出し口を 1 つ置く。呼び出し口は Decision 8 の方法で呼び出し元のセルを特定し、そのセルの `create(scope)` が返した関数へ委譲する。
- 生成後に登録された名前は、次の生成(reset)時に呼び出し口が置かれる。

後段は自身のエントリを登録するだけで、コアは中身を知らない。

- 選択肢: `context.ts` に注入関数を直書きする。
- 理由: 後段がコアを変更せず拡張できる構造(設計書 §2「将来拡張点」)を満たせないため却下。
- 選択肢: エントリを「名前・関数・説明」とし、関数を 1 つだけ持つ。
- 理由: セルごとの signal や ctx を受け取れず、`use` / `tool` の中断や、後段(rlm など)が呼び出し元のツール呼び出しへ処理を結び付けられないため却下。

### 7. timeout の扱い

timeout は既定 30000ms で、[500, 120000] にクランプする。非数値は TypeBox のスキーマ検証で弾かれる。

- 同期部分: `runInContext` の `timeout` オプションで止める。
- await で待っている部分: 外側の `Promise.race` とタイマーで待機を打ち切る。
- 打ち切り時(ツール呼び出しの signal による中断も同じ): `scope.signal` を abort し、`scope.finished` を立てる。error には「timeout で打ち切った」「部分実行でコンテキストが不整合になり得る」「`reset: true` で初期化できる」を必ず含める。signal 中断も timeout と同じ競合に載せ、await 中のセル待機を打ち切って同形の error を返す。

`await` の後に始まる同期ループは、どちらの仕組みでも止められずプロセスが停止する(Context の確認結果)。これは既知の制約として spec に書き、tsrepl のツール説明にも記載する。テストは止められる範囲だけを対象にする。

- 選択肢: Worker / 別スレッドでセルを実行し完全に kill する。
- 理由: M1 のスコープ外であり、コンテキストの永続性(変数共有)と両立しないため却下。
- 選択肢: `createContext` の `microtaskMode: "afterEvaluate"` で、await 後の同期部分にも vm の timeout を効かせる。
- 理由: Bun での動作が未確認で、タイマー後に走るループは依然止められないため、M1 では採らない。

### 8. セル単位の状態と出力捕捉

tsrepl は `executionMode: "sequential"` で直列に実行する。`executionMode` は pi のエージェントループでしか効かないため、セル評価の入口でも実行をキューで直列化する(テストや他の呼び出し経路のため)。モジュール内には「実行中のセル」を 1 つだけ持つ。

各セルは `AsyncLocalStorage.run(scope, …)` の中で実行する。ホスト関数の呼び出し口は `getStore()` で呼び出し元のセルを特定する。

- ストアが無い場合や、そのセルが `finished` の場合、`print` / `out` の書き込みは捨てる。これで、打ち切ったセルの非同期処理による後着の書き込みが、後続セルに混ざらない。
- `use` / `tool` は、abort 済みの `scope.signal` を受け取る。

`print(...args)` は、文字列の引数はそのまま、それ以外は `Bun.inspect` で文字列化し、半角スペースで連結して 1 行として `scope` のバッファへ追記する。value は `Bun.inspect` で文字列化する。

- 選択肢: 並列実行のまま、出力をセルごとに分けるだけにする。
- 理由: 永続コンテキストの値を同時に書き換えるセルが並ぶと結果が予測できないため却下。
- 選択肢: コンテキストの `console.log` を差し替えて捕捉する。
- 理由: 設計書 `docs/spirits-m1-repl.md` §5.5 が「console.log はコンテキスト未提供(意図的)」としており、捕捉対象を `print` に一本化するため却下。

### 9. `use()` の許可判定

指定子を次の順で判定し、許可したものだけを host 側で動的 `import()` する。

1. `node:` / `bun:` で始まるものは許可する。
2. `./` / `../` で始まるものは `ctx.cwd` を基準に `path.resolve` し、結果が cwd 配下なら `pathToFileURL` で import する。cwd の外なら拒否する。cwd 外の判定は `..` をパス区切りまで見て行い(`relative === ".."` または `relative.startsWith(".." + path.sep)` または絶対パス)、`..cache` のように `..` で始まる名前を cwd 外と誤判定しない。
3. それ以外(ベア指定子、絶対パス、URL)は拒否する。

リモート URL の拒否メッセージは「M1 では未対応」と理由を示し、opt-in の手段は設けない。判定は字句的な解決結果で行い、シンボリックリンクは追わない(vm はセキュリティ境界ではない)。拒否と import 失敗は、指定子を含む例外としてセル内に投げる。ベア指定子(同梱依存)の扱いは M2 で決める。

- 選択肢: 判定せず動的 import の失敗に任せる。
- 理由: リモート URL を既定で禁止する要件(設計書 §4.2)を満たせないため却下。
- 選択肢: `import()` に相対指定子をそのまま渡す。
- 理由: host 側の `import()` は実装ファイル基準で解決され、cwd 基準にならないため却下。

### 10. `tool()` の実装

1. `name` が `tsrepl` なら、実行せずに例外を投げる。
2. それ以外は `scope.toolContext.executeTool(name, args, { signal: scope.signal })` を呼ぶ。
3. 結果を次のように返す。
   - `outcome.isError` なら、テキスト内容を含む `Error` を投げる。
   - 成功で `result.structuredContent` があれば、それを返す。
   - それ以外は、テキスト内容を連結した文字列を返す。

上流の codemode ツールと同じ契約に合わせる。呼べる範囲は `executeTool` の呼び出し可能集合(Context 参照)で、存在しないツールや呼び出せないツールは `executeTool` が `isError` で返す。

- 選択肢: `ctx.tools` から `AgentTool` を引いて直接 `execute` する。
- 理由: 検証・フック・権限チェックを迂回するため却下。
- 選択肢: `exposure` が codemode / deferred のツールだけに絞る。
- 理由: 上流 codemode と挙動が分かれ、`pi.getAllTools()` による追加の判定が要るため却下。

### 11. 結果テキストとエラー整形

結果テキストは次の形にする。

- 成功時: `[printed]` 節(printed が空なら省略)と `[value]` 節(value が undefined なら省略)を並べる。両方省略された場合は `(no output)` とする。
- 失敗時: `[error]` 節だけを置き、ツール結果に `isError: true` を立てる。

整形した後のテキスト全体に出力上限を 1 回適用する。上限は JavaScript 文字列の長さで 8000 とし、超えた場合は先頭 4800 と末尾 3200 を残して、間に切り捨てた文字数を書く。value / printed / error の構造化結果は、UI とテスト用に `details` にも入れる。

エラー整形:

- 構文エラー: `BuildMessage.position.line - 1` をセル行とし、`lineText` を抜粋にする。
- 実行時エラー: スタックのうち `tsrepl-cell.js` のフレームだけを使う。行番号から 1 を引いて変換後のセル行とし、変換後コードのその行を抜粋にする。REPL 実装ファイルのフレームは捨てる。Bun のスタック形式は V8 と異なるため、解析は `format.ts` の 1 関数に集約してテストで固定する。
- 提案: 例外の種類ごとに 1 文を `提案:` の見出しで添える。`console` の `ReferenceError` には `print` を、宣言を後続セルで参照した `ReferenceError` には `globalThis` への代入を案内する。
- timeout 判定: 打ち切りは `TimeoutError` インスタンス、または vm の同期 timeout エラー(`code === "ERR_SCRIPT_EXECUTION_TIMEOUT"`)で判定する。メッセージの部分一致(`"timeout"` / `"timed out"`)で判定すると、`use("./timeout-utils.ts")` のようなホスト由来エラーを timeout と誤分類し、指定子を含む本来の error を失う。

- 選択肢: 元の TS セルの行番号へ対応付ける。
- 理由: `Bun.Transpiler` は行を保たず(Context の確認結果)、対応付けにはソースマップ相当の追加手段が要るため却下。抜粋を添えて、行の特定はモデルに任せる。
- 選択肢: 生のスタックトレースをそのまま返す。
- 理由: ホスト内部情報が混ざり actionable でなくなるため(設計書 §6)却下。

### 12. ツールチェーン境界(M1 の前提)

`packages/spirits` は、ルートの npm workspace から外した自己完結の Bun パッケージとする。

- ルート `package.json` の `workspaces` に `"!packages/spirits"` を加える(npm と bun の両方が解釈することを確認済み)。
- ルート `tsconfig.json` の `exclude` に `packages/spirits/**` を加える。
- ルート `biome.json` の `files.includes` に `!packages/spirits/**` を加える。

これらは上流ファイルの変更なので、1 つの `[spirits]` コミットにまとめて分離する。

パッケージ内の構成:

- 依存は `bun install --save-exact` で入れ、`packages/spirits/bun.lock` を持つ。
  - `dependencies`: `typebox`(coding-agent と同じ 1.3.27)。pi 上では仮想モジュールが優先され、`bun test` ではこの依存が使われる。
  - `devDependencies`: `@types/bun`、`typescript`(ルートと同じ 7.0.2)。
- テスト: `"test": "bun test"`(`test/` 配下のみ)。
- 型検査: `"check": "tsc --noEmit"`。`tsconfig.json` はルートの `tsconfig.base.json` を継承し、`types` を `["bun"]` にする。`paths` で `@earendil-works/pi-coding-agent` を `src/types/pi-coding-agent.d.ts`(使用する Extension API だけを写したローカルミラー)に向ける。pi のソースは型検査対象にしない。pi の src を辿ると、`@types/bun` のグローバル(`ReadableStream`)と pi の Node 向け型(`path.PlatformPath`、`@types/node@26`)が衝突し、`bun run check` が通らないため。実行時は拡張ローダの仮想モジュールが実体を渡すので、spirits 側は型 import のみで実体を解決しない。

ルートの `check:pinned-deps` と `check:ts-imports` は除外できずリポジトリ全体を走査するため、依存は完全固定、相対 import は `.ts` 拡張子で書いて両者を満たす。ルートの package-lock と CI は変わらない。`bun.lock` 全面移行と CI 追加は本 change のスコープ外とする。

- 選択肢: workspace のまま npm で管理する。
- 理由: package-lock の更新、CI への Bun 導入、`@types/bun` の npm 導入が必要になり、config の「依存追加は bun install --save-exact」と食い違うため却下。
- 選択肢: `packages/` の外に置く。
- 理由: config と設計書の `packages/spirits` 前提を全面的に変えるため却下。
- 選択肢: M1 でリポジトリ全体を bun.lock / bun test へ移行する。
- 理由: 配布(M2)とも独立した横断的変更であり、M1 の完了条件(設計書 §9)に含まれないため却下。

### 13. スパイクの実施順序

実装の最初に `vm.SourceTextModule` / `importModuleDynamically` の最小コードを Bun 1.4.2 で実行し、結果を `docs/spikes/vm-esm.md` に記録する。動かない場合は、設計書 `docs/spirits-design.md` §4.2 の該当記述を「検証済み・不採用」に更新する。結果がどちらでも Phase 1 実装を進める(スパイクは分岐ゲートではなく記録)。

- 選択肢: スパイクを省き Phase 1 前提で進める。
- 理由: 結果が M5 の選択肢を左右し、設計書 §11 が実機検証を要求しているため却下。

### 14. 上流 pi への依存の解決

ソースでは `@earendil-works/pi-coding-agent` を型 import(`import type`)に限定し、型は Decision 12 の `paths` で `src/types/pi-coding-agent.d.ts` に解決する。同ファイルは上流 `core/extensions/types.ts` のうち spirits が使う面(`ExtensionAPI` / `ExtensionToolContext` / `ToolDefinition` / `AgentToolResult` / `AgentToolCallOutcome` / `AgentToolUpdateCallback`)だけを写したミラーで、上流 API を追加採用するときに同期する。実行時に import するのは `typebox` だけで、pi 上では拡張ローダの仮想モジュールが渡す。テストは `ExtensionToolContext` を満たすフェイク ctx を注入し、実 API キーや実セッションを使わない。

- 選択肢: `@earendil-works/pi-coding-agent` を通常の依存として import する。
- 理由: 拡張ローダが仮想モジュール経路で解決するため実行時依存は不要で、後段非依存(設計書 §2)とテストの独立性を保つため却下。

### 15. 開発時ログ

`SPIRITS_DEV=1` のときだけ、各セルの description、実行時間、結果の種別を verbose ログに出す。出力先は既定で stderr とし、テスト用に差し替え可能にする。

- 選択肢: 常にログを出す。
- 理由: 通常利用の出力を汚すため却下。

## 設計書からの変更点

本 change は次の点で `docs/spirits-m1-repl.md` / `docs/spirits-design.md` と異なる。設計書側への反映はタスク 6.3 で行う。

| 項目 | 設計書 | 本 change |
|---|---|---|
| exposure | `"both"` | `"direct"`(`"both"` は現行 API に無い) |
| 永続の範囲 | 変数がセル間で残る | `globalThis` への代入だけが残る |
| 実行時エラーの行番号 | セル内行番号 | 変換後コードの行番号と抜粋 |
| `use()` の許可範囲 | 同梱依存を許可、opt-in で URL 開放 | ベア指定子は M1 では拒否、opt-in なし |
| `tool()` の範囲 | codemode 公開ツール | executeTool で呼べるツールから tsrepl 自身を除く |
| グローバル | 未定義 | 許可リスト(Decision 5) |
| 実行モード | 未定義 | 直列 |
| timeout | 上限 120000 | 下限 500 を追加、await 後の同期ループは既知の制約 |
| 出力上限 | printed/value 合計 | 整形後テキスト全体(error を含む) |
| ルートツールチェーン | 変更なし | workspaces / tsconfig / biome から除外 |

## Risks / Trade-offs

- [Risk] `vm.SourceTextModule` / `importModuleDynamically` が Bun 1.4.2 で動作しない → Mitigation: 実装冒頭のスパイクで確認し、動かない場合は Phase 1 方式を継続して `docs/spikes/vm-esm.md` と設計書 §4.2 の記述を「検証済み・不採用」に更新する。
- [Risk] `await` の後の同期ループで pi プロセスごと停止する → Mitigation: 既知の制約として spec とツール説明に明記し、`reset` では回復できないこと(プロセスの再起動が必要)をツール説明に書く。
- [Risk] 実行時エラーの行番号が元の TS の行と一致しない → Mitigation: 変換後コードの抜粋を必ず添え、行番号の基準を spec とツール説明に明記する。
- [Risk] Bun のスタック形式や `AsyncLocalStorage` の伝播が Bun の更新で変わる → Mitigation: 解析を `format.ts` の 1 関数に集約し、"runtime error excerpt" と "late print discarded" のテストで検出する。
- [Risk] モデルが `const` の永続を期待して後続セルで ReferenceError を起こす → Mitigation: ツール説明で規則を示し、ReferenceError の提案文で `globalThis` への代入を案内する。
- [Risk] ルートから除外した結果、`packages/spirits` が既存 check/CI の対象外になる → Mitigation: パッケージ内に `bun test` と型検査のスクリプトを用意し、bun.lock 移行時に CI へ組み込む別 change を起こす。
- [Risk] ローカル型ミラー(`src/types/pi-coding-agent.d.ts`)が上流 Extension API と乖離する → Mitigation: 上流 API を追加採用するときにミラーを同期する。型検査はミラーだけを見るため、乖離は型エラーにならず実行時に露見し得る。
- [Risk] Bun.Transpiler が `require` を畳み込み、`__dirname` / `__filename` を注入して、許可外のホストグローバルがセルから見える → Mitigation: IIFE の引数で影にし、セル実行経由の hidden-globals テストで検出する。
- [Risk] 上流マージでルートの `package.json` / `tsconfig.json` / `biome.json` が衝突する → Mitigation: 変更を 1 つの `[spirits]` コミットに分離し、差分を 1 行ずつに抑える。
- [Risk] HostFnRegistry 経由で後段機能がコアへ漏れる → Mitigation: 登録エントリを不透明な値として扱い、REPL コアの import 監査をタスク 5.4 で確認する。
- [Risk] Bun 版 REPL が通常の pi 開発フローと衝突する → Mitigation: `SPIRITS_DEV=1` で verbose ログを出す口だけ用意する。

## Migration Plan

新規パッケージのためデプロイ移行はない。ロールバックは `packages/spirits` の削除と、ルート `package.json` / `tsconfig.json` / `biome.json` を変更した `[spirits]` コミットの revert で行う。

## Open Questions

なし。
