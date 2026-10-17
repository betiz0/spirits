# Spec Delta

## Purpose

OpenSpec ワークフローのリクエストを normal と strong の 2 ロールへ振り分け、実装前レビューと深い検証のときだけ強いモデルへ自動で切り替える。利用者は 1 つのモデルを選択したままにし、手動のモデル切り替えとその戻し忘れをなくす。

## ADDED Requirements

### Requirement: strong ロールの対象設定
システムは、単一のモデル指定を strong ロールの対象として設定ファイルから読み取らなければならない。(SHALL)
指定は provider とモデル ID の組、またはモデル ID だけを受け付け、モデル ID だけの場合はその時点の既定 provider で解決する。指定が無い、または空の場合、システムは strong 未設定として扱わなければならない。(SHALL) 指定が利用可能な物理モデルに解決できない場合(振り分け用のモデル自身など virtual model を指す場合を含む)は、strong が使えないものとして扱わなければならない。(SHALL)

#### Scenario: virtual model を指す指定は使えない
- **GIVEN** 設定に strong の対象として `spirits/auto` がある
- **WHEN** strong フェーズのリクエストを受ける
- **THEN** normal の対象モデルへルートし、理由を示す通知が 1 件表示される

#### Scenario: 設定したモデルへ解決される
- **GIVEN** 設定に strong の対象として `anthropic/claude-opus-4-7` がある
- **WHEN** strong フェーズのリクエストを受ける
- **THEN** `anthropic/claude-opus-4-7` へルートする

#### Scenario: provider を省略した指定
- **GIVEN** 既定 provider が `anthropic` で、strong の対象が `claude-opus-4-7`
- **WHEN** strong フェーズのリクエストを受ける
- **THEN** `anthropic/claude-opus-4-7` へルートする

#### Scenario: 他の設定の保存で失われない
- **WHEN** 利用者が `/model` を保存キーで既定モデルとして保存する
- **THEN** 設定ファイルの strong の指定は変更前のまま残る

### Requirement: 振り分け用のモデルの登録
システムは、normal と strong をリクエストごとに振り分けるモデルを一覧へ登録し、既存のモデル選択手段で選択できるようにしなければならない。(SHALL) 識別子は `spirits/auto` とする。
振り分けは、そのモデルが選択されているセッションにのみ適用する。(SHALL)

#### Scenario: 一覧に表示されて選択できる
- **WHEN** 利用者がモデル selector を開く
- **THEN** `spirits/auto` が候補に現れ、選択すると現在のモデルになる

#### Scenario: 物理モデルを直接選んだセッションでは振り分けない
- **WHEN** 利用者が物理モデルを現在のモデルにしている
- **THEN** いかなるリクエストも振り分けられず、ロールは決定されない

#### Scenario: 再読み込み後も利用できる
- **GIVEN** `spirits/auto` が選択されている
- **WHEN** `/reload` する
- **THEN** `spirits/auto` は選択されたまま、次のリクエストも振り分けられる

### Requirement: ワークフローのステップ別ロール
システムは、リクエストを次の表どおりのロールへ割り付けなければならない。(SHALL) 表に無いステップは normal に割り当てる。

| ステップ | ロール |
|---|---|
| propose | normal |
| change レビュースキル | strong |
| apply | normal |
| verify | normal |
| deep verify スキル | strong |
| archive | normal |

#### Scenario: 通常ステップは normal
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定されている
- **WHEN** propose、apply、verify、archive のいずれのステップでリクエストする
- **THEN** normal の対象モデルへルートする

#### Scenario: 2 つのスキルは strong
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定されている
- **WHEN** change レビュースキル、または deep verify スキルの実行中にリクエストする
- **THEN** strong の対象モデルへルートする

### Requirement: strong フェーズの開始
システムは、対象スキル（`sprt-opsx-review-change` と `sprt-opsx-verify-deep`）の起動を、スキル名がその名前に一致するスラッシュコマンド入力として受け取ったとき、strong フェーズへ遷移しなければならない。(SHALL) スキル名の範囲は、Pi がスキルコマンドを展開するときと同じく、最初の半角スペースまたは入力の終わりまでとする。
対象スキル以外の起動、Pi がスキルとして展開しない入力、およびモデルが SKILL.md を読み取っただけの場合は遷移してはならない。(SHALL)
システムは、run の実行中でないときに対象スキル以外の入力を受け取った場合、ロールを normal にしなければならない。(MUST) 対象スキルの入力の後に run が始まらなかった場合も、strong フェーズを次の run へ持ち越してはならない。run の実行中に steer や follow-up として受け取った入力では、フェーズを変えない。

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
- **GIVEN** `/skill:sprt-opsx-verify-deep` を送ったが、認証エラーなどで run が始まらなかった
- **WHEN** 次に `/opsx-apply` を送る
- **THEN** その run のリクエストは normal の対象モデルへルートする

### Requirement: strong フェーズからの復帰
システムは、strong フェーズへの遷移後に run が settled したとき、中断された場合とエラーで終わった場合も含めて、ロールを normal へ戻さなければならない。(MUST)
スキルの実行は 1 つの run に対応すると前提する。1 つのスキル実行が複数の run に跨るとき、2 つ目以降の run のロールは未定義とする。

