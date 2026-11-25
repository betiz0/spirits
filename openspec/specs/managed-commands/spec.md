# managed-commands Specification

## Purpose

ホストが持たない role 操作と会話のクリアを、`spirits` 拡張が `/spirits-role` と `/spirits-clear` としてホストを問わず registered コマンドで提供する。モデルと thinking レベルの既定保存はホストの `/model` と `/thinking` に任せ、spirits は振り分け用のロールの対象だけを設定する。ロールの対象は spirits 専用の設定と session 記録に保存し、旧ビルドが書いた記録からは片方向でだけ引き継ぐ。設定の書き込みは Pi と同じキー・同じロック手順を使い、クリアした会話が要約や次セッションから復活しないことを保証する。

## Requirements

### Requirement: `save` は振り分け用のモデルを選択しているセッションの選択状況を global 既定に保存する
一覧の `save` と `/spirits-role save` は、セッションのロックを `models.role` に、選択中のモデルを `defaultProvider` と `defaultModel` に保存しなければならない。(SHALL) 判定には書き込み時点の pi の global ファイルを使い、保存可能な差分を 1 回で反映する。差分なしでは書き込まない。(MUST) `defaultProvider` / `defaultModel` の比較は pi がファイルから読む生の値で行い、前後の空白を除いた値で同一とみなしてはならない。(MUST) `models.role` は spirits の読み取りと同じ正規化で比較してよい。(SHALL) セッションのモデル、ロック、ステップ、thinking、記録、および上記 3 キー以外の設定を変えてはならない。(MUST NOT) 保存が成立しても再読み込みを行ってはならない。(MUST NOT) Pi の明示指定、スコープ、project 設定の優先順位を変えてはならない。(MUST NOT)

#### Scenario: 保存する乖離が無い
- **GIVEN** セッションは振り分け用の `spirits/auto` を選んでいて、global の `models.role` が `strong`、既定が `spirits/auto` で、セッションの選択と一致する
- **WHEN** 一覧の `save` の行で Enter を押すか `/spirits-role save` を実行する
- **THEN** 変更なしと報告され、ファイルの内容も mtime も変わらず、この操作による設定の再読み込みはない

#### Scenario: ディスクの既定値に前後の空白がある
- **GIVEN** global の `defaultProvider` が `spirits `(末尾に空白)、`defaultModel` が `auto` で、セッションは振り分け用の `spirits/auto` を選んでいる
- **WHEN** `/spirits-role save` を実行する
- **THEN** 空白を含む値は pi の解決と同じ値ではないため差分として扱われ、`defaultProvider` は `spirits`、`defaultModel` は `auto` に書き直される

#### Scenario: 振り分け用モデルへ替えた後に保存する
- **GIVEN** セッションは `spirits/auto` を選んで strong をロックし、global に利用可能な normal と strong の `provider/id` が設定されている
- **AND** 既定モデルは物理モデルであり、モデルの明示指定・スコープ・project 上書きは既定の選択を妨げない
- **WHEN** `/spirits-role save` を実行し、記録のない新規セッションを開始する
- **THEN** global の既定モデルは `spirits/auto`、既定 role は `strong` になり、新規セッションの最初のステップ外リクエストは strong の対象で応答する

#### Scenario: 保存済みモデルが起動時のスコープに含まれない
- **GIVEN** `spirits/auto` の保存条件を満たすが、pi の起動時スコープが `compat-fake/fake-model` だけである
- **WHEN** `save` で保存し、そのスコープで新規セッションを開始する
- **THEN** global の既定モデルは `spirits/auto` だが、起動モデルは `compat-fake/fake-model` になり、保存はモデルスコープを変更しない

#### Scenario: 一覧を開いた後に global が変わる
- **GIVEN** セッションは `spirits/auto` を選んでいて、global の既定 role はロックと一致しており、一覧が global の旧既定から `spirits/auto` への変更を予告し、その後別プロセスが同じ既定モデルと無関係なキーを保存した
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** 保存時点の値で判定して変更なしとなり、どちらのキーも書き直さず、保存のための再読み込みも行わない

### Requirement: 物理モデルを選択中は `save` が global 設定を見送る
システムは、セッションがモデルを選択していて、かつそのモデルが spirits の振り分け用のモデルでないとき(他拡張が登録した仮想モデルを含む)、`/spirits-role save` および一覧の `save` の行による pi の global settings への書き込みを見送らなければならない。(MUST) 見送りでは `models.role`、`defaultProvider`、`defaultModel` のいずれも書き換えない。(MUST NOT) global ファイルが存在しないときに作成してはならない。(MUST NOT) 見送りは global の値・読み取りの成否に依存せず、書き込みを試みない。(MUST) 一覧の予告用の読み取りは許容する。モデル未選択では見送らない。(MUST NOT) 振り分け用と認めるには `spirits/auto` の識別子と仮想モデルの種別の両方が一致しなければならない。(MUST) 見送り理由は選択中のモデルの実態と一致しなければならない。(MUST)

#### Scenario: 物理モデルを選択して save を実行する
- **GIVEN** 現在のモデルが物理モデル `compat-fake/fake-model` であり、global の既定モデルと既定 role はセッションの選択と異なる
- **WHEN** 対話 TUI または RPC で `/spirits-role save` を実行する
- **THEN** 3 のキーはいずれも変わらず、global ファイルの更新時刻も変わらず、再読み込みも行われない

#### Scenario: 一覧の save 行で見送る
- **GIVEN** 現在のモデルが物理モデルであり、global に保存する差分がある
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** ファイルは変わらず、一覧は閉じない
- **AND** 同じ一覧で先行して成功した編集がある場合は、その編集のための閉じるときの 1 回の再読み込みは従来どおり行う

#### Scenario: 物理モデルで global と差分が無い場合も見送る
- **GIVEN** 現在のモデルが物理モデル `compat-fake/fake-model` であり、global の既定モデルは同じモデルで、既定 role もセッションのロックと一致している
- **WHEN** `/spirits-role save` を実行する
- **THEN** 変更なしではなく見送りとして伝えられ、ファイルの内容も mtime も変わらない

#### Scenario: 他拡張の仮想モデルも振り分け用ではない
- **GIVEN** 現在のモデルが他拡張の登録した仮想モデル `other/router` であり、spirits の振り分けはこのセッションで働いていない
- **WHEN** `/spirits-role save` を実行する
- **THEN** 見送りとなり、3 のキーは変わらない
- **THEN** 見送り理由は選択中のモデルが spirits の振り分け用ではないことを述べ、物理モデルが選択されているとは述べない

#### Scenario: 同名の物理モデルでも保存を見送る
- **GIVEN** 起動済みのコンテキストに物理モデル `spirits/auto` が渡されている。固定ホスト Pi 1.5.0 では同名の衝突で拡張の読み込み自体を起動時に拒否するため、実セッションではこの状態にならず、本シナリオは渡された選択に対する防御条件としてテストで担保する
- **WHEN** コマンドまたは一覧から `save` を実行する
- **THEN** 見送りとなり、設定ファイルの書き込みを試みず、再読み込みも行わない

#### Scenario: 振り分け用のモデルを選択していれば従来どおり保存する
- **GIVEN** セッションは `spirits/auto` を選び、保存後の global settings と global のカタログだけで normal が解決できる
- **WHEN** `/spirits-role save` を実行する
- **THEN** 従来の条件と判定で `models.role` と既定モデルの 2 キーが保存される

#### Scenario: モデル未選択では見送らない
- **GIVEN** 対話セッションはモデル未選択で、ロックは global の既定 role と異なる
- **WHEN** `save` を実行する
- **THEN** `models.role` だけが保存され、モデルが未選択であるため既定モデルは書かない旨が結果に添えられる

#### Scenario: global ファイルが無いセッションで見送る
- **GIVEN** 現在のモデルが物理モデルで、pi の global settings ファイルが存在しない
- **WHEN** `save` を実行する
- **THEN** ファイルは作成されず、見送りであることが伝えられる

