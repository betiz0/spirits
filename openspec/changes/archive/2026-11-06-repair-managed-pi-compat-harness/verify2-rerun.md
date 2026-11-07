# 再検証と判定の訂正: repair-managed-pi-compat-harness

[verify2.md](verify2.md) は書き換えない。このファイルは verify2 の後に進めた訂正と、その再測定だけを記録する。
判定の書き換えは実測にもとづくもので、実測が無い項目は `not-run` のまま残した。

## 対象と範囲

- ブランチ `feat/add-managed-pi-route`、HEAD `78fc660de175ef852e42b274535d4f9bf1ed3e06`。
- 変更したのは互換性ランナー(`scripts/managed-pi-compat/`)とテスト(`packages/spirits/test/`)、文書、この change の記録だけ。
- 製品コード(`packages/spirits/src`、Pi コア)は差分 0。`git diff --stat packages/spirits/src packages/coding-agent packages/ai packages/tui` は空。
- role / `/clear` / `/model` の挙動、release、既定経路の切り替え、フォーク削除は行っていない。

## 実行環境と来歴

ランナーの来歴は測定対象の bundle の来歴と別物として結果 JSON の `runnerProvenance` に保存した。

| 項目 | 値 |
|---|---|
| ランナー commit | `78fc660de175ef852e42b274535d4f9bf1ed3e06` |
| `git diff HEAD` の sha256 | `8dde06509a39d1365dd841fcdffa65f8a61da7ae91e80f5c7bcc30ed5744b5c7` |
| 未追跡ファイル | `verify2-rerun.md`(この記録)、`scratch-ag/`、`sprt-opsx-review-change.SKILL.md`、`sprt-opsx-verify-deep.SKILL.md` |
| 作業ツリー | clean=false |
| 測定 bundle の commit | `78fc660de175ef852e42b274535d4f9bf1ed3e06`(`packages/spirits/src` が未変更なので bundle は HEAD 由来) |
| 公式 tarball sha256 | `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b` |
| 展開後実行ファイル sha256 | `61a84400938da652ed69aac9c1ad2ca23af3c9bd8cc2f46ce571ed84ae6a35e5` |
| 拡張 bundle sha256 | `51f306d132b35b1c34bebe56f157c14e5e88348366bcb6d041585d7354e28f29` |
| Pi 版 / overlay | 1.5.0 / `1.5.0-spirits.1` |
| ランナー側ランタイム | bun 1.4.2 |
| ホスト側ランタイム | official: bun 1.4.4、fixture: bun 1.4.2 |
| 必要 API | `getSettings` / `appendEntry` / `setModel` / `setThinkingLevel` / `sessionManager` / `modelRegistry` あり、`registerModelRoles` なし |

この節は dirty な作業ツリーでの実行の記録で、参考扱いにする。判定コードをコミットしたあとの clean 実行(`runnerProvenance.clean = true`)を「clean での再実行と証拠」に別途残し、数値はこちらではなくそちらを正本とする。

## 訂正した判定

