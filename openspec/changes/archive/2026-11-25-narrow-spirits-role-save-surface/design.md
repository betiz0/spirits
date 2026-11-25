# Design

## Context

`/spirits-role` の書き込み面は 3 つの表面(コマンド行、一覧の設定行、一覧の操作行)から `commands/role-write.ts` の 3 つの操作に集約されている。`applyRoleLock` は phase のロックと `models.role`、`applyRoleSetting` は role/step の 1 キー、`applyRoleSave` は `models.role` と `defaultProvider` / `defaultModel` を書く。`use` の行はこのうちロックと保存を順に呼ぶだけの操作で、セッションのモデル選択には触れない。`RoleWrite.partial` はこの 2 段操作(ロックは成立し保存は断れた)を運ぶためのフィールドで、生むのは `use` の行だけである。

振り分けが働くかどうかは spirits の設定ではなくセッションのモデル選択が決める。host は選択中のモデルが仮想モデルのときだけ `route()` を呼ぶ。物理モデルが選択されていれば `models.*` も位相も一切読まれず、badge は `[off]` になる。`save` はその状態で「いま選んでいる物理モデル」を global 既定として書くので、off が次のセッションに複製される。

ホストの挙動(公式 Pi 1.5.0 の artifact で確認済み):

- `pi.setModel()` はセッションのモデルを変えるが、`defaultProvider` / `defaultModel` は変えない(`docs/extensions.md` の `pi.setModel`)。
- 新規セッションの起動時のモデルは `--model`、次にスコープ(`--models` または `enabledModels`)が非空のときは「saved default がスコープ内なら saved default、無ければスコープの先頭」、最後に `defaultProvider` / `defaultModel`、最後に利用可能な第一眼(`main.js` の `buildSessionOptions` と `core/model-resolver.js` の `findInitialModel`)。再開セッションは記録されたモデルをリストアする(`core/sdk.js` の `restoredModel`)。
- 仮想モデルを登録した provider は資格情報を必要とせず、登録時に configured として扱われる(`core/model-runtime.js` の `registerVirtualModel`)。
- `enabledModels` は host のスコープで、spirits は `save` でこれを変更しない(現行の `managed-commands` 要件)。
- 見送りは `ctx.model` の選択状態だけで決まる。Pi 1.5.0 では物理モデルが `spirits/auto` を名乗ると、同名の仮想モデルの登録は拒否され、さらに host はその拡張の読み込み自体を起動時に拒否する(2026-11-24 実測: `Error: Extension … error: Virtual model spirits/auto conflicts with a physical model.` でセッションが立たない)。つまり実セッションでは「登録が拒否されたまま同名物理モデルが残る状態」でコマンドを実行できない。従って同名物理モデルに対する見送り・未登録理由の判定は、渡された選択/カタログに対する防御条件であり、実機の受入条件は起動時の読み込み拒否、コマンド挙動は単体テストで担保する。名前だけを見ると、`status` が実行不能な操作を案内し、同名の物理モデル上の `save` が global 既定を書いてしまう。選択と登録の判定には、モデルの `api` も使う。

一次根拠は `docs/spirits-design.md`(virtual model の節「既定モデルの変更も自動選択もしない」)と `docs/spirits-managed-pi.md` の一覧と `save` の節。ここにはその重複を書かない。

## Goals / Non-Goals

Goals

- 一覧に「効いた状態を作らない操作」を残さない。
- `save` を「振り分け用のモデルを選んでいるセッションが、その選択を次回に引き継ぐ」操作に限定し、off を複製する通路を閉じる。
- 見送りと失敗と変更なしを、表面(行・通知・再読み込み)のすべてで区別する。
- 対話端末の off 状態では、有効化できる場合は `status` から手順を、できない場合は理由を届ける。

Non-Goals

- 振り分けへの切り替えを spirits が代行しない(`pi.setModel()` も `enabledModels` の書き換えも導入しない)。
- route・ステップの位相・`rlm` の子のモデル解決と、badge の表示形式を変えない。モデル分類の誤りだけはコマンド側の badge も含めて直す。
- `/spirits-role` の文法(`<role>`、`<role|step> <item> <value>`、`save`、`status`)と補完を変えない。

