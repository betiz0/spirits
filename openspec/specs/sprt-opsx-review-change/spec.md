# sprt-opsx-review-change Specification

## Purpose

OpenSpec 変更（`openspec/changes/<name>/`）を実装前にレビューし、成果物間の不整合・archive 時の spec 欠落リスク・検証不能な要求・変更が追加する継ぎ目の判断記録を洗い出し、`/opsx-apply` 開始可否を YES/NO で判定する同梱スキル。

## Requirements

### Requirement: 明示起動とモデル自動起動の両方を許可
スキルは、`/skill:sprt-opsx-review-change` で明示的に起動されたとき、またはモデルが自動選択したときに本文が読み込まれ、レビューを開始しなければならない。(SHALL)

#### Scenario: 自動選択向け一覧に現れる
- **WHEN** 同梱スキルが読み込まれた spirits のスキル一覧を確認する
- **THEN** 自動選択向けの一覧に `sprt-opsx-review-change` が含まれる

#### Scenario: 明示起動でレビューが始まる
- **WHEN** 利用者が `/skill:sprt-opsx-review-change` を実行する
- **THEN** スキルの手順が読み込み、対象 change の選定から始まる

### Requirement: 読み取り専用
スキルは、成果物・コードの作成・編集・削除をしてはならない。(MUST)
`openspec archive` / `sync` / `update` など、書き込みを伴うコマンドは実行してはならない。(MUST)
実行を許されるのは、`openspec` の読み取りコマンド（`--version` / `status` / `instructions` / `validate` / `list` / `show`）、ファイルの読み取り、検索、`git log` / `ls -l` に限られる。(MUST)

#### Scenario: 読み取り専用であること
- **WHEN** スキルがレビューを実行した後のプロジェクトの git 状態を確認する
- **THEN** レビュー対象の変更のファイル以外に、新規作成・変更・削除されたファイルが存在しない

### Requirement: 成果物間の不整合の検出
スキルは、proposal・delta specs・design・tasks の間で、capability パス・要件名・シナリオ・設計判断・タスクの対応に不整合がないかを確認しなければならない。(SHALL)
proposal の Capabilities に列挙された各 capability に `specs/<path>/spec.md` が存在すること、列挙されていない delta ファイルが存在しないことを確認しなければならない。(SHALL)

#### Scenario: 欠落した spec ファイルの検出
- **WHEN** proposal の Capabilities に列挙された capability に対応する delta spec ファイルが存在しない
- **THEN** その欠落が Blocker として報告される

### Requirement: archive 時の spec 欠落リスクの検出
スキルは、archive 時に spec が欠落・破損する記述を検出しなければならない。(SHALL)
MODIFIED の Requirement ヘッダが現行 spec と一致していること、REMOVED に Reason と Migration があること、全 Requirement が REMOVED され ADDED が無い capability に `retire_capabilities: true` があることを確認しなければならない。(SHALL)

#### Scenario: archive を失敗させる記述の検出
- **WHEN** 現行 spec の全 Requirement が REMOVED され ADDED が無い capability で `retire_capabilities` が宣言されていない
- **THEN** その点が Blocker として報告される

### Requirement: 検証不能な要求の検出
スキルは、SHALL/MUST でない規範表現、WHEN/THEN 形式でないシナリオ、「適切に」「正しく」「高速に」など検証できない語を含む記述を検出しなければならない。(SHALL)

#### Scenario: 検証不能な要求の検出
- **WHEN** delta spec のシナリオに「適切に」「正しく」など検証できない語が含まれている
- **THEN** その記述が Major として報告される

### Requirement: 継ぎ目一覧の提示
スキルは、変更が追加する継ぎ目（新しい層・interface・拡張点・外部依存・フォーク元変更）をすべて列挙し、「継ぎ目一覧」に載せなければならない。(SHALL)
各継ぎ目に対応する design の Decision があること、その Decision に代替案・対価・撤回条件があることを確認しなければならない。(SHALL)

#### Scenario: 継ぎ目一覧の提示
- **WHEN** 変更が新しい interface・外部依存・拡張点を追加する
- **THEN** それらが継ぎ目一覧に列挙され、対応する Decision の有無と内容が確認される

### Requirement: YES/NO 判定
スキルは、`/opsx-apply` 開始可否を YES/NO で判定しなければならない。(SHALL)
Blocker が 1 件以上ある場合、または `openspec validate` がエラーで終了した場合は NO としなければならない。(MUST)
Blocker ではない要判断が残っている場合、利用者が回答するまでは「判断待ち」としなければならない。(MUST)

#### Scenario: Blocker があれば NO
- **WHEN** Blocker が 1 件以上報告される
- **THEN** 実装開始判定は NO となる

#### Scenario: 問題なければ YES
- **WHEN** Blocker がなく、validate がエラーで終了しない
- **THEN** 実装開始判定は YES となる

### Requirement: レビューレポートの出力
スキルは、レビュー結果をレポートとして出力しなければならない。(SHALL)
レポートには、収集ログ、validate 結果、継ぎ目一覧、指摘（重大度・観点コード・判断区分）、利用者の判断事項、観点チェック、総評を含めなければならない。(MUST)
各指摘を「機械的」または「要判断」のいずれかに区分しなければならない。(MUST)
要判断の指摘では、レビュアーが方向を選ばず、選択肢を提示しなければならない。(MUST)

#### Scenario: レポートの出力
- **WHEN** スキルがレビューを完了する
- **THEN** 収集ログ・validate 結果・継ぎ目一覧・指摘・総評を含むレポートが出力される
