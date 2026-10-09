# スパイク: 拡張からの SDK 子セッション生成(rlm)

- 日付: 2026-10-08
- Bun: 1.4.2
- 対象 change: `add-rlm`(M3 同期再帰エージェント)
- 関連: `docs/spirits-m3-rlm.md` §5、`openspec/changes/add-rlm/design.md` Decision 12・13
- 使用プロバイダ / モデル: `my_opencode` / `deepseek-v4.1-flash`(実プロバイダ。認証はエージェントディレクトリの設定と環境変数)

## 目的

M3 の実装前に、拡張から `createAgentSession()` で子セッションを生成する経路、usage の取得、abort 伝播、`src/rlm/tsconfig.json` による pi 実行時 import の解決、制限付きリソースローダー、`appendEntry` の非注入を実機で確認する。動かない項目があれば代替経路またはコアへの `[spirits]` 最小パッチ候補を記録し、作業を止める。

## 方法

- `packages/spirits/src/rlm/sdk-probe.ts`(一時)を `-e` で拡張としてロードし、`/sdk-probe` コマンドのハンドラで子セッションの生成・prompt・abort を実行した。結果は `/tmp/sdk-probe-results.json` に記録した。
- 子セッションは `createAgentSession` に `cwd` / 親の `model` / `customTools: [createTsreplTool()]` / `tools: ["tsrepl"]` / `SessionManager.inMemory(cwd)` / `DefaultResourceLoader({ noExtensions: true, noSkills: true, noPromptTemplates: true })` を渡して生成した(`modelRuntime` は渡さない)。
- 実行時 import の確認は、`src/rlm/import-probe.ts`(一時)を `src/index.ts` から静的 import する一時配線で行った。拡張ローダの仮想モジュール経路ではなく、`src/rlm/tsconfig.json`(root `tsconfig.json` を extends)によるパス解決を使う経路になる。
- 一時ファイル(sdk-probe.ts、import-probe.ts、import-probe.test.ts、src/index.ts の一時 import)は本記録の作成後に削除した。

実行コマンド(リポジトリルート):

```sh
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/rlm/sdk-probe.ts -p "/sdk-probe" --approve --no-session
```

## 結果

6 項目すべて成功。pi 上流コアへの変更は不要。

| # | 項目 | 結果 |
|---|---|---|
| 1 | 拡張内から `createAgentSession` で子 `AgentSession` を生成し、custom `tsrepl` を登録して prompt を実行できる | 成功。子は `tsrepl` ツールを呼び、最終回答 `"5"`、`stopReason: "stop"`。所要 3562ms |
| 2 | 子の usage を `getSessionStats()` で取得できる | 成功。`tokens: { input: 3577, output: 106, cacheRead: 3328, cacheWrite: 0, total: 7011 }`、`cost: 0` |
| 3 | `session.abort()` で実行中の子を止められる | 成功。子が `tsrepl` 実行中(`tool_execution_start` 観測済み)に `abort()` を呼ぶと 2ms で戻り、prompt も resolve。60 秒待つセルは打ち切られた |
| 4 | probe モジュールの pi 実行時 import が 3 形態で解決できる | 成功(下記) |
| 5 | `noExtensions` / `noSkills` / `noPromptTemplates` のローダーでも custom `tsrepl` が有効で、コンテキストファイルが読み込まれる | 成功。`extensions: 0` / `skills: 0` / `prompts: 0`、`contextFiles: ["/home/betiz/.pi/agent/AGENTS.md", "/home/betiz/project/spirits/AGENTS.md"]`。同じローダー構成の子で `tsrepl` 呼び出しが成功した |
| 6 | `pi.appendEntry` のカスタムエントリが `buildSessionContext().messages` に含まれない | 成功。エントリは 1 件追加され `type: "custom"`、`inMessages: false` |

### 項目 4: 実行時 import の解決

`probePiImports()` が返した値は 3 形態とも `function,function,function,function,function`(`createAgentSession` / `DefaultResourceLoader` / `SessionManager` / `SettingsManager` / `getAgentDir`)。

| 実行 | 結果 |
|---|---|
| `cd packages/spirits && bun test` | 成功(79 tests、4.04s)。probe のテストを含む |
| `bun packages/spirits/bin/spirits.ts --approve` | 成功。起動時 stderr に `[spirits-import-probe] function,function,function,function,function` |
| `bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts` | 成功。同じ行を stderr に出力 |

`bun test` の所要時間は probe の import を含む全 79 テストで 4.04s(user 1.30s)だった。pi ソースを読み込む `spawn.ts` を import するテストはこの起動コストを払う見込みだが、許容範囲。

### 観測値の生データ(抜粋)

