# Design

## Context

状況と原因は proposal.md を参照。設計上の前提だけ挙げる。

- tmux 3.6 は、ペインごとに systemd の transient scope(`tmux-spawn-<uuid>.scope`)を作る。ただし `StopUnit` / `KillUnit` は呼ばない(バイナリ内にあるのは `StartTransientUnit` のみ)。scope の cgroup は、全プロセスが終了して初めて空になる。
- `strace` は SIGHUP / SIGINT / SIGQUIT / SIGTERM / SIGPIPE / SIGTTIN / SIGTTOU を SIG_IGN で持ち、`tmux kill-session` の SIGHUP では終了しない。
- ptrace 中のプロセスは、tracer が再開させない限り終了できない。SIGKILL は ptrace-stop 中でもカーネルが直接処理するため、回収の最終手段として有効。
- tmux の既定のペインは対話シェルで、ジョブ制御を行う。そのため、send-keys で起動したコマンドは、ペインとは別のプロセスグループになる。一方、セッション ID(ペイン PID)は、setsid しない限り子孫に引き継がれる。
- Linux は、PID の番号をプロセス ID・プロセスグループ ID・セッション ID のいずれかとして使うプロセスが残っている間、その番号を再利用しない。
- 既存のシェルスクリプトのうち、Bash で書かれているのは `test.sh` と `scripts/test-dotenv-smoke.sh` である。`scripts/install.sh`、`scripts/install.test.sh`、`scripts/self-update-smoke.sh` は POSIX sh で、CI は `sh scripts/install.test.sh` で実行している。一時ディレクトリの所有確認は、`test.sh` のマーカーファイル方式を踏襲できる。
- pi の bash ツールは、コマンドを独立したプロセスグループで起動し、中断・タイムアウト時にはプロセスツリーを kill する(`packages/coding-agent/src/core/tools/bash.ts`)。正常終了時は、出力をリダイレクトしてバックグラウンドにしたプロセスを残す。
- 対象プラットフォームは Linux x86_64 で、次の2種類の環境を想定する。
  - systemd の user session と tmux がある環境
  - CI(GitHub Actions)のように systemd user session が無い環境
  
  CI の runner イメージに tmux と strace が入っているかは確認していないため、CI で導入する(D12)。

## Goals / Non-Goals

**Goals:**
- tmux ペインで起動したプロセス群を、検証の成否・中断・タイムアウトにかかわらず回収する。回収はシグナル耐性に依存しない。
- 検証の終了をエージェントの操作だけに依存させない。2段階のタイムアウトで上限を設ける。
- 回収漏れを検証後に検出できる、実行記録と検査コマンドを提供する。
- 一時ファイルと、検証が宣言したリスナのポートを、書き込み側のプロセスの終了を確認した後に解放する。
- 手順文書を新しい既定経路に揃え、手動実行の例外手順も残す。

**Non-Goals:**
- 製品コード(`packages/`)と CLI の挙動の変更。
- Linux 以外、systemd 以外の init 系、tmux 以外の端末多重化への対応。
- 被トレース spirits の teardown 後 futex スピンの修正(別調査)。
- 実行記録の無い過去の残骸(`tmux-spawn-*.scope`、プロキシのポート、ssh-agent)の列挙と回収。Migration Plan の手動手順で扱う。
- 検証レポート(`verification.md`)への clean / residue の自動記録。

## Decisions

### D1: ランナーは Bash スクリプト `scripts/tmux-verify.sh`(サブコマンド `run` / `extend` / `check`)
tmux、systemd、`/proc` の操作は外部コマンドが中心である。Bash なら次のことができる。
- `test.sh` と同じ形で、`trap` による回収を書ける。
- 検証コマンドの引数を配列のまま保持できる。
- `read -t` でタイムアウト付きの待機を書ける。

テストも Bash の `scripts/tmux-verify.test.sh` とする。CI の `sh` は dash なので、構文検査は `bash -n`、テストの実行は `bash scripts/tmux-verify.test.sh` で行う。

