# managed-pi Specification

## Purpose

公式 Pi の固定成果物と spirits 拡張 bundle を対応付けて導入し、通常の spirits 起動とは別の明示的な実験経路で起動できるようにする。既定経路、既存データ、Pi コアを変更せず、専用経路の失敗を旧経路への暗黙の切り替えで隠さない。

## Requirements

### Requirement: 実験経路の明示選択
システムは、専用 Pi を使う隔離経路 `spirits managed-pi` を、利用者が明示的に指定した場合だけ起動しなければならない。(SHALL)
隔離経路は、システムの `pi`、PATH 上の `pi`、既定の compiled spirits を暗黙に使用してはならない。(MUST)
専用 Pi が未導入、破損、非対応の場合、隔離経路は理由と復旧手順を表示して非ゼロで終了し、既定経路へ黙って切り替えてはならない。(MUST)
隔離経路は、起動前に実行プラットフォームが対応表の platform と一致することを確認し、一致しない場合は Pi を spawn せず理由を表示して非ゼロで終了しなければならない。(MUST)
この要件が対象にするのは隔離経路であり、既定経路の agent dir と引数の扱いは別の要件が定める。(MUST)

#### Scenario: 明示指定による起動
- **WHEN** 利用者が専用 Pi の導入後に `spirits managed-pi -- --help` を実行する
- **THEN** 絶対パスで管理された専用 Pi が起動し、システムの `pi` は使用されない

#### Scenario: 明示指定なしの通常起動
- **WHEN** 利用者が `spirits` を引数なしで実行する
- **THEN** 隔離経路の明示選択は適用されず、既定経路の managed が起動する

#### Scenario: 未導入時の失敗
- **WHEN** 専用 Pi を導入せずに `spirits managed-pi` を実行する
- **THEN** 専用 Pi が未導入である旨と導入コマンドが表示され、終了コードは非ゼロになり、システムの `pi` は起動しない

#### Scenario: 破損時の非 fallback
- **WHEN** 管理された専用 Pi の実行ファイルが改変され、記録されたチェックサムと一致しない状態で `spirits managed-pi` を実行する
- **THEN** 整合性検証の失敗が表示され、終了コードは非ゼロになり、既定経路へ切り替わらない

#### Scenario: 非対応プラットフォーム
- **WHEN** 対応表が `linux-x64` の専用 Pi を別のプラットフォームで起動しようとする
- **THEN** 非対応である旨と復旧手順が表示され、終了コードは非ゼロになり、Pi は spawn されない

### Requirement: 専用成果物の対応付けと導入
システムは、専用 Pi の版、Pi artifact のチェックサム、spirits 拡張 bundle の版とチェックサム、必要なアセット、対象プラットフォームを 1 つの対応表として扱わなければならない。(SHALL)
導入は、実行前にすべての成果物の取得元とチェックサムを検証し、1 つでも不一致または欠落があれば何も配置してはならない。(MUST)
導入先は通常の `~/.spirits/bin` および `~/.spirits/agent` のファイルを置換してはならない。(MUST)

#### Scenario: 対応する組の導入
- **WHEN** 対応表に記録された Pi artifact、拡張 bundle、アセットをすべて取得でき、チェックサムが一致する
- **THEN** 専用経路用の領域に成果物が配置され、導入が成功した旨と Pi と拡張の版が表示される

#### Scenario: チェックサム不一致
- **WHEN** 拡張 bundle のチェックサムが対応表と一致しない
- **THEN** 配置は行われず、既存の導入済み成果物は変更されず、終了コードは非ゼロになる

#### Scenario: 組み合わせの不一致
- **WHEN** 対応表に記録されていない Pi の版を指定して導入する
- **THEN** 未対応の組み合わせである旨が表示され、成果物は配置されない

#### Scenario: 通常配布物の維持
- **WHEN** 専用 Pi を導入する
- **THEN** `~/.spirits/bin/spirits`、`~/.spirits/bin/theme/`、既存の `spirits update` の動作は変更されない

### Requirement: 明示的な更新と復旧
システムは、専用 Pi の更新を明示的な更新操作でのみ行い、実験経路の起動時に最新版の確認や自動更新を行ってはならない。(MUST)
更新に失敗した場合、更新前の検証済み成果物を起動可能なまま残さなければならない。(SHALL)
再導入は、既存の専用経路用成果物が破損または欠落している場合に、対応表の同じ組へ復旧できなければならない。(SHALL)

