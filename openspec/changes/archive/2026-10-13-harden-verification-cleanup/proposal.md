# Proposal

## Why

`add-product-identity` のタスク 7.1(install レポート非送信の確認)で、エージェントが tmux ペイン内で `strace -f ... dist/spirits-linux-x64` を起動し、`tmux kill-session` と一時ファイルの `rm` だけで検証を終えた。この結果、SIGHUP/SIGTERM を無視する `strace`(2026-10-11 13:42 起動)と、ptrace-stop で自力終了できない被トレース `spirits` が 28 時間回収されず、合計 32.5 CPU 時間を消費した。同種の残骸として、プロキシ用 `node` が `127.0.0.1:18080` を LISTEN したまま残り、`tmux-spawn-*.scope` が 10 個 active(running) のまま蓄積している。

原因は検証手順が「`tmux kill-session` でペインのプロセスも回収される」という前提に依存していることにある。tmux 3.6 はペインごとに systemd scope を作るが scope を停止せず(バイナリ内に `StopUnit` / `KillUnit` が存在しない)、`strace` / `ssh-agent` / デーモンはシグナルを無視するため、ペインを閉じても生存する。さらに、書き込み中の一時ファイルを先に `rm` するため、削除済み fd を保持した残存プロセスを外部から特定しにくくしている。検証を再実行可能な手順として維持するには、プロセスとリソースの回収を手順の記憶に依存させず、実行記録と検査コマンドで強制する必要がある。

## What Changes

- tmux 検証ランナー `scripts/tmux-verify.sh` を追加する。サブコマンドは `run` / `extend` / `check`。
- `run` は、指定した名前にハッシュ値を付けた一意なセッション名で tmux ペインを起動し、そのセッション名を最初に出力する。ペインの終了、セッションの消滅、タイムアウトのいずれかまで待ち、その時点でプロセスを回収して一時ディレクトリを削除する。エージェントは `run` をバックグラウンドで起動し、別のコマンドで send-keys / capture-pane を行い、最後に `tmux kill-session` を実行する。ランナーが SIGINT / SIGTERM / SIGHUP を受けた場合も同じ回収を行う。
- タイムアウトは2段階とする。1段階目は既定 180 秒で、ユーザ設定 `${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config` で変更できる。1段階目を超えると、`run` はマシン環境(CPU 数、ロードアベレージ、空きメモリ)を出力し、1段階目と同じ長さだけ延長を待つ。エージェントはマシン環境から2段階目の値を見積もって利用者に提示し、了解を得てから `extend` で設定する。拒否された場合は `tmux kill-session` で直ちに終える。待機中に延長されない場合と、2段階目を超えた場合は回収する。
- 実行記録はゲート方式で、検証コマンドの開始前に書き込む。ペインを待機コマンドで起動し、PID などを記録してから待機を解除する。ランナー自身が SIGKILL で落ちても記録は残る。
- 回収は、ペインが専用の systemd scope(`tmux-spawn-*.scope`)に属することを確認できれば、scope 単位で SIGKILL する。確認できなければ、ペインのセッション ID に属し、ペインの開始時刻以降に起動したプロセスだけを SIGKILL する。kill の前には、記録した開始時刻でペイン PID の同一性を照合し、PID が再利用されていても無関係なプロセスを終了させない。setsid で離脱したプロセスは残存として報告する。
- `check` を追加する。実行記録を読み、プロセス・scope・一時パス・宣言したポートの残存を検査し、残存があれば PID と理由を表示して非ゼロ終了する。
- 一時ファイルは、それを開いているプロセスが残っている間は削除しない(削除しても fd が残る症状を検出可能にする)。`--temp` で明示したディレクトリは削除しない。
- `.pi/skills/interactive-testing.md` に spirits の手順節を追加し、検証ランナーを既定経路とする。あわせて、手動でペインを起動した場合の回収手順と、SIGHUP/SIGTERM を無視するプロセス種別(`strace`、`ssh-agent`、プロキシ等)を記載する。
- CI(`.github/workflows/spirits-ci.yml`)で tmux と strace を apt で導入し、ランナーのテストを実行する。
- 既存仕様の要件は変更しない。変更範囲はリポジトリの検証手順とそのツールに限定する。

**BREAKING**: なし。検証手順の既定経路が変わるが、製品の実行時挙動と CLI は変わらない。

範囲外(別 change / 別調査):
- 回収されなかった被トレース `spirits` の teardown 後 futex スピン。本変更では再現も修正もしない。
- `docs/spikes/` 等の既存手順に残る生の `tmux kill-session` の一括置換。必要になった時点で別途行う。
- 実行記録の無い過去の残骸(既存の `tmux-spawn-*.scope`、プロキシ、`strace`)の列挙と回収。`check` の対象には含めず、design の Migration Plan の手動手順で回収する。

## Capabilities

### New Capabilities

- `verification-harness`: リポジトリで tmux を使って行う対話検証について、次を定める。
  - 実行記録
  - 終了とタイムアウト
  - プロセスと scope の回収
  - 一時リソースの後始末
  - 残存検査
  - CI でのテスト
  - 手順文書との整合

### Modified Capabilities

- なし

## Impact

- **Pi 上流コアへの差分: なし。** 変更するファイルは次の4つで、`packages/` 配下の製品コードには触れない。
  - `scripts/tmux-verify.sh`
  - `scripts/tmux-verify.test.sh`
  - `.pi/skills/interactive-testing.md`
  - `.github/workflows/spirits-ci.yml`
  
  `.pi/skills/interactive-testing.md` は上流由来の文書である。Pi コア(`packages/spirits/` を除く `packages/`)には当たらないが、上流の取り込みで競合しうる(design の Risks を参照)。
- 実行環境:
  - tmux が無い環境では、`run` はエラー終了する。
  - systemd user session が無い環境(CI など)では、`run` はセッション ID による回収で動作し、`check` は記録した PID・一時パス・ポートを検査する。
- 依存追加: パッケージの依存は無い。CI のジョブでは apt の `tmux` と `strace` を導入する。
- ユーザ設定: `${XDG_CONFIG_HOME:-$HOME/.config}/spirits-verify/config`(任意。無ければ既定値を使う)。
- ドキュメント: `.pi/skills/interactive-testing.md`。将来の手順改訂で検証結果を記録する場合は、既存の慣行(`verification.md`)に従う。
