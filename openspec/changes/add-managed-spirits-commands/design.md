# Design

入力: `docs/spirits-managed-pi-design.md`(訂正節を含む)と `docs/agent-data-compat/` の実測。本文と訂正節が食い違う点は訂正節を優先した(設定書き込みのロック機構は proper-lockfile、`session_before_compact` は自動 compaction でも発火する)。

## Context

managed 経路は公式 Pi 1.5.0 の実行ファイルに spirits 拡張 bundle を読み込ませるだけで、Pi の JS ソースを変えない(P-SOURCE 0)。したがって「fork でコアに当てていた 16 差分」のうち、拡張 API から到達できない分だけGap になる。fork と managed で同じ bundle が動く制約上、分岐の材料は実行時のホスト能力の有無に限られる。本変更ではその材料を `registerModelRoles` の関数の有無に固定する(`docs/agent-data-compat` の probe で fork=true / 公式 1.5.0=false を実測済み。実装でも同じ読み取り方を使う)。

## Goals / Non-Goals

Goals

- 9 目的を、拡張実装または承認済みの代替で埋めた状態にし、どれが代替かを結果に残す。
- fork 経路の挙動を 1 バイトも変えない(新コマンドを登録しない、既存の読み取り経路を変えない)。
- 設定と role の保存形式を fork と共有し、fork が読める形に保つ。

Non-Goals

- 既定経路の切り替え、managed ガードの変更、fork の削除。
- Pi の再ビルド配布(P-SOURCE)、上流への投稿。
- `/spirits-clear` でのチャット表示の消去(表示は残す。消去は PB の LAND 待ち)。

## 前提確認(実装前実験・結果)

公式 Pi 1.5.0(`df870ba0…` の tarball、信頼ルート一致)+ ローカル fake provider + 隔離 HOME と隔離 agent dir で、`evidence/precondition-probe.ts` を走らせた。拡張側は本変更で実装する形状そのもの(proper-lockfile を inline した bundle、境界 custom entry、`context` フィルタ、`session_before_compact` の肩代わり)を最小実装として使い、19 項目すべて pass した。生結果は `evidence/precondition-results.json`。

### A: change 全体の前提(3 項目とも成立)

| 項目 | 結果 | 観測 |
|---|---|---|
| proper-lockfile を bundle に同梱でき、Pi の SettingsManager と同じパスで排他が効く | 成立 | bundle 57,842 B に locker が inline され(`A1.bundle-inlines-proper-lockfile`)、隔離 agent dir の `settings.json` に対して拡張側 200 回と、別プロセスの実 `SettingsManager`(`setThinkingLevel` → `persistScopedSettings`)200 回を同時に走らせても JSON は壊れず、拡張が書いた `models.strong` / `models.role` / 独自キーと Pi が書いた `defaultThinkingLevel` が同時に残った(`A1.race-with-settings-manager-keeps-both-sides`)。`.lock` 残骸なし(`A1.lock-released`) |
| コマンドの文脈から `ctx.reload()` を呼べ、書き込んだ設定が反映される | 成立(ただし条件付き) | command ctx の `reload` / `ui.setStatus` / `sessionManager.buildSessionProjection`、`pi` の `getSettings` / `appendEntry` / `setModel` がすべて関数として存在。`/spirits-*` 相当の書き込み → `await ctx.reload()` の後の `session_start`(reason `reload`)で読む settings は書き込み後の値になった(`A2.command-context-surface`、`A2.reload-applies-written-settings`)。**条件**: reload の直後、同じ command の `pi` ハンドルと ctx は stale になり、触ると `This extension ctx is stale after session replacement or reload.` の拡張エラーになる。よって反映の確認は reload 以降の `session_start` など新しいハンドルで行う |
| `registerModelRoles` の有無で fork と managed を分けられる | 成立 | 公式 1.5.0 では `false`(`A3.registerModelRoles-absent`)。fork は `docs/agent-data-compat` の probe で `true` |

### B: `/spirits-clear` の方式比較

(a) `ctx.compact()` + `session_before_compact` で compaction を返す方式