## Decisions

### Decision 1: 見送りの判定は `decideSave` に置き、global ファイルに依存させない

選択状態は「未選択」「spirits の振り分け用」「それ以外」の 3 通り。識別子 (`spirits/auto`) と Pi の仮想モデル API (`PI_VIRTUAL_MODEL_API`) の両方が一致する場合だけ振り分け用とする。同じモデル判定をカタログ・スコープ判定にも使う。`selectionOf()` は `ctx.model` の API を捨てず `SessionSelection` に渡す。`decideSave`・`applyRoleSave`・`describeSavePreview` は同じ見送り判定を読む。選択が「それ以外」なら `writes` は空で `declined` を返し、未選択ならロックの保存を続ける。

見送りは global ファイルの現在値に依存しない。`applyRoleSave` は見送りでは `deps.saveSettings` を呼ばないので、ファイルを作成せず、読めないファイルへの書き込みも試みない。一覧のスナップショットが予告用に global を読み取ることは許容する。その成否にかかわらず、見送り理由が変更予告や読み取り失敗の表示に優先する。

見送りの重複判定と到達しない分岐の整理(deep verify W-4、G-1): `describeSavePreview` は `decideSave` の見送り結果を使って先行させ、見送り述語を自ら繰り返さない。`saveableModel` の物理モデルパススルー分岐は `decideSave` が先に見送るため到達せず、物理モデルも書けると読めるので削除する。見送り理由は選択の実態と一致させ(deep verify C-1)、物理モデルでは物理モデルが選択されていること、他拡張の仮想モデルではそのモデルが振り分け用ではないことを出す。

理由: 選択の分類を共有すれば、一覧だけ保存が通る、あるいは badge・`status` は on なのに `save` は見送る、といった不一致を防げる。判定は `commands` 層内の既存モジュールで共有し、route や子モデル解決にまたがる新しい依存は作らない。

代替案: `register.ts` の `save` ハンドラと一覧の `runSave()` で `isPhysicalSelection(ctx)` を見て呼び分け、`role-write.ts` は無変更にする。→ 一覧側は `RolePanel` が `ctx` を持たないのでスナップショットに `routingOff` を足す必要があり、予告とコミットで条件を 2 回書くことになる。却下。

### Decision 2: 見送りは `RoleWrite` の新しい運搬フィールド `declined` で表す

`RoleWrite` に `declined?: string` を追加し、`failure` は「ファイルが書き込みを拒否した」時に限定する。`declined` は `saved: false`、`wrote: []` と共に返し、`failure` と同時に立てない。`declined` の文言は手順を名指さない理由文だけを含み、操作名指しは表面が継ぎ足す(Decision 5)。

表面の規則は 3 つ違う。(a) 一覧は `failure` を `not saved: ` の接頭辞でその行に出すが、見送りは「書き込めなかった」ではなく「書き込まない」なので同じ文に乗らない。(b) 通知の種別が `failure` は error、見送りは warning、成立と変更なしは info であり、文字列で区別できるものではない。(c) `partial` と `hasWrites()` はロックが成立した半分を扱う規則で、見送りには成立した半分がない。

通知契約は表面ごとに分離する(deep verify S-1)。コマンド面は必ず通知する(見送り warning、成立・差分なし info、print は無通知)。一覧全体の見送りは一覧を開いたまま行に理由を残すため通知を出さない(Decision 6)。一覧が保存の成立または差分なしで閉じるとき、info 通知が結果を伝える。

`declined` を追加する撤回条件: 見送りの表面規則が増える(例えば role だけ書く部分見送りが必要になる)なら、string でなく構造化した見送り種別に組み替える。そのときは `saved` / `failure` / `declined` の 3 値の排他を型で表す。

代替案: `failure` を再利用し、呼び出し側で文言を見て通知種別を変える。→ 文字列判定になり、`not saved: ` の接頭辞を外す分岐が行の再描画規則(`afterLead`)にまで及ぶ。却下。

### Decision 3: `models.role` も含めて全体を見送る

見送りでは 3 キーすべてに触れない。

