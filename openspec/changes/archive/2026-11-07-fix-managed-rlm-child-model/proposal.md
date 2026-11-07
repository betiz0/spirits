# Proposal

## Why

`rlm` は親セッションのモデル選択をそのまま子に渡すため、親が `spirits/auto` のような virtual model を選んでいると、子セッション側の新規 `ModelRuntime` に対応 provider が無く `No API key found for spirits` で失敗する。fork 経路と managed 経路は同じ拡張コードを使うため両方で再現し、互換性ランナーの `rlm auto parent` は常に `limited`(既知の制約)のままだった。委任手段としての rlm は M3 の中核なので、virtual model を既定の選択として使う運用で最初に踏む穴を塞ぐ。managed 経路の設計文書は、この変更の一次根拠として `docs/spirits-managed-pi-design.md` に固定する。

## What Changes

- 親が virtual model を選んでいるとき、**親の側で物理モデルに解決してから**子を起動する。対象解決は既存の `resolveStrongTarget` / `resolveNormalTarget` を使い、新しい解決規則は追加しない。直近の成功応答の物理モデルは、振り分け本体と同じく資格情報があるものだけを使う。
- 子のロールは親の現在の位相に従う: strong 位相で strong 対象が解決できれば strong、それ以外は normal(settings の `defaultProvider` / `defaultModel`、それが使えなければ資格情報のある直近の成功応答の物理モデル)。
- 解決できない場合は子を生成せず、試みたロールと不足・使用不可の設定を名指す例外をセルへ返す。子の生成に失敗した場合は、例外に試みた物理モデルを含める。virtual model を子に渡さない(第三者拡張が登録した virtual model を親にしている場合も同じ)。
- 親が物理モデルで子を生成する場合の挙動は変更しない。
- **BREAKING(記録の意味)**: `rlm_usage` の `provider` / `modelId` は「親のモデル」ではなく「子に実際に渡したモデル」を記録する。子を生成しなかった呼び出し(引数不正・深度上限・親のモデル未設定・解決失敗・子の生成失敗・生成前の中断)は、親の種別によらず null になる。仕様と docs に意味として明記する。
- 互換性ランナーの `rlm auto parent` の判定条件を「子が物理モデルで完了したら confirmed」に締める。条件を満たさない場合は failed とする(fixture が子の対象を用意していない場合と、provider へリクエストを送らない固定イベントの host の場合だけ not-run。fixture が揃っていれば解決エラーも failed)。新しい probe は追加しない。
- managed 経路で spirits の機能をどう実現するかという調査・設計文書を `docs/` 配下へ保存し、訂正節を追加する(ドキュメントのみ。コードは無関係)。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `rlm`: 子セッションへ渡すモデルは物理モデルでなければならないという要件、`rlm_usage` の `provider` / `modelId` の意味、子の構成と子の失敗の伝達の文言を変更する。
- `dual-model-routing`: `spirits/auto` を選んだ親が `rlm` を呼んだときの子の対象解決(ロール位相、strong→normal のフォールバック、資格情報の確認、解決失敗時のエラー)を追加する。
- `managed-pi-compatibility`: `rlm auto parent` の観測を既知の制約から、子が物理モデルで完了したかどうかの判定(confirmed / failed / not-run)に変更する。

## Impact

- **Pi 上流コアへの差分: なし。** `packages/coding-agent`、`packages/ai`、`packages/tui` は変更しない。
- 製品コード:
  - `packages/spirits/src/rlm/hostfn.ts`: 注入された子モデル解決関数の呼び出し、`rlm_usage` の記録値、生成失敗の例外文。
  - `packages/spirits/src/routing/`: 子用の対象解決(既存 resolver の再利用、直近の成功応答の物理モデルをセッション branch から読み、資格情報を確認する)と、位相の読み取り口の公開。
  - `packages/spirits/src/index.ts`: 合成のみ。`rlm` と `routing` は兄弟層(`docs/architecture/convention-registry.md` `registry:layers`)なので、両者を結ぶのは `entry` 層に限られる。
- テスト: `packages/spirits/test/rlm-hostfn.test.ts`、`rlm-cell.test.ts`(既存)、`routing-child-model.test.ts`・`rlm-child-model.test.ts`(新規)、`test/pi-runtime/child-model-source-pin.test.ts`(新規、assistant メッセージの `provider` / `model` / `stopReason` と `getBranch()` のピン)、`managed-pi-compat-rlm.test.ts`。
- docs: `docs/spirits-m3-rlm.md`(`rlm_usage` の意味と子モデルの解決、既知の制約)、`docs/spirits-m5-phase2.md`(`rlm_usage` を読む指標の定義)、`docs/spirits-managed-pi.md`(`rlm auto parent` 項目の判定と意味)、`docs/spirits-design.md`(managed 経路の段落から新文書へのリンク)、新規 `docs/spirits-managed-pi-design.md`(設計書の保存と訂正)。
- ハーネス: `scripts/managed-pi-compat/`(`rlm.ts` の判定、`fake-provider.ts` の要求モデル名の記録、`run.ts` の auto 項目、`evidence.ts` のラベルと証拠)。
- 依存追加: なし。既定配布物、`spirits update`、install.sh、既定経路の契約は変更しない。
- 非範囲: 設定の書き込み、`/spirits-*` コマンド、`/clear` の代替、role badge、Pi への限定パッチ(PA `modelRuntime` / PB `clearConversation`)、子への `modelRuntime` の受け渡し、第三者拡張が登録した provider を子から使えるようにする対応、既定経路の切り替え。
