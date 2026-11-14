# Tasks

検証に使う `bun test <file> -t "<case>"` は、ケース名が 1 件にも当たらなかったり複数に当たったりすると失敗する(bun 1.4.2 は `regex "..." matched 0 tests` で exit 1)。だから検証に挙げるケース名は実在するものと同一にする。

チェックと検証の規則(d-verify3 の原因分析で追加。理由は末尾の「Workflow follow-up」の d-verify3 の項):

- チェックを付けてよいのは、そのタスクに書いた検証コマンドを 1 件ずつ実行し、すべて成功したときだけである。`bun test` 全体や `npm run check` の成功では代えない。全体の実行は、ここに書いた `-t` の名前を一度も照合しないからである。実装の報告には、タスクごとに実行した検証コマンドと結果を並べる。
- 新設するテストは、ここに書いた名前のとおりに作る。名前を変えるときは、同じ作業で tasks.md の名前も直す。
- シナリオを検証するテストは、そのシナリオの GIVEN と WHEN をそのまま入力にし、THEN の各項目をアサートする。近い別の操作や、構文解析だけのテストで代えない。テストのコメントにシナリオ名を書く。
- 一覧・status・`rlm` の子が出す解決結果(応答するモデル、thinking レベル)は、同じ条件でルーターが返す値と突き合わせて検証する。期待値を手で書くだけのテストは、実装者と同じ見落としを持つ。
- 対話 TUI の実観測(9.3)で解決結果を確かめるときは、行の文言だけで判定せず、実際に走らせたリクエストの値(ロックの行の `Last request: … at <level>`、`/spirits-role status` の last request)と突き合わせる。
- design の Risks の対策は、9.7 の表でどれかのタスクに対応させる。表に無い対策は実装されない。

d-verify4 の原因分析で追加した規則(理由は末尾の「Workflow follow-up」の d-verify4 の項):

- spec を変えたときは、同じ作業で、そのシナリオを扱うタスクを未完了に戻すか、新しいタスクを足す。そのうえで `scenario-coverage.md`(9.8)に行を足す。チェック済みのタスクしか無い状態で spec だけを変えると、次の apply はやることが無いと判断する。9.8 の検査は、対応の無いシナリオを機械的に見つける。
- 型検査は、CI(`.github/workflows/spirits-ci.yml`)と同じ `cd packages/spirits && bun run check` で行う。ルートの `npm run check` は `packages/spirits/**` を除外している(ルートの `tsconfig.json` の `exclude`)ので、spirits の型エラーを見ない。このファイルの検証にある「`npm run check` が型エラーなしで通る」は、どれも両方を実行する意味で読む。
- 失敗の注入は、ホストの境界(`FakePi` のメソッド。例: `pi.appendEntry`、`pi.getSettings`)で行い、本物の配線(`registerManagedCommands`、`registerDualModelRouting`)を通す。内部の依存(`RoleWriteDeps.lockRole` など)をまるごと置き換えると、実装の中の順序(`setRole` の後に `appendEntry`)が試されず、本当に失敗する場所を通らない。
- 要件の文が値の種類を列挙しているときは、種類ごとに 1 ケースを持つ。例: 記録がステップ名 / `null` / 記録なし / 一覧に無い名前 / 読み取れない値。似た種類を 1 ケースで代表させない。既存の関数を再利用するときは、その関数が想定外の値をどう扱うか(無視する / 終える / 投げる)が要件と同じかを確かめる。
- `src/routing/` にイベントハンドラや位相の処理を足すときは、managed 経路(`withoutRoleApi(new FakePi())`)とフォーク経路(`new FakePi()`)の両方でテストする。routing 層は両経路で共有されるので、managed 経路だけの記録を前提にした処理は、フォーク経路で壊れる。

## 1. 設定の形とステップ一覧

- [x] 1.1 `packages/spirits/src/constants.ts` にステップ一覧(名前・開始コマンド・ステップの既定ロール・継続するか)と新設定キー(`models.normal`、`models.thinking.normal`、`models.thinking.strong`、`models.steps`)を追加する。`STRONG_PHASE_SKILL_NAMES` は 3.1 で `phase.ts` から使い捨てるまで残す(今は `routing/phase.ts:13,70` が読む)。検証: `cd packages/spirits && bun test test/constants-steps.test.ts`(新設。spec の表と `STEP_DEFINITIONS` の一致、ロール名とステップ名の重複なしを検証)
- [x] 1.2 `commands/settings-store.ts` に、経路指定の多段マージとキー削除(`unset`)を新設する。既存の `patchSettingsFile` / `patchGlobalSettings` の `mergeFields` は 1 段マージ(`{ ...base, ...value }`)なので、`{models:{steps:{a:{…}}}}` を渡すと `models.steps` 以下が置き換わる。新関数は `models.steps.<name>.role` のような経路を受けて途中オブジェクトを複製しながら 1 キーだけ変え、削除は対象キーだけを消す。ファイルロックと Pi のキー保持の規則は既存のまま使う。検証: `cd packages/spirits && bun test test/managed-commands.test.ts -t "a step write keeps the sibling steps"` と `-t "unset deletes only the named key"`(新設ケース。既存の `a settings write keeps the keys it was not told about, including pi's own` も通す)
- [x] 1.3 `src/config.ts` の `RoutingSettings` に normal の対象・ロール別 thinking・ステップ設定を読み取り加え、型違い・空・語彙外を未設定にする。検証: `cd packages/spirits && bun test test/config.test.ts -t "unreadable routing settings fall back to unset"`(新設ケース)
- [x] 1.4 型ミラーを追加する。`src/types/pi-coding-agent.d.ts` に `ExtensionContext.mode`、`ctx.ui.custom()`、`pi.getCommands()`、`getArgumentCompletions` を、`src/types/pi-tui.d.ts` に `SettingsList` / `SelectList` の型を追加する(`pi-tui.d.ts` は既存の pi-tui 用スタブなのでこっちに置く)。検証: `npm run check` が型エラーなしで通る

## 2. ルーティングの解決

- [x] 2.1 `routing/resolve.ts` に `models.normal` の読み取りを追加し、`provider/id` と `id`(既定 provider 補完)を解決、型違い・空・virtual model を未設定扱いにする。検証: `cd packages/spirits && bun test test/routing-resolve.test.ts -t "resolves the configured normal target"`(新設ケース。既存の `resolves the default model as normal`、`skips a virtual default and falls back to the previous model` も維持)
- [x] 2.2 ロール別 thinking レベルの読み取りと、`off..max` の語彙解決を追加し、語彙外を未設定にする。検証: `cd packages/spirits && bun test test/routing-thinking.test.ts -t "role thinking level reads only known levels"`(新設)
- [x] 2.3 thinking レベルの解決順(ステップ → 実際に応答するロール → セッションの選択値)を実装し、strong が normal へ落ちたときに normal のレベルを使う。物理モデル選中は thinking レベルを変えない。検証: `cd packages/spirits && bun test test/routing-thinking.test.ts -t "strong fallback uses the normal level"` と `-t "leaves the level alone on a physical model selection"`(新設)
- [x] 2.4 ステップ設定(`models.steps.<name>` の role / thinking)を読み取り、一覧外の名前と不正値を無視する。ロールの優先順位はステップ設定 → ステップの既定ロール → ロックとする。検証: `cd packages/spirits && bun test test/routing-step-settings.test.ts -t "ignores an unknown step name"` と `-t "ignores a role that is not a word in the vocabulary"` と `-t "prefers the step role over the step default and the lock"`(新設)
- [x] 2.5 (d-verify3 で追加。C-1 の原因の除去、design D15)要求の解決を 1 つの副作用の無い関数にまとめ、ルーター・`rlm` の子・一覧が同じ関数を使う。
  - 入力: ステップ、設定、位相のロール、カタログ、セッションの thinking レベル、直近の成功レスポンス。
  - 返り値: 要求したロール、実際に応答するロール(strong が使えなければ normal)、応答するモデルとその出どころ、strong と normal の対象が使えなかったか、要求に載る thinking レベル(応答するロールで解決したもの)。
  - 通知・例外・`onResolved` はルーター側に残す。`createRoutingRoute`、`createChildModelResolver`、一覧のステップ行とロールの thinking 行(5.3)はこの関数の返り値だけを使い、構成要素の関数(`resolveRequestRole`、`resolveStrongTarget`、`resolveNormalTarget`、`resolveRequestThinkingLevel`)を自前で並べない。
  - 検証: `cd packages/spirits && bun test test/routing-request-plan.test.ts -t "the route, the child, and the panel agree on the model and the level"`(新設)と `-t "a strong fallback carries the normal level"`(新設)。
    - 前者は次の全組み合わせで、ルーターの戻り値、子の解決、一覧のステップ行の説明が同じモデルと同じ thinking レベルを示すことを確かめる: strong の対象 3 状態(使える / 未設定 / 設定済みで使えない)× thinking の設定 4 状態(なし / normal だけ / strong だけ / ステップに設定)× ロールの決まり方 3 状態(ステップ設定 strong / ステップの既定 strong / ロック normal)。一覧の期待値は、同じ条件のルーターの戻り値から作る(手で書かない)。
    - 後者は、strong 未設定、`thinking.strong=max`、`thinking.normal=low` でルーターと子が `low` を返すことを確かめる。
  - d-verify4 C-1: `cd packages/spirits && bun run check` が型エラー 3 件で失敗し、CI(`spirits-ci.yml`)が落ちる。
    - `src/routing/router.ts:79`: `RequestPlan.thinkingLevel` は省略可だが、`ModelRoute.thinkingLevel` は必須なので型が合わない。
    - `test/routing-request-plan.test.ts:101,153`: 結果を `thinkingLevel?: string` へキャストしているので、`ChildTarget` に渡せない。
    - 修正: ルーターは `thinkingLevel: plan.thinkingLevel ?? request.thinkingLevel` を返す(design D15 の「型の扱い」)。テストのキャストは `thinkingLevel?: ThinkingLevel` にする。型を緩めて合わせない。
    - 見落とした理由: 2.5 の完了時に実行した `npm run check` は、spirits を検査しない(冒頭の d-verify4 の規則 2)。
  - 検証: `cd packages/spirits && bun run check` が成功し、上の 2 件の `-t` も成功する

## 3. ステップの位相

- [x] 3.1 `routing/phase.ts` をステップ単位に書き換え、開始コマンド一致でステップを開始する。判定は `pi.getCommands()` の `name`(`source` が `extension` 以外。design V4)を使い、Pi がスキル・テンプレートとして展開しない入力では開始しない。名前の取り出しは Pi と同じ規則(スキルは `/skill:` の直後から最初の半角スペース、テンプレートは `/` の直後から最初の空白)。`STRONG_PHASE_SKILL_NAMES` をここで使い捨てて `constants.ts` から削除する。検証: `cd packages/spirits && bun test test/routing-phase.test.ts -t "starts a step from its starter command"` と `-t "does not start when pi would not expand the command"`(新設。既存の `enters strong for the change review skill command`、`enters strong for the deep verify skill command`、`ignores other skill commands and plain input`、`ends the skill name at the first space like pi` は新規則に合わせて更新)
  - d-verify2 W-1: テンプレートで始まるステップのテストが無い(`routing-phase.test.ts` の開始コマンドはすべて `source: "skill"`)。`{ name: "opsx-ff", source: "prompt" }` を渡し、`/opsx-ff` と `/skill:openspec-ff-change` が同じ `opsx-ff` ステップを開始すること(spec「テンプレートとスキルで同じステップ」)と、一覧に無いテンプレートの起動で継続中のステップが終わることを検証する。挙動は d-verify2 P7 で正しいことを確認済みで、テストだけを足す。
  - d-verify2 W-2: シナリオ「SKILL の読み取りだけでは遷移しない」を検証するテストが無い。input を送らずにリクエストを解決しても位相が変わらないこと(位相が未決定ならロックのロール)を検証する。
  - 検証: `cd packages/spirits && bun test test/routing-phase.test.ts -t "a template and a skill start the same step"` と `-t "an unlisted template ends the step"` と `bun test test/routing-phase-wiring.test.ts -t "reading a skill file without input changes no phase"`(新設)