1. **`rlm child abort` を 5 段階に分解した**: `abortSent`、`abortAccepted`、`cellAborted`、`childStopped`、`usageAfterStop`(`usageAtSettled` を添える)。状態は既存の 5 つ(`confirmed` / `limited` / `unavailable` / `not-run` / `failed`)だけを使い、新しい状態は足していない。
2. **abort 後は `agent_settled` の 1 回読みをやめた**: 子のリクエストが閉じるか poll 窓(15 秒)が切れるまで `get_entries` を読み続ける(`runAbortRpcProbe` の `poll`、request id は `<id>-1` … `<id>-final`)。`agent_settled` は親の run が落ち着いた時点で、切られたツール呼び出しはその後まで走る。
3. **fake provider が子の接続切断と完了を記録する**: `receivedAt` / `respondedAt` / `closedAt` / `delayMs` を保持し、切断後は遅延 reply を待たず reply も書かない(`closedEarly()` で判定)。子のリクエストは `delayMs` で親と区別する。
4. **`role/clear/model matrix` の `confirmed` は「専用 Pi で観測した」の意味**で、`unavailable` も観測に含まれる。項目 detail と `data.confirmedMeans` にそう書き、文書にも同じ意味を書いた。行の観測状況は `data.rows` と `data.purposes` に出す。
5. **`existingAgentDirUnchanged` を項目化した**: `existing agent dir untouched` として記録し、`false` なら `failed`。`failed` なので終了コード 1 に効く。従来は evidence の真偽値だけで、終了コードと結ばれていなかった。
6. **`runnerCompleted` と `compatibilityMet` を定義文つきで結果と要約に出す**: JSON の `runnerCompletedDefinition` / `compatibilityMetDefinition`、要約の先頭 2 行。`compatibilityMet` が true でも移行・既定経路の切り替え・フォーク削除を認めないことを定義に含めた。
7. **要約の冒頭に必須観測以外の問題点を並べる**: `## Required observations not confirmed` の後に `## Outside the required list, not confirmed` を置き、必須観測外の `failed` / `limited` / `unavailable` / `not-run` を先頭に並べる。
8. **必須観測を直した**: `rlm child abort` と `existing agent dir untouched` を必須観測に追加した。製品側が応えていないことを理由に必須観測から外さない。例外は `existing agent dir write-back compatibility` だけで、これは本仕様(「既存データの書き込み互換は未確認」)が未確認のまま据えることを決めている項目なので必須に入れない。
9. **ランナーの来歴を分離した**: `runnerProvenance` に `git rev-parse HEAD`、`git diff HEAD` の sha256、未追跡ファイル一覧、`clean` を収め、bundle の `targetCommit` とは別項目にした。official の `workingTreeClean` もここから引く。
10. **rlm 子用の追加 agent dir をやめた**: 以前は `<home>/.pi/agent` に `settings.json` / `auth.json` / `models.json` を複製していた。実測で子に不要と分かったので削除した(次節 Q1)。
11. **内訳を 5 ラベル常時表示にした**: 標準出力の内訳行は実行された状態しか出しておらず、`unavailable` と `failed` が省略されて読めていた。`evidence.ts` の `COMPAT_STATE_LABELS` / `formatStateCounts` に集約し、標準出力も要約の `- Results:` も `confirmed=<n> limited=<n> unavailable=<n> not-run=<n> failed=<n>` の 5 ラベルを必ず並べる。
12. **読み違えやすい 2 つの `confirmed` に但し書きを出した**: 要約の先頭に `Note:` 行を出し、`rlm child abort` の `confirmed` が条件付きであること(`rlm_usage` は親のターン終了後に追記されるため、記録は子が止まった後の読みに現れ `agent_settled` の読みには現れない)を detail と要約の両方に書いた。`role/clear/model matrix` の `Note:` には `matrixPurposeCounts` が測った観測目的数(`2 of 9` など)を添え、`COMPATIBILITY_MET_DEFINITION` に「role / `/clear` / `/model` の利用可否は示さない」を追記した。残る 7 目的を観測するためのハーネス拡張はしていない。
13. **既存の失敗テストを直した**: `update does not check the network on launch` の原因は製品側ではなくテストにあった。テストが `env` を渡さず `launchManagedPi` が `process.env` を拾うため、開発シェルから継承した `SPIRITS_CODING_AGENT_DIR=/home/<user>/.spirits/agent` を managed のガードが拒否して `{ exitCode: 1, launched: false }` になっていた。`env -u SPIRITS_CODING_AGENT_DIR bun test test/managed-pi-update.test.ts` が通ることで確定し、テストに `env: {}` を追加しただけで製品コードは変えていない(`test/managed-pi-launch.test.ts` と `test/managed-pi-integration.test.ts` は最初から `env` を渡していた)。

## 実行記録(fixture / official を 1 回ずつ / dirty・参考)

実行コマンド:

```sh
# fixture
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture-managed-root> --out <out>/result.json
# official
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out <build>
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged official root> \
  --bundle <build>/spirits-managed-pi-extension.js \
  --commit "$(git rev-parse HEAD)" --bundle-version 0.1.0 --out <out>/result.json
```

| 項目 | fixture | official |
|---|---|---|
| 終了コード | 0 | 0 |
| `mode` / label | `fixture` / `fixture-only` | `official` / `official` |
| 内訳 | confirmed 19 / limited 4 / unavailable 0 / not-run 9 / failed 0 | confirmed 28 / limited 1 / unavailable 0 / not-run 3 / failed 0 |
| `runnerCompleted` | false | false |
| `compatibilityMet` | false | true |
| `existing agent dir untouched` | confirmed | confirmed |
| `rlm child abort` | not-run(子セッションが provider に届かず、abort の時点で走っている物が無い) | confirmed |
| `rlm physical model child` | limited | confirmed |
| `rlm auto parent` | limited | limited |
| `role/clear/model matrix` | confirmed(専用 Pi 観測の意味) | confirmed(観測 2 / 9、`unavailable` 0) |
| `logs` | 32 件 | 32 件 |

公式実行の `rlm child abort` の `data.phases`:

```json
{"abortSent": true, "abortAccepted": true, "cellAborted": true, "childSeen": true,
 "childStopped": true, "usageAtSettled": 0, "usageAfterStop": 1, "pollWindowMs": 15000}
```

同じ項目の `providerRequests`(単位 ms、プロセス起動からの経過)。子のリクエストだけが `delayMs` を持つ。359 ms に受けた子の要求は 3079 ms に閉じ、`respondedAt` が無いので reply は一度も書かれていない。親のツール呼び出しは 348 ms で応答済み。

