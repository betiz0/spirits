## 検証レポート: `add-dual-model-routing`

### サマリー

| 観点 | 状態 |
|---|---|
| 完全性 | 23/23 タスクに完了マーク。仕様差分は14要件（ADDED 14、MODIFIED / REMOVED / RENAMED なし）。全要件に実装証拠あり |
| 正確性 | 14/14 要件に実装証拠あり。REMOVED / RENAMED 要件なし。警告2件（登録簿の照合手順） |
| 一貫性 | 設計決定10件すべて準拠。提案2件 |

### 重大

なし。

### 警告

- **登録簿の行数チェックが現状のコマンドでは成立しません。** `docs/spirits-core-diffs.md:18`（§確認方法）と `docs/spirits-upstream-sync.md:79`（§4 コミット構成）は `git log --grep='\[spirits\]' --oneline` を使うよう指示し、タスク 8.1 は「登録簿の行数がそれと一致する」を検証条件にしています。このコマンドは現在14行を返します（`40962fa8d` のコミット本文が "[spirits]" を含むため）。登録簿は13行で、`[spirits]` プレフィックスのコミット13件とは完全一致しています（差分ゼロを機械確認済み）。
  - **推奨:** 両文書のコマンドを `git log -E --grep='^\[spirits\]' --oneline`（13行＝登録簿行数）に修正してください。

- **登録簿の対象ファイルに存在しないパスがあります。** `docs/spirits-core-diffs.md:33` の `openspec/changes/add-architecture-conventions/` と `docs/spirits-core-diffs.md:34` の `openspec/changes/add-sprt-bundled-skills/` はアーカイブ済みで既に存在しません。`docs/spirits-upstream-sync.md:81` の `git diff <取り込み対象タグ> -- <対象ファイル>` はこれらの行で空振りし、「 spirits 側の差分が残っている」確認ができず、上流取り込み時に Requirement「取り込み時の登録簿との突き合わせ」が実行できません。
  - **推奨:** 当該2行から `openspec/` のパスを外すか、`openspec/changes/archive/2026-10-16-add-sprt-bundled-skills/` のような実在パスへ置き換えてください。上流 merge で中身を確認すべきはコア実装と同梱スキル側だけです。

### 提案

- **登録簿の範囲記述が実運用より狭いです。** delta 仕様は登録簿を「Pi 上流コアに加えた spirits 側の差分」と定義していますが（`specs/upstream-tracking/spec.md:6`）、実登録は「1行 = 1 `[spirits]` コミット」規約で、`packages/` 配下を変えない `9edd6311c` と `80d9bbeaf` を含みます（行内に注記あり）。design.md の Decision 9 は「既存の `[spirits]` コア差分コミット（現10件）も登録」ですが、この区別は仕様に現れません。
  - **推奨:** delta の要求本文か `docs/spirits-core-diffs.md:10` の規律に「1行 = 1 `[spirits]` コミット（コア実装ファイルを変えないコミットも含む）」を1行追記してからアーカイブしてください。アーカイブするとこの文言が本仕様になります。

- **`sanitizeStatusText` は `\r\n\t` しか除去しません。** spec「ロールバッジの表記」は「改行や制御文字」（`specs/model-role-badge/spec.md:12`）を要求しますが、`packages/coding-agent/src/modes/interactive/components/footer.ts:14-20` は `\r\n\t` と連続スペースのみを処理します。他の C0 制御文字（ESC など）は素通りし、他製 virtual model が返したラベルで色演出などの副作用が起こり得ます。
  - **推奨:** spec 側を「改行およびタブ」に絞るか、サニタイズを拡張するかをアーカイブ前に決めてください。拡張する場合はコア差分が1行増えるので design.md Decision 7 の「差分は連結1箇所と判定式1箇所」の記述も併せて更新が必要です。

### 要件実装マッピング

