# managed-pi-compatibility Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
