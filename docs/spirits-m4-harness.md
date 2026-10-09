# spirits M4 設計書: Continual Harness

- フェーズ: M4 / 版 v1.1 / 2026-10-09
- 前提文書: spirits 設計書 v0.4(§4.4)、M1・M3 設計書
- v1.1 で `openspec/changes/add-continual-harness` の確定内容を反映した(変更点は §8)

## 1. 目的

エージェントが自分の振る舞い(プロンプト・スキル・メモリ)を更新できる自己改善機構を add し、Prime Agent の Continual Harness 相当を成立させる。

## 2. 依存関係ルール

**許可:**

- M1 HostFnRegistry(`goal`/`note` の登録)、codemode の `tool()` 経路
- M3 rlm(): memory 注入を子セッションへ波及させるかの判断は本フェーズのスコープ
- Pi のスキル機構・プロンプトテンプレート・`appendEntry`・`before_agent_start` 等のイベント

**禁止:**

- M5 のパーサ/非同期 fan-out の存在を前提にしない
- rlm()(M3)の公開 API 変更を伴う設計にしない(memory 注入の採否は子セッション生成オプションではなく、注入層の追加で実現する)

## 3. スコープ

やる:

- `src/harness/memory.ts`: セッション横断メモリ(追記・起動時注入)
- `src/harness/skills.ts`: スキル CRUD(codemode 公開ツール)
- `src/harness/prompt.ts` / `src/harness/tools.ts`: code-mode プロンプトと codemode ツール
- `goal()` / `note(text)` ホスト関数の Registry 登録
- 子セッションへの memory 注入ポリシー決定と実装

やらない:

- スキルの自動品質評価・A/B 検証(将来検討)
- rlm 非同期化(M5)
- 子セッションへのメモリ注入オプション(将来ニーズが出た場合に別 change)

## 4. 設計

### memory.ts

- 保存先: `~/.spirits/agent/memory/` 配下の Markdown 群 + セッション JSONL への `spirits_memory` カスタムエントリ(`appendEntry`)
- `note(text)`: `memory/notes.md` へ `- <ISO8601> <text>` の 1 行を追記し、セッションエントリにも記録する。`text` 内の改行(`\r\n` / `\r` / `\n`)は半角スペース 1 つへ正規化する。追記先が改行で終わらない場合は行区切りを補い、新しい行として追記する。文字列でない、または空白のみの入力はファイルもエントリも書かずにエラー
- 起動時注入: エージェント開始ごと(プロンプトごと)に `before_agent_start` で `systemPromptOptions.sections` に `spirits_memory` を追加する(forceSystemPrompt は使わない)。`memory/` 直下の `*.md` について、整理候補、`notes.md`(末尾の抜粋)、ほかのファイル(ファイル名昇順、先頭の抜粋)の順に要約を組む。全文注入はしない(トークン膨張防止。残りはエージェントが read で見に行く)。`agentDir` は配線時に `path.resolve` で絶対化する(`PI_CODING_AGENT_DIR` が相対パスでも、見出しのパス・`note` の戻り値・`spirits_memory` エントリの `file` は絶対パスになる)
- 抜粋は 1 ファイル N 行(既定 20)。`notes.md` は追記型なので末尾から取る
- セクション本文の全体を文字数上限(既定 4000)以内に収める。超える場合は、見出し、整理候補、`notes.md`、ほかのファイルの順に優先して残す。`notes.md` は新しい行を残して古い行から省き、見出しの行数表示を実際に含めた行数へ更新する。ほかのファイルは後ろ側を切り詰め、最後に切り詰めた旨を付ける。後ろ側を切り詰めた場合、見出しの行数表示は切り詰める前の抜粋の行数のままになる(見出し自体が途中で切れる場合もある)。上限が切り詰めた旨の長さ以下なら旨を付けず、本文の先頭から上限の長さだけを返す(切り口はサロゲートペアを割らない)。各ファイルの見出しには絶対パス・抜粋位置・総行数と、全文がそのファイルにある旨を含める
- メモリの肥大化対策: 行数上限(既定 200)を超えたファイルを「整理候補」として名前と行数つきで示す。自動削除はしない
- 上限は環境変数 `SPIRITS_MEMORY_PREVIEW_LINES` / `SPIRITS_MEMORY_CHAR_LIMIT` / `SPIRITS_MEMORY_LINE_LIMIT` で変更できる。正の整数でない値は既定値へ戻る

