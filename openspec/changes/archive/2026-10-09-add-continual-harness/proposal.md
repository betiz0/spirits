# Proposal

## Why

spirits の設計目標 3「プロンプト / スキル / メモリをエージェント自身が更新できる Continual Harness 相当の自己改善機構」が未実装のままだ。M1 の `tsrepl` と M3 の `rlm` で実行面は揃ったが、セッションを跨いだ知識の蓄積、スキルの再利用、code-mode プロンプトの自己改変ができない。M5(Phase 2)は `rlm` の使用実感に基づく判断ゲートであり、その判断材料と継続改善の基盤を M4 で先に用意する。

## What Changes

- `note(text)` をホスト関数として登録する。`text` 内の改行は半角スペースに置き換えて 1 行にし、`- <ISO8601> <text>` の形でエージェントディレクトリ(既定 `~/.spirits/agent`)配下の `memory/notes.md` へ追記する。あわせて `spirits_memory` カスタムエントリ(`appendEntry`)をセッションへ残す。`text` が文字列でない、または空白のみの場合は、何も書かずに例外にする。追記先は存在しなければ作成する。追記先が改行で終わっていない場合(手での編集やエージェントの `write` で末尾の改行が無い場合)は行区切りを補い、追記する行を既存の最終行と連結させない。戻り値は追記先パスを含む確認文字列とする。
- `goal()` / `goal(text)` をホスト関数として登録する。`goal()` は現在のブランチ上のゴールを返す。明示設定(`spirits_goal` カスタムエントリ)がなければ、現在のブランチ上の最初のユーザーメッセージのテキストを既定ゴールとする(最初のメッセージにテキストが無い場合は、後続のメッセージに進まず空文字列)。`goal(text)` は `spirits_goal` エントリを追記して以降のゴールにする。引数付きの呼び出しは `goal(undefined)` を含めて設定として検証し、引数なしの `goal()` だけを取得として扱う。
- `before_agent_start` でメモリの要約をシステムプロンプトの `spirits_memory` セクションへ差し込む。`memory/` 直下の `*.md` を対象に、`notes.md`(追記型)は末尾 N 行、ほかのファイルは先頭 N 行を抜粋する(N の既定は 20)。セクション本文の全体を文字数上限(既定 4000)以内に収める。表示順は整理候補、`notes.md`、ほかのファイル(ファイル名昇順)とし、超える場合はこの順に優先して残す。`notes.md` は収まらなければ新しい行を残して古い行から省き(見出しの行数表示は実際に含めた行数)、ほかのファイルは後ろを切り詰める。後ろを切り詰めた場合、見出しの行数表示は切り詰める前の抜粋の行数のままになる。上限が切り詰めた旨の長さ以下なら、旨を付けず先頭から上限の長さだけを返す。行数上限(既定 200)を超えるファイルは「整理候補」として行数つきで示す。全文は注入せず、各ファイルの見出しに絶対パス(エージェントディレクトリが相対パスで指定されても絶対パス)と全文がそのファイルにある旨を添えて、エージェント自身の read に委ねる。
- 上記の 3 つの値(抜粋行数、文字数上限、整理候補の行数上限)は環境変数 `SPIRITS_MEMORY_PREVIEW_LINES` / `SPIRITS_MEMORY_CHAR_LIMIT` / `SPIRITS_MEMORY_LINE_LIMIT` で変更できる。正の整数でない値(先頭が 0、符号付き、前後に空白を含む値も含む)は既定値を使う。既定値と環境変数名は `src/constants.ts` の定数に置き、環境変数の読み込みと検証は新設の `src/config.ts` に集約する。
- code-mode プロンプトをビルトイン既定として同梱し、`before_agent_start` で `spirits` セクションとしてシステムプロンプトへ追加する。内容は tsrepl 中心の運用、`rlm` の使いどころと深度上限、`note` / スキル保存の判断基準、Phase 1 のセル評価ルール(return/out、`use` の許可範囲)とする。
- `goal` / `note` の `HostFnEntry` の説明(tsrepl のツール説明に連結される)に、`goal()` / `goal(text)` / `note(text)` の呼び方と、スキル・プロンプトの codemode ツールの名前と引数、スキル変更の反映タイミング(次のセッションまたは `/reload`)を載せる。codemode ツールはモデルへ宣言されないため、この経路でしか名前が伝わらない。`spirits_prompt_set` で `spirits` セクションを上書きしても、この案内は残る。
- `spirits_skill_save` / `spirits_skill_list` / `spirits_skill_delete` を `exposure: "codemode"` で登録し、`tool()` 経由で呼べるようにする。保存先は `~/.spirits/agent/skills/<name>/SKILL.md`(Agent Skills 形式の frontmatter + 本文)。同名は上書きする。スキル名は `^[a-z0-9]+(-[a-z0-9]+)*$` かつ 64 文字以下に検証し、不正名は書き込まずにエラーにする。`description` は 1024 文字以下(Agent Skills の上限。超えると Pi が読み込みのたびに警告する)に検証し、改行や `: ` を含んでも Pi のスキルローダーが同じ文字列として読める形で書く。一覧はディレクトリ名(ディレクトリへの symlink を含む)と説明を返し、保存・削除と同じ識別子で扱えるように、名前の規則に合わないディレクトリは含めない。説明はダブルクォート・シングルクォート・プレーン(空白またはタブの後の `#` 以降のコメントを除く)を Pi と同じ文字列として返し、ブロックスカラーなど読めない記法は空文字列にする。Pi が文字列として読まないプレーン(`: ` を含む値、YAML の指示子で始まる値、真偽値・null・数値になる値など)も読めない記法として空文字列にし、Pi と異なる空でない文字列は返さない。symlink のスキルの削除はリンクだけを消す。
- `spirits_prompt_set` を codemode ツールとして登録する。現在の実効プロンプトを `~/.spirits/agent/prompts/spirits/code-mode.md.bak` へバックアップしてから、上書きファイル `~/.spirits/agent/prompts/spirits/code-mode.md` を書く。上書きファイルはプロンプトテンプレートとして自動探索されるディレクトリの直下ではないため、Pi のコマンド一覧には現れない。空または空白のみの内容は拒否する。
- 子セッションへの非注入を確定する。`rlm` の子は拡張・skill・プロンプトテンプレートを読み込まないため、メモリ要約と code-mode セクションは注入されず、`goal` / `note` も公開されない。子へ必要な情報は親が prompt に織り込む(この導線を code-mode プロンプトに含める)。
- `src/index.ts` の配線を、ホスト関数 `[rlm, goal, note]`、`before_agent_start` ハンドラ、codemode ツール群の登録へ拡張する。`docs/spirits-m4-harness.md` と `docs/spirits-design.md`(§4.4、§9)へ確定事項を反映し、`packages/spirits/README.md` に使い方と復元手順を追記する。

