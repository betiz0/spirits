# Spec Delta

## MODIFIED Requirements

### Requirement: timeout
システムは、セルの実行が timeout を超えた場合、セルの待機を打ち切って error を返さなければならない。error には、timeout で打ち切った旨、部分実行によりコンテキストが不整合になり得る旨、`reset: true` で初期化できる旨を含めなければならない。(SHALL)
timeout は省略可能とし、省略した場合はセル全体の打ち切りを行わない。指定した値は 500ms 未満なら 500ms に、2147483647ms を超えるなら 2147483647ms にクランプしなければならない。(SHALL)
中断を保証するのは、最初の `await` より前の同期実行(同期実行の watchdog の要件に従う)と、`await` で待機している状態に限る。`await` の後に始まる同期ループは中断できず、プロセス全体が応答しなくなる。これは既知の制約とする。打ち切ったセルの非同期処理は、その後も動き続ける場合がある。

#### Scenario: 同期ループの打ち切り
- **WHEN** timeout 500 でセル `while (true) {}` を実行する
- **THEN** error が返り、打ち切った旨、不整合になり得る旨、`reset: true` の案内が含まれる

#### Scenario: 待機中の打ち切り
- **WHEN** timeout 500 でセル `await new Promise((r) => setTimeout(r, 60000))` を実行する
- **THEN** 60000ms を待たずに error が返り、打ち切った旨、不整合になり得る旨、`reset: true` の案内が含まれる

#### Scenario: 下限へのクランプ
- **WHEN** timeout 0 で、300ms 待ってから `return 1` するセルを実行する
- **THEN** timeout は 500ms として扱われ、結果の value は `1` になる

#### Scenario: 上限へのクランプ
- **WHEN** timeout に 2147483647 より大きい値を指定して、300ms 待ってから `return 1` するセルを実行する
- **THEN** 値を拒否せず error にはならず、適用される timeout は 2147483647ms になる

#### Scenario: 未指定では打ち切らない
- **WHEN** timeout を指定せず、1500ms 待ってから `return 1` するセルを実行する
- **THEN** error にはならずに value が `1` になる

#### Scenario: 未指定でも呼び出し元の中断で打ち切る
- **WHEN** timeout を指定せず、60000ms 待機するセルの実行中に呼び出し元の中断シグナルが abort される
- **THEN** 待機を待たずに error が返り、呼び出し元の中断で打ち切った旨が含まれる

#### Scenario: ツール説明での timeout の案内
- **WHEN** 登録された tsrepl ツールの説明文を取得する
- **THEN** 説明文に、timeout が既定なしである旨、指定時の上限 `2147483647`、同期実行に既定 30000ms の watchdog が掛かる旨が含まれる

### Requirement: 出力上限
システムは、整形後の結果テキスト全体(成功時は value と printed、失敗時は error)が 51200 文字(JavaScript 文字列の長さ)を超えた場合、先頭 30720 文字と末尾 20480 文字を残して中間を切り捨て、切り捨てた文字数を明記しなければならない。51200 文字以下のテキストは変更してはならない。(SHALL)
システムは切り捨てたときの全文を一時ファイルに保存し、結果テキストにそのパスを書かなければならない。保存できなかった場合もセルの結果は成功・失敗のままとし、パスの代わりに保存できなかった旨を書く。(SHALL)
システムは上限を変更する手段を提供しない。(SHALL)

#### Scenario: 上限ちょうど
- **WHEN** 整形後の結果テキストがちょうど 51200 文字になるセルを実行する
- **THEN** 結果テキストは切り捨てられず、切り捨ての表記も含まれない

#### Scenario: 上限超過
- **WHEN** セル `print("x".repeat(120000))` を実行する
- **THEN** 結果テキストは元のテキストの先頭 30720 文字と末尾 20480 文字を含み、切り捨てた文字数(元の長さ − 51200)が明記される

#### Scenario: 切り捨てた全文の一時ファイル
- **WHEN** 上限超過のセルを実行する
- **THEN** 結果テキストに切り捨ての表記と一時ファイルのパスが含まれ、そのファイルには切り捨て前の結果テキスト全体が入っている

