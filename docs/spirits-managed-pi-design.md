# managed 経路で spirits の機能をどう実現するか（調査・設計提案）

対象: `feat/add-managed-pi-route` / 公式 Pi 1.5.0 (`v1.5.0` = `f9a2636`)
この文書は調査と設計提案のみ。実装・ハーネス拡張・OpenSpec change・commit は行っていない。

**書かれた時点からの状態**。本文は書き換え禁止なので、ここだけ最新の対応状況を書く。

| change | 状態 | この文書の提案との差 |
|---|---|---|
| `fix-managed-rlm-child-model` | archive 済み (`35595d326`) | §4 の方式どおり。子のモデルは親側で決め、`rlm_usage` に実際に渡したモデルを記録した |
| `add-managed-spirits-commands` | archive 済み (`2b307337e`) | §2 の目的（開始時は 9、現 13）を拡張側で実装 (`5d1b0a09d`)。設定は Pi の `settings.json` へ key lock で書く (§3 案 A 相当)。`/spirits-clear` は compaction 乗っ取り単独では成立しない (Nothing to compact / Already compacted で hook が発火しない) ため、`spirits_clear` 境界 entry + `context` handler + `session_before_compact` の併用にした。代替扱いの目的は `unavailable` ではなく `alternative` / `difference` を持つ行として残した |
| `harden-managed-commands` | archive 済み (`openspec/changes/archive/2026-11-10-harden-managed-commands`) | 代替手段で満たした行の記載、`limited` の意味、`/spirits-clear` の境界の後を追う観測項目を締めた |

---

## 0. 前提の確認（実測ではなくコードで確認した事実）

| 事実 | 根拠 |
|---|---|
| 公式拡張 API に設定の**書き込みは無い**。`getSettings(): Settings` のコピー返却のみ | `core/extensions/types.ts:1782`、`docs/extensions.md:2118` |
| 拡張からモデル・thinking level を**セッション限定で**変更できる | `types.ts:1795 setModel()`（"without changing the configured default"）、`:1798 getThinkingLevel()`、`:1804 setThinkingLevel()` |
| 公式 `/model <ref>` は `setModel(model, { persist: false })`。level 引数も既定保存もない | `modes/interactive/interactive-mode.ts:5296-5315` |
| 拡張は footer・header・widget・terminal title を置換できる | `types.ts:190-292`（`setStatus` / `setFooter` / `setHeader` / `setWidget` / `setTitle`） |
| 公式 footer は拡張の `setStatus()` 値を**1 行にアルファベット順**で描画する | `modes/interactive/components/footer.ts:289-292` |
| `clearConversation()` は公式に**存在しない**。`/clear` も built-in コマンド一覧に無い | `git grep clearConversation v1.5.0` → 0 件、`core/slash-commands.ts` の `BUILTIN_SLASH_COMMANDS` に `clear` なし（`/new` のみ） |
| 拡張コマンド名が built-in と衝突した場合の扱いは「autocomplete から除外」警告のみ。**衝突名が無い `/clear` はそのまま登録・実行される** | `interactive-mode.ts:719-735`（diagnostic）、`:804-813`（autocomplete 側で filter）、`:4869-4877`（`isExtensionCommand` は実行時照合） |
| `SessionManager.resetLeaf()` は公式にある | `core/session-manager.ts:1602` |
| ただし拡張に出る `ctx.sessionManager` は read-only の `Pick` で、`resetLeaf` / `appendCustomEntry` は含まれない | `core/session-manager.ts:245-262` |
| `AgentSession.refreshContext()` は public だが、拡張に `AgentSession` 参照は無い | `core/agent-session.ts:1456`、`ExtensionContext` に session なし |
| compaction は拡張が結果を差し出せる。`session_before_compact` → `{ compaction }` を返すと LLM 呼び出しを飛ばしてその内容で compaction entry を書く | `core/agent-session.ts:2894-2932`、`types.ts:1531-1534` |
| `CompactionResult.firstKeptEntryId` は拡張側型では `string`（null は型上有効でない） | `core/compaction/compaction.ts:105-114` |
| 設定の書込みは「変更フィールドのみを、ロック下で current にマージ」。unknown key は保持される | `core/settings-manager.ts:598-627`（`storage.withLock` → `{ ...currentFileSettings }`） |
| 外部からも `withFileMutationQueue` と `getAgentDir()` が公開されている | `src/index.ts:393`、`src/index.ts:8` |
| 設定の再読込は `SettingsManager.reload()`。拡張の `ctx.reload()` は `session.reload()` を経由してそれを呼ぶ | `core/settings-manager.ts:500`、`core/agent-session.ts:3754`、`core/extensions/runner.ts:1029` |
| 公式は `package.json` の `piConfig.name` からアプリ名と env 変数名を導出する | `src/config.ts:602-611`（`ENV_AGENT_DIR = ${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`） |
| 公式 artifact は単一実行ファイル（`pi/pi`）＋ package.json ＋ アセット。JS ソースは同梱されない | `tar tzf pi-linux-x64.tar.gz` 先頭層 = `pi/pi`、`pi/package.json`、`pi/theme`、`pi/export-html`、`pi/photon_rs_bg.wasm` |
| `createAgentSession()` は `modelRuntime?: ModelRuntime` を公式に取る | `core/sdk.ts:57-58` |
| `ModelRegistry` は `ModelRuntime` を private に持つ。拡張から取得経路は無い | `core/model-registry.ts:48-53` |
| rlm 子は同一プロセスで `createAgentSession()` を呼ぶ（別プロセスではない）。`noExtensions: true` | `packages/spirits/src/rlm/spawn.ts:118-152` |
| rlm は親の `ctx.model` をそのまま子に渡す | `packages/spirits/src/rlm/hostfn.ts:66`、`:127-135` |
| 公式 `ModelRoute` に `role` は無い | `core/virtual-models.ts:73-82` |

