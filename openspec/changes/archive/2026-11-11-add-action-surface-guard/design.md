# Design

## Context

動機と実測値は `proposal.md` にまとめた(2026-11-11 時点の 92 セッション集計: 直接 bash 約 6400 回、tsrepl 278 セル、bash のみのセル 199 のうち 139 は出力を加工しない、分類 S / P に該当する直接 bash は最大でも 1996 回 = 31.2%)。この設計は「どの面を強制し、どの面を空けるか」を決める。
設計の一次根拠は `docs/spirits-design.md`(code-as-action の方針)、ホスト関数は `docs/spirits-m1-repl.md`、code-mode プロンプトは `docs/spirits-m4-harness.md`。この文書はそれらに対する差分だけを書く。

制約:

- 実装は `packages/spirits/`(Pi 拡張)に限る。Pi コアの既存コードは変更しない。
- 使う Pi の公開 API は `packages/coding-agent/docs/extensions.md` と `src/core/extensions/types.ts` で確認した:
  - `tool_call` イベントは `toolName`、`input`(`BashToolInput.command`)、`toolCallId`、入れ子呼び出しの `parentToolCallId` を持つ(`ToolCallEventBase`)。入れ子の id は `<parent id>/<n>` で割り当てられ、トランスクリプトには出ない。
  - ハンドラの返り値は `ToolCallEventResult { block?, reason?, terminate? }`。`block: true` で実行を止め、`reason` がモデルへ返る。止めた呼び出しの結果は、テキストだけのエラー結果になる(`packages/agent/src/agent-loop.ts` の `createErrorToolResult`。構造化結果を持たない)。tsrepl の `tool()` では、構造化結果の無い失敗は例外になるため、セルには理由を含む例外が届く。
  - **ハンドラが失敗すると bash は fail-safe でブロックされる**(extensions.md「Pi reports handler errors and continues where possible. A `tool_call` handler failure blocks the tool as a fail-safe」)。ガード自体のバグで bash を止めてはいけないため、ハンドラ内部は例外を外へ出さない。
  - 入れ子の `executeTool` も `tool_call` を通る。よって直接と入れ子の区別は `parentToolCallId` の有無で決まる。
  - spirits は Pi の型を `src/types/pi-coding-agent.d.ts` の写しから読む。この写しには `tool_call` 関連の型が無いので、使う分を追加する。
- 既存の層構成(`docs/architecture/convention-registry.md`): `repl` `rlm` `harness` `todo` `update` `routing` `commands` `managed-pi` `shared` `entry` `bin`(正本の表は 11 層。本文の「10 層」は古い記述)。`repl` は後段を import しない。`entry` は `index.ts` だけで、`optional(feature, register, substitute)` が任意層の失敗を局所化する。
- 設定は 3 層(config.ts の Layer 3 = 環境変数)。機能スイッチの既存パターンは `SPIRITS_BUNDLED_SKILLS`。

## Goals / Non-Goals

**Goals:**

- 他言語のインラインコードとスクラッチスクリプトが bash 経由で書かれない形にする。
- 誤検出の代償を 1 往復に抑え、無効化と計測の経路を残す。
- ガードの有無と成否が、tsrepl / rlm / メモリ / スキル / TODO の利用に影響しないようにする。
- 公式 Pi(managed)経路と fork 経路の両方で、同じ実装が動く。

**Non-Goals:**

- bash をモデルから隠す、ツール一覧から外すことはしない(別 change)。
- セキュリティ境界にしない。`use("node:child_process")`、`bash -c '...'` の中身、`rlm` の子セッションは対象外。
- 対象プロジェクト自身の実行・テストコマンド(bun、npm、pytest、uv、make など)を制限しない。
- 閾値の自動調整と集計スクリプトは今回作らない。
- 互換性マトリクス(`managed-pi-compatibility`)に guard の行を足さない。

## Decisions

### 1. 強制手段は `tool_call` でのブロック

