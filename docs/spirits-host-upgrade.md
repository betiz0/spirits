# ホスト (公式 Pi) の版更新手順

spirits は Pi を内包しない。実行時に使うホストは `~/.spirits/managed-pi` に導入した**公式 Pi の固定 artifact** で、spirits 側が固定しているのは次の 3 種類だけである。

| 固定値 | 場所 | 意味 |
| --- | --- | --- |
| 型検査に使うホストの型 | `packages/spirits/package.json` の devDependencies `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` | `tsc --noEmit` が拡張を検査する相手。実行時ではなく検査時にだけ効く |
| 導入する artifact の版・名前・sha256・overlay 版 | `packages/spirits/src/constants.ts` の `PINNED_PI` | managed の一式が展開する公式配布物の実体 |
| ホスト固有の形 | `packages/spirits/src/managed-pi/host.ts` の `HostDescriptor` | 実行ファイル名、bundle のロード引数、ホストが読む環境変数名、host が第一引数で dispatch するコマンド語 |

版の更新とは、この 3 か所を同じ版にそろえて、実測で裏を取ることである。フォーク時代のような上流マージは存在しない。

## 更新手順

手順 2〜8 のいずれかが失敗したときは**そこで中止し、固定値をコミットしない**。

### 1. 対象の公式 Pi の版を決める

`@earendil-works/pi-coding-agent` の公開版から選ぶ。spirit のリリースタグ (`spirits-v*`) とホストの版は別物で、1 つの spirits リリースが 1 つのホスト版を指す。

### 2. 型の pin を更新する

`packages/spirits/package.json` の devDependencies を対象の版へ**完全一致**で更新し、`packages/spirits` で `bun install` する。ルートにも同じ名の workspace があるため、解決先がインストール済みの公式パッケージであることを実測で確認する (`import.meta.resolve` をリポジトリルートや `/tmp` から叩くと別の解決結果が見えることがあるので、必ず `packages/spirits` の中で確認する)。

```sh
cd packages/spirits
bun install --save-exact
```

確認は一時ファイルを `packages/spirits` に置いて実行する。

```sh
# packages/spirits/host-resolve-probe.mts (確認後に削除する)
console.log(import.meta.resolve("@earendil-works/pi-coding-agent"));
console.log(import.meta.resolve("@earendil-works/pi-tui"));
```

```sh
cd packages/spirits && bun host-resolve-probe.mts
```

`node_modules/.bun/@earendil-works+pi-coding-agent@<版>...` 配下へ解決されていれば正しい。リポジトリ内のソースへ解決される場合は、何かが workspace のソースを読んでいる。

### 3. 型検査を通す

```sh
cd packages/spirits && bun run check
```

ホストの公開型が変わっていれば、その差分を src と test の実型に反映する。型を通すために assertion を緩めたり、型を `unknown` に潰したりしない。

### 4. `PINNED_PI` を更新する

`packages/spirits/src/constants.ts` の `PINNED_PI` (版、artifact 名、sha256、overlay 版) を同じ版に更新する。artifact の sha256 は公式配布物から取る。配布物の実体が変わっていないことが確認できなければ更新しない。

### 5. 拡張 bundle と manifest を再生成する

```sh
bun scripts/build-managed-pi-inputs.ts --version <spirits の版> --out dist
```

`dist/spirits-managed-pi-extension.js` と `dist/spirits-managed-pi-manifest.json` (+ `.sha256`) ができる。manifest の `pi.version` と `pi.artifact.sha256` が 4. の固定値と一致することを確認する。ビルドは `packages/spirits/tsconfig.json` を使い、host の externals は `HostDescriptor.extensionExternals` (`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`) を外部のまま残す。

### 6. 公式 artifact の互換性を実測する

公式モードは 5. のビルド出力をそのまま入力にする。`--inputs` を渡すと manifest が bundle とホスト artifact のピンを兼ねるため、`--bundle-version` は manifest の値から取られる。

```sh
bun scripts/managed-pi-compat/run.ts \
  --inputs dist \
  --artifact-root <公式 tarball を置いたディレクトリ> \
  --commit HEAD \
  --out /tmp/compat/result.json
```