### skills.ts(codemode ツール群)

以下を `exposure: "codemode"` で登録し、REPL から `tool("spirits_skill_save", {...})` 等で呼ぶ:

| ツール | 引数 | 動作 |
|---|---|---|
| `spirits_skill_save` | `{ name, description, body }` | `~/.spirits/agent/skills/<name>/SKILL.md` へ保存。同名は上書き |
| `spirits_skill_list` | `{}` | ディレクトリ名と frontmatter の `description` を返す |
| `spirits_skill_delete` | `{ name }` | 指定名のディレクトリを削除。存在しなければエラー |
| `spirits_prompt_set` | `{ content }` | code-mode プロンプトを上書き。変更前をバックアップへ保存 |

- スキル名は `^[a-z0-9]+(-[a-z0-9]+)*$` かつ 64 文字以下に検証し、不正名はファイルシステムを変更しない
- `description` は JSON 文字列として frontmatter へ書き、改行・`: `・`#`・引用符を含んでも Pi が同じ文字列として読めるようにする。1024 文字以下に検証し、超える場合は保存せずエラーにする
- `spirits_skill_list` は `skills/` 直下で `SKILL.md` を持つディレクトリ(ディレクトリへの symlink を含む)を、名前の規則に合うものだけ返す。`description` はダブルクォート(JSON)・シングルクォート(`''` は `'`)・コメント付きプレーンを Pi と同じ文字列として読み、ブロックスカラー(`>` / `|`)や継続行は空文字列にする(エラーにしない)。Pi が文字列として読まないプレーン(`: ` を含む値、真偽値・null・数値など)も空文字列にする(コメントは空白またはタブの後の `#` から始まる)。削除はディレクトリごと行い、symlink はリンクだけを消す
- 変更履歴は git 管理を推奨案内し、単一世代のバックアップだけを残す

### goal()

- `goal()` は現在のブランチ(`getBranch()`)上の最新の `spirits_goal` カスタムエントリを返す。無ければそのブランチの最初のユーザーメッセージ、どちらも無ければ空文字列
- `goal(text)` は `spirits_goal` カスタムエントリを追記して `text` を返す。`goal(undefined)` は引数付きの設定として検証し、エラーにする(引数なしの `goal()` だけが取得)。最初のユーザーメッセージにテキストが無い(画像のみなど)場合は、後続のメッセージへ進まず空文字列を返す
- 保持はセッションエントリで、別ブランチの設定は返らない。`spirits_goal` は LLM コンテキストへ送られない

### code-mode システムプロンプト

- 既定は `src/harness/prompt.ts` の TS 定数としてバイナリに同梱する(repo の `prompts/spirits/` は作らない)
- `before_agent_start` で `systemPromptOptions.sections` に `spirits` を追加する(forceSystemPrompt は使わず、Pi 既定のプロンプト・ツール一覧を保つ)
- 上書きは `<agentDir>/prompts/spirits/code-mode.md`。`prompts/` の直下を避けてテンプレート探索と衝突させない
- 骨格:
  1. tsrepl 中心で動くこと(ファイル操作・検索も極力セル内コードで)
  2. rlm の使いどころと深度上限の存在(数値は書かず、値は tsrepl のツール説明の `rlm` の項を参照させる)
  3. note / スキル保存の基準(「次のセッションでも役立つ事実か」で判断)と、子へ渡す情報は prompt に含めること
  4. Phase 1 のセル評価ルール(return / out、use の許可範囲)
- codemode ツールはモデルへ宣言されないため、名前と引数は `goal` / `note` の `HostFnEntry.description`(tsrepl のツール説明に連結)で案内する(`await tool(name, args)` での呼び出しを必須とする)。`spirits` セクションを上書きしてもこの案内は残る

### 子セッションへの memory 注入ポリシー(本フェーズで決定)

既定: **注入しない**。実装は「harness を rlm の生成経路から参照しない」ことで満たし、`spawn.ts` のリソース構成(`noExtensions` / `noSkills` / `noPromptTemplates`)を変更しない。子へ与える情報は親が prompt に織り込む。理由: 子への無差別注入はトークンと文脈汚染を招く。将来ニーズが出たらオプション化を検討。

## 5. テスト計画

