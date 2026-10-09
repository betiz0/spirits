# continual-harness Specification

## Purpose

エージェントがセッションを跨いで知識を蓄積し、スキルと code-mode プロンプトを更新できる自己改善機構を提供する。spirits の設計目標 3 の実装であり、M3 の `rlm` の公開契約と子セッションの構成は変えない。

## Requirements

### Requirement: note によるメモリ追記
システムは、tsrepl のセルから `note(text)` を呼び出せるようにし、成功時に ISO 8601 形式のタイムスタンプ付きの 1 行をメモリファイルへ追記しなければならない。(SHALL)
メモリファイルはエージェントディレクトリ配下の `memory/notes.md` とし、ディレクトリとファイルが無ければ作成しなければならない。(SHALL)
追記前のメモリファイルが改行で終わっていない場合は、追記する行が既存の最終行と連結しないよう、行区切りを補ってから追記しなければならない。(SHALL)
成功した `note` ごとに、追記した行の本文を含む `spirits_memory` カスタムエントリをセッションへ追記しなければならない。(SHALL)
`spirits_memory` は LLM コンテキストへ送ってはならない。(MUST)
システムは、`note` の結果として追記先を示す確認文字列を返さなければならない。(SHALL)

#### Scenario: note でメモリファイルが作られる
- **WHEN** セル `return await note("build requires bun 1.4.2")` を実行する
- **THEN** `memory/notes.md` が作成され、ISO 8601 のタイムスタンプと `build requires bun 1.4.2` を含む 1 行が追記され、戻り値の value に追記先のパスが含まれる

#### Scenario: 改行で終わらないメモリファイルへの追記
- **WHEN** `memory/notes.md` が改行で終わらない 1 行 `prior note` だけから成る状態でセル `await note("new note")` を実行する
- **THEN** `notes.md` は 2 行になり、1 行目は `prior note` のまま、2 行目は ISO 8601 のタイムスタンプと `new note` を含む

#### Scenario: セッションエントリへの記録
- **WHEN** セル `await note("remembered")` を実行した後にセッションのエントリとメッセージ列を取得する
- **THEN** エントリに `spirits_memory` が 1 件追加され、メッセージ列に `spirits_memory` の内容は含まれない

### Requirement: note の入力の検証と正規化
`text` に改行(`\n`、`\r\n`、`\r`)が含まれる場合、システムは各改行を 1 つの半角スペースに置き換えて 1 行にしなければならない。(SHALL)
`spirits_memory` エントリの本文は、改行を置き換えた後のテキストでなければならない。(SHALL)
`text` が文字列でない、または空白のみ(改行のみを含む)の場合は、メモリファイルとセッションエントリのどちらも書かずに例外を投げなければならない。(MUST)

#### Scenario: 改行は 1 行に正規化される
- **WHEN** `memory/notes.md` が 1 行ある状態でセル `await note("a\nb\r\nc")` を実行する
- **THEN** `notes.md` は 1 行だけ増え、追記された行は `a b c` で終わる

#### Scenario: 空の note は書き込まない
- **WHEN** `memory/notes.md` に既存の行がある状態でセル `await note("   ")` と `await note("\n\n")` をそれぞれ実行する
- **THEN** いずれも error が返り、`notes.md` の内容は変わらず、`spirits_memory` エントリも追加されない

#### Scenario: 文字列でない note は書き込まない
- **WHEN** セル `await note(42)` を実行する
- **THEN** error が返り、`memory/notes.md` は作成されず、`spirits_memory` エントリも追加されない

### Requirement: メモリの起動時注入
システムは、エージェント実行の開始前に、エージェントディレクトリ配下 `memory/` 直下の `*.md` を読み、要約をシステムプロンプトの `spirits_memory` セクションへ追加しなければならない。(SHALL)
抜粋は、`notes.md` については末尾の N 行、それ以外のファイルについては先頭の N 行とする。N の既定値は 20 とする。行は改行で区切った行とし、ファイル末尾の改行による空行は数えない。(SHALL)
要約は、整理候補(あれば)、`notes.md`、その他のファイル(ファイル名の昇順)の順に並べなければならない。(SHALL)
要約は、ファイルごとの見出しに、そのファイルの絶対パス、抜粋が先頭か末尾か、全文がそのファイルにある旨を含めなければならない。エージェントディレクトリが相対パスで指定された場合も、パスは絶対パスで示さなければならない。(SHALL)
`memory/` が無い、または対象ファイルが無い場合は `spirits_memory` セクションを追加してはならない。(SHALL)

