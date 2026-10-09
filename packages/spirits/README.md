# spirits

Pi の拡張として動作する spirits のパッケージ。M1 では永続 TypeScript REPL ツール `tsrepl` を提供する。

`packages/spirits` はルートの npm workspace から除外した自己完結の Bun パッケージ。ルートの npm / vitest / CI の対象外で、`bun test` と `bun run check` で検証する。配布は Linux x86_64 向けの単一バイナリ + `scripts/install.sh`。

## インストール

Linux x86_64(glibc)向けの単一バイナリを GitHub Releases で配布する。タグは `spirits-v*`(例: `spirits-v0.1.0`)で、pi 本体の `v*` タグとは分離している。リポジトリが公開されている前提。

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
```

`install.sh` は `main` の版が配られる。スクリプトはリリース成果物の名前と checksum だけに依存し、SHA256 検証に失敗した場合は何も配置しない。

バージョンを指定する場合(タグ `spirits-v0.1.0` を使う):

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | VERSION=0.1.0 sh
```

`~/.spirits/bin/spirits` に配置される。root 権限は不要。`~/.spirits/bin` が `PATH` に無い場合、インストーラは追記行を表示する(`.bashrc` などの自動編集はしない):

```sh
export PATH="$HOME/.spirits/bin:$PATH"
```

## 手動ダウンロードと検証

pipe to sh を使いたくない場合:

```sh
VERSION=0.1.0
BASE="https://github.com/betiz0/spirits/releases/download/spirits-v${VERSION}"
curl -fsSL -o /tmp/spirits-linux-x64 "$BASE/spirits-linux-x64"
curl -fsSL -o /tmp/spirits-linux-x64.sha256 "$BASE/spirits-linux-x64.sha256"
(cd /tmp && sha256sum -c spirits-linux-x64.sha256)
mkdir -p ~/.spirits/bin
mv /tmp/spirits-linux-x64 ~/.spirits/bin/spirits
chmod 755 ~/.spirits/bin/spirits
```

## バージョン確認

```sh
spirits --version   # spirits 0.1.0 (Bun 1.4.2)
spirits -v          # 同じ出力
```

## 更新

`install.sh` をもう一度実行する。`spirits update` は pi の更新案内を表示するだけで、spirits の更新は行わない。

## アンインストール

