# Tasks

前提確認(§1)は実装前に行い、結果は `design.md` の「前提確認」に記録した。B の比較の結果、方式 (b)(区切り entry + `context` フィルタ)を採用し、方式 (a) は採用しない。

## 1. 前提確認(公式 Pi 1.5.0 + fake provider・隔離 HOME)

- [x] 1.1 `evidence/precondition-probe.ts` を書き、実装と同じ形状(proper-lockfile を inline した bundle、`spirits_clear` custom entry、`context` フィルタ、`session_before_compact` の肩代わり)の拡張を公式 Pi 1.5.0 に読み込ませる。確認: `bun evidence/precondition-probe.ts` が終了コード 0、`evidence/precondition-results.json` に 19 項目
- [x] 1.2 A1: bundle に locker が inline されること、隔離 agent dir の `settings.json` に対して拡張 200 回と別プロセスの実 `SettingsManager` 200 回を同時に走らせても JSON が解析でき、両側のキーが残り、`.lock` 残骸が無いこと(`A1.bundle-inlines-proper-lockfile`、`A1.race-with-settings-manager-keeps-both-sides`、`A1.lock-released`)
- [x] 1.3 A2: command ctx の `reload` / `ui.setStatus` / `buildSessionProjection`、`pi` の `getSettings` / `appendEntry` / `setModel` の存在、`await ctx.reload()` 後の `session_start` で書き込み後の設定が読めること。加えて reload 後に同じ command の `pi` / ctx が stale になることを観測し、実装条件として design Decision 3 に記録(`A2.command-context-surface`、`A2.reload-applies-written-settings`)
- [x] 1.4 A3: 公式 1.5.0 で `registerModelRoles` が `false` であることを観測(`A3.registerModelRoles-absent`)。fork が `true` であることは `docs/agent-data-compat` の probe を根拠にする
- [x] 1.5 B(a): 短い会話で `compact` が `Nothing to compact` で失敗し `session_before_compact` が 0 回、直前の entry が compaction のとき `Already compacted`、preparation が成立する場合だけフックが発火し、そのとき要約メッセージが文脈に残ることを観測(4 項目)。決定事項 1 を満たさないため方式 (a) を不採用
- [x] 1.6 B(b): 区切りより前の識別(数え上げは `role !== "system"` で揃える)、短い会話、2 回連続実行、`--continue` 後の再開、自動 compaction(reason `threshold`)発火時の肩代わりとクリア済みマーカーの非復活、肩代わり後に projection の prefix count が 0 になること(使用量表示と閾値の整合が compaction まで遅れることの裏付け)を観測(8 項目)
- [x] 1.7 design.md の前提確認・Decisions に結果を反映し、`/spirits-clear` は方式 (b) で進める(9 目的はすべて観測可能な形が残るため、clear を change から外さない)

## 2. 共通基盤(設定キー、型ミラー、ロック付き設定書き込み)

- [x] 2.1 `packages/spirits/src/constants.ts` に次を追加する: 専用コマンド名(`spirits-model` / `spirits-role` / `spirits-clear`)、custom entry 種別(`spirits_role` / `spirits_clear`)、status key(`spirits`)、設定キー `defaultThinkingLevel`、clear 用の固定 summary 文。確認: `rg -n "SPIRITS_COMMAND_|SPIRITS_ROLE_ENTRY_TYPE|SPIRITS_CLEAR_ENTRY_TYPE" packages/spirits/src/constants.ts` が 1 件以上
- [x] 2.2 `packages/spirits/src/types/pi-coding-agent.d.ts` に `registerCommand`、`ExtensionCommandContext`(`reload` を含む)、`ExtensionUIContext.setStatus`、`context` / `session_before_compact` / `session_compact` のイベントと結果、`ReadonlySessionManager.buildSessionProjection` / `getLeafId` / `getEntries`、`setModel` / `setThinkingLevel` / `getThinkingLevel` を追記する。確認: `cd packages/spirits && bun run check`
- [x] 2.3 `packages/spirits/src/commands/settings-store.ts` を実装する(`lockSync(path, { realpath: false })` を ELOCKED 再試行 10 回 20ms、ロック下で読み → 変更フィールドだけをマージ(nested は変更した下位キーのみ)→ `JSON.stringify(merged, null, 2)` → 解放)。パスは `getAgentDir()` 直下の `settings.json`。確認: `cd packages/spirits && bun test test/managed-commands.test.ts`
- [x] 2.4 同上のテストで (a) 存在しないファイルへの初回書き込み、(b) 空ファイル・BOM 付き・不正 JSON の扱い(不正 JSON は例外で、上書きしない)、(c) 独自キーと未変更キーが保持されること、(d) nested(`models`)は変更した下位キーだけが上書きされること、(e) Pi の `SettingsManager` と交互に書いて双方のキーが残ること(実 `SettingsManager` を使う)、(f) 別プロセス 2 つとの同時書き込みで JSON が解析でき両側のキーが残ること、を確認する(spec `managed-commands` / 設定の書き込みは Pi と同じロック手順で行う)

