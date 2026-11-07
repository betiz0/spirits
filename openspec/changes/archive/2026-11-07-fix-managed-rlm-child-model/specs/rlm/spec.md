# Spec Delta

## ADDED Requirements

### Requirement: 子セッションへ渡すモデルは物理モデル
システムは、子セッションへ渡すモデルとして、要求を振り向けるだけで単独ではリクエストできない仮想モデルを選んではならない。(MUST)
親セッションのモデルが物理モデルの場合、システムはそのモデルを子に渡さなければならない。(SHALL) 親セッションのモデルが仮想モデルの場合、システムは子の起動前に親の側で物理モデルへ解決しなければならない。(SHALL)
解決できない場合、システムは子セッションを生成せず、どの解決も使えなかったことを特定できる例外をセル内に投げなければならない。(SHALL)

#### Scenario: 解決した物理モデルで子を起動する
- **GIVEN** 親セッションが仮想モデルを選択していて、子の対象にできる物理モデルが解決できる
- **WHEN** セル `await rlm("x")` を実行する
- **THEN** 子セッションの生成条件には仮想モデルではなく解決された物理モデルが渡される

#### Scenario: 解決できない親では子を生成しない
- **GIVEN** 親セッションが仮想モデルを選択していて、子の対象にできる物理モデルが解決できない
- **WHEN** セル `await rlm("x")` を実行する
- **THEN** 子セッションは生成されず、error に解決できなかった旨と不足している設定が含まれる

#### Scenario: 他の拡張の仮想モデルを選ぶ親
- **GIVEN** 親セッションが spirits の振り分け対象ではない仮想モデルを選択している
- **WHEN** セル `await rlm("x")` を実行する
- **THEN** 子セッションは生成されず、error にその仮想モデルを子の対象にできない旨が含まれる

#### Scenario: 解決されたモデルの子も同じ規則を守る
- **GIVEN** 仮想モデルを選ぶ親が解決した物理モデルで起動した子(深度 1)がいる
- **WHEN** その子のセルから `rlm` を呼ぶ
- **THEN** 深度 2 の子には親(深度 1)の物理モデルがそのまま渡され、仮想モデルは渡されない

### Requirement: 解決失敗のセル内での扱い
システムは、子のモデル解決の失敗を、セル内で catch できる例外として返さなければならない。(SHALL) 解決の失敗が、子セッションのプロバイダエラーとして現れてはならない。(MUST) 解決の失敗は、同じ REPL の後続の `rlm` 呼び出しを妨げてはならない。(MUST)

#### Scenario: 解決失敗の catch
- **WHEN** 子のモデルが解決できない状態でセル `try { await rlm("x") } catch (e) { return String(e) }` を実行する
- **THEN** セルの error は返らず、value に解決失敗の旨が含まれる

#### Scenario: 解決失敗の後も次の呼び出しは進む
- **GIVEN** 子のモデルが解決できず、1 回目の `rlm("x")` が解決失敗で終わった
- **WHEN** 子のモデルが解決できる状態にして、同じ REPL で `rlm("y")` を呼ぶ
- **THEN** 2 回目は 1 回目の失敗に待たされず、子セッションを生成して回答を返す

## MODIFIED Requirements

### Requirement: 子セッションの構成
システムは、`rlm` の子セッションを、親セッションのモデル(親に thinking level が設定されていればそれも)を継承し、cwd を共有し、ツール構成を `tsrepl` のみとする形で生成しなければならない。(SHALL) ただし、親セッションのモデルが仮想モデルの場合に子が継承するのは、「子セッションへ渡すモデルは物理モデル」の要件で解決した物理モデルであり、仮想モデルそのものは継承しない。(MUST)
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

### Requirement: 子セッションの失敗の伝達
システムは、子セッションの生成の失敗、prompt の失敗、および子の最終アシスタントメッセージがプロバイダエラーで終わった場合を、原因を含む例外としてセル内に投げなければならない。(SHALL) 子セッションを生成できなかった場合、例外には試みた物理モデルの provider と id を含めなければならない。(SHALL)

#### Scenario: 子セッション生成の失敗
- **WHEN** 子セッションを生成できない状態でセル `await rlm("x")` を実行する
- **THEN** 結果は error になり、失敗の原因と試みた物理モデルの provider と id が含まれる

#### Scenario: プロバイダエラーでの終了
- **WHEN** 子の最終アシスタントメッセージが、stopReason `error`、エラーメッセージ `rate limit` で終わる状態でセル `await rlm("x")` を実行する
- **THEN** 結果は error になり、`rate limit` が含まれる

