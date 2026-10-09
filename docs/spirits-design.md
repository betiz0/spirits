# spirits 設計書

- プロジェクト名: **spirits**
- コマンド名: `spirits`
- 版: v0.3
- 更新日: 2026-10-07
- ライセンス: MIT
- ステータス: 設計確定(M1 着手可)

---

## 1. 目的と位置づけ

spirits は、エージェント型コーディングツール **Pi**(`earendil-works/pi`,旧 badlogic/pi-mono)をフォークし、Prime Intellect の **Prime Agent** が Python(IPython カーネル + RLM + Continual Harness)で実現している実行モデルを、**TypeScript / Bun ネイティブで再実装**するための派生プロジェクトである。

設計目標:

1. モデルとの主インターフェースを「永続 TypeScript REPL(1ツール)」とする code-as-action 構成
2. REPL 内から子エージェントを起動できる `rlm()` 相当の再帰機構(Phase 1 は同期呼び出し)
3. プロンプト / スキル / メモリをエージェント自身が更新できる Continual Harness 相当の自己改善機構
4. Pi 上流(upstream)への差分を最小化し、継続的に変更を取り込めるフォーク運用

非目標:

- IPython / Jupyter プロトコルとの互換性(参考実装として読むのみ)
- セキュリティサンドボックスの提供(分離はサンドボックスではない)
- Node.js ランタイムのサポート(Bun 専用)
- npm パッケージとしての配布(§4.5 のコンパイルバイナリ配布に一本化)
- **macOS / Windows 向けバイナリ(v0.3: Linux x86_64 のみ)**

## 2. 前提と確定事項

| 項目 | 内容 | 状態 |
|---|---|---|
| ランタイム | Bun のみ。最低 >= 1.4.0、推奨 >= 1.4.2 | 確定 |
| 上流 | `github.com/earendil-works/pi` を fork 元とする | 確定 |
| 実装方式 | Pi コアは極力触らず、拡張(Extension)+ 独自パッケージで実装 | 確定 |
| 参照実装 | Prime Agent(MIT)のアーキテクチャを TS に移植。コードコピーはしない | 確定 |
| 配布形態 | `bun build --compile` によるスタンドアロンバイナリ + `curl install.sh` 方式。ターゲットは Linux x86_64 のみ | **確定(v0.2/v0.3)** |
| rlm() の実行形態 | Phase 1 は同期呼び出しで開始。非同期 fan-out は M5 で採否判断 | **確定(v0.2)** |
| lockfile | `bun.lock` へ段階移行(M2: root `bun.lock` 導入、`package-lock.json` 保持) | **確定(v0.2)** |
| ライセンス | MIT | **確定(v0.2)** |
| 対応プロバイダ | Pi が対応する全プロバイダに委譲(spirits 側で制限しない) | 確定 |

実行環境に関する根拠:

- Bun 1.4.0(2026-08-19 リリース)で Node.js 26.3.0 互換を目標とする大幅な互換性向上が入り、`node:vm` は `vm.Script` / `vm.createContext` / `vm.runInContext` 等が公式互換性ページ上「完全実装」とされる。
- ただし Bun の API リファレンス個別ページには「experimental VM modules は未実装」との古い記述が残っており、**`vm.SourceTextModule` / `importModuleDynamically` は実機検証を必須**とする。
- Bun 1.4.2(2026-09)で「長時間稼働プロセスでの JIT クラッシュ」「`AsyncLocalStorage` のリーク」等が修正。永続 REPL を抱える長時間プロセスという spirits の性質上、**開発 CI のベースラインは 1.4.2** とする。
- Bun 1.4 系の `bun build --compile` は安定しており、Pi 上流自体がコンパイル Bun バイナリを配布している実績がある。spirits はこの経路をそのまま利用する。

