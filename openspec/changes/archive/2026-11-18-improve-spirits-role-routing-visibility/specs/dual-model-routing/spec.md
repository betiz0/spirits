# Spec Delta

## MODIFIED Requirements

### Requirement: strong フェーズからの復帰
システムは、継続しないステップについて、run が settled したとき、中断された場合とエラーで終わった場合も含めて、ロールをセッションがロックしているロールへ戻さなければならない。(MUST) 継続するステップの run が settled したときは、ステップと位相を維持する。(MUST)
新規セッションの開始では継続中のステップを終えなければならない。(MUST) 拡張の再読み込み、起動時の再開、復帰、分岐作成では、ステップとロックを「再読み込みをまたぐロックと継続中のステップ」に従って戻す。(SHALL)

#### Scenario: 正常終了後に戻る
- **GIVEN** deep verify スキルの strong リクエストを含むセッションが走っており、strong をロックしていない
- **WHEN** run が完了して settled する
- **THEN** その後の最初のリクエストは normal の対象モデルへルートする

#### Scenario: 中断後も戻る
- **GIVEN** deep verify スキルの strong フェーズで走っており、strong をロックしていない
- **WHEN** 利用者が Escape で中断して settled する
- **THEN** その後の最初のリクエストは normal の対象モデルへルートする

#### Scenario: 失敗しても戻る
- **GIVEN** deep verify スキルの strong フェーズで走っており、strong をロックしていない
- **WHEN** provider のエラーで run が終わる
- **THEN** ロールは normal に戻っている

#### Scenario: ロックしたロールへ戻る
- **GIVEN** 利用者が strong をロックしており、対象スキルの run が強いモデルで走った
- **WHEN** run が settled する
- **THEN** その後の最初のリクエストは strong の対象モデルへルートする

#### Scenario: 新規セッションではステップが消える
- **GIVEN** `opsx-propose` のステップが継続中である
- **WHEN** 新しいセッションを開始して idle 入力でリクエストする
- **THEN** ステップは走っておらず、セッションのロックのロールの対象へルートされる

### Requirement: ロールの記録と復元
システムは、ロックの変更とステップの変化をそのセッション分岐に記録し、その分岐でセッションを開始するとき（起動時の再開、復帰、分岐作成、再読み込み）に、記録からロックと継続中のステップを戻さなければならない。(SHALL) 分岐間の移動では、ステップを移動先の記録に合わせ、ロックは変えない (「分岐の移動でステップを移動先の分岐の記録に合わせる」)。
記録は spirits 専用の role entry と step entry に書く。(MUST) ホストが所有する virtual model 用の状態 entry には、拡張から書き込んでならない。(MUST)
ルート結果の `ModelRoute.role` は設定せず、role の記録・復元・表示は spirits の状態だけを正とする。(MUST) ホストの `ModelRoute.role` は使わない。(MUST)
記録が無い、または記録された値を読み取れない場合は、ロール未決定として扱い、ロックは既定ロール（未設定なら normal）とする。(SHALL)
再読み込み以外のセッションの開始では、継続しないステップの run のロール (strong フェーズ) を記録から戻さない。(MUST) 継続しないステップの記録が開いたままなのは、その run の途中でセッションが閉じたことを示し、中断された run はロックへ戻るからである。 戻した継続中のステップのロールと thinking レベルは、戻した後の最初のリクエストで現在の設定から解決する。戻す範囲と戻さない範囲は「再読み込みをまたぐロックと継続中のステップ」に従う。
role の表示は拡張の status 行の badge で行い、ホストのモデル表示の位置や消去の有無を共有しない。(SHALL) badge は直近のリクエストの履歴でも記録されたロールの写しでもなく、戻した状態からの次のリクエストの解決の射影とする。(MUST)

#### Scenario: 復帰後にロールが戻る
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定され、`opsx-propose` が継続中のままセッションが保存されている
- **WHEN** そのセッションを復帰する
- **THEN** ロックは normal、`opsx-propose` は継続中で、badge は strong の解決で描かれる
- **AND** 復帰後の最初の idle 入力のリクエストは strong の対象モデルへルートする

#### Scenario: 分岐ごとにロールを持つ
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定されており、分岐 A の最新のステップの記録は `opsx-propose`、分岐 B にはステップの記録が無い
- **WHEN** 分岐 B へ移動する
- **THEN** 次のリクエストのロールは normal で badge も normal の解決を描き、分岐 A へ戻ると strong に戻る

#### Scenario: 旧形式の記録はロール未決定
- **GIVEN** `spirits/auto` が選択され、ロールを含まない形式の記録だけのセッションがある
- **WHEN** そのセッションを復帰する
- **THEN** 記録されたロールは復元されず、ロックは既定ロールになり、badge はその既定ロールの解決を描く

#### Scenario: 読み取れない記録はロール未決定
- **GIVEN** `spirits/auto` が選択され、記録のロールが文字列でない値(数値など)である
- **WHEN** その分岐を読み込み、拡張の status 行を描画する
- **THEN** 記録されたロールは復元されず、描画は継続し、badge は既定ロールから解決した値を示す

