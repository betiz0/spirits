# Tasks

## 1. テスト基盤とランナーの骨格

- [x] 1.1 `scripts/tmux-verify.test.sh`(Bash)の基盤を作る。
  - 一時ルートを作り、マーカーを置く。
  - `TMUX_TMPDIR`、`SPIRITS_VERIFY_STATE_DIR`、`XDG_CONFIG_HOME`、`TMPDIR` を一時ルートに隔離し、`TMUX` を unset する。
  - ケース関数と、ok / not ok の集計を用意する。
  - 終了時に、テスト専用の tmux サーバと、テストが残したプロセスを回収する。
  - tmux / strace が無い場合は、`CI` が空なら skip を表示して 0 で、空でなければ非ゼロで終了する。
  
  確認:
  - `bash -n scripts/tmux-verify.test.sh` が成功する。
  - ケースが 0 件の状態で、`bash scripts/tmux-verify.test.sh` が 0 で終了する。
  - tmux を含まない PATH(必要なコマンドだけを symlink した一時ディレクトリ)では、`CI=1` で非ゼロ、`CI` 無しで skip を表示して 0 になる。
- [x] 1.2 `scripts/tmux-verify.sh` の骨格を作る。
  - usage と、`run` / `extend` / `check` への分岐。
  - 引数の解析: `run --session <name> [--temp <dir>] [--port <n>] -- <command...>`、`extend --session <name> --seconds <n>`、`check [--session <name>] [--prune]`。
  - tmux が無い場合は、終了コード 2。
  - 設定ファイルの `TIMEOUT_SECONDS` を、`source` せずに読み取る。既定は 180、正の整数以外は終了コード 2(design D3)。
  - `<name>` の文字種を検査する(D4)。
  
  確認:
  - `bash -n scripts/tmux-verify.sh` が成功する。
  - テストケース `usage-and-env` が ok になる。このケースでは次を確認する。
    - tmux 不在で、終了コード 2 になり、ペインも記録も作られない。
    - `TIMEOUT_SECONDS=0` と `TIMEOUT_SECONDS=abc` で、終了コード 2 になり、ペインが作られない。
    - 不正な `<name>` で、終了コード 2 になる。
- [x] 1.3 セッション名の生成と、ゲート方式の起動・実行記録を実装する(D4 / D5)。
  - 記録ディレクトリを 0700 で作り、所有者とシンボリックリンクを確認する。
  - `<name>-<hash8>` を生成し、既存のセッション・記録との衝突時は終了コード 2 にする。生成した名前を、1行目に `session=<name>` として出力する。
  - ゲートの手順: FIFO の作成、`-e` による `SPIRITS_VERIFY_SESSION` / `SPIRITS_VERIFY_TMPDIR` の受け渡し、記録の書き込み、ゲートの解除。ゲートが 10 秒で解除されない場合は、検証コマンドを起動せずに終了する。
  - 記録の項目: セッション名、ペイン PID、開始時刻、セッション ID、cgroup、tmux サーバ PID、ペイン専用 scope の有無、一時パス、ポート、`TIMEOUT_SECONDS`、コマンド、`STATUS=running`、`PHASE=stage1`。一時ファイル + `mv` で書き込む。
  
  確認: 次のテストケースが ok になる。
  - `records-before-command`: 検証コマンドの先頭で、自身の記録を読み、全項目が埋まっていて、ペイン PID が自身の PID と一致することを検査し、結果を一時ファイルに書く。
  - `unique-session-name`: 同じ `--session` で2回実行すると、異なるセッション名が出力され、2つの記録が存在する。

## 2. 終了検知と回収

