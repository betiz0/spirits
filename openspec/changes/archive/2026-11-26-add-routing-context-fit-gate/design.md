# Design

振り分けの一次設計は `docs/spirits-design.md` §4.5–§4.7 にある。この変更は新しい境界を作らず、その routing レイヤーの内側に gate を足す。

## Context

`spirits/auto` は host の仮想モデルとして登録しており、リクエストごとに `route()` が物理モデルと thinking レベルを決める(`packages/spirits/src/routing/register.ts:141-160`)。ロールが変わると応答する物理モデルが変わるので、会話の量はそのまま、収容量だけが変わる区間が生まれる。

固定版 Pi 1.6.0(`PINNED_PI.version`、`packages/spirits/src/constants.ts:619-631`)で実際に確認できた事実は次のとおり(以下 `dist/` は `@earendil-works/pi-coding-agent/dist/`)。

- 仮想モデルの選択では、送信前の閾値圧縮は `prepareRequest` に一本化されている。仮想モデルのとき `_compactBeforeNextAssistantResponse` は早期 return する(`core/agent-session.js:481-490`)。
- `prepareRequest` は route を引いたあと、**route 先の `contextWindow`** で閾値を測り、越えていれば `_runAutoCompaction("threshold")` を走らせ、projection を組み直す。ただし**組み直後に再判定せず、そのまま返して送信する**(`agent-session.js:493-544`)。閾値は `shouldCompact(estimate, contextWindow, settings)` = `settings.enabled && estimate > contextWindow - settings.reserveTokens`(`core/compaction/compaction.js:173-177`)。compaction 設定は選択中モデル向けに解決された値で、モデル override も含まれる(`docs/compaction.md:441-461`)。
- 圧縮の要約は `_runDefaultCompaction(preparation, this.model)` が作り、`this.model` が仮想モデルのときは `reason: "direct"` で route を引き直す(`agent-session.js:279-291, 2311-2315`)。route には `reason` / `messages` / `previous` が届く(`core/model-runtime.js:743-767`)。`reason: "direct"` は圧縮専有ではなく、分岐の要約・不具合報告の要約・拡張の直接解決も同じ reason を通る。要約のリクエストが受ける `messages` は会話を要約に切り出した span で、実送信の会話そのものではない。
- 送信直前に拡張が拒否を渡す口は無い。`before_provider_request` は payload を置き換えられるだけで cancel は返せない(`core/extensions/types.d.ts:712-717`、`core/extensions/runner.js:1079-1105`)。`context` / `context_with_system` の handler が投げた例外は報告されて握り潰される(`runner.js:1019-1075`)。`before_agent_start` の結果は `message` と `systemPrompt` のみで cancel は無い(`extensions/types.d.ts:1145-1149`)。
- run を開始させずに止める口は `input` の `{ action: "handled" }` だけ(`extensions/types.d.ts:930-950`)。spirits はステップ開始の確認で既にこの口と `phase.undoInput(token)` の巻き戻しを使っている(`packages/spirits/src/commands/register.ts:584-640`)。この巻き戻しは開始と復元の両方のステップ記録を追記し、リロードで復元位置が読み返されることを既存テストが固定している(`packages/spirits/test/routing-integration.test.ts:320-354`)。自然文でステップを終わらせる経路には undo トークンが無い。`phase` の待機中 undo 枠は 1 つ(`pendingUndo`)なので、断るはずの入力が `handleInput` を通過すると先行入力のトークンを上書きして `undoInput` を無効化する(`packages/spirits/src/routing/phase.ts:297-303,357-`)。
- 圧縮の終了順序: `compact()` は `compaction_end` を同期的に emit してから return し、`ctx.compact()` の `onComplete` はその後で呼ばれる(`agent-session.js:2425-2434, 2936-2947`)。TUI は `compaction_end` の処理内で圧縮中キューを `session.prompt(text, { streamingBehavior: "steer" })` で送信する(`modes/interactive/interactive-mode.js:2871, 3139-3185`)。だから TUI で圧縮中にキューされた入力も、gate が待機から戻る前の在職中に `input` ハンドラへ届く。
- 圧縮中の prompt の host 応答: 圧縮予約が確立した後に届いた prompt はエラー応答になる(`agent-session.js:1721-1723`)。予約確立の前に到達した後続 idle prompt は待たされず自分の run として開始され、後から来た圧縮に abort される(実測 `queue-coexists: false`、evidence 参照)。`pi.sendMessage(..., { triggerTurn: true })` は `sendCustomMessage` から `_startRun` を直接呼ぶため、`input` イベントにも圧縮中チェックにも掛からない(`agent-session.js:1976-1982`)。
- `ctx.compact()` は最初に run を abort して idle を待つ(`agent-session.js:2330-2360, 2081-2100`)。run が無い idle な入力では待ち合わせられるが、run 中に呼ぶと自分を待つので待てない。圧縮の成立時、host は `compaction_end` を先に出し、元の `CompactOptions` の `onComplete` より先に busy 状態を解き、TUI はそこで待ち行列を流し始める(`agent-session.js:1135-1137, 2425-2434, 2938-2947`、`modes/interactive/interactive-mode.js:3139-3179`)。`isIdle()` は圧縮中は false を返す。
- モードと UI の口: `ExtensionContext` は `mode: ExtensionMode`(`"tui" | "rpc" | "json" | "print"`)と `hasUI`(TUI と RPC で true)を持つ(`extensions/types.d.ts:232-239`)。RPC の `notify` と `setEditorText` は `extension_ui_request`(`method: "notify"` / `"set_editor_text"`)として流れ、後者は fire-and-forget で編集欄の復元は host 実装依存(`modes/rpc/rpc-mode.js:92-177`)。print / json の UI コンテキストは no-op(`core/extensions/runner.js:132-136`)。
- host の閾値測定 `estimateProjectedContextTokens` は root export されていない。root export される `estimateTokens`(chars/4 の過大評価)、`shouldCompact`、`buildSessionProjection`、`getLatestCompactionEntry` を使う(`dist/index.d.ts:6, 21`)。`ctx.getContextUsage()` は直近の応答モデルの上限を使い、圧縮直後は `tokens` が null になりうる(`extensions/types.d.ts:217-222`)。
- 直近の成功レスポンスの物理モデルは `latestSuccessfulModel()` が session 記録から導く(`packages/spirits/src/routing/resolve.ts:104-135`)。host の route リクエストの `previous` も同じ由来である。

