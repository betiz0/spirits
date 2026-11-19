# 検証レポート: `add-spirits-role-save-row`

| 観点 | 状態 |
|---|---|
| 完全性 | 18/18 タスクが完了扱い。10 要件（追加 3・変更 7）すべてに対応箇所あり。既存の要件名・シナリオ名は保持され、追加要件名の重複なし |
| 正確性 | 10/10 要件を実装・文書に対応付け。保存判定に境界ケース 2 件の相違。シナリオの対象範囲は一部未検証（保存済み strong・normal と `--models` による実ホスト起動） |
| 一貫性 | 一覧とコマンドは保存処理を共有し、既存の設定ストア・ルーター・公開 TUI API を再利用。ファイルがない場合のロック順序に警告 1 件 |

主な照合先は、保存判定と確定処理が `packages/spirits/src/commands/role-write.ts:172`、一覧の入力制御と終了時の再読み込みが `packages/spirits/src/commands/role-panel.ts:948`・`:981`、コマンド文法・通知・補完が `packages/spirits/src/commands/role.ts:130` と `packages/spirits/src/commands/register.ts:183`・`:691`、ホストとの操作の区別が `docs/spirits-managed-pi-design.md:132`。クリック非保存は実端末での観測ではなく、固定版 `SettingsList` を駆動する `packages/spirits/test/managed-role-panel.test.ts:631` で確認した。

## 重大

なし。

## 警告

1. **Pi が既定値として解決できないディスク値を「変更なし」と判定する。** `packages/spirits/src/commands/role-write.ts:173`・`:181` は `packages/spirits/src/config.ts:131` で前後の空白を除いた値を比較する。たとえばディスクの `defaultProvider` が `" compat-fake "` なら、セッションの `compat-fake` と同じと判定して保存しない。一方、Pi 1.5.0 はディスク値をそのままモデル検索に使う。`defaultProvider` と `defaultModel` の差分判定・予告にはディスクの生値を使い、空白付きの旧値を正規の選択値で書き直すテストを追加する。
2. **設定ファイルがない場合、ロック外の初期化書き込みが先行する。** `packages/spirits/src/commands/settings-store.ts:152` では、存在確認と `{}` の書き込みの間に別プロセスが初回保存を済ませると、その内容をロック取得前に消せる。ファイル作成もロック下に移し、ファイルがない状態からの同時初回保存で無関係なキーが残ることをテストする。
3. **タスク 4.3 の実走記録は、要求された起動条件を再現していない。** `openspec/changes/add-spirits-role-save-row/tasks.md:32` の記録では、起動時に保存されていたのは normal で、strong は起動後にコマンドで切り替えている。normal の応答確認は物理モデルでの起動、スコープ確認は `--models` ではなく `--model`。Pi 1.5.0 の隔離環境で、保存済み `spirits/auto` からの初回要求を strong・normal それぞれで確認し、別途 `--models` で `spirits/auto` を除外した起動と設定ファイル不変を記録する。

## 提案

なし。

## 最終評価

`openspec validate add-spirits-role-save-row --strict`、`bun run check`、`bash scripts/test-clean-env.sh` は成功（Bun 1,366 件、installer 97 件、tmux-verify 125 件、失敗 0）。

**実行したチェックでは重大な問題は見つからなかった。警告は 3 件。** タスク 4.3 の起動シナリオは、記録の条件が仕様と異なるため未検証。アーカイブ準備完了とは判定しない。検証時に実装・計画成果物の編集、仕様同期、アーカイブは行っていない。
