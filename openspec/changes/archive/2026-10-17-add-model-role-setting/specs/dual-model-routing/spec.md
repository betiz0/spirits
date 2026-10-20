# Spec Delta

## MODIFIED Requirements

### Requirement: 振り分け用のモデルの登録
システムは、normal と strong をリクエストごとに振り分けるモデルを一覧へ登録し、既存のモデル選択手段で選択できるようにしなければならない。(SHALL) 識別子は `spirits/auto` とする。
振り分けは、そのモデルが選択されているセッションにのみ適用する。(SHALL) 振り分けが行われないセッションでも、システムはセッションのロックを保持する。

#### Scenario: 一覧に表示されて選択できる
- **WHEN** 利用者がモデル selector を開く
- **THEN** `spirits/auto` が候補に現れ、選択すると現在のモデルになる

#### Scenario: 物理モデルを直接選んだセッションでは振り分けない
- **WHEN** 利用者が物理モデルを現在のモデルにしている
- **THEN** いかなるリクエストも振り分けられず、ロールは決定されない
- **AND** `/model` で設定したロックは変わらず、`spirits/auto` へ切り替えた後のリクエストに使われる

#### Scenario: 再読み込み後も利用できる
- **GIVEN** `spirits/auto` が選択されている
- **WHEN** `/reload` する
- **THEN** `spirits/auto` は選択されたまま、次のリクエストも振り分けられる

### Requirement: strong フェーズの開始
システムは、対象スキル（`sprt-opsx-review-change` と `sprt-opsx-verify-deep`）の起動を、スキル名がその名前に一致するスラッシュコマンド入力として受け取ったとき、strong フェーズへ遷移しなければならない。(SHALL) スキル名の範囲は、Pi がスキルコマンドを展開するときと同じく、最初の半角スペースまたは入力の終わりまでとする。
対象スキル以外の起動、Pi がスキルとして展開しない入力、およびモデルが SKILL.md を読み取っただけの場合は遷移してはならない。(SHALL)
システムは、run の実行中でないときに対象スキル以外の入力を受け取った場合、ロールをセッションがロックしているロールにしなければならない。(MUST) 対象スキルの入力の後に run が始まらなかった場合も、システムは strong フェーズを次の run へ持ち越してはならない。(MUST) ただし利用者が strong をロックしている場合、次の run はロックされた strong で走る。run の実行中に steer や follow-up として受け取った入力では、フェーズを変えない。run の実行中に `/model` でロールが指定された場合は、strong フェーズの途中でも `/model によるロールのロック` に従う。

#### Scenario: 起動後の最初のリクエストは strong
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定されている
- **WHEN** `/skill:sprt-opsx-verify-deep <change 名>` を送る
- **THEN** その run の以降のリクエストは strong の対象モデルへルートする

#### Scenario: 対象外のスキルでは遷移しない
- **WHEN** 対象スキル以外のスキルコマンドを送る
- **THEN** リクエストは normal の対象モデルへルートする

#### Scenario: 展開されないスキルコマンドでは遷移しない
- **WHEN** `/skill:sprt-opsx-verify-deep` の直後に半角スペースではなく改行が続き、後続行に半角スペースを含む入力を送る
- **THEN** Pi はその入力をスキルとして展開せず、リクエストは normal の対象モデルへルートする

#### Scenario: SKILL の読み取りだけでは遷移しない
- **GIVEN** 入力なしにモデルが SKILL.md を読み取った
- **WHEN** 同じ run の次のリクエストを受ける
- **THEN** normal の対象モデルへルートする

#### Scenario: 始まらなかったスキル実行を持ち越さない
- **GIVEN** strong をロックしておらず、`/skill:sprt-opsx-verify-deep` を送ったが、認証エラーなどで run が始まらなかった
- **WHEN** 次に `/opsx-apply` を送る
- **THEN** その run のリクエストは normal の対象モデルへルートする

#### Scenario: ロック中の入力はロックを解除しない
- **GIVEN** `spirits/auto` が選択され、strong がロックされており、strong の対象が設定されている
- **WHEN** 対象スキル以外の入力を send し、その run のリクエストを受ける
- **THEN** リクエストは strong の対象モデルへルートする

### Requirement: strong フェーズからの復帰
システムは、strong フェーズへの遷移後に run が settled したとき、中断された場合とエラーで終わった場合も含めて、ロールをセッションがロックしているロールへ戻さなければならない。(MUST)
スキルの実行は 1 つの run に対応すると前提する。1 つのスキル実行が複数の run に跨るとき、2 つ目以降の run のロールは未定義とする。

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

