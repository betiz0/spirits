## Deep Verification Report: add-rlm

- 検証対象: `a276dabe5`(main との merge-base)..`b16b2a7895d2728bf963a5dcc809c8c681cfdc33`(HEAD)。未コミット変更: あり
  - この範囲には M2 の 2 コミット(`6ab8cd48c`、`b16b2a789`)が含まれる。アーカイブ済み `add-binary-distribution` の範囲なので、B-4 は未コミット変更と未追跡ファイルだけを対象にした。
- テストコマンド: `cd packages/spirits && bun test && bun run check`、`sh scripts/install.test.sh`、`openspec validate add-rlm --strict`
- verify1 レポート: `openspec/changes/add-rlm/verify1.md`(`@` 参照で Phase B の前に内容が読み込まれた。Phase B の指摘はコードと実行結果だけを根拠にしているが、独立性は完全ではない)
- モード: 通常

### 判定
**FAIL / BLOCKED**

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 152 / 失敗 0。`install.test.sh` 43 / 0。`tsc` 成功。`openspec validate --strict` は失敗(exit 1) |
| 要件 | 意図どおり 10 / 全 11(「親 abort の伝播」が逸脱) |
| シナリオ | 挙動を確認 46 / 全 46(rlm 45 + tsrepl 変更 1)。テストが実質的 41 / 46 |
| spec 外の変更 | 挙動変化あり 2 件 / なし 4 件 |
| タスク | 完了 16 / 全 17(6.5 の検証条件が未達) |

### 指摘

#### CRITICAL

- **[C-1] 子セッションの生成中に親が abort されると、子が最後まで走る**
  - 場所: `packages/spirits/src/rlm/spawn.ts:142-146`、`:159`(窓は `:125` の `reload()` と `:139` の `createAgentSession`)
  - 根拠: 生成中に abort されると、リスナーを付ける前に `params.signal.aborted` が真になる。コードは `onSignalAbort()` を呼ぶだけで、続けて `session.prompt()` を実行する。上流の `AgentSession.abort()` は idle だと何も止めない(`agent-session.ts:2387-2397`)。再現スクリプトのログは `["abort","prompt:task","prompt:finished","dispose"]`、outcome は `aborted`。実機では、abort 済みの親の裏で子が最大 50 回のツール呼び出しを行い、`rlm` の Promise が解決せず直列化キューも解放されない。`rlm_usage` には正常な `aborted` として残る。違反する要件は「親 abort の伝播」。
  - 修正先: 実装
  - 推奨: `createAgentSession` の直後と `reload()` の前に `params.signal.aborted` を確認し、真なら `prompt` を呼ばず `aborted` 結果を返して dispose する。`rlm-spawn.test.ts` に生成をゲートで止めるテストを追加し、`promptTexts` が空であることを検証する。

- **[C-2] タスク 6.5 は完了済みだが、`openspec validate add-rlm --strict` が失敗する**
  - 場所: `tasks.md:36`、`specs/rlm/spec.md:81`、`:126`、`:206`
  - 根拠: exit 1。要件文が 500 文字を超える警告が 3 件(「子セッションの構成とコンテキスト分離」596、「rlm の使い方の案内」658、「rlm_usage の記録」817)。
  - 修正先: spec
  - 推奨: 各要件を分割し、列挙はシナリオへ移す。修正後に `--strict` を再実行する。
  - 要確認: 6.5 の前半(ルートと `packages/spirits` の `bun install --frozen-lockfile`)は、作業ツリーを変えないため未実行。

- **[C-3] 作業ツリーに add-rlm と無関係な、挙動を変える M2 向け未コミット変更が混在している**
  - 場所: `scripts/install.sh`(`--uninstall`、`check_platform` の前倒し)、`.github/workflows/spirits-ci.yml:14,25`、`scripts/install.test.sh`、`packages/spirits/bin/bootstrap.ts`、`bin/version.ts`、`test/version.test.ts`、`packages/spirits/README.md` の「アンインストール」節
  - 根拠: add-rlm の成果物には紐づかない(proposal は「`binary-distribution` は変更しない」)。アーカイブ済み `add-binary-distribution` には紐づく(`proposal.md:11`、`tasks.md` の 1.3 と 3.1、`specs/binary-distribution/spec.md:167`)。動作はしている(`install.test.sh` 43 件成功、`version.test.ts` 成功)。`install.test.sh` のケース 5 の変更は弱体化ではなく強化。問題は内容ではなく、add-rlm の差分に混ざっていること。
  - 修正先: 実装(コミットの分離)
  - 推奨: M2 修正として別コミットにする(明示パスで add)。`README.md` は M2 の節と rlm の節の両方を含むので、節単位で分ける。

#### WARNING

- **[W-1] 3 つのシナリオで、テストが期待結果を検証していない(挙動自体は正しい)**
  - 場所: `test/rlm-hostfn.test.ts:183-191`、`:349-369`
  - 根拠: 「opts.maxDepth による引き上げの丸め」は、クランプが無くても通る(深度 2 の `rlm` が `2` のエラーになることを見ていない)。「深度間の非待ち合わせ」は無関係な 2 つのエントリを作るだけで、親の `spawn` を保留したまま子のセルが `rlm` を呼ぶ経路を通していない(実際の入れ子にデッドロックがないことは `repro-hostfn.ts` で確認済み)。「コンテキストへの非注入」は自動テストがなく、スパイク項目 6 の実機確認だけ。
  - 推奨: 孫のツールからの `rlm("z")` が `深度上限（2）` になることを検証する。親の `spawn` を保留したまま子のセルで `rlm` を呼ぶテストを足す。非注入はスパイクの記録で担保する旨を成果物に明記する。

