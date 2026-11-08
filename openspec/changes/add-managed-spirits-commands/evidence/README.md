# 証拠の再実行手順と結果

対象 commit: `fb2291b0c`(archive 前の独立検証への対応)、実装 `5d1b0a09d`、前提確認のみ `62d6fada2`。公式 Pi は 1.5.0、artifact `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b`(製品の信頼ルートと一致)。すべて隔離 HOME、隔離 agent dir、ローカルの fake provider を使い、実データ・実認証・外部 network は使わない。

| 成果物 | 再実行 | 結果 |
|---|---|---|
| `precondition-results.json` | `bun evidence/precondition-probe.ts` | 19/19 pass。設定ロックの同時書き込み、`ctx.reload()` の挙動、`registerModelRoles` 不在、clear の方式 (a)/(b) 比較 |
| `managed-commands-results.json` | `bun evidence/managed-commands-probe.ts` | 13/13 pass。公式バイナリ上で `/spirits-clear` / `/spirits-role` / `/spirits-model`、settings の永続化、badge の `setStatus`、role API 不在の通知 |
| `official-compat-result.json` | 下記「互換性ランナー」(official) | `confirmed=29 limited=0 unavailable=0 not-run=3 failed=0`、`compatibilityMet=true`、`runnerProvenance.clean=true`、commit `fb2291b0c` |
| `fixture-compat-summary.md` | 下記「互換性ランナー」(fixture) | `confirmed=19 limited=3 unavailable=0 not-run=10 failed=0`、`compatibilityMet=false`(fixture は常に false)、目的観測は 9 件のうち 3 件。公式 Pi の互換性の根拠にはしない |
| `data-compat-results.json` | `bun evidence/data-compat-probe.ts [--fork <bin>] [--pi-dir <dir>]` | 12/12 pass。fork → managed の role 引き継ぎと settings 読み取り、managed → fork の settings・`spirits_role` entry 読み取り |

## 互換性ランナー

```sh
bun scripts/build-managed-pi-inputs.ts --version 0.87.1 --out dist
# ステージング領域には manifest.json と公式 tarball を置く。clean な worktree で走らせないと
# runnerProvenance.clean が false になる。
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged-root> \
  --bundle "$PWD/dist/spirits-managed-pi-extension.js" \
  --commit "$(git rev-parse HEAD)" \
  --bundle-version 0.87.1 \
  --out <tmp>/result.json
```

fixture mode は fixture set を導入した managed root を測る。fixture set は `packages/spirits/test/managed-pi-fixtures.ts` の `makeManagedFixture({ piScript: FAKE_RPC_PI_SCRIPT })` と `installManagedSet()` で作る(`packages/spirits/test/managed-pi-integration.test.ts` と同じ手順)。`--commit` は不要で、結果は `fixture-only` としてラベルされる。

```sh
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture managed root> --out <tmp>/result.json
```

`role/clear/model matrix` の 9 目的は次のとおり。

| purpose | state | 根拠 |
|---|---|---|
| `skill-strong-phase` | available | plain が `fake-model`、strong phase が `fake-strong` で受信された |
| `model-role-vocabulary` | available | `/spirits-role strong` の次が `fake-strong`、`normal` の次が `fake-model`。選択は不変 |
| `role-badge` | limited | `setStatus` が RPC で届く(拡張 status 行)。core footer の badge とは別の場所 |
| `thinking-level` | limited | `/spirits-model <ref> <level>` の level が session runtime で読み戻せる。pi の `/model` ピッカーは経由しない |
| `role-selection` | available | `/spirits-model <ref> <level> <role>` が model を選びつつ `models.role` を書いた |
| `default-save` | available | 選択後に既定 settings キーが変化した |
| `conversation-clear` | available | `/spirits-clear` の後の要求が `compat-clear-after-*` を含み `compat-clear-before-*` を含まない。セッションファイルは全 entry を保持 |
| `same-session-id` | available | session ID が不変 |
| `todo-retention` | available | TODO entry が 1 件そのまま残る |

## 使った入力

- fork 経路のバイナリ: `dist/spirits-linux-x64`、SHA256 `6b26ddc0dd445350ec552d8a11be80baea5fbca2b72ca135fb761f770ace00f6`
- 拡張 bundle(official 実行、commit `fb2291b0c`): `dist/spirits-managed-pi-extension.js`、SHA256 `7db6f613269adc91e547b84390670930a91ab3daddf59d3d40dd8957eb38f473`
- 拡張 bundle(当初の実装 `5d1b0a09d`): SHA256 `267256bf7a98ebe76781a4ec2647df22365d171827a8e4c8f3640d16556ce5a7`

official 実行は `compaction`・fork・`/tree`・resume を観測しない。clear のこれらの挙動は実装前の前提確認 `precondition-results.json`(`B(b).boundary-survives-resume`、`B(b).automatic-compaction-fired`、`B(b).projection-shrinks-after-the-intercepted-compaction`)が根拠で、ランナー側はまだ観測していない。

fork 経路の確認は `data-compat-probe.ts` の fork 実行が兼ねる。`/spirits-*` が登録されないこと、`pi.virtual-model-state` を自分で書くこと、managed が書いた settings と `spirits_role` を読んで応答することを見る。