## 3. 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────┐
│ Pi (upstream fork)                                   │
│  ├─ agent loop / LLM プロバイダ I/F (変更なし)        │
│  ├─ TUI / セッション永続化(JSONL) (変更なし)          │
│  └─ Extension API                                    │
│       │ registerTool / codemode / appendEntry 等      │
│       ▼                                              │
│  packages/spirits (拡張パッケージ, 本プロジェクトの中核)│
│  ├─ repl/   永続 TS REPL(Bun.Transpiler + node:vm)   │
│  ├─ rlm/    子エージェント起動(SDK createAgentSession)│
│  └─ harness/ goal / memory / skill CRUD / code-mode  │
│      (code-mode プロンプトも同梱)                            │
│  配布: bun build --compile → 単一バイナリ `spirits`    │
│        (Linux x86_64 のみ)                            │
└──────────────────────────────────────────────────────┘
```

責務の分離(Prime Agent の設計を踏襲):

- **ホスト(Pi + spirits 拡張)**: プロバイダ呼び出し、セッション永続化、子エージェントのライフサイクル、深度制限、コスト集計、権威ある状態の保持
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
- エンドユーザ環境に Bun / Node は一切不要(バイナリがランタイムを内包)
- Pi 上流がコンパイルバイナリ向けに用意している仮想モジュール機構(拡張から pi パッケージを import する経路)をそのまま利用する
- ビルドはソースから直接行う(`scripts/build-binaries.ts` の `Bun.build`)。pi の `dist` は使わず、root `tsconfig.json` の `paths` で pi ワークスペースのソースを解決し、pi コアの `VERSION` はビルド時に `packages/coding-agent/package.json` の version へ置換する
- theme / assets / export-html / native prebuilds は同梱しない。テーマは system テーマへフォールバックし、HTML エクスポート等の一部機能が劣化する(README に明記)

#### バージョンゲート

- **開発時(Bun 直実行)**: 起動時に `Bun.version` を検査。`< 1.4.0` は起動拒否、`< 1.4.2` は警告
- **コンパイルバイナリ**: ランタイムはビルド時に焼き込まれるため assert は不要。代わりに **CI のビルドジョブで Bun >= 1.4.2 を固定**し、リリースノートに内包 Bun バージョンを記載する
- コンパイルバイナリは `PI_SKIP_VERSION_CHECK=1` を設定し、pi の最新版確認と更新通知を抑止する。`spirits --version` / `-v` は埋め込んだ spirits バージョンと内包 Bun バージョンを表示し、`spirits update` は提供しない(更新は install.sh の再実行)

#### install.sh

`curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh` 形式(`main` の版が配られる)。処理内容:

1. `uname -s` / `uname -m` でプラットフォーム検出。Linux x86_64 以外は非対応メッセージで終了
2. バージョン決定: `VERSION=0.1.0` 形式の指定があればタグ `spirits-v0.1.0` を使う。無ければ Releases API の一覧(`per_page=100`)から draft と prerelease を除き、`tag_name` が `spirits-v` で始まる先頭を latest として使う(pi の `v*` リリースは除外される)
3. **SHA256 チェックサム検証を必須**とする(チェックサムファイルも Releases に同梱)。検証失敗時は配置しない
4. 配置先: `~/.spirits/bin/spirits`(root 不要)。PATH 未通しの場合は shell rc への追記行を案内し、rc は自動編集しない
5. 成功時に利用開始コマンドと、実行環境の `bun --version` を参考表示する(無ければ拡張の依存解決に別途 Bun が必要な旨)。`bun` の有無で成否は変えない
6. `--uninstall` 相当はバイナリとデータディレクトリの削除案内を出力

冪等性を持たせ、再実行でアップグレードとして動作させる。バージョン部に `-` を含むタグ(例: `spirits-v0.3.0-rc.1`)の Release は prerelease として公開し、latest 解決から除外する。初回は自動アップデート機構は持たない(更新は install.sh の再実行)。

#### ユーザ拡張のロード

コンパイルバイナリ利用者も `~/.spirits/agent/extensions/` 配下の拡張を利用可能とする(`PI_CODING_AGENT_DIR=~/.spirits/agent` により、pi の拡張探索先をインストール先 `~/.spirits/bin/` と分離する)。実行基盤が Bun のままなので TS 拡張はネイティブ import でロードできる。配布バイナリではパッケージマネージャを内包しないため、拡張の依存解決が必要な場合は Bun インストールを案内する。依存不足の外部拡張があると、起動時に拡張パス付きのエラーを stderr に出して非ゼロで終了する(上流の Bun 環境における拡張インストール問題と同種の制約として README に明記)。

## 5. フォーク運用方針

差分最小化が upstream 追従コストを決めるため、以下の規律を設ける。

1. **変更の置き場所**: 新規コードはすべて `packages/spirits/` 配下。既存 Pi コアへの変更は原則ゼロ。バイナリランタイムの都合に合わせ、M1 では `packages/spirits` をルートの npm workspaces / `tsconfig.json` / `biome.json` から除外し、`bun test` と `tsc --noEmit` で自己完結して検証する(除外の復帰と CI 組み込みは bun.lock 移行と合わせて別途行う)
2. **やむを得ないコア変更**は 1 変更 = 1 コミットで分離し、先頭に `[spirits]` プレフィックスを付けて cherry-pick / rebase しやすく保つ
3. **上流追従**: `upstream` リモートを登録し、main へ定期的に merge(頻度は月 1 回を目安)
4. **lockfile(段階移行)**: root に `bun.lock` を導入し、spirits の CI / リリースは `bun install --frozen-lockfile` で検証する。既存 npm workflow と `package-lock.json` は当面残し、完全移行(`package-lock.json` 削除、CI / vitest 置換)は別 change とする
5. **jiti**: Bun は TS をネイティブ実行するため拡張ロードの jiti 依存は不要。上流コードは残し、Bun 実行時のみ native import にショートカットする最小パッチとする
6. **パッケージマネージャ**: Bun 環境で npm 不在時に拡張インストールが壊れる上流の既知問題があるため、spirits ではパッケージマネージャ既定を bun に倒す
7. **依存ピン留め**: 上流の流儀(完全固定、`min-release-age=2` 相当)を bun に読み替えて踏襲。`bun install --save-exact` を標準とする

## 6. セキュリティ

- REPL で実行されるモデル生成コードは **spirits プロセスと同一のユーザ権限**で動く。vm コンテキストおよび Bun の node:vm はセキュリティ境界ではない
- Prime Agent も同様に「カーネル分離はサンドボックスではない」と明記しており、spirits も同じ立場を README に明記する
- 信頼できないリポジトリ / 自動化用途では、Pi 公式の containerization 指針(Docker / micro-VM 系)に従った隔離環境での実行を推奨と表記
- `use()` のリモート import は既定で禁止(§4.2)
- 配布経路: install.sh は SHA256 検証必須(§4.5)。pipe to sh 形式のリスクは README で代替手順(バイナリ直接ダウンロード+検証)も併記する

## 7. ライセンス(確定)

- **MIT ライセンス**で公開
- Pi 上流(MIT, 著作権: badlogic / Mario Zechner ほか)の著作権表示を LICENSE に保持し、spirits 部分の著作権行を追記する二段表記とする
- Prime Agent はアーキテクチャ参照のみでコードコピーを行わないため厳密な帰属義務は発生しないが、謝意と参照先は README の Acknowledgments に記載する

## 8. 非機能要件

- **起動性能**: REPL 初期化は遅延(初回ツール呼び出し時)にして体感起動を悪化させない
- **長時間稼働**: CI のビルド Bun は 1.4.2+ 固定(長時間稼働 JIT クラッシュ修正のため)。REPL コンテキストのメモリ肥大化対策としてセッション間でのコンテキスト再生成オプションを用意
- **テスト**: `bun test`。REPL はセル評価・エラー整形・`rlm()` 深度制限をユニットテストで網羅
- **CI / リリース**: GitHub Actions(linux ランナーのみ)
  - 通常 CI: Bun 1.4.0 / 1.4.2 / latest マトリクス + `bun install --frozen-lockfile` + `bun test` + 型検査
  - リリース: `spirits-v*` タグ push で linux-x64 をコンパイル → SHA256 同梱で GitHub Releases(バージョン部に `-` を含むタグは prerelease)→ install.sh は draft と prerelease を除く `spirits-v*` の先頭を latest とする
- **コスト可視化**: `rlm` の呼び出しごとに `rlm_usage` カスタムエントリをルートセッションへ記録する。1 セッションの総量は「ルートセッション自身の usage + そのセッションの JSONL にある全 `rlm_usage`」で集計する

## 9. ディレクトリ構成案

```
(fork root)
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
│     │  │  ├─ prompt.ts       code-mode プロンプト(既定 + 上書き解決)
│     │  │  ├─ guidance.ts     ホスト関数・ツールの案内
│     │  │  ├─ paths.ts        エージェントディレクトリ配下のパス
│     │  │  └─ tools.ts        codemode ツール定義
│     │  └─ tools.ts           REPL ツール登録
│     ├─ bin/                  コンパイル用エントリ
│     └─ test/
├─ scripts/
│  ├─ build-binaries.ts        コンパイル・チェックサム生成
│  └─ install.sh               配布用インストーラ(Linux x86_64 専用, SHA256 検証付き)
└─ docs/
   ├─ design.md(本書)
   └─ fork-policy.md           §5 の運用詳細
