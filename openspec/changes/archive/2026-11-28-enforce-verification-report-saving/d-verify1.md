## Deep Verification Report: enforce-verification-report-saving

- 検証対象: 233bada5a..233bada5a（未コミット変更: あり）
- テストコマンド: `bash scripts/test-clean-env.sh`（check + test + install + tmux-verify）
- strict 検証: `openspec validate enforce-verification-report-saving --strict`（成功）
- 規約正本: `docs/architecture/convention-registry.md`（基点からの変更: あり — `spirits:verify` 層の追加。層表・所属表・ARCH-REPL / ARCH-SPIRITS-LAYER / ARCH-PI-BOUNDARY の文言を同一変更で更新）
- verify1 レポート: `openspec/changes/enforce-verification-report-saving/verify1.md`
- モード: 通常

### 判定
FAIL / BLOCKED

### 集計
| 観点 | 結果 |
|---|---|
| strict 検証 | 成功 |
| テスト | 成功 1559 / 失敗 0（`check` スイートも 0。`bun run check` 相当を内包） |
| 規約検査 | 成功 6 / 失敗 0（`test/architecture-conventions.test.ts`） |
| 要件 | 意図どおり 12 / 全 13（C-1 が「検証対象は入力から固定し、モデルの申告では動かない」の意図と食い違う） |
| シナリオ | 挙動を確認 34 / 全 36、テストが実質的 34 / 全 36 |
| spec 外の変更 | 挙動変化あり 0 件 / なし 1 件（W-4 の未使用定数） |
| 継ぎ目 | 追加 6 件（Decision あり 6 / なし 0）、対価が未実現 1 件（W-1 の store オプション） |
| 重複 | 新たな重複 1 件（W-5） |
| タスク | 完了 19 / 全 19 |

### 継ぎ目一覧
| # | 継ぎ目 | 種別 | 場所 | 対応する Decision | 関係する規約 ID | 指摘 |
|---|---|---|---|---|---|---|
| N-1 | `spirits:verify` 兄弟層 | 境界 | `packages/spirits/src/verify/`（`docs/architecture/convention-registry.md:35,55`） | Decision 2 | ARCH-SPIRITS-LAYER, ARCH-LAYER-UNKNOWN | なし |
| N-2 | `verify → routing`（`phase.step()` / `stepStartedByInput()` の読み取り） | 境界 | `packages/spirits/src/verify/register.ts:38` | Decision 6 | ARCH-LAYER | なし |
| N-3 | `verify → openspec CLI`（`changeRoot` 解決） | 外部依存 | `packages/spirits/src/verify/change-root.ts:51` | Decision 3 | ARCH-PI-BOUNDARY（ホスト外の外部コマンド） | W-1 |
| N-4 | `spirits_verify_report_save` ツール | 拡張点 | `packages/spirits/src/verify/tool.ts:53` | Decision 1・6 | ARCH-PI-BOUNDARY | なし |
| N-5 | `agent_before_settle` 督促 | 拡張点 | `packages/spirits/src/verify/register.ts:167` | Decision 7 | ARCH-PI-BOUNDARY | なし |
| N-6 | obligation / pin のメモリ状態 | 境界 | `packages/spirits/src/verify/register.ts:84`、`pin.ts:32` | Decision 10 | なし | C-1 |

### 指摘

