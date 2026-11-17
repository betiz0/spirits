# product-identity Specification

## Purpose

spirits が CLI、TUI、project 設定、テレメトリの各面で一貫して spirits として振る舞うようにする。アプリ名の表示は展開後の `package.json` の overlay だけで決め、起動役が host の help を spirits の説明として出さない。テレメトリは既定で送信せず、ホストが付与する帰属表示と provider 帰属ヘッダはそのまま受け入れる。

## Requirements
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

### Requirement: TUI 起動ヘッダの spirits 化
対話モードの起動ヘッダは、最上部に spirits の ASCII アート、続いて spirits のワードマークとバージョン、キーヒント、spirits 自身のオンボーディング文をこの順で表示しなければならない。(SHALL)
pi のロゴと、pi を説明するオンボーディング文(例: "Pi can explain its own features ...")を表示してはならない。(MUST)

#### Scenario: ヘッダ表示
- **WHEN** コンパイル済み `spirits` を対話モードで起動する
- **THEN** 起動ヘッダの最上部に ASCII アートがあり、続いて `spirits` とバージョンが含まれ、`Pi can explain` を含む行は表示されない

### Requirement: ヘッダのバージョン整合
起動ヘッダのバージョンは、ビルド時に埋め込まれた spirits バージョンを用いなければならない。(SHALL)
コンパイルされていない実行では、開発版であることを示す値を表示しなければならない。(SHALL)

#### Scenario: コンパイル済みの整合
- **WHEN** コンパイル済み `spirits` を起動して、ヘッダのバージョンと `spirits --version` の表示を比較する
- **THEN** 両者は同じバージョンを示す

#### Scenario: ソース実行の開発版表示
- **WHEN** `bun packages/spirits/bin/spirits.ts` を起動する
- **THEN** ヘッダのバージョンは埋め込みバージョンではなく、開発版であることを示す値になる

### Requirement: quietStartup と起動ヘルプ展開の尊重
`quietStartup` が有効なとき、spirits は起動ヘッダを表示してはならない。(MUST)
起動ヘルプの展開キーが使われたとき、ヘッダの表示内容は展開状態に同期しなければならない。(SHALL)

#### Scenario: quietStartup で非表示
- **WHEN** `quietStartup` を有効にして spirits を起動する
- **THEN** 起動ヘッダは表示されない

#### Scenario: 展開キーへの追従
- **WHEN** 起動ヘッダの表示中に起動ヘルプの展開キーを押す
- **THEN** ヘッダはビルトインと同じく展開された内容を表示する

### Requirement: Project 設定の互換
spirits は project 設定を `.pi` から読み、`.spirits` project ディレクトリを要求してはならない。(SHALL)

#### Scenario: project skill の利用
- **WHEN** リポジトリの `.pi/skills/` に skill を置いて spirits を起動する
- **THEN** その skill はセッションで利用可能である

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
