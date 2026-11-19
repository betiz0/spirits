# managed-commands 仕様差分

## ADDED Requirements

### Requirement: `/spirits-role save` はセッションの選択状況を設定に保存する
一覧の `save` と `/spirits-role save` は、セッションのロックを `models.role` に、選択中のモデルを `defaultProvider` と `defaultModel` に保存しなければならない。(SHALL) 判定には書き込み時点の Pi の global ファイルを使い、保存可能な差分を1回で反映する。差分なしでは書き込まない。(MUST) `defaultProvider` / `defaultModel` の比較は Pi がファイルから読む生の値で行い、前後の空白を除いた値で同一とみなしてはならない。(MUST) `models.role` は spirits の読み取りと同じ正規化で比較してよい。(SHALL) セッションのモデル、ロック、ステップ、thinking、記録、および上記3キー以外の設定を変えてはならない。(MUST NOT) 保存が成立しても、セッションの設定を読み直す再読み込みを行ってはならない。(MUST NOT) Pi の明示指定、スコープ、project 設定の優先順位を変えてはならない。(MUST NOT)

#### Scenario: 保存する乖離が無い
- **GIVEN** global の `models.role` が `strong`、既定が `compat-fake/fake-model` で、セッションの選択と一致する
- **WHEN** 一覧の `save` の行で Enter を押すか `/spirits-role save` を実行する
- **THEN** 変更なしと報告され、ファイルの内容も mtime も変わらず、この操作による設定の再読み込みはない

#### Scenario: ディスクの既定値に前後の空白がある
- **GIVEN** global の `defaultProvider` が `compat-fake `（末尾に空白）、`defaultModel` が `fake-strong` で、セッションは `compat-fake/fake-strong` を選んでいる
- **WHEN** `/spirits-role save` を実行する
- **THEN** 空白を含む値は Pi の解決と同じ値ではないため差分として扱われ、`defaultProvider` は `compat-fake` に、`defaultModel` は `fake-strong` に書き直される
- **AND** その設定で開始した次のセッションは `compat-fake/fake-strong` を選ぶ

#### Scenario: 振り分け用モデルへ替えた後に保存する
- **GIVEN** セッションは `spirits/auto` を選んで strong をロックし、global に利用可能な normal と strong の `provider/id` が設定されている
- **AND** 既定モデルは物理モデルであり、モデルの明示指定・スコープ・project 上書きは既定の選択を妨げない
- **WHEN** `/spirits-role save` を実行し、記録のない新規セッションを開始する
- **THEN** global の既定モデルは `spirits/auto`、既定 role は `strong` になり、新規セッションの最初のステップ外リクエストは strong の対象で応答する

#### Scenario: 保存済みモデルが起動時のスコープに含まれない
- **GIVEN** `spirits/auto` の保存条件を満たすが、Pi の起動時スコープが `compat-fake/fake-model` だけである
- **WHEN** `save` で保存し、そのスコープで新規セッションを開始する
- **THEN** global の既定モデルは `spirits/auto` だが、起動モデルは `compat-fake/fake-model` になり、保存はモデルスコープを変更しない

#### Scenario: 物理モデルを選んでいるときに保存する
- **GIVEN** セッションは `compat-fake/fake-model` を選び normal をロックし、進行中のステップのロールは strong、global の `models.normal` は未設定である
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** global の既定モデルは `compat-fake/fake-model`、既定 role は `normal` になり、ステップ・モデル選択・セッション記録は変わらない

#### Scenario: 一覧を開いた後に global が変わる
- **GIVEN** global の既定 role はロックと一致しており、一覧が global の旧既定から `compat-fake/fake-model` への変更を予告し、その後別プロセスが同じ既定モデルと無関係なキーを保存した
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** 保存時点の値で判定して変更なしとなり、両方のキーを上書きせず、保存のための再読み込みも行わない

### Requirement: 振り分け用モデルは保存後の global 設定で normal が解決できる場合だけ保存する
セッションの選択が `spirits/auto` のとき、保存後の global settings と、global の設定・資格情報・カタログだけで利用できる物理モデルで、成功履歴のない新規セッションの normal が解決できる場合に限り、モデルの2キーを保存しなければならない。(MUST) 旧既定、project の上書き、成功履歴だけでは条件を満たさない。現在のセッションのカタログにだけ存在するモデル、project の拡張が登録した provider、起動時だけ追加されたモデルも条件を満たさない。(MUST NOT) provider の由来を照会できず global の利用可否を判別できない場合は、モデルの2キーを保存してはならない。(MUST) 解決できない場合、およびモデル未選択の場合はモデルの2キーを変えず、ロールに差分があればそれだけを保存しなければならない。(MUST) `models.normal` を補完してはならない。(MUST NOT)

