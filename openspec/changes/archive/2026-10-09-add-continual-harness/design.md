# Design

## Context

M1 の `packages/spirits` は `tsrepl` ツールを持ち、`HostFnRegistry` でホスト関数を公開する。M3 で `rlm` を追加し、`src/index.ts` が `createRlmHostFn` を組んで `registerTsrepl(pi, { hostFns: [rlm] })` に渡す。`createTsreplTool` は `hostFns` の `description` をツール説明へ連結する(すべて M1/M3 で実装済み)。

M4 が依存する上流 API は次のとおり(コード参照)。

- `pi.on("before_agent_start", handler)` は `ExtensionAPI` にあり、ハンドラは `event.systemPromptOptions`(可変の `NormalizedBuildSystemPromptOptions`)と `event.systemPrompt` を受け取る(`extensions/types.ts:1587`、`runner.ts:1428-1455`)。`systemPromptOptions.sections` への追加は `buildSystemPromptSections` が同じ名前のタグで包み、`diffSystemPromptSections`(`system-prompt.ts:196`)が前回との差分を transcript に追記する。`BeforeAgentStartEventResult.systemPrompt` を返すと `forceSystemPrompt` としてシステムプロンプト全体を置換する(`runner.ts:1446`、`agent-session.ts:1744`)。
- `ExtensionContext.sessionManager` は `ReadonlySessionManager`(`types.ts:335`)で、`getBranch()` と `getEntries()` を持つ(`session-manager.ts:245-262`)。`getBranch()` は現在の leaf から根までの経路だけを返し(`session-manager.ts:1469`)、`getEntries()` は放棄したブランチを含む全エントリを返す(同 1520)。`docs/extensions.md:229-230` は、ブランチに依存する状態を `getBranch()` から復元し、全エントリからは再構築しないよう求めている。ユーザーメッセージは `SessionMessageEntry`(`type: "message"`)の `message.role === "user"`。カスタムエントリ(`type: "custom"`、`customType`)は LLM コンテキストに入らない(`session-manager.ts:119-124`)。
- `pi.appendEntry(customType, data)` は LLM へ送らないカスタムエントリを追記する(`types.ts:1692`、M3 の `rlm_usage` で実績)。
- `pi.registerTool({ exposure: "codemode" })` はモデル宣言なしで `ctx.executeTool` から呼べる(`docs/extensions.md`「Tool exposure」)。`tsrepl` のセルからは `tool(name, args)` 経由で届く。`codemode` exposure のツールは有効ツールに入らず、システムプロンプトの tools セクションにも出ない(`buildSystemPromptSections` は `selectedTools` だけを列挙する)。
- `getAgentDir()` は `PI_CODING_AGENT_DIR` があればその値(`~` を展開)、なければ `~/.pi/agent`(`config.ts:566`)。spirits のバイナリは bootstrap で `~/.spirits/agent` を設定する(`bin/env-defaults.ts`)。ソースから `bin/spirits.ts` を経由せず起動した場合は `~/.pi/agent` になる。
- Pi のスキルは `agentDir/skills/` 配下の `SKILL.md` を再帰探索する(`skills.ts`、`resource-loader.ts:979`)。frontmatter は YAML パーサで読まれ(`utils/frontmatter.ts`)、解析に失敗した `SKILL.md` は警告だけを出して読み込まれない(`skills.ts:294-300`)。`description` が空白のみの場合も読み込まれない(`skills.ts:314-334`)。スキルはセッション中の編集後に `/reload` で反映される(`docs/skills.md:89`)。プロンプトテンプレートは `agentDir/prompts/` の**直下**の `*.md` だけを読む(非再帰、`prompt-templates.ts:159`)。

設計の一次根拠は `docs/spirits-design.md`(§4.4、§9)と `docs/spirits-m4-harness.md`。本ドキュメントは、これらの決定を実装へ落とす際の判断と、これらから変えた点を扱う。

## Goals / Non-Goals

**Goals:**

- メモリの追記・保存形式・起動時注入の方式と、上限値の既定と設定方法を確定する。
- `goal()` の取得元と明示設定の方法を確定する。
- スキル CRUD ツールのパラメータ、保存形式、検証、失敗時の扱いを確定する。
- code-mode プロンプトの既定・上書き・適用方式と、モデルへの案内経路を確定する。
- 子セッションへ注入しないポリシーを、rlm の経路を変えずに成立させる。
- fake で決定的にテストできる境界と、実機(interactive smoke)で確認する範囲を分ける。

**Non-Goals:**

- スキルの自動品質評価・A/B 検証、メモリファイルの自動削除。
- `rlm` の非同期化・ハンドル返却(M5)。
- 子セッションへのメモリ注入オプション(将来ニーズが出た場合の別 change)。
- メモリ・スキルの検索インデックスやベクトル検索。

## Decisions

### 1. メモリは `memory/notes.md` への追記 + `spirits_memory` エントリ

`note(text)` は `text` の改行(`\r\n`、`\r`、`\n`)を半角スペース 1 つに置き換えて 1 行にし、`<agentDir>/memory/notes.md` に `- <ISO8601> <text>` の 1 行を追記して、`pi.appendEntry("spirits_memory", { text, timestamp, file })` を呼ぶ。`text` はファイルへ書いた行の本文(置き換え後)と同じにする。ディレクトリとファイルは無ければ作る(`mkdir` と、追記モード `a+` での `open`)。開いたハンドルでサイズを確かめ、0 より大きく最後の 1 バイトが `\n` でなければ、行の先頭に `\n` を付けて書く(手での編集やエージェントの `write` で末尾の改行が無いと、追記した行が既存の最終行に連結し、行数で決まる抜粋と整理候補の判定(Decision 3)が狂う)。確認で読むのは最後の 1 バイトだけで、全体は読まない。戻り値は追記先パスを含む確認文字列。`text` が文字列でない、または空白のみ(改行のみを含む)なら、ファイルもエントリも書かずに例外を投げる。空白判定は置き換え前の `text` に対して行う。

- 選択肢: 改行を含む `text` を例外にする。
- 理由: 複数行の知見は自然に出てくる入力で、拒否するとエージェントが書き直す手間が増えるため却下。保存形式が元のテキストと変わる点は、案内文(Decision 12)に明記する。
- 選択肢: 複数行をそのまま 1 エントリとして追記する。
- 理由: 抜粋と整理候補の判定が行数で決まる(Decision 3)ため、1 note の行数が不定だと上限が読めなくなる。却下。
- 選択肢: `note(text, filename?)` でトピック別ファイルに分ける。
- 理由: M4 のシグネチャは `note(text)` で、ファイル分割はエージェントが `write` / `use("node:fs")` で自由にできる。API を増やす必要がないため却下。
- 選択肢: セッション JSONL の `spirits_memory` エントリだけに保存する。
- 理由: 起動時注入が JSONL 全走査になり、セッションが変わるとファイル側の一覧性・編集性も失う。ファイルを正、エントリを監査ログとするため却下。
- 選択肢: 追記を `writeFile` + 自前の read-modify-write にする。
- 理由: 追記と最後の 1 バイトの確認で足り、全体を読む必要がないため却下。
- 選択肢: 末尾の改行を確認せず、`appendFile` で追記するだけにする(旧案)。
- 理由: 改行で終わらない既存ファイルでは `prior note- <ISO8601> text` のように最終行へ連結し、spec の「1 行を追記」を満たさない。整理候補を受けたエージェントが `notes.md` を書き直すと起こり得るため却下(深い検証で検出)。
- 選択肢: 常に行の先頭に `\n` を付ける。
- 理由: 改行で終わるファイルに空行が増え、行数と抜粋に空行が混ざるため却下。

