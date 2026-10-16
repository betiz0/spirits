# フィクスチャ規約正本

```json registry:layers
{ "spirits:repl": "packages/pi-core" }
```

```json registry:layer-members
{}
```

```json registry:bin-deep-imports
[]
```

```json registry:cycles
[]
```

```json registry:duplication
{ "baseline": 0 }
```

## ARCH-LAYER: 層間依存の許可向き

- **強度**: SHALL
- **内容**: 層間の import(型のみの import を含む)は、registry:layers の許可表と各公開パッケージの package.json から決まる許可の向きのみ。
- **例外**: 公開パッケージの許可向きは package.json の workspace 依存から検査時に導出する。
- **判定方法**: 走査対象の AST から辺を集め、層の許可表で照合する。
- **根拠**: design decision 1・2・11。

## ARCH-LAYER-UNKNOWN: どの層にも属さない src ファイル

- **強度**: SHALL
- **内容**: どの層にも属さない src のファイルは失敗する。未登録のファイルを既存の層に割り当ててはならない。
- **例外**: なし。
- **判定方法**: 所属表の登録パスと公開・例外層のどちらにも当てはまらないファイルを報告する。
- **根拠**: design decision 1・9。

## ARCH-REPL: repl の後段非依存

- **強度**: SHALL
- **内容**: repl が rlm harness todo update とエントリを import すること(型のみと動的 import を含む)を検出して失敗する。
- **例外**: repl は Pi と repl 内完結の import に制限される。
- **判定方法**: 起点が spirits:repl の層違反を報告する。
- **根拠**: ハードルール「後段非依存」。design decision 1。

## ARCH-SPIRITS-LAYER: spirits の層の許可向き

- **強度**: SHALL
- **内容**: spirits の各層は registry:layers の表に載った層へのみ依存する。rlm harness todo は互いに依存できない。
- **例外**: bin は entry shared update と packages/coding-agent 相当へ依存できる。
- **判定方法**: 起点が spirits:repl 以外の spirits の層の層違反を報告する。
- **根拠**: ハードルール「後段非依存」。design decision 1。

## ARCH-PI-BOUNDARY: spirits と Pi 上流の境界

- **強度**: SHALL
- **内容**: spirits の src は pi 系パッケージを bare specifier でのみ import する。bin の deep import は registry:bin-deep-imports に限定する。
- **例外**: src の全層が Pi へ依存すること(bare specifier)は許可する。
- **判定方法**: src の deep import、許可リスト外の bin の deep import、未使用の許可リスト要素を報告する。
- **根拠**: design decision 8。

## ARCH-SRC-DEV: src から dev ファイルへの import

- **強度**: SHALL
- **内容**: src が dev ファイルを import すること(型のみの import を含む)を検出して失敗する。
- **例外**: dev ファイルから src への import は判定しない。
- **判定方法**: src を起点とする辺の終点が dev ファイルなら値を報告する。
- **根拠**: design decision 11。

## ARCH-RESOLVE: 内部 import の解決

- **強度**: SHALL
- **内容**: 内部 specifier は root の tsconfig の paths で解決し、リポジトリ内のファイルに解決できないものは失敗とする。
- **例外**: paths にあっても内部 specifier でないものは外部として扱う。
- **判定方法**: 内部 specifier を paths で解決し、解決できないものを報告する。
- **根拠**: design decision 8。

## ARCH-CYCLE: 値の依存の循環

- **強度**: SHALL
- **内容**: 層の値依存グラフは非循環でなければならない。ファイル単位の強連結成分は registry:cycles と完全に一致するものだけを通す。
- **例外**: 登録済みの循環は上流パッケージ内の既存のものに限る。
- **判定方法**: 層グラフの閉路と、許可リストと一致しない強連結成分を報告する。
- **根拠**: design decision 6・11。

## ARCH-DUP: 重複の ratchet

- **強度**: SHALL
- **内容**: src の対象ノードの正規化本文が一致する群の件数が registry:duplication の基数と一致しなければ失敗する。
- **例外**: dev ファイルは数えない。
- **判定方法**: 群の件数と基数を比較し、超過時は全群を場所つきで報告する。
- **根拠**: design decision 7。