#### Scenario: 既定ロールで開始する
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションであり、`spirits/auto` が選択されている
- **WHEN** セッションを開始する
- **THEN** セッションのロックは strong になり、拡張の status 行に strong の解決が出る
- **AND** 次のリクエストは strong の対象モデルへルートされる

#### Scenario: 物理モデルで開始するときは記録しない
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションであり、現在のモデルが物理モデルである
- **WHEN** セッションを開始する
- **THEN** セッションのロックは strong になるが、badge はロールを示さず、振り分けが無効であることを示す

#### Scenario: 復帰では既定ロールを記録しない
- **GIVEN** `spirits/auto` が選択され、既定ロールが strong で、ロールを含まない形式の記録だけのセッションがある
- **WHEN** そのセッションを復帰する
- **THEN** セッションのロックは strong になるが、セッションに記録は追記されず、badge は既定ロールから解決した値を描く

#### Scenario: 振り分けの失敗では記録を更新しない
- **GIVEN** 記録されたロールが normal である
- **WHEN** strong へ振り分けようとして振り分け自体が失敗する
- **THEN** 記録されたロールは normal のまま、リクエストはエラー応答で終わる

#### Scenario: 再読み込みではロックを引き継ぐ
- **GIVEN** managed 経路で `spirits/auto` が選択され、normal をロックしている
- **WHEN** 設定の変更に伴う拡張の再読み込みが終わった後の最初のリクエストを受ける
- **THEN** そのリクエストは normal の対象モデルへルートし、ロックは既定ロールへ戻っていない

#### Scenario: ホストの状態 entry には書かない
- **WHEN** managed 経路でロールを決定する
- **THEN** ホストの virtual model 用の状態 entry は追加も変更もされず、role は spirits 専用の entry にだけ記録される

#### Scenario: ModelRoute の role は使わない
- **WHEN** `spirits/auto` がリクエストをルーティングする
- **THEN** ルート結果はモデルと thinking level だけを返し、role は spirits の記録と拡張の status 行だけが表す

### Requirement: 再読み込みをまたぐロックと継続中のステップ
システムは、managed 経路でセッションが開始したとき（拡張の再読み込み、起動時の再開、復帰、分岐作成）、セッションのロックと継続中のステップを、開始前の実行環境または分岐の記録から戻さなければならない。(SHALL) 継続しなかったステップ、および `/spirits-clear` やロックの変更で終わったステップを戻してはならない。(MUST) 再読み込み以外の開始では、記録が開いたままの継続しないステップも戻してはならない。(MUST) 新規セッションは記録を持たないので、ステップは無く、ロックは既定ロールとなる。
セッションの開始で継続中のステップを戻すときは、「ステップなし」の記録を追記してはならない。(MUST NOT) 再読み込み以外の開始で、記録が開いたままの継続しないステップを棄却したときは、その棄却をステップの記録として追記しなければならない。(SHALL) 追記は、その後の再読み込みが棄却したステップを戻さない形でなければならない。(MUST)
引き継ぐのは継続中のステップ名だけでよい。そのステップのロールと thinking レベルは、開始の前と同じ値を保持するのではなく、開始後の最初のリクエストで現在の設定から解決する。(MUST)
開始の後も、badge と status 表示が戻した位相と一致しなければならない。(SHALL) 開始の後に描く badge のロールは、戻したステップとロックから、ステップ設定・ステップの既定ロール・ロックの順で解決したロールとし、その要求に載る thinking レベルも同じ解決から描く。(MUST)

#### Scenario: 設定変更の再読み込みをまたぐ
- **GIVEN** 継続するステップが走っており、そのステップの thinking レベルが設定されている
- **WHEN** `/spirits-role` での設定変更に伴う拡張の再読み込みが終わる
- **THEN** 同じステップが継続中で、次のリクエストは再読み込み前と同じロールと thinking レベルで走る

#### Scenario: ステップ設定のロールを badge に出す
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定され、strong の thinking レベルが high に設定されており、`opsx-propose` が継続中である
- **WHEN** 拡張の再読み込みが終わる
- **THEN** badge は `[strong high]` と描かれ、次のリクエストは strong の対象モデルへルートされる

#### Scenario: 復帰でも継続中のステップを戻す
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定され、`opsx-propose` が継続中のままセッションが保存されている
- **WHEN** そのセッションを復帰して idle 入力でリクエストする
- **THEN** `opsx-propose` は継続中で、リクエストは strong の対象へルートされる

