# Tasks

## 1. 設計書の保存(ドキュメントのみ・コード無変更)

- [x] 1.1 `/tmp/managed-pi-design.md` を `docs/spirits-managed-pi-design.md` へコピーし、`diff /tmp/managed-pi-design.md docs/spirits-managed-pi-design.md` の出力が空であることを確認(本文は未変更)
- [x] 1.2 `docs/spirits-managed-pi-design.md` の末尾に「## 10. 訂正」節を追記する。内容は design.md 付録の 3 項とし、項 2 は §7 の比較表に加えるべき「追従の対象」行を訂正節の中で示す(§7 本文は書き換えない)。確認: `diff /tmp/managed-pi-design.md docs/spirits-managed-pi-design.md` の出力が `>` で始まる行だけ(`<` で始まる行が 0 件)であること、`rg -n "proper-lockfile|追従の対象|session_before_compact" docs/spirits-managed-pi-design.md` が 3 件以上
- [x] 1.3 `docs/spirits-design.md` の managed 経路の段落(`rg -n "docs/spirits-managed-pi.md" docs/spirits-design.md` で出る行)に新文書へのリンクを追記する。コミットは `git add docs/spirits-managed-pi-design.md docs/spirits-design.md` で 2 ファイルだけを指定し、`git status --short` で他の変更が混ざっていないことを確認してから 1 つ目のコミットにする

## 2. rlm: 子のモデル解決口と usage の記録値

- [x] 2.1 `packages/spirits/src/rlm/hostfn.ts` に子のモデルを決める関数の注入口を追加する。未指定時は親のモデルをそのまま使う。`cd packages/spirits && bun test test/rlm-hostfn.test.ts test/rlm-cell.test.ts` が全 pass であることを確認(リグレッション無し)
- [x] 2.2 解決関数が失敗した場合、`spawn` を呼ばずに例外を返し、`rlm_usage` が `provider` / `modelId` null・`sessionId` null・`outcome` `error` になることを `test/rlm-hostfn.test.ts` の新ケース「解決失敗」で確認(spec `rlm` / 解決できない親では子を生成しない、解決失敗の記録、解決失敗の catch)。解決の例外経路でも直列化の占有を解く(占有を解く `finally` の内側で解決する)。同じ entry で、解決失敗の後に解決できる状態で 2 回目を呼び、2 回目が待たされず `spawn` に到達するケースを同じファイルに追加して確認する(spec `rlm` / 解決失敗の後も次の呼び出しは進む、design Decision 4)
- [x] 2.3 解決関数が返したモデルが `spawn` の `params.model` と `rlm_usage` の `provider` / `modelId` の両方に渡ることを `test/rlm-hostfn.test.ts` の新ケースで確認(spec `rlm` / 解決した物理モデルで子を起動する、解決したモデルの記録)
- [x] 2.4 子を生成しない各ケースで `provider` / `modelId` が null になることを `test/rlm-hostfn.test.ts` の新ケースで確認する。対象は (a) 引数不正、(b) 深度上限(親が物理モデルの場合を含む)、(c) 親のモデル未設定、(d) 子セッション生成の失敗(`spawn` が `sessionId: null` の error を返す)、(e) 待機中の中断(spec `rlm` / rlm_usage の記録規則)
- [x] 2.5 子セッション生成の失敗(2.4 の (d))の例外文に、試みた物理モデルの provider と id を含める。`test/rlm-hostfn.test.ts` の新ケースで例外文に provider と id が含まれることを確認(spec `rlm` / 子セッションの失敗の伝達)
- [x] 2.6 入れ子の `createRlmHostFn` に同じ解決関数を引き渡し、深度 1 の子からさらに呼んだ子にも仮想モデルが渡らないことを `test/rlm-hostfn.test.ts` の新ケースで確認(spec `rlm` / 解決されたモデルの子も同じ規則を守る)
- [x] 2.7 `docs/spirits-m3-rlm.md` の `rlm_usage` の節、子セッションの節、集計規約(88 行付近)を新しい記録値(子に渡したモデル、子を生成しなかった呼び出しは null)と解決規則へ更新し、旧記録(親のモデル)との意味の違いを 1 段落で注記する。確認: `rg -n "実際に渡した" docs/spirits-m3-rlm.md` が 1 件以上
- [x] 2.8 `docs/spirits-m5-phase2.md` の指標表のうち `rlm_usage` を読む行が `provider` / `modelId` に依存しないことを確認する。依存する場合は定義文を新しい記録値に合わせて更新する(確認: 目視)
- [x] 2.9 `docs/spirits-m3-rlm.md` の既知の制約に「第三者拡張が登録した provider のモデルは、子側が認証を解決できないため子の対象にしても応答しない」を追記し、`rg -n "第三者拡張" docs/spirits-m3-rlm.md` が 1 件以上出ることを確認

## 3. routing: 子の対象解決と親側への接続

