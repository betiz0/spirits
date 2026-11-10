# Tasks: harden-managed-commands

## 1. spec ゲートを緑にする（書式のみ）

- [x] 1.1 `openspec validate --all --strict` の失敗 5 件（`binary-distribution`、`continual-harness`、`dual-model-routing`、`managed-pi-compatibility`、`self-update`）を、本文を分割して 500 字以内に収める。既存の本文の文言は変えず、シナリオは分割後のいずれかの要件へそのまま移す
- [x] 1.2 分割で解消しないものがあれば、内容変更が必要な一覧を作り報告する（実装しない）
- [x] 1.3 `openspec validate --all --strict` が 22 件すべて成功すること

## 2. マトリクスの代替手段と差異（W9）

- [x] 2.1 `PurposeObservation` に `alternative` と `difference` を追加し、`PURPOSE_DEFINITIONS` を目的定義の唯一の情報源として `alternative` を埋める
- [x] 2.2 `deriveRows()` が行へ `alternative` と `difference` を写し、`validateMatrix()` が `not-run` 以外の子孫行の両字段を要求する
- [x] 2.3 `observePurposeState()` が detail に代替手段である旨を必ず付ける
- [x] 2.4 `limited` をユーザーから見える差異に統一し、観測手段の制約（RPC が thinking level を返さない 等）を detail へ移す
- [x] 2.5 `managed-pi-compat-matrix.test.ts` を更新し、代替手段を満たした行の `alternative` / `difference` 欠落が失敗になること、`limited` の理由がユーザーから見える差異であることを検証する

## 3. `/spirits-clear` の区切りの観測（W5）

- [x] 3.1 fake provider に区切り後だけ大きい usage を返す設定を追加する
- [x] 3.2 probe extension にセッションファイルの記録と、拡張 API によるセッションツリー移動のコマンドを追加する
- [x] 3.3 区切りより後の自動 compaction の項目（肩代わり、要約に clear 前が含まれない、要約のモデル呼び出し 0 件、後続リクエスト）
- [x] 3.4 手動 compaction の項目（消した対話が範囲内のときは肩代わり・モデル呼び出し 0 件、範囲に無いときは肩代わりしない・モデル呼び出しが発生）
- [x] 3.5 fork の項目（区切りより後の message で fork し、セッションファイルが切り替わり、clear 前が再出現しない）
- [x] 3.6 セッションツリー移動の項目（区切りより前へ移動すると clear 前が復活する）
- [x] 3.7 再開の項目（別プロセスで再開しても clear 前が出ない）
- [x] 3.8 判定関数を純粋モジュールへ置き、既知の入力で各状態を返すユニットテストを追加する
- [x] 3.9 項目を必須観測と evidence の見出しに追加する

## 4. 独立検証の残課題

- [x] 4.1 `/spirits-model` の仮想モデル除外を api 値判定に変更する
- [x] 4.2 `/spirits-role` と `/spirits-model` の role 選択後に badge を描画する
- [x] 4.3 拡張の再読み込み後のセッション開始で badge が再描画されることをテストする
- [x] 4.4 設定書き込み失敗時に、セッション変更を維持し、保存失敗を分けて伝え、再読み込みしない
- [x] 4.5 既定値保存と role vocabulary の判定を、専用 Pi が読み込んだ既定値から行う（Node 側のファイル読み取りを代用しない）
- [x] 4.6 `docs/spirits-managed-pi.md` のコマンド説明、既知の限界、互換性ランナーの説明を現状の実装に合わせる
- [x] 4.7 `docs/spirits-managed-pi-design.md` の表に `add-managed-spirits-commands` の行を加える

## 5. 同梱スキルと評価

- [x] 5.1 `sprt-opsx-verify-deep` の SKILL.md に、archive 可否の判定前へ `openspec validate <change> --strict` を追加する
- [x] 5.2 clear 区切りの識別方式（メッセージ数依存）を entry ID / timestamp で置換できるか評価し、結果を design.md に残す

## 6. 検証と証拠

- [ ] 6.1 `openspec validate harden-managed-commands --strict` が成功する
- [ ] 6.2 `bun test`、`bun run check`、`npm run check` が成功する
- [ ] 6.3 clean なツリーで official artifact 実行を 1 回行い、来歴と必須観測を含む証拠を `evidence/` に保存する
- [ ] 6.4 fixture 実行を 1 回行い、互換性証拠にしないことを明示して保存する
- [ ] 6.5 検証結果を `verification/` に保存する
