# Design

## Context

M2 設計書 (`docs/spirits-m2-distribution.md` §3) は自動更新と `spirits update` を「将来検討」として対象外にした。現状は install.sh の再実行だけが更新手段で、同版でも毎回約 94MB をダウンロードし、`/tmp` から `mv` するためファイルシステムをまたぐ場合は非原子的である。また pi コアは非 pi の bun バイナリに対して `spirits update` を明示的に拒否し、インストーラ再実行を案内する (`packages/coding-agent/src/package-manager-cli.ts:1039`)。

制約:

- 実装は `packages/spirits/` に閉じる。pi コアへ差分を出さない
- Linux x86_64 のみ。配布は `bun build --compile` の単一バイナリ
- リリース契約(タグ `spirits-v*`、成果物 `spirits-linux-x64` + `.sha256`、draft/prerelease 除外)は install.sh と共有する
- 起動エントリは pi を import する前に Bun ゲートと環境既定値を適用する順序を保つ
- 自己更新は M3 以降の機能に依存しない。M4 の設定読み込み (`src/config.ts`) も import しない

## Goals / Non-Goals

**Goals:**

- コンパイル済みバイナリで `spirits update` が実際に最新 stable へ自己更新する
- install.sh 再実行が同版を検出して不要なダウンロードをせず、配置が原子的である
- 更新経路をネットワークなしの fixture テストで検証できる
- pi コア差分ゼロ、M3 以降の機能への非依存

**Non-Goals:**

- 起動時の更新通知、自動更新、`--check`
- macOS / Windows ターゲット
- pi.dev の managed install への移行
- settings.json の `httpProxy` を自己更新へ適用すること(標準の環境変数 proxy に従う)
- ダウングレード指定(`VERSION` 相当のピン留め更新)。`--force` は最新 stable への置換だけを行う
- install.sh への無通信タイムアウトの導入

## Decisions

### Decision 1: 更新処理は bootstrap で intercept する

選択肢:

- **B1. `bin/bootstrap.ts` が `update` を intercept**(採用)
- B2. pi コアに distribution 用のフックを追加する
- B3. `spirits update` が install.sh を取得して exec する

B1 を採る理由: pi コア差分ゼロで、pi モジュールをロードする前に自身のバージョン (`SPIRITS_VERSION`) と実行パス (`process.execPath`) を使える。B2 は `[spirits]` プレフィックスのコアコミットが必要になり、上流追従コストが増える。B3 は curl / sha256sum への依存が生じ、ユニットテストが難しく、取得する install.sh がインストール済みリリースと一致する保証もない。

bootstrap は自己更新を top-level await で処理し、成功・失敗に関わらず `process.exit` する。保証として依存するのは「`spirits.ts` 本体(`setupCli()` と `main()`)が実行されないこと」だけである。`spirits.ts` は bootstrap に依存するため、ESM の仕様上、bootstrap の評価が終わるまで本体は実行されない。

一方、bootstrap と兄弟の静的 import(`sandbox-env-setup`、`runtime-setup`、pi 本体)は、ESM の仕様上、bootstrap の await 中に評価されうる。コンパイルバイナリでは bundle がモジュールを順に連結するため評価されないことを実機で確認しているが、これは bundle の出力形式に依存する。このため、未コンパイル実行の拒否は最初の `await` より前に同期的に判定して exit する。通常起動では await は即時解決し、既存の同期処理(gate → env defaults → `--version`)の順序は変えない。

### Decision 2: 更新ロジックは TS ネイティブで実装し、版比較は Bun.semver を使う

選択肢:

- **N1. `packages/spirits/src/update/` に TS で実装**(採用)
- N2. install.sh を唯一の実装として `spirits update` が委譲する

N1 を採る理由: curl / sha256sum に依存せず、インストール先と同じファイルシステムへの一時ファイル + rename による原子的置換を制御でき、fetch とベース URL を注入して fixture でテストできる。N2 は実装が 1 つになる代わりに、上記の制御とテスト容易性を失う。

版比較の選択肢:

- **V1. `Bun.semver.order()`**(採用)
- V2. `semver` パッケージを exact で追加する
- V3. 自前で比較する

V1 を採る理由: spirits は Bun 専用で、組み込み API で prerelease を含む順序比較ができ、依存も `packages/spirits/bun.lock` の変更も増えない。V2 は pi coding-agent が既に使っているが、`packages/spirits` は独自の lockfile を持つため依存と lockfile の追加が必要になる。V3 は prerelease の順序規則を再実装することになり、誤りやすい。

