# bundled-skills Specification

## Purpose

製品に同梱したスキルを利用者がインストール直後から使えるようにしつつ、利用者自身のスキルによる上書きと、同梱スキル全体の無効化を可能にする。あわせて、同梱物が利用者領域のスキル管理と衝突しない境界を定める。

## Requirements

### Requirement: 同梱スキルの書き出し
システムは、同梱スキルをエージェントディレクトリ配下の `bundled-skills/<spirits 版>/<スキル名>/` へ、`SKILL.md` を含むファイル一式として書き出さなければならない。(SHALL)
同梱スキルを `<agentDir>/skills/` 直下へ書き出してはならない。(MUST)

#### Scenario: 同梱スキルの書き出し先
- **WHEN** 同梱スキルを持つ spirits のセッションを開始する
- **THEN** `<agentDir>/bundled-skills/<spirits 版>/<スキル名>/SKILL.md` が存在し、`<agentDir>/skills/<スキル名>/` は作成されない

### Requirement: 同梱スキルの探索への供給
システムは、セッション開始後に、書き出した現行版ディレクトリを pi のスキル探索へ供給しなければならない。(SHALL)
供給は、コンパイル済みバイナリとソース実行で同じスキル名と説明を提示しなければならない。(SHALL)

#### Scenario: コンパイル済み spirits での一覧
- **WHEN** 同梱スキルを持つコンパイル済み spirits を起動する
- **THEN** スキル一覧に同梱スキルの名前と説明が現れる

#### Scenario: ソース実行とコンパイル実行の一致
- **WHEN** 同じ同梱スキルを持つ spirits をソース実行とコンパイル実行でそれぞれ起動する
- **THEN** どちらのスキル一覧にも同じ名前と説明が現れる

### Requirement: 利用者スキルの優先
利用者の `<agentDir>/skills/<スキル名>/SKILL.md` が同梱スキルと同名で存在する場合、システムは同梱版をその名前の有効なスキルとして採用させてはならない。(MUST)

#### Scenario: 同名の利用者スキルによる上書き
- **WHEN** `<agentDir>/skills/architecture-guards/SKILL.md` を置いた状態で spirits を起動する
- **THEN** スキル一覧の `architecture-guards` の場所は利用者の `SKILL.md` を指し、同梱版のパスを指さない

### Requirement: 同梱スキルの無効化
システムは、環境変数 `SPIRITS_BUNDLED_SKILLS` に `0` が設定された場合、同梱スキルを無効にしなければならない。(SHALL)
無効時は同梱スキルを書き出さず、pi のスキル探索へ供給してもならない。(MUST)

#### Scenario: 無効時のスキル一覧
- **WHEN** `SPIRITS_BUNDLED_SKILLS=0` で spirits を起動する
- **THEN** スキル一覧に同梱スキルが現れず、`<agentDir>/bundled-skills/` 配下に現行版ディレクトリが新たに作成されない

### Requirement: 同梱ファイルの保護
`spirits_skill_save` と `spirits_skill_delete` は、同梱スキルのディレクトリとファイルを変更・削除してはならない。(MUST)

#### Scenario: save は利用者領域へ書き込む
- **WHEN** 同梱スキルと同じ名前で `spirits_skill_save` を実行する
- **THEN** 書き込み先は `<agentDir>/skills/<スキル名>/SKILL.md` であり、同梱版の `SKILL.md` は変更されない

#### Scenario: delete は同梱ファイルを消さない
- **WHEN** 利用者の `skills/` に存在しない同梱スキル名で `spirits_skill_delete` を実行する
- **THEN** エラーになり、同梱版のディレクトリと `SKILL.md` は残る

#### Scenario: symlink 経由の変更を拒否する
- **WHEN** `<agentDir>/skills/<スキル名>` が同梱スキルのディレクトリへの symlink である状態で `spirits_skill_save` を実行する
- **THEN** エラーが返り、同梱版の `SKILL.md` は変更されない

#### Scenario: agentDir が symlink を経由していても拒否する
- **WHEN** `<agentDir>` の祖先が symlink で、`<agentDir>/skills/<スキル名>` が同梱スキルのディレクトリへの symlink である状態で `spirits_skill_save` を実行する
- **THEN** エラーが返り、同梱版の `SKILL.md` は変更されない

#### Scenario: 相対パスの agentDir でも拒否する
- **WHEN** `<agentDir>` が相対パスで与えられ、`<agentDir>/skills/<スキル名>` が同梱スキルのディレクトリへの symlink である状態で `spirits_skill_save` を実行する
- **THEN** エラーが返り、同梱版の `SKILL.md` は変更されない

#### Scenario: 同梱への symlink の削除はリンクだけを消す
- **WHEN** `<agentDir>/skills/<スキル名>` が同梱スキルのディレクトリへの symlink である状態で `spirits_skill_delete` を実行する
- **THEN** `skills/<スキル名>` の symlink は存在しなくなり、同梱版のディレクトリと `SKILL.md` は残る

