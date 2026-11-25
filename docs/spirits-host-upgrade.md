# ホスト (公式 Pi) の版更新手順

spirits は Pi を内包しない。実行時に使うホストは `~/.spirits/managed-pi` に導入した**公式 Pi の固定 artifact** で、spirits 側が固定しているのは次の 3 種類だけである。

| 固定値 | 場所 | 意味 |
| --- | --- | --- |
| 型検査に使うホストの型 | `packages/spirits/package.json` の devDependencies `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` | `tsc --noEmit` が拡張を検査する相手。実行時ではなく検査時にだけ効く |
| 導入する artifact の版・名前・sha256・overlay 版 | `packages/spirits/src/constants.ts` の `PINNED_PI` | managed の一式が展開する公式配布物の実体 |
| ホスト固有の形 | `packages/spirits/src/managed-pi/host.ts` の `HostDescriptor` | 実行ファイル名、bundle のロード引数、ホストが読む環境変数名、host が第一引数で dispatch するコマンド語 |

版の更新とは、この 3 か所を同じ版にそろえて、実測で裏を取ることである。フォーク時代のような上流マージは存在しない。

## 更新手順

手順 2〜10 のいずれかが失敗したときは**そこで中止し、固定値をコミットしない**。コマンドは特に注記が無い限りリポジトリルートで実行する。

### 1. 対象の公式 Pi の版を決める

`@earendil-works/pi-coding-agent` の公開版から選ぶ。spirit のリリースタグ (`spirits-v*`) とホストの版は別物で、1 つの spirits リリースが 1 つのホスト版を指す。

候補の門 (すべて真の版だけを対象にする):

- 公式リリースとして公開済みで、対象 platform の配布物がリリースに並んでいる
- その配布物の SHA256 がリリースの `SHA256SUMS` に在る
- `@earendil-works/pi-coding-agent` と `@earendil-works/pi-tui` の対象版が両方 npm に公開済み
- 両型パッケージの公開から `bunfig.toml` の `[install] minimumReleaseAge` (172800 秒 = 48 時間) が過ぎている

門の確認コマンド (リポジトリルート。`--json` の `publishedAt` と `assets`、npm の `time["<版>"]` を読む。ビルド済み配布物の SHA256 はリリースの `SHA256SUMS` から取り、4. で実照合する):

```sh
gh release view v<版> --repo earendil-works/pi --json name,publishedAt,assets
curl -fsS https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent | grep -o "\"<版>\":\"[^\"]*\""
curl -fsS https://registry.npmjs.org/@earendil-works%2Fpi-tui | grep -o "\"<版>\":\"[^\"]*\""
```

 経過時間は `bunfig.toml` の `[install] minimumReleaseAge` (秒) と比べ、過ぎていない版は対象にしない。

候補を棄却した場合は、**採用の表と同じ書式で棄却の行を残す** (固定値は一切変更しない):

| 記録する値 | 棄却の例 |
| --- | --- |
| 棄却した版 | `1.6.1` |
| 満たさなかった条件 | 経過時間の門 (下記 3 パターンのいずれか 1 つ) |
| 欠けていたもの | 対象 platform の配布物名、または未公開の型パッケージ名 (両者は別名で併記する) |
| 実測した値 | `publishedAt` / `time["<版>"]`、`SHA256SUMS` の該当有無、門の残り秒数 |
| 処置 | 固定値を変更せず停止。対象版は据え置き、次版は別の計画で選定し直す |

 3 パターンの判定は次のとおり。

 - **経過時間の門**: 型パッケージの `time["<版>"]` から 172800 秒を引いた残りがある間は棄却。片方だけ門を過ぎている場合は、過ぎていない方の名前を書く。
 - **`SHA256SUMS` に配布物が無い**: `grep 'pi-linux-x64.tar.gz' SHA256SUMS` が空、またはリリースに `pi-linux-x64.tar.gz` 自体が並ばない。欠けている配布物名を書く。
 - **型パッケージが揃わない**: `curl -fsS` の JSON に `<版>` の key が無い方を名指す。両方無い場合は両方書く。

 棄却した候補の SHA256 を `PINNED_PI` に書き写さない。門の判定は上の 3 コマンドの出力から行い、「新しいらしいから」で進めない。

選定した版は 1 つの変更の中で固定する。実測中に新しい適格な stable が出ても、進行中の変更の対象版は動かさず、別の計画として選定し直す。
**本次元の対象版: 1.6.0 (固定)**。

本次元の実測 (2026-11-25T04:34Z、`api.github.com` と `registry.npmjs.org`):

| 記録する値 | 実測値 |
| --- | --- |
| リリース `v1.6.0` の公開日時 | `2026-11-20T11:35:03Z` |
| `pi-linux-x64.tar.gz` | 58,977,130 バイト |
| リリース `SHA256SUMS` の `pi-linux-x64.tar.gz` | `ef77dbe4379b3bdeb425a1e1b862fa3c915c255000dfe4965c98eee96a5765d1` |
| `@earendil-works/pi-coding-agent@1.6.0` 公開日時 | `2026-11-20T11:09:15.529Z` |
| `@earendil-works/pi-tui@1.6.0` 公開日時 | `2026-11-20T11:04:11.247Z` |
| 門の判定 (`minimumReleaseAge` 172800 秒) | 経過 約 113.4 時間 / 約 113.5 時間 → **門を過ぎている (真)** |

### 2. 型の pin を更新する

`packages/spirits/package.json` の devDependencies を対象の版へ**完全一致**で更新し、`packages/spirits` で `bun install` する。ルートにも同じ名の workspace があるため、解決先がインストール済みの公式パッケージであることを実測で確認する (`import.meta.resolve` をリポジトリルートや `/tmp` から叩くと別の解決結果が見えることがあるので、必ず `packages/spirits` の中で確認する)。

```sh
cd packages/spirits
bun install --save-exact --ignore-scripts
```

`--ignore-scripts` は必須 (依存のライフサイクルスクリプトを実行させない)。このリポジトリはクリーンインストールも CI も `bun install --frozen-lockfile --ignore-scripts` で走るため、`--ignore-scripts` を外した手順は CI と違う経路になる。

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