制約として、host のソースへの差分は 0 を維持する。Behavior は拡張 API か `piConfig.name` overlay 越しにだけ実現できる(`AGENTS.md` Host Boundary)。

## Goals / Non-Goals

**Goals:**

- 「圧縮 → 再測定 → 収まらないなら送らない」を 1 つの境界で成立させる。
- 収容量の判定はロールではなく、実際に応答する物理モデルを基準にする。
- 測定と閾値は host と同じ基準を使い、spirits 側に第 2 の閾値を作らない。
- 断ったとき、role と step を入力前の位置へ戻し、その位置がリロードで読み返せることを契約にする。

**Non-Goals:**

- 圧縮の cut point を振り分け先の枠に合わせる(既定の `keepRecentTokens` が枠より大きい場合は断る。調整は別の変更)。
- 実行中の run 中にロールが変わった continuation の拒否。host に送信直前の拒否口が無い。
- 展開後に増える会話量と、print / JSON モードでの拒否の保証。
- gate の先行圧縮に属さない `direct` リクエスト(分岐の要約など)の解決先の変更と、その報告の是正。
- 物理モデルを選択しているセッションへの gate の適用。
- `/spirits-role status` への gate の表示の追加。

## Decisions

### D1 gate を置く境界は idle な `input`

- **選ぶ**: `pi.on("input")` で、`streamingBehavior` が無い(idle)入力だけ扱い、必要なら圧縮を完了まで待ってから、`{ action: "handled" }` で run を開始させずに返す。
- **理由**: 「先に圧縮して、その後に測り直して、送らない」という順序を、待ち合わせられる境界はこの 1 か所しかない。`input` は run が始まる前に await されるので、`ctx.compact()` の `onComplete` / `onError` を待てる。spirits が run を開始させる前に決められるので、会話リクエストが 0 件であることが run の有無で一義的に分かる。
- **保証範囲**: D9 のとおり、保証するのは受信時点の会話(展開前の本文 + ブランチ射影)まで。
- **代替案**:
  - `context_with_system` で測って `ctx.abort()` する。トランスクリプトは完成しているので測定は最も正確だが、拒否の形が aborted run になり、`abort()` は fire-and-forget なので会話リクエストが 0 件になる保証が観測で取れない。provider への失敗 1 件を払うことになる。
  - `route()` から throw する。host は route の失敗をエラー応答にして送信しない(`docs/virtual-models.md`)。ただし route は圧縮より前に走る(`agent-session.js:520-541`)ので、**圧縮しないまま断る**ことになり、会話は縮まないまま次の入力も同じ判断になる。
  - host に圧縮後の再判定と拒否の口を作ってもらう。最も筋は良いがソース差分 0 に反する。要求として `docs/spirits-upstream-issues.md` へ残し、その間はこの設計で待つ。

