# Deep Verification Report: enforce-verification-report-saving

- 検証対象: `233bada5a5de4c4a5f906ef10d9cfc5ff614fe`（基点コミット = HEAD、未コミット変更: あり 21 経路）
- テストコマンド: `bun run check`（biome + `tsc -p tsconfig.scripts.json` + `packages/spirits` の型検査）／`cd packages/spirits && bun test`／`bash scripts/test-clean-env.sh`
- strict 検証: `openspec validate enforce-verification-report-saving --strict` → 成功（このレポート作成中に実行）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: あり。13 層化と `spirits:verify` の登記）
- verify1 レポート: `verify1.md`（Phase C で読んだ）
- モード: 再検証（前回レポート: `d-verify2.md`。`d-verify3` の検証は行われたがレポートが未保存で、本文はこのセッションにも残っていない。そのため d-verify3 の指摘は `tasks.md` / `design.md` / `specs/` に記録された差分から復元して再検証した）
- 保存手段: このセッションには `spirits_verify_report_save` が公開されていない（検証ステップが開いていないランタイムのため）。読み取り専用の例外 1 件（新規レポート 1 ファイルの作成）を直接書き込みで行った。実装・テスト・既存ファイルは変更していない。

## 判定

**FAIL**（CRITICAL 1 件）

前回の d-verify3 で解消したはずの未固定終了通知に、**固定済みの検証が後から誤った通知を受ける経路**が残っている。archive には進めない。

## 集計

| 観点 | 結果 |
|---|---|
| strict 検証 | 成功 |
| テスト | 成功 1580 / 失敗 0（125 ファイル、`bun test`） |
| 規約検査 | 成功（`bun run check` exit 0、`test/architecture-conventions.test.ts` 含む。install シェル 97 / 0、tmux-verify 125 / 0 は `bash scripts/test-clean-env.sh` exit 0） |
| 要件 | 意図どおり 13 / 全 14（`verification-report-saving` 11 + `sprt-opsx-verify-deep` 3。意図から乖離: 「対象を固定できないまま終わった検証を伝える」） |
| シナリオ | 挙動を確認 51 / 全 51、テストが実質 48 / 全 51 |
| spec 外の変更 | 挙動変化あり 0 件 / なし（docs 3 件・テスト host 1 件はいずれも成果物に記載あり） |
| 継ぎ目 | 追加 5 件（Decision あり 5 / なし 0）、対価が未実現 0 件 |
| 重複 | 新たな重複 1 件（開き直しのコマンド語） |
| タスク | 完了 20 / 全 20（チェック済み全項目に実装とテストを確認） |

## 継ぎ目一覧

| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `spirits:verify` 層（新ディレクトリ） | 境界 | `packages/spirits/src/verify/` | Decision 2 | ARCH-SPIRITS-LAYER / ARCH-REPL / ARCH-PI-BOUNDARY | なし |
| N-2 | entry → verify の配線（`optional()`） | 拡張点 | `packages/spirits/src/index.ts:204` | Decision 2 | ARCH-SPIRITS-LAYER | なし |
| N-3 | verify → routing（`phase.step()` / `stepStartedByInput()` / `parseCommandInput`） | 境界（新方向の import） | `packages/spirits/src/verify/register.ts:36` | Decision 12 / tasks 4.5 | ARCH-SPIRITS-LAYER | なし |
| N-4 | `spirits_verify_report_save` ツール（登録 API 経由の拡張点） | 拡張点 | `packages/spirits/src/verify/tool.ts:55` | Decision 1・6・12 | なし | なし |
| N-5 | openspec CLI 解決（`Bun.spawn`）+ 解決関数の注入 | 外部依存 | `packages/spirits/src/verify/change-root.ts:57` | Decision 3・13 | なし | なし |

d-verify3 の差し戻しで増えた `ChangeNameLister`（一覧取得の store 対応）は N-5 の注入関数の型であり、新しい継ぎ目ではない。Decision 14 の通知は既存ハンドラ（`input` / `agent_settled`）の内側で完結し、新しい拡張点も interface も追加していない。

## 指摘

### CRITICAL