#### Scenario: 要約の注入
- **WHEN** `memory/notes.md` に `hello memory` を含む行がある状態でエージェントを開始する
- **THEN** システムプロンプトの `spirits_memory` セクションに `hello memory` と `notes.md` のパスが含まれる

#### Scenario: notes.md 以外は先頭 20 行まで
- **WHEN** `memory/other.md` の 1 行目に `line-01-marker`、21 行目に `line-21-marker` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `line-01-marker` は含まれ、`line-21-marker` は含まれない

#### Scenario: notes.md は末尾 20 行
- **WHEN** `memory/notes.md` の 1 行目に `line-01-marker`、25 行目に `line-25-marker` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `line-25-marker` は含まれ、`line-01-marker` は含まれず、`notes.md` の抜粋が末尾である旨が含まれる

#### Scenario: メモリが無い場合
- **WHEN** `memory/` が無いか、`*.md` を 1 つも持たない状態でエージェントを開始する
- **THEN** システムプロンプトに `spirits_memory` セクションは含まれない

#### Scenario: 読み取り失敗の除外
- **WHEN** `memory/` に読み取り不能なファイルと読み取り可能なファイルがある状態でエージェントを開始する
- **THEN** エージェントの開始は失敗せず、要約には読み取り可能なファイルだけが含まれる

#### Scenario: ファイルごとの見出し
- **WHEN** `memory/notes.md` と `memory/other.md` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションの各ファイルの見出しに、そのファイルの絶対パスと、全文がそのファイルにある旨が含まれる

#### Scenario: 相対パスのエージェントディレクトリ
- **WHEN** エージェントディレクトリが相対パスで指定され、その配下の `memory/other.md` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションの `other.md` の見出しのパスは `/` で始まる絶対パスで、そのパスから同じファイルを読める

### Requirement: メモリ要約の文字数上限
`spirits_memory` セクション本文の全体(見出し、パス、整理候補、切り詰めの表示を含む)は、文字数上限(JavaScript 文字列の長さ。既定 4000)を超えてはならない。(SHALL)
本文が上限を超える場合は、切り詰めた旨を末尾に含めなければならない。切り詰めた旨を含めた本文も上限以内でなければならない。(SHALL)
上限が切り詰めた旨の長さ以下の場合は、切り詰めた旨を付けず、本文の先頭から上限の長さだけを返さなければならない。(SHALL)
切り詰めは、サロゲートペアの途中で行ってはならない。(MUST)
切り詰めで省略されたファイルのパスは、要約に含まれない場合がある。(SHALL)

#### Scenario: セクション全体の文字数上限
- **WHEN** 各 5000 文字の 1 行だけから成るファイルを 2 つ `memory/` に置いてエージェントを開始する
- **THEN** `spirits_memory` セクション本文の長さは 4000 以下で、切り詰めた旨が末尾に含まれる

#### Scenario: 上限ちょうどでは切り詰めない
- **WHEN** 切り詰めなしの要約本文の長さがちょうど文字数上限になる状態でエージェントを開始する
- **THEN** 本文は切り詰められず、切り詰めた旨も含まれない

#### Scenario: 上限が切り詰めた旨より短い場合
- **WHEN** `SPIRITS_MEMORY_CHAR_LIMIT=10` で、5000 文字の 1 行だけから成るファイルを `memory/` に置いてエージェントを開始する
- **THEN** `spirits_memory` セクション本文の長さは 10 で、切り詰めた旨は含まれない

#### Scenario: サロゲートペアの途中で切らない
- **WHEN** 絵文字 `😀`(UTF-16 で 2 コード単位)だけから成る長い 1 行を持つファイルがあり、文字数上限を連続する 4 つの値に変えてそれぞれエージェントを開始する
- **THEN** いずれの本文にも、対を持たない上位または下位サロゲートは含まれない

