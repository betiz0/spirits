# Spec Delta

## Purpose

リポジトリの層間依存方向、spirits の層構造、spirits と Pi 上流の境界、値の依存グラフの非循環、および重複の増加を、規約正本と検査によって強制する。

## ADDED Requirements

### Requirement: 層間依存の許可向きのみを受け付ける
システムは、リポジトリの層間の import(型のみの import を含む)が、規約正本の許可表と各公開パッケージの `package.json` から決まる許可の向きだけであることを検査しなければならない。(SHALL)
走査対象は、リポジトリルートの `tsconfig.json` と `packages/spirits/tsconfig.json` が対象に含めるファイルのうち、`.d.ts` と `.json` を除いたものとする。(SHALL)
層の判定は src(走査対象のうち dev ファイル以外。dev ファイルの定義は「src は dev ファイルを import しない」による)を起点とする import だけを対象にし、dev ファイルを起点とする import は判定対象にしない。(SHALL)
層間でない import(同一層内の import)は判定対象にしない。(SHALL)
外部パッケージ(`node:` `bun:` と、`@earendil-works/*` でも相対でもない specifier)の import は判定対象にしない。(SHALL)

#### Scenario: 許可された向きの import は通る
- **WHEN** `packages/spirits/src/rlm/` のファイルが `packages/spirits/src/repl/` のファイルを import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: 許可されていない向きの import は失敗する
- **WHEN** `packages/spirits/src/repl/` のファイルが `packages/spirits/src/harness/` のファイルを import している
- **THEN** 検査は失敗し、失敗メッセージに規約 ID と import 元・先のパスを含める

#### Scenario: 型のみの import も判定に含める
- **WHEN** `import type` で、許可表に載っていない向きの層を import している
- **THEN** 検査は失敗し、その import が型の依存であることを区別して報告する

#### Scenario: 外部パッケージの import は判定しない
- **WHEN** ファイルが `node:fs` や `typebox` を import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: dev ファイルを起点とする import は層を判定しない
- **WHEN** `packages/coding-agent/test/` のファイルが、`packages/coding-agent/package.json` の `dependencies` `optionalDependencies` `peerDependencies` に宣言のない workspace パッケージを import している
- **THEN** 検査はその import を層の違反として報告しない

### Requirement: 走査対象外の解決先も層と dev の判定を受ける
システムは、src を起点とする import の解決先が走査対象に含まれないファイル(`.json` や tsconfig の範囲外のファイル)であっても、解決先に対して層と dev ファイルの判定を行わなければならない。(SHALL)

#### Scenario: 走査対象外のファイルへの import も判定する
- **WHEN** `packages/spirits/src/repl/cell.ts` が `../harness/data.json` を import している、または `packages/spirits/src/` のファイルが tsconfig の範囲外の `packages/spirits/test/fixtures/` のファイルを import している
- **THEN** 検査は解決先に対して層の許可と dev ファイルの判定を行い、前者は `ARCH-REPL` など層の規約 ID、後者は `ARCH-SRC-DEV` で報告する

### Requirement: import を値の依存と型の依存に分類する
システムは、型位置の `import("x")`、`import type`、`export type … from` を型の依存として分類しなければならない。(SHALL)
システムは、それ以外の import を値の依存として分類しなければならない。これには、全指定子が inline の `type` である import、`export … from`、引数が文字列リテラルまたは置換のないテンプレートリテラルの動的 `import()` を含む。(SHALL)
引数が文字列リテラルでも置換のないテンプレートリテラルでもない動的 `import()` は、依存の辺にしてはならない。(MUST)
同じ import 元と同じ指定子に対して値の辺と型の辺が両方ある場合、システムは値の辺を失ってはならない。(MUST)

#### Scenario: 全指定子が inline の type である import は値の依存になる
- **WHEN** `import { type A, type B } from "./x.ts"` がある
- **THEN** その import は値の依存として記録され、循環の検査の対象になる