完了確認は結果の `Compatibility met` が真、`failed` が 0 件、`not-run` が成功として扱われていないこと。`--host` は「別ビルドのホストを差し替えて動かす」モードで、固定成果物の互換性の証拠にはならない (`mode` が `substituted-host` として記録される)。単体での bundle 指定が必要な場合は `--bundle <path>` を明示する。

### 7. ビルドした起動役を対話起動で確認する

```sh
bun scripts/build-binaries.ts --version <spirits の版>
scripts/tmux-verify.sh run --session upgrade -- <ビルドした dist/spirits-linux-x64>
scripts/tmux-verify.sh check
```

確認するものは、spirits のヘッダ (アートと `spirits v<版>`)、`/spirits-clear` が会話境界を切ることを、`tsrepl` が実際に呼ばれてセルの値が返ること、`/spirits-role status` が表示されること。`tmux-verify.sh check` が `clean` (終了コード 0) で終わることまでが手順で、セッションを放置したままにしない。

 pane が 80x24 のままだとヘッダがスクロールして消える。`session=` が出力された直後に `tmux resize-window -t "=<セッション名>" -x 200 -y 60` してから capture すると、ヘッダと起動時の一覧が同時に映る。

### 8. 全体の検査とテストを通す

```sh
bun run check
cd packages/spirits && bun test
```

`bun run check` は biome、`scripts/` の tsc、`packages/spirits` の tsc を**書き換えずに**通す。書き換えは `bun run fix` でする。

### 9. 固定値と文書を更新する

`PINNED_PI`、`docs/spirits-host-upgrade.md` (本書の固定値)、`docs/spirits-design.md` の固定版、`docs/spirits-managed-pi.md` の互換マトリクスを実測結果で更新する。

## 失敗時の中止

