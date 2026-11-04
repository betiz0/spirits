# Spec Delta

## MODIFIED Requirements

### Requirement: 起動前の identity と保存先の確定
システムは、`--help`、`--version` を含む Pi の実行前に、専用 Pi のアプリ名を spirits に固定し、保存先を `<managed root>/agent` の隔離 agent dir に確定しなければならない。(SHALL)
未指定時の保存先は `~/.spirits/managed-pi/agent` とし、既存の `~/.spirits/agent` を使ってはならない。(MUST)
`PI_CODING_AGENT_DIR` および旧名の session dir を保存先の指定として読んではならない。(MUST)
`SPIRITS_CODING_AGENT_DIR` が未指定の場合、および wrapper が通常経路向けに注入した既定値だけが存在する場合は、明示指定として扱わず、固定の隔離 agent dir を使わなければならない。(MUST)
`PI_PACKAGE_DIR` は専用 Pi の package dir に固定するか除去し、外部の値で app 名、版、アセットを差し替えられてはならない。(MUST)

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

### Requirement: 既存データの非破壊な利用
実験期間中、managed 経路は既存の `~/.spirits/agent` を直接利用してはならない。(MUST)
既存 agent dir の自動コピー、移行、同期、削除、バックアップ作成を行ってはならない。(MUST)
書き込み互換が未確認である間、利用者向け文書と訂正記録は、書き込み互換を実証済みとして扱ってはならない。(MUST)
通常の `spirits` 起動は既存 `~/.spirits/agent` を従来どおり使わなければならない。(MUST)

#### Scenario: 既存設定の読み取り
- **WHEN** 既存 `~/.spirits/agent` に settings、auth、sessions、extensions がある状態で managed 起動を実行する
- **THEN** managed 経路はそれらを自分の agent dir として読み込まず、隔離 agent dir を使い、既存ファイルを変更しない

#### Scenario: 既存 agent dir の不変
- **WHEN** 一時 HOME の `~/.spirits/agent` に settings、auth、sessions、extensions の fixture を置き、その HOME で managed の install、update、repair、help、version、通常起動を行う
- **THEN** 既存 agent dir の内容と更新時刻は操作の前後で変わらない

#### Scenario: 自動移行をしない
- **WHEN** managed 経路を初めて起動する
- **THEN** 既存データの自動コピー、自動変換、バックアップの自動作成、旧ディレクトリの削除は行われず、隔離 agent dir だけが使われる

#### Scenario: 変換が必要な操作の記録
- **WHEN** 互換性ランナーの書き込み互換判定に、変換を必要とする操作を渡す
- **THEN** 結果は成功ではなく `limited` と `aborted` の理由を含み、既存 agent dir の fixture は変更されず、書き込み互換は未確認として訂正記録に残る

#### Scenario: 書き込み互換の未確認表示
- **WHEN** managed 経路の利用者向け文書 (`docs/spirits-managed-pi.md`、`packages/spirits/README.md`) と訂正記録を確認する
- **THEN** 既存データの書き込み互換は未確認であること、本番移行前に別 change で読み書き互換を実証することが記載され、実証済みとしては記載されていない

#### Scenario: 通常経路の維持
- **WHEN** 同じ HOME で通常の `spirits` を起動する
- **THEN** 通常経路は従来どおり `~/.spirits/agent` を使い、managed の隔離 agent dir は使わない

## ADDED Requirements

### Requirement: 隔離 agent dir のパス安全性
システムは、隔離 agent dir を起動前に解決し、既存 agent dir との一致・包含、symlink、managed root 外への解決、ディレクトリ以外の実体を検出した場合、Pi を spawn せず理由付きで非ゼロ終了し、通常経路へ fallback してはならない。(MUST)
隔離 agent dir は実ディレクトリとして必要な場合だけ作成し、所有者だけが読み書きできる権限にしなければならない。(SHALL)
パス判定は正規化と実体パスで行い、OS レベルのサンドボックスを提供するものではない。(MUST)

#### Scenario: 既存 agent dir との一致
- **WHEN** 隔離 agent dir の実体パスが既存 `~/.spirits/agent` と一致する、または一方が他方を包含する
- **THEN** 起動は拒否され、既存 agent dir は変更されず、理由と安全な実験開始手順が表示される

#### Scenario: symlink の拒否
- **WHEN** `<managed root>/agent` またはその既存の構成要素が symlink で、既存 agent dir や managed root 外を指す
- **THEN** 起動は拒否され、Pi は spawn されず、既存 agent dir は変更されない

#### Scenario: 安全な隔離ディレクトリの作成
- **WHEN** 一時 HOME の managed root に symlink のない隔離 agent dir がまだ存在しない
- **THEN** 起動前に実ディレクトリが所有者のみ読み書き可能な権限で作成され、子プロセスの保存先はそのディレクトリになる

#### Scenario: ディレクトリ以外の実体
- **WHEN** `<managed root>/agent` が通常ファイルまたは managed root 外を指すパスとして存在する
- **THEN** 起動は拒否され、Pi は spawn されない

