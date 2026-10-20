# Proposal

## Why

spirs の同梱スキルは現在 `architecture-guards` の  1 つのみで、利用者は `/skill:architecture-guards` で明示起動して使う。一方で OpenSpec 変更の深い検証（verify2）と実装前レビューを担う 2 つのスキル（`sprt-opsx-verify-deep`、`sprt-opsx-review-change`）がリポジトリルートに存在するが、同梱スキルとして管理されておらず、配布バイナリに含まれない。これらを同梱スキルとして導入し、あわせて既存の `architecture-guards` にも `sprt-` 接頭辞を付けて、同梱スキル全体で命名規則を統一する。

## What Changes

- **BREAKING** — 同梱スキル `architecture-guards` を `sprt-architecture-guards` にリネームする。ディレクトリ、frontmatter `name`、`definition.ts` の登録名、および spec 内の `/skill:` 参照を更新する。利用者は `/skill:sprt-architecture-guards` で起動する。
- 新しい同梱スキル `sprt-opsx-verify-deep` を導入する。OpenSpec 変更について既定 verify（verify1）と独立した深い検証（verify2）を実装するスキル。frontmatter に `disable-model-invocation: true` を持つ。
- 新しい同梱スキル `sprt-opsx-review-change` を導入する。`/opsx-apply` 開始前に OpenSpec 変更（proposal・delta specs・design・tasks）をレビューし、YES/NO 判定を下すスキル。frontmatter に `disable-model-invocation: true` を持つ。
- `definition.ts` に 2 つの新スキルを登録し、`createBundledSkills()` が 3 つのスキルを返すようにする。
- `bundled-skills` の仕様差分: `architecture-guards` を例に取るシナリオのスキル名を `sprt-architecture-guards` に更新する。
- README（4 言語）と `docs/spirits-design.md` の `/skill:architecture-guards` 参照を `/skill:sprt-architecture-guards` に更新し、新スキルの記載を追加する。
- テスト: `bundled-skills.test.ts` の `architecture-guards` 名前参照を `sprt-architecture-guards` に更新し、新スキルの検証テストを追加する。

## Capabilities

### New Capabilities
- `sprt-opsx-verify-deep`: OpenSpec 変更の深い検証（verify2）を実装する同梱スキル。spec の意図達成、spec 外変更の混在、テストの実際の検証、設計判断に無い継ぎ目の検出、規約検査の弱化を確認し、archive 可否の判定を下す。
- `sprt-opsx-review-change`: OpenSpec 変更の実装前レビューを実装する同梱スキル。成果物間の不整合、archive 時の spec 欠落リスク、検証不能な要求、変更が追加する継ぎ目の判断記録を洗い出し、`/opsx-apply` 開始可否を YES/NO で判定する。

### Modified Capabilities
- `architecture-guards`: スキル名を `architecture-guards` から `sprt-architecture-guards` に変更する。全 Requirement と Scenario の `/skill:architecture-guards` 参照を `/skill:sprt-architecture-guards` に更新し、モデルの自動選択向け一覧に現れないことの対象名を更新する。
- `bundled-skills`: 「利用者スキルの優先」の Scenario で例に取っている同梱スキル名を `architecture-guards` から `sprt-architecture-guards` に更新する。

## Impact

- `packages/spirits/src/harness/bundled-skills/` — ディレクトリリネーム、新スキルディレクトリ追加、`definition.ts` 更新
- `packages/spirits/test/bundled-skills.test.ts` — 名前参照更新と新スキルテスト追加
- `README.md` / `README.ja.md` / `README.de-CH.md` / `README.zh.md` — `/skill:` 参照更新と新スキル記載
- `docs/spirits-design.md` — ディレクトリツリーの `architecture-guards/` を更新
- **Pi 上流コアへの差分: なし**。全変更は `packages/spirits/` 配下に閉じる。
- 新しい外部依存の追加なし。`esbuild` による text import は既存の `type: "text"` 機構を再利用する。