### Requirement: `save` の見送りは一覧の行と通知に出す
システムは見送りについて、書き込まないことと理由を伝えなければならない。(SHALL) 見送りは失敗でも変更なしでもなく、コマンド面では対話端末と RPC で warning として通知する。(SHALL) 一覧全体の見送りは一覧を開いたまま行に理由を残すため通知を出さず、行だけが理由を伝える。(MUST) 見送りをエラーとして通知してはならない。(MUST NOT) 一覧の `save` の行は見送りを行に出し、一覧を閉じない。(SHALL) 見送り理由は、書き込み予定の予告よりも、および global ファイルの読み取り失敗よりも先に出す。(SHALL) 見送りのために再読み込みを行ってはならない。(MUST NOT) print では通知しない。(MUST)

#### Scenario: 見送りはエラーではない
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** 対話 TUI または RPC で `save` を実行する
- **THEN** 通知はエラーではなく、設定もセッション状態も変わらない

#### Scenario: 見送りの通知は warning の型で出る
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** 対話 TUI または RPC で `save` を実行する
- **THEN** 通知の型は warning であり、error でも info でもない

#### Scenario: 見送りの理由は予告を置き換える
- **GIVEN** 現在のモデルが物理モデルであり、global には保存可能な差分がある
- **WHEN** 一覧を開いて `save` の行を見るか、その行で Enter を押す
- **THEN** 行は書き込み予定の列挙ではなく、見送りであることと理由を出す
- **AND** その理由は振り分けが無効である旨を 1 度だけ述べ、有効化の操作を名指さない

#### Scenario: global が読めないときも見送り理由が行に出る
- **GIVEN** 現在のモデルが物理モデルであり、pi の global settings ファイルが読めない
- **WHEN** 一覧を開いて `save` の行を見、その行で Enter を押す
- **THEN** 行には読み取りの失敗や書き込み予定の予告ではなく見送り理由が出、書き込みは試みられず、一覧は開いたままである

#### Scenario: 見送りの理由は再描画の失敗で失われない
- **GIVEN** 現在のモデルが物理モデルで、一覧の `save` の行で見送りを出した
- **AND** その後の再描画が設定の読取りで失敗する
- **WHEN** 一覧の `save` の行を見る
- **THEN** 行には見送りの理由が残り、書き込み予定の予告に戻らない

#### Scenario: print では見送りも通知しない
- **GIVEN** print モードのセッションが物理モデルを選択している
- **WHEN** `/spirits-role save` を実行する
- **THEN** 出力はなく、global ファイルも変わらない

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
`save` の行は global の現在値からの変更予定、変更なし、モデルを見送る理由、および物理モデルの選択による見送りを該当する組合せで示さなければならない。(SHALL) 見送りは失敗でも変更なしでもなく、その区別は行・通知・ファイルのいずれでも保つ。(MUST) 一覧の通常の設定行と `status` は実効状態を示し、`status` に保存履歴を追加してはならない。(MUST NOT)
`save` は書き込みが成立したとき、および差分が無いときに一覧を閉じ、失敗したとき、および物理モデルの選択で見送ったときは閉じずに理由をその行に示す。(SHALL) コマンド面の結果と見送り理由は TUI・RPC の通知で確認でき、print では保存だけして通知しない。(MUST) 一覧全体の見送りは一覧を閉じないため通知を出さず、行だけが理由を伝える。(MUST) 一覧が保存の成立または差分なしで閉じるとき、その info 通知が結果を伝える。(MUST) 成立と変更なしをエラーとして通知してはならない。(MUST NOT)
`save` は再読み込みを行わない。(MUST NOT) 通常の設定変更の再読み込みは、コマンドでは書き込み後に1回、一覧では閉じるときに一括で1回行う。(MUST) 一覧を閉じずに残る失敗と見送りの理由は、その後の再描画が失敗しても失ってはならない。(MUST)

#### Scenario: global と project が異なる
- **GIVEN** global の既定 role は `normal`、信頼済み project の既定 role は `strong`、現在のロックは `strong` であり、project はモデルの既定値も上書きしており、セッションは `spirits/auto` を選んでいる
- **WHEN** 一覧から、選択モデルと現在のロックを保存する
- **THEN** `save` 行の予告は global の `normal` から `strong` への変更を示し、一覧が閉じた後の通知はモデルの保存結果を示す
- **AND** 一覧は閉じ、閉じる前か直後に保存結果が通知される。一覧全体の見送りは一覧を閉じないため通知を出さず、行だけが理由を伝える
- **AND** 通常行と `status` は保存の前後で実効状態を報告し、project の設定を上書きしない。たとえば normal が project の既定モデルで解決していた場合は、global の既定モデルを保存した後も同じモデルで解決する
- **AND** `save` は再読み込みしないため、この操作で実効値は変わらない。通常の設定変更で再読み込みした後も project の値が残る

#### Scenario: 保存の失敗はセッションの変更を取り消さない
- **GIVEN** セッションは `spirits/auto` を選んでいて、この一覧ではまだ書き込みが成功しておらず、global の設定書き込みだけが失敗する
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** セッション状態は変わらず、一覧は開いたまま、`save` の行に失敗の理由が出る
- **AND** 一覧を閉じても再読み込みしない。TUI または RPC のコマンドで同じ失敗が起きた場合は通知し、再読み込みしない

#### Scenario: 先行する編集の成功は save の失敗で取り消されない
- **GIVEN** セッションは `spirits/auto` を選んでいて、一覧で通常の設定行の書き込みが成功した
- **WHEN** `save` の書き込みが失敗し、その後で一覧を閉じる
- **THEN** `save` の失敗理由は行に表示され、先行した変更のために閉じるときに1回だけ再読み込みする

#### Scenario: 保存後も現在のセッションのロックとステップは変わらない
- **GIVEN** 記録のないセッションが `spirits/auto` を選んで `strong` をロックし、project の既定 role は `normal`、継続する `opsx-propose` がルーティングを一度も通らずに走っている
- **WHEN** `/spirits-role save` を実行する
- **THEN** セッションのロックは `strong` のまま、ステップは `opsx-propose` のままで、次の入力でステップが終わるか続くかは保存前と同じ規則に従う
- **AND** 保存による再読み込みはない

#### Scenario: 差分がない保存はエラーではない
- **GIVEN** セッションは `spirits/auto` を選んでいて、global がセッションのロックと選択モデルをすでに持つ
- **WHEN** `save` を実行する
- **THEN** TUI と RPC には変更なしが情報として通知され、エラーとしては通知されない
- **AND** 一覧の `save` の行で操作した場合は一覧が閉じる
- **AND** print では何も出力しない

#### Scenario: 成立した保存は一覧を閉じて通知する
- **GIVEN** セッションは `spirits/auto` を選んでいて、一覧で通常編集はまだ成功しておらず、global に保存する差分がある
- **WHEN** 一覧の `save` の行で Enter を押す
- **THEN** 保存が成立して一覧が閉じ、閉じる前か直後に保存結果が TUI の通知で示される
- **AND** 閉じるときの再読み込みは行われない

#### Scenario: 失敗の理由は再描画の失敗でも失われない
- **GIVEN** セッションは `spirits/auto` を選んでいて、`save` の書き込みが失敗して一覧が開いたままになる
- **AND** その後の再描画が設定の読取りで失敗する
- **WHEN** 一覧の `save` の行を見る
- **THEN** 行には失敗の理由が残り、保存前の予告に戻らない
- **AND** 通常行の読取り失敗は `not redrawn` として行に出る

#### Scenario: 応答中でも保存と通知が成立する
- **GIVEN** セッションは `spirits/auto` を選んでいて、応答中である
- **WHEN** TUI または RPC で `save` を実行する
- **THEN** 書き込みと通知は成立し、再読み込みを行わないためホストの再読み込み拒否に影響されない

#### Scenario: RPC と print で保存する
- **GIVEN** セッションは `spirits/auto` を選んでいて、選択とロックは global の保存済みの値と異なる
- **WHEN** RPC または print モードで `/spirits-role save` を実行する
- **THEN** 同じ条件で同じキーを保存し、RPC では結果が通知されるが print では通知を出さず、結果は global ファイルで確認できる


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