- **[C-1] 対象が固定されていた検証が、終了後の無関係な入力で「変更名が固定されないまま終わった」通知を受ける**
  - 場所: `packages/spirits/src/verify/register.ts:104`（`announceUnpinnedClose` の早期 return が obligation を消費しない）
  - 根拠: `announceUnpinnedClose` は `obligation === undefined || obligation.saved || pin.pinned() !== undefined` のとき **`obligation = undefined` に達する前に return** する。固定済み（または保存後に未通知）で閉じた検証の obligation はそのまま残り、直後の `pin.clear()`（`register.ts:135` と `:173`）で pin だけが消える。次の任意の入力は `stepPrefix() === undefined` 分岐（`register.ts:128`）に入り、そこでは obligation あり・未保存・**pin は undefined** なので通知が出る。
    実測（`/tmp/verify-leak-probe.ts`、このセッションの `bun test` とは別に register 層を直接駆動。数値は通知出現回数）:

    | 経路 | 終了時 | 後続の入力のあと |
    |---|---|---|
    | A `/skill:sprt-opsx-verify-deep alpha` → 中断 | 0 | **1**（誤通知） |
    | B `/opsx-verify alpha`（未保存）→ `/opsx-apply other` | 0 | **1**（誤通知） |
    | C `/skill:sprt-opsx-verify-deep`（未固定）→ 中断 | 0 | 0 |
    | D `/opsx-verify`（未固定）→ `/opsx-apply other` | 1 | 1（繰り返さない） |
    | E `/skill:sprt-opsx-verify-deep`（未固定）→ `session_start` | 0 | 0 |
    | F `/skill:sprt-opsx-verify-deep alpha` → 保存 → settle | 0 | 0（`d-verify1.md` のみ） |
    | G `/opsx-verify`（未固定）→ 解決されない settle → 回答 | 1 | 1 |

  - 違反している要求: `verification-report-saving`「対象を固定できないまま終わった検証を伝える」の「対象が固定されている検証はこの通知の対象外とし、その未保存は『保存されるまで検証を完了として扱わない』が見る。(SHALL)」と「伝えない終了」シナリオ（A は中断の終了）。加えて通知文 `VERIFY_REPORT_UNPINNED_NOTICE` の内容（`constants.ts:989`）が「no change pinned」と述べるが、A・B の検証は実際には変更名を固定していたので、**事実と逆のことをユーザーへ伝える**。
  - 重大度の理由: 具体的な破綻経路（A・B の 2 経路）を示せる意図からの乖離。d-verify3 の差し戻し前には存在しなかった（変更前はステップ終了時に無条件で obligation を捨てていた）。Decision 14 の通知追加で生じた回帰で、既存テスト（A・B に相当する固定済み検証の終了）は督促と保存だけを見ていて、終了後の入力を跨がないため緑のまま残っている。
  - 修正先: 実装
  - 推奨: `announceUnpinnedClose` の先頭で **無条件に obligation を取り出す**形へ変え、通知するかどうかだけ後で判定する。

    ```ts
    const announceUnpinnedClose = (ctx: ExtensionContext, aborted: boolean): void => {
    	const open = obligation;
    	const pinnedAtClose = pin.pinned() !== undefined;
    	obligation = undefined;
    	if (open === undefined || open.saved || pinnedAtClose || aborted) return;
    	if (isInteractive(ctx)) ctx.ui.notify(VERIFY_REPORT_UNPINNED_NOTICE, "warning");
    	else writeStderr(VERIFY_REPORT_UNPINNED_STDERR_NOTICE);
    };
    ```

    併せて `test/verify-report-nudge.test.ts` に回帰テストを 2 件追加する: (a) `/skill:sprt-opsx-verify-deep alpha` → `makeSettledEvent(true)` → 後続で任意入力 → 通知 0 件、(b) `/opsx-verify alpha`（未保存）→ `/opsx-apply other` → 後続で任意入力 → 通知 0 件。既存の D・G 相当（未固定では 1 回だけ）も同時に固定されていることを確認する。

### WARNING

- **[W-1] 新シナリオ「未固定の拒否理由を開き直しでも案内する」のテストが同一定数との比較だけで、案内内容を検証していない**
  - 場所: `packages/spirits/test/verify-report-tool.test.ts:83`（`expect(result.content[0]).toMatchObject({ text: VERIFY_REPORT_UNPINNED_REASON })`）
  - 根拠: 返す文字列が定数と一致することは確認するが、その定数の中身（聞き返しによる固定と、変更名付きで開き直す方法の**両方**が書かれていること）は検査していない。`VERIFY_REPORT_UNPINNED_REASON`（`constants.ts:977`）から開き直しの句を消しても同じテストは通る。シナリオの THEN は「返す理由は … 双方を案内する」なので、期待結果は文案の側にある。
  - 重大度: 挙動自体は正しいので WARNING（B-3 の「テストが期待結果を検証していない」）。
  - 修正先: テスト
  - 推奨: 同じテストに文案アサーションを足す。`expect(VERIFY_REPORT_UNPINNED_REASON).toContain("reopen")` と、両コマンド語を名指しする `expect(VERIFY_REPORT_UNPINNED_REASON).toContain("/opsx-verify <change>")` / `toContain("/skill:sprt-opsx-verify-deep <change>")` を 1 行ずつ（G-1 の定数テストと兼ねる）。