### Requirement: メモリ要約の切り詰めの優先順位
本文が上限を超える場合は、見出し、整理候補、`notes.md` の抜粋、ほかのファイルの抜粋の順に優先して残さなければならない。(SHALL)
`notes.md` の抜粋が収まらない場合は、新しい行を残して古い行から省かなければならない。古い行を省いて収まった場合、見出しに示す抜粋の行数は、実際に含めた行数でなければならない。(SHALL)
古い行を省いても最新の 1 行が収まらない場合、見出しと整理候補だけで上限を超える場合、およびほかのファイルの抜粋が収まらない場合は、本文の後ろ側を切り詰める。(SHALL)
後ろ側を切り詰めた場合、見出しに示す行数は切り詰める前の抜粋の行数のままでよく、本文に残る行の数と一致しない場合がある(見出し自体が途中で切れる場合もある)。(SHALL)

#### Scenario: 切り詰めで notes.md が残る
- **WHEN** `memory/a.md` に 5000 文字の 1 行があり、`memory/notes.md` に `latest-note` を含む行がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `latest-note` が含まれる

#### Scenario: notes.md だけで上限を超える場合は新しい note を残す
- **WHEN** `memory/notes.md` に、各 300 文字で `note-01` から `note-20` までのマーカーを持つ 20 行がある状態で、上限を既定にしてエージェントを開始する
- **THEN** `spirits_memory` セクション本文の長さは 4000 以下で、`note-20` は含まれ、`note-01` は含まれず、`notes.md` の見出しに示す行数は含まれる note の行数と一致する

#### Scenario: 最新の 1 行も収まらない場合
- **WHEN** `SPIRITS_MEMORY_CHAR_LIMIT=500` で、`memory/notes.md` に 5000 文字の 1 行だけがある状態でエージェントを開始する
- **THEN** `spirits_memory` セクション本文の長さは 500 以下で、切り詰めた旨が末尾に含まれる

### Requirement: メモリ上限の設定
システムは、メモリ要約の次の 3 つの値を環境変数で変更できなければならない。(SHALL)
- 抜粋行数 N: `SPIRITS_MEMORY_PREVIEW_LINES`(既定 20)
- セクション本文の文字数上限: `SPIRITS_MEMORY_CHAR_LIMIT`(既定 4000)
- 整理候補の行数上限: `SPIRITS_MEMORY_LINE_LIMIT`(既定 200)

値が正の整数でない場合(空文字列、数値でない文字列、0、負の数、小数、先頭が 0 の数、符号付きの数、前後に空白を含む値)は、その値の既定値を使わなければならない。このとき、エージェントの開始を妨げてはならない。(SHALL)

#### Scenario: 抜粋行数の変更
- **WHEN** `SPIRITS_MEMORY_PREVIEW_LINES=5` で、`memory/other.md` の 5 行目に `line-05-marker`、6 行目に `line-06-marker` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `line-05-marker` は含まれ、`line-06-marker` は含まれない

#### Scenario: 文字数上限の変更
- **WHEN** `SPIRITS_MEMORY_CHAR_LIMIT=500` で、5000 文字の 1 行だけから成るファイルを `memory/` に置いてエージェントを開始する
- **THEN** `spirits_memory` セクション本文の長さは 500 以下である

#### Scenario: 整理候補の行数上限の変更
- **WHEN** `SPIRITS_MEMORY_LINE_LIMIT=10` で、11 行の `memory/big.md` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `big.md` と `11` 行である旨の整理候補が含まれる

#### Scenario: 不正な値は既定値になる
- **WHEN** `SPIRITS_MEMORY_PREVIEW_LINES` に `abc`、`0`、`-1`、`1.5`、`05`、`+5`、`" 5"`(前後に空白)、空文字列をそれぞれ指定し、`memory/other.md` の 20 行目に `line-20-marker`、21 行目に `line-21-marker` がある状態でエージェントを開始する
- **THEN** いずれも開始は失敗せず、`spirits_memory` セクションに `line-20-marker` は含まれ、`line-21-marker` は含まれない