#### Scenario: 起動時に更新しない
- **WHEN** 専用 Pi の新しい版が公開された後に `spirits managed-pi` を起動する
- **THEN** ネットワークによる版の確認や自動更新は発生せず、導入済みの版で起動する

#### Scenario: 明示更新
- **WHEN** 利用者が `spirits managed-pi update` を実行し、新しい対応表の取得と検証に成功する
- **THEN** 専用 Pi と拡張 bundle が対応する組に置き換わり、次回の実験経路の起動から新しい組が使われる

#### Scenario: 更新失敗時の維持
- **WHEN** 更新の途中でチェックサム検証または配置が失敗する
- **THEN** 終了コードは非ゼロになり、更新前の専用 Pi と拡張 bundle はそのまま起動できる

#### Scenario: 破損からの復旧
- **WHEN** 専用経路用の拡張 bundle が欠落している状態で同じ版を再導入する
- **THEN** 対応表の検証済み bundle が再配置され、実験経路が再び起動できる

### Requirement: 起動前の identity と保存先の確定
システムは、隔離経路の起動において、`--help`、`--version` を含む Pi の実行前に、専用 Pi のアプリ名を spirits に固定し、保存先を `<managed root>/agent` の隔離 agent dir に確定しなければならない。(SHALL)
隔離経路の未指定時の保存先は `~/.spirits/managed-pi/agent` とし、既存の `~/.spirits/agent` を使ってはならない。(MUST)
隔離経路では `PI_CODING_AGENT_DIR` および旧名の session dir を保存先の指定として読んではならない。(MUST)
`SPIRITS_CODING_AGENT_DIR` が未指定の場合、および wrapper が通常経路向けに注入した既定値だけが存在する場合は、明示指定として扱わず、固定の隔離 agent dir を使わなければならない。(MUST)
`PI_PACKAGE_DIR` は専用 Pi の package dir に固定するか除去し、外部の値で app 名、版、アセットを差し替えられてはならない。(MUST)
この要件は隔離経路にだけ適用し、既定経路の保存先は「既定経路の agent dir」が定める。(MUST)

#### Scenario: 保存先の既定値
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せずに `spirits managed-pi --help` を実行する
- **THEN** 専用 Pi の表示は spirits になり、保存先は `<home>/.spirits/managed-pi/agent` として解決され、既存の `~/.spirits/agent` は作成も変更もされず、通常経路向けの既定注入は明示指定として扱われない

#### Scenario: 明示された保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR` に `<home>/.spirits/managed-pi/agent` と同じ実体パスを設定して `spirits managed-pi` を起動する
- **THEN** その隔離 agent dir だけが保存先として使われ、既存の `~/.spirits/agent` は使われない

#### Scenario: 旧環境変数の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` と旧名の session dir を設定して `spirits managed-pi` を起動する
- **THEN** 保存先は `/tmp/old-agent` ではなく隔離 agent dir になり、session dir もその配下になる

#### Scenario: package dir の差し替え防止
- **WHEN** `PI_PACKAGE_DIR` に別の package.json を持つディレクトリを指定して `spirits managed-pi --version` を実行する
- **THEN** app 名、版、アセットは専用 Pi の対応表の値のままで、指定した package の値にはならない

### Requirement: 隔離 agent dir のパス安全性
システムは、隔離経路の隔離 agent dir を起動前に解決し、既存 agent dir との一致・包含、symlink、managed root 外への解決、ディレクトリ以外の実体を検出した場合、Pi を spawn せず理由付きで非ゼロ終了し、既定経路へ fallback してはならない。(MUST)
隔離 agent dir は実ディレクトリとして必要な場合だけ作成し、所有者だけが読み書きできる権限にしなければならない。(SHALL)
パス判定は正規化と実体パスで行い、OS レベルのサンドボックスを提供するものではない。(MUST)
この検査を既定経路に適用してはならない。(MUST)

#### Scenario: 既存 agent dir との一致
- **WHEN** 隔離 agent dir の実体パスが既存 `~/.spirits/agent` と一致する、または一方が他方を包含する
- **THEN** 隔離経路の起動は拒否され、既存 agent dir は変更されず、理由と安全な実験開始手順が表示される

#### Scenario: symlink の拒否
- **WHEN** `<managed root>/agent` またはその既存の構成要素が symlink で、既存 agent dir や managed root 外を指す
- **THEN** 隔離経路の起動は拒否され、Pi は spawn されず、既存 agent dir は変更されない

