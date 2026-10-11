# Spec Delta

## MODIFIED Requirements

### Requirement: 設定ディレクトリ
コンパイル済み `spirits` は、環境変数 `SPIRITS_CODING_AGENT_DIR` が未設定の場合、設定・認証情報・セッション・外部拡張の保存先として `~/.spirits/agent/` を使わなければならない。(SHALL)
`SPIRITS_CODING_AGENT_DIR` が設定済みの場合は、その値を優先しなければならない。(SHALL)
旧名 `PI_CODING_AGENT_DIR` は保存先の指定として読んではならない。(MUST)
`~/.spirits/agent/` は、インストール先 `~/.spirits/bin/` と別のディレクトリでなければならない。(MUST)

#### Scenario: 既定の保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せず、空のホームディレクトリでコンパイル済み `spirits` を起動して設定を保存する
- **THEN** 設定ファイルは `~/.spirits/agent/` 配下に作られ、`~/.pi` は作られず、`~/.spirits/bin/spirits` は変更されない

#### Scenario: 環境変数の優先
- **WHEN** `SPIRITS_CODING_AGENT_DIR=/tmp/spirits-agent` を設定してコンパイル済み `spirits` を起動し、設定を保存する
- **THEN** 設定ファイルは `/tmp/spirits-agent` 配下に作られ、`~/.spirits/agent/` は作られない

#### Scenario: 旧環境変数名の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` を設定してコンパイル済み `spirits` を起動し、設定を保存する
- **THEN** 設定ファイルは `/tmp/old-agent` ではなく `~/.spirits/agent/` 配下に作られる

### Requirement: pi の更新通知の抑止
コンパイル済み `spirits` は、pi の最新版確認を行ってはならず、pi の更新通知を表示してはならない。(MUST)
更新は `install.sh` の再実行で行わなければならない。(SHALL)
コンパイル済み `spirits` の help は、pi 本体の更新を案内してはならず、spirits の更新手段を示さなければならない。(SHALL)
`spirits update` を実行した場合は、pi のリリース成果物ではなく、そのディストリビューションの installer の再実行を案内しなければならない。(SHALL)

#### Scenario: 更新通知が出ない
- **WHEN** ネットワークに接続できる環境でコンパイル済み `spirits` を対話モードで起動する
- **THEN** pi の "Update Available" 通知は表示されない

#### Scenario: help に pi 本体の更新を出さない
- **WHEN** コンパイル済み `spirits --help` を実行する
- **THEN** 出力に "Update pi" を含む pi 本体の更新案内は表示されない

#### Scenario: update の案内先
- **WHEN** コンパイル済み `spirits update` を実行する
- **THEN** そのディストリビューションの installer の再実行が案内され、`github.com/earendil-works/pi/releases` は案内されない
