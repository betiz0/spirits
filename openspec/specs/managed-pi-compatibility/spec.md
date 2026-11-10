# managed-pi-compatibility Specification

## Purpose

専用 Pi の実験経路で、spirits 拡張のロードだけでなく実際の機能実行までを隔離環境で測り、確認済み・制限付き・利用不可を区別した互換性の結果を残す。

## Requirements

### Requirement: 隔離された互換性テスト
システムは、専用 Pi の互換性テストを、一時 HOME、一時 agent dir、一時作業ディレクトリで実行しなければならない。(SHALL)
テストは、実 HOME、システムの `pi`、`~/.pi`、`~/.spirits/agent` などのユーザーデータを読み書きしてはならない。(MUST)
測定対象の managed root を明示指定した場合、テストはその root の読み取りだけを許可される。書き込みは一時コピーに対してのみ行う。(MUST)
テストは、管理された専用 Pi の絶対パスを使い、PATH 上の `pi` に依存してはならない。(MUST)

#### Scenario: 一時環境での実行
- **WHEN** 互換性テストを実行する
- **THEN** 専用 Pi は一時 HOME と一時 agent dir を使い、実 HOME やシステムの `~/.pi` は変更されない

#### Scenario: managed root の明示指定
- **WHEN** 利用者が既存の managed root を明示指定して互換性テストを実行する
- **THEN** テストはその root を読み取るだけで、`~/.spirits/agent` などのユーザーデータを読み書きしない

### Requirement: 互換性テストの結果の記録
テストの結果は、実行しなかった項目を成功として扱わず、未実行・失敗・成功を区別して記録しなければならない。(SHALL)
テストは、fixture のみの実行と公式 artifact での実行を区別し、全結果に実行モードを付さなければならない。(SHALL)
fixture の Pi 実体が返した固定イベントを、製品互換性の証拠として記録してはならない。(MUST)
公式 Pi の起動前後で、既存 agent dir の fixture の内容と更新時刻が変わらないことを確認しなければならない。(SHALL)

#### Scenario: 未実行の非成功扱い
- **WHEN** 専用 Pi の artifact が取得できず、テストの一部を実行できない
- **THEN** その項目は未実行として記録され、全体は成功にならない

#### Scenario: fixture と公式 artifact の区別
- **WHEN** fixture の Pi 実体で互換性テストを実行する
- **THEN** 全結果に fixture 実行のモードが付き、その結果を公式 artifact での互換性確認として報告しない

#### Scenario: 既存 agent fixture の不変
- **WHEN** 一時 HOME の既存 agent dir に fixture を置き、その HOME で公式 Pi を起動する
- **THEN** 起動の前後で既存 agent dir の内容と更新時刻が変わらない

### Requirement: 拡張ロードの判定
システムは、拡張ロードの成否を `--help` の終了コードだけで判定してはならない。(MUST)
拡張ロードは、セッション開始後の RPC 状態またはツール一覧で、spirits 拡張が登録するツールが有効であることにより判定しなければならない。(SHALL)
`--help` では拡張ロードのエラーが stderr に出ても終了コードが 0 になり得ることを、テスト結果に明記しなければならない。(SHALL)

#### Scenario: セッション開始によるロード確認
- **WHEN** 専用 Pi を RPC モードで起動し、セッション開始後の状態を取得する
- **THEN** `tsrepl` が有効なツールとして存在し、拡張ロード成功と判定される

#### Scenario: help だけでは判定しない
- **WHEN** 壊れた拡張を指定して専用 Pi の `--help` を実行し、終了コードが 0 になる
- **THEN** その結果だけでは拡張ロード成功と判定されない

### Requirement: tsrepl の実セル実行
システムは、専用 Pi 上で `tsrepl` のツール実行を通常のモデル→ツール実行経路で実際に行い、単なるツール登録や Bun API の存在確認と区別しなければならない。(SHALL)
実セル実行のテストは、TypeScript の変換、`node:vm` での実行、値の返却を確認しなければならない。(SHALL)
失敗した場合、拡張ロードの失敗、Bun API の不在、セル実行の失敗を区別して記録しなければならない。(SHALL)
ツール本体を直接呼ぶ補助検証は、通常のツール経路とは区別して結果に明記しなければならない。(MUST)
他の拡張のツール登録を捕捉できると仮定してはならない。(MUST)

