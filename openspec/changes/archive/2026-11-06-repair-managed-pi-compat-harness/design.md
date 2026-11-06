# Design

## Context

動機と背景は `proposal.md` の Why 参照。この design は `scripts/managed-pi-compat/` の測定基盤をどう直すかを決める。

現在の制約:

- ランナーは `--artifact-root` で渡した managed root をそのまま使い、fixture の Pi スクリプト(`FAKE_RPC_PI_SCRIPT`)が返す固定イベントを結果に記録する。`makeManagedFixture` は公式 artifact の tarball SHA ではなく fixture の archive SHA を manifest に書く。
- `run.ts` の一部の項目は runner 自身の Bun プロセスで `tsrepl` を実行し、`data.ts` は Node の `readFileSync` で agent dir を読む。`matrix.ts` は `get_commands` とツール一覧から行を上書きする。
- `fake-provider.ts` は非ストリーミングの `chat.completion` JSON を返す。Pi の `openai-completions` プロバイダは `openai` SDK で `stream: true` を使い、SSE の `chat.completion.chunk` を期待する(`packages/ai/src/api/openai-completions.ts`)。
- `probe-extension.ts` は `pi.registerTool` を包んで `tsrepl` を捕捉し、直接 `execute` を呼ぶ。
- 製品の保存先ガードは `packages/spirits/src/managed-pi/agent-dir.ts` と `environment.ts` にあり、ランナーは `computeManagedEnv` だけを使う。
- 設計の一次根拠は `docs/spirits-design.md` §「managed-pi 実験経路」、`docs/spirits-managed-pi.md`、`docs/spirits-m3-rlm.md` §4。archive 済み `add-managed-pi-route` の `completion-correction.md` が今回の問題の記録。

## Goals / Non-Goals

**Goals:**

- fixture 実行と公式 artifact 実行を分離し、全結果に実行モードを付ける。
- 公式 Pi 固定成果物と対象 commit の bundle で実行し、artifact・bundle・manifest・overlay の識別情報を記録する。
- tsrepl を通常のモデル→ツール経路で確認し、直接 `execute` の probe は補助として区別する。
- rlm の認証・モデル設定 fixture を準備し、物理モデル親と `spirits/auto` 親を分けて子の生成・回答・usage・中断を個別に判定する。
- 設定・セッションの読み書きを専用 Pi の実行時経路で確認する。
- role・`/clear`・`/model` を目的ごとに専用 Pi で観測する。
- 結果と証拠を対応付けて保存し、結果判定の基準を明確にする。

**Non-Goals:**

- 製品 rlm の認証継承仕様変更、role・`/clear`・`/model` の代替機能追加。
- 実データ移行、本番 release 資産の公開、既定経路切り替え、フォーク削除。
- 実 provider・実認証を使うテスト。
- 将来の外部 Pi 対応のための汎用抽象・設定項目・分岐。
- `packages/coding-agent`、`packages/ai`、`packages/tui` の変更。

## Decisions

### 1. 実行モードの明示分離

ランナーに `--mode fixture|official` を導入する。既定は `fixture`。全結果に `mode` を付け、fixture の結果は `fixture-only` として記録する。`official` では公式 artifact の検証と target-commit bundle の指定を必須にし、結果の `mode` と各項目の label を `official` にする（公式証拠であることを `mode` だけで表し、別の接尾辞は作らない）。

代替案:

- **artifact から自動判別する**: 実体 SHA を既知リストと照合すれば理論上は判別できる。ただし「公式とみなす基準」をコードに埋め込むことになり、基準の更新が harness の変更になる。実行主体の意図を明示しないため、証拠の範囲が曖昧になる。採用しない。
- **fixture 用と official 用で別スクリプトに分ける**: 重複が増え、項目の増減で両方を直すことになる。採用しない。

撤回条件: 公式 artifact の識別を製品が保証するようになったら、モード指定を省略できる。

### 2. 公式 artifact と対象 commit bundle の来歴

`official` モードは `--artifact-root <managed-root>`、`--bundle <path>`、`--commit <sha>` を受け取る。次のように検証・記録する。