代替案(却下):
- POSIX sh: 配列と `read -t` が無く、コマンド引数の保持とゲートの待機を安全に書けない。
- Bun/TS の `scripts/tmux-verify.ts`: 構造化出力と純関数テストが容易だが、結局 tmux / ps / systemctl を spawn する。また、検証ハーネスを `npm run check` の必須経路に載せにくい。JSON 出力が本当に必要になった時点で再検討する。

### D2: `run` は終了まで待つ。エージェントはバックグラウンドで起動する
`run` は、次のいずれかが起きるまで約 0.5 秒間隔で確認しながら待つ。
- ペインの終了: 記録したペイン PID の消滅
- セッションの消滅: `tmux has-session` の失敗
- タイムアウト(D3)

エージェントの操作手順は次のとおり。
1. `run` を出力ファイルへリダイレクトし、バックグラウンドで起動する。
2. 出力ファイルをポーリングし、1行目の `session=<name>` が出るのを待ってからセッション名を得る。
3. 別のコマンドで、pane を一意に指定する target(`-t "=<session>:"`、末尾のコロンまで含める)を使って send-keys / capture-pane を行う。コロンを省いた `=<name>` は tmux の pane target として失敗することがあるため。
4. 最後に `tmux kill-session -t <name>` を実行する。

ランナーは SIGINT / SIGTERM / SIGHUP を trap し、同じ回収を行う。

代替案(却下):
- `start` / `stop` への分割: `stop` を忘れると、プロセスは `check` を実行するまで残る。回収が手順の記憶に依存し、proposal の Why に反する。
- 手順スクリプトを `run` に渡す方式: 手探りで行う対話的な確認に向かない。

### D3: 2段階のタイムアウトと延長
- 1段階目: 検証コマンドの開始(ゲートの解除)から数える。既定は 180 秒。
  - 設定は `${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config` の `TIMEOUT_SECONDS=<正の整数>` で行う。
  - 設定ファイルは `source` せず、`TIMEOUT_SECONDS=` の行だけを読み取る。
  - 値が不正な場合は、ペインを起動せずに終了コード 2 で終わる。
- 1段階目の超過: 回収はしない。標準出力に次の1行を出す。
  ```
  timeout-stage1 session=<name> elapsed=<秒> nproc=<n> loadavg=<1/5/15分> mem_available_kb=<n> extend_deadline=<epoch秒>
  ```
  - 値の出所: nproc は `nproc`、loadavg は `/proc/loadavg`、mem_available_kb は `/proc/meminfo` の MemAvailable。
  - 記録の `PHASE` をまず `awaiting-extension` に書き換えてから、通知行を出す。通知を見て直ちに `extend` を実行しても、記録はすでに更新されている。
  - 延長は、1段階目と同じ長さだけ待つ。
- 延長: `extend --session <name> --seconds <n>` で行う。
  - `extend` は、記録の `PHASE` が `awaiting-extension` であることを確かめる。ランナーは要求を受理する前に、当時の受付期限(`extend_deadline`)を過ぎていないことを確認する。期限を過ぎた要求は受理せず、回収に進む。そのうえで要求ファイル `<records>/<name>.extend` を一時ファイル + `mv` で置き、ランナーが受け付けて `PHASE=extended` にするまで最大 3 秒待つ。
  - 受け付けた場合は 0 で終わる。待機中でない場合、2回目の延長、値が不正な場合、受け付けられなかった場合は非ゼロで終わる。
  - 2段階目は、受け付けた時点から指定秒数とする。延長は1回だけ受け付ける。
- 回収: 次の場合に回収し、`timeout session=<name> stage=<1|2>` を出力する。
  - 延長の待機中に延長がなかった場合
  - 2段階目を超えた場合
- 拒否: 利用者が延長を拒否した場合、エージェントは `tmux kill-session` を実行する。これにより、`run` は D2 の経路で直ちに回収する。
- 見積もり: 2段階目の値はエージェントが見積もる。見積もりには、ランナーが出力するマシン環境と、検証の内容(例: モデル応答の待ち)を使う。ランナーはマシン環境を提供するだけとする。