### Requirement: 設定の書き込みは Pi と同じロック手順で行う
システムは、spirits の設定キーと Pi の既定値を Pi の global settings ファイルに書き込まなければならない。(SHALL) project 単位の設定ファイルには書き込まない。(MUST)
書き込みは、Pi の設定保存と同じ手続きに従わなければならない。(MUST) すなわち、同じパスに対してファイルロックを `realpath` を使わずに取得し、ロック取得が競合した場合は再試行し、ロック下で現在のファイルを読み、変更する経路だけをディスクの現在値に反映し、書き込み、ロックを解放する。マージされていないフィールドと、Pi が知らないキーは保持しなければならない。(MUST)
入れ子の設定キーの反映は、指定した経路だけを変えなければならない。(MUST) あるステップの設定を変えたとき、ほかのステップと兄弟キーはそのまま残る。(MUST) 未設定へ戻す指定は、対象のキーを削除する。(SHALL)
Pi の設定保存と交互に書き込んだ結果、どちらの側の変更も失われず、ファイルは解析できる状態でなければならない。(MUST)
別プロセスから同時に書き込んでも、ファイルは解析できる状態でなければならない。(MUST)

#### Scenario: Pi の書き込みと交互に書く
- **WHEN** Pi が既定 thinking レベルを保存した直後に、spirits が既定 role だけを書き込む
- **THEN** ファイルには Pi が保存した thinking レベルと、spirits が書いた role と、Pi が知らない spirits 独自キーが同時に残る

#### Scenario: ステップ 1 件の変更でほかのステップが残る
- **GIVEN** 設定ファイルに 2 つのステップ設定がある
- **WHEN** うち 1 つの thinking レベルだけを変更する設定を書く
- **THEN** 変更したステップのキーだけが変わり、もう 1 つのステップ設定と `models` のほかのキーはそのまま残る

#### Scenario: 未設定へ戻すとキーが消える
- **GIVEN** あるステップのロールが設定されている
- **WHEN** その項目を未設定へ戻す設定を書く
- **THEN** ファイルからそのキーだけが削除され、同じオブジェクトのほかのキーは残る

#### Scenario: 別プロセスとの同時書き込み
- **WHEN** Pi の設定保存を呼ぶ別プロセスと同じ settings ファイルに対して同時に書き込む
- **THEN** 内容は解析できる形で残り、両側が書いたキーが失われない。ロックの残骸も残らない

### Requirement: role は spirits 独自のセッション記録に保存し、fork の記録から片方向で引き継ぐ
システムは managed 経路で role を記録するとき、spirits 専用のカスタム entry に書き込まなければならない。(SHALL) ホストが所有する virtual model 用の状態 entry には、拡張から書き込んでならない。(MUST)
セッション開始時、branch に spirits 専用の role entry がある場合はそれを優先し、無い場合だけ、旧 fork ビルドが書いた virtual model 用の状態 entry の最新の role を読み込んでロックにしなければならない。(SHALL) どちらも無い場合は既定ロール(未設定なら normal)をロックする。
引き継ぎは片方向だけとする。(MUST) 読み込んだ値をホストの状態 entry に書き戻してはならない。(MUST)

#### Scenario: 専用 entry が優先される
- **WHEN** 仮想 model 用の状態 entry と spirits 専用の role entry の両方がある branch でセッションを開始する
- **THEN** spirits 専用の role entry の値がロックに使われる

#### Scenario: fork から引き継ぐ
- **WHEN** spirits 専用の role entry が無く、旧 fork ビルドが書いた仮想 model 用の状態 entry だけが存在するツリーでセッションを開始する
- **THEN** その entry の role がロックに使われ、ホストの状態 entry は追加も変更もされない

#### Scenario: どちらも無い
- **GIVEN** 既定ロールが設定されていない
- **WHEN** role の記録がまったく無いセッションを開始する
- **THEN** ロックは normal になる

#### Scenario: どちらも無ければ既定ロール
- **GIVEN** 既定ロールが strong に設定されている
- **WHEN** role の記録がまったく無いセッションを開始する
- **THEN** ロックは strong になる

### Requirement: role badge は拡張の status 行に出す
システムは managed 経路で、次のリクエストが走ることになっているロールを拡張の status 行に表示しなければならない。(SHALL) 表示は角括弧で囲んだ小文字のロール名とし、要求する thinking レベルが解決できるときはそれを続けて出す。改行および端末制御文字を含む場合はそれらを取り除いて 1 行とする。取り除いた結果が空になるときは表示しない。
振り分けが無効なセッションではロール名と要求レベルを出さず、振り分けが無効であることを示す語だけを出さなければならない。(SHALL) 振り分けが有効で normal の対象が解決できないときは、応答するロールが無いことを示す語を出す。(SHALL)
描き直す時点は「badge は状態の射影を決められた時点で描き直す」に従う。
表示するロールは、セッションのロックそのものではなく、そのロックと状態から解決した応答ロールとする。(MUST) strong の要求が strong の対象へ解決できないときは normal を表示する。(SHALL)
この表示は、ホストのモデル表示とは別の拡張 status 行であり、ホストの表示位置・表示の消去の有無を共有しないことを文書に記録しなければならない。(SHALL)

#### Scenario: 制御文字を含む role は描画しない
- **WHEN** badge に描く値が制御文字だけからなる
- **THEN** status 行には何も出ず、端末の表示状態は変わらない

#### Scenario: strong で走ったあとは strong を出す
- **GIVEN** `spirits/auto` が選択され、strong がロックされ、strong の対象が設定され、strong の thinking レベルが high である
- **WHEN** strong の対象でリクエストを処理した
- **THEN** 拡張の status 行に `[strong high]` が描かれる

#### Scenario: role を選んだときに描画する
- **GIVEN** `spirits/auto` が選択され、strong の thinking レベルが low に設定されている
- **WHEN** `/spirits-role strong` で role がロックされた
- **THEN** セッションのモデルを変えずに badge がその role の解決 `[strong low]` で描画される

#### Scenario: 再読み込み後に再描画する
- **GIVEN** `spirits/auto` が選択され、`opsx-propose` のロールが strong に設定され、`opsx-propose` が継続中である
- **WHEN** 拡張の再読み込みによってセッションが開始した
- **THEN** 引き継いだロックと継続中のステップから、ステップ設定・ステップの既定ロール・ロックの順で解決したロールと要求レベルの badge がもう一度描画される

#### Scenario: 物理モデル選択中はロールを出さない
- **GIVEN** 既定ロールが strong で、現在のモデルが物理モデルである
- **WHEN** セッションを開始する
- **THEN** 拡張の status 行には `[off]` だけが出、`[strong]` は出ない

#### Scenario: レベルが解決できないときはロールだけを出す
- **GIVEN** `spirits/auto` が選択され、ロールの thinking レベルが未設定で、セッションの選択値が無い
- **WHEN** badge が描かれる
- **THEN** ロール名だけが出て、レベルの値は出ない

#### Scenario: 応答するロールが無いときはその旨を出す
- **GIVEN** `spirits/auto` が選択され、normal の対象、既定モデル、直近の成功レスポンスのいずれも解決できない
- **WHEN** badge が描かれる
- **THEN** ロール名ではなく `[!]` が出る

### Requirement: `/spirits-clear` は区切りより前の会話を LLM 文脈から外す
システムは `/spirits-clear` の実行時に、セッションに会話の区切りを記録し、以後の LLM 要求から、その区切りより前のユーザーメッセージ、アシスタントメッセージ、ツール結果、拡張が送ったメッセージを除かなければならない。(SHALL)
区切りより前の会話は削除してはならない。(MUST) セッション ID とセッション ファイルのパスは変えてはならない。(MUST)
区切りより前に何があっても動作しなければならない。(SHALL) 会話が無い場合、会話が短い場合、続けて 2 回以上実行した場合は成功として扱う。(MUST) 会話が小さいことを理由に失敗してはならない。(MUST)
チャット表示はそのまま残す。(MUST) TODO、goal、memory などの拡張のセッション状態は保持する。(MUST)
セッションを再開した後も、同じ区切りが効き続けなければならない。(SHALL)
モデルと thinking レベルの選択は変わらない。(MUST)

#### Scenario: 短い会話でも効く
- **WHEN** 1 往復しか会話の無いセッションで `/spirits-clear` を実行し、続いて「hello」を送る
- **THEN** LLM 要求に以前の会話は含まれない。エラーは出ない

#### Scenario: 続けて 2 回実行する
- **WHEN** `/spirits-clear` を 2 回続けて実行し、続いて要求を送る
- **THEN** 2 つ目の区切りより前の会話は LLM 要求に含まれない

