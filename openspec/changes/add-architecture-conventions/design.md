# Design

## Context

一次根拠は `docs/spirits-design.md` の §5(フォーク運用方針: 新規コードは `packages/spirits/` に置き、Pi コアへの変更はゼロに保つ)と §9(ディレクトリ構成)。上流 merge の手順は `docs/spirits-upstream-sync.md`。本書はそれらを繰り返さず、依存方向の検査に固有の判断だけを書く。

計測は `typescript` 7.0.2 の AST で行った。同バージョンは classic API を公開せず、`Bun.Transpiler#scanImports` は型のみの import を区別できないため、検査は TS の AST を直接扱う。

用語:
- **走査対象**: root の `tsconfig.json` と `packages/spirits/tsconfig.json` の `rootFiles` から `.d.ts` と `.json` を除いたファイル。
- **dev ファイル**: `packages/*/test/` と `packages/*/examples/` 配下、`packages/*/*.config.ts`、`packages/ai/scripts/` 配下、リポジトリルートの `scripts/` 配下とルート直下のファイル。
- **src**: 走査対象のうち dev ファイルでないもの。`packages/coding-agent` の experimental 層と `packages/evals` の src を含む。
- **基数**: 重複の ratchet で正本に記録する、重複ハッシュ群の件数。
- **ベースライン**: この変更を導入する時点で、各規約について実測した違反件数。

実測(各 tsconfig の `rootFiles` を範囲とする。解決は root の `paths` のみ。Decision 8)。値は計測用の一時スクリプトで得たもので、検査の実装時に再計測する(tasks 3.5・3.6・4.1):

| 項目 | 実測値 |
|---|---|
| 走査ファイル | 1,659(root tsconfig 1,554 + spirits 105。spirits の 105 は検査自身の dev ファイル 9 件を含む) |
| import 辺(値 + 型) | 8,545(値 7,033 + 型 1,512) |
| 辺の内訳 | 静的 import 値 6,668 / 型 1,407、`export … from` 値 287 / 型 85、文字列リテラルの動的 import 42、型位置の `import("x")` 15 |
| 全指定子が inline の `type` である import | **0** |
| 内部 specifier の未解決 | **0** |
| 層グラフの値依存循環 | **0** |
| ファイル単位の値依存循環(強連結成分) | **4**(3・13・3・5 ファイル。`chord` 1、`coding-agent` 2、`durable` 1。すべて上流パッケージ内) |
| src から dev ファイルへの import(値 / 型) | **0 / 0** |
| 新規規約違反(値 / 型) | **0 / 0** |
| spirits src の specifier import(`test/` 除く) | 20 文(`pi-coding-agent` 16、`pi-tui` 1、`typebox` 3)、`@earendil-works/*` の deep import **0** |
| spirits bin の specifier import | 4(bare 1 + deep 3) |
| 重複ハッシュ群(src 限定・10 行以上) | **61** |
| 動的 import | 文字列リテラル 42(うち src 25)、引数が非リテラル 5 |
| 検査相当の走査時間 | Bun 1.4.2 の単体スクリプトで約 3.6 秒(API 起動 1 回、走査と重複計測を含む、手元の 1 回計測) |

表の走査ファイル数と辺数は再計測値である(verify2 G-1)。「辺の内訳」行は初回計測のままで(合計 8,504)、再計測の合計とは一致しない。

制約: `openspec/config.yaml` のハードルール「全実装は packages/spirits/ に集約、Pi コアは原則変更禁止」「後段非依存」。`AGENTS.md` の「erasable syntax のみ」「インライン import 禁止」。上流 `ci.yml` は upstream 由来で、本変更はそれに触れてはならない。

## Goals / Non-Goals

**Goals:**
- 規約を散文から検査可能な形にし、層間依存方向・spirits の層構造・spirits と Pi 上流の境界・循環・重複を強制する。
- 許可表を `package.json` と `tsconfig.build.json` から導出できる部分は導出させ、正本は private 層と例外のみを書く。
- 検査を `packages/spirits/` 内に収め、上流コアのファイルを 1 つも変更しない。
- 検査自身が違反を検出できなくなったときに気づける。