```json
[{"kind": "tool-call", "receivedAt": 348, "respondedAt": 348},
 {"kind": "text", "receivedAt": 359, "closedAt": 3079, "delayMs": 8000}]
```

`pollReads` は abort 後に送った `get_entries` を受けた順。この実行では poll の 1 回目で既に 1 件だった。poll は stdin で abort の後ろに積まれるので、その応答は子の停止と `rlm_usage` の追記の後に生成される。別実行では poll 1 回目が 0 件で最終読みが 1 件になり、揺れる。揺れない事実は `agent_settled` の読みが 0 件で、子の接続が閉じた後の読みが 1 件という対比だけである。だから判定は `agent_settled` の単発読みではなく、子の停止を待った後の読みに置く。

```json
[{"id": "entries-poll-1", "entries": 1, "outcomes": ["aborted"]},
 {"id": "entries-poll-final", "entries": 1, "outcomes": ["aborted"]}]
```

`role/clear/model matrix` は 9 の目的のうち 2 を観測した。`skill-strong-phase` は `available`(通常要求は `fake-model`、strong フェーズは `fake-strong` で受けた)、`thinking-level` は `limited`(セッション runtime 経由で変更・読み戻し、`/model` 行ではない)。残る 7 は `not-run` で、`/clear` の 3 目的はホストが `/clear` をプロンプトとして扱って会話が 4 → 7 entry に増えたこと、role の 3 目的は role 引数を受ける駆動面が無いこと、badge と default 保存は RPC から読めないことが理由で、`unavailable` は 0 件である。

## rlm の境界 4 問

実行はいずれも一時 HOME・隔離 agent dir・ローカルの fake provider を使い、実ユーザーデータ・実認証・実 provider は読んでいない。

### 1. 公式 Pi の物理モデルの子は `childAgentDirs` 無しで動くか

**動く。** 子は親と同じプロセス内で作られ、agent dir を host 自身の `getAgentDir()` で引く(`packages/spirits/src/rlm/spawn.ts` が `agentDir: getAgentDir()` を渡す)。managed の起動は `SPIRITS_CODING_AGENT_DIR` を隔離 agent dir に固定するので、子も親と同じ dir を読む。公式 Pi 1.5.0 での 3 パターン比較:

| fixture を置いた場所 | 子の要求 | セルの応答 | `rlm_usage` | `<home>/.pi/agent` |
|---|---|---|---|---|
| 隔離 agent dir のみ | 1 件 | `"child answer"` | `completed` | 作られない |
| `<home>/.pi/agent` のみ | 0 件 | `Error: rlm: No API key found for compat-fake.` | `error` | 存在するが読まれない |
| 両方 | 1 件 | `"child answer"` | `completed` | 使われない |

よって 2 番目の複製は不要で、ランナーから削除した。

### 2. 親が abort したあと、子は止まるか

**止まる。** 子のリクエストは遅延 reply(8000 ms)で保持している。公式実行では 3000 ms で送った abort により 3099 ms に接続が閉じ、reply は一度も書かれていない(`closedAt` あり・`respondedAt` なし)。その後も子からの新しいリクエストは増えなかった(子の停止は 700 ms の安定窓で判定)。

### 3. 子の停止後に `rlm_usage` は現れるか

**現れる。** `agent_settled` 時点の読みでは 0 件、子の接続が閉じた後の読みでは 1 件で、`outcome` は `aborted`。エントリは `custom` / `customType: "rlm_usage"` で、`outcome` は `entry.data.outcome` にある。`agent_settled` まで待ってから 1 回読む測定では構造的に見えなかった。

### 4. 現在の fork route では 1〜3 がどうなるか

`~/.spirits/bin/spirits` 0.6.0(sha256 `dc3af4cb5de45e1f96e029ed7e1c909e48556f422ed926e2a349100e8238d29d`、同じ値は証拠の `evidence/q4-fork-route.json` の `forkSha256` にも recorded している)を一時 HOME と隔離 `SPIRITS_CODING_AGENT_DIR` で RPC 起動し、fake provider へ繋いで観測した。

| ケース | 結果 |
|---|---|
| 物理モデル・中断なし | 子は 8000 ms の応答を返して完了し、`agent_settled` 時点で `rlm_usage` は `completed` |
| 物理モデル・実行中に中断 | 子のリクエストは 377 ms 受信 → 3005 ms に切断(reply 書かず)、セルは `AbortError`。`rlm_usage` は `outcome: aborted` で post-abort の読みに出る |
| 親が `spirits/auto` | 子は作られず、`Error: rlm: No API key found for spirits` で失敗(`rlm_usage` は `error`)。専用 Pi と同じ既知の制約 |

