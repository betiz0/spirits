# Design

## Context

Pi の virtual model 機構がすでに持つ素面だけを扱う。`docs/spirits-design.md` §5 のコア差分規律(1 差分 = 1 `[spirits]` コミット)が本変更の最大の制約なので、**判断は「コア差分をどこに誰くらい置くか」に集中する**。機構そのものは [`packages/coding-agent/docs/virtual-models.md`](../../../packages/coding-agent/docs/virtual-models.md) を正とし、ここでは繰り返さない。

現状の関連事実:

- `route(request, ctx)` は `ModelRoute { model, thinkingLevel, state }` を返す。`state` はセッション分岐の custom entry `pi.virtual-model-state`(`{ provider, modelId, state }`)に保存され、`getVirtualModelState()` が provider / modelId で絞り込んで復元する。`direct` リクエストは state を持たない。
- `AgentSession.routedModel` は直近の**成功**レスポンス(`findLatestResponse` が error / aborted を除外)から物理モデルを逆算するだけで、ロールを持たない。footer はこれを使って `→ <model.id> • <level>` を出す。
- footer の右側表示は「モデル名 → thinking レベル → `→ routed`」を組み立てた後、末尾で `(provider)` を前置し、余れば stats と右側を幅に収める。`(provider)` は縮退の最初に落ち、その後は `truncateToWidth` が**末尾から**切り詰める。右側を置く余地が無いと stats だけを出す。footer は毎フレーム描画される。
- スキルは Markdown のプロンプト展開である。`/skill:<name>` は `agent-session` が `<skill name="..." location="...">` ブロックへ展開するが、**`input` イベントは展開前に発火する**のでコマンド名を確実に見られる。対応する「スキル終了」イベントは無い。run の終了を表す既存イベントは `agent_settled`(`aborted` フラグ付き、retry・compaction・queued continuation が無い状態で発火)である。
- 設定ファイルは未知キーを保持する。`SettingsManager.persistScopedSettings()` は現在のファイル内容をマージ元に取るため、spirits 固有キーは `/model` 等の保存で失われない。`pi.getSettings()` はマージ済み設定をそのまま返す。
- spirits は `@earendil-works/pi-coding-agent` の型を実ソースではなく `src/types/pi-coding-agent.d.ts` のミラーで受ける。新しい API を使うにはミラーの追加が必要。

## Goals / Non-Goals

**Goals:**

- コア差分を `virtual-models.ts` / `model-runtime.ts` + `agent-session.ts` / `footer.ts` の 3 箇所に閉じ、すべて additive にする(追加のみ、既存フィールドと既存分岐の意味は変えない)。
- コアに `"normal"` / `"strong"` という語彙を置かない。ロールの意味は spirits だけが知る。
- 物理モデルを直接選択しているセッションの挙動と表示を 1 ビットも変えない。
- 上流 merge でコア差分が失われたときに、 spirits の `bun test` か `./test.sh` で検知できる。

**Non-Goals:**

- 3 系統以上のロール、ロールのマッピングの利用者による設定。
- normal の対象そのものの変更。`/model`、`--model`、既定モデル設定、`enabledModels` は変更しない。
- rlm 子セッションの振り分け。子は `rlm` spec の「子セッションの認証と親モデル」に従い独自のモデル選択を持つ。
- 1 スキル実行が複数の run に跨った場合(途中で停止し、別の入力 continuation で再開した等)のロールの扱い。未定義とする。
- RPC / print モード向けの専用表示。バッジは TUI の footer のみ。
- ロール別の thinking レベル上書き。選択中の virtual レベルをそのままルート先へ渡し、Pi の clamping に任せる。
- 設定 selector・settings submenu への `models.strong` の追加。
- `packages/coding-agent/CHANGELOG.md` の更新(上流の changelog であり、既存の `[spirits]` コア差分コミットも更新していない)。

## Decisions

### 1. `models.strong` は Pi の `Settings` 型を変えずに設定ファイルの未知キーとして読む

**選択**: settings.json の `models.strong` を `pi.getSettings()` で読み、型は spirits のミラー(`ExtensionSettings`)にだけ追加する。読み取りは route ごとに現在値を参照し、キャッシュしない(`/reload` と設定変更が即座に効く)。