### 4. 公式配布物を取得して `SHA256SUMS` と照合する

リポジトリの外の作業ディレクトリ (例 `/tmp/pi-artifacts`) に、対象リリースの Linux x64 配布物とリリース本文の `SHA256SUMS` を落とす。ここは git の管理外で、後手順の artifact ルートとして使う。

```sh
cd /tmp/pi-artifacts
gh release download v<版> --repo earendil-works/pi --pattern 'pi-linux-x64.tar.gz' --pattern 'SHA256SUMS'
sha256sum pi-linux-x64.tar.gz
grep 'pi-linux-x64.tar.gz' SHA256SUMS
```

完了確認は 2 つの SHA256 が一致すること。一致しなければここで中止する (`PINNED_PI` は触らない)。この照合済みの配布物だけを、次の手順の SHA256 実測の入力にする。リリース本文に書かれた値や npm の tarball の digest は代用にしない。

### 4b. overlay の SHA256 を実測して `PINNED_PI` を更新する

`packages/spirits/src/constants.ts` の `PINNED_PI` (版、artifact 名、sha256、overlay 版、overlay sha256) を同じ版に更新する。2 つの SHA256 はどちらも 4. の配布物から実測する。

- `artifactSha256` は 4. で照合した tarball そのものの digest。
- `overlaySha256` は、**展開した `pi/package.json` から生成する overlay `package.json` の本文の SHA256** である (`overlay.ts` の `createOverlayPackageJson` が返す `sha256`。ディレクトリやツリーの digest ではない)。生成は product と同じ実関数で行う。

```sh
# リポジトリルート。4. で照合した tarball を展開し、overlay.ts の実関数で本文の digest を実測する
rm -rf /tmp/pi-artifacts/extracted && mkdir -p /tmp/pi-artifacts/extracted
tar -xzf /tmp/pi-artifacts/pi-linux-x64.tar.gz -C /tmp/pi-artifacts/extracted
cat > /tmp/measure-overlay.ts <<'TS'
import { readAndCreateOverlay } from "<repo>/packages/spirits/src/managed-pi/overlay.ts";
const overlay = await readAndCreateOverlay("/tmp/pi-artifacts/extracted/pi");
console.log(JSON.stringify({ version: overlay.version, sha256: overlay.sha256 }));
TS
bun /tmp/measure-overlay.ts
```

 実測した `sha256` を `PINNED_PI.overlaySha256` へ書き、`packages/spirits/package.json` を書き換えた後のビルド成果物や、tarball と違うディレクトリから取った digest は使わない。overlay 版は `<host 版>-spirits.<n>` のまま、適用する overlay の内容 (HostDescriptor の identity) が変わらなければ `n` を上げない。実測せずに書き写した digest は導入時の検証 (`writeOverlayPackage` の期待値照合) で落ちる。

### 5. 拡張 bundle と manifest を再生成する

```sh
bun scripts/build-managed-pi-inputs.ts --version <spirits の版> --out dist   # リポジトリルート
```

`dist/spirits-managed-pi-extension.js` と `dist/spirits-managed-pi-manifest.json` (+ `.sha256`) ができる。manifest の `pi.version` と `pi.artifact.sha256` が 4. の固定値と一致することを確認する。ビルドは `packages/spirits/tsconfig.json` を使い、host の externals は `HostDescriptor.extensionExternals` (`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`) を外部のまま残す。

### 6. 公式 artifact の互換性を実測する

公式モードは 5. のビルド出力をそのまま入力にする。`--inputs` を渡すと manifest が bundle とホスト artifact のピンを兼ねるため、`--bundle-version` は manifest の値から取られる。

```sh
# リポジトリルート。--artifact-root には 4. で照合した tarball を置いたディレクトリを渡す
bun scripts/managed-pi-compat/run.ts \
  --inputs dist \
  --artifact-root /tmp/pi-artifacts \
  --commit HEAD \
  --out /tmp/compat/primary/result.json
```

完了確認は結果の `Compatibility met` が真、`failed` が 0 件、`not-run` が成功として扱われていないこと。`--host` は「別ビルドのホストを差し替えて動かす」モードで、固定成果物の互換性の証拠にはならない (`mode` が `substituted-host` として記録される)。単体での bundle 指定が必要な場合は `--bundle <path>` を明示する。

この実測は **一次** (作業ツリー) である。結果 JSON の `commit` は来歴として記録されるだけで、`--commit` はその commit から bundle をビルドしないため、作業ツリーのまま走らせた実行は「対象 commit の bundle での実行」の証拠にならない。利用者にコミットを依頼した後は 10. で同じコマンドを再生成した bundle と一緒に再実行し、その結果 JSON のパスを証拠として残す。一次の結果は捨てずにパスを並べて記録する。

`Compatibility met` の読み方には落とし穴がある。ランナーの定義では role / `/clear` / model のマトリクス行は「1 つでも目的が観測されれば confirmed」で、何個観測できたかは本文の行数にしか出ない。また `host-upgrade` の側は `confirmed` か `limited` を成功と数えるが、`managed-pi-compatibility` と実装は必須観測の `confirmed` を要求する。本変更は実装と同じ `Compatibility met` を正とし、この食い違いは直さない。判定の根拠として、必須観測の確認状況 (`## Required observations not confirmed` が `none` であること) と `not-run` の各行を必ず読む。

### 7. ビルドした起動役を対話起動で確認する

```sh
# リポジトリルートでビルドし、検証用版が出ることを確認する
bun scripts/build-binaries.ts --version <検証用の spirits 版>
dist/spirits-linux-x64 --version
# 一式が対象版であることは別コマンドで確認する (隔離 HOME で実行)
env -i PATH=/usr/bin:/bin HOME=<iso> dist/spirits-linux-x64 -- --version   # → <対象の Pi 版>
```

#### 7 の前提条件

