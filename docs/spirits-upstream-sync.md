# spirits 上流追従手順

Pi 上流 (`earendil-works/pi`) の変更を spirits の main へ取り込む手順。方針は `docs/spirits-design.md` §5、直近の適用例は `openspec/changes/archive/2026-*/add-upstream-tracking/` を参照。

## 原則

- 取り込みは merge で行い、上流の commit を main の祖先として保持する。rebase や force push はしない。
- 取り込み作業は main 上で行い、push 前の検証がすべて成功するまで push しない。
- 取り込み元はリリースタグを第一候補とする。未リリースの破壊変更を受けずに済み、理由と判断は change の design に記録する。

## 1. 取り込み準備

1. `upstream` リモートを登録する (git remote は clone ごとのローカル設定で、リポジトリに含まれない)。

   ```sh
   git remote add upstream https://github.com/earendil-works/pi.git
   git config remote.upstream.tagOpt --no-tags
   ```

   `tagOpt --no-tags` は、fetch で上流タグを一括取得しないための設定。`upstream` へ push はしない。

2. 取り込み対象のリリースタグまたは commit を、change の tasks に記録する。例: `取り込み対象: pi v1.1.0 (abe508e1b89912adde45528136c3221eb69acdd7)`。

3. 取り込み対象のタグだけを明示的に fetch する。

   ```sh
   git fetch upstream tag v1.1.0
   git rev-parse v1.1.0^{commit}   # 対象 commit を確認
   git merge-base main v1.1.0      # 基点を確認
   git tag -l 'v*'                 # 取り込んだタグだけが増えていること
   ```

   `git fetch upstream` (タグ指定なし) や `--tags` は使わない。上流の `v*` タグを origin へ push すると、fork に残る `build-binaries.yml` (`push: tags: ['v*']`) が Pi のリリース処理を起動する。

## 2. merge と競合解決

```sh
git merge --no-ff --no-commit v1.1.0
git status
```

- `--no-commit` で止め、競合と自動マージ結果を検証してから merge を確定する。
- 競合解決の原則: 製品 identity に関わる文書 (README など) は spirits 版を採用する。テストは原則として双方のテストブロックを残す。lockfile は手マージせず再生成する。
- 自動マージされたコアファイルは `git diff <tag>` を確認し、残る差分が既知の fork 差分だけであることを確認する。既知の fork 差分は `git diff <base> <tag> -- <core files>` と照合する。
- 型スタブと上流 Extension API の差分を照合する。

  ```sh
  grep -hoE '^export (declare )?(interface|type|function|const|class) [A-Za-z0-9_]+' packages/spirits/src/types/*.d.ts
  git diff <base> <tag> -- packages/coding-agent/src packages/tui/src
  ```

  スタブが宣言する export とメンバに、削除・改名・型の変更が無いことを確認する。上流で追加されただけのメンバはスタブに足さない。食い違いがあれば、スタブを直す `fix:` コミットを手順 4 の後に追加する。

## 3. lockfile、モデルデータ、merge の確定

```sh
npm install --ignore-scripts
npm install --package-lock-only --ignore-scripts
node scripts/generate-coding-agent-install-lock.mjs --check
bun install --ignore-scripts
bun install --frozen-lockfile --ignore-scripts
bun packages/ai/scripts/generate-models.ts --strict --data-only
```

- merge コミットには、上流の変更、競合の解決、lockfile の再生成だけを含める。
- `package-lock.json` を含む merge コミットは pre-commit の lockfile ガード (`scripts/check-lockfile-commit.mjs`) に拒否される。差分を確認したうえで `PI_ALLOW_LOCKFILE_CHANGE=1` を付けてコミットする。
- `git diff --cached -- package-lock.json` で追加・更新されたパッケージに `hasInstallScript` を持つものが無いことを確認する。あればコミットせずに利用者へ報告する。

## 4. コミット構成

1. **merge コミット**: 上流の変更、競合解決、lockfile の再生成。メッセージは既定の `Merge tag 'v1.1.0'` のまま変えない。
2. **spirits 側の修正** (`scripts/build-binaries.ts`、`.github/workflows/spirits-ci.yml`、README など): merge の後に 1 修正 = 1 コミット。`fix:` を使う。手順文書の修正は `docs:` を使う。
3. **Pi コアへの適応** (`packages/spirits/` を除く `packages/` 配下): `[spirits]` プレフィックスを付けた独立コミット。上流 API への適応以外で新しいコア差分を増やさない。
4. **上流修正のバックポート**: 検証で上流 main の既知の修正が必要になった場合は、その commit を `git cherry-pick --no-commit <sha>` で取り込み、1 修正 = 1 コミットで分離する。メッセージは変更対象で使い分ける。`packages/` 配下 (Pi コア) なら `[spirits] fix(...): <上流の subject>`、それ以外 (`scripts/` など) なら `fix: <上流の subject>`。本文に `(cherry picked from commit <sha>)` を付ける。追跡される生成物 (`packages/ai/src/providers/*.models.ts`、`models.generated.ts`) は再生成せず、上流 commit と同じ内容にする。
5. 検証で修正が必要になった場合も同じ規則でコミットを追加し、手順 5 の統合検証を最初からやり直す。