- 2〜8 のいずれかで失敗したら、`packages/spirits/package.json` と `PINNED_PI` の変更を戻す。中途半端なピンだけを残すと、次以降の実測がどの版に対して取られたか分からなくなる。
- `bun.lock` を更新した場合は、依存の移動がホストのピン (`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、推移的に入る `@earendil-works/pi-ai`、`typebox`) の移動を伴っていないかを `scripts/check-lockfile-commit.mjs` が報告する。意図した移動だけを `PI_ALLOW_LOCKFILE_CHANGE=1` でコミットする。
- 互換性ランナーで `failed` が出た場合は、ホスト側 API の変化である。実装で塞ぐか判断して、判断を design の D 節に追記する。`not-run` を以て成功とはしない。

## 旧版の利用者への注意

0.7.x までの `spirits update` は拡張更新の引数を受け付けていた。現行は自己更新形 (`update`、`update self`、`update pi`、`update --self` に `--force` と trust フラグを付けた形) だけを受け付け、`spirits update --all` は案内して非ゼロで終了する。**旧版からの移行は `spirits update` を使ってください**。

ホストと拡張 bundle は spirits のリリースに従うので、`spirits update` がそのままホストの更新でもある。host 側の package と model catalog を更新するのは host 実行ファイル自身である。

```sh
spirits managed-pi update                                # 実行ファイルを変えずに pinned の一式を更新
~/.spirits/managed-pi/current/pi/pi update --extensions  # host の package と model catalog
```

`spirits -- update ...` や `spirits install` / `spirits list` は host に届かない。起動役が拡張 bundle を常に先に渡すため、host はそれを model への prompt として扱い、コマンドとしては dispatch しない (Pi 1.5.0 で実測)。host のコマンドを打つときは必ず host 実行ファイルを指定する。

## Rollback

Rollback は「古い spirits 実行ファイルをもう一度走らせる」ことで行う。agent dir のデータは消さない。

### 1. 導入済みバイナリを退避する

```sh
cp -a ~/.spirits/bin ~/.spirits/bin-backup-$(date -u +%Y%m%dT%H%M%SZ)
```

`~/.spirits/bin` にあるのは `spirits` (と旧版が置いた `theme/`) だけなので、退避は安い。初回 managed 起動前に作られたバックアップは `~/.spirits/backups/agent-<UTC 時刻>/` にある。

### 2. 直前のリリース資産に戻す

最新版へ更新して失敗した場合は、直前の spirits リリースの実行ファイルに戻す。`spirits-v0.7.2` は現行構成の直前のリリースで、実行ファイル・拡張 bundle・manifest・互換用テーマ資産が揃っている。

```sh
VERSION=0.7.2 curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
# または成果物を直接確認して置く
gh release download spirits-v0.7.2 --repo betiz0/spirits --pattern 'spirits-linux-x64*' --dir /tmp/rollback
(cd /tmp/rollback && sha256sum -c spirits-linux-x64.sha256)
mv /tmp/rollback/spirits-linux-x64 ~/.spirits/bin/spirits && chmod 755 ~/.spirits/bin/spirits
```

その版に合う managed の一式が未導入なら、その実行ファイルが同じ規則で取得する (`spirits managed-pi install`、または初回起動時の自動取得)。一式を強制的に作り直すときは `spirits managed-pi repair`。

### 3. フォークEra の実行ファイルが必要なとき

ホストではなくフォークを動かしたい場合は、フォークを最後に含んだコミット `spirits-fork-final` からビルドする。このブランチには Pi のソースツリーがあるので、依存導入はルートの `npm ci --ignore-scripts` が必要になる。

```sh
git worktree add /tmp/spirits-fork spirits-fork-final
cd /tmp/spirits-fork
npm ci --ignore-scripts
bun scripts/build-binaries.ts --version 0.7.2-fork
```

できた `/tmp/spirits-fork/dist/spirits-linux-x64` を `~/.spirits/bin/spirits` に置けば、その実行ファイルはフォーク経路で動く。フォーク Era の実行ファイルは `~/.spirits/agent` をそのまま使い、managed の一式とは干渉しない。作業が終わったら worktree を削除する。

### 4. データを戻す

- 設定・セッション・認証は `~/.spirits/agent` にある。managed 経路も同じディレクトリを使うので、Rollback では消えない。
- 初回 managed 起動の前に取ったバックアップは `~/.spirits/backups/agent-<UTC 時刻>/`。リストアは `cp -a` で中身を戻す。
- `~/.spirits/managed-pi` を削除すると導入済みのホスト一式だけを削除する。`~/.spirits/agent` は残る。

## 廃止した手順

- **上流マージ**: 旧 `docs/spirits-upstream-sync.md`（削除済み）が記述していた上流との merge は行わない。ホストは配布物を差し替えるだけで、差分の移植は存在しない。
- **コア差分の管理**: 旧 `docs/spirits-core-diffs.md`（削除済み）が追跡していた Pi 本体への差分は廃止し、必要だった挙動は拡張 API と `piConfig.name` の overlay で実現する。差分の履歴は git 側に残る。
- **モデルデータの hydrate**: `scripts/generate-models.ts` 系のモデルデータ生成は、Pi のソースツリーとともに削除した。モデル catalog はホストの配布物が持つ。
- **`SPIRITS_ROUTE=fork`**: 廃止した。設定してもフォークは起動しない。単一の managed 経路のみである。
- **ホスト型の書き写し**: 手写しの `.d.ts` とその検査スクリプトは廃止した。型検査は devDependencies の公式パッケージの宣言に対する `tsc --noEmit` に一本化した。

## 実測の記録

- 固定ホスト: Pi 1.5.0 (`@earendil-works/pi-coding-agent`)。
- managed の一式: 58,876,253 バイトの公式 tarball を展開し、導入後は 182 MB。
- 互換性ランナー公式モード: `Compatibility met` 真、`confirmed=38`、`failed=0`、`not-run=3`。
- `spirits -- --version` は `1.5.0` を返す。
- 旧版 `spirits-v0.7.2` の実行ファイルは、検証用の配信元を `SPIRITS_API_BASE_URL` / `SPIRITS_RELEASE_BASE_URL` で指すと 0.7.99 への自己更新と managed の一式の導入に成功した (終了コード 0)。