**Non-Goals:**
- `AGENTS.md` の「インライン import 禁止」を新規に強制しない。動的 import は依存の辺として数えるが、禁止はしない(Decision 10)。
- パッケージ間の「依存の宣言」規則を新規に強制しない。これは既存の `scripts/check-runtime-deps.mjs` が公開パッケージの src に対して担っており、計測した未宣言 13 件はすべて `src/experimental/**`(tsconfig.build.json が除外)、`test/`、`examples/`、private パッケージに由来し、既存の仕組みでカバーされている。
- GoF パターン名や「継承は N 段まで」のような一般則を規約にしない。継承の深さ 3 は実測ベースラインとして正本に記録するだけで、ratchet はしない。
- `packages/ai/src/models.generated.ts` など生成物の重複を減らすことは目的にしない。ただし生成物も src に含まれるため重複の件数には入り、基数は生成物を除外せずに測った値である。
- 既存の循環の解消や重複の削減。循環 4 件はすべて上流パッケージ内にあり、解消には上流の変更が要る。

## Decisions

### 1. spirits を 8 層に分割し、`src-root` を `entry` と `shared` に割る

`packages/spirits/src/` の直下ファイルを 1 層(`src-root`)にすると、`index.ts` が `rlm/` `harness/` `todo/` を import するため `rlm → src-root` が合法になり、`rlm/foo.ts` → `index.ts` → `harness` という間接経路で層の分離を破れる。これを防ぐため、他層から import されている `index.ts` だけを `entry` 層とし、残り(`config.ts` `constants.ts` `version.ts` `tools.ts` `types/` `branding/`)を `shared` 層にする。`tools.ts` は `repl/` しか import しないため `shared → repl` の許可が必要。

`rlm` / `harness` / `todo` は互いに依存しない兄弟層とする。Roadmap 上は harness(M4)が rlm(M3)の後段だが、現行コードに harness → rlm の import は無い(違反 0 件)。必要になった時点で、正本の表に 1 行を先に足してから許可する。

「Pi」は `packages/coding-agent` と `packages/tui` を指す。spirits は Pi の拡張であり、全層が Pi を前提に動くため、`bin` を除く全 src 層に Pi を許可する。`bin` は `packages/coding-agent` のみ。

| 層 | 許可 |
|---|---|
| `spirits:repl` | Pi |
| `spirits:shared` | `spirits:repl`, Pi |
| `spirits:rlm` / `spirits:harness` / `spirits:todo` | `spirits:repl`, `spirits:shared`, Pi |
| `spirits:update` | `spirits:shared`, Pi |
| `spirits:entry` | `spirits:repl`, `spirits:shared`, `spirits:rlm`, `spirits:harness`, `spirits:todo`, Pi |
| `spirits:bin` | `spirits:entry`, `spirits:shared`, `spirits:update`, `packages/coding-agent` |

各層に属するパスは正本の `registry:layer-members` に登録する(Decision 12)。現状の登録は次のとおり。
- `spirits:repl` `spirits:rlm` `spirits:harness` `spirits:todo` `spirits:update`: `packages/spirits/src/` の同名ディレクトリ
- `spirits:shared`: `config.ts` `constants.ts` `version.ts` `tools.ts` `types/` `branding/`
- `spirits:entry`: `index.ts`
- `spirits:bin`: `packages/spirits/bin/`
- `packages/evals`: `packages/evals/`

登録に当てはまらない src のファイル(`packages/spirits/src/` に新しく足したディレクトリや直下ファイル、正本に無い private パッケージ)は、未知の層として `ARCH-LAYER-UNKNOWN` で失敗させ、既定の層には割り当てない。層やディレクトリを足す変更は、同じ変更で正本の所属表を更新しない限り通らないため、新しい継ぎ目が必ずレビューに上がる。

**代替案 A:** `src-root` を単層のままにする。却下。`index.ts` 経由の間接依存で `rlm → harness` を防げない。
**代替案 B:** Roadmap の順序どおりに harness → rlm を許可する。却下。後から 1 行足すのは容易だが、一度許した向きを禁止するには既存コードの修正が要る。
**代替案 C:** 登録に当てはまらないファイルを `spirits:shared` に割り当てる。却下。新しいディレクトリが shared の権限を黙って得て、`rlm` `harness` `todo` `update` `entry` `bin` のすべてから import できるようになる。

### 2. 公開パッケージの許可向きは `package.json` から導出する

