# アーキテクチャ規約正本

この文書はリポジトリのアーキテクチャ規約の**正本**である。各規約は ID で参照され、検査(`packages/spirits/test/architecture-conventions.test.ts`)は本文書の機械可読部(JSON ブロック)から許可表・所属表・bin の許可リスト・循環の許可リスト・重複の基数を読む。検査側はこれらの複製を持たない。

**規約を変更するときは、正本と検査を同一変更で更新する。** 層やディレクトリを足す変更は、同じ変更で `registry:layer-members` を更新しない限り検査が通らない。

## 用語

- **走査対象**: root の `tsconfig.json` と `packages/spirits/tsconfig.json` の `rootFiles` から `.d.ts` と `.json` を除いたファイル。
- **dev ファイル**: `packages/*/test/` と `packages/*/examples/` 配下、`packages/*/*.config.ts`、`packages/ai/scripts/` 配下、リポジトリルートの `scripts/` 配下とルート直下のファイル。dev ファイルを起点とする import は層の判定をしない。
- **src**: 走査対象のうち dev ファイルでないもの。
- **基数**: 重複の ratchet でこの文書に記録する、重複ハッシュ群の件数。

## 層の構成

- 公開パッケージ(`package.json` の `private` でないもの)は `packages/<ディレクトリ名>` の層を持つ。許可向きは各 `package.json` の `dependencies` / `optionalDependencies` / `peerDependencies` の workspace 依存から検査時に導出する。依存追加は正本の編集なしに新しい向きを許可する。
- private パッケージと例外層と spirits の層は `registry:layers` の表を正とする。
- **例外層**は公開パッケージの `tsconfig.build.json` の `exclude` のうち `src/` 配下を指し(`src` 自身を除く)、glob を含まず、実在するディレクトリからなる。例外層の許可向きは「当該パッケージの `package.json` 宣言分 + 同パッケージの例外層以外の部分 + 下記 `registry:layers` に列挙した未宣言パッケージ」である。
- **spirits** は 8 層に分割される。`packages/spirits/src/index.ts` だけが `entry` 層で、`repl` `rlm` `harness` `todo` `update` は互いに依存しない兄弟層。`bin` を除く全 src 層は Pi(`packages/coding-agent` と `packages/tui`)を許可する。
- 層への所属は `registry:layer-members` の登録パスだけで決める。登録に当てはまらない src のファイルは既定の層に割り当てず、`ARCH-LAYER-UNKNOWN` で失敗する。

## 機械可読部

```json registry:layers
{
  "packages/evals": ["packages/ai", "packages/coding-agent"],
  "packages/coding-agent:experimental": [
    "packages/client",
    "packages/durable",
    "packages/protocol",
    "packages/server"
  ],
  "spirits:repl": ["packages/coding-agent", "packages/tui"],
  "spirits:shared": ["spirits:repl", "packages/coding-agent", "packages/tui"],
  "spirits:rlm": ["spirits:repl", "spirits:shared", "packages/coding-agent", "packages/tui"],
  "spirits:harness": ["spirits:repl", "spirits:shared", "packages/coding-agent", "packages/tui"],
  "spirits:todo": ["spirits:repl", "spirits:shared", "packages/coding-agent", "packages/tui"],
  "spirits:update": ["spirits:shared", "packages/coding-agent", "packages/tui"],
  "spirits:entry": ["spirits:repl", "spirits:shared", "spirits:rlm", "spirits:harness", "spirits:todo", "packages/coding-agent", "packages/tui"],
  "spirits:bin": ["spirits:entry", "spirits:shared", "spirits:update", "packages/coding-agent"]
}
```

