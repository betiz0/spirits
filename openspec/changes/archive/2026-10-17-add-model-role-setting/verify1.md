# 検証レポート: add-model-role-setting

検証日時: 2026-10-17（verify1、`/opsx-verify`）
スキーマ: `spec-driven`（proposal / specs / design / tasks すべて存在、意図的なスキップなし → 未検証のチェックなし）

## サマリー

| 観点 | 状態 |
|--------------|--------------|
| 完全性 | 28/28 タスク完了、要件 11 件（ADDED 2 / MODIFIED 9）すべてに実装 |
| 正確性 | 11/11 要件をカバー、シナリオ 66 件のうち 63 件は専用テスト、3 件は目視確認 |
| 一貫性 | design の 11 決定すべてに準拠、README 4 ファイルに 1 件の文言矛盾 |

## 証拠

- `openspec instructions apply` の `progress`: total 28 / complete 28 / remaining 0
- 再実行した検証:
  - `cd packages/spirits && bun test` → 557 pass / 0 fail（タスク 5.1）
  - `./test.sh`（リポジトリルート、e2e 除く）→ EXIT=0（タスク 5.2）
  - `npm run check` → EXIT=0（タスク 5.3）
  - coding-agent 関連 5 ファイル（`model-roles`、`model-command-args`、`interactive-mode-model-command`、`settings-manager`、`custom-editor-submit-shortcut`）→ 118 pass
- `openspec validate add-model-role-setting --strict` → `valid: true`（issues なし）
- 登録簿: `git log -E --grep='^\[spirits\]' --oneline` は 16 行、`docs/spirits-core-diffs.md` のデータ行も 16 行で一致（タスク 5.4）。コア変更はこの変更の 1 コミット `a59d23dd0` のみ
- 仕様の内訳: `specs/model-commands/spec.md` MODIFIED 5（シナリオ 32）+ RENAMED 3、`specs/dual-model-routing/spec.md` MODIFIED 4 + ADDED 2（シナリオ 34）。REMOVED は 0
- RENAMED 3 件はいずれも MODIFIED 側に同名があるため、MODIFIED 本文に照らして検証した。`openspec/specs/model-commands/spec.md` は FROM 名のままだが、アーカイブは RENAMED → REMOVED → MODIFIED の順に適用される（`specs-apply`）ので同期は成功する

## 重大

なし。

- 未完了タスク 0 件
- ADDED 2 要件に実装がある
  - 既定ロールの読み取り: `packages/spirits/src/config.ts:130`（`readDefaultRoleSetting`）、適用は `packages/spirits/src/routing/register.ts:103`
  - `/model` によるロールのロック: `packages/spirits/src/routing/phase.ts:43`（`setRole`）、語彙登録は `packages/spirits/src/routing/register.ts:97`
- REMOVED 要件なし。改名した 3 要件の振る舞いは MODIFIED 本文どおり維持されている

## 警告

1. **README の説明が spec と矛盾する（4 ファイル）**
   - 該当: `README.ja.md:83`、`README.md:95`、`README.de-CH.md:79`、`README.zh.md:79`（「物理モデルを選んでいると振り分けしないため、ロックはバッジにだけ現れます」）
   - 実態: `packages/coding-agent/src/core/agent-session.ts:1477` が仮想モデル以外では `routedRole` を `undefined` にするため、物理モデル選択中はバッジ自体が出ない
   - 仕様: `specs/dual-model-routing/spec.md`「物理モデルを直接選んだセッションでは振り分けない」は「`/model` で設定したロックは変わらず、`spirits/auto` へ切り替えた後のリクエストに使われる」
   - 推奨: 4 ファイルの当該文を「物理モデルを選んでいる間は振り分けもバッジも無く、ロックは `spirits/auto` に戻して以降のリクエストから効く」に書き換える（タスク 5.5 の検証範囲内）

## 提案