公開パッケージ(`private` でない)について、許可向きをその `package.json` の `dependencies` / `optionalDependencies` / `peerDependencies` の workspace 依存から検査時に導出する。これで `package.json` に宣言のない向きは自動的に禁止され、依存追加は正本の編集なしに効く。計測上、この導出は手書き表と一致する(宣言されていない `pi-client` `pi-durable` `pi-protocol` `pi-server` は、experimental 層を除く src の import が 0 件)。

private パッケージ(`packages/evals`、`packages/spirits`)は出荷物ではないため、`package.json` ではなく正本の表を正とする。`packages/evals` は `packages/ai` と `packages/coding-agent` を許可する(独立層。宣言依存は devDependencies のみで 0 件、どこからも import されない最上位)。

公開パッケージの層を正本の `registry:layers` のキーに書くと、検査は失敗する。許可の二重管理を防ぎ、`package.json` の変更が正本の変更を要らないようにするためである(verify2 C-2)。

**代替案:** 公開パッケージの表も正本に手書きする。却下。手書きすると `package.json` と二重管理になり、片方だけ直る取り違えが起きる。

### 3. `tsconfig.build.json` が除外するディレクトリを例外層にする

`packages/coding-agent/tsconfig.build.json` の `exclude` は `src/client` `src/experimental` `src/cli/experimental` の 3 ディレクトリを挙げる。この 3 つを `packages/coding-agent:experimental` 層とし、そこだけ `package.json` 未宣言の 4 パッケージに許可を与える。層への所属は `exclude` から導出するため、除外一覧を正本に書かない。

導出の規則: 全公開パッケージの `tsconfig.build.json` を読み、`exclude` の要素のうち、`src/` で始まり(`src` 自身を除く)、glob(`*` `?` など)を含まず、実在するディレクトリだけを採る。`node_modules` `dist` や、他の 12 パッケージが持つ `src/**/*.d.ts` は採らない。現状で該当するのは `packages/coding-agent` の 3 ディレクトリだけである。例外層以外の部分から例外層への import は、`package.json` からも正本からも許可されないため違反になる。

この層の許可向きは「当該パッケージの `package.json` 宣言分 + 同パッケージの非例外部分 + 正本に列挙した未宣言 4 パッケージ」とする。正本に書くのは未宣言の 4 パッケージだけとし、宣言済みのパッケージは書かない。宣言済みを書くと、`package.json` から依存を外しても例外層に許可が残る(verify2 W-4)。例外層が同一パッケージの通常 src へ import することは当然必要であるため。

**代替案:** 例外層の許可向きを 4 パッケージだけにする。却下。例外層は同一パッケージの通常 src を import するため、即座に違反だらけになる(実測 114 件)。

### 4. 検査は `packages/spirits/test/` に置き `bun test` で動かし、正本の変更でも CI を起動する

実リポジトリの検査は `packages/spirits/test/architecture-conventions.test.ts`、検査自身のテストは `packages/spirits/test/architecture-conventions.fixtures.test.ts`、共通の処理は `packages/spirits/test/architecture/` に置く。`packages/spirits/bunfig.toml` の preload と `spirits-ci.yml` の "Test and type-check spirits" 手順(`bun test`)がすでに存在するため、テストの実行手順は足さない。

ただし `spirits-ci.yml` の `paths` には `docs/**` が無く、正本 `docs/architecture/convention-registry.md` だけを変える PR では検査が走らない。許可表を正本だけ編集して merge できてしまうため、`push` と `pull_request` の両方の `paths` に `docs/architecture/**` を足す。`spirits-ci.yml` は spirits が所有するファイルで、上流を変更しない制約には反しない。

リポジトリルートは検査ファイルの位置から上方に辿って `workspaces` を持つ `package.json` を探す。`bun test` の cwd は `packages/spirits` であるため、cwd に依存させない。

**代替案 A:** root の `tsconfig.json` の `include` に検査ファイルを追加し、`scripts/*.test.ts`(`node --test`)として動かす。却下。`include` は 1 行の上流ファイルであり、upstream での merge が頻発するこのリポジトリで競合が起きやすい。また最重要の後段非依存が Spirits CI の `bun test` ではなく上流 `ci.yml` の `npm test` でしか走らなくなる。
**代替案 B:** `scripts/*.mjs` に置く。却下。この方式は同期 TS API が必要だが、それが Spirits CI の `bun test` に乗らない(Decision 5)。
**代替案 C:** 正本を `packages/spirits/` 配下へ移し、`paths` を変えずに済ませる。却下。規約本文は repo 全体の規約であり、`docs/` に置く既存の慣行(設計書)に合わせる。