- **一式を隔離環境に据える**。実 HOME と実 `~/.spirits` は触らない。隔離 HOME (`/tmp/<iso>`) に `installManagedSet` を呼んで `<iso>/.spirits/managed-pi` を作り、`manifest.json` の `extension.artifact` と `installed.json` の digest が 5. の bundle を指るようにする。検証用版を実リリースから取りに行かせない (配信元がまだ無い版なら 404 で落ちる)。一時スクリプトで tarball と bundle を loopback HTTP で配信し、製品自身の導入手順 (取得・SHA256 検証・展開・overlay・記録) を通すこと。
- **agent dir と session dir の引き継ぎを断つ**。`HOME` を隔離しても `SPIRITS_CODING_AGENT_DIR` などの指定が親から残るとそちらが勝つ。pane 内のコマンドは `env -i PATH=/usr/bin:/bin HOME=<iso> TERM=xterm-256color <起動役>` の形で環境を立て直す (tmux は pane にサーバ側の環境しか渡さないので、run を起動する側にも同じ `env -i` を掛ける)。
- **ネットワークを要求しない provider** を隔離環境の**実際の agent dir** (`<iso>/.spirits/agent`) の `models.json` に用意する。managed agent dir に置いても読まれない。ローカルの OpenAI 互換エンドポイント (リポジトリの `scripts/managed-pi-compat/fake-provider.ts` の `startFakeProvider` がそのまま使える) に `models.json` / `auth.json` / `settings.json` (`defaultProvider` / `defaultModel`) を組で置く。
- **tmux の設定**は隔離 HOME の `~/.tmux.conf` に `set -g extended-keys on` と `set -g extended-keys-format csi-u` を書く。既定の `xterm` では `ctrl+alt+p` の修飾キーがホストに届かず、折りたたみキーが効いていないように見える。実 HOME の tmux 設定と既存サーバは触らないため、`TMUX_TMPDIR=<iso>/tmux` で別のサーバを立てる。
- **待ち時間は上げる**。`run` の stage 1 の既定は 180 秒で、対話操作が間に合わないと session を kill して 124 で終わる。`<iso>/.config/spirits-verify/config` に `TIMEOUT_SECONDS=900` を書いてから `run` するか、`extend --session <name> --seconds <n>` で延ばす。

#### 7 の実行手順

`<repo>` はリポジトリルートの絶対パス。`run` は作業ディレクトリを移したところで呼ぶため、スクリプトは**必ず `<repo>` 付きの絶対パス**で指定する (相対パスだと `<作業用ディレクトリ>/scripts/tmux-verify.sh` を探して起動しない)。状態置き場も隔離先に固定し (`SPIRITS_VERIFY_STATE_DIR`)、後の `check` も同じ値で呼ぶ。

```sh
iso=<iso>; repo=<repo>; state=<iso>/verify-state; port=<検証に空けられるポート>
mkdir -p "$state" "$iso/tmux"
cd <作業用ディレクトリ>          # 信頼ダイアログを出す Project dir にしない (一時ディレクトリ)
setsid nohup env -i PATH=/usr/bin:/bin HOME=$iso TMUX_TMPDIR=$iso/tmux TERM=xterm-256color \
  SPIRITS_VERIFY_STATE_DIR=$state \
  bash "$repo/scripts/tmux-verify.sh" run --session upgrade --port $port -- \
  env -i PATH=/usr/bin:/bin HOME=$iso TERM=xterm-256color $repo/dist/spirits-linux-x64 \
  > /tmp/verify-run.log 2>&1 < /dev/null &
echo "run-exit=$?" >> /tmp/verify-run.log
```

1. `session=` が出たら待つ前に resize する: `tmux -S <iso>/tmux/tmux-$(id -u)/default resize-window -t <セッション名>:0 -x 200 -y 60`。 pane が 80x24 のままだとヘッダがスクロールして消える。
2. 下の確認項目を **同じ pane で全て** 終える (`run` は pane の終了まで回収しないので、先に `check` を通すと同じ pane を使えない)。
3. `/quit` で pane を終わらせる。ホストの終了コマンドは `/quit` で、`/exit` は 1.6.0 では model への入力として扱われる (実測: `/exit` がプロンプトとして送信され、セッションは生きたまま残った)。効かなければ `C-d`。
4. `run` の回収を待つ (`run` は残留が無く正常終了なら何も出さず 0 で終わる。背景起動なので `echo run-exit=$?` を仕込んで終了コードを読む)。
5. 回収の確認は `SPIRITS_VERIFY_STATE_DIR=$state bash "$repo/scripts/tmux-verify.sh" check --session <セッション名>` が `clean` (終了コード 0) であること。**`check` は tmux の session・プロセス・一時ディレクトリの残留の判定であり、画面内容の合否ではない**。画面の合否は 2. の各観測で取る。

 回収の証拠は次の 3 点セットで残す。`run` と `check` を**同じ `SPIRITS_VERIFY_STATE_DIR`** で呼ぶこと (`check` は既定の状態置き場に記録が無いと `clean` と出力して終了コード 0 になるため、`--session` 無しや別の状態置き場での `clean` は証拠にならない)。`run --port <port>` でポートを予約すること (`check` は `run` が記録したポートしか検査しないので、予約していないポートの非 listen は別の確認が要る)。そして `ss -ltn` などで予約ポートが listen していないこと。モデル警告の観測 (下の 3 通り) は**別の run** で起動し、それぞれの run を 3.〜5. で回収する。

#### 7 の確認項目

| 確認 | 画面に出るもの |
| --- | --- |
| 起動 art と版 | ヘッダのアートと `spirits v<検証用版>`。同じ一式で `spirits -- --version` が対象の host 版を返すこと (別コマンドで実測) |
| 会話境界 | `/spirits-clear` で `conversation cleared from the model context`。前後の応答で、clear 前の語が後続のリクエストに乗っていないことを provider 側のリクエスト本文でも確認する (画面だけの合判定にしない) |
| tsrepl のセル実行 | 会話から `tsrepl` が呼ばれ、`[value]` とセルの値が画面に出る |
| role 一覧と badge | `/spirits-role` の一覧の行順 (`save` / 空行 / `role lock` / `normal model` / `normal thinking` / `strong model` / `strong thinking` / 各 step)、選択行の追従、role lock を変えたときに status line の badge (`[normal …]` ↔ `[strong …]`) が変わる。badge を見るのは routing が立っている状態で `/model` から `spirits/auto` を選んだあと |
| TODO と折りたたみ | `manage_todos` で追加した TODO の展開行 (`○ #1 …`) と、`ctrl+alt+p` (既定の `todo.toggleKey`) での集約行 (`1 pending`) と、もう一度押しての展開 |
| モデル選択の警告 | 下記 3 点 |

