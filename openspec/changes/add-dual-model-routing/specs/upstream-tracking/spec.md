# Spec Delta

## ADDED Requirements

### Requirement: Pi コア差分の登録簿
システムは、Pi 上流コア（`packages/spirits/` を除く `packages/` 配下）に加えた spirits 側の差分を `docs/spirits-core-diffs.md` に登録簿として保持しなければならない。(SHALL)
登録簿の各行は、コミット番号、対象ファイル、差分の意図、その差分を導入した変更アーティファクト名を含まなければならない。(SHALL)

#### Scenario: 新しいコア差分の登録
- **WHEN** Pi コアへ `[spirits]` プレフィックスのコミットを作成する
- **THEN** 登録簿にそのコミット番号、対象ファイル、意図、変更アーティファクト名が追記されている

#### Scenario: 既存のコア差分を漏らさない
- **WHEN** 登録簿と、main 上の `[spirits]` プレフィックスのコア差分コミットを突き合わせる
- **THEN** 登録簿に載っていないコア差分コミットは無い

### Requirement: 取り込み時の登録簿との突き合わせ
システムは、上流の取り込み後に登録簿と実差分を突き合わせ、登録された差分が取り込み後も残っていることを確認しなければならない。(SHALL)
確認できない差分があるとき、その差分を復元するまで取り込みを push してはならない。(MUST)
`docs/spirits-upstream-sync.md` は、コミット構成の手順として登録簿への参照を記載しなければならない。(SHALL)

#### Scenario: 取り込み後の突き合わせ
- **WHEN** 上流の merge と競合解決を完了する
- **THEN** 登録簿の各行について、対象ファイルに spirits 側の差分が残っていることを確認している

#### Scenario: 失われた差分の復元まで push しない
- **GIVEN** 取り込みで登録済みのコア差分が上流の内容に置き換わっている
- **WHEN** 突き合わせがそれを検出する
- **THEN** 差分を復元するまで origin の main へ push しない

#### Scenario: 手順文書からの参照
- **WHEN** `docs/spirits-upstream-sync.md` のコミット構成の節を確認する
- **THEN** `docs/spirits-core-diffs.md` への参照が記載されている
