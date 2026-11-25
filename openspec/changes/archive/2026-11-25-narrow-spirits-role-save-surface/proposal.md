# Proposal

## Why

一覧の `use normal` / `use strong` は「この会話をそのロールで動かす」と読める語面で、実際にはセッションのロックと global 既定の保存をするだけだった。セッションが物理モデルを選んでいると host は `route()` を呼ばないので振り分けは全く働かず、`use strong` を押しても badge は `[off]`、フッターのモデル表示もそのまま、スキルも strong の対象で走らない。同じセッションで `save` は「いま選んでいる物理モデル」を global 既定として書き込むため、off を次回に複製する側にはたらく。結果として、off の人が振り分けに載る導線が一覧側に 1 つもなく、`save` が誤用を助長していた。

## What Changes

- **BREAKING**（一覧の操作面）一覧の `use normal` / `use strong` 操作行を削除する。ロックは既存の `role lock` 行の候補と `/spirits-role <role>` だけの経路に残す。
- **BREAKING**（`save` の書き込み条件）セッションが物理モデルを選択しているとき、`/spirits-role save` と一覧の `save` 行は global settings へ一切書き込まない（`models.role` も含めて書かない）。他拡張の仮想モデルと、同名の物理モデル `spirits/auto` も見送る。見送り理由は選択の実態と一致させ、物理モデルでは物理モデルが選択されていること、他拡張の仮想モデルではそのモデルが振り分け用ではないことを出す。モデル未選択は従来どおり物理モデルの選択ではなく、`models.role` だけの保存は残る。
- 一覧の操作行は `save` とその直後の区行だけになる。`save` 行は予告の代わりに見送り理由を出し、一覧は閉じない。コマンドの見送りは TUI・RPC では warning とし、理由と事実を伝える。実行可能な手順は TUI でのみ案内し、print は無出力とする。見送りの判定はファイルに依存せず書き込みも試みない。一覧が予告用の読み取りを行っても、その成否で見送り理由は変わらない。`RoleWrite` には見送りを運ぶ `declined` を追加し、`use` 行と一緒に消える `partial` は削除する。
- `/spirits-role status` の手順表示の条件を「振り分けが無効なとき」に広げる（現行は振り分け用モデルがスコープ外のときだけ手順を出しており、スコープ未設定とスコープ内で一覧の「手順は `status`」案内が空振りしていた）。モデル未選択は無効と報告する。仮想モデルの登録が失敗したときは、同名の物理モデルがカタログにあっても手順を名指さず、未登録の理由を出す。`status` は未登録とスコープ外が重なれば両方の事実を出す。
- 物理モデル選択中の設定変更の警告（「振り分けが働いていないことと、振り分け用モデルを選択すると有効になることを 1 行で伝える」）は残すが、`save` は書き込まないのでこの警告の対象から `save` を外す。有効化の手順は、TUI の `status`、`save` の見送り通知、設定変更の警告に、実行できる場合だけ出す。
- 一覧の説明には有効化の操作を名指さないという既存の規則は維持する（一覧は「見送った」ことと `status` に手順が出ることを出し、操作そのものは `status` とコマンドの通知に出す）。
- 文書（README 4 言語、`docs/spirits-managed-pi.md`、`docs/spirits-managed-pi-design.md`）から `use` 行の記述を除き、`save` の見送りと、有効化が host のモデル selector 側にあることを記す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `managed-commands`: 一覧の操作行の構成（`use` 行の削除）、`save` の書き込み条件（物理モデルを選択している間は書き込まない）、見送り理由の一覧と通知の出方、`status` の状態表示と手順表示の条件（対話端末の off で、振り分け用モデルが登録済みならスコープの別なく手順を出す）、およびその文書化。`dual-model-routing` の route・位相・ステップの規則は不変。変更は `managed-commands` の選択判定・表示・書き込み面に限る。

## Impact

- 実装: `packages/spirits/src/commands/role-panel.ts`（`USE_ROW_PREFIX`、`useRowId`、`useRowRole`、`useRow`、`activate()` の `use` 分岐、`runUse()`、`isActionRow()` の縮小、`saved || partial` の畳み込みと見送りの行表示、global 読み取り失敗より見送り優先）、`packages/spirits/src/commands/role-write.ts`（`applyRoleSave`、`decideSave`、`describeSavePreview`、`RoleWrite` への `declined` 追加と `partial` 削除）、`packages/spirits/src/commands/register.ts`（`save` ハンドラの通知の種別と見送り手順の名指し、`statusReport` の手順表示条件）、`packages/spirits/src/commands/role.ts`（モデルの選択状態・登録有無・スコープ・モードの区別を各表面で共有）、`packages/spirits/src/constants.ts`（キーではなく操作を案内するため `HOST_COMMANDS.scopeToggle` を削除）
- テスト: `packages/spirits/test/managed-role-panel.test.ts`（`use` 行の 7 件を削除、`use` と単独 `save` の混在ケースを分割、行順・見送り・global 読取失敗のケースを追加）、`packages/spirits/test/managed-role-command.test.ts`（`save` が物理モデルを保存する前提のケースを `spirits/auto` 前提へ書き換え、見送りのケースを追加）、`packages/spirits/test/managed-role-warning.test.ts`、`packages/spirits/test/managed-role-status.test.ts`（手順表示条件の拡張と未登録時の理由表示）、`packages/spirits/test/managed-commands.test.ts`（`decideSave` を呼ぶ fixture を保存が許可される選択へ更新）、`packages/spirits/test/host/fake-pi.ts`（`fakeCustomScreen` の `done()` 記録。一覧が閉じたか閉じていないかを観測可能にする）
- 固定ホスト Pi 1.5.0 の実測: 振り分け用と同名の物理モデルが存在すると、host は仮想モデルの登録を拒否するだけでなく拡張の読み込み自体を起動時に拒否する。そのため「登録が拒否されたまま同名物理モデルが残るセッション」は実機では作れず、その状態での `save` / `status` の挙動は渡された選択/カタログに対する防御条件として単体テストで担保する（実機の受入条件は起動時の読み込み拒否）。
- ホストの公開面への依存: 追加なし。既存の `ctx.model`、`ctx.scopedModels`、`ctx.mode`、`ctx.modelRegistry`、`pi.getSettings()` の読み取りのみ。`pi.setModel()` は呼ばない（セッションのモデル選択を spirits が書かない方針は維持し、有効化は host の操作に残す）。
- 依存・配布物: 変更なし。`bun.lock`、managed set の manifest、sha256、ホスト版、配布バイナリには触れない。
- 互換性: 一覧の行が減る後方互換のない変更。コマンド文法（`/spirits-role <role>`、`<role|step> <item> <value>`、`save`、`status`）、`models.*` のキー形式、`defaultProvider` / `defaultModel` の読み方は不変。すでに global に保存された値はそのまま読まれる。既存の互換計測（`scripts/managed-pi-compat`）の変更は不要。`save` のモード・起動条件の回帰は固定版 Pi と faux provider を使い、隔離されたテストで確認する。