| 要件 | 実装 | テスト |
|---|---|---|
| strong ロールの対象設定 | `packages/spirits/src/config.ts:109` `readStrongModelSetting`（未設定・空・空白のみ・非文字列・片側空を未設定扱い） | `test/config.test.ts` 4件、`test/pi-runtime/settings-unknown-key.test.ts` |
| 振り分け用のモデルの登録 | `packages/spirits/src/routing/register.ts:27`（拡張ロード時登録、`thinkingLevels` 全レベル、`contextWindow` / `maxTokens` 非宣言） | `test/routing-register.test.ts`（reload 含む） |
| ワークフローのステップ別ロール | `routing/phase.ts:41` + `routing/router.ts:54` | `test/routing-integration.test.ts` 2件 |
| strong フェーズの開始 | `routing/register.ts:40` の `input`（pi はスキル展開前に発火: `agent-session.ts:2022`）、`phase.ts:45` | `test/routing-phase.test.ts` 7件 |
| strong フェーズからの復帰 | `routing/register.ts:45` の `agent_settled`（`aborted` 不問） | `test/routing-phase-wiring.test.ts` 3件 |
| strong が使えないときのフォールバック | `routing/router.ts:62-75`（未設定は無警告、使えないは run 内1回通知） | `test/routing-router.test.ts` 7件 |
| normal の対象の解決 | `routing/resolve.ts:47`（既定 → previous → throw `router.ts:79`）、virtual 除外 `resolve.ts:34` | `test/routing-resolve.test.ts` 7件、`test/pi-runtime/virtual-model-api.test.ts` |
| ロールの記録と復元 | `agent-session.ts:836`（state か role が変わった時に追記、`resolveModel` が throw 時は書かない）、`:1467` / `:1475` | `test/virtual-models.test.ts` の role 8件（分岐・復元・旧形式） |
| ロールバッジの表記 | `footer.ts:251`（`sanitizeStatusText` 経由） | `test/footer-width.test.ts`（制御文字ケース含む） |
| バッジの位置 | `footer.ts:261`（`rightSide` 先頭へ連結） | `test/footer-width.test.ts`（provider 前置・routed 表示より前） |
| 幅不足時の優先順位 | `footer.ts:257`（provider 判定にバッジ幅を算入、既存の末尾切り詰めを踏用） | `test/footer-width.test.ts` 3件 |
| バッジの更新タイミング | `routedModel.role` は分岐に保存された値のみ（`agent-session.ts:1471`）。1リクエスト遅れはこの構造の帰結 | `test/virtual-models.test.ts` + `test/footer-width.test.ts` |
| Pi コア差分の登録簿 | `docs/spirits-core-diffs.md`（13行） | 上記 警告1・2 |
| 取り込み時の登録簿との突き合わせ | `docs/spirits-upstream-sync.md:73-84`（§4 コミット構成、復元まで push しない） | 上記 警告1・2 |

### 実施した確認

- `cd packages/spirits && bun test`: **530 pass、0 fail**（56 files）
- `cd packages/spirits && bun run check`: 成功
- `cd packages/coding-agent && VITEST test/virtual-models.test.ts test/footer-width.test.ts`: **47 pass**
- root で `npm run check`: 成功
- `openspec validate add-dual-model-routing --json`: `valid: true`
- `grep -n "spirits-core-diffs" docs/spirits-upstream-sync.md`: 2件（§2 と §4 コミット構成）
- `grep -n "dual-model-routing" docs/spirits-design.md`: 1件（§4.7）
- README 4言語: `spirits/auto` 4件、`models.strong` 4件、既定モデルは物理モデルという注意書き4言語分
- タスク 9.2 のコア差分の封じ込め: `c3f92bdcd`（`virtual-models.ts` + `docs/virtual-models.md`）、`f98e1df53`（`model-runtime.ts`、`agent-session.ts`、`test/virtual-models.test.ts`）、`d2d60fbcb`（`footer.ts`、`test/footer-width.test.ts`）で指定7ファイル以内に閉じている。`packages/tui` / `packages/ai` は本変更で未変更、`package.json` と lockfile も未変更
- 設計との一貫性: コアに `"normal"` / `"strong"` の語彙なし（grep のヒットは vendor とテスト固定値のみ）、`getVirtualModelEntry` が単一走査で `getVirtualModelState` は薄いラッパ（ループ残存なし）、role は leafId + entryCount でキャッシュ、`route()` はフェーズを変えず `readSettings` はリクエストごと（キャッシュなし）、`input` がスキル展開より前・`streamingBehavior` は実行中のみ、`direct` リクエストは role を保存しない（`agent-session.ts:819` の virtual ガード）、型ミラーは pi の実 `ModelRegistry`（同期 `getAvailable` / `find` / `hasConfiguredAuth`）と一致、`models.strong` は `SettingsManager.getSettings()` が未知キー込みのマージ結果を返すため拡張へ届く
- `docs/architecture/convention-registry.md:39,52` の `spirits:routing` 登記と9層の本文、`test/architecture-conventions.test.ts` の成功
- ベース仕様 `openspec/specs/upstream-tracking/spec.md` に同名要件の衝突なし（既存6要件とは別名）
- `tasks.md` の Workflow follow-up（アーカイブ時に本仕様3件が新規/追加されることの確認）は未実施。アーカイブ後の作業で、想定内
- 作業ツリーの未コミット変更（`.pi/prompts/*`、`openspec/changes/add-sprt-bundled-skills` の削除と `archive/2026-10-16-*` の未追跡）は本変更のコミットとは別で、本検証の対象外
- 未検証・スキップしたチェックはありません

**最終評価:** 重大な問題はありません。考慮すべき警告は2つ（登録簿の行数チェックコマンドと、存在しないパスへの参照）です。アーカイブの準備ができました（改善点が指摘されています）。提案2件のうち登録簿の範囲記述は、アーカイブすると本仕様になる文言なので先に1行入れておく価値があります。