**理由**: コア差分ゼロ。`Settings` に足すと設定 selector・docs・型の一貫性維持まで一続きで発生し、上流が `Settings` を触るたびに衝突する。モデル指定は環境変数ではなく設定ファイルに置く方が、既存の `defaultProvider` / `defaultModel` と同じ解決系で読める。

**代替案 A**: Pi の `Settings` に `models: { strong?: string }` を追加する。コア差分が 1 増えるだけでなく、設定 UI とドキュメントまで要求される。
**代替案 B**: `SPIRITS_MODEL_STRONG` を env にする。`src/config.ts` の Layer 3(env 限定)の流儀には乗るが、モデル指定だけが env に浮き、プロジェクト単位に置けず、`/model` の既定と同じ解決系から外れる。

### 2. `spirits/auto` は登録だけし、既定モデル変更も自動選択もしない

**選択**: 実在しない provider id `spirits` に id `auto` を登録する。未知 provider 配下の virtual model は資格情報を要求されず、常に選択可能(virtual-models.md)。`thinkingLevels` は全レベルを宣言し、物理モデルへの clamping に任せる。`contextWindow` / `maxTokens` は宣言しない(初回応答までは unknown)。

normal と strong の解決では virtual model を対象から外す。virtual model だけを持つ provider は configured として `getAvailable()` に入るため、外さないと次の経路で失敗する。利用者が `/model spirits/auto` を保存キーで既定にする → `defaultProvider=spirits` / `defaultModel=auto` が保存される → normal が `spirits/auto` 自身に解決される → `resolveModel` が「物理モデルではない」で throw し、すべてのリクエストがエラーになる。外した後は既定が virtual のとき「既定を解決できない」扱いになり、`request.previous` → エラーの順に進む。virtual の判定はミラーの `PiModel.api` と pi の api 値 `pi-virtual` で行う(pi は `isVirtualModel` をパッケージ外へ export していない)。値の上流変更は `test/pi-runtime/` の固定テストで検知する。

**理由**: 既存の既定設定と `/model` 動作に触れない。limits を宣言すると、normal と strong で異なるはずの値を登録時の 1 値として誤った確定値に見せる。Pi は初回応答後およびリクエストごとに実モデルの limits を使うので、宣言しなくても compaction は正しい。

**代替案 A**: 登録時に normal 対象の limits を宣言する。strong の窓が小さい場合に誤解を招き、利益は初回応答前の表示だけ。
**代替案 B**: `models.strong` が設定されたら起動時に既定モデルを `spirits/auto` へ切り替える。「既定が変わる」ことは `/model` の既存挙動の変更であり、Non-Goal。

### 3. ロールはコアでは opaque な文字列ラベル

**選択**: `ModelRoute.role?: string`、`VirtualModelStateData.role?: string`、`routedModel.role?: string`。コアは値を解釈せず、footer は受け取った値を `[<role>]` と描画する。spirits は `"normal"` と `"strong"` の 2 値しか使わない。

**理由**: 上流が spirits の語彙を知ると、上流が同じ機構に別のロール体系を入れたとき衝突する。opaque にすると footer の分岐は「有れば前置する」だけになり、差分が最小になる。

**代替案**: `type ModelRole = "normal" | "strong"` をコアに定義する。spirits 専用の語彙を上流へ漏らす。

**撤回条件**: 上流が role をネイティブにサポートした場合、または opaque ラベルをやめて型付きロールに移す場合。

### 4. ロールの保存は既存 `pi.virtual-model-state` entry に additive で載せる

**選択**: entry data を `{ provider, modelId, state, role? }` に拡張し、書き込み条件を「state が変わった **または** role が変わった」に広げる。読み出しのため、entry 全体を返す `getVirtualModelEntry(branch, provider, modelId)` を `virtual-models.ts` に追加し、既存の `getVirtualModelState` はその `?.state` を返す薄いラッパにする。分岐走査と provider / modelId の絞り込みは `getVirtualModelEntry` の 1 箇所だけに置く。2 つの関数が別々に走査すると、片方の絞り込み条件だけを変えたときに state と role の読み出しが食い違う。`role` は optional なので、role を含まない既存 entry はそのまま読め、その場合はロール未決定。

