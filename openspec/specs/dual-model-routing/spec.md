# dual-model-routing Specification

## Purpose

OpenSpec ワークフローのリクエストを normal と strong の 2 ロールへ振り分け、実装前レビューと深い検証のときだけ強いモデルへ自動で切り替える。利用者は 1 つのモデルを選択したままにし、手動のモデル切り替えとその戻し忘れをなくす。

## Requirements

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
振り分けが行われないセッションでも、システムはセッションのロックを保持する。

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

### Requirement: ワークフローのステップ別ロール
システムは、スラッシュコマンドで始まる作業区間をステップとして扱い、リクエストを次の表どおりのロールへ割り付けなければならない。(SHALL) ステップの既定ロールが「未指定」のステップはセッションのロックに従う。表に無い入力ではステップは始まらない。ステップのロールは、そのステップの設定、ステップの既定ロール、セッションのロックの順で決める。ここでいうステップの既定ロールは表の列のことであり、全体の既定ロール (`models.role`) とは別物である。

| ステップ | 開始コマンド | ステップの既定ロール | 継続 |
|---|---|---|---|
| opsx-propose | `/opsx-propose`, `/skill:openspec-propose` | 未指定 | する |
| opsx-new | `/opsx-new`, `/skill:openspec-new-change` | 未指定 | する |
| opsx-continue | `/opsx-continue`, `/skill:openspec-continue-change` | 未指定 | する |
| opsx-ff | `/opsx-ff`, `/skill:openspec-ff-change` | 未指定 | する |
| opsx-apply | `/opsx-apply`, `/skill:openspec-apply-change` | 未指定 | する |
| opsx-verify | `/opsx-verify`, `/skill:openspec-verify-change` | 未指定 | する |
| opsx-archive | `/opsx-archive`, `/skill:openspec-archive-change` | 未指定 | する |
| opsx-bulk-archive | `/opsx-bulk-archive`, `/skill:openspec-bulk-archive-change` | 未指定 | する |
| opsx-sync | `/opsx-sync`, `/skill:openspec-sync-specs` | 未指定 | する |
| opsx-update | `/opsx-update`, `/skill:openspec-update-change` | 未指定 | する |
| opsx-explore | `/opsx-explore`, `/skill:openspec-explore` | 未指定 | する |
| opsx-onboard | `/opsx-onboard`, `/skill:openspec-onboard` | 未指定 | する |
| sprt-opsx-review-change | `/skill:sprt-opsx-review-change` | strong | しない |
| sprt-opsx-verify-deep | `/skill:sprt-opsx-verify-deep` | strong | しない |
| sprt-architecture-guards | `/skill:sprt-architecture-guards` | 未指定 | する |

#### Scenario: 通常ステップは normal
- **GIVEN** 表のステップが走っており、そのステップの設定とステップの既定ロールが未指定で、normal がロックされている
- **WHEN** そのステップの実行中にリクエストする
- **THEN** normal の対象モデルへルートする

#### Scenario: 2 つのスキルは strong
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、normal がロックされている
- **WHEN** `/skill:sprt-opsx-review-change` または `/skill:sprt-opsx-verify-deep` の実行中にリクエストする
- **THEN** strong の対象モデルへルートする

#### Scenario: ステップ設定が既定とロックより優先される
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定されている
- **WHEN** `/opsx-propose` の実行中にリクエストする
- **THEN** strong の対象モデルへルートする

#### Scenario: 表に無いコマンドではステップが始まらない
- **WHEN** 表に無いスキル、テンプレート、および自然言語の入力をする
- **THEN** ステップは始まらず、リクエストはロックのロールへ割り付けられる

### Requirement: strong フェーズの開始
システムは、ステップの開始を、その開始コマンドとして一覧に載るスラッシュコマンド入力を受け取ったときに行わなければならない。(SHALL) 名前の範囲は Pi が展開するときと同じ規則で切る。スキルは `/skill:` の直後から最初の半角スペースまで、テンプレートは `/` の直後から最初の空白文字までとする。
開始コマンドが複数あるステップでは、いずれかを受け取ったときに同じステップを開始する。(SHALL) Pi がスキルまたはテンプレートとして展開しない入力、モデルが SKILL.md を読み取っただけの場合、および steer や follow-up として渡された入力では開始してはならない。(SHALL)
実行中のステップがあるときに別のステップの開始コマンドを受け取った場合、システムは現在のステップを終えて新しいステップを開始する。(SHALL)

