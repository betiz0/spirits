# managed-pi 実験経路

`spirits managed-pi` は、公式 Pi の固定成果物と事前 bundle した spirits 拡張を 1 組として導入し、通常の `spirits` とは別に起動する実験経路である。既定経路ではない。実験期間中の保存先は `<managed root>/agent`(既定は `~/.spirits/managed-pi/agent`)に固定し、既存の `~/.spirits/agent` は読み書きしない。通常の `spirits`、`spirits update`、install.sh、`~/.spirits/bin`、`~/.spirits/agent` の契約は変更しない。

## コマンド

```sh
spirits managed-pi install [--version <pi-version>]
spirits managed-pi update
spirits managed-pi repair
spirits managed-pi -- [pi の引数...]
spirits managed-pi help
```

- `install`: 最新の spirits release から manifest を取得し、記録された Pi artifact、拡張 bundle、アセットを取得・検証して `~/.spirits/managed-pi/releases/<set-id>/` に配置する。成功時だけ `current` を切り替える。
- `update`: 新しい manifest を取得して同じ検証付き導入を行う。完了するまで `current` は旧 set を指す。
- `repair`: 導入済み set の manifest を使って同じ組を再導入する。bundle の欠落や破損から復旧する。
- 引数なしまたは `--` 以降: 管理された Pi を絶対パスで起動する。PATH 上の `pi` や既定の compiled spirits へ fallback しない。起動前に隔離 agent dir を確定し、既存 agent dir には触れない。
- `help`: この経路の wrapper help を表示する。Pi の help は `spirits managed-pi --help` または `spirits managed-pi -- --help` で起動する。

未導入、破損、checksum 不一致、非対応プラットフォームでは理由と `spirits managed-pi install` を表示して非ゼロで終了する。隔離 agent dir のパス検査または起動引数の拒否でも非ゼロで終了し、通常経路へは fallback しない。

## 対応表 (manifest)

manifest は release 資産 `spirits-managed-pi-manifest.json` として配布し、次の項目を持つ。

- `schemaVersion`: 形式版。現在は `1`。
- `setId`: release set の識別子。`releases/<set-id>/` の名前になる。
- `platform`: 対応プラットフォーム。現在は `linux-x64` のみ。
- `pi.version`: 専用 Pi の版。
- `pi.artifact.url` / `pi.artifact.sha256`: 公式 Pi artifact の取得元と SHA256。
- `extension.version`: spirits 拡張 bundle の版。
- `extension.artifact.url` / `extension.artifact.sha256`: bundle の取得元と SHA256。
- `overlay.version` / `overlay.sha256`: 生成する overlay `package.json` の版と SHA256。
- `assets`: 追加アセットの `name`、`url`、`sha256`。

最初の対応 set は Pi `1.5.0`、Linux x64、公式 `pi-linux-x64.tar.gz`、SHA256 `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b`。manifest を更新するときは `scripts/build-managed-pi-inputs.ts` で bundle と manifest を同時に生成し、Checksum を release 資産へ添付する。`spirits-v*` の既定配布物 (`spirits-linux-x64` と `theme/`) とは別の資産であり、install.sh や自己更新の対象ではない。

## 配置とロールバック

```text
~/.spirits/managed-pi/
  releases/<set-id>/
    pi/
    spirits-extension.js
    manifest.json
    installed.json
  current -> releases/<set-id>
  agent/            # 実験専用の隔離 agent dir (0700)
    sessions/
```

導入と更新は同じ managed root 内の `.spirits-tmp-<pid>` で行い、全 checksum の検証後に `releases/` へ移す。`current` は symlink の rename で切り替える。失敗時は一時ディレクトリだけを削除し、旧 set を起動可能なまま残す。

隔離 agent dir を作成するのは Pi 起動経路だけである。`install`、`update`、`repair`、wrapper の `help` は既存 agent dir と隔離 agent dir のどちらを作成・変更しない。これら release 操作は `releases/` と `current` だけを扱う。

安全な実験開始は `SPIRITS_CODING_AGENT_DIR` を未設定のまま `spirits managed-pi install` を実行し、続けて `spirits managed-pi` を起動する。リセットは実験経路を終了してから `~/.spirits/managed-pi/agent` を削除する(managed root 全体を削除してもよい)。どちらでも `~/.spirits/agent` は削除されない。ロールバックは実験経路を終了して `~/.spirits/managed-pi` を削除すること。既定の `spirits` とそのデータはそのまま残る。`install` と `update` は `~/.spirits/bin` と `~/.spirits/agent` を置換しない。

## 隔離 agent dir と起動前ガード

