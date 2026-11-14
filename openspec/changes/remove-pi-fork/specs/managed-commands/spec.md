# managed-commands Delta

## REMOVED Requirements

### Requirement: managed 限定のコマンド登録
**Reason**: role 登録 API の有無で登録を分ける経路が無くなり、ホストを問わず専用コマンドを登録するだけになるため。
**Migration**: 追加する要件「ホストを問わず登録する専用コマンド」に従う。

## MODIFIED Requirements

### Requirement: role は spirits 独自のセッション記録に保存し、fork の記録から片方向で引き継ぐ
システムは managed 経路で role を記録するとき、spirits 専用のカスタム entry に書き込まなければならない。(SHALL) ホストが所有する virtual model 用の状態 entry には、拡張から書き込んでならない。(MUST)
セッション開始時、branch に spirits 専用の role entry がある場合はそれを優先し、無い場合だけ、旧 fork ビルドが書いた virtual model 用の状態 entry の最新の role を読み込んでロックにしなければならない。(SHALL) どちらも無い場合は normal をロックする。
引き継ぎは片方向だけとする。(MUST) 読み込んだ値をホストの状態 entry に書き戻してはならない。(MUST)

#### Scenario: 専用 entry が優先される
- **WHEN** 仮想 model 用の状態 entry と spirits 専用の role entry の両方がある branch でセッションを開始する
- **THEN** spirits 専用の role entry の値がロックに使われる

#### Scenario: fork から引き継ぐ
- **WHEN** spirits 専用の role entry が無く、旧 fork ビルドが書いた仮想 model 用の状態 entry だけが存在するツリーでセッションを開始する
- **THEN** その entry の role がロックに使われ、ホストの状態 entry は追加も変更もされない

#### Scenario: どちらも無い
- **WHEN** role の記録がまったく無いセッションを開始する
- **THEN** ロックは normal になる

### Requirement: role badge は拡張の status 行に出す
システムは managed 経路で、直近のリクエストが扱った role を拡張の status 行に表示しなければならない。(SHALL) 表示は角括弧で囲んだ小文字の role 名とし、改行および端末制御文字を含む場合はそれらを取り除いて 1 行とする。取り除いた結果が空になるときは表示しない。
この表示は、ホストのモデル表示とは別の拡張 status 行であり、ホストの表示位置・表示の消去の有無を共有しないことを文書に記録しなければならない。(SHALL)
システムは、role の選択が終わったときに badge を描画し、拡張の再読み込み後に開始したセッションでもう一度描画しなければならない。(SHALL)

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
システムは、`/spirits-*` による操作がホストの操作と同じ目的を満たすが、コマンド名、表示位置、表示の消去の有無、ホストのコマンドとの統合、対話端末でしか使えない操作という点で異なることを文書に記録しなければならない。(SHALL)
モデルの選択と thinking レベルの既定保存が、ホストの `/model` と `/thinking` でも満たせることを同じ文書に記録しなければならない。(SHALL) 専用コマンドが設定するのはロールの対象であり、セッションのモデル選択ではないことを区別して記録する。(MUST)
ホストが表示する Pi の帰属表示はそのまま受け入れること、および第三者拡張が登録した provider のモデルを `rlm` の子では使えないことを、同じ文書に記録しなければならない。(SHALL)

#### Scenario: 限定向けの文書
- **WHEN** managed 経路の機能一覧を読む
- **THEN** `/spirits-*` の各目的、ホストの操作との違い、ロールの対象の選択とセッションのモデル選択の区別、ホストの `/model` と `/thinking` の代替関係、Pi の帰属表示と第三者 provider の制約が記載されている
## ADDED Requirements

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
