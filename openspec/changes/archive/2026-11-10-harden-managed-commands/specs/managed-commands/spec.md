# managed-commands Delta

## ADDED Requirements

### Requirement: 振り分け用モデルの除外は api 値で行う
システムは、`/spirits-model` の対象から spirits の振り分け用モデルを除く判定を、モデルの api 値が spirits の振り分け用 api と一致するかにより行う。(SHALL) モデル名、provider 名、表示名に依存してはならない。(MUST NOT)

#### Scenario: 名称に仮想を示す語を含まない振り分け用モデル
- **GIVEN** api が spirits の振り分け用 api であり、名前に `virtual` を含まないモデルが存在する
- **WHEN** そのモデル名を `/spirits-model` の検索語に使う
- **THEN** 対象にせず、対象にできない旨を伝える

#### Scenario: 通常モデルは対象に残る
- **GIVEN** api が spirits の振り分け用 api でないモデルが存在する
- **WHEN** そのモデル名を `/spirits-model` の検索語に使う
- **THEN** 通常の解決対象として扱う

## MODIFIED Requirements

### Requirement: `/spirits-model` と `/spirits-role` は選んだ値を既定として保存する
システムは `/spirits-model` でモデルを適用したとき、そのモデルの provider と id を既定モデルの保存キーに、level を指定されたときは thinking レベルの既定保存キーに保存しなければならない。(SHALL)
role を指定されたとき、および `/spirits-role` で role をロックしたときは、spirits の既定 role の保存キーに保存しなければならない。(SHALL)
保存した値は、専用の Pi が設定を再読み込みした後の新しいセッションで読める状態にしなければならない。(SHALL) 設定の書き込みと再読み込みのあいだに利用した、コマンド由来の API ハンドルを再読み込み後のに使ってはならない。(MUST)
設定の書き込みが失敗したとき、システムはセッションへ適用した変更を取り消さない。(MUST) 保存に失敗した旨をセッションへの変更と分けて伝え、設定の再読み込みを行わない。(SHALL)

#### Scenario: 保存された既定値が次のセッションで効く
- **WHEN** `/spirits-model compat-fake/fake-model high` を実行して再読み込みが行われた後、新しいセッションを開始する
- **THEN** 既定モデルのキーは `compat-fake` と `fake-model`、既定 thinking レベルのキーは high として保存されており、設定の再読み込み後の読み取りがその値を返す

#### Scenario: 再読み込み後のに古いハンドルを使わない
- **WHEN** 設定を書いたコマンドが設定の再読み込みを待つ
- **THEN** 再読み込みの後にそのコマンドの API ハンドルやコンテキストを使わず、再読み込みが打ち上げた開始イベントで反映を確認する

#### Scenario: 設定の書き込みが失敗する
- **GIVEN** セッションへの適用は成功し、設定の書き込みだけが失敗する
- **WHEN** `/spirits-model` を実行する
- **THEN** セッションのモデルは変更されたまま、設定の再読み込みは行われず、保存に失敗した旨が伝えられる

### Requirement: role badge は拡張の status 行に出す
システムは managed 経路で、直近のリクエストが扱った role を拡張の status 行に表示しなければならない。(SHALL) 表示は角括弧で囲んだ小文字の role 名とし、改行および端末制御文字を含む場合はそれらを取り除いて 1 行とする。取り除いた結果が空になるときは表示しない。
この表示は、フォーク経路のモデル名隣のバッジと同じ場所・同じ仕組みではないことを文書に記録しなければならない。(SHALL)
システムは、role の選択が終わったときに badge を描画し、拡張の再読み込み後に開始したセッションでもう一度描画する。(SHALL)

#### Scenario: 制御文字を含む role は描画しない
- **WHEN** 記録された role が制御文字だけからなる
- **THEN** status 行には何も出ず、端末の表示状態は変わらない

#### Scenario: strong で走ったあとは strong を出す
- **WHEN** strong の対象でリクエストを処理した
- **THEN** 拡張の status 行に strong を示すバッジが出る

#### Scenario: role を選んだときに描画する
- **WHEN** `/spirits-role strong` または `/spirits-model <語> strong` で role が決まった
- **THEN** セッションのモデルを変えずに badge がその role で描画される

#### Scenario: 再読み込み後に再描画する
- **WHEN** 拡張の再読み込みによってセッションが開始した
- **THEN** 記録された role の badge がもう一度描画される