## 3. commands 層: 登録の可否と `/spirits-model`

- [x] 3.1 `packages/spirits/src/commands/register.ts` に `registerManagedCommands(pi, deps)` を置き、`registerDualModelRouting` の `roleApi` が `false` のときだけ呼ばれる形にする。`false` のときのみ 3 コマンドが登録されること、`true` のときは 0 件であることを `test/managed-commands.test.ts` で確認(spec `managed-commands` / managed 限定のコマンド登録)
- [x] 3.2 `packages/spirits/src/commands/model.ts` に引数解釈を実装する: 末尾の語が role、その直前が thinking level、残りが検索語。語順が逆(`<ref> <role> <level>`)の場合は検索語扱いになること、大文字小文字を区別しないこと、0 語・未知の語・曖昧な部分一致は「変更なし + 理由」にすること。`test/managed-commands.test.ts` で各ケースを確認(spec `managed-commands` / `/spirits-model` は 1 行でモデル、thinking レベル、role を選ぶ)
- [x] 3.3 対象の解決は `ctx.modelRegistry.getAvailable()` を使い、virtual model(`api === "pi-virtual"`)は除外する。解決できたときだけ `pi.setModel()` / `pi.setThinkingLevel()` を呼び、指定された fields を settings に保存して `await ctx.reload()` で締める(reload 後に `pi` / ctx を触らない)。`test/managed-commands.test.ts` で、適用・保存・reload 呼び出しの順と、解決失敗時に `setModel` / 書き込み / reload が走らないことを確認(spec `managed-commands` / `/spirits-model` と `/spirits-role` は選んだ値を既定として保存する、再読み込み之后に古いハンドルを使わない)
- [x] 3.4 `docs/architecture/convention-registry.md` の `registry:layers` に `spirits:commands`(`spirits:shared` / `spirits:routing` / `packages/coding-agent` を許可)と所属表(`packages/spirits/src/commands/`)を追加し、`spirits:entry` の許可先に `spirits:commands` を足す。確認: `cd packages/spirits && bun test test/architecture-conventions.test.ts`

## 4. commands 層: `/spirits-role`、role の永続化と badge

- [x] 4.1 `packages/spirits/src/commands/role.ts` に role の保存と読み取りを置く: 書込스는 `spirits_role` custom entry(`{ role }`)、読み取りは branch 上の最新の `spirits_role` を優先し、無いときだけ `pi.virtual-model-state` の最新の `role` を使う(片方向)。`pi.virtual-model-state` への追記・変更を行わないことを `test/managed-commands.test.ts` で確認(spec `managed-commands` / role は spirits 独自のセッション記録に保存し、fork の記録から片方向で引き継ぐ、専用 entry が優先される、fork から引き継ぐ、どちらも無い)
- [x] 4.2 `/spirits-role` の挙動: `normal` / `strong` は位相のロック + entry + `models.role` の保存 + badge 更新、引数なし・解釈不能は変更なしで現在の値を通知。`test/managed-commands.test.ts` で確認(spec `managed-commands` / `/spirits-role` はモデルを変えずに role をロックする、引数なしは表示だけ)
- [x] 4.3 badge: `ui.setStatus("spirits", "[<role>]")`。制御文字と改行を除去し、空になったら設定しない。`session_start`(保存値)、route が決まったとき、`/spirits-role` の 3 点で更新する。`test/managed-commands.test.ts` で確認(spec `managed-commands` / role badge は拡張の status 行に出す、制御文字を含む role は描画しない、strong で走ったあとは strong を出す)
- [x] 4.4 `registerDualModelRouting` に route が決めた role を伝える口を追加し(`onRole` 相当)、`index.ts` で commands 層へ渡す。`routing` 層が `commands` 層を import しないことを確認: `rg -n "from \"../commands" packages/spirits/src/routing` が 0 件

## 5. commands 層: `/spirits-clear`

