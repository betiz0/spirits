# Spec Delta

## MODIFIED Requirements

### Requirement: managed 限定のコマンド登録
システムは、ホストの拡張 API に role 登録 API(`registerModelRoles`)が関数として存在しないときだけ、spirits 専用コマンド `/spirits-role` と `/spirits-clear` を登録しなければならない。(SHALL)
role 登録 API が存在するホストでは、これらのコマンドを登録してはならない。(MUST)
role 登録 API が無いホストでも、既存の機能(`tsrepl`、TODO、harness、`spirits/auto` の振り分け、skill による strong フェーズ)は変更してはならない。(MUST)
専用コマンドは `/spirits-model` を含まない。(MUST NOT)

#### Scenario: 公式 Pi では専用コマンドを使う
- **WHEN** role 登録 API の無いホストで spirits 拡張を起動し、コマンド一覧を見る
- **THEN** `/spirits-role` と `/spirits-clear` が登録され、`/spirits-model` は登録されず、role 関連機能が制限される旨の既存の限定互換モードの通知も出る

#### Scenario: role API が有るホストでは登録しない
- **WHEN** role 登録 API を持つホストで同じ拡張 bundle を起動し、コマンド一覧を見る
- **THEN** `/spirits-role` と `/spirits-clear` は登録されず、既存の `/model` と `/clear` とコアの role 表示だけが使われる

### Requirement: `/spirits-role` はモデルを変えずに role をロックする
システムは `/spirits-role normal` と `/spirits-role strong` で、セッションのモデルと thinking レベルを変えずに role をロックし、その role をセッションの記録と既定保存キーに残さなければならない。(SHALL)
ロックは継続中のステップを終えなければならない。(MUST) run の実行中にロックされた場合、その run の以降のリクエストにも直ちに適用しなければならない。(SHALL)
物理モデルが選択されている間もロックは保持され、振り分け用のモデルが選択されたときから適用される。(SHALL)

#### Scenario: 引数なしは表示だけ
- **WHEN** `/spirits-role` を引数なしで実行する
- **THEN** 現在のモデル、thinking レベル、role のロック、ステップ、設定ファイルは変わらない
- **AND** 設定と稼働の一覧または稼働状況だけが表示される

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
- **WHEN** `/spirits-role strong` で role がロックされた
- **THEN** セッションのモデルを変えずに badge がその role で描画される

#### Scenario: 再読み込み後に再描画する
- **WHEN** 拡張の再読み込みによってセッションが開始した
- **THEN** 引き継いだロックと継続中のステップから、ステップ設定・ステップの既定ロール・ロックの順で解決したロールの badge がもう一度描画される

### Requirement: 専用コマンドの表面の違いを文書に残す
システムは、`/spirits-*` による操作が既定経路と同じ目的を満たすが、コマンド名、表示位置、表示の消去の有無、公式コマンドとの統合、対話端末でしか使えない操作という点で異なることを文書に記録しなければならない。(SHALL)
モデルの選択と thinking レベルの既定保存が、公式の `/model` と `/thinking` でも満たせることを同じ文書に記録しなければならない。(SHALL) 専用コマンドが設定するのはロールの対象であり、セッションのモデル選択ではないことを区別して記録する。(MUST)
公式バイナリが表示する Pi の帰属表示はそのまま受け入れること、および第三者拡張が登録した provider のモデルを `rlm` の子では使えないことを、同じ文書に記録しなければならない。(SHALL)

#### Scenario: 限定向けの文書
- **WHEN** managed 経路の機能一覧を読む
- **THEN** `/spirits-*` の各目的、既定経路との違い、ロールの対象の選択とセッションのモデル選択の区別、公式 `/model` と `/thinking` の代替関係、Pi の帰属表示と第三者 provider の制約が記載されている

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

## REMOVED Requirements

### Requirement: `/spirits-model` は 1 行でモデル、thinking レベル、role を選ぶ
**Reason**: モデル、thinking レベル、role の選択が公式 Pi 1.5.0 の `/model`、`/thinking`、`/spirits-role` に分かれて足り、1 行で 3 つを選ぶ専用コマンドが不要になったため。ロール別・ステップ別の設定が増え、モデル参照はロールの対象に限定される。
**Migration**: セッションのモデル選択と既定保存は公式の `/model`、thinking レベルは公式の `/thinking`、ロールのロックは `/spirits-role <role>` を使う。ロールの対象モデルは `/spirits-role <role> model <ref>`、ロールの thinking レベルは `/spirits-role <role> thinking <level>` で設定する。

### Requirement: `/spirits-model` と `/spirits-role` は選んだ値を既定として保存する
**Reason**: 保存の主体が `/spirits-role` の 1 コマンドへ集約され、コマンド名を含む要件名が実態と合わなくなるため。保存する対象もロール、ロールの対象モデル、ロールの thinking レベル、ステップ設定へ変わる。
**Migration**: 追加する要件「`/spirits-role` は選んだ値を既定として保存する」に従う。セッションのモデルと thinking レベルの既定保存は公式の `/model` と `/thinking` が担う。