#### Scenario: 文字列リテラルの動的 import は値の依存になる
- **WHEN** `await import("./x.lazy.ts")` がある
- **THEN** その import は値の依存として記録され、層の許可表で照合される

#### Scenario: 置換のないテンプレートの動的 import は値の依存になる
- **WHEN** `` await import(`./x.lazy.ts`) `` がある
- **THEN** その import は値の依存として記録され、層の許可表で照合される

#### Scenario: 非リテラルの動的 import は辺にならない
- **WHEN** `await import(path)` の引数が変数である
- **THEN** 検査はその import を依存の辺として扱わず、違反として報告しない

#### Scenario: 型の import と値の import が同じ指定子にあるとき値の辺は残る
- **WHEN** `a.ts` が `import { value } from "./b.ts"` と `import type { T } from "./b.ts"` の両方を持ち、`b.ts` が `a.ts` を値として import している
- **THEN** `a.ts` から `b.ts` への値の辺は残り、値の循環として検査される

### Requirement: 公開パッケージの許可向きは package.json から導出する
システムは、公開パッケージ(`private` でないパッケージ)の許可向きを手書きの表にせず、そのパッケージの `package.json` の `dependencies` `optionalDependencies` `peerDependencies` に宣言された workspace 依存から検査時に導出しなければならない。(SHALL)
`package.json` の依存追加は、正本を編集することなく新しい向きを許可しなければならない。(SHALL)
正本の `registry:layers` は、公開パッケージ(`private` でないパッケージ)の層を許可表のキーに持ってはならない。(MUST)
公開パッケージの `package.json` が private なワークスペースパッケージを `dependencies` `optionalDependencies` `peerDependencies` に宣言しても、その向きを許可してはならない。(MUST)

#### Scenario: 依存追加が新しい向きを自動的に許可する
- **WHEN** 公開パッケージ A の `package.json` の `dependencies` に workspace パッケージ B が追加され、A の src が B を import している
- **THEN** A から B への import は、正本の編集なしに通る

#### Scenario: 未宣言の向きは失敗する
- **WHEN** 公開パッケージ A の `package.json` に宣言のない workspace パッケージ B を、A の src が import している
- **THEN** 検査は失敗し、その import を A から B への違反として報告する

#### Scenario: 公開パッケージが private パッケージを宣言しても許可されない
- **WHEN** 公開パッケージ `packages/app` の `package.json` の `dependencies` に、`private: true` の workspace パッケージ `packages/spirits` が宣言されており、`packages/app/src/` が `packages/spirits` を import している
- **THEN** 検査は失敗し、その import を `packages/app` から `packages/spirits` への違反として報告する

#### Scenario: 正本で公開パッケージの許可向きを書くと失敗する
- **WHEN** 規約正本の `registry:layers` に公開パッケージ `packages/app` のキーがあり、許可する層が並んでいる
- **THEN** 検査は失敗し、公開パッケージの許可は `package.json` から導出するよう報告する

### Requirement: ビルド対象外のディレクトリを例外層とする
システムは、公開パッケージの `tsconfig.build.json` の `exclude` の要素のうち、`src/` 配下を指し、glob を含まず、実在するディレクトリだけを、そのパッケージの例外層としなければならない。(SHALL)
例外層は、そのパッケージの `package.json` から導出した向き、同じパッケージの例外層以外の部分、および規約正本の許可表に載った向きへ依存できなければならない。(SHALL)
例外層以外の部分は、規約正本の例外層の許可を受けてはならない。(MUST)

#### Scenario: 例外層は正本に載った未宣言パッケージを import できる
- **WHEN** `packages/coding-agent/src/experimental/` のファイルが、`packages/coding-agent/package.json` に宣言が無く、正本の例外層の許可表に載っている `@earendil-works/pi-server` を import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: 例外層以外から未宣言パッケージを import すると失敗する
- **WHEN** `packages/coding-agent/src/core/` のファイルが `@earendil-works/pi-server` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: 例外層は同じパッケージの通常部分を import できる
- **WHEN** `packages/coding-agent/src/experimental/` のファイルが `packages/coding-agent/src/core/` のファイルを import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: ディレクトリでない exclude の要素は例外層にならない
- **WHEN** `tsconfig.build.json` の `exclude` が `node_modules`、`dist`、`src/**/*.d.ts` を含む
- **THEN** これらは例外層にならず、そのパッケージの src は通常の層として判定される