### Requirement: ロールの記録と復元
システムは、リクエストごとに決定したロールをそのセッション分岐に記録し、その分岐を読み込むとき（セッション復帰、分岐作成、分岐間移動）に記録されたロールを復元しなければならない。(SHALL)
記録が無い、または記録された値を読み取れない場合は、ロール未決定として扱わなければならない。(SHALL)
システムは、記録の無い新しいセッション（起動時に新規作成したセッション、または `/new`）を開始するとき、既定ロールが設定されており、現在のモデルが振り分け用のモデルであれば、既定ロールを分岐に記録しなければならない。(SHALL) それ以外のセッションの開始（復帰、分岐作成、再読み込み）と分岐間の移動では、リクエスト以外の理由でロールを記録してはならない。(MUST)
復元するのは表示に使う記録されたロールだけである。run のロール（strong フェーズ）とロックはセッションに保存しないので、セッション開始後の最初のリクエストは既定ロール（未設定なら normal）から始まる。

#### Scenario: 復帰後にロールが戻る
- **GIVEN** deep verify スキルの strong リクエストを含むセッションが保存されている
- **WHEN** そのセッションを復帰する
- **THEN** 記録されたロールは strong として復元されてバッジに表示され、復帰後の最初のリクエストは既定ロールの対象モデルへルートする

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
- **WHEN** その分岐を読み込み、フッターを描画する
- **THEN** ロールは未決定として扱われ、バッジは表示されず、描画は継続する

#### Scenario: 既定ロールで開始する
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションであり、`spirits/auto` が選択されている
- **WHEN** セッションを開始する
- **THEN** セッションのロールが strong にロックされ、分岐に strong が記録されてバッジが `[strong]` と表示される
- **AND** 次のリクエストは strong の対象モデルへルートされる

#### Scenario: 物理モデルで開始するときは記録しない
- **GIVEN** 既定ロールが strong で、記録のない新しいセッションであり、現在のモデルが物理モデルである
- **WHEN** セッションを開始する
- **THEN** セッションのロールは strong にロックされるが、分岐には記録されず、バッジは表示されない

#### Scenario: 復帰では既定ロールを記録しない
- **GIVEN** 既定ロールが strong で、ロールを含まない形式の記録だけのセッションがあり、`spirits/auto` が選択されている
- **WHEN** そのセッションを復帰する
- **THEN** セッションのロールは strong にロックされるが、セッションに記録は追記されず、次のリクエストで決定されるまでバッジは表示されない

#### Scenario: 振り分けの失敗では記録を更新しない
- **GIVEN** 記録されたロールが normal である
- **WHEN** strong へ振り分けようとして振り分け自体が失敗する
- **THEN** 記録されたロールは normal のまま、リクエストはエラー応答で終わる

## ADDED Requirements

### Requirement: 既定ロールの読み取り
システムは設定ファイルからグローバルの既定ロールを読み取り、大文字小文字を区別せずに `normal` または `strong` に解決できるときだけそれを使わなければならない。設定が無い、空である、文字列でない、またはどちらでもない場合、システムは既定ロールを未設定として扱い、初期ロールは normal とし、その理由を通知してはならない。(SHALL)
既定ロールの読み取りは、セッションの開始時（起動、`/new`、復帰、分岐作成、再読み込み）にだけ行い、分岐間の移動では行ってはならない。(SHALL)

#### Scenario: strong の既定ロールを読み取る
- **GIVEN** 設定ファイルの既定ロールが `strong` である
- **WHEN** セッションを開始する
- **THEN** 初期ロールが strong になる

#### Scenario: 大文字小文字を区別しない
- **GIVEN** 設定ファイルの既定ロールが `STRONG` である
- **WHEN** セッションを開始する
- **THEN** 初期ロールが strong になる

#### Scenario: 設定が無い
- **GIVEN** 設定ファイルに既定ロールの設定がない
- **WHEN** セッションを開始する
- **THEN** 初期ロールが normal になり、通知は表示されない

#### Scenario: 不正な値は未設定扱い
- **GIVEN** 設定ファイルの既定ロールが `banana` である
- **WHEN** セッションを開始する
- **THEN** 初期ロールが normal になり、通知は表示されない
- **AND** 設定ファイルは変更されない