1. **`/model` ロックがセッションに書き込まないことをテストしていない**
   - spec の Scenario「ロック設定だけではバッジが変わらない」は `onSelect` が `appendEntry` を呼ばないことに依存するが、`packages/spirits/test/routing-register.test.ts` の `locks the role a /model selection reports` はロールの切替しか検証していない
   - 推奨: そのテストで `pi.entries`（`appendEntry()` に渡された entry、`packages/spirits/test/routing/fake-pi.ts:43`）が空のままであることを 1 行足す
2. **proposal の Impact 一覧と実コミットのファイルがズレている**
   - 実装に入ったが Impact に無い: `packages/coding-agent/test/interactive-mode-status.test.ts`（fake の `getModelRoles`）、`packages/spirits/src/types/pi-coding-agent.d.ts`、`packages/spirits/src/types/pi-subpaths.d.ts`、`packages/coding-agent/src/index.ts`、`packages/spirits/test/harness-install.test.ts`、`packages/spirits/test/todo-tool.test.ts`
   - Impact に有るが未変更: `packages/coding-agent/test/virtual-models.test.ts`
   - 推奨: アーカイブ前に `proposal.md` の影響コードを `a59d23dd0` / `d70ba42f0` の実ファイル一覧へ合わせる
3. **タスク 2.4 の文言が実装とズレている**
   - タスクは「`startup` で分岐に entry が無く」と書くが、実装は pi が `session_start` 前に書く `model_change` / `thinking_level_change` を除外するため message entry の有無で判定する（`packages/spirits/src/routing/register.ts:72`）
   - design Decision 6 には説明が反映済み
   - 推奨: `tasks.md` 2.4 に「（message entry の不在で判定、design Decision 6）」を追記する

## シナリオカバレッジの内訳

専用テストがある主な対応:

- 末尾語の解釈・大文字小文字・1 語・未知の語・順序逆: `packages/coding-agent/test/model-command-args.test.ts`
- selector 経由・キャンセル・保存・`Default role:` 表示・引数ヒント・2 語目補完: `packages/coding-agent/test/interactive-mode-model-command.test.ts`
- 入れ子キーの保存と兄弟キー保持: `packages/coding-agent/test/settings-manager.test.ts`
- 差し替えエディタからの保存: `packages/coding-agent/test/custom-editor-submit-shortcut.test.ts`
- 既定ロールの読み取り（strong / STRONG / 未設定 / banana / 空）: `packages/spirits/test/config.test.ts`
- ロック中の idle 入力、settle でロックへ戻る、normal での解除: `packages/spirits/test/routing-phase.test.ts`
- 新規セッション記録・物理モデルでは記録しない・復帰では記録しない・`/reload` で既定ロール・分岐移動でロック維持・`state` 引き継ぎ: `packages/spirits/test/routing-register.test.ts`
- ロックしたロールのルート、対象スキル run を跨ぐ保持: `packages/spirits/test/routing-router.test.ts`、`routing-integration.test.ts`
- 実 pi への語彙登録と末尾語の受領: `packages/spirits/test/pi-runtime/model-roles-api.test.ts`

専用テストが無く、タスク 6.1〜6.7 の対話モード目視で確認したもの:

- 物理モデル選択中にロックし、`spirits/auto` へ戻した後のリクエストに効く（`振り分け用のモデルの選択解除ではロックが消えない`、`物理モデルで設定したロールが振り分け開始後に効く`）
- ロック設定自体ではバッジが変わらない（実装は `appendEntry` を呼ばないことで構造上保証）

## 最終評価

重大な問題はありません。考慮すべき警告は 1 つあります。アーカイブの準備ができました（改善点が指摘されています）。提案も 3 件あります。

作業ツリーには他セッションの変更（`openspec/changes/add-colorful-startup-mark/`、`add-sprt-bundled-skills` の削除と本仕様の更新、`bun.lock`）があるため、アーカイブ時のステージは明示パスに限る。
