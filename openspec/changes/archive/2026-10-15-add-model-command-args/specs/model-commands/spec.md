# Spec Delta

## Purpose

対話 TUI の `/model` と `/thinking` で、モデルと thinking レベルを 1 行で指定し、その場で適用するか、既定として保存できるようにする。

## ADDED Requirements

### Requirement: /model は最後の語を thinking レベルとして解釈する
システムは `/model` の引数が 2 語以上で、最後の語が thinking レベル名(off / minimal / low / medium / high / xhigh / max、大文字小文字を区別しない)の場合、最後の語を thinking レベル、それより前の部分をモデルの検索語として扱わなければならない。それ以外の場合は、引数全体をモデルの検索語として扱わなければならない。(SHALL)

#### Scenario: モデルと thinking レベルの同時指定
- **GIVEN** `anthropic/claude-sonnet-4-5` が利用可能で、high をサポートする
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high` を Enter で送る
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5`、thinking レベルが high になる
- **AND** 設定ファイルの既定モデルと既定 thinking レベルは変わらない

#### Scenario: レベル名の大文字小文字を区別しない
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 HIGH` を Enter で送る
- **THEN** thinking レベルが high になる

#### Scenario: 最後の語がレベル名でない
- **WHEN** ユーザーが `/model claude sonnet` を Enter で送る
- **THEN** 引数全体の `claude sonnet` を検索語として、従来と同じ処理を行う

#### Scenario: 引数が 1 語だけ
- **WHEN** ユーザーが `/model high` を Enter で送る
- **THEN** `high` をモデルの検索語として扱い、thinking レベルは変わらない

#### Scenario: thinking レベル指定なし
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5` を Enter で送る
- **THEN** モデルが切り替わり、thinking レベルはモデル切り替え時の従来の規則で決まる

### Requirement: /model はサポートされない thinking レベルを拒否する
システムは `/model` で指定された thinking レベルを、適用対象のモデルがサポートしない場合、エラーを表示し、モデルと thinking レベルのどちらも変更してはならない。設定ファイルにも書き込んではならない。(MUST)

#### Scenario: reasoning 非対応モデルに high を指定
- **GIVEN** モデル M は reasoning に対応せず、off だけをサポートする
- **WHEN** ユーザーが `/model <M> high` を送る
- **THEN** high がサポートされない旨のエラーが表示される
- **AND** 現在のモデル、thinking レベル、設定ファイルは送信前と同じである

### Requirement: /model は完全一致しない場合に selector を経由する
システムは `/model` のモデル検索語が利用可能なモデルに完全一致しない場合、検索語を入力した状態でモデル selector を開かなければならない。thinking レベルの指定があれば、selector で選ばれたモデルを適用した後に、その thinking レベルを適用しなければならない。selector がキャンセルされた場合は何も変更してはならない。(SHALL)

#### Scenario: selector で選んだモデルに thinking レベルを適用
- **WHEN** ユーザーが `/model sonn high` を Enter で送る
- **THEN** 検索語 `sonn` が入力された状態でモデル selector が開く
- **WHEN** ユーザーが high をサポートするモデル X を Enter で選ぶ
- **THEN** 現在のモデルが X、thinking レベルが high になる

#### Scenario: selector のキャンセル
- **WHEN** ユーザーが `/model sonn high` を送り、開いた selector をキャンセルする
- **THEN** モデル、thinking レベル、設定ファイルは送信前と同じである

#### Scenario: selector で選んだモデルがレベルをサポートしない
- **WHEN** ユーザーが `/model sonn high` を送り、selector で high をサポートしないモデルを選ぶ
- **THEN** high がサポートされない旨のエラーが表示され、モデルと thinking レベルは送信前と同じである

### Requirement: /model は保存キーで既定として保存する
システムは入力欄の内容が `/model` コマンドのときに `app.models.save` キー(既定 ctrl+s)が押された場合、Enter での送信と同じ処理を行い、さらにモデルを既定モデルとして、指定された thinking レベルをグローバルの既定 thinking レベルとして設定ファイルに保存しなければならない。保存したことが分かる表示を出さなければならない。(SHALL)

#### Scenario: モデルと thinking レベルを保存
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high` を入力して ctrl+s を押す
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5`、thinking レベルが high になる
- **AND** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定 thinking レベルが high になる
- **AND** 入力欄が空になり、既定として保存した旨が表示される