```json registry:layer-members
{
  "spirits:repl": ["packages/spirits/src/repl/"],
  "spirits:rlm": ["packages/spirits/src/rlm/"],
  "spirits:harness": ["packages/spirits/src/harness/"],
  "spirits:todo": ["packages/spirits/src/todo/"],
  "spirits:update": ["packages/spirits/src/update/"],
  "spirits:shared": [
    "packages/spirits/src/config.ts",
    "packages/spirits/src/constants.ts",
    "packages/spirits/src/version.ts",
    "packages/spirits/src/tools.ts",
    "packages/spirits/src/types/",
    "packages/spirits/src/branding/"
  ],
  "spirits:entry": ["packages/spirits/src/index.ts"],
  "spirits:bin": ["packages/spirits/bin/"],
  "packages/evals": ["packages/evals/"]
}
```

```json registry:bin-deep-imports
[
  "@earendil-works/pi-coding-agent/bun/sandbox-env-setup",
  "@earendil-works/pi-coding-agent/bun/runtime-setup",
  "@earendil-works/pi-coding-agent/cli/setup"
]
```

```json registry:cycles
[
  [
    "packages/chord/src/delta/diff.ts",
    "packages/chord/src/delta/index.ts",
    "packages/chord/src/delta/tracker.ts"
  ],
  [
    "packages/coding-agent/src/extensions/codemode/execute.lazy.ts",
    "packages/coding-agent/src/extensions/codemode/execute.ts",
    "packages/coding-agent/src/extensions/codemode/tool.ts"
  ],
  [
    "packages/coding-agent/src/core/agent-session-runtime.ts",
    "packages/coding-agent/src/core/agent-session-services.ts",
    "packages/coding-agent/src/core/agent-session.ts",
    "packages/coding-agent/src/core/extensions/index.ts",
    "packages/coding-agent/src/core/extensions/loader.ts",
    "packages/coding-agent/src/core/extensions/virtual-modules.ts",
    "packages/coding-agent/src/core/resource-loader.ts",
    "packages/coding-agent/src/core/sdk.ts",
    "packages/coding-agent/src/index.ts",
    "packages/coding-agent/src/main.ts",
    "packages/coding-agent/src/modes/index.ts",
    "packages/coding-agent/src/modes/interactive/interactive-mode.ts",
    "packages/coding-agent/src/package-manager-cli.ts"
  ],
  [
    "packages/durable/src/harness/compaction.ts",
    "packages/durable/src/harness/generation.ts",
    "packages/durable/src/harness/live.ts",
    "packages/durable/src/harness/submissions.ts",
    "packages/durable/src/harness/tool.ts"
  ]
]
```