モデル警告は 3 通りを別々の起動で見る。

- `spirits/auto` を既定 (`settings.json` の `defaultProvider=spirits` / `defaultModel=auto`、かつ `models.normal` が解決できる) にした起動では警告行が出ない。
- `--models '<当たらないパターン>'` を添えた起動では `Warning: No models match pattern "…"` が **起動時に 1 回だけ** 出る。
- その session で `/new` 置き換えても同じ警告が再掲されないこと (`✓ New session started` の後に警告行が現れない)。1.6.0 は診断を `takeUnreportedDiagnostics()` で起動時と session 置換後に 1 回ずつ報告し、`type` と `message` が既出のものは出さない。

 既定を `spirits/auto` にして `models.normal` を置いていないと、badge は `[!]` になり context 表示は `0.0%/0` になる (pi 既定が仮想モデルなので normal が解決できない)。これは routing の未解決の表示で、ホストの警告行とは別物として読む。

### 7b. `commandWords` を新しい版の実際の CLI と照合する

`HostDescriptor.commandWords` は「ホストが自己的第一引数でだけ dispatch する語」の一覧で、起動役はこの語を拒否して host 実行ファイルを案内する。これは**バージョンとともに変わる値**で、型 pin や `PINNED_PI` からは決まらない。版を上げるときは、1. で展開した host artifact 自身の `--help` と照合する。

```sh
<一式の host 実行ファイル> --help     # ~/.spirits/managed-pi/current/pi/pi
```

`--help` 自体は network も agent dir の書き換えもしないが、`HOME` は隔離したものを使う (`--help` の中で model catalog の更新や設定の初期化をしない)。

- 表に出るコマンド語と `OFFICIAL_PI_HOST.commandWords` を突き合わせ、増えた語を追加し、消えた語を削除する。語表を変えたら 5. と 7. をやり直す (語表は起動役と manifest に焼き込まれるため、`bun scripts/build-managed-pi-inputs.ts` と `bun scripts/build-binaries.ts` の再生成が要る)。語を足した場合は `spirits <word>` が拒否になる利用者に見える変化を、語を除いた場合は拒否から model への入力へ移る利用者に見える変化を、この節の記録に残す。
- 各語について `spirits <word>` が拒否されることと、`<host> <word>` がコマンドとして動くことを両方確認する。1 語でも不一致があれば 7. に戻る。
- 判定が難しい語は host の `--help` の usage 行と `spirits <word>` の実測 (拒否か model prompt か) を根拠に書く。

理由: 語を**足し忘れる**と正当な model への入力を拒否し、**忘れる**と `spirits <word>` が `-e <bundle> <word>` として host に渡り、model turn と session が残る (Pi 1.5.0 で実測)。`update` はこの一覧に含めない。起動役自身が自己更新か拒否かを分類するため (`src/update/classify.ts`)、host の `update` は host 実行ファイルで打つ。

語ごとの実測は network に触れない形で取る。`<host> <word>` は引数なしでは usage か対話画面で止まるので、`</dev/null` と `timeout` を付け、出力の先頭数行と終了コードを記録する (command として dispatch さえていればよい。model への prompt になるのは不一致)。`config` のように対話 UI を開く語は、usage 行が出ない代わりに TUI の escape sequence が並ぶので、「コマンドとして dispatch された」根拠として usage 行か画面出力かを区別して書く。

### 7c. 自己更新経路を検証する (python3 と network を要求する)

直前のリリースの実行ファイルから検証用配信元へ `spirits update` を走らせ、新しい起動役への置換と、同じリリースの manifest / bundle の managed root への導入を確認する。

```sh
sh scripts/self-update-smoke.sh <old-bin> <new-bin> <検証用版> [manifest] [bundle]
```

- `<old-bin>` は直前のリリース (`spirits-v<直前版>`) の `spirits-linux-x64`、`<new-bin>` は本次元でビルドした `dist/spirits-linux-x64`。検証用版は直前版より大きく、起動役・bundle・manifest が組で揃ったものにする。
- manifest の Pi artifact は公式 earendil-works/pi リリースの絶対 URL なので、この smoke は network 経由で実 tarball を落として manifest の checksum と照合する。
- 完了確認は終了コード 0 と、実行した環境 (host・network の有無) の記録。

 この smoke は検証用配信元に `python3 -m http.server` を使う。python を実行できない環境 (LLM セッションなど) では **実行せずに未実行として記録し、結果の受領までこの手順は合格にしない**。

### 8. 全体の検査とテストを通す

```sh
bun run check
cd packages/spirits && bun test
bash scripts/test-clean-env.sh
```

`bun run check` は biome、`scripts/` の tsc、`packages/spirits` の tsc を**書き換えずに**通す。書き換えは `bun run fix` でする。`scripts/test-clean-env.sh` は CI と同じく `PI_*` / `SPIRITS_*` の無い環境で check / test / install / tmux-verify の 4 suite を順に走らせる。install と tmux-verify の suite は `python3 -m http.server` を要求するので、python を実行できる環境でしか走らない。走らなかった範囲はスキップとして列挙し、成功に数えない。

### 9. 固定値と文書を更新する

実測した版・サイズ・件数を、次の文書から更新する。1 箇所の修正で済む値ではないため、検索して残りを潰す。

| 文書 | 更新するもの |
| --- | --- |
| `docs/spirits-host-upgrade.md` | 本書の固定値と「実測の記録」 |
| `docs/spirits-design.md` | 固定しているホストの版、`-- --version` の実測値、command 語の根拠 |
| `docs/spirits-managed-pi.md` | 対応 set (版・SHA256) と互換の状況 |
| `docs/spirits-default-launch.md` | 初回起動の tarball サイズ・導入後の容量・戻し方 |
| `README.md` / `README.ja.md` / `README.zh.md` / `README.de-CH.md` | tarball のサイズと導入後の容量 (4 言語すべて) |