### 2. 注入は `systemPromptOptions.sections` への追加(forceSystemPrompt は使わない)

`before_agent_start` ハンドラが `event.systemPromptOptions.sections.spirits` に code-mode プロンプトを、`sections.spirits_memory` にメモリ要約を設定する。Pi はセクション単位で差分を transcript に追記するため、既定プロンプトの tools / rules / docs を保持したまま spirits の指示を足せる。上書きファイル・メモリ内容の変更は次回実行の差分として現れる。

- 選択肢: `event.systemPromptOptions.forceSystemPrompt` を設定する / `systemPrompt` を返す(M4 設計書の「forceSystemPrompt 相当」)。
- 理由: 全置換になり Pi 既定のツール一覧・ルール・docs を失う。再ビルドなしで上流追従しやすくするため却下。
- 選択肢: `appendSystemPrompt` に連結する。
- 理由: `addendum` セクション 1 つに code-mode とメモリが混ざり、メモリ更新のたびに code-mode 部分も差分として再送されるため却下。
- 選択肢: `context` / `context_with_system` イベントでメッセージ列を書き換える。
- 理由: リクエストごとの変換で、システムプロンプトのセクションとしての diff 管理から外れる。実行開始前の 1 回で足りるため却下。

### 3. メモリ要約の形式と上限

`<agentDir>/memory/` 直下の `*.md`(ディレクトリは除く)から、次の順に `spirits_memory` セクションの本文を組む。

1. 固定の見出し行(全文は各ファイルを read で読む旨)
2. 整理候補(あれば): 行数が `fileLineLimit` を超えるファイルの名前と行数
3. `notes.md` の抜粋(末尾 `previewLines` 行)
4. ほかのファイルの抜粋(ファイル名昇順、先頭 `previewLines` 行)

各ファイルの見出しは、絶対パス、抜粋が先頭か末尾か、総行数、全文はそのファイルを読む旨を含める。行は `\n` で区切り、末尾の改行による空要素は数えない(`note` は行末に改行を付けて追記し、改行で終わらない既存ファイルには行区切りを補う(Decision 1)ため、末尾の改行を除いて数える)。

本文全体の長さ(JavaScript 文字列の長さ)が `injectionCharLimit` を超える場合は、切り詰めの表示(固定文言)を末尾に付けても `injectionCharLimit` 以内になるよう、残せる文字数を `limit - 表示の長さ` として、次の優先順位で収める。

1. 固定の見出し行と整理候補は先頭に固定する。
2. `notes.md` の抜粋は、残りの文字数に収まるまで古い行から省く。省いたら見出しの行数表示を、実際に含めた行数に更新する(`末尾 K 行 / 全 M 行` の `K`)。最新の 1 行も収まらない場合は、その行の後ろ側を切り詰める。
3. ほかのファイルの抜粋は `notes.md` の後ろに続け、収まらなくなった所で後ろ側を切り詰める。
4. 見出しと整理候補だけで残せる文字数を超える場合は、本文の後ろ側を切り詰める。

後ろ側を切り詰める経路(上の 2 の最新の 1 行、3、4)では、見出しの行数表示は切り詰める前の抜粋の行数のままにする。切り口が見出しの中や直後に来ると、「末尾 1 行」と示したまま本文が 0 文字になる、または見出しが途中で切れる。これは上限が数百文字以下の極端な設定でだけ起き、spec は後ろ側の切り詰めでの行数の一致を保証しない範囲として明記する。

`limit` が表示の長さ以下の場合は、表示を付けず先頭 `limit` 文字だけを返す(spec で規定)。どの経路も、切り口の最後のコード単位が上位サロゲートなら 1 つ戻して、サロゲートペアを割らない(孤立したサロゲートはプロバイダの JSON 検査で拒否され得る)。

見出しに示す絶対パスは、`registerContinualHarness` が `agentDir` を `path.resolve` で解決した値から作る。`PI_CODING_AGENT_DIR` が相対パスでも、見出し(と `note` の戻り値・`spirits_memory` エントリの `file`)は絶対パスになる。

ファイルが 1 つも無ければセクションを追加しない。個別ファイルの読み取り失敗はそのファイルだけ除外し、他で続行する。

`previewLines` / `injectionCharLimit` / `fileLineLimit` は設定可能な値で、既定は 20 / 4000 / 200(Decision 11)。

- 選択肢: 本文全体を一律に後ろから切り詰める(旧案)。
- 理由: `notes.md` は古い順に並ぶため、`notes.md` だけで上限を超えると最新の note から落ちる(約 280 文字の note が 20 行あると、既定の上限で新しい 6 行が落ち、古い 14 行が残る)。proposal の「切り詰めで新しい note が落ちないようにする」を満たさないため、`notes.md` は古い行から省く規則に変えた。
- 選択肢: ファイルごとに文字数の予算を割り当てる。
- 理由: 予算の配分規則(固定比率か、行数比か)が増え、上限が小さいときに挙動が読みにくい。優先順位で埋める方が、規則が短く、テストの境界も決めやすいため却下。
- 選択肢: 抜粋だけを数えて 4000 以内にする(ファイル単位で打ち切る)。
- 理由: 見出し・パス・整理候補が上限の外になり、注入の総量が決まらない。1 ファイル目の抜粋だけで上限を超えると、抜粋が 0 件になる場合もある。却下。
- 選択肢: 全ファイルを先頭 N 行で抜粋する。
- 理由: `notes.md` は末尾に追記されるため、N 件を超えた新しい note が次のセッションに現れない。却下(整理候補の通知は 200 行を超えるまで出ない)。
- 選択肢: `note` を `notes.md` の先頭へ挿入する。
- 理由: 追記ではなく read-modify-write になり、同時書き込みで欠落する危険が増える。却下。
- 選択肢: ファイル名昇順だけで並べる。
- 理由: `a.md` が大きいと、切り詰めで `notes.md` の新しい note が先に落ちる。`notes.md` を整理候補の次に置くことで、後ろから切る規則と整合させる。ファイル名昇順だけの規則は却下。
- 選択肢: 全文を注入する。
- 理由: トークン膨張が起きる(M4 設計書のリスク)。エージェントはパスから read できるため却下。
- 選択肢: 直近 N 件の `spirits_memory` エントリを注入する。
- 理由: ファイルを正とする方針と二重管理になり、起動時注入が「ファイルに残っている事実」を反映しないため却下。
- 選択肢: 行数上限超過時に該当ファイルの抜粋を省く。
- 理由: 中身が見えないと整理の判断ができない。抜粋は残し、整理候補として件数を見せるため採用しない。
- 選択肢: 後ろ側を切り詰めた場合も、見出しの行数を本文に残った行数へ合わせる。
- 理由: 見出し自体が切れる経路では合わせようがない。最新の 1 行を 0 文字まで切った場合に 0 行と表示すると、note が存在しないように読める。極端に小さい上限でしか起きないため、実装を複雑にせず spec で保証範囲を明記する。却下(深い検証で検出)。
- 選択肢: 先頭・末尾の N 行だけを読み、全文を読まない。
- 理由: 見出しの総行数と整理候補の判定に、全文の行数が要る。逐次読み取りでも読むバイト数は変わらないため、M4 では全文を読む(Risks 参照)。却下。