- [x] 5.1 `packages/spirits/src/commands/clear.ts` に境界の追記を実装する: `spirits_clear` custom entry を追記し、直前の境界が leaf 以降に無いときだけ追記する(連続実行で entry を増やしすぎない)。セッション ID と session ファイルは変更しない(`newSession()` を使わない)。実 `SessionManager` を使い、コマンドを 2 回実行しても entry は 1 件だけで session ID が変わらないことを `test/managed-commands-clear.test.ts` で確認(spec `managed-commands` / `/spirits-clear` は区切りより前の会話を LLM 文脈から外す)
- [x] 5.2 `context` フィルタを実装する: 境界 index 以前の entry が生む projection messages のうち `role !== "system"` の数 `drop` を求め、`0 < drop < event.messages.length` のときだけ `slice(drop)` を返す。`drop` がリスト長以上になった場合は何も返さず素通しする(前の `context` handler が会話を削ったあとで slice すると、境界より後の会話まで切り捨てられ、0 件なら会話なしのプロンプトになる)。system message を数えないことで pi の prompt/tool loadout entry を落とさないことを、pi の実 `SessionManager` と `buildSessionProjection()` を使う `test/managed-commands-clear.test.ts` で確認(spec 同上)
- [x] 5.3 単体テストで (a) 会話 0 のクリア(エラーなし)、(b) 1 往復のクリア(次の要求から以前の会話が消える)、(c) 2 回連続のクリア、(d) TODO / goal / memory の custom entry がそのまま残る、(e) モデルと thinking level が変わらない、を確認する(spec 同上、短い会話でも効く、続けて 2 回実行する、TODO と goal は残る)。`test/managed-commands-clear.test.ts`(実 `SessionManager`)。chat 表示そのものは単体では読めないので、(f) は専用 Pi の観測(`same-session-id` と、session ファイルが全 message entry を保つこと)で替える
- [x] 5.4 `session_before_compact` の肩代わりを実装する: pi が要約する範囲に、境界より前で消された会話が残っているときだけ `{ compaction: { summary: <固定注記>, firstKeptEntryId: <境界 id>, tokensBefore } }` を返し、残っていなければ素通す。範囲は `buildSessionProjection()` のうち最新 compaction の後から `preparation.firstKeptEntryId` までとし、境界の位置だけでは判定しない(境界より前に消すべき会話が無いセッションまで引き取ると、本来の要約を 1 個失わせ、要約が捨てるはずだったメッセージを全部 keep する)。固定注記にクリアした会話を含まないこと、および素通しの 3 ケースを実 pi セッションで `test/managed-commands-clear.test.ts` を使い確認(spec `managed-commands` / 自動 compaction はクリア済みの会話を文脈に戻さない、区切りより後の要約は邪魔しない、消された会話が後ろに無い区切りでも邪魔しない)
- [x] 5.5 resume 後にも効くことを専用 Pi 実測で確認する(§7)。単体では「境界 entry が branch に残れば効く」ことまでを検証する

## 6. managed 経路の環境変数と docs

- [x] 6.1 `packages/spirits/src/managed-pi/environment.ts` から `PI_APP_NAME` / `PI_CONFIG_DIR` の設定を削除し、`constants.ts` の対応する定数とコメントも整理する。`test/managed-pi-env.test.ts` を更新し、組み立てた環境に両キーが含まれないこと(親に有っても引き継がないまたは無視されることを明記)、`SPIRITS_CODING_AGENT_DIR` / session dir / `PI_PACKAGE_DIR` / `PI_SKIP_VERSION_CHECK` の固定、`PI_TELEMETRY` の既定、API キーと proxy の保持が変わらないことを確認(spec `managed-pi` / 継承環境と session dir の sanitize、identity の overlay 一本化)
- [x] 6.2 新規 `docs/spirits-upstream-issues.md` に PA(`ExtensionContext.modelRuntime`)と PB(`clearConversation`)の issue 下書きを書く(投稿しない)。本文は問題・再現手順・提案・フォーク実装の規模・`createAgentSession` が既に `modelRuntime` を取るという対称性の根拠を含む。確認: `rg -n "^## " docs/spirits-upstream-issues.md` が 2 件以上
- [x] 6.3 `docs/spirits-managed-pi.md` に `/spirits-model` / `/spirits-role` / `/spirits-clear` の目的と、既定経路との差(コマンド名、badge が footer の拡張 status 行であること、チャット表示は消えないこと、公式 `/model` 行との非統合)、公式バイナリの Pi 帰属表示を受け入れること、第三者拡張の provider を rlm の子で使えないこと、`/spirits-clear` 直後は使用量表示と自動 compaction の閾値がクリア前を引きずることを追記する。確認: `rg -n "spirits-clear|spirits-model|spirits-role" docs/spirits-managed-pi.md` が 6 件以上
- [x] 6.4 `docs/spirits-m3-rlm.md` の既知の制約に第三者拡張の provider が子の対象にならない旨が既にあるか確認し、無ければ追記する。確認: `rg -n "第三者拡張" docs/spirits-m3-rlm.md` が 1 件以上

