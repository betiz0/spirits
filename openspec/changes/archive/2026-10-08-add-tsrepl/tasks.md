# Tasks

## 1. スパイクとパッケージ基盤

- [x] 1.1 `vm.SourceTextModule` / `importModuleDynamically` の最小コードを Bun 1.4.2 で実行し、結果・再現コード・Bun バージョンを `docs/spikes/vm-esm.md` に記録する。動かない場合は `docs/spirits-design.md` §4.2 の該当記述を「検証済み・不採用」に更新する。検証: `docs/spikes/vm-esm.md` が存在して動作可否の結論が明記され、不採用の場合は `rg -n "検証済み・不採用" docs/spirits-design.md` が 1 件以上一致する
- [x] 1.2 `packages/spirits/package.json`(`private: true`、依存なし、`"test": "bun test"`、`"check": "tsc --noEmit"`)、`src/index.ts`(空の拡張エントリ)、`test/smoke.test.ts`(1 件)を作成する。検証: `cd packages/spirits && bun test` が 1 件成功し終了コード 0
- [x] 1.3 ルート `package.json` の `workspaces` に `"!packages/spirits"`、`tsconfig.json` の `exclude` に `packages/spirits/**`、`biome.json` の `files.includes` に `!packages/spirits/**` を加え、`[spirits]` プレフィックス付きの 1 コミットに分ける。ルートに `node_modules` が無ければ先に `npm ci --ignore-scripts` を実行する。検証: `npm install --package-lock-only --ignore-scripts` の後に `git diff --exit-code package-lock.json` が成功し、`npx tsc --showConfig` の出力に `packages/spirits/src/` が含まれず、ルートの `npm run check` が成功する
- [x] 1.4 `packages/spirits` で `bun install --save-exact typebox@1.3.27` と `bun install --save-exact --dev @types/bun typescript@7.0.2` を実行し、`tsconfig.json`(ルートの `tsconfig.base.json` を継承、`types: ["bun"]`、`@earendil-works/pi-coding-agent` を `src/types/pi-coding-agent.d.ts` のローカルミラーに向ける `paths`)を作成する。`src/index.ts` に pi の型の `import type` を 1 つ置く。検証: `package.json` の全依存が完全固定で、`test -f packages/spirits/bun.lock && test ! -e bun.lock` が成功し、`cd packages/spirits && bun run check && bun test` が成功する

## 2. トランスパイルと整形

- [x] 2.1 `src/repl/transpile.ts` を実装する(セルを `(async (require, __dirname, __filename) => {\n` と `\n})()` で包んでから `Bun.Transpiler({ loader: "ts" })` で変換、構文エラーは `position.line - 1` の行番号と `lineText` を返す。`require` は `typeof require` の定数畳み込みを、`__dirname` / `__filename` は同 transpiler の変数注入を、それぞれ引数で影にする)。検証: `cd packages/spirits && bun test test/transpile.test.ts` の "syntax error line"、"await with return"、"shadow require dirname filename" ケースが成功する
- [x] 2.2 `src/repl/format.ts` に結果テキストの整形を実装する(`[printed]` / `[value]` / `[error]` 節、空の節の省略、`(no output)`、value の `Bun.inspect`、`isError` と `details`)と、整形後テキスト全体への出力上限(8000、先頭 4800 + 末尾 3200、切り捨て数の明記)を実装する。検証: `bun test test/format.test.ts` の "result layout"、"truncate exact limit"、"truncate over limit"、"truncate error"、"circular value" ケースと、セル実行経由の `print("x".repeat(20000))` が上限超過になるケースが成功する
- [x] 2.3 `src/repl/format.ts` に実行時エラーの整形を実装する(`tsrepl-cell.js` のフレームだけを解析、行番号 − 1、変換後コードの抜粋、REPL 実装ファイルのフレーム除去、`提案:` の 1 文、`console` の参照には `print`、未定義参照には `globalThis` への代入を案内。フレーム判定の正規表現は固定ファイル名の `.` をエスケープする)。検証: `bun test test/format.test.ts` の "runtime error excerpt"、"host frames removed"、"console suggestion" ケースが成功する

## 3. コンテキストとセル評価パイプライン

- [x] 3.1 `src/repl/registry.ts` に `HostFnRegistry` を実装する(エントリは `{ name, description, create(scope) }`、組込名を含む重複は登録時に例外)。検証: `bun test test/registry.test.ts` の "register and list"、"duplicate name throws"、"builtin name throws" ケースが成功する
- [x] 3.2 `src/repl/context.ts` を実装する(`vm.createContext()` の遅延生成、許可したグローバルの注入、`console` の `delete`、生成時点の登録名ごとの呼び出し口、reset による再生成)。検証: `bun test test/context.test.ts` の "allowed globals"、"hidden globals"、"late registration after reset" と、カスタム登録した `hello` をセル `return hello()` から呼べる end-to-end ケースが成功する
- [x] 3.3 `src/repl/cell.ts` を実装する(入口のキューによる直列化、`AsyncLocalStorage` によるセル単位の `scope`、transpile → `vm.Script.runInContext` → await、`return` の値回収、reset 時の再生成、エラー後のコンテキスト維持)。検証: `bun test test/cell.test.ts` の "persists globalThis"、"undeclared assignment persists"、"declarations stay in cell"、"top-level await"、"return value"、"syntax error not executed"、"runtime error keeps context"、"reset clears values"、"host functions after reset"、"hidden globals through pipeline"、"no-return cell"、"late out discarded" ケースが成功する
- [x] 3.4 `src/repl/hostfns.ts` に組込関数 `out(v)` / `print(...args)` を実装する(文字列はそのまま、その他は `Bun.inspect`、半角スペース連結、終了済みセルからの書き込みは破棄)。検証: `bun test test/hostfns.test.ts` の "out value"、"no return"、"print capture"、"print circular"、"console reference" ケースが成功する