**理由**: 分岐単位であること、fork と `/tree` 追従、compaction 生存、JSON 直列化制約は既存仕様で確定済みである。そこに載せれば resume・分岐・アーカイブの配線が増えない。新しい entry 種別は二重の真相になる。

**代替案 A**: assistant message entry に `routedRole` を追加する。各レスポンスのロールとして履歴化でき、意味はより正確(失敗レスポンスにロールを残さない)だが、セッション entry スキーマと replay 経路に触れる。この変更の価値に対して差分が重い。
**代替案 B**: role 専用の custom entry を新設する。既存 state entry と保存理由が割れ、`getVirtualModelState` と並ぶ第 2 の走査が必要になる。

**撤回条件**: 上流が role をネイティブにサポートして entry スキーマを変えた場合、または保存先を role 専用 entry に移す判断に変わった場合。

### 5. バッジは「最新のリクエストが通ったロール」に固定し、`routedModel` が返す

**選択**: ルート決定時に role を書き、`routedModel.role` は分岐に記録された最新値を返す。`model` と `thinkingLevel` は従来どおり直近の成功レスポンスから導出する。よってスキル起動直前とスキル終了直後は、表示が実態より 1 リクエスト遅れる(spec の scenario に固定した)。

**理由**: 既存の `→ routed` 表示が「すでに起きたことを見せる」意味なので、同じ意味に揃える。まだ出ていないリクエストのロールを出すと、中断や振り直しの結果と矛盾する表示になる。

**代替案**: フェーズを即時表示する。ルータの in-memory 状態を footer まで配線し直し、resume で復元できない。footer は毎フレーム描画されるので、状態の受け渡しに新たな同期点を作る。

**撤回条件**: 上流が role をネイティブにサポートして `routedModel` が role を返すようになった場合、またはバッジの意味を「最新のリクエストのロール」から変える場合。

### 6. ロールフェーズは拡張のクロージャ状態し、`input` で入り `agent_settled` で必ず戻る

**選択**: 拡張ロード時に作った 1 つの状態(normal | strong)を保持する。実行中でないときの `input`(`streamingBehavior` が無い入力)では、入力が `/skill:sprt-opsx-review-change` または `/skill:sprt-opsx-verify-deep` で始まれば strong、それ以外なら normal を代入する。実行中の steer / follow-up 入力ではフェーズを変えない。`agent_settled` ハンドラは `aborted` の真偽と関係なく normal を代入する(try/finally 相当)。`route()` は現在の値を読むだけで、遷移も復帰もしない。

**理由**: `input` はスキル展開前に発火するのでコマンド名を確実に取れる。`agent_settled` は retry・compaction・queued continuation が無い状態で発火するので「run が終わった」に一致し、中断とエラーを区別せずに済む。遷移を `route()` 側に置かないので、振り分けとライフサイクルが分離し、テストは状態機械と判定関数を別々に触れる。

対象外の入力でも normal を代入するのは、run が始まらず `agent_settled` が来ない経路があるためである。`input` ハンドラは preflight より前に走るので、次の経路で strong が持ち越される。物理モデルの API キーが無い状態で `/skill:sprt-opsx-verify-deep` を送る → strong に遷移する → `prompt()` の認証確認が throw して run が始まらない → `spirits/auto` に切り替えて `/opsx-apply` を送る → apply の run 全体が strong へルートされる。後から登録された別の拡張の `input` ハンドラが `handled` を返した場合も同じ経路になる。実行中でない入力は必ず新しい run の起点なので、そこでフェーズを決め直せば持ち越しは起きない。
**代替案 A**: `route()` が `request.messages` を走査し、最新 user メッセージの `<skill name="...">` ブロックで判定する。状態を持たず resume でも効くが、本文一致に依存し、スキル本文や会話がスキル名を引用しただけで誤発火する。
**代替案 B**: skill frontmatter にロール宣言を足し、展開をフックして遷移する。ユーザー所有の SKILL.md に spirits 固有の語彙を強いる。
**代替案 C**: `turn_end` で復帰する。turn はツール実行単位で 1 run に複数の turn があるので、スキル実行中に normal へ戻る。

