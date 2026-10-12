# session-todo Specification

## Purpose

Provide a session-bound TODO list that the LLM manages through an explicit tool, shown in a panel at the bottom of the interactive screen, so users can track task progress across agent turns without losing it when the session or branch changes.

## Requirements

### Requirement: TODO は現在のセッションの現在のブランチに紐づく
システムは TODO 状態を、現在のセッションの現在のブランチ上で最後に保存された状態として解決しなければならない。(SHALL)

#### Scenario: 別セッションへの切り替え
- **GIVEN** セッション A に未完了の TODO「A1」があり、セッション B には TODO が無い
- **WHEN** ユーザーが `/resume` でセッション B に切り替える
- **THEN** TODO パネルは非表示になり、続く `manage_todos` の結果にも「A1」は含まれない

#### Scenario: `/tree` によるブランチ移動
- **GIVEN** 分岐点の後、ブランチ X で TODO「X1」が追加され、ブランチ Y では TODO が追加されていない
- **WHEN** ユーザーが `/tree` で Y の末端へ移動し、その後 X の末端へ戻る
- **THEN** Y へ移動した時点でパネルは非表示になり、X へ戻った時点で「X1」が再表示される

#### Scenario: fork による引き継ぎ
- **GIVEN** 未完了の TODO「F1」が保存された後の位置がある
- **WHEN** ユーザーがその位置から fork する
- **THEN** fork 先のセッションのパネルに「F1」が表示される

### Requirement: LLM はツールで TODO を管理する
システムは LLM が呼び出せる `manage_todos` ツールを全実行モード(interactive、print、RPC)で提供しなければならない。ツールは 1 回の呼び出しで、追加・テキスト更新・完了状態の変更・削除の操作を複数受け付け、指定順に適用しなければならない。(SHALL)

#### Scenario: 項目の追加と ID の採番
- **GIVEN** 現在のブランチに TODO が無い
- **WHEN** LLM が `manage_todos` でテキスト「Fix bug」と「Write test」の追加を 1 回で指示する
- **THEN** 2 項目が未完了として保存され、ID 1 と 2 がこの順に割り当てられ、ツール結果に ID・テキスト・完了状態を含む全項目が返る

#### Scenario: 削除した ID は再利用されない
- **GIVEN** ID 1 と 2 の項目があり、ID 2 を削除した
- **WHEN** LLM が新しい項目の追加を指示する
- **THEN** 新しい項目には ID 3 が割り当てられる

#### Scenario: 項目の完了と再開
- **GIVEN** 未完了の項目 ID 1 がある
- **WHEN** LLM が ID 1 を完了にし、別の呼び出しで未完了に戻す
- **THEN** 1 回目の後は完了状態、2 回目の後は未完了状態として保存され、パネルもそれに従う

#### Scenario: テキストの更新
- **WHEN** LLM が既存項目 ID 1 のテキストを「Fix login bug」に更新する
- **THEN** ID 1 のテキストだけが変わり、ID と完了状態は変わらない

#### Scenario: 項目の削除
- **WHEN** LLM が既存項目 ID 1 の削除を指示する
- **THEN** ID 1 は現在の TODO から消え、パネルからも消える

#### Scenario: print モードでの利用
- **WHEN** print モードで LLM が `manage_todos` で項目を追加する
- **THEN** 項目はセッションに保存され、同じセッションを対話 TUI で再開するとパネルに表示される

### Requirement: 不正な操作を含む呼び出しは何も適用しない
システムは `manage_todos` の 1 回の呼び出しに不正な操作が 1 つでも含まれる場合、その呼び出しのどの操作も適用せず、エラーとして結果を返さなければならない。結果には不正な操作の位置と理由を含めなければならない。(SHALL)

不正な操作は次のとおりとする。
- 存在しない ID の更新・削除。同じ呼び出しの前の操作で削除された ID を含む
- 空文字列または空白だけのテキストによる追加・更新
- テキストも完了状態も指定しない更新
- 操作が 0 件の呼び出し

#### Scenario: 存在しない ID を含む呼び出し
- **GIVEN** 未完了の項目 ID 1 だけがある
- **WHEN** LLM が 1 回の呼び出しで「ID 1 を完了」「ID 9 を削除」を指示する
- **THEN** エラー結果が返り、2 番目の操作で ID 9 が存在しないことが示され、ID 1 は未完了のまま残る

#### Scenario: 空白だけのテキスト
- **WHEN** LLM が「   」を追加する
- **THEN** エラー結果が返り、項目は追加されず、次に追加される項目の ID も変わらない

