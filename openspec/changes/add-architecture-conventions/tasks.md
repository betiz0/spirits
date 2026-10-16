# Tasks

## 1. 読み込みと正本

- [x] 1.1 着手前に `git rev-parse HEAD` の値を控える(5.4 で使う)。`packages/spirits/tsconfig.json` の `exclude` に `test/fixtures/architecture` を加えてから(Decision 13)、`packages/spirits/test/architecture/` に正本の読み込みとリポジトリルートの探索を実装し、`packages/spirits/test/architecture-conventions.fixtures.test.ts` を作る(Decision 12・13)。検証: `cd packages/spirits && bun test test/architecture-conventions.fixtures.test.ts` で次のケースが pass し、`cd packages/spirits && bun run check` が通ること: `registry: missing file fails`、`registry: missing block fails`、`registry: invalid JSON fails`、`registry: non-integer baseline fails`、`registry: allow table value that is not a string array fails`、`registry: unknown layer in allow table or member table fails`、`registry: file matching two layers fails`、`root discovery: same root from another cwd`
- [x] 1.2 `docs/architecture/convention-registry.md` を作成する。Decision 12 の規約 ID ごとに `## <規約ID>: <題名>` の節を置き、強度・内容・例外・判定方法・根拠の 5 項目を持たせる。JSON ブロックは `registry:layers`(Decision 1・3 の表。`packages/evals`、例外層、spirits の 8 層)、`registry:layer-members`(Decision 1 の所属)、`registry:bin-deep-imports`(`@earendil-works/pi-coding-agent/bun/sandbox-env-setup`、`…/bun/runtime-setup`、`…/cli/setup` の 3 件)を置く。`registry:cycles` は `[]`、`registry:duplication` は `{ "baseline": 0 }` で置き、3.5・3.6 で実測値に置き換える。規約の節とは別に、継承の深さの実測値 3 を記録として置く(検査はしない。design Non-Goals)。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `registry: every convention section has strength, content, exceptions, method and rationale`(実際の正本)が pass すること

## 2. 走査・分類・解決

- [x] 2.1 `typescript/unstable/async` で、root の `tsconfig.json` と `packages/spirits/tsconfig.json` の `rootFiles` を 1 回の API 起動で走査し、辺と重複計測用の本文を集める。入口は解析器を起動する関数を省略可能な引数として受け取る(Decision 13)。結果は `beforeAll` で共有し、フックと各テストに 30 秒の明示タイムアウトを付ける(Decision 5)。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `scan: zero files fails`、`scan: unusable tsconfig fails`、`scan: analyzer startup failure fails`、`scan: fixtures are not part of the real repo scan` が pass し、`cd packages/spirits && bun run check` が通ること。フックの明示タイムアウトは、一度だけ値を 1 ms にして timeout で失敗することを確認し、30 秒に戻す
- [x] 2.2 辺の分類を実装する(Decision 11)。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `edges: import type and export type from are type edges`、`edges: type-position import() is a type edge`、`edges: all-inline-type import is a value edge`、`edges: mixed inline type import is a value edge`、`edges: literal dynamic import is a value edge`、`edges: no-substitution template dynamic import is a value edge`、`edges: non-literal dynamic import is not an edge` が pass すること
- [x] 2.3 内部 specifier の解決を実装する(Decision 8)。root の `paths` だけを使い、完全一致をワイルドカードに優先し、ターゲットを列挙順に試して拡張子と `index` を補完し、未解決を違反として返す。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `resolve: pi-coding-agent from spirits src resolves to packages/coding-agent`、`resolve: spirits stub paths are not used`、`resolve: exact key wins over wildcard`、`resolve: extensions and index files are probed in order`、`resolve: multiple path targets are tried in order`、`resolve: non-internal specifier in paths stays external`、`resolve: unresolved internal specifier is a violation`、`resolve: external specifier is not judged` が pass すること
- [x] 2.4 ファイルの層への割当と許可表の導出を実装する(Decision 1・2・3・9)。公開パッケージの許可は `package.json` から、private パッケージと例外層と spirits の層の許可は `registry:layers` から、private パッケージと spirits の層への所属は `registry:layer-members` から、例外層への所属は `tsconfig.build.json` の `exclude` から導出し、dev ファイルを判定する。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `layers: public package direction derives from package.json`、`layers: private package and experimental layer use the registry`、`layers: experimental dirs derive from tsconfig.build.json exclude`、`layers: non-directory exclude entries are not experimental dirs`、`layers: spirits files map to eight layers and index.ts is entry`、`layers: unregistered spirits directory fails as unknown layer`、`layers: private package missing from the registry fails as unknown layer`、`layers: dev files are classified` が pass すること

