# Design

## Context

`rlm` は親の `ExtensionContext.model` をそのまま `spawn` に渡す(`packages/spirits/src/rlm/hostfn.ts`)。親が `spirits/auto` を選んでいると、子セッションは別個の `ModelRuntime` を立てるため `spirits` provider を解決できず `No API key found for spirits` になる。子セッションは `noExtensions: true` で起動するので、route() を子の側で再実行する口は無い。fork 経路・managed 経路で同じ拡張コードが動くため、両経路で同じ症状が出る。

制約:

- 層検査(`docs/architecture/convention-registry.md` `registry:layers`)では `spirits:rlm` と `spirits:routing` が互いに依存しない兄弟層で、両方へ import できるのは `packages/spirits/src/index.ts` の `entry` 層だけ。
- 対象解決は `routing/resolve.ts` の `resolveStrongTarget` / `resolveNormalTarget` が `(lookup, settings, previous)` の純関数として既存。`ctx.modelRegistry` は `ModelLookup` を満たす。
- ロール位相は `routing/register.ts` の `createRoutingPhase()` のクロージャにあり、`agent_settled` で lock に戻る。位相は拡張メモリのみで、プロセスを跨がない。
- 直近の成功レスポンスの物理モデルは、通常は `ModelRouteRequest.previous` として pi が渡す。rlm 呼び出しにはその request が無い。pi 自身の導出は `findLatestResponse(messages)`(`stopReason` が `error` / `aborted` でない最後の assistant message)と `getPhysicalModel(provider, model)` で、assistant message は振り分け後の物理モデルを載せる。pi は route の後に資格情報の確認(`hasConfiguredAuth`)を行い、無ければエラーにする。
- 互換性ランナーの `rlm auto parent` は `scripts/managed-pi-compat/rlm.ts` の `classifyAutoChild` が常に `limited` を返す。`evidence.ts` の `OBSERVATION_EVIDENCE` は「別枠で判定した」ことを証拠として説明している。`REQUIRED_OBSERVATIONS` には入っていない。
- 一次根拠は `docs/spirits-m3-rlm.md`(rlm の契約)と、本 change で `docs/spirits-managed-pi-design.md` に保存する managed 経路の設計文書 §4・§5 である。ここには重複を書かない。`/tmp/managed-pi-design.md` は保存(タスク 1.1)までの写しで、再起動で失われうる。

## Goals / Non-Goals

**Goals:**

- 仮想モデルを選ぶ親から `rlm` を呼んでも、子が物理モデルで起動する。
- 子の対象を決める判断を既存の対象解決とロール位相に寄せ、新しい解決規則を作らない。
- 解決できないときに、子側プロバイダエラーではなく、親側で分かるエラーにする。
- `rlm_usage` を「実際にどのモデルでどれだけの費用がかかったか」の記録として使える形にする。
- fork 経路と managed 経路の両方で、直ることを確認できる状態にする。

**Non-Goals:**

- 第三者拡張が `registerProvider()` で登録した provider を子から使えるようにしない(`ExtensionContext.modelRuntime` を要求する限定パッチ PA は上流 issue ままで、本変更では扱わない)。
- 子の thinking level の扱いを変えない(親の選択をそのまま渡し、pi が物理モデルへ clamp する)。
- 設定の書き込み、`/spirits-*` コマンド、`/clear` の代替、role badge、既定経路の切り替えは対象外。
- 親が物理モデルで子を生成する場合の挙動を変えない。

## Decisions

### 1. 解決は親の側で行い、`entry` 層で注入する

`routing/` に子用の解決関数を置き、`index.ts` が `createRlmHostFn` に注入する。`rlm` は「渡された解決関数で子のモデルを決める」ことだけ知り、仮想モデル・ロール・設定キーを知らない。

- 代替 A: `rlm/hostfn.ts` が `routing/` を import する。`registry:layers` が禁じており、層検査(`ARCH-IMPORT`)が落ちる。`rlm` をロール機能に依存させるのは M3 の後段非依存の趣旨にも反する。
- 代替 B: 子の側で解決する。子は `noExtensions: true` なので virtual model を登録しておらず、原理的に解決できない。
- 代替 C: Pi へパッチを当てて `resolveModel` を子から呼べるようにする。P-SOURCE を増やす決定が要り、この change の範囲外。

