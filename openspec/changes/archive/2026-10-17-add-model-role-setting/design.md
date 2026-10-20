# Design

## Context

`/model` の処理は pi コアの `interactive-mode.ts` が所有する。`handleModelCommand(searchTerm?, persist?)`（同 5276 行）が `parseModelCommandArgs` を内部で呼び、`applyModelSelection` でモデルと thinking レベルを適用する。CTRL+s は `setupSaveKeyHook`（同 3252 行）が `handleModelCommand(searchTerm, true)` を呼ぶ。どちらの経路も `interactive-mode` 内部で完結し、拡張には届かない。

拡張の `input` イベントは `AgentSession._runInputHandlers`（`agent-session.ts:1958`）からしか発火しない。呼び出し元は prompt 経路（同 2034 行）と steer 経路（同 2224 行）の 2 箇所だけで、`/model` はその手前で消費される。したがって spirits は `input` イベントの transform で `/model` 引数を書き換えることはできない。

ロールの状態は spirits 側にある。`registerDualModelRouting` は `createRoutingPhase()` のクロージャを保持し、`RoutingPhase` は `current()` / `handleInput()` / `settle()` しか持たない。外部からロックを設定する口は無い。クロージャは拡張の読み込みごとに作り直されるので、`/reload` でその値は失われる。

バッジの値源は `AgentSession.routedRole` で、分岐に保存された `pi.virtual-model-state` entry の `role` を読む。entry は `agent-session.ts` が `route()` の結果から追記する。拡張 API には `appendEntry(customType, data)` と読み取り専用の `ctx.sessionManager` があり、同じ entry 型を追記できる。ただし entry は `state` も運ぶため、role だけを追記するとルータの状態を落とす。

`session_start` の reason は `startup` / `reload` / `new` / `resume` / `fork` で、分岐間の移動は別の `session_tree` イベントになる。

設定の拡張 API は `getSettings()` のみで、書き込み口は無い。pi の `Settings` 型に `models` フィールドは無く、pi は未知のキーを保持する（spirits の `models.strong` はそれで動いている）。`SettingsManager.persistScopedSettings` は `markModified(field, nestedKey)` で追跡した入れ子キーだけを書き戻す。

## Goals / Non-Goals

**Goals:**
- `/model <model-spec> [level] <role>` でモデルと同時にセッションのロールをロックする
- 保存キーで既定ロールを保存し、次のセッションの初期ロールにする
- 対象スキルの strong 遷移と、ロックの関係を 1 つの模型にまとめる

**Non-Goals:**
- 振り分けの割当表の変更（`add-dual-model-routing` のまま）
- 物理モデル選択中の振り分け（`spirits/auto` 選択時のみ、という制約は変えない）
- `/thinking` コマンドの拡張
- モデル selector の一覧・並びの変更
- ロックのセッションへの保存や分岐ごとの個別ロール

## Decisions

### Decision 1: ロール語彙は spirits が持ち、コアは登録された語彙で末尾語を切り出す

**選択**: pi コアは `/model` 引数の末尾語を、拡張が登録したロール語彙と照合して切り出す。切り出した値は語彙の表記（小文字）に正規化した opaque な文字列で、コアは比較以外に意味を解釈しない。語彙が登録されていなければ、コアは従来どおりロールを切り出さない。既存の `ModelRoute.role` と同じ規律である。

**理由**: `normal` / `strong` は spirits の語彙で、pi はルーティングの意味を知らない。コアに語彙を置くと、ロールを増やすたびにコアが変わり、上流追従の差分が増える。

**代替案**: コアの `parseModelCommandArgs` に `["normal", "strong"]` を直接置く。実装は最も少ないが、 spirits の語彙がコアに漏れ、 spirits を使わない pi に無意味な選択肢が出る。却下した。

### Decision 2: セッションのロールはロックとして扱う

**選択**: `/model` で指定したロールをセッションのロックとし、run の開始・終了や通常の idle 入力では元に戻さない。対象スキルの起動だけが一時的に strong へ遷移し、settle 後はロックへ戻す。ロックの初期値は既定ロール、既定ロールが無ければ normal。run の実行中に `/model` でロールを指定したときは、ロックと現在のロールを同時に置き換え、 strong フェーズの途中でもその run の以降のリクエストへ直ちに効かせる（`setRole` は `lock` と `role` を両方書く）。

