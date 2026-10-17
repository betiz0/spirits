# Tasks

## 1. 設計の確定

- [x] 1.1 design Open Question 1（コアから spirits へロールを渡す口）を利用者と決める。決定結果を design の Decision に反映し、 3 章の対象ファイルと `[spirits]` コミットの分割を確定する。検証: design.md の OQ 1 が消え、 3 章の各タスクが具体的な関数名を持つこと（Decision 9 に反映済み）
- [x] 1.2 design Open Question 2（物理モデル選択中の「振り分けもされる」の解釈）を利用者と確認する。検証: spec の `振り分け用のモデルの登録` と `### Requirement: /model によるロールのロック` の記述が回答と食い違っていないこと（現行の解釈で確認済み）

## 2. spirits の変更（コア変更を待たずに進められる）

- [x] 2.1 `packages/spirits/src/constants.ts` に `SETTINGS_KEY_ROLE = "role"`（`SETTINGS_KEY_MODELS` の下のキー）と、 ロール語彙 `MODEL_ROLES = [MODEL_ROLE_NORMAL, MODEL_ROLE_STRONG]` を追加する。検証: `cd packages/spirits && bun test test/config.test.ts` の `既定ロールの読み取り` ケースが 2.2 で成功する
- [x] 2.2 `packages/spirits/src/config.ts` の `readRoutingSettings` に `defaultRole` を追加し、 `models.role` を `readStrongModelSetting` と同じ規則（非文字列・空は未設定）で読み、 大文字小文字を区別せずに `normal` / `strong` へ解決し、 それ以外は未設定にする。検証: `cd packages/spirits && bun test test/config.test.ts` の `既定ロールの読み取り` ケース（strong / STRONG / 未設定 / `banana` / 空）が成功する
- [x] 2.3 `packages/spirits/src/routing/phase.ts` にロックを追加する。`RoutingPhase` へ `setRole(role)` を持ち、 idle 入力はロックをロールとし、 対象スキル入力だけ strong にし、 `settle()` は normal ではなくロックへ戻す。検証: `cd packages/spirits && bun test test/routing-phase.test.ts` の `ロック中の入力はロックを解除しない` と `ロックしたロールへ戻る` ケースが成功する
- [x] 2.4 `packages/spirits/src/routing/register.ts` で `session_start` を受け、 reason を問わず既定ロール（未設定なら normal）を `phase.setRole` でロックに設定する。reason が `new`、 または `startup` で分岐に entry が無く、 既定ロールが設定され、 現在のモデルが `spirits/auto` のときだけ、 `ctx.sessionManager` で最新の `pi.virtual-model-state` entry を読み、 `state` を引き継いだうえで `appendEntry` に `role` を追記する。`session_tree` は扱わない。検証: `cd packages/spirits && bun test test/routing-register.test.ts` の `既定ロールで開始する` / `物理モデルで開始するときは記録しない` / `復帰では既定ロールを記録しない` / `再読み込みでは既定ロールに戻る` / `分岐間の移動ではロックを維持する` / `state を引き継ぐ` ケースが成功する
- [x] 2.5 `packages/spirits/src/routing/router.ts` が `phase.current()` をそのまま使うことを保ち、 ロック strong のリクエストが strong の対象へルートされることを検証する。検証: `cd packages/spirits && bun test test/routing-router.test.ts test/routing-integration.test.ts` が成功する

## 3. pi コアの変更（`[spirits]` プレフィックスのコミットで分離）