#### Scenario: 操作が 0 件
- **WHEN** LLM が操作の配列を空にして呼び出す
- **THEN** エラー結果が返り、TODO 状態は変わらない

### Requirement: TODO パネルはエディタとフッターの間に表示される
システムは対話 TUI で、エディタとフッターの間に TODO パネルを表示しなければならない。パネルは次の規則に従わなければならない。(SHALL)
- 未完了項目を ID の昇順で 1 項目 1 行として、最大 N 行まで表示する
- 表示しきれない未完了項目の件数と完了項目の件数は、項目行の後の 1 行に件数だけを表示する。完了項目は個別には表示しない
- 項目が 1 件以上あり、すべて完了しているときは「all done」を含む 1 行だけを表示する
- 項目が 0 件のときはパネルを表示しない
- 各行は端末幅に収まるように切り詰める

N の既定値は 5 とする。環境変数 `SPIRITS_TODO_MAX_LINES` に正の整数を指定すると N を変更できる。正の整数でない値は既定値として扱う。print / RPC モードではパネルを表示しない。

#### Scenario: 未完了と完了が混在する
- **GIVEN** N=5、未完了 3 件、完了 2 件
- **WHEN** パネルが描画される
- **THEN** 未完了 3 件がそれぞれ 1 行で表示され、続く 1 行に完了 2 件が件数で表示される

#### Scenario: 未完了が上限を超える
- **GIVEN** N=5、未完了 7 件(ID 1〜7)、完了 0 件
- **WHEN** パネルが描画される
- **THEN** ID 1〜5 が 1 行ずつ表示され、続く 1 行に残り 2 件が件数で表示される

#### Scenario: すべて完了
- **GIVEN** 項目が 3 件あり、すべて完了している
- **WHEN** パネルが描画される
- **THEN** 「all done」を含む 1 行だけが表示される

#### Scenario: 項目が無い
- **WHEN** 現在のブランチに TODO 項目が無い
- **THEN** パネルは表示されない

#### Scenario: 上限の変更
- **GIVEN** `SPIRITS_TODO_MAX_LINES=3` で起動した
- **WHEN** 未完了が 4 件ある状態でパネルが描画される
- **THEN** 項目行は ID 1〜3 の 3 行になり、続く 1 行に残り 1 件が件数で表示される

#### Scenario: 上限の不正値
- **WHEN** `SPIRITS_TODO_MAX_LINES` が `0`、`abc`、`-1` のいずれかで起動する
- **THEN** N は 5 として扱われる

#### Scenario: 長いテキスト
- **WHEN** 項目のテキストが端末幅より長い
- **THEN** その項目は 1 行に切り詰めて表示され、パネルの行数は増えない

#### Scenario: ツール呼び出し後の更新
- **WHEN** `manage_todos` の呼び出しが成功する
- **THEN** 同じ呼び出しの完了時点でパネルが新しい状態を表示する

#### Scenario: `/reload` 後の再表示
- **GIVEN** 未完了の項目がある
- **WHEN** ユーザーが `/reload` を実行する
- **THEN** reload 完了後にパネルが同じ状態で再表示される

### Requirement: TODO 状態はセッションファイルに保存され再開時に復元される
システムは `manage_todos` の成功ごとに TODO 状態をセッションファイルへ保存し、セッションの再開時に復元しなければならない。読み取れない保存データは無視し、同じブランチ上でそれより前の有効な状態を使わなければならない。(SHALL)

読み取れない保存データには、JSON として解釈できないものや型が合わないものだけでなく、ID の重複や空白だけのテキストなど、`manage_todos` が生成しえない内容を含む。

#### Scenario: 再開後の復元
- **GIVEN** 永続化されたセッションで、未完了 1 件と完了 1 件を保存して終了した
- **WHEN** ユーザーが `/resume` または `--continue` でそのセッションを再開する
- **THEN** パネルは未完了 1 件と完了 1 件の件数行を表示し、次に追加される項目には保存前の採番を引き継いだ ID が割り当てられる

#### Scenario: 壊れた保存データ
- **GIVEN** 有効な TODO 状態の後に、形式が不正な TODO 状態がセッションファイルに記録されている
- **WHEN** セッションを再開する
- **THEN** 不正な記録は無視され、直前の有効な状態が表示される

#### Scenario: 意味的に不正な保存データ
- **GIVEN** 有効な TODO 状態の後に、ID が重複した TODO 状態がセッションファイルに記録されている
- **WHEN** セッションを再開する
- **THEN** 重複を含む記録は無視され、直前の有効な状態が表示される