## 3. 規約の判定

- [x] 3.1 層間依存の判定を実装する。違反時に規約 ID と import 元・先を失敗メッセージに含め、型の辺は型として区別して報告する。dev ファイルを起点とする辺は判定しない(Decision 11)。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `layer: allowed direction passes`、`layer: disallowed direction fails with rule id and paths`、`layer: type edge is checked and labeled as type`、`layer: adding a workspace dependency allows the direction`、`layer: undeclared workspace dependency fails`、`layer: external package is not judged`、`layer: import from a dev file is not judged`、`layer: experimental layer may import a registry-listed undeclared package`、`layer: experimental layer may import the same package`、`layer: non-experimental src importing an undeclared package fails` が pass すること
- [x] 3.2 spirits の層の判定を実装する(repl の後段非依存、兄弟層、entry 層)。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `spirits: repl importing a later layer fails`(静的・型のみ・動的 import の 3 通り)、`spirits: rlm to repl passes`、`spirits: harness to todo fails`、`spirits: harness to rlm fails`、`spirits: rlm to entry fails`、`spirits: repl to pi-coding-agent passes` が pass すること
- [x] 3.3 spirits と Pi 上流の境界の判定を実装する。`packages/spirits/src/` は bare specifier のみ、`packages/spirits/bin/` は `registry:bin-deep-imports` と完全一致する deep import のみ。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `boundary: src deep import fails`、`boundary: bin deep import outside the allowlist fails`、`boundary: bin allowlisted deep import passes`、`boundary: unused bin allowlist entry fails`、`boundary: bare specifier passes` が pass すること
- [x] 3.4 src から dev ファイルへの import(値と型)の判定を実装する。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `dev: src importing test fails`、`dev: src importing test with import type fails`、`dev: test importing src is not judged` が pass すること
- [x] 3.5 循環の判定を実装する(Decision 6)。層グラフの非循環、ファイル単位の強連結成分の識別、`registry:cycles` との完全一致。実リポジトリを走査して得た強連結成分のファイル集合を、Decision 12 のパスの書式で `registry:cycles` に記録する。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `cycles: new cycle fails`、`cycles: registered cycle passes`、`cycles: grown cycle fails`、`cycles: resolved cycle left in the registry fails`、`cycles: layer graph cycle fails` が pass し、記録した件数と大きさが design.md の実測表(4 つ、3・13・3・5 ファイル)と一致すること。一致しない場合は、原因が実装の誤りか、design の計測時との定義の違いかを調べ、実装の誤りでなければ design.md の実測表を実測値に更新してから記録する
- [x] 3.6 重複の ratchet を実装する(Decision 7)。実リポジトリの件数を `registry:duplication` の `baseline` に記録する。検証: `bun test test/architecture-conventions.fixtures.test.ts` のケース `duplication: above the baseline fails`、`duplication: below the baseline fails`、`duplication: equal to the baseline passes`、`duplication: dev duplicates are not counted` が pass し、記録した基数が design.md の実測表(61)と一致すること。一致しない場合は 3.5 と同じ手順で原因を調べ、実装の誤りでなければ design.md の実測表と spec の Scenario の基数を実測値に更新してから記録する

## 4. 実リポジトリの検査と検証

- [x] 4.1 `packages/spirits/test/architecture-conventions.test.ts` を作り、実リポジトリを検査の入口に通す。検証: `cd packages/spirits && bun test test/architecture-conventions.test.ts` のケース `real repo: no violations`、`real repo: cycles and duplication match the registry`、`real repo: every reportable rule id exists in the registry` が pass すること
- [x] 4.2 検証: `cd packages/spirits && bun test test/architecture-conventions.fixtures.test.ts` の全ケースが pass し、`cd packages/spirits && bun run check` が通ること(検査ファイルが erasable syntax のみで書かれ、フィクスチャが型検査から除外されていることを tsc が確認する)。あわせて `find packages/spirits/test/fixtures/architecture \( -name '*.test.*' -o -name '*_test.*' -o -name '*.spec.*' -o -name '*_spec.*' \)` の出力が空であること(Decision 13)
- [x] 4.3 検証: `cd packages/spirits && time bun test test/architecture-conventions.test.ts` が 30 秒の明示タイムアウト内で pass すること。実測時間を報告し、design.md の約 3.6 秒(Bun の単体スクリプト)と比べて差があれば Risks に反映する

