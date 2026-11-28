# sprt-opsx-verify-deep Specification

## Purpose

既定の verify（verify1）とは独立した深い検証（verify2）を実装する同梱スキル。実装が spec の意図を満たすか、spec 外の変更が混ざっていないか、テストが実質的に検証しているか、規約検査が弱められていないかをコードとテストの実行結果から確かめ、archive 可否の判定を下す。

## Requirements

### Requirement: 明示起動のみでの実行
同梱スキル `sprt-opsx-verify-deep` は、frontmatter に `disable-model-invocation: true` を持ち、モデルの自動選択向けスキル一覧に現れてはならない。(MUST)
スキルは、`/skill:sprt-opsx-verify-deep` で明示的に起動されたときだけ本文が読み込まれ、検証を開始しなければならない。(SHALL)

#### Scenario: 自動選択向け一覧に現れない
- **WHEN** 同梱スキルが読み込まれた spirits のスキル一覧を確認する
- **THEN** 自動選択向けの一覧に `sprt-opsx-verify-deep` が含まれない

#### Scenario: 明示起動で検証が始まる
- **WHEN** 利用者が `/skill:sprt-opsx-verify-deep` を実行する
- **THEN** スキルの手順が読み込まれ、検証対象の変更の選定から始まる

### Requirement: 読み取り専用
スキルは、コード・テスト・成果物を一切変更してはならない。(MUST)
ファイルの作成・編集・削除、`openspec archive` / `sync` / `update` など書き込みを伴うコマンドの実行をしてはならない。(MUST)
例外は検証レポートの新規ファイルの保存だけであり、これは製品が提供する保存手段へ本文を渡して行う。(SHALL) 保存手段以外の経路でファイルを作成・変更・削除してはならず、検証対象の変更の既存ファイル（ `tasks.md` や spec を含む）も変更しない。(MUST)

#### Scenario: 読み取り専用であること
- **WHEN** スキルが検証を実行した後のプロジェクトの git 状態を確認する
- **THEN** 検証で新規に保存された検証レポートファイル以外に、新規作成・変更・削除されたファイルが存在しない

#### Scenario: 例外は保存手段を通す
- **GIVEN** 検証レポートの保存手段が有効である
- **WHEN** スキルが検証レポートを保存する
- **THEN** 保存手段へ本文を渡して保存し、ファイル書き込みツールやリダイレクトでは書き出さない

### Requirement: テストの実行と失敗の記録
スキルは、検証対象の変更のテストをすべて実行し、失敗を記録しなければならない。(SHALL)
テストの失敗は CRITICAL として報告しなければならない。(MUST)
スナップショットの更新、自動修正、失敗の許容オプションを使用してはならない。(MUST)

#### Scenario: テストの実行
- **WHEN** スキルが検証対象の変更のテストを実行する
- **THEN** テストコマンドの実行結果が記録され、成功数と失敗数が報告される

#### Scenario: テスト失敗は CRITICAL
- **WHEN** テストが失敗する
- **THEN** その失敗は CRITICAL として報告され、判定は FAIL になる

### Requirement: 要件とシナリオの意図確認
スキルは、差分 spec の各要件とシナリオについて、実装しているコードを読み、spec の期待どおりの挙動になるかを確認しなければならない。(SHALL)
コードの挙動とテストの実行結果に基づいて判断し、キーワードの一致や文件名を実装の証拠として扱ってはならない。(MUST)

#### Scenario: シナリオの挙動確認
- **WHEN** 差分 spec のシナリオに対応する実装コードを読む
- **THEN** そのシナリオの条件から結果までの実行経路がたどれ、spec の期待どおりの挙動になるかが判定される

### Requirement: spec 外の変更の検出
スキルは、差分の各変更を対応する要件・タスク・設計判断に紐づけ、紐づかない変更を列挙しなければならない。(SHALL)
挙動を変える spec 外の変更は CRITICAL として報告しなければならない。(MUST)

#### Scenario: spec 外の変更の検出
- **WHEN** 差分に要件・タスク・設計判断のいずれにも紐づかない変更が含まれている
- **THEN** その変更が列挙され、挙動を変えるものは CRITICAL として報告される

### Requirement: タスクの完了確認
スキルは、tasks のチェックボックスを数え、未完了のタスクを検出しなければならない。(SHALL)
未完了のタスク、およびチェック済みだが実装が見つからないタスクは CRITICAL として報告しなければならない。(MUST)

