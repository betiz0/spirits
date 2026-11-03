# managed-pi 実験経路

`spirits managed-pi` は、公式 Pi の固定成果物と事前 bundle した spirits 拡張を 1 組として導入し、通常の `spirits` とは別に起動する実験経路である。既定経路ではない。通常の `spirits`、`spirits update`、install.sh、`~/.spirits/bin`、`~/.spirits/agent` の契約は変更しない。

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
- 引数なしまたは `--` 以降: 管理された Pi を絶対パスで起動する。PATH 上の `pi` や既定の compiled spirits へ fallback しない。
- `help`: この経路の wrapper help を表示する。Pi の help は `spirits managed-pi --help` または `spirits managed-pi -- --help` で起動する。

未導入、破損、checksum 不一致、非対応プラットフォームでは理由と `spirits managed-pi install` を表示して非ゼロで終了する。

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
```

導入と更新は同じ managed root 内の `.spirits-tmp-<pid>` で行い、全 checksum の検証後に `releases/` へ移す。`current` は symlink の rename で切り替える。失敗時は一時ディレクトリだけを削除し、旧 set を起動可能なまま残す。

ロールバックは実験経路を終了して `~/.spirits/managed-pi` を削除する。既定の `spirits` とそのデータはそのまま残る。`install` と `update` は `~/.spirits/bin` と `~/.spirits/agent` を置換しない。

## identity と保存先

overlay `package.json` は公式 artifact の `name` と `version` を保ち、`piConfig` を次のようにする。

```json
{ "piConfig": { "configDir": ".pi", "name": "spirits" } }
```

wrapper は起動前に次を設定する。

- `SPIRITS_CODING_AGENT_DIR`: 明示値があれば保持し、なければ `~/.spirits/agent`。
- `PI_CODING_AGENT_DIR`: 子プロセス環境から除去する。
- `PI_PACKAGE_DIR`: 管理された Pi の package dir に固定する。
- `PI_SKIP_VERSION_CHECK=1`、`PI_TELEMETRY=0`: 通常起動と同じ既定。明示された telemetry 値は保持する。
- API キー、proxy、provider 設定などその他の環境変数は保持する。

起動は `<managed root>/current/pi/pi` を絶対パスで spawn し、stdio と終了コードを引き継ぐ。

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

## 互換性ランナー

```sh
bun scripts/managed-pi-compat/run.ts --artifact-root /tmp/managed-pi-fixture
```

`--artifact-root` には測定対象の managed root を明示する。未指定時は `~/.spirits/managed-pi` を参照し、set が無ければプロセス項目を `not-run` にする。ランナーは一時 HOME、一時 agent dir、一時作業ディレクトリ、一時 managed root を用意する。実 `~/.spirits/agent` などのユーザーデータは読み書きせず、PATH 上の `pi` も使わない。managed root の読み取りは明示指定または既定の `~/.spirits/managed-pi` に限り、書き込みは一時コピーに対してのみ行う。結果は JSON に書き、各項目を次のいずれかで記録する。

- `confirmed`: 条件を満たすことを実測した。
- `limited`: 一部だけ動作する、または既知の制約がある。
- `unavailable`: その機能が存在しない。
- `not-run`: artifact 不在などで実行していない。成功として扱わない。
- `failed`: 実行したが失敗した。

実行方法と後始末: ランナーは自分が作った一時ディレクトリだけを削除する。公式 artifact が無い環境では該当項目は `not-run` になり、全体は成功にならない。実 provider の API キーは読まず、外部の推論 API も呼ばない。

実装範囲: managed set がある場合、ランナーは専用 Pi を RPC で起動して probe 拡張を読み込み、`session_start` 後のツール一覧でロードを判定する。同じ実行で agent dir と package dir、API キーと proxy、書き出された `SKILL.md`、host の版を観測する。tsrepl のセル、fake provider 経由のツール呼び出し、rlm 子セッションは probe コマンドから専用 Pi 内で実行する。既存データは redact fixture の一時コピーだけを読み、書き込み互換は aborted の理由付き `limited` として記録する。managed set が無い場合、または観測できない場合は各項目を `not-run` にし、`confirmed` にしない。

### 拡張ロード

`--help` の終了コードだけでは判定しない。RPC の `session_start` 後に `tsrepl` がツールとして存在することを確認する。`--help` が 0 でも拡張ロードの証拠にはならない。

### tsrepl のセル実行

probe 拡張は `pi.registerTool` を包んで登録済み `tsrepl` を捕捉し、probe から `execute` を直接呼ぶ。これにより `return 1 + 1`、`Bun.Transpiler`、`node:vm` を使うセルを実行する。

- **セル実行の確認**: 値の返却と TypeScript 変換、vm 実行の成否。
- **Pi のツール権限経路の確認**: 別項目。probe の直接呼び出しは権限と hook を迂回するため、その結果を権限経路の確認として扱わない。

### rlm 子セッション

物理モデルを選ぶ親と `spirits/auto` を選ぶ親を別項目にする。物理モデルでは子の生成、最終回答、`rlm_usage`、中断を確認する。`spirits/auto` の子は仮想モデルを解決できたかを記録し、失敗は既知の制約として `limited` にする。fake provider の成功は実 provider の互換性確認ではなく、実 provider を使うテストはこの change の対象外である。

### 既存データ

redact した agent dir のコピーで settings、auth、sessions、外部拡張の読み取りを確認する。実 `~/.spirits/agent` は変更しない。読み取り成功を書き込み互換の成功として扱わない。破壊的な変換が必要な書き込みは中止する。

### アセットと環境

同梱 `SKILL.md` が raw Markdown として bundle に含まれること、`SPIRITS_CODING_AGENT_DIR` の優先、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の decoy 耐性、`--help` が隔離 HOME の外を変更しないこと、API キーと proxy が残ることを確認する。bundle 内の host 版が専用 Pi artifact の版と一致し、別 SDK の版を報告しないことも確認する。