理由: `models.role` の既定値はロックの経路(`/spirits-role <role>` と一覧の `role lock` の行)がすでに書くので、`save` から消しても行き場はなくならない。逆に role だけ書く Partial な見送りにすると、`save` 行が「一部だけ書けた」状態を持つことになり、Enter 専用・行に結果を残す・閉じるときの再読み込みという一覧の規則に新しい組合せが増える。

代替案: role だけ書いて model の 2 キーだけ見送る(既存の `skipped` の仕組みに乗せる)。→ `skipped` は「振り分け用モデルを既定に置く安全性の検査が通らなかった」ための運搬で、「そもそも保存すべきでない状態」とは意味が違う。却下。

### Decision 4: 振り分けへの載せ替えは代行しない

`use` 行を「`spirits/auto` を選んでからロックする」行に作り替える案、`save` の見送りのときに `pi.setModel()` を呼ぶ案のどちらも採らない。

理由: 現行方針は「spirits は既定モデルの変更も自動選択もしない」(`docs/spirits-design.md`)。載せ替えを代行すると、host のスコープ(`enabledModels`)との整合を spirits が背負うことになる。実測の起動規則では新規セッションはスコープが非空のとき saved default がスコープ外だとスコープの先頭が選ばれ、`save` はスコープを書かないので、spirits がモデル選択だけ書き替えても次回起動で元に戻る。「載せる」を請け負えないなら、載せる操作は host のものとして名指す方が正直である。

代替案: `save` に見送りではなく載せ替えをさせて「save すれば効く」ようにする。→ `setModel` はセッション限定で `enabledModels` に触れないので、スコープを設定している環境では save しても次回は off のまま。半端な代行がいちばん誤解を招く。却下。

### Decision 5: 手順の名指しは `status` とコマンドの通知が出し、一覧の行は `status` への案内だけ出す

`status` は振り分け用モデルを選択した場合だけ on を出す。未選択は off とし、現在モデルが未選択である旨を出す。登録の有無は `ctx.modelRegistry.getAll()` で本物の仮想モデルを確認する。スコープは `ctx.scopedModels` を別に確認する。登録とスコープは別の事実なので、`status` では未登録とスコープ外が重なっても両方を出す。

`status`、`save` の見送り、設定変更の警告は、登録・スコープ・モードから案内を出し分ける判断を共有する。TUI で登録済みなら、スコープ内またはスコープ無しでは selector での選択を、スコープ外では範囲の切替や `/scoped-models` を案内する。未登録では操作でなく理由を出す。RPC は事実と理由だけを通知し、print の `save` は無出力とする。スコープ切替はキーでなく操作を名指し、`HOST_COMMANDS.scopeToggle` は削除する。キーは selector 自身が現在の割当を出す。

一覧は有効化の手順もスコープ診断も出さない。見送り理由を行に残して `status` を示し、`status` が操作または実行できない理由を伝える。理由: 一覧の短い説明欄に手順を繰り返さず、詳細を専用の報告に集約できる。

案内の可否は登録・スコープ・モードから一か所で決める(deep verify W-4)。`register.ts` の警告と `status` の手順表示が別々に可否を組み立てず、`status` は未登録とスコープ外という 2 つの事実を表示する責務だけ持つ。RPC で名指すことを禁じるのは振り分けの有効化手順だけであり(deep verify S-3)、strong モデルの指定は振り分け自体の設定なので既存要件どおり TUI・RPC の警告に含める。

代替案: 一覧の `save` 行にも直接手順を名指す。→ 既存要件(一覧の説明に操作を出さない)との矛盾を例外として明文化することになり、行の長さも膨らむ。却下。`status` の手順表示を off 全体の条件へ広げると `status` の既存テスト(`振り分け用モデルがスコープ外だと分かる` など)の前提が変わらない範囲で追記できる(スコープ外の既存シナリオは手順を出すままなので不変)。

### Decision 6: 一覧の `save` 行の見送りは閉じない

見送りは失敗と同じく一覧を開いたままにし、理由をその行に出す。再読み込みは要求しない(`hasWrites()` に加えない)。

理由: 一覧が閉じて通知だけになると、理由が一瞬で画面から消える。行に残せば `status` へ進む前に読み直せる。既存の「見送り・失敗の理由はその後の再描画の失敗でも失わない」規則(`lastSave` を保持する実装)にそのまま乗る。