残りの確認は目視ではなく検索コマンドで取る (0 件が合格):

```sh
rg -n "<旧の host 版>|<旧 tarball のサイズ>|<旧 artifact SHA256>" \
  README.md README.ja.md README.zh.md README.de-CH.md \
  docs/spirits-host-upgrade.md docs/spirits-design.md docs/spirits-managed-pi.md docs/spirits-default-launch.md
rg -n "1\.5\.0" packages/spirits/src packages/spirits/test
```

 2 件目の検索は、`packages/spirits/test/fixtures/architecture/**` の fixture リテラルと「1.5.0 で観測した」と明記した歴史的注記だけが残ってよい (design D5)。

 また、日本語の語を中国語簡体字で書いた字形 («隔離» を簡体で書いた語、«証拠» を簡体で書いた語、«失敗» を簡体で書いた語) が混ざっていないかを、エディタ側の検索で確認する。検索コマンドに字形そのものを書くと自分の行に当たるため、本書のコマンドには載せない。

`docs/spirits-managed-pi-design.md`、`docs/spirits-upstream-issues.md`、`docs/agent-data-compat/` は**その版で観測した一次資料として残す** (新しい版の写しに書き換えない)。上の検索にもこれらを含めない。

### 10. 承認済み commit から正式に再測定する

1〜9 が揃った状態で利用者にコミットを依頼し、その SHA を記録する (`bun.lock` を含むコミットになる)。その後、**その commit から** bundle と起動役を再生成して 6. と同じコマンドを `--commit <その SHA>` で実行する。

```sh
git rev-parse HEAD
bun scripts/build-managed-pi-inputs.ts --version <spirits の版> --out dist
bun scripts/build-binaries.ts --version <spirits の版>          # 起動役も同じ commit から再生成
bun scripts/managed-pi-compat/run.ts --inputs dist --artifact-root /tmp/pi-artifacts --commit <その SHA> --out /tmp/compat/final/result.json
```

 再生成は**承認された commit の作業ツリー**で行う (`git status` が clean であること。dirty のまま生成すると、一次の実測と区別できない)。

完了確認は `Compatibility met` が真、`failed` が 0 件、`not-run` が成功として扱われていないこと、結果 JSON の来歴 (`commit`) が 10.1 の SHA と一致すること。一次と正式の 2 つの結果 JSON のパスが「実測の記録」に並ぶまで、この更新は**完了として扱わず**、OpenSpec の archive も行わない。

## 失敗時の中止

- 2〜9 のいずれかで失敗したら、`packages/spirits/package.json` と `PINNED_PI` の変更を戻す。中途半端なピンだけを残すと、次以降の実測がどの版に対して取られたか分からなくなる。
- 10. の正式な再測定が失敗した場合は、コミット済みの中身を戻す操作にはしない (コミットは利用者の承認済みである)。リリースと OpenSpec の archive を行わず、失敗内容と取り得る手段 (修正の再承認で続行 / 本変更の差し戻し) を利用者に報告して判断を受ける。
- `tsc` による型検査 (3.)、公式配布物の `SHA256SUMS` 照合 (4.)、公式 artifact での互換性実測 (6.) が失敗した場合は**そこで中止し、固定値をコミットしない**。
- python3 と network を要求する検証 (7c. と 8. の install / tmux-verify suite) は、それらを実行できる環境で走らせ、終了コード 0 の記録を受け取るまで合格として扱わない。受け取れない間は未実行としてタスクに残す。
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

### 2. 実行ファイルと一式を同じリリースから戻す

実行ファイルだけ戻して終わらせない。`spirits managed-pi repair` は導入済み set の `manifest.json` を基準に再取得し、通常の起動も検証を通った既存の `current` を使うため、**新版の `current` を残したまま旧バイナリを走らせると新版の一式を再導入し得る**。戻すのは起動役と managed 一式を同じリリースからにする。

取得・検証・配置・導入は**1 つの塊**で書く。検証の後に `;` で命令を並べると、検証が失敗しても次へ進んでしまう (`sha256sum -c` は非ゼロを返すだけで、次の `mv` を止めない)。

```sh
set -u
TAG=spirits-v<直前の版>
RB=/tmp/rollback-<直前の版>
rm -rf "$RB" && mkdir -p "$RB"
gh release download "$TAG" --repo betiz0/spirits \
  --pattern 'spirits-linux-x64' --pattern 'spirits-linux-x64.sha256' \
  --pattern 'spirits-managed-pi-manifest.json' --pattern 'spirits-managed-pi-manifest.json.sha256' \
  --pattern 'spirits-managed-pi-extension.js' --pattern 'spirits-managed-pi-extension.js.sha256' \
  --dir "$RB"

# 検証が通るまで既存のファイルを一切差し替えない。1 件でも失敗したらここで終わる。
(
  cd "$RB" &&
  sha256sum -c spirits-linux-x64.sha256 &&
  sha256sum -c spirits-managed-pi-manifest.json.sha256 &&
  sha256sum -c spirits-managed-pi-extension.js.sha256
) || { echo "Rollback を中止した: SHA256 の検証が失敗した。配置も導入もしていない。" >&2; exit 1; }

cp "$RB/spirits-linux-x64" ~/.spirits/bin/spirits && chmod 755 ~/.spirits/bin/spirits
```

manifest と bundle はそのまま置いても効かない。導入済みの一式を作り直す。このときは**検証した manifest を明示する** (`SPIRITS_MANAGED_PI_MANIFEST_URL`)。付けると install は manifest のあるディレクトリを相対 asset の base URL にするので、同じディレクトリの検証済み bundle がそのまま使われ、親環境に residual に残った配信元設定にも左右されない。`--version` は manifest が pins する Pi 版と照合され、違えば理由を表示して非ゼロで止まる。

```sh
SPIRITS_MANAGED_PI_MANIFEST_URL="file://$RB/spirits-managed-pi-manifest.json" \
  "$HOME/.spirits/bin/spirits" managed-pi install --version <直前の Pi 版>
```