#### Scenario: 単純な値のセル
- **WHEN** 専用 Pi 上で `tsrepl` に `return 1 + 1` を実行させる
- **THEN** 結果に値 `2` が含まれ、実行は成功として記録される

#### Scenario: Bun ランタイム依存のセル
- **WHEN** 専用 Pi 上で `Bun.Transpiler` を使う TypeScript のセルと、`node:vm` を使うセルを実行する
- **THEN** どちらも実行結果を返し、ホストの Bun ランタイムで動いていることが記録される

#### Scenario: セル実行失敗の区別
- **WHEN** 拡張はロードされるが `tsrepl` のセルが失敗する
- **THEN** 結果は「拡張ロード成功・セル実行失敗」として記録され、ロード失敗とは区別される

#### Scenario: 通常ツール経路と直接呼び出しの区別
- **WHEN** モデルが `tsrepl` をツール呼び出しし、別途 probe がツール本体を直接呼ぶ
- **THEN** 前者は通常経路の結果として、後者は Pi の権限・フックを迂回する補助検証として区別して記録される

### Requirement: rlm 子セッションの互換性
システムは、専用 Pi 上で rlm の子セッション生成を、物理モデル指定と `spirits/auto` 指定に分けて検証しなければならない。(SHALL)
物理モデルの子セッションは、生成、応答の取得、usage の記録、中断を個別に確認しなければならない。(SHALL)
`spirits/auto` を親が選択している場合の子セッションは、物理モデル指定の親と分けて結果を記録し、子の要求が物理モデルとして fake provider に届き、最終回答と usage が得られたときだけ成功として記録しなければならない。(SHALL)

#### Scenario: 物理モデルの子セッション
- **WHEN** fake provider を使い、物理モデルを選択した親から rlm を呼ぶ
- **THEN** 子セッションが生成され、最終回答と usage が記録され、中断も効く

#### Scenario: spirits/auto の子セッション
- **GIVEN** 親が選択できる `spirits/auto` に対して、既定モデルの物理モデルが fixture に揃っている
- **WHEN** 親が `spirits/auto` を選択した状態で rlm を呼ぶ
- **THEN** 子の要求がその物理モデルとして fake provider に届いたこと、最終回答、usage を根拠に状態が決まり、その根拠となったリクエストが記録される。子の要求が仮想モデルのまま届いた、または fixture が揃っているのに完了しなかった場合は failed として記録される

#### Scenario: 子の生成・回答・usage・中断の個別判定
- **WHEN** 物理モデルの子セッションを検証する
- **THEN** 生成、最終回答、usage、中断がそれぞれ別項目で記録され、いずれかが欠けても他の項目の成功に影響しない

### Requirement: rlm 子セッションの結果判定
子の要求が仮想モデルのまま届いた場合、その項目を成功として記録してはならず、failed として記録しなければならない。(MUST)
子が利用する認証・モデル設定を fixture として準備し、fixture の不足を製品不具合と断定してはならない。(MUST)
ランナーが子の対象にできる物理モデル(既定 provider、既定モデル、認証、モデル定義)を fixture に書いたのに、子の対象を解決できなかった場合、または子が完了しなかった場合は、解決エラーを含めて failed として記録しなければならない。(MUST) not-run として記録してよいのは、fixture が子の対象を用意していない場合と、provider へリクエストを送らない固定イベントの host の場合に限る。(SHALL)

#### Scenario: 子の対象を解決できない spirits/auto の親
- **GIVEN** 親が `spirits/auto` を選択していて、子の対象にできる物理モデルが fixture に無い
- **WHEN** rlm を呼ぶ
- **THEN** その項目は not-run として、解決できなかった理由を記録し、成功にはならない

