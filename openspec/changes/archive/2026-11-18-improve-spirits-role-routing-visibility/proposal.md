# Proposal

## Why

`/opsx-explore` を実行しても `/spirits-role` で設定した strong のモデルに切り替わっていない、という誤解が実運用で起きた。実測したセッションではステップの記録 (`spirits_step`) は書かれていたが、セッションのモデルが物理モデルのままだったため振り分け自体が走っていなかった。問題は振り分けのロジックではなく、**唯一の常時表示面である badge が振り分けの有無を述べていない**こと、**一覧の説明文が振り分けが走っていないときも「応答する」と断言している**こと、**警告文の「`spirits/auto` を選べ」という指示がモデルスコープ設定済みでは実行不能**なこと、**ステップを開始する瞬間に利用者が止まって直す機会が無い**ことにある。

あわせて、セッションを開き直したときに画面が開き直す前と違うことも同じ種類の誤解を生む。現状はロックだけが戻り、継続中だったステップは開いた時点で終わるので、strong のステップの途中で閉じたセッションを開くと、続きのリクエストは strong で走らない。

## What Changes

- **BREAKING** badge を「イベントで残る履歴」から「状態の射影」へ変える。値はルーティングと同じ解決から導出し、次のリクエストが実際に走るロール・要求する thinking レベル・応答する物理モデルをリクエスト前に言い当てる。記録されたロールを badge にそのまま描く経路は無くなる。
- badge を描き直す時点を、すべての入力、ホストの `model_select`、ホストの `thinking_level_select`、`/spirits-role` による変更、セッション開始、分岐移動、ステップの run が落ち着いたときに固定する。**badge の書き込み口は 1 本だけ**にし、ルーティング側の role 報告は badge の供給元ではなくなる (`status` の直近リクエストの供給のみ)。badge が示すロールはロックの写しではなく、そのロックと継続中のステップから解決した応答ロール (strong が使えなければ normal) とする。
- badge の語彙を確定する: 振り分けが有効な間は `[<role> <thinking>]` と別の status key に応答する物理モデル (provider を除いた ID、24 文字を超えたら 23 文字 + `…`)、振り分けが無効なときは `[off]` のみ (第 2 key は消す。ホストの footer が物理モデルとそのレベルを出しているため)、`normal` すら解決できないときは `[!]` のみ。
- **BREAKING** 物理モデル選択中にロックのロールを badge に描く現行挙動を廃止し、`[off]` に置き換える。
- **BREAKING** セッションの開始 (起動時の再開、復帰、分岐作成、再読み込み) では、分岐の記録からロックと継続中のステップを戻し、badge もその状態から描く。新規・復帰・分岐作成で継続中のステップを終える現行の規則は廃止する。ただし run の途中で閉じた継続しないステップは、再読み込み以外では戻さない。記録が無いときのロックは既定ロール (未設定なら normal) とし、managed-commands の記述を実装と揃える。
- **BREAKING** 一覧 (`/spirits-role` 引数なし) の説明文は、振り分けが無効なときはその状態と現在のモデルをすべての行の先頭に述べ、応答モデルの記述を仮定法に切り替える。ロールの対象の候補はその時点で利用できる物理モデル全部とし、セッションのモデルスコープで制限しない。
- **BREAKING** `status` は現在のモデル名を出し、`spirits/auto` がこのセッションのモデルスコープに含まれない場合はその事実を出す。対話端末では、実行可能な手順 (model selector で scope を `all` に切り替える、または `/scoped-models` で有効化する) も出す。
- 利用者が対話端末で送ったステップの開始コマンドについて、振り分けが無効で、そのステップに期待されるロール (明示のロールまたは thinking の設定、またはステップの既定ロール) があるなら、毎回 10 秒の確認を出す。何もしなければそのまま実行し、中止を選ぶか Esc で閉じれば入力を送らず、ステップを入力前の状態に戻す。拡張機能が送った入力と、確認を出せないときは待たずに進める。
- 文書: README と managed 経路の文書の badge および status 行の記述を新しい語彙に合わせ、開き直したセッションがステップを戻すことを記す。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `dual-model-routing`: ロール表示の Requirement を状態の射影として書き直し、物理モデル選択時の badge の記述を「出さない」から「`[off]` を出す」に改める。セッションの開始で終えていた継続中のステップを、分岐の記録から戻すように改める (ロールの記録と復元、strong フェーズからの復帰、再読み込みをまたぐロックと継続中のステップ)。分岐移動で描き直す badge の綴りを新しい語彙に合わせる。
- `managed-commands`: 記録が無いときのロックを既定ロールとする記述に揃える。badge の Requirement を描画時点・状態・status key の順序として書き直す。一覧の説明の振り分け無効時の定義と行の説明の並び、`status` に出す現在のモデルとスコープの診断、警告文の実行可能性、ステップ開始時の確認を追加する。