### 0.1 登録簿の件数について

`docs/spirits-core-diffs.md` の行と `[spirits]` コミットは**いずれも 16**（`git log -E --grep='^\[spirits\]' --oneline | wc -l` = 16）。依頼文の「14 コア差分」とは一致しない。14 は `add-model-role-setting`（`a59d23dd0`）とその後の badge 修正（`7cb50de89`）導入前の数とみえる。以下は 16 で数える。

実コア差分（`packages/spirits`・docs・test を除く）の正味量は:

```
25 files changed, +724 / -171      # 実装
17 files,            +2,147        # テスト
```

`abe508e1`（= v1.1.0、基点）に対し上流は **533 コミット進んで**おり、HEAD は v1.5.0 に対して 72 コミット先行。

---

## 1. 16 コア差分と Pi 1.5.0 拡張 API の対応

managed 経路で「そのパッチが要るか」で分類する。

### A. managed では不要になる（13 / 16）

| コミット | 意図 | managed での帰結 |
|---|---|---|
| `e4ed6a5e7` | `PI_APP_NAME` / `PI_CONFIG_DIR` env 上書き | **不要**。公式は `piConfig.name` から `SPIRITS_CODING_AGENT_DIR` を導出（config.ts:602-611）。overlay が既に `piConfig.name=spirits` を書く。`computeManagedEnv` が立てる `PI_APP_NAME` / `PI_CONFIG_DIR` は公式では無視される**死んだ env**（`environment.ts:66-69`） |
| `8cd1823f1` | 非 pi bun バイナリに spirits インストーラを案内 | **実質 N/A**。managed は `PI_SKIP_VERSION_CHECK=1` を固定し、更新は `spirits managed-pi update` のみ |
| `a26fec8ee` | auth ヘルプのアプリ名 | **overlay で自動** |
| `c14ea65cf` | built-in ヘッダを遅延適用 | **不要**。公式 `ctx.ui.setHeader()` で spirits ヘッダをそのまま置ける（`types.ts:231`） |
| `69300e206` | models.dev メタデータで Claude 5.5 系を生成 | **上流追従のみ**。managed は成果物同梱のカタログを使う |
| `9edd6311c` | 依存方向の規約検査 | spirits のみ。変更なし |
| `80d9bbeaf` | sprt-opsx bundled skills | spirits のみ。変更なし |
| `c3f92bdcd` | `ModelRoute.role` | **不要**。route() 自身が決めた role なので拡張側に持てる |
| `f98e1df53` | `resolveModel` の role 透過 + entry 保存 | **拡張 `appendEntry()` で代替**（`types.ts:1774`） |
| `d2d60fbcb` | footer の `[role]` バッジ | **`ui.setStatus()` で代替**（公式 footer が描画する） |
| `d8a526dac` | `AgentSession.routedRole` | **拡張内部状態 + 独自 entry で代替** |
| `7cb50de89` | バッジの制御文字除去 | 拡張側で同処理 |
| `99b278d2d` | 非 pi identity を CLI 表示へ、pi 帰属ヘッダ抑制 | **大半は overlay で自動**。残る差分は provider 帰属ヘッダの抑制のみ（判断事項 7） |