#### Scenario: fixture が揃っているのに子の対象を解決できない
- **GIVEN** ランナーが子の対象にできる物理モデルを fixture に書いていて、専用 Pi で親が `spirits/auto` を選択している
- **WHEN** rlm が子の対象を解決できないエラー(例: 子のモデルが無いことを名指すエラー)で終わる
- **THEN** その項目は failed として記録され、エラー文が detail に残る。not-run にはならない

#### Scenario: provider へリクエストを送らない host
- **GIVEN** 親が `spirits/auto` を選択していて、子へのリクエストもエラーも観測されない
- **WHEN** ホストが固定イベントで応答し provider へリクエストを送らない(fixture 実行)
- **THEN** 何を解決したかを読む手掛かりが無いので、その項目は not-run として記録される。専用 Pi の実行で同じ観測になった場合は、完了しなかったものとして failed として記録される

#### Scenario: fixture 不足の記録
- **WHEN** 子の認証・モデル設定の fixture が不足している
- **THEN** その項目は not-run として記録され、製品不具合とは断定されない

### Requirement: アセットと環境分離の検証
システムは、専用経路で配布する Markdown アセットが raw Markdown として書き出されることを検証しなければならない。(SHALL)
システムは、`SPIRITS_CODING_AGENT_DIR` の隔離 agent dir への固定、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の sanitize、`--help` が実 HOME を作らないことを検証しなければならない。(SHALL)
システムは、API キーや proxy など必要な環境変数がテスト用の起動で削除されないことを検証しなければならない。(SHALL)

#### Scenario: 同梱スキルの書き出し
- **WHEN** 専用経路でセッションを開始し、同梱スキルを書き出す
- **THEN** 書き出された `SKILL.md` は raw Markdown であり、HTML ではない

#### Scenario: 環境変数の分離
- **WHEN** `SPIRITS_CODING_AGENT_DIR`、`PI_CODING_AGENT_DIR`、`PI_PACKAGE_DIR` を同時に設定して専用経路を起動する
- **THEN** 保存先は固定の隔離 agent dir になり、app 名と版は `PI_PACKAGE_DIR` の decoy に変わらない

#### Scenario: help の副作用
- **WHEN** 空の一時 HOME で `spirits managed-pi --help` を実行する
- **THEN** 実 HOME やシステムの `~/.pi` は作られず、作られる場合は一時 HOME 配下だけである

### Requirement: 既存データの読み取り互換
システムは、既存の `~/.spirits/agent` を直接変更せず、redact したコピーを使って settings、auth、sessions、外部拡張の読み取り互換を検証しなければならない。(SHALL)
検証は、専用 Pi の書き込み経路が動作することと、既存 agent dir のデータへ安全に書き戻せることを区別しなければならない。(MUST)
既存 agent dir のデータへの書き戻し互換は、実証できるまで未確認のままとし、互換性成立の必須観測に含めない。(MUST)
設定・セッションの読み書きは、専用 Pi の実行時経路で行わなければならない。(MUST)
Node によるファイル読み取りや固定入力の分類を、専用 Pi の読み書きの代用としてはならない。(MUST)
専用 Pi の拡張 API から読めない項目は `not-run` として理由を記録し、Node によるファイル読み取りで代替してはならない。(MUST)

#### Scenario: 設定とセッションの読み取り
- **WHEN** redact した既存 agent dir のコピーで専用経路を起動する
- **THEN** 設定、認証、セッション一覧、外部拡張の読み取り結果が記録される

#### Scenario: 書き込み互換の未確認表示
- **WHEN** 専用経路で設定を保存する操作を行う
- **THEN** その結果は読み取り互換とは別の項目として記録され、未確認または制限付きと表示される

#### Scenario: 専用 Pi による読み書き
- **WHEN** 設定・セッションの互換性を検証する
- **THEN** 専用 Pi の実行時経路が読み書きを行い、runner の Node によるファイル読み取りや固定入力の分類が証拠として使われない

