# self-update Delta

## ADDED Requirements

### Requirement: 自己更新に伴う managed 一式の導入
自己更新は、実行ファイルの更新処理が成功した後、更新後に起動するバイナリの版が属するリリースの manifest から managed の一式（公式 Pi artifact と spirits 拡張 bundle）を取得し、manifest のチェックサムを検証して導入しなければならない。(SHALL)
すなわち置換を行った場合は解決したリリースのタグを、置換を行わなかった場合はインストール済みの版から導出したタグを使う。(SHALL)
自己更新が置換を行わなかった場合（最新、または stable より新しい）も、同じ規則で managed の一式の取得・導入をしなければならない。(SHALL)
自己更新が失敗した場合、managed の一式の取得・導入を行ってはならない。(MUST)

#### Scenario: 更新と同じリリースから導入
- **WHEN** 0.6.0 がインストール済みで最新 stable が 0.7.0 のとき `spirits update` を実行する
- **THEN** 実行ファイルは 0.7.0 に置き換わり、`spirits-v0.7.0` の manifest と bundle で managed の一式が導入される

#### Scenario: 最新時にも導入
- **WHEN** 0.7.0 がインストール済みで最新 stable が 0.7.0 のとき `spirits update` を実行する
- **THEN** 実行ファイルは置換されず、`spirits-v0.7.0` の一式が取得・導入される

#### Scenario: stable より新しい場合も同じ規則
- **WHEN** 0.8.0-rc.1 がインストール済みで最新 stable が 0.7.0 のとき `spirits update` を実行する
- **THEN** 実行ファイルは変更されず、`spirits-v0.8.0-rc.1` の一式の取得・導入を試みる

#### Scenario: 自己更新失敗時は導入しない
- **WHEN** 実行ファイルのダウンロードに失敗して自己更新が失敗する
- **THEN** managed の一式の取得・導入は行われない

### Requirement: managed 一式の導入失敗の報告
managed の一式の取得または導入が失敗した場合、自己更新は理由、修復コマンド `spirits managed-pi repair`、および `SPIRITS_ROUTE=fork` で起動する方法を表示し、自己更新全体の終了コードを非ゼロにしなければならない。(MUST)
失敗を理由に fork を既定の起動経路へ切り替えてはならない。(MUST)

#### Scenario: チェックサム不一致
- **WHEN** ダウンロードした拡張 bundle が manifest のチェックサムと一致しない
- **THEN** 終了コードは非ゼロになり、理由と `spirits managed-pi repair` と `SPIRITS_ROUTE=fork` が表示される

#### Scenario: 取得の失敗
- **WHEN** manifest の取得に失敗する
- **THEN** 終了コードは非ゼロになり、理由と修復手段が表示される

#### Scenario: 一部成功時の報告
- **WHEN** 実行ファイルの更新は成功したが managed の導入が失敗する
- **THEN** 更新された旨と導入失敗の理由の両方が表示され、終了コードは非ゼロになる

## MODIFIED Requirements

### Requirement: 自己更新のリリース解決
自己更新は、`VERSION` を指定しないインストーラと同じ規則で最新版を解決しなければならない。すなわち、Releases API が返す作成日時の新しい順の一覧(1 ページ 100 件)から、draft と prerelease を除いた `spirits-v*` タグのリリースの先頭を最新として使わなければならない。(SHALL)
自己更新は、解決したリリースのタグを、呼び出し側が managed の一式の取得元に使えるよう結果に含めなければならない。(SHALL)

#### Scenario: prerelease と pi リリースの除外
- **WHEN** `spirits-v0.3.0` より新しい prerelease の `spirits-v0.4.0-rc.1` と、pi のリリース `v1.0.0` がある環境で `spirits update` を実行する
- **THEN** `spirits-v0.3.0` の成果物が更新対象になる

#### Scenario: stable リリース未検出
- **WHEN** 通常の(draft でも prerelease でもない)`spirits-v*` リリースが存在しない状態で `spirits update` を実行する
- **THEN** 解決に失敗した旨が表示され、終了コードは非ゼロになり、実行ファイルは変更されない

#### Scenario: 解決したタグの返却
- **WHEN** 自己更新が `spirits-v0.7.0` を最新として解決する
- **THEN** 返されるタグは `spirits-v0.7.0` であり、managed の一式はこのリリースから取得される
