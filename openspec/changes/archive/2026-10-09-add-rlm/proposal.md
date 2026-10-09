# Proposal

## Why

spirits の設計目標 2「REPL 内から子エージェントを起動できる `rlm()` 相当の再帰機構」が未実装のままだ。M1 の `tsrepl` はセル実行と状態永続を提供するが、モデルはコードから別のエージェントへ仕事を委譲できない。M3 で RLM 的な再帰呼び出しを成立させ、code-as-action の主目的を満たす。M4(Continual Harness)と M5(Phase 2)はこの上に積まれるため、公開契約(同期・文字列返却)をここで固定する。

## What Changes

- HostFnRegistry 経由で `rlm(prompt, opts?)` をホスト関数として登録する。`await rlm(prompt)` は子エージェントの最終アシスタントメッセージを文字列で返す。不正な prompt / opts(文字列でない・空の prompt、未知のキー、有限の非負整数でない `maxDepth`)は、子を生成せず例外にする。
- 子セッションを Pi SDK の `createAgentSession()` で生成する。モデル(親に設定があれば thinking level も)を継承し、cwd を共有し、子のツール構成は `tsrepl` のみ(親の REPL 変数は引き継がないコンテキスト分離)とする。拡張・skill・プロンプトテンプレートは読み込まず、AGENTS.md などのコンテキストファイルは読み込む。認証はエージェントディレクトリの認証情報・モデル定義と環境変数に限る(`--api-key` と拡張が登録したプロバイダは非対応)。親のモデルが未設定ならエラーにする。
- 深度カウンタをホスト関数のクロージャの内部値として伝播し、`maxDepth`(既定 2)以上の深度から呼ぶと、上限値を含むモデル向けガイダンス付きエラーを返す。`opts.maxDepth` はルートからの絶対深度で、引き下げる方向にのみ働く(引き上げは継承値へ丸める)。
- 同じ REPL からの `rlm` 呼び出しを直列化する(`Promise.all` でも 1 つずつ)。
- `rlm()` 呼び出しごとの子の最大ツール呼び出し回数(既定 50)を設け、51 回目の開始で子を打ち切って途中結果サマリを返す。
- 親セル/ツール呼び出しの abort(セルの timeout を含む)を子セッションへ伝播させる。中断時のセルの結果は tsrepl の既存の中断・timeout のエラーに従う。
- プロバイダエラーで終わった子は、原因付きの例外としてセルに返す。
- `rlm` の呼び出し 1 回ごとに、`rlm_usage` カスタムエントリ(depth、sessionId、tokens、cost、durationMs、outcome)をルートセッションへ記録する。子を生成しなかった呼び出しも `outcome: "error"` で記録する。集計規約は「ルートセッション自身の usage + 全 `rlm_usage`」。
- `rlm` の使い方をモデルへ案内する。`docs/prime-agent-rlm-instruction.md` の方式を、同期・文字列返却の契約に合わせて TypeScript 向けに改修し、`rlm` を登録した tsrepl のツール説明へ合成する(ルート向け、子向け、深度上限に達した層向け)。
- `createTsreplTool` / `registerTsrepl` に追加のホスト関数を受け取る口を設け、spirits のエントリ(`src/index.ts`)で `rlm` を登録する。追加ホスト関数の `description` はツール説明へ連結する。REPL コア(`repl/` 配下)のレジストリ方式は変更しない。
- pi の実行時 import を解決するため、`packages/spirits/src/rlm/tsconfig.json`(root の `tsconfig.json` を extends)を置く。
- `docs/spikes/sdk-agent-session.md` を追加し、SDK 検証(子セッション生成、usage 取得、abort 伝播、実行時 import の解決、リソースローダーの絞り込み、`appendEntry` の非注入)の結果を記録する。`packages/spirits/README.md`、`docs/spirits-m3-rlm.md`、`docs/spirits-design.md` に確定事項と集計規約を反映する。