実験期間中、managed 経路の保存先は `<managed root>/agent`(既定は `~/.spirits/managed-pi/agent`)に固定する。既存の `~/.spirits/agent` は読み書きせず、通常の `spirits` 経路だけがそれを使う。自動コピー・移行・同期・バックアップ・削除は行わず、force や警告承認でこの判定を解除する機構もない。

Pi を spawn する前に次を拒否し、理由・固定の隔離 agent dir・拒否した値または引数・既存 agent dir を変更していない旨・安全な開始手順・fallback しない旨を表示して非ゼロで終了する。拒否時に隔離 agent dir は作成しないし、通常経路へ fallback もしない。

| 拒否 | 表示する理由 |
|---|---|
| 隔離 agent dir が既存 agent dir と一致、または一方が他方を包含 | `existing agent directory containment` |
| 隔離 agent dir の経路に symlink が含まれる | `symlink in the managed agent path` |
| 解決結果が managed root の外へ出る | `outside the managed root` |
| 隔離 agent dir がディレクトリ以外の実体として存在する | `not a directory` |
| 既存の隔離 agent dir が現在のユーザー所有でない(プラットフォームが所有権を公開する場合) | `owned by another user` |
| `SPIRITS_CODING_AGENT_DIR` が固定の隔離 agent dir と異なる(相対パス・`~` 指定・managed root 外を含む) | `explicit agent directory is not the managed agent directory` |
| 既存データや外部 session を指せる引数 | `unsupported managed-pi argument` と引数名 |

明示指定は受理しない。`SPIRITS_CODING_AGENT_DIR` は正規化とパス安全性の検査の後、固定の隔離 agent dir と実体パスが一致する場合だけ受け付ける。wrapper が通常経路向けに注入する既定値は明示指定ではない。この区別のため、wrapper は `applyEnvDefaults()` より前に環境の独立コピーを取得し、managed コマンドへはそのコピーだけを渡す(通常経路は既定適用後の `process.env` を使う)。

拒否する引数は `--session`、`--fork`、`--session-dir`、`--export`。これらは既存 session や隔離領域外の保存先を指せる。`--continue`、`--resume`、`--session-id`、`--no-session` は固定した隔離 session dir の範囲に収まるため許可する。引数の書き換えはしない。

このガードは起動前のパス検査であり、OS レベルのサンドボックスではない。検査後のファイルシステム変化、`bash` / `read` / `write` / `edit`・拡張機能・`@file`・絶対パスによる任意のファイルアクセスは制限しない。保護の対象は agent dir と session dir の選択に限る。

## identity と保存先

overlay `package.json` は公式 artifact の `name` と `version` を保ち、`piConfig` を次のようにする。

```json
{ "piConfig": { "configDir": ".pi", "name": "spirits" } }
```

wrapper は起動前に次を設定する。値は解決済みの隔離 agent dir から計算し、呼び出し側の agent dir 指定は読まない。

- `SPIRITS_CODING_AGENT_DIR`: `<managed root>/agent` に固定する。
- `SPIRITS_CODING_AGENT_SESSION_DIR`: `<managed root>/agent/sessions` に固定する。
- `PI_APP_NAME`: `spirits` に固定する。
- `PI_CONFIG_DIR`: `.pi` に固定する。
- `PI_CODING_AGENT_DIR` と `PI_CODING_AGENT_SESSION_DIR`: 子プロセス環境から除去する。
- `PI_PACKAGE_DIR`: 管理された Pi の package dir に固定する。
- `PI_SKIP_VERSION_CHECK=1`: 常に固定する(呼び出し側の値は上書きし、通常起動と同じ扱い)。
- `PI_TELEMETRY=0`: 未設定時だけ既定する。明示された値は保持する。
- API キー、proxy、provider 設定など保存先と identity 以外の変数は保持する。

session dir を環境で固定するのは、継承値やプロジェクトの `settings.sessionDir` が隔離領域外へ保存先を切り替えられないようにするためである。起動は `<managed root>/current/pi/pi` を絶対パスで spawn し、stdio と終了コードを引き継ぐ。

## 既存データの書き込み互換は未確認

この change は既存 `~/.spirits/agent` の書き込み互換を実証していない。互換性ランナーは専用 Pi の拡張 API 経由でだけ書き込みを行う。settings の永続書き込みのように API が届かない項目は `not-run` にし、Node によるファイル読み書きで代用しない。代替経路で得た成功を互換性の成立として記録することもしない。本番移行や既存データの継続利用には、読み書き両方向を別 change で実証する必要がある。

過去記録の訂正は [openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md](../openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md) に残す。元のチェックボックスは書き換えていない。

