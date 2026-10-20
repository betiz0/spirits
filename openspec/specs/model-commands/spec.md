# model-commands Specification

## Purpose

対話 TUI の `/model` と `/thinking` で、モデルと thinking レベルを 1 行で指定し、その場で適用するか、既定として保存できるようにする。

## Requirements

### Requirement: /model は末尾の語を thinking レベルとロールとして解釈する
システムは `/model` の引数を、末尾の語から次の順に解釈しなければならない。(SHALL)
1. 引数が 2 語以上で、最後の語がロール名(`normal` / `strong`、大文字小文字を区別しない)の場合、最後の語をロール名として切り出す。
2. 1 の後に残る部分が 2 語以上で、その最後の語が thinking レベル名(off / minimal / low / medium / high / xhigh / max、大文字小文字を区別しない)の場合、その語を thinking レベルとして切り出す。
3. 残る部分をモデルの検索語として扱う。
thinking レベルとロールを両方指定する順序は `<検索語> <level> <role>` だけとする。`<検索語> <role> <level>` の順では、ロール名の位置にある語を検索語の一部として扱わなければならない。(SHALL) thinking レベル名とロール名は重ならない。ロール名は小文字に正規化して扱う。指定された語を理由にエラーにしてはならない。(MUST)

#### Scenario: モデルと thinking レベルの同時指定
- **GIVEN** `anthropic/claude-sonnet-4-5` が利用可能で、high をサポートする
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high` を Enter で送る
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5`、thinking レベルが high になる
- **AND** 設定ファイルの既定モデルと既定 thinking レベルは変わらない

#### Scenario: モデルとロールの同時指定
- **GIVEN** `anthropic/claude-sonnet-4-5` が利用可能である
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong` を Enter で送る
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5` になる
- **AND** セッションのロールが strong にロックされる
- **AND** 設定ファイルの既定モデルと既定ロールは変わらない

#### Scenario: モデルと thinking レベルとロールの同時指定
- **GIVEN** `anthropic/claude-sonnet-4-5` が利用可能で、high をサポートする
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high strong` を Enter で送る
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5`、thinking レベルが high になり、セッションのロールが strong にロックされる

#### Scenario: ロールと thinking レベルの順序が逆
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong high` を Enter で送る
- **THEN** `anthropic/claude-sonnet-4-5 strong` をモデルの検索語、high を thinking レベルとして扱う
- **AND** エラーは表示されず、セッションのロールは変わらない

#### Scenario: normal の指定
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 normal` を Enter で送る
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5` になり、セッションのロールが normal にロックされる

#### Scenario: レベル名の大文字小文字を区別しない
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 HIGH` を Enter で送る
- **THEN** thinking レベルが high になる

#### Scenario: ロール名の大文字小文字を区別しない
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 STRONG` を Enter で送る
- **THEN** セッションのロールが strong にロックされる

#### Scenario: 最後の語がレベル名でない
- **WHEN** ユーザーが `/model claude sonnet` を Enter で送る
- **THEN** 引数全体の `claude sonnet` を検索語として、従来と同じ処理を行う
- **AND** エラーは表示されず、セッションのロールも変わらない

#### Scenario: 最後の語がロール名に似た未知の語
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 invalidrole` を Enter で送る
- **THEN** 引数全体を検索語として、従来と同じ処理を行う
- **AND** エラーは表示されず、セッションのロールも変わらない

#### Scenario: 引数が 1 語だけ
- **WHEN** ユーザーが `/model high` を Enter で送る
- **THEN** `high` をモデルの検索語として扱い、thinking レベルは変わらない

#### Scenario: 引数が 1 語の normal
- **WHEN** ユーザーが `/model normal` を Enter で送る
- **THEN** `normal` をモデルの検索語として扱い、ロールは変わらない

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
システムは `/model` のモデル検索語が利用可能なモデルに完全一致しない場合、検索語を入力した状態でモデル selector を開かなければならない。thinking レベルの指定があれば、selector で選ばれたモデルを適用した後に、その thinking レベルを適用しなければならない。ロールの指定があれば、selector で選ばれたモデルを適用した後に、そのロールをセッションに適用してロックしなければならない。thinking レベルとロールは互いに独立に適用する。selector がキャンセルされた場合は何も変更してはならない。(SHALL)

#### Scenario: selector で選んだモデルに thinking レベルを適用
- **WHEN** ユーザーが `/model sonn high` を Enter で送る
- **THEN** 検索語 `sonn` が入力された状態でモデル selector が開く
- **WHEN** ユーザーが high をサポートするモデル X を Enter で選ぶ
- **THEN** 現在のモデルが X、thinking レベルが high になる

#### Scenario: selector で選んだモデルにロールを適用
- **WHEN** ユーザーが `/model sonn strong` を Enter で送る
- **THEN** 検索語 `sonn` が入力された状態でモデル selector が開く
- **WHEN** ユーザーがモデル X を Enter で選ぶ
- **THEN** 現在のモデルが X になり、セッションのロールが strong にロックされる

#### Scenario: selector のキャンセル
- **WHEN** ユーザーが `/model sonn high` を送り、開いた selector をキャンセルする
- **THEN** モデル、thinking レベル、ロール、設定ファイルは送信前と同じである

#### Scenario: selector で選んだモデルがレベルをサポートしない
- **WHEN** ユーザーが `/model sonn high` を送り、selector で high をサポートしないモデルを選ぶ
- **THEN** high がサポートされない旨のエラーが表示され、モデルと thinking レベルは送信前と同じである