| 観測 | 結果 |
|---|---|
| 会話が keepRecentTokens に収まる場合 | `compact` は `Nothing to compact (session too small)` で失敗し、`session_before_compact` は 0 回(`B(a).short-conversation-fails`、`B(a).hook-not-reached-when-unprepared`)。フックの前に `prepareCompaction` のチェックが来るため拡張は割り込めない |
| 直前の entry が compaction の場合 | `Already compacted` で失敗(`B(a).second-compact-fails`) |
| preparation が成立する場合 | フックは発火し拡張の compaction を採用できる(`B(a).hook-reachable-when-prepared`)。ただし要約メッセージは文脈に残る(`B(a).summary-message-stays-in-context`)。`firstKeptEntryId` を先頭にすれば会話は外せるが、要約という形の新しい内容が増える |

→ 決定事項 1 の「会話の長さに関係なく動作する」「短い会話」「直前に compaction がある場合」を満たさない。**採用しない**。

(b) 区切り custom entry + `context` フィルタ方式

| 観測 | 結果 |
|---|---|
| 区切りより前のメッセージの識別 | 成立。`sessionManager.getBranch()` の最新 `spirits_clear` の index を境界とし、`buildSessionProjection().entries` のうち境界以前に属する entry が生む messages 数を数え、`event.messages` の先頭からその数だけ落とす。**重要**: `context` イベントには system role の message が入っていない(`visibleMessages` で除外される)一方、projection には pi の prompt/tool loadout が `system` role の message entry として残る。そのため数え上げも `role !== "system"` で揃えないと 1 過剰になり、直前のターン全部を落として何も除去できない(実験で実際に踏んだ) |
| 短い会話 | 成立(`B(b).works-on-a-short-conversation`)。compaction の preparation 要否に関係ない |
| 続けて 2 回実行 | 成立。3 回連続のクリア後も新しい要求だけの文脈(`B(b).two-consecutive-clears`) |
| 再開(resume) | 成立。別プロセスで `--continue` した後の要求にもクリア済みのマーカーは入らない(`B(b).boundary-survives-resume`) |
| 自動 compaction が区切りより前を要約し、文脈に戻さないか | 戻さない。fake endpoint の usage を fixture の小さな contextWindow に対して閾値を超える値にすると automatic compaction が発火し(`session_before_compact` reason `threshold`)、拡張の肩代わりが採用され(`session_compact` の `fromExtension: true`、summary は拡張の注記)、その後の要求にクリア済みマーカーは出ない(`B(b).automatic-compaction-fired`、`B(b).extension-supplied-note-used`、`B(b).cleared-content-does-not-return`) |
| コンテキスト使用量の表示と自動 compaction の閾値への影響 | クリア直後は projection にクリア済み entry が残るため、使用量表示と閾値はクリア前を引きずる(実験で境界直後の prefix count = 2)。肩代わり compaction 後はこれらの entry が projection から外れ prefix count = 0(`B(b).projection-shrinks-after-the-intercepted-compaction`)。つまり「クリアの効きは即座、使用量表示と閾値の整合は次の compaction まで遅れる」 |

→ 決定事項 1 の条件をすべて満たす。**この方式を採用**する。満たさない条件(チャット表示の消去)は決定事項 1 本身が対象外にしている。

## Decisions

### Decision 1: 分岐は `registerModelRoles` の関数の有無

`registerDualModelRouting` が既に持っている読み取り(`typeof pi.registerModelRoles === "function"`)をそのまま使い、`false` のときだけ `commands` 層の登録関数を呼ぶ。

- 代替案: `process.env` の経路フラグや `getAgentDir()` のパスで判断する。→ managed か fork かを外部入力から決めることになり、同じ bundle を別の環境で動かしたときに化ける。ホストの能力そのものを見るほうが、上流が `registerModelRoles` を公式に LAND した瞬間に自動的に fork 側の経路へ戻る(=将来の統合がただ 1 行の分岐消失で来る)。

### Decision 2: 設定の書き込みは Pi の `SettingsManager` の手順を再現する(ロックは proper-lockfile)

`<agentDir>/settings.json` に対して `lockSync(path, { realpath: false })` を ELOCKED 再試行(10 回・20ms)で取り、ロック下で読み込み → `stripBom` → `JSON.parse` → **変更したフィールドだけを**マージ(nested は変更した下位キーのみ)→ `JSON.stringify(merged, null, 2)` → 書き込み → 解放。`getAgentDir()`(pi 公開)でパスを求める。global のみ(project settings には書かない)。

