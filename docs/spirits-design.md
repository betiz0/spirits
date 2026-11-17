# spirits 設計書

- プロジェクト名: **spirits**
- コマンド名: `spirits`
- 版: v0.5
- 更新日: 2026-11-17
- ライセンス: MIT
- ステータス: 設計確定 (ホストは公式 Pi の固定 artifact、単一の managed 経路)

---

## 1. 目的と位置づけ

spirits は、エージェント型コーディングツール **Pi**(`earendil-works/pi`)の**公式配布物の上で動く拡張 bundle と薄い起動役**であり、Prime Intellect の **Prime Agent** が Python(IPython カーネル + RLM + Continual Harness)で実現している実行モデルを、**TypeScript / Bun ネイティブで再実装**する。Pi のソースはリポジトリに含めない。実行時に使うのは `~/.spirits/managed-pi` に導入した公式 Pi の固定リリースで、コンパイルした `spirits` はその一式を検証してから spirits 拡張をロードして起動する。

設計目標:

1. モデルとの主インターフェースを「永続 TypeScript REPL(1ツール)」とする code-as-action 構成
2. REPL 内から子エージェントを起動できる `rlm()` 相当の再帰機構(Phase 1 は同期呼び出し)
3. プロンプト / スキル / メモリをエージェント自身が更新できる Continual Harness 相当の自己改善機構
4. ホスト固有の仮定を 1 か所 (`src/managed-pi/host.ts` の記述子と `PINNED_PI`) に集め、ホストの版更新と差し替えをデータの変更として行えるようにする

非目標:

- IPython / Jupyter プロトコルとの互換性(参考実装として読むのみ)
- セキュリティサンドボックスの提供(分離はサンドボックスではない)
- Pi 本体へのソース差分(ホストのソース差分は常に 0。挙動は拡張 API と `piConfig.name` の overlay で寄せる)
- Node.js ランタイムのサポート(Bun 専用。Node はロックファイル gate と数本のスクリプトだけ)
- npm パッケージとしての配布(§4.5 のコンパイルバイナリ配布に一本化)
- **macOS / Windows 向けバイナリ(Linux x86_64 のみ)**

## 2. 前提と確定事項

| 項目 | 内容 | 状態 |
|---|---|---|
| ランタイム | Bun のみ。最低 >= 1.4.0、推奨 >= 1.4.2 | 確定 |
| ホスト | 公式 `@earendil-works/pi-coding-agent` の配布物 (現在 1.5.0) を `~/.spirits/managed-pi` に導入して起動する。ソースは持たない | **確定(v0.5)** |
| 型検査 | devDependencies に公式パッケージを完全 pin し、`tsc --noEmit` でホストと同じ宣言に対して検査する。手写しの型宣言は置かない | **確定(v0.5)** |
| 実装方式 | 拡張(Extension)+ 起動役のみ。ホストのソース差分は 0 | 確定 |
| 参照実装 | Prime Agent(MIT)のアーキテクチャを TS に移植。コードコピーはしない | 確定 |
| 配布形態 | `bun build --compile` による起動役 + `curl install.sh`。初回起動で固定したホスト一式を取得する。ターゲットは Linux x86_64 のみ | **確定(v0.2/v0.3/v0.5)** |
| rlm() の実行形態 | Phase 1 は同期呼び出しで開始。非同期 fan-out は M5 で採否判断 | **確定(v0.2)** |
| lockfile | root の `bun.lock` 1 本。workspace は `packages/spirits` のみ | **確定(v0.5)** |
| 依存の年齢 gate | `bunfig.toml` の `[install] minimumReleaseAge` (既定 172800 秒)。npm の `min-release-age` を Bun は読まない (実測) | **確定(v0.5)** |
| ライセンス | MIT | **確定(v0.2)** |
| 対応プロバイダ | ホストが対応する全プロバイダに委譲(spirits 側で制限しない) | 確定 |

実行環境に関する根拠:

- Bun 1.4.0(2026-08-19 リリース)で Node.js 26.3.0 互換を目標とする大幅な互換性向上が入り、`node:vm` は `vm.Script` / `vm.createContext` / `vm.runInContext` 等が公式互換性ページ上「完全実装」とされる。
- ただし Bun の API リファレンス個別ページには「experimental VM modules は未実装」との古い記述が残っており、**`vm.SourceTextModule` / `importModuleDynamically` は実機検証を必須**とする。
- Bun 1.4.2(2026-09)で「長時間稼働プロセスでの JIT クラッシュ」「`AsyncLocalStorage` のリーク」等が修正。永続 REPL を抱える長時間プロセスという spirits の性質上、**開発 CI のベースラインは 1.4.2** とする。
- Bun 1.4 系の `bun build --compile` は安定しており、Pi 上流自体がコンパイル Bun バイナリを配布している実績がある。spirits はこの経路をそのまま利用する。

