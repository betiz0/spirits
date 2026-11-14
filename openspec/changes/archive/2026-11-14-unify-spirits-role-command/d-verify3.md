## Deep Verification Report: unify-spirits-role-command

- 検証日: 2026-11-13
- 検証対象: `3c3962f97`(main との merge-base)..`f71b6746b`(HEAD)。未コミット変更: あり。`main..HEAD` のコミットは archive 済みの別 change のものなので、HEAD からの作業ツリー差分と未追跡ファイルを対象にした
- テストコマンド:
  - `cd packages/spirits && bun test`
  - `npm run check` と同じ手順を `--write` 抜きで実行(`npm run check` は `biome check --write` を含み、ファイルを書き換えるため)
  - `cd packages/spirits && tsc --noEmit`
  - tasks.md が挙げる `-t` 指定 93 件の個別実行
  - 互換ランナーの fixture モード(作業ツリーの bundle、sha256 `eb40d2c7…`。実装報告の bundle と同じ)
- verify1 レポート: なし(利用者の指示)
- モード: 再検証(前回レポート: `d-verify2.md`)。前回は未コミット状態での検証だったため、全体を検証し直した

再現は scratchpad の一時テスト(probe)で行った。リポジトリと `~/.spirits` は変更していない。

### 判定
**FAIL / BLOCKED**(BLOCKED の S-1 は利用者が決定済み。下の「利用者の判断」)

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 1241 / 失敗 0<br>check 成功(警告・情報なし)、`tsc --noEmit` 成功<br>tasks の `-t` 指定は成功 92 / 失敗 1<br>互換ランナーは confirmed 33 / not-run 3 / failed 1。failed は `rlm child abort` で、d-verify2 が変更前の bundle でも同じ失敗を確認済み(既存の失敗)。`role-status-report` は available |
| 要件 | 意図どおり 39 / 全 40 |
| シナリオ | 挙動を確認 173 / 174(未再現 1: TODO キーの実端末での打鍵。タスク 7.3 の記録による)<br>テストが実質的 約 171 / 174 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件 |
| タスク | 完了 42 / 全 42(ただし 8.2 の検証コマンドが失敗する) |

### 前回(d-verify2)の指摘の再検証
| 前回 | 結果 | 根拠 |
|---|---|---|
| C-1 1 ステップ 1 行 | 解消 | 一覧は 20 行。`rows carry every required field` |
| C-2 ステップ行の説明 | 一部未解消 | モデル・継続の有無・警告は出る。thinking レベルが誤る(新 C-1) |
| C-3 開き直したセッション | 解消 | `register.ts:328`。startup / resume / fork の 3 経路をテストしている |
| C-4 テスト名(5.3 / 5.4) | 解消 | 10 件すべて実在し、成功する。ただし 8.2 に新たな欠落がある(新 C-2) |
| C-5 status の観測行 | 解消 | 今回のランナー実行で `role-status-report` が available |
| C-6 badge のテスト | 解消 | `a role lock draws the badge before the reload` |
| C-7 拡張コマンドの除外 | 解消 | `role-panel.ts:173-174` |
| W-1〜W-8 | 解消 | |
| S-1(決定済み) | 解消 | 新しい要件とテスト `a failed lock save keeps the session lock on the row` |
| G-1〜G-3 | 解消 | |

### 指摘

#### CRITICAL

- **[C-1] strong が normal へ落ちるとき、一覧が要求に載らない thinking レベルを表示する**
  - 場所: `packages/spirits/src/commands/role-panel.ts:465`(ステップ行)、`:423-431`(`strong thinking` 行)
  - 根拠: 一覧は、要求した側のロール(`role`)で thinking レベルを解決している。ルーターは、実際に応答したロールで解決する(`router.ts:154`。strong が使えなければ normal)。probe P1 で再現した。
    - 設定: strong のモデルは未設定、`thinking.strong=max`、`thinking.normal=low`、`opsx-propose` のロールは strong
    - ステップ行の説明: 「It answers with compat-fake/fake-model. It asks for max.」
    - 同じ設定で `createRoutingRoute` が返した結果: `normal / fake-model / low`
    - `strong thinking` 行も「strong requests ask for max」と出す

    この食い違いは、`thinking.strong` を設定していなくても起きる。たとえば `thinking.normal=high` なら、行はセッションの選択値を出し、要求には high が載る。strong が既定の 2 ステップ(review / deep verify)は、strong のモデルが未設定の初期状態でこの経路に当たる。

    反する成果物は次の 3 つ。
    - 要件「対話端末で設定と稼働の一覧を開く」の SHALL(選択行に「有効な thinking レベル」を出す)
    - design D11
    - docs の記述(`docs/spirits-managed-pi.md:155` の「有効な thinking level」)
  - 修正先: 実装
  - 推奨: 説明のモデルと thinking レベルを、応答するロールで解決した結果から作る。比べる対象は、同じ条件でルーターが返すモデルとレベルである。