- 具体例(交互書き込み): Pi が `defaultThinkingLevel: "medium"` を保存した直後に `/spirits-role strong` が `models.role` だけを書くと、ファイルは `{ defaultProvider, defaultModel, defaultThinkingLevel: "medium", models: { strong, role: "strong", <独自キー> } }` になる。逆順でも spirits の独自キーは残る(`{ ...currentFileSettings }` で unknown key が保持されるため。`test/pi-runtime/settings-unknown-key.test.ts` が同じ前提を既にピンしている)。
- 代替案: `withFileMutationQueue`(pi が公開)を使う。→ 訂正 1 のとおりあれはプロセス内キューで、プロセス間排他にならない。fork の `SettingsManager` と同時に書いたら更新を失う。実験で proper-lockfile 同士の排他は実証済み(A1)。
- 代替案: spirits 専用ファイルに保存する。→ `defaultProvider` / `defaultModel` は Pi が所有するキーで、`resolveNormalTarget` の入力そのもの。二重所有になり、Pi の `/model` が保存した値を spirits が無視する形になる。

### Decision 3: reload 後は何もせず、新しいハンドルで確認する

`ctx.reload()` を await したら、その command handler では `pi` / ctx を触らない(公式が stale マークして拡張エラーにする)。そのため

1. 設定書き込み → `await ctx.reload()` → handler はそこで終わる(notification は reload 前に済ませる)、
2. 反映の確認と badge の再描画は reload が打ち上げる `session_start`(reason `reload`)で行う。

- 代替案: reload 前に読み出した値で notification を組み、reload 後に `ctx.ui.notify` する。→ 実験で出た stale エラーそのものになる。

### Decision 4: `/spirits-clear` は「区切り entry + `context` フィルタ + compaction 肩代わり」

- 区切り: `spirits_clear` custom entry。data は `{ at }`(読み取りは entry の位置だけを使う。`beforeEntryId` は branch 上の位置で決まるので持たせない)。
- フィルタ: 境界 index 以前の entry が生む projection messages(`role !== "system"`)の数 `drop` を求め、`0 < drop < event.messages.length` のときだけ `event.messages.slice(drop)` を返す。それ以外は `undefined`(=素通し)。空の文脈を作ることを防ぐ。
- 肩代わり: `session_before_compact` で、境界より前の entry が要約範囲に入る場合だけ `{ compaction: { summary: <固定の注記>, firstKeptEntryId: <境界 entry の id>, tokensBefore: preparation.tokensBefore } }` を返す。注記にはクリアした内容を含ない。要約範囲がすべて境界より後なら素通しし、pi の通常の要約を殺さない。
- 具体 trace: `[user1, assistant1]` → `/spirits-clear` → `[boundary]` → `[user2, assistant2]`。2 つ目の要求の `event.messages` は `[user1, assistant1, user2]`(3 件)、projection の境界以前 の非 system messages は 2 件 → `[user2]` を返す。その後 threshold compaction が発火すると、要約範囲は境界より前を含むので肩代わりが効き、`firstKeptEntryId` = 境界 id → pi 側の projection からもクリア済みが消え、以降の使用量表示と閾値がクリア後の規模になる。
- 代替案 (a): compaction 乗っ取り。→ 上のとおり短い会話と直後 compaction で失敗し、決定事項 1 を満たさない。
- 代替案: `ctx.newSession()`。→ session ID が変わり、決定事項 1 に反する。
- 副作用として残る既知差: チャット表示は消えない(表示の消去は PB の LAND 待ち)。`getContextUsage()` の表示と自動 compaction の閾値は、次の compaction までクリア前の規模を見る。

### Decision 5: role の永続化は spirits 独自 entry、`pi.virtual-model-state` は読むだけ

managed では `spirits_role` custom entry に `{ role }` を追記し、`/spirits-role` と role を伴う `/spirits-model` が書く。セッション開始時(`session_start`)は branch 上の最新の `spirits_role` を優先し、それが無いときだけ `pi.virtual-model-state` の最新 1 件(fork が書く `{ provider, modelId, role, state }`)の `role` を読み込む。`pi.virtual-model-state` への書き込みは行わない(公式コアが所有する entry で、公式 1.5.0 の読み取りは `{provider, modelId}` 一致の最新 1 件から `state` を返す形。拡張が role だけ足して書くとコアの state を壊す恐れがある)。

- 引き継ぎは片方向(fork → managed)だけ。`docs/agent-data-compat` の実測どおり managed はこの entry を増やさないから、双方向の同期は定義しない。
- 代替案: fork と同じ `pi.virtual-model-state` に書き込む。→ 上記のリスク。加えて「managed がこの entry を増やさない」という既測の性質を無意識に変えてしまう。