## 7. 互換性ランナー: 9 目的の再定義と専用 Pi での観測

- [x] 7.1 `scripts/managed-pi-compat/matrix.ts` の `PURPOSE_DEFINITIONS` を managed 側の実現方式に合わせ、`currentMechanism` / `alternative` / `difference` を更新する。状態語彙は既存の 4 状態(`available` / `limited` / `unavailable` / `not-run`)のまま新語を足さない。確認: `cd packages/spirits && bun test test/managed-pi-compat-matrix.test.ts`
- [x] 7.2 `scripts/managed-pi-compat/fixtures/probe-extension.ts` に `/spirits-*` の観測用コマンドを追加する(設定書き込み後の読み戻し、role entry の読み取り、境界の前後の session state)。確認: 同上のテスト、および §7.5 の official 実行
- [x] 7.3 `scripts/managed-pi-compat/run.ts` で、専用 Pi 上に `/spirits-role`、`/spirits-model <ref> <level> <role>`、`/spirits-clear` を実際に送って 9 目的を観測するよう更新する。代替で満たした目的は detail に `alternative` を含める。clear は「境界より前のマーカーが次の要求に含まれない」ことを fake provider の要求本文で判定する。確認: `bun scripts/managed-pi-compat/run.ts --help` が通り、§7.5 の結果 JSON に 9 目的の状態と detail が入る
- [x] 7.4 `scripts/managed-pi-compat/evidence.ts` の `role/clear/model matrix` の証拠文を新しい観測方法に更新する。確認: `cd packages/spirits && bun test test/managed-pi-compat-result.test.ts`

## 8. 検証と証拠

- [x] 8.1 `cd packages/spirits && bun test` 全体。failure 0 件を確認
- [x] 8.2 `cd packages/spirits && bun run check`、および repo root で `npm run check`(biome / tsc / pinned deps / entry graphs)。全 error・warning・info を消す
- [x] 8.3 clean な worktree で `bun scripts/build-managed-pi-inputs.ts` から bundle と manifest を生成し、互換性ランナーを official mode で 1 回走らせて `evidence/official-compat-result.json` に保存する。9 目的のうち observed の数と available / limited の内訳、`role-badge` と `thinking-level` が `limited` である理由を報告に記録する。compaction・fork・`/tree`・resume の目的はこのランナーは観測しない(実装前の前提確認 `evidence/precondition-results.json` だけが根拠)
- [x] 8.4 fork 経路: `evidence/data-compat-probe.ts` の fork 実行で、fork バイナリが `spirits_role` と managed の書いた settings を読み、`/spirits-*` を登録しないことを 1 回確認し、使った fork バイナリの SHA256 を記録する。role suffix 付き `/model` と core `/clear` の fork 経路そのものの実測は行っていない(観測したのは role 語彙の読み書きとコマンド一覧だけ)
- [x] 8.5 データ互換: `scripts/agent-data-compat/run.ts` 本体ではなく `evidence/data-compat-probe.ts`(同じ fork バイナリ・同じ公式 artifact・fake provider を使う最小 probe)を走らせ、managed が保存した settings と role を fork が読めること、および fork が書いた `pi.virtual-model-state` の role を managed が引き継ぐことを確認する(12 項目)
- [x] 8.6 証拠を redact して `evidence/` に保存する(official result.json と要約、fixture 要約、fork 経路 JSON、data-compat の該当項目)。`rg -n "sk-|Bearer |api_key|AKIA" evidence --glob '!README.md'` が 0 件であることを確認する

## 9. コミット分割

- [x] 9.1 commit 1: `openspec/changes/add-managed-spirits-commands/{proposal,design,specs,tasks}` + `evidence/precondition-*`(前提確認の結果)
- [x] 9.2 commit 2: 実装・テスト・ハーネス・docs(`git add` は明示パスのみ)
- [x] 9.3 commit 3: 互換性ランナー・fork 経路・データ互換の証拠
- [x] 9.4 archive と push は行わない

## 10. archive 前の独立検証で出た指摘への対応

