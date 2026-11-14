# 検証レポート: unify-spirits-role-command

使用する変更: **unify-spirits-role-command**（他の変更を検証する場合は `/opsx-verify <name>`）

## サマリー

| 観点 | 状態 |
|------|------|
| 完全性 | 42/42 タスク、39 要件（ADDED+MODIFIED）、削除 2 件を確認 |
| 正確性 | 39/39 要件をカバー（1 件で仕様との相違、2 件でシナリオのテスト不足） |
| 一貫性 | 問題あり（design D11 / tasks S-3 と実装が不一致） |

証拠:

- `packages/spirits` の関連テスト 16 ファイルを実行し全て pass（48 + 65 + 76 + 139 件）
- `npm run check` はエラー・警告・info なしで通過
- `git status` で `packages/coding-agent` / `packages/tui` / `packages/ai` の差分なし
- `/spirits-model` の実装・登録・src/test/scripts の参照は削除済み（残るのは docs の移行表と当時の実測記録 `docs/agent-data-compat/.../result.json` のみ）
- 未検証（スキップしたチェック）はなし

## 重大

なし。

## 警告

1. **一覧が「1 ステップ 1 行」になっていない**
   `packages/spirits/src/commands/role-panel.ts:263` はステップごとに `role` と `thinking` の 2 行を作る。仕様 `managed-commands/spec.md:215` は「ステップは 1 ステップを 1 行とし、そのステップのロールと thinking レベルの組を 1 つの設定項目として扱う。(SHALL)」とし、`design.md:113` と `tasks.md:58`（verify2 S-3）も行数を `1 + 2 * 2 + STEP_DEFINITIONS.length`、値の形を `<role> / <thinking>` と決めている。実装とテスト（`test/managed-role-panel.test.ts:95`）は `STEP_DEFINITIONS.length * 2` 行を前提にしており、決定と食い違う。
   推奨: ステップ 1 行に `currentValue: "<role> / <thinking>"` を持たせ、Enter でロール → thinking の候補を順に開く 1 項目にまとめる（`navigateTo` の連鎖はそのまま使える）。テストの行数期待も `1 + 2 * 2 + STEP_DEFINITIONS.length` に直す。

2. **シナリオ「テンプレートとスキルで同じステップ」を検証するテストがない**
   仕様 `dual-model-routing/spec.md`（strong フェーズの開始）は `/opsx-ff` と `/skill:openspec-ff-change` が同じステップを開始することを要求するが、`test/routing-phase.test.ts` の開始コマンドはすべて `source: "skill"` で、`prompt` ソースのスラッシュコマンドを通すケースが 0 件。
   推奨: `phaseWithCommands` に `{ name: "opsx-ff", source: "prompt" }` を渡し、`/opsx-ff` で `opsx-ff` ステップが始まることを `test/routing-phase.test.ts` に追加する。

3. **シナリオ「SKILL の読み取りだけでは遷移しない」を検証するテストがない**
   入力イベントが無いまま位相が変わらないことが要求だが、対応するテストが無い（`input` が来なければ位相は変わらない、という実装依存の確認のみ）。
   推奨: 開始コマンドを送らずに `settle()` / 次の `input` を処理させ、`phase.step()` が undefined のままであることを 1 ケース追加する。

## 提案

1. **status のロール解決行に strong の thinking レベルが出ない**
   仕様 `managed-commands/spec.md`（`/spirits-role status` は稼働状況を出す）は両ロールの「thinking レベル」を要求するが、`roleResolutionLines`（`src/commands/role.ts:352` 付近）は strong が未設定・使用不可のときレベルを付けない。normal は `thinkingSuffix` を付ける。strong が未設定なら「未設定」でよいが、設定済みで使用不可のときは要求レベルを出すと原因が追いやすい。
   推奨: strong の `unusable` / `unset` 行にも `models.thinking.strong` があれば `, thinking <level>` を付ける。

2. **一覧の「該当する行」に strong 未解決の警告が出ない**
   仕様は「一覧では警告の通知を出さず、同じ内容をロックの行と該当する行の説明に出す」とするが、警告は `lockWarning`（`src/commands/role-panel.ts:341`）でロック行にのみ連結され、ステップの strong 行や strong の model 行の説明には出ない。ロック行だけで内容は読めるため重大ではない。
   推奨: strong の model 行と strong を設定したステップ行の説明にも `strong has no usable model` 相当を付ける。

3. **補完が 4 語目でも候補を返す**
   `roleCompletions`（`src/commands/register.ts:376`）は 3 語の後ろに空白がある（`"normal thinking high "`）と再び level 候補を返す。文法は 3 語までなので、入力済みの語数で打ち切ると挙動が揃う。
   推奨: `tokens.length > 2` のとき 3 語目の候補を返さない（`"strong model x y "` の null と同じ扱い）。

## 最終評価

**重大な問題はありません。考慮すべき警告は 3 つあります。アーカイブの準備はできています（改善点が指摘されています）。** 提案は 3 件です。
