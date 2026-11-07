# 検証レポート: fix-managed-rlm-child-model

## サマリー

| 観点 | 状態 |
|--------------|------------------|
| 完全性 | 30/30 タスク、8 要件（ADDED 3 / MODIFIED 5） |
| 正確性 | 8/8 要件をカバー |
| 一貫性 | 準拠 |

**検証範囲**: schema `spec-driven`、`progress.remaining = 0`、`unavailableTrackingFiles` なし。仕様差分は `specs/rlm/spec.md`（ADDED 2 / MODIFIED 4）、`specs/dual-model-routing/spec.md`（ADDED 1）、`specs/managed-pi-compatibility/spec.md`（MODIFIED 1）。REMOVED / RENAMED 要件はなし。

## 完全性

**タスクの完了**: 30/30（`tasks.md` の全チェックボックスが `[x]`、apply の `progress` も 30/30）。

**仕様範囲**: 8 要件すべてに実装を確認。

| 要件 | 差分 | 実装 |
|---|---|---|
| rlm / 子セッションへ渡すモデルは物理モデル | ADDED | `packages/spirits/src/rlm/hostfn.ts:33`（`ChildModelResolver`）、`packages/spirits/src/routing/child.ts:57` |
| rlm / 解決失敗のセル内での扱い | ADDED | `hostfn.ts:147`（解決失敗を catch して利用記録の上で throw） |
| rlm / 子セッションの構成 | MODIFIED | `hostfn.ts:155-176`、`rlm/spawn.ts`（`noExtensions/noSkills/noPromptTemplates`、`tools: ["tsrepl"]`） |
| rlm / 子セッションの失敗の伝達 | MODIFIED | `hostfn.ts:305-313`（`errorFromResult` が試みたモデルを付記） |
| rlm / rlm_usage のフィールド | MODIFIED | `hostfn.ts:93-104` |
| rlm / rlm_usage の記録規則 | MODIFIED | `hostfn.ts:93-104`、`spawn.ts` |
| dual-model-routing / 振り分け用のモデルを選ぶ親の子セッション | ADDED | `routing/child.ts:57-113` |
| managed-pi-compatibility / rlm 子セッションの互換性 | MODIFIED | `scripts/managed-pi-compat/rlm.ts:243`（`classifyAutoChild`）、`fake-provider.ts:50` |

## 正確性

**要件実装マッピング**: 8/8。主な証拠:

- 物理モデルはそのまま、`spirits/auto` は位相→strong/normal、foreign virtual は明確なエラー、解決失敗はロールと不足設定を名指す: `routing/child.ts:57-113`。
- 直近の成功レスポンスは `getBranch()` を末尾から走査し、`error`/`aborted`・仮想モデル・資格情報なしを除外: `routing/child.ts:115-143`。pi 側 `findLatestResponse` との一致を `test/pi-runtime/child-model-source-pin.test.ts` がピン留め。
- 解決は直列化キュー待ちの後: `hostfn.ts:143-147`（design Decision 4）。
- `rlm_usage` は子を生成したかどうかで `provider`/`modelId` を null 化: `hostfn.ts:97-99`。
- ランナーは子のリクエストのモデル名で 3 区分判定: `scripts/managed-pi-compat/rlm.ts:243-300`、`fake-provider.ts:50`、`evidence.ts:189`。
- 設計文書の保存と訂正節: `docs/spirits-managed-pi-design.md:289`（`diff /tmp/managed-pi-design.md` は `>` 行のみ、`<` 行 0 件）。

**シナリオの対象範囲**: 全シナリオをテストで確認。`bun test` は 833 pass / 0 fail。代表的なもの:

- `test/routing-child-model.test.ts`（strong/normal フォールバック、資格情報、branch 走査の除外）
- `test/rlm-child-model.test.ts`（注入後の合成、設定変更が次の子から反映、キュー待ち中の変更）
- `test/rlm-hostfn.test.ts:880-1100`（解決失敗、null 記録、試みたモデル、入れ子解決）
- `test/managed-pi-compat-rlm.test.ts`（confirmed / failed / not-run、fixture 不足）
- `rlm_usage` の非注入は `appendEntry` → `sessionEntryToContextMessages` がカスタムエントリを空射影する共通機構で満たされる（`test/tools.test.ts:221`、`src/types/pi-coding-agent.d.ts:535-538`）。

**統合証拠**: official の `rlm auto parent` は `confirmed`（子のリクエストが `fake-model` として届き、usage に `compat-fake`/`fake-model`）。fixture は `not-run`。fork 経路の auto ケースも子が物理モデルで応答（`evidence/fork-route.json`）。

## 一貫性

**設計の遵守**: Decision 1-9 すべて準拠。層規約も維持（`rg 'from "../routing' src/rlm` は 0 件、`test/architecture-conventions.test.ts` は pass）。`npm run check` と `bun run check` は成功。

**コードパターンの一貫性**: 新規 `routing/child.ts` は既存の `resolveStrongTarget` / `resolveNormalTarget` / `ModelLookup` を再利用し、DI による注入・兄弟層の分離という既存パターンに沿う。エラーメッセージの言語も層ごとに既存慣例（routing は英語、rlm は日本語）を踏襲。

## 優先度別の問題

1. **重大**: なし
2. **警告**: なし
3. **提案**: 1 件

   - **証拠 README が秘密情報スキャンに自己ヒットする**: `openspec/changes/fix-managed-rlm-child-model/evidence/README.md:149-150` が、タスク 5.8 のスキャン対象パターン（`sk-` / `Bearer ` / `api_key` / `AKIA`）を文字列として含むため、`rg -n "sk-|Bearer |api_key|AKIA" evidence` が 2 件ヒットします。中身は秘密ではなく、走査対象の説明文です。
     - 推奨: `README.md:149-150` を、パターン文字列をリテラルで持たない言い回し（例: 「API キー形式」「Bearer トークン」「AWS キー接頭辞」）に書き換えるか、スキャンコマンドに `--glob '!README.md'` を追加して、タスク 5.8 の「0 件」条件を現在形でも満たすようにする。

## 最終評価

重大な問題や警告はありません。検討すべき提案が 1 件あります。アーカイブの準備ができました（改善点の指摘あり）。

補足: スキップしたチェックはありません。アーカイブは行っていません。可否の判断材料として、実装コミット `cb1733e198e191f0ff07e098c9eea97f60a43cda`、公式 `rlm auto parent = confirmed`、fork 経路の auto ケース成功、全テスト pass を記録します。
