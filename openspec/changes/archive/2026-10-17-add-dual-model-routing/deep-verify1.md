## Deep Verification Report: add-dual-model-routing

- 検証対象: `1e8e075ec..40962fa8d`(未コミット変更: なし。本変更に関するもの)
  - 基点は HEAD と同一(main へ直接コミット済み)。コミット列(`[spirits]` 3 件、feat、docs の計 5 コミット)から範囲を推定した。
- テストコマンド: `./test.sh`、`cd packages/spirits && bun test && bun run check`、`npm run check`
- 規約正本: `docs/architecture/convention-registry.md`(基点からの変更: あり。`spirits:routing` 層の追加。design Decision 10 に理由あり)
- verify1 レポート: `openspec/changes/add-dual-model-routing/verify1.md`
- モード: 通常

### 判定

FAIL / BLOCKED

### 集計

| 観点 | 結果 |
|---|---|
| テスト | 成功 6519 / 失敗 0(`./test.sh` 5989、spirits 530) |
| 規約検査 | 成功 2 / 失敗 0(`architecture-conventions.test.ts`、`npm run check`) |
| 要件 | 意図どおり 11 / 全 14 |
| シナリオ | 挙動を確認 44 / 全 45、テストが実質的 38 / 全 45 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件(`test/support.ts` と `test/todo-widget.test.ts` は 2.1 のミラー変更に伴う修正として紐づけた) |
| 継ぎ目 | 追加 7 件(Decision あり 7 / なし 0)、対価が未実現 0 件 |
| 重複 | 新たな重複 2 件 |
| タスク | 完了 23 / 全 23(8.1 の検証条件が不成立、9.3 は実施記録なし `[要確認]`) |

### 継ぎ目一覧

| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `src/routing/` の新しい層 | 境界 | `packages/spirits/src/routing/` | 10 | ARCH-SPIRITS-LAYER | なし |
| N-2 | `entry → routing` の依存 | 境界 | `packages/spirits/src/index.ts:20` | 10 | ARCH-SPIRITS-LAYER | なし |
| N-3 | `ModelRoute.role`、`VirtualModelStateData.role`、`getVirtualModelEntry` | フォーク元変更 | `packages/coding-agent/src/core/virtual-models.ts:84,171` | 3, 4 | なし | C-1 |
| N-4 | `resolveModel` の role 透過、entry への保存、`routedModel.role` | フォーク元変更 | `packages/coding-agent/src/core/agent-session.ts:1467` | 4, 5 | なし | C-1, W-2, S-2 |
| N-5 | footer のロールバッジ | フォーク元変更 | `packages/coding-agent/src/modes/interactive/components/footer.ts:251` | 7 | なし | C-1, C-2 |
| N-6 | `registerVirtualModel`、`on("input")`、`on("agent_settled")` | 拡張点 | `packages/spirits/src/routing/register.ts:26-49` | 2, 6 | なし | W-1 |
| N-7 | pi 内部の api 値 `pi-virtual` と設定ファイルの未知キー保持への依存 | 外部依存 | `packages/spirits/src/constants.ts`、`packages/spirits/src/config.ts` | 1, 2(`test/pi-runtime/` の固定テストあり) | なし | なし |

### 指摘

#### CRITICAL

- **[C-1] 記録された role が文字列でないと footer の描画が例外で止まる**
  - 場所: `packages/coding-agent/src/modes/interactive/components/footer.ts:251`、`packages/coding-agent/src/core/virtual-models.ts:171`、`packages/coding-agent/src/core/agent-session.ts:1475`
  - 根拠: 要件「ロールの記録と復元」は「記録された値を読み取れない場合は、ロール未決定として扱わなければならない」とする。`getVirtualModelEntry` は `entry.data` を型検証なしにキャストする。`role: 42` を含む entry(手で編集したセッションファイル、または JS 拡張の route が数値を返した場合)があると、`sanitizeStatusText(42)` が `t.replace is not a function` を投げる(node で確認)。footer は毎フレーム描画されるため、描画が継続的に失敗する。
  - 修正先: 実装
  - 推奨: `_storedRoutedRole`(または `getVirtualModelEntry`)で `typeof role === "string"` のときだけ role を返す。`test/virtual-models.test.ts` に "reads a non-string stored role as no role" を追加する。差分は f98e1df53 の対象ファイル内に収まり、登録簿の行は変わらない。