### B. ギャップとして残る（3 / 16）

| コミット | 意図 | managed での代替 | 代替しきれない点 |
|---|---|---|---|
| `9aa13a844` | `/clear`（会話だけ消す・同一ファイル/ID・表示も消す） | compaction 乗っ取り or `newSession()` | **チャット表示の消去**（`chatContainer.clear()` は interactive-mode 内部） |
| `0769d73dd` | `/model <ref> <level>` と既定保存 | 拡張コマンド + settings 書込み | 公式 `/model` 行に統合できない |
| `a59d23dd0` | `pi.registerModelRoles()` | 拡張コマンド `/spirits-role` | `/model` の末尾語彙にならない |

---

## 2. 13 目的ごとの方式（role 5 / `/clear` 3 / `/model` 5）

方式は 3 種: **拡張**（パッチ不要）/ **限定パッチ** / **目的変更（要承認）**。

目的の定義は `scripts/managed-pi-compat/matrix.ts` にあり、この表は行と 1 対 1 で対応する。`add-managed-spirits-commands` は 9 目的で開始し、`unify-spirits-role-command` が role に `step-role-settings` と `role-status-report`、`/model` に `session-model-selection` と `settings-list` を足して 13 になった。role とモデルを 1 行で扱った `role-selection` は、ロールの対象を保存する `role-model` とセッションの選択を見る `session-model-selection` の 2 目的に割れた。

### role

| 目的 | 方式 | 根拠と影響 |
|---|---|---|
| `skill-strong-phase` 1 選択のまま review/deep を strong へ | **拡張**（実装済み・実測 available） | `pi.registerVirtualModel()`（`types.ts:2150`）+ `input` で skill phase、`agent_settled` で settle。clean 実行の official で `available`。パッチ不要 |
| `model-role-vocabulary` モデルを変えずに role を固定 | **拡張**（`/spirits-role normal\|strong` + `models.role` 既定） | `pi.setModel()` を呼ばずに位相だけ変える。操作系が変わる（`/model ... strong` は使えない）。上流提案（`registerModelRoles`）が LAND すれば統合可能 |
| `role-badge` 最後の要求を扱う role の表示 | **拡張**（`ui.setStatus("spirits", "[strong]")`） | 公式 footer が拡張 status を描画（footer.ts:289-292）。**表示位置は「拡張 status 行」で、フォークのモデル名隣のバッジではない**。永続化が要るなら `appendEntry()` でセッションに残す |
| `step-role-settings` 1 つのワークフローステップの role と thinking level を決める | **拡張**（`/spirits-role <step> role\|thinking <値>` と `models.steps.<name>`） | フォーク経路にも無かった新しい目的。ステップ名は一覧（`STEP_DEFINITIONS`）が決めるので、一覧に無い名前は書かず、`/spirits-role status` が無視した値として出す |
| `role-status-report` ロック・実行中のステップ・両ロールの対象を読む | **拡張**（`/spirits-role status`） | pi は選択を出すだけでルーティングを出さない。どのモデルが応答したかを出す面は、この報告しかない |

### /clear

