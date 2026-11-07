# 深い検証レポート: repair-managed-pi-compat-harness

このレポートの後の訂正と再検証は [verify2-rerun.md](verify2-rerun.md) にある。`rlm child abort` の製品欠落扱いを含む判定の書き換え、fixture / official の再実行、ランナー来歴の記録をそこに残す。

- スキーマ: `spec-driven`
- 対象ルート: `/workspace`（ローカル、登録ストアなし）
- 使用する変更: `repair-managed-pi-compat-harness`
- 検証対象: `a0bd389c4`（HEAD）の未コミット変更 + 未追跡ファイル（`scripts/managed-pi-compat/{evidence,official}.ts`、`packages/spirits/test/managed-pi-compat-{evidence,result}.test.ts`）。`git merge-base HEAD main` は `3c3962f97` だが、その間の 2 コミット（`dcfe940e8`、`a0bd389c4`）は archive 済み `add-managed-pi-route` / `guard-managed-pi-agent-writes` の作業のため差分範囲から除外した。
- テストコマンド: `cd packages/spirits && bun test` / `bun run check` / `npm run check`
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: なし）
- verify1 レポート: 会話内の前段レポート（パスなし）
- モード: 通常

## 判定

FAIL / BLOCKED（このレポートを反映し、1.6 / 3.2 / 3.4 / 5.1 / 5.4 / 5.5 / 5.6 / 6.1-6.5 / 7.1 / 7.6 / 7.7 / 7.8 / 8.7 / 8.8 を追加または解除した。成果物側の修正で S-1〜S-5 は解消済み）

## サマリー

| 観点 | 結果 |
|---|---|
| テスト | 成功 775 / 失敗 0（+ 規約検査 3/0、`bun run check` 成功、`npm run check` 成功） |
| 規約検査 | 成功 3 / 失敗 0（層・循環・重複 baseline 61 が正本と一致。`scripts/` と `packages/*/test/` は dev ファイルのため層検査の対象外） |
| 要件 | 意図どおり 6 / 全 10 |
| シナリオ | 挙動を確認 30 / 全 39、テストが実質的 26 / 全 39 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 3 件 |
| 継ぎ目 | 追加 7 件（Decision あり 6 / なし 1）、対価が未実現 2 件 |
| 重複 | 新たな重複 3 件 |
| タスク | 反映後 完了 28 / 全 46 |

実施した実測:

- 公式バイナリ（tarball SHA `df870ba0…`）を再展開し、実行ファイル SHA `61a84400…` が結果 JSON と一致することを確認。
- `scripts/build-managed-pi-inputs.ts` を再ビルドし、成果物の SHA が official 実行で使われた bundle（`51f306d1…`）と完全一致することを確認（対象 commit の来歴が成立している）。
- `manifest.json` の `pi.artifact.sha256` を改変したステージングで official モードを実行し、結果ファイルを書かず exit 1 になることを確認（task 1.2 の挙動は実質的に成立）。
- 公式 Pi の `get_commands` を実起動して応答を確認。拡張コマンド・プロンプト・スキルだけが返り、組み込みの `clear` / `model` は掲載されない。
- 一時 HOME に `~/.spirits/agent` fixture を置き、公式 Pi を managed 環境で起動。内容・mtime ともに不変、書き出しは隔離 agent dir（`bundled-skills/`、`auth.json`）に着地。挙動は仕様どおりで、自動検証だけがスタブ依存。

## 重大

1. **`role/clear/model matrix` の行がコマンド一覧の不在から「利用不可」を判定している（MUST 違反）**
   - 場所: `scripts/managed-pi-compat/run.ts:196`（`observationsFrom`）
   - 根拠: spec「コマンド一覧にコマンドが掲載されていないことだけで、組み込み機能の不存在を判定してはならない」。`commands.includes("clear") ? "limited" : "unavailable"`。公式 Pi の `get_commands` に `clear` / `model` が載らないことを実測で確認。公式実行の結果 JSON では行が `unavailable`、同じ項目の `purposes` は `not-run` で自己矛盾。
   - 対応: task 6.4 を書き直して解除し、行の状態を目的観測から集約するタスクを追加。spec に行の導出規則と「行と目的の状態を矛盾させない」を追加。

2. **`data write compatibility` が `confirmed` で、かつ必須観測に入っている**
   - 場所: `scripts/managed-pi-compat/evidence.ts:83`、`scripts/managed-pi-compat/data.ts:44`、削除された `packages/spirits/test/managed-pi-compat-data.test.ts` の `write compatibility is not confirmed by read success` / `conversion-requiring write is aborted`
   - 根拠: delta spec が base の MUST「書き込み互換を成功として扱ってはならない」を保持していた一方、実装は隔離 agent dir での専用 Pi 書き込みを同名項目で `confirmed` にし、`REQUIRED_OBSERVATIONS` に入れていた。`docs/spirits-managed-pi.md` の「既存データの書き込み互換は未確認」と結果 JSON が逆を向く。不変条件を検証していたテスト 2 本の削除理由が tasks に無かった。
   - 対応: spec を「専用 Pi の書き込み経路」と「既存 agent dir への書き戻し互換」に分離し、書き戻し互換は必須観測に含めない旨を明記。task 7.7（改名と項目分離）と task 7.1 の条件追加で実装側を追従させる。

