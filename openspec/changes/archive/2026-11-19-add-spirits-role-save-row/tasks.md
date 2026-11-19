# Tasks

## 1. 保存判定と共通書き込み

- [x] 1.1 `role-write.ts` に予告と確定が使う保存判定を置く。ロックと物理モデル、`spirits/auto` と有効な `models.normal`、旧既定だけ、成功履歴だけ、project だけ、provider 省略・対象が利用不可、モデル未選択を `managed-role-command.test.ts` の `save checks normal against the prospective global defaults without history` と `save plans a physical model or a role without a model` で検証する。比較は `readSettingsFile` の生値と `readRoutingSettings` の trim 済み値を混ぜず、空白付きの既定値も差分として扱う。
- [x] 1.2 `settings-store.ts` の既存のファイルロックとマージを再利用し、global の現在値をロック下で比較して決めたパッチを1回だけ書く。`managed-commands.test.ts` で `a conditional save leaves an unchanged file untouched`（バイト列と mtime）、`a conditional save uses the latest global settings`（プレビュー後の別書き込みと無関係キー）、`a save patch lands the role and model pair together`（`lastChangelogVersion`、`models.normal`、`models.steps` の保持、モデルを見送ったときの2キーの保持）を検証する。ファイルが無いときもロックを先に取得し、書き込む内容が無ければ作らない。
- [x] 1.3 `role-write.ts` に両入口が共用する保存操作を追加し、`RoleWrite` が複数の変更パスを返すようにする。`RolePanel.edit()` と `register.ts` の設定変更後警告もこの結果へ揃える。`managed-role-command.test.ts` の `save distinguishes a write, no change and failure` でパッチの回数と更新結果を確認し、通常変更の回帰を `managed-role-command.test.ts`、`managed-role-panel.test.ts`、`managed-role-warning.test.ts` で検証する。`SaveDecision` は `decideSave` の戻り値としてだけ使い、export しない。
- [x] 1.4 `save` の安全判定を現在のセッションのカタログから切り離す。保存後の global settings と、global の設定・資格情報・カタログだけで normal を解決できる場合にだけモデルの2キーを書き、project の拡張が登録した provider や起動時だけ追加されたモデルでは書かない。由来取得不能ならモデルを保存せず、取得できた空一覧なら他の global 条件を評価する別ケースを検証する。`managed-role-command.test.ts` に `save refuses the routing model when only the project catalog can answer` と `a save from a project-only provider leaves the model keys alone` を追加し、固定版 Pi では project の拡張だけで provider を登録したフィクスチャから保存し、その provider の無い別 project で新規セッションの最初の normal 要求が解決できることを確認する。
- [x] 1.5 `save` の予告と確定の比較を Pi がファイルから読む生の値にする。`defaultProvider` / `defaultModel` の前後の空白を同一とみなさず、セッションの選択値で書き直す。`managed-commands.test.ts` に `a padded default provider is rewritten to the selected value`、`managed-role-command.test.ts` に `save compares the raw default values` を追加し、固定版で空白付きの既定値から保存した次のセッションが選択値を選ぶことを確認する。
- [x] 1.6 設定ファイルが無いときも同じパスのロックを先に取得し、ロック下で読んでから、書き込む内容があるときだけ作成する。ロック取得失敗ではファイルを作らない。`managed-commands.test.ts` に `a save with no settings file does not create one when the lock is held` と `two concurrent first saves keep both keys` を追加し、ロック保持中に `{}` が作られないこと、別プロセスの初回保存のキーが残ることを確認する。

## 2. コマンド、補完、通知