| 目的 | (a) `ctx.newSession()` | (b) compaction 乗っ取り | (c) 限定パッチ PB |
|---|---|---|---|
| `conversation-clear` 会話を実効文脈から外す | ○ | ○（`firstKeptEntryId` を直近の非 message entry にして LLM 文脈を空にする） | ○ |
| `same-session-id` 同一セッション ID/ファイル | ✗（別ファイル・新 ID） | ○ | ○ |
| `todo-retention` TODO 保持 | ○（TODO を agentDir のファイルに載せ替えれば） | ○（custom entry は branch に残る） | ○ |

- (b) の**捨てられる目的**: 「チャット表示から以前の会話が消える」。compaction は要約ブロックを追加するだけで過去行は残る。`ctx.ui` にトランスクリプトを消す API は無い。
- (b) のもう一つの損失: 「/clear 直後の context usage が 0 トークン」（spec の Requirement）。compaction 後は推定値が出る。
- (b) の実装臭: `ctx.compact()` は `customInstructions` しか拡張との口が無く、`reason: "manual"` でも閾値発火と区別できない。side-channel（トークンを `customInstructions` に載せる）が要り、脆弱。
- 判定: **`conversation-clear` の「表示」半分は目的変更（要承認）**。`same-session-id` と `todo-retention` は拡張で守れる。

### /model

| 目的 | 方式 | 根拠 |
|---|---|---|
| `thinking-level` thinking level を選ぶ | **拡張** | ロール別・ステップ別の level を `models.thinking.*` と `models.steps.<name>.thinking` に保存し、route が要求本文へ載せる。pi 自身の選択（`set_thinking_level`）は変更しない。差は「`/model` 行ではなく `/spirits-role` 行」 |
| `role-model` 1 つのロールに固有のモデルを割り当てて保存する | **拡張**（`/spirits-role <role> model <ref>`） | 保存するのはロールの対象でありセッションのモデルではない。pi 自身の選択は `/model` のまま。`unify-spirits-role-command` まで `role-selection` という id だった |
| `session-model-selection` セッションのモデルを選んで読み戻す | **pi 本体**（`set_model`） | spirits はセッションのモデルを選ばない。ルーティング用モデルを選ぶと全リクエストがルーティングを通り、物理モデルを選ぶと外れる。この差を観測する行として残す |
| `default-save` 選んだ モデル/level を既定として保存 | **拡張** | 下記 §3 |
| `settings-list` 対話一覧でロールの設定を編集する | **拡張**（`/spirits-role` 無引数） | 一覧は対話 TUI にしか無い。ランナーは RPC で駆動するのでこの行は `not-run` で、一覧が編集できる設定はすべてコマンド 1 行で届く |

`spirits-model`（削除した旧コマンド）からの上の表の目的の移行先は [docs/spirits-managed-pi.md](./spirits-managed-pi.md) の「role / `/clear` / `/model` の限定互換モード」節の移行表に置く。セッションのモデル選択とその既定保存は公式 `/model` と公式 `/thinking` が担い、`/spirits-role` が設定するのはロールの対象（とステップの設定）だけであり、セッションの選択は変えない。同じ表をここに写すと 2 箇所で食い違うので、参照だけ持つ。

---

## 3. 設定の永続化: spirits 専用ファイルか Pi へのパッチか → **どちらも使わず Pi の settings.json に拡張から書く**

- 拡張 API には setter が無い（`getSettings()` のみ、types.ts:1782）。
- 一方で pi の書込みは「**変更したフィールドだけを**、ロック下でディスクの現在値にマージ」（settings-manager.ts:598-627）。unknown key も `{ ...currentFileSettings }` で保持される。
- 同じロック機構 `withFileMutationQueue` が公式に公開されている（index.ts:393）。`getAgentDir()` も公開（index.ts:8）。
- 反映は `ctx.reload()` → `session.reload()` → `settingsManager.reload()`（agent-session.ts:3754）。

つまり **パッチ無しで、Pi の settings.json に `models.strong` / `models.role` を安全に書ける**。

spirits 専用ファイルにしない理由（具体的な損失）:
- `defaultProvider` / `defaultModel` は **Pi が所有するキー**で、`resolveNormalTarget` の入力そのもの。専用ファイルにすると「Pi の既定モデル」と「spirits の既定モデル」が二重になり、`/model` で Pi が保存した値を spirits が無視する形になる。
- `pi.getSettings()` で読める唯一の場所に書かないと、編集後 `ctx.reload()` だけで効くという既存の反映経路を再発明する。

