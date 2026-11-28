# 検証レポート: enforce-verification-report-saving

検証日時: 2026-11-26 / スキーマ: spec-driven / 検証者: /opsx-verify

## サマリー

| 観点   | 状態 |
|--------|------|
| 完全性 | 19/19 タスク完了、13 要件すべてに実装対応 (ADDED 11 / MODIFIED 2、REMOVED・RENAMED なし) |
| 正確性 | 13/13 要件をカバー。36 シナリオのうち 34 をテストまたは実測 evidence、2 を静的証拠で確認 |
| 一貫性 | 設計 13 決定すべて準拠。層登録・docs・実測 evidence が整合 |

## 完全性

### タスクの完了

`openspec instructions apply` の progress: **19/19 complete、remaining 0**。未完了タスクなし。

### 仕様範囲

仕様の ADDED / MODIFIED 全 13 要件の実装をコードで確認した。

**`verification-report-saving` (ADDED 10 要件)** — 実装先 `packages/spirits/src/verify/`:

| 要件 | 実装 |
|------|------|
| 検証ステップのあいだだけ保存手段を有効にする | `verify/register.ts:72` の `syncActive`(`getActiveTools` 読取 + 和集合追加、自分の名前のみ除去)+ `tool.ts:53` の `defaultActive: false`、`promptSnippet` / `promptGuidelines` |
| 検証対象は入力から固定し、モデルの申告では動かない | `verify/pin.ts:31`(`offer` は完全一致のみ、書き込み経路は model に公開されない)+ `register.ts` の input ハンドラ(`INPUT_SOURCE_EXTENSION` 除外、`firstArgumentFromInput`) |
| 検証が有効でない保存要求は書き込み前に拒否する | `tool.ts` execute の実行時ガード(`activePrefix()` / `pinned()` を書き込み前に確認) |
| 検証種別ごとの連番でファイル名を決める | `report-name.ts:34` + `constants.ts:906` `VERIFY_REPORT_PREFIXES`(`opsx-verify`→`verify`、`sprt-opsx-verify-deep`→`d-verify`)。最大値+1・欠番を埋めない |
| 既存のファイルを上書きせず、完全な本文だけを残す | `report-name.ts` の系列外一時ファイルへ `wx` + `rename`、EEXIST 時に次連番再試行(上限 `constants.ts:928`)、失敗時一時ファイル削除 |
| 保存の受理と応答 | `save.ts:21`(解決→採番→作成、空・空白のみ本文を拒否、パラメータは `body` のみ) |
| 保存されるまで検証を完了として扱わない | `register.ts:167` の `agent_before_settle`(1 回だけ `continue: true` + `custom_message`、その後は 1 回通知、保留は督促せず枠も消費しない) |
| 督促の境界と通知の経路 | 対話判定 `ctx.mode in {tui, rpc}`、非対話は `process.stderr.write`(`writeStderr` 注入)、`session_start` / `session_tree` で obligation・pin 破棄 |
| 検証プロンプトの再生成に依存しない | 実装はホスト API のみ(`.pi/prompts` への参照なし、git 差分にもなし) |
| 後段フェーズ機能への非依存 | `verify/` の import は `constants` / `routing/phase`(型のみ) / ホスト / typebox のみ。規約検査が通っている |

**`sprt-opsx-verify-deep` (MODIFIED 2 + ADDED 1 要件)** — `harness/bundled-skills/sprt-opsx-verify-deep/SKILL.md`(v1.2):

- 読み取り専用の例外(保存手段からのみ、既存ファイルは不変): `SKILL.md:17`、`SKILL.md:285-288`(ツール経由保存・全文出力維持・パス報告・ツールが無効な環境では出力のみ)
- 検証レポートの出力(保存手段へ本文を渡さなければ未完了): 同上 + `bundled-skills.test.ts:280` の本文アサーション
- 検証レポートを証拠の読み取りに含めない(Phase A で `verify<N>.md` / `d-verify<N>.md` を読まない): `SKILL.md:44`

## 正確性

### 要件実装マッピング

13/13 要件に上記の実装対応あり。乖離は見つからなかった。

### シナリオの対象範囲

36 シナリオのうち 34 が専任テストまたは実測でカバー:

