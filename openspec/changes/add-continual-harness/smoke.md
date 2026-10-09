# M4 Continual Harness Interactive Smoke

- 実施日: 2026-10-09 (JST)
- 対象 commit: `d73567f10` + working tree(未コミットの `add-continual-harness` 変更。`packages/spirits/src/harness/`、`src/config.ts`、型ミラー、テスト、README、`docs/spirits-m4-harness.md`、`docs/spirits-design.md`)
- ソース: `bun packages/spirits/bin/spirits.ts`
- バイナリ: `bun scripts/build-binaries.ts --version 0.0.0` で生成した `dist/spirits-linux-x64`(`sha256sum -c` 成功、`--version` は `spirits 0.0.0 (Bun 1.4.2)`)

## 実行環境

隔離した HOME で実行し、既定パス解決も同時に確認した(実ユーザの `~/.spirits/agent` と `~/.pi` は変更していない)。

- ソース: `HOME=/tmp/spirits-m4-smoke/home`、`~/.spirits/agent` は `$HOME/.spirits/agent`。`models.json` のみコピーし、認証は環境変数(OpenRouter)を使用
- バイナリ: `HOME=/tmp/spirits-m4-smoke/bin-home`(同様)
- tmux 上で対話起動。プロンプトは tsrepl のセル実行を明示し、結果はセッション JSONL と実ファイルの両方で確認した

実行した主なコマンド:

```sh
# ソース
HOME=/tmp/spirits-m4-smoke/home bun packages/spirits/bin/spirits.ts

# バイナリ
bun scripts/build-binaries.ts --version 0.0.0
HOME=/tmp/spirits-m4-smoke/bin-home dist/spirits-linux-x64
```

## 結果

### (1) note の追記と次回からの要約注入 — 成功

- セル `return await note("smoke-m4 note marker")` の戻り値は `メモリに追記しました: /tmp/spirits-m4-smoke/home/.spirits/agent/memory/notes.md`
- `~/.spirits/agent/memory/notes.md` に `- 2026-10-09T07:25:28.953Z smoke-m4 note marker` の 1 行が追加された
- 次のプロンプトのセッション JSONL で、system メッセージの `sections` に `spirits_memory` が現れ、マーカーと `notes.md` の絶対パスを含んでいた

```
<spirits_memory>
## メモリ（抜粋）: 全文は各ファイルのパスを read で読んでください。
### /tmp/spirits-m4-smoke/home/.spirits/agent/memory/notes.md（末尾 1 行 / 全 1 行、全文はこのファイルを read で読む）
- 2026-10-09T07:25:28.953Z smoke-m4 note marker
</spirits_memory>
```

### (2) goal の取得・設定・ブランチ分離 — 成功

- `goal()` はセッション最初のユーザーメッセージ(`Use the tsrepl tool to run this cell: ...`)を返した
- `await goal("smoke goal"); return goal()` は `smoke goal` を返した
- `/tree` で最初のユーザーメッセージを選び、`branch-b goal isolation check` に編集して別ブランチを作成。そのブランチで `return goal()` を実行したところ `branch-b goal isolation check` が返り、`smoke goal` は返らなかった
- セッション JSONL に `spirits_goal` カスタムエントリが記録され、user メッセージ列には現れなかった

### (3) スキル保存(案内経由)と反映 — 成功

- 「この手順をスキル化して」の依頼に対し、tsrepl のツール説明の案内から `await tool("spirits_skill_save", ...)` を実行した
- `~/.spirits/agent/skills/smoke-check/SKILL.md` が作成され、frontmatter の `name` と `description`、本文が保存された
- `/reload` 後、`/skill:smoke` の補完に `smoke-check` と `smoke-special` が表示された

補足: 最初の smoke ではモデルが `tool(...)` を await せず、セル終了時の abort で保存がキャンセルされた。再現性のため `goal` / `note` の案内と code-mode プロンプトの codemode ツール呼び出しを `await tool(name, args)` に修正した(`src/harness/guidance.ts`、`src/harness/prompt.ts`)。

### (4) 特殊文字を含む説明のスキルと `/reload` — 成功

- `description: "step: one\nstep: two"` を含む `smoke-special` を保存
- `/reload` は `Reloaded ... skills ...` と成功し、警告は画面に出なかった
- `/skill:smoke` の補完で `smoke-special [u] step: one step: two` が表示され、Pi が JSON 文字列を復号して同じ説明として読めた

### (5) code-mode プロンプト上書きと `.bak` — 成功

- `await tool("spirits_prompt_set", { content: "## smoke prompt override" })` の後、`prompts/spirits/code-mode.md` は `## smoke prompt override`
- `code-mode.md.bak` には変更前の既定プロンプト(`## spirits code-mode` で始まる全文)が残っていた
- 次のプロンプトの system セクションで `spirits` が `## smoke prompt override` になった
- `/` のコマンド一覧を `code-mode` で絞り込むと候補は空で、プロンプトテンプレートとして現れなかった

### (6) 整理候補 — 成功

- `memory/big.md` に 201 行を置いて次のプロンプトを実行すると、`spirits_memory` に `### 整理候補（行数上限を超えたファイル）` と `- big.md（201 行）` が入った
- `big.md` は変更されず 201 行のまま

### (7) `SPIRITS_MEMORY_CHAR_LIMIT=500` — 成功

- `SPIRITS_MEMORY_CHAR_LIMIT=500` で別セッションを起動し、要約を含む `spirits_memory` セクションの内側(タグを除く)の長さは 500 で、末尾に切り詰めた旨が含まれていた

### (8) 子セッションへの非注入 — 成功