ドリフト対策: リリース解決と検証の規則は仕様で固定し、install.sh のテストと updater のテストが同じ fixture 形状(draft / prerelease / pi タグ混在)を使う。

### Decision 3: 引数ルーティングは pi の update 文法を再現する分類器で行う

選択肢:

- **S1. pi の `parsePackageCommand` の `update` 部分を再現する純関数で、self / all / pass-through に分類する**(採用)
- S2. spec に列挙した形だけを intercept し、それ以外はすべて pi に渡す
- S3. pi の `parsePackageCommand` を import して判定する

S1 を採る理由: pi と同じ使い方ができる。たとえば `update -a` は pi では self として受理されるが、S2 では pi に渡って bun-binary ガード (`package-manager-cli.ts:1039`) で失敗し、引数によって結果が変わる。S3 はパーサが export されておらず、import すると bootstrap が pi の CLI 依存グラフを読み込んでしまう。

分類規則(pi の `parsePackageCommand` に合わせる):

- pass-through: `-h` / `--help` を含む形。pi がエラーとする形(未知のオプション、2 つ目以降の位置引数、`--extension` の値の欠落・重複、`--all` / `--models` / `--extension` と他の対象指定の組み合わせ、self / pi 以外の位置引数と `--self` / `--extensions` / `--all` の組み合わせ)。対象が extensions / models / 単一ソースになる形
- all: `--all` 単独、`--self --extensions`、`self` / `pi` と `--extensions` の組み合わせ
- self: 対象指定なし、`--self`、`self` / `pi`
- `--force`、`-a` / `--approve`、`-na` / `--no-approve` は対象を変えない。`--force` は自己更新に適用し、trust 指定は all のときに拡張更新へ転送する。`-l` / `--local` は update では pi のエラーになるため pass-through にする

all では、自己更新の成功後(置換しない成功を含む)に、インストール先の実行ファイル (`process.execPath`。rename 後は新しいファイルを指す) で `update --extensions` を spawn し、終了コードを伝播する。旧プロセスのコードで拡張更新を続けるのではなく、新しいコードで実行するためである。自己更新が失敗した場合は拡張更新を実行しない。

### Decision 4: 自己更新は同一ディレクトリの一時領域 + rename で行う

選択肢:

- **D1. インストール先ディレクトリ内の一時ディレクトリに書き、rename する**(採用)
- D2. `/tmp` に書いてからコピーする
- D3. インストール済みファイルへ直接上書きする

D1 を採る理由: rename が原子的で、EXDEV(ファイルシステムまたぎ)が構造的に発生しない。D2 は更新中に中断すると壊れた実行ファイルが残り得る。D3 は実行中ファイルへの書き込みが ETXTBSY になる。

流れ: 書き込み可否を確認 → 残骸の掃除(Decision 5)→ `<installDir>/.spirits-tmp-<pid>/` を作成 → 一時ファイルへストリーム保存しながら sha256 を計算 → `.sha256` と照合 → `chmod 0755` → インストール先へ rename → 一時ディレクトリを削除。

置換完了まで実行中プロセスは旧 inode を使い続けるため、実行中セッションには影響しない。同時実行では、各プロセスが PID ごとの一時ディレクトリを使い、検証済みの完全なファイルを rename する。そのため、最後に rename したものが残るだけで、中途半端なファイルにはならない。

### Decision 5: 一時ファイルの後始末は PID 付きの名前とシグナル処理で行う

選択肢:

- **P1. 一時ディレクトリ名に PID を含め、開始時に PID が存在しない残骸だけを削除する**(採用)
- P2. ロックファイルで実行を直列化し、ロック取得後に残骸をすべて削除する
- P3. 一定時間より古い残骸を削除する

P1 を採る理由: TS(`process.kill(pid, 0)`)と POSIX sh(`kill -0 "$pid"`)の両方で同じ判定ができ、実行中の別プロセスの一時ディレクトリを消さない。ESRCH(該当プロセスなし)の場合だけ削除し、EPERM(他ユーザーのプロセス)の場合は生存とみなす。P2 は異常終了したロックの扱いが必要になり、sh と TS でロックの扱いを揃える必要がある。P3 は根拠の無い閾値が必要になり、閾値を超えた長時間のダウンロードの一時ファイルを消しうる。

自己更新と install.sh は同じ接頭辞 `.spirits-tmp-<pid>` を使い、互いの残骸も掃除する。失敗時は自身の一時ディレクトリを削除する。SIGINT / SIGTERM では、ハンドラで一時ディレクトリを削除し、非ゼロ(130 / 143)で終了する。install.sh は既存の `trap … EXIT INT TERM` を一時ディレクトリの場所に合わせて使う。install.sh の残骸削除は、プラットフォーム検査、`--uninstall` の処理、依存コマンドの検査より後、版の解決より前に行う。`--uninstall` はファイルを変更してはならない(既存要件「アンインストールの案内」)ためである。

