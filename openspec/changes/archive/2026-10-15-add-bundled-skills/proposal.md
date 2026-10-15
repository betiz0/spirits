# Proposal

## Why

spirits は配布バイナリに既定のスキルを 1 つも同梱しておらず、利用者はインストール直後に使えるスキルを持たない。`architecture-guards`(利用者リポジトリの実態からアーキテクチャ規約を起こし、利用者の CI で強制する手順)のような製品価値の高いワークフローを、`/skill:architecture-guards` で即座に起動できるようにする。

Pi の拡張は `resources_discover` イベントの戻り値で `skillPaths` を返せるため、Pi コアに手を入れずに拡張側からスキルを供給できる。同梱スキルの配置・上書き・無効化・版更新の契約を capability として固定し、以後の同梱スキル追加を同じ仕組みに乗せる。

## What Changes

- 同梱スキルを `<agentDir>/bundled-skills/<spirits 版>/<name>/SKILL.md` として実行時に書き出し、`resources_discover` の `skillPaths` で pi のスキル探索へ渡す。`skills/` には置かない。
- 最初の同梱スキルとして `architecture-guards` を追加する。frontmatter に `disable-model-invocation: true` を設定し、`/skill:architecture-guards` の明示起動でのみ動く。
- 利用者の `skills/<name>` にある同名スキルを同梱版より優先する。読み込まれない同梱版は警告などで採用されないことが分かるようにする。
- 環境変数で同梱スキル全体を無効化できる。無効時は書き出しも `skillPaths` の返却も行わない。
- `spirits_skill_save` / `spirits_skill_delete` は同梱ディレクトリを対象にせず、同梱ファイルを変更・削除しない。
- 版更新後は現行版ディレクトリのみを供給する。書き出しのたびに現行版ディレクトリの更新時刻を更新し、同梱ルート配下の旧版ディレクトリのうち 7 日以上更新のないものだけを片付ける(別の版のセッションが並行して動いていても、その版のツリーを消さないため)。
- README(英語・日本語・中国語・ドイツ語)と `docs/spirits-design.md` に、同梱スキルの配置・上書き・無効化の契約を追記する。

## Capabilities

### New Capabilities

- `bundled-skills`: バイナリ同梱スキルの書き出し、探索への供給、利用者による同名上書きの優先順位、無効化、版更新時の切り替え。
- `architecture-guards`: 同梱スキル `architecture-guards` の内容(手順と references)と、起動されたときの振る舞い(対象判定、実測からの規約導出、利用者のテストランナーで動く検査の生成、差分提示と承認)。

### Modified Capabilities

- `continual-harness`: `spirits_skill_save` に、書き込み先の実体が `<agentDir>/bundled-skills/` 配下にある場合(`skills/<name>` が同梱ディレクトリへの symlink である場合と、`skills/` 自体が同梱ディレクトリを指す状態で新しい名前を保存する場合を含み、`<agentDir>` が symlink 経由・相対パスの場合でも成り立つ)に保存を拒否する例外を追加する。`spirits_skill_delete` に、リンク切れを含む symlink はリンクだけを削除すること、symlink でなくても実体が同梱配下なら拒否することを明記する。

## Impact

- コード: `packages/spirits/src/harness/`(書き出し・探索配線・無効化設定・`spirits_skill_save` / `spirits_skill_delete` の保護)、`packages/spirits/test/`。REPL コア(`src/repl/`)は変更しない。
- 同梱物: `packages/spirits/src/harness/bundled-skills/` に `architecture-guards` の `SKILL.md` と `references/` を追加する。
- 実行時のファイル配置: `<agentDir>/bundled-skills/<版>/` を新設する。既存の `skills/`・`memory/`・`prompts/` の配置は変えない。
- 依存: npm/Bun の新規依存は追加しない。埋め込み方式を採る場合のみ `scripts/build-binaries.ts` のアセット設定が変わりうる(スパイクで判断)。
- Pi 上流コアへの差分: **なし(想定)**。既存の `resources_discover` API で実現する。スパイクの結果、やむを得ずコア変更が必要になった場合は、理由を design に記録し `[spirits]` プレフィックスの独立コミットに分離する。
- 利用者の `skills/` に同名スキルがある場合、pi は衝突警告を出す(利用者版が採用される)。
- `architecture-guards` の実行結果は利用者リポジトリのテストランナーと CI に検査を生成する。spirits のリポジトリ構成には影響しない。