### D2 拒否の閾値は pi の reserve 込み閾値と同一数値(`enabled` だけ除外)

- **選ぶ**: gate の判定は `estimate > target.contextWindow - reserveTokens`。式は `shouldCompact` と同一で、`enabled` の判定だけを除く。`reserveTokens` は pi が選択中モデル向けに解決する compaction 設定の値(`pi.getSettings()`)、`contextWindow` は route 先の物理モデルの値で、pi の `prepareRequest` と同じ組み合わせを真似る。
- **理由**: 拒否が pi の圧縮判定と同じ閾値なら、「pi は圧縮するのに spirits は送る」(またはその逆)が起きない。公称の収容量の内側でも reserve を越えた会話は断る(利用者の判断)。`enabled` を式から除くのは、自動圧縮が無効でも「収まらないものは送らない」を保つためで(D8)、無効のときは圧縮を走らせないことと閾値の数値は別問題。spirits 側に新しい数値の既定は増やさない(CONFIG-DRIVEN)。
- **代替案**:
  - `estimate > window` の厳密な比較。断る基準が pi の圧縮基準より甘くなり、収まらないことが分かりきった会話を送る区間が残る。
  - `shouldCompact` をそのまま呼ぶ。`enabled` が false のとき常に false で、無効時に超えている会話を断れない。
- **drift ガード**: 有効時に host の `shouldCompact` と結果が一致すること、公称枠の内側で閾値越しの会話が拒否されることをテストで固定し、host の式が変わったら compat の観測ではなくテストで気づく。

### D3 圧縮は host の手動 compaction に委ね、cut は自作しない

- **選ぶ**: host の compaction を呼び、cut point・要約書式・split turn の規則・ファイル追跡は host に任せる。圧縮後も収まらないときは、理由に収容量と測った量と `compaction.keepRecentTokens` を名指す。
- **理由**: `prepareCompaction` は root export されていない。自作すると host の要約書式と cut の規則を複製することになり、host の版上げで静かにズレる(同じ理由で `/spirits-clear` も host の compaction を肩代わりする形に寄せている、`packages/spirits/src/commands/clear.ts:31-42`)。
- **代替案**: `findCutPoint` と `generateSummaryWithUsage` で振り分け先の枠に合わせた cut を作る。小さい枠でも成立する確率は上がるが、host の規則の複製が代償になる。枠が keep より小さい事故は理由の文面で利用者に委ね、調整は別の変更で判断する(今回の対象外)。

### D4 先行圧縮の要約先は gate の在職中だけ決める