#### Scenario: API から読めない項目の非実行扱い
- **WHEN** 認証または外部拡張の読み取りが専用 Pi の拡張 API から届かない
- **THEN** その項目は `not-run` として理由を記録し、Node によるファイル読み取りで代替しない

#### Scenario: 書き込み経路と書き戻し互換の区別
- **WHEN** 専用 Pi の session、model、thinking level の書き込みが成功する
- **THEN** その結果は専用 Pi の書き込み経路の項目として記録され、既存 agent dir のデータへ書き戻せることの成立としては記録されない

### Requirement: role と clear と model の互換性マトリクス
システムは、role、`/clear`、`/model` の目的ごとに、専用経路での状態を既存の状態語彙(`confirmed` / `limited` / `unavailable` / `not-run` / `failed`)以内で記録しなければならない。(SHALL) 新しい状態語を追加してはならない。(MUST)
各目的の状態は、専用 Pi 上の動作観測から判定しなければならない。(SHALL)
システムは、専用 Pi 上で spirits 専用コマンド(`/spirits-model`、`/spirits-role`、`/spirits-clear`)を実際に駆動して、role、`/clear`、`/model` の目的を観測しなければならない。(SHALL)
マトリクスの各行の状態は目的の観測結果から導出しなければならない。(MUST)
コマンド一覧にコマンドが掲載されていないことだけで、組み込み機能の不存在を判定してはならない。(MUST)
同じ結果の中で、行の状態と目的観測の状態を矛盾させてはならない。(MUST)

#### Scenario: role の記録
- **WHEN** 専用 Pi で skill による strong フェーズ、`/spirits-role` による role の固定、拡張の status 行の role 表示を確認する
- **THEN** それぞれの可否がマトリクスに記録され、専用コマンドや status 行という代替で満たした目的にはその旨が detail に付く

#### Scenario: clear の記録
- **WHEN** 専用 Pi で `/spirits-clear` による会話のクリア、同一セッション ID の維持、TODO の保持を確認する
- **THEN** それぞれの可否がマトリクスに記録され、チャット表示が消えないという差異は代替として detail に残る

#### Scenario: model の記録
- **WHEN** 専用 Pi で `/spirits-model` による thinking レベル指定、role 指定、既定値の保存を確認する
- **THEN** それぞれの可否がマトリクスに記録され、公式の `/model` 行ではないことと保存キーの帰属が detail に残る

#### Scenario: コマンド一覧に依存しない判定
- **WHEN** コマンド一覧にコマンドが掲載されていない
- **THEN** それだけで機能の不存在と判定せず、専用 Pi 上の動作観測で状態を記録する

#### Scenario: 行の状態は目的観測から導出する
- **WHEN** 専用 Pi での目的観測が終わった
- **THEN** 各行の状態は目的観測から導出され、観測できない目的を含む行は `not-run` として記録される

#### Scenario: 行と目的の状態の一致
- **WHEN** 結果を出力する
- **THEN** 同じ feature について行の状態と目的観測の状態が矛盾せず、コマンド一覧の不在だけを行の「利用不可」の理由としていない

### Requirement: テストの通信境界
システムの互換性テストは、認証を必要としない経路とローカルの fake provider だけを使わなければならない。(MUST)
テストは実 provider の認証情報を読まず、外部の推論 API への要求や課金を発生させてはならない。(MUST)
fake provider での成功を、実 provider に対する互換性の確認として報告してはならない。(MUST)
実 provider を使うテストはこの変更の対象外とし、将来必要になった場合は別の変更で opt-in の要件として定義しなければならない。(SHALL)
fake provider は、測定対象のプロバイダが実際に使う API とストリーミング形式を再現しなければならない。(SHALL)

#### Scenario: 認証不要のテスト
- **WHEN** CI で互換性テストを実行する
- **THEN** 実 provider の API キーや認証を使わず、RPC とローカルの fake provider の範囲で実行され、外部の推論 API を呼ばない

#### Scenario: fake provider の成功の扱い
- **WHEN** fake provider でモデルから `tsrepl` へのツール呼び出しが成功する
- **THEN** その結果は fake provider での成功として記録され、実 provider の互換性確認としては記録されない

