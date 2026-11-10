# Tasks: switch-default-to-managed

## 1. 共有する規則の整備

- [x] 1.1 `bin/env-defaults.ts` の `computeEnvDefaults` を `src/env-defaults.ts` へ移し、`bin/env-defaults.ts` は re-export にする（`bin/version.ts` と同じ形）。検証: `bun test test/env-defaults.test.ts test/managed-pi-bootstrap.test.ts`
- [x] 1.2 `docs/architecture/convention-registry.md` の `registry:layer-members` の `spirits:shared` に `packages/spirits/src/env-defaults.ts` を追加する。検証: `bun test test/architecture-conventions.test.ts`
- [x] 1.3 `src/constants.ts` に route 選択・バックアップ・manifest 取得の固定値（`ENV_ROUTE`、`ROUTE_FORK_VALUE`、`SPIRITS_BACKUPS_DIR_NAME`、`AGENT_BACKUP_DIR_PREFIX`、`AGENT_BACKUP_STATE_FILE_NAME`、`AGENT_BACKUP_TEMP_SUFFIX`）を追加する。検証: `bun run check`

## 2. 既定経路の起動（agent dir / 引数 / route）

- [x] 2.1 `src/managed-pi/default-route.ts` に `selectStartupRoute({ env, compiled })` を実装する（既定 managed、`SPIRITS_ROUTE=fork` で fork、未コンパイルは fork）。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 2.2 `computeManagedEnv` の `sessionDir` を省略可能にし、指定したときだけ pin する。検証: `bun test test/managed-pi-env.test.ts`
- [x] 2.3 `src/managed-pi/default-route.ts` に `runDefaultManagedStartup()` を実装する（agent dir を `computeEnvDefaults` から決める、set 検証、不足時の取得、spawn、引数透過）。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 2.4 失敗時の表示（理由、`spirits managed-pi repair`、`SPIRITS_ROUTE=fork`）と非ゼロ終了を固定する。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 2.5 `bin/bootstrap.ts` を route 選択で分岐させ、`bin/startup.ts` に既定経路の手渡しを追加する。検証: `bun test test/managed-pi-bootstrap.test.ts`

## 3. 初回起動前の agent dir バックアップ

- [x] 3.1 `src/managed-pi/agent-backup.ts` に `backupAgentDirOnce()` を実装する（記録確認、一時ディレクトリへコピー、rename、記録、表示）。検証: `bun test test/managed-pi-agent-backup.test.ts`
- [x] 3.2 symlink をたどらずリンクのまま保存し、リンクと参照先を表示する。検証: `bun test test/managed-pi-agent-backup.test.ts`
- [x] 3.3 パーミッション（ファイル・ディレクトリ）を保つ。検証: `bun test test/managed-pi-agent-backup.test.ts`
- [x] 3.4 失敗時は記録を書かず、spawn せず、非ゼロで終わる。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 3.5 2 回目以降は取得しない。検証: `bun test test/managed-pi-agent-backup.test.ts`

## 4. 一式の取得（update / install.sh / 初回起動）

- [x] 4.1 `src/managed-pi/release-assets.ts` に `installManagedSetFromRelease({ tag, root, env, fetch, io })` と `releaseTagForVersion()` を実装する。検証: `bun test test/managed-pi-release-assets.test.ts`
- [x] 4.2 `src/update/run.ts` の `UpdateResult` に解決したリリースの `releaseTag` を追加する。検証: `bun test test/update-run.test.ts`
- [x] 4.3 `bin/bootstrap.ts` で自己更新の後に参加リリースの一式を導入し、失敗時は非ゼロ＋修復手段の表示にする。検証: `bun test test/managed-pi-default-route.test.ts`（update の導線）
- [x] 4.4 `scripts/install.sh` に配置後の managed 一式の導入（`SPIRITS_MANAGED_PI_MANIFEST_URL` を同じタグへ固定した `managed-pi install`）と失敗時の非ゼロを追加する。検証: `bash scripts/install.test.sh`

## 5. bundle の版の埋め込みと確認

- [x] 5.1 `scripts/build-managed-pi-inputs.ts` の `Bun.build` に `define: { SPIRITS_VERSION: JSON.stringify(version) }` を追加する。検証: `bun test test/managed-pi-build-inputs.test.ts`
- [x] 5.2 `scripts/check-managed-pi-bundle-version.ts` を追加し、manifest の版・bundle からの `SPIRITS_VERSION` 識別子の消滅・版の文字列を確認する。検証: `bun test test/managed-pi-build-inputs.test.ts`
- [x] 5.3 `.github/workflows/spirits-release.yml` に `--version "${GITHUB_REF_NAME#spirits-v}"` での一致確認ステップを追加する。検証: workflow 定義の確認（`git diff`）
- [x] 5.4 fork と managed の版ディレクトリが同じ agent dir に共存すること、既存の stale 整理だけを使うことを確認する。検証: `bun test test/bundled-skills.test.ts`

## 6. 回帰テスト（隔離 HOME）

- [x] 6.1 既定で managed が agent dir を使って起動する、`--continue` / `--session` が通る。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 6.2 一式が足りない場合と壊れている場合の表示と終了コード。検証: `bun test test/managed-pi-default-route.test.ts`
- [x] 6.3 隔離経路のガードが引き続き効くこと。検証: `bun test test/managed-pi-agent-dir.test.ts test/managed-pi-bootstrap.test.ts`
- [x] 6.4 統合: 隔離 HOME で fixture 一式を使い、既定経路の spawn まで通す。検証: `bun test test/managed-pi-integration.test.ts`

## 7. docs

- [x] 7.1 `docs/spirits-managed-pi.md` を既定経路前提に更新する（何が変わるか、バックアップの場所と復元、fork への戻し方、修復、隔離経路の位置づけ）。検証: 目視
- [x] 7.2 試用環境のセッションを `~/.spirits/agent` に戻す手順を docs に書く。検証: 目視
- [x] 7.3 `packages/spirits/README.md` に既定経路と退避手段を追記する。検証: 目視

## 8. データの安全性と互換性ランナー

- [x] 8.1 fixture の agent dir で既定経路の managed の読み書きを行い、`SPIRITS_ROUTE=fork` で読めることを `docs/agent-data-compat` の手順で確認し、証拠を残す。検証: `bun scripts/agent-data-compat/run.ts` の出力
- [x] 8.2 clean なツリーで互換性ランナーの official を 1 回実行し、結果が変わらないことを確認して証拠を残す。検証: `bun scripts/managed-pi-compat/run.ts --mode official …`

## 9. ゲート

- [x] 9.1 `openspec validate switch-default-to-managed --strict`
- [x] 9.2 `openspec validate --all --strict`
- [x] 9.3 `cd packages/spirits && bun test`
- [x] 9.4 `bun run check` と `npm run check`
