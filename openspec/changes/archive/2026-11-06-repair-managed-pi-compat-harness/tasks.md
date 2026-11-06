# Tasks

## 1. 実行モードと来歴の分離

- [x] 1.1 `scripts/managed-pi-compat/run.ts` に `--mode fixture|official` を追加し、全結果に実行モードを記録する。既定は `fixture`。検証: `cd packages/spirits && bun test test/managed-pi-compat-runner.test.ts` の新ケース `runner records the execution mode` が成功すること
- [x] 1.2 `official` モードで `--artifact-root`、`--bundle`、`--commit` を受け取り、公式 tarball の既知 SHA256 を信頼の基準として manifest の `pi.artifact.sha256` と照合する。一致しない場合は結果を書かず非ゼロで終了する。検証: `bun test test/managed-pi-compat-evidence.test.ts` の `official mode rejects a non-official artifact` が成功すること
- [x] 1.3 `official` モードで Pi 版、artifact tarball SHA、実行ファイル SHA、bundle 版と SHA、manifest の setId と SHA、overlay 版と SHA、対象 commit、作業ツリーの変更有無を結果に記録する。実行ファイル SHA は観測・変更検出の値であり、独立した公式署名や信頼の根拠ではない。検証: `bun test test/managed-pi-compat-evidence.test.ts` の `official mode records artifact and bundle identity` が成功すること
- [x] 1.4 結果とログの保存前に API キー・トークン・proxy 認証をマスクする。検証: `bun test test/managed-pi-compat-evidence.test.ts` の `evidence redaction removes secrets` が成功すること
- [x] 1.5 `docs/spirits-managed-pi.md` に実行モード、`--bundle`/`--commit`、来歴の読み方を記載する。検証: 文書に `fixture` / `official` の区別と `official` の必須引数が含まれ、記載したコマンドが `bun scripts/managed-pi-compat/run.ts --help` の出力と一致すること
- [x] 1.6 `official` モードで `--bundle` の SHA256 を manifest の `extension.artifact.sha256` と照合し、spawn 直前に起動対象の実行ファイルの SHA256 を再計算して展開時の値と照合する。不一致なら起動せず結果を書かず非ゼロで終了する。検証: `cd packages/spirits && bun test test/managed-pi-compat-evidence.test.ts` の新ケース `official mode rejects a bundle that is not the manifest extension` と `official mode re-verifies the executable before launch` が成功すること

## 2. fake provider のストリーミング形式

- [x] 2.1 `scripts/managed-pi-compat/fake-provider.ts` を Pi の `openai-completions` プロバイダが使う SSE 形式に合わせる。ツール呼び出しは `chat.completion.chunk` の `delta.tool_calls` を複数送り、`finish_reason: "tool_calls"` と usage で終える。検証: `cd packages/spirits && bun test test/managed-pi-compat-fake-provider.test.ts` の新ケース `fake provider streams chat.completion.chunk events` が成功すること
- [x] 2.2 ツール結果後の最終回答を `delta.content` と `finish_reason: "stop"` で返す。検証: `bun test test/managed-pi-compat-fake-provider.test.ts` の新ケース `fake provider streams a final answer after the tool result` が成功すること
- [x] 2.3 `fixtures/custom-provider.ts` の `api: "openai-completions"` がストリーミング形式で動作することを確認する。検証: `bun test test/managed-pi-compat-fake-provider.test.ts` の `model tool call reaches tsrepl` が成功すること

## 3. tsrepl の通常ツール経路と補助 probe

- [x] 3.1 fake provider が `tsrepl` をツール呼び出しし、Pi の通常の権限・フック経路で実行する一次確認を追加する。ランナーは `tool_execution_start` / `tool_execution_end` とツール結果を観測する。検証: `cd packages/spirits && bun test test/managed-pi-compat-tsrepl.test.ts` の新ケース `model tool call reaches tsrepl through the normal path` が成功すること
- [x] 3.2 補助項目を `registerTool` 包摂に依存させない。公式 Pi は拡張ごとに別の API オブジェクトを与えるため包摂が効かず、公式実行は常に `not-run` になる。`pi.getAllTools()` の観測に置き換えるか `not-run` 固定にし、結果に `bypassedPiHooks: true` を付ける。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `direct execute probe is auxiliary and optional` が新しい実装で成功し、公式実行でも理由付きで `not-run` または観測結果になること
- [x] 3.3 一次確認が probe 拡張の捕捉に依存しないことを確認する。検証: `bun test test/managed-pi-compat-tsrepl.test.ts` の `model tool call reaches tsrepl through the normal path` が probe 拡張なしで成功すること
- [x] 3.4 `docs/spirits-managed-pi.md` の tsrepl 節を、通常経路と補助 probe の区別に更新する。包摂が公式 Pi で効かない理由（拡張ごとに別の API オブジェクト）と、補助項目が公式実行で `not-run` になることを明記する。検証: 文書に「通常のモデル→ツール経路」、「補助 probe は Pi の権限・フックを迂回」、および包摂が効かない理由の記載があること

