## Deep Verification Report: enforce-verification-report-saving

- 検証対象: 233bada5a..233bada5a(未コミット変更: あり。前回も未コミット状態での検証だったため、差分範囲を確定できず**全体を再検証**した)
- テストコマンド: `bash scripts/test-clean-env.sh`(check + test + install + tmux-verify)
- strict 検証: `openspec validate enforce-verification-report-saving --strict`(成功)
- 規約正本: `docs/architecture/convention-registry.md`(基点からの変更: あり — `spirits:verify` 層の追加。d-verify1 以降の変更: なし)
- verify1 レポート: `openspec/changes/enforce-verification-report-saving/verify1.md`
- モード: 再検証(前回レポート: `openspec/changes/enforce-verification-report-saving/d-verify1.md`)

### 判定
FAIL

### 集計
| 観点 | 結果 |
|---|---|
| strict 検証 | 成功 |
| テスト | 成功 1566 / 失敗 0(install 97、tmux-verify 125 も全成功) |
| 規約検査 | 成功 6 / 失敗 0(`test/architecture-conventions.test.ts`) |
| 要件 | 意図どおり 12 / 全 13(C-1 が「保存の受理と応答」の store 文に抵触) |
| シナリオ | 挙動を確認 38 / 全 38、テストが実質的 36 / 全 38(2 件は SKILL.md 本文の静的証拠) |
| spec 外の変更 | 挙動変化あり 0 件 / なし 0 件(d-verify1 以降の追加分はすべて差し戻しタスク 2.1/4.1/4.2/4.3/4.5/5.1/7.1/7.2/7.3 に紐づく) |
| 継ぎ目 | 追加 7 件(Decision あり 7 / なし 0)、対価が未実現 0 件 |
| 重複 | 新たな重複 0 件(W-5 の重複は解消済み。コマンド行解析は `routing/phase.ts` の 1 箇所のみ) |
| タスク | 完了 20 / 全 20 |

### 継ぎ目一覧
| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `spirits:verify` 兄弟層 | 境界 | `packages/spirits/src/verify/` | D2 | ARCH-SPIRITS-LAYER | なし |
| N-2 | `verify → routing`(step 読み取り + コマンド行解析) | 境界 | `verify/register.ts:28` | D6・タスク 4.5 | ARCH-LAYER | なし |
| N-3 | `verify → openspec CLI`(`changeRoot` / 一覧解決) | 外部依存 | `verify/change-root.ts` | D3 | ARCH-PI-BOUNDARY | C-1 |
| N-4 | `spirits_verify_report_save` ツール | 拡張点 | `verify/tool.ts` | D1・D6 | ARCH-PI-BOUNDARY | なし |
| N-5 | `agent_before_settle` 督促 | 拡張点 | `verify/register.ts:159` | D7 | ARCH-PI-BOUNDARY | なし |
| N-6 | obligation / pin のメモリ状態 | 境界 | `verify/register.ts:68`、`pin.ts:36` | D10・D12(5) | なし | なし(C-1 の凍結は解消を確認) |
| N-7 | `routing` の `parseCommandInput` / `PiCommandLine` export | 抽象型(公開 interface) | `routing/phase.ts:222-256` | D12 追記・タスク 4.5 | ARCH-LAYER | なし(利用側 2 つ: routing 自身の `commandNameFromInput` と verify 層。対価 = 空白定義の一元化は実現) |

### 前回(d-verify1)指摘の再検証
| ID | 内容 | 状態 | 根拠 |
|---|---|---|---|
| C-1 | 固定後の pin が別変更へ再固定された | **解消** | `pin.ts:44` が固定後に即 return(凍結中の CLI 呼出もなし)。テスト `verify-report-pin.test.ts`「once pinned, no offered line moves the target」、`verify-report-register.test.ts`「a later input naming another change does not move the save destination」、実測 verdict `later-change-name-did-not-move-target`(alpha/verify2.md に保存、beta にレポートなし、evidence all-holds true) |
| W-1 | `--store` が保存経路に届かない | **部分解消**(主フロー解消、エッジが新 C-1) | 同一行の名前+store は配線済み(`register.ts:125`→`pin.storeId`→`save` 第4引数→`change-root.ts` の `--store`)。開行の store だけ後の回答が名前を固定した場合が未措置(下記 C-1) |
| W-2 | プロンプト再生成シナリオのテスト欠落 | **解消** | `verify-report-nudge.test.ts`「the nudge does not depend on the verify prompt's body」+ 構造化検証(verify 層の購読は lifecycle 5 イベントのみ) |
| W-3 | 非対話保存のテスト欠落 | **解消** | `verify-report-tool.test.ts`「a save succeeds in the non-interactive tool contexts」(print/json で同連番規則) |
| W-4 | 未使用定数 `EXTENSION_MODE_JSON` | **解消** | 削除。リポジトリ全体 grep で参照 0 |
| W-5 | コマンド行解析の重複 | **解消** | `parseCommandInput` に集約(`commandNameFromInput` は名称ハーフ)。`SKILL_COMMAND_PREFIX` の利用は `routing/phase.ts` のみ |
| S-1 | design の rename と実装 link の食い違い | **解消** | Decision 5・13・タスク 3.2 が link に修正済み(実装は不変)。残る命名の傷は G-1 |
| S-2 | Decision 6 の無効化記述の矛盾 | **解消** | 「ステップ終了・セッション開始・ツリー移動のみ。保存成功では外さない」に修正 |
| G-1 | 実測ドライバの `settles` 型 | **解消** | probe の実体と一致する型に修正 |
| G-2 | 未使用記録 `answerRunTools` | **解消** | 判定 `tool-visible-in-answer-run` が activeTools を検証。記録は削除 |

