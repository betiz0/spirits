# 実測証拠 (switch-default-to-managed)

既定経路を managed に切り替えたことに対する実測を置く。実データ・実認証・実 provider は不使用。
すべて隔離 HOME とローカル fake provider で走らせている。

## 1. 既定経路の agent dir 読み書き実測 (`docs/agent-data-compat/default-route/`)

`scripts/agent-data-compat/run.ts --managed-route default`(本変更で追加した option)で、既定経路の形
そのものを測った。managed ホストは fork と同じ agent dir 規則 (`<home>/.spirits/agent`)、session dir は
pin せず、初回起動前に製品コードの `backupAgentDirOnce()` を通る。

- 23 項目 = bidirectional 18 / one-way 1 / not-run 4(隔離経路の実測と同じ形)
- 初回バックアップは managed の 4 スロットすべてで実行され、`<home>/.spirits/backups/agent-<UTC>/` と
  `<home>/.spirits/managed-pi/agent-backup.json` に残った(`result.json` の `defaultRouteBackups`)
- session は Pi の既定配置 `<agent dir>/sessions/--<cwd>--/<ts>_<id>.jsonl` に作られ、fork 側もそれを
  読んで追記できた(`sessions read` / `sessions rewrite (append-only)` = bidirectional)
- 実 `~/.spirits/agent` は無変更、予期しない provider リクエスト 0

手順・来歴・判定の内訳は [docs/agent-data-compat/README.md](../../../docs/agent-data-compat/README.md)
の「既定経路での実測」節。

## 2. 互換性ランナー official (`official-compat/`)

```sh
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out dist
mkdir -p /tmp/pi-compat-staging/artifact-current
ln -f /tmp/pi-compat-staging/artifact/pi-linux-x64.tar.gz /tmp/pi-compat-staging/artifact-current/
cp dist/spirits-managed-pi-manifest.json /tmp/pi-compat-staging/artifact-current/manifest.json
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root /tmp/pi-compat-staging/artifact-current \
  --bundle "$PWD/dist/spirits-managed-pi-extension.js" \
  --commit "$(git rev-parse HEAD)" \
  --bundle-version 0.1.0 \
  --out /tmp/mpc-official/result.json
```

`assertOfficialBundleSha` が「manifest が組んでいる bundle と実際に渡した bundle」を照合するため、
`artifact-current/manifest.json` は本 commit からビルドした manifest を使う(Pi の pin は同じ tarball を
指したまま)。成果物はこのディレクトリに `result.json` と `managed-pi-compat-result.md` で、上の出力は
`/tmp/mpc-official/` に置いたものを複製したものである。

- 終了コード 0。`confirmed=34 limited=0 unavailable=0 not-run=3 failed=0`
- `mode=official runnerCompleted=false compatibilityMet=true`(`not-run` が 3 残るため runnerCompleted は
  false。判定の定義は [docs/spirits-managed-pi.md](../../../docs/spirits-managed-pi.md) のとおり)
- `existingAgentDirUnchanged=true`
- 必須観測 25 件はすべて confirmed
- `targetCommit=47f8c067b`(独立検証の修正コミット)、`workingTreeClean=true`

実装は初回(`targetCommit=d8265a9b5`)と修正後の再実行(`47f8c067b`)で同一の判定結果で、bundle の
digest も同一(`5cfed658…`)。初回実行は `workingTreeClean=false` だった(内訳は
`scripts/agent-data-compat/{run.ts,hosts.ts}` の `--managed-route` 追加と計測出力の未追跡ファイルで、
ランナーと bundle 自体は clean な `d8265a9b5` ツリーで作成済み、digest は再現済み)。修正後の再実行は
clean なツリーで行ったため、その区別は消えている。

### 前回 official との比較

比較先: 直前の official 実行。`openspec/changes/archive/2026-11-10-harden-managed-commands/evidence/official-compat-result.json`
(runner commit `66d5c68c4`)。

| 観点 | 前回 (harden) | 今回 |
|---|---|---|
| 項目数 | 37 | 37 |
| confirmed / limited / not-run | 34 / 0 / 3 | 34 / 0 / 3 |
| 全項目の status 後退 | — | 0 件(37 項目すべて同状態) |
| not-run | `direct execute probe is auxiliary` / `existing agent dir write-back compatibility` / `settings write compatibility` | 前回と同じ 3 件 |
| Pi / tarball / executable / overlay | 1.5.0 / `df870ba0…` / `61a84400…` / 1.5.0-spirits.1 | 同一 |
| bundle sha256 | `2f048985e24806545314e0f663f21a5e9c52218cfe66cf8e9266f6ca4e439d47` | `5cfed65805ea7834713b2fa83064584ed8e8ba999fa5493f4a323f90742dfb07` |
| `workingTreeClean` | true | true |

項目一覧・状態・`not-run` の中身は同一。bundle sha の差は `d8265a9b5` で bundle に `SPIRITS_VERSION`
(版の埋め込み)が入ったことで、製品拡張の挙動ではない(同ビルドの manifest が同じ sha を指す。
`assertOfficialBundleSha` 通過)。後退 0 件。

### 参考: 2026-11-06 の official との比較

`openspec/changes/archive/2026-11-06-repair-managed-pi-compat-harness/evidence/official/`
(runner commit `d262a8d6f`)との比較は参考として残す(項目数が 32 → 37、`rlm auto parent` が
limited → confirmed などで、差分の大半は `session-clear` と `harden-managed-commands` での観測追加)。

## 3. ビルド・版の埋め込み

```sh
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out dist
bun scripts/check-managed-pi-bundle-version.ts \
  --bundle dist/spirits-managed-pi-extension.js \
  --manifest dist/spirits-managed-pi-manifest.json \
  --version 0.1.0
# Managed bundle embeds version 0.1.0.
```

`SPIRITS_VERSION` の define が効いて bundle 内に `0.1.0` が入り、識別子の残骸と `0.0.0-dev` は 0 件。
上の実測で managed 側が `bundled-skills/0.1.0/` を作ったのと同じ事実である。
