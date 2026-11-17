# product-identity Delta

## MODIFIED Requirements

### Requirement: CLI 表示の spirits 化
コンパイル済み `spirits`、または `packages/spirits/bin/spirits.ts` から起動したセッションは、CLI のバナー、usage、コマンド例、再開やクラッシュの案内で実行中のアプリ名(`spirits`)を表示しなければならない。(SHALL)
ホストの identity は、展開後の `package.json` の `piConfig.name` を `spirits` とする overlay だけで決めなければならない。(MUST) `PI_APP_NAME` と `PI_CONFIG_DIR` は設定してはならない。(MUST)
起動役の `--help` / `-h` は spirits 自身の help を出さなければならない。(SHALL) ホストの help は `spirits -- --help` で到達でき、ホスト自身の文言であることを文書に記録しなければならない。(SHALL)
起動役の help にホストのツール構成を説明する文言(例: "read, bash, edit, write tools")を spirits の説明として表示してはならない。(MUST)

#### Scenario: help のバナー
- **WHEN** コンパイル済み `spirits --help` を実行する
- **THEN** 起動役の help に `spirits` が表示され、`pi` はアプリ名として表示されない

#### Scenario: ホストの help への到達
- **WHEN** `spirits -- --help` を実行する
- **THEN** ホストの help が表示され、その文言はホスト自身のものであることが分かる

#### Scenario: セッション再開の案内
- **WHEN** 再開可能なセッションがある状態で対話セッションが終了する
- **THEN** 再開コマンドの案内は `spirits` をアプリ名として含む

## REMOVED Requirements

### Requirement: テレメトリと provider 名義
**Reason**: provider 帰属ヘッダの抑制はフォークのコア差分で実現していたため。ホストの帰属ヘッダは抑制できない。
**Migration**: 追加する要件「テレメトリの既定とホストの帰属ヘッダ」に従う。

## ADDED Requirements

### Requirement: テレメトリの既定とホストの帰属ヘッダ
コンパイル済み `spirits` は、環境変数 `PI_TELEMETRY` による明示的な有効化がない限り、install テレメトリを送信してはならない。(MUST)
settings.json によるテレメトリの有効化は、効力を持ってはならない。(MUST)
`PI_TELEMETRY=1` を指定した場合は、この限りでない。(SHALL)
ホストが付与する provider 帰属ヘッダは、ホストの既定に従い、そのまま受け入れなければならない。(SHALL) spirits は独自の provider 帰属ヘッダを追加しない。(MUST)

#### Scenario: 既定で送信しない
- **WHEN** テレメトリ設定を変更せずにコンパイル済み `spirits` を初回起動する
- **THEN** install レポートの要求は発生しない

#### Scenario: 明示有効化
- **WHEN** `PI_TELEMETRY=1` を設定してコンパイル済み `spirits` を起動する
- **THEN** install レポートの要求が発生する

#### Scenario: settings での opt-in の無効化
- **WHEN** settings.json でテレメトリを有効化し、`PI_TELEMETRY` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** install レポートの要求は発生しない

#### Scenario: ホストの帰属ヘッダを受け入れる
- **WHEN** OpenRouter 経由のモデルを呼び出す
- **THEN** ホストが付与する帰属ヘッダはそのまま付き、spirits は独自のヘッダを追加しない