#### Scenario: 起動後の最初のリクエストは strong
- **GIVEN** `spirits/auto` が選択され、strong の対象が設定され、normal がロックされている
- **WHEN** `/skill:sprt-opsx-verify-deep <change 名>` を送る
- **THEN** その run のリクエストは strong の対象モデルへルートする

#### Scenario: 対象外のスキルでは遷移しない
- **WHEN** 表の開始コマンドに載っていないスキルを `/skill:` で起動し、その run でリクエストする
- **THEN** 新しいステップは始まらず、継続中のステップが無ければリクエストはロックのロールへルートする

#### Scenario: 展開されないスキルコマンドでは遷移しない
- **WHEN** `/skill:sprt-opsx-verify-deep` の直後に半角スペースではなく改行が続き、後続行に半角スペースを含む入力を送る
- **THEN** Pi はその入力をスキルとして展開せず、ステップは始まらない

#### Scenario: SKILL の読み取りだけでは遷移しない
- **GIVEN** 入力なしにモデルが SKILL.md を読み取った
- **WHEN** 同じ run の次のリクエストを受ける
- **THEN** 直前の位相を維持し、位相が未決定の場合はロックのロールへルートする

#### Scenario: テンプレートとスキルで同じステップ
- **GIVEN** `spirits/auto` が選択され、`opsx-ff` のロールが strong に設定されている
- **WHEN** `/opsx-ff` を送った run と、`/skill:openspec-ff-change` を送った run のそれぞれでリクエストする
- **THEN** どちらも strong の対象モデルへルートする

#### Scenario: ステップからステップへ移る
- **GIVEN** `opsx-propose` のステップが継続中のセッションである
- **WHEN** `/opsx-apply` を送る
- **THEN** `opsx-propose` は終わり、その run のリクエストは `opsx-apply` のロールの対象へルートされる

### Requirement: strong フェーズの維持と解除
システムは、継続するステップについて、run が settled した後もそのステップを維持しなければならない。(MUST) 継続中のステップでは、スキルおよびテンプレートの起動でない idle 入力に対して、ステップのロールと thinking レベルを適用し続ける。(SHALL) 質問への回答と追加指示は同じステップで走る。
継続しないステップは、run が settled したときにセッションのロックへ戻す。(MUST)
継続するステップでも、そのステップを開始してから 1 回のリクエストも解決ないうちに次の idle 入力を受けたときは、ステップを終えてロックへ戻らなければならない。(MUST) run が始まらなかった開始コマンドのステップは次の run へ持ち越さない。
継続中のステップがあるとき、表に無いスキルまたはテンプレートの起動、`/spirits-clear`、およびロールのロックにより、そのステップを終えてロックへ戻らなければならない。(MUST)
run の実行中に steer や follow-up として受け取った入力では、ステップと位相を変えない。(MUST) run の実行中にロールのロックが指定された場合は、ステップの途中でもそのロックに従う。(SHALL)

#### Scenario: 回答の run もステップのロール
- **GIVEN** `spirits/auto` が選択され、normal がロックされ、`opsx-propose` のロールが strong に設定されており、`/opsx-propose` の run が settled した
- **WHEN** 続けて「はい、進めて」と送る
- **THEN** その run のリクエストは strong の対象モデルへルートされる

#### Scenario: 始まらなかったスキル実行を持ち越さない
- **GIVEN** normal をロックしておらず、継続しないステップの開始コマンドを送ったが、認証エラーなどで run が始まらなかった
- **WHEN** 次に idle 入力でリクエストする
- **THEN** その run のリクエストは normal の対象モデルへルートする

#### Scenario: run が始まらなかった継続ステップを持ち越さない
- **GIVEN** normal がロックされており、継続する `opsx-propose` の開始コマンドを送ったが、認証エラーなどで run が始まらなかった
- **WHEN** 次に idle 入力でリクエストする
- **THEN** `opsx-propose` は走っておらず、その run のリクエストは normal の対象モデルへルートされる

#### Scenario: ロック中の入力はロックを解除しない
- **GIVEN** `spirits/auto` が選択され、strong がロックされており、strong の対象が設定されている
- **WHEN** 開始コマンド以外の入力を send し、その run のリクエストを受ける
- **THEN** リクエストは strong の対象モデルへルートする

