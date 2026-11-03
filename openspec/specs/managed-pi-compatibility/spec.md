# managed-pi-compatibility Specification

## Purpose

専用 Pi の実験経路で、spirits 拡張のロードだけでなく実際の機能実行までを隔離環境で測り、確認済み・制限付き・利用不可を区別した互換性の結果を残す。

## Requirements

### Requirement: 隔離された互換性テスト
システムは、専用 Pi の互換性テストを、一時 HOME、一時 agent dir、一時作業ディレクトリで実行しなければならない。(SHALL)
テストは、実 HOME、システムの `pi`、`~/.pi`、`~/.spirits/agent` などのユーザーデータを読み書きしてはならない。(MUST)
測定対象の managed root を明示指定した場合、テストはその root の読み取りだけを許可される。書き込みは一時コピーに対してのみ行う。(MUST)
テストは、管理された専用 Pi の絶対パスを使い、PATH 上の `pi` に依存してはならない。(MUST)
テストの結果は、実行しなかった項目を成功として扱わず、未実行・失敗・成功を区別して記録しなければならない。(SHALL)

#### Scenario: 一時環境での実行
- **WHEN** 互換性テストを実行する
- **THEN** 専用 Pi は一時 HOME と一時 agent dir を使い、実 HOME やシステムの `~/.pi` は変更されない

#### Scenario: 未実行の非成功扱い
- **WHEN** 専用 Pi の artifact が取得できず、テストの一部を実行できない
- **THEN** その項目は未実行として記録され、全体は成功にならない

#### Scenario: managed root の明示指定
- **WHEN** 利用者が既存の managed root を明示指定して互換性テストを実行する
- **THEN** テストはその root を読み取るだけで、`~/.spirits/agent` などのユーザーデータを読み書きしない

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
システムは、専用 Pi 上で `tsrepl` のツール実行を実際に行い、単なるツール登録や Bun API の存在確認と区別しなければならない。(SHALL)
実セル実行のテストは、TypeScript の変換、`node:vm` での実行、値の返却を確認しなければならない。(SHALL)
失敗した場合、拡張ロードの失敗、Bun API の不在、セル実行の失敗を区別して記録しなければならない。(SHALL)

#### Scenario: 単純な値のセル
- **WHEN** 専用 Pi 上で `tsrepl` に `return 1 + 1` を実行させる
- **THEN** 結果に値 `2` が含まれ、実行は成功として記録される

#### Scenario: Bun ランタイム依存のセル
- **WHEN** 専用 Pi 上で `Bun.Transpiler` を使う TypeScript のセルと、`node:vm` を使うセルを実行する
- **THEN** どちらも実行結果を返し、ホストの Bun ランタイムで動いていることが記録される

#### Scenario: セル実行失敗の区別
- **WHEN** 拡張はロードされるが `tsrepl` のセルが失敗する
- **THEN** 結果は「拡張ロード成功・セル実行失敗」として記録され、ロード失敗とは区別される

### Requirement: rlm 子セッションの互換性
システムは、専用 Pi 上で rlm の子セッション生成を、物理モデル指定と `spirits/auto` 指定に分けて検証しなければならない。(SHALL)
物理モデルの子セッションは、生成、応答の取得、usage の記録、中断を確認しなければならない。(SHALL)
`spirits/auto` を親が選択している場合の子セッションは、成功または既知の制約として結果を記録し、成功したものとして扱わない。(MUST)

#### Scenario: 物理モデルの子セッション
- **WHEN** fake provider を使い、物理モデルを選択した親から rlm を呼ぶ
- **THEN** 子セッションが生成され、最終回答と usage が記録され、中断も効く

#### Scenario: spirits/auto の子セッション
- **WHEN** 親が `spirits/auto` を選択した状態で rlm を呼ぶ
- **THEN** 子が virtual model を解決できるかが記録され、失敗した場合は既知の制約として報告される

### Requirement: アセットと環境分離の検証
システムは、専用経路で配布する Markdown アセットが raw Markdown として書き出されることを検証しなければならない。(SHALL)
システムは、`SPIRITS_CODING_AGENT_DIR` の優先、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の sanitize、`--help` が実 HOME を作らないことを検証しなければならない。(SHALL)
システムは、API キーや proxy など必要な環境変数がテスト用の起動で削除されないことを検証しなければならない。(SHALL)