### 4. code-mode プロンプトの既定は TS 定数、上書きはエージェントディレクトリ

既定プロンプトは `src/harness/prompt.ts` の `DEFAULT_CODE_MODE_PROMPT` としてバイナリに同梱する。実行時は `<agentDir>/prompts/spirits/code-mode.md` があり、読めて、空白のみでなければその内容、そうでなければ既定を使う。`spirits_prompt_set({ content })` は、書く前に現在の実効プロンプトを `<agentDir>/prompts/spirits/code-mode.md.bak` へ保存し、`code-mode.md` へ `content` を書く。空・空白のみは書かずにエラー。

`prompts/` 直下の `.md` は Pi のプロンプトテンプレートとして `/` コマンド化されるため、上書きファイルは `prompts/spirits/` サブディレクトリに置く(非再帰ローダーはサブディレクトリを読まない)。

- 選択肢: リポジトリの `prompts/spirits/` に Markdown を置き、`with { type: "text" }` の import でバンドルする。
- 理由: `module: Node16` の型検査と Bun の text import 属性の組み合わせが未検証で、コンパイルバイナリでの同梱も追加確認になる。TS 定数なら同一バンドル経路で完結するため却下(「設計書からの変更点」参照)。
- 選択肢: 上書きを `<agentDir>/prompts/spirits.md` に置く。
- 理由: Pi がプロンプトテンプレート `spirits` として読み込み、コマンド一覧と重複する。システムプロンプト注入とテンプレートの両方の意味を持つファイルになり曖昧なため却下。
- 選択肢: 上書きを `<agentDir>/spirits/code-mode.md` に置く。
- 理由: 設計書 §4.4 が `prompts/` をエージェントが CRUD する対象として挙げている。`prompts/spirits/` ならその配下に収まり、テンプレート探索とも衝突しないため却下。
- 選択肢: 上書き時にタイムスタンプ付きの複数バックアップを残す。
- 理由: 世代管理は git 管理を推奨する方針(M4 設計書のスキル変更履歴と同じ)。復元用の直前 1 世代で足りるため却下。

### 5. `goal()` は現在のブランチのエントリから解決し、`goal(text)` で設定する

`goal()` は `scope.toolContext.sessionManager.getBranch()`(根から現在の leaf までの経路)を先頭から走査し、最新の `spirits_goal`(`type: "custom"`)の `data.goal` を返す。無ければ最初の `SessionMessageEntry` のうち `message.role === "user"` のテキストを返す。どちらも無ければ空文字列。最初のユーザーメッセージは「見つけたか」を別のフラグで持って固定し、そのテキストが空(画像のみなど)でも後続のユーザーメッセージには進まない(空文字列を「未設定」の目印にすると、画像だけの最初のメッセージの後で、次のメッセージがゴールに化ける)。

ホスト関数は `(...args)` で受け、引数の個数で分ける。引数なしが取得、1 つ以上が設定で、`goal(undefined)` も設定として検証して拒否する(`(text?)` では引数なしと `undefined` を区別できず、設定したつもりの `goal(x)`(`x` が undefined)が取得として成功してしまう)。`goal(text)` は `pi.appendEntry("spirits_goal", { goal: text })` を呼んで `text` を返す。空白のみ・文字列でない場合はエラー。

- 選択肢: `getEntries()` を走査する。
- 理由: 放棄したブランチのエントリも返すため、分岐後に別ブランチで設定したゴールが返る。`docs/extensions.md` もブランチ依存の状態を全エントリから再構築しないよう求めている。却下。
- 選択肢: 拡張のクロージャに保持し、`before_agent_start` の `event.prompt` を初回ゴールとして覚える。
- 理由: セッション再開・分岐で拡張が作り直されるとゴールが消える。M4 設計書の「保持はセッションエントリ」に反するため却下。
- 選択肢: `goal()` は取得のみで、明示設定は別の codemode ツールにする。
- 理由: M4 設計書は「セッション開始時のユーザ指示 or 明示設定」を返すとし、設定経路を別ツールにすると REPL から 2 段になる。任意引数 1 つで済むため却下。
- 選択肢: 最初のユーザーメッセージとして `custom_message` も含める。
- 理由: `custom_message` は拡張が注入したもので、ユーザー指示ではないため却下。

### 6. スキルツールは `name` / `description` / `body` を取り、Agent Skills 形式で保存する

`spirits_skill_save` は `<agentDir>/skills/<name>/SKILL.md` に次を書く。

```
---
name: <name>
description: <description を JSON 文字列として書いたもの>
---

<body>
```

`description` は `JSON.stringify(description)` の結果(1 行のダブルクォート文字列)で書く。JSON の文字列リテラルは YAML のダブルクォート文字列として有効で、改行・`: `・`#`・引用符・制御文字はエスケープされるため、Pi の YAML パーサが元の文字列へ戻し、ほかのキーも生じない。`name` は検証済みの文字だけで構成されるためそのまま書く。

`name` は `^[a-z0-9]+(-[a-z0-9]+)*$` かつ 64 文字以下で検証する(Agent Skills 仕様)。`description` と `body` は、文字列で、空でも空白のみでもないことを要求する(空白のみの `description` は Pi が欠落として読み飛ばすため)。`description` は 1024 文字以下も要求する(Agent Skills の上限。Pi は `packages/coding-agent/src/core/skills.ts` の `MAX_DESCRIPTION_LENGTH` を超えると、読み込みのたびに警告を出す)。同名は上書きする。

`spirits_skill_list` は `skills/` 直下を走査し、`SKILL.md` を持つディレクトリについて、ディレクトリ名と `description` を返す。ディレクトリへの symlink は `stat` でたどって対象にする(Pi のスキルローダーも symlink をたどる。`readdir` の種別だけで判定すると、dotfiles などから symlink で置いたスキルが一覧に出ない)。ディレクトリ名がスキル名の規則(`validateSkillName` と同じ)に合わないものは一覧に含めない(`My_Skill` を返しても、削除側の検証で拒否されて扱えない状態を作らないため。Pi はそのスキルを読み込むが、本ツールの管理対象外とする)。