#### Scenario: 再開しても効く
- **WHEN** `/spirits-clear` 後に終了し、同じセッションを再開して要求を送る
- **THEN** 区切りより前の会話は LLM 要求に含まれない

#### Scenario: TODO と goal は残る
- **WHEN** TODO と goal があるセッションで `/spirits-clear` を実行する
- **THEN** TODO と goal はそのまま残り、セッション ID も変わらない

### Requirement: 自動 compaction はクリア済みの会話を文脈に戻さない
システムは、compaction の要約範囲に区切りより前で消された会話が残っている場合、その compaction を拡張が肩代わりし、クリア済みの会話の内容を含まない固定の注記を要約として書き込まなければならない。(SHALL) 肩代わりの保持開始位置は区切りそのものとする。
残っているかの判定は、pi が要約する範囲に相当する投影メッセージを数えることで行い、区切りの位置だけを見て行ってはならない。(MUST) 要約範囲に消された会話が 1 つも残っていない場合は素通しし、既定の要約を妨げてはならない。(MUST)
自動 compaction の後、クリア済みの会話は LLM 要求に現れてはならない。(MUST)
区切り直後は区切りより前の entry がコンテキスト使用量の推算に残ること、およびそれが自動 compaction の閾値に影響することを文書に記録しなければならない。(SHALL)

#### Scenario: 自動 compaction の後も消えたまま
- **WHEN** `/spirits-clear` の後に会話が積み上がり、自動 compaction が発火する
- **THEN** 以降の LLM 要求にクリア済みの会話は現れず、compaction の要約にはクリア済みの内容が含まれない

#### Scenario: 区切りより後の要約は邪魔しない
- **WHEN** 区切りより後の会話だけが要約範囲に含まれる compaction が発火する
- **THEN** 拡張は素通しし、既定の要約が書かれる

#### Scenario: 消された会話が後ろに無い区切りでも邪魔しない
- **WHEN** 会話が消える前に `/spirits-clear` が打たれ、区切りより前にモデルに見えるメッセージが残っていない状態で compaction が発火する
- **THEN** 区切りは要約範囲に入っていても拡張は素通しし、既定の要約が書かれる

### Requirement: 専用コマンドの表面の違いを文書に残す
システムは、`/spirits-*` による操作がホストの操作と同じ目的を満たすが、コマンド名、表示位置、表示の消去の有無、ホストのコマンドとの統合、対話端末でしか使えない操作という点で異なることを文書に記録しなければならない。(SHALL)
モデルの選択と thinking レベルの既定保存が、ホストの `/model` と `/thinking` でも満たせることを同じ文書に記録しなければならない。(SHALL) ロールの対象設定、現在のセッションのモデル選択、`save` による現在の選択の global 既定への保存を区別して記録する。(MUST) 一覧の `save` の行が成功と差分なしで一覧を閉じ、結果を TUI 通知で確認でき、失敗では一覧を閉じず理由を行に出すことを記録する。(MUST) セッションが物理モデルを選択している間は `save` が見送られ、見送りでも一覧を閉じずに理由が行に残ること、振り分けを有効にする操作がホストのモデル selector とスコープ設定側にあり、対話端末の `status` が実行可能な手順、または未登録で実行できない理由を出すことを、同じ文書に記録する。(MUST)
ホストが表示する Pi の帰属表示はそのまま受け入れること、および第三者拡張が登録した provider のモデルを `rlm` の子では使えないことを、同じ文書に記録しなければならない。(SHALL)

#### Scenario: 限定向けの文書
- **WHEN** managed 経路の機能一覧を読む
- **THEN** `/spirits-*` の各目的、ホストの操作との違い、ロールの対象の選択とセッションのモデル選択の区別、ホストの `/model` と `/thinking` の代替関係、Pi の帰属表示と第三者 provider の制約が記載されている

#### Scenario: モデル選択と既定への保存を区別する文書
- **WHEN** `/spirits-role save` の説明を読む
- **THEN** 現セッションのモデルを切り替えないこと、保存条件、物理モデルを選択している間は見送られること、見送りで一覧が閉じないこと、Pi の既定選択の優先順位、print で通知しないことが記載されている

#### Scenario: 一覧の操作行と閉じる振る舞いを記す文書
- **WHEN** 一覧の `save` の説明を読む
- **THEN** `save` はロックを変えずに保存して一覧を閉じること、閉じた後も結果を通知で確認できること、失敗では開いたままで理由が行に出ること、閉じるときの再読み込みが記載されている
- **AND** 見送りでは一覧を開いたままにすることと、実行可能な手順または実行できない理由を `status` で確認できる旨が行に出ることが記載されている
- **AND** ロックの一覧の行と `/spirits-role <role>` がロックの唯一の経路であることが分かる

### Requirement: 振り分け用モデルの除外は api 値で行う
システムは、ロールの対象として保存するモデルの解決と一覧のモデルの候補から spirits の振り分け用モデルを除く判定を、モデルの api 値が spirits の振り分け用 api と一致するかにより行う。(SHALL) モデル名、provider 名、表示名に依存してはならない。(MUST NOT)

#### Scenario: 名称に仮想を示す語を含まない振り分け用モデル
- **GIVEN** api が spirits の振り分け用 api であり、名前に `virtual` を含まないモデルが存在する
- **WHEN** そのモデル名をロールのモデルの設定に使う
- **THEN** 対象にせず、対象にできない旨を伝える

#### Scenario: 通常モデルは対象に残る
- **GIVEN** api が spirits の振り分け用 api でないモデルが存在する
- **WHEN** そのモデル名をロールのモデルの設定に使う
- **THEN** 通常の解決対象として扱う

#### Scenario: 一覧の候補も api 値で除く
- **GIVEN** api が spirits の振り分け用 api であり、provider と ID が `spirits/auto` と異なるモデルが利用できる
- **WHEN** 一覧のロールのモデルの行で候補を開く
- **THEN** そのモデルは候補に出ない

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

### Requirement: ロールのモデルの参照は完全一致から部分一致で決める
システムは `/spirits-role <role> model <ref>` の参照を、廃止した `/spirits-model` と同じ規則で解決しなければならない。(SHALL) `provider/id` の完全一致を先に試し、それが無いときは `provider/id` とモデル ID の部分一致が 1 件だけの候補を解決する。部分一致が 0 件、または 2 件以上のときは解決できなかったものとして扱い、設定を変更しない。その場合、理由を利用者に伝える。(MUST) 解決の候補から振り分け用のモデルは除く。(MUST)

#### Scenario: provider 付きの完全一致
- **GIVEN** `compat-fake/fake-strong` が利用可能である
- **WHEN** `/spirits-role strong model compat-fake/fake-strong` を送る
- **THEN** strong の対象が `compat-fake/fake-strong` として保存される

#### Scenario: 部分一致が 1 件
- **GIVEN** `compat-fake/fake-strong` のみに部分一致する語 `strong` がある
- **WHEN** `/spirits-role strong model strong` を送る
- **THEN** strong の対象が `compat-fake/fake-strong` として保存される

#### Scenario: 解決できないモデル参照では変更しない
- **GIVEN** どのモデルも `nowhere/nothing` に一致しない
- **WHEN** `/spirits-role strong model nowhere/nothing` を送る
- **THEN** strong の対象は変わらず、一致するモデルが無いことが伝えられる

#### Scenario: 曖昧なモデル参照では変更しない
- **GIVEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が部分一致 `fake` に 2 件で抵触する
- **WHEN** `/spirits-role normal model fake` を送る
- **THEN** normal の対象は変わらず、複数のモデルに抵触する旨と候補が伝えられる

### Requirement: `/spirits-role` は選んだ値を既定として保存する
システムは `/spirits-role` で既定 role、ロールのモデル、ロールの thinking レベル、ステップの設定を変更したとき、Pi の global settings に保存しなければならない。(SHALL) 保存した値は、専用の Pi が設定を再読み込みした後の新しいセッションで読める状態にしなければならない。(SHALL) 設定の書き込みと再読み込みのあいだに利用した、コマンド由来の API ハンドルを再読み込み後に使ってはならない。(MUST)
1 項目の変更が、ほかのステップとほかの設定キーを失わせてはならない。(MUST)
設定の書き込みが失敗したとき、システムはセッションへ適用した変更を取り消さない。(MUST) 保存に失敗した旨をセッションへの変更と分けて伝え、設定の再読み込みを行わない。(SHALL)