### 2. 子のロールは親の位相に追従させ、strong が使えなければ normal

位相が strong で strong 対象が解決できるなら strong、それ以外は normal。親の run が強いモデルで答えている最中に委任した子だけが弱いモデルで走る、という齟齬を避ける。

- 代替: 常に normal。strong フェーズのレビュー系 skill が `rlm` を使う運用(現に `sprt-opsx-*` が委譲前提)で、委任した子だけ弱いモデルになり、位相の意味が消える。
- 代替: 常に strong。strong 未設定のセッションで必ずフォールバックが発生し、通常作業のコストが上がる。

### 3. `previous` の代替はセッション branch の直近の成功 assistant message

`ctx.sessionManager.getBranch()` を末尾から走査し、`stopReason` が `error` / `aborted` でない最後の assistant message の `provider` / `model` を、カタログの物理モデルへ写す。pi が `previous` を導く規則をそのまま再現する。

取り出したモデルは、資格情報があるときだけ子の対象にする。pi は route の後に同じ確認(`hasConfiguredAuth`)を行うが、子の経路には route の後段が無い。既存の `resolveNormalTarget` は `previous` を無条件に採るため、`previous` を渡す前に呼び出し側で判定する。これは新しい解決規則ではなく、振り分け本体が既に持つ条件を子の経路にも適用するものである。

- 代替 A: pi が書く振り分け状態の custom entry(`provider` / `modelId`)を読む。pi 内部の保存形式に依存し、初回リクエスト前には存在しない。公式 Pi の版で形が変わる可能性をわざわざ取り込む。
- 代替 B: `previous` を使わず設定のみで解決する。既定モデルを `spirits/auto` にしている、または未設定のセッションで解決不能になり、`dual-model-routing` の既存要件(直近の成功レスポンスへ寄せる)と食い違う。
- 採らない代替 C: 直近の応答を資格情報の確認なしで採る。資格情報を失った provider の応答が子に渡り、子側でプロバイダエラーになる。解決の失敗をプロバイダエラーとして現れさせない要件に反する。
- 採らない代替 D: 子側で認証を解決できるモデルだけに絞る。第三者拡張の provider も親側で弾けるが、子側の認証可否を親から判定する手段が拡張 API にあるかは未検証で、作業量も最大になるため、この change では採らない。

### 4. 解決のタイミングは直列化キュー待ちの後

`rlm` は REPL ごとに直列化する。キュー待ちの後に解決することで、位相・設定・直近の成功応答を「子が実際に始まる時点」で読む。キュー待ちの間に設定編集や `agent_settled` があっても、古い値で決めない。

解決はキューの順番を取った後に行うので、解決の例外経路も他の出口と同じく、順番を必ず次の呼び出しへ渡す。例外経路が占有を解く `finally` の外にあると、1 回の解決失敗で同じ REPL の以後の `rlm` がすべて止まる(キューは REPL ごとのクロージャにあり、tsrepl の timeout は既定なし、`reset: true` でも解けない)。解決は占有を解く `finally` の内側で行う。

- 代替: 呼び出し直後に解決する。待ち時間に入力があった場合、子が実際に始まる時点と違う位相で決める。親のモデル未設定チェックだけを先に済ませるのは従来どおりでよい(子を作るかどうかが決まる)。

### 5. `rlm_usage` の `provider` / `modelId` は子へ渡したモデル

子セッションを生成した呼び出しは、実際に渡したモデルを記録する。子セッションを生成しなかった呼び出し(引数不正・深度上限・親のモデル未設定・解決失敗・子の生成失敗・生成前の中断)は、親の種別によらず null を記録する。記録の条件は `sessionId` が null かどうかと一致する。

例: 親が物理モデル `p/m` を選んでいて深度上限に当たった呼び出しは、旧実装では `p/m` を記録していた。新しい規則では null になる。子が生成されておらず、子に渡したモデルが無いためである。

- 代替 A: 親のモデルを記録したままにする。auto 親では常に `spirits/auto` と記録され、どの物理モデルに落ちたかを後から判別できない。集計(M5 の判断材料)としても使えない。
- 代替 B(採らない): `spawn` に渡したモデルがあれば、生成に失敗した場合も記録する。規則が「子を生成したか」と「モデルを渡したか」の 2 つになり、`sessionId` と揃わなくなる。生成失敗の診断は、例外文に試みたモデルを含めることで補う。
- 副作用: auto 親の子の料金は物理モデル名で記録される。親の選択との対応はセッションの `model_change` / 振り分け状態から見られる。