`description` は frontmatter の `description:` 行から、次の規則で読む。読み方の優先順は上から。

| 値の形 | 返す文字列 |
|---|---|
| `"` で始まる | JSON として復号(失敗したら空) |
| `'` で始まる | シングルクォートの YAML として復号(`''` は `'`。閉じクォートの後が空白かコメントだけでなければ空) |
| `>` または `\|` で始まる(ブロックスカラー) | 空 |
| 次の行がインデントで始まる(継続行) | 空 |
| YAML の指示子 `[` `{` `]` `}` `,` `&` `*` `!` `#` `%` `@` `` ` `` で始まる、または `- ` / `? ` / `: ` で始まる | 空(フロー集合・アンカー・エイリアス・タグ・コメント・予約文字。Pi は文字列以外を返すか、別の文字列を返すか、解析に失敗する) |
| コメントを除いて trim した値が `: ` を含む、または `:` で終わる | 空(Pi はネストしたマップとして解析に失敗する) |
| コメントを除いて trim した値が YAML 1.2 core スキーマで文字列以外に解決される(下記) | 空 |
| それ以外(プレーン) | 行末のコメント(空白またはタブの後の `#` 以降)を除いて trim(結果が空なら空) |

文字列以外に解決される値は、`null` / `Null` / `NULL` / `~`、`true` / `True` / `TRUE` / `false` / `False` / `FALSE`、整数(`[-+]?[0-9]+`、`0o[0-7]+`、`0x[0-9a-fA-F]+`)、浮動小数点(`[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?`、`[-+]?\.(inf|Inf|INF)`、`\.(nan|NaN|NAN)`)とする。Pi が使う `yaml` パッケージの既定は YAML 1.2 core スキーマで、`yes` / `no` などは文字列のまま読まれる。分類は Pi の `parseFrontmatter` で確認した(`a:b`、`-x`、`?x`、`:x`、`1.2.3`、`http://x` は文字列。`&anchor x` と `!tag x` は `x`。`a<TAB># c` は `a`)。

一覧の説明は、Pi が読む文字列と一致するか空文字列のどちらかにし、Pi と異なる空でない文字列は返さない(一覧に説明付きで出るのに、Pi は別の説明で読む、または読み込まない状態を作らない)。

frontmatter が無い、行が無い場合も空文字列にする(読めない記法を、記号だけ(`>` など)の説明として返さない)。frontmatter の `name` は一覧に使わない(手書きで食い違うスキルも、一覧の名前で削除できる)。

`spirits_skill_delete` は該当ディレクトリを再帰削除し、存在しなければエラー。symlink のスキルは、`rm` がリンクだけを消し、リンク先は変更しない(Node の `fs.rm` で確認済み)。

保存の結果テキストには、保存先パスと「次のセッションまたは `/reload` から有効」の案内を含める。

- 選択肢: `content` 1 つで frontmatter 込みの全文を受け取る。
- 理由: name の検証と保存先の決定に frontmatter のパースが要り、壊れた frontmatter をそのまま保存できてしまう。構造化パラメータの方が検証と異常系テストが単純なため却下。
- 選択肢: `description` をそのまま `description: <text>` で書く。
- 理由: `: ` や先頭の `#`・`"` で YAML が壊れ、Pi が読み飛ばす。改行を含むと任意のキー(例: `disable-model-invocation`)を差し込める。一覧には出るのに Pi は読み込まない状態になるため却下。
- 選択肢: `: ` や改行を含む `description` を拒否する。
- 理由: 自然な説明文を拒否することになり、エージェントの書き直しが増える。エスケープで済むため却下。
- 選択肢: ブロックスカラー(`|`)で書く。
- 理由: 任意の本文のインデントと末尾の改行の扱いを規則化する必要があり、検証が複雑になる。1 行の JSON 文字列の方が往復の検証が単純なため却下。
- 選択肢: 一覧の名前に frontmatter の `name` を使う(旧案)。
- 理由: 保存・削除の識別子(ディレクトリ名)と食い違い得る。`spirits_skill_save` で作ったスキルでは常に一致するため、食い違うのは手書きのスキルだけだが、一覧の名前で削除できない状態を作らない方を採る。却下。
- 選択肢: 規則外のディレクトリ名も一覧に返し、削除側の名前検証を緩める。
- 理由: 書き込み先の封じ込めが名前の検証(`../` などの拒否)に依存しており、緩めると保存・削除の安全性の根拠が弱まる。一覧側で規則外を除く方が小さい変更で済むため却下。
- 選択肢: 値の形を判別せず、`description:` の後ろをそのまま返す(旧案)。
- 理由: `>` や `|` のブロックスカラーが記号だけの説明として返り、シングルクォートやコメントも Pi が読む文字列と食い違う。読めない記法は空にし、読める記法だけ Pi と同じ文字列にするため却下。
- 選択肢: プレーンの値は、形を問わず ` #` 以降のコメントを除いて返す(旧案)。
- 理由: `fix: the thing`(Pi は解析に失敗して読み込まない)、`true` や `[a, b]`(Pi は文字列以外として扱い読み込まない)、`&anchor x`(Pi は `x` と読む)が、一覧には別の説明付きで出る。タブの後のコメントも残る。Pi と異なる空でない文字列を返さないよう、Pi が文字列として読まない形は空にし、コメントの開始を空白またはタブの後の `#` にする。却下(深い検証で検出)。
- 選択肢: `description` の長さを検証しない(旧案)。
- 理由: 1025 文字以上の説明を保存すると、Pi が読み込みのたびに警告を出す。名前と同じく Agent Skills の上限で検証するため却下(深い検証で検出)。
- 選択肢: 削除で `SKILL.md` だけを消す。
- 理由: 空ディレクトリが残って一覧の判定が曖昧になるため却下(ディレクトリごと削除)。
- 選択肢: YAML パーサを依存に追加する。
- 理由: 保存側は JSON 文字列で完結し、一覧側も `description:` 行の復号だけで足りる。依存追加なしの方針(Impact)に合わないため却下。

### 7. 登録と配線

`src/harness/` に次を置く。

- `paths.ts`: `getAgentDir()` を実行時 import し、`memoryDir` / `skillsDir` / `promptOverridePath` などを返す。`src/harness/tsconfig.json`(`../../../../tsconfig.json` を extends)で解決する(M3 の `src/rlm/tsconfig.json` と同じ方式)
- `memory.ts`: `createNoteHostFn({ pi, agentDir, now })` と `buildMemorySummary(agentDir, limits)`(`limits` は `src/config.ts` の `MemoryLimits`)
- `goal.ts`: `createGoalHostFn({ pi })`
- `skills.ts`: save / list / delete の実装(agentDir と名を受け取る純関数)
- `prompt.ts`: 既定プロンプトと `resolveCodeModePrompt(agentDir)`
- `guidance.ts`: `goal` / `note` の `HostFnEntry.description`(Decision 12)
- `tools.ts`: skills / prompt の codemode ツール定義(`agentDir` を受け取る)
- `install.ts`: `registerContinualHarness(pi, { agentDir, env })`。受け取った `agentDir` を `path.resolve` で絶対化して以降のモジュールへ渡し、`loadConfig(env)` を 1 回解決し、`pi.registerTool` で codemode ツール群を登録し、`pi.on("before_agent_start", ...)` を登録し、ホスト関数 `[goal, note]` を返す