- **選択肢**: (a) `tool_call` で block する / (b) bash をモデルから隠して tsrepl 経由だけにする / (c) 文面の追加だけ。
- **採用**: (a)。(c) は既に実施済みで効いていない。2026-10-20 の変更で promptGuidelines と使用例を入れた結果、tsrepl は 179 → 278 セルへ増えたが、bash のみのセル 149 → 199、うち出力を加工しないセルは 137 → 139 と横ばいだった。文面は「tsrepl を使う動機」には効くが「bash で雑なことを書く抑止」には効かない。
- **代替案 (b) を採らない理由**: bash を隠すと `git`、`bun test`、`rg` などの単発コマンドまで tsrepl 経由になり、1 往復あたりのトークンが増える。上流の既定システムプロンプト("Use bash for file operations like ls, rg, find")と矛盾した状態を作り、公式 Pi 側との差分が膨らむ。まず (a) で判定を可視化し、隠すかは計測結果を見て別に決める。

### 2. 分類 S は直接呼び出しだけ、分類 P は両方

- **選択肢**: 両分類を常に適用 / S は直接のみ・P は両方 / 両分類とも直接のみ。
- **採用**: S は直接のみ、P は両方。
- **理由**: S(制御構文・長いパイプ・ヒアドキュメントでのファイル生成)は、bash をプログラミング言語として使う形の問題だ。tsrepl のセルの中で決まる入れ子呼び出しは、すでに TypeScript の中で組み立てられており、同じ判定をすると「セルの中でシェルを組み立てる」という新しい書き方を生むだけである。実測でも入れ子 229 回のうち S 該当は 44 回(19.2%、3 段以上を無条件に止める場合)で、直接の 26.2% と同じオーダーだが、入れ子を止めた場合に失うのはセル 1 回まるごとの再実行になる。
- P(他言語のインラインコード・一時ディレクトリの非 TypeScript スクリプト)は、この change の目的そのものに関わる。入れ子で許すと `tool("bash", { command: "python3 -c ..." })` がそのまま残り、目的が達せない。実測は入れ子 229 回のうち 22 回(9.6%)で、影響は小さい。
- **代替案**: 両分類とも常時適用。入れ子で制御構文を止めることは、セル内の書き換えコストに対して利得が薄い。
- 入れ子でブロックしたときは、セルの `tool()` が理由を含む例外を投げる(前述の Pi の挙動)。セルは `try` / `catch` で受けて書き直せる。

### 3. `warn` は記録だけで、モデルへ知らせない

- **選択肢**: `warn` でも reason を返す(実行は通す)/ 記録だけ残す。
- **採用**: 記録だけ。
- **理由**: `warn` の目的は本番運用での誤検出率の実測である。モデルへ「危ないが通す」と伝えると、モデルは同じ往復で書き直す動きをし、判定が通ったのか止まったのかの実測値が汚れる。block と同じ往復を消費するなら `enforce` と変えない。
- **代替案**: reason を返す。誤検出をモデル側で早期に回避できるが、`warn` の計測価値を失う。

### 4. `sh()` を追加する

- **選択肢**: `sh(command, options?)` を増やす / `tool("bash", ...)` のままにする。
- **採用**: 追加する。
- **比較**(bash のみのセル 199 件の実測: 中央値 369 文字、平均 410 文字、92.5% が先頭の文で `tool("bash")` を呼ぶ):

  | 形 | 最小のラッパー | 文字数 | 往復 |
  | --- | --- | --- | --- |
  | `tool("bash", { command })` | `const r = await tool("bash", { command: "rg -n TODO src" }); return r.output.split("\n").slice(0, 10);` | 103 | bash 1 回 + セル 1 回 |
  | `sh(command)` | `const r = await sh("rg -n TODO src"); return r.output.split("\n").slice(0, 10);` | 79 | 同上 |

  1 呼びあたり 24 文字(23%)の削減で、往復数は変わらない。利得は文字数より形にあり、`sh` は「bash を呼ぶための最短の書き方」として tsrepl 側に置くことで、bash を直接打つほうが短いという判断を消す。ガードの reason に載せる書き換え例も 1 行で示せる。