#### Scenario: 次のコマンドでロックへ戻る
- **GIVEN** `opsx-propose` のステップが継続中であり、normal がロックされている
- **WHEN** 表に載らないスキルを `/skill:` で起動し、続いて idle 入力でリクエストする
- **THEN** ステップは終わり、リクエストは normal の対象モデルへルートされる

#### Scenario: クリアでステップが終わる
- **GIVEN** `opsx-propose` のステップが継続中である
- **WHEN** `/spirits-clear` を実行し、続いて idle 入力でリクエストする
- **THEN** ステップは終わっており、リクエストはロックのロールの対象へルートされる

### Requirement: strong フェーズからの復帰
システムは、継続しないステップについて、run が settled したとき、中断された場合とエラーで終わった場合も含めて、ロールをセッションがロックしているロールへ戻さなければならない。(MUST) 継続するステップの run が settled したときは、ステップと位相を維持する。(MUST)
セッションの開始(新規、復帰、分岐作成)では継続中のステップを終えなければならない。(MUST) 拡張の再読み込みでは、ステップとロックを維持する。(SHALL)

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
システムは normal の対象を、その時点の normal の対象の指定、それが無いまたは使えない場合はその時点の既定 provider と既定モデル、それも使えない場合は直近の成功レスポンスの物理モデルの順で解決し、どれも使えない場合はリクエストをエラーで終わらせなければならない。(MUST)
normal の対象の指定が設定されているのに使えない場合、システムは利用者に通知し、同一 run 内で同じ理由の通知を繰り返してはならない。(SHALL) 指定の有無にかかわらず、既定 provider と既定モデルが解決できず直近の成功レスポンスの物理モデルへ寄せたときも、その旨を通知し、同一 run 内で同じ理由の通知を繰り返してはならない。(SHALL) 指定が無く、既定 provider と既定モデルへ寄せられたときは通知してはならない。(MUST)
normal の対象の指定および既定モデルが振り分け用のモデル自身を指す場合、システムはそれを解決できないものとして扱わなければならない。(MUST)
直近の成功レスポンスが strong の対象モデルによるものでも、システムはそのモデルを normal の対象として使い、ロールは normal として記録する。

#### Scenario: 既定モデルが normal になる
- **GIVEN** normal の対象の指定が無く、既定 provider と既定モデルが `anthropic/claude-sonnet-4-5` である
- **WHEN** normal フェーズでリクエストする
- **THEN** `anthropic/claude-sonnet-4-5` へルートし、通知は表示されない

#### Scenario: 指定が失われたら既定へ寄せる
- **GIVEN** normal の対象の provider が資格情報を持たず、既定 provider と既定モデルは解決できる
- **WHEN** normal フェーズでリクエストする
- **THEN** 既定の物理モデルへルートし、理由を示す通知が 1 件表示される

#### Scenario: 既定モデルを失ったら直近のモデルで続ける
- **GIVEN** normal の対象の指定が無く、既定モデルは解決できず、直近の成功レスポンスが `openai/gpt-5.6-luna` である
- **WHEN** normal フェーズでリクエストする
- **THEN** `openai/gpt-5.6-luna` へルートし、通知が 1 件表示される

#### Scenario: どちらも無ければエラーで終わる
- **GIVEN** normal の対象の指定が無く、既定モデルが解決できず、直近の成功レスポンスもない
- **WHEN** リクエストする
- **THEN** リクエストはエラー応答で終わり、セッションは次の入力を受け付けられる

#### Scenario: 振り分け用のモデルを既定にしている
- **GIVEN** normal の対象の指定が無く、既定モデルが `spirits/auto` 自身である
- **WHEN** normal フェーズでリクエストする
- **THEN** 既定を解決できないものとして扱い、直近の成功レスポンスが無ければリクエストはエラーで終わる

#### Scenario: normal の対象の指定が効く
- **GIVEN** normal の対象に `local/qwen3.8-flash` が設定され、既定 provider と既定モデルが `anthropic/claude-sonnet-4-5` である
- **WHEN** normal フェーズでリクエストする
- **THEN** `local/qwen3.8-flash` へルートする

