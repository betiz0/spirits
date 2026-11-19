# Deep Verification Report: add-spirits-role-save-row

- 検証対象: `2b8f6d209`..`2b8f6d209`（未コミット変更: あり、32 ファイル / +5144 −349）
- テストコマンド: `cd packages/spirits && bun test`、`bun run check`、`bash scripts/test-clean-env.sh`
- strict 検証: `openspec validate add-spirits-role-save-row --strict`（成功）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし）
- モード: 通常

作業ツリーにはアーカイブ済み `improve-spirits-role-routing-visibility` の未コミット実装が同居する。`routing/phase.ts`、`routing/register.ts`、`routing/child.ts`、`src/index.ts`、`types/host.ts`、badge/status 関連テストは同変更のアーカイブ済み spec に紐づくため、本変更の spec 外変更には数えていない。

## 判定

FAIL（CRITICAL 1 件）

## 集計

| 観点 | 結果 |
|---|---|
| strict 検証 | 成功 |
| テスト | 成功 1391 / 失敗 0（`bun run check` clean、installer 97 / tmux-verify 125 pass） |
| 規約検査 | 成功（architecture-conventions を含む全テストで失敗 0）/ 失敗 0 |
| 要件 | 意図どおり 14 / 全 14 |
| シナリオ | 挙動を確認 68 / 全 69、テストが実質的 67 / 全 69 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| 継ぎ目 | 追加 6 件（Decision あり 6 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 1 件 |
| タスク | 完了 29 / 全 29（指摘反映後は 27 / 32） |

## 継ぎ目一覧

| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 指摘 |
|---|---|---|---|---|---|
| N-1 | `SettingsPatchDecider` と条件付き書き込み `patchSettingsFileIfChanged` / `patchGlobalSettingsIfChanged` | 拡張点 | `packages/spirits/src/commands/settings-store.ts:229`、`:259` | Decision 5 | なし |
| N-2 | `RoleWriteDeps.saveSettings`、`RoleWrite.wrote` の複数パス化、`partial` / `skipped` | 抽象型の拡張 | `packages/spirits/src/commands/role-write.ts:64`、`:95` | Decision 6 | なし |
| N-3 | `ModelLookup.getRegisteredProviderIds?` を手書きシグネチャで追加 | 拡張点（能力検出） | `packages/spirits/src/routing/resolve.ts:23` | Decision 3 | W-4 |
| N-4 | `RolePanelList extends SettingsList` | 抽象型（基底クラス継承） | `packages/spirits/src/commands/role-panel.ts:1162` | Decision 1 | なし |
| N-5 | `ManagedCommandsDeps.readGlobalSettings` 差し替え口 | 拡張点（テスト seam） | `packages/spirits/src/commands/register.ts:133` | Decision 5 | なし |
| N-6 | `RolePanel.activate`、`useRowId` / `useRowRole` / `SEPARATOR_ROW` / `USE_ROW_PREFIX` の export | 公開 API 追加 | `packages/spirits/src/commands/role-panel.ts:133`-`:158`、`:544` | Decision 8・12 | G-1 |

## 指摘

### CRITICAL

- **[C-1] `save` の失敗後に再描画が失敗したとき、通常行に `not redrawn` が出ない**
  - 場所: `packages/spirits/src/commands/role-panel.ts:981`-`:994`
  - 根拠: 差分 spec の scenario「失敗の理由は再描画の失敗でも失われない」は通常行の `not redrawn` を要求するが、`runSave` の `catch` は `save` 行の理由だけを書き戻す。`failSave` + 3 回目の `getSettings()` 失敗を再現したプローブで `not redrawn` は出なかった。`not redrawn` を付ける `redrawFailed()` は通常編集の経路からしか呼ばれない。テスト `the save row keeps its result when the redraw fails` もこの節を検証していない。
  - 修正先: 実装（spec を狭める場合は spec と design）
  - 推奨: `runSave` の `catch` で通常行に `REDRAW_FAILURE_PREFIX` を付け、`failSave` + `failRead: 3` のテストを追加する。

### WARNING

- **[W-1] Decision 7 の通知順序と実装が一致しない**
  - 場所: `design.md:80`、`:117` と `packages/spirits/src/commands/role-panel.ts:1114`-`:1133`
  - 根拠: design は通知を reload より先と書くが、実装は reload の前に捕捉した `ui` へ reload の後に通知する（reload が transcript を消し、`ctx` を無効化するため）。
  - 修正先: design
  - 推奨: 通知順序の記述を実装に合わせる。

- **[W-2] `describeSavePreview` が `decideSave` の既定モデル比較を再実装している**
  - 場所: `packages/spirits/src/commands/role-write.ts:369` と `:189`
  - 根拠: 同じ「2 キーが変わるか」を 2 か所で判定する。tasks 5.2 は二重に持たないと記録していたが、実装は持っている。
  - 修正先: 実装
  - 推奨: 予告は `decision.writes` から変更有無を読む。

- **[W-3] 起動時スコープのシナリオに対応する自動テストがない**
  - 場所: `specs/managed-commands/spec.md:34` と `packages/spirits/test/managed-role-command.test.ts`
  - 根拠: 保存がセッションのモデルスコープを書かないことを検証するテストが無い。挙動は隔離した固定版 Pi で確認済み。
  - 修正先: 実装（テスト追加）
  - 推奨: 条件付きパッチのキー集合に `enabledModels` が無いことを固定する。

- **[W-4] `ModelLookup.getRegisteredProviderIds` のシグネチャが手書き**
  - 場所: `packages/spirits/src/routing/resolve.ts:17`-`:24`
  - 根拠: ホストは `ModelRegistry#getRegisteredProviderIds(): readonly string[]` を公開している（`dist/core/model-registry.d.ts:61`）。他の 2 メンバーは `Pick<ExtensionModelRegistry, …>` で導出している。`AGENTS.md` の導出規則と `ARCH-PI-BOUNDARY` の趣旨に反し、検査は `.d.ts` / `declare module` しか見ないため検出しない。
  - 修正先: 実装
  - 推奨: `ExtensionModelRegistry["getRegisteredProviderIds"]` から導出する。

### SPEC

なし。

### SUGGESTION

- **[G-1] `USE_ROW_PREFIX` は公開する必要がない**（`packages/spirits/src/commands/role-panel.ts:142`）
- **[G-2] 生値比較の MUST が `models.role` にも読める**（`specs/managed-commands/spec.md:6`）。`defaultProvider` / `defaultModel` に限定した。
- 資格情報の由来（global の保存か、このプロセスだけの環境変数か）はホストが公開していない。design Decision 3 に既知の限界として記録した。

## 次の手順

指摘を成果物へ反映済み。3.4・5.2 を未完了に戻し、5.5〜5.7 を追加した。`openspec validate --strict` は成功（32 タスク、27 完了、残り 5）。
