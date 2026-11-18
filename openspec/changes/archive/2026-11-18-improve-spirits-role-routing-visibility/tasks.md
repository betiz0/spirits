# Tasks

## 1. テスト基盤

- [x] 1.1 `packages/spirits/test/routing/fake-pi.ts` の `fakeCatalog` に `scopedModels` と、応答と待ちを指定できる `ui.select` の stub (呼ばれた title・選択肢・timeout を記録し、指定した値・指定時刻の Esc・`signal` の abort による `undefined`・例外のいずれかを返す) を足し、`model_select` と `thinking_level_select` の payload を作る factory を足して、`cd packages/spirits && bun test test/routing-register.test.ts test/managed-commands.test.ts` が既存のまま通ることを確認

## 2. badge の語彙と状態の射影

- [x] 2.1 `packages/spirits/src/constants.ts` に振り分けが無効であることを示す語、応答するロールが無いことを示す語、ロール表示と応答モデル表示の 2 つの status key、応答モデル表示の桁上限 24、ステップ開始時の確認の待ち時間 10 秒と時間切れを判定する自前のタイマーを早める幅 100 ミリ秒、振り分け用モデルかどうかを provider と ID で判定する関数を追加し、`packages/spirits/test/constants-steps.test.ts` に key の重複がないこと・2 つの key の昇順・綴りを検査するケースを足して `cd packages/spirits && bun test test/constants-steps.test.ts` が通ることを確認
- [x] 2.2 `packages/spirits/src/commands/register.ts` の `isPhysicalSelection` と `packages/spirits/src/routing/child.ts` の provider/ID の比較を 2.1 の判定関数に置き換え (child の api の判定は残す)、`cd packages/spirits && bun test test/managed-role-status.test.ts test/routing-child-model.test.ts` が通ることを確認
- [x] 2.3 `packages/spirits/src/commands/role.ts` の badge 組み立てを、ロール名・要求する thinking レベル・振り分け無効・応答の無い 4 状態を返す形へ直し、`packages/spirits/test/managed-commands.test.ts` の `the badge prints the role on one line…` ケースを `[strong high]`・レベル解決不能時の role のみ・`[off]`・`[!]`・制御文字の除去で置き、同テストが通ることを確認
- [x] 2.4 設定・位相・セッションのモデルから badge の値へ落とす導出を `packages/spirits/src/commands/role.ts` の 1 関数に置き、一覧と status が読む解決と同じ結果になることを `packages/spirits/test/managed-role-panel.test.ts` と `packages/spirits/test/managed-role-status.test.ts` の既存ケースに同じ GIVEN を足して突き合わせ、不一致が 0 件のことを確認。badge の入力型は `resolveRequestPlan` の入力 (`RequestPlanInput`) から派生させ、`previous` の形だけを差分にして、入力の追加が 2 か所に増えないようにする

## 3. 描画の一元化とホストの状態変化の購読