- [x] 3.1 `packages/spirits/src/routing/` に子用の対象解決を追加する。(a) 物理モデルはそのまま返す、(b) `spirits/auto` は位相が strong かつ strong 対象が解決できれば strong 対象、それ以外は normal 対象、(c) spirits が振り分けられない仮想モデルは明確なエラー、(d) 解決失敗は試みたロールと不足する設定を名指すエラーを返す。既存 `resolveStrongTarget` / `resolveNormalTarget` だけを使う。新規テスト `test/routing-child-model.test.ts` で (a)〜(d) の 4 ケースと、strong が使えないとき `ctx.ui.notify` が呼ばれないケースを確認する(spec `dual-model-routing` / strong 位相の子は strong の対象、normal 位相の子は既定モデル、strong が使えなければ黙って normal の対象、物理モデルを選ぶ親は振り分けない、子の対象の解決で通知しない)。加えて、strong 位相のまま strong の設定を別モデルへ変えると、次の解決が変更後の対象を返すケース(テストの `setSettings` を実際に使う)を確認する(spec `dual-model-routing` / 設定変更は次の子から反映する)
- [x] 3.2 直近の成功レスポンスを `ctx.sessionManager.getBranch()` から読む処理を実装する。除外条件は `stopReason` が `error` / `aborted` の assistant、仮想モデル名を指す assistant、assistant が無い branch、資格情報が無い provider のモデル(`hasConfiguredAuth` が false)。`test/routing-child-model.test.ts` で各除外ケースを確認し、資格情報が無いケースは解決失敗になることを確認する(spec `dual-model-routing` / 既定モデルを失った子は直近の成功レスポンス、直近の成功レスポンスに資格情報が無い、子の対象がどちらも使えない)
- [x] 3.3 `test/pi-runtime/child-model-source-pin.test.ts` を追加し、pi の `findLatestResponse` が選ぶ assistant message と、3.2 の branch 走査が選ぶ物理モデルが一致することを確認する(pi 側の規則が変わったときにここが落ちる)
- [x] 3.4 `registerDualModelRouting` の戻り値に位相の読み取りを追加し、`packages/spirits/src/index.ts` で `readRoutingSettings(pi.getSettings())` と合わせて `createRlmHostFn` へ注入する。`cd packages/spirits && bun run check` が成功すること、`rg -n "from \"../routing" src/rlm` が 0 件であること(`rlm` 層が `routing` 層を import しない)、`cd packages/spirits && bun test test/architecture-conventions.test.ts` が成功することを確認
- [x] 3.5 注入後の合成を確かめるテスト `test/rlm-child-model.test.ts` を追加する。位相・設定・branch を用意した解決関数を `createRlmHostFn` と結び、(a) strong 位相の子が strong 対象で `spawn` される、(b) strong 位相のまま strong の対象の設定を別のモデルへ変えると、設定変更が次の子から反映される(spec `dual-model-routing` / 設定変更は次の子から反映する。変更前後で値が異なること)、(c) 直列化キューの待ち時間中に位相が strong になり、strong の対象の設定も別のモデルへ変わった場合、子は待ちの後の値で解決される(design Decision 4。位相の変化だけで成り立つ期待値にしない)、を `cd packages/spirits && bun test test/rlm-child-model.test.ts` で確認する

## 4. 互換性ランナー: `rlm auto parent` の判定を締める

- [x] 4.1 `scripts/managed-pi-compat/fake-provider.ts` のリクエスト記録に、要求されたモデル名を追加する。`cd packages/spirits && bun test test/managed-pi-compat-fake-provider.test.ts` でモデル名が記録されるケースを確認
- [x] 4.2 `classifyAutoChild` を design Decision 8 の 3 区分(confirmed / failed / not-run)に合わせて直す。`RlmChildObservation` に、要求されたモデル名に加えて、fixture が子の対象を用意したか、host が provider へリクエストを送り得るか(official か fixture か)を持たせる。confirmed は物理モデルで届き最終回答と usage が得られた場合、failed は仮想モデルのまま届いた場合、または fixture が子の対象を用意しているのに完了しなかった場合(解決エラー、リクエストもエラーも無いままの未完了を含む)、not-run は fixture が子の対象を用意していない場合と provider へリクエストを送らない固定イベントの host の場合とする。`has no child model` / `has no credentials` は共通の `FIXTURE_MARKERS` から外す。`cd packages/spirits && bun test test/managed-pi-compat-rlm.test.ts` で、fixture が揃っている解決エラー → failed、official でリクエストもエラーも無い → failed、fixture 実行でリクエストが無い → not-run、fixture が子の対象を用意していない → not-run、confirmed、仮想モデルのまま → failed のそれぞれを確認する。`run.ts` の `answerOf`(エラーになったセルの文を最終回答に数えない。物理モデル項目にも適用)も、この変更の判定として記録する(spec `managed-pi-compatibility` / spirits/auto の子セッション、fixture が揃っているのに子の対象を解決できない、provider へリクエストを送らない host、子の対象を解決できない spirits/auto の親、fixture 不足の記録)
- [x] 4.3 `scripts/managed-pi-compat/evidence.ts` の `OBSERVATION_EVIDENCE["rlm auto parent"]` を新しい判定条件の説明へ更新し、`cd packages/spirits && bun test test/managed-pi-compat-result.test.ts` が通ることを確認
- [x] 4.4 `docs/spirits-managed-pi.md` の rlm の段落のうち「`spirits/auto` を選ぶ親は別項目として記録し、成功として扱わない」と「解決できない場合はそのエラーをそのまま `limited` の理由に残す」を、3 区分(confirmed / failed / not-run)の新しい条件へ更新する。not-run は fixture が子の対象を用意していない場合と provider へリクエストを送らない固定イベントの host の場合に限り、fixture が揃っている解決エラーは failed と書く。「親のターン外で」は実際の挙動と合わないので「親の側で、子の起動前に」へ直す(2 箇所)。確認: `rg -n "そのエラーをそのまま" docs/spirits-managed-pi.md` と `rg -n "親のターン外" docs/spirits-managed-pi.md` がともに 0 件であること。not-run 説明の「成功として扱わない」(他の項目の説明)は対象外