- **選ぶ**: gate が `ctx.compact()` を呼ぶ間だけ「先行圧縮の在職」フラグを持つ。`route()` は (1) フラグが在職中、(2) `reason === "direct"`、(3) `request.messages` の推算がロールの対象の閾値に収まらない、の 3 条件が揃ったリクエストだけを gate の要約と判別する。そのリクエストでは、ロールの対象が span を収容できないとき、`request.previous` → `latestSuccessfulModel()` の順で、現在のカタログと資格情報で解決でき、かつ `contextWindow` が span を収める物理モデルを要約先に返す。どれも解決できないとき(判別できない場合を含む)はロールの対象を返す。gate に属さない `direct` リクエスト(分岐の要約・不具合報告・拡張の直接解決)の解決先は変えない。
- **理由**: 現状は `reason` を読んでいないので、要約もロールの対象で走る(`packages/spirits/src/routing/router.ts:100-150`)。振り分け先が自分より大きい会話を圧縮するとき、要約リクエストが振り分け先の枠で overflow して圧縮が失敗し、gate は断るしかなくなる。直近の成功モデルはその会話を実際に保持していたので、収容量が足りることは既に観測されている。全 `direct` への規則を gate 範囲へ絞るのは、分岐の要約など無関係な呼び出しの宛先を変えないための利用者の判断。
- **付随する規則**: gate と判別されたリクエストでは `onResolved` と `onRoute` を呼ばない。要約のリクエストがロール位相を「解決済み」にしたり、`/spirits-role status` の直近リクエスト報告を書き換えたりしてはならない。gate に属さない `direct` の報告の是正は別の変更に残す。
- **代替案**: 全 `direct` に同じ規則を適用する(前回案)。無関係な要約の宛先まで変わり、`status` の報告契約への影響も広がる。
- **撤回条件**: 在職中に gate 以外の `direct` が混在して判別が壊れる観測が取れたら、解決はロールの対象へフォールバックし、host が要約リクエストの由来を区別できる口を待つ(上流要求へ繰り越す)。

### D5 測定は projection と `estimateTokens`

- **選ぶ**: `ctx.sessionManager.buildSessionProjection()` のメッセージに `estimateTokens` を足し上げる。直近の compaction より前の entry が混ざらないことは projection が保証する。
- **理由**: `estimateProjectedContextTokens` は root export されていない。`ctx.getContextUsage()` は直近の応答モデルの上限を使い、圧縮直後は null になるので、圧縮後の再測定に使えない。
- **代替案**: `getContextUsage()` を使う。上限が振り分け先ではなく、圧縮直後に読めない。
- **副作用 1**: provider の usage を使わないので、pi の測定より厳しめに見る(chars/4 は過大評価)。gate が圧縮する回数は pi より増える方向で、誤って断る方向にも働く。Risks に取る。
- **副作用 2**: `/spirits-clear` でクリア済みになった entry も projection には残るので、推算は実際の実送信量より大きくなる。判定は早めに断る方向の誤差になり、安全側とみなす。境界の特別扱いは別の変更で判断する。

### D6 断ったあとの状態は既存の入力の巻き戻しで戻す

- **選ぶ**: `{ action: "handled" }` を返す前に、`phase.undoToken()` / `phase.undoInput(token)` でロール位相とステップを入力前の位置へ戻し、対話端末では本文を入力欄へ**追記**で戻し(`register.ts` の `restoreInputText`、`ctx.ui.setEditorText(`${ctx.ui.getEditorText() ?? ""}${event.text}`)`)、badge を描き直す。追記なのは D10 と同じ理由で、在職中の拒否は複数件続けて届くため set では前の本文を消す(D10 の TUI 実測で追記が前の行を保全することを確認済み)。既存のステップ開始確認と同じ巻き戻しなので、巻き戻し自体はセッション記録を追記する。契約は「戻った位置」であり、リロード・再開・ブランチ移動のあと同じ位置が読み返されることをテストで固定する(既存の undo と同じ検証形、`test/routing-integration.test.ts:320-354`)。
- **理由**: 実行されなかった run のステップが残ると、次の入力がそのステップのロールで走ってしまう。記録を 0 件にする第二の巻き戻しを作ると、復元規則が分かれて、分岐をまたいだ読み返しで検証できない状態が増える。既存の undo は開始と復元の記録を書くことをテストが固定しており、そこに乗り換えるほうが検証済みの経路が減らない。
- **未整理**: 自然文でステップを終わらせる経路には undo トークンが無いので、そのケースは巻き戻しなし(既存挙動どおり)で受け、Workflow follow-up に残す。
- **代替案**: 記録 0 件の巻き戻しを新設する(前回案)。復元規則が二重になる。本文だけ戻してステップを進める、または入力を捨てるは、次の入力のロールが狂うか本文を失うので不可。

### D7 適用する入力は「対話端末と RPC の、モデルリクエストを開始する idle 入力」