留意点:
- `assertProjectTrustedForWrite` に相当する信頼判定がある。**global にだけ書く**（project settings への書込みは信頼ダイアログを伴う。判断事項 5）。
- `ctx.reload()` は重い（extensions/skills/prompts/context files 再読込、`session_start` 再発火）。設定保存時のみ、かつ idle の時に限る。
- `session_start` で role 既定を書く既存挙動（`register.ts`）は、`appendEntry()` 側に移せる。

---

## 4. auto 親で rlm を呼んだときの子のモデル

現状の欠陥（実測 `limited`）: `hostfn.ts:66` が `scope.toolContext.model` をそのまま `spawn` に渡し、`spawn.ts` は `modelRuntime` を渡さない。`spirits/auto`（`api = "pi-virtual"`）を渡すと、子側の新規 `ModelRuntime` に対応 provider が無く `No API key found for spirits` になる。

**方式: 拡張のみ（パッチ不要）。親側で物理モデルに解決してから spawn する。**

```
resolveChildModel(ctx, phase):
  model = ctx.model
  if model is not virtual: return model            # 従来動作
  settings = readRoutingSettings(pi.getSettings())
  if phase.current() == strong:
      strong = resolveStrongTarget({ lookup: ctx.modelRegistry, spec: settings.strong,
                                     defaultProvider: settings.defaultProvider })
      if strong: return strong
  prev = latestPhysicalModelFromSession(ctx.sessionManager)   # request.previous の代替
  normal = resolveNormalTarget({ lookup: ctx.modelRegistry, defaultProvider, defaultModelId, previous: prev })
  return normal?.model            # undefined なら明確なエラー
```

設計上の要点:
- `resolveNormalTarget` / `resolveStrongTarget` は既に `(lookup, settings, previous)` の純関数で、`ctx.modelRegistry` が `ModelLookup` を満たす。**新規の解決ロジックは要らない**。
- ただし `previous` は今は `ModelRouteRequest.previous`（pi が渡す）から来ていて、rlm 側には無い。セッンション entry の最新 assistant（`stopReason` が `error`/`aborted` を除く、virtual を除く）から自前で読む。この 15 行だけが新規。
- 位相 `phase` は `registerDualModelRouting` のクロージャにある。`createRlmHostFn({ pi, ... })` に `resolveChildModel?: (ctx) => PiModel | undefined` を足して注入するのが最小結合。`index.ts` でつなぐ。
- 解決失敗は例外 + `rlm_usage` に `outcome: "error"` と解決に失敗した理由。暗に親の virtual を渡して provider エーラーにするより診断が明瞭。
- `rlm_usage` の `provider` / `modelId` は**親でなく子に渡したモデル**を記録すべき（今の実装は親のを記録する）。
- thinking level は親の選択をそのまま渡し、pi が物理モデルに clamp する（`route()` が level を透過しているのと同じ理屈）。

---

## 5. 拡張が登録した provider が rlm 子から見えない制約

- `ModelRegistry` は `private readonly runtime`（model-registry.ts:49）。拡張から `ModelRuntime` を取り出せない。
- 一方 `createAgentSession({ modelRuntime })` は公式引数（sdk.ts:57-58）。**親の実 runtime を渡せれば解決する**。
- 親 runtime が無くても、子は `agentDir/auth.json` + `models.json` から自分で解決する。**spirits のルーティング対象は内蔵 provider と `models.json` の provider なので実害は薄い**。使えないのは「第三者拡張が `registerProvider()` で生やした provider のモデル」に限定される。

判断:

| 案 | 内容 | 評価 |
|---|---|---|
| **受容**（推奨） | 候補フィルタ「子側が auth を解決できる物理モデルのみ」を §4 の解決に加え、落ちたら理由を明確なエラーで出す。文書化 | spirits 自身の用途には効く。第三者 provider は当面使えない |
| **限定パッチ PA** | `ExtensionContext` に `modelRuntime: ModelRuntime` を追加（または `ModelRegistry.getRuntime()`） | 実装 6 行程度。**上流提案可能性は高い**（`createAgentSession` が既に同じ型を取る） |
| 独自 `ModelRuntime.create()` を親が作る | 子用に新 runtime を作る | 親の拡張登録 provider は見えるようにならない。受容と同等の制約なのにコードが増える。却下 |