### Requirement: repl は後段の層へ依存しない
システムは、`packages/spirits/src/repl/` が `rlm/` `harness/` `todo/` `update/` とエントリ(`packages/spirits/src/index.ts`)を import すること(型のみの import と動的 import を含む)を検出して失敗しなければならない。(SHALL)

#### Scenario: repl が後段を import すると失敗する
- **WHEN** `packages/spirits/src/repl/cell.ts` が `packages/spirits/src/harness/memory.ts` を import している
- **THEN** 検査は失敗し、規約 ID と import 元・先のパスを報告する

#### Scenario: repl が動的 import で後段を参照すると失敗する
- **WHEN** `packages/spirits/src/repl/` のファイルが `await import("../harness/memory.ts")` を持つ
- **THEN** 検査は失敗し、規約 ID と import 元・先のパスを報告する

#### Scenario: repl 内で完結する変更は通る
- **WHEN** `packages/spirits/src/repl/` のファイルが `packages/spirits/src/repl/` 内のファイルと `@earendil-works/pi-coding-agent` だけを import している
- **THEN** 検査はその変更を違反として報告しない

### Requirement: spirits の層は許可表に載った向きへのみ依存する
システムは、spirits の各層(`repl` `shared` `rlm` `harness` `todo` `update` `entry` `bin`)が、規約正本の許可表に載った層へのみ import することを検査しなければならない。(SHALL)
`rlm` `harness` `todo` は互いに依存できない層として表に載せなければならない。(SHALL)
エントリ層(`packages/spirits/src/index.ts`)へ import できる層は `bin` だけでなければならない。(SHALL)

#### Scenario: 許可表に載った向きは通る
- **WHEN** `packages/spirits/src/rlm/` が `packages/spirits/src/repl/` へ import している
- **THEN** 検査はその import を違反として報告しない

#### Scenario: 兄弟層への依存は失敗する
- **WHEN** `packages/spirits/src/harness/` が `packages/spirits/src/todo/` へ import している
- **THEN** 検査はその import を違反として報告する

#### Scenario: 兄弟層への依存は先の層が前段でも失敗する
- **WHEN** `packages/spirits/src/harness/` が `packages/spirits/src/rlm/` へ import している
- **THEN** 検査はその import を違反として報告する

#### Scenario: エントリ経由の間接依存の入口は失敗する
- **WHEN** `packages/spirits/src/rlm/spawn.ts` が `packages/spirits/src/index.ts` を import している
- **THEN** 検査はその import を違反として報告する

### Requirement: どの層にも属さない src のファイルは失敗する
システムは、spirits の層と private パッケージの層への所属を、規約正本に登録されたパスだけで決めなければならない。(SHALL)
システムは、src のファイルのうち、公開パッケージ、例外層、規約正本に登録された層のいずれにも属さないものを、未知の層として報告して失敗しなければならない。(SHALL)
システムは、未登録のファイルを既存の層(`spirits:shared` など)に割り当ててはならない。(MUST)

#### Scenario: spirits の未登録ディレクトリは失敗する
- **WHEN** `packages/spirits/src/` に、規約正本に登録されていないディレクトリ `foo/` が追加され、その中に `.ts` ファイルがある
- **THEN** 検査は失敗し、そのファイルを未知の層として規約 ID とパスを付けて報告する

#### Scenario: 正本に無い private パッケージは失敗する
- **WHEN** `package.json` に `"private": true` を持つパッケージ `packages/newpkg/` が追加され、規約正本にその層が登録されていない
- **THEN** 検査は失敗し、そのパッケージの src のファイルを未知の層として報告する