- [x] 3.1 `packages/spirits/src/commands/register.ts` のセッション開始・分岐移動・ロック・`/spirits-clear` の badge 描画を 2.4 の導出呼び出しに置き換え、`packages/spirits/test/managed-commands.test.ts` の `the session start shows the lock the phase carries` を「物理モデル選択中は `[off]`、振り分け用モデル選択中は解決したロール」の 2 ケースへ差し替えて通す
- [x] 3.2 `packages/spirits/src/commands/register.ts` で `model_select` と `thinking_level_select` を購読して描き直し、`packages/spirits/test/managed-commands.test.ts` に物理モデルへ切り替えて `[off]` になるケースと、セッションの thinking レベルの変更で要求レベルが従うケースを追加して通す
- [x] 3.3 `input` での描き直しを `packages/spirits/src/commands/register.ts` の `input` ハンドラに置き (routing の入力処理より後に登録される)、登録順を入れ替えると落ちるケースと、strong の provider の資格情報が消えた後の idle 入力で normal の解決へ描き直すケース (`解決が変われば次の入力で badge が従う`)、別プロセスが書き換えた設定が再読み込みの前は効かず後に効くケース (`手で編集した設定は再読み込みから badge に効く`) を `packages/spirits/test/routing-integration.test.ts` に追加して通す
- [x] 3.4 `packages/spirits/src/index.ts` の badge への role 報告 (`onRole`) の配線を外して直近リクエストの供給 (`onRequest`) だけを残し、badge の綴りを pin している既存の期待値 (`managed-commands.test.ts:115,135,147,159`、`managed-role-panel.test.ts:896,924,947`、`routing-integration.test.ts:82,86`、`routing-phase-reload.test.ts:188,214,410,414`) を新しい綴りへ更新して、4 ファイルのテストが通ることを確認
- [x] 3.5 `packages/spirits/src/commands/register.ts` で `agent_settled` を購読して badge を描き直し、非継続ステップが settle で終わった後に badge がロックの解決へ戻ることを `packages/spirits/test/routing-integration.test.ts` に追加して通す (シナリオ `settle した非継続ステップの badge はロックへ戻る`)
- [x] 3.6 thinking レベルが変わらず `thinking_level_select` が発火しない操作でも badge が正しいままであることを `packages/spirits/test/managed-commands.test.ts` に追加して通す

## 4. 応答する物理モデルの表示

- [x] 4.1 射影から応答モデルの表示を作り、2 つの status key がロール表示→応答モデルの順で並ぶことを `packages/spirits/test/routing-integration.test.ts` で `statuses` の並びとして pin し、strong の対象が使えないときに `/opsx-propose` の run でロールの表示が normal、応答モデルの表示が normal の対象になるケース (`strong が落ちれば応答モデルも従う`) を同じファイルに追加して通す。starter は `slashCommandInfo` の source を `prompt` か `skill` と明示し、先にステップが strong に入ったことを確認してから解決を比較する
- [x] 4.2 provider を除いたモデル ID を 24 文字 (超過時は先頭 23 文字 + `…`) で省略する表示を実装し、23・24・25・26 文字、provider 付きの長い ID、空白を含む ID の境界を `packages/spirits/test/managed-commands.test.ts` に追加して通す
- [x] 4.3 振り分けが無効なときと `[!]` のときに応答モデルの表示を消し、物理モデルから振り分け用モデルへ切り替えた後に再表示することを `packages/spirits/test/routing-integration.test.ts` に追加して通す
- [x] 4.4 2 つの key の書き込みを独立させ、片方の key の `ui.setStatus` が例外を投げてももう片方が描かれリクエストがルートされることを `packages/spirits/test/extension-degradation.test.ts` に追加して通す

## 5. セッションの開始でロックと継続中のステップを戻す