### Requirement: rlm_usage のフィールド
`rlm_usage` エントリは次を含まなければならない。(SHALL)
- `depth`: その呼び出しが生成する(した)子の深度(呼び出し側の深度 + 1、1 以上)
- `sessionId`: 子セッションの識別子。子を生成しなかった場合は null
- `provider` / `modelId`: 子セッションに実際に渡したモデル。子セッションを生成しなかった場合(引数の不正、深度上限、親のモデル未設定、解決失敗、子の生成失敗、生成前の中断を含む)は null
- `tokens`: input / output / cacheRead / cacheWrite / total
- `cost`
- `durationMs`: 呼び出しの開始から戻り(または例外)までの経過時間。直列化の待機時間を含む
- `outcome`: `completed` / `aborted` / `budget` / `error` のいずれか

#### Scenario: 完了時の記録
- **WHEN** ルートセッションの `rlm` が生成した子が、input 100、output 20、total 120 のトークンとコスト 0.01 を使って完了する
- **THEN** ルートセッションの JSONL に `depth` 1、子の `sessionId`、上記の tokens と cost、数値の `durationMs`、`outcome` `completed` を持つ `rlm_usage` エントリが 1 件追加される

#### Scenario: 解決したモデルの記録
- **GIVEN** 親セッションが仮想モデルを選択していて、子の対象が provider `p` の id `m` に解決される
- **WHEN** 子が完了する
- **THEN** `rlm_usage` の `provider` と `modelId` は `p` と `m` であり、親が選択していた仮想モデルの識別子は記録されない

### Requirement: rlm_usage の記録規則
システムは、子セッションを生成していれば、完了・中断・上限超過・エラーのいずれでも、その時点までの tokens と cost を記録しなければならない。(SHALL)
子セッションを生成しなかった呼び出し(引数の不正、深度上限、親のモデル未設定、子のモデルの解決失敗、子セッション生成の失敗)は、`outcome` を `error`、`sessionId` を null、`provider` と `modelId` を null、tokens と cost を 0 として記録しなければならない。直列化の待機中に中断された呼び出しは、`outcome` を `aborted`、`sessionId` を null、`provider` と `modelId` を null として記録しなければならない。(SHALL)
`rlm_usage` は LLM のコンテキストへ送ってはならない。(MUST)

#### Scenario: 中断時の記録
- **WHEN** 子の実行中に親セルの中断シグナルが abort される
- **THEN** 中断時点までの tokens と cost を持ち、`outcome` が `aborted` の `rlm_usage` エントリが追加される

#### Scenario: 上限超過時の記録
- **WHEN** 子がツール呼び出し回数の上限で打ち切られる
- **THEN** `outcome` が `budget` の `rlm_usage` エントリが追加される

#### Scenario: 子を生成しなかった呼び出しの記録
- **WHEN** 深度 2 のセッションの tsrepl で `rlm` を呼び、深度上限のエラーになる
- **THEN** `depth` 3、`sessionId` null、`provider` と `modelId` null、tokens と cost が 0、`outcome` が `error` の `rlm_usage` エントリが追加される

#### Scenario: 子セッション生成の失敗の記録
- **WHEN** 子セッションの生成が失敗する状態で `rlm` を呼ぶ
- **THEN** `sessionId` null、`provider` と `modelId` null、tokens と cost が 0、`outcome` が `error` の `rlm_usage` エントリが追加され、例外文に試みた物理モデルの provider と id が含まれる

#### Scenario: 解決失敗の記録
- **WHEN** 仮想モデルを選ぶ親のセルで `rlm` を呼び、子のモデルが解決できずにエラーになる
- **THEN** `sessionId` null、`provider` と `modelId` null、tokens と cost が 0、`outcome` が `error` の `rlm_usage` エントリが追加される

#### Scenario: 子のエラー時の記録
- **WHEN** 子がプロバイダエラーで終わるまでに input 50 のトークンを使った
- **THEN** tokens の input が 50 で、`outcome` が `error` の `rlm_usage` エントリが追加される

#### Scenario: 子セッションの異常終了時の記録
- **WHEN** 子セッションの実行が、結果ではなく例外で終わる(後始末の失敗を含む)
- **THEN** `rlm_usage` エントリが 1 件追加され、`outcome` は `error` になる

#### Scenario: コンテキストへの非注入
- **WHEN** `rlm_usage` エントリを追加した後の親セッションのメッセージ列を取得する
- **THEN** `rlm_usage` の内容はメッセージ列に含まれない