#### Scenario: 登録済みのパスに属するファイルは通る
- **WHEN** `packages/spirits/src/config.ts` が規約正本で `spirits:shared` に登録されている
- **THEN** 検査はそのファイルを未知の層として報告しない

### Requirement: spirits と Pi 上流の境界を強制する
システムは、`packages/spirits/src/` が `@earendil-works/pi-*` を、サブパスを持たない bare specifier(`@earendil-works/pi-coding-agent` など)でのみ import することを検査しなければならない。(SHALL)
システムは、`packages/spirits/bin/` の deep import(サブパスを持つ specifier)を規約正本の許可リストに限定し、それ以外の deep import を違反として報告しなければならない。(SHALL)
システムは、規約正本の bin の許可リストの要素のうち、`packages/spirits/bin/` のどの import にも使われていないものがあるとき失敗しなければならない。(SHALL)
システムは、`packages/spirits/src/` の全層が `packages/coding-agent` と `packages/tui` へ依存することを許可しなければならない。(SHALL)

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

### Requirement: src は dev ファイルを import しない
システムは、src(走査対象のうち dev ファイル以外)が dev ファイルを import すること(型のみの import を含む)を検出して失敗しなければならない。(SHALL)
dev ファイルとは、`packages/*/test/` と `packages/*/examples/` 配下、`packages/*/*.config.ts`、`packages/ai/scripts/` 配下、リポジトリルートの `scripts/` 配下とルート直下のファイルをいう。(SHALL)
dev ファイルから src への import は判定対象にしない。(SHALL)
dev 判定と層判定は走査対象とその解決先だけを対象とする。`packages/` 配下以外では root の `scripts/` とルート直下のファイルのみ dev であり、それ以外のパス(`docs/` など)は走査対象にならないため判定しない。(SHALL)

#### Scenario: src から dev ファイルへの値の import は失敗する
- **WHEN** `packages/spirits/src/` のファイルが `packages/spirits/test/support.ts` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: src から dev ファイルへの型のみの import も失敗する
- **WHEN** `packages/spirits/src/` のファイルが `import type` で `packages/spirits/test/support.ts` を import している
- **THEN** 検査は失敗し、その import を違反として報告する

#### Scenario: dev ファイルから src への import は判定しない
- **WHEN** `packages/spirits/test/` のファイルが `packages/spirits/src/` のファイルを import している
- **THEN** 検査はその import を違反として報告しない

### Requirement: 内部 import は root の tsconfig の paths で解決し、解決できないものは失敗とする
システムは、内部 specifier(`@earendil-works/*` と相対 specifier)を、リポジトリルートの `tsconfig.json` の `paths` だけで解決しなければならない。(SHALL)
システムは、`packages/spirits/tsconfig.json` の `paths`(型検査用のスタブ)で解決してはならない。(MUST)
システムは、リポジトリ内のファイルに解決できない内部 specifier を、違反として報告しなければならない。(SHALL)
解決できない import を黙って取り除いてはならない。(MUST)

#### Scenario: spirits の Pi への import は上流パッケージに解決される
- **WHEN** `packages/spirits/src/repl/cell.ts` が `@earendil-works/pi-coding-agent` を import している
- **THEN** その import は `packages/coding-agent` への依存として扱われ、`packages/spirits/src/types/` のスタブには解決されない

#### Scenario: 未解決の import は失敗する
- **WHEN** `./missing.ts` や `@earendil-works/pi-nonexistent` が、リポジトリ内のどのファイルにも解決できない
- **THEN** 検査は失敗し、その import を規約 ID と場所を付けて報告する

### Requirement: 値の依存グラフの循環を禁止する
システムは、層の値依存グラフ(src を起点とする値の辺から作る)が非循環であることを検査しなければならない。(SHALL)
システムは、ファイル単位の値依存グラフ(走査対象の全ファイルの値の辺から作る)の強連結成分(互いに到達できるファイルの集合のうち、2 ファイル以上のもの、または自己 import を持つもの)を循環とし、規約正本の許可リストの要素とファイル集合が完全に一致する循環だけを通さなければならない。(SHALL)
システムは、許可リストの要素のうち、対応する循環が存在しないものがあるとき失敗しなければならない。(SHALL)