#### Scenario: 安全な隔離ディレクトリの作成
- **WHEN** 一時 HOME の managed root に symlink のない隔離 agent dir がまだ存在しない
- **THEN** 起動前に実ディレクトリが所有者のみ読み書き可能な権限で作成され、子プロセスの保存先はそのディレクトリになる

#### Scenario: ディレクトリ以外の実体
- **WHEN** `<managed root>/agent` が通常ファイルまたは managed root 外を指すパスとして存在する
- **THEN** 隔離経路の起動は拒否され、Pi は spawn されない

#### Scenario: 既定経路には適用しない
- **WHEN** 既定経路で `~/.spirits/agent` を agent dir として managed を起動する
- **THEN** 隔離 agent dir のパス安全性の検査は行われず、起動は拒否されない

### Requirement: 隔離保存先の明示指定
システムは、隔離経路において `SPIRITS_CODING_AGENT_DIR` が利用者により明示された場合、正規化とパス安全性の検査の後に隔離 agent dir と一致するときだけ受け付けなければならない。(SHALL)
一致しない指定、相対パス、`~` 指定、managed root 外を指す指定は、Pi を spawn せず理由付きで非ゼロ終了しなければならない。(MUST)
拒否時は隔離 agent dir を作成してはならない。(MUST)
警告の承認や force でこの判定を解除する機能を提供してはならない。(MUST)
この要件は隔離経路にだけ適用し、既定経路は agent dir を任意の場所に許す。(MUST)

#### Scenario: 一致しない明示指定
- **WHEN** `SPIRITS_CODING_AGENT_DIR=~/.spirits/agent` または任意の `/tmp/agent` を設定して `spirits managed-pi` を起動する
- **THEN** 起動は拒否され、指定されたパスは使われず、既存 agent dir も隔離 agent dir も作成・変更されない

#### Scenario: 相対パスと managed root 外
- **WHEN** `SPIRITS_CODING_AGENT_DIR` に相対パス、`~` を含むパス、または managed root 外へ解決されるパスを設定して隔離経路を起動する
- **THEN** 起動は拒否され、Pi は spawn されず、理由と固定された隔離 agent dir が表示される

#### Scenario: force の不在
- **WHEN** 利用者が拒否を回避するための追加オプションや環境変数を探す
- **THEN** 警告の承認や force で隔離判定を解除する機能は存在しない

#### Scenario: 既定経路では受理する
- **WHEN** 同じ `SPIRITS_CODING_AGENT_DIR=/tmp/agent` を設定して既定経路を起動する
- **THEN** 拒否せず、そのパスが agent dir として専用 Pi に渡る

### Requirement: 継承環境と session dir の sanitize
システムは、隔離経路の managed Pi の起動時に、identity と保存先を変える継承環境変数を固定または除去しなければならない。(MUST)
app 名と project config dir は managed bundle の `package.json` overlay だけで決め、子プロセスの環境変数としては立てない。(MUST) overlay 以外の経路で app 名や config dir を差し替えてはならない。(MUST)
隔離経路では `SPIRITS_CODING_AGENT_SESSION_DIR` を隔離 agent dir 配下に固定し、旧名の session dir および `PI_CODING_AGENT_DIR` は除去しなければならない。(MUST)
API キー、proxy、provider 設定など、保存先と identity 以外の変数は保持しなければならない。(MUST)

#### Scenario: identity の overlay 一本化
- **WHEN** managed 起動で子プロセスに渡す環境を組み立てる
- **THEN** app 名と config dir を指定する環境変数は含まれず、identity は overlay の `package.json` からのみ決まる

#### Scenario: identity の継承値
- **WHEN** 親環境に異なる app 名指定や config dir 指定、`PI_CODING_AGENT_DIR` が設定されている
- **THEN** 子プロセスではそれらが除去または無視され、identity は overlay の `package.json` からのみ決まり、既存 agent dir は使われない

#### Scenario: session dir の固定
- **WHEN** 親環境に `SPIRITS_CODING_AGENT_SESSION_DIR` または旧名の session dir が設定されている
- **THEN** 隔離経路の子プロセスの session dir は隔離 agent dir 配下になり、親の指定した外部 session dir は使われない

#### Scenario: 必要な環境変数の保持
- **WHEN** API キー、proxy、provider 設定を設定して managed 起動を行う
- **THEN** それらの値は子プロセスに引き継がれ、保存先と identity の sanitize だけが行われる