- 公式 tarball の既知 SHA256(`MANAGED_PI_FIRST_ARTIFACT_SHA256`)を信頼の基準とする。manifest の `pi.artifact.sha256` と照合し、一致しない場合は「公式 artifact ではない」として終了し、結果を書かない。
- SHA 検証済みの tarball を新しい隔離領域へ展開する。
- 展開した実行ファイルの SHA256 を計算する。
- 起動直前に実行対象の SHA を照合し、結果へ記録する。
- 実行ファイル SHA を別の固定定数として pin することは今回は行わない。
- 既存の実行ファイルをハッシュしただけで公式由来と認定しない。検証済み tarball、ステージした実行ファイル、起動対象の対応を保持する。
- fixture モードは `verifyManagedSet` で managed set の内部整合性(実行者・bundle・overlay の SHA)を確認する。
- `official` モードは `verifyManagedSet` を使わないので、等価の検査を明示的に行う。(a) manifest の tarball SHA が信頼基準と一致、(b) tarball 実体の SHA が manifest と一致、(c) overlay の SHA が manifest と一致、(d) `--bundle` の SHA256 が manifest の `extension.artifact.sha256` と一致、(e) spawn 直前に起動対象の実行ファイルの SHA256 を再計算し展開時の値と一致。(d) または (e) が不一致なら起動せず、結果を書かず非ゼロで終了する。これがないと別 commit からビルドした bundle を official の証拠として受け入れてしまう。
- Pi の起動に managed root の bundle ではなく `--bundle` で渡した target-commit bundle を使う。
- 結果に Pi 版、artifact tarball SHA、実行者 SHA、bundle 版と SHA、manifest の setId と SHA、overlay 版と SHA、対象 commit、作業ツリーの変更有無を記録する。

実行ファイル SHA は観測・変更検出の値であり、独立した公式署名や信頼の根拠ではない。

代替案:

- **managed root の `installed.json` を信頼する**: fixture も整合する `installed.json` を書けるため、区別にならない。採用しない。
- **実行時に bundle をビルドする**: 測定とビルドが混ざり、commit を固定できない。採用しない。ビルドは harness の外のタスクにする。
- **実行ファイル SHA を固定定数として pin する**: 採用しない。実行ファイル SHA は観測・変更検出の値であり、公式署名ではない。

撤回条件: 公式 artifact の実行者 SHA を製品が pin するようになったら、manifest の tarball SHA 照合に加えて実行者 SHA も照合する。

### 3. fake provider のストリーミング形式

`fake-provider.ts` を Pi の `openai-completions` プロバイダが実際に使う SSE 形式に合わせる。ツール呼び出し時は `chat.completion.chunk` を複数送り、`delta.tool_calls` にツール名と引数を積み、最後に `finish_reason: "tool_calls"` と usage を送る。ツール結果後の最終回答は `delta.content` を送り `finish_reason: "stop"` で終える。`data: [DONE]` で終了する。

代替案:

- **非ストリーミングのままにする**: Pi の `openai-completions` は `stream: true` を要求するため、実際の経路を再現できない。採用しない。
- **anthropic-messages 形式に変える**: 測定対象のプロバイダを変えることになり、既存の custom provider fixture と噛み合わない。採用しない。

撤回条件: 測定対象プロバイダを変えるときに合わせる。

### 4. tsrepl の通常ツール経路と補助 probe の分離

一次確認は fake provider が `tsrepl` をツール呼び出しし、Pi の通常の権限・フック経路で実行させる。ランナーは RPC の `tool_execution_start` / `tool_execution_end` とツール結果を観測する。probe 拡張の `registerTool` 包摂は一次確認には使わず、直接 `execute` を呼ぶ補助項目としてのみ残す。補助項目の結果には `bypassedPiHooks: true` を付け、`tsrepl` を捕捉できなかった場合は `not-run` にする。

公式 Pi は拡張ごとに別の API オブジェクトを与える（`loader.ts` の `createExtensionAPI(extension, ...)` が拡張毎に `registerTool` を生成し、登録は `extension.tools` に書かれる）。したがって probe 拡張が自分の `pi.registerTool` を書き換えても他の拡張の登録は捕捉できず、補助項目は公式 Pi では構造的に `not-run` になる（実測で `tsrepl was not captured`）。包摂には依存しない。補助項目は `pi.getAllTools()` の観測に置き換えるか、`not-run` 固定であることを docs に明記する。包摂実装をランナー側 (`tsrepl.ts` の `captureRegisteredTools`) と probe 側に重複を持たない。

