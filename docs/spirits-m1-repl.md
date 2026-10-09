# spirits M1 設計書: 永続 TypeScript REPL

- フェーズ: M1 / 版 v1.0 / 2026-10-07
- 前提文書: spirits 設計書 v0.4(§4.1, §4.2)

## 1. 目的

Pi 拡張として「永続 TypeScript REPL ツール」を単体で動作させる。本フェーズの成果が spirits の心臓部であり、M2 以降はすべてこの上に積む。

## 2. 依存関係ルール

**許可される依存(前段・外部のみ):**

- Pi 上流の Extension API(`registerTool`, `ctx.executeTool`(codemode), `pi.appendEntry`, イベントフック)
- Bun ランタイム API(`Bun.Transpiler`)と `node:vm`

**禁止される依存(後段への参照):**

- M2 の配布基盤(bin エントリ、コンパイル環境)を import しない、存在を前提にしない。M1 は上流 pi を bun で直接起動する形で開発・検証する
- M3 の `rlm`、M4 の `goal`/`note`/skill CRUD を REPL コアから参照しない

**将来拡張点(後段が M1 に登録する形):**

- REPL コンテキストへのホスト関数注入は **レジストリ方式**とする。M1 は `HostFnRegistry`(`{ name, description, create(scope) }` の登録口)だけを定義する。M3(M4)は自分の関数(`rlm`,`goal` 等)をこの Registry に登録する。M1 コアは登録される関数の中身を知らない。これにより「後段に依存しないが後段から拡張できる」構造を保つ

## 3. スコープ

やる:

- `repl/transpile.ts`: `Bun.Transpiler({ loader: "ts" })` ラッパ。セル文字列→JS 変換、構文エラーをそのまま actionable メッセージ化
- `repl/context.ts`: `vm.createContext()` の遅延生成(初回ツール呼び出し時)、ホスト関数注入、リセット API
- `repl/cell.ts`: セル評価パイプライン(下記)
- `repl/format.ts`: 戻り値・print 出力・エラーの整形、truncate
- `tools.ts`: `pi.registerTool("tsrepl", ...)` 登録
- 注入関数(M1 時点): `out(v)`, `print(...args)`, `use(spec)`, `tool(name, args)`
- node:vm ESM 系(`vm.SourceTextModule`, `importModuleDynamically`)の実機スパイク

やらない:

- `rlm`(M3)、`goal`/`note`/skill CRUD(M4)
- パーサによる最終式自動返却(M5 で採否)
- コンパイルバイナリ、install.sh(M2)
- REPL 状態のセッション間永続化(設計書 §11、非目標)

## 4. ツール定義

- 名称: `tsrepl`。`exposure: "direct"`(モデルから直接呼べる主力ツール)、`executionMode: "sequential"`(セルを直列実行)
- TypeBox スキーマ:

| フィールド | 型 | 既定 | 意味 |
|---|---|---|---|
| `code` | string | 必須 | 実行する TypeScript セル |
| `timeout` | number(ms) | 30000 | セル実行の打ち切り。[500, 120000] にクランプ |
| `reset` | boolean | false | true なら実行前にコンテキストを再生成 |
| `description` | string | 省略可 | モデルが意図を添える欄(ログ用) |

- 戻り値: `{ value?, printed?, error? }` を整形済みテキストとして content 化。成功時は value と printed、失敗時は error のみ

## 5. セル評価パイプライン(Phase 1 明示方式)

1. `transpile.ts` で TS→JS 変換。変換エラーは「何行目のどの構文が原因か」を含めて返し、実行は行わない
2. `cell.ts` が変換結果を async IIFE で包む(トップレベル await 吸収):
   - 構造: `(async (require) => { <変換済みコード> })()` を `vm.Script`(ファイル名 `tsrepl-cell.js`)化し `runInContext` 実行。IIFE の `require` 引数は未指定なので undefined になり、Bun.Transpiler の `typeof require` 畳み込みを打ち消す
   - 戻り値の扱い: セル内で `return <expr>` または `out(<expr>)` を使った場合、その値を結果とする。どちらも無ければ value は undefined(printed のみ返る)。**最終式の自動捕捉はしない**(M5 の採否対象)
   - 永続の範囲: セルをまたいで残るのは `globalThis` への代入(`globalThis.x = ...` または宣言なしの代入 `x = ...`)だけ。IIFE 内の `const` / `let` / `function` / `class` はセル内に閉じる。この規則はツール説明でもモデルに示す