### Requirement: managed 起動のパス指定引数の制限
システムは、隔離経路の起動引数のうち、既存データや外部 session を指せる `--session`、`--fork`、`--session-dir`、`--export` を拒否しなければならない。(MUST)
`--continue`、`--resume`、`--session-id` は固定された隔離 session dir の範囲で許可しなければならない。(SHALL)
拒否時は Pi を spawn せず、引数名と安全な代替を表示して非ゼロ終了しなければならない。(MUST)
この制限を既定経路に適用してはならない。(MUST)

#### Scenario: 外部 session dir の拒否
- **WHEN** `spirits managed-pi --session-dir ~/.spirits/agent/sessions` を実行する
- **THEN** 起動は拒否され、Pi は spawn されず、固定された隔離 session dir を使う案内が表示される

#### Scenario: 外部 session ファイルの拒否
- **WHEN** `spirits managed-pi` の `--session`、`--fork`、`--export` に既存 agent dir 配下のパスを指定する
- **THEN** 起動は拒否され、既存 session は読まれず、Pi は spawn されない

#### Scenario: 隔離 session dir 内の再開
- **WHEN** `--continue`、`--resume`、`--session-id` を指定して隔離経路を起動する
- **THEN** session の探索と保存は隔離 agent dir 配下の session dir に限定される

#### Scenario: 既定経路では拒否しない
- **WHEN** 既定経路で `--session`、`--fork`、`--session-dir`、`--export` を指定する
- **THEN** 引数はそのまま専用 Pi へ渡り、拒否メッセージは出ない

### Requirement: 必要な環境変数の保持
システムは、identity と保存先の確定のために干渉する変数だけを処理し、API キー、proxy、認証情報など Pi の実行に必要な環境変数を一律に削除してはならない。(MUST)
作業ディレクトリは Pi の project 探索にだけ使い、システム Pi の agent dir や設定を読んではならない。(MUST)

#### Scenario: API キーと proxy の保持
- **WHEN** `ANTHROPIC_API_KEY` と `HTTPS_PROXY` を設定して `spirits managed-pi` を起動する
- **THEN** 専用 Pi のプロセス環境に両方の値が引き継がれる

#### Scenario: システム Pi の設定を読まない
- **WHEN** 実 HOME に `~/.pi/agent/settings.json` があり、隔離した HOME で `spirits managed-pi --help` を実行する
- **THEN** 専用経路は実 HOME の `~/.pi` を読み書きせず、隔離した保存先だけを使う

### Requirement: 拡張 bundle とホスト SDK の一体性
システムは、専用 Pi に読み込む spirits 拡張を、Markdown などのアセットを文字列として埋め込んだ事前 bundle として配布しなければならない。(SHALL)
bundle は Pi が提供する host module を external に保ち、Pi SDK、TUI、typebox の別実体を内包してはならない。(MUST)
専用 Pi 上で rlm の子セッションを生成する場合、親と同じホスト実体の SDK を使わなければならない。(SHALL)

#### Scenario: Markdown アセットの保持
- **WHEN** 専用 Pi で bundle 済み拡張をロードし、同梱スキルを書き出す
- **THEN** 書き出された `SKILL.md` は raw Markdown であり、HTML 化された内容ではない

#### Scenario: host module の同一性
- **WHEN** 専用 Pi で bundle 済み拡張をロードし、拡張が参照する Pi の版を確認する
- **THEN** 参照される版は専用 Pi artifact の版と一致し、bundle 内の別の Pi SDK の版にはならない

### Requirement: 不足 API の限定互換モード
システムは、専用 Pi のホストに spirits が必要とする任意 API が無い場合、拡張全体のロードを失敗させず、文書化された限定互換モードでロードしなければならない。(SHALL)
限定互換モードでは、利用できない機能を起動時に明示し、利用可能であるかのように表示してはならない。(MUST)
既存の通常起動で同じ API が利用できる場合、限定互換モードを使ってはならない。(MUST)

#### Scenario: role API が無い場合のロード
- **WHEN** 専用 Pi のホストに role 登録 API が無い状態で `spirits managed-pi` を起動する
- **THEN** spirits 拡張はロードされ、`tsrepl` と TODO と harness のツールが登録され、role 関連機能が制限される旨が表示される