## 5. 統合検証と証拠

修正後の新しい実装コミットでやり直し、前回の証拠(実装コミット `cb1733e19`)を置き換える。

- [x] 5.1 `cd packages/spirits && bun test` を流し、全 case pass(failure 0 件)を確認。`env | rg '^(SPIRITS_|PI_)'` の値を記録しておく
- [x] 5.2 リポジトリルートで `npm run check`、`bun run --cwd packages/spirits check` がともに成功することを確認
- [x] 5.3 `bun build --target=bun --outdir=/tmp/mp-syntax scripts/managed-pi-compat/run.ts` が成功し、`scripts/` の構文崩れが無いことを確認(root の biome/tsc は `scripts/` と `packages/spirits` を対象外にしているため)
- [x] 5.4 `bun scripts/build-managed-pi-inputs.ts --version <開発版> --out <build>` で拡張 bundle を作り、公式 Pi 1.5.0 の tarball(信頼ルートの SHA256 と一致することを確認)と manifest を並べた artifact root を用意する
- [x] 5.5 実装コミットを HEAD とする clean な worktree を作って `bun scripts/managed-pi-compat/run.ts --mode official --artifact-root <artifact-root> --bundle <build>/spirits-managed-pi-extension.js --commit <commit> --out <out>/official/result.json` を 1 回実行し、`runnerProvenance.clean` が `true` と `rlm auto parent` の状態(confirmed / failed / not-run)と detail を記録する。前回 `limited` からの変化と、直前の実行(`cb1733e19`)との差を記録し、判定の根拠とした provider リクエストを `result.json` から抜く
- [x] 5.6 同じ clean worktree で fixture set を導入した一時 managed root に対し `--mode fixture` を 1 回実行し、`rlm auto parent` の状態を記録する(fixture のみは互換性の証拠にしない。前回同様 JSON を置かない判断は証拠 README に書く)
- [x] 5.7 fork 経路を確認する: `bun scripts/build-binaries.ts --version <開発版>` で新しい実装コミットからビルドした `dist/spirits-linux-x64` の SHA256 を記録し、一時 HOME・隔離 `SPIRITS_CODING_AGENT_DIR`・ローカル fake provider で `spirits/auto` を選んだ親から `rlm` を 1 回実行して、子が物理モデルで応答し `rlm_usage` が解決後のモデルを記録することを確認する(使ったバイナリの SHA256 と手段を結果に含める)。`evidence/fork-route-probe.ts` は clean worktree への絶対パスではなく相対 import にし、README の実行コマンドだけで再実行できるようにする
- [x] 5.8 証拠を `openspec/changes/fix-managed-rlm-child-model/evidence/` に前回と同じ形式(redact 済み `result.json`、人が読める要約、`README.md` の実行コマンドと秘密情報の走査結果)で保存する。秘密情報の走査は `rg -n "sk-|Bearer |api_key|AKIA" openspec/changes/fix-managed-rlm-child-model/evidence --glob '!README.md'` とする(README が走査パターンを説明するため除外する)。コミット後のツリーで走査を再実行し、偽値以外 0 件(終了コード 1)であることを確認してから、その結果を README に書く
- [x] 5.9 `cd packages/spirits && bun test`、`npm run check`、`openspec validate fix-managed-rlm-child-model` がすべて成功した状態で、既存の 3 コミットは書き換えず、修正(実装・テスト・仕様・docs)と再取得した証拠を別々の追加コミットとして積む(`git status --short` に意図しない変更が残っていないことを各コミット前に確認)

## Workflow follow-up

- archive は行わない。可否の判断材料として、子の role の仕様、変更ファイル、テストとランナーの結果内訳(`rlm auto parent` の状態)、fork 経路の確認結果、コミットハッシュを報告する。
- push は行わない。`bun.lock` の既存ドリフトと他セッションの未追跡ファイルはこの変更に加えない。