#### Scenario: 正常終了後に戻る
- **GIVEN** deep verify スキルの run が strong フェーズで走っている
- **WHEN** run が完了して settled する
- **THEN** その後の最初のリクエストは normal の対象モデルへルートする

#### Scenario: 中断後も戻る
- **GIVEN** deep verify スキルの run が strong フェーズで走っている
- **WHEN** 利用者が Escape で中断して settled する
- **THEN** その後の最初のリクエストは normal の対象モデルへルートする

#### Scenario: 失敗しても戻る
- **GIVEN** deep verify スキルの run が strong フェーズで走っている
- **WHEN** provider のエラーで run が終わる
- **THEN** ロールは normal に戻っている

### Requirement: strong が使えないときのフォールバック
システムは、strong フェーズで strong の対象を解決できないか、その provider が資格情報を持たない場合、normal へフォールバックしなければならない。(MUST)
strong が未設定のときは何も警告してはならない。設定されているのに使えないときは利用者に通知し、同一 run 内で同じ理由の通知を繰り返してはならない。(SHALL)

#### Scenario: 未設定なら黙って normal
- **GIVEN** strong の対象が設定されていない
- **WHEN** deep verify スキルの実行中にリクエストする
- **THEN** normal の対象モデルで動作し、通知は表示されない

#### Scenario: 資格情報が無ければ normal へ寄せて通知する
- **GIVEN** strong の対象の provider が資格情報を持たない
- **WHEN** deep verify スキルの実行中にリクエストする
- **THEN** normal の対象モデルへルートし、理由を示す通知が 1 件表示される

#### Scenario: 同一 run では通知を重複させない
- **GIVEN** strong の対象の provider が資格情報を持たない
- **WHEN** 同じ run 内で 3 回リクエストする
- **THEN** 通知は合計 1 件表示される

### Requirement: normal の対象の解決
システムは normal の対象をその時点の既定 provider と既定モデルで解決し、解決できない場合は直近の成功レスポンスの物理モデルを使い、その旨を 1 回通知し、どちらも使えない場合はリクエストをエラーで終わらせなければならない。(MUST)
既定モデルが振り分け用のモデル自身など virtual model の場合、システムは既定モデルを解決できないものとして扱わなければならない。(MUST)
直近の成功レスポンスが strong の対象モデルによるものでも、システムはそのモデルを normal の対象として使い、ロールは normal として記録する。

#### Scenario: 振り分け用のモデルを既定にしている
- **GIVEN** 既定 provider と既定モデルが `spirits/auto` で、直近の成功レスポンスが `anthropic/claude-sonnet-4-5` である
- **WHEN** normal フェーズでリクエストする
- **THEN** `anthropic/claude-sonnet-4-5` へルートし、通知が 1 件表示される

#### Scenario: strong の直後に既定を失った
- **GIVEN** 直前の run が strong で `anthropic/claude-opus-4-7` に応答させ、既定モデルは解決できない
- **WHEN** settled の後に normal フェーズでリクエストする
- **THEN** `anthropic/claude-opus-4-7` へルートし、記録されるロールは normal で、ルート先のモデル名を含む通知が 1 件表示される

#### Scenario: 既定モデルが normal になる
- **GIVEN** 既定 provider と既定モデルが `anthropic/claude-sonnet-4-5` である
- **WHEN** normal フェーズでリクエストする
- **THEN** `anthropic/claude-sonnet-4-5` へルートする

#### Scenario: 既定モデルを失ったら直近のモデルで続ける
- **GIVEN** 直近の成功レスポンスが `openai/gpt-5.6-luna` で、既定モデルは解決できない
- **WHEN** normal フェーズでリクエストする
- **THEN** `openai/gpt-5.6-luna` へルートし、通知が 1 件表示される

#### Scenario: どちらも無ければエラーで終わる
- **GIVEN** 既定モデルが解決できず、直近の成功レスポンスもない
- **WHEN** リクエストする
- **THEN** リクエストはエラー応答で終わり、セッションは次の入力を受け付けられる

### Requirement: ロールの記録と復元
システムは、リクエストごとに決定したロールをそのセッション分岐に記録し、その分岐を読み込むとき（セッション復帰、分岐作成、分岐間移動）に記録されたロールを復元しなければならない。(SHALL)
記録が無い、または記録された値を読み取れない場合は、ロール未決定として扱わなければならない。(SHALL)
復元するのは表示に使う記録されたロールだけである。strong フェーズはセッションに保存しないので、復帰後の最初のリクエストは normal から始まる。

#### Scenario: 復帰後にロールが戻る
- **GIVEN** deep verify スキルの strong リクエストを含むセッションが保存されている
- **WHEN** そのセッションを復帰する
- **THEN** 記録されたロールは strong として復元されてバッジに表示され、復帰後の最初のリクエストは normal の対象モデルへルートする

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

#### Scenario: 振り分けの失敗では記録を更新しない
- **GIVEN** 記録されたロールが normal である
- **WHEN** strong へ振り分けようとして振り分け自体が失敗する
- **THEN** 記録されたロールは normal のまま、リクエストはエラー応答で終わる