#### Scenario: 全文を保存できない
- **WHEN** 一時ファイルを書けない状態で上限超過のセルを実行する
- **THEN** セルは成功し、切り捨ての表記が含まれ、パスの代わりに保存できなかった旨が含まれる

#### Scenario: error の上限超過
- **WHEN** セル `throw new Error("e".repeat(120000))` を実行する
- **THEN** error のテキストも同じ規則で切り捨てられ、切り捨てた文字数が明記される

#### Scenario: ツール説明での出力上限の案内
- **WHEN** 登録された tsrepl ツールの説明文を取得する
- **THEN** 説明文に、出力上限 `51200` 文字と、切り捨て時に全文がファイルへ保存される旨が含まれる

### Requirement: tool() によるツール呼び出し
システムは、`tool(name, args)` を、ホストのツール実行経路(引数検証・フック・権限チェックを含む)で実行しなければならない。呼び出せるのは、上流 pi が他のツールから呼び出せるとするツール(有効な direct ツール、codemode ツール、deferred ツール)から tsrepl 自身を除いたものとする。(SHALL)
結果がエラー扱いのとき、そのツールが outputSchema を宣言していて結果に構造化結果が含まれる場合は、セルには例外を投げず、構造化結果を返さなければならない。(SHALL)
エラー扱いでない結果に構造化結果が含まれる場合は構造化結果を、含まれない場合はテキスト内容を 1 つの文字列にして返さなければならない。(SHALL)
構造化結果を含まない失敗、outputSchema を宣言しないツールの失敗、存在しないツール、呼び出せないツール、tsrepl 自身の指定、引数不正、拒否は、ツールのエラーテキストを含む例外としてセル内に投げ、セル内で catch できなければならない。(SHALL)

#### Scenario: テキスト結果のツール
- **WHEN** 呼び出し可能なツール `echo` が `{ text: "hi" }` に対してテキスト `hi` を返す環境で、セル `return await tool("echo", { text: "hi" })` を実行する
- **THEN** value は `"hi"` になる

#### Scenario: 構造化結果のツール
- **WHEN** 呼び出し可能なツール `count` が構造化結果 `{ n: 1 }` を返す環境で、セル `return (await tool("count", {})).n` を実行する
- **THEN** value は `1` になる

#### Scenario: エラー扱いの構造化結果
- **WHEN** outputSchema を宣言した呼び出し可能なツール `sh` が `isError` 真で構造化結果 `{ output: "boom", exit_code: 1 }` を返す環境で、セル `const r = await tool("sh", {}); return r.exit_code` を実行する
- **THEN** error は返らず、value は `1` になる

#### Scenario: 宣言の無いツールのエラー扱いの構造化結果
- **WHEN** outputSchema を宣言しない呼び出し可能なツール `undeclared` が `isError` 真で構造化結果 `{ exit_code: 1 }` とテキスト `undeclared failed` を返す環境で、セル `await tool("undeclared", {})` を実行する
- **THEN** 結果は error になり、`undeclared failed` が含まれる

#### Scenario: エラー扱いで構造化結果が無い
- **WHEN** 呼び出し可能なツール `plain` が `isError` 真でテキスト `plain failed` のみ返す環境で、セル `await tool("plain", {})` を実行する
- **THEN** 結果は error になり、`plain failed` が含まれる

#### Scenario: 存在しないツールの catch
- **WHEN** セル `try { await tool("no_such_tool", {}) } catch (e) { return String(e) }` を実行する
- **THEN** value は `no_such_tool` を含むエラー文になる

#### Scenario: 未捕捉のツールエラー
- **WHEN** セル `await tool("no_such_tool", {})` を実行する
- **THEN** 結果は error になり、`no_such_tool` が含まれる

#### Scenario: tsrepl 自身の呼び出し
- **WHEN** セル `await tool("tsrepl", { code: "return 1" })` を実行する
- **THEN** 入れ子の tsrepl は実行されず、error に tsrepl を tool() から呼べない旨が含まれる