## ADDED Requirements

### Requirement: `/spirits-role` は対象 項目 値の文法で設定する
システムは `/spirits-role` の引数を、対象、項目、値の順として解釈しなければならない。(SHALL) 対象はロール名(`normal` / `strong`)、ステップ名、`status`、および引数なしの 4 通りとする。項目はロールに対して `model` と `thinking`、ステップに対して `role` と `thinking` とする。値に `unset` が指定されたときは、その項目を未設定に戻す。(SHALL)
ロールのモデルの値は行末までの全体を参照とし、空白を含む参照を受け付けなければならない。(MUST)
対象と項目と値の語の照合は大文字小文字を区別しない。(SHALL)
解釈できない入力、および項目を要求する対象に対して項目と値を省略した入力では、設定、セッションのロック、記録のいずれも変更してはならない。その場合、使い方を伝える。(MUST)

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
システムは対話 TUI で引数なしの `/spirits-role` を受け取ったとき、1 行 1 設定項目の一覧を開かなければならない。(SHALL) 一覧は、セッションのロック、2 つのロールのモデルと thinking レベル、ステップ一覧の設定を並べ、選択中の行にはその項目の解決結果(実際に応答するモデル、有効な thinking レベル、継続の有無、警告)を表示する。(SHALL)
ステップは 1 ステップを 1 行とし、そのステップのロールと thinking レベルの組を 1 つの設定項目として扱う。(SHALL)
ロール未指定のステップはロックに従う旨、既定ロールが効いている行はその旨、そのセッションに開始コマンドが 1 つもないステップはその旨を表示する。(SHALL)
対話 TUI 以外では一覧を開かず、稼働状況を表示する。(MUST)

#### Scenario: 一覧の開閉
- **WHEN** 対話 TUI で `/spirits-role` を引数なしで実行する
- **THEN** ロック、2 ロールのモデルと thinking レベル、ステップ設定の一覧が開き、選択行に解決結果が出る

#### Scenario: 開始コマンドが無いステップ
- **GIVEN** あるステップの開始コマンドが、このセッションで利用できるスキルおよびテンプレートに 1 つも無い
- **WHEN** 一覧が開かれる
- **THEN** その行に開始コマンドが無い旨が表示されるが、設定の操作は受け付けられる

#### Scenario: 対話端末以外では一覧を開かない
- **WHEN** RPC モードまたは print モードで `/spirits-role` を引数なしで実行する
- **THEN** 一覧は開かれず、稼働状況が通知される

### Requirement: 一覧の説明は実際の解決結果を示す
システムは、一覧のロックの行に、ステップの既定ロールやステップ設定ではなく、セッションがロックしているロールを出さなければならない。(MUST)
行の説明に出す解決結果は設定値の写しではなく、その時点でリクエストを解決したときに実際に応答するモデルとしなければならない。(MUST) 設定済みで使えない対象の行には、使えない旨とその理由、代わりに応答するモデルを出す。(SHALL) 直近のリクエストがあるときは、そのロール・物理モデル・要求した thinking レベルをロックの行の説明に出す。(SHALL)
書き込みに成功した行は、再読み込みを待たずに、値と説明の解決結果の両方を新しい値へ更新する。(SHALL)

#### Scenario: 使えない対象の行は代わりに応答するモデルを出す
- **GIVEN** strong の対象が `nowhere/nothing` に設定され、そのモデルは利用できず、normal の対象は `compat-fake/fake-model` に解決できる
- **WHEN** 一覧の `strong` のモデルの行を選ぶ
- **THEN** 説明に strong の対象が使えない旨とその理由、strong のリクエストが `compat-fake/fake-model` で応答する旨が出る

#### Scenario: ステップの既定ロールで走っている間もロックの行はロックを出す
- **GIVEN** normal がロックされ、`/skill:sprt-opsx-verify-deep` の run が走っている
- **WHEN** その run の途中で一覧を開く
- **THEN** ロックの行は normal を示し、`sprt-opsx-verify-deep` の行の説明に strong で走っている旨が出る

### Requirement: 一覧の説明の thinking レベルは要求に載るレベルを示す
システムは、一覧の行の説明に出す thinking レベルを、その時点でリクエストを解決したときに要求に載るレベルとし、実際に応答するロールの設定から決めなければならない。(MUST) strong が使えず normal の対象で応答するときは、strong の設定ではなく normal の設定から決める。ロールの thinking レベルの行も、そのロールの要求に実際に載るレベルを示す。(SHALL)
行の説明に出すモデルと thinking レベルは、同じ条件でルーティングが返すモデルと thinking レベルに一致しなければならない。(MUST)
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
ロックの行は、書き込み前の値に戻さず、適用したセッションのロックを示し、保存に失敗した旨とその理由をその行の説明に出す。(SHALL) badge もそのロールで描画する。(SHALL)
セッションへロックを適用した後の処理(ロックの記録の追記、設定の書き込み、行の再描画)のどこで失敗や例外が起きても、ロックの行の値と badge は、その時点でセッションがロックしているロールと一致しなければならない。(MUST) 一覧は開いたままにし、失敗の理由をロックの行の説明に出す。(SHALL)

