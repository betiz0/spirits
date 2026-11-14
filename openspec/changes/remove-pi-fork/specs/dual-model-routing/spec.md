# dual-model-routing Delta

## MODIFIED Requirements

### Requirement: ロールの記録と復元
システムは、リクエストごとに決定したロールをそのセッション分岐に記録し、その分岐を読み込むとき（セッション復帰、分岐作成、分岐間移動）に記録されたロールを復元しなければならない。(SHALL)
記録は spirits 専用の role entry に書く。(MUST) ホストが所有する virtual model 用の状態 entry には、拡張から書き込んでならない。(MUST)
記録が無い、または記録された値を読み取れない場合は、ロール未決定として扱わなければならない。(SHALL)
復元するのは表示に使う記録されたロールだけである。run のロール（strong フェーズ）とロックはセッションに保存しないので、セッション開始後の最初のリクエストは既定ロール（未設定なら normal）から始まる。(SHALL) ただし managed 経路の拡張の再読み込みだけは例外で、ロックと継続中のステップは新しい実行環境へ引き継ぐ。(SHALL) 引き継ぐ範囲と引き継がない範囲は「再読み込みをまたぐロックと継続中のステップ」に従う。
role の表示は拡張の status 行の badge で行い、ホストのモデル表示の位置や消去の有無を共有しない。(SHALL)

#### Scenario: 復帰後にロールが戻る
- **GIVEN** deep verify スキルの strong リクエストを含むセッションが保存されている
- **WHEN** そのセッションを復帰する
- **THEN** 記録されたロールは strong として復元されて拡張の status 行に表示され、復帰後の最初のリクエストは既定ロールの対象モデルへルートする

#### Scenario: 分岐ごとにロールを持つ
- **GIVEN** 分岐 A の記録が strong、分岐 B の記録が normal である
- **WHEN** 分岐 B へ移動する
- **THEN** ロールは normal であり、分岐 A へ戻ると strong に戻る

#### Scenario: 旧形式の記録はロール未決定
- **GIVEN** ロールを含まない形式の記録だけのセッションがある
- **WHEN** そのセッションを復帰する
- **THEN** ロールは未決定であり、次のリクエストで決定されるまでバッジは表示されない

#### Scenario: 読み取れない記録はロール未決定
- **GIVEN** 記録のロールが文字列でない値(数値など)である
- **WHEN** その分岐を読み込み、拡張の status 行を描画する
- **THEN** ロールは未決定として扱われ、バッジは表示されず、描画は継続する

#### Scenario: 既定ロールで開始する
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションである
- **WHEN** セッションを開始する
- **THEN** セッションのロックは strong になり、拡張の status 行に strong が出る
- **AND** 次のリクエストは strong の対象モデルへルートされる

#### Scenario: 物理モデルで開始するときは記録しない
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションであり、現在のモデルが物理モデルである
- **WHEN** セッションを開始する
- **THEN** セッションのロックは strong になるが、物理モデルの要求ではバッジは出ない

#### Scenario: 復帰では既定ロールを記録しない
- **GIVEN** 既定ロールが strong で、ロールを含まない形式の記録だけのセッションがある
- **WHEN** そのセッションを復帰する
- **THEN** セッションのロックは strong になるが、セッションに記録は追記されず、次のリクエストで決定されるまでバッジは表示されない

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

## REMOVED Requirements

### Requirement: /model によるロールのロック
**Reason**: ホストの `/model` は role 語彙を持たず、role のロックは `/spirits-role` が担うため。
**Migration**: `/spirits-role normal|strong` でロックする。設定の保存は `/spirits-role <対象> <項目> <値>` を使う。

### Requirement: 分岐間の移動ではステップを移動先の記録に合わせる
**Reason**: fork 経路のシナリオ「フォーク経路の移動ではステップが続く」を外すため。MODIFIED では現行のシナリオを削除できない。
**Migration**: 追加する要件「分岐の移動でステップを移動先の分岐の記録に合わせる」に従う。managed 経路の挙動は変わらない。

## ADDED Requirements

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
- **GIVEN** managed 経路で normal がロックされ、`opsx-propose` のロールが strong に設定され、ステップは走っていない
- **WHEN** 最新のステップの記録が `opsx-propose` の分岐へ移動する
- **THEN** badge は `[strong]` と描き直される
