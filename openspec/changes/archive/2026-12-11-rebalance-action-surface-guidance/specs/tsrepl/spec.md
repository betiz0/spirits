# Spec Delta

## ADDED Requirements

### Requirement: 未提供のホストグローバルへの参照の提案
システムは、セルが `process`、`Bun`、`require` を参照して `ReferenceError` になったとき、error の提案 1 文で代わりの手段を示さなければならない。(SHALL) 代わりの手段は `await use("node:...")` とし、コマンドの実行が要る `Bun` では、`sh()` がルートのセッションでだけ使えることを添えて示す。提案はルートと `rlm` の子のどちらのセッションでも同じとする。
この場合の提案に、`globalThis` への代入を勧める文を含めてはならない。(MUST) それ以外の識別子の `ReferenceError` の提案は変えない。

#### Scenario: process の参照
- **WHEN** セル `return process.env.HOME` を実行する
- **THEN** error に `process` と `use("node:` が含まれ、`globalThis.process =` は含まれない

#### Scenario: Bun の参照
- **WHEN** セル `return Bun.version` を実行する
- **THEN** error に `use("node:` と `sh(` とルートのセッションに限る旨が含まれ、`globalThis.Bun =` は含まれない

#### Scenario: 子セッションでも同じ提案
- **WHEN** `rlm` が生成する子セッションの tsrepl でセル `return process.env.HOME` を実行する
- **THEN** error はルートのセッションで同じセルを実行したときと同じ提案を含み、`globalThis.process =` は含まれない

#### Scenario: require の参照
- **WHEN** セル `const fs = require("fs"); return 1` を実行する
- **THEN** error に `await use("node:` が含まれ、`globalThis.require =` は含まれない

#### Scenario: それ以外の未定義の識別子
- **WHEN** セル `return notDefinedAnywhere` を実行する
- **THEN** error の提案に `globalThis` への代入が含まれる

### Requirement: ツール説明の use() の書き方
システムは、tsrepl のツール説明で、`use()` が Promise を返し `await` して使うことを、`await use("node:...")` の形の例で示さなければならない。(SHALL) 説明に載せる `use()` の例は、指定子の種類(`node:`、`bun:`、相対パス)を問わず、すべて `await` を付けた形でなければならない。(MUST) ツール説明は、セルに `process`、`Bun`、`require` が無いことも示さなければならない。(SHALL)

#### Scenario: await 付きの例
- **WHEN** 登録された tsrepl ツールの説明を取得する
- **THEN** 説明に `await use("node:` が含まれ、指定子を書いた例 `use("` の出現はすべて直前が `await ` である

#### Scenario: 無いグローバルの明示
- **WHEN** 登録された tsrepl ツールの説明を取得する
- **THEN** 説明に `process`、`Bun`、`require` が含まれる

## MODIFIED Requirements

### Requirement: ツール一覧と規則への掲載
システムは、tsrepl ツールに 1 行の promptSnippet を宣言し、モデルへ渡すシステムプロンプトのツール一覧に tsrepl を掲載しなければならない。(SHALL)
システムは、tsrepl ツールに promptGuidelines として次の 4 項目だけを宣言し、システムプロンプトの規則に追加しなければならない。(SHALL)

- ファイルを読むときは read、作成・書き換えるときは edit / write を使う。sed -i、ヒアドキュメント、スクリプトでファイルを書き換えない
- bash は 1 回の起動で終わり出力を自分で読むコマンドに使う(&& での連結、head / tail / wc / grep / rg / sort / uniq / cut / tr / cat / nl / column だけで絞り込むパイプ、sed -n の範囲表示、複数のファイルを引数で渡す形を含む)
- 出力をコードで扱う処理(値の抽出・集計・分岐・繰り返し・待機)と使い捨てのコードは tsrepl で TypeScript として書く。bash にシェルの制御構文、awk / jq / xargs、node -e などのインラインコードを書かない。process や Bun が必要で tsrepl に書けないときだけ、一時ディレクトリの .ts を bun で実行してよい
- python(python3、pip、uv、pytest を含む)は、対象プロジェクトの実行も含めて一切実行しない。JSON の読み取りと集計は tsrepl、ファイルの書き換えは edit を使う

promptSnippet はどのセッションの tsrepl でも宣言する。promptGuidelines は、`rlm` が生成する子セッションの tsrepl では空とし、それ以外のセッションの tsrepl では上記 4 項目を宣言する。(SHALL)

#### Scenario: ツール一覧への掲載
- **WHEN** 登録された tsrepl ツールの promptSnippet を取得する
- **THEN** 空ではなく、改行を含まない 1 行である

#### Scenario: 規則への掲載
- **WHEN** 登録された tsrepl ツールの promptGuidelines を取得する
- **THEN** 項目数は 4 で、ファイルの読み書きを read / edit / write に向ける基準、bash を単発で出力を自分で読む用途に限定する基準、出力をコードで扱う処理と使い捨てコードを tsrepl の TypeScript で書く基準、python を例外なく実行しない基準が含まれる

#### Scenario: 規則のフィルタ一覧はガードと一致する
- **WHEN** 登録された tsrepl ツールの promptGuidelines の bash の項目と、ガードが 3 段以上のパイプで許可するフィルタの一覧を比較する
- **THEN** 項目に列挙されたフィルタはガードの許可フィルタと同じ集合である

#### Scenario: 子の tsrepl は規則を宣言しない
- **WHEN** `rlm` が生成する子セッションの tsrepl の promptSnippet と promptGuidelines を取得する
- **THEN** promptSnippet は親と同じく空でなく、promptGuidelines は空である