#### Scenario: 保存されたロールの対象が次のセッションで効く
- **WHEN** `/spirits-role normal model compat-fake/fake-model` を実行して再読み込みが行われた後、新しいセッションを開始する
- **THEN** normal の対象の保存キー（`models.normal`）に単一の文字列 `compat-fake/fake-model` が入っており、設定の再読み込み後の読み取りがその値を返す

#### Scenario: 再読み込み後に古いハンドルを使わない
- **WHEN** 設定を書いたコマンドが設定の再読み込みを待つ
- **THEN** 再読み込みの後にそのコマンドの API ハンドルやコンテキストを使わず、再読み込みが打ち上げた開始イベントで反映を確認する

#### Scenario: 設定の書き込みが失敗する
- **GIVEN** ロックはセッションへ適用でき、設定の書き込みだけが失敗する
- **WHEN** `/spirits-role strong` を実行する
- **THEN** セッションのロックは strong のまま、設定の再読み込みは行われず、保存に失敗した旨が伝えられる

### Requirement: `/spirits-role` は対話端末で設定と稼働の一覧を開く

システムは対話 TUI で引数なしの `/spirits-role` を受け取ったとき、1 行 1 設定項目の一覧を開かなければならない。(SHALL) 一覧は、`save` の行を最上位に置き、直後に値も説明も持たない区行を置いて、セッションのロック、2 つのロールのモデルと thinking レベル、ステップ一覧の設定を並べる。(SHALL) 選択中の通常の設定行にはその項目の解決結果(実際に応答するモデル、有効な thinking レベル、継続の有無、警告)を表示する。(SHALL)
`save` の行は Enter が確定キーであるときの Enter だけで作動し、候補の一覧を開いてはならない。(MUST NOT) Space、クリック、その他の確定キーでは保存もしない。区行はいずれの確定操作でも候補を開かず、設定とセッションを変えてはならない。(MUST NOT)
ステップは 1 ステップを 1 行とし、そのステップのロールと thinking レベルの組を 1 つの設定項目として扱う。(SHALL)
ロール未指定のステップはロックに従う旨、既定ロールが効いている行はその旨、そのセッションに開始コマンドが 1 つもないステップはその旨を表示する。(SHALL)
対話 TUI 以外では一覧を開かない。RPC では稼働状況を通知し、print では一覧も稼働状況も出力しない。(MUST)

#### Scenario: 一覧の開閉

- **WHEN** 対話 TUI で `/spirits-role` を引数なしで実行する
- **THEN** 最上位に `save` の行、直後に区行、続いてロック、2 ロールのモデルと thinking、ステップ設定が並び、`save` は予告(物理モデルを選択中は見送り理由)、通常の設定行は解決結果を出す

#### Scenario: save は確認 Enter だけで作動する
- **GIVEN** Enter が確定キーであり、セッションは `spirits/auto` を選んでいて、global に保存可能な差分がある
- **WHEN** 一覧を新たに開き、`save` の行で Space、クリック、Enter の順に操作する
- **THEN** Space とクリックは候補も書き込みも起こさず、Enter だけが候補を開かずに保存を行う

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

### Requirement: 一覧での編集はコマンドと同じ書き込みを行う
システムは、`/spirits-role` の一覧での編集を、対応するコマンドと同じ設定書き込みと反映で行わなければならない。(SHALL) 一覧は固有の状態を持たず、一覧でできる操作はすべてコマンドの文法でもできる。(MUST)
ロールのモデルの行は、その時点で利用できるモデルから選ぶ。(SHALL) 候補には解像できるモデル名（`provider/id`）を出し、振り分け用のモデルは含めない。(MUST) 利用できるモデルが無いときは候補を空とし、書き込みを行わない。(MUST)
反映を要する変更を行ったときの設定の再読み込みは、一覧を閉じるときの 1 回に限る。(MUST) 書き込み中の各編集は設定だけを変え、再読み込みを待たずに一覧の表示を新しい値へ更新する。閉じるときの 1 回の再読み込みで、保存された値がリクエストの解決に効く。(SHALL) 書き込みに失敗した設定の項目は表示を元の値に戻し、理由を一覧の中(その行の説明、または一覧の通知行)に出す。(SHALL) ロックの行は「一覧のロックの行は保存に失敗してもセッションのロックを示す」に従う。

#### Scenario: ロックの切り替え
- **WHEN** 一覧のロックの行で Enter を押し、別のロールを選ぶ
- **THEN** `/spirits-role <role>` と同じロックと設定書き込みが行われ、一覧の表示が切り替わる

#### Scenario: ロールのモデルを一覧で変える
- **GIVEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が利用できる
- **WHEN** 一覧の `strong` のモデルの行で Enter を押し、`compat-fake/fake-strong` を選ぶ
- **THEN** `/spirits-role strong model compat-fake/fake-strong` と同じ設定書き込みが行われ、一覧の表示が `compat-fake/fake-strong` に切り替わる
- **AND** 一覧の候補に `spirits/auto` は出ない

#### Scenario: 利用できるモデルが無ければ書き込まない
- **GIVEN** 利用できるモデルが 0 件である
- **WHEN** 一覧の `normal` のモデルの行で Enter を押す
- **THEN** 候補は空で、設定は変わらない

#### Scenario: 閉じるときに 1 回だけ再読み込む
- **GIVEN** 一覧の中で 3 項目を書き換えた
- **WHEN** 一覧を閉じる
- **THEN** 設定の再読み込みは閉じるときに 1 回だけ行われ、編集の途中では行われない

#### Scenario: 書き込みの失敗後は表示が戻る
- **GIVEN** 設定の書き込みが失敗する
- **WHEN** 一覧の行の値を変更する
- **THEN** その行は元の値に表示が戻り、理由が一覧内に出る

### Requirement: 一覧のステップの行は 2 段で選ぶ
システムは、一覧のステップの行で Enter を受けたとき、ロールの候補を開き、ロールを確定すると続けて thinking レベルの候補を開かなければならない。(SHALL) 各段の確定は、それぞれ `/spirits-role <step> role <value>` と `/spirits-role <step> thinking <value>` と同じ書き込みとする。(MUST) 2 段目は現在の thinking レベルを選択した状態で開く。(SHALL) 2 段目を Esc で閉じたときは、1 段目で確定したロールだけが保存され、thinking レベルは変わらない。(MUST)

#### Scenario: ステップの 2 段選択
- **GIVEN** `opsx-propose` のロールが strong、thinking レベルが low に設定されている
- **WHEN** 一覧の `opsx-propose` の行で Enter を押し、ロールの一覧から `unset` を選び、続いて開く thinking レベルの一覧から `high` を選ぶ
- **THEN** ステップのロールのキーは削除され、thinking レベルは high として残る
- **AND** その行の表示と説明は、ロックに従う旨と high を示す

#### Scenario: ステップの 2 段目を Esc で閉じる
- **GIVEN** `opsx-propose` の thinking レベルが low に設定されている
- **WHEN** 一覧の `opsx-propose` の行で Enter を押し、ロールの一覧から strong を選び、続いて開く thinking レベルの一覧を Esc で閉じる
- **THEN** ステップのロールは strong として保存され、thinking レベルは low のまま残る

### Requirement: 一覧の候補は Esc で閉じられる
システムは、一覧の行から開いた候補の一覧を Esc で閉じられるようにし、そのとき設定と行の表示を変えてはならない。(MUST) 候補が空のときに出す案内も、同じ操作で閉じて元の一覧へ戻れなければならない。(MUST)

#### Scenario: 候補の一覧を Esc で閉じる
- **WHEN** 一覧のいずれかの行で Enter を押して候補の一覧を開き、Esc を押す
- **THEN** 候補の一覧が閉じて元の一覧へ戻り、設定とその行の表示は変わらない

#### Scenario: 候補が空の案内を Esc で閉じる
- **GIVEN** 利用できるモデルが 0 件である
- **WHEN** 一覧の `normal` のモデルの行で Enter を押し、出た案内で Esc を押す
- **THEN** 案内が閉じて元の一覧へ戻り、設定は変わらない

