# Spec Delta

## ADDED Requirements

### Requirement: managed 限定のコマンド登録
システムは、ホストの拡張 API に role 登録 API(`registerModelRoles`)が関数として存在しないときだけ、spirits 専用コマンド `/spirits-model`、`/spirits-role`、`/spirits-clear` を登録しなければならない。(SHALL)
role 登録 API が存在するホストでは、これらのコマンドを登録してはならない。(MUST)
role 登録 API が無いホストでも、既存の機能(`tsrepl`、TODO、harness、`spirits/auto` の振り分け、skill による strong フェーズ)は変更してはならない。(MUST)

#### Scenario: 公式 Pi では専用コマンドを使う
- **WHEN** role 登録 API の無いホストで spirits 拡張を起動し、コマンド一覧を見る
- **THEN** `/spirits-model`、`/spirits-role`、`/spirits-clear` が登録され、role 関連機能が制限される旨の既存の限定互換モードの通知も出る

#### Scenario: role API が有るホストでは登録しない
- **WHEN** role 登録 API を持つホストで同じ拡張 bundle を起動し、コマンド一覧を見る
- **THEN** `/spirits-model`、`/spirits-role`、`/spirits-clear` は登録されず、既存の `/model` と `/clear` とコアの role 表示だけが使われる

### Requirement: `/spirits-model` は 1 行でモデル、thinking レベル、role を選ぶ
システムは `/spirits-model` の引数を、末尾の語から role(`normal` / `strong`、大文字小文字を区別しない)、その直前の語が thinking レベル名(`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`、大文字小文字を区別しない)、残りをモデルの検索語として解釈しなければならない。(SHALL) role と thinking レベルを両方書くときの順序は `<検索語> <level> <role>` だけとする。
解決できた対象はその場でセッションに適用し、モデルは `provider/id` 完全一致、それが無いときは部分一致が 1 件だけの場合に限る。virtual model は対象にしない。
解決できない検索語、曖昧な語、role でも level でもない語を理由にエラーにしてはならない。その場合、モデル、thinking レベル、role、設定のいずれも変更せず、理由を利用者に伝える。(MUST)

#### Scenario: モデル、レベル、role の同時指定
- **WHEN** 利用者が `/spirits-model compat-fake/fake-model high strong` を送る
- **THEN** セッションのモデルが `compat-fake/fake-model`、thinking レベルが high、セッションの role が strong になる

#### Scenario: 解決できない語
- **WHEN** どのモデルにも一致しない語で `/spirits-model` を送る
- **THEN** モデル、thinking レベル、role、設定は変わらず、一致しなかった旨が伝えられる

#### Scenario: virtual model は対象にしない
- **WHEN** 振り分け用の virtual model を指す語で `/spirits-model` を送る
- **THEN** その virtual model をセッションのモデルとして適用せず、対象にできない旨を伝える

### Requirement: `/spirits-model` と `/spirits-role` は選んだ値を既定として保存する
システムは `/spirits-model` でモデルを適用したとき、そのモデルの provider と id を既定モデルの保存キーに、level を指定されたときは thinking レベルの既定保存キーに保存しなければならない。(SHALL)
role を指定されたとき、および `/spirits-role` で role をロックしたときは、spirits の既定 role の保存キーに保存しなければならない。(SHALL)
保存した値は、専用の Pi が設定を再読み込みした後の新しいセッションで読める状態にしなければならない。(SHALL) 設定の書き込みと再読み込みのあいだに利用した、コマンド由来の API ハンドルを再読み込み後のに使ってはならない。(MUST)

#### Scenario: 保存された既定値が次のセッションで効く
- **WHEN** `/spirits-model compat-fake/fake-model high` を実行して再読み込みが行われた後、新しいセッションを開始する
- **THEN** 既定モデルのキーは `compat-fake` と `fake-model`、既定 thinking レベルのキーは high として保存されており、設定の再読み込み後の読み取りがその値を返す

#### Scenario: 再読み込み後のに古いハンドルを使わない
- **WHEN** 設定を書いたコマンドが設定の再読み込みを待つ
- **THEN** 再読み込みの後にそのコマンドの API ハンドルやコンテキストを使わず、再読み込みが打ち上げた開始イベントで反映を確認する

### Requirement: `/spirits-role` はモデルを変えずに role をロックする
システムは `/spirits-role normal` と `/spirits-role strong` で、セッションのモデルと thinking レベルを変えずに role をロックし、その role をセッションの記録と既定保存キーに残さなければならない。(SHALL)
引数が無いとき、または role として解釈できない語のときは、値を変更してはならない。その場合、現在の role を利用者に伝える。(MUST)

#### Scenario: 現在のモデルのまま strong にする
- **WHEN** `compat-fake/fake-model` を選ぶセッションで `/spirits-role strong` を実行する
- **THEN** モデルと thinking レベルは変わらず、以後のリクエストは strong の対象になり、既定 role の保存キーが strong になる

#### Scenario: 引数なしは表示だけ
- **WHEN** `/spirits-role` を引数なしで実行する
- **THEN** role、モデル、設定は変わらず、現在の role が表示される

