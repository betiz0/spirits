# rlm Specification

## Purpose

永続 TypeScript REPL のセルから子エージェントを同期的に起動できる再帰呼び出し `rlm(prompt)` を提供し、モデルがコードから仕事を分割・委譲できるようにする。spirits の code-as-action 実行面における再帰の基盤であり、M4 / M5 はこの同期・文字列返却の契約の上に積まれる。

## Requirements

### Requirement: rlm ホスト関数の公開と戻り値
システムは、tsrepl のセルから `rlm(prompt, opts?)` を呼び出せるようにしなければならない。(SHALL)
`rlm` は `Promise<string>` を返し、子エージェントの最終アシスタントメッセージのテキストを返さなければならない。(SHALL)
呼び出し側のセルは `await rlm(...)` で子の完了を待てなければならない。(SHALL)
`opts` は省略可能で、`maxDepth`(数値)だけを受け付けなければならない。(SHALL)
`rlm` は tsrepl が後段フェーズ向けに提供するホスト関数の登録口を経由して公開し、REPL コアのホスト関数登録方式を変更してはならない。(MUST)

#### Scenario: 子の最終回答を返す
- **WHEN** 子セッションが最終アシスタントメッセージとして文字列 `"5"` を返す状態で、セル `return await rlm("2+3は?")` を実行する
- **THEN** 結果の value は文字列 `"5"` になり、error は返らない

#### Scenario: セルからの await
- **WHEN** セル `const a = await rlm("x"); return typeof a` を実行する
- **THEN** value は `"string"` になる

#### Scenario: REPL コアの互換
- **WHEN** `rlm` 登録後の tsrepl で、`rlm` を使わない既存のセル(`globalThis.x = 1` の後に `return x`)を実行する
- **THEN** value は `1` になり、M1 の tsrepl の振る舞いが変わらない

### Requirement: 引数の検証
システムは、`rlm` の引数が次のいずれかに当たる場合、子を生成せずに、不正な引数とその理由を含む例外をセル内に投げなければならない。(SHALL)
- `prompt` が文字列でない、または空もしくは空白のみである
- `opts` が省略されておらず、オブジェクトでない(`null` と配列を含む)
- `opts` が `maxDepth` 以外のキーを持つ
- `opts.maxDepth` が指定されていて、有限の非負整数でない

#### Scenario: prompt が文字列でない
- **WHEN** セル `await rlm(42)` を実行する
- **THEN** 子セッションは生成されず、error に prompt が文字列でない旨が含まれる

#### Scenario: prompt が空
- **WHEN** セル `await rlm("   ")` を実行する
- **THEN** 子セッションは生成されず、error に prompt が空である旨が含まれる

#### Scenario: 未知のオプション
- **WHEN** セル `await rlm("x", { model: "other" })` を実行する
- **THEN** 子セッションは生成されず、error に未知のキー `model` が含まれる

#### Scenario: opts がオブジェクトでない
- **WHEN** セル `await rlm("x", null)` を実行する
- **THEN** 子セッションは生成されず、error に opts がオブジェクトでない旨が含まれる

#### Scenario: maxDepth が不正
- **WHEN** `opts.maxDepth` に `NaN`、`-1`、`1.5`、`"2"` をそれぞれ指定して `await rlm("x", { maxDepth: <値> })` を実行する
- **THEN** いずれも子セッションは生成されず、error に `maxDepth` が有限の非負整数でない旨が含まれる

### Requirement: 深度上限
システムは、ルートセッションの深度を 0 とし、`rlm` が生成する子の深度を呼び出し側の深度 + 1 としなければならない。(SHALL)
システムは、深度 d のセッションの tsrepl から `rlm` が呼ばれ、そのセッションに適用されている上限 L(ルートセッションでは 2)に対して d が L 以上である場合、子を生成せずに、上限値 L と、問題を分割せず現在の層で処理するよう促すガイダンスを含む例外をセル内に投げなければならない。(SHALL)
`opts.maxDepth` は、生成する子とその子孫に適用される上限を、ルートからの絶対深度で表さなければならない。呼び出し側に適用されている上限より大きい値は、その上限に丸めなければならず、上限を引き上げてはならない。(SHALL)
M3 は、ルートセッションの上限 2 を変更する手段を提供しない。

#### Scenario: 深度上限でのエラー
- **WHEN** 深度 2 のセッション(適用されている上限 2)の tsrepl で `await rlm("x")` を実行する
- **THEN** 子セッションは生成されず、error に上限値 `2` と、現在の層で処理するよう促すガイダンスが含まれる