#### Scenario: 設定の編集は次の開始から効く
- **GIVEN** セッションが実行中で、既定ロールが normal である
- **WHEN** 設定ファイルの既定ロールを strong に編集し、分岐間を移動する
- **THEN** 実行中のセッションのロールは変わらない
- **AND** 次に開始するセッションの初期ロールは strong になる

### Requirement: /model によるロールのロック
システムは `/model` でロールが指定された場合、選択対象のモデルの種別にかかわらず、セッションのロールを小文字に正規化したその値にロックしなければならない。(MUST) ロックは Enter での送信だけでは設定ファイルに書き込んではならず、保存キーで送信されたときだけグローバルの既定ロールとして保存される。(SHALL) 物理モデルが選択されている間もシステムはロックを保持し、振り分け用のモデルが選択されたときからそれを適用しなければならない。(SHALL) ロックの設定は、それ自体ではセッションに記録されたロールを変えてはならない。
システムは分岐間の移動ではロックを変えてはならない。(MUST) セッションの開始時（再読み込みを含む）には、ロックを既定ロール（未設定なら normal）に置き換えなければならない。(SHALL)
run の実行中にロールが指定された場合、システムはそのロールを、実行中の run の以降のリクエストにも直ちに適用しなければならない。strong フェーズの途中であっても同じとする。(SHALL)

#### Scenario: 物理モデルを指定してロックする
- **GIVEN** 現在のモデルが物理モデルであり、セッションのロールが normal である
- **WHEN** ユーザーが `/model anthropic/claude-sonnet-4-5 strong` を送る
- **THEN** モデルが `anthropic/claude-sonnet-4-5` に切り替わり、セッションのロールが strong にロックされる
- **AND** 設定ファイルの既定ロールは変わらない

#### Scenario: 物理モデルで設定したロールが振り分け開始後に効く
- **GIVEN** 物理モデルを選択しているセッションで `/model anthropic/claude-sonnet-4-5 strong` を送り、strong にロックしている
- **WHEN** ロールを指定せずに `spirits/auto` へ切り替えてリクエストする
- **THEN** リクエストは strong の対象モデルへルートする

#### Scenario: spirits/auto を選んだままロックする
- **GIVEN** `spirits/auto` が選択されており、セッションのロールが normal である
- **WHEN** ユーザーが `/model spirits/auto strong` を Enter で送る
- **THEN** セッションのロールが strong にロックされ、次のリクエストが strong の対象モデルへルートされる

#### Scenario: normal に戻す
- **GIVEN** セッションのロールが strong にロックされている
- **WHEN** ユーザーが `/model spirits/auto normal` を Enter で送る
- **THEN** セッションのロールが normal にロックされ、次のリクエストが normal の対象モデルへルートされる

#### Scenario: ロック設定だけではバッジが変わらない
- **GIVEN** `spirits/auto` が選択されており、セッションに記録されたロールが無い
- **WHEN** ユーザーが `/model spirits/auto strong` を Enter で送る
- **THEN** セッションのロールは strong にロックされるが、次のリクエストでロールが記録されるまでバッジの表示は変わらない

#### Scenario: 振り分け用のモデルの選択解除ではロックが消えない
- **GIVEN** `spirits/auto` を選んで strong にロックしている
- **WHEN** ロールを指定せずに物理モデルへ切り替える
- **THEN** ロックは strong のままで、再び `spirits/auto` へ戻すと strong の対象モデルへルートされる

#### Scenario: 分岐間の移動ではロックを維持する
- **GIVEN** `spirits/auto` が選択され、既定ロールが未設定で、`/model spirits/auto strong` を Enter で送って strong にロックしている
- **WHEN** 記録が normal の分岐へ移動してリクエストする
- **THEN** バッジは移動直後に記録の `[normal]` を表示し、リクエストは strong の対象モデルへルートされる

#### Scenario: 再読み込みでは既定ロールに戻る
- **GIVEN** `spirits/auto` が選択され、既定ロールが未設定で、`/model spirits/auto strong` を Enter で送って strong にロックしている
- **WHEN** `/reload` してリクエストする
- **THEN** リクエストは normal の対象モデルへルートされる

#### Scenario: run の実行中に指定したロールは直ちに効く
- **GIVEN** `spirits/auto` が選択され、strong をロックしておらず、`/skill:sprt-opsx-verify-deep` の run が strong フェーズで走っている
- **WHEN** ユーザーが `/model spirits/auto normal` を Enter で送る
- **THEN** その run の以降のリクエストは normal の対象モデルへルートされる
- **AND** run が settled した後も normal のままである
