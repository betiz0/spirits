# Spec Delta

## Purpose

同梱スキル `architecture-guards` は、利用者の TypeScript リポジトリの実態からアーキテクチャ規約を導出し、利用者のテストランナーと CI で強制できる検査と規約正本を、利用者の承認を得てから生成する。

## ADDED Requirements

### Requirement: 明示起動のみでの実行
同梱スキル `architecture-guards` は、frontmatter に `disable-model-invocation: true` を持ち、モデルの自動選択向けスキル一覧に現れてはならない。(MUST)
スキルは、`/skill:architecture-guards` で明示的に起動されたときだけ本文が読み込まれ、手順を開始しなければならない。(SHALL)

#### Scenario: 自動選択向け一覧に現れない
- **WHEN** 同梱スキルが読み込まれた spirits のスキル一覧を確認する
- **THEN** 自動選択向けの一覧に `architecture-guards` が含まれない

#### Scenario: 明示起動で手順が始まる
- **WHEN** 利用者が `/skill:architecture-guards` を実行する
- **THEN** `SKILL.md` の手順が読み込まれ、スタックの検出から始まる

### Requirement: 対象プロジェクトの判定
スキルは、TypeScript のソースまたは `tsconfig.json` を持つプロジェクトでのみ手順を実行しなければならない。(SHALL)
対象外のプロジェクトでは、対象外である旨を伝え、いかなるファイルも作成・変更せずに終了しなければならない。(MUST)
対象かどうかを判断できない場合、利用者に質問し、判断がつかないまま終了する場合はいかなるファイルも作成・変更してはならない。(MUST)

#### Scenario: 対象外プロジェクトでは書き込まない
- **WHEN** TypeScript を使わないプロジェクトで `/skill:architecture-guards` を実行する
- **THEN** 対象外である旨が伝えられ、そのプロジェクトのファイルは 1 つも作成・変更されない

#### Scenario: 対象プロジェクトでは手順を開始する
- **WHEN** `tsconfig.json` を持つプロジェクトで `/skill:architecture-guards` を実行する
- **THEN** スタックの検出へ進む

#### Scenario: 対象か判断できない場合は質問して終了する
- **WHEN** プロジェクトが TypeScript を使うか判断できない状態で `/skill:architecture-guards` を実行する
- **THEN** 利用者への質問が行われ、判断がつかないまま終了する場合はファイルは 1 つも作成・変更されない

### Requirement: スタックの検出
スキルは、規約の原案を作る前に、言語、テストランナー、linter、CI、OpenSpec の有無、AGENTS.md の有無を検出しなければならない。(SHALL)
検出結果は規約原案と生成物に反映しなければならない。(SHALL)

#### Scenario: 検出結果の提示
- **WHEN** TypeScript プロジェクトでスキルを実行する
- **THEN** 検出したテストランナー、CI、OpenSpec の有無、AGENTS.md の有無が提示され、その後の原案に反映される

### Requirement: 実測からの規約導出
スキルは、実際の import 依存(型のみの import を含む)を調べ、依存方向の許可表の原案を作って利用者の確認を得なければならない。(SHALL)
スキルは、重複と継承の現状を計測し、規約原案に反映しなければならない。(SHALL)
スキルは、GoF パターン名や汎用規約(継承の制限など)を一律に持ち込んではならない。(MUST)

#### Scenario: 依存方向の許可表の原案
- **WHEN** TypeScript プロジェクトでスキルを実行する
- **THEN** 実測した import 依存から依存方向の許可表の原案が提示され、利用者の確認が求められる

#### Scenario: 型のみの import も対象にする
- **WHEN** 型のみの import があるプロジェクトでスキルを実行する
- **THEN** その import も許可表の判定対象に含まれる

#### Scenario: 重複と継承の計測
- **WHEN** TypeScript プロジェクトでスキルを実行する
- **THEN** 重複と継承の現状の計測結果が提示される