- [x] 2.1 `constants.ts` に共有語彙 `save` と save 行 ID を置き、一覧にだけ必要な区行 ID は一覧内で管理する。`constants-steps.test.ts` の `save does not collide with role or step words` で一意性を確認する。
- [x] 2.2 `role.ts` と `register.ts` で `save` の文法、使用法、補完を追加する。`managed-role-command.test.ts` の `save takes no item or value` で余分な引数の拒否と状態不変・大文字小文字無視を、`the usage names save` で一般の引数誤りにも `/spirits-role save` と項目・値を取らないことが載ることを、`managed-role-completion.test.ts` の `offers the vocabulary of the first word` と `offers nothing where the grammar has no more words` で `save` と後続候補なしを検証する。
- [x] 2.3 `register.ts` から共通の保存を呼び、結果通知・物理モデルで書き込んだ場合の既存警告を順に行い、`save` では再読み込みしない。`managed-role-command.test.ts` の `the save command reports and does not reload` と `saving in rpc and print uses the same settings but different notifications`、`a save that changed nothing is reported as information`、`an unselected model is not a physical model` で、変更なし・失敗は再読み込みなし、モデル見送りとロール保存を同時に通知、TUI・RPC の警告、print の通知なし、セッション・ステップ・記録不変を検証する。
- [x] 2.4 `constants.ts` の `SETTINGS_KEY_ENABLED_MODELS` は差分内に参照が無いため、この変更から取り除く。`rg -n SETTINGS_KEY_ENABLED_MODELS packages/spirits/src packages/spirits/test` が 0 件であることと、スコープの判定が `ctx.scopedModels` だけを読むことを確認する。
- [x] 2.5 `register.ts` の引数なし `/spirits-role` の分岐を RPC と print で分ける。RPC は `status` を通知し、print は一覧も稼働状況も出力しない。`managed-role-command.test.ts` に `print prints no status for the argumentless command` を追加し、固定版 `-p '/spirits-role'` の stdout/stderr が空であることを確認する。

## 3. 一覧の操作行と実効状態

- [x] 3.1 行 ID を定め、use normal、use strong、save、区行、role lock の順に並べる。コマンド語彙は増やさない。constants-steps と managed-role-panel のテストで行順、空の区行、ロック・保存予定と見送り理由の予告を確認する。
- [x] 3.2 固定版 SettingsList で各操作行を独立に開き、確認 Enter だけが候補なしで作動することを検証する。Space、クリック、カスタム確定キーでは書かず右欄は空。通常行の選択・Esc は従来どおり。
- [x] 3.3 use の Enter を既存ロック→共通保存の順につなぐ。managed-role-panel.test.ts で両ロール、モデル見送り、差分なしを検証し、成功時は元の TUI 画面で合成結果を提示する。ロック記録または models.role 書込みの失敗では二段目を呼ばない。別ケースでは一段目を実ファイルへ書き、登録側 saveSettings で二段目だけ拒否する。両ケースで操作行の理由、実ロックと badge、ディスクの role・モデル、手動終了時 reload（先行成功なしは0回、一段目成功なら1回）を確認する。
- [x] 3.4 save 単独は成功・差分なしで閉じ、失敗時は開いたまま理由を行に残す。`managed-role-panel.test.ts` で再描画失敗後も `save` 行の理由が消えないこと、元の TUI で成功・差分なしが info、モデル見送り理由を読めることを確認する。`save` の書き込みが失敗した後で再描画の読取りも失敗したときは、通常の設定行に `not redrawn` を出し、`failSave` と `failRead` を同時に与えたケースで `save` 行の理由・通常行の `not redrawn`・`reloads` 0 回を固定する。通常の一覧編集のルーティング警告は通知に変えない。
- [x] 3.5 managed-role-status.test.ts と実ファイルで global の予告・確定通知と project の実効値を区別する。status は保存履歴を出さず、先行する通常編集なしの save は reload 0回、通常編集後の save / use は終了時1回。応答中に拒否させ、元の画面で保存済み・再読み込み未完了と通知、試行1回・再試行なし、保存結果維持を検証する。
- [x] 3.6 `save` が現在のセッションを読み直さないことを実装とテストで固定する。`managed-role-command.test.ts` の `save keeps the current lock and step` と `save does not change an unresolved step's lifetime` で、project の既定 role が外部で変わったセッションのロックが保存前後で同じこと、ルーティング未解決の継続ステップが保存後の次の入力で保存前と同じ規則で終わることを確認する。固定版 Pi の TUI でも、`opsx-propose` を開始した物理モデル選択中のセッションで保存後に `status` のロックとステップが変わらないことを確認する。
- [x] 3.7 `roleResolutionLines` は `models.normal` が読めない場合も、実際に応答するモデルを `target` に残し、診断を `source` に足す。`managed-role-panel.test.ts` の `an unreadable normal still names the answering model` と固定版 TUI の一覧で、`models.normal: 42` の行に読めない理由と Pi の既定モデルの両方が出ることを確認する。
- [x] 3.8 `SaveDecision` を `decideSave` の戻り値としてだけ使い、モジュール外へ export しない。`register.ts` の `readGlobalSettings` 差し替え口は Decision 5 にテスト用 seam として記録し、本番の既定が `globalSettingsPath()` の実ファイルであることをテストで固定する。`SaveDecision` の export と seam の利用箇所を `rg` で確認する。
- [x] 3.9 README 4言語と docs/spirits-managed-pi{,-design}.md を照合する。3操作行の順・Enter 制約・role lock との違い、成功・差分なしで復帰／失敗で残ること、保存結果と reload 拒否の通知、通常編集の reload、global-only 条件・provider/id・起動優先順位・RPC の個別通知と print 無出力を記し、互換マトリクスの行を増やさない。