**PA は「issue を立てて、LAND したら切る」まで待つ。** 今の時点では受容 + フィルタ。

---

## 6. 限定パッチの一覧と規模

まず「パッチの形」を 2 種に分ける。managed の現設計は P-DATA のみ。

| 形 | 内容 | 現状 |
|---|---|---|
| **P-DATA** | 展開後 `package.json` に `piConfig.name=spirits` を足すだけ。**再ビルド無し**、公式 tarball の sha256 はそのまま検証できる | 実装済み（`overlay.ts`、manifest `overlay.sha256`） |
| **P-SOURCE** | 公式タグを checkout → `patches/*.patch` 適用 → `bun --compile` で linux-x64 実行ファイルをビルド → spirits release asset として配布 → manifest に公式 sha と patch-set sha を併記 | **未使用**。採用すると Pi の版ごとに再ビルド・再検証が必須 |

前提として、公式 artifact は単一実行ファイルで JS ソースを同梱しない（`tar tzf` で確認）。**JS パッチは必ず P-SOURCE になる**。

### P-SOURCE 候補

| ID | 変更箇所 | 規模 | 上流提案可能性 | 判断 |
|---|---|---|---|---|
| **PA** `ExtensionContext.modelRuntime` | `core/extensions/types.ts` +1 宣言、`core/extensions/runner.ts` ctx 構築 +3、`docs/extensions.md` +10 | 実装 6 行、型 2 行 | **高**（`createAgentSession` が既に `modelRuntime` を取る。対称性の欠落と主張できる） | issue を出す。LAND まで受容 |
| **PB** `clearConversation` を拡張 API へ | `core/agent-session-runtime.ts`（フォーク実装を流用、約 40 行）、`core/extensions/types.ts` +1、`core/extensions/runner.ts` +15、`docs/extensions.md` +25。**表示の消去まで入れるなら** `interactive-mode.ts` +10 と新イベント 1 個 | 実装 60〜80 行（表示なし）／100〜130 行（表示込み） | **中**。「同一ファイル内に新しい root を作るリセット」は上流にも価値があるが、トランスクリプト表示の扱いは上流の設計判断が要る | 表示なし版なら PB-1 として出せる |
| **PC** `/model <ref> <level>` + 既定保存 | `core/slash-commands.ts`、`interactive-mode.ts`、`model-command-args.ts` 新設 | 約 300 行（フォーク実績 844 行） | **低〜中**。拡張コマンドで足りる | P-SOURCE にしない。上流提案のみ |
| **PD** `pi.registerModelRoles()` | `core/extensions/*`、`interactive-mode.ts`、`settings-manager.ts` | 約 650 行（フォーク実績） | **低〜中**。Pi 本体に role 語彙を入れる設計判断が必要 | P-SOURCE にしない。上流提案のみ |

**推奨: P-SOURCE は 0 のまま**。PA・PB は上流 issue として送り、公式に LAND した版から managed の対応表を更新する。/clear は §7 の判断で「目的変更（表示を残す）」を取る。

---

## 7. フォーク継続との追従コスト比較

### フォーク現況（実測）

- 基点 `abe508e1` = v1.1.0。上流は v1.5.0 まで **533 コミット**。HEAD は v1.5.0 に対し 72 コミット先行。
- コア実装への手当て: **25 ファイル +724 / -171**、テスト **17 ファイル +2,147**。
- その 25 ファイルを、上流は v1.1.0→v1.5.0 の **4 リリースで 63 コミット**触っている。内訳の上位:

| ファイル | 上流コミット | spirits 追加行 |
|---|---|---|
| `modes/interactive/interactive-mode.ts` | 12 | 229 |
| `core/agent-session.ts` | 7 | 46 |
| `core/extensions/types.ts` | 5 | 46 |
| `package-manager-cli.ts` | 5 | 28 |
| `core/settings-manager.ts` / `core/sdk.ts` / `cli/args.ts` | 各 3 | 19 / 17 / 17 |