- [x] 2.1 終了検知と、2つの経路の回収を実装する(D2 / D6)。
  - 1 秒間隔でペイン PID と `tmux has-session` を確認する。
  - 回収は記録を読み直して行う。
  - ペイン専用 scope がある場合は、`systemctl --user kill --signal=SIGKILL` を実行し、失敗した場合は `cgroup.kill` を使う。
  - ペイン専用 scope が無い場合は、セッション ID と開始時刻で絞り込んで SIGKILL を送る。どちらの経路も、最大 5 秒繰り返す。
  - 最後に `kill-session` を実行する。
  - SIGINT / SIGTERM / SIGHUP を trap し、同じ回収を行う。
  - 終了時に、記録の `STATUS` を clean / residue に更新する。
  - 終了コードは 0 / 1 / 128+n とする(D11)。
  
  確認: 次のテストケースが ok になる。
  - `reap-signal-ignoring`: ペインで `strace -f -o "$SPIRITS_VERIFY_TMPDIR/trace" sleep 300` を起動し、`tmux kill-session` で終える。その後、`strace` と `sleep` が `ps` に無く、`run` の終了コードが 0 になる。scope の経路では、記録した scope の cgroup が存在しないか、空である。
  - `reap-on-interrupt`: 実行中のランナーに SIGTERM を送ると、ペインのプロセスが残らず、終了コードが 143 になる。
  - `keep-preexisting`(scope の無い経路のみ): `run` の前に同じユーザで起動した `sleep` が、回収後も生存している。
- [x] 2.2 同一性の確認と、離脱したプロセスの検出を実装する(D6 の 3. / D7)。
  
  確認: 次のテストケース(scope の無い経路のみ)が ok になる。
  - `pid-reuse-not-killed`: SIGHUP を無視するペインのプロセスが生存している状態で、記録の開始時刻を 1 ずらしてから `kill-session` する。ペインのプロセスは終了せず、`reused pid=<pid>` が出力される。
  - `setsid-escapee-reported`: 検証コマンドが `setsid sleep 300` を起動する。終了後、その PID が `residue ... kind=process` として出力され、終了コードが 1 になる。
  
  どちらのケースも、テストの後始末で対象のプロセスを kill する。
- [x] 2.3 2段階のタイムアウトと `extend` を実装する(D3)。
  - 記録の `PHASE` を `awaiting-extension` に更新してから、1段階目の通知行を出力する。
  - 延長の待機と、`PHASE` の更新を行う。
  - 要求ファイルを受け付け、2段階目の期限を設定する。要求を受理する前に、受理を試みた時刻が当時の受付期限(`extend_deadline`)以前であることを確認する。
  - タイムアウトで回収した場合は、`timeout session=<name> stage=<1|2>` を出力し、終了コード 124 で終了する。ただし残存が残った場合は、design D11 の優先順位に従って終了コード 1 とする。
  - `extend` は、記録を読み取る前に記録ディレクトリがユーザ所有でシンボリックリンクでないことを検査し、合わない場合は終了コード 2 とする(fail-closed)。
  
  確認: `TIMEOUT_SECONDS=2`(または同様の短い間隔)で、次のテストケースが ok になる。
  - `timeout-stage1-notice`: 2〜4 秒後に、`timeout-stage1` の行に `nproc=`、`loadavg=`、`mem_available_kb=`、`extend_deadline=` が含まれ、その時点でペインのプロセスが生存している。
  - `timeout-no-extension`: 延長しない場合、開始から 4〜7 秒で回収され、`stage=1` が出力され、終了コードが 124 になる。
  - `timeout-extended`: 待機中に `extend --seconds 3` を実行すると、`extend` が 0 で終了し、受け付けから 3〜5 秒で回収され、`stage=2` が出力され、終了コードが 124 になる。
  - `extend-rejected`: 待機の前と、受け付けの後に実行した `extend` が非ゼロで終了し、記録の `STAGE2_SECONDS` は受け付けた値のままで期限が変わらない。
  - `extend-after-deadline`: 受付期限を過ぎてから要求を発行しても受理されず、通知どうりに stage=1 で回収され、終了コードが 124 になる。
  - `timeout-with-residue`: 残存を残してタイムアウトした場合、終了コードが 1 になり、`timeout session=<name> stage=<1|2>` と `residue` の両方が出力される。
  - `kill-session-during-wait`: 待機中に `kill-session` すると、2 秒以内に回収され、終了コードが 0 になる。