## 4. 統合確認

- [x] 4.1 `bun run check`、`cd packages/spirits && bun test`、`bash scripts/test-clean-env.sh` をそれぞれリポジトリルートから実行し、すべて成功することを確認する。
- [x] 4.2 作業ツリーの拡張バンドルと固定版 Pi 1.5.0 を使用し、隔離 `HOME`・agent dir・project を用意して親の `PI_*` / `SPIRITS_*` を引き継がず、faux provider と専用 `settings.json` を使う。`scripts/tmux-verify.sh run --session <name> -- <起動コマンド>` で `use normal` / `use strong` / `save` の行順、Space/クリックではファイル不変・Enter でロックとモデルを保存して一覧が閉じ、閉じた後に結果がTUI 通知 で確認できること、失敗（ロック保持中の保存）では閉じずに理由が出ること、保存だけでは再読み込みせず `use` 行は閉じると再読み込みすることを確認する。無解決のときモデルの2キーを維持し理由を表示する。正常終了後は `scripts/tmux-verify.sh check --session <name>` で残留なしを確認する。クリックは fullscreen の SGR マウスで区行と各操作行の座標を押し、区行で選択が動くことと操作行でファイルが変わらないことを確認する。
- [x] 4.3 同じ固定版と隔離フィクスチャで、明示モデル・スコープ・project 上書きがない新規セッションは保存した `spirits/auto` を選び、ステップ外の最初の要求が保存した strong の対象で応答することを footer と faux provider の要求で確認する。別の新規セッションでは normal の最初の要求も成功すること、`--models` で `spirits/auto` を除外した起動では物理モデルが選ばれ、設定のスコープは変更されないこと、project の拡張だけが登録した provider では `spirits/auto` が保存されず別 project の要求が壊れないことを確認する。
- [x] 4.4 固定版 Pi の RPC `prompt` と print の `-p` で `/spirits-role save` を実行し、モードごとに初期設定を作り直して書き込み結果を比較する。RPC で use 相当の操作は既存2コマンドを送り、それぞれの通知を確認する。RPC は `extension_ui_request` の `notify` と `notifyType`、print は通知が stdout/stderr に出ないことと global ファイルで結果を確認する。保存成功・変更なし・モデル見送り・書き込み失敗を比較し、変更なしと成功が `error` にならないこと、応答中でも保存と通知が成立することを確認する。print の引数なし `/spirits-role` が一覧も稼働状況も出力しないことも確認する。
- [x] 4.5 `openspec validate add-spirits-role-save-row --strict` を実行し、既存要件名・既存シナリオを保持していることと、ADDED の名前が現行 spec にないことを照合する。

## 5. 検証で見つかった再発防止

