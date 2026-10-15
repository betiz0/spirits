# Spec Delta

## MODIFIED Requirements

### Requirement: スキルの保存
システムは codemode ツール `spirits_skill_save` を提供し、`name` / `description` / `body` を受け取らなければならない。(SHALL)
保存先はエージェントディレクトリ配下の `skills/<name>/SKILL.md` とし、`name` と `description` だけを持つ frontmatter と `body` から成る Agent Skills 形式で書かなければならない。(SHALL)
`description` は、改行、`: `、`#`、引用符を含んでいても、frontmatter を YAML として読んだときに元の文字列と一致し、ほかのキーを生じさせない形で書かなければならない。(SHALL)
保存先ディレクトリが無ければ作成し、同名スキルが存在する場合は上書きしなければならない。ただし、書き込み先の実体が `<agentDir>/bundled-skills/` 配下にある場合(`skills/<name>` が同梱ディレクトリを指す symlink である場合など)は、保存せずにエラーとし、リンク先のファイルを変更してはならない。この判定は、`<agentDir>` 自体が symlink を経由するパスや相対パスで与えられる場合にも成り立たなければならない。書き込み先がまだ存在しない場合(`skills/` 自体が同梱ディレクトリへの symlink である状態で新しい名前を保存する場合など)も、作成されることになる場所の実体で判定しなければならない。(SHALL)
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

#### Scenario: 同梱ディレクトリへの symlink の拒否
- **WHEN** `skills/<name>` が `<agentDir>/bundled-skills/` 配下のディレクトリへの symlink である状態で `spirits_skill_save` を実行する
- **THEN** 結果はエラーになり、リンク先の `SKILL.md` と `skills/<name>` の symlink は変更されない

#### Scenario: agentDir が symlink を経由する場合の拒否
- **WHEN** `<agentDir>` の祖先が symlink で、`skills/<name>` が `<agentDir>/bundled-skills/` 配下のディレクトリへの symlink である状態で `spirits_skill_save` を実行する
- **THEN** 結果はエラーになり、リンク先の `SKILL.md` と `skills/<name>` の symlink は変更されない

#### Scenario: skills 自体が同梱ディレクトリを指す場合の新規保存の拒否
- **WHEN** `skills` が `<agentDir>/bundled-skills/<版>/` への symlink で、`skills/<name>` がまだ存在しない状態で `spirits_skill_save` を実行する
- **THEN** 結果はエラーになり、`<agentDir>/bundled-skills/` 配下にディレクトリもファイルも作成されない

### Requirement: スキルの削除
システムは codemode ツール `spirits_skill_delete` を提供し、指定名のスキルディレクトリを削除しなければならない。(SHALL)
`skills/<name>` が symlink の場合(リンク先が存在しないものを含む)は、リンクだけを削除し、リンク先を変更してはならない。(SHALL)
`skills/<name>` が symlink ではなくても、その実体が `<agentDir>/bundled-skills/` 配下にある場合(`skills/` 自体が同梱ディレクトリへの symlink である場合など)は、削除せずにエラーを返さなければならない。(SHALL)
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

#### Scenario: リンク切れの symlink の削除
- **WHEN** `skills/dangling` が存在しない場所を指す symlink である状態で `tool("spirits_skill_delete", { name: "dangling" })` を実行する
- **THEN** `skills/dangling` は存在しなくなり、結果に削除の確認が含まれる

#### Scenario: 実体が同梱配下にあるスキルの削除を拒否する
- **WHEN** `skills` が `<agentDir>/bundled-skills/<版>/` への symlink である状態で、同梱スキルと同じ名前で `tool("spirits_skill_delete", { name: "architecture-guards" })` を実行する
- **THEN** 結果はエラーになり、同梱版のディレクトリと `SKILL.md` は残る