- **[C-2] バッジが改行・タブ以外の制御文字(ESC など)を除去しない**
  - 場所: `packages/coding-agent/src/modes/interactive/components/footer.ts:14-20`(`sanitizeStatusText`)、`footer.ts:251`
  - 根拠: 要件「ロールバッジの表記」は「改行や制御文字が含まれる場合、それらを取り除いて 1 行で表記しなければならない」とする。実際に除去するのは `\r\n\t` のみで、`"x\x1b[2Jy"` は ESC を保持したまま出力される(確認済み)。他の virtual model が返したラベルで ANSI シーケンス(画面消去など)が端末に届く。空白のみの role は `[] ` と描画される。
  - 修正先: 実装(または spec)
  - 推奨: 拡張ステータスの既存挙動は変えず、バッジだけに `/[\x00-\x1f\x7f]/g` を除去する処理を通し、除去後に空ならバッジを出さない。`"\x1b[31mstrong"` のテストを追加する。spec を「改行およびタブ」に絞る場合は design Decision 7 も合わせて更新する。

- **[C-3] タスク 8.1 の検証条件が成立せず、文書の突き合わせコマンドが誤った行数を返す**
  - 場所: `docs/spirits-core-diffs.md:18`、`docs/spirits-upstream-sync.md:79`
  - 根拠: `git log --grep='\[spirits\]' --oneline` は 14 行を返す(`40962fa8d` のコミット本文が "[spirits]" を含む)。登録簿は 13 行。手順どおりに実行すると登録漏れがあるように見え、要件「取り込み時の登録簿との突き合わせ」の手順として機能しない。
  - 修正先: 実装(docs)
  - 推奨: 両文書のコマンドを `git log -E --grep='^\[spirits\]' --oneline` に置き換える(13 行で一致することを確認済み)。

#### WARNING

- **[W-1] スキルコマンドの解析が pi と重複し、区切りの扱いが食い違う**
  - 場所: `packages/spirits/src/routing/phase.ts:16-24`、`packages/coding-agent/src/core/agent-session.ts:2176-2180`
  - 根拠: pi はスキル名を最初の `" "` で区切り、spirits は `/\s/` で区切る。`"/skill:sprt-opsx-verify-deep\nadd-dual model"` では、pi はスキル名を `sprt-opsx-verify-deep\nadd-dual` と解釈して未知スキルとして展開せず、spirits は strong に遷移する。
  - 修正先: 実装
  - 推奨: 区切りを pi と同じ `" "` に揃え、改行を含む入力のテストを `test/routing-phase.test.ts` に追加する。

- **[W-2] `docs/virtual-models.md` の role の記述が実装と合わない**
  - 場所: `packages/coding-agent/docs/virtual-models.md:111`
  - 根拠: 文書は「最新の role を返し、どの entry にも role が無いときだけ undefined」と読める。実装は最新の entry の role だけを見るため、最新 entry に role が無ければ、それ以前の entry に role があっても undefined になる。
  - 修正先: 実装(docs)
  - 推奨: 「最新の entry の role。その entry に role が無ければ undefined」と書き直す。

- **[W-3] 取り込み後の diff コマンドが登録簿の対象ファイルの一部しか見ない**
  - 場所: `docs/spirits-upstream-sync.md:81`
  - 根拠: コマンドの対象は `packages/coding-agent/src packages/ai/scripts` のみ。登録簿の行には `test/footer-width.test.ts`、`test/virtual-models.test.ts`、`docs/virtual-models.md`、`packages/ai/test/` も含まれる。design の Risk の Mitigation(role のテストで差分消失を検知する)が、merge でテストごと消えた場合に検出されない。
  - 修正先: 実装(docs)
  - 推奨: `git diff <取り込み対象タグ> -- packages/coding-agent packages/ai` に広げるか、登録簿の行ごとの対象ファイルを渡す形にする。

- **[W-4] 登録簿の対象ファイルに存在しないパス・消える予定のパスがある**
  - 場所: `docs/spirits-core-diffs.md:33-34`
  - 根拠: `openspec/changes/add-architecture-conventions/` は HEAD に存在しない(1e8e075ec でアーカイブ済み)。`openspec/changes/add-sprt-bundled-skills/` は HEAD にはあるが、作業ツリーではアーカイブ処理中で削除されている。
  - 修正先: 実装(docs)
  - 推奨: `openspec/` のパスを外すか、`openspec/changes/archive/` 配下の実在パスに置き換える。