- [x] 5.1 Fake の通知・呼び出し回数だけで済ませず、保存の実ファイルと固定版ホストの挙動を通す回帰テストを追加する。`managed-commands.test.ts` で条件付き書き込みが外部更新後のディスクを読むこと、`managed-role-command.test.ts` で TUI・RPC・print の通知と古いコンテキスト不使用、`managed-role-panel.test.ts` で `use` 行のロック→保存の順序・閉じる判定・再読み込み回数、`managed-role-status.test.ts` で保存後の実効値、固定版プローブで project 専用 provider・空白付き既定値・ロック保持中・応答中の保存を確認する。
- [x] 5.2 新たな短い重複を片付ける。`SettingChange` を `role-write.ts` の1か所に保ち、予告は `decideSave` が返す `writes` から既定モデル2キーの変更有無を読み、生値の比較を `describeSavePreview` にもう一度書かない（`role-write.ts` の `describeSavePreview` と `decideSave` の比較を1つにする）。テストのパッチマージは `settings-store` を直接駆動するか共通ヘルパーに寄せ、`restoredStepEntry` / `rejectedStepEntry` はステップ記録の分類を一度だけ行う。`managed-role-command.test.ts` と `managed-role-panel.test.ts` の該当ケース、`routing-phase-reload.test.ts` の復元・棄却ケースが通ることを確認する。
- [x] 5.3 `SaveDecision` の export と `readGlobalSettings` seam の扱いを Decision 5・6 に沿って確定する。export を外し、seam を残す場合はテスト用であることと撤回条件を design に記す。`rg -n "SaveDecision|readGlobalSettings" packages/spirits/src packages/spirits/test` の結果が意図した箇所だけであることを確認する。
- [x] 5.4 このスキルの再検証モードで、CRITICAL・WARNING・SPEC の各項目を再確認する。`openspec validate --strict`、Bun 全テスト、`test-clean-env.sh`、固定版 Pi の TUI・RPC・print の実測を再実行し、レポートの判定が PASS または PASS WITH WARNINGS になるまで繰り返す。

- [x] 5.5 保存がセッションのモデルスコープを変えないことを自動テストで固定する。`managed-role-command.test.ts` に、`ctx.scopedModels` を読まず、条件付きパッチに `enabledModels` を含めないことをパッチのキー集合で検証するケースを追加する。起動時のスコープ外モデルは隔離した固定版 Pi で確認し、その結果を tasks の Notes に残す。

- [x] 5.6 `ModelLookup.getRegisteredProviderIds` のシグネチャをホスト公開型から導出する。`packages/spirits/src/routing/resolve.ts` の手書き `() => readonly string[]` を `ExtensionModelRegistry["getRegisteredProviderIds"]` に置き換え、任意性だけをローカルに保つ。`ARCH-PI-BOUNDARY` の検査がこの形の写しを検出しないことを design か規約側の課題として記録する（規約を変える場合は正本と検査を同一変更で更新する）。

- [x] 5.7 `packages/spirits/src/commands/role-panel.ts` の `USE_ROW_PREFIX` を非公開にする。行 ID の綴りを外部契約にせず、`useRowId` / `useRowRole` だけを公開する。`rg -n "USE_ROW_PREFIX" packages/spirits/src packages/spirits/test` が定義1件だけになることを確認する。

## Workflow follow-up

- 先行 change `improve-spirits-role-routing-visibility` はアーカイブ・仕様同期済み。実装はその契約を基準に行う。
- ユーザーの依頼があってから仕様を同期し、アーカイブする。その際、delta が置換できない `openspec/specs/managed-commands/spec.md` の Purpose も既存の意味を残して更新し、モデル選択はホスト、現在の選択とロックの global 既定への一括保存は `save` と区別する。

## Notes