## 拡張 bundle の契約

`scripts/build-managed-pi-inputs.ts` は `packages/spirits/src/index.ts` を ESM bundle にし、次の host package を external に保つ。

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

host の実体を bundle に含めないのは、rlm の子セッションが親と同じ SDK、SessionManager、config を使うためである。Markdown は文字列として埋め込み、公式 Pi の loader に `with { type: "text" }` を残さない。bundle の checksum は manifest と release 資産の checksum に現れる。

## role / `/clear` / `/model` の限定互換モード

公式 Pi 1.5.0 には `registerModelRoles` がない。spirits 拡張は API の有無を起動時に判定し、ある場合は既存の role 登録を使う。ない場合は仮想モデル `spirits/auto`、skill に基づく strong フェーズ、設定からの既定 role 読み取りを残し、role 登録だけを省略する。起動時に一度だけ制限内容を通知し、role バッジや `/model ... role` が利用可能であるかのようには表示しない。

| 目的 | 現行機構 | 専用経路 | 代替 / 差異 |
|---|---|---|---|
| review などを strong へ自動振り分け | `spirits/auto`、skill フェーズ、`models.strong` | 制限付き (仮想モデルと strong フェーズは動く) | 拡張コマンドと独自 status line。`/model` role、保存キー、route の role、badge はない |
| normal / strong の固定 | `/model` role suffix と role 登録 | 利用不可 | `/spirits-role` など明示コマンド。操作と保存キーが異なる |
| 最後の role を表示 | core footer badge | 利用不可 | 拡張の status line。配置と永続化が異なる |
| 会話だけを消す `/clear` | core `clearConversation()` | 利用不可 | 同一セッション ID を保つ限定 patch、または「新規セッション」への再定義。後者は同一 ID と履歴を失う |
| model と thinking level | core `/model` parser と保存キー | 制限付き | 拡張コマンドと独自保存。補完と hint が異なる |
| model + level + role | core parser と role 語彙 | 利用不可 | 限定 patch または role 選択の分離。UX と保存キーが異なる |

「利用可」は専用経路で同等に動作、「制限付き」は一部の目的だけ維持、「利用不可」は同等の機能がない状態を指す。この change は既定経路の機能を削除しない。既存の `openspec/specs/` の要件は変更しない。

互換性ランナーはこの表を専用 Pi での目的別観測で上書きする。コマンド一覧にコマンドが掲載されていないことだけで組み込み機能の不存在を判定せず、観測できない目的は `not-run` にする。各目的の状態は結果 JSON の `role/clear/model matrix` 項目に記録する。

## 互換性ランナー

```sh
# fixture モード(既定): 隔離した managed root の fixture set を測る
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root /tmp/managed-pi-fixture

# official モード: 公式 artifact を検証し、対象 commit の bundle で測る
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged-official-artifact-root> \
  --bundle <target-commit-bundle.js> \
  --commit <sha> \
  --bundle-version <version> \
  --out <tmp>/result.json
```

- `--mode` は `fixture`(既定)か `official`。全結果に `mode` が付き、fixture の結果は `fixture-only` として記録される。fixture の成功を公式 Pi の互換性成立の根拠にしない。
- `official` では `--artifact-root`(`manifest.json` と公式 tarball を置いたステージング領域)、`--bundle`(対象 commit からビルドした拡張 bundle)、`--commit`(対象 commit)が必須。manifest の `pi.artifact.sha256` が製品の信頼基準 `MANAGED_PI_FIRST_ARTIFACT_SHA256` と一致しない場合、結果を書かず非ゼロで終了する。
- ランナーは一時 HOME、一時 agent dir、一時作業ディレクトリを用意し、製品の `resolveManagedAgentPaths` / `ensureManagedAgentDir` で隔離 agent dir を解決する。実 `~/.spirits/agent` などのユーザーデータは読み書きせず、PATH 上の `pi` も使わない。
- 結果は JSON と、その隣に `managed-pi-compat-result.md` の要約を出力する。通常実行でリポジトリの `docs/` を書き換えない。
- 保存前に API キー・トークン・proxy 認証をマスクする。
- 終了コードは `failed` がある場合、または official で `compatibilityMet` が false の場合に 1。

### 結果の読み方

結果 JSON は各項目を `confirmed` / `limited` / `unavailable` / `not-run` / `failed` で記録し、`runnerCompleted` と `compatibilityMet` を区別する。

