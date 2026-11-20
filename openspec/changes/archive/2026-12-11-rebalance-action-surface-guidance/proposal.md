# Proposal

## Why

測定には、2026-11-10〜17 に更新された 20 セッションの実セッションログ(`~/.spirits/agent/sessions/`)を使った。内訳はガード導入前 6、導入後(2026-11-11 12:06Z 以降)14。導入後のセッションでは違反の書き方が実質 0 件になったが、ブロックは日に 12〜45 件続いている。
ブロックされた 151 件を意図で分けた。S2 の 71 件のうち約 30 件は `sed -n` による部分の読み取り、13 件は `sed -i` による書き換えで、合わせて約 6 割になる。S3 の 7 件はすべてファイルの作成だった。どれも行き先は tsrepl ではなく read / edit / write である。ところが、規則の文言もブロック理由も bash と tsrepl の二択しか示さず、read / edit に触れていない。
加えて、tsrepl のエラー 112/958 件のうち約 25 件は `use()` を `await` しない呼び出しだった。14 件は `Bun` / `process` が未定義のエラーで、提案文は「`globalThis` へ代入する」という的外れな案内を返していた。
Python については、利用者は Python の実行を例外なく禁止したい。現在のガードは「インラインコード」と「一時ディレクトリのスクリプト」という形で止めているため、`python3 -m json.tool`、`python3 scratch.py`、`pip install`、`bash -c "python3 -c ..."` などが通る。

## What Changes

- 道具の選び方を、意図ごとに 4 つの行き先で示す。ファイルを読むなら read、作成・書き換えなら edit / write、1 回の起動で出力を自分で読むなら bash、出力をコードで扱う(抽出・集計・分岐・繰り返し・待機)なら tsrepl。境目は「出力を読むのが自分かコードか」とする。tsrepl の promptGuidelines と code-mode プロンプトのツール選択の基準を、この内容に書き換える。
- 一時ディレクトリの `.ts` を bun で実行するスクラッチは、規則の文言でも許可する(ガードの P2 は以前から通している)。ただし、まず tsrepl で書くことを優先させる。
- **BREAKING** Python を名前で一律に禁止する分類 P3 を追加する。対象は、python 系(版付きとパス付きを含む)、`pip` / `pip3` / `pipx`、`uv`、`uvx`、`pytest`、`poetry`、`hatch`、`pdm`、`tox`、`ipython`、`jupyter` の起動と、`*.py` の直接実行である。対象プロジェクト自身の実行(`pytest`、`python3 -m pytest`、`uv run` など)も含め、直接の呼び出しと入れ子の呼び出しの両方に適用する。逃げ道は既存の `SPIRITS_ACTION_GUARD` だけとする。ラッパーに `nohup` を加える。
- **BREAKING** `bash -c` / `sh -c` などのシェルの `-c` と `eval` に渡す文字列を字句解析し直し、全分類で判定する。外側の呼び出しの直接・入れ子の区別を引き継ぎ、3 段目まで分類し直す。実行時に決まる文字列は判定しない。
- **BREAKING** 要件「ガードはセキュリティ境界ではない」を削除し、「ガードの対象外とする迂回」に置き換える。これまで対象外だったシェルの `-c` は対象になる。`sudo` / `docker` / `ssh` などに引数として渡したコマンドは、対象外であることを明記する。
- S2 の sed の例外を広げる。`-n` だけを付け、スクリプトが表示コマンド(アドレスは 10 進の行番号、`$`、`/正規表現/`。1 つまたは `,` で 2 つ。その後ろに `p`)を `;` でつないだものだけの形は通す。
- ブロック理由の書き換え例を、意図に合った行き先へ直す。S2 と S3 は read / edit / write を案内し、どの分類の例からも Python の実行例を除く。
- tsrepl の説明文とプロンプトの `use()` の例を、すべて `await use(...)` の形にする。`process` / `Bun` / `require` が未定義という実行時エラーには、`await use("node:...")` を提案する。`Bun` ではルートのセッションに限って `sh()` も添える。`globalThis` への代入は提案しない。
- ルートの `README.md` に Python プロジェクトには推奨しない旨を書き、`packages/spirits/README.md` のガードの節と `docs/spirits-m4-harness.md` の規則の項目数を新しい内容に合わせる。

## Capabilities

### New Capabilities

なし

### Modified Capabilities

- `action-surface-guard`: Python の名前による禁止の分類 P3 を追加する。シェルの `-c` と `eval` の中身も判定する。sed の読み取り例外を広げる。ラッパーに `nohup` を加える。「通すコマンド」から Python のツールチェーンを外す。ブロック理由の書き換え例を意図別にする。「ガードはセキュリティ境界ではない」を削除し、シェルの `-c` を対象外から外した「ガードの対象外とする迂回」に置き換える。
- `tsrepl`: promptGuidelines を 4 つの行き先と Python の禁止に沿った内容へ置き換える。説明文の `use()` の例を `await` 付きにする。未提供のホストグローバルへの参照に対する提案文を変える。
- `continual-harness`: code-mode プロンプトのツール選択の基準を新しい promptGuidelines に合わせる。コード例からファイルを `sh("cat ...")` で読む例を除き、`await use(...)` の例を載せる。

## Impact

- コード: `packages/spirits/src/guard/rules.ts`(分類 P3、ラッパーの読み飛ばしの共通化、シェルの `-c` と `eval` の再判定、sed の例外)、`packages/spirits/src/guard/messages.ts`(共通文の縮小)、`packages/spirits/src/constants.ts`(分類 ID、`GUARD_CATEGORY_GUIDANCE`、分類の適用範囲の配列)、`packages/spirits/src/tools.ts`(`TSREPL_DESCRIPTION`、`TSREPL_PROMPT_SNIPPET`、`TSREPL_PROMPT_GUIDELINES`)、`packages/spirits/src/harness/prompt.ts`(code-mode プロンプト)、`packages/spirits/src/repl/context.ts`(提供しないグローバルと代わりの手段の一覧)、`packages/spirits/src/repl/format.ts`(提案文)。字句解析器 `guard/lex.ts` は変えない。
- テスト: `packages/spirits/test/` のガードのテスト(classify / register / integration)とフィクスチャ `fixtures/guard/{pass,hit}-cases.json`、tools / harness-prompt / format / cell のテスト、規則の文面を照合する `scripts/managed-pi-compat/` の箇所。
- 文書: `README.md`、`packages/spirits/README.md`、`docs/spirits-m4-harness.md`。
- 利用者への影響: Python プロジェクトでは、`pytest` などのプロジェクト自身の実行もガードが止める。止めたくない場合は `SPIRITS_ACTION_GUARD=warn` または `off` で起動する。直接の呼び出しの `bash -c` / `sh -c` / `eval` の中身にも S 系が掛かる。
- ホストの公開面への依存: 既存の `@earendil-works/pi-coding-agent` の `ExtensionAPI`(bash の `tool_call` イベント)と `defineTool`(`promptSnippet` / `promptGuidelines`)だけを使い、新しい export は使わない。
- 固定値・配布物への影響: 分類 ID と書き換え例は `packages/spirits/src/constants.ts` に置く。`PINNED_PI` と `managed-pi/host.ts` は変えない。拡張バンドルの中身は変わるが、配布物の構成、依存、`bun.lock` は変わらない。