## 5. CI・OpenSpec rules・統合確認

- [x] 5.1 `.github/workflows/spirits-ci.yml` の `push` と `pull_request` の両方の `paths` に `docs/architecture/**` を加える(Decision 4)。このファイルには他セッションの未コミットの変更があるため、コミットするときは自分の差分だけを stage する。検証: `grep -c 'docs/architecture/\*\*' .github/workflows/spirits-ci.yml` の出力が 2 であること
- [x] 5.2 `openspec/config.yaml` の `rules.specs` に、規約正本 `docs/architecture/convention-registry.md` への参照と「規約の変更時は正本と検査を同一変更で更新する」を追記する。検証: `grep -n 'convention-registry' openspec/config.yaml` が 1 行以上を返すこと
- [x] 5.3 検証: `cd packages/spirits && bun test` 全体が通ること(既存のテストが検査の追加で壊れていない)
- [x] 5.4 検証: `git diff --name-only <1.1 で控えたコミット> -- tsconfig.json package.json biome.json vitest.base.ts .github/workflows/ci.yml` の出力が空であること。出力がある場合は、その差分がこの change によるものでない(他セッションの変更である)ことを `git diff` で確認する
- [x] 5.5 検証: `openspec validate add-architecture-conventions --strict` が通ること

## 6. 検証指摘(verify2)の対応

上で未完了に戻したタスクの理由となる指摘。修正は apply で行い、各項目の検証を通してから完了にする。コードと正本(`docs/architecture/`)の修正はここで行う。

- [x] 6.1 (C-1、対象 2.2・3.1・3.5) `packages/spirits/test/architecture/rules.ts` の `edgeKey` を、指定子と種別(値・型)の組にする。値と型の両方の import を持つ循環のフィクスチャを追加し、検出されることを確認する。再計測で値の辺 10 本が消えていないことを確かめる。
- [x] 6.2 (C-2、対象 2.4・3.1) 公開パッケージのキーを正本の `registry:layers` に書いたときに失敗させ、許可表のキーが既知の層でないときに失敗させる。spec の追加シナリオに対応するフィクスチャを追加する。
- [x] 6.3 (W-2、対象 3.2・3.4) 解決先が走査対象外のファイル(`.json`、tsconfig 範囲外の `test/fixtures/`)でも、層と dev の判定を行う。フィクスチャを追加する。
- [x] 6.4 (W-1、対象 3.2) `spirits: repl to pi-coding-agent passes` という名前のテストを追加する。現在は `layer: allowed direction passes` で間接的に確かめているだけ。
- [x] 6.5 (W-3、対象 1.1) 所属表の層が許可表に無いフィクスチャを追加し、テスト名(`unknown layer in allow table or member table`)と内容を一致させる。
- [x] 6.6 (W-4、対象 1.2) 正本の `registry:layers` の例外層の許可を、design Decision 3 の未宣言 4 パッケージ(`packages/client` `packages/durable` `packages/protocol` `packages/server`)だけに絞る。
- [x] 6.7 (G-1) design の実測表を再計測値に更新した。
- [x] 6.8 (G-2) 正本の ARCH-DUP 節の「例外」にある循環の文を ARCH-CYCLE 節へ移し、「リファレング」を「リファクタリング」に直す。
- [x] 6.9 (G-3) `layers.ts` の `isDevFile` は `packages/` 以外のすべてのパスを dev とみなす。spec の定義(root の `scripts/` とルート直下)に合わせるか、走査対象の範囲に限ることを spec に明記する。
- [x] 6.10 (S-1) 公開パッケージが private の workspace パッケージを宣言する場合は許可向きにしない、と spec に要件とシナリオを追加した。実装(`layers.ts` の `!target.private`)はすでにこの扱いのため変更不要。

## Workflow follow-up

- プロジェクトのレビュー要件を満たしてから変更をアーカイブする。
- アーカイブ結果を検証する。
- `AGENTS.md` の「インライン import 禁止」と `*.lazy.ts` の遅延ロード方式の整合を取る別 change を立てるかどうかを判断する(本変更の対象外)。
- `docs/spirits-upstream-sync.md` の検証手順に、architecture-conventions のテストが失敗したときは同じ merge で正本を更新する旨を足すかどうかを判断する(本変更の対象外)。