#### Scenario: role API がある場合の通常動作
- **WHEN** role 登録 API を持つホストで spirits 拡張を起動する
- **THEN** 限定互換モードは使われず、既存の role 登録と `/model` 連携の動作が使われる

### Requirement: 既存データの非破壊な利用
隔離経路は、実験期間中、既存の `~/.spirits/agent` を直接利用してはならない。(MUST)
隔離経路は、既存 agent dir の自動コピー、移行、同期、削除、バックアップ作成を行ってはならない。(MUST)
既定経路は fork と同じ agent dir を利用し、初回起動前のバックアップだけが「初回起動前の agent dir バックアップ」の要件に従って行われる。(SHALL)
通常の `spirits` 起動は既定経路の managed であり、その保存先は agent dir の要件が定める。(SHALL)

#### Scenario: 既存設定の読み取り
- **WHEN** 既存 `~/.spirits/agent` に settings、auth、sessions、extensions がある状態で隔離経路を起動する
- **THEN** 隔離経路はそれらを自分の agent dir として読み込まず、隔離 agent dir を使い、既存ファイルを変更しない

#### Scenario: 既存 agent dir の不変
- **WHEN** 一時 HOME の `~/.spirits/agent` に settings、auth、sessions、extensions の fixture を置き、その HOME で隔離経路の install、update、repair、help、version、起動を行う
- **THEN** 既存 agent dir の内容と更新時刻は操作の前後で変わらない

#### Scenario: 自動移行をしない
- **WHEN** 隔離経路を初めて起動する
- **THEN** 既存データの自動コピー、自動変換、バックアップの自動作成、旧ディレクトリの削除は行われず、隔離 agent dir だけが使われる

#### Scenario: 変換が必要な操作の記録
- **WHEN** 互換性ランナーの書き込み互換判定に、変換を必要とする操作を渡す
- **THEN** 結果は成功ではなく `limited` と `aborted` の理由を含み、隔離経路が触れた agent dir の fixture は変更されず、書き込み互換は未確認であることを記録に残す

#### Scenario: 書き込み互換の未確認表示
- **WHEN** managed 経路の利用者向け文書 (`docs/spirits-managed-pi.md`、`packages/spirits/README.md`) と実測記録を確認する
- **THEN** 既存データの書き込み互換について `docs/agent-data-compat` の実測範囲とその未確認部分を区別して示し、実測していない範囲を実証済みとして記載しない

#### Scenario: 通常経路の維持
- **WHEN** 同じ HOME で既定経路の `spirits` を起動する
- **THEN** 保存先は `~/.spirits/agent` になり、`~/.spirits/managed-pi/agent` は使わない

### Requirement: managed コマンドの副作用
システムは、`install`、`update`、`repair`、wrapper `help` が既存 agent dir と隔離 agent dir を作成・変更してはならない。(MUST)
隔離経路の `--help`、`--version`、通常起動は、Pi の起動前に隔離 agent dir を確定し、既存 agent dir を作成・変更してはならない。(MUST)
隔離 agent dir の作成は隔離経路の起動時にだけ行い、既存データのコピーや移行を含んではならない。(SHALL)
初回起動前の agent dir バックアップは既定経路の起動時にだけ行う。(MUST)

#### Scenario: 導入と復旧の副作用
- **WHEN** `spirits managed-pi install`、`update`、`repair`、または wrapper の `help` を実行する
- **THEN** 既存 agent dir と隔離 agent dir のどちらも作成・変更されず、`~/.spirits/backups` にも何も作られない

#### Scenario: Pi の help と version
- **WHEN** `spirits managed-pi --help` または `spirits managed-pi --version` を実行する
- **THEN** Pi の起動前に隔離 agent dir が確定し、既存 agent dir は作成・変更されない

#### Scenario: 通常 managed 起動
- **WHEN** 引数なしの `spirits managed-pi` を実行する
- **THEN** 隔離 agent dir が保存先になり、既存 agent dir のコピー、移行、同期は行われない

### Requirement: 専用経路の非依存性
専用経路の起動と互換性テストは、M3 以降の機能(rlm、Continual Harness、Phase 2)の存在を前提に、通常起動や配布の既定経路を変更してはならない。(MUST)
専用経路の起動は、Pi の更新確認、既定経路の自己更新、テレメトリの既定動作を変更してはならない。(MUST)

#### Scenario: 既定経路の非変更
- **WHEN** 専用経路を導入した後に通常の `spirits` と `spirits update` を実行する
- **THEN** それぞれの出力、保存先、終了コードは専用経路の導入前と同じである

