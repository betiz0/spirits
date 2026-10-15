# スパイク: 同梱スキルの書き出し方式と探索順

- 日付: 2026-10-13
- Bun: 1.4.2
- 対象 change: `add-bundled-skills`
- 関連: `openspec/changes/add-bundled-skills/design.md` Decision 2・3、`docs/spirits-design.md` §4.4

## 目的

M4 後続の `add-bundled-skills` の実装前に、次を実機で確認する。

1. Markdown のアセット import(`import content from "./SKILL.md" with { type: "text" }`)が、ソース実行・コンパイル済みバイナリ・`bun test` の 3 経路でファイル内容を文字列として返すか。動かない場合は `Bun.build` の `compile.assets` + `import.meta.dir` 方式へ切り替える(Decision 2 の主案/代替の判断)。
2. 拡張の `resources_discover` が返す `skillPaths` と利用者 `<agentDir>/skills/` の同名スキルが衝突したとき、利用者版が採用され、衝突警告が出るか(Decision 3 の主案/代替の判断)。

## 1. アセット import の 3 経路

### 方法

`/tmp/spirits-spike-bundled-skills/` に最小フィクスチャを置いた。

- `SKILL.md`: frontmatter、コードフェンス(` ```ts `)、テンプレートリテラルの `${prefix}-${suffix}` を含む 267 文字の Markdown。
- `entry.ts`: `import content from "./SKILL.md" with { type: "text" }` して内容の長さと特徴文字列を出力する。
- `asset.test.ts`: 同じ import を `bun test` から読み、frontmatter・フェンス・`${}` を検査する。
- `build.ts`: `scripts/build-binaries.ts` と同じ条件(`tsconfig` に root `tsconfig.json`、`compile.target: bun-linux-x64`、`throw: false`)で `entry.ts` を単一バイナリ化する。

### 結果

主案(`type: "text"` のアセット import)が 3 経路すべてで成功した。代替(`compile.assets` + `import.meta.dir`)は不要。

| 経路 | コマンド | 結果 |
|---|---|---|
| (a) ソース実行 | `bun entry.ts` | `LENGTH=267 HAS_FRONTMATTER=true HAS_FENCE=true HAS_INTERPOLATION=true`、exit 0 |
| (b) コンパイル実行 | `bun build.ts && ./spike-assets` | `BUILD_OK` の後、同じ 4 行、exit 0 |
| (c) `bun test` | `bun test asset.test.ts` | 1 pass / 0 fail(3 expect) |

Markdown 中のバッククォートと `${}` はエスケープなしでそのまま取り込まれた。Decision 2 の理由(テンプレートリテラルではエスケープが壊れやすい)のとおり、実ファイル + アセット import が成立する。

### 再現コマンド

```sh
cd /tmp/spirits-spike-bundled-skills
bun entry.ts
bun test asset.test.ts
bun build.ts && ./spike-assets
```

## 2. `resources_discover` と利用者スキルの優先順位

### 方法

隔離環境 `/tmp/spirits-spike-bundled/` を作り、`bun scripts/build-binaries.ts --version 0.0.0` で作った `dist/spirits-linux-x64` を(repo root を cwd にして)起動した。

- 利用者版: `home/.spirits/agent/skills/spike-skill/SKILL.md`(description: `user version`)。
- 同梱版の代役: `bundled/spike-skill/SKILL.md`(description: `bundled version`)。将来の実装が返す版ディレクトリに相当する。
- 代役の供給元: `home/.spirits/agent/extensions/spike-bundled.ts`。`resources_discover` で `{ skillPaths: ["/tmp/spirits-spike-bundled/bundled"] }` を返し、`agent_start` で system プロンプトをファイルとセッション JSONL に記録する。
- 起動: `scripts/tmux-verify.sh run`(interactive-testing 手順)。モデルは `--model my_opencode/kimi-k3`、認証はダミー。プロバイダ要求は 401 で失敗したが、system プロンプトの記録とスキル探索には影響しない。

```sh
env HOME=/tmp/spirits-spike-bundled/home \
  SPIRITS_CODING_AGENT_DIR=/tmp/spirits-spike-bundled/home/.spirits/agent \
  SPIKE_BUNDLED_DIR=/tmp/spirits-spike-bundled/bundled \
  SPIKE_RECORD_PATH=/tmp/spirits-spike-bundled/system-prompt.txt \
  OPENCODE_API_KEY=spike-dummy \
  ./dist/spirits-linux-x64 --model my_opencode/kimi-k3
```

### 結果

(a) 起動 TUI の診断表示(実測の抜粋):

```
[Skill conflicts]
  "spike-skill" collision:
    ✓ auto (user) ~/.spirits/agent/skills/spike-skill/SKILL.md
    ✗ /tmp/spirits-spike-bundled/bundled/spike-skill/SKILL.md (skipped)
```

(注: 表示上の `~` は隔離 HOME を指す。)

(b) セッション JSONL(`home/.spirits/agent/sessions/--home-betiz-project-spirits--/*.jsonl`)の system メッセージ `sections.skills` の抜粋:

```xml
<skill>
  <name>spike-skill</name>
  <description>user version</description>
  <location>/tmp/spirits-spike-bundled/home/.spirits/agent/skills/spike-skill/SKILL.md</location>
</skill>
```

同梱版(`bundled/spike-skill/SKILL.md`)のパスは `available_skills` に現れない。pi のローダーはデフォルト探索(利用者 `skills/`)を先に読み、拡張由来の `skillPaths` を後ろにマージして先勝ちで採用するため、Decision 3 の想定どおり利用者版が勝つ。

補足: system プロンプトは session JSONL の `message` エントリ(role: `system`)として `sections` 付きで保存される。よって追加の記録機構なしに、JSONL だけで供給結果を確認できる。

## 結論(Decision 2 / 3 の確定)

| Decision | 採用方式 | 撤回条件 | 判断 |
|---|---|---|---|
| Decision 2: 同梱内容の取り込み | 主案: Markdown 実ファイル + `type: "text"` のアセット import | いずれかの経路で動かない、型検査の負担が無視できない | 主案を採用。3 経路すべて成功 |
| Decision 3: 上書きの優先順位 | 主案: pi のローダーに委ねる(先勝ち + 衝突警告) | 探索順が期待どおりでない、警告がノイズになる | 主案を採用。利用者版の採用と警告を実測 |

design.md の Decision 2・3 は主案のまま変わらないため、更新は不要。スパイクで判明した追加作業は次の 2 点で、タスク 2.x の型検査で対応する。

- `type: "text"` の import は実行時に動くが、TypeScript は `*.md` のモジュール宣言を持たないため、そのままでは `Cannot find module` になる。`packages/spirits/src/types/text-assets.d.ts` に `declare module "*.md" { const content: string; export default content; }` を追加した。
- あわせて `packages/spirits/tsconfig.json` に `"module": "NodeNext"` と `"moduleResolution": "NodeNext"` を追加した。import attributes(`with { type: "text" }`)は `NodeNext` の解決でのみ型検査され、それ以外ではアセット import 自体が解決されないため。この 2 つで `bun run check` が通ることを確認した。