- `runnerCompleted`: 全項目を処理したか。`not-run` が残る場合は false。
- `compatibilityMet`: official で必須観測がすべて `confirmed` の場合だけ true。`failed=0` でも必須観測が `not-run` または `limited` なら false。fixture モードでは常に false。
- `observationEvidence`: 観測項目と期待する証拠の対応表。
- `runtime`: ランナー側と Pi ホスト側のランタイム、必要 API の有無。観測できない値は `unknown`。
- `logs`: 実行した各項目のコマンドと、取得できた stdout・stderr。長い出力は切り詰めて保存する。
- `existingAgentDirUnchanged`: 一時 HOME の `~/.spirits/agent` に赤化した fixture を置き、全起動の前後で内容と更新時刻が変わっていないことを指紋比較で確認した結果。要約にも 1 行出す。

### 詳細ログ・JSON の保管と再実行

結果 JSON と `managed-pi-compat-result.md` は `--out` で指定した場所に出力する。CI では JSON、要約、必要なログを artifact として保管する。リポジトリへ残す要約は、検証後に対象結果を選んで記録する別操作とする。

再実行:

```sh
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture-root> --out <tmp>/result.json
bun scripts/managed-pi-compat/run.ts --mode official --artifact-root <artifact-root> --bundle <bundle> --commit <sha> --out <tmp>/result.json
```

結果の各項目は次のいずれかで記録する。

- `confirmed`: 条件を満たすことを実測した。
- `limited`: 一部だけ動作する、または既知の制約がある。
- `unavailable`: その機能が存在しない。
- `not-run`: artifact 不在などで実行していない。成功として扱わない。
- `failed`: 実行したが失敗した。

実行方法と後始末: ランナーは自分が作った一時ディレクトリだけを削除する。公式 artifact が無い環境では該当項目は `not-run` になり、全体は成功にならない。実 provider の API キーは読まず、外部の推論 API も呼ばない。

実装範囲: managed set がある場合、ランナーは専用 Pi を RPC で起動して probe 拡張を読み込み、`session_start` 後のツール一覧でロードを判定する。同じ実行で agent dir と package dir、API キーと proxy、書き出された `SKILL.md`、host の版を観測する。tsrepl のセル、fake provider 経由のツール呼び出し、rlm 子セッションは probe コマンドから専用 Pi 内で実行する。既存データは専用 Pi の `pi.getSettings()` / `ctx.sessionManager.getEntries()` で読み、`pi.appendEntry()` / `pi.setModel()` / `pi.setThinkingLevel()` で書き込んで読み戻す。Node によるファイル読み取りは行わない。managed set が無い場合、または観測できない場合は各項目を `not-run` にし、`confirmed` にしない。

### 拡張ロード

`--help` の終了コードだけでは判定しない。RPC の `session_start` 後に `tsrepl` がツールとして存在することを確認する。`--help` が 0 でも拡張ロードの証拠にはならない。

### tsrepl のセル実行

一次確認は通常のモデル→ツール経路で行う。fake provider が `tsrepl` をツール呼び出しし、Pi の通常の権限・フック経路で実行する。ランナーは RPC の `tool_execution_start` / `tool_execution_end` とツール結果を観測する。`return 1 + 1`、`Bun.Transpiler`、`node:vm` を使うセルを実行し、値の返却と TypeScript 変換、vm 実行の成否を確認する。

補助項目(`direct execute probe is auxiliary`)は `pi.getAllTools()` で `tsrepl` が登録されているかを観測する。公式 Pi は拡張ごとに別の API オブジェクトを与えるため、probe 拡張が `registerTool` を包摂しても他の拡張のツール定義には届かない。よって direct `execute` の根拠は取れず、公式実行では理由付きで `not-run` になる。この項目は通常経路の確認ではなく、成功しても `bypassedPiHooks: true` を付ける。

### rlm 子セッション

