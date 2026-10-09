# 検証レポート: add-continual-harness

- スキーマ: `spec-driven`
- 対象ルート: `/home/betiz/project/spirits`（ローカル、登録ストアなし）
- 対象成果物: proposal / specs / design / tasks
- 検証は読み取り専用。実装コードは変更していない。

## サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | タスク 20/20 が完了として記録。タスク 7.4 の `~/.spirits/agent` 既定パス確認は未検証 |
| 正確性 | 17 要件すべてに実装経路あり。13 要件は指摘差なし、4 要件に境界条件の差異 |
| 一貫性 | harness の配線・子セッション分離・Pi コア非変更は設計に一致。Layer 1 定数分類に逸脱あり |

仕様差分は ADDED 17 要件、59 シナリオで、MODIFIED / REMOVED / RENAMED 要件はない。全タスクは `[x]` で、apply の `progress` は 20/20、追跡ファイルの欠落は報告されていない。

## 要件・シナリオの照合

- メモリ追記・検証・要約・上限・整理候補: `src/harness/memory.ts`, `src/config.ts`; `test/harness-memory.test.ts`, `test/config.test.ts`, `test/harness-install.test.ts`
- `goal()` / `goal(text)`: `src/harness/goal.ts`; `test/harness-goal.test.ts`
- スキル CRUD・入力検証: `src/harness/skills.ts`, `src/harness/tools.ts`; `test/harness-skills.test.ts`, `test/harness-tools.test.ts`
- 案内・code-mode プロンプト・注入: `src/harness/guidance.ts`, `prompt.ts`, `install.ts`; `test/harness-guidance.test.ts`, `test/harness-prompt.test.ts`, `test/harness-install.test.ts`
- 子セッション非注入・後段フェーズ非依存: `src/rlm/` は変更されておらず、`test/rlm-hostfn.test.ts`, `test/rlm-spawn.test.ts`, `test/harness-isolation.test.ts` で確認

59 シナリオを実装・テストと照合しました。主要な動作経路はユニットテストまたは実機 smoke の証拠があります。下記の境界条件は一致しません。

## 警告

1. **`goal(undefined)` が getter として扱われる** — `packages/spirits/src/harness/goal.ts:39`。spec は `goal(text)` の `text` が非文字列ならエラーとしています（spec:162–164）。現在は引数なしの `goal()` と同様にゴールを取得します。引数の有無を区別し、`goal(undefined)` の拒否テストを追加してください。

2. **空の最初のユーザーメッセージを後続メッセージで置き換える** — `packages/spirits/src/harness/goal.ts:59–67`。`firstUser === ""` を未設定判定に使うため、最初のユーザーメッセージが空、または画像のみでテキストがない場合、後続のユーザーメッセージがゴールになります。spec は現在のブランチ上の最初のユーザーメッセージを使う要件です（spec:130–135）。別の `hasFirstUser` フラグで初回を固定し、空テキストのテストを追加してください。

3. **小さい文字数上限では切り詰め通知が付かない** — `packages/spirits/src/harness/memory.ts:169–176`。`SPIRITS_MEMORY_CHAR_LIMIT=1` など、通知文より小さい上限では本文の先頭だけを返します。これは design.md:75 の例外には沿いますが、spec:68–72 は上限超過時に切り詰め通知を末尾へ含めるよう要求しています。許容する最小上限、通知文、または spec の例外規定を成果物間で揃えてください。

4. **複数行 YAML の description を誤表示する** — `packages/spirits/src/harness/skills.ts:155–164`。`description: >` の block scalar は実際の説明文ではなく `>` として一覧に返ります。design.md:141 は読めない複数行 YAML 記法を空文字列にするとしています。block scalar を空として扱うか、内容を正しく読み取るかを決め、テストを追加してください。

5. **相対 `agentDir` では要約のパスが絶対パスにならない** — `packages/spirits/src/harness/memory.ts:96–111,135–138`、`src/harness/paths.ts:36–37`。`PI_CODING_AGENT_DIR` が相対パスの場合、`path.join` の結果も相対パスです。タスク 2.1 は各ファイル見出しに絶対パスを要求しています。表示用パスを `path.resolve` で絶対化し、相対 env 値のテストを追加してください。

6. **Layer 1 定数の分類が未完了** — `packages/spirits/src/harness/memory.ts:188–189`, `guidance.ts:18–34`, `tools.ts:80–131`。タスク 2.1 / 5.2 / 5.3 と design.md:280–290 は上位サロゲート範囲、案内文、ツールラベルをファイル先頭の Layer 1 定数として定義するよう指定していますが、これらは関数内または tool 定義内に直接書かれています。分類に従ってファイルローカル定数へ移してください。

## 未検証

- **タスク 7.4 の既定エージェントディレクトリ**: 前回の実プロバイダ smoke はソース起動・バイナリ起動の両方で主要動作を確認しましたが、`PI_CODING_AGENT_DIR=/tmp/spirits-smoke-agent` を指定していました。タスクに記載された `~/.spirits/agent` 既定パスでの注入・ファイル配置は未確認です。隔離した `HOME` を用意し、`PI_CODING_AGENT_DIR` を設定せずに確認してください。

## 検証結果

- `cd packages/spirits && bun test`: **251 pass / 0 fail**
- `cd packages/spirits && bun run check`: 成功
- `openspec validate add-continual-harness --strict`: 有効
- `git diff --stat -- packages/coding-agent packages/ai packages/agent packages/tui`: 空

## 最終評価

重大な問題はありません。上記 6 件の警告があり、タスク 7.4 の既定 `~/.spirits/agent` パス確認は未検証です。検証ワークフローの基準では、現時点でアーカイブ準備完了とは判定しません。