## Impact

- 実装: `packages/spirits/src/commands/role.ts` (badge の語彙と射影、`status` の整形、手順文の生成、設定時警告の文言)、`commands/register.ts` (badge 描画の一元化と振り分け無効のガード、`model_select` / `thinking_level_select` / `input` / `agent_settled` の購読、ステップ開始時の確認と rollback の世代管理、`status` 収集、セッション開始でのステップの復元と棄却の記録)、`commands/role-panel.ts` (振り分け無効時の説明文)、`routing/phase.ts` と `routing/register.ts` (入力で開始したステップを入力前へ戻す操作、セッション開始でステップを終える処理の撤去)、`routing/child.ts` (振り分け用モデルの判定を共有の関数へ置き換え)、`index.ts` (badge への role 報告の配線を外す)、`constants.ts` (badge の語彙、第 2 の status key、モデル名の桁上限、確認の待ち時間と時間切れを判定するタイマーを早める幅、振り分け用モデルかどうかの判定)。
- ホストの公開面への依存 (使う exports): `@earendil-works/pi-coding-agent` の `pi.on` の `input` / `model_select` / `thinking_level_select` / `session_start` / `session_tree`、`ExtensionContext.model`、`ExtensionContext.scopedModels`、`ExtensionContext.modelRegistry`、`ExtensionContext.thinkingLevel`、`ExtensionContext.mode`、`ExtensionContext.ui.setStatus` / `ui.notify` / `ui.select` (`timeout` と `signal`)、`InputEvent.source`、`pi.getSettings()`。ホストのソースへの差分は 0 のまま (新依存なし、`bun.lock` 不変)。
- 固定値・配布物への影響: `src/constants.ts` に badge の語彙、status key、モデル名の桁上限、確認の待ち時間とタイマーを早める幅、振り分け用モデルの判定を追加する。バイナリ、manifest、install.sh の形は変わらない。
- 振る舞いの境界: イベントが発行されない変更 (`enabledModels` の別プロセスからの変更、catalog refresh、provider の資格情報の増減) は、次の入力での描き直しと拡張の再読み込みで収束する。設定ファイルを手で編集した場合が badge に効くのは拡張の再読み込み後である旨を文書に残す。
- テスト: `managed-commands.test.ts` (badge の期待値が `[off]` と射影に変わる)、`managed-role-panel.test.ts` (badge の綴りの期待値と振り分け無効時の説明)、`managed-role-status`、`managed-role-warning`、`routing-register`、`routing-integration`、`routing-phase-reload` (badge の綴りと開き直したセッションのステップ)、`routing-phase` (入力前へ戻す操作)、`routing-child-model` (判定の置き換え)、`extension-degradation` (2 つの status key の独立)、`constants-steps`。テスト基盤は `test/routing/fake-pi.ts` の fake ctx に `scopedModels` と `mode` を、2 つのホストイベントの payload factory を足す。新規ファイルは無いのでアーキテクチャの baseline は不変。