#### Scenario: 新規の循環は失敗する
- **WHEN** ファイル `a.ts` と `b.ts` が互いを値として import し、そのファイル集合が許可リストに無い
- **THEN** 検査は失敗し、その循環のファイル集合を報告する

#### Scenario: 許可リストにある循環は通る
- **WHEN** 値の依存の循環のファイル集合が、規約正本の許可リストの 1 要素と完全に一致する
- **THEN** 検査はその循環を違反として報告しない

#### Scenario: 許可済みの循環にファイルが加わると失敗する
- **WHEN** 許可リストの `{A, B, C}` の循環に、`D` が加わって `{A, B, C, D}` の循環になった
- **THEN** 検査は失敗し、許可リストに無い循環として `{A, B, C, D}` を報告する

#### Scenario: 解消された循環が許可リストに残っていると失敗する
- **WHEN** 許可リストの `{A, B, C}` の循環が解消され、許可リストの要素が残っている
- **THEN** 検査は失敗し、対応する循環が無い要素を正本から削除するよう報告する

#### Scenario: 層の循環は失敗する
- **WHEN** 層 X が層 Y を、層 Y が層 X を、それぞれ値として import している
- **THEN** 検査は失敗し、層の閉路を報告する

### Requirement: 重複の増加を ratchet する
システムは、src の関数宣言・メソッド・アロー関数・関数式の本体と、変数宣言の初期化子のうち、空白の連続を 1 つの空白にして前後を除いた本文が 60 文字以上で、元の記述が 10 行以上のものを集め、本文が一致するものが 2 件以上ある群の件数を数えなければならない。(SHALL)
システムは、その件数が規約正本の基数と一致しないとき失敗しなければならない。(SHALL)
dev ファイルは数えてはならない。(MUST)

#### Scenario: 基数を超えると失敗する
- **WHEN** 重複ハッシュ群の件数が基数 61 を超えて 62 になった
- **THEN** 検査は失敗し、基数 61 と現在の件数 62、および現在の全群のファイルの場所を報告する

#### Scenario: 基数を下回ると失敗する
- **WHEN** 重複ハッシュ群の件数が基数 61 を下回って 55 になった
- **THEN** 検査は失敗し、正本の基数を 55 に下げるよう報告する

#### Scenario: 基数と一致すれば通る
- **WHEN** 重複ハッシュ群の件数が基数と一致している
- **THEN** 検査は失敗しない

#### Scenario: dev ファイルの重複は数えない
- **WHEN** `packages/spirits/test/` に、同じ本文で 10 行以上の関数が 2 つある
- **THEN** 重複ハッシュ群の件数は増えない

### Requirement: 規約本文は正本 1 か所に置く
システムは、規約の内容・例外・根拠を規約正本の 1 か所にのみ保持し、検査とその他の文書からは規約 ID で参照しなければならない。(MUST)
検査は private パッケージ・例外層・spirits の層の許可表、private パッケージと spirits の層の所属表、bin の許可リスト、循環の許可リスト、重複の基数を規約正本から読み、検査側にそれらの複製を持ってはならない。(MUST)
検査が報告する規約 ID は、すべて規約正本に存在しなければならない。(MUST)

#### Scenario: 正本の許可表の変更が判定に反映される
- **WHEN** 規約正本の許可表から層 X から層 Y への許可を削除し、検査のコードは変更しない
- **THEN** 次の実行で、X から Y への import が違反として報告される

#### Scenario: 報告する規約 ID は正本に存在する
- **WHEN** 検査が違反を報告する
- **THEN** 報告に含まれる規約 ID は、規約正本の規約の節の見出しに存在する

#### Scenario: 各規約が必要な項目を持つ
- **WHEN** 規約正本の各規約の節を確認する
- **THEN** 各節が規約 ID、強度、内容、例外、判定方法、根拠を持つ

