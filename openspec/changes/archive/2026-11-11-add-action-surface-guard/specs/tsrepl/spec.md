# Spec Delta

## MODIFIED Requirements

### Requirement: ツール一覧と規則への掲載
システムは、tsrepl ツールに 1 行の promptSnippet を宣言し、モデルへ渡すシステムプロンプトのツール一覧に tsrepl を掲載しなければならない。(SHALL)
システムは、tsrepl ツールに promptGuidelines として次の 3 項目だけを宣言し、システムプロンプトの規則に追加しなければならない。(SHALL)

- bash は 1 回の起動で終わり出力をそのまま読むコマンドに使う(&& での連結と、head / tail / wc / grep / rg / sort / uniq / cut / tr / cat / nl / column だけで絞り込むパイプを含む)
- 分岐・繰り返し・出力の解析や集計・結果を次の手順へ渡す処理は tsrepl で TypeScript として書く。bash にシェルの制御構文、awk / jq / xargs、行範囲の print 以外の sed を書かない
- 調査・集計・検証用の使い捨てコードは tsrepl のセルで書く。python や node -e などのインラインコードとスクラッチスクリプトを bash から実行しない(対象プロジェクト自身の実行・テストコマンドは除く)

promptSnippet はどのセッションの tsrepl でも宣言する。promptGuidelines は、`rlm` が生成する子セッションの tsrepl では空とし、それ以外のセッションの tsrepl では上記 3 項目を宣言する。(SHALL)

#### Scenario: ツール一覧への掲載
- **WHEN** 登録された tsrepl ツールの promptSnippet を取得する
- **THEN** 空ではなく、改行を含まない 1 行である

#### Scenario: 規則への掲載
- **WHEN** 登録された tsrepl ツールの promptGuidelines を取得する
- **THEN** 項目数は 3 で、bash を単発で出力をそのまま読む用途に限定する基準、分岐・繰り返し・出力の加工は tsrepl の TypeScript で書く基準、使い捨てコードはセルで書き他言語のインラインコードを bash から実行しない基準が含まれる

#### Scenario: 子の tsrepl は規則を宣言しない
- **WHEN** `rlm` が生成する子セッションの tsrepl の promptSnippet と promptGuidelines を取得する
- **THEN** promptSnippet は親と同じく空でなく、promptGuidelines は空である

### Requirement: セル実行ログの出力と tool() のフィールド
システムは、`tsrepl_cell` エントリに次のフィールドを持たせなければならない。(SHALL)
- `truncated` と `spill`: 出力を切り捨てたか、全文の保存結果(`saved` / `failed` / null)
- `underscoreSet`: セルの値を `_` に設定したか
- `toolCalls`: セル内の `tool()` と `sh()` の呼び出しごとの `{ name, isError, structured, exitCode, threw }`。`sh()` の呼び出しは `name` を `bash` として記録する。`exitCode` は構造化結果に整数の `exit_code` があるときだけ、それ以外は null。`threw` は呼び出しが例外を投げたか

#### Scenario: tool() 呼び出しの記録
- **WHEN** outputSchema を宣言したツール `sh` が `isError` 真で `{ exit_code: 2 }` を返す環境で、セル `await tool("sh", {}); await tool("no_such_tool", {})` を実行する
- **THEN** `toolCalls` は 2 件で、1 件目は `isError` 真・`structured` 真・`exitCode` 2・`threw` 偽、2 件目は `threw` 真になる

#### Scenario: 切り捨ての記録
- **WHEN** セル `print("x".repeat(120000))` を実行する
- **THEN** `truncated` が真で、`spill` が `saved` になる

#### Scenario: sh() 呼び出しの記録
- **WHEN** bash が有効な tsrepl でセル `await sh("printf one")` を実行する
- **THEN** `toolCalls` は 1 件で、`name` が `bash`・`isError` 偽・`structured` 真・`exitCode` 0・`threw` 偽になる

## ADDED Requirements

### Requirement: sh ホスト関数
システムは、tsrepl のセルに `sh(command, options?)` ホスト関数を提供し、bash ツールを `tool("bash", { command, ...options })` と同じ経路で実行して同じ結果を返さなければならない。(SHALL) 返す値は `tool()` と同じ規則で決まり、構造化結果としては `output` と `exit_code` などを含む。
`sh` は root の tsrepl で提供し(bash を呼び出せるかどうかを問わない。bash を呼び出せないセッションでは `tool("bash")` と同じ例外になる)、`rlm` が生成する子セッションの tsrepl では提供してはならない。(SHALL)
システムは、`sh` を提供する tsrepl のツール説明に `sh` の項を含めなければならない。(SHALL)
`sh` の実装は、`guard` と後段フェーズの機能(rlm、goal/note/skill CRUD、配布基盤、Phase 2 機能)を import・参照してはならない。(MUST)

#### Scenario: sh で bash を実行する
- **WHEN** bash が有効な tsrepl でセル `const r = await sh("printf one\\n"); return r.exit_code` を実行する
- **THEN** value は `0` で、`r.output` は `one` を含む

#### Scenario: tool("bash") と同じ結果になる
- **WHEN** 同じコマンドを `sh(command)` と `tool("bash", { command })` でそれぞれ実行する
- **THEN** 両者の `output` と `exit_code` は一致する

#### Scenario: エラー扱いの結果も構造化結果で返る
- **WHEN** 存在しないファイルの `cat` を `sh` で実行する
- **THEN** 例外にはならず、`exit_code` は 0 以外で、`output` にエラーメッセージが入る

#### Scenario: bash を呼び出せないときは tool() と同じ例外になる
- **WHEN** bash を呼び出せないセッションの tsrepl でセル `await sh("echo one")` を実行する
- **THEN** `tool("bash", { command: "echo one" })` と同じ内容の例外がセル内に投げられる

#### Scenario: ツール説明に sh が掲載される
- **WHEN** `sh` を提供する tsrepl ツールの説明を取得する
- **THEN** 説明に `sh` の項が含まれる

#### Scenario: 子セッションでは sh を提供しない
- **WHEN** `rlm` が生成する子セッションの tsrepl に公開されるホスト関数名を列挙する
- **THEN** `sh` は含まれない

#### Scenario: sh は後段機能に依存しない
- **WHEN** `packages/spirits/src/repl/` の import 指定子を列挙する
- **THEN** `guard` と後段フェーズのモジュールへの import が存在しない
