# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: `/spirits-role status` は稼働状況を出す
システムは `/spirits-role status` の要求を受け取ったとき、1 件の通知に、変更を加えずに次の内容を出さなければならない。(SHALL) 振り分けが有効か(セッションのモデルが振り分け用のモデルか物理モデルか)、現在のセッションのモデル(`provider/id`)、ロック、現在のステップと継続の有無、直近のリクエストで使われたロール・物理モデル・要求した thinking レベル、2 つのロールそれぞれの解決結果とその出どころ(設定のどのキーか、Pi の既定か、直近の成功レスポンスか)、未設定と使用不可の区別とその理由、thinking レベル、既定と異なるステップ設定の一覧、読み取れずに無視した設定値。
振り分けが無効であり、かつ振り分け用のモデルがこのセッションのモデルスコープに含まれない場合は、その事実を同じ通知に出さなければならない。(SHALL) 対話端末では、振り分け用のモデルを有効化できる操作も同じ通知に出す。(SHALL) 対話端末でないセッションでは操作を名指さない。(MUST NOT)

#### Scenario: 振り分けが有効なときの全項目
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、継続するステップが走った後である
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが有効であること、現在のモデル、ロック、現在のステップと継続する旨、直近のリクエストのロールと物理モデルと要求した thinking レベル、両ロールの解決結果と出どころ、既定と異なるステップ設定が 1 件の通知に出る

#### Scenario: 物理モデルを選んでいれば無効と出る
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが働いていない旨と現在のモデル名が通知に出るが、ロックと設定値はそのまま読める

#### Scenario: 振り分け用モデルがスコープ外だと分かる
- **GIVEN** 対話端末で、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分け用モデルがスコープに含まれないことと、それを有効化できる操作が通知に出る

#### Scenario: 対話端末でなければスコープ外の事実だけを出す
- **GIVEN** RPC モードで、現在のモデルが物理モデルであり、モデルスコープが設定されていて `spirits/auto` を含まない
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分け用モデルがスコープに含まれないことは通知に出るが、selector やスコープ設定の操作は名指されない

#### Scenario: 設定値の不正区別
- **GIVEN** 設定ファイルに、型違いまたは語彙外の値のステップ設定がある
- **WHEN** `/spirits-role status` を実行する
- **THEN** その値は振り分けでは無視されていることと、無視した理由が読み取れる

### Requirement: 一覧の説明は実際の解決結果を示す
システムは、一覧のロックの行に、ステップの既定ロールやステップ設定ではなく、セッションがロックしているロールを出さなければならない。(MUST)
行の説明に出す解決結果は設定値の写しではなく、その時点でリクエストを解決したときに実際に応答するモデルとしなければならない。(MUST) 設定済みで使えない対象の行には、使えない旨とその理由、代わりに応答するモデルを出す。(SHALL) 直近のリクエストがあるときは、そのロール・物理モデル・要求した thinking レベルをロックの行の説明に出す。(SHALL)
書き込みに成功した行は、再読み込みを待たずに、値と説明の解決結果の両方を新しい値へ更新する。(SHALL)
振り分けが無効なセッションでは、すべての行の説明の先頭に無効であることと現在のモデル(`provider/id`)を述べ、応答モデルの記述を仮定法で書く。(SHALL) その記述は、同じ条件で振り分けが有効だった場合にルーティングが返す解決と一致しなければならない。(MUST)
1 つの行の説明は、振り分けが無効である旨と現在のモデル、保存の失敗とその理由、警告の内容、応答モデルの記述の順に並べる。(SHALL) 振り分けが働いていない旨は 1 つの説明に 1 度だけ述べる。(MUST) スコープの診断と有効化の操作は一覧の説明には出さず、`/spirits-role status` に出す。(SHALL)
一覧のロールのモデルの行が候補として出すモデルは、その時点で利用できる物理モデル(振り分け用のモデルを除く)とし、セッションのモデルスコープで制限してはならない。(MUST NOT) 保存済みの対象がセッションのスコープに含まれるかどうかの診断も、一覧の説明に出さない。(MUST NOT)

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
- **AND** 一覧のどの行の説明も、その仮定の下でルーティングが返す解決と一致する

#### Scenario: 振り分けが働いていない旨は 1 つの説明に 1 度だけ出す
- **GIVEN** 現在のモデルが物理モデルで、strong の対象が設定されていない
- **WHEN** 一覧でロックを strong に切り替え、ロックの行と `strong` のモデルの行を選ぶ
- **THEN** どちらの行の説明でも、振り分けが働いていない旨は先頭に 1 度だけ出て、strong が normal の対象で走る旨がその後に続く

#### Scenario: 一覧の候補はセッションのスコープで制限しない
- **GIVEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が利用でき、セッションのモデルスコープが `spirits/auto` だけである
- **WHEN** 一覧の `strong` のモデルの行で候補を開く
- **THEN** `compat-fake/fake-model` と `compat-fake/fake-strong` が候補に出て、`unset` も選べる
- **AND** 説明に、保存済みの対象がスコープ外である旨の診断は出ない

### Requirement: 一覧の説明の thinking レベルは要求に載るレベルを示す
システムは、一覧の行の説明に出す thinking レベルを、その時点でリクエストを解決したときに要求に載るレベルとし、実際に応答するロールの設定から決めなければならない。(MUST) strong が使えず normal の対象で応答するときは、strong の設定ではなく normal の設定から決める。ロールの thinking レベルの行も、そのロールの要求に実際に載るレベルを示す。(SHALL)
行の説明に出すモデルと thinking レベルは、同じ条件でルーティングが返すモデルと thinking レベルに一致しなければならない。(MUST) 振り分けが無効なセッションでは、この一致は、同じ条件で振り分けが有効だった場合にルーティングが返すモデルと thinking レベルに対するものとする。(MUST)
この一致はすべての行に及ぶ。ロックの行が示す実行中のステップのロール、ロールのモデルの行が示す応答モデル、ステップの行、ロールの thinking レベルの行は、どれも同じ条件でルーティングが返すロール、モデル、thinking レベルと一致しなければならない。(MUST)

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
システムは、セッションが物理モデルを選択している場合、コマンドによるすべての設定変更(ロック、ロールのモデルと thinking レベル、ステップのロールと thinking レベル、`unset` による削除を含む)で、振り分けが働いていないことと、振り分け用のモデルを選択すると有効になることを 1 行で伝えなければならない。(SHALL) 警告しても設定を取り消してはならない。(MUST)
対話端末で伝える手順は、そのセッションで実際に実行できる手順でなければならない。(MUST) 振り分け用のモデルがこのセッションのモデルスコープに含まれない場合は、モデル selector で選択対象の範囲を切り替える操作、またはモデルのスコープを設定する操作で有効化できることを名指す。(SHALL) 対話端末でないセッションでは操作を名指さない。(MUST NOT)

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
