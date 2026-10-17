# Proposal

## Why

spirits の OpenSpec ワークフローでモデル能力の要求が偏るのは 2 箇所だけである。実装前レビュー（`sprt-opsx-review-change`）と深い検証（`sprt-opsx-verify-deep`）は判断品質が成果物を決め、propose / apply / verify / archive は通常のモデルで足りる。現行のモデル設定は単一系統（normal）のみなので、この 2 スキルのためにセッション全体のモデルを手で切り替え、戻し忘れる。切り替え忘れは品質の穴、切り替えたままの通常ステップ実行は過剰コストである。

Pi の virtual model 機構（`route()` がリクエストごとに物理モデルへディスパッチし、footer が `routedModel` を `→ <model.id>` で表示する）を使えば、利用者は 1 つのモデルを選択したまま、スキル実行中だけ強いモデルへ自動で切り替えられる。

## What Changes

- 設定キー `models.strong`（settings.json、省略可能な単一モデル指定）を追加する。**Pi の `Settings` 型は変更しない**。Pi の設定ファイルは未知キーを保持する既存挙動があり、spirits は `pi.getSettings()` 経由で読み取る（コア差分ゼロ）。
- spirits が virtual model `spirits/auto` を登録する。利用者は既存の `/model spirits/auto` で選択する。既存の `/model` の挙動、既定モデル設定、`--model` は変更しない。
- ルータは通常のリクエストを normal、strong フェーズ中のリクエストを `models.strong` へルートする。normal の解決先は既存の `defaultProvider` / `defaultModel` とし、解決できない場合は `request.previous`（直近の成功レスポンスの物理モデル）へ落ちる。両者とも無ければルート失敗にする。既定モデルや `models.strong` が `spirits/auto` 自身などの virtual model を指す場合は、解決できないものとして扱う。
- `models.strong` 未設定時は strong 要求が生じても normal にフォールバックし、警告も出さない（静かなフォールバックで固定）。
- `sprt-opsx-review-change` と `sprt-opsx-verify-deep` の起動を検知して strong フェーズへ遷移し、`agent_settled`（`aborted` の真偽を問わず）で normal へ復帰する。復帰は finally 相当として必ず走らせる。run が始まらずに settle が来ない場合に備え、実行中でないときの対象外入力でも normal に戻す。振り分けマトリクスは propose / apply / verify / archive が normal、上記 2 スキルが strong。
- Pi コアに**ロールラベル**を追加する（すべて additive）。`ModelRoute` に任意のラベル文字列 `role` を受け付け、`pi.virtual-model-state` の custom entry に `role` を保存し、`AgentSession.routedModel` が `role` を返す。**コアは `"normal"` / `"strong"` という語を知らない**（opaque なラベルとし、2 値の意味は spirits 側が定義する）。上流 merge 時の結合面を最小にするため。
- 対話 TUI footer の右側モデル表示の先頭にロールバッジ `[normal]` / `[strong]` を表記する。既存の `(provider)` 前置と `→ <routed>` 表示より前に置く。幅不足時はバッジを優先し、モデル名側を切り詰める。ロールが無い通常モデル選択時は従来表示のまま。
- 表示の意味を「**最新のリクエストが通ったロール**」に固定する。したがってスキル起動直後（まだリクエストが outgoing でない）は `[normal]` のまま、スキル終了直後（次のリクエストがまだない）は `[strong]` のままとなり、次のリクエストで `[normal]` に戻る。ルーティング失敗時はロールを更新しない。
- Pi コア差分の**登録簿** `docs/spirits-core-diffs.md` を新設し、コミット番号・対象ファイル・意図を一覧化する。既存の `[spirits]` コア差分コミット（現行 10 件）と本変更の 3 コミットを登録し、上流 merge 手順のチェックリストとして参照させる。

## Capabilities

### New Capabilities

