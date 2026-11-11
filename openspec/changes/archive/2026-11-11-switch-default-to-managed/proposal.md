# Proposal: switch-default-to-managed

## Why

`spirits managed-pi` は公式 Pi + spirits 拡張 bundle を検証付きで導入・起動する経路として実装済みだが、明示的に呼んだときだけ動く実験経路のまま。利用者が既定で使うのは fork であり、公式 Pi に近い経路が実データで使われないまま検証負荷を引き受け続けている。また agent dir を分け続けているため、settings・sessions・auth が 2 系統に割れて互相運用ができない。

既定の起動経路を managed に切り替え、既存の `~/.spirits/agent` をそのまま使わせることで、(1) 利用者は fork と同じ CLI で公式 Pi 基盤を使い、(2) データは 1 系統になり、(3) fork は `SPIRITS_ROUTE=fork` という明示的な退避手段として残せる。

## What Changes

- **既定経路の切り替え**: コンパイル済み `spirits` は既定で managed（公式 Pi + spirits 拡張 bundle）を起動する。`spirits` のサブコマンド（`update`、`managed-pi`）と `--version` / `-v` の扱いは今のまま。
- **既定経路の CLI**: 今の fork と同じ引数を `--` なしでそのまま受け付ける（`--continue`、`--resume`、`--session`、`--fork`、`--session-dir`、`--export` など）。
- **agent dir**: 既定経路の managed は fork と同じ規則で agent dir を決める（既定 `~/.spirits/agent`、`SPIRITS_CODING_AGENT_DIR` も fork と同じ意味）。コピー・移行はしない。
- **初回起動前のバックアップ**: 既定経路で managed を初めて起動する前に、その agent dir のバックアップを 1 回だけ `~/.spirits/backups/agent-<UTC 時刻>/` に取る。シンボリックリンクはたどらずリンクのまま保存し、見つけたリンクと参照先を表示する。保存先とサイズを表示し、実行済みは managed root に記録して 2 回目以降は取らない。バックアップに失敗した場合は起動せず理由を表示して非ゼロで終了する。
- **fork への退避**: 環境変数 `SPIRITS_ROUTE=fork` で従来の fork を起動する。Pi 自身に `--fork` フラグがあるためフラグ名には使わない。fork を削除する change まで残す。
- **一式の取得**: `spirits update` と `install.sh` は、起動役のバイナリと同じリリースの manifest から managed の一式（公式 Pi と bundle）を取得・検証して導入する。初回起動時に一式が足りなければ同じ規則で取得する。取得失敗・破損時は黙って fork に切り替えず、理由と `spirits managed-pi repair` と `SPIRITS_ROUTE=fork` を表示して非ゼロで終了する。
- **bundle への版の埋め込み**: `scripts/build-managed-pi-inputs.ts` の `Bun.build` に manifest と同じ版を `SPIRITS_VERSION` として define し、リリースワークフローで `--version` と一致することを確認する。同梱スキルのディレクトリ名と起動ヘッダーの版が正しい値になる。
- **隔離経路は据え置き**: `spirits managed-pi` とそのガード（既存 agent dir の拒否、`--session` などの拒否）は互換性ランナーとテストのために残す。ガードの対象は隔離経路だけ。
- **試用環境のセッション戻し手順**: `~/.spirits/managed-pi/agent` で作ったセッションを `~/.spirits/agent` に戻す手順を docs に書く（自動では行わない）。

範囲外: fork の削除、薄い起動役への置き換え、Pi のパッチ、新しい機能の追加、リリース。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `managed-pi`: 既定経路が managed 起動になる（agent dir は fork と同じ規則、引数透過、初回起動前のバックアップ、不足時の取得、失敗時の非 fallback）。既存の隔離 agent dir ガードと起動引数の拒否は隔離経路に限定する。既存データの非破壊要件は隔離経路に限定し、既定経路のバックアップを認める。
- `binary-distribution`: 既定の起動経路と起動役の責務（route 選択）、`SPIRITS_ROUTE=fork` による fork 起動、インストーラによる同じリリースの managed 一式の導入、bundle へ埋め込む版とリリースワークフローの一致確認。
- `self-update`: `spirits update` が実行中のバイナリと同じリリースの manifest から managed の一式を取得・導入する。失敗時の終了コードと表示。

## Impact

- code: `packages/spirits/bin/bootstrap.ts`（route 選択）、`packages/spirits/bin/startup.ts`、`packages/spirits/bin/env-defaults.ts`（実装を `src/env-defaults.ts` へ移し shared 化する）、`packages/spirits/src/managed-pi/{default-route,default-env,agent-backup,release-assets,environment,launch}.ts`（新規 3 + 改訂 3）、`packages/spirits/src/update/run.ts`（解決したリリース tag を返す）
- scripts: `scripts/build-managed-pi-inputs.ts`（`SPIRITS_VERSION` define）、`scripts/check-managed-pi-bundle-version.ts`（新規）、`scripts/install.sh`（同じリリースの managed 一式を起動役へ委任）
- workflows: `.github/workflows/spirits-release.yml`（bundle の版と `--version` の一致確認）
- docs: `docs/spirits-managed-pi.md`（既定経路化・バックアップ・復元・fork への戻し方・修復）、`packages/spirits/README.md`
- specs: `openspec/changes/switch-default-to-managed/specs/{managed-pi,binary-distribution,self-update}/spec.md`
- tests: `packages/spirits/test/{managed-pi-default-route,managed-pi-default-env,managed-pi-agent-backup,managed-pi-release-assets,managed-pi-build-inputs,bundled-skills,env-defaults,managed-pi-bootstrap,managed-pi-integration}.test.ts`
- architecture: `docs/architecture/convention-registry.md` の `registry:layer-members` に `packages/spirits/src/env-defaults.ts` を `spirits:shared` へ追加
- **Pi 上流コアへの差分: なし**（`packages/coding-agent` ほか Pi 側コードは変更しない）
