# sprt-opsx-verify-deep Delta

## MODIFIED Requirements

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