代替案(却下):
- 単一のタイムアウト: 長い検証を、相談なしに打ち切ってしまう。逆に既定値を長くすると、放置されたときの消費が増える。
- 延長を無期限に待つ: エージェントのセッションが終わると、ランナーと検証プロセスが残り続け、本件と同じ状態になる。

### D4: セッション名は `<name>-<hash8>`
- `hash8` の作り方: `<name>:<ランナー PID>:<epoch(マイクロ秒)>:<$RANDOM>` を `sha256sum` に通し、先頭 8 桁の16進を使う。
- `<name>` に使える文字は `[A-Za-z0-9_-]` に限る。tmux のターゲット指定で、`.` と `:` は区切りとして解釈されるため。
- 生成した名前が既存の tmux セッションまたは記録と一致した場合は、上書きせずに終了コード 2 で終わる。

代替案(却下):
- 同名を拒否するだけ: 利用者が毎回名前を変える必要があり、並行実行もしにくい。
- コマンドのハッシュ: 同じコマンドを2回実行すると衝突する。

### D5: ゲート方式の起動と実行記録
- 記録の置き場所: `${SPIRITS_VERIFY_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/spirits-verify}/records/`
  - 0700 で作る。ユーザ所有でない場合と、シンボリックリンクの場合は、終了コード 2 で終わる。
  - `SPIRITS_VERIFY_STATE_DIR` は、テストで利用者の記録と隔離するために使う。
- 記録ファイル: `<session>.env`。値は `printf %q` で書き、読むときは `source` する。所有者とパーミッションは、上記の確認で担保する。
- ゲートの手順:
  1. FIFO を作る。
  2. `tmux new-session -d -s <session> -e SPIRITS_VERIFY_SESSION=<session> -e SPIRITS_VERIFY_TMPDIR=<tmp> "exec bash <gate> <fifo> <command...>"` でペインを起動する。ゲートは FIFO を `read -t 10` で待つ。
  3. `#{pane_pid}` と `/proc/<pid>/stat` から、開始時刻(22 番目のフィールド)とセッション ID(6 番目のフィールド)を読む。`/proc/<pid>/cgroup` から cgroup を読む。tmux サーバ PID(`#{pid}`)も読む。
  4. 記録を一時ファイル + `mv` で書く。`STATUS=running`、`PHASE=stage1` とする。
  5. FIFO に書いて、ゲートを解除する。
- ゲートは、検証コマンドを `exec` する。このため、記録したペイン PID と開始時刻は、検証コマンドのものと一致する。
- ゲートが 10 秒以内に解除されない場合(ランナーが記録の前に落ちた場合)、ゲートは検証コマンドを起動せずに終了する。
- 終了時の記録の扱い:
  - 記録は EXIT 時に削除しない。
  - 残存がなければ `STATUS=clean`、あれば `STATUS=residue` に更新する。
  - ランナーが SIGKILL された場合は `STATUS=running` のまま残り、`check` の対象になる。
- 記録を読み取る側(`extend` / `check`)も、記録とその親ディレクトリ(records / state)がユーザ所有でシンボリックリンクでないことを同様に確認する。合わなければ終了コード 2 とする。records ディレクトリがユーザ所有でない場合に、内容を読み飛ばして全件 clean としてはなけない(fail-closed)。

代替案(却下):
- 2段階の記録(起動前と起動直後): 起動から追記までの間にランナーが落ちると、PID が欠ける。
- JSON 1 本: jq に依存し、並行実行で競合する。
- 記録を `run` の終了時に削除する: 検出の証跡が消え、本件を検出できない。

### D6: 回収の対象の選定
回収は、記録を読み直して行う。記録を唯一の情報源とし、テストで値を差し替えられるようにする。