#### Scenario: 旧既定だけが normal を解決する
- **GIVEN** セッションは `spirits/auto`、global の既定は `compat-fake/fake-model`、`models.normal` は未設定で、ロックは global の値と異なる
- **WHEN** `/spirits-role save` を実行する
- **THEN** 既定 role だけが変わり、既定モデルの2キーは変わらず、normal の対象を設定すればモデルを保存できる旨が通知される

#### Scenario: 成功履歴または project の指定だけで解決する
- **GIVEN** 選択は `spirits/auto`、global の `models.normal` は未設定または利用できず、現セッションだけが成功履歴または project の指定から normal を解決できる
- **WHEN** `save` を実行する
- **THEN** global の既定モデルの2キーは変わらない

#### Scenario: project の拡張だけが使えるモデルでは保存しない
- **GIVEN** セッションは `spirits/auto`、保存前の既定は別 project でも利用可能な物理モデルであり、global の `models.normal` は project の拡張だけが登録する provider のモデルを指し、現在の project では解決できる
- **WHEN** `/spirits-role save` を実行し、その provider を登録しない別の project で新しいセッションを開始する
- **THEN** global の `models.normal` を根拠に `spirits/auto` を保存せず、`defaultProvider` / `defaultModel` は変わらず、理由が通知される
- **AND** 別の project の最初の normal 要求は解決できない状態にならない

#### Scenario: provider を省略した normal が保存後に解決できない
- **GIVEN** 選択は `spirits/auto`、global の `defaultProvider` は `compat-fake`、`models.normal` は `fake-model` で、現状は `compat-fake/fake-model` に解決する
- **WHEN** `save` を実行する
- **THEN** 変更後の既定 provider `spirits` では解決できないためモデルの2キーは変わらず、利用可能な `provider/id` で normal を指定する案内が出る

#### Scenario: モデルを選択していない
- **GIVEN** 対話セッションはモデル未選択で、ロックは global の既定 role と異なる
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** 既定 role だけが保存され、一覧が閉じ、ロールの保存結果とモデルを選択していないため保存しなかった理由が通知される

### Requirement: save はディスク上の結果と実効状態を区別する
`save` の行は global の現在値からの変更予定、変更なし、モデルを見送る理由を該当する組合せで示さなければならない。(SHALL) 一覧の通常の設定行と `status` は実効状態を示し、`status` に保存履歴を追加してはならない。(MUST NOT)
`save` は書き込みが成立したとき、および差分が無いときに一覧を閉じ、失敗したときは閉じずに理由をその行に示す。(SHALL) 結果と見送り理由は TUI・RPC の通知でも確認でき、print では保存だけして通知しない。(MUST) 成立と変更なしをエラーとして通知してはならない。(MUST NOT)
`save` は再読み込みを行わない。(MUST NOT) 通常の設定変更の再読み込みは、コマンドでは書き込み後に1回、一覧では閉じるときに一括で1回行う。(MUST) 一覧を閉じずに残る失敗の理由は、その後の再描画が失敗しても失ってはならない。(MUST)

#### Scenario: global と project が異なる
- **GIVEN** global の既定 role は `normal`、信頼済み project の既定 role は `strong`、現在のロックは `strong` であり、project はモデルの既定値も上書きしている
- **WHEN** 一覧から、選択モデルと現在のロックを保存する
- **THEN** `save` 行の予告は global の `normal` から `strong` への変更を示し、一覧が閉じた後の通知はモデルの保存結果を示す
- **AND** 一覧は閉じ、閉じる前か直後に結果と見送り理由が通知される
- **AND** 通常行と `status` は保存の前後で実効状態を報告し、project の設定を上書きしない。たとえば normal が project の既定モデルで解決していた場合は、global の既定モデルを保存した後も同じモデルで解決する
- **AND** `save` は再読み込みしないため、この操作で実効値は変わらない。通常の設定変更で再読み込みした後も project の値が残る

#### Scenario: 保存の失敗はセッションの変更を取り消さない
- **GIVEN** この一覧ではまだ書き込みが成功しておらず、global の設定書き込みだけが失敗する
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** セッション状態は変わらず、一覧は開いたまま、`save` の行に失敗の理由が出る
- **AND** 一覧を閉じても再読み込みしない。TUI または RPC のコマンドで同じ失敗が起きた場合は通知し、再読み込みしない

#### Scenario: 先行する編集の成功は save の失敗で取り消されない
- **GIVEN** 一覧で通常の設定行の書き込みが成功した
- **WHEN** `save` の書き込みが失敗し、その後で一覧を閉じる
- **THEN** `save` の失敗理由は行に表示され、先行した変更のために閉じるときに1回だけ再読み込みする