代替案:

- **probe の直接 `execute` を一次確認にする**: Pi の権限・フック経路を迂回するため、通常経路の確認にならない。採用しない。
- **`ctx.executeTool("tsrepl", ...)` を一次確認にする**: これも Pi の経路を通るが、モデルが発行したツール呼び出しではない。モデル→ツール経路の確認には fake provider のツール呼び出しが最も直接的。採用しない(補助として使う)。

撤回条件: Pi がツール実行経路を監視する API を安定させたら、probe 拡張の捕捉をやめる。

### 5. rlm の fixture と親の分離

子の認証・モデル設定は親と同じ agent dir の auth と設定、および環境変数から解決される(`docs/spirits-m3-rlm.md` §4)。ランナーは赤化した fixture を隔離 agent dir に配置し、`settings.json` に `models.strong` と `models.role`、`auth.json` に fake provider の認証を置く。custom provider fixture は `compat-fake` として登録する。

- 物理モデル親: `set_model` で `compat-fake/fake-model` を選び、`rlm` を呼ぶ。
- `spirits/auto` 親: `set_model` で `spirits/auto` を選び、normal/strong を設定した親として `rlm` を呼ぶ。
- 子の生成・最終回答・`rlm_usage`・中断を別項目で記録する。中断は fake provider の遅延応答と親セルの abort で発火させる。
- fixture 不足が原因の失敗は `not-run` または `limited` とし、製品不具合と断定しない。
- fake provider はリクエスト本文で返信を選ぶ拡張点 `reply` を持つ。親リクエストにはツール呼び出し、子リクエストにはテキストで応じ、子が `rlm` を再帰的に呼び出さないようにする。子セッションは拡張を読まないため、プロバイダ登録をファイル (`models.json`) 経由で置く。

代替案:

- **auto 親を物理モデルにフォールバックさせる**: `spirits/auto` の解決可否という観測点が失われる。採用しない。
- **子の abort を測定しない**: 項目の到達範囲が狭がる。採用しない。ただし fixture が用意できなければ `not-run` にする。

撤回条件: 子の認証継承の製品仕様が変わったら、fixture の作り方を見直す。

### 6. 設定・セッションの読み書きを専用 Pi で確認

`data.ts` の Node による `readFileSync` と固定入力の分類をやめる。probe 拡張が Pi の実行時経路で観測する。

- 読み取り: `pi.getSettings()` で settings、`ctx.sessionManager.getEntries()` で session を読む。
- 書き込み: session は `pi.appendEntry()` で追記して `getEntries()` で読み戻す。model/thinking level は `pi.setModel()` / `pi.setThinkingLevel()` で変更して `ctx.model` / `ctx.getThinkingLevel()` で読み戻す。
- settings の永続書き込みが Pi の拡張 API から届かない場合は、その項目を `not-run` にし、Node のファイル書き込みで代用しない。
- 読み取りは settings と session に留まらず、spec が挙げる auth と外部拡張も専用 Pi の実行時経路で観測する。届かない項目は `not-run` にする。検証は redact した既存 agent dir のコピーを隔離 agent dir に配置して行う。
- 専用 Pi の書き込み経路 (session / model / thinking level) と、既存 agent dir のデータへ安全に書き戻せることは別項目にする。書き戻し互換は実証できるまで `not-run` のままにし、`compatibilityMet` の必須観測に含めない。書き込み経路の項目名を `data write compatibility` のままにすると docs の「書き込み互換は未確認」と結果 JSON が逆を向くため、`dedicated Pi write path` へ改名する。

代替案:

- **Node でファイルを読んで分類を続ける**: 専用 Pi の実行時経路ではないため、要求に反する。採用しない。
- **プロダクトに settings 書き込み API を追加する**: 製品仕様の変更であり、この change の非対象。採用しない。