#### Scenario: 深度 2 までの入れ子
- **WHEN** ルートセッション(深度 0)の `rlm` が深度 1 の子を生成し、その子の `rlm` が深度 2 の孫を生成し、その孫が `rlm` を呼ぶ
- **THEN** 深度 0 と深度 1 のセッションからの `rlm` は成功し、深度 2 のセッションからの `rlm` は深度上限のガイダンス付きエラーになる

#### Scenario: opts.maxDepth による引き下げ
- **WHEN** ルートセッションが `rlm("x", { maxDepth: 1 })` を呼び、生成された深度 1 の子が `rlm` を呼ぶ
- **THEN** 深度 1 のセッションからの `rlm` は、上限値 `1` を含む深度上限のガイダンス付きエラーになる

#### Scenario: opts.maxDepth が 0
- **WHEN** ルートセッションが `rlm("x", { maxDepth: 0 })` を呼び、生成された深度 1 の子が `rlm` を呼ぶ
- **THEN** ルートからの呼び出しは成功し、深度 1 のセッションからの `rlm` は上限値 `0` を含む深度上限のガイダンス付きエラーになる

#### Scenario: opts.maxDepth による引き上げの丸め
- **WHEN** ルートセッションが `rlm("x", { maxDepth: 5 })` を呼び、生成された深度 1 の子の `rlm` が深度 2 の孫を生成し、その孫が `rlm` を呼ぶ
- **THEN** 深度 0 と深度 1 のセッションからの `rlm` は成功し、深度 2 のセッションからの `rlm` は上限値 `2` を含む深度上限のガイダンス付きエラーになる

### Requirement: 子セッションの構成
システムは、`rlm` の子セッションを、親セッションのモデル(親に thinking level が設定されていればそれも)を継承し、cwd を共有し、ツール構成を `tsrepl` のみとする形で生成しなければならない。(SHALL)
子セッションは、拡張・skill・プロンプトテンプレートを読み込んではならず、AGENTS.md などのコンテキストファイルは読み込まなければならない。(MUST)

#### Scenario: 子のツール構成
- **WHEN** `rlm` が生成する子セッションの有効ツール名を取得する
- **THEN** `tsrepl` だけが含まれ、`read` / `bash` / `edit` / `write` は含まれない

#### Scenario: モデルと cwd の継承
- **WHEN** 親の cwd が `/work`、モデルが provider `p` の id `m`、thinking level が `high` の状態で `rlm` を呼ぶ
- **THEN** 子セッションの生成条件に、cwd `/work`、provider `p` の id `m` のモデル、thinking level `high` が渡される

#### Scenario: thinking level が未設定
- **WHEN** 親に thinking level が設定されていない状態で `rlm` を呼ぶ
- **THEN** 子セッションの生成条件に thinking level は渡されない

#### Scenario: 外部リソースの非読込
- **WHEN** `rlm` が生成する子セッションが読み込むリソースの設定を取得する
- **THEN** 拡張・skill・プロンプトテンプレートは無効で、コンテキストファイルは無効化されていない

### Requirement: 子セッションの認証と親モデル
子セッションの認証は、親と同じエージェントディレクトリの認証情報・モデル定義と環境変数に基づかなければならない。親に `--api-key` で与えた認証と、拡張が登録したプロバイダは継承しない。(SHALL)
親セッションにモデルが設定されていない場合、システムは子を生成せずに、モデル未設定を示す例外をセル内に投げなければならない。(SHALL)

#### Scenario: 親のモデルが未設定
- **WHEN** 親セッションにモデルが設定されていない状態でセル `await rlm("x")` を実行する
- **THEN** 子セッションは生成されず、error にモデルが設定されていない旨が含まれる

### Requirement: 子セッションのコンテキスト分離
子セッションの `tsrepl` は、親の REPL 変数を引き継がず、独立した永続コンテキストを持たなければならない。(SHALL)
子セッションの `tsrepl` には、親の深度 +1 で `rlm` を公開しなければならない。(SHALL)

#### Scenario: 親変数の非参照
- **WHEN** 親セッションで `globalThis.shared = 1` を設定した後に `rlm` を呼び出し、子の `tsrepl` で `return typeof shared` を実行する
- **THEN** 子の value は `"undefined"` になる

#### Scenario: 子での再帰呼び出し
- **WHEN** 深度 0 の `rlm` が生成した子セッションのセルで `return typeof rlm` を実行する
- **THEN** value は `"function"` になる

