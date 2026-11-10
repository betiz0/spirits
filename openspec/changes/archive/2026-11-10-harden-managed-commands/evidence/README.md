# 証拠の再実行手順と結果

対象 commit: `66d5c68c4`(実装)、提案 `965f3a361`。公式 Pi は 1.5.0、artifact `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b`(製品の信頼ルートと一致)、拡張 bundle `2f048985e24806545314e0f663f21a5e9c52218cfe66cf8e9266f6ca4e439d47`、overlay `1.5.0-spirits.1` / `883b0b1462dd22bbcfa5c5020aeb79979b74adc39d059d6dbc8fa8318135a6ad`。すべて隔離 HOME・隔離 agent dir・ローカルの fake provider を使い、実データ・実認証・外部 network は使わない。

| 成果物 | 再実行 | 結果 |
|---|---|---|
| `official-compat-result.json` | 下の「互換性ランナー(公式)」 | `confirmed=34 limited=0 unavailable=0 not-run=3 failed=0`、`compatibilityMet=True`、`runnerProvenance.clean=True`、commit `66d5c68c4` |
| `fixture-compat-result.json` | 下の「互換性ランナー(fixture)」 | `confirmed=19 limited=3 unavailable=0 not-run=15 failed=0`、`compatibilityMet=False`。fixture 実行は常に false。公式 Pi の互換性の根拠にはしない |

公式実行で `not-run` の 3 件は `add-managed-spirits-commands` の証拠と同じもの(既存 agent dir への write-back、拡張 API の永続設定書き込み、direct execute 補助 probe)で、必須観測の外にある。required observation は 25 件で、5 つの clear 境界項目を含めすべて `confirmed`。

## 互換性ランナー(公式)

```sh
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out dist
# ステージング領域には manifest.json と公式 tarball を置く。clean な worktree で走らせないと
# runnerProvenance.clean が false になる。
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged-root> \
  --bundle "$PWD/dist/spirits-managed-pi-extension.js" \
  --commit "$(git rev-parse HEAD)" \
  --bundle-version 0.1.0 \
  --out <tmp>/result.json
```

## 互換性ランナー(fixture)

fixture set は `packages/spirits/test/managed-pi-fixtures.ts` の `makeManagedFixture({ piScript: FAKE_RPC_PI_SCRIPT })` と `installManagedSet()` で作る。インストーラが走った managed root を `--artifact-root` に渡す。

```sh
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture managed root> --out <tmp>/result.json
```

## `/spirits-clear` の境界の後(公式実行)

判定は fake provider に届いた本文のマーカー、probe 拡張が `ctx.sessionManager.getEntries()` から書き写した compaction entry の `summary` / `fromHook`、probe 拡張が記録した session ファイルだけを使っている。RPC の `get_entries` は compaction entry を返さない。

| 項目 | 状態 | 根拠 |
|---|---|---|
| `clear boundary automatic compaction` | confirmed | the compaction after the boundary came from the extension hook with the clear note in 0 summarization request(s), and the following request carried compat-clear-auto-after-1794293599485 without compat-clear-auto-before-1794293599485 |
| `clear boundary manual compaction` | confirmed | a compaction with cleared conversation in its span was taken over with the clear note in 0 summarization requests, and a clean span kept pi's own summary in 2 request(s) |
| `clear boundary fork` | confirmed | the fork created 718ef0.jsonl and its request carried the conversation kept after the boundary without compat-clear-fork-before-1794293609989 |
| `clear boundary tree move` | confirmed | moving the leaf to before the boundary brought compat-clear-tree-before-1794293615498 back into the request, which is the documented drop-off |
| `clear boundary resume` | confirmed | the resumed session ession.jsonl kept the boundary and sent no compat-clear-resume-before-1794293620982 |

同じ 5 項目を fixture host に対して走らせると全部 `not-run` になる。fixture の pi は RPC の `compact` を unsupported で返し、fake provider に何も届かないため、判定そのものが成立しない。

| 項目 | fixture | 理由 |
|---|---|---|
| `clear boundary automatic compaction` | not-run | the fake provider received no request, so the compat model never answered |
| `clear boundary manual compaction` | not-run | the host refused the manual compaction (unsupported fixture command) |
| `clear boundary fork` | not-run | the seeded session reported no boundary and no message after it |
| `clear boundary tree move` | not-run | the seeded session reported no reply that carried the cleared message |
| `clear boundary resume` | not-run | the fake provider received no request, so the compat model never answered |

## 9 目的の観測(公式実行)

`role/clear/model matrix` の `data.purposes`。`alternative` で満たした観測は detail の先頭に `alternative (<手段>)` を持つ。

| purpose | state | 観測 |
|---|---|---|
| `skill-strong-phase` | available | alternative (The same extension routing; the route reports its role to the extension status line): the plain request ran on fake-model and the strong-phase request on fake-strong |
| `model-role-vocabulary` | available | alternative (/spirits-role <role>: locks the phase, records a spirits_role entry, writes models.role): /spirits-role strong sent the next request to fake-strong and /spirits-role normal sent the one after it back to fake-model, with the selection unchanged |
| `role-badge` | limited | alternative (ui.setStatus() on the extension status line, updated by the route): the extension asked the host to draw 9 role status line(s) over RPC, which is the extension status line, not the core footer badge |
| `thinking-level` | limited | alternative (/spirits-model <ref> <level>: pi's own setThinkingLevel plus defaultThinkingLevel): the thinking level changed through the session runtime instead of the one-line /model, so the completion menu is missing; the RPC read-back answers only for the model, which is why the level is confirmed by the following request rather than by a reply |
| `role-selection` | available | alternative (/spirits-model <ref> [level] [role], parsed from the right): /spirits-model <ref> <level> <role> left models.role strong, read back by the reloaded runtime |
| `default-save` | available | alternative (Merge-write of pi's own keys into pi's global settings.json, under pi's file lock): the default settings keys changed after the selection |
| `conversation-clear` | available | alternative (/spirits-clear: a boundary entry plus a context handler that drops what precedes it): the request after the command carried compat-clear-after-1794293594479 and not compat-clear-before-1794293594479, while the session file kept every message entry |
| `same-session-id` | available | alternative (/spirits-clear appends one entry and rewrites nothing): the session kept the ID 01a1c43b-7aba-767f-acbb-12b3c5d9046f |
| `todo-retention` | available | alternative (Same: the boundary is a conversation cut, not a session reset): 1 TODO entries survived the command |

## 公式実行で `not-run` の項目

- `existing agent dir write-back compatibility`: no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item
- `settings write compatibility`: the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute
- `direct execute probe is auxiliary`: the direct execute probe needs another extension's tool definition; Pi hands every extension its own API object, so no definition is reachable; tsrepl was observed in the tool inventory