#### Scenario: strong の直後に既定を失った
- **GIVEN** 直前の run が strong の対象モデルで成功しており、既定モデルの provider から資格情報が消えた
- **WHEN** 次の normal リクエストを受ける
- **THEN** 直近の成功レスポンスのモデルへルートし、通知が 1 件表示される

### Requirement: ロールの記録と復元
システムは、リクエストごとに決定したロールをそのセッション分岐に記録し、その分岐を読み込むとき（セッション復帰、分岐作成、分岐間移動）に記録されたロールを復元しなければならない。(SHALL)
記録が無い、または記録された値を読み取れない場合は、ロール未決定として扱わなければならない。(SHALL)
システムは、記録の無い新しいセッション（起動時に新規作成したセッション、または `/new`）を開始するとき、既定ロールが設定されており、現在のモデルが振り分け用のモデルであれば、既定ロールを分岐に記録しなければならない。(SHALL) それ以外のセッションの開始（復帰、分岐作成、再読み込み）と分岐間の移動では、リクエスト以外の理由でロールを記録してはならない。(MUST)
復元するのは表示に使う記録されたロールだけである。run のロール（strong フェーズ）とロックはセッションに保存しないので、セッション開始後の最初のリクエストは既定ロール（未設定なら normal）から始まる。(SHALL) ただし managed 経路の拡張の再読み込みだけは例外で、ロックと継続中のステップは新しい実行環境へ引き継ぐ。(SHALL) 引き継ぐ範囲と引き継がない範囲は「再読み込みをまたぐロックと継続中のステップ」に従う。

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

#### Scenario: 再読み込みではロックを引き継ぐ
- **GIVEN** managed 経路で `spirits/auto` が選択され、normal をロックしている
- **WHEN** 設定の変更に伴う拡張の再読み込みが終わった後の最初のリクエストを受ける
- **THEN** そのリクエストは normal の対象モデルへルートし、ロックは既定ロールへ戻っていない

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
この要件は `/model` が role 語彙を持つフォーク経路についてのものである。managed 経路では role 語彙が無い代わりに `/spirits-role` がロックする（`managed-commands` の「`/spirits-role` は対象 項目 値の文法で設定する」）。
システムは `/model` でロールが指定された場合、選択対象のモデルの種別にかかわらず、セッションのロールを小文字に正規化したその値にロックしなければならない。(MUST) ロックは Enter での送信だけでは設定ファイルに書き込んではならず、保存キーで送信されたときだけグローバルの既定ロールとして保存される。(SHALL) 物理モデルが選択されている間もシステムはロックを保持し、振り分け用のモデルが選択されたときからそれを適用しなければならない。(SHALL) ロックの設定は、それ自体ではセッションに記録されたロールを変えてはならない。
システムは分岐間の移動ではロックを変えてはならない。(MUST) フォーク経路のセッションの開始時（再読み込みを含む）には、ロックを既定ロール（未設定なら normal）に置き換えなければならない。(SHALL) managed 経路の拡張の再読み込みではロックを既定ロールへ戻さない（「再読み込みをまたぐロックと継続中のステップ」）。(MUST)
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
- **GIVEN** フォーク経路で `spirits/auto` が選択され、既定ロールが未設定で、`/model spirits/auto strong` を Enter で送って strong にロックしている
- **WHEN** `/reload` してリクエストする
- **THEN** リクエストは normal の対象モデルへルートされる

#### Scenario: run の実行中に指定したロールは直ちに効く
- **GIVEN** `spirits/auto` が選択され、strong をロックしておらず、`/skill:sprt-opsx-verify-deep` の run が strong フェーズで走っている
- **WHEN** ユーザーが `/model spirits/auto normal` を Enter で送る
- **THEN** その run の以降のリクエストは normal の対象モデルへルートされる
- **AND** run が settled した後も normal のままである

### Requirement: 振り分け用のモデルを選ぶ親の子セッション
システムは、`spirits/auto` を選択した親セッションが子エージェントセッションを起動するとき、親の run と同じ解決で子に渡す物理モデルと thinking レベルを決めなければならない。(SHALL)
位相が strong で strong の対象が解決できるときは strong の対象を、それ以外の場合(strong 未設定、strong が使えない、位相が normal)は normal の対象を子の対象にする。子の対象の判定には、振り分け本体が既に行う資格情報の確認以外の解決規則を追加してはならない。(MUST)
子の起動では、対象の解決とフォールバックについて通知してはならない。(MUST)