#### CRITICAL
- **[C-1] 固定済みの検証対象が、後続のユーザー入力で別の変更へ移る（未固定のときだけ動くという設計と食い違う）**
  - 場所: `packages/spirits/src/verify/register.ts:132-133`、`packages/spirits/src/verify/pin.ts:35-40`
  - 根拠: `register.ts` の input ハンドラは、検証ステップが開いているかぎり非 extension の入力を無条件に `pin.offer()` へ渡す。`pin.offer()` は「未固定のときだけ」を判定せず、一覧に載る名前なら常に上書きする。実測（`spirits/auto` 相当で run を解決させた状態）: `/opsx-verify alpha` → ユーザー入力 `beta`（一覧に載る別変更）→ `spirits_verify_report_save` の保存先が `beta/verify1.md` になり、alpha の検証本文が beta のディレクトリへ入る（`alpha/` は空、詳細は `register.ts:212` の保存経路）。`pin.ts:5-12` のモジュール docstring 自身が「while nothing is pinned」と書いており、実装はその文書にも反する。design Decision 12 の (2)(3) も未固定のあいだの入力だけを固定元と定めている。Decision 1 が (B) を退けた理由（検証対象と違う変更へ保存できる）が、ユーザー入力経由で復活している。仕様 `verification-report-saving` / 検証対象は入力から固定し、モデルの申告では動かない、の意図（保存先は検証対象の関数）と食い違う。
  - 修正先: 実装
  - 推奨: `register.ts:132` の呼び出しを `pin.pinned() === undefined` のときだけ `offer` する形にし、`test/verify-report-pin.test.ts` に「固定後に別の一覧名を渡しても動かない」テスト、`test/verify-report-register.test.ts` に「固定後に別の変更名を入力しても保存先が変わらない」テストを追加する。再固定を意図するなら design Decision 12 と `pin.ts` の docstring、仕様のシナリオを同一変更で書き換える（その場合は「どの入力が再固定の根拠か」を仕様に書く）。

#### WARNING
- **[W-1] store の識別子が保存経路に届かず、`--store` 付きの検証が保存できない**
  - 場所: `packages/spirits/src/verify/save.ts:18-24`、`packages/spirits/src/verify/register.ts:212`、`packages/spirits/src/verify/register.ts:56-69`
  - 根拠: `ReportSaver` と `ChangeRootResolver` は `storeId?` を受け取るが、製品配線（`register.ts:212`）は常に 3 引数で呼ぶため `storeId` は undefined のまま。`firstArgumentFromInput()` はコマンド語の直後の第 1 トークンだけを返すので、`/opsx-verify alpha --store s1` の `s1` は捨てられる。design Decision 3 は「store 宣言・ストア解決・config ポインタの規則は openspec の規則」として CLI に委ねるが、その CLI 呼び出しに `--store` を渡す経路が無い。ストアを使うプロジェクト（`.pi/prompts/opsx-verify.md` の「ストアの選択」節が対象）では、`openspec status --change alpha --json` が最寄りのローカル `openspec/` を解決して失敗し、保存が理由付きで拒否される（誤った場所への保存は起きないが、保証が効かない構成が残る）。`test/verify-report-change-root.test.ts` は store 引数を fake で渡しているだけで、製品配線からの到達性は検証していない。
  - 修正先: 実装（または design と README の限界記録）
  - 推奨: 入力テキストから `--store <id>` を拾って pin と一緒に保持し、`save(body, changeName, prefix, storeId)` へ渡す経路を 1 本通す（`firstArgumentFromInput` の隣に store 解析を置く）。実装しない場合は design Decision 3 と README に「store 指定は保存に反映されない」限界を明記し、`save.ts` の未使用引数を削る。

- **[W-2] シナリオ「検証プロンプトが再生成される」に対応するテストが無い**
  - 場所: `openspec/changes/enforce-verification-report-saving/specs/verification-report-saving/spec.md`（同シナリオ）、`packages/spirits/test/verify-report-nudge.test.ts`
  - 根拠: 挙動は正しい（`verify/` のどこにも `.pi/prompts` 参照が無く、`git diff` にもプロンプト編集が無い）が、再生成を模したテストが無い。verify1 の提案 1 と同じ指摘を、重大度定義（シナリオに対応するテストが無い = WARNING）に従って上げた。
  - 修正先: 実装（テスト）
  - 推奨: `test/verify-report-nudge.test.ts` に、ダミーのプロンプト本文を `pi.slashCommands` で与えたまま input→settle の督促が 1 回返るテストを 1 件追加する。