- **[C-2] tasks 8.2 の検証に挙げたテスト名が実在しない**
  - 場所: `tasks.md` 8.2 の d-verify2 C-5 の検証、`packages/spirits/test/managed-pi-compat-matrix.test.ts:270`
  - 根拠: `bun test test/managed-pi-compat-matrix.test.ts -t "records the status report as a role purpose"` は `matched 0 tests` で exit 1 になる。同じ目的のテストは `the status row is decided by the report the command produced` という名前で存在する。tasks.md 冒頭の規則「検証に挙げるケース名は実在するものと同一にする」に反する。
  - 修正先: 実装(テスト名)
  - 推奨: テスト名を `records the status report as a role purpose` に変える。

#### WARNING

- **[W-1] 一覧で編集したときの例外を捕まえていない。design Risks の対策が実装されていない** `[要確認]`
  - 場所: `role-panel.ts:578-585` と `:614-639`(`onSelect` → `write`)、`role-write.ts:51`(`lockRole` が try の外にある)
  - 根拠: design Risks は「`onSelect` 内の例外は catch して panel 内の通知行に出す」と書いている。実装の try は、設定ファイルの書き込み(`saveFile`)だけを囲んでいる。次の 2 つは保護されていない。
    - `pi.appendEntry`(ロックの記録)
    - 再描画時の `pi.getSettings()` / `getAvailable()` / `getCommands()`

    例外が出た場合の経路は次のとおり。
    1. pi-tui は `handleInput` を try なしで呼ぶ(`packages/tui/src/tui.ts:1110-1115`)。
    2. 例外は `uncaughtException` まで上がる。
    3. pi はそこで終了する(`interactive-mode.ts:4517`)。

    コマンドで同じ操作をした場合は、コマンドのエラーとして報告されるだけで済む。
  - 要確認: セッション記録への追記が、実際に例外を投げうるか(セッションファイルへの書き込み失敗など)。
  - 推奨: `openRolePanel` の `write` と `refresh` を try/catch で囲み、例外の内容を該当行の説明に載せる。

- **[W-2] 分岐移動(`/tree`)で、終えたステップが後の再読み込みで復活する** `[要確認]`(spec に書かれていないエッジケース)
  - 場所: `register.ts:328-334`
  - 根拠: 想定する経路は次のとおり。
    1. `/opsx-propose` で記録 `{step:"opsx-propose"}` が残る。
    2. `/spirits-clear` で、その先に `{step:null}` が残る。
    3. `/tree` で 2 つの記録のあいだのノードへ移る。移った先の分岐の最新の記録は `opsx-propose` で、メモリにステップは無い。
    4. 設定を変えると reload が走り、`restoreStep("opsx-propose")` が実行される。

    分岐移動は `session_start` ではない(`session_tree` を送る)ので、C-3 の閉じる処理も `beginSession` も走らない。
  - 推奨: 分岐移動でのステップの扱いを spec で決め、`session_tree` で処理する。

- **[W-3] シナリオ「空白を含むモデル参照」の、解決と保存を通しで確かめるテストが無い**
  - 場所: `managed-role-command.test.ts:107-117`(構文解析だけを見ている)
  - 推奨: ID に空白を含むモデルを持つカタログで `normal model Local/Qwen3.8 Flash Next` を実行し、`models.normal` に保存された値を確かめる。

- **[W-4] シナリオ「一覧での編集は行の説明で伝える」の「通知は出ない」を確かめるテストが無い**
  - 場所: `managed-role-panel.test.ts:519`(`driveScreen` は常に `spirits/auto` を選んだ状態で動く)
  - 根拠: `run.notices` はどのテストでも検証していない。挙動自体は正しい(`role-panel.ts` は `notify` を呼ばない)。
  - 推奨: 物理モデルを選び strong が未設定の状態で、一覧のロックを strong にする画面テストを足す。期待は `notices` が空で、ロックの行に 2 つの警告が出ること。

- **[W-5] シナリオ「ステップの 2 段選択」の結果の表示を確かめるテストが無い**
  - 場所: `managed-role-panel.test.ts:582-605`
  - 根拠: シナリオは「strong / low の行で unset → high を選ぶ」。既存テストは「unset → strong → high」で、検証しているのは書き込みだけ。行の値 `unset / high`、「ロックに従う」旨、「asks for high」は検証していない。
  - 推奨: シナリオどおりの操作をする画面テストを足す。

#### SPEC

