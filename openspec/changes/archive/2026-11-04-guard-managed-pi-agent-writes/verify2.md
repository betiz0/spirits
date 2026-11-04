# 深い検証レポート: guard-managed-pi-agent-writes

- スキーマ: `spec-driven`
- 対象ルート: `/workspace`（ローカル、登録ストアなし）
- 使用する変更: `guard-managed-pi-agent-writes`
- 検証対象: `dcfe940e8`（HEAD）の未コミット変更 + 未追跡ファイル。`git merge-base HEAD main` は `3c3962f97` だが、この change の作業はすべて未コミットで、`dcfe940e8` は archive 済み `add-managed-pi-route` のコミットのため差分範囲から除外した。
- テストコマンド: `cd packages/spirits && bun test` / `bun run check` / `npm run check`（biome, pinned-deps, runtime-deps, ts-imports, entry-graphs, install-lock, tsc, browser-smoke）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし）
- verify1 レポート: 会話内の前段レポート（パスなし）
- モード: 通常

## 判定

PASS WITH WARNINGS

## サマリー

| 観点 | 結果 |
|---|---|
| テスト | 成功 748 / 失敗 0（+ architecture 79/0、compat 10/0、repo checks 全成功） |
| 規約検査 | 成功 79 / 失敗 0 |
| 要件 | 意図どおり 6 / 全 6 |
| シナリオ | 挙動を確認 26 / 全 26、テストが実質的 24 / 全 26 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| 継ぎ目 | 追加 3 件（Decision あり 3 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 1 件 |
| タスク | 完了 23 / 全 23（このレポートを反映し 1.2 / 2.3 を解除、5.1-5.3 を追加） |

互換性ランナーを実際に実行し、訂正記録の記載（`confirmed=20` / `limited=2` / `not-run=2` / `failed=0`、`data write compatibility` は `limited` + `aborted`、`<artifact-root>/agent` 未作成）を再現確認した。

## 警告

1. **`SPIRITS_CODING_AGENT_DIR=""` を未指定として扱い、design Decision 2 の「any other value ... fails」と spec の MUST に反する**
   - 場所: `packages/spirits/src/managed-pi/agent-dir.ts:207`
   - 根拠: spec ADDED「隔離保存先の明示指定」は「一致しない指定...は Pi を spawn せず理由付きで非ゼロ終了しなければならない(MUST)」。design Decision 2 は「If `SPIRITS_CODING_AGENT_DIR` is set ... Any other value ... fails before spawn」。実装は `explicit === ""` を未指定として受理する。空文字は fixed path と一致しない。ただし `packages/spirits/bin/env-defaults.ts:30` の `if (!env[ENV_AGENT_DIR])` と同じ「空は未指定」という既存規約に従っており、失敗方向は安全（隔離 dir を使う）。
   - 対応: タスク 1.2 に空文字の拒否を追加し、チェックを解除した。

2. **シナリオ「既存 agent dir の不変」の version/通常起動ステップが spawn seam で実プロセスを走らせていない**
   - 場所: `packages/spirits/test/managed-pi-integration.test.ts:63-72`、`packages/spirits/src/managed-pi/launch.ts:60`
   - 根拠: 同テストは install/update/repair/help を実 API で実行するが、`["--version"]` と `[]` の launch は `spawn: async () => 0` で Pi を置き換えている。`launchManagedPi` のテスト呼び出し 16 件はすべて spawn seam を渡しており、本番の既定経路 `spawnManagedProcess` をテストは一度も通していない。
   - 対応: タスク 2.3 に実 `spawnManagedProcess` での起動を追加し、チェックを解除した。

3. **同じヘルパーが 2 箇所に追加された**
   - 場所: `packages/spirits/test/managed-pi-launch.test.ts:8-15`、`packages/spirits/test/managed-pi-fixtures.ts:78-85`
   - 根拠: 両方とも `lstat` + `isDirectory` の同じ処理。dev ファイルなので ARCH-DUP の ratchet 対象外だが、同一 diff 内で重複している。
   - 対応: タスク 5.1 を追加した。

## 提案

1. **`docs/spirits-managed-pi.md` の runner 節の「`SPIRITS_CODING_AGENT_DIR` の優先」が新しい固定の仕組みと古い表現のまま**
   - 場所: `docs/spirits-managed-pi.md:173`
   - 対応: タスク 5.2 を追加した。

2. **許可引数と session dir 固定の結合テストがない**
   - 場所: `packages/spirits/test/managed-pi-agent-dir.test.ts:198`
   - 対応: タスク 5.3 を追加した。

## 継ぎ目

| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | 隔離 agent dir の解決・検査・引数ガードの新モジュールと公開 API | 境界 / interface | `packages/spirits/src/managed-pi/agent-dir.ts:1` | Decision 9, 10 | ARCH-LAYER, ARCH-SPIRITS-LAYER | なし |
| N-2 | wrapper から managed 経路へ渡す hand-off helper | 境界 | `packages/spirits/bin/startup.ts:1` | Decision 11 | ARCH-LAYER, ARCH-SPIRITS-LAYER | なし |
| N-3 | `ManagedCommandOptions` の test-only spawn seam | 拡張点 | `packages/spirits/src/managed-pi/command.ts:38` | Decision 11 | なし | なし |

## verify1 との突き合わせ

- verify1 提案 1（空文字）→ 警告 1 に引き上げ。verify1 が提案に留めたのは、キーワード一致と推論で design の "any other value" を読まなかったため。verify2 は design と codebase 規約を読んだうえで、失敗方向が安全なため警告に留める判断をした。
- verify1 提案 2（許可引数の起動レベル test）→ 提案 2 として維持。env 固定は別テストで証拠付けられているため警告にはしない。
- verify2 のみ: 警告 2（seam）、警告 3（重複）、提案 1（docs 表現）。verify1 が拾えなかった理由: キーワード検索ではテストの mock 置換やヘルパーの重複、文書表現の古さを検出できないため。
- 重大度の食い違いはなし（verify1 は重大・警告 0 件、提案 2 件）。

## 検証根拠

- `cd packages/spirits && bun test`: **748 pass / 0 fail**（89 files、2320 expect）
- `cd packages/spirits && bun test test/architecture-conventions.test.ts test/architecture-conventions.fixtures.test.ts`: **79 pass / 0 fail**
- `cd packages/spirits && bun run check`（`tsc --noEmit`）: 成功
- `npm run check`（biome / pinned-deps / runtime-deps / ts-imports / entry-graphs / install-lock / tsc / browser-smoke）: 成功
- `npx --yes @fission-ai/openspec@1.16.0 validate guard-managed-pi-agent-writes --strict`: `Change 'guard-managed-pi-agent-writes' is valid`
- `bun scripts/managed-pi-compat/run.ts --artifact-root <fixture-root> --out <tmp>/result.json`: 終了コード 0、`confirmed=20` / `limited=2` / `not-run=2` / `failed=0`
- `git diff --name-only` と `git status --short`: 差分は `packages/spirits/`、`scripts/managed-pi-compat/`、`docs/`、`openspec/` のみ。Pi コアと lockfile の差分なし。

## 次の手順

- PASS WITH WARNINGS: archive に進めることができるが、警告 1-3 と提案 1-2 は apply で対応する。
- タスク 1.2 / 2.3 / 5.1-5.3 を実装し、このスキルを再検証モードで実行する。