- `await rlm("... return [typeof goal, typeof note].join(\",\") ...")` の戻り値は `undefined,undefined`
- 子のリソース構成(`noExtensions` / `noSkills` / `noPromptTemplates`)は M3 のままで、メモリ要約の注入経路がない(`test/rlm-spawn.test.ts` の "resource loader options" で固定)

### (9) `notes.md` は最新を残して古い行を省く — 成功

- 各 300 文字の `note-01`〜`note-20` を追記した 21 行(既存 1 行)の `notes.md` で、要約本文の長さは 3895
- `note-20` は含まれ、`note-01` は含まれなかった。見出しは `末尾 12 行 / 全 21 行` で、本文に含まれる note 行も 12 行(先頭 `note-09`、末尾 `note-20`)と一致した
- 同じ要約に整理候補(`big.md（201 行）`)も残っていた

### (10) 既定パスの確認(ソース / バイナリ) — 成功

- ソース: メモリは `/tmp/spirits-m4-smoke/home/.spirits/agent/memory/notes.md`、スキルは同 `skills/`、上書きは同 `prompts/spirits/` に作成された。`/tmp/spirits-m4-smoke/home/.pi` は作成されなかった
- バイナリ: `HOME=/tmp/spirits-m4-smoke/bin-home` で `note` と `spirits_skill_save` を実行し、`memory/notes.md` と `skills/binary-smoke-skill/SKILL.md` が `$HOME/.spirits/agent` 配下に作成された。`$HOME/.pi` は作成されず、次のプロンプトの `spirits_memory` に追記内容が反映された

## 未確認・制約

- なし(10 項目すべて成功)。

---

## Deep verify(2 回目)対応後の再実施 — 2026-10-09 (JST)

- 対象 commit: `d73567f10` + working tree(未コミット。深い検証(2 回目)の指摘を反映した後の再実施)
- 起動: ソースのみ。`HOME=/tmp/spirits-m4-smoke-rerun/home bun packages/spirits/bin/spirits.ts --provider openrouter --model moonshotai/kimi-k2.6 --thinking medium`(隔離 HOME、認証は環境変数 `OPENROUTER_API_KEY`)
- 実行方法: tmux 上で対話起動し、セル実行は「Use the tsrepl tool to run this cell ...」のプロンプト経由。`/reload` と `/skill:` の補完で反映を確認
- 再実施項目: (1)(3)(4)(11)(12)。コード変更の影響を受けない (2)(5)〜(10) は前回(上記)の結果を引き継ぐ
- 前回の記録からの差分: セッション JSONL のメッセージ列に `spirits_memory` の内容が含まれないことの確認を (1) に追加

### (1) note の追記と次回からの要約注入 — 成功(再)

- セル `return await note("rerun note marker")` の戻り値は `メモリに追記しました: /tmp/spirits-m4-smoke-rerun/home/.spirits/agent/memory/notes.md`
- 次のプロンプトの system セクション `spirits_memory` が `末尾 2 行 / 全 2 行` となり、`prior note` と `- 2026-10-09T08:57:44.344Z rerun note marker` の 2 行を含んだ
- セッション JSONL では `spirits_memory` は `type: "custom"` の 1 エントリとしてのみ現れる。`type: "message"` のエントリに `customType` も custom entry の data も含まれない(要約は system メッセージの `sections` にだけ現れる。これは意図した注入)

### (11) 改行で終わらない notes.md への追記 — 成功(新規)

- 起動前に `printf 'prior note' > ~/.spirits/agent/memory/notes.md`(末尾改行なし)を置いた
- セル `await note("rerun note marker")` の後、`notes.md` は `prior note`、`- 2026-10-09T08:57:44.344Z rerun note marker`、空文字列の 3 要素(`split("\n")`)になり、既存行と連結しなかった
- 次のプロンプトの `spirits_memory` に 2 行として現れた(上記 (1) と同じ証跡)

### (3) スキル化依頼と反映 — 成功(再)

- 「この手順をスキル化して: rerun smoke は bun test を実行して結果を確認する。スキル名は rerun-check にして。」に対し、tsrepl のツール説明の案内から `await tool("spirits_skill_save", ...)` を実行し、`skills/rerun-check/SKILL.md` を作成した
- `/reload` は `Reloaded keybindings, extensions, skills, prompts, themes, and context files` で成功し、警告は出なかった
- `/skill:rerun` の補完に `skill:rerun-check  [u] rerun smoke は bun test を実行して結果を確認する` が現れた

### (4) 特殊文字を含む説明のスキルと `/reload` — 成功(再)

- セルで `description: "step: one\nstep: two"`(改行と `: ` を含む)の `rerun-special` を保存した。`SKILL.md` の frontmatter は `description: "step: one\nstep: two"` の 1 行(JSON 文字列)
- `/reload` は成功し、警告は出なかった。`/skill:rerun-special` の補完は `[u] step: one step: two` となり、Pi が同じ説明として読めた

### (12) description の長さ上限 — 成功(新規)

- 1025 文字: セル `const long = "d".repeat(1025); try { await tool("spirits_skill_save", ...) ... } catch { return "rejected"; }` は `rejected` を返し、`skills/rerun-over` は作成されなかった
- 1024 文字: セル `const long = "d".repeat(1024); return await tool("spirits_skill_save", { name: "rerun-max", description: long, body: "b" })` は保存に成功した(`description` 行の JSON 復号後の長さは 1024)
- `/reload` は警告なしで成功し、`/skill:rerun-max` の補完が現れた

### 再実施の制約

- バイナリ起動と (2)(5)〜(10) は前回の結果を引き継ぐ(今回の変更は `description` の長さ検証、プレーンの読み取り、`note` の行区切り、テストのみで、それらの項目の経路を変更しない)