- **[W-5] 2 シナリオでテストが実質的でない**
  - 場所: `packages/spirits/test/routing-register.test.ts`、`packages/spirits/test/pi-runtime/virtual-model-api.test.ts`
  - 根拠: 「再読み込み後も利用できる」は fake pi に拡張を 2 回読み込ませるだけで、`/reload` 後も選択が残ることを確かめていない。「一覧に表示されて選択できる」は `getAvailable()` に含まれることの固定のみ。
  - 修正先: 実装(テスト)
  - 推奨: `packages/coding-agent/test/suite/harness.ts` と faux provider で、reload 後の `session.model` が `spirits/auto` のままで次のリクエストが振り分けられることを確かめるテストを追加する。

- **[W-6] thinking level の一覧が pi と重複している**
  - 場所: `packages/spirits/src/routing/register.ts:20`、`packages/coding-agent/src/core/virtual-models.ts:43`
  - 根拠: pi がレベルを追加しても `spirits/auto` に出ない。
  - 修正先: 実装(テスト)
  - 推奨: `packages/spirits/test/pi-runtime/` で pi の一覧との一致を固定する。

- **[W-7] タスク 9.3(TUI での目視確認)の実施記録が無い `[要確認]`**
  - 場所: `openspec/changes/add-dual-model-routing/tasks.md` 9.3
  - 根拠: 成果物・コミットに実施の記録が無い。
  - 修正先: 実装(確認作業)
  - 推奨: 再実施し、結果をタスクに記録する。
  - 要確認: 実施済みかを利用者に確認する。

#### SPEC

- **[S-1] 登録簿の対象範囲が spec の定義と実際の登録で食い違う**
  - 場所: `openspec/changes/add-dual-model-routing/specs/upstream-tracking/spec.md:6`、`docs/spirits-core-diffs.md:33-34`
  - 根拠: spec は対象を「Pi 上流コア(`packages/spirits/` を除く `packages/` 配下)に加えた差分」と定義する。実登録はコアを変えない `9edd6311c` と `80d9bbeaf` を含み、design Decision 9 の「現 10 件」もこの 2 件を含む数である。
  - 修正先: spec
  - 推奨: (a) spec を「1 行 = 1 `[spirits]` コミット(コア実装を変えないコミットも含む)」に改める、または (b) 2 行を登録簿から削除し、確認コマンドと Decision 9 の件数を合わせる。

- **[S-2] 成功レスポンスが無いとバッジが出ない**
  - 場所: `packages/coding-agent/src/core/agent-session.ts:1471`、`openspec/changes/add-dual-model-routing/specs/model-role-badge/spec.md`
  - 根拠: spec は「セッションにロールが記録されているとき…表記しなければならない」とする。`routedModel` は成功レスポンスが無ければ undefined を返すため、新しいセッションの最初のリクエストが provider エラーで終わると、role は記録済みなのにバッジが出ない。また normal 成功後に strong のリクエストが provider エラーで終わると、`[strong] … → <normal のモデル>` とバッジとルート先表示が食い違う。
  - 修正先: spec または実装
  - 推奨: (a) spec に「直近の成功レスポンスがある場合に表記する」と明記し、食い違い表示を Decision 5 の帰結として記載する、または (b) `routedModel` とは独立に role を返す経路を設け、成功レスポンスが無くてもバッジを出す。

#### SUGGESTION

なし。

### verify1 との突き合わせ

- verify1 W1(grep の行数): 採用。CRITICAL(C-3)に格上げ。タスク 8.1 の検証条件そのものが成立していないため。
- verify1 W2(存在しないパス): 採用(W-4)。ただし `add-sprt-bundled-skills` は HEAD には存在する。
- verify1 提案 1(登録簿の範囲): 採用し SPEC(S-1)とする。
- verify1 提案 2(制御文字): CRITICAL(C-2)に格上げ。spec の SHALL を満たさず、具体的な経路を示せるため。
- verify2 のみの指摘:
  - C-1: verify1 は「`sanitizeStatusText` 経由」で実装済みと判断し、値の型を確かめていない。
  - W-1: pi 側のスキルコマンド解析との比較をしていない。
  - W-2、W-3: 文書と実装・登録簿の照合をしていない。
  - S-2: `routedModel` の返り値の条件を読んでいない。

### 次の手順

- FAIL: C-1〜C-3 を apply で修正し、このスキルを再検証モードで実行する(前回の HEAD は `40962fa8d`)。
- BLOCKED: S-1、S-2 について利用者の判断を仰ぐ。