撤回条件: Pi が拡張 API で settings 書き込みを公開したら、その経路に切り替える。

### 7. role・`/clear`・`/model` の目的別観測

`get_commands` の不掲載だけで機能の不存在を判定しない。各目的を専用 Pi の動作で観測する。

- role: skill コマンドによる strong フェーズ、`/model` の role 語彙、role バッジに相当する表示を個別に観測する。
- `/clear`: 会話のクリア、同一セッション ID の維持、TODO の保持を個別に観測する。
- `/model`: thinking level 指定、role 指定、既定値の保存を個別に観測する。

観測できない目的は `not-run` にし、静的な `COMPAT_MATRIX` の値だけを結果にしない。

API やコマンドの有無だけを根拠に状態を確定しない。公式 Pi の `get_commands` は拡張コマンド・プロンプト・スキルだけを返し、組み込みの `/clear` と `/model` は掲載されない（実測）。コマンド一覧の不在を行の `unavailable` に変換すると「コマンド一覧だけで不存在を判定しない」という MUST を破る。

マトリクスの行の状態は目的観測から集約して導出し、行と目的の状態を結果の中で矛盾させない。行の定義（目的・代替案・差異）は目的定義の一覧から生成し、同じ文言を `COMPAT_MATRIX` と `*_PURPOSES` の 2 箇所に持たない。

代替案:

- **`get_commands` の有無で判定を続ける**: 組み込み機能がコマンド一覧に載らない場合があるため、不存在判定の根拠が弱い。採用しない。
- **すべての目的を `unavailable` と決め打ちする**: 専用 Pi での実測という change の目的に反する。採用しない。

撤回条件: 専用 Pi のコマンド拡張機構が変わったら、観測方法を見直す。

### 8. 保存先保護と既存 agent fixture の不変

ランナーは製品の `resolveManagedAgentPaths` と `ensureManagedAgentDir` を使って隔離 agent dir を解決・作成し、`computeManagedEnv` にその agent dir を渡す。一時 HOME の `~/.spirits/agent` に既存 fixture を置き、公式 Pi 起動の前後で内容と更新時刻が変わらないことを確認する。検証は、拒否対象パスでは spawn 前に失敗すること、正常な隔離領域では起動できること、既存 agent fixture が不変であることの3点を含む。関数名の検索だけで検証完了にしない。

代替案:

- **ランナー自身でパス検査を実装する**: 製品のガードと重複し、ずれが生じる。採用しない。
- **既存 agent dir を測らない**: 要求の「公式 Pi 起動前後で不変」を満たせない。採用しない。

撤回条件: 製品のガード API が変わったら、呼び出しを追従する。

### 9. 証拠保存と結果判定

ランナーは結果 JSON に次を対応付けて書く: 実行モード、対象 commit、作業ツリーの変更有無、Pi 版、artifact tarball SHA、実行者 SHA、bundle 版と SHA、manifest の setId と SHA、overlay 版と SHA、各項目のコマンド、環境条件、結果、stdout/stderr。認証情報・秘密情報はマスクする。

結果判定は次を区別する。

- 個々の項目: `confirmed` / `limited` / `unavailable` / `not-run` / `failed`。
- `runnerCompleted`: 全項目を処理したか。
- `compatibilityMet`: 必須観測がすべて `confirmed` か。
- 必須観測が `not-run` または `limited` の場合、`failed=0` でも `compatibilityMet` は false。
- 必須観測には専用 Pi 上で実測できる項目だけを入れる。既存 agent dir への書き戻し互換と、製品側の制約で観測できない `rlm` の子中断は含めない。観測できない項目は `not-run` / `limited` と理由を記録し、報告物は別 change 候補として出す。
- `fixture` モードの成功を `compatibilityMet` の根拠にしない。
- 観測項目と期待する証拠の対応表を結果に含める。
- 実行した各項目についてコマンドと stdout/stderr を `logs` に記録する（一部の項目だけしか残さないと、どの実体に対して何を走らせたかを来歴から再現できない）。
- ランタイムは識別できる値で記録する。Bun でも `process.version` は Node 互換版を返すため、ホスト側は Bun 実行なら `Bun.version` を使い、識別できない場合だけ `unknown` にする。