#### Scenario: 保存後も現在のセッションのロックとステップは変わらない
- **GIVEN** 記録のないセッションが `strong` をロックし、project の既定 role は `normal`、継続する `opsx-propose` がルーティングを一度も通らずに走っている
- **WHEN** `/spirits-role save` を書き込みが成立するように実行する
- **THEN** セッションのロックは `strong` のまま、ステップは `opsx-propose` のままで、次の入力でステップが終わるか続くかは保存前と同じ規則に従う
- **AND** 保存による再読み込みはない

#### Scenario: 差分がない保存はエラーではない
- **GIVEN** global がセッションのロックと選択モデルをすでに持つ
- **WHEN** `save` を実行する
- **THEN** TUI と RPC には変更なしが情報として通知され、エラーとしては通知されない
- **AND** 一覧の `save` の行で操作した場合は一覧が閉じる
- **AND** print では何も出力しない

#### Scenario: 成立した保存は一覧を閉じて通知する

- **GIVEN** 一覧で通常編集はまだ成功しておらず、global に保存する差分がある
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** 保存が成立して一覧が閉じ、閉じる前か直後に保存結果が TUI の通知で示される
- **AND** 閉じるときの再読み込みは行われない

#### Scenario: 失敗の理由は再描画の失敗でも失われない
- **GIVEN** `save` の書き込みが失敗して一覧が開いたままになる
- **AND** その後の再描画が設定の読取りで失敗する
- **WHEN** 一覧の `save` の行を見る
- **THEN** 行には失敗の理由が残り、保存前の予告に戻らない
- **AND** 通常行の読取り失敗は `not redrawn` として行に出る

#### Scenario: 応答中でも保存と通知が成立する
- **GIVEN** セッションが応答中である
- **WHEN** TUI または RPC で `save` を実行する
- **THEN** 書き込みと通知は成立し、再読み込みを行わないためホストの再読み込み拒否に影響されない

#### Scenario: RPC と print で保存する
- **GIVEN** セッションの選択とロックは global の保存済みの値と異なる
- **WHEN** RPC または print モードで `/spirits-role save` を実行する
- **THEN** 同じ条件で同じキーを保存し、RPC では結果が通知されるが print では通知を出さず、結果は global ファイルで確認できる

### Requirement: 一覧は `use normal` / `use strong` の操作行を持つ
一覧は `use normal` と `use strong` の行を `save` の上に置き、`save` とその直後の区行をその下に残さなければならない。(SHALL) 既存の `role lock` の行は残し、値の選択でロックを設定する経路として使えなければならない。(MUST)
それぞれの行は、Enter が確定キーであるときの Enter だけで作動し、候補の一覧を開いてはならない。(MUST NOT) Space、クリック、その他の確定キーではロックも保存も起こしてはならない。(MUST NOT) 各行の説明は、ロックするロールと `save` の予告を示す。(SHALL) この行は新しいコマンドの語彙を増やさず、`/spirits-role <role>` と `/spirits-role save` の連続と同じ書き込みとする。(MUST)

#### Scenario: 操作行の並び
- **WHEN** 対話 TUI で `/spirits-role` を引数なしで実行する
- **THEN** 最上位に `use normal`、`use strong`、`save` の順に操作行が並び、`save` の直後に区行が続く

#### Scenario: use strong は確認 Enter だけで作動する
- **GIVEN** Enter が確定キーであり、global に保存可能な差分がある
- **WHEN** `use strong` の行で Space、クリック、Enter の順に操作する
- **THEN** Space とクリックは候補もロックも保存も起こさず、Enter だけがロックと保存を行って一覧を閉じる

### Requirement: `use` の行はロックと保存を行い、成功で閉じる
行の作動は、`/spirits-role <role>` と同じセッションのロックと、`save` と同じ global 設定への保存を、この順で行わなければならない。(MUST) 両方が成立したとき、またはロックが成立して保存に差分が無いときに一覧を閉じなければならない。(SHALL) ロックの書き込みに失敗したとき、およびロックだけが成立して保存が失敗したときは、閉じずにその行に理由を示さなければならない。(MUST) 閉じる場合はロック・保存の結果と見送り理由を元の TUI 画面の通知で確認できなければならない。(MUST)
閉じるときの再読み込みは、ロックを書いた通常の設定変更として1回だけ試行し、拒否された場合は保存成功と再読み込み未完了を区別して通知しなければならない。(MUST) 保存の成立だけでは再読み込みしてはならない。(MUST NOT)

#### Scenario: use normal でロックと保存を行って閉じる
- **GIVEN** セッションのロックは `strong` で、global の既定 role は `normal`、`models.normal` は保存後の global で解決できる
- **WHEN** 一覧の `use normal` の行で Enter を押す
- **THEN** セッションのロックは `normal` になり、global の `models.role` と既定モデルの2キーはセッションの選択で更新され、一覧が閉じる
- **AND** 閉じるときに 1 回だけ再読み込みし、ロックは `normal` のまま、保存の結果が通知される

