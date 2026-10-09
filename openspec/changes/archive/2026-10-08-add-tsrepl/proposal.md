# Proposal

## Why

spirits の設計目標は「モデルとの主インターフェースを永続 TypeScript REPL(1ツール)とする code-as-action 構成」であり、M2 以降の全フェーズ(配布、rlm、Continual Harness)はこの REPL の上に積まれる。現状 repo には `packages/spirits` が存在せず、REPL を動かす手段がない。M1 で `tsrepl` を単体動作させ、後段が依存できる安定した土台を先に確定する。

## What Changes

- `packages/spirits/` を新設し、上流 pi の Extension API で `tsrepl` ツールを登録する(`registerTool`、直列実行)。
- 永続 TypeScript REPL のセル評価パイプラインを実装する: async IIFE で包んだセルの `Bun.Transpiler` による TS→JS 変換、`node:vm` の永続コンテキストでの実行、整形。セルをまたいで残るのは `globalThis` への代入だけとする。
- コンテキストへ注入するホスト関数 `out(v)` / `print(...args)` / `use(spec)` / `tool(name, args)` と、許可したグローバル(`setTimeout` / `clearTimeout` / `fetch` / `URL` / `TextEncoder` / `TextDecoder` / `structuredClone`)を実装する。`console` は提供しない。Transpiler が畳み込み・注入し得る `require` / `__dirname` / `__filename` も IIFE の引数で影にして提供しない。
- 後段がホスト関数を追加登録するための `HostFnRegistry`(セルごとの実行状態を受け取って関数を返すエントリの登録口)を定義する。M1 コアは登録される関数の中身を知らない。
- 出力・エラーの整形と truncate、timeout 打ち切り、reset によるコンテキスト再生成を実装する。
- ルート `package.json` の `workspaces`、`tsconfig.json`、`biome.json` から `packages/spirits` を除外し、ルートの npm/vitest/CI に影響させない。
- `vm.SourceTextModule` / `importModuleDynamically` が Bun 1.4.2 で動作するかを実機スパイクし、結果を `docs/spikes/vm-esm.md` に記録する。
- `bun test` によるセル評価のテスト群と、開発ワークフローを書いた `packages/spirits/README.md` を追加する。
- 設計書(`docs/spirits-m1-repl.md`、`docs/spirits-design.md`)に、本 change で変えた点を反映する。

非目標(設計書 `docs/spirits-m1-repl.md` §3): `rlm`(M3)、`goal`/`note`/skill CRUD(M4)、パーサによる最終式自動返却と宣言の永続化(M5)、コンパイルバイナリ / install.sh(M2)、`use()` での同梱依存の扱い(M2)、リモート URL import の opt-in、REPL 状態のセッション間永続化、`await` の後に始まる同期ループの中断。

## Capabilities

### New Capabilities

- `tsrepl`: 上流 pi の拡張として動作する永続 TypeScript REPL ツール。次を、モデルから観測できる振る舞いとして規定する。
  - セルの実行、戻り値、`globalThis` による永続
  - コンテキストのグローバル、print 出力、エラー整形
  - timeout、reset、直列実行
  - `use()` の import 許可判定、`tool()` による他ツール呼び出し
  - 後段向け `HostFnRegistry`

### Modified Capabilities

なし(`openspec/specs/` に既存仕様は存在しない)。

## Impact

- 新規パッケージ `packages/spirits/`(`src/index.ts`, `src/tools.ts`, `src/repl/{transpile,context,registry,hostfns,cell,format,guards}.ts`, `src/types/pi-coding-agent.d.ts`, `test/`, `README.md`, `bun.lock`)。既存 `packages/*` のコードは変更しない。
- **Pi 上流への差分: あり(ルート設定ファイルのみ)。** ルート `package.json`(`workspaces` に `"!packages/spirits"`)、`tsconfig.json`(`exclude`)、`biome.json`(`files.includes`)に 1 行ずつ追加し、`[spirits]` プレフィックス付きの 1 コミットに分離する。Pi 上流コア(`packages/*` のコード)への差分はない。
- 使用する上流 API: `registerTool`(`exposure: "direct"`、`executionMode: "sequential"`)と `ExtensionToolContext.executeTool`。
- 依存追加(`packages/spirits` 内、`bun install --save-exact`、`packages/spirits/bun.lock` で管理):
  - `dependencies`: `typebox` 1.3.27(coding-agent と同じ版)
  - `devDependencies`: `@types/bun`、`typescript` 7.0.2(ルートと同じ版)
  - `@earendil-works/pi-coding-agent` は依存に入れない。型は tsconfig の `paths` で `src/types/pi-coding-agent.d.ts` のローカルミラー(上流 `core/extensions/types.ts` の使用面のみ)に解決する。pi のソースは型検査対象にしない。
- ルートのツールチェーン(npm workspaces / package-lock.json / vitest / CI)は変わらない。`packages/spirits` は CI の対象外で、`bun test` と `bun run check` で自己完結して検証する。型検査と pi の起動には、ルートで `npm ci --ignore-scripts` 済みであることが前提になる。`bun.lock` 全面移行と CI 追加は M1 のスコープ外とし、必要になった時点で別途 propose する。
- ドキュメント: スパイク結果 `docs/spikes/vm-esm.md` を追加し、`docs/spirits-m1-repl.md` と `docs/spirits-design.md` に本 change で変えた点を反映する。スパイクで不採用となった場合は、`docs/spirits-design.md` §4.2 を「検証済み・不採用」に更新する。
- セキュリティ: REPL で実行されるモデル生成コードはプロセスと同一ユーザ権限で動き、`vm` はセキュリティ境界ではない(設計書 §6 の仕様)。