**撤回条件**: スキル実行の run 単位前提が崩れた場合(1 スキル実行が複数 run に跨るのが通常になった場合)、または strong ロールの要件がなくなった場合。pi が「run が始まらなかった入力」を通知するイベントを持った場合は、対象外入力での normal 代入をそのイベントでの復帰に置き換える。

### 7. footer の差分はバッジの前置と provider 判定へのバッジ幅の算入に限定する

**選択**: 既存の `rightSide` 組み立ての後で、文字列の先頭にバッジを連結する。provider 前置を出すかどうかの判定にはバッジ幅を含める(`visibleWidth(roleBadge + withProvider)`)。縮退順序(provider → 末尾 → 右側全体)、`truncateToWidth` による末尾切り詰め、余地が無いとき右側を出さない分岐は変更しない。バッジを先頭に置くことで、既存の末尾切り詰めが「`→ routed` とモデル名から先に失う」を自動実現する。role は opaque な文字列なので、既存の `sanitizeStatusText` を通してから描画する。

判定にバッジ幅を含めないと、次のように spec の縮退順序を満たせない。幅が「provider 付きの右側はちょうど収まるが、バッジを足すと収まらない」とき、provider 前置が残ったまま末尾が切り詰められ、provider より先にモデル名側が失われる。ロールが無いときはバッジ幅が 0 なので、判定は従来と同じ結果になる。

**理由**: 上流が footer に足す機能(色・統計・パディング)と衝突しにくい。差分は連結 1 箇所と判定式 1 箇所に収まる。

**代替案 A**: バッジを最後に失う専用の縮退順を実装する。既存の幅計算に触れ、上流と衝突する。バッジは 8 文字程度で専用に扱う価値がない。
**代替案 B**: `ctx.ui.setFooter()` で spirits が footer を差し替える。コア差分ゼロにできるが、トークン統計・context usage・git branch・セッション名を再実装することになり、上流の footer 変更が黙って失われる。

**撤回条件**: 上流が footer の右側表示を大幅に変更した場合、またはバッジの前置を専用縮退順で実装し直す判断に変わった場合。

### 8. 通知は `ctx.ui.notify` を使い、run 内で同じ理由を 1 回にする

**選択**: 解決できない・資格情報が無いときは route 内で通知し、run 単位(agent_start 〜 settled)で理由キーを保持して重複を抑止する。strong 未設定は理由キーを作らない(無警告)。

**理由**: `route()` は continuation ごとに走る。抑止しないと 1 スキル実行で数十件の通知が出る。`notify` はモード横断で出る唯一の確実な経路。

**代替案**: 2 回目以降は `ctx.ui.setStatus()` で footer に常時出す。状態経路が 2 本になり、TUI 以外で status が見える保証がない。

### 9. コア差分の登録簿を docs に置き、変更アーティファクト名で紐づける

**選択**: `docs/spirits-core-diffs.md` に行(コミット番号、対象ファイル、意図、導入した変更名)として登録する。既存の `[spirits]` コア差分コミット(現 10 件)も本変更で登録し、`docs/spirits-upstream-sync.md` のコミット構成の節から参照する。

**理由**: `git log --grep=[spirits]` はメッセージにしか依存せず、意図と対象ファイルが復元できない。上流 merge で差分が消えたことの検知は、「消えるべきでない差分の一覧」が無いと書けない。

**代替案**: 既存どおり各 change の proposal.md の Impact に書くだけにする。merge 時に「どのコミットのどのファイル差分を確認するか」が一箇所に無く、取りこぼす。

### 10. ルーティングは新規 `spirits:routing` 層に閉じる

**選択**: `packages/spirits/src/routing/` を新規ディレクトリとし、規約正本に `spirits:routing` 層を追加する。依存向きは `spirits:shared` と `packages/coding-agent` のみ。`spirits:entry` の許可先に `spirits:routing` を足す。