- [x] 2.4 一時パスとポートの後始末を実装する(D8 / D9)。
  - 自動で採番した一時ディレクトリには、マーカーを置く。
  - 削除の前に、同じユーザの全プロセスの fd を走査する。
  - `--temp` で明示した場合は削除しない。
  - `--port` で宣言したポートは、`/proc/net/tcp{,6}` で待ち受けを判定する。
  - 残存がある場合は、記録を `STATUS=residue` にし、終了コードを 1 にする。
  
  確認: 次のテストケースが ok になる。
  - `temp-and-port-released`: `run --port <空きポート>` で、`python3 -m http.server <ポート>` を起動する検証を実行し、`kill-session` で終える。その後、そのポートが LISTEN でなく、自動で採番した一時ディレクトリが存在しない。
  - `explicit-temp-kept`: `--temp <dir>` を指定すると、終了後も `<dir>` とその中身が残っている。
  - `held-temp-kept`(scope の無い経路のみ): setsid で離脱したプロセスが、一時ディレクトリ内のファイルを開いたままにする。この場合、一時ディレクトリが残り、`residue ... kind=temp` が出力され、終了コードが 1 になる。

## 3. 残存検査

- [x] 3.1 `check` を実装する(D10)。
  - 対象は、`STATUS=clean` 以外の記録、または `--session` で指定した記録。
  - 検査は、scope の経路とセッション ID の経路で行い、一時パスとポートも検査する。
  - D7 と同じように PID 再利用を判定する。開始時刻が一致しない記録では、その PID をセッション ID とするプロセスを残存に数えないで、`reused pid=<pid>` だけを出力して当該記録を clean とする。
  - 出力は `residue ...` / `clean ...` の行とする。
  - 終了コードは 0 / 1 / 2 とする。
  - state / records ディレクトリがユーザ所有でシンボリックリンクでないことを検査する。既定経路でも、所有ずれを読み飛ばして clean としてはいけない(fail-closed)。
  - `--prune` を実装する。
  
  確認: 次のテストケースが ok になる。
  - `check-after-runner-kill`: 実行中のランナーを SIGKILL すると、記録が `STATUS=running` で残る。`check` がペイン PID を含む `residue` 行を出力して 1 で終了し、テストが手動で回収した後は 0 で終了する。
  - `check-skips-clean`: 正常に完了した記録は、引数なしの `check` の対象にならない。`--session` で指定すると、検査して 0 で終了する。
  - `check-prune`: 残存のある記録と残存のない記録がある状態で `check --prune` を実行すると、残存のない記録だけが削除される。
  - `check-pid-reuse-not-residue`: 記録の PID を再利用したセッションリーダがある状態で `check` を実行すると、当該 PID のセッション ID に対応するプロセスは残存に数えられず、`reused pid=<pid>` だけが出力されて終了コードが 0 になる。
  - `check-port-residue`: `run --port <空きポート>` で宣言し、待ち受けを残したまま `check` を実行すると、`residue ... kind=port` と理由が出力され、終了コードが非ゼロになる。
  - `check-dir-fail-closed`: 記録ディレクトリをシンボリックリンク、または非所有に見立てた環境で `check` を実行すると、終了コードが 2 になり、記録の内容を読み飛ばさない。

## 4. CI