- **[W-2] スキル仕様へ追加した「対象未固定で拒否されたら開き直しを案内する」シナリオに、SKILL.md 本文のアサーションが無い**
  - 場所: `packages/spirits/test/bundled-skills.test.ts:279-295`
  - 根拠: 既存のアサーションはツール名・保存手段が無い環境のフォールバック・読み取り専用の例外・`verify<N>.md` / `d-verify<N>.md` の除外・`disable-model-invocation` を見るが、Decision 14 で決めた「開き直しの案内」本文（`packages/spirits/src/harness/bundled-skills/sprt-opsx-verify-deep/SKILL.md:288`）を検査していない。この行を消しても `bun test` は緑のまま、スキル仕様のシナリオだけ満たされない状態になる。
  - 修正先: テスト
  - 推奨: 同じテストに `expect(body).toContain("開き直す")` と `expect(body).toContain("/skill:sprt-opsx-verify-deep <change>")` を追加する。

- **[W-3] 開き直しのコマンド語が `constants.ts` 内で 3 重複し、`STEP_DEFINITIONS` の starters と結ばれていない**
  - 場所: `packages/spirits/src/constants.ts:973`（`VERIFY_REPORT_STEP_NOT_OPEN_REASON`）、`:977`（`VERIFY_REPORT_UNPINNED_REASON`）、`:989`（`VERIFY_REPORT_UNPINNED_NOTICE`）
  - 根拠: 「検証を開くコマンドは何か」という知識は `STEP_DEFINITIONS` の starters（`constants.ts:544` `/opsx-verify`、`:552` `/skill:sprt-opsx-verify-deep`）が正で、層の検査もそちらを見る。今回は同じコマンドの組を messaging 用の 3 定数に素の文字列で書き、README と SKILL.md にも写した。starter が改名されると、実装（step 判定）は追随するのに 3 つの文案と README・SKILL.md だけが黙って古くなる。既存の `VERIFY_REPORT_STEP_NOT_OPEN_REASON` も同じ形だが、この変更で +2 増えた。
  - 修正先: 実装（`test/constants-verify-report.test.ts` に 1 テストで足りる）
  - 推奨: `STEP_DEFINITIONS` から両 starter を引き、`VERIFY_REPORT_UNPINNED_NOTICE` / `VERIFY_REPORT_UNPINNED_REASON` / `VERIFY_REPORT_STEP_NOT_OPEN_REASON` がそれぞれの starter 語を含むことを assert するテストを `test/constants-verify-report.test.ts` に追加する。文案を合成リテラルへ直すのは可読性を下げないので、テストによる連結で十分。

### SPEC

なし。d-verify3 で開いた S-1 は Decision 14 として design に決定記録があり、spec（`specs/verification-report-saving/spec.md` の要求「対象を固定できないまま終わった検証を伝える」と、固定要求の範囲文）・proposal・README・スキル仕様と実装の 4 者が同じ範囲を述べていることを読み合わせで確認した。tasks 4.3 / 6.1 / 7.1 の記録も実装と一致する。

### SUGGESTION

- **[G-1] 「伝えない終了」のうち `session_start` / `session_tree` 側が、この通知について未テスト**
  - 関連して、`isInteractive` の判定（`register.ts:257`）が `tui` / `rpc` 以外を stderr へ回すことは既存の非対話テストが見るが、新通知では `print` のみの検査で `json` は未検査（督促側のテストは両モードを回している）。
  - 場所: `packages/spirits/test/verify-report-nudge.test.ts`（reload テストは督促を見、中断は新通知テストが見るが、`session_start` / `session_tree` は督促の有無しか見ていない）
  - 根拠: 実測（E）では `session_start` でも後続の入力でも通知 0 件で、仕様どおり。ただし `register.ts:183` / `:192` が `announceUnpinnedClose` を呼ばないことへの固定が無い。
  - 推奨: 未固定で開いた状態で `session_start`（`reason: "reload"`）→ 任意入力、および `session_tree` → 任意入力で通知 0 件を確かめる 1 テストを同じファイルに足す。

## 前回の指摘の再検証（d-verify1 / d-verify2 / 記録済みの d-verify3）