#### Scenario: 更新通知の非変更
- **WHEN** 専用経路を起動する
- **THEN** 既存の `PI_SKIP_VERSION_CHECK` とテレメトリの既定値が通常起動と異なる扱いを受けない

### Requirement: 中核でない機能の失敗は中核に伝播しない
Pi は拡張の初期化関数が例外を出したとき、その拡張が登録したものを全て取り捨てる。managed 経路は、中核(`tsrepl`、`rlm`、memory / goal / skills / prompts、同梱 OpenSpec skill、session TODO)以外機能の登録失敗で中核まで利用不可にしてはならない。(MUST)
失敗した機能は起動時の通知で 1 回だけ名指しし、同じ失敗を繰り返し通知してはならない。(MUST) 中核の登録失敗は、引き続きロード失敗として扱う。
routing が登録できない場合でも `rlm` は動作を保つ。(MUST) 親が物理モデルを選ぶ場合はそのままそのモデルを子に渡し、親が `spirits/auto` を選ぶ場合は保存済みの既定 role で強弱を決める。
route の途中で role badge の更新が失敗しても、そのリクエストを止めてはならない。(MUST)

#### Scenario: 仮想モデルを受け取れない host
- **WHEN** `registerVirtualModel` が例外を出す host で spirits 拡張を起動する
- **THEN** `tsrepl`、`rlm`、harness のツール、session TODO は登録されており、routing が使えない旨が 1 回だけ伝えられる

#### Scenario: コマンドを受け取れない host
- **WHEN** `registerCommand` が例外を出す公式 Pi で spirits 拡張を起動する
- **THEN** 中核は登録されており、専用コマンドが使えない旨が 1 回だけ伝えられる

#### Scenario: footer が書けない host
- **WHEN** route が role を決めた後、role badge の status 行の書き込みが例外を出す
- **THEN** そのリクエストは route の選んだモデルで返り、例外は利用者に届かない

### Requirement: 既定の managed 起動
システムは、コンパイル済み `spirits` の既定の起動経路として managed を起動しなければならない。(SHALL)
managed の起動は、検証済みの専用 Pi を絶対パスで spawn し、spirits 拡張 bundle を `-e` で読み込む。(SHALL)
既定経路は PATH 上の `pi`、システムの `pi`、fork の実行ファイルを使用してはならない。(MUST)

#### Scenario: 既定の起動
- **WHEN** `SPIRITS_ROUTE` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** 検証済みの専用 Pi が spirits 拡張 bundle とともに起動し、fork の実行ファイルは起動しない

#### Scenario: 未コンパイル実行は fork
- **WHEN** ソースから `bun packages/spirits/bin/spirits.ts` を起動する
- **THEN** managed の取得・検証・spawn は行わず、従来の fork が起動する

### Requirement: 既定経路の agent dir
既定経路の managed は、fork と同じ規則で agent dir を決めなければならない。(SHALL)
すなわち `SPIRITS_CODING_AGENT_DIR` が設定済みならその値を、未設定なら `~/.spirits/agent` を使い、旧名 `PI_CODING_AGENT_DIR` は保存先の指定として読まない。(MUST)
既定経路は agent dir のコピー、移行、同期を行ってはならない。(MUST)

#### Scenario: 既定の保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せずに既定経路で managed を起動する
- **THEN** 子プロセスの agent dir は `~/.spirits/agent` になり、`~/.spirits/managed-pi/agent` は使われない

#### Scenario: 明示された保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR=/tmp/spirits-agent` を設定して既定経路で managed を起動する
- **THEN** 子プロセスの agent dir は `/tmp/spirits-agent` になる

#### Scenario: 旧環境変数の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` だけを設定して既定経路で managed を起動する
- **THEN** agent dir は `/tmp/old-agent` ではなく `~/.spirits/agent` になる

### Requirement: 既定経路の引数透過
既定経路は、今の fork と同じ CLI 引数を `--` なしでそのまま受け付け、専用 Pi へ渡さなければならない。(SHALL)
`--continue`、`--resume`、`--session`、`--fork`、`--session-dir`、`--export` を含む Pi の引数を既定経路で拒否してはならない。(MUST)
spirits のサブコマンド (`update`、`managed-pi`) と `--version` / `-v` の扱いは従来のままなければならない。(SHALL)