| # | ケース | 期待 |
|---|---|---|
| 1 | `note("x")` 後に別セッション起動 | 要約が `spirits_memory` セクションへ注入される |
| 2 | skill 保存 → 一覧 → 削除 | CRUD が一貫して動く |
| 3 | メモリファイル上限超過 | 起動時注入文に整理候補表示 |
| 4 | `goal()` / `goal(text)` | 初回ユーザ指示と明示設定が返る。別ブランチの設定は返らない |
| 5 | 子セッションから memory 参照 | 注入されていないこと(ポリシー確認) |
| 6 | E2E(手動): エージェントに「この手順をスキル化して」と依頼 | save → 別セッションで skill が使える |
| 7 | `spirits_prompt_set` → 次回起動 | `sections` の `spirits` が上書き内容になり、`.bak` に旧内容が残る |
| 8 | メモリ上限の環境変数 | 不正値は既定値、正の整数は反映 |

単体テストは `agentDir` / `now` / `env` を注入した純モジュールと fake `pi` / fake セッションで行い、実機は interactive smoke(セクション差分、`/reload` 後のスキル認識、`/` コマンドに `code-mode` が現れないこと)で確認する。

## 6. 完了条件

- セッション横断メモリとスキル CRUD が code-mode プロンプトと一体で機能
- E2E テスト(#6)を通過

## 7. リスク

- **自己改変プロンプトの破壊**: `spirits_prompt_set` でエージェントが自分のプロンプトを壊し得る → `code-mode.md.bak` への必須バックアップ + 復元手順を README に必置
- **memory 注入によるトークン膨張**: 注入は要約限定とし、セクション本文の全体に文字数上限(既定 4000)を設定する。整理候補(既定 200 行超)で圧縮を促す
- **description の特殊文字でスキルの YAML が壊れる**: JSON 文字列として書き出し、往復テストと `/reload` 後の実機認識で確認する

## 8. v1.0 からの変更点

| 項目 | v1.0 | v1.1(確定) |
|---|---|---|
| プロンプト適用 | `before_agent_start` の forceSystemPrompt 相当 | `systemPromptOptions.sections` に `spirits` / `spirits_memory` を追加(全置換しない) |
| 既定プロンプトの置き場所 | repo `prompts/spirits/` | `src/harness/prompt.ts` の TS 定数(バイナリ同梱) |
| プロンプト上書き先 | 記述なし | `<agentDir>/prompts/spirits/code-mode.md`(+ `.bak`) |
| `goal()` | 取得のみ | 現在のブランチで解決し、`goal(text)` による明示設定を追加 |
| メモリ注入の抜粋 | 各ファイル先頭 | `notes.md` は末尾、ほかは先頭。既定 20 行 |
| メモリ注入の上限 | 文字数上限 4,000(抜粋の総量) | セクション本文の全体を 4000 以内に収める(優先順位は次行) |
| メモリ注入の順序 | 記述なし | 整理候補、`notes.md`、ほかのファイル(ファイル名昇順) |
| 整理候補 | 行数上限の値は記述なし | 既定 200 行超をファイル名と行数つきで列挙 |
| 上限の設定 | 「既定 4,000」とだけ記述 | 3 つの上限を `SPIRITS_MEMORY_*` 環境変数で変更できる |
| `note` の保存ファイルと形式 | 記述なし | `memory/notes.md` に `- <ISO8601> <text>`。改行は半角スペースへ置換 |
| メモリ切り詰めの優先順位 | 後ろから一律に切り詰め | 見出し、整理候補、`notes.md`(古い行から省く)、ほかのファイルの順。上限が切り詰めた旨の長さ以下なら旨を付けず先頭から切る |
| `goal()` の引数 | `text?` で取得と設定 | 引数の個数で分け、`goal(undefined)` は拒否。最初のユーザーメッセージにテキストが無ければ後続へ進まず空文字列 |
| スキル一覧の読み取り | 記述なし | 読める記法は Pi と同じ文字列、ブロックスカラーや継続行は空。symlink を含み、名前の規則に合わないディレクトリは除外 |
| `agentDir` の絶対化 | 記述なし | 配線時に `path.resolve` し、相対指定でもパスは絶対で示す |
| ホスト関数とツールの案内 | 記述なし | `goal` / `note` の `HostFnEntry.description` に載せる |
| スキル保存の引数 | name + 本文 | `name` / `description` / `body` |
| 子への非注入 | 本フェーズで判断 | 「注入しない」を確定。rlm の生成経路と子ローダーは変更しない |
