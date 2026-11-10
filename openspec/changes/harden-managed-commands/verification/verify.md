# 検証結果 (verify)

対象: `harden-managed-commands`。対象 commit `66d5c68c4`(実装)/ `965f3a361`(提案)。実行日 2026-11-10。

## B-0. OpenSpec の strict 検証

```
$ openspec validate harden-managed-commands --strict
変更 'harden-managed-commands' は有効です

$ openspec validate --all --strict
結果: 成功 23 / 失敗 0 （計 23 件）
```

失敗 0 件。base spec の 5 件(`binary-distribution` / `continual-harness` / `dual-model-routing` / `managed-pi-compatibility` / `self-update`)は 500 字制限に引っかかっていたが、意味と scenario を保ったまま要求を分割して解消した。分割は書式のみのため delta にはせず、base spec への直接編集にしている。

## テストと型検査

```
$ cd packages/spirits && bun test
 914 pass / 0 fail (2967 expect, 99 files)

$ cd packages/spirits && bun run check   # tsc --noEmit
成功

$ npm run check                          # biome + pinned-deps + runtime-deps + ts-imports + entry-graphs + install-lock + tsc + browser-smoke
成功
```

新規・更新したテスト:

| ファイル | 内容 |
|---|---|
| `packages/spirits/test/managed-pi-compat-clear-boundary.test.ts` | 5 項目の判定関数。自動 compaction の確認/失敗/not-run、手動 compaction の肩代わり・非肩代わり・拒否、fork、tree move、resume、fork/tree の対象 entry 選択、probe snapshot から compaction entry を読む件、境界 provider が閾値を 1 回だけ超えること、pi の 2 形の要約 prompt をどちらも肩代わり失敗に数えること |
| `packages/spirits/test/managed-pi-compat-matrix.test.ts` | `alternative`/`difference` の必須化、`limited` は利用者に見える差異を挙げる、代替で満たした観測の detail に `alternative` が含まれる、role routing の判級 |
| `packages/spirits/test/managed-pi-compat-result.test.ts` | 5 つの境界項目が必須観測に入っていること |
| `packages/spirits/test/managed-commands.test.ts` | virtual model を API で除外する、role badge の Redraw、settings 書き込み失敗時に session 変更を残して reload をスキップする |

## 公式 artifact 実行

`evidence/official-compat-result.json`。commit `66d5c68c4`、`runnerProvenance.clean=true`。

```
confirmed=34 limited=0 unavailable=0 not-run=3 failed=0
compatibilityMet=true
```

必須観測 25 件はすべて `confirmed`。`not-run` の 3 件(既存 agent dir write-back、拡張 API の永続設定書き込み、direct execute 補助 probe)は必須観測の外にあり、`add-managed-spirits-commands` の証拠から変わらない。

## fixture 実行

`evidence/fixture-compat-result.json`。fixture host に対する実行で、`confirmed=19 limited=3 not-run=15 failed=0`、`compatibilityMet=false`(fixture は常に false)。**公式 Pi の互換性の根拠にはしない。** 境界の 5 項目は fixture では `compact` が unsupported、fake provider にリクエストが届かないなどの理由で `not-run` になり、理由が detail に残る。

## アーカイブ判定

- B-0 の strict 検証は成功。
- 実装・テスト・docs・証拠がそろう。delta spec の 5 項目(代替と差異の記載、静的な値だけで確定しない、境界の後を追う観測、マトリクスの導出、strict 検証の gate)は実装と対応が取れている。
- 境界項目 5 つは公式実行で `confirmed`。
- 未解決の `not-run` は変更の範囲外(既存 agent dir write-back など)で、`COMPATIBILITY_MET_DEFINITION` が必須観測の外だと定義どおり。

よってアーカイブ可能。ただしこの変更ではアーカイブも push も行わない。
