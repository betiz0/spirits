# OpenSpec Change Review: repair-managed-pi-compat-harness

## 収集ログ

- 実行したコマンドと結果の要約:
  - `bunx @fission-ai/openspec --version` → `1.16.0`(`openspec` は PATH に無いため `bunx @fission-ai/openspec` を使用)
  - `openspec status --change "repair-managed-pi-compat-harness" --json` → schemaName `spec-driven`、planningHome.root `/workspace`、changeRoot `/workspace/openspec/changes/repair-managed-pi-compat-harness`、proposal/specs/design/tasks すべて status `done`
  - `openspec validate "repair-managed-pi-compat-harness" --strict` → `Change 'repair-managed-pi-compat-harness' is valid`(ERROR/WARNING/INFO なし)
  - `openspec list --json` → active change は本 change のみ(全 38 タスク、完了 0)
  - `git log --oneline -10 -- openspec/changes/repair-managed-pi-compat-harness/` → 出力なし(未コミット)
  - `ls -l` で更新順を取得
- OpenSpec のバージョン: **1.16.0**(審査基準の compatibility は 1.11.0。版が異なる)
- change 名: `repair-managed-pi-compat-harness` / schemaName: `spec-driven` / planningHome.root: `/workspace` / skip_specs: なし / retire_capabilities: なし / config.yaml の rules: あり(proposal・specs・design・tasks)
- 規約正本: `docs/architecture/convention-registry.md`
- 読んだファイル:
  - change: `proposal.md` / `design.md` / `tasks.md` / `.openspec.yaml` / `specs/managed-pi-compatibility/spec.md`
  - 現行 spec: `openspec/specs/managed-pi-compatibility/spec.md`(存在)
  - 設定: `openspec/config.yaml`
  - 規約: `docs/architecture/convention-registry.md`
  - 既存コード: `scripts/managed-pi-compat/{run,fake-provider,data,matrix,probes,rpc,rlm,tsrepl,runner,labels}.ts`、`scripts/managed-pi-compat/fixtures/{custom-provider,probe-extension}.ts`、`packages/spirits/src/managed-pi/{agent-dir,environment,manifest,verify}.ts`、`packages/spirits/src/{constants,config}.ts`、`packages/spirits/src/routing/register.ts`、`packages/ai/src/api/openai-completions.ts`、`packages/coding-agent/src/core/extensions/{loader,types}.ts`
  - テスト: `packages/spirits/test/managed-pi-compat-*.test.ts`
  - 文書: `docs/spirits-managed-pi.md`、`docs/spirits-m3-rlm.md`、`docs/spirits-design.md`、`openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md`
  - 存在しなかった現行 spec のパス: なし
- 既存実装の探索に使った語と範囲: `MANAGED_PI_FIRST_ARTIFACT_SHA256` / `resolveManagedAgentPaths` / `ensureManagedAgentDir` / `computeManagedEnv`(`packages/spirits/src/` と `scripts/managed-pi-compat/`)、`getSettings` / `appendEntry` / `setThinkingLevel` / `getThinkingLevel` / `setModel`(`packages/coding-agent/src/`)、`registerModelRoles`(`packages/`)、`get_commands`(`scripts/managed-pi-compat/` と `packages/spirits/src/`)、`openai-completions`(`packages/ai/src/api/`)
- 成果物の更新順(新しい順): `tasks.md`(2026-11-04 06:41) → `design.md`(06:39) → `specs/.../spec.md`(06:31) → `proposal.md`(06:28)

## validate結果

V-1 [INFO] 報告なし(`Change 'repair-managed-pi-compat-harness' is valid`)

## 継ぎ目一覧