1. ペイン専用の scope がある場合
   - 条件: 記録した cgroup の末尾が `tmux-spawn-*.scope` に一致し、記録時と回収時のどちらでも `cgroup.procs` に tmux サーバ PID とランナー PID が含まれない。
   - 処理: `systemctl --user kill --signal=SIGKILL <unit>` を実行する。失敗した場合は、その cgroup の `cgroup.kill` に `1` を書く。その後、`cgroup.procs` が空になるまで最大 5 秒確認する。
2. ペイン専用の scope が無い場合
   - D7 の同一性を確認する。
   - `/proc/[0-9]*/stat` から、セッション ID がペイン PID で、開始時刻が記録した開始時刻以降のプロセスを列挙し、SIGKILL を送る。
   - fork の競合に備え、該当するプロセスが無くなるまで最大 5 秒繰り返す。
3. 離脱したプロセスの検出
   - 同じユーザのプロセスのうち、`/proc/<pid>/environ` に `SPIRITS_VERIFY_SESSION=<session>` を持ち、開始時刻がペイン以降で、1. と 2. で回収できなかったものを、残存として報告する(kill はしない)。
4. セッションの片付け
   - セッションが残っている場合は、最後に `tmux kill-session -t <session>` を実行する。

代替案(却下):
- PGID + `/proc/<pid>/cgroup` から求めた cgroup:
  - scope の無い環境では、cgroup がランナーやログインセッションと共有され、無関係なプロセスまで kill する。
  - ジョブ制御で別の PGID になったジョブを取りこぼす。
- `systemctl --user stop`: SIGHUP / SIGTERM を無視するプロセスがあると、`TimeoutStopUSec`(既定 90 秒)待たされる。
- 子孫の定期スナップショット: スナップショットの間に起動して離脱したプロセスを取りこぼす。

制約: 環境変数を消して起動したプロセス(`env -i` など)は、3. では検出できない。手順文書に記載する。

### D7: 同一性の確認は `/proc/<pid>/stat` の開始時刻
D6 の 2. の前に、記録したペイン PID を確認する。

- PID のプロセスが存在し、開始時刻が一致しない場合
  - そのセッション ID のプロセスは kill せず、`reused pid=<pid>` を出力する。
  - これは残存には数えない。PID の番号が別のプロセスに使われているなら、Context に書いた再利用の規則により、元のセッション ID を持つプロセスは残っていないため。
- PID のプロセスが存在しない場合
  - ペインのプロセスは終了しているが、セッションの構成員は残りうる。D6 の 2. のとおり、開始時刻で絞って回収する。

ペイン専用の scope がある場合は、scope 名が UUID で再利用されないため、この確認を経ずに scope 単位で回収する。

代替案(却下):
- PID と cmdline の照合: 同じコマンドを複数起動する検証(並行するプロキシ等)で誤判定する。
- 無条件の kill: 他のセッションを壊す。

### D8: 一時パスはランナーが採番し、所有マーカーで保護する
- 作成: `--temp` を指定しない場合は、`mktemp -d "${TMPDIR:-/tmp}/spirits-verify.XXXXXX"` で作り、マーカー `.spirits-verify-owned` を置く。パスは `SPIRITS_VERIFY_TMPDIR` で渡す。
- 削除の条件: 回収の後、次をすべて満たす場合だけ削除する。
  - 同じユーザの全プロセスの `/proc/<pid>/fd/*` のうち、一時ディレクトリ配下を指すものが無い。
  - パスが採番の形式に一致する。
  - シンボリックリンクではない。
  - マーカーがある。
- 削除できない場合: ファイルを開いているプロセスが残っている場合は削除せず、その PID を残存として報告する。
- `--temp <dir>` を指定した場合: 削除の対象にせず、fd の検査だけを行う。

代替案(却下): 先に `rm` してから kill する。削除済みの inode を fd で保持したプロセスを、外部から特定しにくくする(今回の 87,907 バイトの trace がこれに当たる)。

### D9: ポートは `run --port` で宣言し、`/proc/net/tcp{,6}` で待ち受けを判定する
`ss` の有無に依存せず、同じユーザが読める procfs だけで判定する。宣言したポートについて、ローカルポートが一致し、状態が `0A`(LISTEN)の行があれば残存とする。宣言が無い検証では、ポートの検査をスキップする。

