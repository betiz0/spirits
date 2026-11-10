# Design: harden-managed-commands

## Context

対象は `feat/add-managed-pi-route` の `2b307337e`（`add-managed-spirits-commands` を archive した状態）。公式 Pi は 1.5.0、OpenSpec CLI は 1.15.0。実行前に `openspec validate --all --strict` が 5 capability で失敗し、内訳はすべて「要件本文が 500 字を超える」WARNING だった。

## Decision 1: base spec の 5 件は「本文分割」で解消し、delta には入れない

**問題**: `--all --strict` が緑でないと、この change の spec ゲートが通らない。失敗 5 件（`binary-distribution`、`continual-harness`、`dual-model-routing`、`managed-pi-compatibility`、`self-update`）は、1 つの要件に複数の独立した約束を詰め込んでいることが原因で、意味上の問題はない。

**方針**: 本文を 500 字以内に収まる複数要件に分割し、シナリオは意味が対応する要件へそのまま移す。本文の文言は変更しない（接続文のみ補う）。したがって base spec への直接編集とし、この change の delta には含めない。delta にすると、archive 時に「変更された要件」として扱われ、意味が変わっていないのに履歴が誤解を招く。

**代替案と却下理由**: 要件 1 本のまま本文だけ短縮する案は、本文から約束を落とすかシナリオを削ることになるため却下。`--strict` を緩める設定変更は、ゲート自体を無効化するので却下。

**内容変更が必要なケース**: 5 件のうち、分割だけで 500 字以内に収まる範囲で処理できないものはなかった。収まらない場合は実装せず一覧化して報告する。

**旧要件名と新要件名の対応表**: 分割で見出し名が変わった（増えた）ものは以下のとおり。いずれも本文の文とシナリオはそのまま移動しており、意味は変わらない。

| spec | 旧要件名 | 分割後の要件名 |
| --- | --- | --- |
| binary-distribution | 配置と冪等性 | 配置と冪等性（残余: 初回配置・root 権限）/ 再実行の判定 / バージョンを明示した再配置 / 配置の原子的性質と一時ファイルの掃除 |
| continual-harness | スキルの保存 | スキルの保存（残余）/ 同梱スキルへの保存の拒否 |
| dual-model-routing | strong フェーズの開始 | strong フェーズの開始（残余）/ strong フェーズの維持と解除 |
| managed-pi-compatibility | 隔離された互換性テスト | 隔離された互換性テスト（残余）/ 互換性テストの結果の記録 |
| managed-pi-compatibility | rlm 子セッションの互換性 | rlm 子セッションの互換性（残余）/ rlm 子セッションの結果判定 |
| self-update | 自己更新のリリース解決と検証 | 自己更新のリリース解決 / 自己更新の取得とチェックサム検証 |

`role と clear と model の互換性マトリクス` の分割（5 文のうち 4 文を ADDED 要件へ移す）は上の表に含まれない。これは base spec の分割ではなくこの change の delta（MODIFIED + ADDED）として行うため、archive 時にマージされる。分割作業中に `行と目的の状態の一致` シナリオの THEN の下へ残った重複行（見出しも箇条書き記号もない孤立行）は、delta の MODIFIED 本文が同一要件を置換することで消えることを delta との差分で確認済み。

## Decision 2: 代替手段と差異は目的定義が持ち、行へ伝搬する

現行の `MatrixPurpose` は `alternative` と `difference` を型に持つが、`PurposeObservation` にその字段がなく、`deriveRows()` は `difference` を `obs.detail` に固定していた。結果、`available` の行でも「本来の機能との差異」が読まない限り分からず、`/model` 相当を `set_model` で満たした行と、真の `/model` 行が区別できない。

**方針**: `PurposeObservation` に `alternative` と `difference` を追加し、`PurposeDefinition`（`PURPOSE_DEFINITIONS`）が保持する。`deriveRows()` は行へそのまま写し、`validateMatrix()` は `not-run` 以外の子孫行が両方を持つことを要求する。`observePurposeState()` は detail に `alternative` の接頭辞を必ず付与し、行に立つ観測が代替手段によるものかを機械的に判定できるようにする。

**限定の付け替え**: 目的観測 `available + difference != "None"` は行が `limited` を返すため、detail に手段の注記を含めなくても行は `limited` になる。

## Decision 3: `limited` はユーザーから見える差異、観測手段の制約は detail

現行の matrix テストは「RPC が thinking level を返さないこと」を `limited` の理由にしていた。これは Pi の機能の欠けではなく、観測経路の制約であり、`limited` の意味を不明確にしている。

**方針**: `limited` は「目的は部分的にしか成功しない、または本来の機能と見える挙動が異なる」ことに統一し、行の `difference` にその差異を書く。観測手段の制約（RPC が値を返さない 等）は目的観測の detail に書く。目的が成功するか不明なときは `not-run`（理由付き）とし、`limited` にしない。

**具体的な帰結**: `thinking-level` の行は `limited` のままだが、理由は「完了メニューのない別コマンドで、レベル指定が `/model` の 1 行目と 同じ見た目にならない」ことになり、「RPC が level を返さない」は detail へ移る。`role-badge` の行は「badge がモデル名の隣ではなく status 行に出る」ことが理由になる。

## Decision 4: clear 区切りの識別方式是変更しない

**問題**: `context` handler は「境界より前の model-visible message 数」を先頭から落としている。メッセージ数依存は Pi の更新で壊れそうなので、entry ID や timestamp で直接判定できるなら置き換える。

**評価**:

- 境界は entry ID を持つ。`clearBoundaryIndex(branch)` は branch 上の `spirits_clear` custom entry の位置を返し、`branchPositions()` は entry ID から branch 位置への写像を作る。`clearedMessagesOf()` は projection の各 entry を `sourceEntry.id` で branch 上に写し、境界より前にある entry が contributions した message 数だけを足す。つまり現行実装は既に entry ID 由来で数量を決めており、本文の文字列照合で数えているのではない。
- 置き換えられない理由は受取側の型にある。`context` イベントが渡すのは `AgentMessage[]` で、元になった session entry の ID を運ばない (`packages/coding-agent/src/core/extensions/types.ts` の `ContextEvent`)。handler は message ごとに「これは境界より前か」を判定できないので、決定は「先頭から N 件落とす」の形になる。entry ID で filter するには `AgentMessage` に source entry ID を通す必要があり、host 側の型を変える要求になる。
- timestamp も同じ壁にあたる。message 側に時刻があっても境界 entry と対応付ける手掛からないため、結局 entry ID を通す改造が要る。
- 残る前提は drop 数の先頭一致だけ。branch の先頭から境界までは model-visible message の並びで、projection はそれを順序どおり先頭に置く。compaction が介在する場合は drop 数が projection の message 数より大きくなり、先頭からまとめて落ちる。これは「clear 前を落とす」という目的どおりの挙動で、実際に compaction を介したケースはユニットテストで押さえている。

**結論**: 置き換えない。drop 数は entry ID から計算されているので「メッセージ数依存」という脆弱性は無い。残る前提が崩れたときは、clear 前のマーカーが fake provider の要求本文に再出現するため、Decision 5 の観測項目が `failed` として拾う。

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