3. **既存データの読み取り互換が spec の 4 種（settings・auth・sessions・外部拡張）のうち 2 種しか測っていない**
   - 場所: `scripts/managed-pi-compat/fixtures/probe-extension.ts:156`、参照箇所ゼロの `scripts/managed-pi-compat/fixtures/redacted-agent/`
   - 根拠: base の `readAgentDirSnapshot`（4 種を Node で読む）を削除したが、置き換え後の専用 Pi 読み取りは settings と sessions のみ。redact コピーを読む経路も無い。公式実行の detail も「read 3 settings keys and 2 session entries」。
   - 対応: task 5.1 に auth・外部拡張の観測を追加し、task 5.5 として redact fixture を隔離 agent dir に配置する経路を追加。spec に「API から読めない項目は `not-run`、Node 読み取りで代替しない」を追加。

## 警告

1. **`purposes` が専用 Pi の動作観測ではなく API / コマンド有無から導出されている**（`run.ts:231`）→ task 6.1 / 6.2 / 6.3 に具体的な観測手順（session ID・TODO 読み戻し、設定キー読み戻し）を明記して解除。
2. **official モードが Decision 2 の内部整合性検査（bundle SHA と manifest の突合、起動直前の実行ファイル SHA 照合）を行っていない**（`run.ts:352`、`official.ts:92`）。別 commit 由来の bundle を official の証拠として受け入れてしまう → task 1.6 を追加、design Decision 2 に (a)-(e) の検査を明記。
3. **`registerTool` 包摂は公式 Pi では構造的に効かない**（拡張ごとに別 API オブジェクト。実測で `tsrepl was not captured`）のに、包摂実装が `tsrepl.ts:23` と `fixtures/probe-extension.ts:68` に重複し、`FakePi` 相手のテストだけが通る → task 3.2 / 3.4 を書き直して解除。
4. **ホストランタイムが Bun だと識別できない**（`probe-extension.ts:88` の `process.version` は Bun でも Node 互換版。結果は `runner: "bun 1.4.4"` / `host: "v26.3.0"`）→ task 7.6 を書き直して解除、spec に識別値の要求を追加。
5. **計測対象をスタブに置き換えているテスト**（`FAKE_RPC_PI_SCRIPT` が期待イベントを直接出力、`api key and proxy survive` は分類関数を呼ばない恒真、目的テストは状態を手渡し）→ task 5.4 / 6.x に追記。挙動自体は実測で仕様どおりを確認済み。
6. **新たな重複 3 件**（`COMPAT_MATRIX` と `*_PURPOSES` の目的・代替案・差異の文言、`registerTool` 包摂、`countStates` と `renderSummary` の集計）→ design Decision 7 に「行の定義は目的定義から生成し同じ文言を 2 箇所に持たない」を追加。
7. **`logs` が 28 項目中 2 項目のみ**（design Decision 9 は各項目のコマンドを要求）→ task 7.8 を追加。
8. **対価が実現していない継ぎ目**（`CompatRunner.setMode` は本番呼び出しゼロ、`withoutProbeObservations` / `countStates` / `classifyFixtureInsufficiency` / `purposesFor` / `classifyHelpOnly` / `classifyBundledMarkdown` は未使用）→ apply 側で削除。

## 成果物側（SPEC）として修正したもの

- **S-1** delta spec が保持する「redact したコピーを使って … 外部拡張」「書き込み互換を成功として扱ってはならない」と、tasks / design のスコープが矛盾 → spec を書き換え、読み取り 4 種と `not-run` の扱い、書き込み経路と書き戻し互換の分離、書き戻し互換を必須観測に含めないことを明記。
- **S-2** `rlm child abort` が必須観測で、製品側の制約により `compatibilityMet` が恒久 false → spec に「必須観測は実測できる項目だけ」「製品側の制約で観測できない項目は含めない」を追加。task 7.1 に反映し、task 8.8 で製品不具合を別 change 候補として報告する手順を追加。
- **S-3** 「data write compatibility」の名称衝突 → spec と task 7.7 で `dedicated Pi write path` に分離。
- **S-4** design の `official-artifact` ラベルと実装の `official` の食い違い → design Decision 1 を `official` に修正。
- **S-5** fake provider の `reply` 拡張点（親にツール呼び出し、子にテキストを返し rlm 再帰を防ぐ）に Decision が無かった → design Decision 5 に追記。

## verify1 との突き合わせ

- verify1 W-1 → 採用、重大へ格上げ（公式バイナリで `get_commands` の内容を実測し、MUST 違反が結果 JSON に現れていることを確認）。
- verify1 W-2 → 採用、警告のまま（task 6.1-6.3 の観測手順として具体化）。
- verify1 W-3 → 採用、重大へ格上げ（redact コピー経路自体が消え fixture が孤児化している点を追加）。
- verify1 S-1（logs）→ 警告へ格上げ（task 7.8）。
- verify1 S-2（label）→ SPEC として S-4 に採用。
- verify1 S-3（恒真テスト）→ 警告 5 に統合。
- verify1 S-4（未使用コード）→ 警告 8 に採用。
- verify1 S-5（製品不具合の change 候補）→ SPEC S-2 として採用（必須観測化が判定を恒久 false にしている点を追加）。
- verify1 が拾えなかったもの: 書き込み互換の `confirmed` 化と不変条件テストの削除、official モードの bundle / 実行ファイル照合漏れ、`registerTool` 包摂の構造的失効、`process.version` の意味、重複 3 件、`reply` 拡張点の Decision 欠落。

## 次の手順

1. apply で 1.6 / 3.2 / 3.4 / 5.1 / 5.4 / 5.5 / 5.6 / 6.1-6.5 / 7.1 / 7.6 / 7.7 / 7.8 を実装する。
2. 8.7 で fixture / official を再実行し、結果 JSON・要約・ログを保管する。8.8 で製品不具合を別 change 候補として報告する。
3. 本スキルを再検証モードで再実行する。
