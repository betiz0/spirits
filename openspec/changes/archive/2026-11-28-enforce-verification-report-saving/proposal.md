# Proposal

## Why

`/opsx-verify` と `/skill:sprt-opsx-verify-deep` の検証レポートは、いまはモデルがチャットに出力するだけで、保存されないことが多い。保存されてもファイル名はモデルが任意に決め、`verify1.md`・`verify2.md`・`d-verify1.md`・`deep-verify1.md` が変更ごとに混在し、既存レポートを上書きすることも防げない。レポートが archive 判断の根拠になる以上、モデルの判断に任せていると検証の実行自体が確認できない。

検証の合否判定は変えず、**レポートが対象変更のディレクトリに連番の新規ファイルとして保存されることだけ**を spirits 側で保証する。

## What Changes

- 検証レポートを保存するツール `spirits_verify_report_save` を追加する。モデルは検証の最終レポートの**本文だけを**このツールへ渡す。変更名・保存先・ファイル名はモデルから受け取らない。
- 保存先は**検証対象として spirits が固定した変更**のディレクトリである。対象は検証ステップを開いた入力と、以降の保留中のユーザー入力から spirits が openspec CLI で解決して固定し、モデルの申告では動かない。store を指定した場合は、対象の固定と保存で同じ store を使う。ファイル名は検証種別ごとの連番（既定の検証は `verify<N>.md`、深い検証は `d-verify<N>.md`）とし、既存ファイルは上書きしない。保存先の採番・作成で I/O が失敗した場合は、例外ではなく理由を返す。
- 検証ステップ（`opsx-verify` と `sprt-opsx-verify-deep`）が開かれた間だけツールをモデルに有効化する。検証以外のセッションではプロンプトに現れない。有効中でも、検証ステップが開いていない・対象が未固定の保存要求は書き込み前に拒否する。
- 検証ステップの run が、保存なしに終わろうとしたとき、1 回だけ保存を要求して継続し、それでも保存されなければ未保存であることを利用者に通知してそれ以上要求しない。中断時は要求しない。**検証対象が未固定（モデルが変更名や前提をユーザーに確認して待っている）間は督促しない。同じセッション内の後続入力に対して解決できる変更名は同じ検証の対象として引き継ぐ。同じセッション内の後続入力に対して解決できる変更名を同じ検証の対象として引き継ぐのは、検証ステップがその回答の入力まで続く場合（`spirits/auto` の継続する検証ステップ）に限定する（決定済み、design Decision 14）。深い検証（全セッションで `continuing: false`）と物理モデルセッションの検証は、検証を開いた行に変更名がある場合にのみ保存と督促を保証し、対象を固定できないまま検証が終わったときは、レポートが保存されていないことと `/opsx-verify <change>` / `/skill:sprt-opsx-verify-deep <change>` で開き直す方法を 1 回だけ利用者に伝える（対話はセッションへの通知、`print` / `json` は stderr）。この通知は未固定で終わった検証だけが見る。ステップが終わった時点でその検証の「開かれたが保存していない」状態は通知の可否とかかわらず消費するので、固定済み・保存済みの検証が後の無関係な入力でこの通知を受けることはなく、通知も 1 回を超えない（d-verify3 C-1）。
- 保存保証は全モード対象で、`print` / `json` の非対話でも同じツールで保存される。追加リクエスト（督促の継続）は利用者が応答できる対話モード（`tui` / `rpc`）だけに行い、非対話では未保存の旨を出力形式を壊さない経路（stderr）で伝える。
- **BREAKING** 同梱スキル `sprt-opsx-verify-deep` の手順を、最終レポートを本文に書くだけでなくツールへ渡す形に変える（ツールが有効でない環境では従来の出力を継続）。読み取り専用の契約に「検証レポートの新規ファイル作成だけを例外」として加える（従来無かった書き込み行為が増えるため BREAKING 表記）。
- OpenSpec CLI が生成する `.pi/prompts/opsx-verify.md` は変更しない。強制はホスト API だけで行い、プロンプト再生成の影響を受けない。

## Capabilities

### New Capabilities

- `verification-report-saving`: OpenSpec の検証ステップが生んだ最終レポートを、対象変更のディレクトリへ衝突しない連番のファイルとして保存し、保存されるまで検証を完了として扱わない振る舞い。

### Modified Capabilities

- `sprt-opsx-verify-deep`: **BREAKING**「読み取り専用」に最終レポートの新規保存だけを例外として加え、「検証レポートの出力」にツール経由の保存（全文出力は維持）を課す。さらに検証レポートファイルを証拠読み取りから除外する要件を追加する。保存手段が無い環境では従来どおり本文出力で終わる。

## Impact

- **新規層**: `packages/spirits/src/verify/`（兄弟層）。`docs/architecture/convention-registry.md` の `registry:layers` / `registry:layer-members` / ARCH-SPIRITS-LAYER の層一覧と層数、および ARCH-PI-BOUNDARY の例外文（層ごとの許可は `registry:layers` が正で、routing 以外の全層がホスト両方に依存できるという記述を `verify` の事実に合わせて同一変更で更新）を揃える。
- **既存ファイル**: `packages/spirits/src/index.ts`（層の配線）、`packages/spirits/src/constants.ts`（ツール名・検証種別とファイル名 prefix・連番上限・再試行上限・CLI タイムアウト・督促と通知の文言）、`packages/spirits/src/harness/bundled-skills/sprt-opsx-verify-deep/SKILL.md`（手順の更新）、`packages/spirits/test/architecture-conventions.test.ts` のベースライン、`README.md`（レポートの保存規則）、`docs/spirits-design.md`（層構成）。既存の劣化テスト `packages/spirits/test/extension-degradation.test.ts` に新層の失敗時も他層が残ることを追加する。
- **ホストの公開面への依存**（`@earendil-works/pi-coding-agent` の bare export のみ、deep import なし）: `defineTool` と `registerTool`（`defaultActive: false`）、`getActiveTools()` / `setActiveTools()`、`on("input")` / `on("agent_before_settle")` / `on("session_start")`、`AgentBeforeSettleEvent` と `custom_message` 草稿、`ctx.ui.notify`。`@earendil-works/pi-tui` は使わない。ホストのソースへの差分は 0 のまま。
- **外部依存**: 実行時に `openspec` CLI を実行する（検証ステップが既に必須としているものと同じで、新しい npm 依存は増やさない）。`openspec status --change <name> --json` の `changeRoot` を保存先に使う。
- **固定値・配布物への影響**: 新增の固定値は `src/constants.ts` に集約する。同梱スキル同梱物としての `bundled-skills/<版>/sprt-opsx-verify-deep/SKILL.md` の中身が変わる（ファイル構成は不変）。`bun.lock` は変更しない。
- **非対象**: `sprt-opsx-review-change`（実装前レビュー）のレポート、既存の検証レポートファイル名の移行、検証の重大度・判定基準、アーカイブの条件。
