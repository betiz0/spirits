# Spec Delta

## MODIFIED Requirements

### Requirement: spirits と Pi 上流の境界を強制する
システムは、`packages/spirits/src/` が `@earendil-works/pi-*` を、サブパスを持たない bare specifier(`@earendil-works/pi-coding-agent` など)でのみ import することを検査しなければならない。(SHALL)
システムは、`packages/spirits/bin/` の deep import(サブパスを持つ specifier)を規約正本の許可リストに限定し、それ以外の deep import を違反として報告しなければならない。(SHALL)
システムは、規約正本の bin の許可リストの要素のうち、`packages/spirits/bin/` のどの import にも使われていないものがあるとき失敗しなければならない。(SHALL)
システムは、`packages/spirits/src/` の層のうち `routing` を除く全層が `packages/coding-agent` と `packages/tui` へ依存することを許可しなければならない。(SHALL) `routing` への許可は `packages/coding-agent` だけとする。(MUST) 層ごとの許可は規約正本の `registry:layers` が正であり、`ARCH-PI-BOUNDARY` の例外文はそれと食い違わないように同じ変更で更新する。(MUST)

#### Scenario: src の deep import は失敗する
- **WHEN** `packages/spirits/src/` 内のファイルが `@earendil-works/pi-coding-agent/core/session` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: bin の許可リスト外の deep import は失敗する
- **WHEN** `packages/spirits/bin/` のファイルが、許可リストに無い `@earendil-works/pi-coding-agent/core/session` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: bin の許可リストにある deep import は通る
- **WHEN** `packages/spirits/bin/spirits.ts` が `@earendil-works/pi-coding-agent/cli/setup` を import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: 使われていない bin の許可リストの要素は失敗する
- **WHEN** `packages/spirits/bin/` から `@earendil-works/pi-coding-agent/cli/setup` の import が削除され、許可リストに要素が残っている
- **THEN** 検査は失敗し、対応する import が無い要素を正本から削除するよう報告する

#### Scenario: bare specifier は通る
- **WHEN** `packages/spirits/src/repl/cell.ts` が `@earendil-works/pi-coding-agent` を bare specifier で import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: routing の packages/tui は例外文でも通らない
- **WHEN** `packages/spirits/src/routing/router.ts` が `@earendil-works/pi-tui` を import し、正本の `ARCH-PI-BOUNDARY` の例外文が全層許可のまま残っている
- **THEN** 検査はその import を違反として報告する

### Requirement: spirits の層は許可表に載った向きへのみ依存する
システムは、spirits の各層(`repl` `shared` `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `guard` `entry` `bin`)が、規約正本の許可表に載った層へのみ import することを検査しなければならない。(SHALL)
`rlm` `harness` `todo` は互いに依存できない層として表に載せなければならない。(SHALL)
`spirits:commands` は Pi の `packages/tui` への import を許可された層として表に載せなければならない。(SHALL) `spirits:routing` は `packages/coding-agent` のみへ依存できることを表は保つ。(MUST)
エントリ層(`packages/spirits/src/index.ts`)へ import できる層は `bin` だけでなければならない。(SHALL)

#### Scenario: 許可表に載った向きは通る
- **WHEN** `packages/spirits/src/rlm/` が `packages/spirits/src/repl/` へ import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: commands から packages/tui は通る
- **WHEN** `packages/spirits/src/commands/` のファイルが `@earendil-works/pi-tui` を bare specifier で import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: routing から packages/tui は失敗する
- **WHEN** `packages/spirits/src/routing/` のファイルが `@earendil-works/pi-tui` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: 兄弟層への依存は失敗する
- **WHEN** `packages/spirits/src/harness/` が `packages/spirits/src/todo/` へ import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: 兄弟層への依存は先の層が前段でも失敗する
- **WHEN** `packages/spirits/src/harness/` が `packages/spirits/src/rlm/` へ import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: エントリ経由の間接依存の入口は失敗する
- **WHEN** `packages/spirits/src/rlm/spawn.ts` が `packages/spirits/src/index.ts` を import している
- **THEN** 検査は失敗し、その import を違反として報告する