人が読める要約は `--out` で指定した JSON の隣に `managed-pi-compat-result.md` として出力する。通常実行で追跡中の `docs/` を書き換えない。リポジトリへ残す要約は、検証後に対象結果を選んで記録する別操作とする。CI artifact の対象には JSON、要約、必要なログを含め、再実行方法を `docs/spirits-managed-pi.md` に書く。

代替案:

- **exit code を `failed=0` で 0 にする**: 未実行・部分成功を成功に見なすため、要求に反する。採用しない。
- **詳細 JSON をリポジトリにコミットする**: 肥大化し、秘密情報が混入するリスクがある。採用しない。

撤回条件: CI が artifact を自動保管するようになったら、保存先をそれに合わせる。

### 10. 将来の拡張単体利用との責務分離

managed ランチャー固有の処理(probe、fake provider、fixture、来歴記録)は `scripts/managed-pi-compat/` に閉じる。拡張本体(`packages/spirits/src/`)は harness の都合で変更しない。互換性結果には Pi 版、実行形態、ランナー側のランタイム、Pi ホスト側のランタイム、必要 API の有無を記録し、観測できない値は `unknown` とする。managed 専用の保存先・identity 制御を拡張本体の必須処理にしない。将来対応のための汎用抽象・設定項目・分岐は追加しない。

代替案:

- **拡張本体に harness 専用フックを追加する**: 拡張本体と測定基盤が結合し、将来の外部 Pi 対応の邪魔になる。採用しない。
- **外部 Pi 対応を先取りして抽象化する**: 要求の「将来対応のための汎用抽象は追加しない」に反する。採用しない。

撤回条件: 外部 Pi 対応が別 change で採用されたら、その change で責務分担を見直す。

## Risks / Trade-offs

- [Risk] 公式 artifact を用意できない環境では `official` モードを実行できない → Mitigation: `fixture` モードはオフラインで動き、`official` は artifact と bundle が揃った環境でのみ走る。結果にモードを記録し、fixture の結果を公式と混同しない。
- [Risk] fake provider の SSE 形式が Pi の SDK の要求とずれる → Mitigation: Pi の `openai-completions` のストリーミング解析箇所を根拠に chunk 形式を固定し、テストで SDK がパースできることを確認する。
- [Risk] rlm の子 abort を安定的に発火できない → Mitigation: 遅延応答と abort を組み合わせ、発火できない場合は `not-run` にして製品不具合と断定しない。
- [Risk] 専用 Pi の設定・セッション書き込み経路が拡張 API から届かない → Mitigation: 到達しない項目は `not-run` として理由を残し、Node のファイル操作で代用しない。
- [Risk] 来歴記録に秘密情報が混入する → Mitigation: 保存前に API キー・トークン・proxy 認証をマスクするテストを用意する。
- [Risk] 目的別 role/clear/model の観測が不安定になる → Mitigation: 各目的を独立したシナリオに分け、観測できない目的は `not-run` にする。
- [Risk] `rlm` の子中断時に `rlm_usage` が残らないのは製品側の制約で、ハーネスでは解消できない → Mitigation: 必須観測から外して `not-run` と理由を残し、再現条件・証拠・影響を別 change 候補として報告する。
- [Risk] probe 拡張の `registerTool` 包摂は公式 Pi では効かない → Mitigation: 包摂に依存せず `getAllTools()` で観測し、包摂実装の重複を削除する。

## Migration Plan

1. `scripts/managed-pi-compat/` とテストを変更し、`fixture` モードで既存の項目が通ることを確認する。
2. 公式 Pi artifact の検証・ステージと bundle のビルドを行い、来歴を記録する。準備完了を互換性測定完了と扱わない。
3. `official` モードで実行し、結果 JSON と要約を `--out` の隣に出力する。
4. 結果をレビューし、製品不具合が判明した場合は再現条件・証拠・影響を記録して別 change 候補として報告する。
5. 既定経路、配布、`~/.spirits/agent` は変更しない。

## Open Questions

- 詳細ログ・JSON の CI artifact 保管先は、実施環境の CI 設定に合わせる。spec とタスク分担は変わらない。