### 6. 仮想モデルの検出と spirits 外の仮想モデル

親のモデルが仮想モデル(api が仮想モデル用の識別子)の場合だけ解決に入り、`spirits/auto` であれば位相と設定で解決する。spirits が振り分けられない仮想モデルの場合は、子を生成せず「その仮想モデルは子の対象にできない」旨のエラーにする。

- 代替: `spirits/auto` のときだけ介入し、他の仮想モデルは従来どおり子に渡す。既知の `No API key found for <provider>` を再利用することになり、診断が悪い。「仮想モデルを子に渡さない」を構造で保証しないままになる。

### 7. 第三者拡張の provider は受容して文書化する

`ModelRuntime` は拡張から取得経路が無く、子は `agentDir` の `auth.json` / `models.json` と環境変数から自分で解決する。従って「拡張が生やした provider のモデル」は子の対象になっても子側で認証に失敗する。今回はこれを解決せず、失敗時のエラーに認証解決の場所が現れるようにし、docs の既知の制約として書く。

- 代替: 限定パッチ PA(`ExtensionContext.modelRuntime`)を入れる。上流提案可能性は高いが、P-SOURCE(公式 artifact の再ビルド配布)を決める別 change が必要で、この change の目的(既存不具合を直す)を待たせることになる。

### 8. ランナーは新しい probe を足さず判定だけ締める

既存の `rlm auto parent` の観測に、fake provider が受けたリクエストのモデル名を加える。判定は次の 3 区分にする。

- confirmed: 子のリクエストが物理モデルとして届き、最終回答と usage が得られた。
- failed: 子のリクエストが仮想モデルのまま届いた、または fixture が子の対象を用意しているのに子が完了しなかった(製品側の回帰)。解決エラー(`has no child model` など)と、子へのリクエストもエラーも無いままの未完了もここに入る。
- not-run: fixture が子の対象を用意していない(子の対象にできる物理モデルが fixture に無い)場合と、provider へリクエストを送らない固定イベントの host(fixture 実行)の場合。後者は何を解決したかを読む手掛かりが無く、製品不具合とは断定できない。

ランナーは auto の実行の前に必ず `writeRlmFixture` で子の対象(既定 provider、既定モデル、認証、モデル定義)を書くので、official 実行では「fixture 不足」は成り立たない。したがって解決エラーの文字列(`has no child model` / `has no credentials`)を共通の `FIXTURE_MARKERS` に入れない。共通マーカーは物理モデル項目など他の項目の判定にも使われ、auto では fixture が揃っているのに回帰を not-run に落とす。auto の判定は、観測に「fixture が子の対象を用意したか」と「host が provider へリクエストを送り得るか(official か fixture か)」を持たせて区別する。

判定の入力に使う最終回答は、エラーになったセルの文を数えない(`run.ts` の `answerOf`。物理モデル項目にも同じ扱いを適用する)。そうしないと、子が一度も走っていない失敗文が「最終回答」として数えられ、confirmed の条件を満たしてしまう。

`classifyAutoChild` をこの判定に置き換え、`OBSERVATION_EVIDENCE` の説明も新しい判定条件へ書き換える。

- 代替: 子のモデルを直接読む新しい probe を追加する。項目が増え、`docs/spirits-managed-pi.md` の対応表・要約・ラベル定義の書き換えの範囲が広がる。既存項目の provider リクエストで同じことが言える。
- 代替(採らない): 解決エラーの文字列を fixture 不足のマーカーとして not-run にする。runner が fixture を揃えて走らせる以上、子モデル解決の回帰が failed の件数に現れず、`limited` に埋もれるのと同じ状態になる。
- 代替(採らない): 失敗を `limited` のまま残す。既知の制約として埋もれ、回帰が Results の failed 件数に現れない。
- 代替: 親のセル結果だけから判定する。子は生成できるが応答しない、という状態と区別できない。

### 9. 設計文書の保存は docs のみ・別コミット

`/tmp/managed-pi-design.md` を `docs/spirits-managed-pi-design.md` として保存し、本文は書き換えず末尾に訂正節を追記する。既存 docs の命名(`spirits-design.md` / `spirits-managed-pi.md`)に合わせ、managed 経路の設計であることがパスで分かる名前にする。

