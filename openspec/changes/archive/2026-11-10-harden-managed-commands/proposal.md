# Proposal: harden-managed-commands

## Why

`add-managed-spirits-commands` は archive されたが、独立検証（verify2）の指摘と、仕様ゲートの未達が残った。

1. `openspec validate --all --strict` が base spec の 5 capability で失敗しており、spec 変更のゲートが通せない。失敗はいずれも「要件本文が 500 字を超える」という書式要件で、要件内容は問題ではない。
2. 互換性マトリクスは `alternative` と `difference` を目的ごとに持たず、`limited` の意味が「ユーザーから見える差異」と「観測手段の制約」で二重化している。公式 Pi 実行で代替手段がどこまで本来の機能を再現したか読めない。
3. `/spirits-clear` の境界に依存する挙動（自動 compaction、手動 compaction の肩代わり、fork、セッションツリー移動、再開）が専用 Pi 上で観測されていない。Pi 更新でここが壊れても検出できない。
4. 独立検証の指摘（仮想モデルの除外方式、role 選択時の badge、既定値保存の成否判定、設定書き込み失敗の報告、docs の drift）が残っている。

## What Changes

- **書式のみ** base spec を分割し、`openspec validate --all --strict` を緑にする。要件本文・シナリオの意味は変えず、既存シナリオを分割後のいずれかの要件にそのまま移す。内容変更が必要なものは一覧化して報告する。
- **MODIFIED** 互換性マトリクス: `limited` の定義を「ユーザーから見える挙動の差異がある」に統一する。観測手段の制約は目的観測の detail に書く。
- **ADDED** マトリクス記載規則: 代替手段で満たした行は `alternative` と `difference` の両方を必ず持つ。目的定義が代替手段と差異を保持し、行へ伝搬する。
- **ADDED** `/spirits-clear` の区切りに依存する挙動の観測項目（公式 artifact 実行の必須観測）: 区切りより後の自動 compaction、手動 compaction の肩代わり有無、fork したセッション、ツリーで区切りより前へ移動、セッション再開。RPC と拡張 API のどちらからも操作できない項目は理由付き `not-run` とし、観測用の新しい基盤は作らない。
- **MODIFIED** `/spirits-model`: 仮想モデルの除外を api 値によるものにする。設定書き込みが失敗したときはセッション変更を取り消さず、保存失敗を分けて伝え、再読み込みしない。
- **MODIFIED** role badge: role 選択時と、拡張の再読み込み後のセッション開始時に描画する。
- **ADDED** 同梱スキル `sprt-opsx-verify-deep`: archive 可否の判定前に `openspec validate <change> --strict` を実行し、失敗を CRITICAL として報告する。
- clear 区切りの識別方式（メッセージ数依存）を entry ID / timestamp で置換できるか評価し、結果を design.md に残す。

## Capabilities

### Modified Capabilities

- `managed-pi-compatibility`: マトリクスの状態定義と記載規則、`/spirits-clear` 境界の観測項目。
- `managed-commands`: 仮想モデルの除外方式、既定値保存の失敗報告、role badge の描画時点。
- `sprt-opsx-verify-deep`: archive 可否判定前の strict 検証。

### New Capabilities

なし。

## Impact

- code: `scripts/managed-pi-compat/matrix.ts`（代替手段と差異を目的定義へ、行への伝搬、`limited` の意味）、`scripts/managed-pi-compat/run.ts`（clear 境界の観測項目）、`scripts/managed-pi-compat/processes.ts`（fake provider の usage 制御）、`scripts/managed-pi-compat/fixtures/probe-extension.ts`（ツリー移動とセッションファイルの観測）、`packages/spirits/src/commands/model.ts`、`packages/spirits/src/commands/register.ts`
- docs: `docs/spirits-managed-pi.md`、`docs/spirits-managed-pi-design.md`
- specs: `openspec/specs/*/spec.md` の書式分割（意味不変）、`openspec/changes/harden-managed-commands/specs/**` の delta
- tests: `packages/spirits/test/managed-commands.test.ts`、`packages/spirits/test/managed-pi-compat-matrix.test.ts`、`packages/spirits/test/managed-pi-compat-evidence.test.ts`
- 既存の既定経路・managed ガード・fork 削除・新機能は変更しない。