## 4. rlm の fixture と親の分離

- [x] 4.1 子の認証・モデル設定として、隔離 agent dir に `settings.json`(`models.strong`、`models.role`、`defaultProvider`、`defaultModel`)と `auth.json`(fake provider の認証)を配置する fixture を用意する。検証: `cd packages/spirits && bun test test/managed-pi-compat-rlm.test.ts` の新ケース `rlm fixture provides auth and model settings` が成功すること
- [x] 4.2 物理モデル親(`compat-fake/fake-model`)と、normal/strong 設定済みの `spirits/auto` 親を別項目で実行する。検証: `bun test test/managed-pi-compat-rlm.test.ts` の新ケース `physical model child` と `auto parent with normal/strong settings` が成功すること
- [x] 4.3 子の生成・最終回答・`rlm_usage`・中断を個別項目で記録する。検証: `bun test test/managed-pi-compat-rlm.test.ts` の新ケース `child generation, answer, usage, and abort are judged separately` が成功すること
- [x] 4.4 子の中断を fake provider の遅延応答と親セルの abort で発火させ、`rlm_usage` の `outcome` を観測する。発火できない場合は `not-run` にする。検証: `bun test test/managed-pi-compat-rlm.test.ts` の新ケース `child abort is observed through rlm_usage` が成功すること
- [x] 4.5 fixture 不足が原因の失敗を `not-run` または `limited` として記録し、製品不具合と断定しない。検証: `bun test test/managed-pi-compat-rlm.test.ts` の新ケース `fixture insufficiency is not a product defect` が成功すること
- [x] 4.6 `docs/spirits-managed-pi.md` の rlm 節に、物理モデル親と `spirits/auto` 親の区別、子の個別判定、fixture 不足の扱いを記載する。検証: 文書に各区別と `not-run` の扱いが記載されていること

## 5. 設定・セッションの読み書きを専用 Pi で

- [x] 5.1 `scripts/managed-pi-compat/data.ts` の Node による `readFileSync` を廃止し、probe 拡張の `pi.getSettings()` と `ctx.sessionManager.getEntries()` で読み取る。spec が挙げる 4 種（settings・auth・sessions・外部拡張）のうち auth と外部拡張も専用 Pi の実行時経路で観測し、API から届かない項目は `not-run` とする。検証: `cd packages/spirits && bun test test/managed-pi-compat-data.test.ts` の `reads settings and sessions through the dedicated Pi` と新ケース `reads auth and external extensions through the dedicated Pi` が成功すること
- [x] 5.2 session の書き込みを `pi.appendEntry()` で行い `getEntries()` で読み戻す。model/thinking level は `pi.setModel()` / `pi.setThinkingLevel()` で変更し `ctx.model` / `ctx.getThinkingLevel()` で読み戻す。検証: `bun test test/managed-pi-compat-data.test.ts` の新ケース `writes and reads back through the dedicated Pi` が成功すること
- [x] 5.3 settings の永続書き込みが Pi の拡張 API から届かない場合は、その項目を `not-run` にし、Node のファイル書き込みで代用しない。検証: `bun test test/managed-pi-compat-data.test.ts` の新ケース `settings write is not-run when the Pi API does not expose it` が成功すること
- [x] 5.4 ランナーが製品の `resolveManagedAgentPaths` と `ensureManagedAgentDir` を使い、保存先検証を旧来の明示指定優先から隔離 agent dir 固定へ追従させる。拒否対象パスでは spawn 前に失敗すること、正常な隔離領域では起動できること、一時 HOME の `~/.spirits/agent` fixture の内容と更新時刻が起動前後で不変であることを確認する。関数名の検索だけで検証完了にしない。RPC の agent dir は環境変数のエコーに過ぎないので、書き出された `bundled-skills` が隔離 agent dir 配下に着いることをアサートし、保存先が実際に使われている証拠にする。公式 Pi での不変確認は official 実行の証跡（結果 JSON と要約）で残す。検証: `bun test test/managed-pi-compat-data.test.ts` の `existing agent fixture is unchanged` が隔離 agent dir への書き出し位置も検証すること
- [x] 5.5 redact した既存 agent dir の fixture（`scripts/managed-pi-compat/fixtures/redacted-agent/`）を隔離 agent dir に配置して検証する経路にする。現状この fixture はどこからも読まれておらず、読み取り互換の実測が settings と sessions の 2 種に留まっている。検証: `cd packages/spirits && bun test test/managed-pi-compat-data.test.ts` の新ケース `reads a redacted existing agent fixture` が成功すること
- [x] 5.6 `docs/spirits-managed-pi.md` の既存データ節を、専用 Pi による読み書きと Node 読み取りの廃止に更新する。auth と外部拡張の読み取り範囲、および専用 Pi の書き込み経路と既存データへの書き戻し互換を別項目として区別したことを追記する。検証: 文書に Node 読み取りを代用しないこと、auth と外部拡張の扱い、書き込み経路と書き戻し互換の区別、書き込み在未確認のままであることが記載されていること