#### Scenario: 実 provider の認証情報の非使用
- **WHEN** 実 provider を指す API キーが環境にある状態で互換性テストを実行する
- **THEN** テストはその認証情報を読まず、外部の推論 API へ要求を送らない

#### Scenario: ストリーミング形式の再現
- **WHEN** fake provider がモデルのレスポンスを返す
- **THEN** 測定対象のプロバイダが実際に使う API とストリーミング形式でレスポンスを返す

### Requirement: 公式 artifact と対象 commit の bundle での実行
システムは、公式 Pi の固定成果物と、対象 commit から生成した拡張 bundle で互換性テストを実行しなければならない。(SHALL)
テストは、artifact、bundle、manifest、overlay の版と SHA256 を結果に記録しなければならない。(SHALL)
公式 artifact でない実体を使った結果を、公式 artifact での結果として報告してはならない。(MUST)
システムは、指定された拡張 bundle の SHA256 を manifest が記録する拡張 bundle の SHA256 と照合しなければならない。(MUST)
システムは、Pi を起動する直前に起動対象の実行ファイルの SHA256 を再計算し、検証済み tarball から展開した値と照合しなければならない。(MUST)

#### Scenario: 公式 artifact と対象 commit bundle での実行
- **WHEN** 公式 Pi 固定成果物と、対象 commit から生成した bundle を指定してテストする
- **THEN** それらの実体でテストが実行され、結果に実行モードが付く

#### Scenario: 識別情報の記録
- **WHEN** テストが完了する
- **THEN** artifact、bundle、manifest、overlay の版と SHA256 が結果に記録される

#### Scenario: 非公式 artifact の結果の扱い
- **WHEN** 公式 artifact でない実体でテストを実行する
- **THEN** その結果は公式 artifact での結果として報告されない

#### Scenario: bundle と実行ファイルの照合
- **WHEN** 公式モードで Pi を起動する
- **THEN** 指定した bundle の SHA256 が manifest の拡張 bundle SHA256 と一致し、起動対象の実行ファイルの SHA256 が展開時に計算した値と一致する

#### Scenario: 照合失敗時の非実行
- **WHEN** bundle または実行ファイルの SHA256 の照合が一致しない
- **THEN** Pi を起動せず、結果を書かず、理由を表示して非ゼロで終了する

### Requirement: 互換性結果の来歴と証拠
システムは、互換性テストの結果と証拠を、対象 commit、作業ツリーの変更有無、Pi 版、各成果物 SHA、項目ごとの実行コマンドと stdout/stderr、環境条件、結果 JSON に対応付けて保存しなければならない。(SHALL)
システムは、来歴にランナー側と Pi ホスト側のランタイムを区別して記録し、ホスト側は実行したランタイムを識別できる値を使う。(MUST)
システムは、来歴に必要 API の有無を記録しなければならない。(MUST)
観測できない値は `unknown` として記録し、推測で埋めてはならない。(MUST)
保存する情報に認証情報や秘密情報が含まれないことを検証しなければならない。(MUST)
人が読める要約は `--out` で指定した JSON の隣に出力し、詳細ログ・JSON の保管方法と再実行方法を文書化しなければならない。(SHALL)

#### Scenario: 来歴と証拠の対応付け
- **WHEN** テスト結果を保存する
- **THEN** 対象 commit、作業ツリーの変更有無、Pi 版、各成果物 SHA、コマンド、環境条件、結果 JSON、stdout/stderr が対応付けられる

#### Scenario: ランタイムと必要 API の記録
- **WHEN** 来歴を記録する
- **THEN** ランナー側のランタイムと Pi ホスト側のランタイムが区別され、必要 API の有無が記録され、観測できない値は `unknown` として記録される

#### Scenario: 秘密情報の非保存
- **WHEN** 結果とログを保存する
- **THEN** 認証情報や秘密情報が含まれない

#### Scenario: ホストランタイムの識別
- **WHEN** Pi ホスト側のランタイムを記録する
- **THEN** Bun で実行している場合は Bun の版のようにランタイムを識別できる値を記録し、識別できない場合だけ `unknown` とする