- 検証済み manifest の `pi.artifact.url` は公式リリースの絶対 URL なので、Pi の tarball はそこから取得し、install 内で manifest の SHA256 と照合される (bundle は manifest と同じディレクトリから検証付きで入る)。
- install は `releases/<setId>` を作り直して `current` を切り替えるだけで、**`managed-pi/agent` の設定・セッションには触れない** (隔離 agent dir を作成・変更するのは起動経路だけ)。
- 新版の set を容量ごと消したい場合は、2b. を通した**後**に `rm -rf ~/.spirits/managed-pi/releases/pi-<新版>` に限定して消す。`rm -rf ~/.spirits/managed-pi` は `agent` も `current` も一度に消すため使わない (取得が失敗すると動作する一式も残らない)。

環境変数で版を渡す install スクリプトを使う場合も、`VERSION=<ver> curl … | sh` の形にはしない (環境変数はパイプの左の `curl` にだけ掛かって、`sh` に届かない)。先に `export VERSION=<ver>` してから実行するか、上のダウンロード経路を使う。

### 2b. 戻した後に両方の版と agent dir を確認する

```sh
spirits --version            # 起動役 (spirits) の版
spirits -- --version         # 一式が指す host (Pi) の版
cat ~/.spirits/managed-pi/current/manifest.json   # pi.version と extension.version
ls "$HOME/.spirits/managed-pi/agent" 2>/dev/null  # 隔離経路の設定・セッションが残っていること
```

 起動役の版と一式の host 版が、どちらも狙ったリリースを指していることを両方で確認する。一方だけ新しい状態は Rollback 未完了である。`releases/pi-<新版>` を消すのはこの確認の後。

### 2c. 戻し方の手順を実測で確かめる (隔離 HOME)

上の塊は隔離 HOME で 3 ケース流す (`env -i PATH=/usr/bin:/bin HOME=<iso>`。親の `SPIRITS_CODING_AGENT_DIR` を残すと managed root の解決が `HOME` に勝って**実 `~/.spirits/managed-pi` に書く**ので、必ず `env -i` で立て直す)。Pi の tarball は `file://` の manifest asset に差し替えて network に触れないようにする。

| ケース | 入力 | 実測 (2026-11-25、隔離 HOME、spirits 0.8.99) |
| --- | --- | --- |
| 検証が失敗する | `spirits-linux-x64` を 1 バイト壊して `.sha256` と不一致にする | 塊は終了コード 1 で `ABORT`。`cp` も `managed-pi install` も走らず、`current` (`releases/pi-1.6.0`)・`releases`・`managed-pi/agent/settings.json` と `agent/sessions/marker.json` がすべて実行前と同一 |
| 手順どおり戻る | 検証を通った manifest / bundle を `SPIRITS_MANAGED_PI_MANIFEST_URL=file://…` で明示 | `Installed managed Pi …` (install-exit 0)。`current` が `releases/pi-1.6.0-rb` へ切り替わり、前の `releases/pi-1.6.0` もそのまま残り、`managed-pi/agent` の設定・セッションは無変更 |
| 配置後の取得が失敗する | manifest の Pi asset を存在しない `file://` へ向ける | `PLACED` の後に `Managed Pi install failed: ENOENT …`、install-exit 1。`current` は `releases/pi-1.6.0` のままで、`spirits managed-pi -- --version` は **`1.6.0`** を返し、`managed-pi/agent` の設定・セッションも残る |

 3 ケース目が示すのは「`rm -rf ~/.spirits/managed-pi` を先に入れない」理由そのものである。旧版の取得が失敗しても動作する一式と agent dir のデータが残る。

### 3. フォークEra の実行ファイルが必要なとき

ホストではなくフォークを動かしたい場合は、フォークを最後に含んだコミット `spirits-fork-final` からビルドする。このブランチには Pi のソースツリーがあるので、依存導入はルートの `npm ci --ignore-scripts` が必要になる。

```sh
git worktree add /tmp/spirits-fork spirits-fork-final
cd /tmp/spirits-fork
npm ci --ignore-scripts
bun scripts/build-binaries.ts --version 0.7.2-fork
```

できた `/tmp/spirits-fork/dist/spirits-linux-x64` を `~/.spirits/bin/spirits` に置けば、その実行ファイルはフォーク経路で動く。フォーク Era の実行ファイルは `~/.spirits/agent` をそのまま使い、managed の一式とは干渉しない。作業が終わったら worktree を削除する。

### 4. データについて

- 設定・セッション・認証は `~/.spirits/agent` にあり、Rollback でも消えない。隔離経路 (`spirits managed-pi`) の設定・セッションは `~/.spirits/managed-pi/agent` にあるため、**ここも Rollback の対象にしない**。`install` / `update` / `repair` は `releases/` と `current` だけを扱い、`agent` を作成も変更もしない。
- 初回 managed 起動の前に取ったバックアップは `~/.spirits/backups/agent-<UTC 時刻>/`。リストアは `cp -a` で中身を戻す。
- 「データが消えないこと」と「そのデータを旧版が読めること」は別の事実である。新版が agent dir に書いた形式を旧版がそのまま読めるかは本変更で実測していない (互換性ランナーは隔離 HOME と redact したコピーだけを使い、書き戻し互換は未確認のまま)。新版が agent dir に何かを書いた後の Rollback では、まず `~/.spirits/agent` をコピーしてから旧版を起動する。

## 廃止した手順

- **上流マージ**: 旧 `docs/spirits-upstream-sync.md`（削除済み）が記述していた上流との merge は行わない。ホストは配布物を差し替えるだけで、差分の移植は存在しない。
- **コア差分の管理**: 旧 `docs/spirits-core-diffs.md`（削除済み）が追跡していた Pi 本体への差分は廃止し、必要だった挙動は拡張 API と `piConfig.name` の overlay で実現する。差分の履歴は git 側に残る。
- **モデルデータの hydrate**: `scripts/generate-models.ts` 系のモデルデータ生成は、Pi のソースツリーとともに削除した。モデル catalog はホストの配布物が持つ。
- **`SPIRITS_ROUTE=fork`**: 廃止した。設定してもフォークは起動しない。単一の managed 経路のみである。
- **ホスト型の書き写し**: 手写しの `.d.ts` とその検査スクリプトは廃止した。型検査は devDependencies の公式パッケージの宣言に対する `tsc --noEmit` に一本化した。