- **[W-3] シナリオ「非対話でも保存は同じ規則で効く」に対応するテストが無い**
  - 場所: `packages/spirits/test/verify-report-tool.test.ts`
  - 根拠: `tool.execute` にモード判定が無く構造的に保証されるが、`print` / `json` のツールコンテキストで保存が成功するテストが無い。verify1 の提案 2 と同じ。
  - 修正先: 実装（テスト）
  - 推奨: `test/verify-report-tool.test.ts` に `erasedToolContext(tool, { mode: "print" })` での成功保存を 1 件追加する。

- **[W-4] 未使用の定数 `EXTENSION_MODE_JSON` が追加されている（タスク・design に記載が無い）**
  - 場所: `packages/spirits/src/constants.ts:357`
  - 根拠: `rg` の結果、参照は定義 1 箇所のみ。`isInteractive()` は `tui` / `rpc` だけを許可し、他は非対話として落ちるため JSON の定数は不要。タスク 2.1 の列挙にも無い。挙動は変わらない。
  - 修正先: 実装
  - 推奨: 定数を削除するか、非対話判定（`ctx.mode !== EXTENSION_MODE_TUI && ctx.mode !== EXTENSION_MODE_RPC`）を `EXTENSION_MODE_JSON` / `EXTENSION_MODE_PRINT` の明示判定に書き換えて使う。

- **[W-5] pi のコマンド行の解釈が 2 箇所に重複している（既存の `commandNameFromInput` と新設の `firstArgumentFromInput`）**
  - 場所: `packages/spirits/src/routing/phase.ts:220-230`、`packages/spirits/src/verify/register.ts:56-69`
  - 根拠: どちらも「`/skill:<name>` か `/<name>` か」と「コマンド語の終端」を判定する。`SKILL_COMMAND_PREFIX` の扱いと空白の扱いを二重に持つ。すでに差異がある: routing は `indexOf(" ")`（半角空白のみ）、verify は `search(/\s/)`（任意の空白）。`/skill:foo<TAB>bar` で routing はコマンド名を `skill:foo\tbar` と読み（ステップは開かない）、verify は第 1 引数を `bar` と読む。現状はステップが開かないため実害は無いが、片方だけ直すと食い違う。
  - 修正先: 実装
  - 推奨: `routing/phase.ts` の解析を「コマンド名 + 第 1 引数」を返す 1 つの関数に一般化して export し、`verify/register.ts` はそれを呼ぶ（`verify` は `routing` へ型・値の両方で依存を許可されている）。空白の定義も 1 つに揃える。

#### SPEC
- **[S-1] design Decision 5 が `rename` と EEXIST 再試行を書いているが、実装は `link`（ハードリンク）である**
  - 場所: `openspec/changes/enforce-verification-report-saving/design.md:58-62`（`:125` の「rename の純ロジック」も同じ）、`packages/spirits/src/verify/report-name.ts:89`
  - 根拠: POSIX の `rename(2)` は既存の最終名を黙って置き換えるため、「既存ファイルを上書きしない」という Decision 5 の目的を満たせない。実装は `link(temp, final)` を使い、EEXIST を実際に受けて次連番へ進む（`report-name.ts:88-99`）。挙動は仕様どおりで、実装のほうが正しい。verify1 も design の記述をそのまま「wx + rename」と転記しており、design の文言が誤った事実を 2 つのレポートに広げている。
  - 修正先: spec（design）
  - 推奨: Decision 5 の本文と選択肢 (C) を「同一ディレクトリの一時ファイルへ `wx` で書き切り、`link` で最終名へ張る（`rename` は上書きになるため使わない）。`link` が EEXIST なら次連番」に書き換える。`report-name.ts` の docstring は既に正しいので、design を実装に合わせる。

