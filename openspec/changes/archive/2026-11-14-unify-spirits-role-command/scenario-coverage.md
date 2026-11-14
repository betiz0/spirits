# Scenario coverage

`specs/*/spec.md` の ADDED / MODIFIED 節の全シナリオと、それを検証するテストの対応表。
`bun test` の行は `cd packages/spirits` から実行する。`manual:` の行は実端末の対話観測で確認したもの。

| spec | Scenario | 検証 |
| --- | --- | --- |
| managed-commands | 公式 Pi では専用コマンドを使う | `bun test test/managed-commands.test.ts -t "registers only spirits-role and spirits-clear on an official host"` |
| managed-commands | role API が有るホストでは登録しない | `bun test test/routing-register.test.ts -t "uses the existing role registration when available"` |
| managed-commands | 引数なしは表示だけ | `bun test test/managed-role-panel.test.ts -t "an argumentless command opens the list without changing anything"` |
| managed-commands | 現在のモデルのまま strong にする | `bun test test/managed-role-command.test.ts -t "a role lock records the session entry and saves the default role"` |
| managed-commands | 実行中の run に直ちに効く | `bun test test/routing-integration.test.ts -t "applies a role locked during a target skill run to the rest of that run"` |
| managed-commands | 物理モデルを選択していてもロックは残る | `bun test test/routing-register.test.ts -t "locks the default role without recording it when a physical model is selected"` |
| managed-commands | Pi の書き込みと交互に書く | `bun test test/managed-commands.test.ts -t "a settings write keeps the keys it was not told about, including pi's own"` |
| managed-commands | ステップ 1 件の変更でほかのステップが残る | `bun test test/managed-commands.test.ts -t "a step write keeps the sibling steps"` |
| managed-commands | 未設定へ戻すとキーが消える | `bun test test/managed-commands.test.ts -t "unset deletes only the named key"` |
| managed-commands | 別プロセスとの同時書き込み | `bun test test/managed-commands.test.ts -t "two processes that write different fields both land, and the file stays readable"` |
| managed-commands | 制御文字を含む role は描画しない | `bun test test/managed-commands.test.ts -t "the badge prints the role on one line, and a role that leaves nothing prints nothing"` |
| managed-commands | strong で走ったあとは strong を出す | `bun test test/routing-integration.test.ts -t "the badge shows the role that answered the request"` |
| managed-commands | role を選んだときに描画する | `bun test test/managed-role-command.test.ts -t "a role lock draws the badge before the reload"` |
| managed-commands | 再読み込み後に再描画する | `bun test test/routing-phase-reload.test.ts -t "the badge and status match the phase restored across a reload"` |
| managed-commands | 限定向けの文書 | manual: 8.3 |
| managed-commands | 名称に仮想を示す語を含まない振り分け用モデル | `bun test test/managed-role-command.test.ts -t "the routing model is never a role target"` |
| managed-commands | 通常モデルは対象に残る | `bun test test/managed-role-command.test.ts -t "the routing model is never a role target"` |
| managed-commands | 一覧の候補も api 値で除く | `bun test test/managed-role-panel.test.ts -t "the model row drops every virtual model by its api"` |
| managed-commands | ロールのモデルを設定する | `bun test test/managed-role-command.test.ts -t "resolves a role model reference"` |
| managed-commands | 空白を含むモデル参照 | `bun test test/managed-role-command.test.ts -t "resolves and saves a model whose id has spaces"` |
| managed-commands | ステップのロールと thinking を設定する | `bun test test/managed-role-command.test.ts -t "a step setting writes only its own key path"` |
| managed-commands | 未設定へ戻す | `bun test test/managed-commands.test.ts -t "unset deletes only the named key"` |
| managed-commands | 解釈できない入力は変更しない | `bun test test/managed-role-command.test.ts -t "leaves everything alone on an unparseable line"` |
| managed-commands | 一覧に無い語は設定を変更しない | `bun test test/managed-role-command.test.ts -t "leaves everything alone on an unparseable line"` |
| managed-commands | 大文字小文字を区別しない | `bun test test/managed-role-command.test.ts -t "every word matches without regard to case"` |
| managed-commands | 項目を省略したステップ指定 | `bun test test/managed-role-command.test.ts -t "an omitted item or an empty value is a usage"` |
| managed-commands | 空のモデル参照 | `bun test test/managed-role-command.test.ts -t "an omitted item or an empty value is a usage"` |
| managed-commands | provider 付きの完全一致 | `bun test test/managed-role-command.test.ts -t "resolves a role model reference"` |
| managed-commands | 部分一致が 1 件 | `bun test test/managed-role-command.test.ts -t "resolves a role model reference"` |
| managed-commands | 解決できないモデル参照では変更しない | `bun test test/managed-role-command.test.ts -t "refuses a reference that matches no model"` |
| managed-commands | 曖昧なモデル参照では変更しない | `bun test test/managed-role-command.test.ts -t "refuses an ambiguous reference"` |
| managed-commands | 保存されたロールの対象が次のセッションで効く | `bun test test/managed-commands.test.ts -t "a saved role target is one string a reloaded read returns"` |
| managed-commands | 再読み込み後に古いハンドルを使わない | `bun test test/managed-role-command.test.ts -t "reloads last"` |
| managed-commands | 設定の書き込みが失敗する | `bun test test/managed-role-command.test.ts -t "keeps the session lock when the settings write fails"` |
| managed-commands | 一覧の開閉 | `bun test test/managed-role-panel.test.ts -t "opens the list on a terminal"` |
| managed-commands | 開始コマンドが無いステップ | `bun test test/managed-role-panel.test.ts -t "marks a step whose starters are absent"` |
| managed-commands | 対話端末以外では一覧を開かない | `bun test test/managed-role-panel.test.ts -t "shows status outside the tui"` |
| managed-commands | 使えない対象の行は代わりに応答するモデルを出す | `bun test test/managed-role-panel.test.ts -t "an unusable target row names the model that answers"` |
| managed-commands | ステップの既定ロールで走っている間もロックの行はロックを出す | `bun test test/managed-role-panel.test.ts -t "the lock row shows the lock during a strong-default step"` |
| managed-commands | strong が落ちるステップの行は normal のレベルを示す | `bun test test/managed-role-panel.test.ts -t "a step row names the level its requests carry when strong falls back"` |
| managed-commands | 使えない strong の thinking レベルの行 | `bun test test/managed-role-panel.test.ts -t "the strong thinking row names the level a fallback carries"` |
| managed-commands | ロールのモデルの行とロックの行もルーティングと一致する | `bun test test/routing-request-plan.test.ts -t "the model row and the lock row agree with the route"` |
| managed-commands | ロックの切り替え | `bun test test/managed-role-panel.test.ts -t "an edit writes through the same settings path"` |
| managed-commands | ロールのモデルを一覧で変える | `bun test test/managed-role-panel.test.ts -t "the model row offers the available models without the routing model"` |
| managed-commands | 利用できるモデルが無ければ書き込まない | `bun test test/managed-role-panel.test.ts -t "an empty model list writes nothing"` |
| managed-commands | 閉じるときに 1 回だけ再読み込む | `bun test test/managed-role-panel.test.ts -t "reloads once on close"` |
| managed-commands | 書き込みの失敗後は表示が戻る | `bun test test/managed-role-panel.test.ts -t "a failed write restores the row"` |
| managed-commands | ステップの 2 段選択 | `bun test test/managed-role-panel.test.ts -t "the two stages from strong low to unset high"` |
| managed-commands | ステップの 2 段目を Esc で閉じる | `bun test test/managed-role-panel.test.ts -t "escape on the second stage keeps the thinking level"` |
| managed-commands | 候補の一覧を Esc で閉じる | `bun test test/managed-role-panel.test.ts -t "escape closes a choice list without writing"` |
| managed-commands | 候補が空の案内を Esc で閉じる | `bun test test/managed-role-panel.test.ts -t "escape closes the empty model notice"` |
| managed-commands | ロックの保存が失敗する | `bun test test/managed-role-panel.test.ts -t "a failed lock save keeps the session lock on the row"` |
| managed-commands | ロックの記録の追記が例外を投げる | `bun test test/managed-role-panel.test.ts -t "a lock record that fails to append keeps the row and the badge on the session lock"` |
| managed-commands | 振り分けが有効なときの全項目 | `bun test test/managed-role-status.test.ts -t "reports every field when routing is in force"` |
| managed-commands | 物理モデルを選んでいれば無効と出る | `bun test test/managed-role-status.test.ts -t "reports routing disabled on a physical model"` |
| managed-commands | 設定値の不正区別 | `bun test test/managed-role-status.test.ts -t "names the settings values routing ignores"` |
| managed-commands | 使えない normal の対象 | `bun test test/managed-role-status.test.ts -t "reports an unusable normal target with its reason and the model that answers"` |
| managed-commands | ステップの既定ロールで走っている間のロック | `bun test test/managed-role-status.test.ts -t "reports the lock, not the step default, during a strong-default step"` |
| managed-commands | 読めない strong の対象は未設定と区別する | `bun test test/managed-role-status.test.ts -t "reports an unreadable models.strong apart from unset"` |
| managed-commands | 再読み込みの直後 | `bun test test/managed-role-status.test.ts -t "says no request has run since the last reload"` |
| managed-commands | strong 未設定でロックする | `bun test test/managed-role-warning.test.ts -t "warns but keeps the lock"` |
| managed-commands | 対象が設定済みなら警告しない | `bun test test/managed-role-warning.test.ts -t "stays quiet when strong is usable"` |
| managed-commands | 物理モデル選択中に設定する | `bun test test/managed-role-warning.test.ts -t "says routing is off while a physical model is selected"` |
| managed-commands | 物理モデル選択中に thinking を設定する | `bun test test/managed-role-warning.test.ts -t "says routing is off on any setting change while a physical model is selected"` |
| managed-commands | strong の対象を設定した直後は strong 未設定と言わない | `bun test test/managed-role-warning.test.ts -t "does not warn about strong right after setting the strong model"` |
| managed-commands | 一覧での編集は行の説明で伝える | `bun test test/managed-role-panel.test.ts -t "a list edit on a physical model sends no notice"` |
| managed-commands | 1 語目 | `bun test test/managed-role-completion.test.ts -t "offers the vocabulary of the first word"` |
| managed-commands | 2 語目に項目名 | `bun test test/managed-role-completion.test.ts -t "offers the item names of the second word"` |
| managed-commands | 3 語目にロール名とレベル | `bun test test/managed-role-completion.test.ts -t "offers the value words of the third word"` |
| managed-commands | モデル参照は補完しない | `bun test test/managed-role-completion.test.ts -t "offers no model candidates"` |
| dual-model-routing | 通常ステップは normal | `bun test test/routing-router.test.ts -t "routes normal outside a strong phase"` |
| dual-model-routing | 2 つのスキルは strong | `bun test test/routing-phase.test.ts -t "enters strong for the change review skill command"` |
| dual-model-routing | ステップ設定が既定とロックより優先される | `bun test test/routing-step-settings.test.ts -t "prefers the step role over the step default and the lock"` |
| dual-model-routing | 表に無いコマンドではステップが始まらない | `bun test test/routing-phase.test.ts -t "ignores other skill commands and plain input"` |
| dual-model-routing | 起動後の最初のリクエストは strong | `bun test test/routing-integration.test.ts -t "runs normal, then strong during the skill, then normal after settle"` |
| dual-model-routing | 対象外のスキルでは遷移しない | `bun test test/routing-integration.test.ts -t "keeps normal across a non-target skill run"` |
| dual-model-routing | 展開されないスキルコマンドでは遷移しない | `bun test test/routing-phase.test.ts -t "ends the skill name at the first space like pi"` |
| dual-model-routing | SKILL の読み取りだけでは遷移しない | `bun test test/routing-phase-wiring.test.ts -t "reading a skill file without input changes no phase"` |
| dual-model-routing | テンプレートとスキルで同じステップ | `bun test test/routing-phase.test.ts -t "a template and a skill start the same step"` |
| dual-model-routing | ステップからステップへ移る | `bun test test/routing-phase.test.ts -t "ends the step on a starter of another step"` |
| dual-model-routing | 回答の run もステップのロール | `bun test test/routing-phase.test.ts -t "a continuing step survives settle"` |
| dual-model-routing | 始まらなかったスキル実行を持ち越さない | `bun test test/routing-phase-wiring.test.ts -t "does not carry a strong phase into the next run when the skill run never started"` |
| dual-model-routing | run が始まらなかった継続ステップを持ち越さない | `bun test test/routing-phase.test.ts -t "drops a continuing step whose run never started"` |
| dual-model-routing | ロック中の入力はロックを解除しない | `bun test test/routing-integration.test.ts -t "keeps the locked role across a plain input run"` |
| dual-model-routing | 次のコマンドでロックへ戻る | `bun test test/routing-phase.test.ts -t "ends the step on a skill that is not listed"` |
| dual-model-routing | クリアでステップが終わる | `bun test test/routing-phase.test.ts -t "ends the step on clear"` |
| dual-model-routing | 正常終了後に戻る | `bun test test/routing-integration.test.ts -t "runs normal, then strong during the skill, then normal after settle"` |
| dual-model-routing | 中断後も戻る | `bun test test/routing-phase.test.ts -t "a non-continuing step returns to the lock at settle"` |
| dual-model-routing | 失敗しても戻る | `bun test test/routing-phase-wiring.test.ts -t "phase returns to normal when settle follows a failed input handler"` |
| dual-model-routing | ロックしたロールへ戻る | `bun test test/routing-integration.test.ts -t "keeps the locked role across a target skill run"` |
| dual-model-routing | 新規セッションではステップが消える | `bun test test/routing-phase.test.ts -t "ends the step on a new session"` |
| dual-model-routing | 既定モデルが normal になる | `bun test test/routing-resolve.test.ts -t "resolves the default model as normal"` |
| dual-model-routing | 指定が失われたら既定へ寄せる | `bun test test/routing-router.test.ts -t "notifies once per run when the configured normal target is unusable"` |
| dual-model-routing | 既定モデルを失ったら直近のモデルで続ける | `bun test test/routing-router.test.ts -t "notifies once when falling back to the previous model"` |
| dual-model-routing | どちらも無ければエラーで終わる | `bun test test/routing-router.test.ts -t "ends the request with an error when there is no normal target"` |
| dual-model-routing | 振り分け用のモデルを既定にしている | `bun test test/routing-resolve.test.ts -t "skips a virtual default and falls back to the previous model"` |
| dual-model-routing | normal の対象の指定が効く | `bun test test/routing-resolve.test.ts -t "resolves the configured normal target"` |
| dual-model-routing | strong の直後に既定を失った | `bun test test/routing-resolve.test.ts -t "falls back to the previous model when the default is unresolvable"` |
| dual-model-routing | 復帰後にロールが戻る | `bun test test/managed-commands.test.ts -t "a resumed session takes the lock back from its entries before showing the badge"` |
| dual-model-routing | 分岐ごとにロールを持つ | `bun test test/managed-commands.test.ts -t "each branch answers with the role it recorded"` |
| dual-model-routing | 旧形式の記録はロール未決定 | `bun test test/managed-commands.test.ts -t "a fork record without a role inherits nothing, so the configured default stands"` |
| dual-model-routing | 読み取れない記録はロール未決定 | `bun test test/managed-commands.test.ts -t "a record with a role that is not a word decides nothing"` |
| dual-model-routing | 既定ロールで開始する | `bun test test/pi-runtime/routing-record-pin.test.ts -t "pi reads the routing record spirits writes under its own entry type"` |
| dual-model-routing | 物理モデルで開始するときは記録しない | `bun test test/routing-register.test.ts -t "locks the default role without recording it when a physical model is selected"` |
| dual-model-routing | 復帰では既定ロールを記録しない | `bun test test/routing-register.test.ts -t "does not record the default role when resuming"` |
| dual-model-routing | 振り分けの失敗では記録を更新しない | `bun test test/routing-register.test.ts -t "reports no role when the routing itself fails"` |
| dual-model-routing | 再読み込みではロックを引き継ぐ | `bun test test/managed-role-command.test.ts -t "a reload restores the step the session recorded"` |
| dual-model-routing | 物理モデルを指定してロックする | `bun test test/routing-register.test.ts -t "locks the role a /model selection reports"` |
| dual-model-routing | 物理モデルで設定したロールが振り分け開始後に効く | `bun test test/routing-register.test.ts -t "locks the default role without recording it when a physical model is selected"` |
| dual-model-routing | spirits/auto を選んだままロックする | `bun test test/routing-register.test.ts -t "locks the role a /model selection reports"` |
| dual-model-routing | normal に戻す | `bun test test/routing-register.test.ts -t "locks the role a /model selection reports"` |
| dual-model-routing | ロック設定だけではバッジが変わらない | `bun test test/routing-register.test.ts -t "locks the role a /model selection reports"` |
| dual-model-routing | 振り分け用のモデルの選択解除ではロックが消えない | `bun test test/routing-register.test.ts -t "keeps the lock across a physical model selection"` |
| dual-model-routing | 分岐間の移動ではロックを維持する | `bun test test/routing-register.test.ts -t "keeps the lock across a branch move"` |
| dual-model-routing | 再読み込みでは既定ロールに戻る | `bun test test/routing-register.test.ts -t "returns to the default role on reload"` |
| dual-model-routing | run の実行中に指定したロールは直ちに効く | `bun test test/routing-integration.test.ts -t "applies a role locked during a target skill run to the rest of that run"` |
| dual-model-routing | strong 位相の子は strong の対象 | `bun test test/rlm-child-model.test.ts -t "a strong phase child is spawned on the strong target"` |
| dual-model-routing | normal 位相の子は既定モデル | `bun test test/routing-child-model.test.ts -t "resolves a normal phase child to the default model"` |
| dual-model-routing | 子の thinking レベルは親の run と同じ解決 | `bun test test/routing-child-model.test.ts -t "the child takes the run's thinking level"` |
| dual-model-routing | strong が使えなければ黙って normal の対象 | `bun test test/routing-child-model.test.ts -t "falls back to the normal target without a notice"` |
| dual-model-routing | 既定モデルを失った子は直近の成功レスポンス | `bun test test/routing-child-model.test.ts -t "falls back to the latest successful response"` |
| dual-model-routing | 直近の成功レスポンスに資格情報が無い | `bun test test/routing-child-model.test.ts -t "refuses a latest successful response without credentials"` |
| dual-model-routing | 子の対象がどちらも使えない | `bun test test/routing-child-model.test.ts -t "names the roles tried and the settings that are missing"` |
| dual-model-routing | 物理モデルを選ぶ親は振り分けない | `bun test test/routing-child-model.test.ts -t "leaves a physical parent selection untouched"` |
| dual-model-routing | 設定変更は次の子から反映する | `bun test test/rlm-child-model.test.ts -t "a strong target change reaches the next child while the phase stays strong"` |
| dual-model-routing | provider 付きの指定が効く | `bun test test/routing-resolve.test.ts -t "resolves the configured normal target"` |
| dual-model-routing | provider を省略した指定 | `bun test test/routing-resolve.test.ts -t "resolves a bare strong id against the default provider"` |
| dual-model-routing | 不正な値は未設定扱い | `bun test test/config.test.ts -t "unreadable routing settings fall back to unset"` |
| dual-model-routing | ロールの thinking が選択値より優先される | `bun test test/routing-router.test.ts -t "carries the resolved thinking level"` |
| dual-model-routing | strong が落ちれば normal のレベル | `bun test test/routing-thinking.test.ts -t "strong fallback uses the normal level"` |
| dual-model-routing | どちらも未設定なら選択値 | `bun test test/routing-thinking.test.ts -t "resolves the level by step, then role, then session"` |
| dual-model-routing | 語彙に無い値は未設定 | `bun test test/routing-thinking.test.ts -t "role thinking level reads only known levels"` |
| dual-model-routing | 物理モデル選中は thinking レベルを変えない | `bun test test/routing-thinking.test.ts -t "leaves the level alone on a physical model selection"` |
| dual-model-routing | role だけ指定されたステップ | `bun test test/routing-step-settings.test.ts -t "a step that sets only a role still answers at a level"` |
| dual-model-routing | 一覧に無いステップ名 | `bun test test/routing-step-settings.test.ts -t "ignores an unknown step name"` |
| dual-model-routing | 不正な値は未設定 | `bun test test/routing-step-settings.test.ts -t "ignores a role that is not a word in the vocabulary"` |
| dual-model-routing | 綴りの違うステップ名 | `bun test test/managed-role-status.test.ts -t "reports a mixed-case step key as ignored"` |
| dual-model-routing | 設定変更の再読み込みをまたぐ | `bun test test/routing-phase-reload.test.ts -t "a reload keeps the continuing step"` |
| dual-model-routing | ステップ設定のロールを badge に出す | `bun test test/routing-phase-reload.test.ts -t "a reload draws the badge from the step setting"` |
| dual-model-routing | 復帰では復元しない | `bun test test/routing-phase-reload.test.ts -t "a resume drops the step"` |
| dual-model-routing | 開き直したセッションでは後の再読み込みでも復元しない | `bun test test/routing-phase-reload.test.ts -t "a reopened session restores no step on the next reload"` |
| dual-model-routing | 終わったステップは再読み込みで復元しない | `bun test test/routing-phase-reload.test.ts -t "a reload after the step ended restores nothing"` |
| dual-model-routing | 再読み込み中の設定変更は継続中のステップに次から効く | `bun test test/routing-phase-reload.test.ts -t "a changed step setting reaches the next request after a reload"` |
| dual-model-routing | 終えたステップの手前へ移る | `bun test test/routing-phase-reload.test.ts -t "a tree move follows the step record of the new branch"` |
| dual-model-routing | ステップの記録より前へ移る | `bun test test/routing-phase-reload.test.ts -t "a tree move to a branch with no open step ends the step"` |
| dual-model-routing | 一覧に無いステップ名の記録へ移る | `bun test test/routing-phase-reload.test.ts -t "a tree move to an unlisted step record ends the step"` |
| dual-model-routing | 移動の後に badge を描き直す | `bun test test/routing-phase-reload.test.ts -t "a tree move redraws the badge"` |
| dual-model-routing | フォーク経路の移動ではステップが続く | `bun test test/routing-register.test.ts -t "a fork-route tree move keeps the step"` |
| managed-pi-compatibility | role の記録 | `bun test test/managed-pi-compat-matrix.test.ts -t "records the status report as a role purpose"` |
| managed-pi-compatibility | thinking level の記録 | `bun test test/managed-pi-compat-matrix.test.ts -t "the thinking level is the level the provider received"` |
| managed-pi-compatibility | model の記録 | `bun test test/managed-pi-compat-matrix.test.ts -t "records the session model selection apart from the role target"` |
| managed-pi-compatibility | 公式 /model の既定保存は観測できない | `bun test test/managed-pi-compat-matrix.test.ts -t "model default save and the settings list are never read as unavailable"` |
| managed-pi-compatibility | 対話端末専用 UI の観測 | `bun test test/managed-pi-compat-matrix.test.ts -t "model default save and the settings list are never read as unavailable"` |
| managed-pi-compatibility | clear の記録 | `bun test test/managed-pi-compat-matrix.test.ts -t "clear purposes are observed separately"` |
| managed-pi-compatibility | コマンド一覧に依存しない判定 | `bun test test/managed-pi-compat-matrix.test.ts -t "command list absence does not decide unavailability"` |
| managed-pi-compatibility | 行の状態は目的観測から導出する | `bun test test/managed-pi-compat-matrix.test.ts -t "rows are derived from purpose observations"` |
| managed-pi-compatibility | 行と目的の状態の一致 | `bun test test/managed-pi-compat-matrix.test.ts -t "matrix validation requires alternatives for unavailable rows"` |
| architecture-conventions | src の deep import は失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "boundary: src deep import fails"` |
| architecture-conventions | bin の許可リスト外の deep import は失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "boundary: bin deep import outside the allowlist fails"` |
| architecture-conventions | bin の許可リストにある deep import は通る | `bun test test/architecture-conventions.fixtures.test.ts -t "boundary: bin allowlisted deep import passes"` |
| architecture-conventions | 使われていない bin の許可リストの要素は失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "boundary: unused bin allowlist entry fails"` |
| architecture-conventions | bare specifier は通る | `bun test test/architecture-conventions.fixtures.test.ts -t "boundary: bare specifier passes"` |
| architecture-conventions | routing の packages/tui は例外文でも通らない | `bun test test/architecture-conventions.test.ts -t "routing may not import pi-tui"` |
| architecture-conventions | 許可表に載った向きは通る | `bun test test/architecture-conventions.fixtures.test.ts -t "spirits: rlm to repl passes"` |
| architecture-conventions | commands から packages/tui は通る | `bun test test/architecture-conventions.test.ts -t "commands may import pi-tui"` |
| architecture-conventions | routing から packages/tui は失敗する | `bun test test/architecture-conventions.test.ts -t "routing may not import pi-tui"` |
| architecture-conventions | 兄弟層への依存は失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "spirits: harness to todo fails"` |
| architecture-conventions | 兄弟層への依存は先の層が前段でも失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "spirits: harness to rlm fails"` |
| architecture-conventions | エントリ経由の間接依存の入口は失敗する | `bun test test/architecture-conventions.fixtures.test.ts -t "spirits: rlm to entry fails"` |
| session-todo | 既定キー | `bun test test/todo-widget.test.ts -t "ショートカットで折りたたみと展開が切り替わる"` |
| session-todo | 既定キーは修飾キーを報告しない端末でも届く | manual: 7.3 |
| session-todo | 設定ファイルでの変更 | `bun test test/extension-degradation.test.ts -t "設定ファイルの todo.toggleKey でショートカットが登録される"` |
| session-todo | 設定ファイルが環境変数より優先される | `bun test test/config.test.ts -t "設定ファイルの開閉キーが環境変数より優先される"` |
| session-todo | 環境変数での変更 | `bun test test/config.test.ts -t "設定ファイルの開閉キーが環境変数より優先される"` |
| session-todo | 設定ファイルの値が構文として解釈できない | `bun test test/config.test.ts -t "設定ファイルの開閉キーが構文不正なら環境変数を使う"` |
| session-todo | すべての候補が構文として解釈できない | `bun test test/config.test.ts -t "すべての候補が構文不正なら既定値"` |
| session-todo | 読めない設定ファイル | `bun test test/extension-degradation.test.ts -t "設定ファイルが無くても manage_todos とパネルが登録される"` |
| session-todo | 設定の変更は `/reload` で反映される | `bun test test/extension-degradation.test.ts -t "設定ファイルの変更は再読み込みまで反映されない"` |
| session-todo | 記号の基底キー | `bun test test/config.test.ts -t "記号の基底キーを受け付ける"` |
| session-todo | 大文字と前後の空白 | `bun test test/config.test.ts -t "大文字と前後の空白を正規化する"` |
| session-todo | 存在しないキー名 | `bun test test/config.test.ts -t "存在しないキー名はそのまま採用する"` |
| session-todo | 既定キーは shift を含まない | `bun test test/config.test.ts -t "the default todo toggle key"` |
| session-todo | 利用者は条件を満たさないキーも設定できる | `bun test test/extension-degradation.test.ts -t "設定ファイルの todo.toggleKey でショートカットが登録される"` |

シナリオ 183 件 / `bun test` 181 件 / `manual:` 2 件。