- [x] 10.1 `specs/managed-pi/spec.md` の MODIFIED 要件「継承環境と session dir の sanitize」から既存シナリオ「identity の継承値」が落ちていたのを復元する(overlay 一本化の内容に合わせた THEN 文で)。確認: `openspec validate add-managed-spirits-commands --strict` が exit 0
- [x] 10.2 `commands/register.ts` の `context` handler を `drop >= event.messages.length` で素通しに変更する(spec の `0 < drop < event.messages.length` と同じ条件)。確認: `test/managed-commands-clear.test.ts` 「a list shorter than the boundary is handed back untouched」
- [x] 10.3 `commands/clear.ts` の compaction 引き取りを「その要約範囲に消された会話が実際に残っているか」の判定に変更する(`event.branchEntries` の位置と `buildSessionProjection()` の対応は entry id で取る)。確認: 同上「a boundary with nothing cleared behind it leaves the summary to pi」他 3 件
- [x] 10.4 `index.ts` で中核でない機能(routing・専用コマンド・header)を 1 機能ずつ開始し、失敗時はその機能だけ落として次へ進む `optional` / `attempt` を入れる。通知は session start で 1 回だけ。routing が無い場合の位相は `fallbackRoutingPhase`(保存済みの既定 role + lock)で `rlm` に渡し、物理モデルを選ぶ親の挙動は変えない。badge の更新失敗は route 側で受け止める。spec `managed-pi` / 中核でない機能の失敗は中核に伝播しない。確認: `test/extension-degradation.test.ts` 6 件
- [x] 10.5 `docs/spirits-managed-pi.md` に次を追記する: 区切りより前の entry が `getContextUsage()` の推算と自動 compaction の閾値に残ること(実測値入り)、`/tree` で境界より前に移ったときと fork 経路で開き直したときの影響、互換性ランナーの role / clear / model 観測の説明を今の実装(`/spirits-*` と fake provider の受信本文)に合わせる
- [x] 10.6 タスク 8.3 / 8.4 / 8.5 の文言を実際に走らせた範囲に合わせる(fork 経路は probe にとどまる、`scripts/agent-data-compat/run.ts` 本体は走らせていない、compaction / fork / `/tree` / resume はランナーの観測対象外)

## 実測結果(§8)

- 8.1 `cd packages/spirits && bun test` → 864 pass / 0 fail(96 files)。
- 8.2 `cd packages/spirits && bun run check` と repo root の `npm run check` → ともに exit 0(biome、pinned deps、runtime deps、ts-imports、entry graphs、install-lock、tsc、browser smoke)。
- 8.3 official mode → `confirmed=29 limited=0 unavailable=0 not-run=3 failed=0`、`compatibilityMet=true`、`runnerProvenance.clean=true`(commit `5d1b0a09d`)。9 目的の内訳は available 7、limited 2(`role-badge` は拡張 status 行、`thinking-level` は pi の `/model` ピッカー非経由)、unavailable 0、not-run 0。結果は `evidence/official-compat-result.json`。
- 8.4 fork 経路 → `evidence/data-compat-probe.ts` の fork 実行(`dist/spirits-linux-x64`、SHA256 `6b26ddc0dd445350ec552d8a11be80baea5fbca2b72ca135fb761f770ace00f6`)。`/spirits-*` は登録されず、`pi.virtual-model-state` を自分で書き、managed が書いた settings と `spirits_role` entry を読んで応答する。
- 8.5 データ互換 → `evidence/data-compat-results.json` 12/12 pass。fork が書き込んだ role を managed が継承して strong で振り分け、managed が保存した `defaultProvider` / `defaultModel` / `defaultThinkingLevel` / `models.role` を fork が解決し、未知キー(`spiritsForeign`)と `models.strong` が双方の書き込みを越えて残る。
- 8.6 `rg -n "sk-|Bearer |api_key|AKIA" openspec/changes/add-managed-spirits-commands/evidence` → 0 件。

`scripts/agent-data-compat/run.ts` そのものは fork 側の全項目を観測する別変更の手順で、本项目が要求する settings / role の双方向読み書きは `evidence/data-compat-probe.ts` に絞った(同じ fork バイナリ、同じ公式 artifact、fake provider を使う)。

単体テストは §2〜§5 の項目を次の 3 ファイルに分けた。上記の各項目はそのテスト名に対応する。

- `test/managed-commands.test.ts` … 引数文法、設定ファイル、badge、コマンド登録の分岐(テスト dub で足りるもの)
- `test/managed-commands-clear.test.ts` … 境界の数え上げと compaction の引き取り(実 `SessionManager` と `buildSessionProjection()` を使う)
- `test/extension-degradation.test.ts` … 中核でない機能が失敗したとき中核が残ること、通知が 1 回であること