harness の外に、環境変数を読む設定モジュール `src/config.ts`(Layer 3、Decision 11)と、複数ファイルが参照する値の `src/constants.ts`(Layer 2、Decision 13)を置く。

`src/index.ts` は `rlm` と harness のホスト関数を `registerTsrepl` の `hostFns` に並べる。`rlm` の子の `tsrepl` は M3 のまま `[rlm]` だけを登録し、`spawn.ts` も変更しない。

- 選択肢: `index.ts` にすべて書く。
- 理由: `index.ts` はビルドエントリから静的に読まれる配線点で、fs やツール定義まで置くとテストできなくなるため却下。
- 選択肢: `harness/install.ts` が `createTsreplTool` まで組み立てる。
- 理由: tsrepl の生成は `src/index.ts` の責務のままでよく、循環参照も避けられるため却下。

### 8. fake でテストできる境界を分ける

- `memory.ts` / `skills.ts` / `prompt.ts` / `src/config.ts` は `agentDir`、`now`、`env` などの引数を受け取る純モジュールとし、`bun test` は一時ディレクトリで検証する
- `createNoteHostFn` / `createGoalHostFn` / `install.ts` は `pi` と `agentDir` を注入可能にし、fake `pi`(`appendEntry` / `registerTool` / `on` を記録)と fake セッション(`getBranch()` と、他ブランチも返す `getEntries()`)で検証する
- 特殊文字を含む説明の YAML 往復は、Pi の公開 API `parseFrontmatter` で検証する(JSON の復号だけでは、spec の「YAML として読む」を確認したことにならない)。`packages/spirits/test/pi-runtime/` に、root の `tsconfig.json` を extends する `tsconfig.json` を置いて Bun に実行時の Pi を解決させ、型検査は `pi-coding-agent.d.ts` のミラーに `parseFrontmatter` を足して通す(`src/harness/tsconfig.json` と同じ方式。YAML パーサの依存追加はしない)
- 境界値のテストは、spec のシナリオと同じ位置に探針を置く(抜粋行数 N なら N 行目のマーカーが出て N+1 行目が出ない)。探針を 1 行ずらすと off-by-one を検出できない
- 切り口の位置に依存するテスト(サロゲートペアの切り詰め)は、上限なしの要約から切り口の位置を導出し、探針が狙った位置(ペアの途中)に当たったこと自体も確かめる。一時ディレクトリのパスが長い環境では、固定の上限だと切り口が見出しの中に入り、何も検証せずに通るため(深い検証で検出)
- spec のシナリオの期待結果は、すべての項目をアサーションで確かめる(整理候補では行数と、対象ファイルが変更されないこと)。fake で確かめられない項目(カスタムエントリが LLM のメッセージ列に入らないこと)は interactive smoke で確かめる
- 実機の `before_agent_start`(セクションの差分、上書きの反映、スキルが次セッションで読まれること、特殊文字を含む説明を Pi が読むこと)は interactive smoke で確認し、結果(日時、commit、コマンド、項目ごとの結果)を変更ディレクトリに記録する

- 選択肢: 実 `pi` を読み込む統合テストだけにする。
- 理由: `bun test` が実プロバイダや重い pi 起動に依存する。M3 と同じく fake で論理を固定するため却下。
- 選択肢: `getAgentDir()` を各所で直接呼ぶ。
- 理由: テストごとに環境変数を操作する必要があり、純モジュールの単体テストが環境依存になるため却下(解決は `paths.ts` に集約)。

### 9. 子セッションへは注入しない(ポリシー実装)

M4 設計書の決定どおり、子セッションへメモリ・code-mode プロンプト・`goal` / `note` を配線しない。実装は「harness を rlm の生成経路から参照しない」ことで満たし、`spawn.ts` の `DefaultResourceLoader({ noExtensions: true, noSkills: true, noPromptTemplates: true })` は変更しない。回帰として、次をテストで固定する。

- 子のホスト関数に `goal` / `note` が無いこと(M3 の `child host fn names` に `typeof goal` / `typeof note` の確認を足す)
- `src/rlm/` が `harness/` を import しないこと(`test/harness-isolation.test.ts`)
- 子のリソースローダー設定が M3 のままであること(M3 の `resource loader options`)

- 選択肢: 子へメモリ要約だけ注入するオプションを付ける。
- 理由: M4 設計書が「既定: 注入しない」と決定し、spec も自動配線を MUST NOT とするため却下。
- 選択肢: 子セッションにも `spirits` セクションを付ける。
- 理由: 子は拡張をロードしないため注入経路がなく、付けるには `spawn.ts` のリソース構成を変えることになる。stray な子プロンプトへの影響も読めないため却下。

### 10. 失敗時の扱い

- `note` / `goal(text)` の引数不正は、ファイルもエントリも書かずにセルのエラーとして返す。`note` の書き込み失敗(`mkdir`、`open`、末尾 1 バイトの読み取り、書き込みの例外)は、エントリを書かずにセルのエラーとして返す。ファイルハンドルは失敗時も閉じる
- `spirits_prompt_set` は、検証、`.bak` の書き込み、上書きファイルの書き込みの順に行う。引数不正と `.bak` の書き込み失敗では何も変更しない。上書きファイルの書き込みが失敗した場合は、`.bak` が直前の実効プロンプトで更新された状態でエラーを返す(実効プロンプトは変わらない)
- メモリ注入はハンドラ内でファイルごとに try/catch し、全滅時も `spirits_memory` を付けずにエージェント実行を続ける
- 上書きプロンプトの読み取り失敗は既定へフォールバックする
- スキル一覧の frontmatter が読めなくても、一覧はディレクトリ名と空の説明で返し、例外にしない(壊れたスキルは Pi 側のローダーが警告する)
- メモリ上限の環境変数が不正でも、その値の既定を使って続行する(Decision 11)

### 11. メモリ上限は Layer 3(環境変数)で変更でき、既定は Layer 2 の定数にする

メモリ上限は環境・運用で変わり得る値なので、`constants-discipline` の Layer 3 として扱う。