### Requirement: メモリの整理候補
システムは、`memory/` 直下の `*.md` が整理候補の行数上限(既定 200)を超える場合、`spirits_memory` セクションにそのファイル名と行数を整理候補として含めなければならない。(SHALL)
システムは、行数上限を超えたファイルを自動で削除・変更してはならない。(MUST)

#### Scenario: 整理候補の表示
- **WHEN** 201 行の `memory/big.md` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `big.md` と `201` 行である旨の整理候補が含まれ、`big.md` は変更されない

#### Scenario: 上限ちょうどは候補にならない
- **WHEN** 200 行の `memory/exact.md` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `exact.md` の整理候補は含まれない

#### Scenario: `*.md` 以外は対象外
- **WHEN** 201 行の `memory/big.txt` がある状態でエージェントを開始する
- **THEN** `spirits_memory` セクションに `big.txt` は含まれない

### Requirement: goal の取得
システムは、tsrepl のセルから `goal()` を呼び出せるようにし、現在のブランチ上のゴールを文字列で返さなければならない。(SHALL)
現在のブランチ上に `spirits_goal` カスタムエントリがある場合、その最新の設定値を返さなければならない。(SHALL)
明示設定がない場合、現在のブランチ上の最初のユーザーメッセージのテキストを返さなければならない。ユーザー以外のメッセージとカスタムエントリは対象にしてはならない。最初のユーザーメッセージにテキストが無い(画像のみなど)場合は、後続のユーザーメッセージに進まず、空文字列を返さなければならない。(SHALL)
どちらも無い場合、空文字列を返さなければならない。(SHALL)
ほかのブランチ(現在のブランチに含まれないエントリ)の `spirits_goal` と最初のユーザーメッセージは、返す値に影響してはならない。(MUST)

#### Scenario: 最初のユーザーメッセージを返す
- **WHEN** 最初のユーザーメッセージが `fix the parser` であるセッションでセル `return goal()` を実行する
- **THEN** value は `fix the parser` になる

#### Scenario: ユーザー以外のメッセージを無視する
- **WHEN** 最初のメッセージがアシスタントのメッセージで、次のユーザーメッセージが `fix the parser` であるセッションでセル `return goal()` を実行する
- **THEN** value は `fix the parser` になる

#### Scenario: 明示設定を優先する
- **WHEN** セル `goal("ship M4")` を実行した後にセル `return goal()` を実行する
- **THEN** value は `ship M4` になる

#### Scenario: 最新の明示設定を返す
- **WHEN** セル `goal("first")` と `goal("second")` をこの順に実行した後にセル `return goal()` を実行する
- **THEN** value は `second` になる

#### Scenario: ゴールが無い場合
- **WHEN** ユーザーメッセージも `spirits_goal` も無いセッションでセル `return goal()` を実行する
- **THEN** value は空文字列になる

#### Scenario: 最初のユーザーメッセージにテキストが無い場合
- **WHEN** 最初のユーザーメッセージが画像のみで、次のユーザーメッセージが `second message` であるセッションでセル `return goal()` を実行する
- **THEN** value は空文字列になり、`second message` にはならない

#### Scenario: ほかのブランチの設定は返さない
- **WHEN** ブランチ A で `goal("goal-on-a")` を実行した後、分岐元のエントリからブランチ B を作り、B 上でセル `return goal()` を実行する
- **THEN** value は `goal-on-a` にならず、B の経路上のゴール(B 上に明示設定が無ければ、B の経路上の最初のユーザーメッセージ)になる

### Requirement: goal の明示設定
`goal` を引数付きで呼び出した場合(`goal(undefined)` を含む)、システムは `spirits_goal` カスタムエントリを追記し、`text` を返さなければならない。引数なしの `goal()` だけを取得として扱わなければならない。(SHALL)
`text` が文字列でない(`undefined` を含む)、または空白のみの場合は、エントリを追記せずに例外を投げなければならない。(MUST)
`spirits_goal` は LLM コンテキストへ送ってはならない。(MUST)

#### Scenario: 設定の記録
- **WHEN** セル `await goal("M4")` を実行した後にセッションのエントリとメッセージ列を取得する
- **THEN** エントリに `spirits_goal` が 1 件追加され、メッセージ列にその内容は含まれない

