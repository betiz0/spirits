# Proposal

## Why

spirits は Pi 1.1.0 に対する 14 個のコア実装差分を持つフォークであり、Pi 上流の更新に伴う merge と追従のコストが大きい。依存を減らせるかを判断するには、公式 Pi を spirits が管理する専用実行環境で起動し、spirits 拡張のどの機能が実際に動くかを、既存経路を壊さずに測れる基盤が要る。

隔離実験では、公式 compiled Pi v1.5.0 (Linux x64) が Bun 1.4.4 を内包し、`Bun.Transpiler` / `node:vm` / `Bun.inspect` を拡張から使えること、spirits 拡張を事前 bundle すれば host module alias 経由でロードできること、`piConfig.name` で app 名と `SPIRITS_CODING_AGENT_DIR` を spirits にできることを確認した。一方、無改修の公式 Pi では `pi.registerModelRoles` が無いため実 spirits 拡張はロードに失敗し、`/clear`・`/model` の level/role・role バッジ・更新整合・rlm 子セッション・既存データの書き込み互換は未確認のままである。

この change は完全移行ではない。専用 Pi を明示的に選んで起動する実験経路と、その経路で必要機能を実測する互換性テストを追加する。既定経路の切り替え、フォークの削除、Pi コア差分の追加は行わない。

### 根拠の扱い

この提案は `/tmp/spirits-pi-investigation/report.md` と `verification-and-proposal-input.md` の記載だけを根拠にする。次を区別し、未確認事項を確認済みとして扱わない。

- **確認済み**: 公式 v1.5.0 artifact の SHA256、Bun 1.4.4 の内包、Bun API の存在、`piConfig.name` による help/env の置換、`PI_PACKAGE_DIR` の漏えい、source の `with { type: "text" }` が raw Markdown にならないこと、prebundle で raw Markdown になること、role API 不足がロード blocker であること、no-op shim で `tsrepl` / TODO / harness の tool 登録が成立すること。
- **推論 / 未確認**: 公式 Pi 上での実 `tsrepl` セル実行、rlm 子セッション、`/clear`・`/model ... role`・role バッジの拡張だけでの代替可否、更新・ロールバック・オフライン、TUI header の実表示、既存 `~/.spirits/agent` の認証・設定・セッション・外部拡張の書き込み互換。
- **混同しないこと**: 拡張のロード成功と機能実行成功、`--help` の exit 0 と拡張の正常起動、同じデータを読めることと安全に書き戻せること、Bun 内包と全実行時依存の充足、コアソース無改修と配布メタデータを含む公式成果物の無変更。

## What Changes

- `spirits managed-pi` という明示的な実験用サブコマンド群を追加する。通常の `spirits` 起動、`spirits update`、install.sh、既定の保存先、既定モデル経路は変更しない。
  - `spirits managed-pi install [--version <pi-version>]`: 検証済みの公式 Pi artifact、spirits 拡張 bundle、アセット、対応表(manifest)を導入する。
  - `spirits managed-pi update`: 導入済みの専用 Pi を明示的に更新する。通常起動時の自動更新は行わない。
  - `spirits managed-pi [--] [pi の引数...]`: 専用 Pi を絶対パスで起動する。システムの `pi`、PATH、既定の compiled spirits に暗黙に切り替えない。
- 専用 Pi と spirits 拡張 bundle の対応を manifest に固定する。Pi の版、artifact の SHA256、拡張 bundle の版と SHA256、必要なアセット、対象プラットフォームを記録し、導入時と起動時に検証する。
- 拡張 bundle は Markdown などのアセットを文字列として埋め込み、host module (`@earendil-works/pi-coding-agent`、`pi-tui`、`typebox`) を external に保つ。SDK を自前で別実体化しない。
- 起動前に identity と保存先を確定する。専用 Pi の `package.json` は `piConfig.name=spirits` と `configDir=.pi` を持ち、wrapper は未指定時に `SPIRITS_CODING_AGENT_DIR=~/.spirits/agent` を設定する。`PI_PACKAGE_DIR` は専用 artifact の package dir に固定または除去し、`PI_CODING_AGENT_DIR` は保存先として使わない。API キー・proxy など必要な環境変数は削除しない。
- 専用 Pi が未導入、破損、checksum 不一致、未対応版、非対応プラットフォームの場合は、理由と復旧手順を表示して非ゼロで終了する。旧経路へ黙って fallback しない。
- 専用経路の互換性テストを追加する。隔離 HOME と一時 agent dir を使い、認証不要のテストとローカルの fake provider を使うテストだけを対象にする。実 provider を使うテストはこの change に含めず、必要になった場合に別 change で opt-in の要件として追加する。fake provider の成功を実 provider の互換性確認として扱わない。
  - 拡張ロードは `--help` の exit code ではなく、RPC の session_start と tool 一覧で判定する。
  - 実 `tsrepl` セル実行、prebundle された Markdown、`SPIRITS_CODING_AGENT_DIR` の優先、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の sanitize、`--help` が実 HOME やシステム `~/.pi` を作らないことを確認する。
  - rlm は物理モデルと `spirits/auto` を分け、子セッションの生成・usage・中断を確認する。`spirits/auto` の子継承は既知の制約として結果を記録する。
  - role・`/clear`・`/model` は、現行の目的と専用経路での可否を対応表にする。この change では既存経路の機能を削除せず、専用経路の不足を「利用不可」「制限付き」「利用可」で明示する。
