# 手動 E2E 記録: bundled-skills と architecture-guards

- 日付: 2026-10-13
- Bun: 1.4.2
- 使用モデル: `my_opencode/gpt-6-luna`
- 対象 change: `add-bundled-skills`
- 実行環境: 隔離 HOME(`/tmp/spirits-e2e/home`)、`SPIRITS_CODING_AGENT_DIR=/tmp/spirits-e2e/home/.spirits/agent`
- 実行バイナリ: `dist/spirits-linux-x64`(`bun scripts/build-binaries.ts --version 0.0.0`)。ソース実行は `bun packages/spirits/bin/spirits.ts`

tmux 操作は `scripts/tmux-verify.sh run` を使った。実行中はモデルの入出力を TUI とセッション JSONL の両方で確認した。

## 4.1 ソース実行とコンパイル実行の供給

| 実行 | 版ディレクトリ | 書き出されたファイル | スキル一覧 |
|---|---|---|---|
| コンパイル版 `dist/spirits-linux-x64` | `<agentDir>/bundled-skills/0.0.0/architecture-guards/` | `SKILL.md` + `references/` 3 件 | `architecture-guards` が表示され、説明がオートコンプリートに出る |
| ソース実行 `bun packages/spirits/bin/spirits.ts` | `<agentDir>/bundled-skills/0.0.0-dev/architecture-guards/` | 同じ 4 ファイル | 同じ名前・説明が表示される |

両実行の `SKILL.md` は SHA-256 が一致した(`1f09183c...0452`)。`<agentDir>/skills/` には書き出されない。

`/skill:architecture-guards` は `SKILL.md` を展開してモデルへ渡し、応答は対象判定とスタック検出から始まった(TUI で「対象判定: TypeScript…」「[Skills] に architecture-guards」を確認)。モデルは `packages/spirits` のみを対象にするか質問し、利用者(オペレータ)が「packages/spirits のみ」と回答した。

## 4.2 spirits リポジトリ自身への適用

確定した入力:

- 対象: `packages/spirits` のみ(`tsconfig.json` の `src`・`test`・`bin`)
- 依存方向の許可表: 実測 100 ファイルの層間依存。`value` / `type-only` を別判定。`rlm → tools.ts` は許可。型のみの辺も許可表の対象
- 強度: 依存方向・後段非依存・値の循環・上流差分分離 = `must`、重複コード・設定値 = `should`、継承 = `info`
- 型のみの辺を含む混合循環(`bundled-skills/index.ts` ↔ `definition.ts`)はベースラインとして許容。循環判定は値の辺だけを対象にする

生成された差分:

- `docs/architecture/convention-registry.md`(AG-001〜AG-007)
- `packages/spirits/test/architecture-guards.test.ts`(AG-001〜AG-004 の検査)
- `.github/workflows/spirits-ci.yml` への base/head SHA の受け渡し(AG-004 を CI で実行)
- `openspec/config.yaml` の rules への正本参照と検査コマンドの追記案

検証:

- 差分提示の段階で `git status --porcelain` は調査開始時と同じで、生成物は未書き込みだった
- 承認後に提示どおり書き込み、`cd packages/spirits && bun test test/architecture-guards.test.ts` が **2 pass / 0 fail**(AG-004 は CI 用の SHA 未設定のためローカルではスキップ)
- `cd packages/spirits && bun run check` も成功(生成時に型アサーション 1 行の修正を挟んだ)

生成物の確認(`/tmp/spirits-e2e/` の既存生成物から転記。`/tmp` 配下のため永続しない):

- 重複と継承の計測結果が提示されたこと: `/tmp/spirits-e2e/proposal.txt` の AG-006 に `POSITIVE_INTEGER_PATTERN` の重複箇所(`src/config.ts:50`、`src/update/timeout.ts:13`)、AG-007 に `extends` 5 辺・`implements` 6 辺・最大の内部 `extends` 深さ 1 が記載されている。
- 実測に現れない GoF パターン名や継承の制限が原案に含まれないこと: `proposal.txt` に GoF パターン名(Strategy、Factory、Singleton、Visitor、Observer など)は現れない。AG-007 は「上限や禁止の規約は設けない」と明記している。
- 規約本文が正本 1 か所だけにあり、検査と設定が規約 ID で参照していること: `gen1/test/architecture-guards.test.ts` は `docs/architecture/convention-registry.md` を読み、規約 ID(AG-001〜AG-004)のみを検査名に持つ。`gen1/openspec-config.diff` は正本のパスと規約 ID、検査コマンドだけを追記しており、規約本文を複製していない。

この E2E の生成物はこの change のスコープ外のため、記録後にメインの作業ツリーから撤去した(`docs/architecture/` と生成テストを削除し、CI / OpenSpec への追記案は元に戻した)。一時コピーでの検証は 4.3・4.4 で行った。

## 4.3 生成検査の違反検出