### Requirement: 子セッションの失敗の伝達
システムは、子セッションの生成の失敗、prompt の失敗、および子の最終アシスタントメッセージがプロバイダエラーで終わった場合を、原因を含む例外としてセル内に投げなければならない。(SHALL)

#### Scenario: 子セッション生成の失敗
- **WHEN** 子セッションの生成または prompt が失敗する状態でセル `await rlm("x")` を実行する
- **THEN** 結果は error になり、失敗の原因が含まれる

#### Scenario: プロバイダエラーでの終了
- **WHEN** 子の最終アシスタントメッセージが、stopReason `error`、エラーメッセージ `rate limit` で終わる状態でセル `await rlm("x")` を実行する
- **THEN** 結果は error になり、`rate limit` が含まれる

### Requirement: rlm の使い方の案内
システムは、`rlm` を登録した tsrepl のツール説明に、`rlm` の使い方を含めなければならない。(SHALL) 含める内容は次のとおり。
- `await rlm(prompt)` の形で呼び、子の最終回答が文字列で返ること
- 子は親の REPL 変数を見られず、必要な情報は prompt か cwd 配下のファイルで渡すこと。子のツールは `tsrepl` だけであること
- 結果が長い場合は、子にファイルへ書かせてパスを返させること
- 委譲の基準(文脈量の多い調査や独立した実装は委譲し、単発で既知の操作は自分で実行すること)

#### Scenario: ルートセッションの使い方の案内
- **WHEN** `rlm` を登録したルートセッション(深度 0、上限 2)の tsrepl のツール説明を取得する
- **THEN** 説明に `await rlm(`、文字列が返る旨、子は親の REPL 変数を見られない旨が含まれる

### Requirement: rlm の制約の案内
システムは、`rlm` を登録した tsrepl のツール説明に、`rlm` の制約を含めなければならない。(SHALL) 含める内容は次のとおり。
- 呼び出しが直列に実行され、待ち時間が合計されること。セルの timeout が子の実行時間にも適用されるため、`timeout` を大きく指定すること
- 深度上限の値と、そのセッションの深度
- 子のツール呼び出し回数の上限

#### Scenario: ルートセッションの制約の案内
- **WHEN** `rlm` を登録したルートセッション(深度 0、上限 2)の tsrepl のツール説明を取得する
- **THEN** 説明に `timeout`、直列に実行される旨、深度上限 `2`、ツール呼び出し回数の上限 `50` が含まれる

### Requirement: 深度と登録状況に応じた案内
システムは、`rlm` を呼べない深度のセッション(深度が上限以上)のツール説明には、`rlm` の使い方を含めず、深度上限により `rlm` を呼べない旨だけを含めなければならない。(SHALL)
システムは、`rlm` で起動された子(深度 1 以上)のツール説明に、親エージェントが `rlm` で起動した子であること、最終アシスタントメッセージのテキストが親へ文字列として返ることを含めなければならない。(SHALL)
`rlm` を登録していない tsrepl のツール説明は、M1 から変えてはならない。(MUST)

#### Scenario: 深度上限に達したセッションの案内
- **WHEN** 深度 2(上限 2)のセッションの tsrepl のツール説明を取得する
- **THEN** 説明に深度上限により `rlm` を呼べない旨が含まれ、`await rlm(` の使用例は含まれない

#### Scenario: 子向けの案内
- **WHEN** 深度 1 の子セッションの tsrepl のツール説明を取得する
- **THEN** 説明に、親が `rlm` で起動した子である旨と、最終アシスタントメッセージが親へ文字列で返る旨が含まれる

#### Scenario: rlm を登録しない tsrepl の説明
- **WHEN** `rlm` を登録せずに作成した tsrepl のツール説明を取得する
- **THEN** 説明は M1 のツール説明と同一である

### Requirement: rlm 呼び出しの直列化
システムは、同じ tsrepl(同じ REPL)から呼ばれた `rlm` を 1 つずつ直列に実行し、その REPL から生成した子セッションを同時に 2 つ以上動かしてはならない。(SHALL)
先行する呼び出しが終わるまで、後続の呼び出しは待機しなければならない。待機中の呼び出しが親セルの中断シグナルの abort で打ち切られた場合、子を生成せずに終了しなければならない。(SHALL)
直列化は REPL ごとに行い、異なる深度のセッションの `rlm` を互いに待ち合わせてはならない。(MUST)

