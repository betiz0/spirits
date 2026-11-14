# self-update Delta

## MODIFIED Requirements

### Requirement: spirits update による自己更新
コンパイル済み `spirits` は、`update` の引数が次の自己更新形のいずれかである場合、実行ファイル自身を最新の stable リリースへ置き換えなければならない。(SHALL)
自己更新形は `update`、`update self`、`update pi`、`update --self`、およびこれらに `--force`、`-a` / `--approve`、`-na` / `--no-approve` を加えた形である。`-a` / `--approve` / `-na` / `--no-approve` は受け付けるが、自己更新の挙動を変えない。
起動役は Pi の `update` の文法を解釈してはならない。(MUST)
自己更新形以外の `update` の引数(`--extensions`、`--models`、`--extension <source>`、`--all`、`self` / `pi` 以外の位置引数、`-h` / `--help`、未知のオプション、これらと自己更新形の組み合わせ)では、自己更新もホストの起動も行わず、ホストと拡張 bundle の更新は `spirits managed-pi update`、拡張やモデルの更新は `spirits -- update <引数>` で行う旨を表示して、非ゼロで終了しなければならない。(MUST)

#### Scenario: 最新版への更新
- **WHEN** 0.2.0 がインストール済みの環境で最新 stable が 0.3.0 のとき `spirits update` を実行する
- **THEN** 実行ファイルは 0.3.0 に置き換わり、終了コードは 0 になる

#### Scenario: project trust 指定付きの自己更新
- **WHEN** 0.2.0 がインストール済みの環境で最新 stable が 0.3.0 のとき `spirits update -a` を実行する
- **THEN** 実行ファイルは 0.3.0 に置き換わり、終了コードは 0 になる

#### Scenario: 拡張更新の指定は案内して終了する
- **WHEN** コンパイル済み `spirits update --extensions` を実行する
- **THEN** 実行ファイルは変更されず、ホストは起動せず、`spirits managed-pi update` と `spirits -- update <引数>` の案内が表示され、終了コードは非ゼロになる

#### Scenario: all 指定は案内して終了する
- **WHEN** コンパイル済み `spirits update --all` を実行する
- **THEN** 自己更新は行われず、同じ案内が表示され、終了コードは非ゼロになる

#### Scenario: 未知のオプション
- **WHEN** コンパイル済み `spirits update --unknown` を実行する
- **THEN** 自己更新は行われず、同じ案内が表示され、終了コードは非ゼロになる

### Requirement: 自己更新の原子性
自己更新は、置換のどの時点でも、インストール先のパスが元の実行ファイル全体か、検証済みの新しい実行ファイル全体のいずれかになるように置換しなければならない。(SHALL)
置換が完了するまで、インストール済みの実行ファイルは元の内容と実行ビットを保たなければならない。(SHALL)
置換後の実行ファイルは実行ビットを持たなければならない。(SHALL)
複数の自己更新、または自己更新とインストーラが同時に実行された場合も、インストール先はいずれかの実行が配置した検証済みの実行ファイル全体でなければならない。(SHALL)

#### Scenario: 成功時の置換
- **WHEN** チェックサム検証済みの自己更新が完了する
- **THEN** インストール先の実行ファイルは新しい内容で実行ビットを持ち、次回起動から新しいバージョンが使われる

#### Scenario: 置換失敗時の元ファイル維持
- **WHEN** インストール先ディレクトリへの書き込みが置換の完了前に失敗する
- **THEN** 終了コードは非ゼロになり、インストール済みの実行ファイルは元の内容と実行ビットを保つ

#### Scenario: 同時実行
- **WHEN** 同じインストール先に対して 2 つの `spirits update --force` を同時に実行する
- **THEN** 両方の終了後、インストール先は検証済みの実行ファイル全体で実行ビットを持つ

### Requirement: managed 一式の導入失敗の報告
managed の一式の取得または導入が失敗した場合、自己更新は理由、修復コマンド `spirits managed-pi repair`、および旧版への戻し方を表示し、自己更新全体の終了コードを非ゼロにしなければならない。(MUST)
失敗を理由にフォークや別ホストを既定の起動経路へ切り替えてはならない。(MUST)

#### Scenario: チェックサム不一致
- **WHEN** ダウンロードした拡張 bundle が manifest のチェックサムと一致しない
- **THEN** 終了コードは非ゼロになり、理由と `spirits managed-pi repair` と旧版への戻し方が表示される

#### Scenario: 取得の失敗
- **WHEN** manifest の取得に失敗する
- **THEN** 終了コードは非ゼロになり、理由と修復手段が表示される

#### Scenario: 一部成功時の報告
- **WHEN** 実行ファイルの更新は成功したが managed の導入が失敗する
- **THEN** 更新された旨と導入失敗の理由の両方が表示され、終了コードは非ゼロになる

## REMOVED Requirements

### Requirement: 自己更新の取得とチェックサム検証
**Reason**: 新しい自己更新はテーマ資産を取得せず、取得する成果物が実行ファイルとチェックサムだけになるため。
**Migration**: 追加する要件「自己更新の実行ファイル取得」に従う。

### Requirement: 自己更新のテーマ資産
**Reason**: テーマはホスト Pi の配布物に含まれ、起動役の自己更新で `theme/` を配置する必要がなくなったため。
**Migration**: テーマは managed 一式のホスト artifact が提供する。自己更新は実行ファイルだけを置換し、既存の `~/.spirits/bin/theme/` は変更しない。リリースは旧版の自己更新のためにテーマ資産を互換用として添付し続ける (binary-distribution「リリース成果物」)。

### Requirement: pi へ渡す update 引数
**Reason**: 起動役は Pi を内包せず、Pi の `update` 文法を解釈しないため。
**Migration**: 「spirits update による自己更新」に従い、自己更新形以外は案内して非ゼロで終了する。ホストと拡張 bundle の更新は `spirits managed-pi update`、拡張やモデルの更新は `spirits -- update <引数>` を使う。

### Requirement: 自己更新と拡張更新の組み合わせ
**Reason**: 起動役が Pi の拡張更新を実行しないため、自己更新と拡張更新を組み合わせる経路がなくなるため。
**Migration**: 自己更新は `spirits update`、拡張の更新は `spirits -- update --extensions` を別々に実行する。

## ADDED Requirements

### Requirement: 自己更新の実行ファイル取得
自己更新は、実行ファイルを置換する場合、解決したリリースの `spirits-linux-x64` と `spirits-linux-x64.sha256` を取得し、配置前にチェックサムを検証しなければならない。(SHALL)
自己更新は、リリースに添付されたテーマ資産を取得してはならない。(MUST)
チェックサム検証に失敗した場合、インストール済みの実行ファイルを変更せず、非ゼロで終了しなければならない。(MUST)

#### Scenario: チェックサム不一致
- **WHEN** ダウンロードされる実行ファイルが `.sha256` と一致しない状態で `spirits update` を実行する
- **THEN** 終了コードは非ゼロになり、インストール済みの実行ファイルは元の内容のまま残る

#### Scenario: テーマ資産を取得しない
- **WHEN** テーマ資産を添付したリリースへ `spirits update` で更新する
- **THEN** `dark.json` と `light.json` はダウンロードされず、既存の `~/.spirits/bin/theme/` は変更されない
