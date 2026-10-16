# Design

## Context

spirs の同梱スキルは `packages/spirits/src/harness/bundled-skills/` 配下に Markdown として置かれ、`definition.ts` が `with { type: "text" }` import で文字列として読み込み、`createBundledSkills()` が配列として返す。`index.ts` の `registerBundledSkills` が `resources_discover` ハンドラとして書き出しと pi への供給を行う。現在 `architecture-guards` の 1 つだけが登録されている。

リポジトリルートに `sprt-opsx-verify-deep.SKILL.md` と `sprt-opsx-review-change.SKILL.md` が存在するが、これらは同梱スキルとして管理されていない。

## Goals / Non-Goals

**Goals:**
- 同梱スキル `architecture-guards` を `sprt-architecture-guards` にリネームし、命名規則を統一する
- 2 つの新スキル（`sprt-opsx-verify-deep`、`sprt-opsx-review-change`）を同梱スキルとして導入する
- 配布バイナリに 3 つの同梱スキルが含まれ、ソース実行とコンパイル実行で同じスキル一覧を提示する

**Non-Goals:**
- スキルの本文ロジックの変更（verify2 やレビューの手順そのものの修正）
- 新しい pi 機能や OpenSpec CLI 機能への依存の追加
- 同梱スキルの書き出し機構（`index.ts`）の変更

## Decisions

### Decision 1: ディレクトリリネームは `git mv` で行い、frontmatter と本文の名前参照を同一変更で更新する

**選択肢:**
- (A) `git mv` でディレクトリをリネームし、SKILL.md の frontmatter `name`・description 内の `/skill:` 参照・本文の見出しと `/skill:` 参照をすべて更新する
- (B) 新規ディレクトリ `sprt-architecture-guards/` を作成し、旧ディレクトリを削除する

**理由:** (A) を選ぶ。`git mv` は履歴を保持し、リネームであることが明確になる。frontmatter `name` はディレクトリ名と一致が必須（`validateBundledSkills` が検証）ため、同一変更で更新する必要がある。本文内の `/skill:architecture-guards` 参照も利用者の明示起動に使われるため、更新しないと起動方法が古いまま残る。

### Decision 2: 新スキルは SKILL.md ファイルを `bundled-skills/<name>/` に置き、`definition.ts` に `with { type: "text" }` import で登録する

**選択肢:**
- (A) 新スキルの SKILL.md を `bundled-skills/sprt-opsx-verify-deep/SKILL.md` と `bundled-skills/sprt-opsx-review-change/SKILL.md` に置き、既存の `type: "text"` import パターンで `definition.ts` に登録する
- (B) リポジトリルートの SKILL.md をシンボリックリンクで参照する

**理由:** (A) を選ぶ。既存の `architecture-guards` と同じパターンで、Markdown を実ファイルとしてリポジトリに置く。`type: "text"` import は既存の機構を再利用し、esbuild の設定変更も不要。シンボリックリンクは配布パッケージでの挙動が不安定になるため避ける。

新スキルは `references/` を持たない（単一 SKILL.md のみ）ため、`files` は `{ path: "SKILL.md", content: ... }` の 1 つだけになる。

### Decision 3: capability パス `architecture-guards` は維持し、スキル名のみ変更する

**選択肢:**
- (A) capability パス `architecture-guards` を維持し、spec 差分でスキル名参照を `sprt-architecture-guards` に更新する
- (B) capability パス自体を `sprt-architecture-guards` にリネームする

**理由:** (A) を選ぶ。capability パスはシステムの振る舞いを表す安定した識別子であり、スキル名は実装詳細。OpenSpec の ` Modified Capabilities` は既存パスを正確に使う規定がある。spec ディレクトリのリネームは不要な複雑さを増やす。

### Decision 4: テストは `bundled-skills.test.ts` の名前参照を更新し、新スキルの検証を追加する

**選択肢:**
- (A) `createBundledSkills()` から `sprt-architecture-guards` を取得する箇所と、`architecture-guards` のアサーションを `sprt-architecture-guards` に更新し、`sprt-opsx-verify-deep` の `disableModelInvocation` と `sprt-opsx-review-change` のモデル向け一覧への出現を確認するテストを追加する
- (B) テストを新規ファイルに分離する

**理由:** (A) を選ぶ。既存テストの構造を維持し、変更最小限にする。新スキルの検証は既存の "bundled skill frontmatter is valid" テストに追加するだけで十分。

## Risks / Trade-offs

- [Risk] 利用者の `skills/` に `architecture-guards` という名前のユーザースキルが存在すると、リネーム後に同名衝突が解消される（利用者スキルが优先される） → Mitigation: これは仕様の意図した挙動（同名の利用者スキルが优先）であり、問題ではない。リネーム後は `sprt-architecture-guards` が同梱スキルとして機能する。
- [Risk] リネーム前に `/skill:architecture-guards` を実行していた利用者の履歴が古い → Mitigation: スキルは明示起動であり、古い名前は `disable-model-invocation` によりモデルが自動選択しない。再起動時に新しい名前のみが提示される。README を更新して新しい起動方法を示す。
- [Trade-off] capability パスとスキル名が一致しなくなる（`architecture-guards` capability vs `sprt-architecture-guards` スキル） → spec 本文で両者の関係が分かるようにしており、コード上は `definition.ts` の名前参照とテストで整合性が保たれる。
- [Trade-off] `sprt-opsx-review-change` はモデルによる自発的起動を許可する（`disable-model-invocation` を持たない） → モデルがレビューを自動的に実行できるが、その結果は利用者が確認する必要がある。一方 `sprt-opsx-verify-deep` は引き続き `disable-model-invocation: true` を持ち、明示起動のみとする。