- [x] 5.1 `packages/spirits/src/commands/register.ts` の `session_start` で、再読み込み以外の開始に `{ step: null }` を追記する処理を外し、新規以外のすべての開始で分岐の記録から継続中のステップを戻す。ただし再読み込み以外の開始では、記録が開いたままの継続しないステップ (`continuing: false`) は戻さない (`routing/phase.ts` の `beginSession` は、再読み込み以外では実行中のステップを記録を追記せずにメモリ上だけで外す形に直す。同じプロセスで `/resume` したとき、開く前のセッションのステップの終わりが開いたセッションに追記されないようにするため)。`packages/spirits/test/routing-phase-reload.test.ts` の `a resume drops the step` を「復帰でも継続中のステップを戻す」に、`a reopened session restores no step on the next reload (${reason})` を「開いた時点で戻し、再読み込みの後も同じ・記録を追記しない」に差し替え、`/spirits-clear` で終えたステップは復帰でも戻らないケースと、`sprt-opsx-verify-deep` の run の途中で閉じたセッションを復帰するとステップが戻らず normal で走るケース (`run の途中で閉じた継続しないステップは復帰で戻さない`) を追加して通す。棄却をメモリ上だけで外すと後の再読み込みで復活するため、永久記録の扱いは 5.3 で直す
- [x] 5.2 復帰したセッションでロックと継続中のステップが戻り、badge がその解決 (strong) で描かれ、最初の idle 入力が strong の対象へルートすることと、分岐 A/B 間の移動で badge と次のリクエストのロールが従うことを `packages/spirits/test/routing-phase-reload.test.ts` に追加して通す。`new` の開始ではステップが消えることを既存の `a new session with no records takes the configured default` と並べて確認し、記録が無く既定ロールが strong のセッションでロックが strong になることが同じケースで固定されていることを確かめる (managed-commands の `どちらも無ければ既定ロール`)
- [x] 5.3 `packages/spirits/src/routing/phase.ts` と `packages/spirits/src/commands/register.ts` に、再読み込み以外の開始で棄却した継続しないステップの記録を追記する経路を足し、復帰の後に fresh runtime で再読み込みしてもそのステップが戻らないことを `packages/spirits/test/routing-phase-reload.test.ts` に追加して通す (シナリオ `棄却した継続しないステップは再読み込みでも戻さない`)。継続中のステップを戻す開始では記録を追記しない

## 6. 一覧の振り分け無効時の説明

- [x] 6.1 一覧のスナップショットに現在のモデル (`provider/id`) を増やし、振り分けが無効なときはすべての行の説明の先頭に無効であることと現在のモデルが述べるように `packages/spirits/src/commands/role-panel.ts` を直し、`packages/spirits/test/managed-role-panel.test.ts` のロックの行・ロールのモデルの行・ステップの行の各ケースで先頭に出ることを確認。あわせて `modelChoices` をセッションのスコープで交差させる処理を入れない (候補の制限は 6.5 で除去する)
- [x] 6.2 応答モデルの記述を仮定法へ切り替え、同じ GIVEN で振り分けが有効だったときの解決 (モデルと thinking レベル) と一致することを確認するケースを `packages/spirits/test/managed-role-panel.test.ts` に追加して通す
- [x] 6.3 行の説明を「無効の旨と現在のモデル → 保存の失敗 → 警告 → 応答モデル」の順に組み立て、振り分けが働いていない旨がロックの行と `strong` のモデルの行のそれぞれで 1 度だけ出ること、スコープの診断が一覧に出ないことを `packages/spirits/test/managed-role-panel.test.ts` に案内文のカウントとして追加して確認。現状は保存済みの対象がスコープ外である旨を出しており、この検査を満たしていない
- [x] 6.4 物理モデル選択中にロックの保存が失敗したとき、ロックの行が strong を示し badge が `[off]` であるケースを `packages/spirits/test/managed-role-panel.test.ts` に追加して通す
- [x] 6.5 `packages/spirits/src/commands/role-panel.ts` の `selectableModels`、`packages/spirits/src/commands/register.ts` の `modelChoices` への適用、および一覧のスコープ外診断を取り除き、ロールの対象の候補がセッションのモデルスコープで制限されないこと、スコープが `spirits/auto` だけでも物理モデルの候補と `unset` が残ることを `packages/spirits/test/managed-role-panel.test.ts` に追加して通す (シナリオ `一覧の候補はセッションのスコープで制限しない`)
- [x] 6.6 spec の「badge は解決した応答ロール」「行の値はロック」をテストで分離し、strong の対象が使えずロックの保存が失敗したときはロックの行が strong・badge が `[normal]`、strong の対象が使えるときだけ `[strong low]` になることを `packages/spirits/test/managed-role-panel.test.ts` に追加して通す

## 7. status と警告の手順を実行可能にする