### 5. TS API には非同期 API(`typescript/unstable/async`)を使い、テストに明示タイムアウトを付ける

`typescript/unstable/sync` は Bun 1.4.2 で動作しない。実測すると `SyncRpcChannel` が `stdout._handle.fd` を要求し、Bun の stdout では `undefined` になる。一方 `typescript/unstable/async` は Bun 1.4.2 で動作する。非同期 API は子プロセスとして tsgo を起動する。

実行時間: Bun 1.4.2 の単体スクリプトで、API 起動 1 回の走査と重複計測を合わせて約 3.6 秒(手元の 1 回計測)。以前の「約 2.7 秒」は import の数え上げだけの部分計測で、層判定・循環・重複を含まない。`bun test` からの全体の実測は task 4.3 で取る。

`bun test` の既定タイムアウトは 1 テスト 5 秒とされる(Bun の文書による。未検証)。CI の速度差で既定を超えうるため、走査は 1 回だけ行って結果を各テストで共有し(`beforeAll`)、そのフックと各テストに明示タイムアウト **30 秒** を付ける。30 秒は手元実測の約 8 倍に当たる余裕であり、実測に基づく上限ではない。フックの明示タイムアウトが効くことは task 2.1 で確認する(未検証)。

**代替案:** 同期 API を使う。却下。Bun で失敗する(実測済み)。
**代替案:** タイムアウトを既定の 5 秒のままにする。却下。実測の 3.6 秒は CI で超えうる。

### 6. 循環は層グラフの assert とファイル単位の許可リストの 2 段にし、ファイル単位は強連結成分で識別する

層の値依存グラフが非循環であることを assert する(実測 0 件)。

ファイル単位は、値の辺から作るファイルグラフの強連結成分(互いに到達できるファイルの最大集合)のうち、2 ファイル以上のもの、または自己 import を持つものを「循環」とし、そのファイル集合(ソート済みのパス一覧)で識別する。正本の許可リストに登録された集合と **完全に一致** するときだけ通す。実測は 4 つ(3・13・3・5 ファイル)。

- 許可リストに無い循環は失敗する。既存の循環に別のファイルが加わった場合も、集合が一致しないため新規として失敗する。例: 登録済みの `{A, B, C}` に、`D` が `A` へ import し `A` が `D` へ import する変更が入ると、`{A, B, C, D}` になり失敗する。
- 許可リストの項目に対応する循環が無いときも失敗し、正本から項目を削除するよう報告する。例: `{A, B, C}` の循環を解消した後に、正本の項目が残っていると、同じ循環を後で再導入しても通ってしまうため。
- 既存の強連結成分の内側で辺が増えるだけの変更は検出しない。受け入れる制限であり、層グラフの assert は別に効く。

**代替案 A:** 単純閉路をすべて列挙して許可リストにする。却下。列挙の結果が探索順で変わり、無関係なファイルが増えるだけで許可済みの閉路が別の集合として報告されうる。大きな強連結成分では件数も急増する。
**代替案 B:** すべての循環を禁止する。却下。4 つの循環は 24 ファイルに及び、すべて上流パッケージ(`chord`、`coding-agent`、`durable`)内にある。解消には上流コードの変更が要り、「Pi コアは原則変更禁止」に反する。

### 7. 重複は src 限定・10 行以上のハッシュ群で ratchet し、基数との完全一致を要求する

計測の定義:
- 対象は src(用語を参照)。dev ファイルは含めない。
- 対象ノードは、関数宣言・メソッド・アロー関数・関数式の本体と、変数宣言の初期化子。初期化子がアロー関数のときは初期化子と本体の両方を別個に数えるため、重複した 1 つのアロー関数が 2 群になりうる。
- 正規化は、空白の連続を 1 つの半角スペースにし、前後を除くことだけを行う。コメントと識別子は変えない。
- 正規化後の本文が 60 文字以上、かつ元の記述が 10 行以上のものだけを数える。
- 正規化後の本文が一致するノードが 2 件以上あるものを 1 群とする。群の件数が基数(実測 61)。
- 群の件数が基数と **一致** しないときに失敗する。多いときは増加、少ないときは基数を下げるよう報告する。減った分を残したままにすると、後で同じ件数が増えても通ってしまうため。
- 基数だけを記録するため、どの群が増えたかは特定できない。超過時は現在の全群をファイルの場所つきで報告する。

