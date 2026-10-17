# upstream-tracking Specification

## Purpose

Pi 上流 (`earendil-works/pi`) の変更を spirits の main へ定期的に取り込み、取り込みの手順、コミット構成、取り込み後の検証、回帰検出までを、文書化された再実行可能な手順として維持できるようにする。

## Requirements

### Requirement: 上流リモートからの merge による取り込み
上流の取り込みは、`earendil-works/pi` を指す `upstream` リモートを登録した作業ツリーで行わなければならない。(SHALL)
上流の取り込みは merge で行い、取り込んだ上流コミットを main の履歴の祖先として保持しなければならない。(SHALL)
取り込みを開始する前に、対象のリリースタグまたは commit を変更アーティファクトに記録しなければならない。(SHALL)

#### Scenario: upstream リモートの登録
- **WHEN** 取り込み作業を開始する
- **THEN** 作業ツリーの `upstream` リモートが `earendil-works/pi` を指している

#### Scenario: merge による取り込み
- **WHEN** pi v1.1.0 を main へ取り込む
- **THEN** merge コミットが作成され、上流 v1.1.0 の commit は main の祖先に含まれる

#### Scenario: 取り込み対象の記録
- **WHEN** 取り込み作業を開始する
- **THEN** 対象のリリースタグまたは commit が change の tasks に記載されている

### Requirement: 上流追従手順の文書化
リポジトリは、上流追従の手順を `docs/spirits-upstream-sync.md` に保持しなければならない。(SHALL)
この文書は、`upstream` リモートの登録、取り込み対象の変更アーティファクトへの記録、取り込み対象の fetch と merge、取り込みのコミット構成、取り込み後の検証コマンドとその順序、上流タグの扱いを記載しなければならない。(SHALL)
`docs/spirits-design.md` の §5 は、この文書を参照しなければならない。(SHALL)

#### Scenario: 手順文書の内容
- **WHEN** `docs/spirits-upstream-sync.md` を確認する
- **THEN** `upstream` リモートの登録、取り込み対象の変更アーティファクトへの記録、取り込み対象の fetch と merge、コミット構成、検証コマンドとその順序、上流タグの扱いがそれぞれ記載されている

#### Scenario: 設計書からの参照
- **WHEN** `docs/spirits-design.md` の §5 を確認する
- **THEN** `docs/spirits-upstream-sync.md` への参照が記載されている

### Requirement: 取り込みのコミット構成
取り込みの merge コミットは、上流の変更、競合の解決、および lockfile の再生成だけを含まなければならない。(SHALL)
取り込みに伴う spirits 側の修正 (ビルド設定、CI、文書など) は、merge コミットの後の独立したコミットにしなければならない。(SHALL)

#### Scenario: lockfile の再生成を merge に含める
- **WHEN** 上流が依存を変更した状態で取り込む
- **THEN** 再生成した `package-lock.json` と `bun.lock` は merge コミットに含まれる

#### Scenario: spirits 側の修正の分離
- **WHEN** 取り込みに伴い `scripts/build-binaries.ts` を修正する
- **THEN** その修正は merge コミットには含まれず、merge コミットの後の独立したコミットに含まれる

### Requirement: 取り込み後の検証
取り込みと競合解決の後、origin の main へ push する前に、lockfile の再生成、モデルデータの hydrate、`npm run check`、`./test.sh`、spirits の `bun test` と `bun run check`、および spirits バイナリの build と self-update smoke をすべて成功させなければならない。(SHALL)
検証のいずれかが失敗した場合、取り込みのコミットを origin の main へ push してはならない。(MUST)
取り込み後に、バージョンを明示せずにビルドした spirits バイナリの `spirits --version` は、`spirits-v*` タグから導出したバージョンを表示しなければならない。(SHALL)

#### Scenario: 検証成功時の push
- **WHEN** 取り込みのコミットに対して定義された検証コマンドがすべて成功する
- **THEN** 取り込みのコミットが origin の main へ push される

#### Scenario: lockfile の再生成
- **WHEN** 上流がパッケージまたは依存を追加した状態で取り込む
- **THEN** `package-lock.json` と `bun.lock` が再生成され、`bun install --frozen-lockfile` が成功する

#### Scenario: バージョン注入の維持
- **WHEN** 取り込み後に、バージョンを明示せずに spirits バイナリをビルドする
- **THEN** `spirits --version` は `spirits-v*` タグから導出したバージョンを表示し、終了コード 0 で終わる

#### Scenario: 検証失敗時
- **WHEN** 検証コマンドのいずれかが失敗する
- **THEN** origin の main は取り込み前のコミットを指したまま変わらない