- 代替: `docs/spirits-managed-pi.md` に統合する。運用手順の文書と実装方針の調査が混ざり、前者は利用者が読む文書として長すぎる。

## Risks / Trade-offs

- [位相は拡張メモリだけで、`rlm` を呼んだ run とずれる可能性がある] → 解決をキュー待ち後に置き、子の起動時点の位相を読む。位相の持続と復帰の規則自体は `dual-model-routing` の既存要件で、本変更では変えない。
- [直近の成功応答をセッション branch から読む実装は pi の assistant message の形に依存する] → `test/pi-runtime/` に `getBranch()` の message entry が `provider` / `model` / `stopReason` を持つことをピン留めするテストを置き、壊れたときに気がつける場所を作る。
- [親が物理モデルで子を生成しなかった呼び出しの記録値が null になる(`provider` / `modelId` が変わる)] → 子を生成した呼び出しは、親が物理モデルでも記録値が変わらない(解決結果が親と同一になるため)。意味の変更は仕様・docs に明記し、`rlm_usage` を読む既存計測の定義文(`docs/spirits-m3-rlm.md` の集計規約、`docs/spirits-m5-phase2.md` の指標表)を同じ change で確認し、必要なら更新する。
- [子が受け取った物理モデルの provider を子側が認証できないケースが残る] → 第三者拡張の provider に限定される。認証解決の場所をエラーに残し、docs の既知の制約として書く。PA は上流 issue 側の話として追わない。
- [解決の例外経路で直列化の占有を解き忘れると、1 回の解決失敗で同じ REPL の以後の `rlm` が止まる] → 解決を占有を解く `finally` の内側で行い、`rlm-hostfn.test.ts` に「解決失敗の後の 2 回目の呼び出しが `spawn` に到達する」ケースを置く(Decision 4)。
- [ランナーの auto 項目が confirmed に変わらない可能性がある] → fork 経路と managed 経路の両方で単体レベルの再現手順を用意し、clean ツリーでの fixture / official 実行を証拠として残す。変わらなければ、原因を fixture 不足(not-run)と製品側(failed)に切り分けて報告する。`limited` には残さない。

## Migration Plan

- コードは通常のリバートで戻せる。データ移行は無い。
- `rlm_usage` の `provider` / `modelId` の意味は記録値の変更であり、過去のセッションの記録は書き換えない。旧記録は親のモデル、新記録は子のモデルを示すことを docs で知れるようにする。
- 証拠は前 change と同じ形式(`redact` 済みの `result.json` と人が読める要約、実行 commit と成果物 SHA)で change ディレクトリへ保存する。コミットは設計書 / 実装・テスト・仕様 / 証拠の 3 つに分ける。archive と push は行わない。

## Appendix: docs へ保存する設計書に追記する訂正節

既存本文は書き換えず、次の 3 項を「## 10. 訂正」節として追記する(文言はそのまま使う。項 2 の末尾だけは下記のとおり)。

1. **設定の書き込みのロック機構**: Pi の `SettingsManager` は proper-lockfile によるプロセス間のファイルロック(`settings-manager.ts` の `lockSync`)を使う。`withFileMutationQueue`(`core/tools/file-mutation-queue.ts`)はプロセス内のキューであり、同じロック機構ではない。拡張から `settings.json` に書く場合は、同じパスで proper-lockfile を使って「読み込み → マージ → 書き込み」を行い、その後 `ctx.reload()` で反映する方式を前提とする。
2. **追従コストの比較**: managed では拡張 API の変更への追従が発生する。フォーク継続では上流の変更はソースのコンフリクトとして現れるのに対し、managed は公式拡張 API のみに依存する代わりに、その API 自体が上流で変われば拡張が追従する。§7 のフォーク継続との比較表に加えるべき「追従の対象」の行を、この訂正節の中で示す(§7 本文は書き換えない)。
3. **`session_before_compact` の発火条件**: `session_before_compact` は自動 compaction でも発火する(`reason` は `manual` / `threshold` / `overflow` を運び、`manual` は Pi の `/compact` 由来とも同じ値になる)。したがって `/clear` の代替は、明示的な起動のときにだけ立つ条件を満たす呼び出しだけを横取りし、それ以外は素通しするという条件を仕様に含める。