- `test/verify-report-save.test.ts`(9 テスト): 採番(空・最大+1・欠番・系列分離)、競合再番号、既存不変、書込失敗で部分なし、番号上限、解読不能の名前、空本文
- `test/verify-report-tool.test.ts`(6): 実行時ガード 2 種、body 専用パラメータ、成功時のパス返却
- `test/verify-report-pin.test.ts`(4): 完全一致のみ固定、空行、clear、モデル到達経路なし
- `test/verify-report-register.test.ts`(10): step 開始/終了/中断での窓、検証外ステップ(`opsx-apply`)で無効、他ツール名不変、回答の固定、steer 無視
- `test/verify-report-nudge.test.ts`(10): 督促 1 回→通知 1 回→静默、保存済みは不出動、保留は枠を消費しない、中断、`print`/`json` は stderr のみ、reload
- `test/verify-report-change-root.test.ts`(4)・`test/constants-verify-report.test.ts`(3)
- 実測: `evidence/verify-report.json`(pi 1.6.0・RPC・`spirits/auto`・fake provider、判定 8 項目 all-holds true — 宣言窓、保存の byte 一致、チャット本文一致、保留で何も要求しない、督促継続恰好 1 回、回答 run でも表示)

静的証拠のみ(テストなし)のシナリオ 2 件は下記の提案に記録。

## 一貫性

### 設計の遵守

design.md の Decision 1〜13 すべてに準拠:

- D1 spirits が保存・body 専用 / D12 pin はユーザー入力のみ / D13 関数注入(`VerifyReportDeps`、DI コンテナなし)— 実装どおり
- D2 新兄弟層 `spirits:verify` — `docs/architecture/convention-registry.md:35`(layers)`:55`(members)`:21`(13 層化)`:118`(ARCH-PI-BOUNDARY 例外文)が同一変更で更新済み
- D3 `openspec status --change --json` の `changeRoot`(`--store` は指定時のみ)— `change-root.ts:92-129`
- D4-D5 連番と wx+rename — 上記
- D6-D10 の督促・モード・メモリのみ状態 — `register.ts` + nudge テスト
- D7 の実測修正(`canContinue` はドラフト前計算なので条件に使わない)は design 側にも反映済み(Decision 7 追記、Open Questions 解消記録)
- D11 SKILL.md 条件付き誘導 + フォールバック — `SKILL.md:285-288`

### コードパターンの一貫性

- 既存の兄弟層と同じ形(`index.ts:204` の `optional(...)`、登録失敗は DEGRADED 通知で続行)
- 固定値はすべて `constants.ts:897-985`(ツール名・prefix・上限・文言・モード語)、`repl/spill.ts` の `wx` 慣例の発展
- `verify` 層は `routing` を読み取りのみで参照(registry の記述と一致)

大きな逸脱なし。

## 問題

### 重大

なし。

### 警告

なし。

### 提案

1. シナリオ「検証プロンプトが再生成される」は自動テストがなく、静的証拠(実装が `.pi/prompts` を一切読まないこと、git 差分にプロンプト編集がないこと)での確認。テストを追加するなら「input→settle の督促がプロンプト本文に依存しないこと」をダミーテンプレートで回す形になる(`test/verify-report-nudge.test.ts` に 1 テスト)。推奨: アーカイブ前に追加するか、このレポートの静的確認で十分と判断してよい。
2. シナリオ「非対話でも保存は同じ規則で効く」は `tool.execute` にモード判定が存在しないことで構造的に保証されているが、`print` モード設定での保存テストは無い。推奨: `test/verify-report-tool.test.ts` に print ctx での成功保存を 1 テスト(低コスト)。

## 参考(アーカイブ前提ではない)

- design.md の Open Questions 2 件(reload 後の督促復元、自由文応答の pin)は「しない」と決めた限界の記録で、未解決の作業ではない。
- 物理モデルセッションの限界(requestResolved が走らないため聞き返しをまたぐ窓が効かない)は Risks に実測付きで記録済み。dual-model-routing 側の話として本変更の範囲外。

## 次の手順

1. 上記提案 1・2 を実施するか判断(どちらも任意)。
2. 実セッションで `/skill:sprt-opsx-verify-deep enforce-verification-report-saving` を走らせる(このレポートは `verify1.md` へ保存済み、deep 側は `d-verify1.md` になる)。
3. 問題なければ `openspec archive enforce-verification-report-saving`。