- 2026-11-18 の深い検証（verify2）の指摘を反映した。project 専用 provider で `spirits/auto` を保存できる経路、空白付き既定値を「変更なし」と判定する経路、設定ファイルをロック前に作る経路、`save` の再読み込みが現在のロック・ステップを変える経路、応答中に再読み込みが拒否される経路、保存結果が再描画失敗で消える経路、`save` が使用法に無い経路、読めない normal が応答モデルを隠す経路を、仕様・設計・タスクに追加した。実装は未修正で、該当タスクを未完了に戻した。
- 旧 UI の検証結果は過去の証跡に限る。レビュー後、節6の作業を節3に統合し、更新した実装→固定版確認→最終検証の順に整理した。
- `save` は次に始まるセッションの既定を書く操作とし、現在のセッションを読み直す再読み込みは行わない。通常の設定変更だけが従来どおり再読み込みする。この判断により、応答中の再読み込み拒否と、project 既定の変更・未解決ステップの寿命変化を避ける。
- `save` が使える normal の根拠は global の設定・資格情報・カタログだけに限る。ホストが provider の由来表示を公開していない間は、global 所有と確認できない provider を安全側で見送る（限定互換）。
- print の引数なし `/spirits-role` は一覧も稼働状況も出力しない。RPC は `status` を通知する。`save` の print 無出力と同じ出力契約に揃える。
- 成果物を更新した後、`openspec validate add-spirits-role-save-row --strict` は成功。実装後の最終確認でも成功し、MODIFIED 7 要件の既存シナリオが 1 つも漏れていないこと（delta に無い現行シナリオが 0 件）と、ADDED の名前が現行 spec に無いことを機械的に照合した。
- 操作行追加時点は ADDED 6 / MODIFIED 7。レビュー後は引数なしの既存ロック要件も MODIFIED に含むため、ADDED 6 / MODIFIED 8。
- 2026-11-19 verify2 の未完了項目を実装した。provider の由来が取得できない lookup はモデルの2キーを保存しない（安全側）。一覧は use normal / use strong / save / 区行の順になり、use は既存ロック→共通保存、成功または差分なしで閉じる。save は成立・差分なしで閉じ、失敗は開いたまま行に理由を残す。閉じた結果は TUI 通知で読み、reload 後は捕捉済みの UI オブジェクトから通知して reload に消されず stale ctx も踏まない。reload 拒否は保存済みと未完了を分けて通知する。cwd の README 4言語と docs 2件を更新した。
- 2026-11-19 固定版 Pi 1.5.0 と隔離フィクスチャで確認: 一覧の行順、Space/クリックでファイル不変、SGR マウス（tmux send-keys -H）で区行と use 行の選択が動くこと、use の Enter で role と既定モデルを保存して閉じ reload 1回、save は通知のみで reload 0回、ロック保持中の save は開いたまま理由、models.normal 無解決で既定2キー維持と理由通知、保存結果が reload 後も TUI 通知に残ること。RPC は成功/差分なし/見送り/失敗を個別 notify（見送り・成功は info、失敗は error）、use 相当の2コマンドも個別通知、print の save と引数なしは stdout/stderr 空で global ファイルのみ更新。遅い faux provider の応答中に RPC で save し、応答と通知が成立することを確認した。`scripts/tmux-verify.sh check` は clean。
- 2026-11-19 深い検証で 4.3 の起動条件を再測した。隔離した固定版 Pi 1.5.0 で session を `/spirits-role strong` → `/spirits-role save` すると global は `spirits/auto` / role strong になり、記録の無い新規セッションは `spirits/auto` を選び、ステップ外の最初の要求は faux provider の `fake-strong` で応答した。`/spirits-role normal` → `save` でも同じで、新規セッションの最初の要求は `fake-model`。`--models compat-fake/fake-model` で起動すると `compat-fake/fake-model` が選ばれ、`settings.json` のバイト列は変わらない。
- 2026-11-19 の深い検証（sprt-opsx-verify-deep）の指摘を反映した。`save` 失敗後の再描画失敗で通常行に `not redrawn` が出ない経路を 3.4 に戻して未完了にし、予告の比較重複を 5.2 に戻して未完了にした。新たに 5.5（スコープ不変の自動テスト）、5.6（ホスト公開型からの導出）、5.7（`USE_ROW_PREFIX` の非公開化）を未完了で追加した。design は通知順序を「reload 前に捕捉した UI へ reload 後に通知」に直し、Decision 6 に予告が `writes` から変更有無を読むことを、Decision 3 に資格情報の由来を区別しない既知の限界を記した。spec は生値比較の MUST を `defaultProvider` / `defaultModel` に限定し、`models.role` は spirits の正規化で比較してよいことを明記した。
- タスク 5.5: `managed-role-command.test.ts` の `save ignores the session scope and never patches enabledModels` で、`scopedModels` にアクセスすると失敗する context を save に渡し、パッチのトップレベルキーが既定モデル2キーと `models.role` だけで、`enabledModels` を含まないことを確認した。隔離した固定 Pi 1.5.0 の 4.3 起動プローブでは global の `spirits/auto` を `--models compat-fake/fake-model` が除外したとき、セッションは `compat-fake/fake-model` を選び、設定ファイルのバイト列は変わらないことを確認済み。これは起動スコープを save が拡張しないことの実機証跡。
