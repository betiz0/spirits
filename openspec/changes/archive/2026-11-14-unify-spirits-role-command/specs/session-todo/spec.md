# Spec Delta

## MODIFIED Requirements

### Requirement: 開閉キーは設定ファイル、環境変数、既定値の順に決まる
システムは開閉キーを、次の候補の順に最初に採用できた値で決めなければならない。(SHALL)
1. グローバル設定ファイル(`<agentDir>/settings.json`)の `todo.toggleKey`
2. 環境変数 `SPIRITS_TODO_TOGGLE_KEY`
3. 既定値 `ctrl+alt+p`

値が無い、文字列でない、または構文として解釈できない候補は未設定として扱い、次の候補へ進まなければならない。(MUST) 設定ファイルが存在しない、JSON として解釈できない、またはオブジェクトでない場合は、設定ファイルに値が無いものとして扱わなければならず、拡張の読み込みを失敗させてはならない。(MUST) 設定は拡張の読み込み時に読み、変更は次の `/reload` または起動から反映する。

#### Scenario: 既定キー
- **GIVEN** 設定ファイルに `todo.toggleKey` が無く、`SPIRITS_TODO_TOGGLE_KEY` も設定されていない
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+alt+p` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: 既定キーは修飾キーを報告しない端末でも届く
- **GIVEN** 端末が Kitty keyboard protocol も xterm modifyOtherKeys も使わず、tmux の `extended-keys` も off である
- **WHEN** 設定なしで起動した対話 TUI で、未完了の項目がある状態で既定の開閉キーを押す
- **THEN** パネルが展開と折りたたみの間で切り替わる
- **AND** Pi の組み込み操作は始まらない

#### Scenario: 設定ファイルでの変更
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": "ctrl+shift+k" }` があり、`SPIRITS_TODO_TOGGLE_KEY` は設定されていない
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+shift+k` を押し、次に `ctrl+alt+p` を押す
- **THEN** `ctrl+shift+k` でパネルが切り替わり、`ctrl+alt+p` では切り替わらない

#### Scenario: 設定ファイルが環境変数より優先される
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": "ctrl+shift+k" }` があり、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j` で起動した
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+shift+j` を押し、次に `ctrl+shift+k` を押す
- **THEN** `ctrl+shift+j` では切り替わらず、`ctrl+shift+k` でパネルが切り替わる

#### Scenario: 環境変数での変更
- **GIVEN** 設定ファイルに `todo.toggleKey` が無く、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j` で起動した
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+shift+j` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: 設定ファイルの値が構文として解釈できない
- **GIVEN** 設定ファイルの `todo.toggleKey` が `""`、`"ctrl+"`、`"ctrl l"`、数値 `1` のいずれかで、`SPIRITS_TODO_TOGGLE_KEY=ctrl+shift+j` で起動した
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+shift+j` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: すべての候補が構文として解釈できない
- **GIVEN** 設定ファイルに `todo.toggleKey` が無く、`SPIRITS_TODO_TOGGLE_KEY` が空文字列または `ctrl+` で起動した
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+alt+p` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: 読めない設定ファイル
- **GIVEN** 設定ファイルが JSON として解釈できず、`SPIRITS_TODO_TOGGLE_KEY` は設定されていない
- **WHEN** 対話 TUI を起動し、未完了の項目がある状態でユーザーが `ctrl+alt+p` を押す
- **THEN** 拡張は読み込まれて `manage_todos` を使え、パネルが展開と折りたたみの間で切り替わる

#### Scenario: 設定の変更は `/reload` で反映される
- **GIVEN** 起動後に、設定ファイルの `todo.toggleKey` を `ctrl+shift+k` に書き換えた
- **WHEN** ユーザーが `ctrl+shift+k` を押し、次に `/reload` を実行してから `ctrl+shift+k` を押す
- **THEN** `/reload` 前の `ctrl+shift+k` ではパネルは切り替わらず、`/reload` 後の `ctrl+shift+k` で切り替わる

### Requirement: 開閉キーは構文だけを検証する
構文として解釈できる値とは、前後の空白を除いて小文字にしたとき、修飾キー `ctrl` `shift` `alt` `super` を 0 個以上それぞれ `+` を付けて並べ、その後に基底キーを 1 つ置いたものをいう。基底キーは英数字の並び、または `+` と空白を除く ASCII 記号 1 文字とする。システムは構文として解釈できるが存在しないキー名を、既定値に戻さずそのまま開閉キーとして採用しなければならない。(SHALL) この場合、どのキーを押してもパネルは切り替わらない。

#### Scenario: 記号の基底キー
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": "alt+," }` がある
- **WHEN** 未完了の項目がある状態でユーザーが `alt+,` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: 大文字と前後の空白
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": " Ctrl+Shift+K " }` がある
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+shift+k` を押す
- **THEN** パネルが展開と折りたたみの間で切り替わる

#### Scenario: 存在しないキー名
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": "ctrl+foo" }` がある
- **WHEN** 未完了の項目がある状態でユーザーが `ctrl+alt+p` を押す
- **THEN** パネルは切り替わらない

## ADDED Requirements

### Requirement: 既定の開閉キーは修飾キーの追加報告に依存しない
システムは、既定の開閉キーとして、端末が修飾キーを別途報告しなくても他のキーと区別できるキーを用いなければならない。(MUST) すなわち、基底キーが英字であり `shift` を含むキーを既定にしてはならない。(MUST) 既定の開閉キーは、Pi が組み込みで使うキーと衝突してはならない。(MUST)

利用者が `todo.toggleKey` や `SPIRITS_TODO_TOGGLE_KEY` にこの条件を満たさないキーを設定することはできる。(SHALL) その場合、システムは追加の警告を出さず、そのキーが効くかどうかは端末の修飾キー報告に従う。

#### Scenario: 既定キーは shift を含まない
- **WHEN** 既定の開閉キーの値を読み取る
- **THEN** 文字列は `ctrl+alt+p` であり、`shift` を含まない

#### Scenario: 利用者は条件を満たさないキーも設定できる
- **GIVEN** 設定ファイルに `"todo": { "toggleKey": "ctrl+shift+l" }` がある
- **WHEN** 対話 TUI を起動する
- **THEN** 拡張は警告を出さずに読み込まれ、開閉キーとして `ctrl+shift+l` が登録される