- [x] 3.1 `packages/coding-agent/src/core/extensions/types.ts` に `ModelRoleRegistration`（`roles` / `settingsKey` / `onSelect`）と `registerModelRoles(definition)` を追加し、 `loader.ts` と `runner.ts` で 1 件の登録として保持する（再登録は置き換え）。`packages/coding-agent/docs/extensions.md` に API を記載する。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/model-roles.test.ts`（新規）の `登録と置き換え` / `未登録ならロールを切り出さない` ケースが成功する
- [x] 3.2 `packages/coding-agent/src/modes/interactive/model-command-args.ts` の `ModelCommandArgs` に `role?: string` を追加し、 `parseModelCommandArgs(args, roles)` が末尾から role（2 語以上で末尾語が `roles` に大文字小文字を区別せず一致）、 残りが 2 語以上なら level の順に切り出し、 role は登録語彙の表記で返す。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/model-command-args.test.ts` が成功する（`strong` / `normal` / `STRONG` / `invalidrole` / 1 語の `normal` / `high strong` / `strong high` / 語彙未登録）
- [x] 3.3 `packages/coding-agent/src/modes/interactive/interactive-mode.ts` の `handleModelCommand` / `applyModelSelection` / `showModelSelector` にロールを通し、 モデルを適用した後に選択対象の種別にかかわらず登録の `onSelect(role, ctx)` を呼ぶ。selector で選んだ場合も同じで、 キャンセル時は呼ばない。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-mode-model-command.test.ts` の `ロールを通知する` / `selector 経由でロールを通知する` / `キャンセルでは通知しない` ケースが成功する
- [x] 3.4 `packages/coding-agent/src/core/settings-manager.ts` に `setExtensionNestedSetting(field, key, value)` を追加し、 `markModified` の nestedKey で入れ子の 1 キーだけを書き戻す。pi の `Settings` 型へは spirits 語彙を増やさない。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/settings-manager.test.ts` の `入れ子の拡張キーを保存する`（`models.strong` が残る）ケースと既存の未知キー保持のテストが成功する
- [x] 3.5 `setupSaveKeyHook` の保存経路で、 登録の `settingsKey` にロールを保存し、 保存表示へ `Default role: <role>` を追加する。ロール指定が無いときは `Default role:` を出さない。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-mode-model-command.test.ts` の `ロールを保存する` / `大文字のロールは小文字で保存する` / `thinking レベルとロールを同時に保存` / `ロール指定なしで保存` ケースが成功する
- [x] 3.6 `model-command-args.ts` の `getThinkingLevelArgumentCompletions` に登録されたロール語彙を候補として追加し、 確定時に 1 語目を保ったまま 2 語目だけを置き換える。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/model-command-args.test.ts` の `role の候補` ケースが成功する
- [x] 3.7 `packages/coding-agent/src/core/slash-commands.ts` の `/model` 引数ヒントを `<provider/model> [level] [role]` に変更する。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-mode-model-command.test.ts` が成功する（同 test の既存アサートも新文言へ更新）
- [x] 3.8 拡張が `CustomEditor` を継承したエディタへ差し替えた場合も CTRL+s でロールが保存されることを確認する。検証: `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/custom-editor-submit-shortcut.test.ts` の `差し替えたエディタでロールを保存する` ケースが成功する

## 4. spirits とコア API の接続

- [x] 4.1 `packages/spirits/src/routing/register.ts` で `pi.registerModelRoles({ roles: MODEL_ROLES, settingsKey: { field: SETTINGS_KEY_MODELS, key: SETTINGS_KEY_ROLE }, onSelect: (role) => phase.setRole(role) })` を呼ぶ。検証: `cd packages/spirits && bun test test/routing-register.test.ts` の `/model のロールでロックする` ケースと、 `test/pi-runtime/` に追加する `model-roles-api` のテスト（実際の pi で `/model X strong` が `onSelect` に届く）が成功する

## 5. 統合と回帰

- [x] 5.1 `cd packages/spirits && bun test` が成功する
- [x] 5.2 `./test.sh`（リポジトリルート、 e2e を除く全テスト）が成功する
- [x] 5.3 `npm run check`（リポジトリルート）がエラー・警告・情報 0 件で終わる
- [ ] 5.4 `docs/spirits-core-diffs.md` に 3 章の `[spirits]` コミットを 1 行 = 1 コミットで登録する。検証: `git log -E --grep='^\[spirits\]' --oneline` の行数と登録簿の行数が一致する
- [x] 5.5 `README.md` / `README.ja.md` / `README.de-CH.md` / `README.zh.md` に、 `/model <model> [level] <normal|strong>`、 CTRL+s での既定ロール保存、 ロックの解除方法（`/model <model> normal`）、 `/reload` で Enter のロックが既定ロールに戻ることを書く。検証: 4 ファイルに `normal` と `strong` の語が同じ節にあることを `grep -c` で確認する

## 6. 対話モードの目視確認

各タスクは `.pi/skills/interactive-testing.md` の tmux 手順で起動・入力し、 `tmux capture-pane -p` の出力で、 バッジと保存表示、 およびフッターの `→ <routed>` 表示によるルート先を確認する。

- [x] 6.1 `--model spirits/auto` で起動し、 `/model spirits/auto strong` を Enter して次のリクエストが strong の対象へルートされることを確認する。バッジは最初の振り分け後に `[strong]` になることを確認する
- [x] 6.2 `/model <physical> strong` を Enter し、 振り分けが起こらないこと、 その後 role 無しで `spirits/auto` へ戻すと strong の対象へルートされることを確認する
- [x] 6.3 `/model <model> STRONG` で CTRL+s を押し、 設定ファイルの `models.role` が `strong` になり、 表示に `Default role: strong` が出ることを確認する
- [x] 6.4 `models.role` を strong に設定して新規セッションを開始し、 `spirits/auto` 選択ではバッジが `[strong]`、 物理モデル選択ではバッジが出ないことを確認する。続いて既存のセッションを復帰し、 セッションファイルに entry が追記されないことを確認する
- [x] 6.5 strong をロックした状態で `/skill:sprt-opsx-verify-deep` を走らせ、 run 中も run の後も strong の対象モデルへルートされ続けることを確認する。続いて `/model spirits/auto normal` で normal に戻ることを確認する
- [x] 6.6 strong をロックした状態で対象スキル以外の入力（通常のプロンプト）を送り、 ロックが解除されないことを確認する
- [x] 6.7 既定ロール未設定で `/model spirits/auto strong` を Enter し、 `/tree` で別の分岐へ移動してもロックが保たれること、 `/reload` 後は normal に戻ることを確認する。`models.role` を strong にした場合は `/reload` 後も strong であることを確認する