### Requirement: 一覧のロックの行は保存に失敗してもセッションのロックを示す
システムは、一覧でロックを切り替えたときに設定の書き込みだけが失敗した場合、セッションへ適用したロックを取り消してはならない。(MUST) これはコマンドの「設定の書き込みが失敗したとき、セッションへ適用した変更を取り消さない」と同じ扱いである。
ロックの行は、書き込み前の値に戻さず、適用したセッションのロックを示し、保存に失敗した旨とその理由をその行の説明に出す。(SHALL) badge も、そのロックとセッションの状態から解決した応答ロールで描画する。(SHALL) 振り分けが無効なセッションでは `[off]` と描画する。(SHALL)
セッションへロックを適用した後の処理(ロックの記録の追記、設定の書き込み、行の再描画)のどこで失敗や例外が起きても、ロックの行の値と badge は、その時点でセッションがロックしているロールと一致しなければならない。(MUST) 一覧は開いたままにし、失敗の理由をロックの行の説明に出す。(SHALL)

#### Scenario: ロックの保存が失敗する
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、設定の書き込みが失敗し、strong の対象が利用でき、strong の thinking レベルが low に設定されている
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** セッションのロックは strong のままで、ロックの行は strong を示し、その行の説明に保存に失敗した旨とその理由が出る
- **AND** badge は `[strong low]` と描画される

#### Scenario: strong の対象が使えなければ解決したロールを出す
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、strong の対象が未設定で、normal の対象が `compat-fake/fake-model` に解決でき、設定の書き込みが失敗する
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** セッションのロックは strong のままで、ロックの行は strong を示す
- **AND** badge は応答する normal の解決 `[normal]` とそのモデルで描画される

#### Scenario: ロックの記録の追記が例外を投げる
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、ロックの記録の追記が例外を投げる
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** 一覧は開いたままで、ロックの行はセッションがロックしているロールを示し、その行の説明に失敗の理由が出る
- **AND** badge はセッションがロックしているロールの解決で描画されている

#### Scenario: 物理モデル選択中のロックの保存が失敗する
- **GIVEN** 現在のモデルが物理モデルで、normal がロックされ、設定の書き込みが失敗する
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** セッションのロックは strong のままで、ロックの行は strong を示し、その行の説明に保存に失敗した旨とその理由が出る
- **AND** badge は `[off]` と描画される

### Requirement: `/spirits-role status` は稼働状況を出す
システムは `/spirits-role status` の要求を受け取ったとき、1 件の通知に、変更を加えずに次の内容を出さなければならない。(SHALL) 振り分けが有効か（振り分け用の仮想モデルを選択したときだけ有効）、現在モデル（`provider/id`、または未選択）、ロック、現在のステップと継続の有無、直近のリクエストで使われたロール・物理モデル・要求した thinking レベル、2 つのロールそれぞれの解決結果とその出どころ(設定のどのキーか、Pi の既定か、直近の成功レスポンスか)、未設定と使用不可の区別とその理由、thinking レベル、既定と異なるステップ設定の一覧、読み取れずに無視した設定値。
振り分けが無効であるときは、その事実を同じ通知に出さなければならない。(SHALL) 対話端末では、そのセッションで実際に実行できる有効化の手順を、モデルスコープの有無とかわらず同じ通知に出す。(SHALL) スコープが設定され、振り分け用のモデルを含まない場合は、未登録の場合もスコープ外の事実を併せて出す。(SHALL) 振り分け用のモデルがこのセッションのモデルカタログに存在しないときは手順を名指さず、その理由を出す。(MUST NOT) 対話端末でないセッションでは操作を名指さない。(MUST NOT)

#### Scenario: 振り分けが有効なときの全項目
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、継続するステップが走った後である
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが有効であること、現在のモデル、ロック、現在のステップと継続する旨、直近のリクエストのロールと物理モデルと要求した thinking レベル、両ロールの解決結果と出どころ、既定と異なるステップ設定が 1 件の通知に出る

#### Scenario: 物理モデルを選んでいれば無効と出る
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが働いていない旨と現在のモデル名が通知に出るが、ロックと設定値はそのまま読める

#### Scenario: スコープが設定されていなくても手順が出る
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、モデルスコープは設定されていない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが無効であることと、振り分け用のモデルをモデル selector で選ぶ操作が通知に出る

#### Scenario: 振り分け用モデルが範囲内でも手順が出る
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含む
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが無効であることと、そのモデルを選ぶ操作が通知に出る

#### Scenario: 振り分け用モデルがスコープ外だと分かる
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分け用モデルがスコープに含まれないことと、それを有効化できる操作が通知に出る

#### Scenario: 対話端末でなければスコープ外の事実だけを出す
- **GIVEN** RPC モードで、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分け用モデルがスコープに含まれないことは通知に出るが、selector やスコープ設定の操作は名指されない

#### Scenario: モデル未選択の status は無効と出る
- **GIVEN** セッションに選択中のモデルがない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けは無効で、現在モデルは未選択と報告される。登録済みなら TUI で実行できる選択手順を案内する

#### Scenario: 同名の物理モデルは振り分け用の案内の根拠にならない
- **GIVEN** 起動済みのコンテキストに渡されたモデルカタログに `spirits/auto` が物理モデルだけで、設定されたスコープも実際の振り分け用モデルを含まない。固定ホスト Pi 1.5.0 では同名の衝突で拡張の読み込み自体を起動時に拒否するため、実セッションではこの状態にならず、本シナリオは渡されたカタログに対する防御条件としてテストで担保する
- **WHEN** TUI または RPC で `/spirits-role status` を実行する
- **THEN** 振り分けは無効で、未登録とスコープ外の両方を報告し、有効化の操作は名指さない

#### Scenario: 設定値の不正区別
- **GIVEN** 設定ファイルに、型違いまたは語彙外の値のステップ設定がある
- **WHEN** `/spirits-role status` を実行する
- **THEN** その値は振り分けでは無視されていることと、無視した理由が読み取れる

### Requirement: status のロックと解決結果は実際の位相と解決を示す
システムは、`/spirits-role status` のロックの項目に、ステップの既定ロールやステップ設定ではなく、セッションがロックしているロールを出さなければならない。(MUST) 現在のステップの項目には、そのステップが実際に走るロールを添える。(SHALL)
ロールの解決結果は、その時点でリクエストを解決したときの結果としなければならない。(MUST) 設定済みで使えない対象については、使えない旨とその理由(利用できるモデルに無い、資格情報が無い、振り分け用のモデルである)、および代わりに応答するモデルとその出どころを出す。(SHALL)

#### Scenario: 使えない normal の対象
- **GIVEN** `spirits/auto` が選択され、normal の対象が資格情報の無い provider のモデルに設定され、Pi の既定モデルは利用できる
- **WHEN** `/spirits-role status` を実行する
- **THEN** normal の対象が使えない旨とその理由、リクエストが Pi の既定モデルで応答している旨とその出どころが出る

#### Scenario: ステップの既定ロールで走っている間のロック
- **GIVEN** normal がロックされ、`/skill:sprt-opsx-verify-deep` の run が走っている
- **WHEN** その run の途中で `/spirits-role status` を実行する
- **THEN** ロックは normal と出て、現在のステップは `sprt-opsx-verify-deep` で strong で走る旨が出る

### Requirement: status は読めない設定値と再読み込み後のリクエストの有無を区別して出す
システムは、`/spirits-role status` の無視した設定値に、`models.role`、`models.normal`、`models.strong`、`models.thinking` 配下、`models.steps` 配下のすべてについて、値が書かれているが読めないものを、未設定とは区別して出さなければならない。(SHALL)
直近のリクエストは拡張の実行環境の中にだけ保持する。拡張の再読み込みの後にまだリクエストが無いときは、再読み込み以降にリクエストが無い旨を出す。(SHALL)

#### Scenario: 読めない strong の対象は未設定と区別する
- **GIVEN** `models.strong` に文字列でない値が書かれている
- **WHEN** `/spirits-role status` を実行する
- **THEN** strong は未設定ではなく、`models.strong` が読めない値として無視されている旨と理由が出る

#### Scenario: 再読み込みの直後
- **GIVEN** `/spirits-role` での設定変更に伴う再読み込みが終わり、その後にリクエストがまだ無い
- **WHEN** `/spirits-role status` を実行する
- **THEN** 直近のリクエストの項目は、再読み込み以降にリクエストが無い旨を示す