#### Scenario: 既存 session の指定
- **WHEN** 既定経路で `spirits --session <file>` を実行する
- **THEN** 引数を書き換えずに専用 Pi へ渡し、拒否メッセージを出さない

#### Scenario: 継続と再開
- **WHEN** 既定経路で `spirits --continue` および `spirits --resume` を実行する
- **THEN** 専用 Pi にそのまま渡り、起動は拒否されない

#### Scenario: サブコマンドは従来のまま
- **WHEN** 既定経路化後に `spirits update` と `spirits managed-pi help` を実行する
- **THEN** それぞれ自己更新と managed wrapper help が従来どおり実行される

### Requirement: 初回起動前の agent dir バックアップ
システムは、既定経路で managed を初めて起動する前に、その agent dir のバックアップを 1 回だけ取得しなければならない。(SHALL)
保存先は `~/.spirits/backups/agent-<UTC 時刻>/` とし、ファイルとディレクトリのパーミッションを保ち、実行済みであることを managed root に記録して 2 回目以降は取得しない。(SHALL)
agent dir が存在しない場合は何もコピーせず、実行済みだけを記録する。(SHALL)
バックアップの保存先とサイズ、およびシンボリックリンクとその参照先を表示しなければならない。(SHALL)

#### Scenario: 1 回だけの取得
- **WHEN** 既存 agent dir がある環境で既定経路の managed を 2 回起動する
- **THEN** バックアップは 1 回目だけ取得され、2 回目は `~/.spirits/backups` に新しいディレクトリが増えない

#### Scenario: シンボリックリンクはリンクのまま
- **WHEN** agent dir に `skills -> ~/.pi/agent/skills` のシンボリックリンクがある状態でバックアップを取る
- **THEN** 保存先でもそれはシンボリックリンクであり参照先の内容はコピーされず、リンクと参照先が表示される

#### Scenario: 保存先とサイズ
- **WHEN** バックアップが完了する
- **THEN** 保存先のパスとコピーしたサイズが表示される

#### Scenario: 失敗時は起動しない
- **WHEN** バックアップの取得中に書き込みエラーが起こる
- **THEN** 専用 Pi は spawn されず、理由が表示され、終了コードは非ゼロになる

### Requirement: 一式の取得元は起動役のリリース
システムは、managed の一式（公式 Pi artifact と spirits 拡張 bundle）の取得元を、動作中の起動役バイナリと同じリリースの manifest から決めなければならない。(SHALL)
最新リリースの manifest を既定として使用してはならない。(MUST)

#### Scenario: 同じリリースの manifest
- **WHEN** 0.7.0 の起動役バイナリが `spirits-v0.7.0` のリリースを解決して managed の一式を取得する
- **THEN** manifest、bundle、公式 Pi artifact はすべて `spirits-v0.7.0` から取得される

#### Scenario: 後から出た最新版を取らない
- **WHEN** 0.7.0 の起動役バイナリが動作し、`spirits-v0.8.0` が公開済みである
- **THEN** 0.7.0 のバイナリが取得する manifest は `spirits-v0.7.0` のものである

### Requirement: 既定経路の一式の欠落と失敗時の挙動
システムは、既定経路の起動時に managed の一式が未導入の場合、同じ規則で取得して導入しなければならない。(SHALL)
取得に失敗した場合、および導入済みの一式が破損して検証を通らない場合は、専用 Pi を spawn せず、理由、修復コマンド `spirits managed-pi repair`、および `SPIRITS_ROUTE=fork` で起動する方法を表示して非ゼロで終了しなければならない。(MUST)
失敗を理由に黙って fork へ切り替えてはならない。(MUST)

#### Scenario: 未導入時の自動取得
- **WHEN** managed の一式が未導入の環境で既定経路の managed を起動する
- **THEN** 起動役と同じリリースの一式を取得・検証して導入し、続いて専用 Pi を起動する

#### Scenario: 破損時の非 fallback
- **WHEN** 導入済みの拡張 bundle が記録されたチェックサムと一致しない状態で既定経路の managed を起動する
- **THEN** 専用 Pi は spawn されず、理由と `spirits managed-pi repair` と `SPIRITS_ROUTE=fork` が表示され、終了コードは非ゼロになる

#### Scenario: 取得失敗時の非 fallback
- **WHEN** 一式の取得中にネットワークエラーが起こる
- **THEN** 理由と修復コマンドと fork 起動方法が表示され、終了コードは非ゼロになり、fork は起動しない