- Layer 2(`src/constants.ts`、harness の項): 既定値 `DEFAULT_MEMORY_PREVIEW_LINES = 20` / `DEFAULT_MEMORY_INJECTION_CHAR_LIMIT = 4000` / `DEFAULT_MEMORY_FILE_LINE_LIMIT = 200` と、環境変数名 `ENV_MEMORY_PREVIEW_LINES = "SPIRITS_MEMORY_PREVIEW_LINES"` / `ENV_MEMORY_CHAR_LIMIT = "SPIRITS_MEMORY_CHAR_LIMIT"` / `ENV_MEMORY_LINE_LIMIT = "SPIRITS_MEMORY_LINE_LIMIT"`(単位と根拠のコメント付き)。環境変数名の置き場所は、既存の `ENV_AGENT_DIR` と同じ `constants.ts` に揃える。
- Layer 3(`src/config.ts`): `loadConfig(env)` が環境変数を読み、`/^[1-9][0-9]*$/` に一致して安全な整数になる値だけを採用し、それ以外(未設定、空文字列、数値でない、0、負、小数)は Layer 2 の既定値を使って `{ memory: { previewLines, injectionCharLimit, fileLineLimit } }`(型 `MemoryLimits`)を返す。既定値のリテラルは `config.ts` に書かない。
- 読み込み: `registerContinualHarness` が拡張の読み込み時に `loadConfig(env)` を 1 回だけ呼び、結果をクロージャに保持して `buildMemorySummary` へ渡す(起動時に一度だけ読む)。`env` は引数で受け取り、既定は `process.env`。

- 選択肢: `config.ts` のモジュールトップで `export const config = { ... process.env ... }` として import 時に評価する(`constants-discipline` の例の形)。
- 理由: テストが import 時点の `process.env` に依存し、環境変数を変えるケースごとにモジュールの再読み込みが要る。`env` を引数にして呼び出し側が 1 回解決する形でも「起動時に一度だけ読む」は満たせるため却下。
- 選択肢: エージェントディレクトリの設定ファイル(例: `<agentDir>/spirits/harness.json`)に書く。
- 理由: 新しいファイル形式と、読み込み失敗・不正値の扱いが増える。spirits の既存の設定入力は `PI_CODING_AGENT_DIR` / `SPIRITS_DEV` など環境変数で、それに揃える方が小さい。却下。
- 選択肢: Pi の `settings.json` に書く。
- 理由: 上流の設定スキーマへ未検証のキーを足すことになる。「Pi 上流コアへの差分なし」の方針にも反しかねない。却下。
- 選択肢: 不正値で起動を失敗させる。
- 理由: メモリ上限の誤設定でエージェント全体が使えなくなるのは影響が大きすぎる。既定へ戻して続行する。ただし誤字が気づかれにくくなるため、README に環境変数名と既定値を載せる。却下。

エージェントはセッション中に環境変数を変えられないため、注入量は利用者の管理下に置かれる。

### 12. `goal` / `note` の説明で、ホスト関数とツールの使い方を案内する

codemode ツールはモデルへ宣言されず、`spirits` セクションは `spirits_prompt_set` で上書きされ得る。このため、名前と引数の案内は上書きの影響を受けない `HostFnEntry.description`(`createTsreplTool` が tsrepl のツール説明へ連結する)に置き、使い分けの基準は `spirits` セクションに置く。

- `goal` の説明: `goal()` で取得、`goal(text)` で設定、既定は最初のユーザー指示であること
- `note` の説明: `note(text)` の呼び方と改行の正規化に加え、スキルとプロンプトの codemode ツール 4 つの名前と引数名(`name` / `description` / `body` / `content`)、`await tool(name, args)` で呼ぶこと(セル終了時の abort で呼び出しが破棄されるため await が必要)、スキルの変更は次のセッションまたは `/reload` から有効になること

スキルとプロンプトのツールは `tool()` 経由で呼ぶもので、ホスト関数ではない。`HostFnRegistry` に載せられる説明は `goal` と `note` のエントリだけなので、ツールの案内は `note` のエントリに同居させる(`src/harness/guidance.ts` で組み立てる)。

- 選択肢: すべて `spirits` セクションに書く。
- 理由: `spirits_prompt_set` で上書きするとツール名の案内ごと消え、復元に使う名前をモデルが参照できなくなる。却下。
- 選択肢: ツール側の `promptSnippet` / `promptGuidelines` に書く。
- 理由: codemode ツールは有効ツールに入らず、tools セクションに出ない(Context 参照)。モデルに届かない。却下。
- 選択肢: 案内だけを持つ疑似ホスト関数を 1 つ追加する。
- 理由: REPL に実体のない名前が増え、`HostFnRegistry` の名前空間を汚す。`note` のエントリへの同居で足りるため却下。

### 13. 固定値は 3 層に分類し、複数ファイルが参照する値だけを Layer 2 に置く

実装前に、次の判定で固定値を分類した(結果は「固定値の分類」)。他のファイルから参照しなければ Layer 1(ファイル内の非公開定数)、参照するが環境・運用で変わらなければ Layer 2(`src/constants.ts`)、参照し、環境・運用で変わり得れば Layer 3(`src/config.ts`、既定値は Layer 2 を参照)。

- 選択肢: すべての値を `src/constants.ts` に集約する。
- 理由: 1 ファイルの中でしか意味を持たない文言やディレクトリ名まで公開され、変更の影響範囲が読めなくなる。複数ファイルが参照する値だけを Layer 2 に置く。却下。
- 選択肢: 各ファイルにリテラルを直書きする。
- 理由: ツール名や既定値が `tools.ts` / `guidance.ts` / `prompt.ts` / `config.ts` の間で食い違い得る。案内文のツール名がツールの実名とずれると、モデルが存在しない名前を呼ぶ。却下。

## 固定値の分類

`constants-discipline` に従い、本 change で導入するリテラルを実装前に分類した。

**Layer 2: `src/constants.ts`(harness の項を新設)。** 複数ファイルが参照し、環境・運用では変わらない値。

| 名前 | 値 | 参照するファイル | 単位・根拠 |
|---|---|---|---|
| `DEFAULT_MEMORY_PREVIEW_LINES` | 20 | `config.ts` | 行。抜粋 1 ファイルあたりの既定。利用者が決めた既定で、運用実績は無く、環境変数で調整できる |
| `DEFAULT_MEMORY_INJECTION_CHAR_LIMIT` | 4000 | `config.ts` | 文字(JavaScript 文字列の長さ)。`docs/spirits-m4-harness.md` §7 の既定 |
| `DEFAULT_MEMORY_FILE_LINE_LIMIT` | 200 | `config.ts` | 行。整理候補にする閾値の既定。利用者が決めた既定で、環境変数で調整できる |
| `ENV_MEMORY_PREVIEW_LINES` / `ENV_MEMORY_CHAR_LIMIT` / `ENV_MEMORY_LINE_LIMIT` | `SPIRITS_MEMORY_PREVIEW_LINES` / `SPIRITS_MEMORY_CHAR_LIMIT` / `SPIRITS_MEMORY_LINE_LIMIT` | `config.ts` | 環境変数名。既存の `ENV_AGENT_DIR` と同じ置き場所に揃える |
| `MEMORY_NOTES_FILE_NAME` | `notes.md` | `paths.ts`(追記先)、`memory.ts`(抜粋規則と並び順で識別) | `note` の追記先。`notes.md` だけ末尾を抜粋する規則の判定にも使う |
| `SKILL_NAME_MAX_LENGTH` | 64 | `skills.ts`(検証)、`tools.ts`(引数の説明) | 文字。Agent Skills 仕様(Pi の `MAX_NAME_LENGTH` と同じ) |
| `SKILL_NAME_PATTERN` | `^[a-z0-9]+(-[a-z0-9]+)*$` | `skills.ts`、`tools.ts` | Agent Skills 仕様の名前規則 |
| `SKILL_DESCRIPTION_MAX_LENGTH` | 1024 | `skills.ts`(検証)、`tools.ts`(引数の説明) | 文字(JavaScript 文字列の長さ)。Agent Skills 仕様(Pi の `MAX_DESCRIPTION_LENGTH` と同じ) |
| `TOOL_NAME_SKILL_SAVE` / `TOOL_NAME_SKILL_LIST` / `TOOL_NAME_SKILL_DELETE` / `TOOL_NAME_PROMPT_SET` | `spirits_skill_save` / `spirits_skill_list` / `spirits_skill_delete` / `spirits_prompt_set` | `tools.ts`(定義)、`guidance.ts` と `prompt.ts`(案内の本文) | codemode ツールの名前。外部契約 |