非目標(`docs/spirits-m4-harness.md` §3): スキルの自動品質評価・A/B 検証、`rlm` の非同期化(M5)、子セッションへのメモリ注入オプション(将来ニーズが出た場合に別 change)、メモリファイルの自動削除。

## Capabilities

### New Capabilities

- `continual-harness`: エージェントがセッションを跨いで知識を蓄積し、スキルと code-mode プロンプトを更新できる自己改善機構。次を、外部から観測できる振る舞いとして規定する。
  - `note(text)` によるメモリ追記(検証、改行の正規化、タイムスタンプ、保存先、`spirits_memory` エントリ)
  - 起動時のメモリ要約注入(対象ファイル、`notes.md` の末尾抜粋、セクション全体の文字数上限と切り詰め、表示順、整理候補の通知、非注入のケース)
  - メモリ上限(抜粋行数、文字数上限、整理候補の行数上限)の環境変数による設定
  - `goal()` / `goal(text)` によるゴールの取得と明示設定(現在のブランチ上の解決、最初のユーザーメッセージへのフォールバック)
  - スキル CRUD(codemode ツール、保存形式、description の安全な書き出しと長さ上限、ディレクトリ名による一覧、削除、名前検証と書き込み先の封じ込め)
  - `goal` / `note` の説明によるホスト関数とツールの案内
  - code-mode プロンプトの適用と `spirits_prompt_set` による上書き・バックアップ
  - 子セッションへの非注入ポリシー
  - M5 の Phase 2 機能および `rlm` 公開 API への非依存

### Modified Capabilities

なし。`rlm` の「子セッションへ memory / skill を自動配線してはならない」と「後段フェーズ機能への非依存」はすでに本 change のポリシーと一致しており、要件を変更しない。`tsrepl` の REPL コアと `tools.ts` の登録口も変更しない。

## Impact

- 新規ファイル: `packages/spirits/src/config.ts`(環境変数の読み込み)、`packages/spirits/src/harness/{paths,memory,goal,skills,prompt,guidance,tools,install}.ts`、`packages/spirits/src/harness/tsconfig.json`、`packages/spirits/test/config.test.ts`、`packages/spirits/test/harness-*.test.ts`、YAML の往復を Pi の `parseFrontmatter` で検証する `packages/spirits/test/pi-runtime/`(実行時に Pi を解決するための `tsconfig.json` を持つ)。
- 変更ファイル: `packages/spirits/src/index.ts`(配線)、`packages/spirits/src/constants.ts`(メモリ上限の既定値、環境変数名、`notes.md` のファイル名、スキル名の規則、スキルの説明の長さ上限、codemode ツール名)、`packages/spirits/src/types/pi-coding-agent.d.ts`(`pi.on("before_agent_start")`、`ExtensionContext.sessionManager` と `getBranch()`、セッションエントリ、`registerTool` の使用面、テストが使う `parseFrontmatter`)、`packages/spirits/test/rlm-hostfn.test.ts`(子のホスト関数に `goal` / `note` が無いことの確認を追加)、`packages/spirits/test/support.ts`(テスト用のツールコンテキストに `sessionManager` を追加)、`packages/spirits/README.md`、`docs/spirits-m4-harness.md`、`docs/spirits-design.md`。
- **Pi 上流コアへの差分: なし。** `before_agent_start` のセクション変更、`appendEntry`、`registerTool` の `codemode` exposure、`getAgentDir` はすべて公開 API。`[spirits]` のコア変更コミットは不要。`packages/coding-agent` / `packages/ai` / `packages/agent` / `packages/tui` は変更しない。
- 依存追加: なし。すべて Bun / Node の標準機能と既存の `typebox` で実装する。
- データ: エージェントディレクトリ(既定 `~/.spirits/agent`)配下の `memory/`(Markdown)、`skills/<name>/SKILL.md`、`prompts/spirits/code-mode.md` とその `.bak` を新設する。セッション JSONL に `spirits_memory` / `spirits_goal` カスタムエントリが増える(いずれも LLM コンテキストへは送らない)。
- 設定: 環境変数 `SPIRITS_MEMORY_PREVIEW_LINES` / `SPIRITS_MEMORY_CHAR_LIMIT` / `SPIRITS_MEMORY_LINE_LIMIT` を新設する(未設定なら既定値)。
- ドキュメント: `README.md` にメモリ・goal・スキル・プロンプト上書きの使い方、環境変数と既定値、バックアップからの復元手順を記載する。`docs/spirits-m4-harness.md` の決定事項(注入方式、上限値、保存パス)と `docs/spirits-design.md` §4.4・§9 を確定内容に合わせて更新する。