#### Scenario: 空の設定は拒否する
- **WHEN** セル `goal("  ")` を実行する
- **THEN** error が返り、`spirits_goal` エントリは追加されない

#### Scenario: 文字列でない設定は拒否する
- **WHEN** セル `goal(42)` を実行する
- **THEN** error が返り、`spirits_goal` エントリは追加されない

#### Scenario: undefined の設定は拒否する
- **WHEN** 最初のユーザーメッセージがあるセッションでセル `goal(undefined)` を実行する
- **THEN** error が返り、`spirits_goal` エントリは追加されず、現在のゴールは返らない

### Requirement: スキルの保存
システムは codemode ツール `spirits_skill_save` を提供し、`name` / `description` / `body` を受け取らなければならない。(SHALL)
保存先はエージェントディレクトリ配下の `skills/<name>/SKILL.md` とし、`name` と `description` だけを持つ frontmatter と `body` から成る Agent Skills 形式で書かなければならない。(SHALL)
`description` は、改行、`: `、`#`、引用符を含んでいても、frontmatter を YAML として読んだときに元の文字列と一致し、ほかのキーを生じさせない形で書かなければならない。(SHALL)
保存先ディレクトリが無ければ作成し、同名スキルが存在する場合は上書きしなければならない。(SHALL)
成功時は、保存先パスと、スキルの変更が次のセッションまたは `/reload` から有効になる旨を含む確認を返さなければならない。(SHALL)

#### Scenario: スキルの作成
- **WHEN** `tool("spirits_skill_save", { name: "release-check", description: "check a release", body: "run bun test" })` を実行する
- **THEN** `skills/release-check/SKILL.md` が作成され、frontmatter の `name` が `release-check`、`description` が `check a release` で、本文に `run bun test` が含まれる

#### Scenario: 同名の上書き
- **WHEN** 同じ `name` で `spirits_skill_save` を 2 回実行する
- **THEN** `SKILL.md` の内容は 2 回目のものになり、ファイルは 1 つのままである

#### Scenario: 特殊文字を含む説明
- **WHEN** `description` を `fix: "quote" #tag` の後に改行と `disable-model-invocation: true` を続けた文字列にして `spirits_skill_save` を実行する
- **THEN** `SKILL.md` の frontmatter を YAML として読むと、キーは `name` と `description` の 2 つだけで、`description` は指定した文字列と一致する

#### Scenario: 保存結果の案内
- **WHEN** `spirits_skill_save` を実行する
- **THEN** 結果に保存先パスと `/reload` が含まれる

### Requirement: スキルの一覧
システムは codemode ツール `spirits_skill_list` を提供しなければならない。(SHALL)
エージェントディレクトリ配下 `skills/` の直下サブディレクトリ(ディレクトリへの symlink を含む)のうち `SKILL.md` を持つものについて、スキル名と説明を返さなければならない。スキル名はディレクトリ名とし、`spirits_skill_save` と `spirits_skill_delete` の `name` と同じ識別子でなければならない。(SHALL)
ディレクトリ名がスキル名の規則(スキル名の検証と同じ)に合わないものは、削除できない名前を返さないよう、一覧に含めてはならない。(SHALL)
説明は frontmatter の `description` とし、読み取り規則は「スキルの説明の読み取り」と「Pi と異なる説明の禁止」に従わなければならない。(SHALL)
スキルが無い場合は空の一覧を返さなければならない。(SHALL)