#### Scenario: 同梱スキルの書き出し
- **WHEN** 専用経路でセッションを開始し、同梱スキルを書き出す
- **THEN** 書き出された `SKILL.md` は raw Markdown であり、HTML ではない

#### Scenario: 環境変数の分離
- **WHEN** `SPIRITS_CODING_AGENT_DIR`、`PI_CODING_AGENT_DIR`、`PI_PACKAGE_DIR` を同時に設定して専用経路を起動する
- **THEN** 保存先は `SPIRITS_CODING_AGENT_DIR` になり、app 名と版は `PI_PACKAGE_DIR` の decoy に変わらない

#### Scenario: help の副作用
- **WHEN** 空の一時 HOME で `spirits managed-pi --help` を実行する
- **THEN** 実 HOME やシステムの `~/.pi` は作られず、作られる場合は一時 HOME 配下だけである

### Requirement: 既存データの読み取り互換
システムは、既存の `~/.spirits/agent` を直接変更せず、redact したコピーを使って settings、auth、sessions、外部拡張の読み取り互換を検証しなければならない。(SHALL)
検証は、同じデータを読めることと安全に書き戻せることを区別し、書き込み互換を成功として扱ってはならない。(MUST)

#### Scenario: 設定とセッションの読み取り
- **WHEN** redact した既存 agent dir のコピーで専用経路を起動する
- **THEN** 設定、認証、セッション一覧、外部拡張の読み取り結果が記録される

#### Scenario: 書き込み互換の未確認表示
- **WHEN** 専用経路で設定を保存する操作を行う
- **THEN** その結果は読み取り互換とは別の項目として記録され、未確認または制限付きと表示される

### Requirement: role と clear と model の互換性マトリクス
システムは、role、`/clear`、`/model` の目的ごとに、専用経路での状態を「利用可」「制限付き」「利用不可」のいずれかで記録しなければならない。(SHALL)
現行の既定経路で利用できる機能を、専用経路の互換性テストの結果だけを理由に削除してはならない。(MUST)
専用経路で不足する機能には、同じ目的を維持する代替案と、現行との操作・表示・内部方式の差異を記録しなければならない。(SHALL)

#### Scenario: role の記録
- **WHEN** 専用 Pi で skill による strong フェーズ、`/model` の role 指定、role バッジを確認する
- **THEN** それぞれの可否がマトリクスに記録され、利用不可の項目には代替案と差異が付く

#### Scenario: clear の記録
- **WHEN** 専用 Pi で会話のクリア、同一セッション ID の維持、TODO の保持を確認する
- **THEN** それぞれの可否がマトリクスに記録され、利用不可の項目には代替案と差異が付く

#### Scenario: model の記録
- **WHEN** 専用 Pi で thinking レベル指定、role 指定、既定値の保存を確認する
- **THEN** それぞれの可否がマトリクスに記録され、利用不可の項目には代替案と差異が付く

### Requirement: テストの通信境界
システムの互換性テストは、認証を必要としない経路とローカルの fake provider だけを使わなければならない。(MUST)
テストは実 provider の認証情報を読まず、外部の推論 API への要求や課金を発生させてはならない。(MUST)
fake provider での成功を、実 provider に対する互換性の確認として報告してはならない。(MUST)
実 provider を使うテストはこの変更の対象外とし、将来必要になった場合は別の変更で opt-in の要件として定義しなければならない。(SHALL)

#### Scenario: 認証不要のテスト
- **WHEN** CI で互換性テストを実行する
- **THEN** 実 provider の API キーや認証を使わず、RPC とローカルの fake provider の範囲で実行され、外部の推論 API を呼ばない

#### Scenario: fake provider の成功の扱い
- **WHEN** fake provider でモデルから `tsrepl` へのツール呼び出しが成功する
- **THEN** その結果は fake provider での成功として記録され、実 provider の互換性確認としては記録されない

#### Scenario: 実 provider の認証情報の非使用
- **WHEN** 実 provider を指す API キーが環境にある状態で互換性テストを実行する
- **THEN** テストはその認証情報を読まず、外部の推論 API へ要求を送らない