- [x] 3.2 継続するステップを run settled 後も維持し、継続しないステップは settled でロックへ戻す。1 回のリクエストも解決ないうちに次の idle 入力を受けた継続ステップは終える。検証: `cd packages/spirits && bun test test/routing-phase.test.ts -t "a continuing step survives settle"` と `-t "a non-continuing step returns to the lock at settle"` と `-t "drops a continuing step whose run never started"`(新設。既存の `returns to normal on the next idle input when no run settled`、`keeps the phase on steer and follow-up input`、`returns to normal on settle regardless of abort` は新規則に合わせて更新)
  - d-verify1 C-13: 説明の無いアサーション削除を戻す。`test/routing-phase-wiring.test.ts` の `does not carry a strong phase into the next run when the skill run never started` に、ステップが始まったことの前提検証を `phase.step()?.name` で戻す(`role()` は route を呼んでリクエストを解決済みにするので使わない)。`test/routing-phase.test.ts` の `a lock set to normal releases a strong lock` から削った末尾 3 行(normal ロック後に strong 既定のステップを走らせ、settle で normal へ戻ること)と、削除したケース `enters strong for a target skill while locked on strong` を戻す。検証: `cd packages/spirits && bun test test/routing-phase-wiring.test.ts -t "does not carry a strong phase into the next run when the skill run never started"` と `bun test test/routing-phase.test.ts -t "a lock set to normal releases a strong lock"` と `-t "enters strong for a target skill while locked on strong"`
- [x] 3.3 ステップの終了条件を実装する。条件は 6 種: 別の開始コマンド、一覧に無いスキル・テンプレートの起動、`/spirits-clear`、ロールのロック、セッション開始(`startup` / `new`)、セッションの復帰・分岐作成(`resume` / `fork`)。検証: `cd packages/spirits && bun test test/routing-phase.test.ts -t "ends the step on a starter of another step"`、`-t "ends the step on a skill that is not listed"`、`-t "ends the step on clear"`、`-t "ends the step on a role lock"`、`-t "ends the step on a new session"`、`-t "ends the step on resume and fork"`(6 ケース)
- [x] 3.4 ロックと継続中のステップをセッション記録(`spirits_role` に加え `spirits_step` の custom entry)へ残す。`spirits_step` にはステップ名だけを書き、ステップが終わりるときは「ステップなし」の記録を追記する。`session_start` の reason が `reload` のときだけ復元し、`startup` / `new` / `resume` / `fork` では復元しない。検証: `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a reload keeps the continuing step"` と `-t "a resume drops the step"` と `-t "a reload after the step ended restores nothing"` と `-t "the badge and status match the phase restored across a reload"`(新設)。verify3: `-t "a reload keeps the continuing step"` に reload 後のリクエストのロール・モデル・thinking を追加し、`-t "a changed step setting reaches the next request after a reload"`(新設)で一覧相当の設定変更が reload 後のリクエストに効くことを検証する
  - d-verify1 C-4: 再読み込み後の badge を `current()`(ステップ既定 ?? ロック)ではなく、ステップ設定・ステップの既定ロール・ロックの順で解決したロールで描く(`commands/register.ts` の `session_start`。`resolveRequestRole(step, readSettings(), current())`)。ロック normal・`models.steps.opsx-propose.role = strong`・`opsx-propose` 継続中の reload で、現状は `[normal]` を描き、次のリクエストは strong へ行く。
  - d-verify1 W-3: `the badge and status match the phase restored across a reload` は名前に反して status を見ていないので、status の出力(ロックと現在のステップ)も検証する。
  - d-verify1 G-2: `restoreStep` が reload のたびに同じ `spirits_step` を追記しないようにする(復元は記録の変化ではない)。
  - 検証: `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a reload draws the badge from the step setting"` と `-t "a reload appends no step record"`(新設)と `-t "the badge and status match the phase restored across a reload"`
  - d-verify2 C-3: セッションの開始(`startup` / `new` / `resume` / `fork`)でステップの終了が記録されず、後の reload でステップが復活する。原因は `phase.beginSession` の `end()` がメモリ上のステップしか見ないこと。継続ステップの最中に終了したセッションを新しいプロセスで開くと、メモリにステップが無いので何も記録されない。その後に設定を変えて reload すると、`spiritsStepEntry` が古い `{ step: "opsx-propose" }` を読んで `restoreStep` する(d-verify2 P6 で 3 経路とも再現)。reload 以外の `session_start` で、ブランチの最新の `spirits_step` が null でなければ `{ step: null }` を追記する(design D12)。記録の無いブランチと、既に null で閉じたブランチには何も足さない。
  - 検証: `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a reopened session restores no step on the next reload"`(新設。`startup` / `resume` / `fork` の 3 経路を検証)と `-t "a start appends nothing to a branch with no open step"`(新設)。既存の `a reload appends no step record` も通す
- [x] 3.5 `routing/router.ts` の `spirits/auto` の解決に thinking レベル解決を接続し、解決できない場合は従来どおりエラーで終わらせる。`models.normal` が設定済みで使えないときは run ごと 1 回通知し、未設定なら無言にする。検証: `cd packages/spirits && bun test test/routing-router.test.ts -t "carries the resolved thinking level"` と `-t "notifies once per run when the configured normal target is unusable"` と `-t "stays quiet when normal is unset"`(新設ケース。既存の `routes normal outside a strong phase`、`routes the configured strong model during a strong phase`、`falls back to normal silently when no strong model is configured`、`falls back to normal and notifies once per run when the strong model is unusable`、`notifies once when falling back to the previous model`、`ends the request with an error when there is no normal target` は維持)
- [x] 3.6 `routing/child.ts` が親の run と同じ解決でモデルと thinking レベルを子へ渡す。検証: `cd packages/spirits && bun test test/routing-child-model.test.ts -t "the child takes the run's thinking level"`(新設ケース。既存の 13 ケースは維持)
- [x] 3.7 (d-verify3 で追加。W-2、利用者の決定: 移動先の記録に合わせる)分岐間の移動(`session_tree`、design V11)で、ステップを移動先の分岐の最新の `spirits_step` 記録に合わせる(design D12、spec「分岐間の移動ではステップを移動先の記録に合わせる」)。
  - 記録がステップ名なら継続中として復元する(`restoreStep` と同じく記録を足さない)。`{ step: null }` か記録なしならステップを終える。終えるときも記録を足さない(`end()` は終了の記録を追記するので使わない)。
  - ロックは変えない。badge は再読み込みのときと同じ解決(`badgeRole()`)で描き直す。
  - 誤動作の例: `/opsx-propose` → `/spirits-clear` → `/tree` で 2 つの記録のあいだへ移る → メモリにはステップが無いが、分岐の最新の記録は `opsx-propose` → 設定変更の reload で `opsx-propose` が復元される(`register.ts:331-334`)。移動の直後と reload の後で位相が変わる。
  - 検証: `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move follows the step record of the new branch"`(新設。spec のシナリオ「終えたステップの手前へ移る」を GIVEN / WHEN のとおりに操作し、移動の直後と reload の後のどちらでもステップが `opsx-propose` であること)、`-t "a tree move to a branch with no open step ends the step"`(新設。シナリオ「ステップの記録より前へ移る」)、`-t "a tree move appends no step record"`(新設)
  - d-verify4 C-3: 一覧に無いステップ名の記録へ移っても、移動前のステップが残る。
    - 原因: `followStepRecord` は名前を `restoreStep` に渡す。`restoreStep` は一覧に無い名前を無視する(何もしない)。
    - 例(d-verify4 P3): `opsx-propose` が継続中に、最新の記録が `opsx-teleport` の分岐へ移る。移動の直後は `opsx-propose`、reload の後は `none` になる。
    - 修正: 一覧に無い名前は、記録を足さずにステップを外す(design D12 の「記録の値の種類ごとの扱い」)。
  - d-verify4 C-4: フォーク経路で分岐を移動すると、継続中のステップが消える。
    - 原因: `session_tree` のハンドラ(`src/routing/register.ts:266-271`)を、経路にかかわらず登録している。フォーク経路は `spirits_step` を書かないので、移動先は常に「記録なし」と読まれる。
    - 例(d-verify4 P2): role API のあるホストで `/skill:openspec-propose` を走らせ、settle の後に `session_tree` を送ると、ステップは `undefined` になる。
    - 修正: `registerModelRoles` が無いときだけハンドラを登録する(design D12)。`test/routing-register.test.ts:186` の `expect(pi.handlersFor("session_tree")).toBe(1)` は、フォーク経路のハンドラの数を期待値にしているので、ステップが続くことの検証に置き換える。
  - d-verify4 W-1: シナリオ「移動の後に badge を描き直す」のテストが無い(挙動は d-verify4 P4 で正しいことを確認済み)。
  - d-verify4 W-3: 既存の 2 件(`a tree move follows the step record of the new branch`、`a tree move to a branch with no open step ends the step`)は `phase.step()` だけを見ている。シナリオの THEN(status の現在のステップ、リクエストのルート先)で検証する。「ステップの記録より前へ移る」は、記録の無い分岐(`/opsx-propose` を送る前のノード)を GIVEN にする。今の `{ step: null }` のケースは残し、記録の無い分岐のケースを足す。
  - 検証は、冒頭の規則どおり、spec のシナリオの GIVEN / WHEN を使い、記録の値の種類ごとに 1 ケースとする。
    - `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move to an unlisted step record ends the step"`(新設。シナリオ「一覧に無いステップ名の記録へ移る」。移動の直後と reload の後の両方の status が「なし」)
    - `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move to an unreadable step record ends the step"`(新設。`{ step: 42 }`)
    - `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move to a branch with no step record ends the step"`(新設。記録の無い分岐。移動の後のリクエストがロックのロールへルートされる)
    - `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move redraws the badge"`(新設。シナリオ「移動の後に badge を描き直す」。`statuses.get("spirits")` が `[strong]`)
    - `cd packages/spirits && bun test test/routing-phase-reload.test.ts -t "a tree move follows the step record of the new branch"` と `-t "a tree move to a branch with no open step ends the step"`(既存。status で検証する形に更新)
    - `cd packages/spirits && bun test test/routing-register.test.ts -t "a fork-route tree move keeps the step"`(新設。シナリオ「フォーク経路の移動ではステップが続く」。`new FakePi()` で、移動の後もステップが続き、リクエストがステップのロールへルートされる)

## 4. `/spirits-role` のコマンド

- [x] 4.1 `commands/role.ts` を「対象 項目 値」の構文に書き換え、ロールのロック、`status`、`<role> model <ref>`、`<role> thinking <level>`、`<step> <role|thinking> <value|unset>` を解釈し、解釈できない入力・項目の省略・空のモデル参照では一切変更しない。語の照合は大文字小文字を区別しない。検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "grammar reads object"` と `-t "leaves everything alone on an unparseable line"`(新設。d-verify1 G-3: 以前の `-t "grammar"` は後者を実行していなかった)。verify3: `-t "a role lock records the session entry and saves the default role"` にモデルと thinking が変わらないことを追加
  - d-verify2 W-5: design Risks の対策「`/spirits-clear` で終われることを `usage` とパネルに出す」が実装されていない。`USAGE`(`commands/register.ts:82`)に、継続中のステップは `/spirits-clear` かロックで終わる旨を加える(一覧の側は 5.3)。
  - 検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "the usage names how a step ends"`(新設)
- [x] 4.2 モデル参照の解決(`provider/id` 完全一致 → 部分一致 1 件、空白を含む行末までの参照、振り分け用モデルの api 除外、0 件と複数件のときは変更せず理由を伝える)を `model.ts` から移す。検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "resolves a role model reference"` と `-t "refuses a reference that matches no model"` と `-t "refuses an ambiguous reference"`(既存の 4 ケースを新構文へ移す)
  - d-verify3 S-1(利用者の決定: spec の文言を「ID に空白を含む」に直す。解決規則は変えない): シナリオ「空白を含むモデル参照」は「表示名に空白を含む」と書いていたが、解決規則が照合するのは `provider/id` と ID だけで、表示名(`name`)は照合しない(旧 `/spirits-model` と同じ)。spec のシナリオと design D7 を「ID に空白を含む」に直した。実装の変更は無い。
  - d-verify3 W-3: このシナリオを通しで検証するテストが無い。`a model reference keeps its spaces`(`test/managed-role-command.test.ts:107`)は構文解析だけを見ている。provider `Local`、ID `Qwen3.8 Flash Next` のモデル 1 件を含むカタログで `/spirits-role normal model Local/Qwen3.8 Flash Next` を実行し、`models.normal` に `Local/Qwen3.8 Flash Next` が保存されること、表示名だけが一致する参照は解決しないことを確かめる。
  - 検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "resolves and saves a model whose id has spaces"`(新設)