- [x] 7.1 `status` に現在のセッションのモデル名 (`provider/id`) を出し、`packages/spirits/test/managed-role-status.test.ts` の `reports routing disabled on a physical model` にモデル名の期待を足して通す
- [x] 7.2 振り分け用モデルを名指す手順文を `packages/spirits/src/commands/role.ts` の 1 関数で作る。セッションのスコープ集合が非空かつ振り分け用モデルを含まないときはその事実を出し、`ctx.mode === "tui"` のときだけ selector の選択範囲の切り替えとモデルのスコープ設定の操作を名指す。スコープ有・無 × tui・rpc の 4 ケースを `packages/spirits/test/managed-role-status.test.ts` に追加して通す。非対話の分岐では `enabledModels` などの設定ファイル編集も名指さない
- [x] 7.3 設定時警告 (`roleSettingWarning`) を 7.2 の関数で組み立て、ハードコードした振り分け用モデルの綴りと未使用の `routingModel` 引数を無くし、`packages/spirits/test/managed-role-warning.test.ts` の文言ケースをスコープ有・無と tui・rpc で更新して通す。非対話のスコープ外で設定ファイルの操作を要求する期待値は、事実だけを要求する形へ直す
- [x] 7.4 `routingModelGuide` の非対話・スコープ外の分岐から `enabledModels` の編集手順を外し、status と設定時警告のどちらにも設定ファイルの操作が出ないことを `packages/spirits/test/managed-role-status.test.ts` と `packages/spirits/test/managed-role-warning.test.ts` で検査する

## 8. ステップ開始時の確認

- [x] 8.1 `packages/spirits/src/routing/phase.ts` に、直前の入力で変えたステップを入力前の状態へ戻す操作を足し (戻した結果をステップの記録として追記する)、`packages/spirits/test/routing-phase.test.ts` に「別のステップが継続中」「ステップなし」の 2 つの入力前の状態から戻すケースと、記録が入力前と同じになるケースを追加して通す
- [x] 8.2 `packages/spirits/src/commands/register.ts` の `input` ハンドラで、`ctx.mode === "tui"`・入力の `source` が `interactive`・振り分け無効・ステップが入力で開始し期待されるロール (明示のロールか thinking の設定、または既定ロール) があるときに、7.2 の手順文を本文に「続行」「中止」の `ctx.ui.select` を 2.1 の待ち時間で出す。`packages/spirits/test/routing-integration.test.ts` に、確認が出て本文に手順がある・既定ロールのステップでも出る・期待されるロールが無ければ出ない・開始のたびに出る・振り分けが有効なら出ない・rpc では出ない・`source` が `extension` の入力では出ない、の 7 ケースを追加して通す
- [x] 8.3 8.2 の確認の結果を扱う。`select` に待ち時間の `timeout` と、2.1 の幅だけ早く発火する自前のタイマーで abort する `signal` を渡し、自前のタイマーの後の `undefined` を時間切れ (続行)、それより前の `undefined` を Esc (中止) とする。「中止」と Esc では `{ action: "handled" }` を返して 8.1 の操作でステップを入力前に戻し、`select` が例外を投げたら待たずに続行する。`packages/spirits/test/routing-integration.test.ts` に、時間切れで続行・「続行」で続行・「中止」で入力前に戻り再読み込み後も同じ・3 秒後の Esc で中止・自前のタイマーの発火直後の閉じは時間切れ・`select` の例外で続行、の 6 ケースを追加して通す。中止後の再読み込みは fresh runtime を記録から配線して検査する (同じ phase の使い回しでは復元を検査できない)
- [x] 8.4 確認の rollback を入力ごとの token と位相・分岐の世代で限定し、確認待ちの間に拡張入力が別のステップを開始した場合と分岐を移動した場合に、中止が現在の状態や移動先の記録を書き換えないことを `packages/spirits/test/routing-integration.test.ts` に追加して通す

## 9. 文書