- **選ぶ**: 判定は `ctx.mode` が `"tui"` または `"rpc"` の idle な入力だけに行う。print と JSON は素通しする。拡張が登録したコマンド(`pi.getCommands()` で `source === "extension"`)、shell へ逃がす prefix、空行、拡張から送られた入力(`source === "extension"`)は対象外にする。スキルとテンプレートは対象にし、判定は展開前の本文と会話から行う。
- **host コマンドの扱い(実測で定めた限定)**: host のコマンドも対象外にしたいが、`pi.getCommands()` は拡張コマンドと prompt template / skill しか出さず、host コマンド名は拡張から検知できない。対話端末では host が `input` の前で自分のコマンドを横取りするので届かないのに対し、RPC では `/compact` が `input` に届く(evidence `input-shapes`)。よって実装は `source === "extension"` のコマンドだけを検知して除外し、host コマンド名による除外はしない。RPC で `/compact` が idle 入力として届いた場合はモデルリクエストを開始する入力なので、判定してよい(host が横取りしない以上それは素の本文である)。evidence の導出規則行 `input-rule` はこの確定版と食い違っている(「template / skill も素通り」と書いてある)ので、1.3 の再実行時に合わせる。
- **理由**: モデルを実行しない入力を断ると、収容量を超えているセッションで `/spirits-role status` が使えなくなる。スキル展開で増える量は `input` の時点では観測できないので、その分は host の送信前圧縮と overflow 復旧に任せる(D9)。print / JSON では `notify` も `setEditorText` も no-op で、拒否の理由を出せず、print の成功終了・JSON の機械可読結果との整合を今回の範囲で作らない(利用者の判断)。
- **代替案**: すべての入力に判定する。コマンドが動かない事故と、拡張が送る入力の無音の失敗を招く。print / JSON まで拒否を提供する。理由と終了契約の設計が host の no-op UI と噛み合わず、観測できる経路が無い。
- **fail open**: 分類に迷う入力は対象外にする。誤って送るほうが、誤って止めるより回収できる。

### D8 自動 compaction が無効なら圧縮せず、送らない判断はする

- **選ぶ**: `compaction.enabled` が false のときは圧縮を走らせない。そのうえで収まらないリクエストは断り、理由に自動 compaction が無効であることを名指す。拒否の閾値は D2 のとおり有効時と同一数値で、`enabled` に依存しない。
- **理由**: 設定を打ち消して圧縮するのは利用者の選択の書き換えだが、収まらないものを送らないことは設定と衝突しない。理由に設定を名指せば、利用者は `/compact` か設定で自分で進める。
- **代替案**: pi と同じく送る。ユーザー要求の「収まらなければ送らない」が設定 1 つで消える。

### D9 保証するのは受信時点の会話(idle 入力)

- **選ぶ**: gate の保証範囲は、入力を受信した時点で積まれている会話(展開前の本文 + ブランチ射影の推算)とする。スキル・テンプレート展開で増える量と、実行中の run 中のロール切り替えで continuation が小さい枠へ移る区間は、host の送信前圧縮と overflow 復旧に任せる。
- **理由**: 固定 Pi の送信直前の拒否口は idle `input` の 1 か所だけで、最終リクエストの保証には `prepareRequest` の後の再判定が必要になり、それは host に口を増やす要求(ソース差分 0 に反する)。ユーザーの中心ケースは「strong で積んだ会話を既定 normal へ戻すときの蓄積会話」で、idle 入力が担える。
- **代替案**: 最終リクエストまで保証する。1.6.0 では成立せず、製品実装を保留して上流 API を待つことになり、目的と衝突する。
- **在職中の切替は受信時点の対象で判定する**: gate は圧縮を待つ前に振り分け先を読み固定するので、待機中(≈圧縮の所要時間)に role lock や settings の normal 対象を切り替えても、再測定と拒否の閾値は受信時点の対象についてのものである。これは「受信時点で積まれている会話を保証する」という本決定の範囲どおりで、待機中の切替は continuation 側の区間と同じ扱いになる。拡張が登録したコマンドは `prompt()` が圧縮中チェックより先に実行するため(host 実装)、在職中に `/spirits-role` を打つと実行されるが、gate は圧縮後に測り直すので安全側へずれるだけである。

### D10 先行圧縮の在職フラグで後続入力を gate 自身が断る。Esc は従来どおりの取り消し

(2026-11-26 改訂。前版の「後続入力は pi の待ち行列に任せる」は実測で棄証: host は圧縮の予約が確立する前に到達した後続 idle prompt を待たせず自分の run として開始し、後から来た圧縮がそれを abort する。evidence の `queue-coexists: false` と `gate-flag-visible-to-racing-input: true`、`openspec/changes/add-routing-context-fit-gate/evidence/precondition-results.json`)

