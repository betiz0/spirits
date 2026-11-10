# Design: harden-managed-commands

## Context

対象は `feat/add-managed-pi-route` の `2b307337e`（`add-managed-spirits-commands` を archive した状態）。公式 Pi は 1.5.0、OpenSpec CLI は 1.15.0。実行前に `openspec validate --all --strict` が 5 capability で失敗し、内訳はすべて「要件本文が 500 字を超える」WARNING だった。

## Decision 1: base spec の 5 件は「本文分割」で解消し、delta には入れない

**問題**: `--all --strict` が緑でないと、この change の spec ゲートが通らない。失敗 5 件（`binary-distribution`、`continual-harness`、`dual-model-routing`、`managed-pi-compatibility`、`self-update`）は、1 つの要件に複数の独立した約束を詰め込んでいることが原因で、意味上の問題はない。

**方針**: 本文を 500 字以内に収まる複数要件に分割し、シナリオは意味が対応する要件へそのまま移す。本文の文言は変更しない（接続文のみ補う）。したがって base spec への直接編集とし、この change の delta には含めない。delta にすると、archive 時に「変更された要件」として扱われ、意味が変わっていないのに履歴が誤解を招く。

**代替案と却下理由**: 要件 1 本のまま本文だけ短縮する案は、本文から約束を落とすかシナリオを削ることになるため却下。`--strict` を緩める設定変更は、ゲート自体を無効化するので却下。

**内容変更が必要なケース**: 5 件のうち、分割だけで 500 字以内に収まる範囲で処理できないものはなかった。収まらない場合は実装せず一覧化して報告する。

## Decision 2: 代替手段と差異は目的定義が持ち、行へ伝搬する

現行の `MatrixPurpose` は `alternative` と `difference` を型に持つが、`PurposeObservation` にその字段がなく、`deriveRows()` は `difference` を `obs.detail` に固定していた。結果、`available` の行でも「本来の機能との差異」が読まない限り分からず、`/model` 相当を `set_model` で満たした行と、真の `/model` 行が区別できない。

**方針**: `PurposeObservation` に `alternative` と `difference` を追加し、`PurposeDefinition`（`PURPOSE_DEFINITIONS`）が保持する。`deriveRows()` は行へそのまま写し、`validateMatrix()` は `not-run` 以外の子孫行が両方を持つことを要求する。`observePurposeState()` は detail に `alternative` の接頭辞を必ず付与し、行に立つ観測が代替手段によるものかを機械的に判定できるようにする。

**限定の付け替え**: 目的観測 `available + difference != "None"` は行が `limited` を返すため、detail に手段の注記を含めなくても行は `limited` になる。

## Decision 3: `limited` はユーザーから見える差異、観測手段の制約は detail

現行の matrix テストは「RPC が thinking level を返さないこと」を `limited` の理由にしていた。これは Pi の機能の欠けではなく、観測経路の制約であり、`limited` の意味を不明確にしている。

**方針**: `limited` は「目的は部分的にしか成功しない、または本来の機能と見える挙動が異なる」ことに統一し、行の `difference` にその差異を書く。観測手段の制約（RPC が値を返さない 等）は目的観測の detail に書く。目的が成功するか不明なときは `not-run`（理由付き）とし、`limited` にしない。

**具体的な帰結**: `thinking-level` の行は `limited` のままだが、理由は「完了メニューのない別コマンドで、レベル指定が `/model` の 1 行目と 同じ見た目にならない」ことになり、「RPC が level を返さない」は detail へ移る。`role-badge` の行は「badge がモデル名の隣ではなく status 行に出る」ことが理由になる。

## Decision 4: `/spirits-clear` の区切りの識別方式是変更しない

**問題**: 現行の実装は、`spirits_clear` custom entry より前の model-visible message を数え、先頭からその数を drop している。entry ID や timestamp で直接判定できないなら、メッセージ数依存は Pi の更新で壊れやすい。

**評価**:

- clear 区切りは custom entry として永続化され、`id` と `timestamp` を持つ。`ctx.sessionManager.getBranch()` は現在の branch の entry を順に返すため、`entries.findIndex((entry) => entry.type === "custom" && entry.customType === "spirits_clear")` で区切りの位置を直接取得できる。drop 数を数える代わりにこの index を使えば、message 以外の entry の並びに依存しなくなる。
- ただし本番の drop 計算は `projectMessages()` の後に行われる。`ProjectMessage` は `Message & { sessionId: string }` であり、元になった session entry の ID を保持しない。したがって projection 上で entry ID を使うには、project 前に index を計算する必要がある。
- **その計算は既に存在する**。`clearBoundaryIndex(branch)` は `ctx.messages`（session entry の branch）を走査して区切りより前の model-visible message を数えており、この走査自体が branch の entry に直接触れている。つまり現行実装は「entry を走査して決めた drop 数を projection に適用する」形であり、entry ID 由来の情報を失っていない。
- **残る脆弱性は drop 数の先頭一致**。区切りより前の message が projection で先頭から連続して現れない場合、drop がずれる。branch の先頭から区切りまでは model-visible message の並びで、`projectMessages` はこれを順序どおり projection の先頭に置くため、compaction が介在しない限り一致する。compaction が介在する場合、compaction 自体が `firstKeptEntryId` より前の entry を文脈から外すため、drop 数は projection に存在する message 数より大きくなり、先頭からまとめて落とす挙動は「clear 前の内容を落とす」という目的どおりに働く。
- timestamp による判定は、同じセッション内で時計が戻らないことを前提に加えて、`spirits_clear` より後の message を選別する処理を別途必要とするため、現行方式より単純にならない。