#### Scenario: 保存したスキルの一覧
- **WHEN** `release-check` を保存した後に `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果に `release-check` と `check a release` が含まれる

#### Scenario: スキルが無い場合
- **WHEN** `skills/` が無いか空の状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果は空の一覧になり、エラーにならない

#### Scenario: ディレクトリ名で返す
- **WHEN** `skills/foo/SKILL.md` の frontmatter の `name` が `bar` である状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果にはスキル名 `foo` が含まれ、`bar` は含まれない

#### Scenario: SKILL.md が無いディレクトリ
- **WHEN** `skills/empty-dir/` が `SKILL.md` を持たない状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果に `empty-dir` は含まれない

#### Scenario: symlink のスキル
- **WHEN** `skills/linked` が、`SKILL.md` を持つ別の場所のディレクトリへの symlink である状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果にスキル名 `linked` が含まれる

#### Scenario: 名前の規則に合わないディレクトリ
- **WHEN** `skills/My_Skill/SKILL.md` がある状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 結果に `My_Skill` は含まれない

### Requirement: スキルの説明の読み取り
`spirits_skill_list` は、ダブルクォートの文字列(JSON 文字列)、シングルクォートの文字列(`''` は `'` として読む)、プレーンの文字列(空白またはタブの後の `#` 以降のコメントを除く)の `description` を、Pi が読むのと同じ文字列として返さなければならない。(SHALL)
frontmatter が無い場合、`description` が無い場合、およびブロックスカラー(`>`、`|`)や継続行を持つ記法など読み取れない場合は、説明を空文字列としなければならない。この場合も一覧はエラーにしてはならない。(SHALL)

#### Scenario: frontmatter が無いスキル
- **WHEN** `skills/plain/SKILL.md` が frontmatter を持たない状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** エラーにならず、結果にスキル名 `plain` と空の説明が含まれる

#### Scenario: ブロックスカラーの説明
- **WHEN** `skills/folded/SKILL.md` の frontmatter が `description: >` の次の行から説明を書いている状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** エラーにならず、結果にスキル名 `folded` と空の説明が含まれ、説明に `>` は含まれない

#### Scenario: シングルクォートとコメント付きの説明
- **WHEN** frontmatter が `description: 'it''s fine'` のスキルと、`description: plain text # note` のスキルがある状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 説明はそれぞれ `it's fine` と `plain text` になる

#### Scenario: タブの後のコメント
- **WHEN** frontmatter が `description: plain text` の後にタブと `# note` を続けた行のスキルがある状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** 説明は `plain text` になる

### Requirement: Pi と異なる説明の禁止
`spirits_skill_list` の説明は、Pi が読む文字列と一致するか空文字列のどちらかでなければならず、Pi が読む文字列と異なる空でない文字列を返してはならない。(MUST)
プレーンの値のうち、Pi が文字列として読まないもの(YAML として解析に失敗する値、真偽値・null・数値・配列・マップなど文字列以外になる値、アンカーやタグのように Pi が別の文字列として読む値)は、読み取れない記法として説明を空文字列としなければならない。この場合も一覧はエラーにしてはならない。(SHALL)

#### Scenario: Pi が文字列として読まないプレーンの説明
- **WHEN** frontmatter が `description: fix: the thing`、`description: true`、`description: [a, b]`、`description: &anchor x` のスキルがそれぞれある状態で `tool("spirits_skill_list", {})` を実行する
- **THEN** エラーにならず、いずれのスキルも説明は空文字列になる

### Requirement: スキルの削除
システムは codemode ツール `spirits_skill_delete` を提供し、指定名のスキルディレクトリを削除しなければならない。(SHALL)
存在しないスキル名の場合は削除せずにエラーを返さなければならない。(SHALL)
成功時は削除した旨の確認を返さなければならない。(SHALL)

#### Scenario: 保存したスキルの削除
- **WHEN** `release-check` を保存した後に `tool("spirits_skill_delete", { name: "release-check" })` を実行する
- **THEN** `skills/release-check` は存在しなくなり、結果に削除の確認が含まれる

#### Scenario: 存在しないスキルの削除
- **WHEN** `tool("spirits_skill_delete", { name: "no-such-skill" })` を実行する
- **THEN** 結果はエラーになり、`skills/` は変更されない

#### Scenario: symlink のスキルの削除
- **WHEN** `skills/linked` がディレクトリへの symlink である状態で `tool("spirits_skill_delete", { name: "linked" })` を実行する
- **THEN** `skills/linked` は存在しなくなり、リンク先のディレクトリとその中のファイルは変更されない