物理モデルを選ぶ親と `spirits/auto` を選ぶ親を別項目にする。子は親の model を継承するため、`settings.json`(`models.strong`、`models.role`、`defaultProvider`、`defaultModel`)、`auth.json`(fake provider の認証)、`models.json`(fake provider の registry)を書く。書き先は spirits の隔離 agent dir だけではない。子セッションは拡張を読まず agent dir をホスト自身の解決(`PI_CODING_AGENT_DIR`、未設定なら `<home>/.pi/agent`)で引くため、そのディレクトリにも同じファイルをおく。親と違い、子には fake provider をプログラム登録する拡張がないため、認証とプロバイダ表はファイルからしか届かない。子の生成・最終回答・`rlm_usage`・中断を個別に記録する。中断は子のリクエストを遅延させ、セルが `rlm` の内部で待っている間に RPC の abort を送って `rlm_usage` の `outcome` を観測する。観測できない場合は `not-run` にし、他の項目の判定を変えない。現状は abort 自体はセルに届くが、子の最中に呼び出し元が中断されたとき `rlm_usage` の記録が残らないため、`rlm child abort` は `not-run` になる。これはランナーの不足ではなく製品側の確認待ち事項として報告する。再現条件・証拠・影響は [openspec/changes/repair-managed-pi-compat-harness/product-defect-rlm-usage-abort.md](../openspec/changes/repair-managed-pi-compat-harness/product-defect-rlm-usage-abort.md) にまとめた。fixture は親のリクエストにはツール呼び出し、子のリクエストにはテキストで応じ、子が `rlm` を再帰的に呼び出さないようにする。`spirits/auto` を選ぶ親は別項目として記録し、成功として扱わない。子セッションは拡張を読まないため、仮想モデルの route はそこで再現できない。解決できない場合はそのエラーをそのまま `limited` の理由に残す。fixture 不足が原因の失敗は `not-run` または `limited` として記録し、製品不具合と断定しない。fake provider の成功は実 provider の互換性確認ではなく、実 provider を使うテストはこの change の対象外である。

### 既存データ

redact した既存 agent dir の fixture(`scripts/managed-pi-compat/fixtures/redacted-agent/`)を隔離 agent dir にコピーし、その保存先を専用 Pi に読ませる。読み取りは settings と sessions を `pi.getSettings()` と `ctx.sessionManager.getEntries()`、auth を `ctx.modelRegistry.getProviderAuthStatus()`、外部拡張はその拡張が登録したコマンドを `pi.getCommands()` で観測する。外部拡張の読み取りだけ、host が agent dir の拡張を読むことを許す起動(`--no-extensions` を付けない)を使う。他の項目は誤読を防ぐため `--no-extensions` のままにする。API から届かない項目は `not-run` にする。Node によるファイル読み取りは行わない。

書き込みは `pi.appendEntry()`、`pi.setModel()`、`pi.setThinkingLevel()` で行い、`getEntries()` / `ctx.model` / `ctx.getThinkingLevel()` で読み戻す。この項目名は `dedicated Pi write path` で、専用 Pi の書き込み経路の実測である。既存 agent dir のデータに変換をともなう書き戻しが出来るか(`existing agent dir write-back compatibility`)は別項目のままにし、書き込み経路の成功をそのまま引き継がない。現状は `not-run` であり、未確認であることを結果に残す。settings の永続書き込みが Pi の拡張 API から届かない場合は、その項目を `not-run` にし、Node のファイル書き込みで代用しない。

保存先の解決は製品の `resolveManagedAgentPaths` と `ensureManagedAgentDir` を使う。拒否対象のパス指定は spawn 前に失敗し、隔離領域では `SPIRITS_CODING_AGENT_DIR` を経由せずに product guard が決めた dir だけを触る。書き出された `bundled-skills` が隔離 agent dir 配下に着ることも確認し、保存先が実際に使われている証拠にする。RPC の agent dir は環境変数のエコーに過ぎないため、これ自体を根拠にしない。一時 HOME の `~/.spirits/agent` には赤化した fixture を置いておき、全起動の前後で内容と更新時刻が変わっていないかを指紋比較して `existingAgentDirUnchanged` に記録する。

### アセットと環境

同梱 `SKILL.md` が raw Markdown として bundle に含まれること、`SPIRITS_CODING_AGENT_DIR` の隔離 agent dir への固定、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の decoy 耐性、`--help` が隔離 HOME の外を変更しないこと、API キーと proxy が残ることを確認する。bundle 内の host 版が専用 Pi artifact の版と一致し、別 SDK の版を報告しないことも確認する。

### role / clear / model

role、`/clear`、`/model` の目的を専用 Pi で個別に観測する。role は skill コマンドで strong フェーズに入ったリクエストがどの物理モデルで流れたかを fake provider の受信リクエストから読む。`/clear` は probe 拡張が実行前に session ID・会話エントリ数・TODO エントリ数をファイルに記録し、コマンド実行後に読み戻して比較する。`/model` は thinking level と model の変更を実行し、変更結果と保存済みの既定設定キーを読み戻す。コマンド一覧に掲載されていないことだけで組み込み機能の不存在を判定せず、観測できない目的は `not-run` にする。各目的の状態は `available` / `limited` / `unavailable` / `not-run` で記録し、利用不可の項目には代替案と差異を付ける。

マトリクスの行は目的観測から導出する。観測しなかった目的の行は `unavailable` ではなく `not-run` になり、行と目的の状態が矛盾しないことを検証関数で確認する。ターミナル上の表示など RPC 読み取りできない目的は `not-run` のままにする。