- `role`・`/clear`・`/model` の目的を維持するための代替案を design に整理する。実装は後続 change に分け、この change では専用経路の互換アダプタに必要な最小範囲だけを扱う。無改修を合格条件にせず、必要な場合の限定 Pi パッチも後続の判断材料として記録する。
- 既存の `~/.spirits/agent` を手作業なしで使う。自動移行や破壊的なデータ変換は行わない。読めることと安全に書き戻せることを分け、書き込み互換は未確認として明示する。旧版との双方向互換は保証しない。
- 既存の自己更新経路は作り直さない。専用 Pi の版整合と復旧だけを実験経路内で扱い、本番配布・既定更新への統合は別 change とする。

## Capabilities

### New Capabilities

- `managed-pi`: 専用の公式 Pi artifact と spirits 拡張 bundle を対応付けて導入・明示更新・起動する実験経路。identity と保存先の分離、失敗時の非 fallback、既定経路を変えないことを含む。
- `managed-pi-compatibility`: 専用 Pi 経路で拡張ロード、実 tsrepl セル、rlm 子セッション、アセット、環境変数、既存データの読み取り、role/`/clear`/`/model` の可否を、認証不要テストと fake provider テストに分けて実測する互換性テスト。

### Modified Capabilities

- なし。既存の `binary-distribution`、`self-update`、`product-identity`、`model-commands`、`session-clear`、`model-role-badge`、`dual-model-routing` の要件は変更しない。専用経路の制限は新しい capability の要件として扱い、既定経路の仕様には触れない。

## Impact

- **Pi 上流コアへの差分: なし。** この change は `packages/spirits/` の外にある Pi コアを変更しない。専用 Pi は公式 artifact を固定して使い、role API など不足する API は拡張側の互換アダプタと明示的な制限表示で扱う。限定 Pi パッチの要否は互換性テストの結果を見て後続 change で決める。
- 影響コード(予定):
  - `packages/spirits/bin/`: `managed-pi` の引数分類、導入・更新・起動の入口。通常起動の `bootstrap.ts` の順序と既定値は変えない。
  - `packages/spirits/src/managed-pi/`: manifest、artifact 解決、checksum、配置、env sanitize、起動、互換アダプタ。`src/update/` は再利用できる範囲だけを使い、作り直さない(ストリーム SHA256 検証と一時ディレクトリ管理を再利用し、単一ファイル配置の `apply.ts` は使わない)。
  - `packages/spirits/src/update/download.ts`: 期待ダイジェストを直接受け取る検証関数の切り出し。既存のチェックサム URL 経路の動作は変えない。
  - `packages/spirits/src/routing/`: host に role API が無い場合の限定互換モード。既存の API がある場合の動作は変えない。
  - `scripts/`: 拡張 bundle の生成、managed-pi manifest の生成、互換性テストランナー。既存の `build-binaries.ts` と install.sh の既定出力は変えない。
- 影響テスト: `packages/spirits/test/managed-pi-*.test.ts`、`scripts/managed-pi-compat/` のランナーと fixtures。
- 影響ドキュメント: `docs/spirits-design.md`、`packages/spirits/README.md`、新しい `docs/spirits-managed-pi.md`、`docs/architecture/convention-registry.md`(`spirits:managed-pi` 層の登録)。互換性の確認済み・推論・未確認を分けて記録する。
- 依存追加: なし。新しい外部依存を追加しない。公式 Pi artifact は実行時依存ではなく、明示的に導入する固定成果物として扱う。
- 配布: 既存の `spirits-linux-x64`、theme、install.sh、`spirits update` の契約は維持する。専用経路用に拡張 bundle と manifest の配布物を追加するが、既定のインストール先と既定起動には影響させない。
- 互換性: 専用経路は既存 `~/.spirits/agent` を既定で使う。自動移行・破壊的変換はしない。旧版との書き込み後の相互互換は保証せず、互換性テストの対象は redact したコピーの読み取りまでとする。
- 対象プラットフォーム: 既存と同じ Linux x64 glibc。専用 Pi の公式 artifact も Linux x64 に固定する。