### Requirement: スキル名の検証と書き込み先
システムは、スキルの保存と削除の `name` を `^[a-z0-9]+(-[a-z0-9]+)*$` かつ 64 文字以下に検証しなければならない。(SHALL)
検証に失敗した場合、`skills/` ディレクトリの外を含め、ファイルシステムを変更してはならない。(MUST)
`description` と `body` が、文字列でない、または空もしくは空白のみの場合は、保存せずにエラーにしなければならない。(SHALL)
`description` が 1024 文字(Agent Skills の上限。JavaScript 文字列の長さ)を超える場合は、保存せずにエラーにしなければならない。(SHALL)

#### Scenario: 不正な名前の拒否
- **WHEN** `name` に `../evil`、`Release-Check`、`-bad`、`a--b`、65 文字の名前をそれぞれ指定して `spirits_skill_save` を実行する
- **THEN** いずれもエラーになり、`skills/` の外にも中にもファイルは作成されない

#### Scenario: 64 文字の名前は受理する
- **WHEN** `a` を 64 個並べた `name` で `spirits_skill_save` を実行する
- **THEN** 成功し、`skills/` の下に同名のディレクトリと `SKILL.md` が作成される

#### Scenario: 不正な名前での削除
- **WHEN** `skills/` と同じ階層に `outside/` ディレクトリがある状態で、`name` に `../outside` を指定して `spirits_skill_delete` を実行する
- **THEN** 結果はエラーになり、`outside/` と `skills/` の内容は変わらない

#### Scenario: 不正な本文の拒否
- **WHEN** `description` または `body` を空文字列または空白のみの文字列にして `spirits_skill_save` を実行する
- **THEN** 結果はエラーになり、`SKILL.md` は作成されない

#### Scenario: 説明の長さ上限
- **WHEN** 1024 文字の `description` と 1025 文字の `description` を、別々の `name` でそれぞれ `spirits_skill_save` に渡す
- **THEN** 1024 文字のスキルは保存され、1025 文字はエラーになってそのスキルの `SKILL.md` は作成されない

### Requirement: ホスト関数とツールの案内
システムは、`goal` と `note` を登録した tsrepl のツール説明に、次を含めなければならない。(SHALL)
- `goal()` で取得し `goal(text)` で設定できること
- `note(text)` の呼び方と、改行が 1 行に正規化されること
- スキルとプロンプトの codemode ツール(`spirits_skill_save` / `spirits_skill_list` / `spirits_skill_delete` / `spirits_prompt_set`)を `tool(name, args)` で呼べること、および各ツールの引数名
- スキルの変更が次のセッションまたは `/reload` から有効になること

この案内は、`spirits_prompt_set` による `spirits` セクションの上書きに依存してはならない。(MUST)
`goal` と `note` を登録していない tsrepl のツール説明に、この案内を含めてはならない。(MUST)

#### Scenario: ツール説明の案内
- **WHEN** `goal` と `note` を登録した tsrepl のツール説明を取得する
- **THEN** 説明に `goal(`、`note(`、`spirits_skill_save`、`spirits_skill_list`、`spirits_skill_delete`、`spirits_prompt_set`、引数名 `name` / `description` / `body` / `content`、`/reload` が含まれる

#### Scenario: 上書き後も案内が残る
- **WHEN** `spirits_prompt_set` で `spirits` セクションを上書きした後に、`goal` と `note` を登録した tsrepl のツール説明を取得する
- **THEN** 説明に `spirits_skill_save` と `spirits_prompt_set` が含まれる

#### Scenario: 登録しない場合の説明
- **WHEN** `goal` と `note` を登録せずに作成した tsrepl のツール説明を取得する
- **THEN** 説明に `spirits_skill_save` は含まれない

### Requirement: code-mode プロンプトの適用
システムは、エージェント実行の開始前にシステムプロンプトへ `spirits` セクションを追加しなければならない。(SHALL)
セクションは次を含まなければならない。(SHALL)
- tsrepl を主要な実行面として使うこと
- `rlm` の使いどころと深度上限があること
- `note` とスキル保存の判断基準(次のセッションでも役立つ事実か)と、子へ渡す情報は prompt に含めること
- Phase 1 のセル評価ルール(`return` / `out`、`use` の許可範囲)