- **[W-2] `spawn` が reject すると `rlm_usage` が 1 件も記録されない**
  - 場所: `src/rlm/hostfn.ts:127-135`、`src/rlm/spawn.ts:196`
  - 根拠: `finally` の `session?.dispose()` が例外を投げると `spawnChildSession` は reject する(`repro-abort.ts` ケース B)。`hostfn` ではその場合の usage エントリが 0 件(`repro-hostfn.ts` ケース 3。キューは解放される)。「呼び出し 1 回につき 1 件」に反し、子のコストが失われる。
  - 推奨: `spawn.ts` で `session.dispose()` を try/catch で囲む。`hostfn.ts` で `await spawn(params)` を try/catch で囲み、`appendUsage("error", null)` を呼んで再 throw する。

- **[W-3] 未追跡のツール用ファイル 24 件が add-rlm と無関係(挙動は変えない)**
  - 場所: `.pi/prompts/opsx-*.md`、`.pi/skills/openspec-*/`
  - 推奨: add-rlm のコミットに含めない。

#### SPEC

- **[S-1] `SettingsManager` の共有について、design と tasks が食い違っている**
  - 場所: `design.md` Decision 2、Decision 10 の `SpawnSdk`、`tasks.md` 3.1、`spawn.ts:118-134`
  - 根拠: Decision 2 は「1 つ作ってローダーと共有する」。Decision 10 の `SpawnSdk` とタスク 3.1 には `SettingsManager` の口がない。実装は後者に従っている。ローダー側 `getAgentDir()`(`config.ts:566`)とセッション側既定 `getDefaultAgentDir()`(`sdk.ts:136-138`)は同じ関数に行き着き、挙動の差は見つからなかった。
  - 修正先: spec(推奨: design を実装に合わせる)
  - 要確認: どちらにするか(人間の判断)。

#### SUGGESTION

- **[G-1]** `src/types/pi-coding-agent.d.ts:7-9` の冒頭コメントが現状(`spawn.ts` の実行時 import)と合わない。
- **[G-2]** `openspec/config.yaml:30` の `例: add-tsrepl` が引用符なしで、`proposal` のルール全体が無視される。
- **[G-3]** `src/rlm/guidance.ts:51` の案内が、`opts.maxDepth` がルートからの絶対深度だと書いていない。

### verify1 との突き合わせ

- verify1 の重大(タスク 6.5)は採用。同じ 3 件の警告で exit 1 になることを独立に再現した(C-2)。
- verify1 の警告(`SettingsManager`)は重大度を上げて SPEC(S-1)にした。design 内と tasks の食い違いで、実装の不具合というより成果物の矛盾なので、人間の判断が要る。
- verify1 の提案 2 件は G-1、G-2 として採用。
- verify2 だけが指摘したもの(C-1、C-3、W-1、W-2)。C-1: abort 系のテストはどれもフェイクセッションの prompt 開始後に abort しており、生成中や abort 済みシグナルのケースがない。C-3: verify1 は merge-base からの差分に基づく逆方向の検査をしていない。W-1、W-2: テストの実質性の確認と、`spawn` が reject する経路の確認が verify1 にはない。
- verify1 だけが指摘したものはない。

### 次の手順

- FAIL: C-1、C-2、C-3 を apply で修正する。W-1、W-2 も同時に直す。その後このスキルを再検証モードで実行する(前回レポート: このファイル、前回の HEAD: `b16b2a7895d2728bf963a5dcc809c8c681cfdc33`。前回の検証は未コミット状態だったため、再検証では全体を検証し直す)。
- BLOCKED: S-1 について判断する。
- 未実行: 実プロバイダのスモーク(6.4)の再実行、バイナリのビルド、ルートの `bun install --frozen-lockfile`。スパイク文書が挙げる 2 つのセッション JSONL は実在し、`rlm_usage` 10 件ずつの内容が文書の記述と一致することは確認した。

## 成果物への反映(検証後に追記)

| 指摘 | 反映先 |
|---|---|
| C-1 | spec「親 abort の伝播」に要件文とシナリオ「子セッションの生成中の abort」を追加。design Decision 7 に節・代替案・Risk を追加。tasks 3.2 を未完了に戻し、テスト 3 件を追加 |
| C-2 | spec の 3 要件(子セッションの構成、案内、usage)を 10 要件に分割(子セッション 4、案内 3、usage 3)。`openspec validate add-rlm --strict` が成功。tasks 6.5 を未完了に戻した |
| C-3 | tasks 6.7 を追加(コミット範囲の分離) |
| W-1 | tasks 4.1 と 4.3 を未完了に戻し、検証するテストの内容を具体化。4.4 に非注入の検証方法を明記 |
| W-2 | spec に「子セッションの異常終了時の記録」シナリオを追加。design Decision 9 に記載。tasks 3.2(dispose)と 4.4(spawn の例外)を更新 |
| W-3 | tasks 6.7 に含めた |
| S-1 | 推奨案で反映: design Decision 2 を「共有しない」に改め、代替案を記載。tasks 1.3、proposal の Impact、design Decision 11 から `SettingsManager` を削除。人間の確認待ち |
| G-1 | tasks 1.3 に含めた |
| G-2 | tasks 6.6 を追加 |
| G-3 | tasks 2.2 と design Decision 14 に反映 |
