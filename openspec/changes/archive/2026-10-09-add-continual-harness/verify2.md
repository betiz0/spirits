# 検証レポート: add-continual-harness

- スキーマ: `spec-driven`
- 対象ルート: `/home/betiz/project/spirits`（ローカル、登録ストアなし）
- 使用する変更: `add-continual-harness`（別変更を検証する場合は `/opsx-verify <other>`）
- このレポートは現行作業ツリーの再検証結果。既存の `verify1.md` は変更していない。
- 実装・仕様アーティファクトは変更せず、この報告書のみ追加した。

## サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 20/20 タスク、ADDED 要件 19 件 |
| 正確性 | 18/19 要件適合。71 シナリオを照合し、警告 1 件 |
| 一貫性 | 実装は設計に準拠。文書の改善提案 2 件 |

REMOVED / RENAMED 要件はない。`specs`、`design`、`tasks` は読み取り可能で、未検証のチェックはない。apply の進捗は 20/20 完了。

## 要件・シナリオの照合

- メモリ追記・入力検証・要約・上限・整理候補: `packages/spirits/src/harness/memory.ts`, `src/config.ts`; `test/harness-memory.test.ts`, `test/config.test.ts`, `test/harness-install.test.ts`
- `goal()` / `goal(text)`: `packages/spirits/src/harness/goal.ts`; `test/harness-goal.test.ts`
- スキル CRUD・frontmatter・名前検証: `packages/spirits/src/harness/skills.ts`, `src/harness/tools.ts`; `test/harness-skills.test.ts`, `test/pi-runtime/harness-skills-yaml.test.ts`, `test/harness-tools.test.ts`
- 案内・code-mode プロンプト・注入: `packages/spirits/src/harness/guidance.ts`, `prompt.ts`, `install.ts`; 対応する harness テスト
- 子セッション非注入・後段フェーズ非依存: 子の `tsrepl` は `rlm` のみを登録。`test/rlm-hostfn.test.ts`, `test/rlm-spawn.test.ts`, `test/harness-isolation.test.ts` で確認

## 警告

1. **末尾改行がない既存 `notes.md` への追記が前の行と連結する** — `packages/spirits/src/harness/memory.ts:116`。`notes.md` が `prior note` のように改行なしで終わっていると、`note("new note")` は `prior note- <timestamp> new note` と追記し、独立した 1 行にならない。
   - 推奨: 追記前にファイル末尾の改行を確認し、必要なら行区切りを補ってください。末尾改行のない既存ファイルから追記する回帰テストも追加してください。

## 提案

1. `docs/spirits-design.md:66` の構成図は `prompts/` を独立ディレクトリとして記載しています。既定プロンプトは `src/harness/prompt.ts` にあるため、図を実際の配置に合わせてください。
2. `docs/spirits-m4-harness.md:125` の上限説明は「後ろから切り詰める」となっています。実装では `notes.md` の古い行を先に省き、ほかのファイルを後ろから切り詰めるため、その優先順位が分かる表現にしてください。

## 検証根拠

- `cd packages/spirits && bun test`: **272 passed / 0 failed**（29 files）
- `cd packages/spirits && bun run check`: **成功**
- タスク 7.3 の静的監査は通過。後段フェーズへの import はなく、Pi 上流パッケージの差分もありません。Pi の実行時 import は `harness/paths.ts` のみで、定数監査も通過しました。
- `smoke.md` には、ソース起動・バイナリ起動の実機 smoke 10 項目すべて成功と記録されています。

補足（選択した change の範囲外）: 検証途中で誤ってリポジトリルートからテストを起動し、変更対象外の `packages/coding-agent/test/config.test.ts` で 9 件失敗しました。Bun 環境で `detectInstallMethod()` が `bun` を返し、テストが期待する `npm` または `unknown` と異なるケースです。対象の `packages/spirits` から実行した全テストは通過しており、この失敗は本変更の判定には含めていません。

## 最終評価

重大な問題はありません。考慮すべき警告は 1 件あります。未検証のチェックはなく、手順上はアーカイブ可能ですが、改善点があります。提案は 2 件です。アーカイブ操作は実行していません。
