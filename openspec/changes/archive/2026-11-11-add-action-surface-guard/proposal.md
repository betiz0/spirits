# Proposal

## Why

モデルの実行面が bash に偏ったまま、誘導が文面だけである。`~/.spirits/agent/sessions`(92 セッション、2026-10-06〜2026-11-11)の再集計:

- モデルが直接呼び出した bash は **6400 回**、tsrepl セルは **278 回**(bash が 23 倍)。tsrepl からの `tool("bash")` は 229 回。
- tsrepl 278 セルのうち **199 セル(71.6%)** が bash 以外のツールを呼ばず、そのうち **139 セル** はセル内に出力を加工するコードを持たない(文字列操作・分岐・反復のいずれも現れない)。bash を 2 回以上呼ぶセルは 21、ツールを呼ばないセルは 77。2026-10-20 の変更時の 179 セル / bash のみ 149 / 無加工 137 から、セル数は増えたが「bash を呼ぶだけのセル」の比率は解消していない。
- 直接 bash 6400 回を、この change で提案する分類の字句解析にあてた件数(分類は重複して数える)。**次の数値は、3 段以上のパイプを無条件に止める分類で数えたもの**で、この change は 2 段目以降が許可フィルタだけの連鎖を通すため、実際の該当はこれより少ない。通す場合の件数が分かるものは併記する。段数は、パイプでつながれたコマンドの数とする。
  - 和集合: **2185 回 = 34.1%**(S 分類だけ 1680 件 = 26.2%、P 分類だけ 703 件 = 11.0%)。許可フィルタだけの連鎖を通す場合、S 分類だけは 1293 件(20.2%)で、和集合は 1996 件(31.2%)以下になる(重複の差し引きは再計測していない)。bash を使った 45 セッション中 44 で 1 件以上あり、セッション単位の該当率は中央値 31.2%、上位 1 割で 45.2%(いずれも無条件の場合)。
  - S1 シェルの制御構文・関数定義: **198**(3.1%)
  - S2 awk / sed スクリプト / jq / xargs を含む実行: **855**(13.4%)。sed の起動 1275 件のうち 927 件が行範囲の print 以外の使い方(`sed -n '1,50p'` 形式は 348 件)、awk 62、jq 20、xargs 20。sed と awk などの件数は起動単位で、1 回の呼び出しに複数回現れるため、他の件数(bash 呼び出し単位)とは合計が一致しない。
  - S2 3 段以上のパイプ: **548**(8.6%)。段数の分布は 1 段 2181、2 段 3671、3 段 449、4 段 70、5 段以上 29。3 段以上のうち 455 件は 2 段目以降が head / grep / sort などの許可フィルタだけの連鎖で、この change では通す。止める対象は 93 件(1.5%)。
  - S3 ヒアドキュメントでファイル内容を生成する書き込み: **266**(4.2%)。ヒアドキュメント 489 件のうち git commit 宛ては 21 件
  - P1 他言語のインラインコード: **626**(9.8%)。python 558(`-c` と標準入力/ヒアドキュメント)、node `-e`/`-p` 65、bun `-e` 9、deno / perl / ruby / php は 0。python を起動するコマンドは 575 回(9.0%)
  - P2 一時ディレクトリ配下の非 TypeScript スクリプトをインタプリタで実行: **130**(2.0%)。`$TMPDIR` 配下の扱いと作業ディレクトリ配下の除外を入れた定義では再計測していない。
  - 字句解析できず該当なしに倒すのは 3 件(0.05%)
- tsrepl 経由の bash 229 回のうち P 分類に該当するのは **22 回(9.6%)**、S 分類は 44 回(19.2%、3 段以上を無条件に止める場合)。tsrepl の中に入っても他言語のインラインコードが書かれている。

現行の誘導は tsrepl の promptGuidelines 2 項目と code-mode プロンプトの文面だけで、実行時の強制が無い。文面だけの変更(2026-10-20 の align-tsrepl-limits-and-guidance)でセル数は 179 → 278 へ増えたが、無加工のラッパーセルは 137 → 139 と減らなかった。次に効かせるには、判定を実行時に組み込み、他言語のスクラッチコードが bash 経由で書かれない形にする必要がある。

## What Changes

- **BREAKING** Pi の公開拡張 API の `tool_call` フックで bash のコマンド文字列を検査し、該当分類をブロックするガードを追加する。既定の `enforce` では、これまで実行できた bash 呼び出しのうち分類に該当するものが実行されなくなる(`warn` / `off` で従来どおりにできる)。Pi コアは変更しない。
  - 分類 S(S1 制御構文 / S2 プログラム可能なフィルタと、2 段目以降に許可フィルタ以外を含む 3 段以上のパイプ / S3 ヒアドキュメントでのファイル生成)は、モデルが直接呼び出した bash にだけ適用する(`parentToolCallId` がある呼び出しは対象外)。
  - 分類 P(P1 他言語のインラインコード / P2 一時ディレクトリの非 TypeScript スクリプト実行)は、直接の呼び出しと tsrepl の `tool("bash")` 経由の両方に適用する。インタプリタは、パス付き・版付きの名前と、先頭の環境変数代入、`env` / `timeout` / `nice` / `uv run` の後ろも認識する。作業ディレクトリ配下のパスは一時ディレクトリ配下として扱わない。
  - 判定は引用符とエスケープを解釈する字句解析で行い、解析できない入力は通す。ブロック時の reason に分類 ID、tsrepl での書き換え例 1 行、動作モードの切り替え方を含める。
  - `enforce`(既定)/ `warn` / `off` を環境変数 `SPIRITS_ACTION_GUARD` で切り替える。`warn` は実行を止めない。
  - ガードは挙動の誘導であり、セキュリティ境界ではない(`use("node:child_process")` や `bash -c '...'` などの迂回を塞がない)。