#### Scenario: 並行呼び出しの直列化
- **WHEN** セル `return await Promise.all([rlm("a"), rlm("b")])` を実行する
- **THEN** 1 つ目の子の完了後に 2 つ目の子が生成され、子セッションが同時に 2 つ動く瞬間は無く、value は 2 つの子の回答を呼び出し順に並べた配列になる

#### Scenario: 待機中の呼び出しの打ち切り
- **WHEN** 1 つ目の子の実行中に、2 つ目の `rlm` が待機している状態で親セルの中断シグナルが abort される
- **THEN** 2 つ目の子セッションは生成されない

#### Scenario: 深度間の非待ち合わせ
- **WHEN** 深度 0 の `rlm` が生成した子の実行中に、その子(深度 1)の tsrepl が `rlm` を呼ぶ
- **THEN** 子の `rlm` は深度 0 の呼び出しの完了を待たずに実行される

### Requirement: 親 abort の伝播
システムは、親セルの中断シグナルが abort された場合、実行中の子セッションを abort し、その完了を待ってから子セッションを破棄しなければならない。(SHALL)
親セルの中断シグナルには、呼び出し元のツール呼び出しの中断と、セルの timeout による打ち切りの両方を含める。(SHALL)
中断時のセルの結果は、tsrepl の timeout と中断の要件に従わなければならない。(SHALL)
子セッションの生成中に中断シグナルが abort された場合、子への prompt を開始してはならず、生成済みの子セッションを破棄しなければならない。(MUST)

#### Scenario: 親中断で子を abort
- **WHEN** 子の実行中に、呼び出し元のツール呼び出しの中断シグナルが abort される
- **THEN** 子セッションの abort が呼ばれ、セルの error に呼び出し元の中断で打ち切った旨が含まれる

#### Scenario: セルの timeout で子を abort
- **WHEN** timeout 500 でセル `await rlm("x")` を実行し、子が 500ms を超えて実行中である
- **THEN** 子セッションの abort が呼ばれ、セルの error に timeout で打ち切った旨と `reset: true` の案内が含まれる

#### Scenario: 子セッションの生成中の abort
- **WHEN** 子セッションの生成中(子への prompt の開始前)に親セルの中断シグナルが abort される
- **THEN** 子への prompt は開始されず、生成済みの子セッションは破棄され、`rlm_usage` の `outcome` は `aborted` になる

#### Scenario: 中断の非伝播
- **WHEN** 子の実行中に親セルの中断シグナルが abort されない
- **THEN** 子セッションの abort は呼ばれず、`rlm` は子の最終回答を返す

### Requirement: 子のツール呼び出し回数上限
システムは、1 回の `rlm` 呼び出しあたりの子セッションのツール呼び出し回数に上限(既定 50)を設け、上限を超える回数目の呼び出しが始まった時点で子を打ち切らなければならない。(SHALL)
打ち切り時、`rlm` は上限超過の旨と打ち切り時点で得られた子の部分的なアシスタントテキストを、途中結果サマリとして返さなければならない。(SHALL)

#### Scenario: 上限超過での打ち切り
- **WHEN** 子が 51 回目のツール呼び出しを開始する状態で、`await rlm("x")` を実行する
- **THEN** 子は打ち切られ、戻り値に上限 `50` を超えた旨と部分的なテキストが含まれる

#### Scenario: 上限ちょうどでの完了
- **WHEN** 子がツール呼び出しをちょうど 50 回行って最終回答 `"done"` で完了する
- **THEN** 子は打ち切られず、`rlm` は `"done"` を返す

#### Scenario: 上限内での完了
- **WHEN** 子のツール呼び出し回数が 3 回で完了する
- **THEN** 子は打ち切られず、`rlm` は子の最終回答を返す

### Requirement: rlm_usage の記録単位と記録先
システムは、`rlm` の呼び出し 1 回につき `rlm_usage` カスタムエントリを 1 件、ルートセッション(深度 0)に記録しなければならない。深度 1 以上のセッションから呼ばれた `rlm` の記録も、ルートセッションに追加しなければならない。(SHALL)

#### Scenario: 入れ子の呼び出しの記録先
- **WHEN** ルートセッションの `rlm` が生成した深度 1 の子が、`rlm` で深度 2 の孫を生成して完了する
- **THEN** ルートセッションに `depth` 1 と `depth` 2 の `rlm_usage` エントリが追加され、子セッションにはエントリが追加されない