- **選ぶ**: gate は先行圧縮の「在職」フラグを持つ(実体は D4 の在職状態と同一)。フラグは圧縮経路の最初の await より前に同期で立て、gate ハンドラの全出口(continue / handled / throw)で finally により下ろす。在職中に `input` イベントへ届いた入力はすべて、通常の fit 判定を通さず `handled` + 理由通知で断る。ここでの「すべて」は D7 で gate 対象外とした prompt template とスキル起動(`skill:`)も含む(拡張コマンドは `input` イベントに届かないので、対象外ではなく元々届かない)。在職チェックは routing の `phase.handleInput` を呼ぶ input ハンドラより**前に登録**する。後に置くと、断る入力の `handleInput` が先行入力の `pendingUndo`(1 枠)を上書きし、先行入力の `undoInput(token)` が効かなくなる(`packages/spirits/src/routing/phase.ts:297-303,357-`)。
- **戻り方の様式**: 対話端末では本文を editor へ**追記**で戻す(圧縮中キューは `compaction_end` 処理内で prompt と steer として順に届くため、set でなく追記なら複数件でも上書きしない、`interactive-mode.js:2871,3139-3185,4144-4147`)。RPC では `handled` の成功応答(disposition `handled`)と拡張通知が返る。host 本来の圧縮中 prompt エラー応答(`agent-session.js:1721-1723`)とは別の経路で、断る側が成功応答になるのは gate の設計である旨を仕様側に併記する。
- **フラグを降ろさない場所**: `session_compact`・`compaction_end` では降ろさない(そこで降ろすと、キュー入力が先に run を開始し、`streamingBehavior` 無しの元の入力が `agent-session.js:1760` の "Agent is already processing" で失われる経路が開く)。`before_agent_start` でも降ろさない(`_preparePrompt` の throw でフラグが残り続ける)。降ろすのは gate ハンドラの出口だけ。
- **取り消し**: 待ち受け中の取り消し(Esc)は `/compact` と同じ pi の abort 経路で圧縮を中断させる(`Compaction cancelled`、compaction entry 0、provider リクエストはクライアント切断を実測済み)。gate はその入力を「圧縮が成立しなかった」として扱い、送らずに D6 で状態を戻し、理由に取り消しを名指す。
- **既知の制限(実装しない)**: `pi.sendMessage(..., { triggerTurn: true })` は `sendCustomMessage` から `_startRun` を直接呼ぶため、`input` イベントにも圧縮中チェックにも掛からず、gate では防げない(`agent-session.js:1976-1982`)。spirits 本体にこの呼び出し箇所は無い。host 側の制限としてここに記録する。
- **TUI 実測の追記(タスク 5.6、evidence/tty/)**: 対話端末では圧縮中に打った行が 2 経路に分かれた。先に `input` へ届いた行は in-flight guard がその場で断り、host の TUI 自体がキュー(`↳ Alt+Up to edit all queued messages`)に積んだ行は待機解除後に gate 本体が改めて断る(2 回目は `Already compacted` 経由)。どちらの経路も `handled`+通知で送らず、本文は editor へ追記で残り、前の行は消えなかった。期待値との差分は「すべて `compaction_end` 経由で届く」部分で、契約(送らない・追記で戻す・複数行保全)は両経路で成立。
- **代替案**:
  - 競合を許す(前版の実測動作のまま): 後続入力が先に run を走らせ、後から来た圧縮に abort される。無駄 run と abort 痕跡が残る。
  - 上流待ち(Q-4 C): 送信前に待てる境界は idle `input` の 1 か所だけなので、実質この変更の実装不可になる。

### D11 `fit.ts` は共有する測定処理だけを持つ