### Requirement: 設定時は振り分けの効きを伝える
システムは、コマンドで strong をロックしたとき、またはステップのロールに strong を設定したときに、strong の対象が未設定または使えない場合、設定自体は行ったうえで、normal の対象で実行されることと設定コマンドを 1 行で伝えなければならない。(SHALL) strong の対象そのものを設定したときは、この警告を出してはならない。(MUST NOT) 警告しても設定を取り消してはならない。(MUST)

#### Scenario: strong 未設定でロックする
- **GIVEN** strong の対象が設定されていない
- **WHEN** `/spirits-role strong` を実行する
- **THEN** ロックと保存は行われ、normal の対象で走る旨と strong の設定コマンドが 1 行伝えられる

#### Scenario: 対象が設定済みなら警告しない
- **GIVEN** strong の対象が設定され、利用可能であり、`spirits/auto` が選択されている
- **WHEN** `/spirits-role strong` を実行する
- **THEN** 警告は出ず、ロックされた旨だけが伝えられる

### Requirement: 振り分けを有効にする手順は対話端末で実行できるものを名指す
システムは振り分けが無効であることを伝える通知（設定変更の警告、`save` の見送り、`status`）で、TUI では実行可能な有効化の手順を名指す。(SHALL) スコープ外なら selector の対象範囲の切替またはスコープ設定を、キー名でなく操作で案内する。(SHALL) カタログに振り分け用の仮想モデルが無いときは、同名の物理モデルがあっても操作を名指さず、利用できない理由を出す。(MUST) RPC の通知では理由と事実だけを出し、振り分けを有効化する手順の操作を名指さない。(MUST NOT) 振り分け自体の設定であり有効化手順ではない strong モデルの指定は、TUI・RPC を問わず設定変更の警告に含めてよい。 print の `save` は通知しない。(MUST NOT) 一覧の説明には有効化の操作とスコープの診断を出さない。(MUST NOT)

#### Scenario: 対話端末では selector の操作を名指す
- **GIVEN** 対話端末で現在のモデルが物理モデルであり、モデルスコープは設定されていない
- **WHEN** `save` を実行する
- **THEN** 振り分け用のモデルをモデル selector で選ぶ操作が名指される

#### Scenario: スコープ外の手順を名指す
- **GIVEN** 対話端末で現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `save` を実行する
- **THEN** selector の選択対象の範囲を切り替える操作、またはモデルのスコープを設定する操作が名指される

#### Scenario: 振り分け用モデルが未登録なら手順を名指さない
- **GIVEN** 対話端末で現在のモデルが物理モデルであり、振り分けの登録が失敗していてモデルカタログに `spirits/auto` が無い
- **WHEN** `/spirits-role save` を実行する
- **THEN** 見送りとその理由は伝わるが、モデル selector の操作は名指されず、振り分け用のモデルが利用できないことが理由として出る

#### Scenario: 対話端末でないセッションでは操作を名指さない
- **GIVEN** RPC セッションで現在のモデルが物理モデルである
- **WHEN** `save` を実行する
- **THEN** warning で見送りの理由と該当する事実は伝わるが、モデル selector、キー、スラッシュコマンドはいずれも名指されない

#### Scenario: 一覧は手順を名指さず status を示す
- **GIVEN** 対話端末で現在のモデルが物理モデルである
- **WHEN** 一覧の `save` の行を見たり Enter を押したりする
- **THEN** 行には操作そのものは出ず、実行可能な手順または実行できない理由を `status` で確認できる旨が出る

### Requirement: 物理モデルを選択している間の設定変更は振り分けが働いていないことを伝える
システムは、セッションが物理モデルを選択している場合、コマンドによるすべての設定変更(ロック、ロールのモデルと thinking レベル、ステップのロールと thinking レベル、`unset` による削除)で、振り分けが働いていないことを 1 行で伝えなければならない。案内は TUI・RPC と登録状態に応じた規則に従う。(SHALL) 警告に strong モデルの指定のコマンドを含めることは有効化の手順の禁止とは別の規則であり、TUI・RPC を問わず出してよい。 警告しても設定を取り消してはならない。(MUST) モデル未選択のセッションを物理モデルの選択として扱い、この警告を出してはならない。(MUST NOT)

#### Scenario: 物理モデル選択中に設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role opsx-propose role strong` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが伝えられる

#### Scenario: 物理モデル選択中に thinking を設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role normal thinking high` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが 1 行伝えられる

#### Scenario: 物理モデル選択中の save はこの警告ではない
- **GIVEN** 現在のモデルは物理モデル `compat-fake/fake-model` で、global の既定モデルは異なる
- **WHEN** 対話 TUI または RPC で `/spirits-role save` を実行する
- **THEN** 設定は保存されず、設定変更の警告でなく見送りの warning として理由が伝わる
- **AND** 実行可能な手順は TUI でのみ伝わり、RPC では操作を名指さない

#### Scenario: モデル未選択では警告しない
- **GIVEN** セッションはモデルを選択していない
- **WHEN** `/spirits-role normal thinking high` を実行する
- **THEN** 設定は保存され、振り分けが無効である旨の警告は出ない

### Requirement: 設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える
システムは、設定時の警告の判定に、そのコマンドが書き込んだ値を反映した設定を使わなければならない。(MUST) 再読み込みの前に読める設定は書き込み前の値のままなので、それだけで判定してはならない。(MUST NOT)
一覧での編集では警告の通知を出さない。(MUST NOT) 代わりに、同じ内容をロックの行と該当する行の説明に出す。(SHALL) 振り分けが無効なセッションでは、振り分けが働いていない旨は「一覧の説明は実際の解決結果を示す」の先頭の記述で伝え、警告の内容としてもう一度は出さない。(MUST NOT)

#### Scenario: strong の対象を設定した直後は strong 未設定と言わない
- **GIVEN** strong の対象が設定されておらず、`spirits/auto` が選択されている
- **WHEN** `/spirits-role strong model compat-fake/fake-strong` を実行する
- **THEN** strong の対象が保存され、strong が使えない旨の警告は出ない

#### Scenario: 一覧での編集は行の説明で伝える
- **GIVEN** 現在のモデルが物理モデルで、strong の対象が設定されていない
- **WHEN** 一覧でロックを strong に切り替える
- **THEN** 警告の通知は出ず、ロックの行の説明に、振り分けが働いていない旨と strong が normal の対象で走る旨が出る

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

### Requirement: ホストを問わず登録する専用コマンド
システムは、ホストに role 登録 API の有無にかかわらず、spirits 専用コマンド `/spirits-role` と `/spirits-clear` を登録しなければならない。(SHALL)
専用コマンドは `/spirits-model` を含まない。(MUST NOT)
専用コマンドの登録失敗は、他の機能(`tsrepl`、TODO、harness、`spirits/auto` の振り分け、skill による strong フェーズ)を変更してはならない。(MUST)

#### Scenario: ホストでの専用コマンド登録
- **WHEN** spirits 拡張を起動し、コマンド一覧を見る
- **THEN** `/spirits-role` と `/spirits-clear` が登録され、`/spirits-model` は登録されない

#### Scenario: 登録失敗の局所化
- **WHEN** `registerCommand` が例外を出すホストで spirits 拡張を起動する
- **THEN** 中核機能は登録され、専用コマンドが使えない旨が 1 回だけ通知される

### Requirement: badge は状態の射影を決められた時点で描き直す
システムは managed 経路で、badge の値を、その時点の設定、ロック、継続中のステップ、セッションのモデルから次のリクエストの解決として導出しなければならない。(SHALL) badge が示すロール、要求する thinking レベル、応答する物理モデルは、同じ条件でルーティングが返すロール、要求する thinking レベル、応答モデルと一致しなければならない。(MUST)
システムは、ユーザーの入力を受け取るごと、セッションのモデルが変えられたとき、セッションの thinking レベルが変えられたとき、`/spirits-role` による変更の後、セッションの開始、分岐間の移動、およびステップの終了時のそれぞれで badge を描き直さなければならない。(SHALL) ルーティングが報告したロールや、セッションに記録されたロールを、badge の値として直接書き込んではならない。(MUST NOT)