一時フィクスチャ `/tmp/spirits-e2e/fixture-dep`(規約正本と生成テストのコピー + 違反を入れた TS ファイル)で確認した。

```
error: AG-002 src/forward.ts: phase/shared scope is not registered
AG-001 src/repl/leak.ts:1 -> src/harness/target.ts (value)
AG-002 src/repl/leak.ts:1 -> src/harness/target.ts (M1 -> M4)
AG-003 src/todo/a.ts <-> src/todo/b.ts
exit=1
```

- AG-001: 許可表にない `src/repl` → `src/harness` の値 import
- AG-002: M1(`src/forward.ts`)→ M4(`src/harness`)の後段依存
- AG-003: `src/todo/a.ts` ↔ `src/todo/b.ts` の値の循環

型のみの import だけの違反も確認した(verify2 W-2)。`src/todo/type-only-leak.ts` に `import type { forward } from "../forward.ts"` を追加した(方向 `src/todo` → `src` は値のみ許可で、型のみは非許可)。再実行の出力:

```
error: AG-002 src/forward.ts: phase/role is not registered
AG-001 src/repl/leak.ts:1 -> src/harness/target.ts (value)
AG-002 src/repl/leak.ts:1 -> src/harness/target.ts (M1 -> M4)
AG-001 src/todo/type-only-leak.ts:1 -> src/forward.ts (type)
AG-003 src/todo/a.ts -> src/todo/b.ts -> src/todo/a.ts
exit=1
```

型のみの辺が `(type)` として方向検査の対象になり、値の辺と別に検出されることを確認した。

上流差分の検査は一時 git リポジトリ `/tmp/spirits-e2e/fixture-git` で確認した。`SPIRITS_ARCHITECTURE_BASE_SHA` / `SPIRITS_ARCHITECTURE_HEAD_SHA` に base/head を渡し、`packages/ai` だけを変更する `[spirits]` なしコミットと、`packages/spirits` と `packages/ai` を混ぜたコミットを検出した。

```
error: AG-004 25d7e49...: upstream package commit subject must start with [spirits] (chore: update ai)
AG-004 678bbd1...: mixes packages/spirits with packages/ai/y.ts
exit=1
```

## 4.4 撤去と再生成(冪等性)

一時コピー `/tmp/spirits-e2e/fixture-regen` で、生成された 2 ファイルを削除してから、同じ確定入力(対象範囲・許可表の方針・強度)で手順 4〜7 を再実行した。1 回目の生成物は `/tmp/spirits-e2e/gen1/`、2 回目は同 fixture に保存されている。

再生成の注意点として、初回の再実行でモデルが git 履歴から生成物を復元しようとしたため、「履歴や既存生成物を参照せず実測から書き起こす」よう指示してやり直した。この知見は `references/check-generation.md` の「再実行と冪等性」に反映した。

| 比較項目 | 1 回目 | 2 回目 | 一致 |
|---|---|---|---|
| ファイル構成 | `docs/architecture/convention-registry.md` + `packages/spirits/test/architecture-guards.test.ts` | 同じ | 一致 |
| 規約 ID | AG-001〜AG-007 | AG-001〜AG-007 | 一致 |
| 検査名 | AG-001/002/003 と AG-004 の 2 テスト | 同じ 2 テスト | ほぼ一致(AG-004 の説明語のみ差) |
| ベースライン | 2 pass / 0 fail | 2 pass / 0 fail | 一致 |
| 違反検出(4.3 のフィクスチャ) | AG-001/002/003 を検出、exit 1 | 同じ 3 件を検出、exit 1 | 一致 |
| バイト単位 | 正本 9081 bytes / テスト 13908 bytes | 正本 8755 bytes / テスト 13755 bytes(202 行差) | 不一致 |

バイト単位では一致しない。LLM の再生成では文章・表の行構成が毎回同一にならないため、検証基準を **ファイル構成・規約 ID・検査名・ベースライン・違反検出の一致** に置き換えた(2026-10-13、利用者承認)。tasks.md 4.4 の検証も同じ基準に更新し、バイト一致は求めない。

## 5.1 OpenSpec 非使用の TypeScript リポジトリ

一時リポジトリ `/tmp/spirits-e2e/fixture-ts`(`bun test`、TypeScript 7.0.2、CI なし、OpenSpec なし、AGENTS.md なし)で `/skill:architecture-guards` を最初から実行した。

- スタック検出で「`openspec/` と `openspec/config.yaml` は見つかりません。OpenSpec rules の手順は対象外です」と伝えた
- 層分け(`domain` / `infra` / `ui` / `util` / `test`)と許可表を提示し、確認後に生成
- 生成物: `docs/architecture/convention-registry.md` と `test/architecture-guards.test.ts`
- 検査は `package.json` の test スクリプト(`bun test`)で実行でき、**2 pass / 0 fail**
- `openspec/config.yaml` は作成されなかった
- CI が無いため、CI ワークフローは新設せず、`info` の規約として CI 導入時の組み込みを記録した
- 検査は TypeScript 7.0.2 では classic API が使えないため `typescript/unstable/async` と `typescript/unstable/ast` を使った(初回提示は classic API で、実測を伝えて修正させた)