updater(TS 側)の残骸削除も同じ位置に置く。すなわち、拒否ガード(未コンパイル・非対応プラットフォーム・書込不可・`PI_OFFLINE`)をすべて通過した後、リリース解決の前に行う。置換しない成功(最新・最新より新しい)やリリース解決の失敗など、置換に進まない経路でも残骸が掃除されるようにするためである。書込不可の判定もこの拒否ガードの一部として no-op 判定より前に行い、最新版でも配置先が書込不可なら拒否する。

### Decision 6: install.sh の同版判定は `--version` 表示を使う

選択肢:

- **I1. latest 解決時だけ、インストール済みバイナリの `--version` 出力を比較する**(採用)
- I2. サイドカーのバージョンファイルを置く
- I3. 判定せず常にダウンロードする(現状)

I1 を採る理由: `--version` は M2 からある公開インターフェースで、実ファイルと必ず一致する。I2 はファイルと実体が乖離し得る第二の真実源になる。I3 は不要な 94MB ダウンロードと「更新されたのか分からない」表示が残る。

判定方法: 出力の先頭行が `spirits <version> ...` の形なら、2 番目のフィールドをバージョンとする。ファイルが無い、`--version` が非ゼロで終了する、または形が合わない場合は、判定不能としてダウンロードへ進む(修復経路)。`VERSION=x.y.z` を明示した実行は意図的な再配置・修復とみなし、同版でも常にダウンロードして配置する。

版が異なれば、順序は比較せずに置換する。インストール済みが新しい prerelease の場合も、最新 stable へ置換する。POSIX sh で semver の順序比較を実装しないためであり、`spirits update`(置換しない)との違いは仕様に明記する。

表示: 同版なら `spirits <version> is already up to date`、置換したら `<old> -> <new>`(判定不能時は新しい版のみ)を表示する。

配置は `$INSTALL_DIR/.spirits-tmp-<pid>/` へダウンロードして `sha256sum -c` で検証し、`chmod 755` の後に rename する(Decision 4 と同じ理由)。検証失敗時は一時ディレクトリを削除し、既存ファイルを変更しない。

### Decision 7: PI_OFFLINE が有効なら自己更新を拒否する

選択肢:

- **O1. 拒否する**(採用)
- O2. 明示コマンドなので無視してネットワークにアクセスする

O1 を採る理由: pi は `PI_OFFLINE` で拡張更新のネットワーク処理を止める (`core/package-manager.ts` の `isOfflineModeEnabled`)。O2 では `--all` のうち自己更新だけがオフライン指定を無視する。

有効の判定は pi と同じ規則(`1`、または大文字小文字を区別しない `true` / `yes`)とする。拒否はネットワークアクセスの前に行い、`PI_OFFLINE` が有効なため更新しない旨と、`PI_OFFLINE` を解除して再実行する手段を表示する。pi の `--offline` フラグは、pi の update 文法では未知のオプションなので、Decision 3 により pi に渡り、pi のエラーになる。

### Decision 8: 無通信タイムアウトは既定 10 秒で、環境変数で上書きできる

選択肢:

- **T1. 無通信時間(要求の送信後、または最後の受信から)に上限を設ける**(採用)
- T2. 要求全体の所要時間に上限を設ける
- T3. 上限を設けない

T1 を採る理由: 停止した接続を検出しつつ、低速回線での 94MB のダウンロードを打ち切らない。T2 は回線速度に依存する値になる。T3 は `spirits update` が終わらなくなりうる。

実装: 要求ごとに `AbortController` を持ち、応答ヘッダの受信とボディの各チャンク受信のたびにタイマーをリセットする。上限に達したら abort し、無通信タイムアウトとして失敗理由を表示する。

既定値 `DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS = 10` と環境変数名 `ENV_UPDATE_IDLE_TIMEOUT_SECONDS = "SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS"` を `src/constants.ts` に置く。値の解釈は `src/config.ts` の `readLimit` と同じ規則(正の 10 進整数のみ。それ以外は既定値)とするが、`src/config.ts` は M4 の設定なので import せず、update モジュール内で解釈する。

### Decision 9: テストは fixture サーバと純関数で行い、リリース CI では版の異なる 2 つのバイナリで自己更新を確認する

選択肢:

- **T1. `Bun.serve` の fixture + 注入した fetch / ベース URL で bun test**(採用)
- T2. 実 GitHub Releases を叩く
- T3. コンパイルバイナリの手動テストのみ