**Layer 3: `src/config.ts`。** 環境・運用で変わり得る値は、上記 3 つの上限だけ(`loadConfig(env)`、Decision 11)。

**Layer 1: 各ファイル先頭の非公開定数。** 他のファイルから参照しない値。

| ファイル | 定数 |
|---|---|
| `paths.ts` | ディレクトリ名 `memory` / `skills` / `prompts` / `spirits`、上書きファイル名 `code-mode.md`、バックアップの接尾辞 `.bak` |
| `memory.ts` | 対象拡張子 `.md`、`note` の行頭 `- `、改行のパターンと置換文字、エントリ種別 `spirits_memory`、見出し・切り詰め表示・先頭/末尾の文言、上位サロゲートの範囲(`0xd800` / `0xdbff`)、ファイル見出しと整理候補の行の書式(`### `、括弧、`行` の単位、区切り) |
| `goal.ts` | エントリ種別 `spirits_goal`、データのキー `goal` |
| `skills.ts` | `SKILL.md`、frontmatter の区切り `---` とキー名 `name` / `description`、ブロックスカラーの開始記号(`>` / `\|`)、クォート文字(`"` / `'`)、コメントの開始(空白またはタブの後の `#`)、YAML の指示子、マップの区切り(`: ` と末尾の `:`)、YAML 1.2 core スキーマで文字列以外に解決される値のパターン |
| `prompt.ts` | 既定プロンプトの本文 |
| `install.ts` | システムプロンプトのセクション名 `spirits` / `spirits_memory` |
| `guidance.ts` / `tools.ts` | 案内文、ラベル、ツールの説明、結果メッセージの文言(ツール名と `SKILL_NAME_MAX_LENGTH` は Layer 2 から補間する)。関数や定義の本体に文字列を直書きせず、ファイル先頭の定数にする |

**定数にしないもの。**

- `rlm` の深度上限(2)とツール呼び出し上限(50): `rlm/depth.ts` が持つ値。code-mode プロンプトと案内には数値を書かず、値は tsrepl のツール説明の `rlm` の項を参照させる。値の複製も、harness から `rlm` への import も作らない。
- Pi API の識別子(イベント名 `before_agent_start`、エントリの `type` と `role` の判別子、`exposure: "codemode"`): 型で検査される。
- `0`、`1`、空文字列などの自明な値。

**テスト。** 外部契約(ツール名、環境変数名、エントリ種別、保存パス)はリテラルで検証する。コードから導出すると、名前が変わっても検出できないため。設定可能な既定値と `SKILL_NAME_MAX_LENGTH` / `SKILL_DESCRIPTION_MAX_LENGTH` の境界(ちょうど、1 つ超過)は Layer 2 の定数から導出し、数値を複製しない。

## 設計書からの変更点

本 change は次の点で `docs/spirits-m4-harness.md` / `docs/spirits-design.md` と異なる。設計書への反映はタスクで行う。

| 項目 | 設計書 | 本 change |
|---|---|---|
| プロンプト適用 | `before_agent_start` の forceSystemPrompt 相当 | `systemPromptOptions.sections` に `spirits` / `spirits_memory` を追加(全置換しない) |
| 既定プロンプトの置き場所 | repo `prompts/spirits/`(§4.4・§9) | `src/harness/prompt.ts` の TS 定数(バイナリ同梱)。repo `prompts/spirits/` は作らない |
| プロンプト上書き先 | 記述なし | `<agentDir>/prompts/spirits/code-mode.md`(+ `.bak`)。`prompts/` 直下を避けてテンプレート探索と衝突させない |
| `goal()` | 取得(明示設定の経路は記述のみ) | 現在のブランチ上で解決し、`goal(text)` による明示設定を追加 |
| メモリ注入の抜粋 | 「各ファイル先頭 N 行」 | `notes.md` は末尾 N 行、ほかは先頭 N 行。N の既定は 20 |
| メモリ注入の上限 | 「文字数上限 4,000」(抜粋の注入総量) | セクション本文の全体を上限以内に収める。既定 4000。整理候補、`notes.md`(古い行から省く)、ほかのファイル(後ろから切る)の優先順位で残す。上限が切り詰めた旨の長さ以下なら旨を付けない。後ろから切った場合、見出しの行数表示は切り詰め前のまま |
| メモリ注入の順序 | 記述なし | 整理候補、`notes.md`、ほかのファイル(ファイル名昇順) |
| 整理候補 | 「ファイルごとの行数上限」(値の記述なし) | `*.md` が 200 行(既定)を超えたら件数つきで列挙 |
| 上限の設定 | 「既定 4,000」とだけ記述 | 3 つの上限を環境変数 `SPIRITS_MEMORY_*` で変更できる |
| `note` の保存ファイルと形式 | 記述なし | `memory/notes.md` に `- <ISO8601> <text>`。改行は半角スペースへ置換。既存ファイルが改行で終わらなければ行区切りを補う |
| ホスト関数とツールの案内 | 記述なし | `goal` / `note` の `HostFnEntry.description`(tsrepl のツール説明)に載せる |
| スキル保存の引数 | name + 本文 | `name` / `description` / `body` |
| スキルの説明の長さ | 記述なし | 1024 文字以下(Agent Skills の上限)。超えたら保存しない |
| スキル一覧・削除の詳細 | 記述なし | ディレクトリ名(symlink を含み、名前の規則に合わないものは除く)と `description`(読める記法だけ。Pi が文字列として読まないプレーンは空。Pi と異なる空でない文字列は返さない)を返す。存在しない削除はエラー。削除はディレクトリごと(symlink はリンクだけ) |
| `spirits_prompt_set` の入力 | 記述なし | `{ content }` 1 つ。空・空白のみは拒否 |
| 子への非注入 | 本フェーズで判断 | 「注入しない」を確定。`rlm` の生成経路と子ローダーは変更しない |
| 検証 | テスト計画の E2E #6 のみ | 純モジュール + fake pi のユニットテストを追加し、実機は interactive smoke で確認 |