| ID | 内容 | 状態 | 根拠 |
|---|---|---|---|
| d-verify1 C-1 | 固定後の対象が動く | 解消 | `pin.ts:66` で `offer` が固定後に no-op。`verify-report-pin.test.ts`、`verify-report-register.test.ts:「a later input naming another change…」`、evidence `later-change-name-did-not-move-target` |
| d-verify1 W-1 | store が保存経路に届かない | 解消 | `pin.ts` `rememberStore` / `storeId()`、`save.ts` 第 4 引数、`register.ts` の配線 |
| d-verify1 W-2 | プロンプト再生成シナリオのテスト無し | 解消 | `verify-report-nudge.test.ts:83-110`（ダミーテンプレートを展開して投入） |
| d-verify1 W-3 | 非対話保存のテスト無し | 解消 | `verify-report-tool.test.ts:121-135`（print / json で保存成功と `verify2.md`） |
| d-verify1 W-4 | 未使用の `EXTENSION_MODE_JSON` | 解消 | `rg EXTENSION_MODE_JSON` → 0 件。非対話判定は `ctx.mode` の `tui`/`rpc` 明示判定（`register.ts:250`） |
| d-verify1 W-5 | コマンド行解釈の 2 箇所作成 | 解消 | `routing/phase.ts` `parseCommandInput` に集約、`verify/register.ts:36` が import。ローカル版は削除済み |
| d-verify1 S-1 | design の `rename` と実装 `link` の食い違い | 解消 | `design.md` Decision 5 が `link` に統一（`:66-68`）、実装 `report-name.ts:105` |
| d-verify1 S-2 | Decision 6 の無効化記述の自己矛盾 | 解消 | Decision 6 の記述が「保存成功では外さない」に揃っている（design Decision 6、`register.ts:110` のコメント） |
| d-verify1 G-1 / G-2 | evidence ドライバの型と未使用観測 | 解消 | `ProbeEvidence` が probe の書く `settled: {aborted}` のみ、`answerRunTools` 削除（`scripts/managed-pi-compat/verify-report.ts:131-136`） |
| d-verify2 C-1 | 開行の `--store` が後の回答で失われる | 解消 | `pin.rememberStore` をステップ開行で呼ぶ（`register.ts` の `rememberStore(storeFlagFromArguments(line.rest))`）、`verify-report-pin.test.ts`・register の該当テスト |
| d-verify2 G-1 | `RENAME` の名の残骸 | 解消 | `VERIFY_REPORT_LINK_RETRY_MAX` / `beforeLink`（`constants.ts:925` 付近、`report-name.ts:119`） |
| d-verify2 G-2 | store 経路が unit 止まり | 解消 | `verify-report.ts` の `stageStore()` が隔離 HOME で `openspec store setup` を実行し、store のみ変更の保存・ローカルのみ変更の拒否を実測（evidence 11 判定 all-holds） |
| d-verify3 C-1 | 固定と保存で別 store | 解消 | `createOpenspecChangeNameLister` が `storeId` を受け `openspec list --json --store <id>`（`change-root.ts:150-165`）、`pin.offer` が一覧取得にも同じ store を渡す（`pin.ts:74`）。unit + register 配線 + 実測 |
| d-verify3 C-2 | 採番・作成 I/O の例外と一時ファイル残留 | 解消 | `report-name.ts:86-90`（採番失敗を理由へ）、`:100-104` / `:113-118`（一時ファイル削除）、`save.ts:29-35`。テスト 4 件 |
| d-verify3 S-1 | 物理モデルの保証範囲 | 解消（範囲を明記する選択で決定済み） | Decision 14、spec の範囲文とシナリオ、proposal、README。ただし**その新通知に上記 C-1 の新欠陥** |
| d-verify3 W-1 | プロンプト本文差し替えの回帰テストが無かった | 解消 | 一時 fixture で `.pi/prompts/opsx-verify.md` の本文そのものを差し替える形に変更 |

## verify1 との突き合わせ

- verify1 の提案 1（プロンプト再生成テスト）: 採用済み（`verify-report-nudge.test.ts`）。verify1 が挙げた「静的確認だけ」の状態は解消している。
- verify1 の提案 2（print モードでの保存テスト）: 採用済み（`verify-report-tool.test.ts:121-135`）。
- verify1 が見逃した点: verify1 は Decision 14 以前のコードで検証されたもので、「固定済み検証の obligation が終了後も残る」経路は見ていない（督促の有無しか見ていないため）。d-verify1 C-1 のときと同じく、**pin・obligation の寿命をまたぐ経路**が verify1 のキーワード確認では見えない、という同じ型の落ち口になる。
- 重大度の食い違い: なし（verify1 の 2 件は任意の提案、本报告では CRITICAL 1・WARNING 3・SUGGESTION 1）。

## 次の手順

1. **C-1 を apply で修正**（`announceUnpinnedClose` で obligation を無条件に消費 + 回帰テスト 2 件）。W-1・W-2・W-3、任意で G-1 も同じ差し戻しで消化できる。
2. 修正後、このスキルを**再検証モード**で再実行する（連番規則上、次は `d-verify4.md` の作成になる）。
3. PASS / PASS WITH WARNINGS になってから `/opsx-archive`（本仕様 2 件の同期を伴う）。現状の判定 FAIL なので、**アーカイブは行わない**。
