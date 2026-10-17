## Deep Verification Report: add-dual-model-routing

- 検証対象: `40962fa8d..c6e1b6d1c`（未コミット変更: あり。openspec の spec/design/tasks と .pi のスキル・プロンプト更新。コードの未コミット変更なし）
- テストコマンド: `./test.sh`、`cd packages/spirits && bun test && bun run check`、`cd packages/coding-agent && VITEST test/virtual-models.test.ts test/footer-width.test.ts`、root `npm run check`
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし。`spirits:routing` 層は既に登録済み）
- verify1 レポート: `openspec/changes/add-dual-model-routing/verify1.md`
- 前回 deep-verify レポート: `openspec/changes/add-dual-model-routing/deep-verify1.md`（前回 HEAD `40962fa8d`）
- モード: 再検証

### 判定
PASS

### 集計

| 観点 | 結果 |
|---|---|
| テスト | 成功 6580+ / 失敗 0（`./test.sh` 全通過、spirits 533、coding-agent 53） |
| 規約検査 | 成功 2 / 失敗 0（`architecture-conventions.test.ts`、`npm run check`） |
| 要件 | 意図どおり 14 / 全 14 |
| シナリオ | 挙動を確認 45 / 全 45、テストが実質的 45 / 全 45 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| 継ぎ目 | 追加 7 件（Decision あり 7 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 0 件 |
| タスク | 完了 22 / 全 23（9.3 は実施記録が無かったが、下記の実機確認で完了） |

### 継ぎ目一覧
前回レポートと同じ 7 件。新規の継ぎ目は追加されていない。`ALL_THINKING_LEVELS` の export は既存の登録経路の写しであり、新しい境界ではない。

### 前回指摘の再検証

#### CRITICAL（前回 3 件）
- **C-1**（非文字列 role で footer が例外で止まる）: 解消。`_storedRoutedRole()` が `typeof stored === "string"` でガードし、`sanitizeRoleLabel` はバッジ専用。テスト "reads a non-string stored role as no role" が通過。
- **C-2**（制御文字が除去されない）: 解消。`sanitizeRoleLabel` が `[\x00-\x1f\x7f]` を空白に置換し、空ならバッジを出さない。テスト "strips escape sequences from the role badge" / "omits the badge when the role is blank after sanitizing" が通過。
- **C-3**（登録簿の突き合わせコマンドが誤った行数を返す）: 解消。`git log -E --grep='^\[spirits\]' --oneline` を使い、15 件 = 登録簿 15 行で一致。

#### WARNING（前回 7 件）
- **W-1**（スキル名の区切りが pi と違う）: 解消。`phase.ts` が最初の半角スペースで区切る。テスト "ends the skill name at the first space like pi" が通過。
- **W-2**（docs/virtual-models.md の role 記述が実装と合わない）: 解消。`routedModel.role` の記述を削除し、`routedRole` の記述に統一。grep 0 件。
- **W-3**（取り込み後の diff コマンドが対象ファイルの一部しか見ない）: 解消。`packages/coding-agent packages/ai` 相当の広い対象に変更。
- **W-4**（登録簿に存在しない / 消えるパス）: 解消。`openspec/changes/` のパスが 0 件。
- **W-5**（reload テストが実質的でない）: 解消。`test/pi-runtime/virtual-model-reload.test.ts` で実 `ModelRuntime` 上の再登録を検証。
- **W-6**（thinking level の一覧が pi と重複）: 解消。`test/pi-runtime/virtual-model-api.test.ts` で pi の一覧と一致を固定。
- **W-7**（タスク 9.3 の実施記録なし）: 解消（実機確認）。下記参照。

#### SPEC（前回 2 件）
- **S-1**（登録簿の対象範囲が spec の定義と実際の登録で食い違う）: 解消。upstream-tracking spec を「1 行 = 1 `[spirits]` コミット」に改定。
- **S-2**（成功レスポンスが無いとバッジが出ない）: 解消。`AgentSession.routedRole` を `routedModel` と独立に追加し、spec に「直近の成功レスポンスの有無に依存してはならない」を追加。

### 新規に変わったファイル（40962fa8d 以降）への B-2〜B-7
- `agent-session.ts` / `virtual-models.ts`: `routedRole` の独立 getter とキャッシュ。非文字列ガードあり。テスト 8 件追加、すべて通過。
- `footer.ts`: バッジを `routedRole` から読み、バッジ専用の制御文字除去。テスト 4 件追加、すべて通過。
- `phase.ts`: スキル名の区切りを最初の半角スペースに変更。テスト追加、通過。
- `docs/*`: コマンドと記述を実装に合わせる。grep 検証通過。
- `packages/spirits/src/types/pi-coding-agent.d.ts`: ミラー追加。型検査通過。

### 実機確認（タスク 9.3）
`/tmp/test-spirits/agent-strong` 環境（`models.strong` 設定済み）で `spirits 0.5.0-test.2` を起動し、`/model spirits/auto` を選択した。
- 通常リクエスト後: フッターに `[normal]` バッジが表示され、`→ LongCat-2.5-Preview` へルートされた。
- `/skill:sprt-opsx-verify-deep add-dual-model-routing` 送信後、最初のリクエストの振り分け時点で: `[strong]` バッジが表示され、`→ beam-free`（strong 対象）へルートされた。
- Escape で中断して settled 後、次のリクエスト前: バッジは `[strong]` のまま（次のリクエストの振り分けまで更新しない）。
- 次の通常リクエスト後: バッジは `[normal]` へ戻った。
- `models.strong` を置かない場合はコード経路（strong 未設定 → 無警告で normal へフォールバック）と既存テストで固定されている。

### 次の手順
- PASS: archive に進める。タスク 9.3 のチェックボックスと実施記録は apply 工程で記入する（本検証では成果物を変更しない）。