| # | 継ぎ目 | 種別 | 出典(成果物の箇所) | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `--mode fixture\|official` の実行モード分離 | 拡張点(設定による実装の切り替え) | design Decision 1 / tasks 1.1, 8.3, 8.4 | 1. 実行モードの明示分離 | なし | なし |
| N-2 | `--artifact-root` / `--bundle` / `--commit` の CLI 引数 | 抽象型(CLI インターフェース) | design Decision 2 / tasks 1.2, 1.3 | 2. 公式 artifact と対象 commit bundle の来歴 | なし | なし |
| N-3 | 製品定数 `MANAGED_PI_FIRST_ARTIFACT_SHA256` との結合 | 外部依存(製品コード) | design Decision 2 / tasks 1.2 | 2. 公式 artifact と対象 commit bundle の来歴 | なし | なし |
| N-4 | 結果 JSON の `mode` / `runnerCompleted` / `compatibilityMet` / `bypassedPiHooks` フィールド | 抽象型(出力形式) | design Decision 9 / tasks 7.1-7.3 | 9. 証拠保存と結果判定 | なし | R-1 |

## 指摘

### [R-1] Major | E3
- 対象: `specs/managed-pi-compatibility/spec.md` の `### Requirement: 結果判定の基準`
- 問題: 個別項目の状態として「確認済み・部分成功・未実行・失敗」の4件しか挙げられていないが、design Decision 9 は `confirmed / limited / unavailable / not-run / failed` の5件で、現行 spec のマトリクスも「利用不可」を使う。
- 根拠: spec「システムは、個々の項目を確認済み・部分成功・未実行・失敗のいずれかで記録しなければならない。(SHALL)」/ design「個々の項目: `confirmed` / `limited` / `unavailable` / `not-run` / `failed`。」
- 照合先: `design.md` Decision 9、`openspec/specs/managed-pi-compatibility/spec.md` の `role と clear と model の互換性マトリクス`
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: spec の状態一覧に「利用不可」(`unavailable`)を追加する。

### [R-2] Minor | A6
- 対象: `proposal.md` の `## What Changes`
- 問題: MODIFIED「アセットと環境分離の検証」で `SPIRITS_CODING_AGENT_DIR` の扱いが「優先」から「隔離 agent dir への固定」に変わっているが、What Changes はこの挙動差に触れていない。
- 根拠: spec「システムは、`SPIRITS_CODING_AGENT_DIR` の隔離 agent dir への固定、…を検証しなければならない。(SHALL)」/ scenario「THEN 保存先は固定の隔離 agent dir になり、…」
- 照合先: 現行 spec「`SPIRITS_CODING_AGENT_DIR` の優先」「THEN 保存先は `SPIRITS_CODING_AGENT_DIR` になり、…」、`proposal.md` What Changes
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: What Changes に `SPIRITS_CODING_AGENT_DIR` の固定の旨を1文で追加する。

### [R-3] Minor | F4
- 対象: `specs/managed-pi-compatibility/spec.md` の `#### Scenario: 既存 agent fixture の不変`(2箇所)
- 問題: 同一のシナリオが「隔離された互換性テスト」と「アセットと環境分離の検証」の両方に重複している。
- 根拠: 31行目と53行目に同名シナリオ。
- 照合先: 同ファイル内
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: どちらか一方に集約し、もう一方からは参照にする。

### [R-4] Minor | D2
- 対象: `tasks.md` の `- [ ] 7.4`
- 問題: 要約の出力先が `docs/managed-pi-compat-result.md` に固定されており、検証コマンドは `--out <tmp>/result.json` を使うため、テスト実行時にリポジトリの `docs/` へ書き込む副作用が生じうる。
- 根拠: task 7.4「人が読める要約を `docs/managed-pi-compat-result.md` として出力する。検証: `bun scripts/managed-pi-compat/run.ts --mode fixture --out <tmp>/result.json` の実行後に要約ファイルが生成されること」
- 照合先: `design.md` Decision 9
- 確度: 確認済
- 判断: 要判断
- 修正の方向性: 利用者の判断が必要(Q-1)