### Requirement: /model は保存キーで既定として保存する
システムは入力欄の内容が `/model` コマンドのときに `app.models.save` キー(既定 ctrl+s)が押された場合、Enter での送信と同じ処理を行い、さらにモデルを既定モデルとして、指定された thinking レベルをグローバルの既定 thinking レベルとして、指定されたロールをグローバルの既定ロールとして設定ファイルに保存しなければならない。保存したことが分かる表示を出さなければならない。(SHALL) ロールは小文字に正規化した値で保存し、ロールを保存した場合はその値を `Default role: <role>` として表示に含めなければならない。(SHALL)

#### Scenario: モデルと thinking レベルを保存
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high` を入力して ctrl+s を押す
- **THEN** 現在のモデルが `anthropic/claude-sonnet-4-5`、thinking レベルが high になる
- **AND** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定 thinking レベルが high になる
- **AND** 入力欄が空になり、既定として保存した旨が表示される

#### Scenario: モデルとロールを保存
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定ロールが strong になる
- **AND** 保存した旨の表示に `Default role: strong` が含まれる
- **AND** セッションのロールが strong にロックされる

#### Scenario: モデルと normal ロールを保存
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 normal` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定ロールが normal になる

#### Scenario: 大文字のロールは小文字で保存する
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 STRONG` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定ロールが `strong` になる
- **AND** 保存した旨の表示に `Default role: strong` が含まれる

#### Scenario: thinking レベルとロールを同時に保存
- **GIVEN** `anthropic/claude-sonnet-4-5` が high をサポートする
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 high strong` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定 thinking レベルが high、既定ロールが strong になる

#### Scenario: thinking レベル指定なしで保存
- **GIVEN** 設定ファイルの既定 thinking レベルが medium である
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5` になり、既定 thinking レベルは medium のままである

#### Scenario: ロール指定なしで保存
- **GIVEN** 設定ファイルの既定ロールが strong である
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5` になり、既定ロールは strong のままである
- **AND** 保存した旨の表示に `Default role:` は含まれない

#### Scenario: 保存指定を selector に引き継ぐ
- **WHEN** ユーザーが `/model sonn high` を入力して ctrl+s を押し、開いた selector でモデル X を Enter で選ぶ
- **THEN** 設定ファイルの既定モデルが X、既定 thinking レベルが high になる

#### Scenario: ロール付きの保存指定を selector に引き継ぐ
- **WHEN** ユーザーが `/model sonn strong` を入力して ctrl+s を押し、開いた selector でモデル X を Enter で選ぶ
- **THEN** 設定ファイルの既定モデルが X、既定ロールが strong になる

#### Scenario: 引数なしの /model
- **WHEN** ユーザーが `/model` だけを入力して ctrl+s を押し、開いた selector でモデル X を Enter で選ぶ
- **THEN** 設定ファイルの既定モデルが X になる

#### Scenario: キーバインドの変更に従う
- **GIVEN** ユーザーが `app.models.save` を ctrl+y に設定している
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong` を入力して ctrl+y を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定ロールが strong になる

#### Scenario: 拡張機能差し替え後のエディタでもロールを保存する
- **GIVEN** 拡張機能が入力欄のエディタを、`CustomEditor` を継承したエディタに差し替えている
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong` を入力して ctrl+s を押す
- **THEN** 設定ファイルの既定モデルが `anthropic/claude-sonnet-4-5`、既定ロールが strong になる

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

### Requirement: /model の引数補完は 2 語目に thinking レベルとロールを出す
システムは `/model` の引数補完で、1 語目が利用可能なモデルに完全一致し、その後に空白がある場合、そのモデルがサポートする thinking レベルと、ロール名 `normal` および `strong` を候補として出さなければならない。候補を確定したときは、1 語目を残したまま 2 語目だけを置き換えなければならない。(SHALL)

#### Scenario: thinking レベルの候補
- **GIVEN** `anthropic/claude-sonnet-4-5` が off / minimal / low / medium / high をサポートする
- **WHEN** ユーザーが入力欄に `/model anthropic/claude-sonnet-4-5 h` と入力する
- **THEN** 補完候補に high が出る
- **WHEN** ユーザーが high を確定する
- **THEN** 入力欄が `/model anthropic/claude-sonnet-4-5 high` になる

#### Scenario: ロールの候補
- **WHEN** ユーザーが入力欄に `/model anthropic/claude-sonnet-4-5 s` と入力する
- **THEN** 補完候補に `strong` が出る
- **WHEN** ユーザーが `strong` を確定する
- **THEN** 入力欄が `/model anthropic/claude-sonnet-4-5 strong` になる

#### Scenario: 1 語目が完全一致しない
- **WHEN** ユーザーが入力欄に `/model claude son` と入力する
- **THEN** 補完候補は従来どおり、引数全体で検索したモデルである

### Requirement: /model の引数ヒントは thinking レベルとロールを示す
システムはスラッシュコマンドの補完で、`/model` の引数ヒントを `<provider/model> [level] [role]` と表示しなければならない。(SHALL)

#### Scenario: 引数ヒントの表示
- **WHEN** ユーザーが入力欄に `/mo` と入力して補完候補を表示する
- **THEN** `/model` の候補に引数ヒント `<provider/model> [level] [role]` が表示される
