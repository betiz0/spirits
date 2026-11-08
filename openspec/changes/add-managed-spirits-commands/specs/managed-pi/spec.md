# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 継承環境と session dir の sanitize
システムは、managed Pi の起動時に、identity と保存先を変える継承環境変数を固定または除去しなければならない。(MUST)
app 名と project config dir は managed bundle の `package.json` overlay だけで決め、子プロセスの環境変数としては立てない。(MUST) overlay 以外の経路で app 名や config dir を差し替えてはならない。(MUST)
`SPIRITS_CODING_AGENT_SESSION_DIR` は隔離 agent dir 配下に固定し、旧名の session dir および `PI_CODING_AGENT_DIR` は除去しなければならない。(MUST)
API キー、proxy、provider 設定など、保存先と identity 以外の変数は保持しなければならない。(MUST)

#### Scenario: identity の overlay 一本化
- **WHEN** managed 起動で子プロセスに渡す環境を組み立てる
- **THEN** app 名と config dir を指定する環境変数は含まれず、identity は overlay の `package.json` からのみ決まる

#### Scenario: identity の継承値
- **WHEN** 親環境に異なる app 名指定や config dir 指定、`PI_CODING_AGENT_DIR` が設定されている
- **THEN** 子プロセスではそれらが除去または無視され、identity は overlay の `package.json` からのみ決まり、既存 agent dir は使われない

#### Scenario: session dir の固定
- **WHEN** 親環境に `SPIRITS_CODING_AGENT_SESSION_DIR` または旧名の session dir が設定されている
- **THEN** 子プロセスの session dir は隔離 agent dir 配下になり、親の指定した外部 session dir は使われない

#### Scenario: 必要な環境変数の保持
- **WHEN** API キー、proxy、provider 設定を設定して managed 起動を実行する
- **THEN** それらの値は子プロセスに引き継がれ、保存先と identity の sanitize だけが行われる