- **[S-1] シナリオ「空白を含むモデル参照」の「表示名」が、モデル参照の解決規則と合わない**
  - 場所: `specs/managed-commands/spec.md` の「対象 項目 値の文法」のシナリオと、要件「完全一致から部分一致で決める」。design D7 も同じ語を使う
  - 根拠: 解決規則(旧 `/spirits-model` と同じ)が照合するのは `provider/id` と `id` だけで、表示名(`name`)は照合しない。たとえば `id: qwen3.8-flash-next`、`name: "Qwen3.8 Flash Next"` のモデルに `Local/Qwen3.8 Flash Next` を送ると、`no model matches` になる。9.3 で観測したモデルは、ID 自体に空白を含んでいた。
  - 修正先: spec
  - 推奨: シナリオを「ID に空白を含む」に直す(実装は変えない)。表示名でも照合させたいなら、要件のほうを改める。

#### SUGGESTION

- **[G-1]** 誤記が 2 つある。`docs/spirits-managed-pi.md:155` の「除したもの」は「除いたもの」、`docs/spirits-managed-pi-design.md:123` の「削した旧コマンド」は「削除した旧コマンド」。
- **[G-2]** `role-panel.ts:474`: thinking だけを設定したステップの説明が「Nothing is set, so … follows the lock」になる。「No role is set」と書くほうが正確。

### verify1 との突き合わせ
verify1 のレポートは渡されていない(利用者の指示)ため、省略した。

### 利用者の判断(2026-11-13)
- S-1: spec の文言を「ID に空白を含む」に直す。解決規則と実装は変えない。
- W-2: 分岐間の移動では、ステップを移動先の分岐の最新のステップの記録に合わせる。移動では記録を追記しない。
- 指摘の反映に合わせて、これまでの指示でも同じ種類の不備が繰り返した原因を分析し、その原因を除く手順を成果物に入れる。

### 反映先
- specs:
  - managed-commands: シナリオ「空白を含むモデル参照」を「ID に空白を含む」に直した(S-1)。要件「一覧の説明の thinking レベルは要求に載るレベルを示す」を足した。内容は、thinking レベルを応答するロールで決める MUST、ルーティングと一致する MUST、シナリオ 2 件(「strong が落ちるステップの行は normal のレベルを示す」「使えない strong の thinking レベルの行」)(C-1)。
  - dual-model-routing: 要件「分岐間の移動ではステップを移動先の記録に合わせる」とシナリオ 2 件を足した(W-2)。
- design: V11(`session_tree`)、D7(「表示名」→「ID」)、D11(解決の組み立てを D15 に任せる、thinking は応答するロールで解決、編集中の例外を一覧の中で捕まえる)、D12(分岐間の移動の規則)、D15(新設。要求の解決を 1 つの純関数にまとめる)、Risks(2 項目を追加、1 項目にタスクの参照を追加)。
- proposal: ステップの継続の項に、分岐間の移動の扱いを足した。
- tasks: 4.2 / 5.3 / 5.4 / 8.2 / 8.3 / 9.1 / 9.2 / 9.3 を未完了に戻し、2.5 / 3.7 / 9.6 / 9.7 を追加した。冒頭に「チェックと検証の規則」を、Workflow follow-up に原因分析を置いた。

### 原因分析の要約
同じ種類の不備が d-verify1 から d-verify3 まで繰り返した。詳細は tasks.md の Workflow follow-up にある。

| 繰り返した不備 | 原因 | 除去 |
|---|---|---|
| 一覧がルーターと食い違う(d-verify1 C-11、d-verify2 C-2、今回 C-1) | 解決の組み立てがルーターの中にしか無く、一覧が構成要素の関数を並べ直していた。指示も関数名を並べただけで、テストの期待値は手書き | 1 つの純関数に集約(D15、tasks 2.5)。ルーターの戻り値との突き合わせで検証 |
| tasks のテスト名が実在しない(d-verify2 C-4、今回 C-2) | 完了の根拠が `bun test` 全体の成功で、`-t` の名前を一度も照合していない | チェックの条件をタスクの検証コマンドの個別実行にする。全件の機械的な確認(tasks 9.6) |
| design の対策が未実装(今回 W-1) | Risks の対策がタスクに対応していない | 対応表(tasks 9.7) |
| シナリオのテストが近い操作で代わっている(今回 W-3〜W-5) | tasks がテスト名だけを指定し、使う入力を書いていない | GIVEN / WHEN をそのまま使う規則 |
| 分岐移動の見落とし(今回 W-2) | V7 が `session_start` しか洗い出していない | V11 と D12 の規則(tasks 3.7) |
| spec の語の不正確さ(今回 S-1) | 観測環境の事情から「表示名」と書いた | 解決規則に合わせて「ID」に直した |

### 次の手順
- tasks の未完了の項目を apply で修正し、このスキルを再検証モード(前回レポート: このファイル)で実行する。