#### Scenario: 応答中の再読み込み拒否は保存失敗ではない
- **GIVEN** use のロックと保存が成立し、ホストは応答中で再読み込みを拒否する
- **WHEN** 一覧が閉じる
- **THEN** 再読み込み試行は1回で、元の画面に保存済み・再読み込み未完了と伝わり、設定もロックも取り消されない

#### Scenario: ロックの失敗では閉じない
- **GIVEN** ロックの記録の追記が失敗する
- **WHEN** `use strong` の行で Enter を押す
- **THEN** 保存段階には進まず、一覧は開いたままで、操作行に失敗理由が出る。ロック行と badge はその時点の実ロックを示し、先行編集がなければ閉じても再読み込みしない

#### Scenario: ロックは成立して保存が失敗したら閉じない
- **GIVEN** ロック段階の記録と `models.role` の書き込みは成功し、次の保存段階だけが拒否される
- **WHEN** `use strong` の行で Enter を押す
- **THEN** ロック行と badge は `strong`、ディスクの `models.role` は `strong`、既定モデルの2キーは変更されず、一覧は閉じずに操作行に保存失敗の理由が出る
- **AND** その後に一覧を閉じると、ロックの変更のために 1 回だけ再読み込みする

#### Scenario: モデルの保存を見送っても閉じて理由を通知する
- **GIVEN** セッションは `spirits/auto` を選択し、`models.normal` が保存後の global で解決できない
- **WHEN** `use strong` の行で Enter を押す
- **THEN** ロックと `models.role` は保存され、既定モデルの2キーは変わらず、一覧が閉じてモデルを見送った理由が通知される

### Requirement: 設定ファイルの作成はロック下で行う
システムは、global settings ファイルが存在しないときも、同じパスのファイルロックを先に取得し、ロック下で現在の内容を読んでから、書き込む内容がある場合だけファイルを作成しなければならない。(MUST) 書き込む内容がないときは、ファイルが無くても作成してはならない。(MUST NOT) ロックを取得できなかったときは、ファイルを作成してはならない。(MUST NOT) 存在確認とロック取得の間に別プロセスが作った内容を、空の設定で上書きしてはならない。(MUST NOT)

#### Scenario: ロックがない状態から初回保存する
- **GIVEN** global settings ファイルが存在しない
- **AND** 別プロセスが同じパスのロックを保持している
- **WHEN** `save` を実行する
- **THEN** 保存は失敗として通知され、ファイルは作成されない
- **AND** ロックが解放された後に再度 `save` を実行すると、別プロセスが書いたキーを保持したまま保存できる

#### Scenario: 同時の初回保存で両方のキーが残る
- **GIVEN** global settings ファイルが存在しない
- **WHEN** 2 つのプロセスが同時に異なるキーを保存する
- **THEN** ファイルは解析でき、両方のキーが残り、ロックの残骸も残らない

## MODIFIED Requirements

### Requirement: `/spirits-role` はモデルを変えずに role をロックする
システムは `/spirits-role normal` と `/spirits-role strong` で、セッションのモデルと thinking レベルを変えずに role をロックし、その role をセッションの記録と既定保存キーに残さなければならない。(SHALL)
ロックは継続中のステップを終えなければならない。(MUST) run の実行中にロックされた場合、その run の以降のリクエストにも直ちに適用しなければならない。(SHALL)
物理モデルが選択されている間もロックは保持され、振り分け用のモデルが選択されたときから適用される。(SHALL)

#### Scenario: 引数なしは表示だけ
- **WHEN** `/spirits-role` を引数なしで実行する
- **THEN** 現在のモデル、thinking レベル、role のロック、ステップ、設定ファイルは変わらない
- **AND** TUI は一覧を開き、RPC は稼働状況だけを通知し、print は何も出力しない

#### Scenario: 現在のモデルのまま strong にする
- **WHEN** `compat-fake/fake-model` を選ぶセッションで `/spirits-role strong` を実行する
- **THEN** モデルと thinking レベルは変わらず、以後のリクエストは strong の対象になり、既定 role の保存キーが strong になる

#### Scenario: 実行中の run に直ちに効く
- **GIVEN** `spirits/auto` が選択され、normal をロックしており、継続するステップの run が走っている
- **WHEN** run の実行中に `/spirits-role strong` を実行する
- **THEN** その run の以降のリクエストは strong の対象モデルへルートされ、ステップは終わっている

#### Scenario: 物理モデルを選択していてもロックは残る
- **GIVEN** 現在のモデルが物理モデルであるセッションで `/spirits-role strong` を実行した
- **WHEN** ロールを指定せずに `spirits/auto` へ切り替えてリクエストする
- **THEN** リクエストは strong の対象モデルへルートされる