**理由**: `add-dual-model-routing` の現行要件は idle 入力と settle で必ず normal へ戻す。このままでは `/model` で設定したロールが次の入力で消え、「normal / strong を固定したい」という目的を果たせない。

**代替案**: 設定したロールを次の idle 入力まで有効にする。現行要件を変えずに実装できるが、 1 回の入力で消えるので設定の意味が無い。run 単位の保持も検討したが、 2 run 以上の継続が決まらず、 固定という要求に答えない。却下した。run の実行中の指定を次の run まで遅らせる案は、 実行中の strong フェーズを保てるが、 phase に実行中の状態を持たせる必要があり、 利用者が明示した指定がすぐ効かない。却下した（利用者選択）。

### Decision 3: 未知の末尾語は検索語にフォールバックする

**選択**: 最後の語が thinking レベル名でもロール名でもない場合は、 引数全体をモデルの検索語として扱う従来動作を変えない。エラーにはしない。

**理由**: 現行の検索・ selector 経路（`handleModelCommand` → `findExactModelMatch` → `showModelSelector`）と矛盾しない。`/model claude sonnet` のような複数語の検索を壊さない。 誤字のロール名は黙って検索語になるが、 その場合は selector が開くので無反応にはならない。

**代替案**: 前段がモデルに完全一致するときだけ末尾語を検証してエラーにする。誤字を検出できるが、 検索語の扱いは「完全一致するか」に依存し、 selector 経由の経路と組み合わせた規定が増える。要件 1 つと Scenario 数行の増加分だけの価値は無いと判断した。

### Decision 4: 既定ロールは spirits 所有キー `models.role`

**選択**: 既定ロールは `models.strong` と同じ `models` の下、 `models.role` に保存する。キーの意味は spirits だけが知り、 pi は登録時に渡された入れ子キーとして書く（Decision 9）。spirits は `readRoutingSettings` で `models.strong` と同じ規則（非文字列・空は未設定）で読み、 大文字小文字を区別せずに `normal` / `strong` へ解決する。

**理由**: 同じ機能領域の spirits キーがすでに `models` の下にある。 pi の `Settings` 型に `models` を追加しない実装にすれば、 コアの型は spirits のキーを知らないままにできる。

**代替案**: pi コア所有のトップレベル `defaultRole` は、既存 `defaultThinkingLevel` と対称でコア側は素直だが、 spirits の語彙をコアの型に載せる。`Settings.models` を型として追加する案も、 コアが spirits の用途を知る点で同じ問題がある。却下した。

### Decision 5: 要求は `model-commands` と `dual-model-routing` に分け、新規 capability を作らない

**選択**: `/model` の構文・ selector・保存・補完・表示は `model-commands` の MODIFIED、 ロックと既定ロールの状態としての挙動は `dual-model-routing` の MODIFIED / ADDED に置く。`model-commands` の見出しは内容に合わせて RENAMED で改名する。

**理由**: 既存 spec と同じ粒度に載るので、 将来の MODIFIED が 1 箇所に当たる。`model-role-setting` を新規 capability にすると、 `/model` の仕様が 2 箇所に分裂し、 実際 delta の要求がすべて他の capability と重複した。

**代替案**: `model-role-setting` に寄せる案は、 `/model` の既存仕様を参照せず読める利点があるが、 重複の維持コストが上回る。却下した。

### Decision 6: バッジは記録されたロールのみを表示し、記録の無い新しいセッションだけ spirits が既定ロールを記録する

**選択**: バッジの値源は現状の `routedRole` のまま変えない。 `/model` でのロック設定はそれ自体ではバッジを変えない。記録の無い新しいセッション（`session_start` の reason が `new`、または `startup` で分岐に message entry が無いとき）の開始時に、 既定ロールが設定され現在のモデルが `spirits/auto` であれば、 spirits が `appendEntry("pi.virtual-model-state", …)` で role を追記してバッジに出す。復帰・分岐作成・再読み込み・分岐間の移動では追記しない。