代替案(却下): cgroup に属するプロセスの socket inode を、`/proc/<pid>/fd` から逆引きする。複雑で、プロセスの回収後は inode も消えるため、検査できない。

### D10: `check` の対象と出力
- 対象:
  - `--session` を指定した場合は、その記録。
  - 指定しない場合は、`STATUS=clean` 以外のすべての記録。
  - 正常に完了した記録を既定で除外するのは、後から同じポートで待ち受けた無関係なプロセスを、残存と誤検出しないため。
- 検査内容:
  - 記録にペイン専用の scope がある場合: scope の cgroup が存在し、プロセスが残っているか。
  - 無い場合: D7 の同一性、セッション ID の構成員、離脱したプロセス。
  - いずれの場合も: 一時パスとポート。
- D7 の対象は `check` でも同じく扱う。開始時刻が一致しないとき、記録した PID をセッション ID に持つプロセスは残存に数えないで、`reused` だけを出力して当該記録を clean とする。Linux の再利用ルールにより、PID の番号が別のプロセスに使われる前に、そのセッションの構成員はすべて消えている。
- 出力:
  - 残存1件ごとに1行: `residue session=<s> kind=<process|scope|temp|port> id=<pid|path|port> reason=<理由>`
  - 残存が無い場合: `clean session=<s>`(対象が無い場合は `clean`)
- 終了コード: 残存があれば 1、無ければ 0、使い方や環境の誤りは 2。
- `--prune`: `STATUS=clean` の記録と、この呼び出しで残存なしを確認した記録だけを削除する。

代替案(却下): 全記録を毎回検査する。正常に完了した記録が、時間が経ってから誤検出され続ける。

### D11: `run` の終了コード
終了コードは次の優先順位で判定する。複数の条件が同時に成立した場合は、この一覧の先のものを優先する。
- `2`: 起動前の誤り(tmux の不在、設定値の不正、引数の誤り、名前の衝突、記録ディレクトリの不正)
- `1`: 回収後の残存(離脱したプロセス、開いたままの一時ファイル、待ち受けたままのポート、空にならない scope)
- `124`: タイムアウトによる回収
- `128+n`: シグナル n による中断
- `0`: それ以外

つまり、タイムアウトで回収した場合でも残存があれば、終了コードは 1 とする(残存は検出としてより重大なので優先する)。シグナル受領時は従来どおり、割り込みの回収を終えてから 128+n とする。

`run` は、検証コマンド自身の終了コードは返さない。対話検証では `tmux kill-session` で終えるため、検証コマンドの終了コードに意味が無い。

代替案(却下): 検証コマンドの終了コードを返す。回収の結果と区別できない。

### D12: CI で tmux と strace を導入してテストする
- `.github/workflows/spirits-ci.yml` に、次の4点を加える。
  - `sudo apt-get update && sudo apt-get install -y tmux strace`
  - `bash -n scripts/tmux-verify.sh`
  - `bash scripts/tmux-verify.test.sh`
  - `paths` への `scripts/tmux-verify.sh` と `scripts/tmux-verify.test.sh` の追加
- テストのツール不在時の扱い: tmux / strace が無い場合、`CI` が空なら skip して 0 で終わり、空でなければ非ゼロで終わる。
- 環境とケースの対応:
  - systemd user session が無い CI では、セッション ID の経路のケースを実行する。
  - ローカル(systemd あり)では、scope の経路のケースを実行する。
  - 経路に依存するケースは、記録のペイン専用 scope の有無で実行するかを判定する。

代替案(却下):
- runner イメージに頼る: tmux と strace の有無を確認しておらず、無ければテストが黙って skip され、回帰を検出できない。
- ローカル専用にする: 回収ロジックの回帰を検出できない。

## Risks / Trade-offs

