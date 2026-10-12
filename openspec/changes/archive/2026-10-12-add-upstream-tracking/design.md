# Design

## Context

現状の把握は探索で完了している。要点だけ置く。

- fork 基点 `a276dabe5` (pi v1.0.0)。local main は `[spirits]` コア差分を含む 23 commits。`upstream` リモートは未登録
- 上流は v1.1.0 (`abe508e1b`) と、その先の main (未リリース 47 commits)。v1.1.0 の dry-run merge の衝突は `README.md` と `packages/coding-agent/test/config.test.ts` の 2 ファイル
- `[spirits]` コア差分 (`config.ts` の identity override、`interactive-mode.ts` の `/clear` とヘッダ、`agent-session-runtime.ts` の `clearConversation`、`slash-commands.ts` の `clear` 登録、`provider-attribution.ts` の `x-opencode-client` 抑止、`package-manager-cli.ts` の bun-binary ガード、`auth-command.ts` の `formatAuthCommandHelp`、`config-selector.ts` の設定パス表示、`args.ts` / `main.ts` / `sdk.ts` / `mcp/cli.ts`) は自動マージされる
- 上流 `src/bun/*` は base..v1.1.0 で無変更。spirits の独自エントリ `bin/spirits.ts` の前提は崩れない
- `replace-pi-version.ts` が依存する VERSION 宣言は v1.1.0 でも同一
- post-release の `biome-check.mjs` 移行と `apps/*` workspaces は v1.1.0 に含まれない
- v1.1.0 の `packages/env` のテストは、Rust 製の pi-env daemon (`packages/env/daemon`、toolchain 1.96.0) のビルドを前提とし、未ビルドだと import の時点で失敗する。上流 `ci.yml` は `npm test` の前に `npm run build:daemon --workspace packages/env` を実行する。ビルド成果物 `packages/env/daemon/target/` は上流の `.gitignore` で除外される
- 上流 README の差分は、節 `Using local packages outside the monorepo` の追加と、npm 依存の節の 1 行の変更だけ。spirits の `README.md` にはどちらの節も無い
- v1.1.0 は workflow `env.yml` (Environments) を追加する。`packages/env/**` を変更する main への push で起動し、macOS / Windows / ARM のマトリクスで実行される。spirits は pi-env を使わない
- spirits の `bun run check` は、Pi の型を手書きの型スタブ (`packages/spirits/src/types/*.d.ts`) で解決する。rlm の子セッション生成のテストは fake SDK を使う。v1.1.0 の Extension API の変更は追加だけで、スタブが宣言する export とメンバには当たらない
- v1.1.0 のテストの一部は、ビルド済みの `dist/` を前提とする。例: `packages/coding-agent` の experimental テストは `@earendil-works/pi-durable` を、`2791-fswatch-error-crash.test.ts` の子プロセス (Node) は `@earendil-works/pi-tui/dist/index.js` を、`packages/ai/test/models-entry.test.ts` は `@earendil-works/pi-ai/models` を、それぞれ `dist/` から解決する。上流 `ci.yml` は `npm ci` → `npm run build` → `npm run check` → `build:daemon` → `npm test` の順で実行する (検証中に判明)
- root の `npm run build` は、`packages/ai` で `generate-models` (live からの完全な再生成) を実行し、追跡対象の `packages/ai/src/providers/*.models.ts` などを書き換える。root の `npm run build:offline` は、`packages/ai` では `check:model-data` と `tsc` だけを実行し、hydrate 済みのデータを `dist/` にコピーする
- モデルデータは live から hydrate するため、リリース時点の値を期待するテストが外れることがある。v1.1.0 の `packages/ai/test/supports-xhigh.test.ts` は Claude Sonnet 5.5 の `cacheRead: 0.2` (v1.1.0 の `generate-models.ts` にある暫定値) を期待するが、現在の models.dev は `0.1` を返す。上流 main の `ce950d78f` が暫定値を削除し、期待値を `0.1` に直している (検証中に判明)
- 検証環境の npm 12 では `npm pack --json` の出力形式が変わり、root `scripts/package-artifacts.mjs` のテストが失敗する。上流 main の `6fb2e7815` (fixes #10633) を `fix:` コミット `154106b18` でバックポート済み。変更は root の `scripts/` だけで、Pi コア (`packages/` 配下) は変えていない (検証中に判明)

運用方針の一次根拠は `docs/spirits-design.md` §5。差分分離と `[spirits]` プレフィックス、lockfile の段階移行は同節を参照し、ここでは重複させない。

## Goals / Non-Goals

**Goals:**

- Pi v1.1.0 の merge を main へ取り込み、v0.3 開発ツリーの出発点にする
- 上流追従の手順 (リモート、merge、コミット構成、検証、CI) を文書化し、再実行可能な形で確立する
- `[spirits]` コア差分を保持し、新規の fork 差分は原則として増やさない

**Non-Goals:**

- v0.3.0 のタグ付けとリリース検証
- 上流 main の未リリース変更 (pi.dev schema 移行など) の採用
- `[spirits]` コア差分の設計変更やリファクタリング
- npm から bun への完全移行 (§5 の段階移行を維持)

## Decisions

### Decision 1: 取り込み元は上流のリリースタグ v1.1.0 を使う

採用: `abe508e1b` (tag `v1.1.0`) を merge する。
代替: upstream main を merge する (§5 の字義通り)。
理由: 配布物の安定性を優先し、未リリースの破壊変更 (設定 schema の pi.dev 移行) を今は受けない。衝突も 2 ファイルで済む。§5 の「main へ定期 merge」は merge 先を main に置く規定であり、取り込み元をリリースタグに限定しないと読む。

### Decision 2: 履歴は merge で保持し、rebase しない

採用: upstream の commit を祖先に持つ merge コミットを作る。
代替: 23 local commits を v1.1.0 へ rebase する。
理由: rebase は公開済み main の書き換えと force push を伴い、プロジェクト規則に反する。merge は merge-base を正確に保ち、次回以降の取り込みコストを下げる。

### Decision 3: 取り込み作業は main 上で行い、検証通過まで push しない

採用: local main で merge と検証を完結させ、全検証成功後に push する。
代替: `sync/pi-1.1.0` ブランチと pull request を使う。
理由: ソロ運用でレビュー待ちが無く、ブランチと pull request の手順を挟む利点が無い。Spirits CI と上流 CI は push 後に確認し、失敗した場合は Migration Plan に従って修正コミットで対応する。

### Decision 4: 競合解決は fork 側の意図を優先する

採用: `README.md` は spirits 版をそのまま採用し、上流の追加は移植しない。`config.test.ts` は双方のテストブロックを残す。`package-lock.json` は手マージせず再生成する。
代替: 上流の開発者向け節 (ローカルパッケージ利用、release smoke の記述) を spirits 版へ移植する。または上流版の README をそのまま採用する。
理由: spirits の `README.md` は利用者向け文書である。上流が追加した節は、Pi のパッケージを monorepo の外で使う手順で、spirits の利用者に関係しない。release smoke の行が属する npm 依存の節は、spirits の `README.md` に無い。spirits 版の採用なら翻訳版 README との食い違いも生じない。lockfile は再生成が唯一の正解。

### Decision 5: lockfile は package-lock と bun.lock の二本立てを維持する

採用: `npm install --ignore-scripts` と `npm install --package-lock-only --ignore-scripts` で `package-lock.json` を整え、root で `bun install --ignore-scripts` して `bun.lock` を更新する。検証は `bun install --frozen-lockfile --ignore-scripts`。
代替: `package-lock.json` を削除して bun へ完全移行する。
理由: §5 が完全移行を別 change とする方針。spirits の CI とバイナリ build は bun 前提のため bun.lock の更新は必須。`packages/env` と新 devDeps が入るため、どちらも更新しないと CI が落ちる。`--ignore-scripts` は、利用者の指示なしに lifecycle script を実行しないというプロジェクト規則 (AGENTS.md) に従うため。

### Decision 6: モデルデータは上流の generate-models をそのまま使う

採用: `packages/ai/scripts/generate-models.ts` の上流版を採用し、CI と同じ `--strict --data-only` でデータを再生成する。`models.generated.ts` の上流差分も採用する。
代替: 旧 script を残して差分を最小化する。
理由: 生成器の保守を上流に委ねるのが fork 運用の原則。フラグが存続することを確認済み。

### Decision 7: spirits バイナリでも .env 自動ロードを無効化する

採用: `scripts/build-binaries.ts` の `Bun.build` で `compile.autoloadDotenv: false` を指定する。
代替: 上流の `scripts/build-binaries.sh` を使う。
理由: fork は独自エントリと `Bun.build` API を使っており shell script は使えない。bun-types 1.4.2 の `CompileBuildOptions.autoloadDotenv` (既定値 `true`) を `false` にすると、`.env` 系ファイルの自動読み込みが止まる。
v0.2.0 までのバイナリは、この既定値のまま `.env` 系ファイルを読んでいた。そのためこの変更は BREAKING として扱い、移行方法 (シェルの環境変数で指定する) を README 5 件に記載する。対象は root の `README.md`、翻訳版の `README.ja.md` / `README.zh.md` / `README.de-CH.md`、`packages/spirits/README.md`。5 件すべてに、`PI_CODING_AGENT_DIR` の廃止を BREAKING として記載した前例がある。

### Decision 8: Spirits CI のトリガにコアのソースパスと root 設定を加える

採用: `spirits-ci.yml` の `push` と `pull_request` の `paths` に、`packages/**`、`package.json`、`tsconfig.json`、`tsconfig.base.json` を追加する。既存の paths 列挙は維持する。
代替: main push では paths フィルタを外して常時実行する。
理由: 上流取り込みの merge ではコアと lockfile が同時に変わるが、その後のコア単独変更でも spirits テストを走らせる必要がある。spirits は `packages/` 配下に加えて root の設定にも依存する。`packages/spirits/tsconfig.json` は `tsconfig.base.json` を継承し、`scripts/build-binaries.ts` は root の `tsconfig.json` を使い、root の `package.json` は workspace の構成を決める。これらを列挙すれば、PR と push の両方で paths による絞り込みを保てる。

### Decision 9: 検証は上流 CI と独立に spirits 側で完結させる

採用: 次の順で実行する。
1. merge 中: 型スタブが宣言する export とメンバについて、上流 diff での削除・改名・型の変更を照合する
2. lockfile 検証 → モデル hydrate
3. `npm run build:offline` → `npm run check` → pi-env daemon の build → `./test.sh`
4. spirits の `bun test` / `bun run check`
5. バイナリの build と version、self-update smoke
6. 既存の binary-distribution シナリオのバイナリ smoke (`--help`、設定ディレクトリ、旧環境変数名の無視、外部拡張のロード) と、`.env` 禁止の回帰 smoke (`scripts/test-dotenv-smoke.sh`)
7. 対話モード smoke (ヘッダ、`/clear`、`tsrepl`)

代替: 上流 ci.yml と同じ `npm ci` ベースの検証に寄せる。
理由: spirits のビルドと配布は bun 前提であり、上流 CI では spirits のテストが走らない。ローカルで再現できる順序を固定しておく。
`./test.sh` は上流の `packages/env` のテストを含むため、上流 CI と同じく事前に pi-env daemon をビルドする。`packages/env` を除いてテストし上流 CI に委ねる案は、push 前の検証範囲が狭まり spec の検証集合も変わるため採らない。
`./test.sh` のテストの一部はビルド済みの `dist/` を前提とするため、上流 CI と同じく事前に各パッケージをビルドする。ビルドには `npm run build` ではなく `npm run build:offline` を使う。`npm run build` は live からモデルデータを完全に再生成し、追跡ファイルに取り込みと無関係な差分を出すため。`build:offline` は手順 2 で hydrate したデータを使い、追跡ファイルを変えない。vitest の解決設定を広げて build を避ける案は、子プロセスが `dist/` を読むテストを解決できず、fork 独自のテスト基盤の差分も増えるため採らない。AGENTS.md は依頼の無い build を禁じるため、build の実行には利用者の承認を得る。
spirits のテストは型スタブと fake SDK を使うため、上流コアの変化を直接は検出できない。型スタブの照合で型の食い違いを、binary-distribution の既存シナリオと対話モード smoke で、バイナリの観測できる挙動を確かめる。
統合検証 (`npm run build:offline` 以降) は、Decision 10 のコミットをすべて作った後の HEAD に対して行う。検証で修正コミットを追加した場合は、`npm run build:offline` から再実行する。

### Decision 10: merge コミットと spirits 側の修正コミットを分ける

採用: 取り込みは次の 3 コミットで構成する。
1. merge コミット: 上流 v1.1.0 の変更、競合の解決、lockfile (`package-lock.json`、`bun.lock`) の再生成だけを含める。メッセージは既定の `Merge tag 'v1.1.0'` を使う。
2. `fix:` コミット: `scripts/build-binaries.ts` の `.env` 自動読み込みの無効化と、README の移行方法の記載。
3. `fix:` コミット: `spirits-ci.yml` のトリガの修正。

これらとは別に、手順文書 (Decision 11) を `docs:` コミットとして追加する。
検証で修正が必要になった場合は、1 修正 = 1 コミットで追加する。
- Pi コア (`packages/spirits/` を除く `packages/` 配下) の修正は、`[spirits]` プレフィックスのコミットにする (spec「fork 差分の分離維持」)。上流 API への適応と、上流の修正のバックポートを含む。バックポートは上流のコミットと同じ内容にし、メッセージに cherry-pick 元を記録する
- Pi コア以外の修正 (root の `scripts/`、`packages/spirits/`、ビルド設定など) は `fix:` コミットにする
- 手順文書 (Decision 11) の修正は `docs:` コミットにする

v1.1.0 の取り込みで追加するコミットは次の 3 件。
- `fix: support npm 12 pack JSON output` (`154106b18`): 上流 `6fb2e7815` のバックポート。root の `scripts/` だけを変更する
- `[spirits] fix(ai): use models.dev metadata for Claude 5.5 models`: 上流 `ce950d78f` のバックポート。`packages/ai` の 2 ファイルを変更する
- `docs:` コミット: 手順文書の検証順序に `npm run build:offline` を加える
代替: 競合解決、lockfile、`.env` の無効化、CI トリガをすべて 1 つの merge コミットに含める。
理由: merge コミットの内容を上流の取り込みに限ると、上流由来でない変更を後から識別し、個別に revert できる。また、merge の後に追加された `[spirits]` コミットを `git log` で列挙できる。
制約: `package-lock.json` を含む merge コミットは、pre-commit の lockfile ガード (`scripts/check-lockfile-commit.mjs`) に拒否される。そのため、lockfile の差分を確認したうえで `PI_ALLOW_LOCKFILE_CHANGE=1` を付けてコミットする。pre-commit は各コミットで `npm run check` を実行し、`packages/ai` が変わる場合は browser smoke も実行する。

### Decision 11: 上流追従の手順は専用文書に置き、§5 から参照する

採用: `docs/spirits-upstream-sync.md` に、次の手順を記載する。§5 の「上流追従」の項からこの文書を参照する。
- `upstream` リモートの登録と、上流タグの扱い
- 取り込み対象のタグまたは commit を、change の tasks に記録すること
- 取り込み対象の fetch と merge
- 型スタブと上流 Extension API の差分照合
- コミット構成 (Decision 10)
- 検証コマンドとその順序 (Decision 9)
- fork で使わない上流 workflow の無効化 (Decision 12)

代替: 手順を `docs/spirits-design.md` §5 に直接書く。
理由: §5 はフォーク運用の方針を置く節であり、コマンドの列や検証の順序を入れると、方針と手順が混ざる。手順を別文書に分けると §5 は方針だけを保ち、記述の重複を避けられる。git remote は clone ごとのローカル設定で push されないため、手順は文書として残す必要がある。

### Decision 12: fork で使わない上流 workflow は GitHub の UI で無効化する

採用: Environments (`env.yml`) を GitHub の Actions UI で無効化し、ファイルは残す。
代替: `env.yml` を削除するか、トリガを書き換える。
理由: spirits は pi-env を使わない。ファイルを変えると fork の差分が増え、次回以降の取り込みで衝突する。UI での無効化はリポジトリ設定であり、ファイルの差分を生まない。
制約: GitHub の Actions UI は default branch にある workflow だけを扱うため、`env.yml` が origin の main に入る前は無効化できない。そのため merge の push で起動した最初の実行は避けられず、push 直後に cancel してから無効化する。

### Decision 13: .env 禁止の回帰テストは独立した smoke スクリプトで自動化する

採用: `scripts/test-dotenv-smoke.sh` を追加する。引数でビルド済みバイナリのパスを受け取り、probe 拡張を一時ファイルへ生成し、cwd と agent dir を分離した一時環境で 3 ケース (`.env` の無視、`.env.local` / `.env.<NODE_ENV>` の無視、シェル環境変数の反映) を検証する。`docs/spirits-upstream-sync.md` の検証手順から実行し、次回以降の取り込みで回帰を検出する。
代替: `Bun.build` に渡す `autoloadDotenv: false` を単体テストで確認する。手動 smoke のままにする。`scripts/self-update-smoke.sh` にケースを追加する。
理由: `.env` の自動読み込みの有無はコンパイル済みバイナリの実行時の挙動でしか観測できず、オプション値の単体テストは実効性の証拠にならない。手動のみでは再実行可能性が無い。self-update smoke は更新経路の検証で関心が異なる。verify2 の W-1 への対応。

## Risks / Trade-offs

- [Risk] auto-merge されたコアファイルで意味的な衝突が残る (settings-manager や model-config のリファクタと fork 側の変更) → Mitigation: auto-merge されたファイルの diff を目視し、型スタブを照合する。`npm run check` と `./test.sh` に加えて、既存の binary-distribution シナリオのバイナリ smoke と対話モード smoke を実行する
- [Risk] Rust toolchain の導入や daemon のビルドに失敗し、`./test.sh` を実行できない → Mitigation: `packages/env/daemon/rust-toolchain.toml` が指定する 1.96.0 を rustup で入れる。`build:daemon` は `cargo build --locked` で、`Cargo.lock` に固定した crate だけを使う。失敗時は原因を解消するまで push しない
- [Risk] bun.lock の再生成漏れで CI の `--frozen-lockfile` が落ちる → Mitigation: `bun install --ignore-scripts` 後に `bun install --frozen-lockfile --ignore-scripts` で再検証してから push する
- [Risk] モデルデータの再生成がネットワーク依存で失敗する → Mitigation: 先に hydrate を実行し、失敗時は原因を解消してから検証を続ける
- [Risk] `.env` 無効化の反映漏れで spirits バイナリだけ環境が漏れる → Mitigation: `compile.autoloadDotenv: false` を build 設定に追加し、バイナリ起動 smoke で確認する
- [Risk] 次回以降の取り込みでリリースタグと main の選択がぶれる → Mitigation: 取り込み対象を tasks に記録することを spec で要求し、この design の Decision 1 を判断の記録として残す
- [Risk] 検証で追加の修正が必要になり、コミット構成が計画とずれる → Mitigation: Decision 10 の規則で `[spirits]`、`fix:`、`docs:` のコミットを追加し、`npm run build:offline` から検証をやり直す
- [Risk] build で追跡ファイル (`packages/ai/src/providers/*.models.ts` など) が live のモデルデータで書き換わる → Mitigation: `npm run build:offline` を使い、実行後に追跡ファイルの変更が無いことを `git status` で確認する
- [Risk] hydrate 済みのデータが `build:offline` の `check:model-data` を通らない → Mitigation: 完全版の `npm run build` に切り替えず止め、原因を利用者に報告する
- [Risk] live のモデルデータや検証環境のツール (npm 12 など) がリリース時点から変わり、上流のテストが失敗する → Mitigation: 上流 main に修正があれば、Decision 10 の規則でバックポートする。修正が無ければ止めて利用者に報告する
- [Risk] 上流の `v*` タグを origin へ push すると、fork に残る `build-binaries.yml` (`push: tags: ['v*']`) が pi のリリース処理を起動する → Mitigation: 取り込み対象のタグだけを fetch し、`upstream` リモートに `tagOpt --no-tags` を設定する。`git push --tags` と `git push --follow-tags` は使わず、`push.followTags` が `true` でないことを push 前に確認する。これらを手順文書に記載する
- [Risk] merge の push で Environments workflow が macOS / Windows / ARM のマトリクスで起動する → Mitigation: push 直後に実行を cancel し、workflow を UI で無効化する (Decision 12)
- [Risk] `.env` 系ファイルに API キーなどを置いていた利用者が、更新後に認証エラーになるまで変更に気付けない → Mitigation: BREAKING として扱い、移行方法を README 5 件に記載する (Decision 7)

## Migration Plan

- 適用は main への merge 1 回と、それに続く修正コミット (Decision 10)。push 前に全検証を完了させる
- push 前の取り消しは、merge を確定する前なら `git merge --abort` で行う。確定した後の取り消しはローカルのコミットを捨てる操作になるため、利用者の確認を得てから行う。push 後は通常の修正コミットで対応し、上流取り込みの revert は行わない
- rustup と Rust toolchain は利用者のローカル環境に導入するもので、リポジトリには含まれない
- v0.3.0 タグはこの変更では打たない。タグ付けとリリース検証はリリース作業として別に行う
