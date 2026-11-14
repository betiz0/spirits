## Deep Verification Report: unify-spirits-role-command

- 検証日: 2026-11-13
- 検証対象: `3c3962f97`(main との merge-base)..`f71b6746b`(HEAD)。未コミット変更あり。前回も未コミット状態だったので、差分の基点は確定できない。そこで d-verify3.md より後に更新された 17 ファイルを読み直した。それ以外のファイルは d-verify3 から変わっていないので、前回の結論を引き継ぐ
- テストコマンド:
  - `cd packages/spirits && bun test`
  - `cd packages/spirits && bun run check`(= `tsc --noEmit`。CI の `spirits-ci.yml` が実行するもの)
  - ルートの `npm run check` を `--write` 抜きで、手順ごとに実行
  - tasks.md の `-t` 指定を 1 件ずつ実行
- verify1 レポート: なし
- モード: 再検証(前回レポート: `d-verify3.md`)

再現は scratchpad の一時テスト(probe)で行った。リポジトリと `~/.spirits` は変更していない。

### 判定
**FAIL / BLOCKED**(BLOCKED の S-1 / S-2 は利用者が決定済み。下の「利用者の判断」)

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` は成功 1253 / 失敗 0<br>**`packages/spirits` の `tsc --noEmit` は型エラー 3 件で失敗**<br>ルートの check は全手順成功<br>tasks の `-t` 指定は成功 105 / 失敗 0 |
| 要件 | 意図どおり 40 / 全 42 |
| シナリオ | 挙動を確認 179 / 183(3 件は不一致、1 件は TODO キーの実端末の打鍵で 7.3 の記録による)<br>テストが実質的 約 176 / 183 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| タスク | 完了 46 / 全 46 |

### 前回(d-verify3)の指摘の再検証
| 前回 | 結果 | 根拠 |
|---|---|---|
| C-1 一覧の thinking レベル | 解消。ただし型エラーが新たに入った(新 C-1) | `routing/plan.ts` を新設。`routing-request-plan.test.ts` は 36 通りの条件で、期待値をルーターの戻り値から作っている |
| C-2 8.2 のテスト名 | 解消 | 105 件すべて個別に成功 |
| W-1 一覧の編集中の例外 | 一部未解消(新 C-2) | 例外は一覧の中に止まる。しかしロックの行の値と badge がセッションのロックとずれる |
| W-2 `/tree` | 一部未解消(新 C-3、C-4) | 基本の 2 シナリオは成立する。一覧に無い名前の記録と、フォーク経路で破綻する |
| W-3〜W-5 | 解消 | シナリオの GIVEN / WHEN どおりのテストがある |
| S-1、G-1、G-2 | 解消 | |

### 指摘

#### CRITICAL

- **[C-1] spirits の型検査が失敗するので、CI が落ちる**
  - 場所:
    - `packages/spirits/src/routing/router.ts:79`
    - `packages/spirits/test/routing-request-plan.test.ts:101,153`
  - 根拠:
    - `RequestPlan.thinkingLevel?`(`plan.ts:74`)が `undefined` を許す。一方、ルートの戻り値 `ModelRoute.thinkingLevel` は必須なので、型が合わない(TS2322)。
    - テストは結果を `thinkingLevel?: string` へキャストしており、`ChildTarget` に渡せない(TS2769)。
    - `spirits-ci.yml:70-76` は `bun run check` を実行するので、この型エラーで落ちる。d-verify3 の時点では成功していた。
  - 修正先: 実装
  - 推奨:
    - router は `thinkingLevel: plan.thinkingLevel ?? request.thinkingLevel` を返す。
    - テストのキャストは `thinkingLevel?: ThinkingLevel` にする。

- **[C-2] ロックの記録の追記が例外を投げると、ロックの行と badge がセッションのロックとずれる**
  - 場所:
    - `src/commands/register.ts:96-102`(`setRole` の後に `appendEntry`)
    - `src/commands/role-panel.ts:335-336`(`lockDrawn` に届かない)
    - `src/commands/role-panel.ts:574-583`(catch は説明だけを直し、`refresh` しない)
  - 根拠: probe P1 で再現した。`spirits_role` の `appendEntry` を投げさせ、一覧でロックを strong にした。
    - `phase.lock()` は `strong`。
    - ロックの行は `normal` のまま。
    - badge は未描画。

    これは spec「一覧のロックの行は保存に失敗してもセッションのロックを示す」の MUST と、シナリオ「ロックの記録の追記が例外を投げる」に反する。既存テスト `an exception in an edit stays inside the list` は、`lockRole` 全体を先に投げさせているので、この経路を通らない。
  - 修正先: 実装
  - 推奨:
    - ロックの行では、例外が出ても `lockDrawn` を呼ぶ(`finally` で `deps.phase.lock()` のロールを描く)。
    - catch の中でも行の値を `phase.lock()` から作り直す。
    - シナリオどおりのテスト(実際の `registerManagedCommands` で `appendEntry` だけを投げさせる)を足す。

- **[C-3] 一覧に無いステップ名の記録へ移っても、移動前のステップが残る**
  - 場所: `src/routing/phase.ts` の `followStepRecord` → `restoreStep`(定義が無ければ何もしない)
  - 根拠: probe P3 で再現した。`opsx-propose` が継続中に、最新の記録が `opsx-teleport` の分岐へ移った。
    - 移動の直後は `opsx-propose` のまま。
    - reload の後は `none`。

    これは spec「分岐間の移動ではステップを移動先の記録に合わせる」の「一覧に無い名前のときはステップを終える」と「移動の直後と再読み込みの後で同じ」に反する(シナリオ「一覧に無いステップ名の記録へ移る」)。
  - 修正先: 実装
  - 推奨: `followStepRecord` で、一覧に無い名前を `undefined` と同じく扱い、記録を足さずにステップを外す。

- **[C-4] フォーク経路で分岐を移動すると、継続中のステップが消える**
  - 場所: `src/routing/register.ts:266-271`(`session_tree` を経路にかかわらず登録している)
  - 根拠: probe P2 で再現した。role API のあるホストで `/skill:openspec-propose` を走らせ、settle の後に `session_tree` を送った。
    - 移動の前は `opsx-propose`。
    - 移動の後は `undefined`。

    フォーク経路は記録を書かない(`onStepChange` で return する)ので、移動の後は常に「記録なし」と読まれる。これは spec の MUST「フォーク経路は…分岐間の移動でステップを変えてはならない」と、シナリオ「フォーク経路の移動ではステップが続く」に反する。`routing-register.test.ts:186` は、フォーク経路でハンドラが 1 件あることを期待値にしている。
  - 修正先: 実装
  - 推奨:
    - `session_tree` の追従を `!registerModelRoles` のときだけにする。
    - 上のシナリオのテストを足す。
    - `routing-register.test.ts:186` の期待値を見直す。

#### WARNING

- **[W-1] 追加されたシナリオのうち、挙動は正しいがテストが無いものが 2 件ある**
  - 対象と場所:
    - 「ロールのモデルの行とロックの行もルーティングと一致する」: `role-panel.ts:271,396-400`
    - 「移動の後に badge を描き直す」: `commands/register.ts:320-322`。probe P4 では `[strong]` を描いた
  - 推奨:
    - 前者は `routing-request-plan.test.ts` と同じ形で、ルーターの戻り値から期待値を作るテストにする。
    - 後者は、`session_tree` の後の `statuses.get("spirits")` を検証する。

- **[W-2] strong が未設定のとき、strong のモデルの行が応答するモデルを名指さない**
  - 場所: `role-panel.ts:394-395`(「a strong request runs normal」で終わる)
  - 根拠: spec「行の説明に出す解決結果は…実際に応答するモデルとしなければならない」。設定済みで使えない場合は、モデルを名指している。
  - 推奨: `targets.normal.target` を添えて「runs normal on `<model>`」と出す。

- **[W-3] `/tree` のテストが、シナリオの THEN と GIVEN をそのまま使っていない**
  - 場所: `test/routing-phase-reload.test.ts:222-262`
  - 根拠: どちらの不足も挙動は正しい。
    - THEN の status やルート先ではなく、`phase.step()` だけを見ている。
    - 「ステップの記録より前へ移る」は、記録の無い分岐ではなく `{step:null}` を使っている。
  - 推奨: tasks 冒頭の規則 3 のとおり、status の出力とルート結果で検証する。記録の無い分岐の場合も足す。

#### SPEC

- **[S-1] spec がタスクの完了後に改められ、tasks と design が追従していない**
  - 場所:
    - `specs/managed-commands/spec.md`、`specs/dual-model-routing/spec.md`(14:41 更新)
    - `tasks.md`(14:22。全件チェック済み)、`design.md`(13:53)
  - 根拠: 次の 5 シナリオと、それに伴う MUST に、対応するタスクも design の記述も無い。C-2〜C-4 と W-1 の原因である。
    - 「ロックの記録の追記が例外を投げる」
    - 「ロールのモデルの行とロックの行もルーティングと一致する」
    - 「一覧に無いステップ名の記録へ移る」
    - 「移動の後に badge を描き直す」
    - 「フォーク経路の移動ではステップが続く」

    design D12 は、フォーク経路と一覧外の名前を扱っていない。
  - 修正先: spec 以外の成果物(tasks / design)
  - 推奨:
    - tasks の 3.7 と 5.4 を未完了に戻し、上のシナリオのテスト名と検証を足す。
    - D12 に「managed 経路だけで追従する」「一覧に無い名前は終える(記録しない)」を書く。

- **[S-2] tasks の型検査の検証が、spirits を検査していない**
  - 場所: `tasks.md` の 1.4 / 5.7 / 6.1 / 9.1 / 9.5(`npm run check`)
  - 根拠:
    - ルートの `tsconfig.json:57` は `packages/spirits/**` を除外している。そのためルートの check は通るが、CI が実行する `packages/spirits` の `bun run check` は落ちる(C-1)。
    - これは原因分析の「原因 2」(検証コマンドが本当の合格条件を見ていない)と同じ種類の不備である。
  - 修正先: tasks
  - 推奨: 9.1 に `cd packages/spirits && bun run check` を足す。

#### SUGGESTION

- **[G-1]** `role-panel.ts:435` は、レベルが無いとき「the session level (off)」と出し、`:489` は「unset」と出す。2 つの文言が食い違い、前者は値が off だと断定している。どちらも「the session's level」に揃える。

### verify1 との突き合わせ
verify1 のレポートが渡されていないので省略した。

### 利用者の判断(2026-11-13)
- 指摘をすべて changes に反映し、該当タスクを未完了に戻す。S-1 と S-2 は推奨どおりとする。
  - S-1: tasks を戻して足し、design D11 / D12 を補う。
  - S-2: spirits の型検査を検証に加える。
- 同じ種類の不備がこれまでの指示でも防げなかった理由を分析し、その原因を除く手順を changes に入れる。

### 反映先
- design:
  - D11: 例外時のロックの行と badge の規則(C-2)、strong 未設定のモデルの行(W-2)
  - D12: 移動の追従は managed 経路だけ、一覧に無い名前は終える(C-3、C-4)
  - D15: ルートが返す thinking レベルは必須(C-1)
  - Risks: 「routing 層のハンドラは両経路で共有される」を追加
- tasks:
  - 2.5 / 3.7 / 5.3 / 5.4 / 9.1 / 9.2 / 9.6 / 9.7 を未完了に戻した。
  - 9.8(シナリオとテストの対応表と、その機械的な検査)を足した。
  - 冒頭の「チェックと検証の規則」に 4 項目を足した。
  - Workflow follow-up に原因分析を置いた。
- specs と proposal: 変更なし。今回の指摘は、spec の記述そのものではなく、spec に tasks と design が追従していなかったことにあるため。

### 原因分析の要約
詳細は tasks.md の Workflow follow-up(d-verify4 の項)にある。

| 不備 | 原因 | 除去 |
|---|---|---|
| spec の 5 シナリオにタスクもテストも無い(S-1) | タスクの完了後に spec を改めたが、tasks を戻す手順も、対応の無いシナリオを見つける手段も無い。183 シナリオのうち 114 件は、名前がどのテストにも出てこない | シナリオとテストの対応表と、その全件の機械的な検査(9.8)。spec を変えた作業で tasks を戻す規則 |
| 型エラーが通った(C-1、S-2) | 検証の `npm run check` は spirits を除外している。CI が実際に実行するコマンドを、検証に使っていない | CI と同じコマンドを検証に使う規則。9.1 に `bun run check` を追加 |
| フォーク経路の破綻(C-4) | routing 層は両経路で共有されるのに、design V11 / D12 とテストが managed 経路しか見ていない | routing 層のハンドラは両経路でテストする規則。D12 に経路を明記 |
| 一覧に無い名前(C-3) | 失敗時の意味が違う関数(`restoreStep` は無視する、spec は終える)を再利用した。要件が列挙する値の種類を、種類ごとに試していない | 要件の列挙は種類ごとに 1 ケースという規則 |
| 例外時のロックの行(C-2) | テストは内部の依存(`lockRole`)をまるごと置き換えたので、本物の順序(`setRole` の後に `appendEntry`)を通らない | 失敗はホストの境界(FakePi)で注入し、本物の配線を通す規則 |

### 次の手順
- tasks の未完了の項目を apply で修正し、このスキルを再検証モード(前回レポート: このファイル)で実行する。