## 3. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ ~/.spirits/bin/spirits  (起動役、Pi のソースを含まない)   │
│  ├─ managed の一式を検証 → current/pi/pi を spawn        │
│  ├─ 環境の既定値 (agent dir、テレメトリ無効化)          │
│  └─ 自己更新 (実行ファイル → その版の managed 一式)     │
│        │ -e current/spirits-extension.js                 │
│        ▼                                                 │
│ 公式 Pi (managed-pi/current/pi/pi、変更しない)           │
│  ├─ agent loop / LLM プロバイダ I/F                     │
│  ├─ TUI / セッション永続化 (JSONL)                       │
│  └─ Extension API                                        │
│       │ registerTool / registerVirtualModel / appendEntry │
│       ▼                                                  │
│  packages/spirits (拡張 bundle、本プロジェクトの中核)    │
│  ├─ repl/   永続 TS REPL(Bun.Transpiler + node:vm)      │
│  ├─ rlm/    子エージェント起動(SDK createAgentSession)  │
│  ├─ harness/ goal / memory / skill CRUD / code-mode      │
│  ├─ routing/ spirits/auto の role 振り分け               │
│  └─ managed-pi/ update/ (導入・検証・自己更新)          │
└─────────────────────────────────────────────────────────┘
```

配布物は 2 層に分かれる。起動役は `bun build --compile` の単一実行ファイルで、ホストのソースを運ばない。ホストとそのテーマは `~/.spirits/managed-pi` の公式 artifact が提供し、実行ファイルと同じディレクトリには何も置かない。

責務の分離(Prime Agent の設計を踏襲):

- **ホスト(公式 Pi + spirits 拡張)**: プロバイダ呼び出し、セッション永続化、子エージェントのライフサイクル、深度制限、コスト集計、権威ある状態の保持
- **REPL(モデルに見える実行面)**: 作業用変数・状態の保持、ホスト提供関数の呼び出し、標準出力の捕捉

Prime Agent ではホスト(どもの TS)とカーネル(Python)間を Jupyter comm の RPC で接続していたが、spirits では同一 Bun プロセス内のため、**RPC 層は廃し、REPL の vm コンテキストへ async 関数を直接注入**する。

## 4. コンポーネント設計

### 4.1 spirits-repl(永続 REPL)

モデルに公開する主力ツール。`pi.registerTool()` で登録し、パラメータは TypeBox スキーマで `{ code: string, timeout?, description? }`。

実行パイプライン(1セル):

1. **トランスパイル**: `Bun.Transpiler({ loader: "ts", target: "bun" })` の `transformSync()` で TS → JS。外部依存(esbuild/jiti)は持たない
2. **実行**: `vm.createContext()` でセッション開始時に生成した永続コンテキストに対し `script.runInContext()`。トップレベル await はセル全体を async IIFE で包んで吸収し、セルをまたいで残るのは `globalThis` への代入だけとする
3. **戻り値**: `return <式>` または `out(<式>)` の値をツール結果へ返す(Phase 1 の明示方式。最終式の自動捕捉は Phase 2、4.2 参照)
4. **出力捕捉**: コンテキストへ注入した `print()` 等で標準出力をバッファリングし、ツール結果に同梱。上限超過時は truncate(先頭・末尾を残す)
5. **エラー整形**: vm のスタック(`tsrepl-cell.js` のフレーム)を変換後コードの行番号へマップし、「エラー内容 + 次に試すべき修正」の actionable なメッセージに整形して返す(Pi の拡張ガイドラインのエラー指針に準拠)

コンテキストへ注入するホスト関数:

| 関数 | 役割 |
|---|---|
| `rlm(prompt, opts?)` | 子エージェント起動(§4.3)。Phase 1 は同期で最終回答を返す |
| `goal()` / `note(text)` | ゴール表示 / メモリ追記(appendEntry 経由でセッション永続) |
| `use(spec)` | 動的 import ヘルパ(§4.2) |
| `tool(name, args)` | 呼び出し可能なツールの実行(`ctx.executeTool` 経由。`tsrepl` 自身は除く) |

### 4.2 セル評価ルール

段階的に実装する。

- **Phase 1(明示方式)**: 最後に評価したい値を `return` または専用の `out(value)` で返す。import は `const m = await use("mod")` のみ許可。構文解析を持たず堅牢に動く
- **Phase 2(パーサ導入)**: 軽量パーサで末尾の式文を検出し自動で `return (...)` に書き換え。セル先頭の `import` 宣言を検出して `use()` 呼び出しへ変換
- `vm.SourceTextModule` による真の ESM セル実行は、Bun 1.4 系での実機検証が完了するまで採用しない(文書間で実装状況の記述が矛盾するため)

import 許可範囲:

- 許可: 組込モジュール(`node:*`, `bun:*`)、作業ディレクトリ(cwd)配下に収まる相対パス
- 不許可(既定): ベア指定子(バイナリ同梱の依存)、絶対パス、cwd 外、リモート URL。M1 では opt-in を設けない(同梱依存と URL は M2 以降で検討)

### 4.3 rlm(再帰エージェント)

- Pi はサブエージェントを意図的に内蔵しないが、SDK の `createAgentSession()` でプロセス内に独立した `AgentSession` を生成できる。`rlm()` はこれを包む薄いラッパとする
- **Phase 1(同期,確定)**: `await rlm(prompt)` が子の最終回答を直接返す。深度・上限はホスト関数のクロージャに保持し、`opts.maxDepth` はルートからの絶対深度で引き下げのみ(継承値を超える値は継承値へクランプ)。深度が上限以上のセッションからの呼び出しは、上限値を含むガイダンス付きエラー
- 子は `SessionManager.inMemory()` で生成し、cwd とモデル(親に thinking level があればそれも)を継承する。子の有効ツールは `tsrepl` だけで、拡張・skill・プロンプトテンプレートは読み込まず、AGENTS.md などのコンテキストファイルは読み込む。認証は親と同じエージェントディレクトリと環境変数に限り、`--api-key` と拡張が登録したプロバイダは継承しない
- 同じ REPL からの `rlm` は直列に実行する。親セルの abort(timeout を含む)は子へ伝播し、abort の完了を待ってから子を破棄する
- 1 呼び出しあたりの子のモデル発行ツール呼び出しは既定 50 回で打ち切り、部分テキスト付きの途中結果サマリを返す
- コスト・トークン集計は `rlm_usage` カスタムエントリとしてルートセッションへ記録する(`depth` は子の深度、`tokens` / `cost` / `durationMs` / `outcome` を持つ)
- **Phase 2(非同期 fan-out)**: Prime Agent 流の「即時ハンドル返却 + 後から `agent_message` で回収」。採否は M5 で Phase 1 の使用実感を見て判断する

### 4.4 Continual Harness 相当

「エージェントが自分のプロンプト / スキル / メモリを改善できる」機構を、Pi の既存機構の組合せで実装する(M4 で確定。詳細は `spirits-m4-harness.md`):

- **メモリ**: セッション横断で残したい事実は `note(text)` で `~/.spirits/agent/memory/notes.md` へ追記し、`spirits_memory` カスタムエントリでも記録する。エージェント開始ごと(プロンプトごと)に `memory/` 直下の `*.md` の要約をシステムプロンプトの `spirits_memory` セクションへ注入する(`notes.md` は末尾、ほかは先頭。本文全体を文字数上限以内に収め、超えるときは整理候補、`notes.md`、ほかのファイルの順に残し、`notes.md` は古い行から省く。上限は `SPIRITS_MEMORY_CHAR_LIMIT` などで設定)
- **スキル**: `~/.spirits/agent/skills/` 配下の `SKILL.md` を codemode ツールで CRUD する。モデルには宣言せず、`tool(name, args)` と `goal` / `note` のツール説明の案内で伝える
- **同梱スキル**: バイナリに同梱したスキルは起動時と `/reload` 時に `~/.spirits/agent/bundled-skills/<spirits 版>/` へ書き出し、`resources_discover` の `skillPaths` で pi のスキル探索へ供給する。利用者の `skills/` に同名スキルがあれば利用者版が優先され、同梱版はスキップされる(衝突警告が出る)。`SPIRITS_BUNDLED_SKILLS=0` で書き出しと供給を無効化する。書き出しのたびに現行版ディレクトリの更新時刻を更新し、現行版以外のディレクトリは 7 日以上更新がない場合にだけ best-effort で削除する。書き出し失敗時はそのセッションで供給しない。`spirits_skill_save` / `spirits_skill_delete` は同梱領域を変更・削除しない。判定は書き込み先・削除対象の実体パス(`realpath`)と同梱 root の実体パスを比較して行い、`<agentDir>` が symlink を経由する場合や相対パスで与えられた場合、`skills/` 自体が同梱ディレクトリへの symlink である場合も同梱物を保護する(symlink はリンクだけを削除する)。同梱内容の反映には spirits の再起動が必要で、`/reload` は実行中の版のツリーを書き出し直すだけである
- **プロンプト**: 既定の code-mode プロンプトを TS 定数として同梱し、`before_agent_start` の `systemPromptOptions.sections` に `spirits` として追加する。上書きは `~/.spirits/agent/prompts/spirits/code-mode.md`(変更前は `.bak`)
- **子セッション**: メモリ・スキル・プロンプトは自動配線しない。子へ渡す情報は親が `rlm` の prompt に含める
- **既存参考実装**: `pi-agenticoding`(spawn / notebook / handoff の文脈管理プリミティブ)を設計参照とする。必要になれば依存として取り込む

### 4.5 コマンド・配布構成(確定)

**配布形態: `bun build --compile` スタンドアロンバイナリ + curl install.sh、ターゲットは Linux x86_64 のみ**

#### ビルド

- `bun build --compile` で単一バイナリを生成。spirits 拡張はバイナリにバンドルする
- ターゲット(v0.3 で確定): **Linux x86_64 のみ**。macOS / Windows は今回の実装範囲外

| ターゲット | バイナリ名 |
|---|---|
| `bun-linux-x64` | spirits-linux-x64 |

- 非対応 OS からの install.sh 実行は、検出時点で「このバージョンは Linux x86_64 専用」と明示して終了する
- macOS / Windows 対応が将来必要になった場合は `--target` の追加と CI ジョブ追加のみで拡張可能な構成を維持する
- エンドユーザ環境に Bun / Node は一切不要(バイナリがランタイムを内包し、ホストは公式の自己完結実行ファイル)
- ビルドは `scripts/build-binaries.ts` が `packages/spirits/bin/spirits.ts` だけを `Bun.build` する。Pi の `dist` も、ワークスペースのソースを解決する `paths` も使わない。実測として、ビルドした `dist/spirits-linux-x64` に `createAgentSession` と `InteractiveMode` の文字列は現れない
- 拡張 bundle は `scripts/build-managed-pi-inputs.ts` が `packages/spirits/tsconfig.json` でビルドし、`HostDescriptor.extensionExternals` (`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`) を外部のまま残す。ホストが解決する instance を二重に持たせないため
- テーマはホストの artifact が提供する。リリースは旧版の自己更新との互換用に `dark.json` / `light.json` と `.sha256` を添付し続けるが、現行の起動役・インストーラ・自己更新は使わない(実測: インストーラは dark.json を要求しない)

#### バージョンゲート

- **開発時(Bun 直実行)**: 起動時に `Bun.version` を検査。`< 1.4.0` は起動拒否、`< 1.4.2` は警告
- **コンパイルバイナリ**: ランタイムはビルド時に焼き込まれるため assert は不要。代わりに **CI のビルドジョブで Bun >= 1.4.2 を固定**し、リリースノートに内包 Bun バージョンを記載する
- コンパイルバイナリは `PI_SKIP_VERSION_CHECK=1` を設定し、pi の最新版確認と更新通知を抑止する。`spirits --version` / `-v` は埋め込んだ spirits バージョンと内包 Bun バージョンを表示する。`spirits update` は最新 stable `spirits-v*` の解決、SHA256 検証、インストール先と同一ディレクトリの一時領域からの rename による自身の置換を行う

#### install.sh

`curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh` 形式(`main` の版が配られる)。処理内容:

1. `uname -s` / `uname -m` でプラットフォーム検出。Linux x86_64 以外は非対応メッセージで終了
2. バージョン決定: `VERSION=0.1.0` 形式の指定があればタグ `spirits-v0.1.0` を使う。無ければ Releases API の一覧(`per_page=100`)から draft と prerelease を除き、`tag_name` が `spirits-v` で始まる先頭を latest として使う(pi の `v*` リリースは除外される)
3. **SHA256 チェックサム検証を必須**とする(チェックサムファイルも Releases に同梱)。検証失敗時は配置しない
4. 配置先: `~/.spirits/bin/spirits`(root 不要)。PATH 未通しの場合は shell rc への追記行を案内し、rc は自動編集しない
5. 成功時に利用開始コマンドと、実行環境の `bun --version` を参考表示する(無ければ拡張の依存解決に別途 Bun が必要な旨)。`bun` の有無で成否は変えない
6. `--uninstall` 相当はバイナリとデータディレクトリの削除案内を出力

冪等性を持たせ、再実行でアップグレードとして動作させる。バージョン部に `-` を含むタグ(例: `spirits-v0.3.0-rc.1`)の Release は prerelease として公開し、latest 解決から除外する。ダウンロードと検証は `$INSTALL_DIR/.spirits-tmp-<pid>/` で行い、rename で配置する。失敗時と SIGINT / SIGTERM 時は一時ディレクトリを削除し、開始時には終了済み PID の残骸だけを削除する。`VERSION` を指定しない latest 解決ではインストール済みの `--version` を確認し、同版ならダウンロードを省略して up to date を表示する。修復や意図的な再配置には `VERSION=x.y.z` を指定する。起動時チェック・自動更新は持たず、更新は `spirits update` と install.sh の再実行の 2 経路。

#### ユーザ拡張のロード

コンパイルバイナリ利用者も `~/.spirits/agent/extensions/` 配下の拡張を利用可能とする(`SPIRITS_CODING_AGENT_DIR=~/.spirits/agent` により、pi の拡張探索先をインストール先 `~/.spirits/bin/` と分離する)。実行基盤が Bun のままなので TS 拡張はネイティブ import でロードできる。配布バイナリではパッケージマネージャを内包しないため、拡張の依存解決が必要な場合は Bun インストールを案内する。依存不足の外部拡張があると、起動時に拡張パス付きのエラーを stderr に出して非ゼロで終了する(上流の Bun 環境における拡張インストール問題と同種の制約として README に明記)。

### 4.6 製品 identity

製品名・実行環境識別・送信名義を spirits に揃える。対象は CLI 表示、TUI ヘッダ、agent dir、テレメトリ。実装の詳細と代替案は `openspec/changes/add-product-identity/design.md` を参照。

- **identity の overlay**: 起動役は導入済みのホスト package.json に `piConfig.name = "spirits"` を書く (`configDir` 未指定なら `.pi`)。ホスト自身に env で名前を押し付けず、配布物の manifest を overlay することで、ホストが自分で読む identity を spirits に揃える。overlay 後の package.json も検証対象で、壊れた一式は起動しない
- **設定ディレクトリ**: `CONFIG_DIR_NAME` は `.pi` のまま維持する。project 設定・skills・prompts・extensions は `.pi` から読み、リポジトリの `.pi/` 開発リソースと上流エコシステムの互換を保つ
- **agent dir**: `ENV_AGENT_DIR` は `APP_NAME` から派生し `SPIRITS_CODING_AGENT_DIR` になる(**BREAKING**: 旧 `PI_CODING_AGENT_DIR` は読まない)。既定は `~/.spirits/agent/` で、env-defaults が未設定時に設定する。設定・認証・セッション・拡張の保存先は変わらない
- **TUI ヘッダ**: spirits 拡張が `session_start` で `ctx.ui.setHeader` を呼び、最上部から ASCII アート(4 行)・ワードマーク・`resolveSpiritsVersion()` のバージョン・キーヒント・オンボーディング文をこの順で表示する。ASCII アートの本文と行別のテーマトークン割り当ては `colorful-startup-mark` が正本で、ビルトインテーマでは truecolor / 256 色のどちらでも 4 行の解決後の色が互いに異なることが要求される(行の順序は `product-identity`)。`quietStartup: true` 時はヘッダを設定せず、起動ヘルプの展開キーに `setExpanded` で追従する。アート以外の色もテーマトークン(`accent` / `dim` / `muted`)を使う
- **テレメトリ**: env-defaults が `PI_TELEMETRY=0` を既定にし、pi.dev への install レポートと pi 名義の attribution ヘッダを送らない。有効化は `PI_TELEMETRY=1` の明示指定のみで、settings.json の opt-in は既定の無効化に上書きされて効かない
- **CLI 表示**: オーバーレイした identity をホスト自身が読むので、ホストの help・起動行・エラー文は spirits を名乗る。実測では管理下の host 実行ファイルの `--help` が `spirits - AI coding assistant with read, bash, edit, write tools` を出し、`-- --version` は `1.5.0` を返す (ホストの版)。起動役自身の `--version` は `spirits <spirits 版> (Bun <bun>)` で、 spirits 自身の最新 stable を解決する
- **ヘッダの描画**: 起動時のアートは spirits 拡張がホストの header API を通して描く (`installBrandingHeader`)。行別の色は theme token を解決して使うため、テーマはホストの artifact 側のもので動く

ホスト側の表示・テレメトリ・provider ヘッダは、オーバーレイと `PI_TELEMETRY=0` の既定値で寄せる。ソース差分は作らない (§5)。

### 4.7 dual-model-routing(ロール別モデル振り分け)

OpenSpec ワークフローのうち変更レビューと深い検証の 2 ステップだけ強いモデルで走らせ、ほかは既定モデルで走らせる。利用者は 1 つのモデルを選択したままにし、手動のモデル切り替えとその戻し忘れをなくす。実装詳細と代替案は `openspec/changes/add-dual-model-routing/design.md` を参照。

- **virtual model**: spirits 拡張が `pi.registerVirtualModel()` で `spirits/auto` を登録する。登録は拡張ロード時に行い、`/reload` でも失われない。既定モデルの変更も自動選択もしない
- **設定**: strong の対象は settings.json の `models.strong`(`"<provider>/<modelId>"` または `"<modelId>"`)。Pi の `Settings` 型は変更せず、未知キーを保持する既存挙動を `packages/spirits/test/pi-runtime/` で固定する
- **ロールフェーズ**: 拡張メモリ内の 1 値の状態機械。`input` イベントで `/skill:sprt-opsx-review-change` と `/skill:sprt-opsx-verify-deep` を検知して strong へ入り、`agent_settled` で `aborted` の真偽に関わらず normal へ戻る
- **フォールバック**: strong 未設定は無警告。設定済みで使えない場合は normal へ寄せて `ctx.ui.notify` を run 内 1 回。normal は既定 provider + 既定モデル、解決できなければ直近の成功レスポンス、どちらも無ければリクエストをエラーで終わらせる
- **ロールの実装は拡張側**: ホストの `ModelRoute.role` は設定せず、role の記録・復元・表示は spirits の状態だけを正にする。ホストが所有する virtual model の状態 entry へ拡張は書き込まない
- **バッジの意味**: 直近のリクエストが通ったロール。スキル起動直後と終了直後は 1 リクエスト遅れる。表示は拡張の status 行で、ホストの footer は使わない (`/spirits-role status` で routing・lock・step・解決結果を表示できる)
- **層**: `packages/spirits/src/routing/` は `spirits:routing` 層として [`docs/architecture/convention-registry.md`](architecture/convention-registry.md) に登記し、依存先は `spirits:shared` とホスト (`host:pi-coding-agent`) に限定する

ホストへのソース差分は作らない。挙動が必要なら拡張 API か overlay で実現し、API が足りなければ不足を限定互換として記録し、ホストの版更新で解決する。

## 5. ホスト版更新方針

spirits は Pi をフォークしない。ホストは公式配布物であり、版の更新は「固定値をそろえて実測し直す」作業である。手順の正本は [`docs/spirits-host-upgrade.md`](spirits-host-upgrade.md)。

1. **変更の置き場所**: 新規コードはすべて `packages/spirits/` 配下。ホストのソース差分は常に 0 で、差し込み点は拡張 API と `piConfig.name` の overlay に限る
2. **固定値は 3 か所**: devDependencies の型の pin、`PINNED_PI` (版・artifact 名・sha256・overlay 版)、`HostDescriptor` (実行ファイル名・bundle のロード引数・環境変数名・host が第一引数で dispatch するコマンド語)
3. **型検査**: devDependencies の公式パッケージの宣言に対する `tsc --noEmit` に一本化する。手写しの型宣言は置かず、必要なら `src/types/host.ts` のように公式 export から derived alias を切る
4. **検証の順序**: 型の pin → `tsc` → `PINNED_PI` → bundle / manifest 再生成 → 互換性ランナー公式モード → tmux 検証 → `bun test` / `bun run check`。途中で失敗したら中止し、固定値をコミットしない
5. **lockfile**: root の `bun.lock` 1 本。`bun install --frozen-lockfile --ignore-scripts` で再解決しないことを CI と pre-commit で確認する
6. **依存ピン留め**: 外部依存は完全固定 (`bun install --save-exact`)。新規リリースの取り込みは `bunfig.toml` の `[install] minimumReleaseAge` が抑える (既定 172800 秒)。npm の `min-release-age` を Bun は読まないことを実測で確認済みなので、`.npmrc` には持たせない
7. **パッケージマネージャ**: spirits 側は Bun のみ。配布物の解決も Bun で行う

## 6. セキュリティ

- REPL で実行されるモデル生成コードは **spirits プロセスと同一のユーザ権限**で動く。vm コンテキストおよび Bun の node:vm はセキュリティ境界ではない
- Prime Agent も同様に「カーネル分離はサンドボックスではない」と明記しており、spirits も同じ立場を README に明記する
- 信頼できないリポジトリ / 自動化用途では、Pi 公式の containerization 指針(Docker / micro-VM 系)に従った隔離環境での実行を推奨と表記
- `use()` のリモート import は既定で禁止(§4.2)
- 配布経路: install.sh は SHA256 検証必須(§4.5)。pipe to sh 形式のリスクは README で代替手順(バイナリ直接ダウンロード+検証)も併記する

## 7. ライセンス(確定)

- **MIT ライセンス**で公開
- 公式 Pi(MIT, 著作権: badlogic / Mario Zechner ほか)の著作権表示を LICENSE に保持し、spirits 部分の著作権行を追記する二段表記とする。spirits は Pi のソースの衍生ではなく、公式配布物の上で動く独立の成果物であることも記す
- Prime Agent はアーキテクチャ参照のみでコードコピーを行わないため厳密な帰属義務は発生しないが、謝意と参照先は README の Acknowledgments に記載する

## 8. 非機能要件

- **起動性能**: REPL 初期化は遅延(初回ツール呼び出し時)にして体感起動を悪化させない
- **長時間稼働**: CI のビルド Bun は 1.4.2+ 固定(長時間稼働 JIT クラッシュ修正のため)。REPL コンテキストのメモリ肥大化対策としてセッション間でのコンテキスト再生成オプションを用意
- **テスト**: `bun test`。REPL はセル評価・エラー整形・`rlm()` 深度制限をユニットテストで網羅
  - テスト実行の環境は `packages/spirits/test/preload.ts` が固定する。ホストは自分の package.json の `piConfig.name` から識別名 (=`SPIRITS_CODING_AGENT_DIR` という変数名) を導くため、`PI_PACKAGE_DIR` を渡した実行 (つまり spirits のセッションから起動した実行) と、それを渡さない実行 (CI) ではホストの識別名その物が違う。preload は呼び出し元の `PI_*` / `SPIRITS_*` を全て落としてから、製品の overlay (`managed-pi/overlay.ts`) を適用した package.json を一時ディレクトリに stage し、`PI_PACKAGE_DIR` と agent dir をそこに張る。CI と同じ条件の再実行は `bash scripts/test-clean-env.sh`
- **CI / リリース**: GitHub Actions(linux ランナーのみ)
  - 通常 CI: Bun 1.4.0 / 1.4.2 / latest マトリクス + `bun install --frozen-lockfile` + `bun test` + 型検査
  - リリース: `spirits-v*` タグ push で linux-x64 をコンパイル → SHA256 同梱で GitHub Releases(バージョン部に `-` を含むタグは prerelease)→ install.sh は draft と prerelease を除く `spirits-v*` の先頭を latest とする
- **コスト可視化**: `rlm` の呼び出しごとに `rlm_usage` カスタムエントリをルートセッションへ記録する。1 セッションの総量は「ルートセッション自身の usage + そのセッションの JSONL にある全 `rlm_usage`」で集計する

## 9. ディレクトリ構成案

```
(repo root、workspace は packages/spirits のみ)
├─ package.json               root scripts (check / fix / test)、devDependencies は biome・typescript・husky
├─ bun.lock                   唯一の lockfile
├─ bunfig.toml                [install] minimumReleaseAge
├─ tsconfig.base.json         共有設定
├─ tsconfig.json              リポジトリ view (編集用の参照。検査は下の 2 つ)
├─ tsconfig.scripts.json      scripts/ の型検査
├─ biome.json                 scripts/ のみ (packages/spirits は未編入)
├─ .husky/pre-commit          lockfile gate + bun run check
├─ packages/
│  └─ spirits/
│     ├─ package.json          @spirits/core(内部パッケージ,非公開)
│     ├─ src/
│     │  ├─ index.ts           拡張エントリ(registerTool 等)
│     │  ├─ repl/
│     │  │  ├─ transpile.ts    Bun.Transpiler ラッパ
│     │  │  ├─ context.ts      vm コンテキスト生成・注入
│     │  │  ├─ cell.ts         セル評価パイプライン
│     │  │  └─ format.ts       出力・エラー整形
│     │  ├─ rlm/
│     │  │  ├─ spawn.ts        createAgentSession ラッパ(同期)
│     │  │  └─ depth.ts        深度制限伝播
│     │  ├─ harness/
│     │  │  ├─ install.ts      配線(registerTool / before_agent_start)
│     │  │  ├─ memory.ts       note / メモリ要約
│     │  │  ├─ goal.ts         goal() ホスト関数
│     │  │  ├─ skills.ts       skill CRUD
│     │  │  ├─ bundled-skills/ 同梱スキル(assets + 供給)
│     │  │  │  ├─ index.ts     定義・検証・書き出し・resources_discover 配線
│     │  │  │  ├─ definition.ts コンパイル済みバンドル定義
│     │  │  │  ├─ sprt-architecture-guards/ SKILL.md と references/
│     │  │  │  ├─ sprt-opsx-review-change/ SKILL.md
│     │  │  │  └─ sprt-opsx-verify-deep/ SKILL.md
│     │  │  ├─ prompt.ts       code-mode プロンプト(既定 + 上書き解決)
│     │  │  ├─ guidance.ts     ホスト関数・ツールの案内
│     │  │  ├─ paths.ts        エージェントディレクトリ配下のパス
│     │  │  └─ tools.ts        codemode ツール定義
│     │  └─ tools.ts           REPL ツール登録
│     ├─ bin/                  起動役 (spirits.ts / bootstrap.ts / startup.ts / version.ts)
│     ├─ src/managed-pi/       一式の取得・検証・overlay・起動・HostDescriptor
│     ├─ src/update/           自己更新と案内
│     ├─ test/                 bun test (host の fake は test/host/fake-pi.ts に集約)
│     └─ tsconfig.json         拡張と test の型検査 (noEmit)
├─ scripts/
│  ├─ build-binaries.ts        起動役のコンパイル・チェックサム・互換用テーマ資産のコピー
│  ├─ build-managed-pi-inputs.ts  拡張 bundle と manifest の生成
│  ├─ check-managed-pi-bundle-version.ts  manifest と版の突き合わせ
│  ├─ check-lockfile-commit.mjs  lockfile の gate (pre-commit から呼ばれる)
│  ├─ managed-pi-compat/       互換性ランナー (公式モード既定、substituted / fixture は明示)
│  ├─ compat-theme/            旧版の自己更新向けのテーマ資産
│  ├─ install.sh / install.test.sh
│  ├─ self-update-smoke.sh     旧版→新版の自己更新スモーク
│  └─ tmux-verify.sh           対話起動の検証ランナー
├─ docs/
│  ├─ spirits-design.md(本書)
│  ├─ spirits-host-upgrade.md  §5 の手順の正本
│  └─ architecture/convention-registry.md  アーキテクチャ規約の正本
```

## 10. 開発フェーズ

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| M1 | REPL ツール(Phase 1 評価ルール)単体で動作 | pi に拡張ロードし、永続変数・print 捕捉・エラー整形が動く |
| M2 | `bun build --compile` で `spirits` バイナリ生成 + install.sh + リリース workflow | install.sh から linux-x64 環境へ導入可能 |
| M3 | rlm() 同期版 + 深度制限 + コスト伝播 | REPL 内から子エージェント呼び出しが安定動作 |
| M4 | Continual Harness(memory / skill CRUD) | セッション横断メモリが機能 |
| M5 | Phase 2 群(パーサによる最終式返却、非同期 fan-out)を採否判断の上実装 | 使用実感に基づく |

開発時の起動は `bun packages/spirits/bin/spirits.ts` で、ホストは同じ managed の一式を使う(未コンパイルの実行は一式を取得しないので、先に `managed-pi install` するかビルド済み manifest を指す)。Pi のソースをロードする開発経路は無い。

フォーク削除は独立した change として完了済みのため、フェーズ表の M1〜M5 に「ホストの差し替え」は入らない。版更新は §5 と [`docs/spirits-host-upgrade.md`](spirits-host-upgrade.md) の手順で行う。

## 11. リスクと未検証事項

- **`node:vm` の ESM 系実装状況**(Bun 公式文書間で記述が矛盾)→ 対応: M1 早期に実機検証し、不可なら Phase 1 方式のまま運用
- **ホストの Extension API の変動** → 対応: 版更新のたびに devDependencies の型で `tsc` を通し、互換性ランナー公式モードで実測する。失敗したら固定値をコミットしない(§5)
- **Bun の JSC と V8 の差異**により、V8 固有 API 依存の npm パッケージが REPL 経由で import されると壊れる可能性 → 対応: `use()` のエラー整形で原因候補を提示
- **コンパイルバイナリでの拡張ロード**: 起動役はバンドルした拡張を `-e` で渡し、利用者の外部拡張は agent dir からホストが読む。両方が載った一式は 1.5.0 で実機確認済み (`[Extensions]` に `spirits-extension.js` が出る)
- **ホストの配布物が読めなくなる / 検証が通らない** → 対応: 起動時に検証し、`spirits managed-pi repair` と Rollback を表示して止まる。黙って別のホストへ切り替えない
- **host のコマンド語の変化** → 対応: `HostDescriptor.commandWords` が正。起動役はこの語を拒否して host 実行ファイルを案内するため、host がコマンドを増やしたら記述子の更新が必要 (Pi 1.5.0 の `--help` の表を実測根拠にする)
- **REPL 状態の永続化範囲**: vm コンテキスト内の変数はプロセス内のみで、セッション復元時に消える。必要ならセルログのリプレイによる再構成を将来検討(現状は非目標)

## 12. Follow-up 候補

フォーク削除 (`remove-pi-fork`。アーカイブ: `openspec/changes/archive/2026-11-17-remove-pi-fork/`) が範囲外として残した判断。実装するときは新しい change を起こす。

- **`biome.json` に `packages/spirits` を入れる**: 現行の対象は `scripts/**` のみ (§9)。実測で `packages/spirits` の 465 個の TypeScript ファイルに 335 件の diagnostic (フォーマット中心で 429 ファイルが書き換わる) が出たため、他の変更と分けて判断する。材料: `bunx biome check --max-diagnostics=200 packages/spirits`。
- **`commandWords` の自動観測**: §11 と [`docs/spirits-host-upgrade.md`](spirits-host-upgrade.md) §7b は現在、人間が host artifact の `--help` と突き合わせる手順書。host の `--help` を読んで `OFFICIAL_PI_HOST.commandWords` との差分を CI か版更新の手順で報告する観測にできる。見落としは拒否すべき語が model prompt へ渡る側に出るため、記述子の手更新を続ける間は手順書を正とする。
- **互換用のテーマ資産の添付をやめる時期**: 起動役・インストーラ・自己更新はテーマ資産を使わないが、リリースは旧版の自己更新のために `dark.json` / `light.json` と `.sha256` を添付し続ける (出力元は `scripts/compat-theme/`、判断根拠はアーカイブ済み design の D8)。やめる判断は、添付を要求するバイナリが配布元に残っていないと確認できた change で行う。
- **Pi-Bolt 対応の未解決事項**: ホストの差し替え点は `HostDescriptor` (`packages/spirits/src/managed-pi/host.ts`) に集約済みで、互換性ランナーは `--host <descriptor.json>` で代用ホストと同じマトリクスを測れる (`docs/spirits-managed-pi.md`)。未実測: agent dir の向け直し (環境変数名と既定パス)、overlay (`package.json` の `piConfig.name` 相当) の適用可否、JIT 無しでの tsrepl の速度、RPC モードのプロトコル互換、拡張 API の提供有無、`commandWords` と拡張ロード引数の位置。manifest の `host: { kind }` と `schemaVersion: 2` も未確定で、実測してから決める。

## 付録: 参照

- Pi: `https://github.com/earendil-works/pi`(旧 badlogic/pi-mono)、ドキュメント `https://pi.dev/docs/latest`(SDK / Extensions / Codemode / Containerization)
- Prime Agent(参照アーキテクチャ): `https://github.com/PrimeIntellect-ai/prime-agent`(MIT)
- Bun 1.4 リリース: `https://bun.com/blog/bun-v1.4`、Node 互換性: `https://bun.com/docs/runtime/nodejs-compat`、Transpiler: `https://bun.com/docs/runtime/transpiler`
- pi-agenticoding パッケージ: `https://pi.dev/packages/pi-agenticoding`

## managed 経路 (単一経路)

既定の起動は managed で、公式 Pi の固定 artifact と事前 bundle した spirits 拡張を 1 組として起動する。組の書式・検証・互換マトリクス・ランナーは `docs/spirits-managed-pi.md`、初回起動のバックアップと戻し方は `docs/spirits-default-launch.md`、版更新と Rollback は `docs/spirits-host-upgrade.md`。公式 Pi 1.5.0 の拡張 API で spirits の機能をどう実現するかという調査・設計の一次根拠は `docs/spirits-managed-pi-design.md`(フォーク Era の比較を含む歴史的資料)。

`spirits managed-pi` は残るが、意味は「一式の管理と隔離起動」である。`install` / `update` / `repair` は `~/.spirits/managed-pi` を扱い、`spirits managed-pi -- [args]` は専用の agent dir (`~/.spirits/managed-pi/agent`) で起動するため、互換性ランナーとテストはこれで実データを触らずにホストを動かせる。既定経路の agent dir は `~/.spirits/agent` である。

role・clear・model は削除していない。role のバッジは拡張の status 行に出し、role のコマンドは `/spirits-role`、会話境界は `/spirits-clear`(ホストの `/clear` と `/model` をそのまま残す)。Pi 1.5.0 で不足する拡張 API は限定互換として記録し、実装できないものは Follow-up に残す。
