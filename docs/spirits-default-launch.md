# 既定の起動経路 (managed)

`spirits` を打つと **managed** が起動する。managed は公式 Pi の固定成果物に spirits 拡張 bundle を `-e` で読み込ませた経路で、保存先は `~/.spirits/agent` である。設定・セッション・認証・外部拡張はそのまま読む。Pi 内蔵経路は削除済みで、`~/.spirits/bin` には起動役しか入らない。

## 何が動くか

| 項目 | 挙動 |
|---|---|
| 起動するもの | `~/.spirits/managed-pi/current/pi/pi` + `current/spirits-extension.js` |
| agent dir | `SPIRITS_CODING_AGENT_DIR` が無ければ `~/.spirits/agent` |
| CLI 引数 | そのままホストへ (`--continue`、`--resume`、`--session`、`--session-dir`、`--export` など) |
| サブコマンド | `spirits update`、`spirits managed-pi`、`--version` / `-v` |
| 初回起動 | agent dir のバックアップを 1 回だけ取ってから起動 |
| 起動ヘッダー | 拡張がホストの header API で描く。アート・`spirits v<版>`・キーヒント |
| role 表示 | 拡張の status line（[spirits-managed-pi.md](spirits-managed-pi.md) の「已知の制約」） |

`spirits list` / `install` / `config` などの host コマンド語は起動役が拒否し、host 実行ファイルを案内する。`--` の後は model への入力になる（[`docs/spirits-host-upgrade.md`](spirits-host-upgrade.md) の「旧版の利用者への注意」）。

`SPIRITS_CODING_AGENT_SESSION_DIR` は既定経路では固定しない。Pi はこの変数を「session ディレクトリそのもの」として扱い、既定値の `<agent dir>/sessions/<エンコードした cwd>/` を使わなくなるため、既定経路で固定すると既存のセッション配置が変わってしまう。継承値があればそのまま子に渡る（fork と同じ）。

## 一式の導入

managed の一式（公式 Pi と拡張 bundle）は、**起動役のバイナリと同じリリース**から入る。最新リリースではない。

- `spirits update` … 実行ファイルを更新した後、同じリリースの manifest から一式を取得して `~/.spirits/managed-pi` に入れる
- `scripts/install.sh` … 実行ファイルを配置した後、同じタグの manifest URL を指定して導入する
- 初回の `spirits` 起動 … 一式が無ければ、そのバイナリのリリースから取得して導入する

一式が無く、取得もできなかった場合は黙って別のホストを起動しない。理由、`spirits managed-pi repair`、取得元を表示して非ゼロで終わる。

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

## 前のリリースへ戻す

環境変数で経路を切り替える手段は無い。戻すときは実行ファイルごと戻す。

```sh
# 1. spirits を終了して ~/.spirits/bin を退避する
cp -a ~/.spirits/bin ~/.spirits/bin-backup-$(date -u +%Y%m%dT%H%M%SZ)
# 2. 直前のリリースの実行ファイルを取得して検証し、配置する
gh release download spirits-v0.7.2 --repo betiz0/spirits --dir /tmp/rollback
(cd /tmp/rollback && sha256sum -c spirits-linux-x64.sha256)
mv /tmp/rollback/spirits-linux-x64 ~/.spirits/bin/spirits && chmod 755 ~/.spirits/bin/spirits
spirits --version   # 戻した版が表示されること
```

`~/.spirits/agent` と `~/.spirits/managed-pi` は `bin/` の外なので、戻し操作の影響を受けない。その版に合う一式が未導入なら、その実行ファイルが同じ規則で取得する。手順全体とフォーク Era の実行ファイルの作り方は [`docs/spirits-host-upgrade.md`](spirits-host-upgrade.md) の Rollback を見る。

## 一式が壊れたとき

検証を通らない（チェックサムが合わない、`installed.json` が読めない、bundle が書き換わった）ときは、自動で取り直さない。`spirits managed-pi repair` を実行すると、導入済み set の `manifest.json`（導入時に取得元を絶対 URL へ解決して保存してある）と同じ組を再取得して検証し、`current` を置き換える。リリースの解決はしない。

```sh
spirits managed-pi repair        # 導入済み set の manifest から同じ組を取り直して検証
spirits managed-pi update        # 起動役バイナリのリリースの組を入れ直す（最新リリースではない）
```

どちらも失敗したときは理由と取得元を表示して非ゼロで終わる。agent dir と `~/.spirits/bin` は書き換えられない。

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
- `settings.json` は既存のキー（`enabledModels` など）をまとめて上書きしない。`models.strong` / `models.role` / `defaultProvider` / `defaultModel` / `defaultThinkingLevel` だけを写す。
- `auth.json` は認証情報なので、コピーより `spirits` 側でログインし直すほうが安全な場合がある。
- `bundled-skills/` と `extensions/` は移行しない。起動時に作り直される／元の場所にあるべきものだから。
- 移した session は既定経路で `spirits --session <file>` または `--continue` で開けることを確認してから、`~/.spirits/managed-pi/agent` を削除する。

## データの互換性

agent dir を読む経路は 1 つになった。fork 時代に測った往復の記録は [docs/agent-data-compat/](agent-data-compat/README.md) に歴史的証拠として残る（既定経路の形で測った結果が `docs/agent-data-compat/default-route/` にあり、23 項目のうち bidirectional 18 / one-way 1 / not-run 4）。`not-run` は headless な書き込み経路が product に無かったことの記録で、失敗ではない。one-way は `pi.virtual-model-state` だけで、managed 側が将来分を書かない代わりに読むことはできる。

実測に使ったランナーは削除済みなので、現在の互換性の証拠は互換性ランナーの公式モードが出す。

```sh
bun scripts/build-managed-pi-inputs.ts --version <版> --out dist
bun scripts/managed-pi-compat/run.ts --inputs dist --artifact-root <公式 tarball の dir> --commit HEAD --out /tmp/compat/result.json
```

完了確認は `Compatibility met` が真、`failed` が 0 件、`not-run` を成功として数えないこと。実データで確かめるときは上記のバックアップを自分で取ったうえで、`~/.spirits/managed-pi/agent` を使う隔離経路で行う。