```

## 10. 開発フェーズ

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| M1 | REPL ツール(Phase 1 評価ルール)単体で動作 | pi に拡張ロードし、永続変数・print 捕捉・エラー整形が動く |
| M2 | `bun build --compile` で `spirits` バイナリ生成 + install.sh + リリース workflow | install.sh から linux-x64 環境へ導入可能 |
| M3 | rlm() 同期版 + 深度制限 + コスト伝播 | REPL 内から子エージェント呼び出しが安定動作 |
| M4 | Continual Harness(memory / skill CRUD) | セッション横断メモリが機能 |
| M5 | Phase 2 群(パーサによる最終式返却、非同期 fan-out)を採否判断の上実装 | 使用実感に基づく |

M1 では開発ループを壊さないため、先に「上流 pi を bun で拡張ロードして動かす」形で検証し、M2 で配布形態に移す。

## 11. リスクと未検証事項

- **`node:vm` の ESM 系実装状況**(Bun 公式文書間で記述が矛盾)→ 対応: M1 早期に実機検証し、不可なら Phase 1 方式のまま運用
- **Pi 上流の SDK / Extension API の変動** → 対応: 差分分離規律(§5)と月次マージ
- **Bun の JSC と V8 の差異**により、V8 固有 API 依存の npm パッケージが REPL 経由で import されると壊れる可能性 → 対応: `use()` のエラー整形で原因候補を提示
- **コンパイルバイナリでの拡張ロード**: 上流バイナリでの仮想モジュール経路は存在するが、spirits 拡張のバンドル + 外部拡張混在は要検証 → 対応: M2 で最小構成を実機確認
- **bun.lock 移行後の上流マージ**: package-lock 削除後、上流が package-lock を更新してくると毎回衝突する → 対応: `.gitattributes` で lockfile のマージ戦略を調整し、マージ後の lock 再生成を手順化
- **REPL 状態の永続化範囲**: vm コンテキスト内の変数はプロセス内のみで、セッション復元時に消える。必要ならセルログのリプレイによる再構成を将来検討(現状は非目標)

## 付録: 参照

- Pi: `https://github.com/earendil-works/pi`(旧 badlogic/pi-mono)、ドキュメント `https://pi.dev/docs/latest`(SDK / Extensions / Codemode / Containerization)
- Prime Agent(参照アーキテクチャ): `https://github.com/PrimeIntellect-ai/prime-agent`(MIT)
- Bun 1.4 リリース: `https://bun.com/blog/bun-v1.4`、Node 互換性: `https://bun.com/docs/runtime/nodejs-compat`、Transpiler: `https://bun.com/docs/runtime/transpiler`
- pi-agenticoding パッケージ: `https://pi.dev/packages/pi-agenticoding`