閾値の理由: 10 行は、短い定型コードを群から外すための下限である。dev ファイルを含む全ファイルでの事前計測では、重複群の行数の分布は 1〜4 行 1,020、5〜9 行 431、10〜19 行 155、20 行以上 41 で、10 行未満が約 9 割を占めた(例: 8 行・11 か所の `EMPTY_USAGE` のような小さな定数オブジェクト)。60 文字は、行数に関係なく短い本文を除く下限として計測の当初から使った値で、他の値との比較はしていない。この 2 つの値で基数 61 を実測したため、値を変える場合は基数を測り直し、spec の Scenario と task 3.6 の値も更新する。

**代替案 A:** 全ファイルを対象にする。却下。test のハーネスヘルパー(`createUsage` `streamFn` `toolUsage` など)が大部分を占めるため、ベースラインの意味がなくなる。
**代替案 B:** 基数を記録するだけにする。却下。記録するだけでは増加を検知できず、規約として機能しない。
**代替案 C:** 基数以下なら通す。却下。減った分の余裕が後の増加を隠す。

### 8. 内部 specifier は root の `paths` だけで解決し、解決できなければ失敗とする

内部 specifier(相対と `@earendil-works/*`)の解決は、検査側が root の `tsconfig.json` の `paths` だけを使って longest-prefix 一致で行う。完全一致のキーはワイルドカードに優先する。解決できなかったものは違反として報告する。

`paths` のターゲットが複数あるときは列挙順に試す。各候補について、そのままのパス、`.ts`、`.tsx`、`/index.ts`、`/index.tsx` の順にファイルの実在を確かめ、最初に見つかったものを採る。相対 specifier も同じ補完で解決する。例: bin の `@earendil-works/pi-coding-agent/cli/setup` は `@earendil-works/pi-coding-agent/*` → `./packages/coding-agent/src/*` に当てはまり、補完によって `packages/coding-agent/src/cli/setup.ts` に解決する。`typebox` のように `paths` にあっても内部 specifier でないものは、外部として扱い解決しない。

`packages/spirits/tsconfig.json` の `paths`(`@earendil-works/pi-coding-agent` → `src/types/pi-coding-agent.d.ts` など)は spirits の型検査用スタブであり、実行時の依存先は上流パッケージであるため、解決には使わない。例: `src/repl/cell.ts` の `import type … from "@earendil-works/pi-coding-agent"` は `packages/coding-agent` への依存として扱い、Decision 1 の `spirits:repl` の許可(Pi)で通る。

**代替案 A:** spirits の `paths` で解決し、`src/types/*.d.ts` を層として全層から許可する。却下。実行時の依存先である Pi 本体が層グラフに現れず、上流への依存が検査できない。
**代替案 B:** 解決不能を情報出力に留める。却下。規約が効いているように見えて効いていない状態になる。誤った resolver が規約を静かに無効化する。
**代替案 C:** `@earendil-works/*` を外部として扱う。却下。同じ理由で、内部の依存が検査から消える。

### 9. 検査のファイル範囲は各 tsconfig の `rootFiles` とする

`node_modules` 配下の `.d.ts` や import で巻き込まれたファイルを含まないため、`rootFiles` を使う。program のファイル一覧(`getSourceFileNames`)は 4,295 件で、うち 2,586 件が `node_modules` 配下である。

**代替案:** `readdir` で再帰列挙する。却下。除外ディレクトリの管理が検査側に重複する。

### 10. 動的 import は辺に含め、インライン import 禁止の強制は対象外にする

引数が文字列リテラル(または置換のないテンプレート)の動的 import は値の辺として数え、層判定・循環・未解決の検査に含める。引数が非リテラルのもの(5 件)は解決できないため辺にしない。

動的 import は 42 件(うち src 25)あり、内訳はほぼすべて `*.lazy.ts` が同名の非遅延版を import する、リポジトリ標準の遅延ロード方式である。`AGENTS.md` の「インライン import 禁止」との整合は別 change で解消すべき事項で、本変更は動的 import を禁止しない。

