# 互換性ランナーと fork 経路の証拠 (clean 実行 / 2026-11-07)

作業ツリーが clean な worktree だけで実行した測定結果。`runnerProvenance.clean` はいずれも `true`、
`diffSha256` は空 diff の SHA256(`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)、`untracked` は空。
実行 commit は実装コミットそのもので、公式 mode の `targetCommit` も同じ。

| 項目 | 値 |
|---|---|
| 実行 commit | `cb1733e198e191f0ff07e098c9eea97f60a43cda` |
| 公式 tarball sha256 | `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b`(信頼ルート `MANAGED_PI_FIRST_ARTIFACT_SHA256` と一致) |
| 展開後実行ファイル sha256 | `61a84400938da652ed69aac9c1ad2ca23af3c9bd8cc2f46ce571ed84ae6a35e5` |
| 拡張 bundle sha256 | `908b3c43fb7a7891a5c32c37e904de3a5bc265ec9b0a8652bc9f1407c5a04290` |
| manifest sha256 | `c787c6bb23fde86346e51e7849e7f87910526237bb6cc831c6d2824c0031d465` |
| Pi 版 / overlay | 1.5.0 / `1.5.0-spirits.1` |
| ランナー側 / host ランタイム | bun 1.4.2 / bun 1.4.4 |
| 比較した fork 経路 | `dist/spirits-linux-x64` sha256 `6b26ddc0dd445350ec552d8a11be80baea5fbca2b72ca135fb761f770ace00f6`(`scripts/build-binaries.ts --version 0.1.0` で同じ commit からビルド) |

## `rlm auto parent` の状態

前回(`openspec/changes/archive/2026-11-06-repair-managed-pi-compat-harness/evidence/`)は `limited` だった。

| 実行 | 状態 | detail |
|---|---|---|
| official | `confirmed` | the auto parent handed the child fake-model, which answered and recorded rlm_usage |
| fixture | `not-run` | no child request reached the provider and the run reported nothing, so the auto parent was never exercised (child created=true, requested model=none, final answer=yes, usage=false) |

official の判定根拠はこの項目の `data.providerRequests` に残した。`kind=text` の 2 本目が子自身のリクエストで
(1 本目は親のプロンプトを運ぶ tool-call、3 本目は tool 結果の続き)、その `model` が `fake-model`。親が
`spirits/auto` を選んだままでも子のリクエストは物理モデル名で届いている。

```json
[
  { "kind": "tool-call", "model": "fake-model", "receivedAt": 516, "respondedAt": 516 },
  { "kind": "text", "model": "fake-model", "receivedAt": 540, "respondedAt": 541, "delayMs": 0 },
  { "kind": "text", "model": "fake-model", "receivedAt": 547, "respondedAt": 548 }
]
```

同じ実行で子が残した `rlm_usage` が `official-auto-usage.json`。`provider` と `modelId` は解決後の
`compat-fake` / `fake-model`、`outcome` は `completed`。以前はここで provider が `spirits` /
modelId が `auto`(= 子では使えない選択)か、呼び出しが失敗して record 自体が `error` だった。

## fork 経路(`dist/spirits-linux-x64`)

`fork-route.json` に 3 ケース、`fork-route-probe.ts` に実行したスクリプトをおく(import 先は実行に使った
clean worktree のパスのまま)。`childRequestedModel` は fake provider が受けた子のリクエストの `model`、
`childModelIsVirtual` はそれが仮想モデル名だったか。

| case | 子のリクエスト数 | 子の要求モデル | cell | `rlm_usage` |
|---|---|---|---|---|
| physical | 1 | `fake-model` | `child answer`(非 error) | `completed` / `compat-fake` / `fake-model` |
| abort | 1(親中断で切断) | `fake-model` | 中断 error | poll の 2 読みとも `aborted` / `compat-fake` / `fake-model` |
| auto | 1 | `fake-model` | `child answer`(非 error) | `completed` / `compat-fake` / `fake-model` |

アーカイブした `q4-fork-route.json` では auto ケースが `childRequests: 0`、cell が
`rlm: No API key found for spirits.`、`usageAtSettled: ["error"]` だった。fork 経路でも同じ修正で子が
物理モデルで応答し、usage に解決後のモデルが残る。

## 結果内訳

| 実行 | confirmed | limited | unavailable | not-run | failed | runnerCompleted | compatibilityMet | role/clear/model 観測 |
|---|---|---|---|---|---|---|---|---|
| official | 29 | 0 | 0 | 3 | 0 | false | true | 2 of 9 |
| fixture | 19 | 3 | 0 | 10 | 0 | false | false | 1 of 9 |

前回の official は `confirmed=28 limited=1`、fixture は `confirmed=19 limited=4 not-run=9`。差分は
`rlm auto parent` が `limited` から公式では `confirmed`、fixture では `not-run` に移ったこと。公式の実行で
`not-run` に残る 3 項目は `existing agent dir write-back compatibility`、`settings write compatibility`、
`direct execute probe is auxiliary` で、前回と同じ(いずれも必須観測外)。

## 含まれるファイル

| ファイル | サイズ | 内容 |
|---|---|---|
| `official/result.json` | 38,863 B | 公式 artifact 実行の結果 JSON(赤化済み)。`data` に各項目の観測、`logs` に実行コマンドと出力 |
| `official/managed-pi-compat-result.md` | 6,796 B | 同じ実行の人が読める要約(定義文・5 ラベル内訳・`Note:` の但し書き付き) |
| `fixture/managed-pi-compat-result.md` | 7,964 B | fixture 実行の要約のみ。fixture 結果は互換性の証拠にならないため JSON は置いていない(前回の判断を踏襲) |
| `official-auto-usage.json` | 740 B | `spirits/auto` の親が公式 Pi で残した `rlm_usage` の 1 件(一時 session ID は赤化) |
| `fork-route.json` | 3,988 B | fork 経路 3 ケース。`forkSha256` に使用した実行ファイルの SHA256 |
| `fork-route-probe.ts` | 7,356 B | 上記を実行したスクリプト(一時 HOME・隔離 agent dir・local fake provider のみ) |

`run.log` は置いていない。リポジトリの `.gitignore` が `*.log` を対象にしているためで、内容は次の通り
(詳細ログは結果 JSON の `logs` に入る)。official は 170 B、fixture のランナー stdout は同じ形。

```text
# official
Compatibility result: <out>/official/result.json
confirmed=29 limited=0 unavailable=0 not-run=3 failed=0
mode=official runnerCompleted=false compatibilityMet=true

# fixture
Compatibility result: <out>/fixture/result.json
confirmed=19 limited=3 unavailable=0 not-run=10 failed=0
mode=fixture runnerCompleted=false compatibilityMet=false
```

## 実行コマンド

```sh
# clean worktree(実装コミットを HEAD にする)。node_modules は実体への symlink を並べ、
# git status が clean に見えるようにする(node_modules 自体を symlink にすると未追跡に見える)
git worktree add --detach /tmp/mp2wt HEAD
mkdir -p /tmp/mp2wt/node_modules
for e in <repo>/node_modules/.[!.]* <repo>/node_modules/*; do ln -s "$e" /tmp/mp2wt/node_modules/; done

bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out /tmp/mp2-build
# artifact root は公式 tarball と、新しい bundle の sha を載せた manifest を並べる
cp /tmp/mp2-build/spirits-managed-pi-manifest.json /tmp/mp2-artifact/manifest.json
ln <staged>/pi-linux-x64.tar.gz /tmp/mp2-artifact/pi-linux-x64.tar.gz

# official
cd /tmp/mp2wt && bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root /tmp/mp2-artifact \
  --bundle /tmp/mp2-build/spirits-managed-pi-extension.js \
  --commit "$(git rev-parse HEAD)" --bundle-version 0.1.0 \
  --out <out>/official/result.json

# fixture(一時的な managed root に RPC を話す fixture set をインストールして実行)
bun /tmp/mp2-fixture-run.ts <out>/fixture/result.json

# fork 経路
bun scripts/build-binaries.ts --version 0.1.0
SPIRITS_FORK_BINARY=<repo>/dist/spirits-linux-x64 bun evidence/fork-route-probe.ts
```

## 環境

実行セッションの `SPIRITS_*` / `PI_*` は次の通りで、ランナーは起動ごとにこれを引き継がない env を
組み立てる(`runner.env()` が PATH・一時 HOME・XDG・隔離 agent dir だけを渡し、`computeManagedEnv` が
`SPIRITS_CODING_AGENT_DIR` を隔離 agent dir に固定する)。

```text
PI_APP_NAME=spirits
PI_CODING_AGENT=true
PI_MODEL=<local model name>
PI_PROVIDER=Local
PI_REASONING_LEVEL=xhigh
PI_SESSION_FILE=<session path>
PI_SESSION_ID=<session id>
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
SPIRITS_CODING_AGENT_DIR=/home/betiz/.spirits/agent
```

## 秘密情報とユーザーデータ

実行は一時 HOME・隔離 agent dir・ローカルの fake provider だけを使い、実認証・実 provider・実
`~/.spirits/agent` を読んでいない。ランナーは保存前に API キー・トークン・proxy 認証をマスクする。
加えて保存前に `sk-`、`Bearer `、`api_key`、`AKIA` のパターンで走査し、該当 0 件を確認した
(`rg -n "sk-|Bearer |api_key|AKIA" openspec/changes/fix-managed-rlm-child-model/evidence` は終了コード 1)。
`token` / `password` を足すと `"tokens"`(usage のキー)と "fake bearer token" という文言がヒットするが、
値は入っていない。残る絶対パスは一時ディレクトリ(`/tmp/mp2-*`、`/tmp/spirits-managed-compat-*`)、
bun 実行ファイルのパス、`fork-route.json` の `fork`(ビルドした fork 実行ファイルのパス)だけである。