#### Scenario: skills ディレクトリ自体が同梱を指す場合の削除を拒否する
- **WHEN** `<agentDir>/skills` が `<agentDir>/bundled-skills/<版>/` への symlink である状態で、同梱スキルと同じ名前で `spirits_skill_delete` を実行する
- **THEN** エラーが返り、同梱版のディレクトリと `SKILL.md` は残る

#### Scenario: skills ディレクトリ自体が同梱を指す場合の新規保存を拒否する
- **WHEN** `<agentDir>/skills` が `<agentDir>/bundled-skills/<版>/` への symlink である状態で、同梱スキルに無い名前で `spirits_skill_save` を実行する
- **THEN** エラーが返り、`<agentDir>/bundled-skills/<版>/` 配下にディレクトリもファイルも作成されない

### Requirement: 現行版ディレクトリのみの供給
システムは、`<agentDir>/bundled-skills/` 配下の現行版ディレクトリだけを pi のスキル探索へ供給しなければならない。(SHALL)

#### Scenario: 旧版が残っていても現行版のみ
- **WHEN** 旧版の同梱ディレクトリが残った状態で新版の spirits を起動する
- **THEN** 供給されるスキルパスは現行版ディレクトリ配下だけである

### Requirement: 版文字列のサニタイズ
システムは、版文字列が 1 つの安全なパス要素でない場合、版ディレクトリ名を `dev` に置き換えなければならない。(MUST)
安全なパス要素でない版文字列とは、空文字列、`.`、`..`、または `[A-Za-z0-9._+-]` 以外の文字を 1 つでも含むものをいう。

#### Scenario: 安全でない版文字列
- **WHEN** 版文字列が `0.1/0`、`a b`、`..`、`.`、空文字列のいずれかである状態で spirits を起動する
- **THEN** 書き出し先と供給の版ディレクトリ名は `dev` となり、`<agentDir>/bundled-skills/` の外には何も作成されない

### Requirement: 旧版同梱ディレクトリの片付け
システムは、同梱スキルの書き出しのたびに、現行版ディレクトリの更新時刻を書き出し時刻にしなければならない。(SHALL)
システムは、同梱スキルの書き出し時に、`<agentDir>/bundled-skills/` 直下の現行版以外のディレクトリのうち、更新時刻から 7 日以上経過したものを削除しなければならない。(SHALL)
更新時刻から 7 日未満の現行版以外のディレクトリは、削除してはならない。(MUST)
削除に失敗した場合でも、現行版の同梱スキルの供給とセッションの開始を妨げてはならない。(MUST)

#### Scenario: 使われなくなった旧版ディレクトリの削除
- **WHEN** 最後の書き出しから 7 日以上経過した旧版の同梱ディレクトリが残った状態で新版の spirits を起動する
- **THEN** そのディレクトリは削除され、`<agentDir>/bundled-skills/` 直下には現行版ディレクトリと 7 日未満の版だけが残る

#### Scenario: 並行して使われている版は残る
- **WHEN** 7 日未満の間に書き出された別の版の同梱ディレクトリが残った状態で spirits を起動する
- **THEN** その版のディレクトリとファイルは削除されず、その版のセッションは `/skill:<スキル名>` の展開で `SKILL.md` を引き続き読める

#### Scenario: 現行版の更新時刻
- **WHEN** 内容が変わらない同梱スキルを、時間をおいて 2 回書き出す
- **THEN** 2 回目の書き出し後、現行版ディレクトリの更新時刻は 2 回目の書き出し時刻になる

#### Scenario: 削除失敗時の起動継続
- **WHEN** 7 日以上経過した旧版の同梱ディレクトリを削除できない
- **THEN** 現行版の同梱スキルはスキル一覧に現れ、セッションは起動する

### Requirement: 書き出し失敗時の起動継続
システムは、同梱スキルの書き出しに失敗した場合、セッションの開始を妨げてはならない。(MUST)
書き出しに失敗した場合、そのセッションでは同梱スキルをスキル一覧に現してはならない。(MUST)

#### Scenario: 同梱ルートを作成できない
- **WHEN** `<agentDir>/bundled-skills` の位置に同名のファイルが存在する状態で spirits を起動する
- **THEN** セッションは起動し、同梱スキルはスキル一覧に現れない

### Requirement: 後段フェーズ機能への非依存
同梱スキルの書き出しと供給は、M5(Phase 2)の機能を import・参照してはならない。(MUST)

#### Scenario: 後段機能の非参照
- **WHEN** 同梱スキルの書き出しと供給の実装の参照を列挙する
- **THEN** Phase 2 のモジュールへの参照が存在しない