**代替案 A:** 動的 import を辺から除外する。却下。`*.lazy.ts` 経由の依存や、repl から後段への動的 import が検出されなくなる。
**代替案 B:** 動的 import の件数を ratchet にする。却下。既存 25 件の扱いが決まっておらず、この変更の範囲を超える。

### 11. 依存の辺の定義と、値・型の分類

| 構文 | 分類 |
|---|---|
| `import type …`、`export type … from` | 型 |
| 型位置の `import("x")` | 型 |
| `import { type A, type B } from "x"`(全指定子が inline の `type`) | 値 |
| `import { type A, b } from "x"`、既定 import、`import "x"`、`export … from` | 値 |
| 文字列リテラルまたは置換のないテンプレートを引数にした動的 `import()` 呼び出し | 値 |
| 引数が非リテラルの `import(expr)` | 辺にしない |

全指定子が inline の `type` である import を値にするのは、`tsconfig.base.json` の `verbatimModuleSyntax: true` により、この import が `import {} from "x"` として出力に残って実行時に読み込まれるため(tsc の仕様に基づく。Bun の変換結果は未検証だが、値として扱うと検査が厳しい側に倒れる)。現行コードに該当は 0 件で、ベースラインに影響しない。

型の辺は値の辺と同じ許可表で照合する(型だけでも層の結合になるため)。違反の報告では値と型を区別する。層グラフの非循環とファイル単位の循環の検査は値の辺だけを使う。src から dev ファイルへの import は値と型の両方を対象にする。

判定の起点: 層の判定(許可表の照合と層グラフの非循環)は src を起点とする辺だけを対象にし、dev ファイルを起点とする辺は判定しない。test や examples が devDependencies の workspace パッケージを import するのは正当であり(Non-Goals の未宣言 13 件の一部)、`packages/spirits/test/` は 8 層のどれにも属さないため。src から dev ファイルへの辺は層の判定をせず、`ARCH-SRC-DEV` だけで判定する。ファイル単位の循環は、走査対象の全ファイル(dev ファイルを含む)の値の辺で判定する。

同じ import 元と指定子の組に値の辺と型の辺が両方あるときは、両方を別々に保持する。指定子だけをキーにして上書きすると、後から来た型の辺が値の辺を消し、循環の検査から依存が抜ける。実測では値の辺 10 本がこの形で消えていた(verify2 C-1)。

**代替案:** 全指定子が inline の `type` である import を型の辺にする。却下。実行時に読み込まれる依存を、循環検出から落とす。

### 12. 正本の機械可読部は JSON の fenced block とし、欠落・不正では失敗する

問題: 検査が Markdown の正本から許可表や基数を読むとき、書式が決まっていないと実装ごとに解析がずれる。解析に失敗した値が黙って通る形も危ない。例: 基数が `NaN` になると `count > NaN` は常に false になり、重複の検査が常に通る。

書式: 正本の機械可読部は、info string が `json registry:<名前>` の fenced code block とし、中身は JSON とする。新規依存を足さず、`JSON.parse` だけで読める。

| ブロック | 内容 |
|---|---|
| `registry:layers` | 層名 → 許可する層名の配列。private パッケージ、例外層、spirits の各層 |
| `registry:layer-members` | 層名 → 所属するパスの配列。private パッケージと spirits の各層(Decision 1)。公開パッケージと例外層は導出するため書かない |
| `registry:bin-deep-imports` | `packages/spirits/bin/` で許可する deep import の specifier の配列(3 件)。実際の deep import との完全一致を要求する |
| `registry:cycles` | 許可する循環の配列。各要素はファイルパスの配列(順序は問わず、集合として比較する) |
| `registry:duplication` | `{ "baseline": <非負整数> }` |

書式:
- 層名は、公開パッケージと private パッケージが `packages/<ディレクトリ名>`、例外層が `packages/<ディレクトリ名>:experimental`、spirits の層が `spirits:<層>`(`spirits:repl` など 8 つ)とする。
- パスはリポジトリルートからの相対パスで、区切りは `/` とする。`registry:layer-members` のディレクトリは末尾に `/` を付け、ファイルは付けない。ファイルは、登録されたディレクトリの配下にあるか、登録されたファイルと一致するとき、その層に属する。
- `registry:bin-deep-imports` は、`packages/spirits/bin/` のどの import にも使われていない要素があっても失敗する。理由は循環の許可リストと同じで、残った要素があると、同じ deep import を後で再導入しても通ってしまうため。