### Requirement: `/spirits-role` は対象 項目 値の文法で設定する

システムは `/spirits-role` の引数を、対象、項目、値の順として解釈しなければならない。(SHALL) 対象はロール名(`normal` / `strong`)、ステップ名、`status`、`save`、および引数なしの 5 通りとする。項目はロールに対して `model` と `thinking`、ステップに対して `role` と `thinking` とする。値に `unset` が指定されたときは、その項目を未設定に戻す。(SHALL)
`save` は項目と値を取らない。(MUST)
ロールのモデルの値は行末までの全体を参照とし、空白を含む参照を受け付けなければならない。(MUST)
対象と項目と値の語の照合は大文字小文字を区別しない。(SHALL)
解釈できない入力、項目を要求する対象に対して項目と値を省略した入力、および `save` に項目または値を続けた入力では、設定、セッションのロック、記録のいずれも変更してはならない。その場合、使い方を伝える。(MUST) 使い方には `save` を、項目も値を取らない対象として含めなければならない。(MUST)

#### Scenario: ロールのモデルを設定する

- **WHEN** 利用者が `/spirits-role strong model compat-fake/fake-strong` を送る
- **THEN** strong の対象が `compat-fake/fake-strong` として保存され、ロックとステップは変わらない

#### Scenario: 空白を含むモデル参照

- **GIVEN** ID に空白を含む物理モデル(provider `Local`、ID `Qwen3.8 Flash Next`)が 1 件だけ存在する
- **WHEN** `/spirits-role normal model Local/Qwen3.8 Flash Next` を送る
- **THEN** 行末までを参照として解決し、normal の対象が `Local/Qwen3.8 Flash Next` として保存される
- **AND** 参照の照合は `provider/id` と ID に対して行い、表示名(モデルの `name`)は照合しない

#### Scenario: ステップのロールと thinking を設定する

- **WHEN** `/spirits-role opsx-propose role strong` に続いて `/spirits-role opsx-propose thinking high` を送る
- **THEN** そのステップのロールが strong、thinking レベルが high として保存される

#### Scenario: 未設定へ戻す

- **GIVEN** あるステップの thinking レベルが設定されている
- **WHEN** `/spirits-role opsx-propose thinking unset` を送る
- **THEN** そのステップの thinking レベルのキーだけが削除され、そのステップのロール設定は残る

#### Scenario: 解釈できない入力は変更しない

- **WHEN** `/spirits-role strong bogus high` を送る
- **THEN** 設定、ロック、記録は変わらず、使い方が伝えられる

#### Scenario: 一覧に無い語は設定を変更しない

- **WHEN** `/spirits-role teleport role strong` を送る
- **THEN** 現在のモデル、thinking レベル、role、ステップ、設定ファイルは変わらず、使い方が伝えられる

#### Scenario: 大文字小文字を区別しない

- **WHEN** `/spirits-role OpsX-Propose Role STRONG` を送る
- **THEN** `opsx-propose` のロールが strong として保存される

#### Scenario: 項目を省略したステップ指定

- **WHEN** `/spirits-role opsx-propose` だけを送る
- **THEN** 設定は変わらず、`role` か `thinking` を要求する使い方が伝えられる

#### Scenario: 空のモデル参照

- **WHEN** `/spirits-role normal model` を項目だけで送る
- **THEN** 設定は変わらず、モデル参照を要求する使い方が伝えられる

#### Scenario: save に項目や値を続けない

- **WHEN** `/spirits-role save strong` を送る
- **THEN** 設定、ロック、記録は変わらず、`save` は項目と値を取らないことを含む使い方が伝えられる

#### Scenario: 引数誤りの使い方に save が載る

- **WHEN** `/spirits-role bogus` を送る
- **THEN** 使い方に `/spirits-role save` が含まれ、`save` が項目と値を取らないことが読める

### Requirement: `/spirits-role` は対話端末で設定と稼働の一覧を開く

システムは対話 TUI で引数なしの `/spirits-role` を受け取ったとき、1 行 1 設定項目の一覧を開かなければならない。(SHALL) 一覧は、`use normal` と `use strong` の操作行を最上位に置き、その下に `save` の行、直後に値も説明も持たない区行を置いて、セッションのロック、2 つのロールのモデルと thinking レベル、ステップ一覧の設定を並べる。(SHALL) 選択中の通常の設定行にはその項目の解決結果(実際に応答するモデル、有効な thinking レベル、継続の有無、警告)を表示する。(SHALL)
`use normal` / `use strong` と `save` の行は Enter が確定キーであるときの Enter だけで作動し、候補の一覧を開いてはならない。(MUST NOT) Space、クリック、その他の確定キーではロックも保存もしない。区行はいずれの確定操作でも候補を開かず、設定とセッションを変えてはならない。(MUST NOT)
ステップは 1 ステップを 1 行とし、そのステップのロールと thinking レベルの組を 1 つの設定項目として扱う。(SHALL)
ロール未指定のステップはロックに従う旨、既定ロールが効いている行はその旨、そのセッションに開始コマンドが 1 つもないステップはその旨を表示する。(SHALL)
対話 TUI 以外では一覧を開かない。RPC では稼働状況を通知し、print では一覧も稼働状況も出力しない。(MUST)

