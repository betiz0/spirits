# Proposal

## Why

managed Pi の通常起動は既定で `~/.spirits/agent` を保存先にするが、書き込み互換は未確認のままである。監査では、一時 HOME と fixture を使った再現で、managed 起動がこの既定 agent dir に書き込めることを確認した。互換性ランナーが一時 agent dir を使うことは、製品起動経路の実データ保護にはならない。

また、archive 済み `add-managed-pi-route` の完了チェックの一部は、現在の再実行結果と一致しない、または実行結果・ログ・CI で裏付けられない。過去の成功記録をそのまま再利用せず、実験期間の安全性を先に確定し、完了記録の訂正を永続化する必要がある。

## What Changes

- **BREAKING**: 実験期間中、`spirits managed-pi` の保存先を専用の隔離 agent dir `<managed root>/agent`（既定 `~/.spirits/managed-pi/agent`）に固定する。既存 `~/.spirits/agent` は managed 経路から直接利用しない。
- **BREAKING**: `SPIRITS_CODING_AGENT_DIR` の明示指定は、パス安全性の検査後に固定された隔離 agent dir と正規化して一致する場合だけ受け付ける。それ以外の絶対パス・相対パス・`~` 指定は、Pi を spawn する前に理由付きで拒否する。任意の指定先を安全な実験領域とみなさない。
- wrapper の通常経路向けの既定値注入と、利用者の明示指定を混同しない。wrapper は `applyEnvDefaults()` より前に環境の独立コピーを取得し、managed コマンドにはそのコピーだけを渡す。通常経路の既定値と `process.env` の扱いは変更しない。
- `PI_CODING_AGENT_DIR`、旧名の session dir、継承された `PI_APP_NAME` / `PI_CONFIG_DIR` など、保存先や identity の解決に影響する環境変数を sanitize する。session dir は隔離 agent dir 配下に固定する。
- symlink、既存 agent dir との一致・包含、managed root 外への解決、ディレクトリ以外の agent dir を起動前に拒否する。隔離 agent dir は必要な場合だけ 0700 で作成する。
- `--session`、`--fork`、`--session-dir`、`--export` など、既存データや外部 session を指せる CLI 引数は managed 起動で拒否する。`--continue`、`--resume`、`--session-id` は固定 session dir の範囲で許可する。
- `install`、`update`、`repair`、wrapper `help`、`--version`、通常 managed 起動の副作用を定義し、既存 agent dir を作成・変更しないことをテストで固定する。
- 警告の承認、force オプション、既存 agent dir の自動コピー・移行・同期は追加しない。
- 通常の `spirits` 起動、`spirits update`、`~/.spirits/agent`、install.sh、既定配布の契約は変更しない。
- archive 済み `add-managed-pi-route` の経緯を残したまま、監査で確認できたこと、以前の完了チェックを裏付けられないこと、実測で未達と判明したこと、後続 change で対応することを訂正記録に残し、元の archive から参照できるようにする。
- 互換性ランナーの全面修正、rlm の認証継承、role・`/clear`・`/model` の代替実装、既存データ移行、本番配布、既定経路切り替えは行わない。

## Capabilities

### New Capabilities

なし。既存の `managed-pi` の要件を変更する。

### Modified Capabilities

- `managed-pi`: 実験経路の保存先を既存 `~/.spirits/agent` から専用の隔離 agent dir に変更し、明示パス・継承環境・CLI 引数による迂回を拒否する。既存データの直接利用に関する要件を、実験期間の分離要件に置き換える。

## Impact

- 影響コード:
  - `packages/spirits/src/managed-pi/`: agent dir の解決・検証・作成、起動環境の sanitize、起動前の引数検証、launch/command の配線。
  - `packages/spirits/bin/`: 既存の分類・gate・version・既定適用の順序は維持し、`applyEnvDefaults()` より前に取得した環境の独立コピーを managed コマンドへ渡す限定配線を追加する。引き渡し用の `packages/spirits/bin/startup.ts` を新設する。通常経路は既定適用後の `process.env` を使い続ける。
  - `scripts/managed-pi-compat/`: 新しい環境計算 API に追従する最小限の修正。ランナーの分類・probe・rlm・データ互換の全面修正は行わない。
- 影響テスト:
  - `packages/spirits/test/managed-pi-agent-dir.test.ts`（新規）
  - `packages/spirits/test/managed-pi-bootstrap.test.ts`（新規）
  - `packages/spirits/test/managed-pi-env.test.ts`
  - `packages/spirits/test/managed-pi-launch.test.ts`
  - `packages/spirits/test/managed-pi-install.test.ts`
  - `packages/spirits/test/managed-pi-update.test.ts`
  - `packages/spirits/test/managed-pi-repair.test.ts`
  - `packages/spirits/test/managed-pi-command.test.ts`
  - `packages/spirits/test/managed-pi-integration.test.ts`
- 影響ドキュメント:
  - `docs/spirits-managed-pi.md`
  - `packages/spirits/README.md`
  - `openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md`（新規、archive 内）
  - archive 済み `tasks.md` への追記（既存チェックは変更しない）
- Pi 上流コアへの差分: なし。`packages/coding-agent`、`packages/ai`、`packages/tui` は変更しない。
- 依存追加: なし。
- 既存データ: 実験経路では既存 `~/.spirits/agent` を読み書きしない。通常 `spirits` のデータはそのまま残る。既存データを手作業なしで継続利用する最終要件は撤回せず、本番移行前に別 change で読み書き互換を実証する。この change は互換性を実証済みとして扱わない。
- 保証しない範囲: OS レベルのサンドボックス、任意の絶対パスや `bash` / `read` / `write` / `edit` / 拡張機能によるファイルアクセスの制限。今回の保護は agent dir と session dir の選択に関する起動前制御である。