人間向けの規約本文は、`## <規約ID>: <題名>` の節にし、`強度` `内容` `例外` `判定方法` `根拠` の 5 項目を持たせる(規約 ID は見出しが与える)。検査が報告する規約 ID はすべてこの見出しに存在しなければならない。

規約 ID と spec の Requirement の対応:

| 規約 ID | 内容 | spec の Requirement |
|---|---|---|
| `ARCH-LAYER` | 層間依存の許可向き(公開パッケージ、private パッケージ、例外層) | 層間依存の許可向きのみを受け付ける / 公開パッケージの許可向きは package.json から導出する / ビルド対象外のディレクトリを例外層とする |
| `ARCH-LAYER-UNKNOWN` | どの層にも属さない src のファイル | どの層にも属さない src のファイルは失敗する |
| `ARCH-REPL` | repl の後段非依存 | repl は後段の層へ依存しない |
| `ARCH-SPIRITS-LAYER` | spirits の層の許可向き(兄弟層、entry) | spirits の層は許可表に載った向きへのみ依存する |
| `ARCH-PI-BOUNDARY` | spirits と Pi 上流の境界(bare specifier、bin の許可リスト) | spirits と Pi 上流の境界を強制する |
| `ARCH-SRC-DEV` | src から dev ファイルへの import | src は dev ファイルを import しない |
| `ARCH-RESOLVE` | 内部 specifier の解決 | 内部 import は root の tsconfig の paths で解決し、解決できないものは失敗とする |
| `ARCH-CYCLE` | 値の依存の循環(層とファイル) | 値の依存グラフの循環を禁止する |
| `ARCH-DUP` | 重複の ratchet | 重複の増加を ratchet する |

層の違反は、起点が `spirits:repl` なら `ARCH-REPL`、それ以外の spirits の層なら `ARCH-SPIRITS-LAYER`、spirits 以外の層なら `ARCH-LAYER` で報告し、1 つの層の違反を複数の ID で重ねて報告しない。正本の不備(下記)は規約違反ではないため、規約 ID を付けずに報告する。

次の場合は、検査全体が失敗する。通過させてはならない。
- 正本ファイルが無い。
- 必須のブロックが無い、JSON として不正、または型が違う(基数が非負整数でない、許可表・所属表の値が文字列の配列でない)。
- 許可表が存在しない層を参照している、所属表の層が許可表に無い、または 1 つのファイルが所属表の複数の層に当てはまる。
- TS API が起動できない、または走査したファイルが 0 件である。

**代替案 A:** 正本とは別に `convention-registry.json` を置く。却下。規約本文と数値が 2 ファイルに分かれ、片方だけ直る取り違えが起きる。
**代替案 B:** Markdown の表を解析する。却下。列の追加や書式の揺れで解析が壊れやすい。
**代替案 C:** YAML のブロックにする。却下。解析に依存の追加か Bun 固有の機能が要る。

### 13. 検査自身の検出能力をフィクスチャで検証する

問題: 検査が違反を検出できなくなっても、実リポジトリは違反 0 件なので通り続ける。例: 解決器が全 import を外部扱いにすると、層違反は常に 0 件で通る。注入して戻す手動の確認は、実装後に検出能力が失われても気づけない。

解決: 検査の入口を「リポジトリルートと正本のパスを受け取り、違反の一覧を返す」形にする。実リポジトリの検査とフィクスチャのテストが同じ入口を使う。フィクスチャは `packages/spirits/test/fixtures/architecture/<ケース名>/` に置く小さな疑似リポジトリで、自前の `package.json`・`tsconfig.json`・`packages/*/`・正本を持つ。規約ごとに、違反を含むケースと含まないケースを置き、期待する規約 ID を assert する。次も対象にする。
- 公開パッケージの許可向きの導出(依存追加で許可、未宣言で違反)
- src から dev ファイルへの import
- 検査の cwd 非依存(別の作業ディレクトリでも同じ結果)
- 正本の不備(欠落・解析失敗)
- 辺の分類(Decision 11 の各構文)
- 解析器の起動失敗