#### Scenario: 一覧の開閉

- **WHEN** 対話 TUI で `/spirits-role` を引数なしで実行する
- **THEN** 最上位に `use normal` と `use strong` の行、その下に `save` の行、直後に区行、続いてロック、2 ロールのモデルと thinking、ステップ設定が並び、`save` は予告、通常の設定行は解決結果を出す

#### Scenario: save は確認 Enter だけで作動する
- **GIVEN** Enter が確定キーであり、global に保存可能な差分がある
- **WHEN** 各ケースで一覧を新たに開き、 `use normal`、`use strong`、`save` の各行で Space、クリック、Enter の順に操作する
- **THEN** Space とクリックは候補も書き込みも起こさず、Enter だけが候補を開かずにその行の操作を行う

#### Scenario: 区行は操作を受け付けない

- **WHEN** 一覧の区行にカーソルを置いて Enter を押す
- **THEN** 候補の一覧は開かず、設定、セッションのロック、記録は変わらない

#### Scenario: 開始コマンドが無いステップ

- **GIVEN** あるステップの開始コマンドが、このセッションで利用できるスキルおよびテンプレートに 1 つも無い
- **WHEN** 一覧が開かれる
- **THEN** その行に開始コマンドが無い旨が表示されるが、設定の操作は受け付けられる

#### Scenario: 対話端末以外では一覧を開かない

- **WHEN** RPC モードまたは print モードで `/spirits-role` を引数なしで実行する
- **THEN** RPC では一覧は開かれず稼働状況が通知され、print では一覧も稼働状況も出力されない

### Requirement: 一覧の説明は実際の解決結果を示す
システムは、一覧のロックの行に、ステップの既定ロールやステップ設定ではなく、セッションがロックしているロールを出さなければならない。(MUST)
行の説明に出す解決結果は設定値の写しではなく、その時点でリクエストを解決したときに実際に応答するモデルとしなければならない。(MUST) 設定済みで使えない対象の行には、使えない旨とその理由、代わりに応答するモデルを出す。(SHALL) 直近のリクエストがあるときは、そのロール・物理モデル・要求した thinking レベルをロックの行の説明に出す。(SHALL)
書き込みに成功した行は、再読み込みを待たずに、値と説明の解決結果の両方を新しい値へ更新する。(SHALL)
振り分けが無効なセッションでは、すべての通常の設定行の説明の先頭に無効であることと現在のモデル(`provider/id`)を述べ、応答モデルの記述を仮定法で書く。(SHALL) その記述は、同じ条件で振り分けが有効だった場合にルーティングが返す解決と一致しなければならない。(MUST)
通常の設定行の説明は、振り分けが無効である旨と現在のモデル、保存の失敗とその理由、警告の内容、応答モデルの記述の順に並べる。(SHALL) 振り分けが働いていない旨は 1 つの説明に 1 度だけ述べる。(MUST) スコープの診断と有効化の操作は一覧の説明には出さず、`/spirits-role status` に出す。(SHALL)
一覧のロールのモデルの行が候補として出すモデルは、その時点で利用できる物理モデル(振り分け用のモデルを除く)とし、セッションのモデルスコープで制限してはならない。(MUST NOT) 保存済みの対象がセッションのスコープに含まれるかどうかの診断も、一覧の説明に出さない。(MUST NOT)
読めない設定値の診断は、その設定が使えない理由として示すが、同じ行に実際に応答するモデルの記述を置かなければならない。(MUST) 診断だけを出して応答モデルを隠してはならない。(MUST NOT)

#### Scenario: 使えない対象の行は代わりに応答するモデルを出す
- **GIVEN** strong の対象が `nowhere/nothing` に設定され、そのモデルは利用できず、normal の対象は `compat-fake/fake-model` に解決できる
- **WHEN** 一覧の `strong` のモデルの行を選ぶ
- **THEN** 説明に strong の対象が使えない旨とその理由、strong のリクエストが `compat-fake/fake-model` で応答する旨が出る