- [x] 4.3 `status` の出力を実装し、有効/無効、ロック、現在のステップと継続、直近のロール・物理モデル・要求 thinking、両ロールの解決結果と出どころ、既定と異なるステップ、無視した値を 1 件に出す。検証: `cd packages/spirits && bun test test/managed-role-status.test.ts`(新設。`reports routing disabled on a physical model` を含む)。verify3: `-t "reports a mixed-case step key as ignored"` に読み取り側で無視されることも追加
  - d-verify1 C-3: `RoutingPhase` に生のロックを返す `lock()` を足し、status の「lock」に使う。現状は `current()` を使うため、ロック normal で `/skill:sprt-opsx-verify-deep` の run 中に status を出すと `lock: strong` になる。現在のステップの行には、そのステップが実際に走るロールを添える。
  - d-verify1 C-2: 両ロールの解決結果を、ルーティングと同じ解決関数(`resolveNormalTarget` / `resolveStrongTarget`、直近の成功レスポンスを含む)で求める。出どころ(`models.<role>` / Pi の既定 / 直近の成功レスポンス)、使えない理由(利用できるモデルに無い / 資格情報が無い / 振り分け用のモデル)、代わりに応答するモデルを出す。現状は `models.normal` が使えなくても設定値をそのまま「解決結果」として出す。
  - d-verify1 C-7 / W-1: `readIgnoredSettings`(`src/config.ts`)が `models.role` と `models.strong` も検査し、値が書かれているが読めないものを未設定と区別して出す。ステップ名のキーは読み取り側と同じく大文字小文字を区別して照合し、`OpsX-Propose` のようなキーを「一覧に無いステップ名」として出す。
  - d-verify1 W-4: 直近のリクエストは実行環境のメモリにだけ持つ。再読み込みの後にリクエストが無いときは、再読み込み以降に無い旨を出す(`none since the last reload`)。
  - d-verify1 W-3: `a step that ended reports no step` は status を呼んでいないので、status の出力で検証する形に書き直す。
  - 検証: `cd packages/spirits && bun test test/managed-role-status.test.ts -t "reports the lock, not the step default, during a strong-default step"`、`-t "reports an unusable normal target with its reason and the model that answers"`、`-t "reports an unreadable models.strong apart from unset"`、`-t "reports a mixed-case step key as ignored"`、`-t "says no request has run since the last reload"`、`-t "a step that ended reports no step"`(新設・書き直し)
  - d-verify2 W-4: strong が使えないときの行は、代わりに応答するモデルを示すが、その出どころを示さない(`role.ts:470-477` の `runs X`)。spec「status のロックと解決結果は実際の位相と解決を示す」に合わせ、同じ行に出どころも出す(例: `runs compat-fake/fake-model (pi's default model)`)。
  - d-verify2 G-2: strong が未設定または使えないとき、strong の要求に実際に載る thinking レベル(normal へ落ちるので normal のレベル)を strong の行に出す。
  - d-verify2 G-3: `wrapRouteReportingRole`(`routing/register.ts:161-171`)では、`onRole` が例外を投げると `onRequest` が呼ばれず、status の直近のリクエストが更新されない。2 つの呼び出しを別々に保護する。
  - 検証: `cd packages/spirits && bun test test/managed-role-status.test.ts -t "an unusable strong names where its replacement comes from"` と `-t "an unresolved strong reports the level its requests carry"` と `bun test test/extension-degradation.test.ts -t "a throwing role reporter still records the request"`(新設)
- [x] 4.4 設定時の警告(strong 未解決、物理モデル選択中)を実装し、設定は取り消さない。解決時の通知規則は 3.5 のまま変えない。検証: `cd packages/spirits && bun test test/managed-role-warning.test.ts`(新設。`warns but keeps the lock` と `stays quiet when strong is usable`)
  - d-verify1 C-5: 警告の判定は、読み取った設定に書き込んだ経路と値を重ねた設定で行う。`pi.getSettings()` は `ctx.reload()` まで書き込み前の値を返すので、現状は strong 未設定から `/spirits-role strong model compat-fake/fake-strong` を実行した直後に「strong has no usable model」と誤って警告する。strong の対象そのものを設定したときは strong 未解決の警告を出さない(design D4)。
  - d-verify1 S-4(決定済み): 物理モデル選択中の警告は、コマンドによるすべての設定変更(ロック、ロールの model / thinking、ステップの role / thinking、`unset`)で 1 行出す。strong 未解決の警告は strong のロックとステップ strong のときだけ。一覧での編集は通知を出さない(5.3 で行の説明に出す)。
  - d-verify1 W-3: `warns but keeps the lock` は `patchSettings` が何もしないので保存を検証していない。書き込みを記録し、`models.role` が保存されたことを確かめる。
  - 検証: `cd packages/spirits && bun test test/managed-role-warning.test.ts -t "does not warn about strong right after setting the strong model"`(fake host は書き込みを `pi.settings` に反映しない)、`-t "says routing is off on any setting change while a physical model is selected"`、`-t "warns but keeps the lock"`(新設・書き直し)
- [x] 4.5 設定の書き込み → `ctx.reload()` の順序、失敗時の再読み込みなし、書き込み後のハンドル非使用を新構文で保つ。検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "reloads last"` と `-t "keeps the session lock when the settings write fails"`(既存ケースを新構文へ移す)。verify3: `cd packages/spirits && bun test test/managed-commands.test.ts -t "a saved role target is one string a reloaded read returns"`(新設)
  - d-verify2 C-6: `test/managed-commands.test.ts` から `a role lock shows on the badge before the reload it asks for` が削除されたが、成果物に削除の理由が無い。代わりのテストも無く、シナリオ「role を選んだときに描画する」を検証するテストが無くなった(6.2 が説明しているのは `/spirits-model` のテストの削除だけ)。挙動(`register.ts:134`)は正しいので、新構文のテストとして戻す。
  - 検証: `cd packages/spirits && bun test test/managed-role-command.test.ts -t "a role lock draws the badge before the reload"`(新設)
- [x] 4.6 `getArgumentCompletions` を `value` と `label` を満たすヘルパで実装し、`model` の値では候補を出さない。検証: `cd packages/spirits && bun test test/managed-role-completion.test.ts`(新設。`every completion item carries a label` と `offers no model candidates`)
  - d-verify2 G-1: 3 語の後ろに空白がある入力(`normal thinking high `、`opsx-propose role strong `)で、3 語目の候補をもう一度返す(`roleCompletions`、`commands/register.ts:376`)。文法は 3 語までなので、候補を返さない(`null`)。
  - 検証: `cd packages/spirits && bun test test/managed-role-completion.test.ts -t "offers nothing where the grammar has no more words"`(既存ケースに上の 2 入力を足す)

## 5. 対話端末の設定一覧

- [x] 5.1 `docs/architecture/convention-registry.md` の `registry:layers` に `spirits:commands → packages/tui` を追加し、同じ変更で `ARCH-PI-BOUNDARY` の例外文を「`routing` を除く全層」に直して `registry:layers` と食い違わないようにする。同じ変更で規約検査と fixture を追従させる。検証: `cd packages/spirits && bun test test/architecture-conventions.test.ts -t "commands may import pi-tui"` と `-t "routing may not import pi-tui"`
  - d-verify1 C-8: `registry:layers` の追加と検査は済んでいるが、`ARCH-PI-BOUNDARY` の例外文(`docs/architecture/convention-registry.md:163`)が「`packages/spirits/src/` の全層が `packages/coding-agent` と `packages/tui` へ依存すること(bare specifier)は許可する」のまま。「`routing` を除く全層が `packages/coding-agent` と `packages/tui` へ、`routing` は `packages/coding-agent` だけへ」に直す。追加検証: `grep -n "例外" docs/architecture/convention-registry.md` の `ARCH-PI-BOUNDARY` の行に `routing` が含まれる
- [x] 5.2 `scripts/build-managed-pi-inputs.ts` の `HOST_EXTERNALS`(31 行)には `@earendil-works/pi-tui` が既に入っている。実装作業は無く、external のまま保つことと、bundle が解決できることの回帰検査だけを追加する。検証: `bun scripts/build-managed-pi-inputs.ts --version 0.0.0-0 --out /tmp/spirits-external-check && grep -q "@earendil-works/pi-tui" /tmp/spirits-external-check/spirits-managed-pi-extension.js`(リポジトリ直下の `scripts/` を実行する。`cd packages/spirits` ではない)と `cd packages/spirits && bun test test/managed-pi-build-inputs.test.ts -t "keeps pi-tui external"`(新設ケース)
- [x] 5.3 `commands/role-panel.ts` で `SettingsList` の本体一覧(ロック、2 ロールのモデルと thinking、ステップ設定、選択行の説明、開始コマンドの欠落表示)を作る。theme と行はビルダ関数で全必須値を満たす。開く可否は `ctx.mode === "tui"` で判定する(`hasUI` は RPC でも true)。検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "rows carry every required field"`(新設)。verify3: `-t "an argumentless command opens the list without changing anything"`(新設)
  - d-verify1 S-3(決定済み): ステップは 1 ステップ 1 行とし、ロールと thinking の組を 1 項目として扱う。行の値は `<role> / <thinking>` の形で両方を示す。行数は `1 + 2 * 2 + STEP_DEFINITIONS.length` になるので `rows carry every required field` を更新する。
  - d-verify1 C-3: ロックの行には生のロック(4.3 の `lock()`)を出す。現状は `current()` なので strong 既定のステップ中に strong と出る。
  - d-verify1 C-11: 行の説明に、ルーティングと同じ解決関数で求めた「実際に応答するモデル」を出す。設定済みで使えない対象は、使えない旨・理由・代わりに応答するモデルを出す(現状は `models.strong` が使えなくても「Strong answers with X」と出す)。ロックの行には直近のリクエスト(ロール・物理モデル・要求した thinking)を出す。スナップショットに直近のリクエストと解決結果を加える。
  - d-verify1 S-4(決定済み): 物理モデル選択中の警告と strong 未解決の警告を、通知ではなくロックの行と該当行の説明に出す。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "rows carry every required field"`(更新)、`-t "an unusable target row names the model that answers"`、`-t "the lock row shows the lock during a strong-default step"`、`-t "the lock row carries the warnings a command would notify"`(新設)
  - d-verify2 C-1: 上の d-verify1 S-3 の決定(1 ステップ 1 行、値は `<role> / <thinking>`)が実装されていない。一覧のステップは `step:<name>.role` と `step:<name>.thinking` の 2 行のままで(`role-panel.ts:263-289`、計 35 行)、spec「対話端末で設定と稼働の一覧を開く」の SHALL に反する。テスト `rows carry every required field` も、行数を `STEP_DEFINITIONS.length * 2` の前提で検証している(`test/managed-role-panel.test.ts:95`)。ステップを 1 行 `step:<name>` にまとめ、行数の期待を `1 + 2 * 2 + STEP_DEFINITIONS.length` に直す。
  - d-verify2 C-2: ステップの行の説明が設定値の写し(`Runs strong, which you set.`)のままで、実際に応答するモデル、継続の有無、strong 未解決の警告を出さない。strong 未設定のまま一覧で `opsx-propose` を strong にしても、警告はどの行にも出ない(`lockWarning` はロックと実行中のステップしか見ない。d-verify2 P1)。ステップの行と strong の `model` 行に、design D11 の内容(そのステップが走るロール、実際に応答するモデル、有効な thinking、継続するかどうか、strong 未解決の警告)を出す。spec「一覧の説明は実際の解決結果を示す」「設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える」。
  - d-verify2 W-5: ロックの行の説明に、継続中のステップは `/spirits-clear` かロックで終わる旨を出す(design Risks)。
  - d-verify2 C-4: 上の検証に挙げた `an unusable target row names the model that answers`、`the lock row shows the lock during a strong-default step`、`the lock row carries the warnings a command would notify` はどれも実在しない(`bun test -t` が `matched 0 tests` で失敗する)。この名前でテストを作る。
  - 検証: 上の 4 件に加え、`cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a step row names the model that answers and whether it continues"` と `-t "a step set to strong warns on its row when strong has nothing to run on"`(新設)
  - d-verify3 C-1: strong が使えないとき、ステップ行と `strong thinking` 行が、要求に載らない thinking レベルを出す。
    - 原因: `stepRow`(`role-panel.ts:465`)は要求したロール(strong)で thinking を解決する。ルーター(`router.ts:154`)は応答したロール(normal)で解決する。
    - 例: strong 未設定、`thinking.strong=max`、`thinking.normal=low`、`opsx-propose` のロール strong。行は「It answers with compat-fake/fake-model. It asks for max.」、同じ条件のルーターは `normal / fake-model / low`。`strong thinking` 行も「strong requests ask for max」と出す。`thinking.strong` が未設定でも、`thinking.normal` を設定していれば同じ食い違いが起きる。
    - 修正: 説明のモデルと thinking レベルを 2.5 の関数の返り値から作る。`strong thinking` 行は、strong が使えないとき「strong の要求は normal で走り、normal のレベル <x> を載せる」と出す(spec に追加した要件「一覧の説明の thinking レベルは要求に載るレベルを示す」とシナリオ 2 件)。
  - d-verify3 G-2: thinking だけを設定したステップの説明が「Nothing is set, so … follows the lock」になる(`role-panel.ts:474`)。ロールが未設定である旨に直す(例: 「No role is set, so … follows the lock」)。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a step row names the level its requests carry when strong falls back"`(新設。spec のシナリオ「strong が落ちるステップの行は normal のレベルを示す」の GIVEN / WHEN をそのまま使い、期待値は同じ条件のルーターの戻り値から作る)、`-t "the strong thinking row names the level a fallback carries"`(新設。シナリオ「使えない strong の thinking レベルの行」)、`-t "a step with only a level set says no role is set"`(新設)
  - d-verify4 W-1: spec に後から足されたシナリオ「ロールのモデルの行とロックの行もルーティングと一致する」のテストが無い(挙動は d-verify4 で正しいことを確認済み)。
    - GIVEN をそのまま使う: `spirits/auto`、strong の対象は設定済みで使えない、normal は Pi の既定モデル、normal のロック、`opsx-propose` のロール strong で継続中。
    - 期待値は、同じ条件のルーターの戻り値から作る(冒頭の規則 4)。
      - `strong model` 行の説明は、ルーターが返すモデル(`modelKey(routed.model)`)を含む。
      - ロックの行の説明は、ルーターの要求したロール(strong)を「runs strong」として含む。
  - d-verify4 W-2: strong の対象が未設定のとき、`strong model` 行の説明(`role-panel.ts:394-395`)が、代わりに応答するモデルを名指さない。設定済みで使えないとき(`runs <model>`)と同じく、normal の対象のモデルを出す(design D11)。
  - d-verify4 G-1: レベルが無いときの文言が食い違う。`levelRow` は「the session level (off)」と off を断定し(`role-panel.ts:435`)、`stepRow` は `unset` と出す(`:489`)。どちらも「the session's level」に揃える。
  - 検証:
    - `cd packages/spirits && bun test test/routing-request-plan.test.ts -t "the model row and the lock row agree with the route"`(新設)
    - `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "an unset strong model row names the model that answers"`(新設。期待値は同じ条件のルーターの戻り値から作る)