### Decision 6: badge は `ui.setStatus("spirits", "[role]")`

公式 footer は拡張 status を 1 行にアルファベット順で描画する(`modes/interactive/components/footer.ts`)。fork のモデル名隣のバッジではない。role を表す語は制御文字を除去して 1 行にし、空なら設定しない。更新は (1) `session_start`(保存された role)、(2) ルートが決まったとき(直近のリクエストの role)、(3) `/spirits-role`。

- 代替案: `setFooter` で footer ごと描画する。→ git branch・context usage など公式 footer のデータを拡張が再生産ることになり、上流 footer の変更に取り残される。

### Decision 7: `commands` を新層として追加する

`src/commands/` を新層 `spirits:commands`(許可先: `spirits:shared`、`spirits:routing`、`packages/coding-agent`)として `docs/architecture/convention-registry.md` の `registry:layers` と所属表に追加し、`spirits:entry` の許可先へ加える。既存層への置き場はない(`/spirits-clear` は routing でも harness でもない)。

- 代替案: `routing` に入れる。→ 会話のクリアは振り分けではない。`harness` に入れるのも同様。

### Decision 8: `/spirits-model` の引数解釈は fork の `/model` と揃える

末尾から (role) → (level) → 残りを検索語。fork の `model-commands` 仕様と同じ順なので、利用者は経路によって語順を覚えなくてよい。検索は `ctx.modelRegistry.getAvailable()` に対して `provider/id` 完全一致 → 一意な部分一致。virtual model は対象から除外する。

- 代替案: 公式 `/model` の selector を拡張して level/role を足す。→ 公式コマンドを上書きできず、P-SOURCE(PC)が必要。

## Risks

- [Risk] `context` フィルタの `drop` が pi の文脈構築とズレて、消すべき会話を残す、または残すべき会話を消す → Mitigation: 数え上げを projection 側から選び、`drop >= event.messages.length` では何もしない(縮小方向にしか失敗しない)。`/spirits-clear` の各条件を単体テスト(`test/managed-commands-clear.test.ts`)と互換性ランナーの専用 Pi 実測の両方で見る。ズレは「消えない」側に出るため、誤削除より軽度なことを spec のシナリオに書く。
- [Risk] 上流が `context` / `session_before_compact` の形を変えると clear が黙って効かなくなる → Mitigation: 互換性ランナーが専用 Pi で実際にマーカー入りの要求を送って観測する(`available` でなければ状態に現れる)。docs の追従表に追従対象を明記する(訂正 2 の「追従の対象」)。
- [Risk] `ctx.reload()` は重い(extensions/skills/prompts/context files 再読込、`session_start` 再発火) → Mitigation: 設定を書いたときだけ呼ぶ。idle の command 文脈でしか呼ばない(`ExtensionCommandContext` はユーザー起動の command にしか渡されない)。
- [Risk] 設定の同時書き込みで片側の変更が失れる → Mitigation: Pi と同じロック機構(A1 で実証)。加えて「交互書き込みで未変更キーと独自キーが残る」「2 プロセス並行で壊れない」を単体テストにする。
- [Risk] `defaultModel` に書いたモデルが後で使えなくなったとき、Pi の既定解決が詰まる → Mitigation: 書き込みは `getAvailable()` で実在を確認したモデルだけ。virtual model は書かない。

## Migration Plan

データ移行は不要(fork → managed はコピーでそのまま使えるのが `docs/agent-data-compat` の実測)。role だけは `pi.virtual-model-state` からの片方向の引き継ぎを実装側で吸収する。設定キーは fork と同じなので、`settings.json` を共有しても両経路が同じ値を読む。

## Open Questions

- `/spirits-clear` のチャット表示の消去を PB 待ちでなく拡張側でやる道(`setFooter` で表示を絞る等)は、fork と同じ見え方にならないため本変更では検討しない。必要になったら別 change。

## 付録: 前提確認の再現手順

`evidence/precondition-probe.ts`(公式 artifact の検証・bundle ビルド・staged RPC・fake provider を行う)を `bun evidence/precondition-probe.ts` で実行し、`evidence/precondition-results.json` に 19 項目の結果が出る。リポジトリ内の `scripts/managed-pi-compat/*` と `packages/spirits/src/managed-pi/*` を import する。実データ・実認証・実 provider は使わない。