- **[S-2] design Decision 6 の「無効化は保存成功・ステップ終了・セッション開始で駆動する」が、同じ Decision の「保存成功では外さない」と矛盾している**
  - 場所: `openspec/changes/enforce-verification-report-saving/design.md:70`
  - 根拠: 実装は保存成功で `syncActive()` を呼ばず（`register.ts:128-146` の保存経路に `syncActive` が無い）、ステップ終了・セッション開始・ツリー移動だけで外す。Decision 6 の前半（保存成功では外さない）と実装は一致し、後半の 1 文だけが食い違う。
  - 修正先: spec（design）
  - 推奨: 後半を「無効化はステップ終了（`agent_settled`、中断後も発火）とセッション開始・ツリー移動で駆動する」に直す。

#### SUGGESTION
- **[G-1] evidence ドライバの `ProbeEvidence.settles` が、probe が書かない `aborted` を要求している**
  - 場所: `scripts/managed-pi-compat/verify-report.ts:96`
  - 根拠: `fixtures/verify-report-probe.ts` の `settles` は `{ entries, canContinue }` だけを書く。`readProbe` は JSON を型にキャストするので型検査は通るが、宣言と実体が食い違い、将来 `settles` を読む判定を書くと `aborted` が undefined になる。
  - 修正先: 実装（テスト用ドライバ）
  - 推奨: `settles` の型から `aborted` を落とすか、probe 側で `aborted` を書く（`agent_settled` のフラグを `settles` に統合する）。

- **[G-2] `answerRunTools` を記録しているが判定に使っていない**
  - 場所: `scripts/managed-pi-compat/verify-report.ts`（`measurements.answerRunTools`）
  - 根拠: 「回答 run でもツールが見える」判定は `answerRun.promptHasTool` で成立しており、`answerRunTools` はどの verdict からも読まれない。
  - 修正先: 実装（テスト用ドライバ）
  - 推奨: 判定を `answerRun.activeTools.includes("spirits_verify_report_save")` でも確認する（`tool-declared-during-verify` と同じ形）か、記録を削る。

### verify1 との突き合わせ
- verify1 だけが指摘した項目: 提案 2 件（プロンプト再生成のテスト、非対話保存のテスト）を再検証し、W-2 / W-3 として採用した。重大度は verify1 の「提案」から WARNING へ上げた（スキルの重大度定義: シナリオに対応するテストが無い、または期待結果を検証していない = WARNING）。verify1 の「重大・警告なし」は、この 2 件を提案に留めた判断による。
- verify2 だけが指摘した項目: C-1（pin の再固定）、W-1（store 未配線）、W-4（未使用定数）、W-5（コマンド行解析の重複）、S-1（rename と link）、S-2（Decision 6 の矛盾）、G-1・G-2。verify1 が拾えなかった理由: verify1 は design の記述（`rename`、`保存成功で無効化`）を実装の証拠としてそのまま採用しており、コードと design の突き合わせになっていない。C-1 は「ユーザー入力から固定」という要件文の確認だけで、固定後の入力で pin が動く経路（`register.ts:132` の無条件 `offer`）を読んでいない。キーワード一致では検出できない型。
- 重大度が食い違う項目: 上記のとおり verify1 の提案 2 件を WARNING に上げた。verify2 の判断を採る（スキルの定義に照らして WARNING が正しい）。

### 次の手順
- FAIL: C-1 を apply で修正し（`offer` を未固定のときだけ呼ぶ + 2 テスト追加）、このスキルを再検証モードで実行する。
- BLOCKED: S-1・S-2 について、design の文言を実装に合わせて直す判断を仰ぐ（実装が正しく、design が誤っているため、修正は design 側）。
- W-1 は「store を保存経路に通す」か「限界として design / README に記録する」かを決めてから archive に進む。
- 再検証時は `bash scripts/test-clean-env.sh` と `bun run check` を再実行し、C-1 の追加テストが red→green になることを確認する。