- 分類に該当した判定ごとにカスタムエントリ `spirits_guard` を 1 件記録する(分類 ID、モード、ブロックしたか、nested か)。コマンド本文と出力は含めず、LLM のコンテキストへ送らない。
- tsrepl にホスト関数 `sh(command, options?)` を追加する。`tool("bash", { command, ... })` と同じ経路・同じ構造化結果を返す短縮形。`tsrepl_cell` の `toolCalls` には `name: "bash"` の呼び出しとして記録する。
- **BREAKING** tsrepl の promptGuidelines を、2 項目から 3 項目に置き換える(項目数と文面が変わる。`rlm` の子セッションでは従来どおり空)。
- code-mode プロンプトの選択基準と使用例を新しい 3 項目と `sh()` に合わせる。規則の文面は 1 か所の定数から参照し、複製しない。

対象外(別の change で扱う): bash をモデルから隠すモード、リポジトリ自身のテスト用シェルの python3 依存の置き換え、計測エントリの集計スクリプトと閾値の再調整、`rlm` の子セッションへの bash の開放、シェル(`bash` / `sh`)経由の一時スクリプト実行の判定、互換性マトリクス(`managed-pi-compatibility`)への guard の行の追加。

## Capabilities

### New Capabilities

- `action-surface-guard`: bash 呼び出しを実行時に分類し、他言語のスクラッチコードとシェルのプログラミングへブロックを返す振る舞い、およびその計測。

### Modified Capabilities

- `tsrepl`:
  - 「ツール一覧と規則への掲載」を MODIFIED(promptGuidelines を 3 項目へ置き換える)
  - 「セル実行ログの出力と tool() のフィールド」を MODIFIED(`toolCalls` に `sh()` の呼び出しを含める)
  - ADDED で「`sh` ホスト関数」
- `continual-harness`: 「code-mode プロンプトの適用」を MODIFIED(選択基準を 3 項目へ、使用例を `sh()` 経由へ書き換える)。

## Impact

- 影響コード(すべて `packages/spirits/`):
  - 新層 `src/guard/`: 字句解析(`lex`)、分類規則と閾値(`rules`)、ブロック理由の組み立て(`messages`)、`tool_call` ハンドラ(`register`)、判定の計測エントリ(`metrics`)
  - `src/index.ts`: guard を `optional` 層として登録(失敗時はガード無しで起動し、tsrepl / rlm / メモリ / スキル / TODO を失わない)。root の tsrepl へ `sh` を渡す
  - `src/repl/hostfns.ts`: `sh` ホスト関数(`HostFnRegistry` 経由)。`tool` と同じ記録経路を共有する。`src/repl/registry.ts` と `src/repl/metrics.ts` は変更しない見込み
  - `src/tools.ts`: `TSREPL_PROMPT_GUIDELINES` の 3 項目化
  - `src/harness/prompt.ts`: code-mode プロンプトの選択基準と使用例
  - `src/config.ts` / `src/constants.ts`: モード(`enforce` / `warn` / `off`)の読み取りと既定値、環境変数名、計測エントリの種別名、分類 ID、許可フィルタの一覧、分類 ID ごとの説明文と書き換え例
  - `src/types/pi-coding-agent.d.ts`: Pi の型の写し。`tool_call` の `on()` 多重定義と、`ToolCallEvent` / `BashToolCallEvent` / `ToolCallEventResult` を追加する(現状は無い)
  - `packages/spirits/README.md`: 環境変数 `SPIRITS_ACTION_GUARD` の説明
- 影響テスト: `packages/spirits/test/{guard-lex,guard-classify,guard-register,guard-metrics,guard-integration,managed-pi-compat-guard,config,hostfns,tools,cell,rlm-hostfn,harness-prompt,extension-degradation,architecture-conventions}.test.ts`(`guard-*` と `managed-pi-compat-guard` は新規)。通すコマンドと分類の固定データは `packages/spirits/test/fixtures/guard/` に置く。
- アーキテクチャ正本: `docs/architecture/convention-registry.md` を同一変更で更新する。
  - `registry:layers` に `spirits:guard`(向きは `spirits:shared` と Pi のみ)を追加し、`spirits:entry` の許可向きに `spirits:guard` を加える(加えないと `index.ts` からの登録が `ARCH-LAYER` 違反になる)
  - `registry:layer-members` に `packages/spirits/src/guard/` を追加する
  - 本文の層数(現状 10 層。表は既に 11 層で、guard を足して 12 層)と、兄弟層の列挙、`ARCH-SPIRITS-LAYER` の層の列挙を表に揃える
  - `repl` は `guard` を import しない(後段非依存)。
- 影響ドキュメント: `docs/spirits-m1-repl.md`(ホスト関数の表)、`docs/spirits-m4-harness.md`(code-mode プロンプトの骨格)
- pi 上流コア差分: **なし**。使うのは pi の公開拡張 API の `tool_call`(`BashToolCallEvent.input.command`、`parentToolCallId`、`ToolCallEventResult.block` / `reason`)、`appendEntry`、`ToolDefinition.promptGuidelines`、`ExtensionToolContext.executeTool` のみ。公式 Pi(managed)経路と fork 経路の両方で動く(どちらのフック経路でも同じイベントが届く。managed 経路の確認は `managed-pi-compat-guard.test.ts` で行う)。
- 依存関係: なし(新規依存なし)。シェルの字句解析は自前の最小実装。