### [R-5] Minor | C4
- 対象: `design.md` の `## Open Questions`
- 問題: 実行者 SHA を pin に含めるかは implement 時の実測で決めるとされ、判断が実装に先送りされている。採用次第で task 1.2 の検証内容が変わりうる。
- 根拠: 「公式 Pi 1.5.0 の実行者 SHA を harness の pin に含めるか、manifest の tarball SHA 照合に留めるかは、implement でステージした artifact の実測値を踏まえて決める。spec とタスク分担は変わらない。」
- 照合先: task 1.2
- 確度: 確認済
- 判断: 要判断
- 修正の方向性: 利用者の判断が必要(Q-2)

### [R-6] Minor | D4
- 対象: `design.md` の `### 10. 将来の拡張単体利用との責務分離`
- 問題: 「互換性結果には Pi 版、実行形態、ランタイム、必要 API の有無を記録する」とあるが、spec の「互換性結果の来歴と証拠」は「環境条件」までで「ランタイム」「必要 API の有無」を明示していない。
- 根拠: design「互換性結果には Pi 版、実行形態、ランタイム、必要 API の有無を記録する。」/ spec「対象 commit、作業ツリーの変更有無、Pi 版、各成果物 SHA、コマンド、環境条件、結果 JSON、stdout/stderr」
- 照合先: `specs/.../spec.md` の `### Requirement: 互換性結果の来歴と証拠`
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: spec の「来歴と証拠」に「ランタイム」「必要 API の有無」を明示する。

### [R-7] Minor | D7
- 対象: `tasks.md` の `- [ ] 8.4`
- 問題: 公式 artifact のステージ、bundle のビルド、official モードの実行、結果と要約の記録を1タスクに含み、1セッションで完了させられない可能性がある。
- 根拠: task 8.4 の本文。
- 確度: 確認済
- 判断: 要判断
- 修正の方向性: 利用者の判断が必要(Q-3)

### [R-8] Minor | B10
- 対象: `specs/managed-pi-compatibility/spec.md` の `### Requirement: role と clear と model の互換性マトリクス`、`### Requirement: tsrepl の実セル実行`
- 問題: `get_commands` / `registerTool` / `execute` といった内部 API 名が spec に残っている。
- 根拠: 「`get_commands` にコマンドが掲載されていないことだけで…」「他の拡張の `registerTool` を捕捉できると仮定してはならない。」「直接 `execute` を呼ぶ probe は…」
- 照合先: `openspec/config.yaml` の specs rules(「内部関数名やライブラリ選定はdesignへ任せる」)
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: API 名を観測可能な振る舞いの記述に置き換える。

### [R-9] Minor | A5
- 対象: `proposal.md` の `## Impact`
- 問題: 新規に出力する `docs/managed-pi-compat-result.md` が Impact の影響コードに挙がっていない。
- 根拠: Impact は `docs/spirits-managed-pi.md` のみ。task 7.4 が `docs/managed-pi-compat-result.md` を出力する。
- 照合先: `tasks.md` task 7.4
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: Impact に `docs/managed-pi-compat-result.md` を追加する。

### [R-10] Minor | D2
- 対象: `tasks.md` の `- [ ] 5.4`
- 問題: 検証が「fixture が不変であること」という結果のみで、design Decision 8 が求める `resolveManagedAgentPaths` / `ensureManagedAgentDir` の使用を確認する方法になっていない。
- 根拠: task 5.4 の検証は `existing agent fixture is unchanged` の成功のみ。
- 照合先: `design.md` Decision 8
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: 検証に製品 API の使用を確認する観点を追加する。

### [R-11] Minor | B6
- 対象: `specs/managed-pi-compatibility/spec.md` の MODIFIED 4件(「隔離された互換性テスト」「既存データの読み取り互換」「role と clear と model の互換性マトリクス」「テストの通信境界」)
- 問題: いずれも既存の記述を変えずに新しい記述を足しているのみで、ADDED として分割できる可能性がある。
- 根拠: 各 Requirement で既存文の削除・変更がなく、追記のみ。
- 照合先: 同ファイル
- 確度: 確認済
- 判断: 要判断
- 修正の方向性: 利用者の判断が必要(Q-4)