### 指摘

#### CRITICAL
- **[C-1] 検証を開いた行の `--store` 指定は、後の回答で対象が固定されたとき失われ、解決に `--store` が渡らない**
  - 場所: `packages/spirits/src/verify/register.ts:125`(`storeFlagFromArguments(line.rest)` を offer するのは開行の candidate と同時にだけ)、`packages/spirits/src/verify/pin.ts:41-56`(`storeId` の保持は pin が立ったときのみ)
  - 根拠: 仕様「保存の受理と応答」の追加文「検証を開いた入力が store の指定を含むときは、解決にもその store 指定を渡す。(SHALL)」は行の組合せを条件付けていない。実測(FakePi + 製品 register、セーブの storeId を記録): `/opsx-verify --store s1`(store のみ・名前なし)→ 解決不能なので未固定 → 回答 `alpha` で固定 → 保存時の解決呼出は `{changeName: "alpha", storeId: undefined}`。開行の `s1` は `offer("--store", "s1")` の candidate 落ちと同時に捨てられる。結果、ストア使うプロジェクトでレポートが最寄りローカル root へ解決され、同名変更があれば**誤ったツリーへ保存**、無ければ解決失敗で保存不能になる(d-verify1 W-1 が「誤保存は起きない」と書いた前提は store が解決経路に届いて初めて成立する)。design Decision 3 の「検証を開いたコマンド行から spirits が読み、**検証対象の固定と一緒に保持**して解決時へ渡す」も、固定が後から立ったケースの保持を定めている。
  - 修正先: 実装
  - 推奨: ステップを開く入力では store フラグを candidate の成否と独立に pin へ預ける。たとえば `VerifyPin` に `rememberStore(storeId: string | undefined): void`(開行時に呼ぶ、固定前の保持)と、固定時に「offer で渡された store → 保持済み store」の順で採用する規則を追加し、`register.ts` のステップ開始節で呼ぶ。テストは `verify-report-pin.test.ts`(保持した store で後の offer が固定されるとき storeId が効くこと)と `verify-report-register.test.ts`(開行 store のみ → 回答固定 → 解決器に storeId が届くこと)の 2 件。加えて仕様シナリオ「store 指定を伴う検証の保存」に「名前は後の回答で固定される」変형을 1 件追加する。

#### WARNING
なし。

#### SPEC
なし。

#### SUGGESTION
- **[G-1] 連番再試行の定数とテスト用シームが `rename` の名のまま(実操作は `link`)**
  - 場所: `packages/spirits/src/constants.ts:925`(`VERIFY_REPORT_RENAME_RETRY_MAX`)、`packages/spirits/src/verify/report-name.ts:69`(`beforeRename` 引数)
  - 根拠: S-1 で design・tasks・モジュール docstring は link に統一済みだが、識別子だけが rename の語を残す。挙動・仕様への影響はない。
  - 推奨: `VERIFY_REPORT_LINK_RETRY_MAX` / `beforeLink` へ改名(参照は constants 定義・report-name・save 系テストの計数箇所のみ)。やらない場合は design Decision 5 に「識別子の rename は歴史的経緯として残す」の 1 行を追記する。
- **[G-2] store 指定の実測は互換ランナーには含まれていない**
  - 場所: `scripts/managed-pi-compat/verify-report.ts`(fixture は nearest root のみ)
  - 根拠: store の配線は unit シーム(解決器の引数検査)と CLI 引数生成のテストで覆盖しているが、登録ストアへの実保存は fake プロバイダ計測の外。C-1 の修正後はその実測もない。
  - 推奨: C-1 修正時にドライバへ 2 ステージ目として `--store` 付きの保存を 1 本足すか、evidence の `mode` 欄に「store 経路は unit のみ」を明記する(登録ストアの staging が重いなら後者で十分)。

### verify1 との突き合わせ
- verify1 の提案 2 件(プロンプト再生成のテスト、非対話保存のテスト)は d-verify1 の W-2/W-3 として採用され、今回はどちらも解消を確認した。verify1 の判定「Ready for archive」は d-verify1 の C-1 で既に覆っており、今回の C-1 でさらに覆る。
- verify1 が拾えなかった理由(d-verify1 以降の新規指摘分): store の配線は W-1 の差し戻しで入った新コードで、verify1/d-verify1 とも「同じ行に名前と store」の happy path しか読んでいない。要求文の SHALL は組合せを条件付けないため、開行 store + 回答固定の経路がこぼれた。

### 次の手順
- FAIL: C-1 を apply で修正(開行 store の保持 + テスト 2 件 + spec シナリオ変形 1 件、実測ドライバの store 経路または evidence への限界記録)し、このスキルを再検証モードで実行する(`d-verify3.md`)。
- G-1・G-2 は任意(C-1 の作業に同乗させると安い)。
- archive は PASS / PASS WITH WARNINGS になってから。