```json
{
  "bunVersion": "1.4.2",
  "appendEntry": { "appended": 1, "inMessages": false, "entryType": "custom" },
  "resourceLoader": {
    "extensions": 0,
    "skills": 0,
    "prompts": 0,
    "contextFiles": ["/home/betiz/.pi/agent/AGENTS.md", "/home/betiz/project/spirits/AGENTS.md"]
  },
  "success": {
    "text": "5",
    "sawToolStart": true,
    "durationMs": 3562,
    "stopReason": "stop",
    "tokens": { "input": 3577, "output": 106, "cacheRead": 3328, "cacheWrite": 0, "total": 7011 },
    "cost": 0
  },
  "abort": { "sawToolStart": true, "abortMs": 2, "stopReason": "error", "promptResolved": true }
}
```

## 実装への含意

- **abort 後の `stopReason` は `"aborted"` ではなく `"error"`**: `spawn.ts` の失敗判定は「abort を要求したか」を先に確認し、要求済みなら最終メッセージの `stopReason` を見ずに `aborted` として扱う。`stopReason === "aborted"` で abort 未要求の場合のみ予期しない中断として `error` にする。
- **子の 1 ターン(tsrepl 1 呼び出し)は約 3.5 秒**: 既定のセル timeout 30000ms でも 1 回の `rlm` は収まる見込みだが、直列化や複数呼び出しでは余裕が減る。案内文どおり `timeout` を大きく指定できるようにする。
- **`cost` は 0**(モデルのコスト定義が 0)。usage 記録のフィールドは 0 でも欠落させない。
- **制限付きローダーでもコンテキストファイルは読み込まれる**: `noContextFiles` は指定しない方針(Decision 2)が実機で成立する。
- **`appendEntry` は拡張ロード中には呼べない**(runtime 未初期化)。`pi.appendEntry` を呼ぶのはツール実行時(= `rlm` 呼び出し時)であり、本件は問題にならない。スパイクではコマンドハンドラ(= 初期化後)で確認した。

### `prompt()` 事前処理中の abort と `checkAuth` の実 IO(タスク 3.2)

`spawn.ts` は abort 要求済みのまま `agent_start` を受けたら `session.abort()` を出し直す(design Decision 7)。上流 `prompt()` は実行開始前に事前処理を await し、実行の開始時に中断フラグを初期化する(`agent-session.ts:1776`)ため、その間の abort は失われる。上流コードで実 IO を待つ経路があるかを確認した。

- `prompt()`(`agent-session.ts:1921`)の事前処理が await するのは、入力ハンドラ(`_runInputHandlers`)、認証確認(`hasConfiguredAuth || await checkAuth`、`:1990`)、`before_agent_start`、画像の正規化、および既存アシスタントメッセージがある場合の `_checkCompaction`。`noExtensions` の子ではハンドラが 0 なので、入力ハンドラと `before_agent_start` は外部 IO を待たずに解決する。初回 prompt には既存メッセージが無いため `_checkCompaction` も走らない。先頭 `/` の拡張コマンド処理も、拡張が無いため即座に false になる。
- 認証確認は `hasConfiguredAuth` が真なら `checkAuth` を await しない。`createAgentSession` が使う `ModelRuntime` は生成時に既定 (`refreshOnCreate !== false`) で `refresh()` を await し(`model-runtime.ts:254`、生成は `sdk.ts:182`)、`configuredProviders` を全プロバイダの `checkAuth` 結果から埋める(`:350`)。環境変数ベースの認証も含まれる。子は親と同じエージェントディレクトリと環境を使うため、通常はこの時点で真になり `checkAuth` の待機には入らない。
- `hasConfiguredAuth` が偽の場合の `checkAuth` は資格情報ストアを読む(`auth-storage.ts:401`)。`auth.json` のリビジョンが前回読込と同じならキャッシュを返してファイル IO をせず(`:407-408`)、リビジョンが変わったときだけ非同期リロード(実 IO)になる。この経路は実行時生成後に資格情報が追加・変更された場合で、子の初回 prompt では踏まない。
- したがって、現行上流で子の初回 `prompt()` の事前処理が実 IO を待つ経路は確認できなかった。abort が失われ得る窓はマイクロタスク程度だが、`agent_start` での再発行は上流のフラグ初期化に対する数行の防御として残す(`spawn.ts`)。フェイクセッションのテスト「abort reissued at agent start」で、事前処理中の abort が `agent_start` 後の再発行でしか子を止められない挙動を固定している。事前処理に実 IO の待機が将来入っても、この防御が同じ窓を覆う。

## interactive smoke(タスク 6.4)

`.pi/skills/interactive-testing.md` の tmux 手順で、ソース起動と `bun scripts/build-binaries.ts --version 0.0.0` のバイナリの両方を実プロバイダで動かした。