- [Risk] kill の対象の取り違え(PID の再利用、共有された cgroup、記録ファイルの改竄)
  → Mitigation:
    - 開始時刻の照合と、開始時刻による絞り込み(D7)
    - ペイン専用の scope の判定(D6)
    - 記録ディレクトリを 0700 で作り、ユーザ所有を確認してから操作する(D5)
- [Risk] `--temp` に共有パスやホームを指定して誤削除する
  → Mitigation: 明示した場合は削除せず、検査だけを行う。削除の対象は、自動で採番しマーカーを置いたディレクトリだけにする(D8)。
- [Risk] scope の無い環境で、ペイン内のプロセスが setsid で離脱する
  → Mitigation: 環境変数のマーカーで検出し、残存として報告する(D6)。マーカーを消したプロセスは検出できないことを、手順文書に記載する。
- [Risk] tmux / systemd のバージョン差で、scope 名や cgroup の構成が変わる
  → Mitigation: scope 名は `/proc/<pid>/cgroup` から求め、専用であることを確認できない場合は、セッション ID の経路にする(D6)。
- [Risk] 実行記録が蓄積する
  → Mitigation: `check --prune` で、残存なしの記録だけを削除する(D10)。
- [Risk] ランナー自身が SIGKILL されて回収できない
  → Mitigation: 記録が `STATUS=running` のまま残るため、`check` が検出する。手動での回収(`systemctl --user kill -s KILL <unit>`、`kill -9`)を手順文書で案内する。記録の前に落ちた場合は、ゲートが 10 秒で終了し、検証コマンドは起動しない(D5)。
- [Risk] エージェントの bash ツールが、中断・タイムアウト時にバックグラウンドのランナーを kill する
  → Mitigation:
    - SIGTERM / SIGHUP であれば、ランナーが回収する(D2)。SIGKILL であれば、記録が残り、`check` が検出する。
    - 手順文書では、`run` を出力のリダイレクト付きでバックグラウンド起動するだけの、すぐ戻るコマンドとして実行するよう記載する。
- [Risk] エージェントが1段階目の通知に気づかず、延長の待機が切れて検証が打ち切られる
  → Mitigation: 打ち切りは安全側の結果である。手順文書には、出力ファイルで通知を確認する方法と、長い検証では事前に `TIMEOUT_SECONDS` を設定する方法を記載する。
- [Risk] 上流由来の `.pi/skills/interactive-testing.md` を変更するため、上流の取り込みで競合する
  → Mitigation: 上流の手順ブロックは改変せず、その前に spirits の節を追加して既定経路を上書きする。競合した場合は、上流の変更を取り込んだうえで spirits の節を保持して解決する。
- [Risk] CI での apt の導入が、ミラーの障害で失敗する、またはバージョンがローカルと異なる
  → Mitigation: 失敗した場合は再実行する。tmux のバージョンに依存する scope の経路は、CI ではテストしない(D12)。

## Migration Plan

- 既存手順の呼び出し箇所は、`.pi/skills/interactive-testing.md` の更新で切り替える。
- ロールバックは、スクリプト・テスト・手順文書・workflow の revert で完了する。状態の移行は無い。ユーザ設定ファイルが残っても影響は無い。
- 過去の `docs/spikes/` の生の tmux 手順は、履歴文書として残す(proposal の範囲外)。
- 稼働中の残骸(292072 / 292075 / 316180、active な `tmux-spawn-*.scope`、`127.0.0.1:18080` の LISTEN)には実行記録が無く、`check` では検出されない。本変更の実装とは独立した運用作業として、次の手動手順で回収する。
  1. 列挙する。
     - `systemctl --user list-units 'tmux-spawn-*.scope' --state=active`
     - `ps -o pid,lstart,args -p 292072,292075,316180`
     - `ss -ltnp 'sport = :18080'`
  2. 各 scope のプロセスを `systemd-cgls --user-unit <unit>` で確認する。
  3. 回収する。
     - scope 単位: `systemctl --user kill -s KILL <unit>`
     - 個別のプロセス: `kill -9 <pid>`
  4. 1. のコマンドを再実行し、該当が無いことを確認する。

## Open Questions

- なし
