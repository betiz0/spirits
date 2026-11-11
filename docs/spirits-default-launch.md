# 既定の起動経路 (managed)

`spirits` を打つと、既定では **managed** が起動する。managed は公式 Pi の固定成果物に spirits 拡張 bundle を `-e` で読み込ませた経路で、保存先は従来と同じ `~/.spirits/agent` である。設定・セッション・認証・外部拡張はそのまま引き継がれる。コピーも移行もしていない。

起動役のバイナリはそのまま残っており、`~/.spirits/bin/spirits` が経路を選んでから子プロセスを起動する。

## 何が変わるか

| 項目 | 従来 (fork) | 既定 (managed) |
|---|---|---|
| 起動するもの | バイナリ内の fork 版 pi | `~/.spirits/managed-pi/current/pi/pi` + 拡張 bundle |
| agent dir | `~/.spirits/agent` | 同じ規則 (`SPIRITS_CODING_AGENT_DIR` が無ければ `~/.spirits/agent`) |
| CLI 引数 | そのまま pi へ | `--` なしでそのまま Pi へ (`--continue`、`--resume`、`--session`、`--fork`、`--session-dir`、`--export` など) |
| サブコマンド | `spirits update` など | 同じ。`update`、`managed-pi`、`--version` / `-v` の扱いは従来どおり |
| 初回起動 | なし | agent dir のバックアップを 1 回だけ取ってから起動 |
| 起動ヘッダー | spirits の独自ヘッダー | 公式 Pi のヘッダーに spirits の版を表示 |
| role 表示 | フッターのモデル名隣の badge | 拡張の status line（[spirits-managed-pi.md](spirits-managed-pi.md) の「已知の制約」） |

`SPIRITS_CODING_AGENT_SESSION_DIR` は既定経路では固定しない。Pi はこの変数を「session ディレクトリそのもの」として扱い、既定値の `<agent dir>/sessions/<エンコードした cwd>/` を使わなくなるため、既定経路で固定すると既存のセッション配置が変わってしまう。継承値があればそのまま子に渡る（fork と同じ）。

## 一式の導入

managed の一式（公式 Pi と拡張 bundle）は、**起動役のバイナリと同じリリース**から入る。最新リリースではない。

- `spirits update` … 実行ファイルを更新した後、同じリリースの manifest から一式を取得して `~/.spirits/managed-pi` に入れる
- `scripts/install.sh` … 実行ファイルを配置した後、同じタグの manifest URL を指定して導入する
- 初回の `spirits` 起動 … 一式が無ければ、そのバイナリのリリースから取得して導入する

一式が無く、取得もできなかった場合は、黙って fork に切り替えない。理由、`spirits managed-pi repair`、`SPIRITS_ROUTE=fork spirits` を表示して非ゼロで終わる。fork はその場で起動する。

## バックアップ

既定経路で managed を**初めて起動する前**に、agent dir を `~/.spirits/backups/agent-<UTC 時刻>/` へコピーする。実行した事実は `~/.spirits/managed-pi/agent-backup.json` に** agent dir ごと**に記録され（実体パスで識別）、同じ dir に対しては 2 回目以降取らない。`SPIRITS_CODING_AGENT_DIR` で別の dir を指したときは、その dir の初回としてバックアップが取られる。導入前の single-dir 記録は自動で引き継がれる。

- ファイルとディレクトリのパーミッションは保存される。
- シンボリックリンクは**たどらずリンクのまま**保存し、見つけたリンクと参照先を一覧で表示する（例: `skills -> /home/me/.pi/agent/skills`）。参照先のファイルはコピーされない。
- 保存先とコピーしたサイズが表示される。
- agent dir がまだ存在しなければ何もコピーせず、記録だけ残す。
- **バックアップに失敗した場合は起動しない。** 理由を表示して非ゼロで終わる。記録も残らないので、次回の起動で再試行する。

圧縮はしない。リストアが `cp -a` 1 回で済むほうが、戻せなくなる状況よりマシだからである。

### 戻し方

```sh
# 1. spirits を終了する
# 2. 現在の agent dir を退避する
mv ~/.spirits/agent ~/.spirits/agent.after-managed
# 3. バックアップを戻す
cp -a ~/.spirits/backups/agent-2026-11-10T09-12-33Z ~/.spirits/agent
```

リンクの参照先（`skills` など）はコピーされていないので、バックアップを戻した後も元の場所を指したままである。個別に確かめるなら:

```sh
find ~/.spirits/backups/agent-2026-11-10T09-12-33Z -type l -exec ls -l {} +
```

## fork へ戻る

一時的になら環境変数だけで戻せる。

```sh
SPIRITS_ROUTE=fork spirits --continue
```

`SPIRITS_ROUTE` は `fork` のときだけ fork を起動し、未設定とそれ以外の値は既定（managed）になる。Pi 自身に `--fork` フラグがあるため、フラグ名としては提供しない。

恒久的に戻す場合は、**退避しておいた `~/.spirits/bin` を戻す**。退避は、fork が既定だった頃のバイナリが入っているうちに（managed 既定版への更新の前に）取っておく。

```sh
# 退避（fork 既定のバイナリがまだ入っているうちに実行）
cp -a ~/.spirits/bin ~/.spirits/bin.fork-<UTC 時刻>
```

戻すときは、現在の bin ディレクトリを退けてから、退避しておいたものをはめ直す。

```sh
# spirits を終了してから
mv ~/.spirits/bin ~/.spirits/bin.managed-<UTC 時刻>
mv ~/.spirits/bin.fork-<UTC 時刻> ~/.spirits/bin
spirits --version   # 退避しておいた版が表示されること
```

