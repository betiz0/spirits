# Spec Delta

## MODIFIED Requirements

### Requirement: 利用者スキルの優先
利用者の `<agentDir>/skills/<スキル名>/SKILL.md` が同梱スキルと同名で存在する場合、システムは同梱版をその名前の有効なスキルとして採用させてはならない。(MUST)

#### Scenario: 同名の利用者スキルによる上書き
- **WHEN** `<agentDir>/skills/sprt-architecture-guards/SKILL.md` を置いた状態で spirits を起動する
- **THEN** スキル一覧の `sprt-architecture-guards` の場所は利用者の `SKILL.md` を指し、同梱版のパスを指さない
