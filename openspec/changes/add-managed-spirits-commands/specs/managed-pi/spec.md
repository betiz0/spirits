# Spec Delta

## MODIFIED Requirements

### Requirement: 継承環境と session dir の sanitize
システムは、managed Pi の起動時に、identity と保存先を変える継承環境変数を固定または除去しなければならない。(MUST)
app 名と project config dir は managed bundle の `package.json` overlay だけで決め、子プロセスの環境変数としては立てない。(MUST) overlay 以外の経路で app 名や config dir を差し替えてはならない。(MUST)
`SPIRITS_CODING_AGENT_SESSION_DIR` は隔離 agent dir 配下に固定し、旧名の session dir および `PI_CODING_AGENT_DIR` は除去しなければならない。(MUST)
API キー、proxy、provider 設定など、保存先と identity 以外の変数は保持しなければならない。(MUST)

#### Scenario: identity の overlay 一本化
- **WHEN** managed 起動で子プロセスに渡す環境を組み立てる
- **THEN** app 名と config dir を指定する環境変数は含まれず、identity は overlay の `package.json` からのみ決まる

#### Scenario: 古い identity 変数の継承値
- **WHEN** 親環境に異なる app 名指定や config dir 指定、`PI_CODING_AGENT_DIR` が設定されている
- **THEN** 子プロセスではそれらが除去または無視され、既存 agent dir は使われない

#### Scenario: session dir の固定
- **WHEN** 親環境に `SPIRITS_CODING_AGENT_SESSION_DIR` または旧名の session dir が設定されている
- **THEN** 子プロセスの session dir は隔離 agent dir 配下になり、親の指定した外部 session dir は使われない

#### Scenario: 必要な環境変数の保持
- **WHEN** API キー、proxy、provider 設定を設定して managed 起動を実行する
- **THEN** それらの値は子プロセスに引き継がれ、保存先と identity の sanitize だけが行われる