### Requirement: 設定の書き込みは Pi と同じロック手順で行う
システムは、spirits の設定キーと Pi の既定値を Pi の global settings ファイルに書き込まなければならない。(SHALL) project 単位の設定ファイルには書き込まない。(MUST)
書き込みは、Pi の設定保存と同じ手続きに従わなければならない。(MUST) すなわち、同じパスに対してファイルロックを `realpath` を使わずに取得し、ロック取得が競合した場合は再試行し、ロック下で現在のファイルを読み、変更したフィールドだけをディスクの現在値にマージし、書き込み、ロックを解放する。マージされていないフィールドと、Pi が知らないキーは保持しなければならない。(MUST)
Pi の設定保存と交互に書き込んだ結果、どちらの側の変更も失われず、ファイルは解析できる状態でなければならない。(MUST)
別プロセスから同時に書き込んでも、ファイルは解析できる状態でなければならない。(MUST)

#### Scenario: Pi の書き込みと交互に書く
- **WHEN** Pi が既定 thinking レベルを保存した直後に、spirits が既定 role だけを書き込む
- **THEN** ファイルには Pi が保存した thinking レベルと、spirits が書いた role と、Pi が知らない spirits 独自キーが同時に残る

#### Scenario: 別プロセスとの同時書き込み
- **WHEN** Pi の設定保存を呼ぶ別プロセスと同じ settings ファイルに対して同時に書き込む
- **THEN** 内容は解析できる形で残り、両側が書いたキーが失われない。ロックの残骸も残らない

### Requirement: role は spirits 独自のセッション記録に保存し、fork の記録から片方向で引き継ぐ
システムは managed 経路で role を記録するとき、spirits 専用のカスタム entry に書き込まなければならない。(SHALL) 公式コアが所有する virtual model 用の状態 entry には、拡張から書き込んでならない。(MUST)
セッション開始時、branch に spirits 専用の role entry がある場合はそれを優先し、無い場合だけ、fork 経路が書いた virtual model 用の状態 entry の最新の role を読み込んでロックにしなければならない。(SHALL) どちらも無い場合は normal をロックする。
引き継ぎは片方向だけとする。(MUST) 読み込んだ値を公式コアの状態 entry に書き戻してはならない。(MUST)

#### Scenario: 専用 entry が優先される
- **WHEN** 仮想 model 用の状態 entry と spirits 専用の role entry の両方がある branch でセッションを開始する
- **THEN** spirits 専用の role entry の値がロックに使われる

#### Scenario: fork から引き継ぐ
- **WHEN** spirits 専用の role entry が無く、fork 経路が書いた仮想 model 用の状態 entry だけが存在するツリーでセッションを開始する
- **THEN** その entry の role がロックに使い、公式コアの状態 entry は追加も変更もされない

#### Scenario: どちらも無い
- **WHEN** role の記録がまったく無いセッションを開始する
- **THEN** ロックは normal になる

### Requirement: role badge は拡張の status 行に出す
システムは managed 経路で、直近のリクエストが扱った role を拡張の status 行に表示しなければならない。(SHALL) 表示は角括弧で囲んだ小文字の role 名とし、改行および端末制御文字を含む場合はそれらを取り除いて 1 行とする。取り除いた結果が空になるときは表示しない。
この表示は、フォーク経路のモデル名隣のバッジと同じ場所・同じ仕組みではないことを文書に記録しなければならない。(SHALL)

#### Scenario: 制御文字を含む role は描画しない
- **WHEN** 記録された role が制御文字だけからなる
- **THEN** status 行には何も出ず、端末の表示状態は変わらない

#### Scenario: strong で走ったあとは strong を出す
- **WHEN** strong の対象でリクエストを処理した
- **THEN** 拡張の status 行に strong を示すバッジが出る

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
システムは、`/spirits-clear` の区切りより前の entry が compaction の要約範囲に含まれる場合、その compaction を拡張が肩代わりし、クリア済みの会話の内容を含まない固定の注記を要約として書き込まなければならない。(SHALL) 肩代わりの保持開始位置は区切りそのものとする。
要約範囲がすべて区切りより後である場合は、素通しして既定の要約を妨げてはならない。(MUST)
自動 compaction の後、クリア済みの会話は LLM 要求に現れてはならない。(MUST)
区切り直後は区切りより前の entry がコンテキスト使用量の推算に残ること、およびそれが自動 compaction の閾値に影響することを文書に記録しなければならない。(SHALL)

#### Scenario: 自動 compaction の後も消えたまま
- **WHEN** `/spirits-clear` の後に会話が積み上がり、自動 compaction が発火する
- **THEN** 以降の LLM 要求にクリア済みの会話は現れず、compaction の要約にはクリア済みの内容が含まれない

#### Scenario: 区切りより後の要約は邪魔しない
- **WHEN** 区切りより後の会話だけが要約範囲に含まれる compaction が発火する
- **THEN** 拡張は素通しし、既定の要約が書かれる

### Requirement: 専用コマンドの表面の違いを文書に残す
システムは、`/spirits-*` による操作が既定経路と同じ目的を満たすが、コマンド名、表示位置、表示の消去の有無、公式コマンドとの統合という点で異なることを文書に記録しなければならない。(SHALL)
公式バイナリが表示する Pi の帰属表示はそのまま受け入れること、および第三者拡張が登録した provider のモデルを `rlm` の子では使えないことを、同じ文書に記録しなければならない。(SHALL)

#### Scenario: 限定向けの文書
- **WHEN** managed 経路の機能一覧を読む
- **THEN** `/spirits-*` の各目的、既定経路との違い、Pi の帰属表示と第三者 provider の制約が記載されている