#### Scenario: ツール説明での非ゼロ終了の案内
- **WHEN** 登録された tsrepl ツールの説明文を取得する
- **THEN** 説明文に、非ゼロ終了などのエラー扱いでも構造化結果が返る旨と、終了コードを確認する必要がある旨が含まれる

### Requirement: ツールパラメータと結果
システムは tsrepl ツールをモデルから直接呼び出せる形で登録し、code(必須)、timeout(省略可、既定なし。クランプと同期実行の watchdog はそれぞれの要件に従う)、reset(既定 false)、description(省略可、開発時ログ用)を受け付けなければならない。(SHALL)
結果は、成功時に value と printed を、失敗時に error のみを整形済みテキストとして返さなければならない。失敗時は、ツール結果をエラーとして扱わせなければならない。結果テキストを切り捨てたときは、切り捨ての表記と全文のパスを結果に含める。(SHALL)
value は、循環参照・関数・undefined を含む値も例外を出さずに文字列化しなければならない。(SHALL)

#### Scenario: ツール登録と実行
- **WHEN** pi にパッケージを拡張ロードし、tsrepl を `{ code: "print(1); return 2" }` で呼ぶ
- **THEN** 結果テキストに printed の `1` と value の `2` が含まれ、ツール結果はエラーとして扱われない

#### Scenario: timeout を省略した実行
- **WHEN** pi にパッケージを拡張ロードし、tsrepl を `{ code: "return 1" }`(timeout なし)で呼ぶ
- **THEN** 結果テキストに value の `1` が含まれ、打ち切りの表記は含まれない

#### Scenario: 失敗時の結果
- **WHEN** tsrepl を `{ code: "throw new Error('boom')" }` で呼ぶ
- **THEN** 結果テキストは error だけで `boom` を含み、ツール結果はエラーとして扱われる

#### Scenario: 循環参照を含む value
- **WHEN** セル `const o: any = { n: 1 }; o.self = o; return o` を実行する
- **THEN** error は返らず、value のテキストに `n` と循環参照を示す表記が含まれる

### Requirement: コンテキストのグローバル
システムは、セルのコンテキストに、ECMAScript の組込オブジェクトとホスト関数に加えて、`setTimeout` / `clearTimeout` / `fetch` / `URL` / `TextEncoder` / `TextDecoder` / `structuredClone` だけを提供しなければならない。(SHALL)
`process` / `Bun` / `require` / `console` を含め、それ以外のホストのグローバルを提供してはならない。(MUST)
セルの実行結果として `globalThis` に置かれる値(直前の value の保持の要件の `_` を含む)は、ホストのグローバルではない。

#### Scenario: 許可したグローバル
- **WHEN** セル `return [setTimeout, clearTimeout, fetch, URL, TextEncoder, TextDecoder, structuredClone].map((f) => typeof f).join(",")` を実行する
- **THEN** value はすべて `function` を並べた文字列になる

#### Scenario: 提供しないグローバル
- **WHEN** セル `return [typeof process, typeof Bun, typeof require].join(",")` を実行する
- **THEN** value は `"undefined,undefined,undefined"` になる

#### Scenario: Transpiler が注入し得る識別子
- **WHEN** セル `return [typeof __dirname, typeof __filename, typeof module, typeof exports].join(",")` を実行する
- **THEN** value は `"undefined,undefined,undefined,undefined"` になる

## ADDED Requirements

### Requirement: 同期実行の watchdog
システムは、セルの最初の `await` より前の同期実行に対して、セル全体の timeout とは別に同期実行の watchdog を適用しなければならない。同期実行の watchdog は既定 30000ms とし、セル全体の timeout を指定した場合はその値と 30000ms の小さい方とする。(SHALL)
同期実行の watchdog による打ち切りは、セル全体の timeout による打ち切りと区別できる error とし、同期実行が上限を超えた旨と、処理を `await` を含む単位へ分割する提案を含めなければならない。この error にも、timeout の要件が定める 3 項目(打ち切った旨、部分実行によりコンテキストが不整合になり得る旨、`reset: true` で初期化できる旨)を含めなければならない。(SHALL)