非目標(`docs/spirits-m3-rlm.md` §3、`docs/spirits-design.md` §4.3): M4 の memory / skill の子セッションへの自動配線、M5 の非同期 fan-out / ハンドル返却 / `agent_message`、子セッションのモデル変更多態(親継承のみ)、子セッション個別の timeout、Persistent REPL 状態のセッション間復元、`--api-key` や拡張プロバイダの子への継承(コアへのパッチが要るため)。

## Capabilities

### New Capabilities

- `rlm`: 永続 TypeScript REPL のセルから子エージェントを同期的に起動する再帰呼び出し機能。次を、外部から観測できる振る舞いとして規定する。
  - `rlm(prompt, opts?)` の文字列返却、引数の検証、子 REPL への `rlm` 公開(深度込み)
  - 深度上限(既定 2)と超過時のガイダンス、`opts.maxDepth` の引き下げと丸め
  - 子セッションの生成条件(モデルの継承、認証の範囲、cwd 共有、`tsrepl` のみ、リソースの絞り込み、コンテキスト分離)
  - モデルへの使い方の案内(ツール説明)
  - `rlm` 呼び出しの直列化
  - 親 abort(timeout を含む)の子への伝播
  - 子のツール呼び出し回数上限(既定 50)と途中結果サマリ
  - `rlm_usage` カスタムエントリへの記録(depth・sessionId・tokens・cost・durationMs・outcome)
  - 後段フェーズ機能(M4 memory/skill、M5 非同期 fan-out)への非依存

### Modified Capabilities

- `tsrepl`: 「後段フェーズ機能への非依存」の Requirement のうち、シナリオ「後段機能の非参照」の探索範囲を、`packages/spirits/src` 全体から REPL コア(`src/repl/` と `src/tools.ts`)へ限定する。`src/index.ts` が `rlm` を登録し `src/rlm/` が `rlm` を実装するため、全体を探索範囲にすると偽になる。要件の本文と他のシナリオは変えない。振る舞いの変更はなく、**BREAKING** ではない。`binary-distribution` は変更しない。

## Impact

- 新規ファイル: `packages/spirits/src/rlm/{depth,guidance,hostfn,spawn}.ts`、`packages/spirits/src/rlm/tsconfig.json`、`packages/spirits/test/rlm*.test.ts`、`docs/spikes/sdk-agent-session.md`。
- Pi 上流の `packages/*/src`(`packages/spirits` を除く)は変更しない。`packages/spirits` 内の変更: `src/index.ts`(`rlm` の登録)、`src/tools.ts`(追加ホスト関数を受け取る口とツール説明の合成)、`src/types/pi-coding-agent.d.ts`(`createAgentSession` / `SessionManager.inMemory` / `DefaultResourceLoader` / `getAgentDir` / `AgentSession` / `SessionStats` / `ExtensionAPI.appendEntry` / `ExtensionContext.model` / `thinkingLevel` などのローカルミラー拡張)、`README.md`。
- **Pi 上流コアへの差分: なし。** `createAgentSession()` は pi の公開 index から export 済み。拡張からの実行時 import は `src/rlm/tsconfig.json` で解決する(SDK スパイクの項目 4 で確認する)。`[spirits]` のコア変更コミットは不要。
- 依存追加: なし(`typebox` / `@types/bun` / `typescript` は M1 のまま)。pi パッケージは `packages/spirits` の依存には加えない。`spawn.ts` を import するテストは pi のソースを読み込むため、ルートの依存導入が前提になる(CI は既存のルート `bun install --frozen-lockfile` で足りる見込み)。
- 実行時 import の追加: `src/rlm/spawn.ts` だけが `@earendil-works/pi-coding-agent` を型だけでなく実行時にも import する(M1 までは型 import のみ)。`hostfn.ts` / `depth.ts` / `guidance.ts` は型 import のみ。
- ドキュメント: `docs/spikes/sdk-agent-session.md` を追加。`README.md` に `rlm` の使い方・深度上限・直列化・timeout の制約・認証の範囲・`rlm_usage` の集計規約を記載する。`docs/spirits-m3-rlm.md` と `docs/spirits-design.md`(§4.3、§8)に本 change で確定した点を反映する。