削除に使うコマンドを案内する(ファイルは自動削除しない):

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh -s -- --uninstall
```

出力される `rm` コマンドでバイナリとデータディレクトリ `~/.spirits/agent/` を削除する。データディレクトリには設定・セッション・外部拡張が含まれるため、必要ならバックアップしてから削除する。`~/.spirits/bin` を `PATH` に追加した行は shell rc から手動で消す。

## 設定ディレクトリ

`~/.spirits/agent/` を使う(環境変数 `PI_CODING_AGENT_DIR` を設定している場合はそちらを優先)。セッション・認証・設定のほか、外部拡張は `~/.spirits/agent/extensions/` に置く。インストール先 `~/.spirits/bin/` とは別のディレクトリ。

## rlm(子エージェント呼び出し)

tsrepl のセルから `await rlm(prompt, opts?)` で子エージェントを同期的に起動できる。戻り値は子の最終アシスタントメッセージの文字列。

シグネチャ: `rlm(prompt: string, opts?: { maxDepth?: number }): Promise<string>`

- 深度: ルートを 0 とし、子とその子孫に適用される上限は既定 2。`opts.maxDepth` はルートからの絶対深度で、上限を引き下げる方向にのみ働く(継承値より大きい値は継承値へクランプされる)。深度が上限以上のセッションから呼ぶと、上限値を含む例外になる。ルートの上限 2 を変更する手段はない。
- ツール呼び出し上限: 1 回の `rlm` 呼び出しあたり、子のモデル発行ツール呼び出しは既定 50 回まで。51 回目で子を打ち切り、上限超過の旨と部分テキストを途中結果サマリとして返す。
- 直列化: 同じ REPL からの `rlm` は 1 つずつ実行される(`Promise.all` でも直列)。待ち時間は合計される。
- 中断: セルの timeout と呼び出し元の中断は子にも伝播する。セルの timeout は子の実行時間にも適用されるため、長い処理では `timeout` を大きく指定する(最大 120000ms)。
- 認証: 子の認証は親と同じエージェントディレクトリ(`PI_CODING_AGENT_DIR` 指定時はそちら)の認証情報・モデル定義と環境変数に限る。`--api-key` で与えた認証と、拡張が登録したプロバイダは子に継承されない。
- 子のリソース: 子は cwd を親と共有し、モデル(親に thinking level があればそれも)を継承する。子の有効ツールは `tsrepl` だけで、親の REPL 変数は見えない。拡張・skill・プロンプトテンプレートは読み込まず、AGENTS.md などのコンテキストファイルは読み込む。
- `rlm` の利用には親セッションのモデルが必要。未設定の場合、子は生成せず例外になる。

### rlm_usage エントリ

`rlm` の呼び出し 1 回につき 1 件、ルートセッションの JSONL へ `rlm_usage` カスタムエントリが記録される。

| フィールド | 内容 |
|---|---|
| `depth` | 子の深度(呼び出し側 + 1、1 以上)。ルートセッション自身は 0 |
| `sessionId` | 子セッションの識別子(子を生成しなかった場合は null) |
| `provider` / `modelId` | 親のモデル(未設定なら null) |
| `tokens` | input / output / cacheRead / cacheWrite / total |
| `cost` | 子のコスト |
| `durationMs` | 呼び出し開始から戻るまでの経過時間(直列化の待ち時間を含む) |
| `outcome` | `completed` / `aborted` / `budget` / `error` |

集計規約: 1 セッションの総コスト / トークンは「ルートセッション自身の usage + そのセッションの JSONL にある全 `rlm_usage`」とする。子はインメモリで自身の usage だけを含むため、二重計上は起きない。`rlm_usage` は LLM のコンテキストには送られない。

## Continual harness(メモリ / goal / スキル / code-mode プロンプト)

`tsrepl` のセルから、セッションを跨ぐメモリ、ゴール、スキル、code-mode プロンプトを操作できる。

### メモリ(`note`)

`await note(text)` で、タイムスタンプ付きの 1 行を `~/.spirits/agent/memory/notes.md` へ追記する。`text` 内の改行(`\r\n`、`\r`、`\n`)は半角スペース 1 つに正規化される。文字列でない、または空白のみの `text` はエラーになり、何も書かない。追記先が改行で終わらない場合(手での編集やエージェントの `write` など)は行区切りを補い、新しい行として追記する。成功した `note` は `spirits_memory` カスタムエントリとしてセッションにも記録される(LLM コンテキストには送られない)。

要約は、そのセッションの開始時ではなくエージェント開始ごと(プロンプトごと)に、`memory/` 直下の `*.md` を読み直してシステムプロンプトの `spirits_memory` セクションへ注入する。

- `notes.md` は末尾の 20 行、ほかのファイルは先頭の 20 行を抜粋する。
- 200 行を超えるファイルは「整理候補」としてファイル名と行数を示す(自動削除はしない)。
- 各ファイルの見出しに絶対パスと全文がそのファイルにある旨を含める。全文は注入せず、エージェントが read で読む。
- `memory/` が無い、または `*.md` が 1 つも無い場合はセクションを追加しない。

要約本文の全体は 4000 文字以内に収める。超える場合は、見出し、整理候補、`notes.md`、ほかのファイルの順に優先して残す。

- `notes.md` は新しい行を残して古い行から省き、見出しの行数表示を実際に含めた行数に更新する。
- ほかのファイルの抜粋は後ろ側を切り詰める。
- 切り詰めた場合は末尾に切り詰めた旨を付ける。上限が切り詰めた旨の長さ以下だと旨が付かず、先頭から上限の長さだけが残るため、`SPIRITS_MEMORY_CHAR_LIMIT` は切り詰めた旨より十分大きい値にする。

上限は環境変数で変更できる。正の整数でない値(空文字列、`abc`、`0`、`-1`、`1.5`、先頭が 0 の `05`、符号付きの `+5`、前後に空白を含む ` 5` など)は既定値に戻る。

| 環境変数 | 既定 | 内容 |
|---|---|---|
| `SPIRITS_MEMORY_PREVIEW_LINES` | 20 | 1 ファイルあたりの抜粋行数 |
| `SPIRITS_MEMORY_CHAR_LIMIT` | 4000 | `spirits_memory` セクション本文の文字数上限 |
| `SPIRITS_MEMORY_LINE_LIMIT` | 200 | 整理候補にする行数上限 |

### ゴール(`goal`)

`goal()` は現在のブランチのゴールを返す。明示設定が無ければ、そのブランチの最初のユーザーメッセージを返す。`goal(text)` はゴールを明示設定する。`goal(undefined)` は引数付きの設定として検証され、エラーになる。引数なしの `goal()` だけが取得になる。設定は `spirits_goal` カスタムエントリとしてセッションに残り、`/tree` などで別ブランチへ移るとそのブランチのゴールが返る。`spirits_goal` は LLM コンテキストには送られない。

### スキル CRUD

codemode ツールを `await tool(name, args)` 経由で呼ぶ(モデルへは宣言されない):

| ツール | 引数 | 動作 |
|---|---|---|
| `spirits_skill_save` | `{ name, description, body }` | `~/.spirits/agent/skills/<name>/SKILL.md` に保存(同名は上書き) |
| `spirits_skill_list` | `{}` | スキル名と説明の一覧 |
| `spirits_skill_delete` | `{ name }` | スキルのディレクトリを削除 |
| `spirits_prompt_set` | `{ content }` | code-mode プロンプトを上書き |

スキル名は `^[a-z0-9]+(-[a-z0-9]+)*$` かつ 64 文字以下。`description` は 1024 文字以下(超える場合は保存せずエラー)で、改行や `: ` を含んでも Pi が同じ文字列として読める形で書き出される。スキルの変更は次のセッションまたは `/reload` から有効になる。

`spirits_skill_list` の読み取りは Pi と同じ規則に従う。

- ダブルクォート(JSON 文字列)、シングルクォート(`''` は `'`)、行末コメント付きのプレーンは、Pi が読むのと同じ文字列を返す。
- ブロックスカラー(`>` / `|`)や継続行など読み取れない記法の `description` は空文字列を返し、エラーにしない。
- Pi が文字列として読まないプレーン(`: ` を含む値、真偽値・null・数値など)も空文字列を返す。コメントは空白またはタブの後の `#` から始まる。
- `skills/` 直下のディレクトリへの symlink は一覧に含み、削除はリンクだけを消す。
- 名前の規則に合わないディレクトリ(`My_Skill` など)は、保存・削除と同じ識別子で扱えないため一覧に出さない。