### Requirement: Pi コアと root 設定の変更に対する spirits CI
spirits のテストと type check は、`packages/` 配下のファイル、または root の `package.json`、`tsconfig.json`、`tsconfig.base.json` が変更された push または pull request でも実行されなければならない。(SHALL)

#### Scenario: コア変更の push
- **WHEN** `packages/coding-agent/src/` 配下のファイルだけを変更して main へ push する
- **THEN** Spirits CI が起動し、spirits の `bun test` と `bun run check` が実行される

#### Scenario: root 設定の変更
- **WHEN** root の `tsconfig.base.json` だけを変更した pull request を main に対して作成する
- **THEN** Spirits CI が起動し、spirits の `bun test` と `bun run check` が実行される

#### Scenario: 上流取り込みの push
- **WHEN** 上流取り込みの merge を main へ push する
- **THEN** Spirits CI が起動し、spirits の `bun test` と `bun run check` が実行される

### Requirement: fork 差分の分離維持
取り込みに伴い、競合の解決以外で Pi コア (`packages/spirits/` を除く `packages/` 配下) のソースを変更する場合 (上流 API の変化への適応、上流の修正のバックポートなど)、その変更は `[spirits]` プレフィックスを付けた独立コミットとして分離しなければならない。(SHALL)
競合の解決で Pi コアのファイルを変更する場合、その変更は merge コミットの解決内容に含めなければならない。(SHALL)

#### Scenario: コア適応の分離
- **WHEN** 上流 API の変化へ適応するために Pi コアを変更する
- **THEN** その変更は `[spirits]` プレフィックスの独立コミットに含まれる

#### Scenario: 上流修正のバックポート
- **WHEN** 取り込み後の検証を通すために、取り込み元より新しい上流の修正を Pi コアへバックポートする
- **THEN** その変更は `[spirits]` プレフィックスの独立コミットに含まれ、merge コミットには含まれない

#### Scenario: 競合解決のみの取り込み
- **WHEN** 取り込みが競合解決だけで完結する
- **THEN** 新たな `[spirits]` コア差分コミットは作成されず、解決内容は merge コミットに含まれる

### Requirement: Pi コア差分の登録簿
システムは、件名が `[spirits]` で始まるコミットを、1 行 = 1 コミットで `docs/spirits-core-diffs.md` に登録簿として保持しなければならない。(SHALL) 対象は Pi 上流コア（`packages/spirits/` を除く `packages/` 配下）を変えるコミットに加え、コア実装を変えない `[spirits]` コミットも含む。
登録簿の各行は、コミット番号、対象ファイル、差分の意図、その差分を導入した変更アーティファクト名を含まなければならない。(SHALL)
登録簿と main の突き合わせは件名の接頭辞で行い、本文に `[spirits]` を含むだけのコミットは対象にしない。(SHALL)

#### Scenario: 新しいコア差分の登録
- **WHEN** `[spirits]` プレフィックスのコミットを作成する
- **THEN** 登録簿にそのコミット番号、対象ファイル、意図、変更アーティファクト名が追記されている

#### Scenario: 既存の `[spirits]` コミットを漏らさない
- **WHEN** 登録簿と、main 上の件名が `[spirits]` で始まるコミットを突き合わせる
- **THEN** 登録簿に載っていない `[spirits]` コミットは無く、登録簿の行数とコミット数が一致する

#### Scenario: 本文に接頭辞を含むだけのコミットは数えない
- **GIVEN** 件名が `docs:` で始まり、本文に `[spirits]` を含むコミットが main にある
- **WHEN** 登録簿の確認手順のコマンドを実行する
- **THEN** そのコミットは一覧に現れず、登録簿の行数とコミット数が一致する

### Requirement: 取り込み時の登録簿との突き合わせ
システムは、上流の取り込み後に登録簿と実差分を突き合わせ、登録された差分が取り込み後も残っていることを確認しなければならない。(SHALL)
確認できない差分があるとき、その差分を復元するまで取り込みを push してはならない。(MUST)
`docs/spirits-upstream-sync.md` は、コミット構成の手順として登録簿への参照を記載しなければならない。(SHALL)

#### Scenario: 取り込み後の突き合わせ
- **WHEN** 上流の merge と競合解決を完了する
- **THEN** 登録簿の各行について、対象ファイル（テストと文書を含む）に spirits 側の差分が残っていることを確認している

#### Scenario: 失われた差分の復元まで push しない
- **GIVEN** 取り込みで登録済みのコア差分が上流の内容に置き換わっている
- **WHEN** 突き合わせがそれを検出する
- **THEN** 差分を復元するまで origin の main へ push しない

#### Scenario: 手順文書からの参照
- **WHEN** `docs/spirits-upstream-sync.md` のコミット構成の節を確認する
- **THEN** `docs/spirits-core-diffs.md` への参照が記載されている