#### Scenario: strong 位相の子は strong の対象
- **GIVEN** 親セッションが `spirits/auto` を選択していて、ロール位相が strong で、strong の対象が利用可能
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡すモデルは strong の対象の物理モデルである

#### Scenario: normal 位相の子は既定モデル
- **GIVEN** 親セッションが `spirits/auto` を選択していて、ロール位相が normal で、normal の対象の指定が無く、既定 provider と既定モデルが `anthropic/claude-sonnet-4-5` である
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡すモデルは `anthropic/claude-sonnet-4-5` である

#### Scenario: 子の thinking レベルは親の run と同じ解決
- **GIVEN** 親セッションが `spirits/auto` を選択していて、位相が normal であり、normal の thinking レベルが high に設定され、セッションの選択値が medium である
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡す thinking レベルは high である

#### Scenario: strong が使えなければ黙って normal の対象
- **GIVEN** 親セッションが `spirits/auto` を選択していて、ロール位相が strong だが strong の対象が解決できない
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡すモデルは normal の対象であり、通知は表示されない

#### Scenario: 既定モデルを失った子は直近の成功レスポンス
- **GIVEN** 親セッションが `spirits/auto` を選択していて、normal の対象の指定と既定モデルは解決できず、直近の成功レスポンスが `anthropic/claude-sonnet-4-5` で、その provider に資格情報がある
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡すモデルは `anthropic/claude-sonnet-4-5` である

#### Scenario: 直近の成功レスポンスに資格情報が無い
- **GIVEN** 親セッションが `spirits/auto` を選択していて、normal の対象の指定と既定モデルは解決できず、直近の成功レスポンスが `openai/gpt-5.6-luna` で、その provider に資格情報が無い
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子は起動せず、試みたロールと資格情報が無いことを名指すエラーになる

#### Scenario: 子の対象がどちらも使えない
- **GIVEN** 親セッションが `spirits/auto` を選択していて、normal の対象も直近の成功レスポンスの物理モデルも使えない
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子は起動せず、試みたロールと不足している設定を名指すエラーになる

#### Scenario: 物理モデルを選ぶ親は振り分けない
- **GIVEN** 親セッションが物理モデルを選択していて、ロール位相が strong
- **WHEN** 親のセッションから子エージェントセッションを起動する
- **THEN** 子に渡すモデルは親のモデルそのままであり、strong の対象は使われない

#### Scenario: 設定変更は次の子から反映する
- **GIVEN** 親セッションが `spirits/auto` を選択していて、ロール位相が strong で、子を 1 回起動した後に strong の対象の設定が変わった
- **WHEN** 同じ親セッションから子をもう 1 回起動する
- **THEN** 2 回目の子には変更後の設定で解決した対象が渡される

### Requirement: normal ロールの対象設定
システムは、単一のモデル指定を normal ロールの対象として設定ファイルから読み取らなければならない。(SHALL) 指定は provider とモデル ID の組、またはモデル ID だけを受け付け、モデル ID だけの場合はその時点の既定 provider で解決する。指定が無い、空である、文字列でない場合、システムは normal の対象を未設定として扱わなければならない。(SHALL) 未設定の normal の対象は Pi の既定モデルで満たす。

#### Scenario: provider 付きの指定が効く
- **GIVEN** normal の対象に `local/qwen3.8-flash` が設定されている
- **WHEN** normal フェーズのリクエストを受ける
- **THEN** `local/qwen3.8-flash` へルートする

#### Scenario: provider を省略した指定
- **GIVEN** 既定 provider が `anthropic` で、normal の対象が `claude-sonnet-4-5` である
- **WHEN** normal フェーズのリクエストを受ける
- **THEN** `anthropic/claude-sonnet-4-5` へルートする

#### Scenario: 不正な値は未設定扱い
- **GIVEN** normal の対象に空文字列または数値が設定されている
- **WHEN** normal フェーズのリクエストを受ける
- **THEN** 指定は未設定として既定モデルへルートし、通知は表示されない
- **AND** 設定ファイルは変更されない