**理由**: 既存 `model-role-badge` の「セッションにロールが記録されているとき」という規定を壊さない。コアの footer を変える必要が無い。追記を新しいセッションに限ると、 既存のセッションを開いただけでセッションファイルが書き換わることも、 分岐の途中に entry が増えることも無い。

**代替案**: 復元のたびに既定ロールで記録を埋める案は、 旧形式のセッションでもバッジが出るが、 開いただけのセッションと分岐の形を変える。記録されていないロールもバッジに出す案は、 footer が「表示用のロール」を別途持つことになり、 `model-role-badge` の MODIFIED を増やす。どちらも却下した。

判別に reason だけでは足りない。`main.ts` は起動時の runtime を `sessionStartEvent` 無しで作るため、 セッションを新規作成しても既存ファイルを開いても reason は `startup` になる。 逆に分岐が空でも足りない: pi は `session_start` を撃つ前に `--model` の適用で `model_change` と `thinking_level_change` を書き込むので、 新しいセッションの分岐はすでに 2 件ある。 「まだ何も要求されていない」を表す message entry の有無で判別する。

実装上の注意: `pi.virtual-model-state` entry は `state` も運ぶ。 role だけを追記すると `route()` に渡る `state` が undefined になり、 ルータの状態が飛ぶ。追記前に `ctx.sessionManager` で最新の entry を読み、 `state` を引き継がなければならない。新しいセッションには entry が無いので、 通常は引き継ぐ `state` も無い。

### Decision 7: 物理モデルでもロールを設定・保存する

**選択**: モデルの種別にかかわらず、 ロール指定があればセッションのロールをロックし、 保存キーでは既定ロールも保存する。振り分けは `spirits/auto` 選択時にのみ行うという既存の制約は変えない（利用者確認済み）。

**理由**: 物理モデルで一時的に強いモデルを選び、 あとで `spirits/auto` に戻す、 という流れでロールを引き継げる。 コアの `/model` 経路でモデルの種別を判定する必要がなく、 分岐が減り、 仕様も「種別にかかわらず」で一番短い。

**代替案**: 物理モデルではロールを無視する案は既存 spec と衝突しないが、 `/model <physical> strong` と `/model spirits/auto strong` で別扱いになり、 利用者が理由を理解できない。却下した。

### Decision 8: 補完は 2 語目にロール名を出し、保存表示に `Default role:` を加える

**選択**: `getThinkingLevelArgumentCompletions` が thinking レベルに加えて登録されたロール語彙を返し、 引数ヒントを `<provider/model> [level] [role]` にする。保存時の表示は既存の `Default model: … · Default thinking level: …` と同じ形式に `Default role: <role>` を足す。Enter 時の表示は変えない。

**理由**: 新しい末尾語を入力規則を知らないと使えない状態を避ける。表示形式は既存の保存表示と揃える。ヒントは level と role を併記できることを示す（Decision 11）。

**代替案**: 補完とヒントは触らない案は作業量最少だが、 機能が存在することが伝わらない。却下した。

### Decision 9: ロール語彙を登録する小さな拡張 API `registerModelRoles`

**選択**: 拡張 API に `pi.registerModelRoles(definition)` を追加する。

```ts
interface ModelRoleRegistration {
	/** Role words accepted as the last `/model` argument, lowercase. */
	roles: readonly string[];
	/** Global settings location the save key writes the default role to. */
	settingsKey: { field: string; key: string };
	/** Called after `/model` applied the model, whatever the model kind. */
	onSelect(role: string, ctx: ExtensionContext): void;
}
```

- コアは `parseModelCommandArgs(args, roles)` で末尾語を大文字小文字を区別せずに `roles` と照合し、 一致した語彙の表記を `role` として返す。
- `applyModelSelection` はモデル（と thinking レベル）を適用した後、 `role` があれば `onSelect(role, ctx)` を呼ぶ。selector 経由でも同じで、 キャンセル時は呼ばない。
- 保存キーでは、 コアが `SettingsManager.setExtensionNestedSetting(field, key, role)` で `settingsKey` の位置に書き、 `markModified` の入れ子追跡で他の `models.*` キーを保つ。
- 登録は 1 つだけ持ち、 再登録は置き換える。拡張の再読み込みで登録し直される。