- ソース: `PI_CODING_AGENT_DIR=/home/betiz/.pi/agent SPIRITS_DEV=1 bun packages/spirits/bin/spirits.ts --approve`
- バイナリ: `PI_CODING_AGENT_DIR=/home/betiz/.pi/agent SPIRITS_DEV=1 ./dist/spirits-linux-x64 --approve`
- `PI_CODING_AGENT_DIR` を dev の `~/.pi/agent` に向けたのは、`~/.spirits/agent/auth.json` が空(`{}`)で `models.json` も無く、そのままだと子を含むモデル解決ができないため。spirits の環境既定は `bin/bootstrap.ts` / `bin/env-defaults.ts` のままで、バイナリの起動・バンドル経路は変えていない。

| # | 確認 | ソース起動 | バイナリ |
|---|---|---|---|
| 1 | `return await rlm("2+3は?")` が子の回答文字列を返す | セル値 `"2 + 3 = 5 です。"`、呼び出し 1685ms | セル値 `"5 です。"`、呼び出し 2074ms |
| 2 | 深度 2 の孫まで動き、深度 2 からの `rlm` が上限付きガイダンスエラー | `Error: 深度上限（2）に達したため、子エージェントを起動できません。問題を分割せず、現在の層で直接処理してください。`(ルート呼び出し 8890ms) | 同じ上限エラー(ルート呼び出し 10338ms) |
| 3 | 子の実行中に親を中断すると子が止まり、セルは tsrepl の中断文面 | `AbortError: 呼び出し元の中断により実行を打ち切りました。(… reset: true …)`。子セル elapsed 7613ms kind=error | 同文面。子セル elapsed 4133ms kind=error |
| 4 | `timeout: 500` のセルで子が abort され timeout エラー | `TimeoutError: 実行が 500ms を超えたため打ち切りました。(… reset: true …)`、呼び出し 501ms | 同文面、呼び出し 501ms |
| 5 | `Promise.all([rlm("a"), rlm("b")])` の子が直列 | 完了 1889ms / 4079ms(差 2190ms ≒ 子 1 回分、合計 ≒ 和) | 完了 2950ms / 4867ms(差 1917ms ≒ 子 1 回分、合計 ≒ 和) |
| 6 | ルート JSONL に呼び出しごとの `rlm_usage`(深度 2 もルート) | 10 件。depth 1(複数)、depth 2(3958ms)、depth 3(error, sessionId null) | 10 件。depth 1(複数)、depth 2(4904ms)、depth 3(error, sessionId null) |
| 7 | モデルがツール説明の案内に従って `rlm` を使う | 指示したセルで `rlm` を選択。子/孫への再帰も案内どおり | 同左 |

### 子の所要時間(参考)

- `rlm("2+3は?")` の子 1 ターン(tsrepl 1 回): 約 1.7–2.1 秒
- 深度 1 の子が深度 2 の孫を起動する入れ子: 深度 1 の呼び出し 約 8.9–10.3 秒、深度 2 の呼び出し 約 4.0–4.9 秒
- 直列化した 2 呼び出し: 各 約 1.9–3.0 秒、合計 約 4.1–4.9 秒
- 60 秒待機セルの子を中断: 中断まで 約 4.1–7.6 秒

既定のセル timeout 30000ms は 1 回の `rlm` には足りる。入れ子や直列化した複数呼び出しでは 30 秒に近づくため、案内文どおり `timeout` を大きく指定できることが重要になる。

### 証跡(セッションファイル)

- ソース起動: `~/.pi/agent/sessions/--home-betiz-project-spirits--/2026-10-08T10-27-58-014Z_01a11b0e-33bd-7539-9064-1cd4863dbe46.jsonl`
- バイナリ: `~/.pi/agent/sessions/--home-betiz-project-spirits--/2026-10-08T10-33-42-579Z_01a11b13-75b3-72f9-85d1-262975a54917.jsonl`

## 再現手順

```sh
cd <repo>

# 6 項目の確認(実プロバイダ。結果は /tmp/sdk-probe-results.json)
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/rlm/sdk-probe.ts -p "/sdk-probe" --approve --no-session

# 実行時 import(probe を src/index.ts から一時 import した状態で)
cd packages/spirits && bun test
cd <repo>
tmux new-session -d -s probe-bin -c <repo> "bun packages/spirits/bin/spirits.ts --approve 2> /tmp/probe-bin.log"
sleep 10; cat /tmp/probe-bin.log; tmux kill-session -t probe-bin
tmux new-session -d -s probe-e -c <repo> "bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts 2> /tmp/probe-e.log"
sleep 10; cat /tmp/probe-e.log; tmux kill-session -t probe-e
```