## 実測の記録 (Pi 1.6.0)

固定した値:

| 値 | 実測 |
| --- | --- |
| ホストの版 | `1.6.0` (リリース `v1.6.0` 公開 `2026-11-20T11:35:03Z`) |
| 型の pin | `@earendil-works/pi-coding-agent@1.6.0` (公開 `2026-11-20T11:09:15.529Z`)、`@earendil-works/pi-tui@1.6.0` (公開 `2026-11-20T11:04:11.247Z`)。`minimumReleaseAge` 172800 秒の門は約 113.4 時間経過で真 |
| 公式配布物 | `pi-linux-x64.tar.gz` 58,977,130 バイト、SHA256 `ef77dbe4379b3bdeb425a1e1b862fa3c915c255000dfe4965c98eee96a5765d1` (リリースの `SHA256SUMS` と一致) |
| overlay | `1.6.0-spirits.1`、SHA256 `e0c6b589a26f3438c5b9224294b769a999fabee3eba06383fafceb68be031cd0` (照合済み tarball を展開し overlay を適用した実体から実測) |

導入 (隔離 HOME、loopback 配信):

- 導入後の容量: **182 MB** (`du -sb` で 190,287,149 バイト。set ディレクトリ = 展開した `pi/` + 置きっぱなしの `pi.tar.gz` (58,977,130 B) + `manifest.json` + `installed.json` + `spirits-extension.js`)。1.5.0 の記録と同じ 182 MB で、D8 の撤回条件の 2 割超過は無い。
- 導入時間: **2,202 ms**。測定範囲は `installManagedSet` 全体 (loopback HTTP からの取得 → SHA256 検証 → 展開 → overlay → 記録) で、実 network 経由の初回起動は含まない。
- `spirits -- --version` は **`1.6.0`** を返す。

互換性ランナー (公式モード):

- 一次 (作業ツリー、bundle 0.8.99): `confirmed=38`、`limited=0`、`unavailable=0`、`not-run=3`、`failed=0`、`Compatibility met` 真。結果は `/tmp/compat/primary/result.json` と `/tmp/compat/primary/managed-pi-compat-result.md`。
- 正式 (承認済み commit `cd94aeb6e9b55620a330d06790498632e001e279` から再生成した bundle と起動役): `confirmed=38`、`limited=0`、`unavailable=0`、`not-run=3`、`failed=0`、`Compatibility met` 真、ランタイム版 `1.6.0`、`workingTreeClean` 真。結果は `/tmp/compat/final/result.json` (一次 `/tmp/compat/primary/result.json` と同じ内訳)。両者のパスが揃うまで本更新は未完了扱いだった。
- `not-run` 3 件は 1.5.0 と同じ「観測できないもの」 (既存 agent dir への書き戻し互換、永続 settings 書き込み API、別の拡張の tool 定義を要する直接実行 probe) で、必須観測ではない。`## Required observations not confirmed` は `none`。
- role / `/clear` / model のマトリクスは **13 目的中 11 を観測**。`registerModelRoles` は 1.6.0 にも無い (`roleApi` 偽) ため、role の限定互換 (`/spirits-role` と仮想モデル `spirits/auto`) はそのまま残る。
- 互換性の成功判定は design D12 で `confirmed` 一本へ揃えた。`Compatibility met` は公式モードで**必須観測がすべて `confirmed`** のときだけ真 (ランナーの `COMPATIBILITY_MET_DEFINITION`)。`limited` / `unavailable` / `not-run` は必須観測に 1 件でもある限り偽で、代替手段で部分成功した行を `limited` として成功に数えることもない。`host-upgrade` の本仕様側 (`confirmed` または `limited`) との同期は archive 前の spec sync で行う。
- マトリクス行は 1 つでも目的が観測できれば `confirmed` になるため、成功の根拠には 13 中何個を観測したかを併記する (本次元は 11)。

tmux 対話検証 (起動役 0.8.99 + Pi 1.6.0 の一式、隔離 HOME、ローカル provider):

- 起動 art と `spirits v0.8.99`、`[Extensions] spirits-extension.js` が画面に出る。
- `/spirits-clear` → `conversation cleared from the model context`。clear 前に送った語は clear 後のリクエスト本文から消える (provider 側のリクエストで `marker absent` を確認)。
- `tsrepl` が会話から呼ばれ `[value] 42` が画面に出る。
- `/spirits-role` の一覧は `save` / 空行 / `role lock` / `normal model` / `normal thinking` / `strong model` / `strong thinking` / 各 step の行順で、role lock の選択で status line の badge が `[normal medium] fake-model` ↔ `[strong medium] fake-model` と追従する。
- `manage_todos` の TODO が `○ #1 …` として展開され、`ctrl+alt+p` (csi-u) で `1 pending` に集約、もう一度で展開に戻る。
- `/spirits-role` など引数補完を持つ拡張コマンドは、入力直後の 1 回目 Enter が補完の確定に使われて送信されない。2 回目 Enter で実行される。
- 終了は `/quit`。`/exit` は 1.6.0 では model への prompt として送信される。
- `run` は `/quit` 後の回収で 0 で終わり、`tmux-verify.sh check --session <session>` は `clean` (終了コード 0)。`check` は残留の判定で、画面内容の合否は別の観測である。
- 回収の証拠は次の 3 件で取った (`SPIRITS_VERIFY_STATE_DIR` は隔離先に固定)。
  - `run --port 8931` で `spirits` を対話起動し、`/quit` → `run` 終了コード 0 → `check --session <session>` が `clean` (終了コード 0)。`ss -ltn sport = :8931` は起動中・回収後の両方で該当行 0 件。
  - 検査に歯があることの確認: 同じく `--port 8933` で予約したセッションに対し、ポートを listen させたまま `check --session <session>` を実行すると `residue session=… kind=port id=8933 reason=listen` (終了コード 1)、listener を kill すると `clean` (終了コード 0)。つまり予約したポートの `clean` は実際にポートを検査した結果である。
  - `--port` を渡していない `run` では `check` はポートを検査せず、`--session` 無しで記録が空の場合も `clean` を返す (両方終了コード 0)。したがって予約なしの `clean` をポートの証拠にはしない。