- **代替案**: `tool("bash")` のまま。誘導の最短形が bash ツール呼びのまま残る。
- **実装の置き方**: `sh` は repl 層に `createShHostFn()` として置き、`index.ts`(entry 層)が root の tsrepl に渡す。repl のビルトイン(`out` `print` `use` `tool`)に含めると `rlm` の子セッションにも出てしまい、「子のホスト関数は 5 つ」という既存の契約(continual-harness)と、子に bash が無いという現状(rlm の子は `tools: ["tsrepl"]`)を壊す。`sh` と `tool` は同じ呼び出し・記録の経路(`tool` の `runTool` と `ToolCallRecord` の書き込み)を共有する。これで `sh` の呼び出しが `tsrepl_cell` の `toolCalls` に `name: "bash"` として載り、`src/repl/metrics.ts` を変えずに済む。呼び出しを記録して例外を投げる処理も `sh` と `tool` で 1 つの関数にまとめ、2 か所に複製しない。
- **提供範囲**: `sh` は、bash を呼び出せるかどうかを問わず、root の tsrepl のすべてへ渡す。bash を呼び出せないセッションでは、`runTool` を共有するので `tool("bash")` と同じ例外になる(提供するかどうかを bash の有無で分けると、その分岐が `index.ts` に増える)。

### 5. ガードは新しい兄弟層 `spirits:guard` に置く

- **選択肢**: `spirits:guard` を新設 / `harness` に置く / `repl` に置く。
- **採用**: 新設。依存向きは `spirits:shared`(定数)と Pi のみ。entry 層から `optional("the bash action guard", ...)` で登録する(`optional` のラベルは通知とテスト名に使うので、実装とテストで同じ文字列にする)。正本の更新は次の 5 点を同一変更で行う(正本と検査を同一変更で更新する規約)。
  1. `registry:layers` に `spirits:guard` を追加する。
  2. `registry:layers` の `spirits:entry` の許可向きに `spirits:guard` を加える。加えないと `index.ts` からの import が `ARCH-LAYER` で失敗する。
  3. `registry:layer-members` に `packages/spirits/src/guard/` を追加する。
  4. 本文の層数を 12 層にし、兄弟層の列挙に `guard` を加える(現行の本文は「10 層」だが、表は既に 11 層で、`commands` が本文に無い)。
  5. `ARCH-SPIRITS-LAYER` の層の列挙を表に揃える。
- **理由**: `repl` に置くと「repl は後段を import しない」規約に反する(guard は計測のために session へ entries を append する後段の性質を持つ)。`harness` に置くと code-mode プロンプトと結合し、プロンプトを上書きしたとき(`spirits_prompt_set`)にガードまで消えるように見える。兄弟層にすれば `optional` の単位と一致する。
- **代替案**: `harness` 内。ファイルは増えないが、失敗の局所化とプロンプト上書きの境界が曖昧になる。
- `repl` は `guard` を import しない。文面と規則の置き場は次のとおり。
  - ツール選択の基準(`TSREPL_PROMPT_GUIDELINES`): 現状どおり `src/tools.ts`(shared)に置く。`harness/prompt.ts` がすでにここを参照しており、単一出典はこの場所で成立している。
  - 許可フィルタの一覧、分類 ID ごとの説明文と tsrepl での書き換え例 1 行: `src/constants.ts`(shared)に 1 か所だけ置く。`tools.ts` の基準(許可フィルタを列挙する)と、`guard/rules.ts`(判定)と、`guard/messages.ts`(reason)が同じ一覧を読む。
  - 閾値(段数)と sed の許可形: `guard/rules.ts`。誘導の文面と閾値を混ぜると、プロンプトを直したときに判定が変わる。

### 6. 字句解析は自前の最小実装、迷ったら通す