## 6. role・clear・model の目的別観測

- [x] 6.1 role の目的(skill による strong フェーズ、`/model` の role 語彙、role バッジに相当する表示)を専用 Pi での動作観測で個別に判定する。`apis.roleApi` の有無など API 存在だけから状態を確定しない。検証: `cd packages/spirits && bun test test/managed-pi-compat-matrix.test.ts` の `role purposes are observed separately` が成功し、目的の状態が観測結果から入ること
- [x] 6.2 `/clear` の目的(会話のクリア、同一セッション ID の維持、TODO の保持)を個別に観測する。probe 拡張で実行前に session ID と TODO エントリを記録し、クリア後に同一 ID と TODO 残存を読み戻す。検証: `bun test test/managed-pi-compat-matrix.test.ts` の `clear purposes are observed separately` が成功し、新ケース `clear purposes come from observations` が成功すること
- [x] 6.3 `/model` の目的(thinking level 指定、role 指定、既定値の保存)を個別に観測する。既定値の保存は保存後の設定キーを読み戻して判定する。検証: `bun test test/managed-pi-compat-matrix.test.ts` の `model purposes are observed separately` が成功し、新ケース `model default save is read back` が成功すること
- [x] 6.4 コマンド一覧の不掲載だけで組み込み機能の不存在を判定しない。目的観測だけでなくマトリクスの行の状態もコマンド一覧の不在から `unavailable` を導出せず、目的観測から集約する。観測できない目的とその行は `not-run` にする。検証: `bun test test/managed-pi-compat-matrix.test.ts` の `command list absence does not decide unavailability` と新ケース `rows are derived from purpose observations` が成功すること
- [x] 6.5 `docs/spirits-managed-pi.md` の role/clear/model 節を、目的別の観測とコマンド一覧に依存しない判定に更新する。行の状態が目的観測から導出されること、行と目的の状態が矛盾しないことを明記する。検証: 文書に各目的と `not-run` の扱い、行と目的の状態の一致が記載されていること

## 7. 結果判定と証拠保存