## 4. use / tool / timeout

- [x] 4.1 `src/repl/hostfns.ts` に `use(spec)` を実装する(`node:` / `bun:` と、`ctx.cwd` 基準で cwd 配下に収まる `./` / `../` だけを許可、それ以外は拒否、リモート URL は「M1 では未対応」、指定子を含む例外。cwd 外判定は `..` をパス区切りまで見る)。検証: `bun test test/hostfns.test.ts` の "use node builtin"、"use cwd relative"、"use rejects remote"、"use rejects bare"、"use rejects outside cwd"、"use missing module"、"use allows dot-prefixed in-cwd path" ケースが成功する
- [x] 4.2 `src/repl/hostfns.ts` に `tool(name, args)` を実装する(`tsrepl` 自身は実行せずに例外、`executeTool` に `scope.signal` を渡す、`isError` は例外、`structuredContent` があればそれ、無ければテキストを連結)。検証: フェイク ctx を使う `bun test test/hostfns.test.ts` の "tool text result"、"tool structured result"、"tool unknown catch"、"tool uncaught error"、"tool self call" ケースが成功する
- [x] 4.3 `src/repl/cell.ts` に timeout を実装する([500, 120000] へのクランプ、同期部分は vm の `timeout`、await 中は外側の race、打ち切り時に `scope.signal` の abort と `finished`、打ち切り・不整合・`reset: true` の案内。ツール呼び出しの signal 中断も同じ race に載せてセル待機を打ち切り、timeout 判定は `TimeoutError` または `ERR_SCRIPT_EXECUTION_TIMEOUT` で行う)。検証: `bun test test/cell.test.ts` の "timeout sync loop"、"timeout await"、"timeout lower clamp"、"timeout upper clamp"、"late print discarded"、"external abort cuts await"、"timeout message not misclassified" ケースが成功する

## 5. ツール登録と開発フロー

- [x] 5.1 `src/tools.ts` と `src/index.ts` を実装する(TypeBox スキーマで code/timeout/reset/description、`exposure: "direct"`、`executionMode: "sequential"`、ツール説明に `globalThis` による永続・行番号の基準・await 後の同期ループの制約を記載、`pi.registerTool`)。検証: `bun test test/tools.test.ts` の "tool schema"、"tool description"、"success result"、"error result"、"two calls serialized" ケースが成功する
- [x] 5.2 `SPIRITS_DEV=1` のときだけ、description・実行時間・結果の種別を verbose ログに出す口を実装する(出力先は既定で stderr、テストでは差し替え)。検証: `bun test test/tools.test.ts` の "dev log enabled" と "dev log disabled" ケースが成功する
- [x] 5.3 `packages/spirits/README.md` に開発ワークフロー(ルートの `npm ci --ignore-scripts`、`bun install --frozen-lockfile`、`bun test`、`bun run check`、pi への拡張ロードコマンド、`SPIRITS_DEV`、await 後の同期ループの制約)を記述する。検証: README のコマンドを記載どおりに実行し、`bun test` と `bun run check` が成功し、pi が tsrepl を読み込んで起動する
- [x] 5.4 後段非依存を監査する。検証: `rg -n "^\s*(import|export)\b.*from\s+['\"][^'\"]*(rlm|goal|note|skill|harness|bin/|phase-?2)" packages/spirits/src` が 0 件で、`rg -n "import\(" packages/spirits/src` が `use()` の 1 箇所だけを返す

## 6. 統合確認

- [x] 6.1 ルートで `npm ci --ignore-scripts` 済みの状態で `bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts` を起動し、`.pi/skills/interactive-testing.md` の手順(tmux)で tsrepl を実行させる。検証: `globalThis` に代入した値が次のセルで読めること、print 出力、実行時エラーの抜粋と提案、`console.log` に対する `print` の提案が、tmux の画面出力で確認できる
- [x] 6.2 テスト全件、型検査、ルートの check、スパイク記録を確認する。検証: `cd packages/spirits && bun test && bun run check` とルートの `npm run check` が成功し、`docs/spikes/vm-esm.md` が存在する
- [x] 6.3 design.md の「設計書からの変更点」を `docs/spirits-m1-repl.md` と `docs/spirits-design.md` に反映する。検証: `rg -n 'exposure: "both"' docs/` が 0 件で、`docs/spirits-m1-repl.md` に `globalThis` による永続の規則と `use()` の許可範囲が記載されている