- **選択肢**: 自前の最小 tokenizer / 正規表現のみ / 依存追加(shell parser)。
- **採用**: 自前の最小 tokenizer。新規依存は増やさない(制約)。
- 処理するもの: 単一引用符、複合引用符(中の `\$`、`` \` ``、`\\`)、バックスラッシュエスケープ、`` ` `` と `$( )` の部分展開(中身は走査しない)、`#` コメント、ヒアドキュメント(マーカー行まで読み飛ばす)、リダイレクト(`>`、`>>`、`N>`)、単純コマンドの前置きの環境変数代入(`NAME=value`。読み飛ばして次の語をコマンドとする)、制御演算子(`|`、`||`、`&&`、`;`、改行、`(`、`)`)。
- 行の継続と改行: 引用符の外の `\` + 改行は、行の継続として捨てる(語にしない)。`|`、`&&`、`||` の直後の改行は、コマンドの区切りにしない(シェルは次の行へ続けて読む)。
- 構文語(`if` `then` `do` `{` `}` `time` `!` など): コマンドの先頭に現れる構文語は、S1 の判定のために記録するが、パイプの段には数えない。`time` と `!` は読み飛ばして次の語を単純コマンドとする。`{` と `}` は `(` と `)` と同じ区切りとし、`{ ...; }` と `( ... )` のグループはパイプの 1 段として数える。
- 関数定義: `name()` 形式に加えて、`function name`(後ろの `()` の有無を問わない)を関数定義として印付ける。
- 引用符内の文字列は「語」として扱い、コマンド位置の判定には使わない。これで `rg "for (" src` は発火しない。引数の値としては読む(sed のスクリプトの形、パスの語)。
- 閉じられていない引用符など、構造を確定できない入力は `parseError` として該当なし扱いにし、実行を止めない。判定関数とハンドラは例外を外へ出さない(pi が fail-safe で bash を止めるため)。
- **構文語を段に数えない理由**(検証で見つかった誤検出): 構文語を 1 つのコマンドとして段に数えると、2 段のパイプが 3 段になる。例えば `time bun test 2>&1 | tail -20` は、`time`、`bun`、`tail` の 3 段と数えられ、2 段目の `bun` が許可フィルタではないので S2 で止まる。`time python3 --version` や `if python3 --version; then ...` も、構文語が段を作るため `python3` が「パイプから標準入力を受ける」と読まれて P1 になる。2026-11-11 の実セッションログ(直接 bash 6648 回)では、この原因だけで止まる `time bun test … | tail -N` 形式のプロジェクト自身のテストが 13 件あった。構文語を段に数えず、S1 の判定にだけ使えば、これらは通る。「失敗するなら見逃しの側に倒す」という方針とも合う。回帰テストは `guard-lex.test.ts`(段の数え方)と `guard-classify.test.ts`(分類)に置く。
- **代替案**: 正規表現のみ。`sed 's/for//;` のような引用符内の語で誤爆し、通すべきコマンドを止める。

### 7. 閾値は実測で決める

段数は、パイプでつながれたコマンドの数。前置きの `time` と `!`、構文語は数えず、`{ }` と `( )` のグループは 1 段と数える(決定 6)。件数は特記しない限り bash 呼び出し単位(直接 bash 6400 回)で、sed の起動数だけが起動単位。

| 項目 | 値 | 実測根拠 |
| --- | --- | --- |
| 段数の分布 | 1 段 2181 / 2 段 3671 / 3 段 449 / 4 段 70 / 5 段以上 29 | 直接 bash 6400 回 |
| パイプ | 3 段以上で、2 段目以降に許可フィルタ以外を含むものだけ S2 | 3 段以上は 548 件(8.6%)。うち 455 件は 2 段目以降が許可フィルタだけの連鎖で通す。止めるのは 93 件(1.5%) |
| 許可フィルタ | head / tail / wc / grep / rg / sort / uniq / cut / tr / cat / nl / column(`constants.ts` に 1 か所) | 上の 455 件を数えた一覧 |
| 2 段までのパイプ | 常に通す | 2 段は 3671 回(57.3%)で支配的 |
| sed | `-n` と `'<A>,<B>p'`(A、B は 10 進整数)の 1 つだけ、残りがファイル名だけの形を通す。`'5p'`、`'1,$p'`、`-e` 付きは通さない。`-n` の無い形(`sed '1,50p'`)と `--quiet` / `--silent` も通さない(オプションは `-n` だけ) | sed 起動 1275 件のうち 348 件(27.3%)が行範囲の print。`s///` と `-i` など残り 927 件が該当し、置換は edit ツールかセルへ寄せる判断と整合する |
| ヒアドキュメント | `>` / `>>` でファイルへ書く形と tee だけ、git commit は除外 | ヒアドキュメント 489 件のうち git commit 宛ては 21 件。ファイル生成は 266 件(write / edit / セルへ寄せる対象) |
| P2 のスクリプト | 一時ディレクトリ配下かつ `.ts`/`.mts`/`.cts` 以外。作業ディレクトリ配下は除く(決定 11) | 130 件(`$TMPDIR` と cwd 除外を入れた定義では再計測していない)。`bun /tmp/*.ts` は 49 件使われており、tsrepl 前提の運用で通すべき形なので除外する |
| 判定できない入力 | 通す | 6400 件のうち 3 件(0.05%) |

- **許可フィルタだけの連鎖を通す理由**: 許可フィルタだけの連鎖(`rg x | grep -v y | head`)は出力をそのまま読む用途で、セルに移しても加工コードが増えない。これをブロックすると「bash を呼ぶだけのセル」(無加工 139 セル)を増やす方向に働き、この change が減らしたいものを増やす。2 段目以降に許可フィルタ以外(tee、python、awk など)が入る連鎖は、集計そのものとして S2 で止める。
- **代替案**:
  - (a) 3 段以上を無条件に止める。S 分類だけの該当は 1293 件(20.2%)から 1680 件(26.2%)へ増え、`rg x | grep -v y | head` 形式の 1 往復まで止まる。誤検出が想定より少なければ、この案へ移すために、段数の閾値と「許可フィルタだけの連鎖を通す」判断を `guard/rules.ts` の定数 2 つに分けて残す。
  - (b) 段数 2 から止める。2 段以上は 4219 件(65.9%)が該当し、単発コマンドの大半が止まって、ガードが bash を使えなくするものになる。
  - (c) sed を全面的に止める。行範囲の print(348 件)まで止まり、`sed -n '1,50p'` という最短の読み方まで失う。

### 8. 設定は環境変数 `SPIRITS_ACTION_GUARD`

- **選択肢**: 環境変数 / pi の settings キー(`spirits.actionGuard`)。
- **採用**: 環境変数。`enforce`(既定)/ `warn` / `off`。この 3 つと完全に一致しない値(空文字列、大文字を含む値、前後に空白を含む値)は `enforce` に倒す。`config.ts` の独立した関数 `readActionGuardMode(env)`(環境変数の層)で読み、登録時に 1 回解決する。`loadConfig` の戻り値には含めない(ガードは設定のスナップショットではなく、`registerBashGuard(pi, { env })` に注入された env から読むので、テストで env を差し替えられる)。
- **理由**: 機能スイッチの既存パターン(`SPIRITS_BUNDLED_SKILLS`)と、テストで env を注入できる点。pi の settings キーは `/settings` の一覧に出ないため、モードの存在が利用者に伝わらない。
- **代替案**: settings キー。`models.strong` の前例はあるが、モデルの既定値のような「セッションを重ねて効く値」ではなく、有効/無効のスイッチなので環境変数が合う。

### 9. 計測は `spirits_guard` エントリ、該当した判定 1 回につき 1 件

- フィールドは `category`(該当した分類 ID の配列: `S1` / `S2` / `S3` / `P1` / `P2`)、`mode`、`blocked`、`nested` の 4 つ。コマンド本文・出力・引数は入れない(`tsrepl_cell` と同じ規律)。
- 該当しなかった判定は記録しない。`off` では分類しないので記録しない。全 bash を記録すると 6400 件規模になり、読めない。
- 記録の失敗は判定を変えない(`appendEntry` は try/catch)。LLM のコンテキストへは送らない(カスタムエントリは既定で送られない)。
- **代替案**: 該当なしも記録して母数にする。`tsrepl_cell` が全件記録で母数を出しているのと同じ手もあるが、bash は件数が 1 桁多く、セッションファイルを肥大させる。母数が欲しいときは別の集計で取る。

### 10. 両経路(fork / managed)での動作

- **選択肢**: (a) 公開拡張 API だけで実装し、両経路で同じイベントを受ける / (b) Pi コアに guard 用のフックを足す(`[spirits]` プレフィックスの上流差分)。
- **採用**: (a)。`tool_call`、`parentToolCallId`、`executeTool`、`appendEntry`、`promptGuidelines` はいずれも extensions.md に載る契約で、Spirits 固有の fork パッチ(`registerModelRoles` など)には依存しない。
- **理由**: (b) は Pi コアの変更禁止に反し、公式 Pi(managed)経路には届かない。
- **検証**: 互換性マトリクス(role / `/clear` / `/model` の目的観測。`managed-pi-compatibility` の契約)には guard の行を足さない。代わりに、新規の `managed-pi-compat-guard.test.ts` が、既存の `scripts/managed-pi-compat/` のヘルパー(`rpc.ts` と fake provider)を使い、managed 経路と fork 経路の両方で、同じ固定データ(for ループ、`python3 -c`、`git status --short`、セルからの入れ子 `tool("bash", ...)`)に対して同じ分類 ID とブロックの有無になることを確かめる。入れ子の呼び出しに `parentToolCallId` が付くことは、managed 経路でこのテストが初めて確かめる(fork 側は文書で確認済み)。official artifact が無い環境では managed 側を `not-run` とし、成功とは数えない。

### 11. インタプリタの認識と一時ディレクトリの定義

- **インタプリタの選択肢**: (A) P1 に挙げた名前だけ、単純コマンドの先頭のみ / (B) A に加え、パス付き・版付きの名前、先頭の環境変数代入、透過的なラッパー(`env`、`timeout`、`nice`、`uv run`)の後ろも認識 / (C) B に加え、シェル(`bash` / `sh`)での一時スクリプト実行も P2 の対象にする。
- **採用**: (B)。(A) は `env python3 -c` や `/usr/bin/python3 -c` で素通りし、誘導として効かない。(C) は「`bash -c` はガードの対象外」という方針と整合させる説明が要り、一時スクリプトを `sh` で書く形を別 change で扱う。
- ラッパーのオプションの読み飛ばし(読み飛ばせないものが出たら、そのコマンドは該当なしで通す):

  | ラッパー | 読み飛ばすもの |
  | --- | --- |
  | `env` | `-i`、`-u NAME`、`NAME=value` |
  | `timeout` | `-s SIG`、`-k DURATION`、期間の語 |
  | `nice` | `-n N`、`-N`(`-` と 10 進整数。`nice -10 python3 ...` の `-10`) |
  | `uv run` | `--with X`、`--python X`、`-p X`、`--project X`、`--no-project` |

- **一時ディレクトリの選択肢**: (A) 字面が `/tmp/` か `/var/tmp/` で始まるパスだけ / (B) A に加え、ガード起動時の `os.tmpdir()` 配下と、字面が `$TMPDIR` で始まるパス / (C) B に加え、作業ディレクトリ配下のパスは除く。
- **採用**: (C)。(A) は `$TMPDIR` 配下を見逃す。(B) は、作業ディレクトリが一時ディレクトリの中にあるプロジェクトで「作業ディレクトリ配下のスクリプトは通す」と衝突し、通すべきものを止める。
- 判定の入力は、コマンド文字列に加えて、作業ディレクトリ(`tool_call` ハンドラが受ける ctx の cwd)と一時ディレクトリの一覧(登録時に 1 回求める)。パスは `..` を畳み、相対パスは作業ディレクトリ基準で解決する。`cd /tmp && python3 x.py` のような `cd` は追わない(字句解析だけで判定できる範囲を超える。見逃しに倒す)。
- スクリプトの特定: インタプリタの後ろのオプション(`-` で始まる語)を読み飛ばした最初の語。値を取るオプション(`python3 -W ignore x.py` など)の値は読み飛ばさないので、その場合は見逃しに倒す。
- **P1 の判定範囲**(検証で見つかった誤検出): P1 のオプション(`-c` `-e` `-p` `-r`)と引数 `-` は、上の「最初の語」より前にあるものだけを判定に使う。最初の語より後ろは、スクリプトまたはサブコマンドへの引数である。全引数を探すと、`python3 -m pytest -c pytest.ini -q`(`-c` は pytest の設定ファイル)、`python3 scripts/check.py -c config.yaml`、`cat data.json | python3 scripts/convert.py -`、`node packages/coding-agent/dist/cli.js -p 'hello'`、`bun build src/index.ts --outdir dist -e react`(`-e` は `--external`)が P1 で止まる。これらは対象プロジェクト自身の実行であり、「通すコマンド」に反する。python の `-m` は、その後ろのモジュール名までを読んだ時点で打ち切る。deno の `eval` は最初の語そのものが条件なので、従来どおり該当にする。
- **前置きの `time` と `!`**: ラッパー(上の表の 4 つ)には数えない。読み飛ばして次の語を判定する(決定 6 の構文語の扱い)。

## Risks / Trade-offs

- **[Risk] 誤検出で 1 往復を浪費する** → 通す形の許可リストを仕様側に書き、判定できない入力は通す。`warn` に切り替えて実運用で `spirits_guard` の `blocked` 率を測り、次 change で閾値を直す(集計スクリプトは対象外)。`off` で無効化できる。
- **[Risk] ブロック後にモデルが bash の書き方を変えて回避する**(2 段に割る、`bash -c '...'`、`&&` で連結し直す)→ ガードは誘導であり境界ではないと仕様に明記する。回避は許容し、検出を追わない。ただし回避の多さは `warn` モードの実測で見えるので、必要なら次 change でインタプリタの `-c` を再帰判定する。
- **[Risk] 利用者が明示的に Python のスクリプトを依頼した場合に、ガードが依頼に反する** → reason にモードの存在を書き(`SPIRITS_ACTION_GUARD=warn|off`)、判断を利用者へ返す。モデルがモードを変えられる形(ツールでの設定変更)は作らない。設定を変えられるのは利用者に限ると明確にするため。reason に環境変数名を載せることは仕様の要件とし、テストで確認する。
- **[Risk] ガードの例外で bash が全て止まる**(pi が `tool_call` ハンドラの失敗を fail-safe でブロックするため)→ ハンドラと判定関数は例外を外へ出さず、内部で握りつぶして通す。専用テスト(判定関数が例外を投げるケースで実行が止められないこと)を持つ。
- **[Risk] 分類規則の文面が 3 箇所に増えてズレる**(tsrepl の guidelines、code-mode プロンプト、ガードの reason)→ 許可フィルタの一覧と、分類 ID ごとの説明文と書き換え例は `spirits:shared` の 1 か所の定数に置く。ツール選択の基準は `tools.ts` の 1 か所に置き、`harness-prompt` テスト(プロンプト内の基準の文面が promptGuidelines と一致すること)でズレを検出する。重複の増加は `ARCH-DUP` が検査する。
- **[Risk] ラッパーのオプションの読み違い** → 読み飛ばせないものは通す(見逃しに倒す)。ラッパーは 4 つに固定し、増やすときは仕様を変える。
- **[Trade-off] S を入れ子に適用しない**ので、セルの中で長いパイプやヒアドキュメントを作れる。ただしそのコードは TypeScript として書かれ、再実行・計測・`_` の保持が可能になるため、change の目的(他言語のスクラッチを止める)とは矛盾しない。
- **[Trade-off] 自前の tokenizer は bash の文法を完全には再現しない**(配列展開、`[[ ]]` 演算子、ヒアドキュメントの中のリダイレクト等)。未知の形は通す方向に倒すので、失敗の向きは「止めすぎ」ではなく「見逃し」である。

## Migration Plan

1. `spirits:guard` 層を追加し、正本(`docs/architecture/convention-registry.md`)の `registry:layers` / `registry:layer-members` と検査を同じコミットで更新する。
2. 既定は `enforce` で出す。切り戻しは `SPIRITS_ACTION_GUARD=off`(環境変数のみ、コード変更不要)。パイプの閾値を戻す場合は `guard/rules.ts` の定数(決定 7)だけを変える。
3. 出してから最初の計測は `spirits_guard` の `blocked` 率と `mode=warn` の再現で行う。閾値の再調整は別 change。

## Open Questions

- `sh` を `rlm` の子セッションにも開放するか(子に bash を入れるかと同じ判断。別 change の「rlm の子セッションへの bash の開放」で決める)。
- 分類 P を入れ子にも適用した結果、セル内の `tool("bash")` が失敗してセル全体が落ちる率。`spirits_guard` の `nested` と `tsrepl_cell` の `outcome` を突き合わせて測る。