#### Scenario: 全項目のコマンド記録
- **WHEN** テストが完了する
- **THEN** 実行した各項目について実行コマンドと取得できた stdout/stderr が記録される

#### Scenario: 要約と詳細の分離
- **WHEN** テストが完了する
- **THEN** 人が読める要約が `--out` で指定した JSON の隣に出力され、詳細ログ・JSON の保管方法と再実行方法が文書化される

### Requirement: 結果判定の基準
システムは、個々の項目を `confirmed` / `limited` / `unavailable` / `not-run` / `failed` のいずれかで記録しなければならない。(SHALL)
システムは、「ランナーが完走した」ことと「互換性要件を満たした」ことを区別して報告しなければならない。(SHALL)
`runnerCompleted` は全項目を処理したかに、`compatibilityMet` は必須観測がすべて `confirmed` かに基づく。(MUST)
必須観測が `not-run` または `limited` の場合、失敗が 0 件であっても互換性確認の成功としては報告してはならない。(MUST)
`fixture` モードでの成功を、公式 Pi の互換性成立の根拠として扱ってはならない。(MUST)
必須観測には専用 Pi で実測できる項目だけを含め、既存 agent dir への書き戻し互換と観測できない項目は含めない。(MUST)
システムは、観測項目と期待する証拠の対応表を出力しなければならない。(SHALL)

#### Scenario: 状態の区別
- **WHEN** 個々の項目を記録する
- **THEN** `confirmed` / `limited` / `unavailable` / `not-run` / `failed` のいずれかで区別される

#### Scenario: 完走と互換性充足の区別
- **WHEN** ランナーが全項目を処理した
- **THEN** `runnerCompleted` は全項目を処理したかに基づき、`compatibilityMet` は必須観測がすべて `confirmed` かに基づく

#### Scenario: 未実行・部分成功での非成功扱い
- **WHEN** 必須観測が `not-run` または `limited` で、失敗が 0 件である
- **THEN** 互換性確認は成功として報告されない

#### Scenario: fixture モードの成功の扱い
- **WHEN** `fixture` モードで全項目が `confirmed` になる
- **THEN** その結果は公式 Pi の互換性成立としては報告されない

#### Scenario: 観測項目と証拠の対応表
- **WHEN** 結果を出力する
- **THEN** 観測項目と期待する証拠の対応表が含まれる

#### Scenario: 必須観測の範囲
- **WHEN** 必須観測の一覧を作る
- **THEN** 専用 Pi 上で実測できる項目だけを並べ、既存 agent dir への書き戻し互換と、製品側の制約で観測できない項目は含めない

### Requirement: マトリクス行の代替手段と差異の記載
各目的の定義は、専用経路でその目的を満たす仕組み(拡張による実装か代替手段か)と、現行経路との操作・表示・内部方式の差異を保持しなければならない。(SHALL) 代替手段で目的を満たした観測は、その観測の detail に代替手段を用いたことを明記しなければならない。(SHALL) 代替であることを伏せて「利用可」として報告してはならない。(MUST) 代替手段で満たした行は、行の `alternative` と `difference` の両方に、使った手段とその差異を記載しなければならない。(SHALL)
`limited` は、目的が部分的にしか成功しない、または本来の機能と利用者の目にする挙動が異なることを示し、その差異を行の `difference` に記載する。(SHALL) 観測手段の制約を `limited` の理由として使わない。(MUST NOT) 目的の成否を観測できないときは `not-run` として理由を detail に残す。(SHALL)
現行の既定経路で利用できる機能を、専用経路の互換性テストの結果だけを理由に削除してはならない。(MUST)

#### Scenario: 代替手段で満たした行
- **WHEN** 目的観測が代替手段で成功し、その子孫行が `available` または `limited` になった
- **THEN** その行は `alternative` と `difference` の両方を持ち、detail に代替手段である旨が残る