- [x] 9.1 `README.md`、`README.ja.md`、`README.zh.md`、`README.de-CH.md` の badge の段落を、状態の射影であること・`[off]` と応答モデルの表示・振り分けが有効なセッションでのみロールを出すこと・ステップ開始時の確認・開き直したセッションで継続中のステップが戻ることに更新し、`rg -n "\[normal\]|\[strong\]" README*.md` が badge の説明として古い記述 (直近のリクエストの履歴) を出さないことを確認。あわせて `/reload` でセッションのロックが既定へ戻るという記述を、role 記録から戻る実装に合わせる
- [x] 9.2 `docs/spirits-managed-pi-design.md` の role badge の行を新しい表示面 (ロール表示と応答モデル表示の 2 key) に更新し、設定ファイルを手で編集した場合が拡張の再読み込みから効く旨と、セッションの開始で継続中のステップを戻す旨を同じ文書に追記して、`rg -n "setStatus|resume|復帰" docs/spirits-managed-pi-design.md` で記述が新旧どちらにも矛盾しないことを確認。`{ step: null }` を追記するのは再読み込みのときだけという記述は誤りなので、開始は記録を追記しないこと、棄却した継続しないステップだけは記録を追記することを書く。あわせて `docs/spirits-managed-pi.md` のセッション開始でステップが終わるという記述も直す
- [x] 9.3 「専用コマンドの表面の違いを文書に残す」が対象にする文書に、振り分け用モデルを選ぶには model selector の選択範囲の切り替えまたはモデルのスコープ設定が必要になる場合があること、その案内とステップ開始時の確認は対話端末だけで出ることを追記し、記載した操作名がホストに実在することを `rg -n "scoped-models" packages/spirits/node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js` で確認。現状は非対話の案内が `enabledModels` の編集を名指しており、この記述と実装が一致していない

## 10. 統合確認

- [x] 10.1 リポジトリルートで `bun run check` を実行し、報告 0 件を確認
- [x] 10.2 `cd packages/spirits && bun test` を実行して全テストが通ることを確認
- [x] 10.3 `bash scripts/test-clean-env.sh` で CI と同じ環境 (`PI_*` / `SPIRITS_*` を降ろした状態) でも suites が通ることを確認
- [x] 10.4 `scripts/tmux-verify.sh run --session <name> -- <binary>` と `scripts/tmux-verify.sh check` で、物理モデル選択時に `[off]`、`/model` で振り分け用モデルへ切り替えた後にロール表示と応答モデル表示が出ること、物理モデル選択中に strong 設定のステップを送ると 10 秒のカウントダウン付きの確認が出て時間切れで進むこと、Esc で閉じると入力が送られないこと、確認の待ちの間に別の入力を送ったときとセッションを切り替えたときのホストの扱い (design の Open Questions)、継続中のステップのまま閉じたセッションを `--resume` で開くと badge がそのステップの解決で出ることを実際の footer で観察し、待ちの扱いの観察結果を design の Open Questions に書き戻す
- [x] 10.5 `openspec validate improve-spirits-role-routing-visibility --strict` が通ることを確認

## Notes

- 2026-11-17 の深い検証 (verify2) の指摘を成果物へ反映した。badge をステップの終了時にも描き直す (3.5)、badge の入力型を plan の入力から派生させる (2.4)、復帰で棄却した継続しないステップを記録する (5.1 / 5.3)、一覧の候補をセッションのスコープで制限しない (6.1 / 6.3 / 6.5 / 6.6)、非対話の案内から設定ファイルの操作を外す (7.2 / 7.3 / 7.4)、確認の rollback を入力と世代で限定する (8.3 / 8.4)、starter の `source` を明示した fallback のテスト (4.1)、ロックと継続ステップの文書の記述 (9.1 / 9.2 / 9.3)。実装とテストは未修正で、該当タスクは未完了に戻した。

- ユーザーの依頼があってから specs を本仕様へ同期し、変更をアーカイブする (`openspec archive` は再適用で ADDED を重複させるため、同期はエージェント側で行う)。
- 振り分けを既定にしたい利用者のための導線 (design の Open Questions) は、必要なら別の変更にする。