入口は、解析器を起動する関数を省略可能な引数として受け取る(既定は `typescript/unstable/async`)。起動に失敗したときに検査が失敗することを、フィクスチャのテストで再現するため。

フィクスチャの TS ファイルが `bun run check` で型検査されず、実リポジトリの走査にも入らないよう、`packages/spirits/tsconfig.json`(spirits が所有)の `exclude` に `test/fixtures/architecture` を加える。

フィクスチャ内のファイル名には `.test.` `_test.` `.spec.` `_spec.` を含めない。`packages/spirits` の `bun test` は cwd 配下からこれらの名前のファイルを探してテストとして実行するため、疑似リポジトリの `test/` を模したファイルでも別の名前にする。

**代替案:** 判定関数に辺の配列を直接渡すテストにする。却下。解決・`package.json` 導出・正本の読み込みが検証の外になり、Decision 8 のような解決の誤りを検出できない。

## Risks / Trade-offs

- [非同期 API の子プロセス起動が CI で不安定になる、または遅い] → Mitigation: Bun 1.4.2 の単体スクリプトで約 3.6 秒。テストに 30 秒の明示タイムアウトを付ける。`spirits-ci.yml` は既に `bun test` を実行しており、同じ条件下で動く。CI での実測は初回実行で確認する。
- [許可表を `package.json` に結合したため、依存の追加が自動的に新しい向きを許可する] → Mitigation: これは `check-runtime-deps.mjs` と同じ信任境界であり、依存追加はレビュー済みでなければ CI を通れない。
- [層の分割が細かく、層やディレクトリを足すたびに正本の所属表と許可表を更新する必要がある] → Mitigation: 未登録のファイルは `ARCH-LAYER-UNKNOWN` で失敗し、失敗メッセージが登録先のブロックを示す。層の追加は「新しい継ぎ目」としてレビュー項目にする(同梱スキル `architecture-guards` の方針)。検査のコードは変えず、正本だけを編集する。
- [循環の許可リストと重複の基数が実測との完全一致を要求するため、上流 merge で上流コードの循環や重複が変わると Spirits CI が失敗する。循環 4 件はすべて上流パッケージ内] → Mitigation: 失敗メッセージが差分(増えた循環、消えた循環、現在の群の一覧)を示す。上流 merge と同じ変更で正本を更新する。`docs/spirits-upstream-sync.md` の手順への追記の要否は、Open Questions で扱う。
- [強連結成分での識別は、既存の強連結成分の内側で辺が増えるだけの変更を検出しない] → Mitigation: 受け入れる制限。層グラフの非循環は別に assert される。
- [全指定子が inline の `type` である import を Bun が実行時にどう扱うかは未検証] → Mitigation: 値として扱う側に倒す。現行コードに該当は 0 件で、ベースラインに影響しない。
- [`typescript/unstable/*` は非安定 API で、Bun のバージョン非依存の書き方ではない] → Mitigation: `packages/spirits` の `typescript` は完全ピン留め(現状 7.0.2)。

## Open Questions

- 上流 `ci.yml` がこの fork で実際に有効かどうかはリポジトリからは確認できない(設定上の無効化はローカルからは読めない)。検査は `spirits-ci.yml` の `bun test` に乗るため、上流側が無効でも規約は強制される。上流側も有効であれば、本変更は上流 `npm test` の対象にはならない(検査は Spirits CI 側で走る)ため、影響はない。
- `AGENTS.md` の「インライン import 禁止」と `*.lazy.ts` の遅延ロード方式の整合を取る別 change を立てるかどうか。本変更では触れない。
- `docs/spirits-upstream-sync.md` の検証手順に、「architecture-conventions のテストが失敗したら、同じ merge で正本を更新する」旨を足すかどうか。足さなくても検査は動くが、上流 merge 時に失敗の原因を探す手間が増える。本変更では触れない。
- 公開パッケージが private の workspace パッケージを `package.json` に宣言したときの扱い(verify2 S-1)。現実装は許可向きに含めない(`layers.ts` の `!target.private`)。公開パッケージは非公開パッケージに実行時依存できない、という理由による。決定: spec に書く(private な workspace パッケージへの宣言は許可向きにしない)。実装は変更不要。
