# Proposal

## Why

`scripts/managed-pi-compat/` のランナーは、fixture の Pi スクリプトが返す固定イベントをそのまま結果として記録し、一部の項目は runner 自身の Bun プロセスや固定入力の分類に頼っている。archive 済み `add-managed-pi-route` の `completion-correction.md` は、公式 Pi 実体での実測がされていないこと、複数の完了チェックが現在のコードと矛盾することを記録している。後続の製品修正を判断するには、fixture 実行と公式 artifact 実行を分離し、公式 Pi 上で通常のモデル→ツール経路を実行する測定基盤が要る。

## What Changes

- ランナーに `fixture` / `official` の実行モードを導入する。fixture の固定イベントは製品互換性の証拠にせず、全結果に実行モードを付ける。
- 公式 Pi 固定成果物と、対象 commit から生成した拡張 bundle で実行する。artifact、bundle、manifest、overlay の版と SHA256 を結果に記録する。
- fake provider を Pi の `openai-completions` プロバイダが実際に使う SSE ストリーミング形式に対応させる。実 provider・実認証は使わない。
- tsrepl を通常のモデル→ツール実行経路で確認する。直接ツール本体を呼ぶ probe は補助検証として明示的に区別し、他の拡張のツール登録を捕捉できると仮定しない。
- rlm は、子からも利用できる認証・モデル設定の fixture を準備する。物理モデル親と、normal/strong 設定済みの `spirits/auto` 親を分けて測る。子の生成・回答・usage・中断を個別に判定し、fixture 不足を製品不具合と断定しない。
- 設定・セッション等の互換性は、専用 Pi による読み書きで確認する。Node によるファイル読み取りや固定入力の分類を代用しない。読み取り対象は spec と同じ 4 種（settings・auth・sessions・外部拡張）に広げ、redact した既存 agent dir のコピーを隔離 agent dir に配置して測る。専用 Pi の書き込み経路と、既存 agent dir のデータへの書き戻し互換を別項目に分け、書き戻し互換は実証できるまで未確認とし、互換性成立の必須観測に含めない。
- role・`/clear`・`/model` は目的ごとに専用 Pi で動作観測する。API やコマンド一覧の有無だけから状態を確定せず、マトリクスの行の状態も目的観測から導出する。公式 Pi のコマンド一覧には組み込みの `/clear` と `/model` が掲載されないため、不在を「利用不可」にしない。
- 公式モードは `--bundle` の SHA256 を manifest の拡張 bundle SHA と照合し、spawn 直前に実行ファイルの SHA256 を再計算して照合する。不一致なら起動せず結果を書かない。
- 保存先保護を維持し、一時 HOME・隔離 agent dir で実行する。保存先検証は旧来の明示指定優先から隔離 agent dir 固定へ追従させる。製品側は前 change で実装済みであり、今回はランナー側の追従である。公式 Pi 起動前後で既存 agent fixture の不変を確認する。
- 結果と証拠を保存する。対象 commit、作業ツリーの変更有無、Pi 版、各成果物 SHA、コマンド、環境条件、結果 JSON、stdout/stderr を対応付ける。来歴にはランナー側と Pi ホスト側のランタイム、必要 API の有無を区別して記録し、観測できない値は `unknown` とする。認証・秘密情報は保存しない。人が読める要約は `--out` で指定した JSON の隣に `managed-pi-compat-result.md` として出力する。通常実行で追跡中の `docs/` を書き換えない。リポジトリへ残す要約は、検証後に対象結果を選んで記録する別操作とする。CI artifact の対象には JSON、要約、必要なログを含め、詳細ログ・JSON の保管方法と再実行方法を定める。
- 結果判定を明確にする。個々の項目を `confirmed` / `limited` / `unavailable` / `not-run` / `failed` で区別し、「ランナーが完走した」と「互換性要件を満たした」を分ける。`fixture` モードの成功を公式 Pi の互換性成立の根拠にしない。必須観測が `not-run` または `limited` の場合に、`failed=0` という理由だけで成功にしない。必須観測には専用 Pi で実測できる項目だけを含め、製品側の制約で観測できない `rlm` の子中断を含めない。観測項目と期待する証拠を対応表にする。実行した全項目のコマンドと stdout/stderr を記録し、Pi ホスト側のランタイムは識別できる値（Bun 実行なら Bun の版）で記録する。
- 将来の拡張単体利用に向け、managed ランチャー固有の処理と拡張本体の責務を分離する。互換性結果には Pi 版、実行形態、ランナー側と Pi ホスト側のランタイム、必要 API の有無を記録する。managed 専用の保存先・identity 制御を拡張本体の必須処理にしない。将来対応のための汎用抽象・設定項目・分岐は追加しない。

## Capabilities

### New Capabilities

なし。既存の `managed-pi-compatibility` の要件を変更する。

### Modified Capabilities

- `managed-pi-compatibility`: 執行モードと来歴、公式 artifact と対象 commit bundle での実行、通常ツール経路、rlm fixture、専用 Pi による設定・セッション読み書き、目的別 role/clear/model 観測、fake provider のストリーミング形式、証拠保存と結果判定の要件を変更する。

## Impact

- **Pi 上流コアへの差分: なし。** `packages/coding-agent`、`packages/ai`、`packages/tui` は変更しない。
- 影響コード:
  - `scripts/managed-pi-compat/`: ランナー、probe、fake provider、tsrepl、rlm、data、matrix、rpc、labels、fixtures。
  - `packages/spirits/test/managed-pi-compat-*.test.ts`: 各項目のテスト。
  - `docs/spirits-managed-pi.md`: 実行方法、結果の読み方、保管方法。
  - 必要な場合のみ `packages/spirits/src/managed-pi/`: ハーネスが観測に必要な既存 API の公開。製品仕様(`managed-pi`)は変更しない。
- 影響テスト: `packages/spirits/test/managed-pi-compat-*.test.ts`、`bun scripts/managed-pi-compat/run.ts` の実行（修正後の fixture / official 再実行を含む）。結果項目の改名に伴い `docs/spirits-managed-pi.md`、人が読める要約、観測と証拠の対応表を追従させる。
- 依存追加: なし。
- 配布: 既定配布物、`spirits update`、install.sh の契約は変更しない。
- 非対象: 製品 rlm の認証継承仕様変更、role・clear・model の代替機能追加、実データ移行、本番 release 資産の公開、既定経路切り替え、フォーク削除。製品不具合が判明した場合は、再現条件・証拠・影響を記録し、別 change 候補として報告する。
- 将来の拡張単体利用: 標準配布は spirits が専用 Pi を一起導入・管理する方式を維持する。利用者が管理する Pi への拡張追加は今回実装しない。外部 Pi 対応可否は、この change の公式 Pi 実測結果を材料に後続 change で決定する。
