# architecture-conventions Delta

## REMOVED Requirements

### Requirement: spirits と Pi 上流の境界を強制する
**Reason**: `packages/coding-agent` / `packages/tui` がリポジトリから無くなり、境界の対象が固定ホスト公開パッケージになるため。
**Migration**: 追加する要件「spirits とホストの境界を強制する」に従う。

### Requirement: 内部 import は root の tsconfig の paths で解決し、解決できないものは失敗とする
**Reason**: root の `paths` に Pi のソースが無くなり、ホストは公開パッケージの解決で判定するため。
**Migration**: 追加する要件「内部 import は root の tsconfig と固定ホストパッケージで解決し、解決できないものは失敗とする」に従う。

### Requirement: 検査は Pi 上流コアを変更しない
**Reason**: リポジトリから Pi のソースツリーが無くなり、「上流コアを変更しない」という境界の前提が消えるため。
**Migration**: 追加する要件「検査と規約正本は spirits のルート構成に置く」に従う。

### Requirement: spirits の層は許可表に載った向きへのみ依存する
**Reason**: 許可表の依存先が、削除される `packages/tui` / `packages/coding-agent` からホスト公開パッケージに変わり、それを名前に含むシナリオを置き換えるため。
**Migration**: 追加する要件「spirits の層は許可表に載った層とホスト公開パッケージへのみ依存する」に従う。

## ADDED Requirements

### Requirement: spirits とホストの境界を強制する
システムは、`packages/spirits/src/` がホストを、公開パッケージの package root (`@earendil-works/pi-coding-agent` と `@earendil-works/pi-tui`) でのみ import することを検査しなければならない。(SHALL)
システムは、`packages/spirits/bin/` がホストを import しないことを検査しなければならない。(MUST)
システムは、`packages/spirits/src/` と `packages/spirits/bin/` の deep import(サブパスを持つ specifier)を違反として報告しなければならない。(MUST)
システムは、ホストの specifier が固定したホスト公開パッケージの `exports` で解決できないとき、違反として報告しなければならない。(MUST)

#### Scenario: src の deep import は失敗する
- **WHEN** `packages/spirits/src/` 内のファイルが `@earendil-works/pi-coding-agent/core/session` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: bin のホスト import は失敗する
- **WHEN** `packages/spirits/bin/` のファイルが `@earendil-works/pi-coding-agent` を import している
- **THEN** 検査は失敗し、起動役がホストを内包しないという境界違反として報告する

#### Scenario: bare specifier は通る
- **WHEN** `packages/spirits/src/repl/cell.ts` が `@earendil-works/pi-coding-agent` を bare specifier で import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: exports に無い subpath は失敗する
- **WHEN** `packages/spirits/src/` が公開パッケージの `exports` に無い subpath を import している
- **THEN** 検査は失敗し、その specifier を違反として報告する

### Requirement: 内部 import は root の tsconfig と固定ホストパッケージで解決し、解決できないものは失敗とする
システムは、内部 specifier(`@earendil-works/*` と相対 specifier)を、リポジトリルートの `tsconfig.json` と、固定したホスト公開パッケージの公開 export で解決しなければならない。(SHALL)
システムは、`packages/spirits/src/types/` の型ミラーを、存在しない export を隠すために使ってはならない。(MUST)
システムは、リポジトリ内のファイルにもホスト公開パッケージにも解決できない内部 specifier を、違反として報告しなければならない。(SHALL)
解決できない import を黙って取り除いてはならない。(MUST)

#### Scenario: ホストへの import は固定ホスト公開パッケージに解決される
- **WHEN** `packages/spirits/src/repl/cell.ts` が `@earendil-works/pi-coding-agent` を import している
- **THEN** その import は固定ホスト公開パッケージへの依存として扱われる

#### Scenario: 未解決の import は失敗する
- **WHEN** `./missing.ts` や `@earendil-works/pi-nonexistent` が、リポジトリ内にもホスト公開パッケージにも解決できない
- **THEN** 検査は失敗し、その import を規約 ID と場所を付けて報告する

### Requirement: 検査と規約正本は spirits のルート構成に置く
システムは、検査と規約正本を、spirits 単独のルート構成(`package.json`、`tsconfig.json`、`biome.json`、`packages/spirits/test/`、`docs/architecture/convention-registry.md`)に置かなければならない。(SHALL)
検査は `packages/spirits/` 内で、spirits 側のテストランナーによって実行されなければならない。(SHALL)

#### Scenario: spirits 側のランナーで検査が動く
- **WHEN** `packages/spirits` で `bun test test/architecture-conventions.test.ts` を実行する
- **THEN** 検査は `docs/architecture/convention-registry.md` を正本として読み、リポジトリ内に `packages/coding-agent` などの Pi のパッケージが無い状態で成功する

#### Scenario: 正本が欠けると失敗する
- **WHEN** `docs/architecture/convention-registry.md` が無い状態で同じ検査を実行する
- **THEN** 検査は通過せず、正本が見つからない旨を報告する

### Requirement: spirits の層は許可表に載った層とホスト公開パッケージへのみ依存する
システムは、spirits の各層(`repl` `shared` `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `guard` `entry` `bin`)が、規約正本の許可表に載った層へのみ import することを検査しなければならない。(SHALL)
`rlm` `harness` `todo` は互いに依存できない層として表に載せなければならない。(SHALL)
`spirits:commands` はホスト公開パッケージ `@earendil-works/pi-tui` への import を許可された層として表に載せなければならない。(SHALL) `spirits:routing` はホスト公開パッケージのうち `@earendil-works/pi-coding-agent` のみへ依存できることを表は保つ。(MUST)
エントリ層(`packages/spirits/src/index.ts`)へ import できる層は `bin` だけでなければならない。(SHALL)

#### Scenario: 許可表に載った向きは通る
- **WHEN** `packages/spirits/src/rlm/` が `packages/spirits/src/repl/` へ import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: commands から pi-tui は通る
- **WHEN** `packages/spirits/src/commands/` のファイルが `@earendil-works/pi-tui` を bare specifier で import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: routing から pi-tui は失敗する
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