#### Scenario: ステップの既定ロールで走っている間もロックの行はロックを出す
- **GIVEN** normal がロックされ、`/skill:sprt-opsx-verify-deep` の run が走っている
- **WHEN** その run の途中で一覧を開く
- **THEN** ロックの行は normal を示し、`sprt-opsx-verify-deep` の行の説明に strong で走っている旨が出る

#### Scenario: 振り分けが無効なときは仮定法で述べる
- **GIVEN** 現在のモデルが物理モデルであり、`opsx-propose` のロールが strong に設定され、strong の対象が利用できる
- **WHEN** 一覧を開いて `opsx-propose` の行を選ぶ
- **THEN** 説明の先頭に振り分けが無効であることと現在のモデルが出て、応答するモデルは仮定法で示される
- **AND** 一覧のどの通常の設定行の説明も、その仮定の下でルーティングが返す解決と一致する

#### Scenario: 振り分けが働いていない旨は 1 つの説明に 1 度だけ出す
- **GIVEN** 現在のモデルが物理モデルで、strong の対象が設定されていない
- **WHEN** 一覧でロックを strong に切り替え、ロックの行と `strong` のモデルの行を選ぶ
- **THEN** どちらの行の説明でも、振り分けが働いていない旨は先頭に 1 度だけ出て、strong が normal の対象で走る旨がその後に続く

#### Scenario: 一覧の候補はセッションのスコープで制限しない
- **GIVEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が利用でき、セッションのモデルスコープが `spirits/auto` だけである
- **WHEN** 一覧の `strong` のモデルの行で候補を開く
- **THEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が候補に出て、`unset` も選べる
- **AND** 説明に、保存済みの対象がスコープ外である旨の診断は出ない

#### Scenario: 読めない normal でも実際に応答するモデルを出す
- **GIVEN** `models.normal` が数値で書かれ、Pi の既定モデルは利用できる
- **WHEN** 一覧の `normal` のモデルの行を選ぶ
- **THEN** 説明には `models.normal` が読めない理由と、実際に応答する Pi の既定モデルの両方が出る

### Requirement: 一覧の説明の thinking レベルは要求に載るレベルを示す
システムは、一覧の通常の設定行の説明に出す thinking レベルを、その時点でリクエストを解決したときに要求に載るレベルとし、実際に応答するロールの設定から決めなければならない。(MUST) strong が使えず normal の対象で応答するときは、strong の設定ではなく normal の設定から決める。ロールの thinking レベルの行も、そのロールの要求に実際に載るレベルを示す。(SHALL)
行の説明に出すモデルと thinking レベルは、同じ条件でルーティングが返すモデルと thinking レベルに一致しなければならない。(MUST) 振り分けが無効なセッションでは、この一致は、同じ条件で振り分けが有効だった場合にルーティングが返すモデルと thinking レベルに対するものとする。(MUST)
この一致はすべての通常の設定行に及び、`save` 行と区行には適用しない。ロックの行が示す実行中のステップのロール、ロールのモデルの行が示す応答モデル、ステップの行、ロールの thinking レベルの行は、どれも同じ条件でルーティングが返すロール、モデル、thinking レベルと一致しなければならない。(MUST)

#### Scenario: strong が落ちるステップの行は normal のレベルを示す
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定されておらず、strong の thinking レベルが max、normal の thinking レベルが low、`opsx-propose` のロールが strong に設定されている
- **WHEN** 一覧の `opsx-propose` の行を選ぶ
- **THEN** 説明は normal の対象のモデルで応答し、thinking レベル low を要求する旨を示し、max を要求するとは示さない
- **AND** `/opsx-propose` の run のリクエストは、説明と同じモデルと thinking レベル low で送られる

#### Scenario: 使えない strong の thinking レベルの行
- **GIVEN** strong の対象が設定されておらず、strong の thinking レベルが max、normal の thinking レベルが low である
- **WHEN** 一覧の `strong` の thinking レベルの行を選ぶ
- **THEN** 説明は、strong の要求が normal の対象で走り low を要求する旨を示す

#### Scenario: ロールのモデルの行とロックの行もルーティングと一致する
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定済みで使えず、normal の対象は Pi の既定モデルに解決でき、normal がロックされ、`opsx-propose` のロールが strong に設定されて継続中である
- **WHEN** 一覧の `strong` のモデルの行とロックの行を選ぶ
- **THEN** `strong` のモデルの行は、strong の要求に実際に応答するモデルとして、同じ条件でルーティングが返すモデルを示す
- **AND** ロックの行は、実行中の `opsx-propose` が走るロールとして、同じ条件でルーティングが要求したロール(strong)を示す