#### Scenario: thinking レベル指定なしで保存
- **GIVEN** 設定ファイルの既定 thinking レベルが medium である
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5` になり、既定 thinking レベルは medium のままである

#### Scenario: 保存指定を selector に引き継ぐ
- **WHEN** ユーザーが `/model sonn high` を入力して ctrl+s を押し、開いた selector でモデル X を Enter で選ぶ
- **THEN** 設定ファイルの既定モデルが X、既定 thinking レベルが high になる

#### Scenario: 引数なしの /model
- **WHEN** ユーザーが `/model` だけを入力して ctrl+s を押し、開いた selector でモデル X を Enter で選ぶ
- **THEN** 設定ファイルの既定モデルが X になる

#### Scenario: キーバインドの変更に従う
- **GIVEN** ユーザーが `app.models.save` を ctrl+y に設定している
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5` を入力して ctrl+y を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5` になる

### Requirement: /thinking は保存キーで既定として保存する
システムは入力欄の内容が `/thinking` コマンドのときに `app.thinking.save` キー(既定 ctrl+s)が押された場合、Enter での送信と同じ処理を行い、さらに指定された thinking レベルをグローバルの既定 thinking レベルとして設定ファイルに保存しなければならない。(SHALL)

#### Scenario: thinking レベルを保存
- **WHEN** ユーザーが `/thinking high` を入力して ctrl+s を押す
- **THEN** thinking レベルが high になり、設定ファイルの既定 thinking レベルが high になる

#### Scenario: 不正なレベル
- **WHEN** ユーザーが `/thinking foo` を入力して ctrl+s を押す
- **THEN** Enter で送った場合と同じエラーが表示され、設定ファイルは変わらない

#### Scenario: 引数なしの /thinking
- **WHEN** ユーザーが `/thinking` だけを入力して ctrl+s を押し、開いた selector でレベル high を Enter で選ぶ
- **THEN** 設定ファイルの既定 thinking レベルが high になる

### Requirement: 保存キーはコマンド以外の入力を変更しない
システムは入力欄の内容が `/model` コマンドでも `/thinking` コマンドでもないときに保存キーが押された場合、入力欄の内容を変更してはならず、送信してはならない。(MUST)

#### Scenario: 通常のメッセージ
- **WHEN** ユーザーが `hello` を入力して ctrl+s を押す
- **THEN** 入力欄の内容は `hello` のままで、メッセージは送信されない

#### Scenario: コマンド名の前方一致
- **WHEN** ユーザーが `/models` を入力して ctrl+s を押す
- **THEN** 入力欄の内容は `/models` のままで、設定ファイルは変わらない

### Requirement: 拡張機能が差し替えたエディタでも保存キーが働く
システムは拡張機能が入力欄のエディタを `CustomEditor` を継承したエディタに差し替えた場合でも、`/model` と `/thinking` の保存キーを既定のエディタと同じように処理しなければならない。`CustomEditor` を継承しないエディタは、他のアプリのキーバインドと同じくアプリのショートカットを引き継がないため、この要件の対象外とする。(SHALL)

#### Scenario: 差し替えたエディタで保存
- **GIVEN** 拡張機能が入力欄のエディタを、`CustomEditor` を継承したエディタに差し替えている
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定 thinking レベルが high になる

### Requirement: /model の引数補完は 2 語目に thinking レベルを出す
システムは `/model` の引数補完で、1 語目が利用可能なモデルに完全一致し、その後に空白がある場合、そのモデルがサポートする thinking レベルを候補として出さなければならない。候補を確定したときは、1 語目を残したまま 2 語目だけを置き換えなければならない。(SHALL)

#### Scenario: thinking レベルの候補
- **GIVEN** `anthropic/claude-sonnet-4-5` が off / minimal / low / medium / high をサポートする
- **WHEN** ユーザーが入力欄に `/model anthropic/claude-sonnet-4-5 h` と入力する
- **THEN** 補完候補に high が出る
- **WHEN** ユーザーが high を確定する
- **THEN** 入力欄が `/model anthropic/claude-sonnet-4-5 high` になる

#### Scenario: 1 語目が完全一致しない
- **WHEN** ユーザーが入力欄に `/model claude son` と入力する
- **THEN** 補完候補は従来どおり、引数全体で検索したモデルである

### Requirement: /model の引数ヒントは thinking レベルを示す
システムはスラッシュコマンドの補完で、`/model` の引数ヒントを `<provider/model> [level]` と表示しなければならない。(SHALL)

#### Scenario: 引数ヒントの表示
- **WHEN** ユーザーが入力欄に `/mo` と入力して補完候補を表示する
- **THEN** `/model` の候補に引数ヒント `<provider/model> [level]` が表示される