- `dual-model-routing`: normal / strong の 2 ロールへのリクエスト振り分け。`models.strong` 設定の読み取りと解決、virtual model の登録と選択、スキル実行に紐づくロールフェーズの遷移と復帰、フォールバック、ロールのセッション分岐への保持とセッション復帰時の復元。
- `model-role-badge`: 対話 TUI footer の右側モデル表示におけるロールバッジの表記位置、トランケーション規則、ロールが無い場合の従来表示。

### Modified Capabilities

- `upstream-tracking`: Pi コア差分をコミット番号つきの登録簿として保持し、上流 merge 時に登録簿と実差分を突き合わせる要求を追加する。

## Impact

- **Pi 上流コアへの差分**: あり。`packages/coding-agent` の 3 箇所に限定し、`packages/tui` と `packages/ai` は変更しない。**1 差分 = 1 コミットで `[spirits]` プレフィックスの独立コミット 3 つに分離する**（design Decision 7）。混ぜると上流 merge 時の切り離しが困難になる。
  1. `src/core/virtual-models.ts` — `ModelRoute.role` と `VirtualModelStateData.role` の追加。entry 全体を返す `getVirtualModelEntry` を追加し、既存の `getVirtualModelState` をその薄いラッパにする。`docs/virtual-models.md` に role の記載を追記。
  2. `src/core/model-runtime.ts` と `src/core/agent-session.ts` — `resolveModel` が role を透過し、agent-session が role を state entry に保存、`routedModel` が role を返す。
  3. `src/modes/interactive/components/footer.ts` — 右側表示の先頭にバッジを前置し、provider 前置の判定にバッジ幅を含める。縮退順序・トランケーション・配色・パディングのロジックには手を入れない（バッジ優先の切り詰めは既存の右側切り詰め経路の内側で表現する）。role は既存の `sanitizeStatusText` を通して描画する。
  - 既存コアテストへの追加: `test/virtual-models.test.ts`（role の透過・state entry・旧 entry との後方互換）、`test/footer-width.test.ts`（バッジ表記と幅不足時の優先順位）。上流追従後の `./test.sh` で検知できる。
  - `packages/coding-agent/CHANGELOG.md` は更新しない（上流の changelog であり、既存の `[spirits]` コア差分コミットも更新していない）。
- **Spirits 拡張**（`packages/spirits/`）
  - `src/routing/`（新規）: 設定解決、ロールフェーズの状態、`route()` の判定、スキル検知と復帰。
  - `src/config.ts`: `models.strong` の読み取り（Layer 3 の設定解決に加えるが、env ではなく settings 由来）。
  - `src/index.ts`: virtual model の登録とスキル検知の配線。
  - `src/types/pi-coding-agent.d.ts`: `registerVirtualModel`、`ModelRouteRequest` / `ModelRoute`、`ExtensionContext.modelRegistry`、`ExtensionSettings.models`、`PiModel.api` のミラー追加（spirits は実型ではなくミラーで型検査する）。
  - `src/constants.ts`: provider id `spirits`、model id `auto`、ロール名、対象スキル名、pi の virtual model の api 値 `pi-virtual`。
- **ドキュメント**: `docs/spirits-core-diffs.md`（新規）、`docs/spirits-upstream-sync.md`（登録簿への参照）、`docs/spirits-design.md`、README 4 言語（`models.strong` と `/model spirits/auto` の解説、バッジの意味、`spirits/auto` を既定モデルに保存しない注意）。
- **振る舞いの変化**: `spirits/auto` を選択したセッションでは、`(provider)` / モデル名 / `→ routed` の前にバッジが常時出る。通常の物理モデルを直接選択したセッションの表示は変わらない。
- **API**: `ModelRoute` と `AgentSession.routedModel` に optional フィールドを追加するのみで、既存呼び出しは変更しない。セッション entry の `pi.virtual-model-state` data に optional な `role` を追加する（`role` の無い既存 entry はそのまま読める）。
- **キーバインド**: 追加なし。
- **依存関係**: 追加なし。