#### Scenario: ロックの保存が失敗する
- **GIVEN** normal がロックされ、設定の書き込みが失敗する
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** セッションのロックは strong のままで、ロックの行は strong を示し、その行の説明に保存に失敗した旨とその理由が出る
- **AND** badge は `[strong]` と描画される

#### Scenario: ロックの記録の追記が例外を投げる
- **GIVEN** normal がロックされ、ロックの記録の追記が例外を投げる
- **WHEN** 一覧のロックの行で strong を選ぶ
- **THEN** 一覧は開いたままで、ロックの行はセッションがロックしているロールを示し、その行の説明に失敗の理由が出る
- **AND** badge はセッションがロックしているロールで描画されている

### Requirement: `/spirits-role status` は稼働状況を出す
システムは `/spirits-role status` の要求を受け取ったとき、1 件の通知に、変更を加えずに次の内容を出さなければならない。(SHALL) 振り分けが有効か(セッションのモデルが振り分け用のモデルか物理モデルか)、ロック、現在のステップと継続の有無、直近のリクエストで使われたロール・物理モデル・要求した thinking レベル、2 つのロールそれぞれの解決結果とその出どころ(設定のどのキーか、Pi の既定か、直近の成功レスポンスか)、未設定と使用不可の区別とその理由、thinking レベル、既定と異なるステップ設定の一覧、読み取れずに無視した設定値。

#### Scenario: 振り分けが有効なときの全項目
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、継続するステップが走った後である
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが有効であること、ロック、現在のステップと継続する旨、直近のリクエストのロールと物理モデルと要求した thinking レベル、両ロールの解決結果と出どころ、既定と異なるステップ設定が 1 件の通知に出る

#### Scenario: 物理モデルを選んでいれば無効と出る
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role status` を実行する
- **THEN** 振り分けが働いていない旨が通知に出るが、ロックと設定値はそのまま読める

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

### Requirement: 物理モデル選択中の設定変更は振り分けが働いていないことを伝える
システムは、セッションが物理モデルを選択している場合、コマンドによるすべての設定変更(ロック、ロールのモデルと thinking レベル、ステップのロールと thinking レベル、`unset` による削除を含む)で、振り分けが働いていないことと、振り分け用のモデルを選択すると有効になることを 1 行で伝えなければならない。(SHALL) 警告しても設定を取り消してはならない。(MUST)

#### Scenario: 物理モデル選択中に設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role opsx-propose role strong` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが伝えられる

#### Scenario: 物理モデル選択中に thinking を設定する
- **GIVEN** 現在のモデルが物理モデルである
- **WHEN** `/spirits-role normal thinking high` を実行する
- **THEN** 設定は保存され、いまは振り分けが働いていないことと振り分け用のモデルで有効になることが 1 行伝えられる

### Requirement: 設定時の警告は書き込んだ値で判定し、一覧では行の説明で伝える
システムは、設定時の警告の判定に、そのコマンドが書き込んだ値を反映した設定を使わなければならない。(MUST) 再読み込みの前に読める設定は書き込み前の値のままなので、それだけで判定してはならない。(MUST NOT)
一覧での編集では警告の通知を出さない。(MUST NOT) 代わりに、同じ内容をロックの行と該当する行の説明に出す。(SHALL)

#### Scenario: strong の対象を設定した直後は strong 未設定と言わない
- **GIVEN** strong の対象が設定されておらず、`spirits/auto` が選択されている
- **WHEN** `/spirits-role strong model compat-fake/fake-strong` を実行する
- **THEN** strong の対象が保存され、strong が使えない旨の警告は出ない

#### Scenario: 一覧での編集は行の説明で伝える
- **GIVEN** 現在のモデルが物理モデルで、strong の対象が設定されていない
- **WHEN** 一覧でロックを strong に切り替える
- **THEN** 警告の通知は出ず、ロックの行の説明に、振り分けが働いていない旨と strong が normal の対象で走る旨が出る

### Requirement: 入力の補完は語彙を限定する
システムは `/spirits-role` の引数補完で、1 語目に `status`、ロール名、ステップ名、2 語目に項目名、3 語目にロール名、thinking レベル、`unset` を提示しなければならない。(SHALL) モデルの参照は補完しない。(MUST NOT)

#### Scenario: 1 語目
- **WHEN** `/spirits-role ` の後ろで補完を開く
- **THEN** `status`、ロール名、ステップ名が候補に出る

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