#### Scenario: watchdog は指定 timeout に追従する
- **WHEN** timeout 1000 でセル `while (true) {}` を実行する
- **THEN** 1000ms までに打ち切られ、error に同期実行の上限を超えた旨と、処理を分割する提案が含まれる

#### Scenario: timeout 未指定でも watchdog が掛かる
- **WHEN** timeout を指定せずにセル `while (true) {}` を実行する
- **THEN** 30000ms までに打ち切られ、error に同期実行の上限を超えた旨と、`reset: true` の案内が含まれる

#### Scenario: 大きい timeout でも watchdog は 30000ms
- **WHEN** timeout 120000 でセル `while (true) {}` を実行する
- **THEN** 120000ms を待たず 30000ms までに打ち切られ、同期実行の上限を超えた旨が error に含まれる

### Requirement: 直前の value の保持
システムは、value を返して成功したセルの値を、永続コンテキストの `globalThis._` に設定しなければならない。(SHALL)
value を返さないセル、および error になったセルは `_` を変えてはならない。コンテキストの再生成は `_` も消さなければならない。(SHALL)

#### Scenario: 直前の value を読む
- **WHEN** セル `return 40 + 2` の後に別セル `return _` を実行する
- **THEN** 後続セルの value は `42` になる

#### Scenario: 計算の間にも使う
- **WHEN** セル `return [1, 2, 3]` の後に別セル `return _.length` を実行する
- **THEN** 後続セルの value は `3` になる

#### Scenario: value 無しセルは変えない
- **WHEN** セル `return 7` の後に別セル `print("side")` を実行し、続けて別セル `return _` を実行する
- **THEN** printed は `side` で、3 つ目の value は `7` のままになる

#### Scenario: error セルは変えない
- **WHEN** セル `return 7` の後に別セル `throw new Error("x")` を実行し、続けて別セル `return _` を実行する
- **THEN** 2 つ目のセルは error になり、3 つ目の value は `7` のままになる

#### Scenario: reset で消える
- **WHEN** セル `return 7` を実行した後、reset:true でセル `return typeof _` を実行する
- **THEN** value は `"undefined"` になる

### Requirement: ツール一覧と規則への掲載
システムは、tsrepl ツールに 1 行の promptSnippet を宣言し、モデルへ渡すシステムプロンプトのツール一覧に tsrepl を掲載しなければならない。(SHALL)
システムは、tsrepl ツールに promptGuidelines として次の 2 項目だけを宣言し、システムプロンプトの規則に追加しなければならない。(SHALL)
- 2 つ以上のコマンドを続けて実行する、出力の一部だけを取り出す、または結果を次の手順で使う場合は tsrepl を使う
- 1 回だけ実行して出力をそのまま読むコマンドは bash を使う

promptSnippet はどのセッションの tsrepl でも宣言する。promptGuidelines は、`rlm` が生成する子セッションの tsrepl では空とし、それ以外のセッションの tsrepl では上記 2 項目を宣言する。(SHALL)

#### Scenario: ツール一覧への掲載
- **WHEN** 登録された tsrepl ツールの promptSnippet を取得する
- **THEN** 空ではなく、改行を含まない 1 行である

#### Scenario: 規則への掲載
- **WHEN** 登録された tsrepl ツールの promptGuidelines を取得する
- **THEN** 項目数は 2 で、連続実行・部分抽出・次の手順への受け渡しに基づく基準と、単発で出力をそのまま読むコマンドは bash を使う基準が含まれる

#### Scenario: 子の tsrepl は規則を宣言しない
- **WHEN** `rlm` が生成する子セッションの tsrepl の promptSnippet と promptGuidelines を取得する
- **THEN** promptSnippet は親と同じく空でなく、promptGuidelines は空である

