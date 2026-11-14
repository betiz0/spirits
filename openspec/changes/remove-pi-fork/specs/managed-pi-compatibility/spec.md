# managed-pi-compatibility Delta

## MODIFIED Requirements

### Requirement: 隔離された互換性テスト
システムは、ホスト Pi の互換性テストを、一時 HOME、一時 agent dir、一時作業ディレクトリで実行しなければならない。(SHALL)
テストは、実 HOME、システムの `pi`、`~/.pi`、`~/.spirits/agent` などのユーザーデータを読み書きしてはならない。(MUST)
測定対象の managed root を明示指定した場合、テストはその root の読み取りだけを許可される。書き込みは一時コピーに対してのみ行う。(MUST)
テストは、管理されたホスト Pi の絶対パスを使い、PATH 上の `pi` に依存してはならない。(MUST)
テストは、固定した公式 artifact と、ホストを差し替えた受け入れ試験の実行を区別しなければならない。(SHALL)

#### Scenario: 一時環境での実行
- **WHEN** 互換性テストを実行する
- **THEN** ホスト Pi は一時 HOME と一時 agent dir を使い、実 HOME やシステムの `~/.pi` は変更されない

#### Scenario: managed root の明示指定
- **WHEN** 利用者が既存の managed root を明示指定して互換性テストを実行する
- **THEN** テストはその root を読み取るだけで、`~/.spirits/agent` などのユーザーデータを読み書きしない

## ADDED Requirements

### Requirement: ホストを差し替えた受け入れ試験
システムは、互換性ランナーにホストの記述(実行ファイル、package dir、manifest、拡張 bundle)を渡し、同じ互換性マトリクスを別のホストで実行できなければならない。(SHALL)
ホストを差し替えた実行は、固定した公式 artifact での実行と区別して記録しなければならない。(MUST)
ホストを差し替えた実行を、固定した公式 artifact での互換性確認として報告してはならない。(MUST)

#### Scenario: 別ホストでの実行
- **WHEN** 公式 artifact とは別のホストの記述を渡して互換性ランナーを実行する
- **THEN** 同じマトリクスがそのホストで実行され、結果にホストの識別情報が記録される

#### Scenario: 公式 artifact との区別
- **WHEN** ホストを差し替えた実行が完了する
- **THEN** その結果は公式 artifact での結果として報告されず、ホストの識別情報が detail に残る