- 追加のコストは競合解決だけでなく、`docs/spirits-core-diffs.md` 登録簿 16 行の**存在確認**（上流 merge で「消えるべき差分が消えた」検知）と、`test/pi-runtime/` の API ピンニングを毎回含む。

### managed へ移した場合

- 上流取り込み = **manifest の `pi.version` と `artifact.sha256` を書き換えて再検証**（`install/update/repair` は既存実装）。コア差分は P-SOURCE を 0 に保てば **0**。コンフリクトは構造的に発生しない。
- 代償として、ギャップを埋めるコードが spirits 側（=上流と競合しない場所）に移る。推定:

| 追加 | 規模 |
|---|---|
| `/spirits-role`（ロールのロック、ロールとステップの model / thinking、status、対話一覧） | 約 700〜900 行 |
| 設定書込み（`withFileMutationQueue` + `ctx.reload()`） | 約 120 行 |
| `/spirits-clear`（compaction 方式） | 約 100〜150 行 |
| rlm 子の物理モデル解決 | 約 80 行 |
| role badge（`ui.setStatus`） | 約 40 行 |
| **合計** | **約 550〜700 行**（spirits 内、上流競合なし） |

### 交換条件の要約

| | フォーク継続 | managed（P-SOURCE 0） |
|---|---|---|
| 上流追従 | 4 リリースごとに 63 箇所の突き合わせ＋16 行の登録簿確認。 hottest file は interactive-mode（上流 12 / 手当て 229 行） | manifest 更新 + 再検証のみ |
| UI/操作 | `/clear`（表示も消す）、`/model <ref> <level> <role>`、footer の `[role]` バッジを**そのまま**保てる | `/clear` の表示消去は失う。`/model` 行は公式のまま。role 語彙と level 引数は `/spirits-*`。badge は footer の拡張 status 行 |
| 目的（13。開始時は 9） | 開始時の 9 目的は 9/9。`step-role-settings` と `role-status-report` は spirits が足した新しい面で、フォーク経路にも無い | 12/13 を拡張で達成。`conversation-clear`（表示半分）は目的変更。`session-model-selection` は pi 本体の面そのもので、spirits はセッションのモデルを選ばない。`role-selection` は `role-model` と `session-model-selection` に割れた |
| 第三者拡張 | 拡張は pi 内部に自由に触れる（フォークなので） | 公式拡張 API の範囲。`ModelRuntime` 非公開が唯一の実質的制約 |
| P-SOURCE を増やすと | n/a | 1 件ごとに「公式タグ + patch 再適用 + 再ビルド + 再検証」。PA（6 行）はほぼ無料、PB（60〜130 行）は許容範囲、PC/PD（数百行）は**事実上フォーク化**するので採らない |

---

## 8. ユーザーが決めるべき事項

1. **`/clear` のチャット表示**。3 択: (i) compaction 方式で表示は残す（= 目的の一部を捨てる。**要承認**） / (ii) `/new`（別セッション・新 ID）に読み替える（`same-session-id` を捨てる。**要承認**） / (iii) P-SOURCE(PB) で再ビルドした Pi を配布する。
2. **P-SOURCE（公式 artifact の再ビルド配布）を受け入れるか**。これ自体が「公式 Pi を優先する」の解釈を決める。PA 6 行だけのための再ビルド_pipeline を維持するか否か。
3. **`/spirits-role` という単一のコマンド体系を認めるか**。公式 `/model` は selector として残り、spirits の設定は「対象 項目 値」の 1 行と対話一覧に集約する。
4. **role badge を footer の「拡張 status 行」に出す**ことで足りるか（モデル名の隣の `[strong]` は再現しない）。
5. **設定の保存先**。Pi の `settings.json`（推奨）でよいか。project settings にも書くことを認めるか（信頼ダイアログを伴う。推奨は global のみ）。
6. **第三者拡張の provider を rlm 子で使えない**ことを文書化して受け入れるか（PA の LAND 待ち）。
7. **`99b278d2d` の pi 帰属 provider ヘッダ抑制**を managed でも欲しいか。公式 binary では pi 帰属ヘッダが出る。不要なら削除、必要なら P-SOURCE の追加候補。
8. **フォーク経路の role 系 5 パッチ**（`c3f92bdcd` / `f98e1df53` / `d2d60fbcb` / `d8a526dac` / `7cb50de89`）をいつ捨てるか。両経路を持つ間、spirits 側に role 実装が 2 系統並ぶ（`registerModelRoles` 有無の分岐は既に入っているが、badge の読み出し元が違う）。
9. （副次）`computeManagedEnv` の `PI_APP_NAME` / `PI_CONFIG_DIR`（公式では無視される死んだ env）を削除して overlay 一本に寄せてよいか。

