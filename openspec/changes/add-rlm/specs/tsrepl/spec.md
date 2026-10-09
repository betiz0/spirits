# Spec Delta

## MODIFIED Requirements

### Requirement: 後段フェーズ機能への非依存
tsrepl は M1 で定義したホスト関数(`out`/`print`/`use`/`tool`)と登録口のみに依存し、後段フェーズの機能(rlm、goal/note/skill CRUD、配布基盤、Phase 2 機能)を import・参照してはならない。(MUST)
システムは、後段フェーズがホスト関数を登録できる登録口を提供しなければならない。登録エントリは、セルごとの実行状態(中断シグナル、ツール実行コンテキスト、出力先)を受け取って関数を返す形とし、M1 コアは登録された関数の中身を知らずにコンテキストへ公開できなければならない。(SHALL)
既に登録された名前、および M1 の組込関数(`out`/`print`/`use`/`tool`)と同じ名前の登録は、登録時に例外としなければならない。(SHALL)
コンテキスト生成後に登録された関数は、次にコンテキストを生成したとき(reset 時)から利用可能にしなければならない。(SHALL)

#### Scenario: 後段機能の非参照
- **WHEN** `packages/spirits/src/repl/` と `packages/spirits/src/tools.ts` の import 指定子を列挙する
- **THEN** rlm / goal / note / skill / 配布基盤 / Phase 2 のモジュールへの import が存在しない

#### Scenario: ホスト関数の追加登録
- **WHEN** コンテキスト生成前に、呼ぶと `"hi"` を返す関数を名前 `hello` で登録し、セル `return hello()` を実行する
- **THEN** value は `"hi"` になり、REPL コアのコードは変更していない

#### Scenario: 組込名との重複登録
- **WHEN** 名前 `print` で関数を登録する
- **THEN** 登録時に例外が投げられる

#### Scenario: 同名の二重登録
- **WHEN** 名前 `hello` で 2 回登録する
- **THEN** 2 回目の登録で例外が投げられる

#### Scenario: コンテキスト生成後の登録
- **WHEN** コンテキスト生成後に名前 `late` で登録し、セル `return typeof late` を実行してから、reset:true でセル `return typeof late` を実行する
- **THEN** 1 つ目の value は `"undefined"`、2 つ目の value は `"function"` になる