モデル選択の警告:

- 既定を `spirits/auto` (`defaultProvider=spirits` / `defaultModel=auto` かつ `models.normal` が解決できる) にした起動では警告行が出ない。
- `--models 'nomatch*/*'` を添えた起動では `Warning: No models match pattern "nomatch*/*"` が **起動時に 1 回だけ** 出る。同じ session で `/new` (`✓ New session started`) をしても再掲されない (warning 行 0 件)。1.6.0 は診断を `takeUnreportedDiagnostics()` で起動時と session 置換後に 1 回ずつ出し、`type` と `message` が既出のものは出さない。
- 既定を `spirits/auto` にして `models.normal` を置いていないと badge は `[!]`、context 表示は `0.0%/0` になる (pi 既定が仮想モデルなので normal が解決できない)。設計上この挙動で、ホストの警告行とは別物。
- `enabledModels` / `--models` のパターンは `provider/modelId` か bare id に minimatch する。`find` のパスパターンが検索ディレクトリ基準に変わったことと、`openai` / `azure` / `openai-codex` の既定モデルが `gpt-6.2-sol` になったことは上流の挙動変更で、spirits 側のコードは変えない。tmux 検証では壊れが出なかったが、これらの経路を使う利用者には効く。

host コマンド語の照合:

| 項目 | 実測 |
| --- | --- |
| `pi/pi --help` が並べる語 | `install`、`remove`、`uninstall`、`update`、`list`、`config`、`auth`、`mcp` |
| 除いた語 | `update` (起動役が先に分類する) |
| `OFFICIAL_PI_HOST.commandWords` | `install`、`remove`、`uninstall`、`list`、`config`、`auth`、`mcp` |
| 追加漏れ / 削除漏れ | **0 件 / 0 件** (1.5.0 と同じ集合で、語表は変えていない) |

語ごとの実測 (`spirits <word>` と `<host> <word>`、隔離 HOME、`</dev/null` + `timeout`)。

| 語 | `spirits <word>` | `<host> <word>` |
| --- | --- | --- |
| `install` | 拒否 1 + host 実行ファイルを案内 | `Missing install source.` + usage 行 (exit 1) |
| `remove` | 拒否 | `Missing remove source.` + usage 行 (exit 1) |
| `uninstall` | 拒否 | `remove` と同じ usage 行 (exit 1。alias が dispatch された) |
| `list` | 拒否 | `No packages installed.` (exit 0) |
| `config` | 拒否 | 対話 UI を開く (TUI の escape sequence、exit 0。model prompt ではない) |
| `auth` | 拒否 | `Usage: pi auth login <provider> …` (exit 0) |
| `mcp` | 拒否 | `Usage: spirits mcp add <server> …` (exit 0) |
| `update` (除いた語) | 起動役自身の自己更新経路が走る (検証用版 0.8.99 は未発行なので manifest 取得が 404 で非ゼロ) | host 自身の `update` が走り `spirits is already up to date (v1.6.0)` (exit 0) |

推移依存の移動 (`bun.lock`):

- host 直下から `grok-mermaid@0.2.3` を除去、`lovely-mermaid@0.3.3` を追加。
- `undici` 8.12.3 → 8.12.4、`pi-ai` 配下の `openai` 7.19.0 → 7.59.0 と `@google/genai` 2.21.0 → 2.32.0、`openai@7.59.0` の optional peer `google-auth-library` の追加。
- `@earendil-works/pi-agent-core` / `pi-ai` / `pi-codemode` / `pi-mcp` / `pi-schema` / `pi-telemetry` / `pi-tui` と `typebox` は 1.5.0 から在り、版のみ追随。
- spirits は `lovely-mermaid` を import しない (host が自分の mermaid 描画で使う)。除外・追加 pin・ラッパーは入れていない。
- 撤回条件: 公式 Linux x64 配布物の導入または起動が失敗する、導入後の容量が記録から 2 割を超える、公式モードに `failed` が出る、tmux 検証で描画・対話の壊れが出る。該当時は `package.json`・`PINNED_PI`・`bun.lock` を 1.5.0 へ戻す。

テストと自己更新:

- `bun run check` は biome / `tsc -p tsconfig.scripts.json` / `packages/spirits` の型検査が 0 件。`cd packages/spirits && bun test` は失敗 0 件。
- `bash scripts/test-clean-env.sh` は check / test / install / tmux-verify の 4 suite が完走した (実行環境は `python3` が在るため、install の 97 assertions と tmux-verify の 125 assertions もスキップされずに走っている)。python3 の無い環境ではこの 2 suite が走らないので、そちらでは未実行として扱う。
- 自己更新 smoke (利用者の許可を得て実行。Linux x64、Bun 1.4.2、GitHub への network あり、smoke 本体の待ち受けに `python3 -m http.server` を使用): 旧 `spirits 0.8.2` → 検証用 0.8.99 へ `spirits update` して **終了コード 0**。

  ```sh
  gh release download spirits-v0.8.2 --repo betiz0/spirits --pattern 'spirits-linux-x64' --dir /tmp/smoke-old
  sh scripts/self-update-smoke.sh /tmp/smoke-old/spirits-linux-x64 dist/spirits-linux-x64 0.8.99 \
    dist/spirits-managed-pi-manifest.json dist/spirits-managed-pi-extension.js
  ```

  出力は `Managed set verified [after-update]: current -> releases/pi-1.6.0`、2 回目の現版実行は `already up to date`、`Self-update smoke passed: spirits 0.8.99 (Bun 1.4.2)`。smoke はホストのランタイム版の文字列を比較しないため、同じ 0.8.99 起動役・同じ manifest を隔離 HOME へ導入して `spirits managed-pi -- --version` の実出力 **`1.6.0`** を別途確認し、導入された bundle が `dist` のものと `cmp` で一致することを見た。
