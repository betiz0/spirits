# Spec Delta

## MODIFIED Requirements

### Requirement: 明示起動のみでの実行
同梱スキル `sprt-architecture-guards` は、frontmatter に `disable-model-invocation: true` を持ち、モデルの自動選択向けスキル一覧に現れてはならない。(MUST)
スキルは、`/skill:sprt-architecture-guards` で明示的に起動されたときだけ本文が読み込まれ、手順を開始しなければならない。(SHALL)

#### Scenario: 自動選択向け一覧に現れない
- **WHEN** 同梱スキルが読み込まれた spirits のスキル一覧を確認する
- **THEN** 自動選択向けの一覧に `sprt-architecture-guards` が含まれない

#### Scenario: 明示起動で手順が始まる
- **WHEN** 利用者が `/skill:sprt-architecture-guards` を実行する
- **THEN** `SKILL.md` の手順が読み込まれ、スタックの検出から始まる

### Requirement: 対象プロジェクトの判定
スキルは、TypeScript のソースまたは `tsconfig.json` を持つプロジェクトでのみ手順を実行しなければならない。(SHALL)
対象外のプロジェクトでは、対象外である旨を伝え、いかなるファイルも作成・変更せずに終了しなければならない。(MUST)
対象かどうかを判断できない場合、利用者に質問し、判断がつかないまま終了する場合はいかなるファイルも作成・変更してはならない。(MUST)

#### Scenario: 対象外プロジェクトでは書き込まない
- **WHEN** TypeScript を使わないプロジェクトで `/skill:sprt-architecture-guards` を実行する
- **THEN** 対象外である旨が伝えられ、そのプロジェクトのファイルは 1 つも作成・変更されない

#### Scenario: 対象プロジェクトでは手順を開始する
- **WHEN** `tsconfig.json` を持つプロジェクトで `/skill:sprt-architecture-guards` を実行する
- **THEN** スタックの検出へ進む

#### Scenario: 対象か判断できない場合は質問して終了する
- **WHEN** プロジェクトが TypeScript を使うか判断できない状態で `/skill:sprt-architecture-guards` を実行する
- **THEN** 利用者への質問が行われ、判断がつかないまま終了する場合はファイルは 1 つも作成・変更されない
