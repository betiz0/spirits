# Tasks

## 1. architecture-guards のリネーム

- [x] 1.1 `git mv packages/spirits/src/harness/bundled-skills/architecture-guards packages/spirits/src/harness/bundled-skills/sprt-architecture-guards` を実行し、ディレクトリがリネームされたことを確認する。検証: `ls packages/spirits/src/harness/bundled-skills/` に `sprt-architecture-guards/` が存在し、`architecture-guards/` が存在しない
- [x] 1.2 `sprt-architecture-guards/SKILL.md` の frontmatter `name` を `sprt-architecture-guards` に更新し、description 内の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新し、本文の見出し `# architecture-guards` を `# sprt-architecture-guards` に更新し、本文内の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新する。検証: `grep -c "architecture-guards" packages/spirits/src/harness/bundled-skills/sprt-architecture-guards/SKILL.md` が 0（`sprt-architecture-guards` は `architecture-guards` を含むため、`grep -c "sprt-architecture-guards"` で確認する）

## 2. 新スキルの導入

- [x] 2.1 `packages/spirits/src/harness/bundled-skills/sprt-opsx-verify-deep/SKILL.md` を作成し、`name: sprt-opsx-verify-deep` の frontmatter が正しいことを確認する。検証: `bun test test/bundled-skills.test.ts` の "bundled skill frontmatter is valid" が成功する
- [x] 2.2 `packages/spirits/src/harness/bundled-skills/sprt-opsx-review-change/SKILL.md` を作成し、`name: sprt-opsx-review-change` の frontmatter が正しいことを確認する。検証: `bun test test/bundled-skills.test.ts` の "bundled skill frontmatter is valid" が成功する

## 3. definition.ts の更新

- [x] 3.1 `definition.ts` の `architecture-guards` の import パスを `sprt-architecture-guards` に更新し、`createBundledSkills()` の `name` を `sprt-architecture-guards` に更新する。検証: `grep -c "architecture-guards" packages/spirits/src/harness/bundled-skills/definition.ts` が 0
- [x] 3.2 `definition.ts` に `sprt-opsx-verify-deep` と `sprt-opsx-review-change` の `with { type: "text" }` import と `createBundledSkills()` への登録を追加する。検証: `bun test test/bundled-skills.test.ts` が成功し、`createBundledSkills()` が 3 つのスキルを返す

## 4. テストの更新と新スキルの検証

- [x] 4.1 `bundled-skills.test.ts` の `definitionFiles()` 内の `"architecture-guards"` 参照を `"sprt-architecture-guards"` に更新し、"architecture-guards is hidden from the model-facing skill list" テスト内の名前参照を `sprt-architecture-guards` に更新する。検証: `bun test test/bundled-skills.test.ts` が成功する
- [x] 4.2 `bundled-skills.test.ts` に `sprt-opsx-verify-deep` の `disableModelInvocation` が `true` でありモデル向け一覧に現れないこと、および `sprt-opsx-review-change` の `disableModelInvocation` が `true` でなくモデル向け一覧に現れることを確認するテストを追加する。検証: `bun test test/bundled-skills.test.ts` が成功する
- [x] 4.3 `harness-skills.test.ts` の `architecture-guards` フィクスチャ参照はリネームの対象外（テスト内で独自に作成するフィクスチャ名）であることを確認し、変更不要であることを確認する。検証: `bun test test/harness-skills.test.ts` が成功する

## 5. README と docs の更新

- [x] 5.1 `README.md` の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新し、`sprt-opsx-verify-deep` と `sprt-opsx-review-change` の同梱スキルとしての記載を追加する。検証: `grep -c "sprt-architecture-guards" README.md` が 1 以上
- [x] 5.2 `README.ja.md` の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新し、2 つの新スキルの記載を追加する。検証: `grep -c "sprt-architecture-guards" README.ja.md` が 1 以上
- [x] 5.3 `README.de-CH.md` の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新する。検証: `grep -c "sprt-architecture-guards" README.de-CH.md` が 1 以上
- [x] 5.4 `README.zh.md` の `/skill:architecture-guards` を `/skill:sprt-architecture-guards` に更新する。検証: `grep -c "sprt-architecture-guards" README.zh.md` が 1 以上
- [x] 5.5 `docs/spirits-design.md` のディレクトリツリー内の `architecture-guards/` を `sprt-architecture-guards/` に更新する。検証: `grep -c "sprt-architecture-guards" docs/spirits-design.md` が 1 以上

## 6. 統合確認

- [x] 6.1 `cd packages/spirits && bun test test/bundled-skills.test.ts test/harness-skills.test.ts` を実行し、全テストが成功することを確認する。検証: テスト結果が all pass
- [x] 6.2 隔離 HOME でソース実行とコンパイル実行の両方で `bundled-skills/<版>/` に 3 つのスキルが書き出されることを確認する。検証: 両実行で `sprt-architecture-guards`、`sprt-opsx-verify-deep`、`sprt-opsx-review-change` の SKILL.md が存在し、スキル一覧に同じ名前と説明が現れる