#### Scenario: 開き直したセッションでは後の再読み込みでも復元しない
- **GIVEN** 継続する `opsx-propose` を `/spirits-clear` で終えた後に終了したセッションが保存されており、そのセッションの最新のステップの記録は「ステップなし」である
- **WHEN** 新しいプロセスでそのセッションを開き(起動時の再開、復帰、分岐作成のいずれでも)、`/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** ステップは復元されず、リクエストはロックのロールの対象へルートされる

#### Scenario: 開き直したセッションは開いた時点で戻し、再読み込みの後も同じ
- **GIVEN** 継続する `opsx-propose` が走っている間に終了したセッションが保存されており、そのセッションの最新のステップの記録は `opsx-propose` である
- **WHEN** 新しいプロセスでそのセッションを開き(起動時の再開、復帰、分岐作成のいずれでも)、`/spirits-role status` を実行し、続いて `/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** status は現在のステップを `opsx-propose` と示し、再読み込みの後もステップは `opsx-propose` で、リクエストはそのステップのロールの対象へルートされる
- **AND** 開始によって「ステップなし」の記録は追記されていない

#### Scenario: 終わったステップは再読み込みで復元しない
- **GIVEN** 継続するステップが走っており、続いて `/spirits-clear` を実行してステップを終えた
- **WHEN** `/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** ステップは復元されず、リクエストはロックのロールの対象へルートされる

#### Scenario: 復帰では復元しない
- **GIVEN** 継続するステップが走っており、続いて `/spirits-clear` を実行してステップを終えたセッションが保存されている
- **WHEN** そのセッションを復帰して idle 入力でリクエストする
- **THEN** ステップは走っておらず、リクエストはロックのロールの対象へルートされる

#### Scenario: run の途中で閉じた継続しないステップは復帰で戻さない
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`/skill:sprt-opsx-verify-deep` の run の途中でセッションが閉じられ、最新のステップの記録は `sprt-opsx-verify-deep` のままである
- **WHEN** そのセッションを復帰して idle 入力でリクエストする
- **THEN** ステップは走っておらず、badge は normal の解決を描き、リクエストは normal の対象へルートされる

#### Scenario: 棄却した継続しないステップは再読み込みでも戻さない
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`/skill:sprt-opsx-verify-deep` の run の途中でセッションが閉じられ、最新のステップの記録は `sprt-opsx-verify-deep` のままである
- **WHEN** そのセッションを復帰した後、`/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** ステップは復元されず、badge は normal の解決を描き、リクエストは normal の対象へルートされる

#### Scenario: 再読み込み中の設定変更は継続中のステップに次から効く
- **GIVEN** 継続する `opsx-propose` が走っており、そのステップのロールが normal に設定されている
- **WHEN** 一覧で `opsx-propose` のロールを strong に変えて再読み込みが終わり、idle 入力でリクエストする
- **THEN** 同じステップが継続中で、リクエストは strong の対象モデルへルートされる

### Requirement: 分岐の移動でステップを移動先の分岐の記録に合わせる
システムは managed 経路で、セッションの分岐間を移動したとき、ステップを移動先の分岐の最新のステップの記録に合わせなければならない。(SHALL) 記録が一覧に載るステップ名を示すときはそのステップを継続中とし、「ステップなし」の記録、記録が無いとき、および記録が一覧に無い名前や読み取れない値のときはステップを終える。(SHALL) 別の分岐で終えたステップでも、移動先の分岐の記録で終わっていなければ継続中とする。
移動ではステップの記録を追記してはならない。(MUST) 移動先の分岐の記録がすでにその分岐の状態を表しているからである。ロックは移動で変えない。(MUST)
移動の直後と、その後の拡張の再読み込みの後で、ステップは同じでなければならない。(MUST) badge は移動の後に、再読み込みのときと同じ解決で描き直す。(SHALL)

#### Scenario: 終えたステップの手前へ移る
- **GIVEN** `/opsx-propose` の run の後に `/spirits-clear` でステップを終えたセッションである
- **WHEN** 分岐の移動で `/opsx-propose` の記録と終了の記録のあいだのノードへ移って `/spirits-role status` を実行し、続いて `/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われた後に、もう一度 `/spirits-role status` を実行する
- **THEN** どちらの status も現在のステップを `opsx-propose` と示し、移動によるステップの記録は追記されていない

#### Scenario: ステップの記録より前へ移る
- **GIVEN** `opsx-propose` が継続中で、normal がロックされている
- **WHEN** 分岐の移動で `/opsx-propose` を送る前のノードへ移って idle 入力でリクエストし、続いて設定変更に伴う拡張の再読み込みの後にもう一度 idle 入力でリクエストする
- **THEN** どちらのリクエストもステップなしでロックのロールの対象へルートされ、移動によるステップの記録は追記されていない

#### Scenario: 一覧に無いステップ名の記録へ移る
- **GIVEN** managed 経路で `opsx-propose` が継続中で、移動先の分岐の最新のステップの記録が一覧に無い名前 `opsx-teleport` である
- **WHEN** その分岐へ移動して `/spirits-role status` を実行し、続いて設定変更に伴う拡張の再読み込みの後にもう一度 `/spirits-role status` を実行する
- **THEN** どちらの status も現在のステップを「なし」と示す

#### Scenario: 移動の後に badge を描き直す
- **GIVEN** managed 経路で `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定され、strong の thinking レベルが high に設定されており、ステップは走っていない
- **WHEN** 最新のステップの記録が `opsx-propose` の分岐へ移動する
- **THEN** badge は `[strong high]` と描き直される