### Requirement: rlm_usage のフィールド
`rlm_usage` エントリは次を含まなければならない。(SHALL)
- `depth`: その呼び出しが生成する(した)子の深度(呼び出し側の深度 + 1、1 以上)
- `sessionId`: 子セッションの識別子。子を生成しなかった場合は null
- `provider` / `modelId`: 親のモデル。未設定なら null
- `tokens`: input / output / cacheRead / cacheWrite / total
- `cost`
- `durationMs`: 呼び出しの開始から戻り(または例外)までの経過時間。直列化の待機時間を含む
- `outcome`: `completed` / `aborted` / `budget` / `error` のいずれか

#### Scenario: 完了時の記録
- **WHEN** ルートセッションの `rlm` が生成した子が、input 100、output 20、total 120 のトークンとコスト 0.01 を使って完了する
- **THEN** ルートセッションの JSONL に `depth` 1、子の `sessionId`、上記の tokens と cost、数値の `durationMs`、`outcome` `completed` を持つ `rlm_usage` エントリが 1 件追加される

### Requirement: rlm_usage の記録規則
システムは、子セッションを生成していれば、完了・中断・上限超過・エラーのいずれでも、その時点までの tokens と cost を記録しなければならない。(SHALL)
子セッションを生成しなかった呼び出し(引数の不正、深度上限、親のモデル未設定、子セッション生成の失敗)は、`outcome` を `error`、`sessionId` を null、tokens と cost を 0 として記録しなければならない。直列化の待機中に中断された呼び出しは、`outcome` を `aborted`、`sessionId` を null として記録しなければならない。(SHALL)
`rlm_usage` は LLM のコンテキストへ送ってはならない。(MUST)

#### Scenario: 中断時の記録
- **WHEN** 子の実行中に親セルの中断シグナルが abort される
- **THEN** 中断時点までの tokens と cost を持ち、`outcome` が `aborted` の `rlm_usage` エントリが追加される

#### Scenario: 上限超過時の記録
- **WHEN** 子がツール呼び出し回数の上限で打ち切られる
- **THEN** `outcome` が `budget` の `rlm_usage` エントリが追加される

#### Scenario: 子を生成しなかった呼び出しの記録
- **WHEN** 深度 2 のセッションの tsrepl で `rlm` を呼び、深度上限のエラーになる
- **THEN** `depth` 3、`sessionId` null、tokens と cost が 0、`outcome` が `error` の `rlm_usage` エントリが追加される

#### Scenario: 子のエラー時の記録
- **WHEN** 子がプロバイダエラーで終わるまでに input 50 のトークンを使った
- **THEN** tokens の input が 50 で、`outcome` が `error` の `rlm_usage` エントリが追加される

#### Scenario: 子セッションの異常終了時の記録
- **WHEN** 子セッションの実行が、結果ではなく例外で終わる(後始末の失敗を含む)
- **THEN** `rlm_usage` エントリが 1 件追加され、`outcome` は `error` になる

#### Scenario: コンテキストへの非注入
- **WHEN** `rlm_usage` エントリを追加した後の親セッションのメッセージ列を取得する
- **THEN** `rlm_usage` の内容はメッセージ列に含まれない

### Requirement: 後段フェーズ機能への非依存
`rlm` は M3 までに定義した機能(tsrepl のホスト関数登録口、Pi SDK の子セッション生成、M2 の配布基盤)にのみ依存し、M4 の memory / skill や M5 の非同期 fan-out の機能を import・参照してはならない。(MUST)
システムは、子セッションへ M4 の memory / skill を自動配線してはならない。(MUST)
`rlm` の公開契約は文字列を返す同期呼び出しに限り、非同期ハンドルや回収用の公開 API を提供してはならない。(MUST)

#### Scenario: 後段機能の非参照
- **WHEN** `packages/spirits/src/rlm/` の import 指定子を列挙する
- **THEN** memory / skill / harness / 非同期 fan-out のモジュールへの import が存在しない

#### Scenario: 子への memory / skill 非配線
- **WHEN** `rlm` が生成する子セッションの `tsrepl` に公開されるホスト関数名を列挙する
- **THEN** 名前は `out` / `print` / `use` / `tool` / `rlm` のちょうど 5 つで、M4 由来の関数は含まれない

#### Scenario: 公開契約が文字列のみ
- **WHEN** `rlm` の戻り値を調べる
- **THEN** 戻り値は文字列に解決される Promise で、ハンドル型ではない