## Risks / Trade-offs

- [Risk] メモリ注入でトークンが膨張する → Mitigation: セクション本文全体に上限(既定 4000 文字)を設け、抜粋は 20 行まで、整理候補の提示でエージェントに圧縮を促す。境界値(上限ちょうど、超過、`notes.md` の末尾、21 行目)をテストで固定する。
- [Risk] ツール名や既定値が複数のファイルで食い違う(案内文のツール名が実名とずれ、モデルが存在しないツールを呼ぶ) → Mitigation: 複数ファイルが参照する値は `src/constants.ts` の 1 か所に定義して補間し、ソース監査(tasks 7.3)で `SPIRITS_MEMORY_` と `spirits_skill_` / `spirits_prompt_` が `constants.ts` にしか現れないことを確認する。テストは外部契約をリテラルで固定する。
- [Risk] 環境変数の誤字や不正値が既定値へ黙って戻り、上限が効いていることに気づかない → Mitigation: 不正値は既定値にフォールバックすると README に明記し、変数名と既定値を載せる。テストで不正値のケースを固定する。
- [Risk] 切り詰めで `notes.md` の新しい note や整理候補が落ちる → Mitigation: 表示順を整理候補、`notes.md` の順にして優先して残し、`notes.md` は収まらなければ古い行から省く。極端に小さい上限(整理候補だけで超える場合、切り詰めた旨の長さ以下の場合など)では落ちる・旨が付かないことを許容し、README に上限の目安(切り詰めた旨の長さを超える値にすること)を載せる。`notes.md` だけで上限を超える場合に最新の note が残るテストを置く。
- [Risk] 手書きスキルの `description` が一覧で Pi と違う文字列になる、または一覧に出ない → Mitigation: 読める記法(ダブル・シングルクォート、コメント付きプレーン)は Pi と同じ文字列に、読めない記法(ブロックスカラー、継続行、Pi が文字列として読まないプレーン)は空にし、Pi と異なる空でない文字列を返さない。symlink は対象にし、規則外の名前は除く。それぞれのテストと、Pi の `parseFrontmatter` との差分テストを置く。
- [Risk] エージェントや利用者が `notes.md` を書き直して末尾の改行を落とし、次の `note` が最終行に連結する → Mitigation: 追記前に最後の 1 バイトを確認し、改行が無ければ行区切りを補う。改行で終わらないファイルへの追記の回帰テストを置く。
- [Risk] 1025 文字以上の説明のスキルを保存し、Pi が読み込みのたびに警告を出す → Mitigation: `description` を Agent Skills の上限(1024 文字)で検証し、超えたら保存しない。境界のテストを置く。
- [Risk] メモリ要約は総行数を示すため、エージェント開始ごとに `memory/` の各 `*.md` を全文読む。大きなファイルがあると開始が遅くなる → Mitigation: 整理候補(既定 200 行超)で縮小を促す。総行数の表示に全文の走査が要るため、先頭・末尾だけを読む最適化は行わない。必要になれば行数のキャッシュなどを別 change で検討する。
- [Risk] `PI_CODING_AGENT_DIR` が相対パスのとき、要約の見出しが相対パスになり、cwd が変わるとエージェントが読めない → Mitigation: `registerContinualHarness` が `agentDir` を絶対化する。相対パスを渡すテストを置く。
- [Risk] 切り詰めがサロゲートペアを割り、プロバイダが不正な JSON として拒否する → Mitigation: 切り口が上位サロゲートで終わる場合は 1 つ戻す。絵文字だけの行で上限を変えるテストを置く。
- [Risk] エージェントが `spirits_prompt_set` で自分のプロンプトを壊す → Mitigation: 変更前を `.bak` に必須保存し、README に復元手順(上書きファイルの削除または `.bak` のコピー)を記載する。置換範囲は `spirits` セクションだけで、Pi 既定のプロンプトと、`goal` / `note` の説明に載せたツールの案内は残る。
- [Risk] `before_agent_start` の API(可変 `systemPromptOptions.sections`)が上流で変わる → Mitigation: 使用面を `harness/install.ts` の 1 ハンドラに閉じ、型ミラーを同期する。interactive smoke で実機確認する。
- [Risk] スキル名の検証漏れで `skills/` の外に書き込む・削除する → Mitigation: 名前を正規表現と長さで検証し、`../` などを拒否するテストを保存と削除の両方に置く。
- [Risk] `description` の特殊文字で `SKILL.md` の YAML が壊れ、Pi が読み込まない → Mitigation: JSON 文字列で書き出し、Pi の `parseFrontmatter` による往復のテストと実機(`/reload` 後に Pi がスキルを認識すること)で確認する。
- [Risk] `prompts/` 直下に置いたファイルがプロンプトテンプレートとして読み込まれる → Mitigation: 上書きは `prompts/spirits/` に置き、interactive smoke で `/` コマンドに現れないことを確認する。
- [Risk] `getAgentDir()` の実行時 import がテストやソース起動で解決できない → Mitigation: `src/harness/tsconfig.json` を M3 と同じ方式で置き、純モジュールのテストは import しない構成にする。
- [Risk] 複数セッションが同時に `notes.md` へ追記して行が混ざる → Mitigation: 1 行を 1 回の追記書き込みにし、tsrepl は直列。同時実行は許容し、破損より欠落しないことを優先する(末尾の確認と書き込みの間に別プロセスが追記すると、行区切りが重なって空行が入り得るが、行は欠落しない)。
- [Risk] メモリ要約が更新されず古い情報を注入し続ける → Mitigation: `before_agent_start` ごとにファイルを読み直す。差分は Pi がセクション単位で追記する。
- [Risk] `goal()` が最初のユーザーメッセージを取り違える(分岐・圧縮後) → Mitigation: `getBranch()` の経路だけを走査し、`type: "message" && role: "user"` だけを対象にする。ほかのブランチの設定を返さないテストとテキスト抽出のテストを置く。
- [Risk] スキル保存後に Pi が読み込むタイミングが分かりにくい → Mitigation: 変更は次セッションまたは `/reload` から有効になる旨を、保存ツールの結果、`note` の説明、README に含める。E2E で別セッションからの利用を確認する。

## Migration Plan

- 上書きファイルが無い既存セッションはビルトイン既定のまま。`spirits_memory` / `spirits_goal` は標準のカスタムエントリで、JSONL 形式は変わらない。環境変数が未設定なら、上限は既定値で動く。
- ロールバックは `src/harness/` の削除、`src/index.ts` の配線戻し、`src/constants.ts` と `src/config.ts` と型ミラーの revert、M3 のテスト(`rlm-hostfn.test.ts`)の追加分の revert、README と設計書の差分戻しで完了する。エージェントディレクトリに作られたメモリ・スキル・上書きは残っても既存動作に影響しない。

## Open Questions

なし。