```json registry:duplication
{ "baseline": 61 }
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
- **内容**: `packages/spirits/src/repl/` が `rlm` `harness` `todo` `update` とエントリ(`packages/spirits/src/index.ts`)を import すること(型のみの import と動的 import を含む)を検出して失敗する。
- **例外**: repl は Pi(`packages/coding-agent` `packages/tui`)と repl 内完結の import に制限される。
- **判定方法**: 起点が `spirits:repl` の層違反を `ARCH-REPL` として報告する(1 つの層の違反を複数の ID で重ねて報告しない)。
- **根拠**: ハードルール「後段非依存」。design decision 1。

## ARCH-SPIRITS-LAYER: spirits の層の許可向き

- **強度**: SHALL
- **内容**: spirits の各層(`repl` `shared` `rlm` `harness` `todo` `update` `entry` `bin`)は `registry:layers` の表に載った層へのみ依存する。`rlm` `harness` `todo` は互いに依存できない兄弟層。エントリ層へ import できるのは `bin` のみ。
- **例外**: `bin` は `entry` `shared` `update` と `packages/coding-agent` へ依存できる(コンパイル済み単一バイナリの起動時初期化のため)。
- **判定方法**: 起点が `spirits:repl` 以外の spirits の層の層違反を `ARCH-SPIRITS-LAYER` として報告する。
- **根拠**: ハードルール「後段非依存」と Roadmap の兄弟層の分離。design decision 1。

## ARCH-PI-BOUNDARY: spirits と Pi 上流の境界

- **強度**: SHALL
- **内容**: `packages/spirits/src/` は `@earendil-works/pi-*` をサブパスを持たない bare specifier でのみ import する。`packages/spirits/bin/` の deep import(サブパスを持つ specifier)は `registry:bin-deep-imports` の 3 件に限定し、使われていない要素があっても失敗する。
- **例外**: `packages/spirits/src/` の全層が `packages/coding-agent` と `packages/tui` へ依存すること(bare specifier)は許可する。
- **判定方法**: spirits の src と bin の import を調べ、src の deep import・許可リスト外の bin の deep import・未使用の許可リスト要素を規約 ID とパスを付けて報告する。
- **根拠**: Pi への deep import は上流パッケージの内部構成に依存するため。design decision 8。

## ARCH-SRC-DEV: src から dev ファイルへの import

- **強度**: SHALL
- **内容**: src が dev ファイル(「用語」の定義による)を import すること(型のみの import を含む)を検出して失敗する。dev ファイルから src への import は判定しない。
- **例外**: なし。`packages/spirits/test/` が spirits の src を import するのは正当である(dev ファイルを起点とする辺は層の判定をしない)。
- **判定方法**: src を起点とする辺の終点が dev ファイルなら、値・型の両方を規約 ID とパスを付けて報告する。
- **根拠**: テストと実装の結合は CI の失敗を隠す。design decision 11。

## ARCH-RESOLVE: 内部 import の解決

- **強度**: SHALL
- **内容**: 内部 specifier(相対と `@earendil-works/*`)は root の `tsconfig.json` の `paths` だけで解決し、リポジトリ内のファイルに解決できないものは失敗とする。解決できない import を黙って取り除いてはならない。spirits の `paths`(型検査用スタブ)で解決してはならない。
- **例外**: `typebox` のように `paths` にあっても内部 specifier でないものは外部として扱い、解決も判定もしない。
- **判定方法**: 内部 specifier を root の `paths`(完全一致をワイルドカードに優先し、ターゲットを列挙順に試して拡張子と `index` を補完)で解決し、解決できないものを規約 ID と場所を付けて報告する。
- **根拠**: 誤った resolver が規約を静かに無効化することを防ぐため。design decision 8。

## ARCH-CYCLE: 値の依存の循環

- **強度**: SHALL
- **内容**: 層の値依存グラフ(src を起点とする値の辺から作る)は非循環でなければならない。ファイル単位の値依存グラフ(走査対象の全ファイルの値の辺から作る)の強連結成分のうち 2 ファイル以上のもの、または自己 import を持つものを循環とし、`registry:cycles` の要素とファイル集合が完全に一致する循環だけを通す。
- **例外**: 登録済みの循環は上流パッケージ内の既存のもの(`chord` 1 件、`coding-agent` 2 件、`durable` 1 件)に限る。新規・拡大・解消済みの残存はいずれも失敗する。既存の強連結成分の内側で辺が増えるだけの変更は検出しない(受け入れる制限)。
- **判定方法**: 層グラフに閉路があれば層の閉路を報告する。強連結成分を求め、許可リストに無い循環・対応する循環が無い許可リスト要素を規約 ID とファイル集合を付けて報告する。型の辺と動的 import(非リテラルを除く)は辺に含めるが、循環の検査は値の辺だけを使う。
- **根拠**: 循環はリファクタリングを妨げ、上流 merge で競合を増やす。design decision 6・10・11。

## ARCH-DUP: 重複の ratchet

- **強度**: SHALL
- **内容**: src の関数宣言・メソッド・アロー関数・関数式の本体と、変数宣言の初期化子のうち、空白の連続を 1 つの空白にして前後を除いた本文が 60 文字以上で、元の記述が 10 行以上のものを集め、本文が一致するものが 2 件以上ある群の件数が `registry:duplication` の基数と一致しなければ失敗する。dev ファイルは数えてはならない。
- **例外**: なし。群の件数が多いときは増加、少ないときは基数を下げるよう報告する。
- **判定方法**: src の AST から対象ノードを集めて正規化し、本文ごとに群を作る。群の件数が基数と一致しないとき、超過時は現在の全群をファイルの場所つきで、減少時は基数の更新を報告する。
- **根拠**: 重複の増加は黙って進むため、ratchet で検知する。design decision 7。
