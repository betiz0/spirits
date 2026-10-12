# session-clear Specification

## Purpose

Provide a `/clear` command in the interactive TUI that removes the current conversation from the LLM context while keeping the session file, model selection, thinking level, and extension state such as TODO items, so users can start fresh without reconfiguring and without losing earlier history.

## Requirements

### Requirement: /clear は会話を LLM 文脈とチャット表示から外す
システムは対話 TUI の `/clear` 実行時に、現在のブランチの会話を以後の LLM 要求とチャット表示から外さなければならない。ここでの会話は、ユーザーメッセージ、アシスタントメッセージ、ツール結果、拡張が送ったメッセージ、compaction 要約、branch 要約を指す。(SHALL)

#### Scenario: 次の要求に以前の会話が含まれない
- **GIVEN** 2 往復の会話と compaction 要約が現在のブランチにある
- **WHEN** ユーザーが `/clear` の後に「hello」を送る
- **THEN** LLM 要求のメッセージは「hello」のユーザーメッセージ 1 件だけになる

#### Scenario: チャット表示のクリア
- **WHEN** ユーザーが `/clear` を実行する
- **THEN** チャット表示から以前の会話が消え、クリアが完了した旨のメッセージだけが表示される

#### Scenario: 会話が無い状態での実行
- **GIVEN** 現在のブランチにメッセージが無い
- **WHEN** ユーザーが `/clear` を実行する
- **THEN** エラーは表示されず、モデル、思考レベル、TODO は変わらない

### Requirement: /clear は以前の会話を削除しない
システムは `/clear` で以前の会話をセッションファイルから削除してはならない。以前の会話は `/tree` から選択して戻れなければならない。(MUST)

#### Scenario: `/tree` で以前の会話に戻る
- **GIVEN** 会話 M1〜M4 の後に `/clear` を実行した
- **WHEN** ユーザーが `/tree` で M4 を選択する
- **THEN** M1〜M4 が LLM 文脈とチャット表示に戻る

### Requirement: /clear は同じセッションファイルと ID を使い続ける
システムは `/clear` で新しいセッションファイルを作らず、セッション ID とセッションファイルのパスを変えてはならない。セッションを再開したときは、`/clear` 後のブランチを現在のブランチとしなければならない。(MUST)

#### Scenario: ID とパスの継続
- **WHEN** ユーザーが `/clear` を実行する
- **THEN** セッション ID とセッションファイルのパスは実行前と同じである

#### Scenario: 再開時は `/clear` 後のブランチ
- **GIVEN** `/clear` の後に「hello」を送り、終了した
- **WHEN** ユーザーが同じセッションを再開する
- **THEN** チャット表示と LLM 文脈には「hello」以降の会話だけが含まれる

### Requirement: /clear は拡張がセッションに保存した状態を保持する
システムは `/clear` 実行時に、現在のブランチ上で拡張がセッションに保存した状態の記録をすべて、元の順序のまま新しいブランチへ引き継がなければならない。(SHALL)

#### Scenario: TODO の保持
- **GIVEN** 未完了の TODO ID 1 と完了の TODO ID 2 があり、次の採番は 3 である
- **WHEN** ユーザーが `/clear` を実行する
- **THEN** TODO パネルの表示は変わらず、次に追加される項目には ID 3 が割り当てられる

#### Scenario: 明示ゴールの保持
- **GIVEN** `goal("ship v1")` でゴールを設定した
- **WHEN** ユーザーが `/clear` を実行した後に `goal()` を呼ぶ
- **THEN** 「ship v1」が返る

### Requirement: /clear はモデル設定を保持する
システムは `/clear` 実行時に、現在のモデルと思考レベルを変えてはならない。また、`/clear` 後のブランチを再開したときに、同じモデルと思考レベルが復元されなければならない。(MUST)

#### Scenario: セッション限定のモデル選択の保持
- **GIVEN** 既定値として保存せずにモデル X と思考レベル high を選択した
- **WHEN** ユーザーが `/clear` を実行し、終了してから同じセッションを再開する
- **THEN** `/clear` 直後も再開後も、モデルは X、思考レベルは high である

### Requirement: /clear はコンテキスト使用量を 0 にする
システムは `/clear` 直後のフッターのコンテキスト使用量を 0 トークンとして表示しなければならない。(SHALL)

#### Scenario: コンテキスト使用量の表示
- **GIVEN** モデルが選択され、フッターのコンテキスト使用量が 0 より大きい
- **WHEN** ユーザーが `/clear` を実行する
- **THEN** フッターのコンテキスト使用量は 0 トークンを示す

### Requirement: 応答中と compaction 中の /clear は拒否される
システムは応答の生成中または compaction の実行中に `/clear` が入力された場合、警告を表示し、会話、ブランチ、送信待ちのメッセージを変えてはならない。(MUST)

#### Scenario: 応答中の拒否
- **GIVEN** アシスタントが応答を生成中で、送信待ちの follow-up メッセージが 1 件ある
- **WHEN** ユーザーが `/clear` を入力する
- **THEN** 応答の完了を待つよう求める警告が表示され、応答は継続し、送信待ちのメッセージも残る

#### Scenario: compaction 中の拒否
- **WHEN** compaction の実行中にユーザーが `/clear` を入力する
- **THEN** compaction の完了を待つよう求める警告が表示され、会話とブランチは変わらない

### Requirement: /clear は拡張の実行時状態を破棄しない
システムは `/clear` を拡張にセッションの開始や切り替えとして通知してはならず、拡張がメモリ上に持つ状態を保持しなければならない。(MUST)

#### Scenario: tsrepl の変数の保持
- **GIVEN** tsrepl でセル `globalThis.x = 1` を実行した
- **WHEN** ユーザーが `/clear` を実行し、その後 LLM が tsrepl でセル `return x` を実行する
- **THEN** 1 が返る