- **選ぶ**: 新しい module `packages/spirits/src/routing/fit.ts` には、(1) projection から会話の推算と閾値判定(D2 の式)、(2) 任意のメッセージ群の推算が窓に収まるかの述語、の 2 つの純粋な測定処理だけを入れる。入力の判別と gate の制御は `register.ts`、要約先の解決規則は `router.ts` に置く。
- **理由**: 測定は gate(`register.ts`)と gate 要約の判別(`router.ts`)の 2 か所から呼ばれる。どちらかに実装して他方が import すると、入力制御のコードへモデル解決が依存する方向が生まれる。共通の測定だけを分離すると、境界が 1 つ増える代わりに依存方向が測定→使われ方に揃う。
- **代替案**: `register.ts` に直接実装して `router.ts` が import する。module を増やさないが、route が入力制御に依存する。
- **撤回条件**: 実装の結果、呼び出し元が 1 か所になった場合は module を解消して呼び出し元に inline する(`AGENTS.md` の 1 呼び出し元の helper を置かない規則)。

## Risks / Trade-offs

- `[Risk]` idle 入力の分類が host の実際の振り分けとずれる(host コマンド、bash へ逃がす入力、テンプレート) → `[Mitigation]` 実装の前に pinned artifact と公式モードで `input` に届く入力を列挙して `docs/spirits-managed-pi.md` に記録し、分類できない入力は対象外にする(fail open)。
- `[Risk]` `ctx.compact()` を idle 入力で待ったときに、session が busy のまま復帰しない、または待ち受け中の後続入力が順序を壊す → `[Mitigation]` 実測済み(タスク 1、evidence): 待機は成立し(`compact-waitable-from-idle-input: true`)、abort も既存経路で成立し(`esc-aborts-compaction: true`)、後続入力の競合は host 側では起きるが在職フラグが後続ハンドラから見える(`gate-flag-visible-to-racing-input: true`)ため、D10 の gate レベル拒否で封じる。host の待ち行列仮定は棄証済み(`queue-coexists: false`)で、設計から外した。
- `[Risk]` chars/4 の推算が provider の実使用量とずれ、実際に収まる会話を断つ → `[Mitigation]` 断るときは理由に推算と収容量と閾値を出すので利用者が判断できる。pi の overflow 復旧は後段に残る。公式モードで推算と実測の差を見る。
- `[Risk]` projection は `/spirits-clear` でクリア済みの entry も含むので、推算が実際の実送信量より大きく、収まる会話を早めに断ることがある → `[Mitigation]` 安全側の誤差として理由に推算を出す。境界の特別扱いは別の変更。
- `[Risk]` 圧縮後に残る keep が振り分け先の枠より大きい(既定 `keepRecentTokens` 20000 > 小さい枠)と gate は断り続ける → `[Mitigation]` 理由に収容量と `compaction.keepRecentTokens` を名指す。枠に合わせた cut は別の変更で判断する。
- `[Risk]` gate の圧縮と `prepareRequest` の閾値圧縮が 1 ターンで二重に走る → `[Mitigation]` 閾値は host と同じ規則なので、圧縮後は host の閾値下にいることが多い。公式モードの fake provider で圧縮 entry 数と要約・会話リクエストの件数を別々に測り、2 回走るなら gate の測定側を寄せる。
- `[Risk]` run 実行中のロール変更で continuation が小さい枠へ切り替わる区間は守れない → `[Mitigation]` host の閾値圧縮と overflow 復旧が受けると `docs/spirits-managed-pi.md` に制約として記録し、送信直前の拒否口を `docs/spirits-upstream-issues.md` へ要求として残す。
- `[Risk]` 断る前に要約で 1 回モデルを呼ぶので、料金と待ち時間が増える → `[Mitigation]` 収容量を越えているときだけ走る。要約は 1 回で、`previous` の解決に失敗したらロールの対象に寄せる。
- `[Risk]` RPC の `setEditorText` は fire-and-forget で、編集欄の復元は host 実装依存 → `[Mitigation]` 復元は最善を尽くすに留め、RPC の契約は `handled` + 拡張通知(`method: "notify"`)とする。通知に本文が戻らない可能性があることを含める。
- `[Trade-off]` `/spirits-clear` の境界より前の会話は、gate が走らせる圧縮でも要約に載らない(`openspec/specs/managed-commands/spec.md` の自動 compaction の肩代わりが manual でも同じ hook を通る)。境界の肩代わりが優先されることをテストで固定する。

## Open Questions

(なし。cut を枠へ合わせる調整、自然文ステップ終わりの undo、gate 外 `direct` の報告是正は、いずれも別の変更として tasks の Workflow follow-up に残す)