#### Scenario: ユーザーから見える差異がある行
- **WHEN** 目的は成功するが、本来の機能と利用者の目にする挙動が違う
- **THEN** 行は `limited` となり、`difference` にその挙動の差異が書かれる

#### Scenario: 観測手段の制約
- **WHEN** 目的の成否は分かるが、成否の細部を観測経路から取り出せない
- **THEN** 行を `limited` にする理由にはせず、制約のみを目的観測の detail に記録する

#### Scenario: 観測できない目的
- **WHEN** 目的を専用 Pi 上で観測できず `not-run` になった
- **THEN** その行は `alternative` と `difference` を持たなくてよく、detail に理由が残る

#### Scenario: 既定経路の機能を削除しない
- **GIVEN** 専用経路の互換性テストで目的が `not-run` になった
- **WHEN** 現行の既定経路の機能を使う
- **THEN** その機能は残り、`not-run` は削除の根拠にならない

### Requirement: 互換性マトリクスを静的な値だけで確定しない
システムは、API やコマンドの有無、および静的な表の値だけを根拠にして目的の状態を確定してはならない。(MUST)

#### Scenario: 静的な表だけからの確定
- **GIVEN** 対応する API やコマンドが一覧に存在する
- **WHEN** 専用 Pi 上でその目的の動作を観測していない
- **THEN** 目的の状態は `not-run` であり、API やコマンドの存在だけで `available` にしない

### Requirement: `/spirits-clear` の区切りに依存する挙動の観測
システムは、専用 Pi 上で `/spirits-clear` の区切りに依存する挙動を観測項目として実行し、既存の状態語彙で記録しなければならない。(SHALL) 観測項目は、区切りより後の自動 compaction、手動 compaction の肩代わりと肩代わりしない場合、fork したセッション、セッションツリーで区切りより前へ移動した場合、セッションの再開とする。(SHALL)
判定は、互換性テスト用の fake provider に届いた要求本文のマーカー、セッションに書き込まれた compaction entry の要約と肩代わりを示す印、および probe extension が記録したセッションファイルから行う。(SHALL) RPC と拡張 API のどちらからも操作できない項目は `not-run` として理由を記録し、観測のための新しい基盤を追加してはならない。(MUST NOT) 文書に記録した挙動と食い違った場合は `failed` とする。(SHALL) これらの項目は公式 artifact 実行の必須観測に含める。(SHALL)

#### Scenario: 区切りより後の自動 compaction
- **WHEN** 区切りの後に context が閾値を超え、自動 compaction が走る
- **THEN** 肩代わりした compaction entry が記録され、要約に clear 前のマーカーが含まれず、要約のためのモデル呼び出しは 0 件で、後続のリクエストは clear 前のマーカーを運ばない

#### Scenario: 消した対話が要約範囲に含まれる手動 compaction
- **WHEN** 区切りで消えた対話が残っている状態で手動 compaction を実行する
- **THEN** 肩代わりし、要約は clear 用の固定文で、要約のためのモデル呼び出しは 0 件である

#### Scenario: 消した対話が要約範囲に無い手動 compaction
- **WHEN** 区切りより後の対話だけを要約する手動 compaction を実行する
- **THEN** 肩代わりせず、Pi 自身の要約が作られ、要約のためのモデル呼び出しが発生する

#### Scenario: fork したセッション
- **WHEN** 区切りより後の message を選んで fork し、そのセッションで prompt を送る
- **THEN** 新しいセッションファイルが使われ、clear 前のマーカーは再出現しない

#### Scenario: セッションツリーで区切りより前へ移動する
- **WHEN** 区切りより前の message へ leaf を移動して prompt を送る
- **THEN** clear 前のマーカーがリクエストに復活する

#### Scenario: 再開したセッション
- **WHEN** 区切りを含むセッションを別プロセスで再開して prompt を送る
- **THEN** clear 前のマーカーはリクエストに出ない

#### Scenario: どちらの経路からも操作できない項目
- **WHEN** 項目が RPC にも拡張 API にも対応する操作を持たない
- **THEN** その項目は `not-run` で、理由が記録され、専用の足場は追加されない