- [x] 4.1 `.github/workflows/spirits-ci.yml` を更新する(D12)。
  - `sudo apt-get update && sudo apt-get install -y tmux strace` のステップを追加する。
  - `bash -n scripts/tmux-verify.sh` と `bash scripts/tmux-verify.test.sh` のステップを、`Test installer` の後に追加する。
  - push と pull_request の `paths` に、`scripts/tmux-verify.sh` と `scripts/tmux-verify.test.sh` を追加する。
  
  確認:
  - `rg -n 'apt-get install -y tmux strace' .github/workflows/spirits-ci.yml` が1行を返す。
  - `rg -n 'scripts/tmux-verify' .github/workflows/spirits-ci.yml` が、`paths` の4行と実行ステップの2行(計6行)を返す。
  - ローカルで `CI=1 bash scripts/tmux-verify.test.sh` を実行し、全ケースが ok になる。

## 5. 手順文書と実地確認

- [x] 5.1 `.pi/skills/interactive-testing.md` を更新する。上流の手順ブロックは改変せず、その前に spirits の節を追加する。この節には次を記載する。
  - 既定経路: `run` を、出力のリダイレクト付きでバックグラウンド起動する。`session=` の行が出るのを待ってからセッション名を読み、pane への操作には、`send-keys` / `capture-pane` とも `-t "=<セッション名>:"` を使うこと(コロンを省いた `=<名>` だけでは失敗する)、`tmux kill-session` で終えること、を記載する。
  - タイムアウト: 出力ファイルで `timeout-stage1` を確認する方法。マシン環境に基づいて2段階目を見積もり、利用者に了解を求める手順。`extend` の使い方。拒否された場合は `kill-session` すること。`TIMEOUT_SECONDS` の設定方法。
  - 手動でペインを起動した場合の回収: `#{pane_pid}`、`/proc/<pid>/stat` の開始時刻、cgroup の確認、`systemctl --user kill -s KILL <unit>` と `kill -9` による回収。手動で起動した検証は `check` で検出されないこと。
  - SIGHUP / SIGTERM を無視するプロセス種別(`strace`、`ssh-agent`、プロキシ)。環境変数を消したプロセスは検出できないこと。
  
  確認:
  - 次の語を1語ずつ `rg -n -F '<語>' .pi/skills/interactive-testing.md` で検索し、それぞれ1件以上ヒットする: `tmux-verify.sh run`、`tmux-verify.sh extend`、`tmux-verify.sh check`、`kill-session`、`timeout-stage1`、`TIMEOUT_SECONDS`、`systemctl --user kill`、`kill -9`、`tmux-spawn`、`strace`、`ssh-agent`。
  - `git diff --numstat -- .pi/skills/interactive-testing.md` の削除行数が 0 である。
- [x] 5.2 実地確認として、コンパイル済み `spirits` または `bun` の対話起動の確認を、手順文書のとおり `scripts/tmux-verify.sh run` で1本実行する。セッション名の取得は `session=` の行が出るのを待って行い、pane の操作には `-t "=<セッション名>:"` を使う。
  
  確認:
  - `run` が終了コード 0 で終わる。
  - `scripts/tmux-verify.sh check --session <name>` が 0 を返す。
  - 記録にある scope ユニットについて、`systemctl --user is-active <unit>` が `active` 以外を返す。

## 6. 統合確認

- [x] 6.1 リポジトリの必須チェックを通す。
  
  確認:
  - `npm run check` の全出力で、エラー・警告・info が 0 である。
  - `npm run test:scripts` が、既存のケースを含めて通る。
  - ローカルで `bash scripts/tmux-verify.test.sh` の全ケースが ok になる。

## Workflow follow-up

- `openspec validate --strict harden-verification-cleanup` を通してからアーカイブする。
- 稼働中の残骸(292072 / 292075 / 316180、active な `tmux-spawn-*.scope`、`127.0.0.1:18080`)には実行記録が無く、`check` では検出されない。design の Migration Plan の手動手順で回収し、同じ手順で残存が無いことを確認する。
- 被トレース spirits の teardown 後 futex スピンは、別調査として切り出す(再現条件の特定から)。
- パッケージ成果物の変更がないため、CHANGELOG への追記は不要。