#### Scenario: 汎用規約を持ち込まない
- **WHEN** リポジトリの実測に現れない GoF パターン名や継承の制限を規約案に加えようとする
- **THEN** その規約は原案に含まれず、実測に基づく規約だけが提示される

### Requirement: 利用者のテストランナーで動く検査の生成
スキルは、利用者が確定した規約を、利用者のテストランナーで実行できる検査として生成しなければならない。(SHALL)
生成する検査は、spirits の実行環境、インストール、コマンドに依存してはならない。(MUST)

#### Scenario: 利用者のテストコマンドで実行できる
- **WHEN** 生成された検査を利用者の `package.json` の test スクリプトから実行する
- **THEN** 検査が実行され、規約違反の有無が終了コードで判定できる

#### Scenario: spirits への依存がない
- **WHEN** 生成された検査の実行に必要なものを確認する
- **THEN** spirits のバイナリや spirits 固有のコマンドを必要としない

### Requirement: OpenSpec rules への追記案
スキルは、対象プロジェクトが OpenSpec を使っている場合、`openspec/config.yaml` の rules への追記案を差分として提示しなければならない。(SHALL)
対象プロジェクトが OpenSpec を使っていない場合、`openspec/config.yaml` を作成してはならない。(MUST)

#### Scenario: OpenSpec 利用プロジェクト
- **WHEN** `openspec/config.yaml` を持つプロジェクトで規約を確定する
- **THEN** rules への追記案が差分として提示される

#### Scenario: OpenSpec 非利用プロジェクト
- **WHEN** OpenSpec を使っていないプロジェクトでスキルを実行する
- **THEN** `openspec/config.yaml` は作成されず、OpenSpec を使っていない旨が伝えられる

### Requirement: 規約正本の生成
スキルは、規約ID、強度、内容、例外、判定方法、根拠を含む規約正本を 1 か所に生成しなければならない。(SHALL)
正本は、規約の本文を重複して別のファイルへ書かない形にしなければならない。(SHALL)

#### Scenario: 正本の内容
- **WHEN** 規約が確定し正本が生成される
- **THEN** 正本の各規約に規約ID、強度、内容、例外、判定方法、根拠が含まれる

#### Scenario: 規約本文の重複がない
- **WHEN** 生成物の規約本文を確認する
- **THEN** 規約本文は正本 1 か所だけにあり、検査や設定ファイルは正本を参照する

### Requirement: 差分提示と承認後の書き込み
スキルは、生成するすべてのファイルを差分として提示し、利用者が承認するまで書き込んではならない。(MUST)

#### Scenario: 承認前は書き込まない
- **WHEN** スキルが生成物を提示した直後のプロジェクトを確認する
- **THEN** リポジトリのファイルはまだ変更されておらず、生成予定の差分が提示されている

#### Scenario: 承認後の書き込み
- **WHEN** 利用者が提示された差分を承認する
- **THEN** 提示した差分と同じ内容のファイルが書き込まれる

#### Scenario: 承認しない場合
- **WHEN** 利用者が提示された差分を承認しない
- **THEN** ファイルは書き込まれず、対象外または中止である旨が伝えられる

### Requirement: SKILL.md と references の分離
同梱スキルの `SKILL.md` は実行手順だけを含み、規約の考え方の詳細は `references/` に置かなければならない。(SHALL)

#### Scenario: 同梱物の分離
- **WHEN** 同梱スキルのファイル構成を確認する
- **THEN** `SKILL.md` には実行手順が、`references/` には規約の考え方の詳細が置かれている

### Requirement: references に置く考え方
`references/` は、統制対象が抽象化の追加と重複の蓄積の両方向であること、機械判定できる規約は CI で強制し人間のレビューは新しい継ぎ目を増やす変更に絞ること、規約本文を正本 1 か所に置くこと、導入前後で成果指標を比較することを記載しなければならない。(SHALL)

#### Scenario: 考え方の記載
- **WHEN** `references/` の内容を確認する
- **THEN** 統制対象の両方向、CI と人間レビューの分担、正本 1 か所、導入前後の成果指標比較が記載されている