- [x] 5.4 一覧の編集をロール選択・thinking・ステップの 2 段(`SelectList` submenu)で実装し、書き込みはコマンドと同じ経路、失敗行は表示を戻す。ロールの `model` 行は `SelectList` の候補に `ctx.modelRegistry.getAvailable()` の結果(振り分け用モデルを除く)を出して選ばせ、候補が 0 件のときは書き込まない。検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "an edit writes through the same settings path"` と `-t "a failed write restores the row"` と `-t "the model row offers the available models without the routing model"` と `-t "an empty model list writes nothing"`(新設)
  - d-verify1 C-1: `SelectList` の `onCancel` が空関数で、モデル 0 件の案内部品も入力を無視するため、Esc で候補を閉じられず、0 件の案内からは一覧へ戻れない(`SettingsList` はサブメニューに全入力を渡す)。どちらも `done()` を呼んで値を変えずに閉じる。
  - d-verify1 S-3(決定済み): ステップの行は Enter でロールの候補を開き、確定すると `/spirits-role <step> role <value>` と同じ書き込みをしてから、現在の thinking を選択した候補を続けて開く。2 段目の確定は `/spirits-role <step> thinking <value>` と同じ書き込み、2 段目の Esc は thinking を変えない。
  - d-verify1 C-6: 候補からの除外を provider / id ではなく `model.api === PI_VIRTUAL_MODEL_API` で行う。現状は他の拡張が登録した仮想モデル(例: `other/router`、api `pi-virtual`)が候補に出る。
  - d-verify1 C-12: 書き込み失敗の理由を `ctx.ui.notify` ではなく、その行の説明か一覧の通知行に出す。
  - d-verify1 W-6: 書き込みに成功した行は、値に加えて説明も新しい解決結果へ更新する(`SettingsList` の説明は静的なので、行の `description` を作り直す)。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "escape closes a choice list without writing"`、`-t "escape closes the empty model notice"`、`-t "a step row edits role then thinking"`、`-t "escape on the second stage keeps the thinking level"`、`-t "the model row drops every virtual model by its api"`、`-t "a failed write shows its reason inside the list"`、`-t "a saved edit refreshes the row description"`(新設)。既存の `the model row offers the available models without the routing model` と `a failed write restores the row` も通す。Esc とサブメニューの検証は `openRolePanel` が組み立てた部品に `handleInput` で Esc を送って行う(行モデルだけの検証では足りない)
  - d-verify2 C-1: ステップの 2 段選択を 1 行の中で行う。現状は role 行から `navigateTo` で別の thinking 行へ移るので、シナリオ「ステップの 2 段選択」の「その行の表示と説明」が 1 行にならない。1 行 `step:<name>` の submenu で、ロールを確定したら同じ行の thinking の候補を開く。pi-tui の `navigateTo` で同じ行を開き直すか、submenu の中で段を持つ。2 段目の Esc は thinking を変えずに一覧へ戻す。
  - d-verify2 C-4: 上の検証に挙げた 7 件(`escape closes a choice list without writing`、`escape closes the empty model notice`、`a step row edits role then thinking`、`escape on the second stage keeps the thinking level`、`the model row drops every virtual model by its api`、`a failed write shows its reason inside the list`、`a saved edit refreshes the row description`)はどれも実在せず、`bun test -t` が `matched 0 tests` で失敗する。この名前でテストを作る。
  - d-verify2 W-3: 今の Esc のテスト(`escape closes every submenu`)は、`rowSubmenu` に自前の close を渡すだけで、`openRolePanel` が `SettingsList` に渡す配線を見ていない。そのため、9.3 で見つかった「外側の `done` を渡して画面ごと閉じる」不具合を検出できない。`ctx.ui.custom()` の factory が返した `SettingsList` に、`handleInput` で Enter と Esc を送って検証する(上の C-4 の Esc 2 件はこの形で作る)。
  - d-verify2 W-7: (a) 一覧でロックを変えたときは、書き込みの成否にかかわらず、コマンドと同じく badge をそのロールで描く。(b) ステップのロールの書き込みが失敗したときは 2 段目を開かず、失敗理由を出した行へ戻す(`role-panel.ts:474-478` は失敗しても `navigateTo` する)。
  - d-verify2 S-1(決定済み): ロックの行で設定の書き込みだけが失敗したときは、セッションのロックを取り消さず、行は適用後のロックと保存失敗の理由を示す(spec「一覧のロックの行は保存に失敗してもセッションのロックを示す」、design D11)。今の挙動はこれに合っている(d-verify2 P9)ので、テストで固定する。
  - 検証: 上の 7 件に加え、`cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a failed lock save keeps the session lock on the row"`、`-t "a lock edit draws the badge even when the save fails"`、`-t "a failed step role write does not open the second stage"`(新設)
  - d-verify3 W-1: design Risks の対策「`onSelect` 内の例外は catch して一覧の中に出す」を実装するタスクが無く、実装されていない(原因は Workflow follow-up の原因 3)。`openRolePanel` の `write` と `refresh`(`role-panel.ts:521-534`)で例外を捕まえ、その行の説明に理由を出し、一覧を開いたままにする。
    - 今の経路: `pi.appendEntry`(ロックの記録、`role-write.ts:51` の `lockRole` は try の外)や、再描画時の `pi.getSettings()` / `getAvailable()` / `getCommands()` が例外を投げる → pi-tui の `handleInput`(try なし、`packages/tui/src/tui.ts:1110-1115`)から抜ける → pi の `uncaughtException` の処理(`interactive-mode.ts:4517`)で pi が終了する。
  - d-verify3 W-4: シナリオ「一覧での編集は行の説明で伝える」の「警告の通知は出ない」を検証するテストが無い。`driveScreen` は常に `spirits/auto` を選ぶ(`test/managed-role-panel.test.ts:519`)うえ、`run.notices` をどのテストも見ていない。シナリオの GIVEN(物理モデルを選び、strong 未設定)で一覧のロックを strong にし、通知が 0 件であること、ロックの行の説明に「振り分けが働いていない」旨と「strong が normal で走る」旨の両方が出ることを確かめる。
  - d-verify3 W-5: シナリオ「ステップの 2 段選択」をそのまま操作するテストが無い。既存の `a step row edits role then thinking` は unset → strong → high で、書き込みだけを見る。シナリオの GIVEN(`opsx-propose` が strong / low)から `unset` → `high` を選び、ロールのキーの削除、`high` の書き込み、行の値 `unset / high`、説明の「ロックに従う」旨と `high` を確かめる。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "an exception in an edit stays inside the list"`(新設。`lockRole` が投げても `handleInput` が例外を外へ出さず、一覧が開いたままでロックの行に理由が出る)、`-t "a list edit on a physical model sends no notice"`(新設)、`-t "the two stages from strong low to unset high"`(新設)
  - d-verify4 C-2: ロックの記録の追記が例外を投げると、ロックの行と badge がセッションのロックとずれる。spec に後から足された MUST(「一覧のロックの行は保存に失敗してもセッションのロックを示す」の 3 段落目)と、シナリオ「ロックの記録の追記が例外を投げる」に反する。
    - 経路:
      1. `lockRole`(`commands/register.ts:96-102`)が `phase.setRole("strong")` を実行する。
      2. `pi.appendEntry` が例外を投げる。
      3. `applyRoleLock` を抜けるので、`hooks.lockDrawn`(`role-panel.ts:336`)に届かない。
      4. `openRolePanel` の catch(`role-panel.ts:574-583`)は、行の説明だけを直して `refresh` しない。
    - 結果(d-verify4 P1): `phase.lock()` は `strong`、ロックの行は `normal`、badge は未描画。
    - テストが見逃した理由: 既存の `an exception in an edit stays inside the list` は `RoleWriteDeps.lockRole` をまるごと置き換え、`setRole` より前で投げている。そのため実装の順序を通らない(冒頭の d-verify4 の規則 3)。
    - 修正(design D11): ロックの行の編集では、例外の有無にかかわらず `finally` で `phase.lock()` のロールを使って badge を描き、行の値を `phase.lock()` から作り直す。理由は行の説明に出す。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a lock record that fails to append keeps the row and the badge on the session lock"`(新設)
    - 入力: 本物の `registerManagedCommands` と `createRoutingPhase()` を使い、`FakePi.appendEntry` だけを `spirits_role` で投げさせる。シナリオの GIVEN / WHEN(normal のロック、一覧で strong を選ぶ)をそのまま使う。
    - 期待: `handleInput` が例外を外へ出さない。ロックの行の値が `phase.lock()` と同じ `strong`。行の説明に理由が出る。badge が `[strong]`。
  - d-verify5 W-1: 書き込みが成立した後に設定の読み戻しが投げると、行が旧値のまま `not saved` を出す。badge を描く `finally` の read が投げたときは badge も `ctx.reload()` も走らない。
    - 原因: `write`(`commands/role-panel.ts:599-621`)は `panel.edit` の成败を区別せず、catch したら常に `saved: false` と `the row was not saved` を返す。書き込みの成立後に走る `refresh()`(`:602`)と badge の read(`:352`)の失敗がそこに落ちる。badge の read が投げると `panel.edit` が完走せず `changes` に残らないので、`hasWrites()` が false になり reload も走らない。
    - 実測(d-verify5 の probe。`pi.getSettings` を N 回目以降投げさせ、一覧の lock 行から strong を選ぶ):
      - badge の read で投げる: `phase.lock()` は `strong`、`spirits_role` の記録も追記済み、`models.role` の patch も済んでいる。それなのに badge は未描画(`ui.setStatus` 0 件)、`ctx.reload()` 0 回、行は `role lock normal` + `not saved: ...`。
      - `refresh()` で投げる: lock は `strong`、badge は `[strong]`、reload は 1 回。行は `role lock normal` + `not saved: ...` のまま。
    - 修正(design D11 の「行はセッションの事実を示す」の続き): 書き込みが成立した後だけを別扱いにする。`panel.edit` が返しえたときは `saved` を保ち、`changes` に残して reload を走らせ、行に出す理由は「保存できたが行を描き直せない」旨にする(現在の `FAILURE_PREFIX` の `not saved: ` をそのまま付けない)。badge は `phase.lock()` だけで描けるようにする(`RolePanel` に phase のロックを渡す口を足し、badge の描画が settings の読み戻しに失敗して止まらないようにする)。
    - 見落とした理由: d-verify4 C-2 の `an exception in an edit stays inside the list` は `lockRole` 自体を投げさせており、書き込みが成功した後の読み戻しを通さない。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a read that raises after a landed lock keeps the row and the badge on the session lock"`(新設。`driveScreen` に `failRead: number` を足し、`pi.getSettings` を N 回目以降投げさせる。N は 2 で、書き込みの成立後にある読み戻し(一覧の再描画)を落とす。badge を描く `finally` は phase だけを読むので、そこを通る読み戻しは無い)
    - 期待: `handleInput` が例外を外へ出さない。badge が `[strong]`。`ctx.reload()` が 1 回走る。ロックの行の値が `phase.lock()` と同じ `strong`。行に理由が出るが `not saved` の文言は出ない。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "a read that raises after a step role edit still opens the level stage"`(新設。ステップの 1 段目の書き込みが成立した行で読み戻しが落ちるケース。`saved` が保たれないと 2 段目が開かない)
    - 期待: 1 段目のあとに thinking の候補が開く。一覧へ戻ると行の値が `strong / low`(書き換わった半分だけ動き、半分は留まる)。`not saved` は出ず、`ctx.reload()` が 1 回走る。
- [x] 5.5 再読み込みを一覧を閉じるとき 1 回に限定し、対話 TUI 以外では一覧を開かず `status` 相当を出す。検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "reloads once on close"` と `-t "shows status outside the tui"`。verify3: `-t "an argumentless command opens the list without changing anything"`(新設)
- [x] 5.6 一覧が開始コマンドの在席を `pi.getCommands()` で判定する。検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "marks a step whose starters are absent"`
  - d-verify2 C-7: `missingStartersFor`(`role-panel.ts:150-159`)に `pi.getCommands()` の全件の名前を渡しており(`register.ts:265`)、拡張コマンドも開始コマンドとして数える。一方、ステップの開始(`phase.ts:215`)は `source !== "extension"` で拡張コマンドを除く。そのため、拡張コマンド `opsx-propose` しか無いセッションでは、一覧は開始コマンドが有ると表示するのに、ステップは始まらない(d-verify2 P8)。spec のシナリオ「開始コマンドが無いステップ」は、スキルとテンプレートだけを数える。ステップの開始と同じ条件で絞る(design D11)。
  - 検証: `cd packages/spirits && bun test test/managed-role-panel.test.ts -t "an extension command is not a starter"`(新設)
- [x] 5.7 `src/index.ts` にパネルとコマンドの配線を足す(一覧はコマンドハンドラの `ExtensionContext` を受け取る)。検証: `cd packages/spirits && bun test test/managed-commands.test.ts -t "registers only spirits-role and spirits-clear"` と `npm run check` が通る

## 6. `/spirits-model` の削除

- [x] 6.1 `commands/model.ts` を削除し、`commands/register.ts` と `packages/spirits/src/index.ts` の export から外す。検証: `cd packages/spirits && bun test test/managed-commands.test.ts -t "registers only spirits-role and spirits-clear"`(旧ケースは削除または更新)と `npm run check` が通る
- [x] 6.2 旧 `/spirits-model` のテストを新構文へ移し、spirits 側に残った参照が無いことを確認する。`scripts/managed-pi-compat` の参照は 8.2 で消すのでここでは対象にしない。検証: `cd packages/spirits && bun test test/managed-commands.test.ts` と `! grep -rn "spirits-model" packages/spirits/src packages/spirits/test`

## 7. TODO パネルの既定開閉キー(7.x は 1〜6 と独立。並行して進められる)

- [x] 7.0 (調査済み・実装はしない) 不具合の実測済み再現: 0.7.1 の実バイナリ + 実 TODO パネルで、`extended-keys off` の tmux では `C-S-l` が Pi のモデル選択を開くだけで開閉せず、`SPIRITS_TODO_TOGGLE_KEY=ctrl+alt+t` を立てた同じ環境では `C-M-t` が `1 pending` への折りたたみと展開を切り替えた。原因は V10。開閉キーの上書き経路が既に動いているので、実装は 7.1 の 1 値の変更と 7.2 の文書更新で足りる。
- [x] 7.1 `packages/spirits/src/constants.ts` の `DEFAULT_TODO_TOGGLE_KEY` を `ctrl+shift+l` から `ctrl+alt+p` に変える。設定(`todo.toggleKey`)・環境変数(`SPIRITS_TODO_TOGGLE_KEY`)の決定順と構文検証は変えない。検証: `cd packages/spirits && bun test test/config.test.ts -t "the default todo toggle key"`(既存の `expect(DEFAULT_TODO_TOGGLE_KEY).toBe("ctrl+shift+l")` を新値へ更新)と `cd packages/spirits && bun test test/config.test.ts`
- [x] 7.2 `packages/spirits/README.md` の TODO 設定表の既定値を `ctrl+alt+p` に更新し、注意書きを「修飾キーを別途報告しない端末では `ctrl+shift+<letter>` が `ctrl+<letter>` と同じバイト列になり、`ctrl+l` は Pi のモデル選択が握っているため開閉できない。効かないときは `todo.toggleKey` に端末が送る別のキーを書く」に書き換える(kitty の `kitty_mod` と Ubuntu の `Ctrl+Alt+T` の例も残す)。検証: `grep -n "ctrl+alt+p" packages/spirits/README.md` が設定表と注意書きの 2 箇所以上に出る
  - d-verify1 W-2: README の注意書き(316 行)の「モデル選択を清空する Pi の組み込み操作」は誤り。`ctrl+l` は Pi のモデル選択を開く(design D14)。同じ誤りの `src/constants.ts` の `DEFAULT_TODO_TOGGLE_KEY` の JSDoc(`which pi binds to clearing the model`)も直す。追加検証: `! grep -n "清空" packages/spirits/README.md` と `! grep -n "clearing the model" packages/spirits/src/constants.ts`
- [x] 7.3 管理バイナリの対話 TUI で既定キーが開閉を切り替え、Pi の組み込み操作が始まらないことを実観測する。手順は `.pi/skills/interactive-testing.md` に従い、`scripts/tmux-verify.sh run --session todo-key -- ./dist/spirits-linux-x64 --approve` を背景で起動し、`session=` を待ってからの操作にする。検証: TODO 項目を 1 件作って `manage_todos` の行が出た画面で `tmux send-keys -t "=todo-key:" 'C-M-p'` を送り、`tmux capture-pane -t "=todo-key:" -p` が件数サマリ行だけになること、もう 1 回送ると項目行へ戻ること、`scripts/tmux-verify.sh check --session todo-key` が clean であること。`tmux show -g extended-keys` が off のままの tmux で行う(既定の tmux 設定が失敗条件そのもの)

## 8. 互換ランナーとドキュメント

- [x] 8.1 `scripts/managed-pi-compat/rpc.ts` に `set_thinking_level` の送信を追加し、`scripts/managed-pi-compat/fake-provider.ts` に受けた要求本文の記録を追加する(`fixtures/custom-provider.ts` の 2 モデルは `reasoning: true` ですでに thinking 対応)。検証: `cd packages/spirits && bun test test/managed-pi-compat-thinking.test.ts`(新設。`set_thinking_level` の値が fake provider の body に出る)
- [x] 8.2 `scripts/managed-pi-compat/matrix.ts` を新仕様に更新し、`MODEL_PURPOSES` の `/spirits-model` 由来の 3 行を新しい手段と状態へ書き換え、role / thinking / ステップ設定 / status / 一覧の行を定義する。一覧と公式 `/model` の既定保存は RPC で駆動できないので `not-run` と理由を記録する。検証: `bun scripts/managed-pi-compat/run.ts --mode fixture` が完走し(リポジトリ直下で実行)、一覧に相当する行が `not-run` と理由で記録される。あわせて `! grep -rn "spirits-model" scripts/managed-pi-compat` が成功する
  - d-verify1 S-5: fixture モードは `--bundle` を黙って無視し、インストール済みの managed set の拡張を測る。上の検証コマンドは作業ツリーの変更を測っていない(インストール済みの旧拡張では thinking-level が `unavailable`、role-model と step-role-settings が `not-run` だった)。fixture モードで `--bundle` を受け付け、指定時はその bundle を入れた一時 managed root を作って測る。結果の `runtime` に測った拡張のパスと sha256 を残す。
  - d-verify1 C-9: `modelPurposeObservations` は `setModelResult` を集めているのに使っていない(しかも `spirits/auto` を選んだ後に `fake-model` と比べている)。`set_model` によるセッションのモデル選択と `get_state` の読み戻しを観測する目的を 1 行足し、ロールの対象の行とは別に記録する(spec「model の記録」)。
  - d-verify1 C-14: `rlm child abort` が作業ツリーの bundle でも旧 bundle でも `failed`(`abort accepted=unknown, cell aborted=false`)。archive 済み `switch-default-to-managed` の証跡では confirmed だった。変更前のコミット(`f71b6746b`)の bundle と作業ツリーの bundle で同じ fixture を測って切り分け、差が無ければ環境・既存の問題として理由を記録し、差があれば修正する。
  - 検証: `bun scripts/build-managed-pi-inputs.ts --version 0.0.0-0 --out /tmp/spirits-compat-bundle` の後、`bun scripts/managed-pi-compat/run.ts --mode fixture --bundle /tmp/spirits-compat-bundle/spirits-managed-pi-extension.js --out /tmp/spirits-compat.json` が完走し、結果の `runtime` が指定した bundle を指すこと。model の目的に `set_model` のセッション選択の行が観測結果つきで記録され、thinking-level / role-model / step-role-settings が `available` であること。一覧と公式 `/model` の既定保存の行が `not-run` と理由で記録されること。`cd packages/spirits && bun test test/managed-pi-compat-matrix.test.ts -t "records the session model selection apart from the role target"`(新設)。`! grep -rn "spirits-model" scripts/managed-pi-compat` も成功する
  - d-verify2 C-5(決定済み: 実装する): 上の記述の「status の行」が無い。`matrix.ts` の目的にも、`run.ts` の駆動にも `/spirits-role status` が出てこない。`ROLE_PURPOSES` に `/spirits-role status` の目的を 1 行足し、RPC で status を駆動して、通知の出力(ロック、現在のステップ、両ロールの解決結果)を読む。spec の「role の記録」シナリオには追記済み。
  - d-verify2 で確認済み(作業は無い): `--bundle` で測った結果の `runtime.extension` は、指定した bundle の sha256 を指す。thinking-level / role-model / step-role-settings / session-model-selection は `available`、default-save と settings-list は `not-run`。`rlm child abort` の `failed` は変更前のコミット `f71b6746b` の bundle(sha256 `d9effea3…`)でも同じ形で出るので、この変更の起因ではない。
  - 検証: 上のランナーの検証で、status の目的が観測結果つきで記録されること。`cd packages/spirits && bun test test/managed-pi-compat-matrix.test.ts -t "records the status report as a role purpose"`(新設)
  - d-verify3 C-2: 上の `records the status report as a role purpose` が実在せず、`matched 0 tests` で exit 1 になる。同じ目的のテストは `the status row is decided by the report the command produced`(`test/managed-pi-compat-matrix.test.ts:270`)という名前で作られた。冒頭の規則どおり、テスト名を tasks の名前に変える。d-verify3 のランナー実行(bundle sha256 `eb40d2c7…`)で `role-status-report` は `available` だったので、挙動の作業は無い。d-verify2 C-4 と同じ種類の不備が、d-verify2 の反映で足した名前で繰り返した(原因は Workflow follow-up の原因 2)。
  - 検証: `cd packages/spirits && bun test test/managed-pi-compat-matrix.test.ts -t "records the status report as a role purpose"` が 1 件以上 pass する
- [x] 8.3 `docs/spirits-managed-pi.md`(設定の永続化、既知の制約、コマンド一覧、互換表、ランナーの観測、`/spirits-model` からの移行表)と `docs/spirits-managed-pi-design.md`(拡張コマンドの対応表とマトリクス目的、`/spirits-model` を挙げる 5 箇所)を新仕様に更新する。CHANGELOG は作らない(spirits に前例が無い)。実測記録の `docs/agent-data-compat/default-route/result.json` は当時の観測なので変更しない。検証: `! grep -rn "/spirits-model" docs/spirits-managed-pi.md docs/spirits-managed-pi-design.md` が成功し、`grep -n "spirits-role" docs/spirits-managed-pi.md` の移行表の行が 4 行以上ある
  - d-verify1 C-10: spec「専用コマンドの表面の違いを文書に残す」の 2 文が無い。「セッションのモデル選択と thinking レベルの既定保存は公式の `/model` と `/thinking` で満たせる」「`/spirits-role` が設定するのはロールの対象であり、セッションのモデル選択ではない」を書く。移行表の `spirits-model <ref>` と `spirits-model <ref> <level>` の移行先が `/spirits-role normal model` になっており、spec の REMOVED Migration(セッション選択は公式 `/model`)と矛盾するので、公式 `/model` / `/thinking` に直し、ロールの対象を設定したい場合の行を別に置く。
  - d-verify1 W-2: ランナーの観測の節(293 行)の thinking の判定手段を、実際の駆動(`/spirits-role <role> thinking` の後に fake provider の要求本文を読む)に合わせる。一覧の説明の記述(154 行「直近の物理モデル名を含む」)は 5.3 の実装に合わせて残す。
  - d-verify1 W-4: 既知の制約に「`status` と一覧の直近のリクエストは拡張の実行環境にだけあり、設定書き込みに伴う再読み込みで消える」を書く。
  - 追加検証: `grep -n "/thinking" docs/spirits-managed-pi.md` が代替関係の文に出る、`grep -n "セッションのモデル選択" docs/spirits-managed-pi.md` が区別の文に出る、`grep -n "再読み込み以降" docs/spirits-managed-pi.md` が既知の制約に出る
  - d-verify2 W-6: design の Migration Plan と proposal は、`/spirits-model` からの移行表を `docs/spirits-managed-pi-design.md` にも書くとしているが、その表が無い。同じ表を置くか、`docs/spirits-managed-pi.md` の移行表への参照を置く。旧コマンド名は、`docs/spirits-managed-pi.md` と同じく先頭のスラッシュを付けずに書く。上の `! grep -rn "/spirits-model"` の検証を壊さないため。
  - d-verify2 W-8: `docs/spirits-managed-pi.md:153` の誤記「workfow」を直す。あわせて「進行中の workfow step の role と thinking level を上書きする」を「そのステップが走るときの role と thinking level を設定する」に改める。ステップ設定は進行中のステップに限らず、そのステップが走るたびに効くため。
  - 追加検証: `grep -n "spirits-model" docs/spirits-managed-pi-design.md` が移行表(または参照)の行に出る、`! grep -n "workfow" docs/spirits-managed-pi.md`
  - d-verify3 G-1: 誤記を直す。`docs/spirits-managed-pi.md:155` の「除したもの」を「除いたもの」に、`docs/spirits-managed-pi-design.md:123` の「削した旧コマンド」を「削除した旧コマンド」にする。
  - d-verify3 C-1 / W-2: `docs/spirits-managed-pi.md` の一覧の説明の記述(155 行)に、thinking レベルは実際に応答するロールで解決する旨(strong が normal へ落ちれば normal のレベル)を足す。ステップの継続の記述に、分岐間の移動(`/tree`)ではステップが移動先の分岐の記録に合わせて変わる旨を足す。
  - 追加検証: `! grep -n "除したもの" docs/spirits-managed-pi.md`、`! grep -n "削した" docs/spirits-managed-pi-design.md`、`grep -n "/tree" docs/spirits-managed-pi.md` がステップの記述に出る
  - d-verify5 W-2: `docs/spirits-managed-pi.md:115` の「`defaultThinkingLevel` は pi の `/thinking` が握った既定値であり、spirits は読むだけで書かない」が誤り。spirits はこのキーを読まない。`rg -n "defaultThinkingLevel|SETTINGS_KEY_THINKING_LEVEL" packages/spirits/src` は型ミラー(`src/types/pi-coding-agent.d.ts:123`)の 1 件だけで、`readRoutingSettings`(`src/config.ts:205-222`)は `models.role` / `models.strong` / `models.normal` / `models.thinking` / `models.steps` / `defaultProvider` / `defaultModel` を読む。 Spirits がこのキーを引くのは互換ランナーの fixture(`scripts/managed-pi-compat/fixtures/probe-extension.ts:117`)だけ。
    - 値自体は間接に効く。pi がこのキーからセッションの thinking level を決める(`packages/coding-agent/src/core/model-resolver.ts:670,683-684`)ので、spirits の解決の最後の 1 段「pi のセッション選択」へ届く。直すのは「spirits が読む」という主語だけ。
  - d-verify5 W-3: `docs/spirits-managed-pi-design.md` のマトリクス目的が 9 のまま。`scripts/managed-pi-compat/matrix.ts` は role 5(`skill-strong-phase` / `model-role-vocabulary` / `role-badge` / `step-role-settings` / `role-status-report`)、clear 3、model 5(`thinking-level` / `role-model` / `session-model-selection` / `default-save` / `settings-list`)の 13 目的で、`docs/spirits-managed-pi.md:204` は「role 5 目的、`/clear` 3 目的、model 5 目的」と更新済み。design は §2 の見出し(90 行)、`:120` の `role-selection`(`matrix.ts` には無い id。model 側は `role-model`)、§7 の比較表の「9 目的 | 9/9 | 7/9」(257 行)、§9 の「9 目的マトリクスの再定義」(291 行)が残っている。
    - 修正: §2 の表に `step-role-settings` / `role-status-report` / `session-model-selection` / `settings-list` を足し、`role-selection` を `role-model` へ直して、件数を 13 にする。§7 と §9 の文も 13 に合わせる。§9 のように当時の計画を記述している文は、その時点では 9 目的だったと分かる書き方にしてよい。
  - 追加検証: `! grep -n "読むだけで書かない" docs/spirits-managed-pi.md`、`grep -n "defaultThinkingLevel" docs/spirits-managed-pi.md` が「spirits は読まない」旨の文に出る、`! grep -n "^| \`role-selection\`" docs/spirits-managed-pi-design.md`(目的の行として `role-selection` を残さない。置き換わった旨の説明文に名前が出るのは許す)、`grep -n "13 目的" docs/spirits-managed-pi-design.md` が 1 行以上出る
- [x] 8.4 `packages/spirits/README.md` の設定キーに `models.normal`、`models.thinking.normal`、`models.thinking.strong`、`models.steps.<name>.role`、`models.steps.<name>.thinking` を追う。検証: `grep -n "models.normal\|models.thinking\|models.steps" packages/spirits/README.md` が 5 行以上出る
  - d-verify1 C-7 / W-2: README 247 行は `models.normal` / `models.strong` に「`provider/id` の文字列、または `{ provider, modelId }`」と書くが、読み取りは文字列だけで、オブジェクト形式は黙って無視される(status は「models.strong is not set」と出す)。オブジェクト形式の記述を削除する。追加検証: `! grep -n "{ provider, modelId }" packages/spirits/README.md`
  - d-verify5 G-1: README の解決順(252 行)「ロールについて ステップ設定 → ステップの既定ロール → セッションのロック → `models.role`」の 4 つ目の矢印が、spec にも実装にも無い。`resolveRequestRole`(`src/routing/plan.ts:26-28`)は `ステップの設定 ?? phaseRole` で、`phaseRole` にはロックか `step.defaultRole ?? lock` が入る(`src/commands/role-panel.ts:280,514`)。`models.role` は `session_start` のロック初期化(`src/routing/register.ts:232-238`)と `src/index.ts:158` のフォールバック phase でしか読まない。spec の `dual-model-routing` は「ステップの設定、ステップの既定ロール、セッションのロックの順」とし、「全体の既定ロール (`models.role`) とは別物」と明記している。
    - 修正: 「ステップ設定 → ステップの既定ロール → セッションのロック(起動時に `models.role` から初期化)」に直す。同じ表の `models.role` の行(246 行「ロックの既定」)とは矛盾していない。
  - 追加検証: `! grep -n "セッションのロック → " packages/spirits/README.md`

## 9. 統合確認

- [x] 9.1 `npm run check` がエラー・警告・情報なしで通ることを確認する。検証: `npm run check`(フル出力)と `cd packages/spirits && bun run check`(CI の `spirits-ci.yml` と同じ。ルートの check は spirits を除外するので、両方を実行する)。d-verify1〜d-verify5 の修正後に再実行する
  - d-verify4 S-2: d-verify3 の修正後、ルートの check は通ったが、`packages/spirits` の `tsc --noEmit` は型エラー 3 件で失敗していた(2.5 の d-verify4 C-1)。今までの 9.1 の検証コマンドは spirits を検査していなかった。
- [x] 9.2 `cd packages/spirits && bun test` がすべて通ることを確認する。検証: `cd packages/spirits && bun test`。d-verify1〜d-verify5 の修正後に再実行する。これはタスクごとの検証の代わりにはならない(9.6)
- [x] 9.3 管理バイナリの対話 TUI で `/spirits-role` の一覧を開き、ロック切替・モデル選択・ステップの 2 段選択・`status`・警告を実観測する。手順は `.pi/skills/interactive-testing.md`。検証: `scripts/tmux-verify.sh run --session role-panel -- ./dist/spirits-linux-x64 --approve` を背景で起動し、`/spirits-role` を送って一覧を開いた画面を `tmux capture-pane -t "=role-panel:" -p` で取り、キャプチャに一覧の行(ロック、2 ロールのモデルと thinking、ステップ)と選択行の解決結果(直近の物理モデル名)が出ていること、`strong` のモデル行の候補に `compat-fake/fake-strong` が出て `spirits/auto` が出ないこと、`scripts/tmux-verify.sh check --session role-panel` が clean であること
  - 実観測は隔離 HOME の管理ルート(`/tmp/spirits-env`、公式 Pi 1.5.0 + overlay + 作業ツリーの拡張バンドル)で行った。`./dist/spirits-linux-x64` は実 `~/.spirits/agent` の設定を書き換え実プロバイダを叩くため、ユーザーの判断で隔離環境に切り替えた。手順は同じ(`scripts/tmux-verify.sh run --session role-panel` 経由、`scripts/tmux-verify.sh check` は clean)。観測した物: 一覧の行(ロック、2 ロールの model・thinking、15 ステップの 2 段 = `(n/35)`) / `status` の 8 行 / `/model spirits/auto` + プロンプト後のロック行の説明が `Last request: normal on openrouter/moonshotai/kimi-k2.6 at medium.` と直近の物理モデルを名指す / model 候補 537 件に `spirits/auto` は無く末尾は `unset back to unset` / 名前空間に空白のある `Local/Qwen3.8 Flash Next` が候補に出る / 閉じた時に 1 回だけ reload される / 不正リファレンスは `Warning: no model matches` + 使用法 / starter の無いステップの行は `This session has none of its starter commands.` / 物理モデル選択中のロック切替は通知を出さず、ロック行の説明に `routing is off while a physical model is selected` が出る
  - 実観測で見つかった不具合 2 つをここで直す。(1) submenu の `Escape` が一覧へ戻さず画面ごと閉じていた。`openRolePanel` が `SettingsList` の submenu に `ctx.ui.custom()` の `done` を渡していたためで、pi-tui が渡す `done` を通すようにした。これに合わせてステップの 2 段目は自前の入れ子 Component(`stepSubmenu`)をやめ、pi-tui 自身の `done(undefined, { navigateTo: "step:<name>.thinking" })` に乗せた(2 段目の `Escape` で thinking は変わらず、role の書き込みだけ残ることを実測)。(2) ロック行の説明が `…No request since the last reload.routing is off…` と隙間なく連結していた
  - 観測できなかった項目 2 つ。`strong` の候補に `compat-fake/fake-strong` が出る、は互換 fixture のフェイクプロバイダが居る環境でのみ成立する観測で、実プロバイダの隔離環境では `provider/id` の候補そのものと `spirits/auto` が候補に無いことで確認した。`models.strong` を使えないモデルにする、はコマンド面が登録済みの利用可能なモデルしか受け付けない(`anthropic/claude-sonnet-4-5` は `Warning: no model matches` で弾かれた)ため、この環境では状態自体を作れない。未登録・未認証の対象は unit test(`the lock row says when strong has nothing to run on` と status の test)で覆う
  - d-verify1 追加観測(5.3 / 5.4 の修正後のバイナリで行う): 各行の候補を開いて `Escape` を送ると値を変えずに一覧へ戻ること。利用できるモデルが 0 件の環境で model 行の案内を `Escape` で閉じられること。ステップの行でロールを選ぶと thinking の候補が続けて開き、2 段目の `Escape` で thinking が変わらないこと。`models.strong` を使えないモデルにした状態で strong の行の説明に「使えない旨と代わりに応答するモデル」が出ること。物理モデル選択中にロックを変えても通知は出ず、ロックの行の説明に振り分けが働いていない旨が出ること
  - d-verify2 追加観測(5.3 / 5.4 / 5.6 の修正後のバイナリで行う):
  - d-verify2 追加観測の実測(作業ツリーからビルドした拡張を `/tmp/spirits-env` の管理ルートで `scripts/tmux-verify.sh run --session role-panel` 経由。測った拡張 sha256 `004747801210…`)。一覧は 20 行で `(1/20)`、ステップは 1 行 `<role> / <thinking>`(例 `opsx-propose  strong / max`)。ステップの行で Enter → ロール候補(`normal` / `strong` / `unset  back to unset`)→ 確定すると同じ行の thinking 候補(`off`…`max` / `unset`)が続けて開き、2 段目で `Escape` すると thinking は変わらず role の書き込みだけが `settings.json` に残った(`opsx-propose` が `strong` → `normal`、thinking は `max` のまま)。`/spirits-role strong model unset` のあとに一覧の `opsx-continue` を strong にすると、その行の説明が `Runs strong, which you set. It answers with openrouter/moonshotai/kimi-k2.6. It asks for max. It continues after its run, until a role lock, /spirits-clear, or another step. strong has no usable model, so these requests run normal. set one with /spirits-role strong model <provider/id>.` となり、警告が同じ行に出た。ロック行の説明は `A continuing step ends on a role lock or on /spirits-clear.` を常に出す。モデル候補は 536 件で `spirits/auto` は含まれず、末尾は `unset  back to unset`。候補一覧で `Escape` すると値を変えずに一覧へ戻る。物理モデル選択中に一覧でロックを normal → strong にすると通知は出ず、ロック行の説明に `routing is off while a physical model is selected; select spirits/auto to put this to work.` が出て、footer の badge は閉じる前に `[strong]` へ変わった。一覧を閉じると reload が 1 回 `(Reloaded keybindings, extensions, skills, prompts, themes, and context files)`。`/spirits-role status` は routing / lock / step / last request / 両ロール / step settings を 1 件に出した。`compat-fake/fake-strong` の候補と「設定済みだが使えない strong」は隔離環境では作れないので、前者は候補に `spirits/auto` が無いこと、後者は unit test で覆う。`scripts/tmux-verify.sh check` は clean。実測後に `settings.json` は元の値(role normal、strong=`my_hyper/deepseek-v4.1-flash-1017`、`opsx-propose`=strong)へ戻した。
    - 一覧のステップが 1 ステップ 1 行で、値が `<role> / <thinking>` であること。全体は 20 行(ロック 1、2 ロールの model・thinking 4、15 ステップ)で、スクロールの表示は `(n/20)` になる。上の実観測の `(n/35)` は 2 行時代のもの。
    - ステップの行で Enter を押してロールを確定すると、同じ行の thinking の候補が開くこと。2 段目の `Escape` で thinking が変わらず一覧へ戻ること。
    - strong 未設定のまま一覧でステップを strong にしたとき、その行の説明に strong 未解決の警告が出ること。
    - ロックの行の説明に `/spirits-clear` でステップを終えられる旨が出ること。
  - d-verify3 の注記: 上の実測の「`opsx-continue` を strong にすると … It asks for max.」は、行の文言だけを記録しており、実際のリクエストのレベルと突き合わせていない。その時点の設定次第では C-1 そのもので、記録からは判定できない(冒頭の規則の「実観測は実際のリクエストの値と突き合わせる」を足した理由)。
  - d-verify3 追加観測(2.5 / 3.7 / 5.3 / 5.4 の修正後のバイナリで行う):
    - `thinking.normal=low`、`thinking.strong=max`、strong のモデル未設定で、一覧の `opsx-propose` を strong にする。行の説明が `It asks for low` を示すこと。続けて `/opsx-propose` で 1 リクエスト走らせ、ロックの行の `Last request: normal on <model> at low` と、行の説明のモデルとレベルが一致すること。行の文言だけを見て判定しない。
    - `/opsx-propose` で 1 リクエスト走らせ、`/spirits-clear` の後に `/tree` で 2 つの記録のあいだへ移ると、`/spirits-role status` の step が `opsx-propose` を示すこと。`/opsx-propose` より前へ移ると `step: none` を示すこと。
    - 実測(2026-11-13、作業ツリーの bundle sha256 `3d8c29b00b77…`、隔離環境 `/tmp/spirits-env`)。`models.normal` / `thinking.normal=low` / `thinking.strong=max` / strong 未設定にし、一覧で `opsx-propose` を strong にすると行の説明は `It answers with openrouter/moonshotai/kimi-k2.6. It asks for low.` と strong 未解決の警告を出した。`/opsx-propose` の 1 リクエスト後、`status` は `last request: normal on openrouter/moonshotai/kimi-k2.6 at low` と `step: opsx-propose (continuing) runs strong` を出し、行の説明と一致した。`/spirits-clear` の後に `/tree` で step 記録より後・clear 記録より前のノードへ移ると、移動直後と設定変更の reload 後のどちらも `step: opsx-propose` だった。step 記録より前のノードはこの経路のツリー UI に現れない(system ノードは step 記録の子)ため、`step: none` への移動は unit test(`a tree move to a branch with no open step ends the step`)で覆う。`scripts/tmux-verify.sh check` は clean。
- [x] 9.4 Pi 上流の差分ゼロを確認する。検証: `git diff --name-only main...HEAD -- packages/coding-agent packages/tui` が空
- [x] 9.5 (d-verify1 で追加)spec 外の差分を整理する。d-verify1 W-5: `src/routing/resolve.ts:47` の `findModel` の比較の左右入れ替えと、`isVirtual` のコメントの整形を元に戻す。`src/constants.ts` の `THINKING_LEVELS` の上に重複している JSDoc を 1 つにする。d-verify1 G-1: `src/routing/phase.ts:107` の未使用の `stepForStarter` を削除する。検証: `grep -n "model.id === modelId" packages/spirits/src/routing/resolve.ts` が出る、`! grep -n "stepForStarter" packages/spirits/src/routing/phase.ts`、`npm run check`
- [x] 9.6 (d-verify3 で追加。C-2 の原因の除去)tasks.md に挙げたすべての `bun test <file> -t "<name>"` を 1 件ずつ実行し、全件が exit 0 で、1 件以上 pass であることを確かめる。`bun test` 全体の成功では代えない。
  - 手順: tasks.md の各行から `bun test test/<file>.test.ts` と、それに続く `-t "<name>"` の組を抜き出す(ファイルを書かない `-t` は、同じ行の直前のファイルを使う)。`cd packages/spirits && bun test <file> -t "<名前を正規表現としてエスケープしたもの>"` を順に実行する。抜き出しは一時スクリプト(`/tmp` か scratchpad)で行い、終わったら消す。
  - 検証: 失敗が 0 件。実行した件数と失敗の一覧を実装の報告に載せる。d-verify3 の時点では 93 件中 1 件(8.2 の `records the status report as a role purpose`)が失敗した。d-verify4 の時点では 105 件すべて成功した。d-verify5 の時点では 200 件すべて成功した。d-verify5 の修正後(5.4 の 2 件を足す)は 202 件すべて成功した
  - 抜き出しは「同じ行の直前のファイル」を使うので、検証の名前を書く行には `bun test test/<file>.test.ts` も書く。名前だけの行は抜き出しから漏れる
- [x] 9.7 (d-verify3 で追加。W-1 の原因の除去)design の Risks の各対策が、どのタスクで実装・検証されるかを下の表で確かめる。Risks に項目を足したときは、同じ作業でこの表に行を足す。
  - 検証: 表に空欄が無く、対応するタスクがすべてチェック済みであること

| design の Risks の項目 | 対策を実装・検証するタスク |
|---|---|
| 継続ステップの取り違え | 4.1(usage)、4.3(status)、5.3(ロックの行) |
| パネルが拡張ごとクラッシュする | 5.3(theme と行の必須値)、5.4(編集中の例外を一覧の中に出す。d-verify3 W-1。例外時のロックの行と badge。d-verify4 C-2。badge と行の読み戻しが失敗したときの行の値・badge・reload。d-verify5 W-1) |
| routing 層のハンドラは両経路で共有される | 3.7(`session_tree` の登録を managed 経路に限る。フォーク経路のテスト。d-verify4 C-4) |
| 解決の再合成による食い違い | 2.5、5.3 |
| 分岐間の移動で位相と記録が食い違う | 3.7 |
| 補完項目の形式 | 4.6 |
| reload で位相が二重化される | 3.4 |
| パネル書き込みと Pi の既定値の競合 | 1.2 |
| パネルのモデル一覧 | 5.4 |
| 既定ロールの強い切替 | 1.1(既定ロールの表)、4.1(`unset` でロック追従に戻せる) |
| マトリクスの観測不能 | 8.2 |
| `/spirits-model` の即削除 | 8.3 |
| 書き込み直後の設定読み取り | 4.4、5.4 |
| 一覧から抜けられない | 5.4 |
| 直近のリクエストの消失 | 4.3、8.3 |
| 互換ランナーが作業ツリーを測らない | 8.2 |
| 既定の開閉キーが端末に届かない | 7.1、7.2、7.3 |

- [x] 9.8 (d-verify4 で追加。S-1 の原因の除去)delta spec のすべてのシナリオを、それを検証するテストに対応させる表を、変更ディレクトリの `scenario-coverage.md` に作り、全件を機械的に検査する。
  - 背景:
    - spec はタスクの完了後(tasks のチェックは 14:22、spec の更新は 14:41)に 5 シナリオを足したが、どのタスクも戻されず、apply の対象にならなかった。
    - d-verify4 の時点で、delta spec(ADDED と MODIFIED)の 183 シナリオのうち 114 件は、名前がどのテストのコメントにも出てこない。対応の無いシナリオを見つける手段が無かった。
  - 表の形: `| spec | Scenario | 検証 |`。「検証」は次のどちらか。
    - `bun test test/<file>.test.ts -t "<name>"`
    - `manual: <タスク番号>`(実端末の観測など。7.3、9.3)
    - 既存の挙動を検証する既存テストがあれば、その名前を書く(新しいテストは要らない)。無ければ、冒頭の規則 3 に従ってテストを作る。
  - 手順:
    1. `specs/*/spec.md` の ADDED / MODIFIED 節から `#### Scenario:` を抜き出す。REMOVED 節は除く。
    2. 表の行と 1 対 1 で照合する。
    3. 表の `bun test` を 1 件ずつ実行する。
    4. 抜き出しと実行は一時スクリプト(scratchpad か `/tmp`)で行い、終わったら消す。
  - spec を変えたときは、同じ作業で表に行を足し、該当タスクを未完了に戻す(冒頭の d-verify4 の規則 1)。
  - 検証: 次をすべて満たす。実装の報告に、シナリオの件数、`bun test` の件数、`manual:` の件数を載せる。
    - 表に無いシナリオが 0 件。
    - 表にあって spec に無い行が 0 件。
    - 表の `bun test` がすべて exit 0 で、1 件以上 pass。
    - `manual:` の行のタスクがすべてチェック済み。

## Workflow follow-up

- 2026-11-12: d-verify1(`d-verify1.md`)の指摘を反映し、3.2 / 3.4 / 4.3 / 4.4 / 5.1 / 5.3 / 5.4 / 7.2 / 8.2 / 8.3 / 8.4 / 9.1 / 9.2 / 9.3 を未完了に戻し、9.5 を追加した。各タスクの「d-verify1」の小項目が修正内容。S-3(ステップの 2 段選択は実装をシナリオに合わせる)、S-4(コマンドは全変更で警告、一覧は行の説明)、W-4(直近のリクエストの消失は制約として文書化)は利用者が決定済み。修正後は深い検証を再検証モード(前回レポート: `d-verify1.md`)で実行する。
- 2026-11-13: d-verify5 の修正を apply で実装し、5.4 / 8.3 / 8.4 / 9.1 / 9.2 / 9.6 / 9.7 を完了に戻した。W-1 は `openRolePanel` の `write` を「書き込みの失敗」と「成立後の読み戻しの失敗」に分け、行の値を書いた値から直接作り、badge を `phase.lock()` だけで描くようにした(`RolePanelHooks.sessionLock`)。W-2 / W-3 / G-1 は文書のみ。検証は 9.6 の 202 件成功、`cd packages/spirits && bun test` が 1269 pass / 0 fail、`cd packages/spirits && bun run check` と `npm run check` が成功、互換ランナーの fixture が confirmed=33 / not-run=3 / failed=1(`rlm child abort` の既存)で完走。
- 2026-11-13: d-verify5(`d-verify5.md`)の指摘を反映し、5.4 / 8.3 / 8.4 / 9.1 / 9.2 / 9.6 / 9.7 を未完了に戻した。CRITICAL は 0 件。各タスクの「d-verify5」の小項目が修正内容で、W-1(一覧の読み戻しが失敗したときに行・badge・reload がセッションとずれる)だけ実装とテスト、W-2 / W-3 / G-1 は文書のみ。spec は変えていないので `scenario-coverage.md` の行は増えない。
- 2026-11-13: 検証レポートの名前を付け替えた。通常の verify(`/opsx:verify`)は `verifyN.md`、深い検証は `d-verifyN.md` とする。旧 `verify2.md`(深い検証)は `d-verify1.md` に、旧 `verify3.md`(通常の verify)は `verify2.md` にした。このファイルと design の「d-verify1」は旧 verify2 を指す。
- 2026-11-13: 深い検証 d-verify2(`d-verify2.md`。突き合わせた通常の verify は `verify2.md`)の指摘を反映し、3.1 / 3.4 / 4.1 / 4.3 / 4.5 / 4.6 / 5.3 / 5.4 / 5.6 / 8.2 / 8.3 / 9.1 / 9.2 / 9.3 を未完了に戻した。修正内容は各タスクの「d-verify2」の小項目にある。S-1(一覧のロックの行は保存に失敗しても適用後のロックを示す)と C-5(status の観測行を実装する)は利用者が決定済み。spec は managed-commands(要件「一覧のロックの行は保存に失敗してもセッションのロックを示す」を追加)、dual-model-routing(シナリオ「開き直したセッションでは後の再読み込みでも復元しない」を追加)、managed-pi-compatibility(「role の記録」に status を追加)を、design は D11 と D12 を改めた。修正後は深い検証を再検証モード(前回レポート: `d-verify2.md`)で実行する。
- 2026-11-13: 深い検証 d-verify3(`d-verify3.md`。通常の verify との突き合わせは無し)の指摘を反映し、4.2 / 5.3 / 5.4 / 8.2 / 8.3 / 9.1 / 9.2 / 9.3 を未完了に戻し、2.5 / 3.7 / 9.6 / 9.7 を追加した。修正内容は各タスクの「d-verify3」の小項目にある。S-1(spec の文言を「ID に空白を含む」に直す。解決規則は変えない)と W-2(分岐間の移動ではステップを移動先の記録に合わせる)は利用者が決定済み。spec は managed-commands(シナリオ「空白を含むモデル参照」の文言、要件「一覧の説明の thinking レベルは要求に載るレベルを示す」とシナリオ 2 件を追加)と dual-model-routing(要件「分岐間の移動ではステップを移動先の記録に合わせる」)を、design は V11、D7、D11、D12、D15(新設)、Risks を、proposal はステップの継続の項を改めた。修正後は深い検証を再検証モード(前回レポート: `d-verify3.md`)で実行する。
  - 同じ種類の不備が 3 回の深い検証で繰り返したので、原因を次のとおり特定し、冒頭の「チェックと検証の規則」、2.5、9.6、9.7 で取り除く。
  - 原因 1: 一覧が解決を自前で組み立てている。
    - 経緯: d-verify1 C-11、d-verify2 C-2、d-verify3 C-1 は、どれも「一覧の説明がルーターの結果と食い違う」不具合である。指示(design D11、d-verify2 の推奨)は、呼ぶべき関数の名前を並べただけだった。「strong が落ちたら応答するロールは normal で、thinking も normal で解決する」という組み立て方は、ルーターの中(`createRoutingRoute`)にしか無い。関数を並べ直すたびに、その組み立ての一部が抜ける。
    - テストも防げなかった: 一覧のテストの期待値は実装者が手で書いており、strong が使える条件しか試していなかった。9.3 の実観測も行の文言だけを記録し、実際のリクエストのレベルと突き合わせていない。
    - 除去: 組み立てを 1 つの純関数にし(2.5、design D15)、ルーターの戻り値との突き合わせで検証する(冒頭の規則 4 と 5)。
  - 原因 2: 完了の判定に、タスク自身の検証コマンドを使っていない。
    - 経緯: d-verify2 C-4 と d-verify3 C-2 は、どちらも tasks の `-t` の名前が実在しない。実装の報告は `bun test` 全体の成功(1241 pass)を完了の根拠にしているが、全体の実行は `-t` の名前を照合しない。名前の規則は冒頭の 1 文にしか無く、機械的に確かめる手順が無かった。d-verify2 の反映で足した名前で、同じ不備が繰り返した。
    - 除去: チェックの条件を「タスクの検証コマンドを 1 件ずつ実行して成功したとき」にし(冒頭の規則 1 と 2)、全件の機械的な確認を 9.6 に置く。
  - 原因 3: design の Risks の対策がタスクになっていない。
    - 経緯: W-1 の「`onSelect` の例外を捕まえる」は design の Risks にだけ書かれ、実装者が追うタスクには無かった。
    - 除去: Risks の対策とタスクの対応表を 9.7 に置き、Risks を足すときは表も足す。
  - 原因 4: シナリオのテストが、シナリオそのものではなく近い操作を検証している。
    - 経緯: W-3 は構文解析だけ、W-4 は `spirits/auto` の画面だけ、W-5 は unset → strong → high(シナリオは strong / low → unset → high)。tasks がテスト名だけを指定し、どのシナリオのどの入力を使うかを書いていなかった。
    - 除去: シナリオの GIVEN / WHEN をそのまま使う規則を冒頭に置き(規則 3)、新設するテストにシナリオ名を添える。
  - 原因 5: 位相が読む分岐を変えるイベントの洗い出しが足りない。
    - 経緯: design V7 は `session_start` の reason だけを調べ、分岐間の移動(`session_tree`)で `getBranch()` の結果が変わることを扱っていなかった(W-2)。
    - 除去: V11 として事実を足し、D12 に移動時の規則を書いた(3.7)。
  - 原因 6: spec の語が、観測環境の事情から不正確に書かれた。
    - 経緯: 9.3 の環境ではモデルの ID 自体に空白があり、それを design D7 と spec で「表示名」と書いた(S-1)。
    - 除去: 解決規則に合わせて「ID」に直した。
  - 検証側の反省: d-verify2 の C-2 の推奨も関数名を並べただけで、何と何を突き合わせれば決着するか(ルーターの戻り値)を示していなかった。d-verify2 の probe も、thinking を設定しない条件しか試していない。以後の検証の推奨には、比べる対象と条件を書く。
- 2026-11-13: 深い検証 d-verify4(`d-verify4.md`。通常の verify との突き合わせは無し)の指摘を反映した。
  - 2.5 / 3.7 / 5.3 / 5.4 / 9.1 / 9.2 / 9.6 / 9.7 を未完了に戻し、9.8 を追加した。修正内容は、各タスクの「d-verify4」の小項目にある。
  - S-1(tasks と design を spec に追従させる)と S-2(spirits の型検査を検証に加える)は、利用者が推奨どおりに決定済み。
  - design は D11、D12、D15、Risks を改めた。spec と proposal は変えていない。今回の不備は、spec の記述ではなく、spec に tasks と design が追従していなかったことにあるため。
  - 修正後は、深い検証を再検証モード(前回レポート: `d-verify4.md`)で実行する。
  - d-verify3 で原因 1〜6 を除いた後も、同じ種類の不備が 4 回目の検証で残った。d-verify3 の除去策が届かなかった理由と、新しい原因を次のとおり特定し、冒頭の「d-verify4 の原因分析で追加した規則」と 9.8 で取り除く。
  - 原因 7: spec の変更が tasks に届く経路が無い。
    - 経緯: d-verify3 の反映の後、tasks の全件がチェックされた(14:22)。その後(14:41)に、spec へ 5 シナリオと MUST が足された。
      - 「ロックの記録の追記が例外を投げる」
      - 「ロールのモデルの行とロックの行もルーティングと一致する」
      - 「一覧に無いステップ名の記録へ移る」
      - 「移動の後に badge を描き直す」
      - 「フォーク経路の移動ではステップが続く」
    - どのタスクも戻されず、design にも書かれなかった。apply は tasks の未完了だけを見るので、やることが無いと判断する。C-2〜C-4 と W-1 は、すべてこの 5 シナリオから出た。
    - d-verify3 の規則 3(シナリオ名をテストのコメントに書く)は、テストを書くときの規則で、テストが無いシナリオを見つけない。実際に 183 シナリオのうち 114 件は、名前がどのテストにも出てこない。
    - 除去: シナリオとテストの対応表と、その全件の機械的な検査(9.8)。spec を変えた作業で tasks を戻す規則(冒頭の d-verify4 の規則 1)。
  - 原因 8: 検証コマンドが、CI の合格条件を見ていない。
    - 経緯: 2.5 で `plan.ts` を入れたときに型エラーが入った(C-1)。1.4 / 5.7 / 6.1 / 9.1 / 9.5 の検証は、ルートの `npm run check` を使う。ルートの `tsconfig.json` は `packages/spirits/**` を除外しているので、ルートの check は通った。一方、CI(`spirits-ci.yml`)は `packages/spirits` で `bun run check` を実行するので落ちる。
    - これは d-verify3 の原因 2(検証コマンドが本当の合格条件を照合していない)と同じ形だが、`-t` の名前ではなく、型検査の範囲で起きた。d-verify3 の除去策(`-t` の全件の個別実行)は、名前の照合に限っていた。
    - 除去: 型検査は CI と同じコマンドで行う(冒頭の d-verify4 の規則 2)。9.1 の検証に `bun run check` を足した。
  - 原因 9: 失敗の注入点が、本当に失敗する場所と違う。
    - 経緯: d-verify3 W-1 のテスト `an exception in an edit stays inside the list` は、`RoleWriteDeps.lockRole` をまるごと置き換えて投げさせた。本物の `lockRole` は、`phase.setRole()` の後に `pi.appendEntry()` を実行する。追記が失敗した時点で、セッションはもう新しいロックにある。テストはこの順序を通らないので、ロックの行と badge のずれ(C-2)を検出できなかった。
    - d-verify3 の推奨も「try/catch で囲み、理由を行に出す」だけで、「失敗の後にロックの行と badge がセッションのロックと一致するか」という比べる対象を書いていなかった。
    - 除去: 失敗はホストの境界(`FakePi`)で注入し、本物の配線を通す(冒頭の d-verify4 の規則 3)。
  - 原因 10: 再利用した関数の、想定外の値の扱いが要件と違う。
    - 経緯: `followStepRecord` は、名前を `restoreStep` にそのまま渡した。`restoreStep` は再読み込み用の関数で、一覧に無い名前を無視する(何もしない)。要件は終えることを求める。テストは、要件が列挙する値の種類(ステップ名 / `null` / 記録なし / 一覧に無い名前 / 読み取れない値)のうち、2 種類しか持たなかった(C-3)。
    - 除去: 列挙された種類ごとに 1 ケースを持つ。再利用する関数の想定外の値の扱いを、要件と照らす(冒頭の d-verify4 の規則 4)。
  - 原因 11: 共有される層の変更を、片方の経路でしか考えていない。
    - 経緯: design V11 と D12 は managed 経路の記録(`spirits_step`)だけを前提に書かれた。`session_tree` のハンドラは、両経路で共有される routing 層に、経路を区別せずに登録された。テストも managed 経路(`withoutRoleApi`)だけで書かれた(C-4)。`routing-register.test.ts:186` の期待値は、フォーク経路でハンドラが増えたことを「正しい」として固定した。
    - 除去: routing 層の変更は両経路でテストする(冒頭の d-verify4 の規則 5)。design D12 と Risks に経路を明記した。
  - 検証側の反省:
    - d-verify3 の W-2 の推奨(「`session_tree` で処理する」)は、どの経路で、どの値の種類を扱うかを書かなかった。
    - d-verify3 は spec の更新(14:41)より前に行ったので、後から足されたシナリオを見ていない。
    - 以後の深い検証は、成果物の更新時刻を比べて、tasks のチェックより後に spec が変わっていないかを最初に確かめる。
- 2026-11-13: verify3(通常の verify)の指摘を反映した。テストの THEN を検証していない 3 警告と、対応表の参照先 4 件を直した。3.4 / 4.1 / 4.3 / 4.5 / 5.3 / 5.5 / 9.1 / 9.2 / 9.6 / 9.8 を未完了に戻した。追加・更新したテストは、`a reload keeps the continuing step` の reload 後リクエスト、`a changed step setting reaches the next request after a reload`、`a role lock records the session entry and saves the default role` のモデル・thinking 不変、`a saved role target is one string a reloaded read returns`、`an argumentless command opens the list without changing anything`、`reports a mixed-case step key as ignored` の読み取り側。`scenario-coverage.md` の対応先を、空モデルの構文テストから保存テストへ、分岐移動からステップ設定の読み取りへ、行の必須値から一覧を開くテストへ直した。
- verify(`openspec verify` / 外部レビュー)を通過してからアーカイブする。アーカイブ時に `models.steps` の語彙とステップ一覧、既定の開閉キーが本仕様へ同期されるか確認する。
- 一覧の行順と文案は、実装時に管理バイナリの対話 TUI で画面を確認して決める。