---

## 9. 次に propose すべき最小範囲

**判断事項 1〜5 を待たずに進められるのは rlm の子モデル解決だけ**。これを 1 change にする。

### 最小 change: `fix-managed-rlm-child-model`

- 目的: `rlm auto parent` を `limited` から `available` にする（clean 実行で実測が動く）。
- 内容: §4 の `resolveChildModel`（virtual を渡さない / phase を注入 / `previous` をセッション entry から読む / 解決失敗は明確なエラー）、`rlm_usage` に**実際に渡した**モデルを記録。
- ハーネス: 既存の `rlm auto parent` 観測の state 定義を「親が virtual で子の要求が normal 物理モデルで届いた」に締める。新 probe は不要。
- 依存: 無し。設定書込み・`/spirits-*`・`/spirits-clear`・badge と独立。
- 非範囲: 設定の書き込み、`/spirits-*` コマンド、`/clear`、badge、PA/PB。

### その次（判断事項 1〜5 の確定後）: `add-managed-spirits-commands`

`/spirits-role`・`/spirits-clear`・設定書込み・`ui.setStatus` badge、および目的マトリクスの再定義（`currentMechanism` に managed 経路の方式を書き、代替扱いの目的を `alternative`/`difference` として明示的に行に残す）。この時点では 9 目的の数で書いており、実装されたマトリクスは role 5・`/clear` 3・model 5 の 13 目的である。

### 並行（実装 change にしない）

上流 issue を 2 本: PA（`ExtensionContext.modelRuntime`）と PB（`clearConversation`）。P-SOURCE は作らない。

---

## 10. 訂正

本文は書き換えない。実装段階で判明した事実により、次の 3 項を訂正する。

1. **設定の書き込みのロック機構**: Pi の `SettingsManager` は proper-lockfile によるプロセス間のファイルロック（`settings-manager.ts` の `lockSync`）を使う。`withFileMutationQueue`（`core/tools/file-mutation-queue.ts`）はプロセス内のキューであり、同じロック機構ではない。拡張から `settings.json` に書く場合は、同じパスで proper-lockfile を使って「読み込み → マージ → 書き込み」を行い、その後 `ctx.reload()` で反映する方式を前提とする。
2. **追従コストの比較**: managed では拡張 API の変更への追従が発生する。フォーク継続では上流の変更はソースのコンフリクトとして現れるのに対し、managed は公式拡張 API のみに依存する代わりに、その API 自体が上流で変われば拡張が追従する。§7 のフォーク継続との比較表に加えるべき「追従の対象」の行は次のとおり（§7 本文は書き換えない）。

| | フォーク継続 | managed（P-SOURCE 0） |
|---|---|---|
| 追従の対象 | 上流の**ソース**。core 実装の変更がコンフリクトとして現れ、登録簿 16 行の存在確認と `test/pi-runtime/` のピンを毎回突き合わせる | 上流の**公式拡張 API**。`ExtensionAPI`・イベント・`registerVirtualModel` の形が変わったときだけ spirits 側が追従し、それ以外の上流変更は何もしない |

3. **`session_before_compact` の発火条件**: `session_before_compact` は自動 compaction でも発火する（`reason` は `manual` / `threshold` / `overflow` を運び、`manual` は Pi の `/compact` 由来とも同じ値になる）。したがって `/clear` の代替は、明示的な起動のときにだけ立つ条件を満たす呼び出しだけを横取りし、それ以外は素通しするという条件を仕様に含める。