### Requirement: ロールとステップの thinking レベルの解決
システムは、リクエストごとに thinking レベルを、現在のステップの設定、実際に応答するロールの設定、セッションの選択値の順で解決しなければならない。(SHALL) 解決したレベルを要求に載せるのは、振り分け用のモデルが選択されているセッションに限定する。(SHALL) 物理モデルが選択されているセッションでは thinking レベルを変えない。strong が使えなくて normal へ落ちた場合は normal の設定を使う。(SHALL)
解決したレベルを解決先のモデルへ丸める処理は Pi に委ね、spirits は丸めを行わない。(MUST)
設定の読み取りは strong と normal のそれぞれの指定について、設定が無い、空である、文字列でない、thinking レベルの語彙に無い場合、未設定として扱わなければならない。(SHALL) 未設定と扱った理由を振り分け時に通知してはならない。(MUST)

#### Scenario: ロールの thinking が選択値より優先される
- **GIVEN** normal の thinking レベルが high に設定され、セッションの選択値が medium であり、normal の対象は利用可能である
- **WHEN** normal フェーズでリクエストする
- **THEN** リクエストの thinking レベルは high である

#### Scenario: strong が落ちれば normal のレベル
- **GIVEN** strong の thinking レベルが max、normal の thinking レベルが low に設定され、strong の対象が解決できない
- **WHEN** strong 位相でリクエストする
- **THEN** normal の対象モデルへルートし、thinking レベルは low である

#### Scenario: どちらも未設定なら選択値
- **GIVEN** 2 つのロールの thinking レベルが未設定で、セッションの選択値が medium である
- **WHEN** normal フェーズでリクエストする
- **THEN** リクエストの thinking レベルは medium である

#### Scenario: 語彙に無い値は未設定
- **GIVEN** normal の thinking レベルに `banana` が設定されている
- **WHEN** normal フェーズでリクエストする
- **THEN** 指定は未設定としてセッションの選択値が使い、通知は表示されない

#### Scenario: 物理モデル選中は thinking レベルを変えない
- **GIVEN** normal の thinking レベルが high に設定され、セッションの選択値が medium であり、現在のモデルが物理モデルである
- **WHEN** リクエストする
- **THEN** リクエストの thinking レベルは medium のままで、high は載らない

### Requirement: ステップ設定の読み取り
システムは、ステップ名を鍵とする設定の集合から、各ステップのロールと thinking レベルを読み取らなければならない。(SHALL) どちらも省略できる。ロールはロールの語彙で、thinking レベルは thinking レベルの語彙で、大文字小文字を区別せずに解決できるときだけ使う。
型違い、空、語彙外の値、一覧に無いステップ名は未設定として扱わなければならない。(SHALL) ステップ名のキーは一覧の綴りと完全に一致するときだけ読み、大文字小文字の違うキーは一覧に無いステップ名として扱う。(SHALL) 読み取り時にその理由を通知してはならない。(MUST) 設定ファイルを書き換えてはならない。(MUST)

#### Scenario: role だけ指定されたステップ
- **GIVEN** `opsx-new` のステップ設定にロールだけがあり、thinking レベルが無い
- **WHEN** そのステップの run でリクエストする
- **THEN** ロールは設定値を使い、thinking レベルはロールの設定またはセッションの選択値から決まる

#### Scenario: 一覧に無いステップ名
- **GIVEN** 一覧に無い名前 `opsx-teleport` のステップ設定がある
- **WHEN** どのリクエストの解決でも設定を読み取る
- **THEN** その設定は無視され、通知は表示されず、振り分けは既存の規則どおりに進む

#### Scenario: 不正な値は未設定
- **GIVEN** `opsx-sync` のステップ設定のロールが真偽値である
- **WHEN** `/opsx-sync` の run でリクエストする
- **THEN** ロールはステップ既定またはロックから決まり、通知は表示されない

#### Scenario: 綴りの違うステップ名
- **GIVEN** 設定ファイルに `OpsX-Propose` というキーのステップ設定があり、`opsx-propose` のキーは無い
- **WHEN** `/opsx-propose` の run でリクエストし、続けて `/spirits-role status` を実行する
- **THEN** そのステップ設定は使われず、status には `OpsX-Propose` が一覧に無いステップ名として無視されている旨が出る