#### Scenario: 未完了タスクの検出
- **WHEN** tasks に未完了のチェックボックスが残っている
- **THEN** そのタスクが CRITICAL として報告される

### Requirement: 判定と archive 可否
スキルは、検証結果を FAIL / BLOCKED / PASS WITH WARNINGS / PASS のいずれかで判定しなければならない。(SHALL)
CRITICAL が 1 件以上ある場合は FAIL とし、SPEC が 1 件以上ある場合は BLOCKED としなければならない。(MUST)
archive に進めるのは PASS と PASS WITH WARNINGS のときだけである。(MUST)
スキルは、判定を下す前に、対象の変更に対して `openspec validate <change> --strict` を実行し、実行結果をレポートに記録しなければならない。(SHALL) 検証が失敗した場合は CRITICAL として報告する。(MUST)

#### Scenario: CRITICAL があれば FAIL
- **WHEN** CRITICAL が 1 件以上報告される
- **THEN** 判定は FAIL となり、archive に進めない

#### Scenario: すべて PASS
- **WHEN** CRITICAL・SPEC・WARNING がいずれも報告されない
- **THEN** 判定は PASS となり、archive に進める

#### Scenario: strict 検証が失敗する
- **WHEN** 対象の変更について `openspec validate <change> --strict` が失敗する
- **THEN** その失敗は CRITICAL として報告され、判定は FAIL となり、archive に進めない

#### Scenario: strict 検証が通る
- **WHEN** 対象の変更について `openspec validate <change> --strict` が成功し、他の指摘が無い
- **THEN** strict 検証の結果がレポートに記録され、archive に進める

### Requirement: 検証レポートの出力
スキルは、検証結果をレポートとして出力しなければならない。(SHALL)
レポートには、判定、集計（テスト・規約検査・要件・シナリオ・spec 外の変更・継ぎ目・重複・タスク）、継ぎ目一覧、指摘（CRITICAL / WARNING / SPEC / SUGGESTION）、verify1 との突き合わせ、次の手順を含めなければならない。(MUST)
すべての指摘に、具体的な場所（`file:line`）と具体的な推奨を付ければならない。(SHALL)
保存手段が有効なときは、同じ本文を保存手段へ渡さなければならず、渡していない検証は未完了である。(MUST) 保存が成功してもチャットへのレポート本文の全文出力は従来どおり維持し、加えて保存先のパスを報告する。(SHALL)

#### Scenario: レポートの出力
- **WHEN** スキルが検証を完了する
- **THEN** 判定・集計・継ぎ目一覧・指摘・次の手順を含むレポートが出力される

#### Scenario: 保存手段が有効なら本文を渡す
- **GIVEN** 検証レポートの保存手段が有効である
- **WHEN** スキルが検証を完了した
- **THEN** 出力した本文をそのまま保存手段へ渡し、レポートの全文出力に加えて保存先のパスを報告する

#### Scenario: 対象未固定で拒否されたら開き直しを案内する
- **GIVEN** 検証対象が未固定で、保存手段が有効である
- **WHEN** 保存手段が対象未固定の理由を返した
- **THEN** 別の変更へ保存せず、本文を出力したまま、変更名を付けてこのスキルを開き直すよう利用者に伝えて終わる

#### Scenario: 保存手段が無効な環境では出力で終わる
- **GIVEN** 検証レポートの保存手段が有効でない
- **WHEN** スキルが検証を完了した
- **THEN** 従来どおり本文を出力して終わり、検証を失敗として扱わない

### Requirement: 検証レポートを証拠の読み取りに含めない
スキルは、検証の前収集（未追跡ファイルの内容収集と差分収集）で、対象変更ディレクトリの検証レポートファイル（ `verify<N>.md` と `d-verify<N>.md` の系列）を内容として読み取って、実装の証拠として扱ってはならない。(MUST) verify 系列のレポートは verify との突き合わせ段階でのみ読む。

#### Scenario: 未追跡の検証レポートは証拠に入らない
- **GIVEN** 対象変更ディレクトリに未追跡の `verify1.md` がある
- **WHEN** スキルが深層検証の前収集を行う
- **THEN** `verify1.md` の内容は実装の証拠として収集・引用されない

#### Scenario: 突き合わせでは明示的に読む
- **WHEN** スキルが verify との突き合わせを行う
- **THEN** verify 系列のレポートをその段階で読み、比較結果をレポートに反映する