### [R-12] Minor | C1
- 対象: `design.md` の `### 4. tsrepl の通常ツール経路と補助 probe の分離`
- 問題: 撤回条件に英語の "observes" が混じっている。
- 根拠: 「撤回条件: Pi がツール実行経路を observes する API を安定させたら、…」
- 確度: 確認済
- 判断: 機械的
- 修正の方向性: 「observes」を日本語の記述に置き換える。

## 利用者の判断事項

### [Q-1] 対応する R-4
- 問い: 要約の出力先をどうするか。
- 選択肢:
  - A. `docs/managed-pi-compat-result.md` に固定出力を維持する: リポジトリに残るが、テスト実行時に `docs/` が書き換わる。
  - B. `--out` の隣に出力する: テストの副作用がなくなるが、CI が summary を別途保管する必要が出る。
  - C. 専用オプション(例: `--summary-out`)で指定する: 柔軟だが CLI が増える。
- 判断材料: task 7.4 の検証は `--out <tmp>/result.json` を使う。design は `docs/managed-pi-compat-result.md` を例示。
- 推奨: B。テストの副作用を避けられる。

### [Q-2] 対応する R-5
- 問い: 実行者 SHA を harness の pin に含めるかどうかをいつ決めるか。
- 選択肢:
  - A. implement 時に実測して決める(現状): 柔軟だが task 1.2 の内容が未定。
  - B. 今の時点で「含めない」と確定し、design の Open Questions から削除する: 決定が早いが、artifact 実測より先に確定する。
- 判断材料: design Open Questions、task 1.2。
- 推奨: A(現状維持)。実測に基づく判断が妥当。

### [Q-3] 対応する R-7
- 問い: task 8.4 を分割するか。
- 選択肢:
  - A. 分割しない(現状): 1タスクだが統合確認として妥当。
  - B. 「artifact ステージ + bundle ビルド」と「official 実行 + 記録」に分割する: 粒度が下がるがタスクが増える。
- 判断材料: task 8.4 の検証は結果 JSON の1点。
- 推奨: A(現状維持)。

### [Q-4] 対応する R-11
- 問い: 追記のみの MODIFIED を ADDED に分割するか。
- 選択肢:
  - A. 分割しない(現状): 関連記述が1 Requirement に集約される。
  - B. ADDED として分割する: 変更点が明確になるが Requirement 数が増える。
- 判断材料: 4件の MODIFIED は既存文を変更していない。
- 推奨: A(現状維持)。

## 観点チェック

指摘のなかった観点: A1, A2, A3, A4, B1, B2, B3, B4, B5, B7, B8, B9, B11, B12, B13, C2, C3, C5, D1, D3, D5, D6, E1, F1, F2, F3, F5, F6

指摘のあった観点: A5(R-9), A6(R-2), B6(R-11), B10(R-8), C1(R-12), C4(R-5), D2(R-4, R-10), D4(R-6, R-10), D7(R-7), E2(R-4), E3(R-1, R-2, R-6), F4(R-3)

## 総評

- Blocker: なし
- 要判断: Q-1, Q-2, Q-3, Q-4
- 継ぎ目: 4件。うち人間の設計判断が必要なもの: N-4(R-1)
- 実装開始: **判断待ち**(Blocker はないが、要判断の回答が必要)
- 未確認事項:
  - 審査基準の compatibility は OpenSpec 1.11.0 だが、実行した CLI は 1.16.0。版が異なる。
  - `openspec validate --strict` はエラーなし。archive 時のマージ衝突は validate では検査されない。
  - `git log` は出力なし(変更は未コミット)。更新順は `ls -l` の時刻から判断した。