#### Scenario: モデル切り替えで badge が従う
- **GIVEN** `spirits/auto` が選択され、badge が strong の解決で描かれている
- **WHEN** 利用者が `/model` で物理モデルを選ぶ
- **THEN** badge はそのリクエストが走ったか待たずに `[off]` へ描き直される

#### Scenario: thinking レベルの切り替えで badge が従う
- **GIVEN** `spirits/auto` が選択され、normal の thinking レベルは未設定で、badge がセッションの選択レベルで描かれている
- **WHEN** 利用者が `/thinking` で別のレベルを選ぶ
- **THEN** badge は要求する thinking レベルを新しい選択値として描き直される

#### Scenario: 解決が変われば次の入力で badge が従う
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、badge が strong の解決で描かれており、その後 strong の provider の資格情報が消えた
- **WHEN** idle 入力を受け取る
- **THEN** badge は normal の解決へ描き直される

#### Scenario: 手で編集した設定は再読み込みから badge に効く
- **GIVEN** `spirits/auto` が選択され、別プロセスが設定ファイルの strong の対象を書き換えたが、拡張の再読み込みは終わっていない
- **WHEN** idle 入力を受け取る
- **THEN** badge は再読み込み前に読める設定からの解決を示す
- **AND** 拡張の再読み込みの後の描き直しは書き換え後の設定からの解決を示す

### Requirement: badge は応答する物理モデルを別の status key に出す
システムは managed 経路で、振り分けが有効なセッションの応答する物理モデルを、ロールの表示とは別の拡張 status key に出さなければならない。(SHALL) 2 つの表示は同じ status 行に並び、ロールの表示が先、物理モデルの表示が後でなければならない。(SHALL)
物理モデルの表示は provider を除いたモデル ID とする。(SHALL) ID が 24 文字を超えるときは、先頭 23 文字に `…` を付けた 24 文字で示す。(SHALL) 振り分けが無効なセッション、および応答する物理モデルが無いときは物理モデルの表示を出さない。(MUST)
2 つの key の書き込みは互いに独立とし、片方の書き込みが失敗しても、もう片方の書き込みとリクエストの処理を止めてはならない。(MUST NOT)

#### Scenario: ロールが先、応答モデルが後
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、normal の対象が `compat-fake/fake-model` に解決できる
- **WHEN** badge が描かれる
- **THEN** 拡張の status 行にはロールの表示に続けて `fake-model` が出る

#### Scenario: 24 文字を超えるモデル ID は省略する
- **GIVEN** `spirits/auto` が選択され、応答する物理モデルの ID が `abcdefghijklmnopqrstuvwxyz` (26 文字) である
- **WHEN** badge が描かれる
- **THEN** 物理モデルの表示は `abcdefghijklmnopqrstuvw…` (24 文字) である

#### Scenario: 24 文字ちょうどのモデル ID は省略しない
- **GIVEN** `spirits/auto` が選択され、応答する物理モデルの ID がちょうど 24 文字である
- **WHEN** badge が描かれる
- **THEN** 物理モデルの表示はその ID のままで、`…` は付かない

#### Scenario: 振り分けが無効なら応答モデルは出さない
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** badge が描かれる
- **THEN** 物理モデルの表示は消え、振り分けが無効であることを示す語だけが残る

#### Scenario: 応答するロールが無ければ応答モデルは出さない
- **GIVEN** `spirits/auto` が選択され、normal の対象、既定モデル、直近の成功レスポンスのいずれも解決できない
- **WHEN** badge が描かれる
- **THEN** 物理モデルの表示は消え、応答するロールが無いことを示す語だけが残る

#### Scenario: strong が落ちれば応答モデルも従う
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定されており、strong の対象は使えない
- **WHEN** `/opsx-propose` の run の解決で badge が描かれる
- **THEN** ロールの表示は normal であり、物理モデルの表示は normal の対象である

#### Scenario: 片方の key の書き込みが失敗しても他方は描く
- **GIVEN** `spirits/auto` が選択され、ホストが物理モデルの表示の key への書き込みで例外を投げる
- **WHEN** badge が描かれ、続いてリクエストを処理する
- **THEN** ロールの表示は描かれ、リクエストは通常どおりルートされる

### Requirement: ステップ開始時に振り分けが無効なら確認してから進める
システムは managed 経路の対話端末で、利用者が端末から送った入力がステップを開始し、そのとき振り分けが無効であり、そのステップに期待されるロールがある場合、入力を進める前に確認を出さなければならない。(SHALL) 期待されるロールがあるとは、そのステップにロールまたは thinking レベルの設定があるか、そのステップに既定ロールがあることをいう。
確認には、そのステップに期待するロールが今は使われないことと、振り分けを有効にする実行可能な手順を書き、「続行」と「中止」を選ばせる。(SHALL) 確認は条件を満たすステップの開始ごとに出す。(SHALL)
対話端末でないセッション、および拡張機能が送った入力では確認を出さず、待たずに入力を進める。(MUST)

#### Scenario: strong 設定のステップは確認してから進む
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送る
- **THEN** 設定したロールが今は使われないことと振り分けを有効にする手順を書いた確認が、「続行」と「中止」を選べる形で出る

#### Scenario: 既定ロールのあるステップでも確認する
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`sprt-opsx-verify-deep` のロールと thinking レベルは未設定で、その既定ロールは strong である
- **WHEN** `/skill:sprt-opsx-verify-deep` を送る
- **THEN** 確認が出る

#### Scenario: 期待されるロールの無いステップでは確認しない
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、そのステップのロールと thinking レベルは未設定で、既定ロールも無い
- **WHEN** そのステップの開始コマンドを送る
- **THEN** 確認は出ず、入力は待たずに進む

#### Scenario: 開始のたびに確認する
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、ロールの設定があるステップの開始で既に 1 回確認して続行した
- **WHEN** 別のロールの設定があるステップの開始コマンドを送る
- **THEN** 確認がもう一度出る

#### Scenario: 振り分けが有効なら確認しない
- **GIVEN** 対話端末で、`spirits/auto` が選択され、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送る
- **THEN** 確認は出ず、入力は待たずに進む

#### Scenario: 対話端末でなければ確認しない
- **GIVEN** RPC モードで、現在のモデルが物理モデルであり、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送る
- **THEN** 確認は出ず、入力は待たずに進み、ステップは始まる

#### Scenario: 拡張機能が送った入力では確認しない
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`opsx-explore` のロールが strong に設定されている
- **WHEN** 拡張機能が `/opsx-explore` を入力として送る
- **THEN** 確認は出ず、入力は待たずに進み、ステップは始まる

### Requirement: ステップ開始時の確認は時間切れで進み、中止で入力前に戻す
システムは、ステップ開始時の確認を 10 秒で自動で閉じ、時間切れまたは「続行」では入力をそのまま進めなければならない。(SHALL)
「中止」を選んだとき、および確認を Esc で閉じたときは、入力を送らず、ステップを入力を受け取る前の状態に戻さなければならない。(SHALL) どの場合も設定を変えてはならない。(MUST NOT)
ホストが確認を出せないとき(確認の表示が失敗したとき)は、待たずに入力を進める。(SHALL)

#### Scenario: 何もしなければ 10 秒で進む
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送り、確認に 10 秒間何も選ばない
- **THEN** 確認は閉じ、入力は送られ、`opsx-explore` は継続中のステップとして始まる

#### Scenario: 中止すれば入力前に戻る
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`opsx-propose` が継続中で、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送り、確認で「中止」を選ぶ
- **THEN** 入力は送られず、現在のステップは `opsx-propose` のままで、`/spirits-role status` も `opsx-propose` を示す
- **AND** 拡張の再読み込みの後も現在のステップは `opsx-propose` である

#### Scenario: Esc で閉じれば中止と同じ
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、ステップは走っておらず、`opsx-explore` のロールが strong に設定されている
- **WHEN** `/opsx-explore` を送り、確認が出てから 3 秒後に Esc で閉じる
- **THEN** 入力は送られず、ステップは走っていない

#### Scenario: 確認を出せなければ待たずに進む
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、`opsx-explore` のロールが strong に設定され、ホストが確認の表示で失敗する
- **WHEN** `/opsx-explore` を送る
- **THEN** 入力は待たずに進み、ステップは始まる
