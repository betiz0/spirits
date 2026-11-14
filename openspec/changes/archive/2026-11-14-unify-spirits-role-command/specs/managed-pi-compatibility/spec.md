# Spec Delta

## MODIFIED Requirements

### Requirement: role と clear と model の互換性マトリクス
システムは、role、`/clear`、`/model` の目的ごとに、専用経路での状態を既存の状態語彙(`confirmed` / `limited` / `unavailable` / `not-run` / `failed`)以内で記録しなければならない。(SHALL) 新しい状態語を追加してはならない。(MUST)
各目的の状態は、専用 Pi 上の動作観測から判定しなければならない。(SHALL)
システムは、専用 Pi 上で spirits 専用コマンド(`/spirits-role`、`/spirits-clear`)と公式コマンドを実際に駆動して、role、`/clear`、`/model` の目的を観測しなければならない。(SHALL)
thinking レベルの目的は、専用 Pi 上の fake provider が受けた要求本文から判定しなければならない。(SHALL)
対話端末の画面操作にしかない目的（拡張の一覧、`/model` selector の保存キーなど）は RPC 経路から駆動できないため、その行は `not-run` とし、駆動できない理由と、同じ目的に使える RPC 操作があればそれを detail に残す。(MUST)
マトリクスの各行の状態は目的の観測結果から導出しなければならない。(MUST)
コマンド一覧にコマンドが掲載されていないことだけで、組み込み機能の不存在を判定してはならない。(MUST)
同じ結果の中で、行の状態と目的観測の状態を矛盾させてはならない。(MUST)

#### Scenario: role の記録
- **WHEN** 専用 Pi で skill による strong フェーズ、`/spirits-role` による role の固定、`/spirits-role <step> role` によるステップ設定、拡張の status 行の role 表示、`/spirits-role status` が出す稼働状況(ロック、現在のステップ、両ロールの解決結果)を確認する
- **THEN** それぞれの可否がマトリクスに記録され、専用コマンドや status 行という代替で満たした目的にはその旨が detail に付く

#### Scenario: thinking level の記録
- **WHEN** 専用 Pi でロールの thinking レベルを設定し、続けてリクエストして fake provider が受けた要求本文を読む
- **THEN** 要求した thinking レベルが要求に乗ったか否かがマトリクスに記録され、公式 `/thinking` との代替関係が detail に残る

#### Scenario: model の記録
- **WHEN** 専用 Pi の RPC で `set_model` によるセッションのモデル選択と `get_state` での読み戻し、`/spirits-role <role> model` によるロールの対象の既定保存と再読み込み後の読み取りを確認する
- **THEN** 各自の可否がマトリクスに記録され、ロールの対象の選択は公式 `/model` の代替ではないことが detail に残る

#### Scenario: 公式 /model の既定保存は観測できない
- **WHEN** 専用 Pi の RPC 経路から公式 `/model` の既定保存を送ろうとする
- **THEN** 既定保存は対話 TUI の selector の保存キーにしか無く RPC 命令に無いため、その行を `not-run` とし、セッションのモデル選択は `set_model` で観測できる旨を detail に残す
- **AND** 既定保存の未観測を機能の不存在として記録しない

#### Scenario: 対話端末専用 UI の観測
- **WHEN** 専用 Pi の RPC 経路から `/spirits-role` の一覧を開こうとする
- **THEN** その経路では一覧が観測できないことを理由として detail に残し、`not-run` として記録する。一覧の欠落を機能の不存在として記録しない

#### Scenario: clear の記録
- **WHEN** 専用 Pi で `/spirits-clear` による会話のクリア、同一セッション ID の維持、TODO の保持を確認する
- **THEN** それぞれの可否がマトリクスに記録され、チャット表示が消えないという差異は代替として detail に残る

#### Scenario: コマンド一覧に依存しない判定
- **WHEN** コマンド一覧にコマンドが掲載されていない
- **THEN** それだけで機能の不存在と判定せず、専用 Pi 上の動作観測で状態を記録する

#### Scenario: 行の状態は目的観測から導出する
- **WHEN** 専用 Pi での目的観測が終わった
- **THEN** 各行の状態は目的観測から導出され、観測できない目的を含む行は `not-run` として記録される

#### Scenario: 行と目的の状態の一致
- **WHEN** 結果を出力する
- **THEN** 同じ feature について行の状態と目的観測の状態が矛盾せず、コマンド一覧の不在だけを行の「利用不可」の理由としていない