- [x] 7.1 結果に `runnerCompleted` と `compatibilityMet` を区別して記録し、必須観測が `not-run` または `limited` の場合に `compatibilityMet` を false にする。必須観測は専用 Pi で実測できる項目に限定し、既存 agent dir への書き戻し互換と `rlm child abort` を含まない。検証: `cd packages/spirits && bun test test/managed-pi-compat-result.test.ts` の `runner completion and compatibility are separate` と新ケース `unobservable items are not required` が成功すること
- [x] 7.2 `failed=0` でも必須観測が欠けていれば成功として報告しない。検証: `bun test test/managed-pi-compat-result.test.ts` の新ケース `failed=0 does not imply compatibility` が成功すること
- [x] 7.3 観測項目と期待する証拠の対応表を結果に含める。検証: `bun test test/managed-pi-compat-result.test.ts` の新ケース `observation evidence map is emitted` が成功すること
- [x] 7.4 人が読める要約を `--out` で指定した JSON の隣に `managed-pi-compat-result.md` として出力する。テストでは一時領域を使い、通常実行で追跡中の `docs/` を書き換えない。検証: `bun scripts/managed-pi-compat/run.ts --mode fixture --out <tmp>/result.json` の実行後に `<tmp>/managed-pi-compat-result.md` が生成されること
- [x] 7.5 `docs/spirits-managed-pi.md` に詳細ログ・JSON の保管方法(CI artifact、対象は JSON・要約・必要なログ)と再実行方法を記載する。リポジトリへ残す要約は、検証後に対象結果を選んで記録する別操作であることを明記する。検証: 文書に保管先と再実行コマンドが記載されていること
- [x] 7.6 来歴にランナー側のランタイムと Pi ホスト側のランタイムを区別して記録し、必要 API の有無を記録する。ホスト側は Bun でも `process.version` が Node 互換版になるため、Bun 実行なら `Bun.version` のようにランタイムを識別できる値を使い、識別できない場合だけ `unknown` とする。検証: `cd packages/spirits && bun test test/managed-pi-compat-evidence.test.ts` の `runtime and required api presence are recorded separately` がランタイム識別値を検証すること
- [x] 7.7 結果項目の名称を分ける。専用 Pi の書き込み経路の項目を `dedicated Pi write path` に改名し、既存 agent dir のデータへの書き戻し互換を別の `not-run` 項目として残す。`REQUIRED_OBSERVATIONS`、docs、要約、観測と証拠の対応表を追従させる。検証: `cd packages/spirits && bun test test/managed-pi-compat-result.test.ts` の新ケース `write path and write-back are separate items` が成功すること
- [x] 7.8 実行した全項目について実行コマンドと取得できた stdout/stderr を `logs` に記録する。検証: `cd packages/spirits && bun test test/managed-pi-compat-runner.test.ts` の新ケース `every item records its command` が成功すること

## 8. 統合確認

- [x] 8.1 `cd packages/spirits && bun test` が全件成功し、既存の managed-pi テストに回帰がないことを確認する。検証: 全テストが成功すること
- [x] 8.2 `cd packages/spirits && bun run check` とリポジトリルートの `npm run check` が成功すること。検証: 両コマンドが成功すること
- [x] 8.3 `fixture` モードをオフラインで実行し、全結果に `fixture-only` が付くことを確認する。検証: `bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture-root> --out <tmp>/result.json` が完了し、結果 JSON に `mode: "fixture"` が現れること
- [x] 8.4 公式 Pi artifact の検証・ステージと bundle のビルドを行い、来歴を記録する。入力: 公式 artifact、対象 commit。出力: 検証済み artifact、ステージした実行ファイル、ビルドした bundle、来歴。完了条件: tarball の SHA が既知値と一致し、SHA 検証済み tarball を新しい隔離領域へ展開して実行ファイルの SHA を計算し、検証済み tarball・ステージした実行ファイル・起動対象の対応が記録されること。準備完了を互換性測定完了と扱わない。検証: ステージした artifact の SHA と実行ファイルの SHA が記録されること
- [x] 8.5 `official` モードで実行し、結果・要約・ログを保存する。入力: 8.4 の成果物。出力: 結果 JSON、要約、ログ。完了条件: 結果 JSON に `mode: "official"`、Pi 版、各 SHA、対象 commit が現れ、`compatibilityMet` が必須観測の状態に対応すること。検証: 結果 JSON と `<out>/managed-pi-compat-result.md` が生成されること
- [x] 8.6 変更差分を確認し、`packages/coding-agent/`、`packages/ai/`、`packages/tui` に差分がなく、新しい依存を追加していないことを確認する。検証: `git diff --name-only` に Pi コアが含まれず、`package.json` / lockfile に依存差分がないこと
- [x] 8.7 1.x / 3.x / 5.x / 6.x / 7.x の修正後に `fixture` モードと `official` モードを再実行し、結果 JSON・要約・ログを `--out` の隣に保管する。公式実行は検証済み tarball・ステージした実行ファイル・`--bundle` の対応が結果に出ていることを目視確認する。検証: `bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture-root> --out <tmp>/result.json` と `--mode official ...` が完了し、結果 JSON の `logs` が実行項目数と一致すること
- [x] 8.8 製品側で判明した不具合（子セッション実行中の中断で `rlm_usage` が残らない）を、再現条件・証拠（公式実行の結果 JSON の `rlm child abort` の `not-run` 理由）・影響付きで別 change 候補として報告する。検証: `docs/spirits-managed-pi.md` か報告文に再現条件と証拠パスが記載されていること

## Workflow follow-up

- 実装は `/opsx-apply` をユーザーが明示的に開始したときに別セッションで進める。
- archive、release、既定経路切り替え、フォーク削除はこの change の対象外。
- 製品不具合が判明した場合は、再現条件・証拠・影響を記録し、別 change 候補として報告する。
