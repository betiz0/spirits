# アーキテクチャ規約正本

この文書はリポジトリのアーキテクチャ規約の**正本**である。各規約は ID で参照され、検査(`packages/spirits/test/architecture-conventions.test.ts`)は本文書の機械可読部(JSON ブロック)から許可表・所属表・循環の許可リスト・重複の基数を読む。検査側はこれらの複製を持たない。

**規約を変更するときは、正本と検査を同一変更で更新する。** 層やディレクトリを足す変更は、同じ変更で `registry:layer-members` を更新しない限り検査が通らない。

## 用語

- **ホスト**: `packages/spirits` の依存として固定した公開パッケージ (`@earendil-works/*`)。spirits はホストを、その package.json が `exports` に載る specifier (載らない場合は `types` / `main`) でのみ import する。解決は importer から `node_modules` をたどって見つけたパッケージの package.json でおこなう。root の `tsconfig.json` の `paths` はホストの解決に使わない。
- **ホスト層**: `node_modules/@earendil-works/<name>` の内のファイルは層 `host:<name>` に属す。許可表はこれを依存先として載せられる。ホスト自身の内部は走査しない。
- **走査対象**: root の `tsconfig.json` と `packages/spirits/tsconfig.json` の `rootFiles` から `.d.ts` と `.json` を除いたファイル。
- **dev ファイル**: `packages/*/test/` と `packages/*/examples/` 配下、`packages/*/*.config.ts`、`packages/*/scripts/` 配下、リポジトリルートの `scripts/` 配下とルート直下のファイル。dev ファイルを起点とする import は層の判定をしない。
- **src**: 走査対象のうち dev ファイルでないもの。
- **基数**: 重複の ratchet でこの文書に記録する、重複ハッシュ群の件数。

## 層の構成