#### Scenario: ルートセッションへの適用
- **WHEN** エージェントを開始してシステムプロンプトを取得する
- **THEN** `spirits` セクションに `tsrepl`、`return`、`rlm`、`note`、`スキル` が含まれる

#### Scenario: 既存プロンプトの維持
- **WHEN** `spirits` セクションを追加した後のシステムプロンプトを取得する
- **THEN** Pi 既定のツール一覧のセクションは変更されずに残る

### Requirement: code-mode プロンプトの上書き
システムは codemode ツール `spirits_prompt_set` を提供し、`content` を受け取らなければならない。(SHALL)
呼び出し時、現在の実効プロンプトをエージェントディレクトリ配下 `prompts/spirits/code-mode.md.bak` へ書き込み、上書きファイル `prompts/spirits/code-mode.md` へ `content` を書かなければならない。(SHALL)
以降のエージェント実行では、上書きファイルがあればその内容を `spirits` セクションとして使わなければならない。(SHALL)
`content` が、文字列でない、または空もしくは空白のみの場合は、何も書かずにエラーにしなければならない。(MUST)

#### Scenario: 上書きとバックアップ
- **WHEN** `tool("spirits_prompt_set", { content: "custom prompt" })` を実行する
- **THEN** `prompts/spirits/code-mode.md` に `custom prompt` が書かれ、`prompts/spirits/code-mode.md.bak` に変更前のプロンプトが書かれる

#### Scenario: 繰り返しの上書きではバックアップが直前の内容になる
- **WHEN** `spirits_prompt_set` を `content` `first` と `second` でこの順に実行する
- **THEN** `code-mode.md` は `second`、`code-mode.md.bak` は `first` になる

#### Scenario: 上書きの適用
- **WHEN** 上書きファイルがある状態でエージェントを開始する
- **THEN** `spirits` セクションの内容は上書きファイルの内容になる

#### Scenario: 上書きの解除で既定に戻る
- **WHEN** 上書きファイルを削除してエージェントを開始する
- **THEN** `spirits` セクションの内容はビルトインの既定プロンプトに戻る

#### Scenario: 空の上書きは拒否する
- **WHEN** `spirits_prompt_set` の `content` に空文字列または空白のみの文字列を指定する
- **THEN** 結果はエラーになり、上書きファイルとバックアップファイルは作成されない

### Requirement: 子セッションへの非注入
continual-harness は、`rlm` の子セッションへメモリ要約、code-mode プロンプト、`goal` / `note` を自動配線してはならない。(MUST)
子セッションへ渡す情報は、親が子の prompt に含めた内容に限らなければならない。(SHALL)

#### Scenario: 子のホスト関数
- **WHEN** `rlm` が生成する子セッションの `tsrepl` に公開されるホスト関数名を列挙する
- **THEN** 名前は `out` / `print` / `use` / `tool` / `rlm` のちょうど 5 つで、`goal` と `note` は含まれない

#### Scenario: 子へのプロンプト非注入
- **WHEN** `rlm` が生成する子セッションのリソース構成を取得する
- **THEN** 拡張・skill・プロンプトテンプレートは無効のままで、メモリ要約と code-mode セクションの注入経路を持たない

### Requirement: 後段フェーズ機能への非依存
continual-harness は M4 までに定義した機能(ホスト関数の登録口、セッションのカスタムエントリ、実行開始前のシステムプロンプト拡張点、ツール登録、ファイルシステム)にのみ依存し、M5 の Phase 2 機能(パーサによる最終式返却、非同期 fan-out、ハンドル)を import・参照してはならない。(MUST)
continual-harness は `rlm` の公開 API(`rlm(prompt, opts?)` の同期・文字列返却)と子セッションの構成を変更してはならない。(MUST)

#### Scenario: 後段機能の非参照
- **WHEN** `packages/spirits/src/harness/` の import 指定子を列挙する
- **THEN** パーサ / fan-out / ハンドル / M5 のモジュールへの import が存在しない

#### Scenario: rlm 契約の維持
- **WHEN** `rlm` を登録した tsrepl のツール説明と `rlm` の戻り値の型を取得する
- **THEN** 同期呼び出しと文字列返却の契約は M3 から変わらない