T1 を採る理由: ネットワークと実リリースに依存せず、`scripts/install.test.sh` と同じ fixture 形状を再利用できる。`SPIRITS_API_BASE_URL` / `SPIRITS_RELEASE_BASE_URL` は install.sh と同じ名前を使う。install.sh は既存テストを拡張する。

リリース CI の自己更新スモークの選択肢:

- **C1. 古い版のバイナリを別にビルドし、リリース対象のバイナリへ自己更新させて `--version` を比較する**(採用)
- C2. fixture にスタブのファイルを置き、内容の変化だけを確認する
- C3. 同じビルドを fixture に置き、inode の変化と終了コードだけを確認する

C1 を採る理由: 仕様の「次回起動から新しいバージョンが使われる」を、リリース対象の実バイナリで直接検証できる。CI のビルド時間はほぼ倍になる。C2 と C3 は新しい版で起動することを検証できない。

手順: `scripts/build-binaries.ts` は出力先が `dist/spirits-linux-x64` に固定されている。このため、古い版(`--version 0.0.0-0`)をリリースビルドより先にビルドして `dist/` の外へ移す。リリースビルドが後に行われるので、リリース成果物は上書きされない。`0.0.0-0` は semver で最も低い版で、`spirits-v0.0.0-test` のような prerelease タグよりも古い。

既存のスモークは `dist/spirits-linux-x64 --version` がタグのバージョンを含むことも確認し、手順の順序が入れ替わってスモーク用のバイナリを公開する事故を防ぐ。

`scripts/self-update-smoke.sh <old> <new> <expected-version>` は、`python3 -m http.server` でリリース一覧(新しい版を stable として掲載)と成果物を配信し、一時インストール先へコピーした古いバイナリで `update` を実行する。終了コード 0、`--version` が期待する版を含むこと、`.spirits-tmp-*` が残らないことを確認する。

## Risks / Trade-offs

- [Risk] 0.1.0 のバイナリは自己更新を持たず、更新の起点になれない → Mitigation: identity 修正と合わせた最初のリリースに updater を含め、リリースノートと README に「0.1.0 からは install.sh の再実行が 1 回必要」と明記する
- [Risk] install.sh と updater の解決・検証規則がドリフトする → Mitigation: 規則を仕様で固定し、両テストで同じ fixture を使う。CI スモークで自己更新経路を検証する
- [Risk] bootstrap の top-level await や `process.execPath`、bundle 時のモジュール評価順の挙動が将来の Bun で変わる → Mitigation: 依存する保証を「本体が実行されないこと」に限定し(Decision 1)、リリース CI のスモークがコンパイル済み経路を検出する
- [Risk] 分類器が pi の引数文法の変化に追随できない → Mitigation: pi の `parsePackageCommand` の分岐に対応する表駆動テストを持ち、上流取り込みで `package-manager-cli.ts` の `update` 解析が変わった場合は表を見直す
- [Risk] GitHub API のレート制限やオフライン環境 → Mitigation: 更新は明示コマンド時のみ実行し、起動時チェックは行わない。失敗理由を表示し、`PI_OFFLINE` が有効なら拒否する(Decision 7)
- [Risk] settings.json の proxy 設定が自己更新に適用されない → Mitigation: 標準の環境変数 proxy を使うことを前提とし、必要になったら別 change で扱う。bootstrap が pi を import しない制約を優先する
- [Risk] rename 時の権限・ディスク不足で置換が失敗する → Mitigation: 事前に書き込み可否を確認し、失敗時は元ファイルを残してインストーラ再実行を案内する
- [Risk] PID の再利用で、残骸が生存プロセスのものと誤判定される → Mitigation: 誤判定は削除しない方向にしか働かない。残骸は、その PID のプロセスが終了した後の実行で削除される
- [Risk] CI でビルド順序が入れ替わり、スモーク用の古いバイナリが公開される → Mitigation: 公開前のスモークで `dist/spirits-linux-x64 --version` がタグの版を含むことを確認する(Decision 9)

## Migration Plan

1. `spirits-m2-verify` の identity 修正を含めてリリースを切る(0.1.0 は `spirits update` が pi 名義になるため)
2. 0.1.0 利用者は 1 回だけ install.sh を再実行する。以降は `spirits update` が使える
3. ロールバックは install.sh の `VERSION=<previous>` による再配置で行う。`spirits update` は常に最新 stable を選ぶため、`spirits update` で旧版へ戻すには、新しい版のリリースを取り下げる(削除するか prerelease に変更する)必要がある