**理由**: ルーティングは設定解決(`config.ts`、shared 層)と pi の ExtensionContext(`modelRegistry` / `ctx.ui.notify`)の両方を使う。既存のどの層にも属させると、その層の許可表と責務がルーティングの依存向きと合わない。新規層に閉じることで、ルーティングコードの依存向きが検査に掛かり、後続の変更が層の境界を跨げなくなる。

**代替案 A**: `spirits:shared` 配下にファイルを置く。層の追加は不要だが、shared 層の責務(設定・定数・型)がルーティング判定まで膨らぎ、shared を import する全層がルーティングコードに依存する。
**代替案 B**: `spirits:harness` 等の既存機能層に置く。スキル検知は harness の責務に近いが、ルーティング判定は全リクエストに関わるため、機能層の責務を汚す。

**撤回条件**: ルーティング機能を廃止する場合、またはルーティングコードを既存層に移す判断に変わった場合(その際は規約正本の層表から `spirits:routing` を削除し、検査を更新する)。

## Risks / Trade-offs

- [Risk] footer と `routedModel` の差分は上流 merge で失われやすい → Mitigation: 既存の `packages/coding-agent/test/footer-width.test.ts` と `test/virtual-models.test.ts` に role のケースを追加し、`./test.sh` で落ちるようにする。登録簿で確認対象を固定する。
- [Risk] バッジが 1 リクエスト遅れる意味は直感に反する → Mitigation: spec に scenario として固定し、README に「バッジは直近のリクエストのロール」と書く。
- [Risk] プロセス kill やクラッシュで `agent_settled` が来ないとフェーズが strong のまま残る → Mitigation: フェーズはメモリのみでセッションに保存しない。プロセスをまたぐと normal から始める。セッション復帰後はバッジに記録済みのロール(strong など)を表示するが、次のリクエストは normal へルートする。run 中の中断とエラーでは settle が発火する。run が始まらなかった入力の後は、次の実行中でない入力でフェーズを決め直す(Decision 6)。
- [Trade-off] normal が `request.previous` に落ちるとき、直前の run が strong なら previous は strong の対象モデルである。その場合 normal のリクエストは `[normal]` と表示されたまま strong の対象モデルへ送られる。通知にルート先のモデル名を出すので、利用者は気付ける。既定モデルを直すまで続く。
- [Trade-off] `spirits/auto` を既定モデルとして保存すると、normal は既定から解決できない(Decision 2)。新しいセッションの最初のリクエストは previous も無いのでエラーになる。README で、既定には物理モデルを置くよう案内する。
- [Risk] スキル実行中に steering / follow-up で別入力を足すと、その run の残りも strong で走る → Mitigation: 仕様どおり(run 単位)。マトリクス外入力を区別しないことを trade-off として明記する。
- [Risk] 未知キー保持は文書化された上流契約ではない → Mitigation: spirits 側の `test/pi-runtime/` で `SettingsManager` の未知キー保持を 1 本固定する。落ちたら Decision 1 代替案 A(`Settings` 型追加)へ移る。
- [Risk] strong モデルの context window が normal より小さいと、normal 前提の運用で compaction が早めに走る → Mitigation: Pi の既存仕様(リクエスト先モデルの limits で compaction 判定)に従うことを docs に書く。
- [Risk] `models.strong` を誤った ID にすると黙って normal で走る → Mitigation: 「設定されているが使えない」は通知対象。無警告なのは未設定のときだけ。
- [Trade-off] フェーズは 1 値なので、スキル実行中にスキルを重ねると後の起動が勝つ。2 スキルの同時実行は想定しない。
- [Trade-off] ロール表記はコアでは自由文字列なので、spirits 以外の virtual model が返したラベルも footer に出る(制御文字は除去する)。コアに語彙を置かないことの裏返し。

## Migration Plan

- 設定しない限り無効。`spirits/auto` を選択せず、`models.strong` を置かなければ、既存セッションの挙動と表示は変わらない。
- role を含まない既存セッションの `pi.virtual-model-state` entry はそのまま読め、ロール未決定(バッジなし)で復帰する。書き戻しはロールが決定したときだけなので、旧セッションのファイル形式は強制的に変わらない。

## Open Questions

- `spirits/auto` の selector 表示名(`name`)の文案。表示のみの問題で、実装時に変更できる。
