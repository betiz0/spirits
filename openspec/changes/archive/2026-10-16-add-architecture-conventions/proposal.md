# Proposal

## Why

このリポジトリには依存方向を強制する手段が存在しない。`openspec/config.yaml` は「後段非依存: 各フェーズは前段の成果物にのみ依存し、後段フェーズの機能/APIを import・参照してはならない」をハードルールとして宣言し、`AGENTS.md` は Pi コアへの変更禁止を規定しているが、いずれも散文であり検査がない。その結果、(1) `packages/spirits/src/repl/` が後段フェーズへ依存する経路が静かに増えうる、(2) `src-root` として一括りにされた `index.ts` が `rlm/` `harness/` `todo/` を import するため、`rlm` → `src-root` という合法な向きが `index.ts` 経由で `rlm` → `harness` の間接依存を許す、(3) `package.json` に宣言のない `pi-client` `pi-durable` `pi-protocol` `pi-server` が `src/experimental` 以外の src から import されたときに誰も気づかない、の 3 点が放置されている。

実測の結果、出荷対象の src はすでにクリーンな層 DAG(循環のない有向グラフ)を満たしている(層グラフの循環 0 件、src から dev ファイルへの import 0 件)。したがって規約と検査を導入するためにコード修正は不要であり、今導入する価値が最も高い。

## What Changes

- 規約正本 `docs/architecture/convention-registry.md` を新規作成する。規約 ID・強度・内容・例外・判定方法・根拠を持ち、private パッケージと例外層と spirits の層の許可表、private パッケージと spirits の層の所属表、bin の deep import の許可リスト、循環の許可リスト、重複の基数をここに置く。継承の深さの実測値も記録として置く(検査はしない)。
- 検査 `packages/spirits/test/architecture-conventions.test.ts` を新規作成し、`bun test` で実行する。判定の共通処理は `packages/spirits/test/architecture/`、検査自身のテストとフィクスチャは `packages/spirits/test/architecture-conventions.fixtures.test.ts` と `packages/spirits/test/fixtures/architecture/` に置く。`packages/spirits/bunfig.toml` の preload と `spirits-ci.yml` の `bun test` 手順がすでにあるため、テストの実行手順は足さない。
- `.github/workflows/spirits-ci.yml` の `paths` に `docs/architecture/**` を加える。正本だけを変える PR でも検査を走らせるため。このファイルは spirits が所有する。
- `packages/spirits/tsconfig.json` の `exclude` にフィクスチャのディレクトリを加える。フィクスチャが型検査と走査に入らないようにするため。
- 依存許可表は手書きとしない。公開パッケージの許可向きは各 `package.json` の workspace 依存から検査時に導出し、正本には private パッケージ(`packages/evals`、`packages/spirits`)の層と `tsconfig.build.json` が除外するディレクトリからなる例外層の許可表だけを書く。
- 内部 import は root の `tsconfig.json` の `paths` だけで解決する。spirits の `paths`(型検査用スタブ)は使わず、spirits から Pi への import は上流パッケージへの依存として扱う。
- `packages/spirits/src/` は `@earendil-works/pi-*` を bare specifier でのみ import すること、`packages/spirits/bin/` は deep import を既存 3 件に限定すること、を規約化する。bin の許可リストは実際の deep import との完全一致を要求し、使われなくなった要素も失敗とする。
- spirits の `rlm` `harness` `todo` は互いに依存しない兄弟層とし、エントリ(`src/index.ts`)へ import できるのは `bin` だけとする。
- 層への所属は、公開パッケージと例外層は導出し、private パッケージと spirits の層は正本の所属表で決める。どの層にも属さない src のファイル(spirits の src に新しく足したディレクトリ、正本に無い private パッケージなど)は未知の層として失敗させる。
- 層の判定は src を起点とする import だけを対象にし、test や examples などの dev ファイルを起点とする import は判定しない。
- 値の依存グラフの循環を禁止する。現行の循環(強連結成分で 4 件、すべて上流パッケージ内)は正本の許可リストに登録し、リストと完全に一致しない循環(新規、拡大、解消済みの残存)を失敗とする。
- 重複を src 限定・10 行以上のハッシュ群の件数で ratchet し、基数と一致しない件数を失敗とする。
- 検査自身の検出能力を、規約ごとの違反フィクスチャで検証する。
- `openspec/config.yaml` の `rules` に規約正本への参照と「規約変更時は正本と検査を同一変更で更新する」を追記する。
- 上流が所有する root のファイル(`tsconfig.json`、`.github/workflows/ci.yml`、`biome.json`、`vitest.base.ts`、`package.json`)は変更しない。

## Capabilities

### New Capabilities
- `architecture-conventions`: リポジトリの層間依存方向、spirits の層構造、spirits と Pi 上流の境界、値の依存グラフの非循環、重複の増加を、規約正本と検査によって強制する。

### Modified Capabilities
<!-- 要件が変わる既存機能なし。`architecture-guards` は同梱スキルの仕様であり、この変更はリポジトリ側の規約と検査を対象にするため、その Requirement は変わらない。 -->

## Impact

- **Pi 上流コアへの差分: 無し。** 検査は `packages/spirits/test/` に置き、上流が所有する root の `tsconfig.json`、`.github/workflows/ci.yml`、`biome.json`、`vitest.base.ts`、`package.json` を触らない。これは上流 merge での競合を避けるための制約であり、`openspec/config.yaml` の「Pi コアは原則変更禁止」と一致する。
- 変更するファイル(いずれも spirits または repo 全体の文書・設定で、上流が所有しない): `docs/architecture/convention-registry.md`(新規)、`packages/spirits/test/` 配下(新規)、`packages/spirits/tsconfig.json`、`.github/workflows/spirits-ci.yml`、`openspec/config.yaml`。
- 影響する検査: `packages/spirits` の `bun test`(`spirits-ci.yml` の "Test and type-check spirits" ステップ)。`npm run check` / 上流 `ci.yml` の `npm test` には影響しない。
- 依存追加: 無し。`packages/spirits` はすでに `typescript` 7.0.2 を devDependency に持つ。
- 検査の実行時間: Bun 1.4.2 の単体スクリプトで約 3.6 秒(走査ファイル 1,650、import 辺 8,504 件、重複計測を含む)。`bun test` には 30 秒の明示タイムアウトを付ける。
- 新規規約違反はベースライン 0 件(実測済み)のため、既存ビルドが壊れることはない。ただし、循環の許可リストと重複の基数は実測との完全一致を要求するため、上流 merge で上流コードの循環や重複が変わると Spirits CI が失敗し、同じ変更で正本の更新が要る。
