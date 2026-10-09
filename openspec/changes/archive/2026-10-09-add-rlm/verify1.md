## 検証レポート: `add-rlm`

### サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 17/17 タスクに完了マーク。仕様差分は11要件（ADDED 10、MODIFIED 1）。ただしタスク6.5の厳格検証条件は未達 |
| 正確性 | 11/11要件に実装証拠あり。REMOVED / RENAMED 要件なし |
| 一貫性 | 問題あり。`SettingsManager` の共有方法が設計と実装で異なる |

### 重大

- **タスク6.5の検証条件が満たされていません。** `tasks.md:36` は `openspec validate add-rlm --strict` の成功を求めていますが、実行結果は非0終了で、要件文が500文字を超えるという警告が3件出ました（`specs/rlm/spec.md:81`, `:126`, `:206`）。
  - **推奨:** 該当要件を分割するか、例や境界条件をシナリオへ移し、`openspec validate add-rlm --strict` を再実行してください。

### 警告

- **`SettingsManager` の共有が設計と一致していません。** 設計は1つの `SettingsManager` を作成してローダーと共有するとしています（`design.md:63-64`）。一方、`spawn.ts:118-134` はローダーにも `createAgentSession` にも渡していません。上流実装ではそれぞれ別の既定値が作られます（`sdk.ts:184-188`, `resource-loader.ts:371`）。
  - **推奨:** 同じインスタンスを両方へ渡すよう実装し、必要なら型ミラーも更新するか、別インスタンスが意図的なら設計とスパイク記録を修正してください。

### 提案

- `pi-coding-agent.d.ts:7-9` は「spirits には型専用 import しかない」と説明していますが、`rlm/spawn.ts:12-25` は SDK の実行時 import を行っています。コメントを現在の解決方式に合わせてください。
- `openspec/config.yaml:30` は `例: add-tsrepl` の `: ` が未引用のため、`instructions apply` で `rules.proposal[1]` が無視される警告が出ました。該当ルール全体を引用符で囲んでください。

### 実施した確認

- `cd packages/spirits && bun test`: **152 pass、0 fail**
- `cd packages/spirits && bun run check`: 成功
- 後段機能への依存、REPL / `tools.ts` からの `rlm` 参照、Pi SDK の実行時 import 箇所、Pi コア差分を確認。いずれもタスク6.3の条件を満たしています。
- SDK とソース／バイナリの実プロバイダ smoke は `docs/spikes/sdk-agent-session.md:36-37`, `:92-99` に記録されています。この検証では再実行していません。
- 未検証・スキップしたチェックはありません。

**最終評価:** 重大な問題が1件あります。アーカイブ前に厳格検証の失敗を解消してください。警告1件、提案2件です。