### 5.1 承認しない場合

一時リポジトリ `/tmp/claude-1000/-home-betiz-project-spirits/3123a910-2e18-4047-851d-03bc2b240ea4/scratchpad/e2e/fixture-ts-decline`(`bun test`、TypeScript、tsconfig あり、OpenSpec・AGENTS.md なし、git commit 済み)で、次の順に実行した。

1. `/skill:architecture-guards`: スタック検出と許可表原案(層間依存 `test → src`)を提示し、層分けの確認を求めた
2. 層分けの確認に「その案で進める。書き込まず差分の提示までで止める」と回答: 計測ベースライン(重複 0、継承 0)と生成予定ファイルの要約を提示し、「ここで停止します」と応答。`git status --porcelain` は空
3. 差分を「承認しない」と回答: 「検査生成を中止しました。ファイルへの書き込みはありません。」と応答。`git status --porcelain` は実行前と同じく空で、`docs/`・生成検査・`openspec/config.yaml` は作成されなかった

この承認拒否の確認は、承認済みの生成(上記の承認パス)とは別の実行である。

## 5.2 非 TypeScript プロジェクト

一時リポジトリ `/tmp/spirits-e2e/fixture-py`(Python のみ)で実行した。

```
このリポジトリは対象外です。`tsconfig.json` も `.ts` / `.tsx` ファイルも見つかりませんでした。
`architecture-guards` は TypeScript を使うリポジトリでのみ実行できます。ファイルの作成・変更は行っていません。
exit=0
```

実行前後で `git status --porcelain` は空のままだった。

### 5.2 vendored のみに `.ts` がある場合

一時リポジトリ `/tmp/claude-1000/-home-betiz-project-spirits/3123a910-2e18-4047-851d-03bc2b240ea4/scratchpad/e2e/fixture-vendored`(`tsconfig.json` なし、`.ts` は `vendor/lib/x.ts` のみ、git commit 済み)で `/skill:architecture-guards` を実行した。利用者への質問には回答せず、その応答で終了させた。

```
対象か判断できません。ルートに `tsconfig.json` はなく、見つかった TypeScript ファイル `vendor/lib/x.ts` は vendored ディレクトリ内だけです。

このリポジトリでは `vendor/` も含めて規約の対象にしますか？ 対象範囲の確認が取れるまで、作業は進めず、ファイルも変更しません。
```

実行前後で `git status --porcelain` は空のままで、`openspec/` 等の書き込みもなかった。判断できない場合は質問して終了し、何も書き込まないことを確認した。

## 5.3 references へのフィードバック

E2E で見つかった点を `references/check-generation.md` と `SKILL.md` に反映した。

| 知見 | 反映先 | 内容 |
|---|---|---|
| TypeScript 7 では classic API が使えない | `references/check-generation.md`「TypeScript のバージョンと API の選択」 | 5.x は classic API、7.x は `typescript/unstable/async` + `unstable/ast`。判断できない場合は `node_modules/typescript/package.json` を見て生成前に API の存在を実測する |
| 型のみの辺と循環 | `references/check-generation.md`「循環の判定」 | 型のみの辺は方向検査に含め、循環判定からは除外する。混合循環はベースラインとして記録する |
| CI が無いリポジトリ | `references/check-generation.md`「CI が無いリポジトリ」 | `must` は可能だが CI ワークフローを勝手に新設せず、組み込みは `info` として記録する |
| 再生成時に履歴を参照した | `references/check-generation.md`「再実行と冪等性」と `SKILL.md` 手順 7 | 履歴や以前の生成物を参照せず、実測と確定済みの規約から書き起こす。比較はファイル構成・規約 ID・検査名・ベースラインで行う |
| 生成物が既存だと再生成せず「差分なし」と判断した | `references/check-generation.md`「再実行と冪等性」 | 削除後の再実行を前提に、生成物の有無ではなく実測と入力から書き起こす |

反映後も `cd packages/spirits && bun test test/bundled-skills.test.ts` は 13 pass / 0 fail。

## 一時ファイルの所在

`/tmp` 配下のため永続しない。参照用のパス:

- `/tmp/spirits-e2e/gen1/`: 4.2 の生成物
- `/tmp/spirits-e2e/fixture-regen/`: 4.4 の再生成物
- `/tmp/spirits-e2e/fixture-dep/`, `/tmp/spirits-e2e/fixture-git/`: 4.3 の違反フィクスチャ
- `/tmp/spirits-e2e/fixture-ts/`, `/tmp/spirits-e2e/fixture-py/`: 5.1・5.2 のフィクスチャ