## 5. 検証 (push 前)

次の順で実行する。1 つでも失敗したら push しない。

1. 型スタブ照合 (手順 2)。
2. lockfile 検証とモデルデータ hydrate (手順 3)。
3. root で `npm run build:offline`。v1.1.0 以降の `npm test` は一部パッケージでビルド済み `dist/` を前提とするため、検証の前に build する。
   - `npm run build` は使わない。`packages/ai` の `generate-models` (full) が live のモデルデータで追跡ファイル (`packages/ai/src/providers/*.models.ts`、`models.generated.ts`) を再生成し、取り込みと無関係な差分が混ざるため。`build:offline` は `check:model-data` で検証したデータを使い、`tsc` とデータのコピーだけを行う。
   - AGENTS.md により build の実行には利用者の承認が必要。`check:model-data` が失敗した場合は `npm run build` に切り替えず、止めて利用者に報告する。
   - 実行後は `git status --short --untracked-files=no` が空 (追跡ファイルが書き換わっていない) であることを確認する。
4. root で `npm run check`。
5. pi-env daemon のビルド。rustup が無ければ導入し、`packages/env/daemon/rust-toolchain.toml` が指定する toolchain (現状 1.96.0) を入れる (`rustup toolchain install 1.96.0`)。root で `npm run build:daemon --workspace packages/env` を実行し、`packages/env/daemon/target/debug/pi-env` が存在し、ビルド成果物が `git status --short packages/env` に出ないことを確認する。
6. root で `./test.sh` (非 e2e テスト)。上流 `packages/env` のテストが daemon を要求するため、5 の後に行う。
7. `packages/spirits` で `bun install --frozen-lockfile` → `bun test` → `bun run check`。
8. spirits バイナリの build と version 注入。`env -u SPIRITS_VERSION bun scripts/build-binaries.ts` でビルドし、`dist/spirits-linux-x64 --version` が `git describe --tags --match 'spirits-v*'` から導出した値 (例: `0.2.0`) を表示し終了コード 0 で終わることを確認する。
9. self-update smoke。旧版と新版のバイナリを作り、`sh scripts/self-update-smoke.sh <old> <new> <version>` を通す。
10. binary-distribution の既存シナリオ (`--help` に `Update pi` を含まないこと、設定ディレクトリの作成先、旧環境変数名の無視、外部拡張のロード) をビルド済みバイナリで再実行する。あわせて `.env` 禁止の回帰 smoke を実行する。

    ```sh
    bash scripts/test-dotenv-smoke.sh dist/spirits-linux-x64
    ```

    スクリプトは cwd の `.env` / `.env.local` / `.env.<NODE_ENV>` の値が記録に含まれないことと、シェルの環境変数が含まれることを検証する。
11. 対話モード smoke。`.pi/skills/interactive-testing.md` の tmux 手順でビルド済みバイナリを起動し、ヘッダ表示、`/clear`、`tsrepl` の呼び出しを確認する。

## 6. push と上流タグの扱い

```sh
git config --get push.followTags          # "true" でないこと
git push origin main                      # --tags / --follow-tags は使わない
git ls-remote --tags origin refs/tags/v1.1.0   # 空であること
```

上流の `v*` タグは origin へ push しない。push 後は Spirits CI (`.github/workflows/spirits-ci.yml`) と上流 CI (`.github/workflows/ci.yml`) の成功を確認する。

## 7. fork で使わない上流 workflow の無効化

- 上流が追加した workflow のうち spirits で使わないもの (現状: `env.yml` / Environments) は、GitHub Actions UI で無効化し、ファイルは残す。ファイルを書き換えたり削除したりすると fork 差分が増え、次回の merge で衝突する。
- Actions UI は default branch 上の workflow しか扱えない。`env.yml` が origin の main に入る最初の push では 1 回起動するため、push 直後に実行を cancel し、その後 UI の "Disable workflow" で無効化する。
- `gh workflow list --all` で対象 workflow の状態が `disabled_manually` であることを確認する。