### Requirement: 再読み込みをまたぐロックと継続中のステップ
システムは、managed 経路で拡張の再読み込みが行われたとき、セッションのロックと継続中のステップを新しい実行環境へ引き継がなければならない。(SHALL) 継続しなかったステップ、およびセッションの開始(新規、復帰、分岐作成)で終わったステップを復元してはならない。(MUST)
引き継ぐのは継続中のステップ名だけでよい。そのステップのロールと thinking レベルは、再読み込みの前と同じ値を保持するのではなく、引き継ぎ後の最初のリクエストで現在の設定から解決する。(MUST)
再読み込みをまたいでも、badge と status 表示が引き継いだ位相と一致しなければならない。(SHALL) 再読み込みの後に描く badge のロールは、引き継いだステップとロックから、ステップ設定・ステップの既定ロール・ロックの順で解決したロールとする。(MUST)

#### Scenario: 設定変更の再読み込みをまたぐ
- **GIVEN** 継続するステップが走っており、そのステップの thinking レベルが設定されている
- **WHEN** `/spirits-role` での設定変更に伴う拡張の再読み込みが終わる
- **THEN** 同じステップが継続中で、次のリクエストは再読み込み前と同じロールと thinking レベルで走る

#### Scenario: ステップ設定のロールを badge に出す
- **GIVEN** normal がロックされ、`opsx-propose` のロールが strong に設定され、`opsx-propose` が継続中である
- **WHEN** 拡張の再読み込みが終わる
- **THEN** badge は `[strong]` と描かれ、次のリクエストは strong の対象モデルへルートされる

#### Scenario: 復帰では復元しない
- **GIVEN** 継続するステップが走っていたセッションが保存されている
- **WHEN** そのセッションを復帰して idle 入力でリクエストする
- **THEN** ステップは走っておらず、リクエストはロックのロールの対象へルートされる

#### Scenario: 開き直したセッションでは後の再読み込みでも復元しない
- **GIVEN** 継続する `opsx-propose` が走っている間に終了したセッションが保存されており、そのセッションの最新のステップの記録は `opsx-propose` である
- **WHEN** 新しいプロセスでそのセッションを開き(起動時の再開、復帰、分岐作成のいずれでも)、`/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** ステップは復元されず、リクエストはロックのロールの対象へルートされる

#### Scenario: 終わったステップは再読み込みで復元しない
- **GIVEN** 継続するステップが走っており、続いて `/spirits-clear` を実行してステップを終えた
- **WHEN** `/spirits-role normal thinking high` で設定を変えて拡張の再読み込みが行われ、idle 入力でリクエストする
- **THEN** ステップは復元されず、リクエストはロックのロールの対象へルートされる

#### Scenario: 再読み込み中の設定変更は継続中のステップに次から効く
- **GIVEN** 継続する `opsx-propose` が走っており、そのステップのロールが normal に設定されている
- **WHEN** 一覧で `opsx-propose` のロールを strong に変えて再読み込みが終わり、idle 入力でリクエストする
- **THEN** 同じステップが継続中で、リクエストは strong の対象モデルへルートされる

### Requirement: 分岐間の移動ではステップを移動先の記録に合わせる
システムは managed 経路で、セッションの分岐間を移動したとき、ステップを移動先の分岐の最新のステップの記録に合わせなければならない。(SHALL) 記録が一覧に載るステップ名を示すときはそのステップを継続中とし、「ステップなし」の記録、記録が無いとき、および記録が一覧に無い名前や読み取れない値のときはステップを終える。(SHALL) 別の分岐で終えたステップでも、移動先の分岐の記録で終わっていなければ継続中とする。
移動ではステップの記録を追記してはならない。(MUST) 移動先の分岐の記録がすでにその分岐の状態を表しているからである。ロックは移動で変えない。(MUST)
移動の直後と、その後の拡張の再読み込みの後で、ステップは同じでなければならない。(MUST) badge は移動の後に、再読み込みのときと同じ解決で描き直す。(SHALL)
フォーク経路はステップの記録を書かないので、分岐間の移動でステップを変えてはならない。(MUST) フォーク経路で継続中のステップは、「strong フェーズの維持と解除」の終了条件でだけ終わる。

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

#### Scenario: フォーク経路の移動ではステップが続く
- **GIVEN** フォーク経路で `/skill:openspec-propose` の run が settled し、`opsx-propose` が継続中である
- **WHEN** 分岐の移動を行い、idle 入力でリクエストする
- **THEN** `opsx-propose` は継続中のままで、リクエストは `opsx-propose` のロールの対象へルートされる