fork route と専用 route で rlm の経路は同じ製品コード(`packages/spirits/src/rlm/`)を歩くため、境界の差は観測されなかった。製品コードの差分が無いことも `git diff --stat` で確認している。同じ挙動は `packages/spirits/test/rlm-hostfn.test.ts` の FakePi テスト(中断時に `aborted` を持つ `rlm_usage` が子の停止後に追記される)でも押さえた。

## テストと検査

- `cd packages/spirits && bun test`: 803 pass / 0 fail。以前そこにあった唯一の失敗は訂正 13 の env 漏れで、原因がテスト側と分かったのでこの change の中で閉じた。
- `env | grep -E '^(SPIRITS_|PI_)'` に `SPIRITS_CODING_AGENT_DIR=/home/<user>/.spirits/agent` が出る環境で実行して確認した(その変数を外した実行では HEAD でも通る)。
- `cd packages/spirits && bun run check`: 成功。
- `npm run check`(リポジトリルート): 成功。
- 追加・更新したテスト: `managed-pi-compat-rlm.test.ts`(5 段階の判定、`rlmUsageOutcome`)、`managed-pi-compat-rpc.test.ts`(abort 後の poll、停止後の最終読み、poll 窓の終了)、`managed-pi-compat-fake-provider.test.ts`(切断の記録)、`managed-pi-compat-result.test.ts`(必須観測、定義文、必須外の集計)、`managed-pi-compat-runner.test.ts`(`existing agent dir untouched` 項目と要約冒頭)、`rlm-hostfn.test.ts`(fork route 相当の中断時 usage)。

## 移行できるか

**移行はブロックしたままだ。** 根拠を「実測で埋める項目」と「設計で決める項目」に分ける。

- 実測で埋める項目 — `existing agent dir write-back compatibility` が `not-run`。専用 Pi 自身の書き込み経路(`dedicated Pi write path`)は成功するが、既存 agent dir への変換をともなう書き戻しは未実測で、本仕様も未確認のまま据えている。ここはランナーが観測を追加すれば埋まる。
- 設計で決める項目 — `settings write compatibility` が `not-run`。Pi 1.5.0 の拡張 API は settings を読み取り専用でしか晒さない(`ExtensionAPI.getSettings(): Settings` があり、永続書き込みの API は `packages/coding-agent/src/core/extensions/types.ts` の拡張 API 面に存在しない。実測の `requiredApis` とも一致)。Node のファイル書き込みは代用にしないと決めているので、これは実測では埋まらず、専用経路の所有キーをどうするかの設計判断が先に要る。

`compatibilityMet` が true でも移行・既定経路の切り替え・フォーク削除は認めない(定義にそう書く)。

### 移行の根拠ではなくなった項目

- `rlm auto parent` は `limited` のままだが、移行を止める根拠から外す。親が `spirits/auto` のとき子が作られず `Error: rlm: No API key found for spirits` になるのは、専用 Pi でも現在の fork route(`~/.spirits/bin/spirits` 0.6.0)でも同じで(Q4 実測)、専用経路への移行で悪化するものではない。fork でも起きる既存の製品不具合として記録する。
- `rlm_usage` の追記が中断した呼び出し元に返る AbortError より後になる順序も、移行の根拠から外す。製品内に `rlm_usage` の読み手は無く、fork でも同じ順序なので、優先度の低いバックログに落とす。
- `outcome` が `entry.data.outcome` にある点は製品課題ですらない。`pi.appendEntry(customType, data)` は `CustomEntry`(`{ type: "custom", customType, data }`)を追記する標準形で、`entry.outcome` を読んでいたランナー側の計測が誤っていた。修正は `scripts/managed-pi-compat/rlm.ts` の `rlmUsageOutcome` に入っている。

## 次の最小範囲

1. 既存 agent dir への書き戻しの実証。専用 Pi 自身の書き込みは決まっているので、既存 agent dir への変換をともなう書き戻しを実測できる項目を作る。移行を動かせるのはこれと 2 の判断だけ。
2. settings の永続書き込みの設計判断。Pi 1.5.0 の拡張 API に書き込み面が無い以上、Node 書き込みを許すのか専用キーをどう所有させるのかを決めてから実装する。
3. `rlm auto parent` の扱いを決める。fork でも同じ失敗なので移行の妨げではないが、子セッションに拡張を読ませない限り `spirits/auto` の route は検証できないままなので、既知の制約として据えるのか専用経路側で解決するのかを決め、結果にその判断を残す。
4. 優先度の低いバックログ: 中断した呼び出し元に返る AbortError より `rlm_usage` の追記が遅い順序。製品内に読み手が無く fork でも同じなので、上記が片付く限り着手順は後ろでよい。

証拠の保管は変更ディレクトリへ赤化した JSON と要約を commit する形で決めた(clean 実行分を `evidence/` に置く)。CI 化はしていない。