代替案: 差分なしと同じく閉じて通知する。→ 書き込み予定の予告を見た直後に画面が消え、理由と予告の対応が取れなくなる。却下。

### Decision 7: 削除する語と `partial` は一覧に閉じたまま消す

`USE_ROW_PREFIX`、`useRowId`、`useRowRole`、`useRow`、`RolePanel.activate()` の `use` 分岐、`openRolePanel` の `runUse()` を削除し、`isActionRow()` は `save` の行だけを見る。`use` 行が消えると `RoleWrite.partial` を生む操作も消えるので、`partial` フィールドと、一覧が `saved || partial` で畳んでいた分岐と `hasWrites()` の partial 扱いもこの変更で除く(次のセッションで同じ判定を再発見させるより、消した方が分岐が 1 つ減る)。一覧固有の語彙(`use`)の削除は `constants.ts` に及ばない。`constants.ts` の変更は Decision 5 の `HOST_COMMANDS.scopeToggle` の削除による。`RolePanelList` の `onActivate` は `save` 専用になるが、Enter 限定の仕組み(`confirmEnter` と `tui.select.confirm` の照合)はそのまま残す。

代替案: `partial` を将来の 2 段操作のため残す。→ 生产侧が消えたフィールドはテストからも外れ、気づかないところで腐る。必要になったとき作り直すすぎの方が安い。却下。

## Risks / Trade-offs

- [Risk] 物理モデルを選択中のユーザーが「save が壊れた」と受け取る → Mitigation: 見送りの文言は理由を一覧行に、コマンドでは理由と実行できる操作を 1 行で出す。既定 role はロックの経路が書くので、ロールの既定だけを残したい操作は従来どおり成立する。
- [Risk] 新しい `declined` が `failure` / `hasWrites()` の既存分岐をすり抜けて、一覧が閉じる、または error 通知になる → Mitigation: `panel.activate()` の呼び出し側(`runSave`)と `register.ts` の `save` ケースの両方に分岐を追加し、「見送りでは一覧を閉じない」「warning であって error 通知にしない」「再読み込みしない」をテストで固定する。
- [Risk] `save` の既存テストの何件かは物理モデル選択を前提にしており、見送りで落ちる → Mitigation: tasks で該当ケースを `spirits/auto` 前提へ書き換える順を先に置く。`use` 行を削除するタスクは同一ファイル内の混在ケース(`use` と単独 `save` を 1 テストで見るもの)の分割も含める。
- [Risk] `status` の手順表示の条件拡張が既存の `status` テストを壊す → Mitigation: 手順表示は追加であって既存シナリオ(スコープ外で手順を出す)の出力を変えない。タスクで `managed-role-status.test.ts` 全体をこの変更で実行して確認する。
- [Risk] 一覧の先頭 2 行が消えてカーソル位置が変わり、手順を暗記していた人が迷う → Mitigation: README 4 言語と `docs/spirits-managed-pi.md`、`docs/spirits-managed-pi-design.md` を同じ変更で更新し、ロックの唯一の一覧経路が `role lock` の行だと書く。
- [Risk] `isRoutingModel()` を使った見送り判定が、モデル未選択のセッションで誤爆する → Mitigation: `selection.model === undefined` は見送らない(現行の `models.role` だけの保存を維持)。既存テスト `an unselected model is not a physical model` を保持する。
- [Trade-off] 一覧から「ロック + 保存」の 1 回操作が消えるので、ロックして既定に固定するには 2 回の操作が要る。→ 効いた状態を作らない 1 回操作を置くより、2 回で状態と結果が分かれている方が誤解が少ないと判断する。

## Migration Plan

コードと文書は同一変更で揃える。global settings に保存済みの値はそのまま読めるので、設定データの移行は無い。`use` 行に依存する外部手順は互換計測にも無く(`scripts/managed-pi-compat` はコマンド行のみ駆動)、機械的な移行対象も無い。操作手順の変化(一覧に `use` が無い、`save` は物理モデル選択中は見送られる)は README と docs に同じ変更で書く。ロールダウンはこの変更を revert すれば戻るが、見送り導入後に `save` していたユーザーの global 既定は変わっていないので、戻っても追加の復旧作業は不要。