### Requirement: セル実行ログの記録
システムは、`pi` の `appendEntry` を渡されて作られた tsrepl ツールについて、セルを 1 回実行するごとに、カスタムエントリ `tsrepl_cell` をセッションへ 1 件記録しなければならない。LLM のコンテキストへは送ってはならない。(SHALL)
記録に失敗してもセルの結果を変えてはならない。(MUST) `appendEntry` を渡されない tsrepl(`rlm` の子セッションを含む)は記録しない。

#### Scenario: 成功セルの記録
- **WHEN** `appendEntry` を渡された tsrepl で、セル `return 1` を実行する
- **THEN** `tsrepl_cell` エントリが 1 件追加され、`outcome` が `ok`、`timeoutMs` が null、`toolCalls` が空、`underscoreSet` が真になる

#### Scenario: 記録に失敗してもセルは成功する
- **WHEN** `appendEntry` が例外を投げる状態でセル `return 1` を実行する
- **THEN** セルの結果は成功で、value は `1` になる

#### Scenario: appendEntry の無い tsrepl
- **WHEN** `appendEntry` を渡さずに作った tsrepl でセルを実行する
- **THEN** `tsrepl_cell` エントリは記録されない

### Requirement: セル実行ログに中身を含めない
システムは、セルのコード、value、printed、結果テキスト、`tool()` の引数を、`tsrepl_cell` エントリに含めてはならない。(MUST) 記録するのは文字数と分類だけとする。

#### Scenario: 中身を記録しない
- **WHEN** セル `print("secret-token"); return "secret-value"` を実行する
- **THEN** エントリのどのフィールドにも `secret-token` と `secret-value` は含まれない

### Requirement: セル実行ログの実行フィールド
システムは、`tsrepl_cell` エントリに次のフィールドを持たせなければならない。(SHALL)
- `outcome`: `ok` / `error` / `timeout_cell` / `timeout_sync` / `aborted` のいずれか
- `durationMs`: セルの実行開始から結果が確定するまでの経過時間
- `timeoutMs`: クランプ後の timeout。省略したときは null
- `reset`: `reset: true` が指定されたか
- `codeChars`、`valueChars`、`printedChars`、`outputChars`: セルのコード、value、printed、整形後の結果テキスト全体の文字数

#### Scenario: 打ち切りの区別
- **WHEN** timeout 500 でセル `while (true) {}` を実行し、別に timeout 500 でセル `await new Promise((r) => setTimeout(r, 60000))` を実行する
- **THEN** 記録の `outcome` は 1 件目が `timeout_sync`、2 件目が `timeout_cell` になる

#### Scenario: timeout の記録
- **WHEN** timeout 1e12 を指定したセルと、timeout を省略したセルを実行する
- **THEN** `timeoutMs` は 1 件目が 2147483647、2 件目が null になる

### Requirement: セル実行ログの出力と tool() のフィールド
システムは、`tsrepl_cell` エントリに次のフィールドを持たせなければならない。(SHALL)
- `truncated` と `spill`: 出力を切り捨てたか、全文の保存結果(`saved` / `failed` / null)
- `underscoreSet`: セルの値を `_` に設定したか
- `toolCalls`: セル内の `tool()` 呼び出しごとの `{ name, isError, structured, exitCode, threw }`。`exitCode` は構造化結果に整数の `exit_code` があるときだけ、それ以外は null。`threw` は `tool()` が例外を投げたか

#### Scenario: tool() 呼び出しの記録
- **WHEN** outputSchema を宣言したツール `sh` が `isError` 真で `{ exit_code: 2 }` を返す環境で、セル `await tool("sh", {}); await tool("no_such_tool", {})` を実行する
- **THEN** `toolCalls` は 2 件で、1 件目は `isError` 真・`structured` 真・`exitCode` 2・`threw` 偽、2 件目は `threw` 真になる

#### Scenario: 切り捨ての記録
- **WHEN** セル `print("x".repeat(120000))` を実行する
- **THEN** `truncated` が真で、`spill` が `saved` になる