**結論**: entry ID による直接判定へは置き換えない。置き換えれば drop 数の先頭一致は消えるが、projection に entry ID を通すために `ProjectMessage` を拡張する必要があり、managed 用の型を 1 つ増やす代价に対して、上記のとおり現行方式は compaction 後も目的どおりに動く。変更しない理由をここに記録する。

**据える観測**: 置き換えない代わりに、壊れたときに必ず検出できる観測項目を Decision 5 と入れる。drop 数の先頭一致が崩れた場合、clear 前のマーカーが fake provider の要求本文に再出現するため、観測項目はこれを `failed` にする。

## Decision 5: clear 境界の観測は既存 RPC と既存 probe extension で駆動する

新規に基盤を作らない制約がある。公式 Pi 1.5.0 の RPC と拡張 API で各項目が操作できるかを先に実測し、その結果で実装を決めた。

| 項目 | 駆動方法 | 実測結果 |
| --- | --- | --- |
| 区切りより後の自動 compaction | `settings.json` の `compaction.keepRecentTokens` を 1 にし、fake provider が区切り後だけ大きい usage を返す | 区切り後に自動 compaction が発火し、`session_before_compaction` が肩代わりした。compaction entry は `fromHook: true`、要約は clear 用の固定文、要約 LLM へのリクエストは 0 件 |
| 手動 compaction の肩代わり | RPC `compact` | clear で消えた対話が要約範囲に入るときは肩代わりして要約 LLM 0 件。区切りより後の対話しか無いときは肩代わりせず、Pi 自身の要約（要約リクエスト 1 件） |
| fork | RPC `fork`（message entry ID） | 区切りより後の user entry で fork すると新セッションになり、clear 前のマーカーは再出現しなかった |
| ツリー移動 | RPC に `navigate_tree` は無い。拡張コマンドから `ctx.navigateTree(entryId)` | 区切りより前の assistant entry へ移動すると、後続リクエストに clear 前のマーカーが復活した（docs の挙動どおり） |
| 再開 | `--session <file>` で再プロセス | clear 前のマーカーは再出現せず、フィルタは効き続けた |

**方針**: 5 項目を `run.ts` の互換性項目として追加し、上記の駆動方法を使う。fork は RPC `fork` を使い、拡張コマンドはツリー移動の 1 本だけを `fixtures/probe-extension.ts` に追加する。判定は fake provider に届いた本文のマーカー、`get_entries` から読み込んだ compaction entry の `summary` と `fromHook`、probe extension が記録したセッションファイルのパスを使う。

**境界条件**: 自動 compaction の項目は `settings.json` に compaction の閾値を書く。このファイルは item 6（settings 互換）と item 11（既存 agent dir 不変）の検証後に書く。両項目はすでに判定済みで、同じプロセスの中で settings を読み返さないため顺序の冲突はない。

**却下した案**: probe extension に fork も移動もまとめて実装する案は、RPC でできることを拡張に逃がすため、Pi 更新で RPC が壊れた検出にならず却下した。

## Decision 6: 独立検証の残課題は仕様の文言を先に決める

- 仮想モデルの除外は、`Model` の `api` 値が spirits の仮想モデル API と一致するかで行う。名称に `virtual` を含むかで判定しない。
- 既定値保存の成否は、専用 Pi が読み込んだ結果で判定する。probe extension が返す `defaults`（`defaultModel`、role、`defaultThinkingLevel`）を使い、Node 側のファイル読み取りを代用しない。
- 設定書き込みが失敗した場合、セッション適用は取り消さない。失敗を分けて伝え、再読み込みしない。
- badge は role 選択時と、`session_start` が `reload` で来たときに描画する。

## Risks

- 自動 compaction の項目は `settings.json` に手を入れるため、後続項目が settings を読み返すと順序依存で壊れる。現状は settings を読み返す項目が後に無いため許容するが、項目を追加する場合はこの記録を見直す必要がある。
- fork とツリー移動の項目は永続化セッションを使う。`--no-session` を使わない唯一の項目であり、セッションファイルが一時 agent dir に増える。既存 agent dir 不変の検証とは別物なので、判定済みになった後に実行する。
- `openspec validate` の strict 判定は CLI バージョンに依存する。1.15.0 で緑になっても、上位で追加されれば再び落ちる。