- 公開パッケージ(`package.json` の `private` でないもの)は `packages/<ディレクトリ名>` の層を持つ。許可向きは各 `package.json` の `dependencies` / `optionalDependencies` / `peerDependencies` の workspace 依存から検査時に導出する。依存追加は正本の編集なしに新しい向きを許可する。
- private パッケージと例外層と spirits の層は `registry:layers` の表を正とする。
- **例外層**は公開パッケージの `tsconfig.build.json` の `exclude` のうち `src/` 配下を指し(`src` 自身を除く)、glob を含まず、実在するディレクトリからなる。例外層の許可向きは「当該パッケージの `package.json` 宣言分 + 同パッケージの例外層以外の部分 + 下記 `registry:layers` に列挙した未宣言パッケージ」である。
- **spirits** は 13 層に分割される。`packages/spirits/src/index.ts` だけが `entry` 層で、`repl` `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `guard` `verify` は互いに依存しない兄弟層(`commands` は `routing` に、`managed-pi` は `update` に限って依存を許可する)。`bin` を除く全 src 層はホスト (`host:pi-coding-agent` と `host:pi-tui`) を許可する。ただし `routing` と `verify` はホストのうち `host:pi-coding-agent` のみを許可し、`managed-pi` は `update` への依存を再利用する資産に限定する。`bin` はホストを import しない。検証レポート保存(`verify`)は兄弟層で、`routing` への依存は実行中ステップを読むみの参照に限定する(書き込みはしない)。
- 層への所属は `registry:layer-members` の登録パスだけで決める。登録に当てはまらない src のファイルは既定の層に割り当てず、`ARCH-LAYER-UNKNOWN` で失敗する。

## 機械可読部

```json registry:layers
{
  "spirits:repl": ["host:pi-coding-agent", "host:pi-tui"],
  "spirits:shared": ["spirits:repl", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:rlm": ["spirits:repl", "spirits:shared", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:harness": ["spirits:repl", "spirits:shared", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:todo": ["spirits:repl", "spirits:shared", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:update": ["spirits:shared", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:routing": ["spirits:shared", "host:pi-coding-agent"],
  "spirits:verify": ["spirits:shared", "spirits:routing", "host:pi-coding-agent"],
  "spirits:commands": ["spirits:shared", "spirits:routing", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:managed-pi": ["spirits:shared", "spirits:update", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:guard": ["spirits:shared", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:entry": ["spirits:repl", "spirits:shared", "spirits:rlm", "spirits:harness", "spirits:todo", "spirits:routing", "spirits:commands", "spirits:guard", "spirits:verify", "host:pi-coding-agent", "host:pi-tui"],
  "spirits:bin": ["spirits:entry", "spirits:shared", "spirits:update", "spirits:managed-pi"]
}
```

```json registry:layer-members
{
  "spirits:repl": ["packages/spirits/src/repl/"],
  "spirits:rlm": ["packages/spirits/src/rlm/"],
  "spirits:harness": ["packages/spirits/src/harness/"],
  "spirits:todo": ["packages/spirits/src/todo/"],
  "spirits:update": ["packages/spirits/src/update/"],
  "spirits:routing": ["packages/spirits/src/routing/"],
  "spirits:commands": ["packages/spirits/src/commands/"],
  "spirits:managed-pi": ["packages/spirits/src/managed-pi/"],
  "spirits:guard": ["packages/spirits/src/guard/"],
  "spirits:verify": ["packages/spirits/src/verify/"],
  "spirits:shared": [
    "packages/spirits/src/config.ts",
    "packages/spirits/src/constants.ts",
    "packages/spirits/src/env-defaults.ts",
    "packages/spirits/src/version.ts",
    "packages/spirits/src/tools.ts",
    "packages/spirits/src/types/",
    "packages/spirits/src/branding/"
  ],
  "spirits:entry": ["packages/spirits/src/index.ts"],
  "spirits:bin": ["packages/spirits/bin/"]
}
```

```json registry:cycles
[]
```

```json registry:duplication
{ "baseline": 0 }
```

## 記録(検査なし)

- 継承の深さの実測値は **3**(2026-10 時点)。一般則としては規約化せず、記録のみ置く。

## ARCH-LAYER: 層間依存の許可向き

- **強度**: SHALL
- **内容**: 層間の import(型のみの import を含む)は、`registry:layers` の許可表と各公開パッケージの `package.json` から決まる許可の向きのみを受け付ける。層間でない import と外部パッケージの import は判定しない。
- **例外**: 公開パッケージの許可向きは `package.json` の workspace 依存から検査時に導出する(手書き表にしない)。例外層は `registry:layers` の表と同パッケージの宣言分と非例外部分を合わせた向き。
- **判定方法**: 走査対象の rootFiles を TS の AST で走査し、import 文・`export … from`・文字列リテラルの動的 import・型位置の `import("x")` を値/型の辺として集める。src を起点とする辺について、起点と終点の層が異なり許可表に無い向きなら違反を報告する。違反メッセージには規約 ID と import 元・先のパスを含める。
- **根拠**: design decision 1・2・3・8・11。

## ARCH-LAYER-UNKNOWN: どの層にも属さない src ファイル

- **強度**: SHALL
- **内容**: src のファイルのうち、公開パッケージ・例外層・`registry:layer-members` に登録された層のいずれにも属さないものは失敗する。未登録のファイルを既存の層に割り当ててはならない。
- **例外**: なし。`packages/spirits/src/` に新しいディレクトリを足す変更は、同じ変更で所属表を更新しない限り通らない(新しい継ぎ目が必ずレビューに上がる)。
- **判定方法**: ファイルが所属表の登録パス(ディレクトリは末尾 `/`)に当てはまるか、公開パッケージないし例外層のどちらかを判定し、どれにも当てはまらないファイルを規約 ID とパスを付けて報告する。
- **根拠**: design decision 1・9。

## ARCH-REPL: repl の後段非依存

- **強度**: SHALL
- **内容**: `packages/spirits/src/repl/` が自分のほかの spirits 層を import すること(型のみの import と動的 import を含む)を検出して失敗する。列挙すると `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `guard` `verify` とエントリ(`packages/spirits/src/index.ts`)、および `bin` で、検査が `ARCH-REPL` として報告する層はこの列挙と同じである。
- **例外**: repl はホスト (`host:pi-coding-agent` `host:pi-tui`) と repl 内完結の import に制限される。`guard` は計測のために session へ entry を append する後段の性質を持つため、特に repl から締め出す(design decision 5)。
- **判定方法**: 起点が `spirits:repl` の層違反を `ARCH-REPL` として報告する(1 つの層の違反を複数の ID で重ねて報告しない)。
- **根拠**: ハードルール「後段非依存」。design decision 1。

## ARCH-SPIRITS-LAYER: spirits の層の許可向き

- **強度**: SHALL
- **内容**: spirits の各層(`repl` `shared` `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `guard` `verify` `entry` `bin`)は `registry:layers` の表に載った層へのみ依存する。`rlm` `harness` `todo` `routing` `commands` `managed-pi` `guard` と `verify` は互いに依存できない兄弟層。エントリ層へ import できるのは `bin` のみ。
- **例外**: `bin` は `entry` `shared` `update` `managed-pi` へ依存できる(コンパイル済み単一バイナリの起動時初期化のため)。ホストへの依存は `bin` には無い(境界は `ARCH-PI-BOUNDARY`)。
- **判定方法**: 起点が `spirits:repl` 以外の spirits の層の層違反を `ARCH-SPIRITS-LAYER` として報告する。
- **根拠**: ハードルール「後段非依存」と Roadmap の兄弟層の分離。design decision 1。

## ARCH-PI-BOUNDARY: spirits とホストの境界

- **強度**: SHALL
- **内容**: `packages/spirits/src/` はホストを、その package.json が公開する entry point でのみ import する。許可する subpath は `@earendil-works/pi-coding-agent` の `.` と `./rpc-entry`、`@earendil-works/pi-tui` の `.` だけである(`pi-tui` は `exports` を持たず `main` / `types` のみ、`./rpc-entry` は型宣言を持たない)。`packages/spirits/bin/` はホストを import しない。`packages/spirits/src/` と `packages/spirits/bin/` はホスト型の再宣言 (型ミラー) を置いてはならず、`declare module` による ambient 宣言と、ホストの specifier を名前に出す `.d.ts` を含めない。
- **例外**: `packages/spirits/src/` の層のうち `routing` と `verify` を除く全層がホスト両方へ依存すること(bare specifier)は許可する。`routing` と `verify` の許可は `host:pi-coding-agent` だけとし、層ごとの許可は `registry:layers` が正であるため、この例外文はそれと食い違わないように同じ変更で更新する。
- **判定方法**: importer から `node_modules` をたどって見つけたホストパッケージの package.json と照合し、次のそれぞれを規約 ID と import 元のパス・specifier を付けて報告する。(a) `packages/spirits/bin/` からのホストの import。(b) `exports` に載らない subpath(宣言が無い `main` / `types` からの解決は bare のみ)。(c) 型宣言の無い subpath の型位置の import (`./rpc-entry` を `import type` で読む経路)。(d) `packages/spirits/{src,bin}/` 配下で、ホストの specifier を名前に出す `declare module` と `.d.ts`。ホスト以外を対象とする ambient 宣言 (テキスト asset の import など) は鏡像ではない。走査対象は `.d.ts` を含まないため、(d) は src と bin のツリーを直接歩く。
- **根拠**: 公開面以外のものは上流の内部構成であり、版本更新で黙って変わる。型を自分で再宣言すると実型とのずれが検査されない。design decision 4・8。

## ARCH-SRC-DEV: src から dev ファイルへの import

- **強度**: SHALL
- **内容**: src が dev ファイル(「用語」の定義による)を import すること(型のみの import を含む)を検出して失敗する。dev ファイルから src への import は判定しない。
- **例外**: なし。`packages/spirits/test/` が spirits の src を import するのは正当である(dev ファイルを起点とする辺は層の判定をしない)。
- **判定方法**: src を起点とする辺の終点が dev ファイルなら、値・型の両方を規約 ID とパスを付けて報告する。
- **根拠**: テストと実装の結合は CI の失敗を隠す。design decision 11。

## ARCH-RESOLVE: 内部 import の解決

- **強度**: SHALL
- **内容**: 内部 specifier(相対と `@earendil-works/*`)は、相対は import 元の位置から、ホストは公開パッケージの `exports`(`exports` が無いパッケージは bare に限り `types` / `main`)で解決し、リポジトリ内のファイルにもホスト公開パッケージにも解決できないものは失敗とする。解決できない import を黙って取り除いてはならない。root の `tsconfig.json` の `paths` も、spirits の `paths`(型検査用スタブ)も解決に使わない。
- **例外**: `typebox` のように内部 specifier でないものは外部として扱い、解決も判定もしない。
- **判定方法**: 相対 specifier は import 元から補完順(`.ts` `.tsx` `/index.ts` `/index.tsx`)に探す。ホスト specifier は import 元からリポジトリルートまで `node_modules/@earendil-works/<name>` を探して見つけたパッケージの package.json を読み、`exports` の完全一致の key を `./*` パターンに優先し、配列のターゲットは列挙順に試す。解決できないものを規約 ID と場所を付けて報告する。
- **根拠**: 誤った resolver が規約を静かに無効化することを防ぐため。ホストを fork のソースに解決すると、公開面の境界が検査されない。design decision 8。

## ARCH-CYCLE: 値の依存の循環

- **強度**: SHALL
- **内容**: 層の値依存グラフ(src を起点とする値の辺から作る)は非循環でなければならない。ファイル単位の値依存グラフ(走査対象の全ファイルの値の辺から作る)の強連結成分のうち 2 ファイル以上のもの、または自己 import を持つものを循環とし、`registry:cycles` の要素とファイル集合が完全に一致する循環だけを通す。
- **例外**: 登録済みの循環は 0 件 (`remove-pi-fork` §12 で `chord` と `durable` の循環はフォークごと消え、残った 0 件を `registry:cycles` に記録した)。新規・拡大・解消済みの残存はいずれも失敗する。既存の強連結成分の内側で辺が増えるだけの変更は検出しない(受け入れる制限)。
- **判定方法**: 層グラフに閉路があれば層の閉路を報告する。強連結成分を求め、許可リストに無い循環・対応する循環が無い許可リスト要素を規約 ID とファイル集合を付けて報告する。型の辺と動的 import(非リテラルを除く)は辺に含めるが、循環の検査は値の辺だけを使う。
- **根拠**: 循環はリファクタリングを妨げ、上流 merge で競合を増やす。design decision 6・10・11。

## ARCH-DUP: 重複の ratchet

- **強度**: SHALL
- **内容**: src の関数宣言・メソッド・アロー関数・関数式の本体と、変数宣言の初期化子のうち、空白の連続を 1 つの空白にして前後を除いた本文が 60 文字以上で、元の記述が 10 行以上のものを集め、本文が一致するものが 2 件以上ある群の件数が `registry:duplication` の基数と一致しなければ失敗する。dev ファイルは数えてはならない。
- **例外**: なし。群の件数が多いときは増加、少ないときは基数を下げるよう報告する。
- **判定方法**: src の AST から対象ノードを集めて正規化し、本文ごとに群を作る。群の件数が基数と一致しないとき、超過時は現在の全群をファイルの場所つきで、減少時は基数の更新を報告する。
- **根拠**: 重複の増加は黙って進むため、ratchet で検知する。design decision 7。