### Requirement: 隔離保存先の明示指定
システムは、`SPIRITS_CODING_AGENT_DIR` が利用者により明示された場合、正規化とパス安全性の検査の後に隔離 agent dir と一致するときだけ受け付けなければならない。(SHALL)
一致しない指定、相対パス、`~` 指定、managed root 外を指す指定は、Pi を spawn せず理由付きで非ゼロ終了しなければならない。(MUST)
拒否時は隔離 agent dir を作成してはならない。(MUST)
警告の承認や force でこの判定を解除する機能を提供してはならない。(MUST)

#### Scenario: 一致しない明示指定
- **WHEN** `SPIRITS_CODING_AGENT_DIR=~/.spirits/agent` または任意の `/tmp/agent` を設定して managed 起動を実行する
- **THEN** 起動は拒否され、指定されたパスは使われず、既存 agent dir も隔離 agent dir も作成・変更されない

#### Scenario: 相対パスと managed root 外
- **WHEN** `SPIRITS_CODING_AGENT_DIR` に相対パス、`~` を含むパス、または managed root 外へ解決されるパスを設定する
- **THEN** 起動は拒否され、Pi は spawn されず、理由と固定された隔離 agent dir が表示される

#### Scenario: force の不在
- **WHEN** 利用者が拒否を回避するための追加オプションや環境変数を探す
- **THEN** 警告の承認や force で隔離判定を解除する機能は存在しない

### Requirement: 継承環境と session dir の sanitize
システムは、managed Pi の起動時に、identity と保存先を変える継承環境変数を固定または除去しなければならない。(MUST)
`PI_APP_NAME` と `PI_CONFIG_DIR` は managed bundle の identity に固定し、`SPIRITS_CODING_AGENT_SESSION_DIR` は隔離 agent dir 配下に固定し、旧名の session dir は除去しなければならない。(MUST)
API キー、proxy、provider 設定など、保存先と identity 以外の変数は保持しなければならない。(MUST)

#### Scenario: identity の継承値
- **WHEN** 親環境に異なる `PI_APP_NAME` や `PI_CONFIG_DIR` が設定されている
- **THEN** 子プロセスの app 名と config dir は managed bundle の値に固定され、既存 agent dir は使われない

#### Scenario: session dir の固定
- **WHEN** 親環境に `SPIRITS_CODING_AGENT_SESSION_DIR` または旧名の session dir が設定されている
- **THEN** 子プロセスの session dir は隔離 agent dir 配下になり、親の指定した外部 session dir は使われない

#### Scenario: 必要な環境変数の保持
- **WHEN** API キー、proxy、provider 設定を設定して managed 起動を実行する
- **THEN** それらの値は子プロセスに引き継がれ、保存先と identity の sanitize だけが行われる

### Requirement: managed 起動のパス指定引数の制限
システムは、managed 起動の引数のうち、既存データや外部 session を指せる `--session`、`--fork`、`--session-dir`、`--export` を拒否しなければならない。(MUST)
`--continue`、`--resume`、`--session-id` は固定された隔離 session dir の範囲で許可しなければならない。(SHALL)
拒否時は Pi を spawn せず、引数名と安全な代替を表示して非ゼロ終了しなければならない。(MUST)

#### Scenario: 外部 session dir の拒否
- **WHEN** `spirits managed-pi --session-dir ~/.spirits/agent/sessions` を実行する
- **THEN** 起動は拒否され、Pi は spawn されず、固定された隔離 session dir を使う案内が表示される

#### Scenario: 外部 session ファイルの拒否
- **WHEN** `--session`、`--fork`、`--export` に既存 agent dir 配下のパスを指定する
- **THEN** 起動は拒否され、既存 session は読まれず、Pi は spawn されない

#### Scenario: 隔離 session dir 内の再開
- **WHEN** `--continue`、`--resume`、`--session-id` を指定して managed 起動を実行する
- **THEN** session の探索と保存は隔離 agent dir 配下の session dir に限定される

### Requirement: managed コマンドの副作用
システムは、`install`、`update`、`repair`、wrapper `help` が既存 agent dir と隔離 agent dir を作成・変更してはならない。(MUST)
`--help`、`--version`、通常 managed 起動は、Pi の起動前に隔離 agent dir を確定し、既存 agent dir を作成・変更してはならない。(MUST)
隔離 agent dir の作成は managed 起動時にだけ行い、既存データのコピーや移行を含んではならない。(SHALL)

#### Scenario: 導入と復旧の副作用
- **WHEN** `spirits managed-pi install`、`update`、`repair`、または wrapper の `help` を実行する
- **THEN** 既存 agent dir と隔離 agent dir のどちらも作成・変更されない

#### Scenario: Pi の help と version
- **WHEN** `spirits managed-pi --help` または `spirits managed-pi --version` を実行する
- **THEN** Pi の起動前に隔離 agent dir が確定し、既存 agent dir は作成・変更されない

#### Scenario: 通常 managed 起動
- **WHEN** 引数なしの `spirits managed-pi` を実行する
- **THEN** 隔離 agent dir が保存先になり、既存 agent dir のコピー、移行、同期は行われない