### code-mode プロンプトの上書き

`spirits_prompt_set({ content })` は、現在の実効プロンプトを `~/.spirits/agent/prompts/spirits/code-mode.md.bak` へ保存してから、`~/.spirits/agent/prompts/spirits/code-mode.md` を上書きする。上書きファイルはプロンプトテンプレート探索の対象外(`prompts/` の直下ではない)なので、`/` コマンドには現れない。空・空白のみの `content` は拒否する。

復元するには、上書きファイルを削除してビルトイン既定に戻すか、バックアップをコピーする:

```sh
rm ~/.spirits/agent/prompts/spirits/code-mode.md
# または
cp ~/.spirits/agent/prompts/spirits/code-mode.md.bak ~/.spirits/agent/prompts/spirits/code-mode.md
```

### 子セッションへは注入しない

`rlm` の子セッションには、メモリ要約・code-mode プロンプト・`goal` / `note` は自動で渡らない。子に必要な情報は親が `rlm` の prompt に含める。

## 単一バイナリの制約

- theme / assets / export-html / native prebuilds を同梱しない。テーマは system テーマへフォールバックし、HTML エクスポートなどの一部機能が劣化する。
- 実行ファイルはパッケージマネージャを内包しない。外部拡張が独自の node_modules 依存を必要とする場合、依存解決には別途 Bun が必要。依存不足の外部拡張があると、起動時に拡張パス付きのエラーを stderr に出して非ゼロで終了する。
- 対象は Linux x86_64(glibc)のみ。macOS / Windows / musl(Alpine)は対象外。
- 自動アップデートと `spirits update` コマンドは未対応。

## 開発

### 必要なもの

- Bun >= 1.4.0(推奨 1.4.2。未コンパイル起動時のみバージョンゲートが働く)
- pi をソースから起動する場合のみ、リポジトリルートで `npm ci --ignore-scripts`
- rlm のテスト(`src/rlm/spawn.ts` を import するテスト)は pi ソースを読み込むため、リポジトリルートの依存導入も必要

### セットアップ

```sh
# リポジトリルート(pi をソースから動かす場合)
npm ci --ignore-scripts

# このパッケージ
cd packages/spirits
bun install --frozen-lockfile
```

### 開発時の起動

リポジトリルートから、spirits 拡張を組み込みでロードした pi を起動する:

```sh
bun packages/spirits/bin/spirits.ts
```

pi をソースから起動して tsrepl だけを読み込む M1 の形も使える:

```sh
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

### 検証

```sh
cd packages/spirits
bun test          # 全テスト
bun run check     # tsc --noEmit(pi の型は src/types/pi-coding-agent.d.ts のミラーで解決)
```

リポジトリルートからのインストーラ検証:

```sh
sh -n scripts/install.sh
sh scripts/install.test.sh
bun scripts/build-binaries.ts --version 0.0.0
```

### 開発時ログ

`SPIRITS_DEV=1` で、各セルの description・実行時間・結果種別を stderr に出す:

```sh
SPIRITS_DEV=1 bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

### 既知の制約

- `await` の後に始まる同期ループは中断できない。timeout も効かず、プロセス全体が応答しなくなる。`reset` では回復できず、プロセスの再起動が必要。
- 実行時エラーの行番号と抜粋は、TypeScript を JavaScript へ変換した後のコード基準。元の TS の行番号とは一致しない場合がある。
- `use()` が許可するのは `node:` / `bun:` の組込と、セッション cwd 配下に収まる `./` / `../` の相対パスだけ。リモート URL と同梱依存(ベア指定子)は M1 では未対応。