`bin/` には実行ファイルと `theme/` しかない。データ目録（`~/.spirits/agent`）と managed の一式（`~/.spirits/managed-pi`）は `bin/` の外なので、戻し操作の影響を受けない。現在のバイナリは `bin.managed-<UTC 時刻>` のまま残る。

`VERSION` を指定した `install.sh` の再実行は、現状では戻し手段にできない:

```sh
VERSION=0.6.0 sh scripts/install.sh
# Error: Failed to download https://github.com/betiz0/spirits/releases/download/spirits-v0.6.0/dark.json.
```

インストーラは実行ファイルの前にテーマ資産（`dark.json` / `light.json`）をそのタグから取得するが、`spirits-v0.6.0` のリリースにはテーマ資産が添付されておらず、配置まで進まずに失敗する（配置済みのファイルはそのまま）。退避を取り忘れた場合は、今のバイナリで `export SPIRITS_ROUTE=fork` を shell の rc に書いて起動経路を恒久的に fork へ固定できる（実行ファイル自体は managed 既定版のまま。fork を起動する手段は、fork を削除する変更までは消えない）。

## 一式が壊れたとき

検証を通らない（チェックサムが合わない、`installed.json` が読めない、bundle が書き換わった）ときは、自動で取り直さない。`spirits managed-pi repair` を実行すると、導入済み set の `manifest.json`（導入時に取得元を絶対 URL へ解決して保存してある）と同じ組を再取得して検証し、`current` を置き換える。リリースの解決はしない。

```sh
spirits managed-pi repair        # 導入済み set の manifest から同じ組を取り直して検証
spirits managed-pi update        # 起動役バイナリのリリースの組を入れ直す（最新リリースではない）
```

どちらも失敗したときは、上記と同じく理由・`spirits managed-pi repair`・`SPIRITS_ROUTE=fork spirits` が出る。agent dir と `~/.spirits/bin` は書き換えられない。

## 隔離経路 `spirits managed-pi`

`spirits managed-pi` は残っている。保存先を `~/.spirits/managed-pi/agent` に固定し、既存 agent dir との一致・symlink・`--session` / `--fork` / `--session-dir` / `--export` を起動前に拒否するガードもそのままだ。

ただしガードが効くのは**この隔離経路だけ**である。既定経路は `~/.spirits/agent` を使うことが目的なので、これらの拒否を適用しない。隔離経路は互換性ランナーとテストの土台として置いてあり、通常の利用は既定経路を使う。詳細は [spirits-managed-pi.md](spirits-managed-pi.md)。

## 試用環境で作ったセッションを `~/.spirits/agent` に戻す

`~/.spirits/managed-pi/agent` で試用中に作ったセッションを、本番の agent dir に移す手順はこれ。**自動では行わない。**

```sh
# 1. 現在の ~/.spirits/agent のバックアップ（上記と同じ形式で手で取る）
cp -a ~/.spirits/agent ~/.spirits/backups/agent-$(date -u +%Y-%m-%dT%H-%M-%SZ).before-trial-merge

# 2. session ファイルだけ選ぶ。全ディレクトリをまとめて上書きしない
ls -lt ~/.spirits/managed-pi/agent/sessions/*/ | head

# 3. 1 プロジェクト分の session を、対応する cwd のディレクトリ名でコピーする
mkdir -p ~/.spirits/agent/sessions
cp -a ~/.spirits/managed-pi/agent/sessions/--home-me-project-- ~/.spirits/agent/sessions/

# 4. settings.json / auth.json はまとめて上書きしない。必要なキーだけ写す
diff <(jq -S . ~/.spirits/managed-pi/agent/settings.json) <(jq -S . ~/.spirits/agent/settings.json)
```

- `sessions/` の下のディレクトリ名は cwd をエンコードしたものであり、同名ディレクトリがある場合は既存ファイルを消さないよう `cp -n` を使う。
- `settings.json` は fork 側が持っているキー（`enabledModels` など）を上書きしない。`models.strong` / `models.role` / `defaultProvider` / `defaultModel` / `defaultThinkingLevel` だけを `jq` で写す。
- `auth.json` は認証情報なので、コピーより `spirits` 側でログインし直すほうが安全な場合がある。
- `bundled-skills/` と `extensions/` は移行しない。起動時に作り直される／元の場所にあるべきものだから。
- 移した session は既定経路で `spirits --session <file>` または `--continue` で開けることを確認してから、`~/.spirits/managed-pi/agent` を削除する。

## データの互換性

fork と managed の間で agent dir の読み書きが通るかは [docs/agent-data-compat/](agent-data-compat/README.md) に実測を残した。既定経路の形（agent dir を fork と共有し、session dir を pin しない）で測った結果が `docs/agent-data-compat/default-route/` である。

- 23 項目のうち bidirectional 18 / one-way 1 / not-run 4。managed が書き込んだ session・settings・
  memory・skills・auth を fork 側がそのまま読める（`SPIRITS_ROUTE=fork` に相当する読み取りを fork バイナリで実測）。
- not-run の 4 項目（`auth.json write` / `models.json write` / `models-store.json` / `trust.json`）は
  headless な書き込み経路が product に無く、実測機会が無いことの記録であり、失敗ではない。
- one-way は `pi.virtual-model-state` だけ。公式 Pi 1.5.0 に役割 API が無いため managed 側が将来分を
  追記しないだけで、fork が書いた entry は読める。

実データで確かめるなら、上記のバックアップを自分で取ったうえで実施する。