### Requirement: 物理モデル選択中の設定変更は振り分けが働いていないことを伝える
システムは、セッションが物理モデルを選択している場合、コマンドによるすべての設定変更(ロック、ロールのモデルと thinking レベル、ステップのロールと thinking レベル、`unset` による削除、TUI・RPC で `save` により書き込みが成立した場合を含む)で、振り分けが働いていないことと、振り分け用のモデルを選択すると有効になることを 1 行で伝えなければならない。(SHALL) 警告しても設定を取り消してはならない。(MUST)
対話端末で伝える手順は、そのセッションで実際に実行できる手順でなければならない。(MUST) 振り分け用のモデルがこのセッションのモデルスコープに含まれない場合は、モデル selector で選択対象の範囲を切り替える操作、またはモデルのスコープを設定する操作で有効化できることを名指す。(SHALL) 対話端末でないセッションでは操作を名指さない。(MUST NOT) モデル未選択のセッションを物理モデルの選択として扱い、この警告を出してはならない。(MUST NOT)

#### Scenario: 物理モデル選択中に設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role opsx-propose role strong` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが伝えられる

#### Scenario: 物理モデル選択中に thinking を設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role normal thinking high` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが 1 行伝えられる

#### Scenario: スコープ外の手順を名指す
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `/spirits-role opsx-propose role strong` を実行する
- **THEN** 伝えられる手順は、その設定のまま `spirits/auto` に到達できる操作を名指す

#### Scenario: 物理モデルの選択をコマンドで保存する
- **GIVEN** 現在のモデルは物理モデル `compat-fake/fake-model` で、global の既定モデルは異なる
- **WHEN** 対話 TUI または RPC で `/spirits-role save` を実行する
- **THEN** 保存結果に加え、振り分けが無効であり `spirits/auto` を選ぶと有効になることが伝えられる

### Requirement: 専用コマンドの表面の違いを文書に残す
システムは、`/spirits-*` による操作がホストの操作と同じ目的を満たすが、コマンド名、表示位置、表示の消去の有無、ホストのコマンドとの統合、対話端末でしか使えない操作という点で異なることを文書に記録しなければならない。(SHALL)
モデルの選択と thinking レベルの既定保存が、ホストの `/model` と `/thinking` でも満たせることを同じ文書に記録しなければならない。(SHALL) ロールの対象設定、現在のセッションのモデル選択、`save` による現在の選択の global 既定への保存を区別して記録する。(MUST) 一覧の `use normal` / `use strong` と `save` の行が成功で一覧を閉じ、結果を TUI 通知で確認でき、失敗では一覧を閉じず理由を行に出すことを記録する。(MUST)
ホストが表示する Pi の帰属表示はそのまま受け入れること、および第三者拡張が登録した provider のモデルを `rlm` の子では使えないことを、同じ文書に記録しなければならない。(SHALL)

#### Scenario: 限定向けの文書
- **WHEN** managed 経路の機能一覧を読む
- **THEN** `/spirits-*` の各目的、ホストの操作との違い、ロールの対象の選択とセッションのモデル選択の区別、ホストの `/model` と `/thinking` の代替関係、Pi の帰属表示と第三者 provider の制約が記載されている

#### Scenario: モデル選択と既定への保存を区別する文書
- **WHEN** `/spirits-role save` の説明を読む
- **THEN** 現セッションのモデルを切り替えないこと、保存条件、Pi の既定選択の優先順位、print で通知しないことが記載されている

#### Scenario: 一覧の操作行と閉じる振る舞いを記す文書
- **WHEN** 一覧の `use normal` / `use strong` と `save` の説明を読む
- **THEN** use はロック後に保存し、save はロックを変えずに保存して一覧を閉じること、閉じた後も結果と見送り理由を通知で確認できること、失敗では開いたままで理由が行に出ること、閉じるときの再読み込みが記載されている

### Requirement: 入力の補完は語彙を限定する

システムは `/spirits-role` の引数補完で、1 語目に `status`、`save`、ロール名、ステップ名、2 語目に項目名、3 語目にロール名、thinking レベル、`unset` を提示しなければならない。(SHALL) モデルの参照は補完しない。(MUST NOT)

#### Scenario: 1 語目

- **WHEN** `/spirits-role ` の後ろで補完を開く
- **THEN** `status`、`save`、ロール名、ステップ名が候補に出る

#### Scenario: 2 語目に項目名

- **WHEN** `/spirits-role opsx-propose ` の後ろで補完を開く
- **THEN** `role` と `thinking` が候補に出る

#### Scenario: 3 語目にロール名とレベル

- **WHEN** `/spirits-role opsx-propose role ` の後ろで補完を開く
- **THEN** `normal`、`strong`、`unset` が候補に出る
- **AND** `/spirits-role opsx-propose thinking ` の後ろでは thinking レベルと `unset` が候補に出る

#### Scenario: モデル参照は補完しない

- **WHEN** `/spirits-role normal model ` の後ろで補完を開く
- **THEN** モデルの候補は出ない
