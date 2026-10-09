## Deep Verification Report: add-rlm

- 検証対象: `a276dabe5`..`b16b2a7895d2728bf963a5dcc809c8c681cfdc33`(HEAD)。未コミット変更: あり(add-rlm の実装はステージ済み、M2 の変更は未ステージ)
- テストコマンド: `cd packages/spirits && bun test && bun run check`、`sh scripts/install.test.sh`、`openspec validate add-rlm --strict`
- verify1 レポート: `openspec/changes/add-rlm/verify1.md`(再検証モードのため Phase C は省略し、前回の突き合わせ結果を引き継ぐ)
- モード: 再検証(前回レポート: `openspec/changes/add-rlm/verify2.md`)。前回は未コミット状態での検証だったので、全体を検証し直した

### 判定
**BLOCKED**(CRITICAL 0、SPEC 1、WARNING 2)

### 集計
| 観点 | 結果 |
|---|---|
| テスト | `bun test` 成功 159 / 失敗 0。`install.test.sh` 43 / 0。`tsc` 成功。`validate --strict` 成功 |
| 要件 | 意図どおり 17 / 全 18(「親 abort の伝播」は W-1 [要確認]) |
| シナリオ | 挙動を確認 49 / 全 49。テストが実質的 45 / 49(残り 4 件のうち 3 件は rg 監査とスパイクで検証、1 件は W-2) |
| spec 外の変更 | add-rlm のステージ範囲では 0 件。M2 の変更と `.pi/` は分離済み |
| タスク | 完了 19 / 全 19(6.6 は実装済みだが、検証コマンドに欠陥がある。S-1) |

### 前回指摘の再検証
| 前回 | 状態 | 根拠 |
|---|---|---|
| C-1 生成中の abort | 解消 | `spawn.ts:118` で生成前、`:152` で生成後に確認する。"abort during creation skips prompt" で `promptTexts` が空、dispose 1 回。別の窓が残る(W-1) |
| C-2 strict 検証の失敗 | 解消 | exit 0。要件文の最大は 387 文字 |
| C-3 M2 変更の混在 | 解消 | ステージ済みは add-rlm の 15 ファイルだけ |
| W-1 テストの実質性 | 解消 | "maxDepth raised is clamped" が孫の `深度上限（2）` まで検証する。"child rlm not blocked by parent call" はキューを共有すると失敗する |
| W-2 spawn 例外時の記録 | 解消 | `hostfn.ts:127-134` と `spawn.ts:212-216`。テスト 2 件 |
| W-3 `.pi/` | 解消 | ステージされていない |
| S-1 `SettingsManager` | 解消 | design の Decision 2、tasks 1.3、proposal、型ミラーが「共有しない」で揃った |
| G-1〜G-3 | 解消 | ミラー冒頭コメント、`config.yaml` の引用符(stderr 空)、`guidance.ts:51` の「絶対深度」 |

### 指摘

#### CRITICAL
なし

#### WARNING

- **[W-1] `prompt()` の事前処理中に届いた abort は失われる [要確認]**
  - 場所: `packages/spirits/src/rlm/spawn.ts:162-175`
  - 根拠: リスナーを付けてから、上流がエージェント実行を始めるまでの間に、事前処理の await がある(入力ハンドラ、`checkAuth`、`before_agent_start`)。この間の `session.abort()` は効かない(`_isAgentRunActive` が偽で、`agent.abort()` は `activeRun` だけを止める。`agent-session.ts:2387-2397`、`agent.ts:341`)。さらに `_runAgentPrompt` が開始時に `_agentRunAbortRequested = false` へ戻す(`agent-session.ts:1776`)。結果として子は最後まで走り、`aborted` として記録される。ただし、認証が設定済みなら `hasConfiguredAuth` は同期的に判定され(`model-runtime.ts:543`)、事前処理はマイクロタスクだけになる。タイマーやキー入力からの abort は割り込めないので、現実に踏む経路は示せていない。
  - 修正先: 実装
  - 推奨: `subscribe` のハンドラで `event.type === "agent_start"` かつ `abortRequested` なら、`session.abort()` を出し直す(`abortPromise ??=` を通さず別の Promise として保持する)。テストは、`abort()` が `agent_start` の前は何もしないフェイクセッションで追加する。
  - 要確認: 子の認証で `hasConfiguredAuth` が偽になり、`checkAuth` が実 IO を待つ経路(`agent-session.ts:1990-1992`)があるか。あれば CRITICAL に上げる。

- **[W-2] シナリオ「ルートセッションの使い方の案内」の一部を、テストが検証していない**
  - 場所: `packages/spirits/test/rlm-guidance.test.ts:5-13`
  - 根拠: シナリオは「子は親の REPL 変数を見られない旨」を求める。案内文には含まれる(`guidance.ts:47`)が、対応するアサーションがない。
  - 推奨: "guidance root covers await, string, timeout, serial, limits" に `expect(text).toContain("親の REPL 変数を見られません")` を加える。

#### SPEC

- **[S-1] タスク 6.6 の検証コマンドが、タスク自身の本文に一致して必ず失敗する**
  - 場所: `openspec/changes/add-rlm/tasks.md:37`
  - 根拠: `openspec instructions apply --json` の出力にはタスクの本文が含まれる。そのため `rg -c "引用符で囲んでください"` は 6.6 自身の記述に一致する。実際の警告は消えている(stderr 0 バイト、YAML の型チェック成功)。
  - 修正先: tasks
  - 推奨: 検証を `openspec instructions apply --change add-rlm --json 2>&1 >/dev/null` の出力が空であること、に書き換える。

#### SUGGESTION

- **[G-1] タスクの成果物である文書と change 自体が、ステージ範囲に入っていない**
  - 場所: `docs/spikes/sdk-agent-session.md`(1.2、6.4)、`docs/spirits-m3-rlm.md` と `docs/spirits-design.md`(6.2)、`openspec/changes/add-rlm/`
  - 内容: どれも未追跡。M1/M2 の文書も未コミットなので慣例どおりかもしれないが、add-rlm のコミットに含めるかを決めてから commit する。

### 次の手順

- BLOCKED: S-1 は tasks.md の 1 行修正で解消する。W-1 と W-2 も同じ apply で直す。修正後に再検証モードで実行する(前回レポート: このファイル)。
- 未実行: 実プロバイダのスモーク(6.4)は C-1 の修正後に再実行していない。ルートの `bun install --frozen-lockfile`、バイナリのビルド。

## 成果物への反映(検証後に追記)

| 指摘 | 反映先 |
|---|---|
| W-1 | design Decision 7 に節と代替案、Risks に項目を追加。tasks 3.2 を未完了に戻し、`agent_start` での出し直しとテスト "abort reissued at agent start"、上流の `checkAuth` 経路の確認とスパイク文書への追記を追加。spec は変更しない(外部から観測できる振る舞いは既存の要件が定めており、これは上流の事前処理に起因する実装上の防御のため) |
| W-2 | tasks 2.2 を未完了に戻し、"guidance root covers ..." の検証内容に「子は親の REPL 変数を見られない旨」を明記 |
| S-1 | tasks 6.6 の検証コマンドを stderr が空であることの確認に変更し、未完了に戻した |
| G-1 | tasks 6.7 を未完了に戻し、未追跡の文書を add-rlm のコミットに含めるかをユーザに確認する手順を追加(範囲は決めない) |
