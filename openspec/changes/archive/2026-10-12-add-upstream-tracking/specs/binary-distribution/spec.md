# Spec Delta

## ADDED Requirements

### Requirement: 起動ディレクトリの .env の読み込み禁止
コンパイル済み `spirits` は、起動ディレクトリにある `.env`、`.env.local`、および `NODE_ENV` の値に対応する `.env.<NODE_ENV>` (`.env.development`、`.env.production`、`.env.test`) の値を、自身の環境へ読み込んではならない。(MUST)
コンパイル済み `spirits` は、起動したシェルから受け取った環境変数を、引き続き自身の環境として扱わなければならない。(SHALL)

#### Scenario: 起動ディレクトリの .env を無視する
- **WHEN** 起動ディレクトリの `.env` に `SPIRITS_DOTENV_PROBE=1` を定義し、環境変数を読み出して記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_PROBE` は存在しない

#### Scenario: .env.local と .env.<NODE_ENV> を無視する
- **WHEN** `NODE_ENV=production` を設定し、起動ディレクトリの `.env.local` に `SPIRITS_DOTENV_LOCAL_PROBE=1`、`.env.production` に `SPIRITS_DOTENV_MODE_PROBE=1` を定義して、環境変数を記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_LOCAL_PROBE` と `SPIRITS_DOTENV_MODE_PROBE` はどちらも存在しない

#### Scenario: シェルの環境変数は反映される
- **WHEN** シェルで `SPIRITS_DOTENV_PROBE=1` を設定し、環境変数を記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_PROBE=1` が存在する