**理由**: 語彙と設定キーの意味は spirits に残り、 コアは渡された文字列を比較・保存・通知するだけで済む（Decision 1、 Decision 4）。`/model` の経路は interactive-mode の中で完結しているので、 コアから拡張へ値を渡す口はどの案でも必要になる。

**代替案**: `/model` の生引数を拡張へ渡すイベントを追加する案は汎用だが、 コアのイベント面が増え、 解析と保存を spirits が別に持つことになる。`registerVirtualModel` に `roles` を足す案は、 物理モデル選択時にもロールを扱う（Decision 7）ことと合わない。どちらも却下した（利用者選択）。

### Decision 10: ロックはセッションの開始で既定ロールに置き換え、分岐間の移動では変えない

**選択**: `session_start`（reason を問わず、 `reload` を含む）で既定ロールを読み、 ロックを既定ロール（未設定なら normal）に置き換える。`session_tree`（分岐間の移動）ではロックも既定ロールも扱わない。Enter で設定したロックはセッションに保存しないので、 `/reload` で既定ロールに戻る。

**理由**: 「実行中のセッションのロールは変わらない」と一貫し、 分岐を移動しても利用者が `/model` で固定したロールが保たれる。phase は拡張のクロージャにあり、 `/reload` で作り直されるので、 開始時に置き換える規則は実装の性質とも一致する。

**代替案**: 分岐の復元のたびに既定ロールへ戻す案は、 分岐の移動で Enter のロックが消える。ロックをセッションに保存する案は、 永続化の要件が増え Non-Goal に触れる。どちらも却下した（利用者選択）。

### Decision 11: thinking レベルとロールの同時指定は `<model> <level> <role>` の順だけ

**選択**: 末尾から role、 level の順に切り出す。`<model> <role> <level>` では、 role の位置の語を検索語の一部として扱う。

**理由**: 語彙は重ならないので曖昧さは無く、 規則とテストの追加が最小で済む（利用者選択）。

**代替案**: 両方の順を許す案は利用者の書き方に寛容だが、 規則とテストが増える。同時指定を許さない案は、 thinking レベルとロールを一度に保存できない。どちらも却下した。

## Risks / Trade-offs

- [strong をロックしたまま課金が嵩む] → バッジに `[strong]` が出続けることで状態は視覚的に分かる。README に `/model <model> normal` で解除できることを書く
- [role だけを追記した `pi.virtual-model-state` entry でルータの状態が飛ぶ] → 追記前に既存 entry の `state` を読み継ぐ。`packages/spirits/test/routing-register.test.ts` で state が保持されることを検証する
- [既定ロールの記録で既存セッションや分岐の形が変わる] → 追記は記録の無い新しいセッションの開始時だけに限る（Decision 6）。`routing-register.test.ts` で復帰・再読み込みでは追記しないことを検証する
- [ロックが解除されず「振り分けが直らない」という報告が増える] → 既定ロールが normal のときは従来動作と同一であること、 解除方法が `/model … normal` であることを README に書く
- [`/reload` で Enter のロックが消えることに利用者が驚く] → README に、 ロックを残すには CTRL+s で既定ロールとして保存することを書く
- [コアの `/model` パースへの上流変更と衝突する] → コア変更は `[spirits]` コミットに分離し `docs/spirits-core-diffs.md` に登録する
- [未知のロール名が黙って検索語に化ける] → selector が開くので無反応にはならない。Decision 3 で意図的に選んだ trade-off であることを spec の Scenario に書く

## Migration Plan

新規の設定キー `models.role` を追加するだけで、 データ移行は無い。キーが無い・空・不正な値のときは初期ロールが normal で、 既存の動作と同一である。ロールバックは spirits 側と `[spirits]` コミットを revert すればよく、 設定ファイルに残った `models.role` は読まれないだけで害が無い。

## Open Questions

なし