### Requirement: 検査は前提が欠けたまま通過しない
システムは、規約正本が無いとき、必須のブロックが無いとき、ブロックが JSON として不正なとき、値の型が正しくないとき(基数が非負整数でない、許可表の値が文字列の配列でない)、許可表と所属表が互いに無い層を参照しているとき、許可表のキーが既知の層でないとき、または許可表のキーが公開パッケージの層であるとき、失敗しなければならない。(SHALL)
システムは、TypeScript の解析器が起動できないとき、または走査したファイルが 0 件のとき、失敗しなければならない。(SHALL)

#### Scenario: 正本が無ければ失敗する
- **WHEN** 規約正本のファイルが存在しない
- **THEN** 検査は失敗し、正本が無い旨を報告する

#### Scenario: 基数が整数でなければ失敗する
- **WHEN** 規約正本の `registry:duplication` の `baseline` が `"abc"` である
- **THEN** 検査は重複の検査を通過させずに失敗する

#### Scenario: 許可表のキーが未知の層なら失敗する
- **WHEN** 規約正本の `registry:layers` に `spirits:typo` のキーがある
- **THEN** 検査は失敗し、未知の層であることを報告する

#### Scenario: 走査したファイルが 0 件なら失敗する
- **WHEN** 走査対象のファイルが 1 つも得られない
- **THEN** 検査は層の違反が 0 件であっても失敗する

### Requirement: 検査は自身の検出能力をフィクスチャで検証する
システムは、各規約について、違反を含むフィクスチャを検査が違反と判定すること、および違反を含まないフィクスチャを通すことを、検査自身のテストで確認しなければならない。(SHALL)
この確認は、公開パッケージの許可向きの導出、src から dev ファイルへの import、import の分類、正本の不備、および作業ディレクトリへの非依存を含まなければならない。(SHALL)
フィクスチャは、型検査(`bun run check`)と実リポジトリの走査の対象に含めてはならない。(MUST)

#### Scenario: 違反を含むフィクスチャは該当する規約 ID で失敗する
- **WHEN** 層の許可表に載っていない向きの import を含むフィクスチャを検査に与える
- **THEN** 検査はその層の規約 ID の違反を報告する

#### Scenario: 違反を含まないフィクスチャは通る
- **WHEN** 許可された向きの import だけを含むフィクスチャを検査に与える
- **THEN** 検査は違反を報告しない

#### Scenario: 作業ディレクトリに依存しない
- **WHEN** 検査をリポジトリルート以外の作業ディレクトリから実行する
- **THEN** 検査は同じリポジトリルートを見つけ、`packages/spirits` から実行した場合と同じ結果を返す

### Requirement: 正本の変更だけでも検査が実行される
システムは、Spirits CI が、規約正本のディレクトリ `docs/architecture/` 配下の変更だけを含む push と pull request でも、検査を含むテストのステップを実行するようにしなければならない。(SHALL)

#### Scenario: 正本だけを変える pull request で検査が走る
- **WHEN** pull request が `docs/architecture/convention-registry.md` だけを変更している
- **THEN** Spirits CI が起動し、`bun test` が実行される

### Requirement: 検査は Pi 上流コアを変更しない
システムは、検査と規約正本を Pi 上流コア(root の `tsconfig.json`、`.github/workflows/ci.yml`、`biome.json`、`vitest.base.ts`、`package.json` など、上流が持つファイル)に置いてはならず、それらを変更してはならない。(SHALL)
検査は `packages/spirits/` 内で、spirits 側のテストランナーによって実行されなければならない。(SHALL)

#### Scenario: 上流ファイルに触れない
- **WHEN** この変更の差分を確認する
- **THEN** root の `tsconfig.json`、`.github/workflows/ci.yml`、`biome.json`、`vitest.base.ts`、`package.json` に差分がなく、検査が `packages/spirits/` に、正本が `docs/architecture/` に置かれている