3. `use(spec)`: `node:` / `bun:` の組込と、セッション cwd を基準に解決して cwd 配下に収まる `./` / `../` 相対パスだけを許可し、動的 `import()` する。ベア指定子(同梱依存)・絶対パス・cwd 外・リモート URL は拒否し、理由を含む例外をセルへ投げる。M1 では URL 開放の opt-in を設けない(ベア指定子は M2 以降で検討)
4. `tool(name, args)`: `ctx.executeTool` で呼び出せるツール(direct ツール、codemode ツール、deferred ツール)から `tsrepl` 自身を除いたものを実行する。存在しないツール・実行失敗は、ツールのエラーテキストを含む例外としてセル内へ投げる
5. 出力捕捉: `print()` は 1 行としてバッファへ追記し、結果の printed として返す。`out(v)` は value を設定する。コンテキストのホストグローバルは `setTimeout` / `clearTimeout` / `fetch` / `URL` / `TextEncoder` / `TextDecoder` / `structuredClone` だけとし、`process` / `Bun` / `require` / `console` は提供しない(console 参照は print に誘導)
6. タイムアウト: 既定 30000ms、[500, 120000] にクランプ。同期部分は vm の `timeout`、await 中は外側の race で打ち切り、「timeout で打ち切り、部分実行でコンテキストが不整合になり得る、`reset: true` で初期化できる」と返す。**既知の制約**: `await` の後に始まる同期ループは中断できず、プロセス全体が応答しなくなる(`reset` でも回復しない)
7. 実行モード: `executionMode: "sequential"` に加え、セル評価の入口でもキューで直列化する。実行を終えたセル(timeout 打ち切りを含む)の非同期処理が後から `print` / `out` を呼んでも、その出力や値は他のセルの結果へ混ぜない

## 6. エラー整形方針(format.ts)

- 実行時エラー: 例外の種類とメッセージ + 行番号 + その行の抜粋 + 「次に試すべきこと」の提案 1 文。行番号は `tsrepl-cell.js` のフレーム行番号から 1 を引いた値(元のセル行に対応)で、抜粋は変換後コードの該当行。`console` の参照には `print` を、未定義参照(宣言を後続セルへ持ち越そうとした場合)には `globalThis` への代入を案内する
- トランスパイルエラー: `Bun.Transpiler` のエラー位置(`position.line - 1`)と `lineText` を提示し、コードは実行しない
- スタックトレースは `tsrepl-cell.js` のフレームだけを使い、ホスト側内部情報(REPL 実装ファイル、テスト)を含めない
- 出力上限: 整形後の結果テキスト全体(成功時は value / printed、失敗時は error)に 1 回適用。8,000 文字を超えたら先頭 4,800 + 末尾 3,200 を残して中間を切り捨て、切り捨てた文字数を明記する

## 7. スパイクタスク(M1 冒頭で実施)

`vm.SourceTextModule` / `importModuleDynamically` が Bun 1.4.2 で実際に動くかを最小コードで検証する(公式文書間で記述が矛盾するため)。結果に応じて:

- 動く → Phase 2 実装の選択肢として記録(M5 の判断材料)
- 動かない → Phase 1 方式を継続採用。設計書 §4.2 の該当記述を「検証済み・不採用」に更新

スパイク結果は `docs/spikes/vm-esm.md` に記録する。

## 8. テスト計画(bun test)

| # | ケース | 期待 |
|---|---|---|
| 1 | 変数を代入するセルの後、別セルで参照 | 永続コンテキストで値が残る |
| 2 | `return 式` / `out(式)` / 無返却の 3 パターン | value が正しく取れる |
| 3 | トップレベル await(Promise 返却セル) | 正しく待機して value が返る |
| 4 | 構文エラーのセル | 実行されず、行番号付きエラー |
| 5 | 実行時例外 | セル内行番号 + 提案付きエラー、コンテキストは生存 |
| 6 | timeout 超過セル | 打ち切りメッセージ |
| 7 | `use("node:fs")` 許可 / `use("https://...")` 拒否 | allowlist 動作 |
| 8 | `reset:true` | 変数が消えている |
| 9 | print 大量出力 | truncate 動作と文字数明記 |

## 9. 完了条件

- 上流 pi を `bun` で起動し、`packages/spirits` を拡張ロードした状態で `tsrepl` が使える
- 上記テスト全件パス
- スパイク結果が記録されている

## 10. リスク

- **vm ESM 未実装の場合**: Phase 1 方式のまま進む。M5 の選択肢が 1 つ減るだけで M1 は完結する
- **async IIFE ラップによる行番号ずれ**: format.ts のオフセット処理が不十分だと誤誘導する → テスト #4/#5 で担保
- **Bun 版 tsrepl が pi 開発時の通常フローと喧嘩**: 開発中は環境変数 `SPIRITS_DEV=1` で verbose ログを出す口だけ用意する
