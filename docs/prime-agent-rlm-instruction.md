# Prime Agent が rlm の使い方をモデルに伝える仕組み(参照文書)

- 作成日: 2026-10-08
- 対象: Prime Intellect「Prime Agent」(リポジトリ `PrimeIntellect-ai/prime-agent`)
- 目的: モデル(LLM)に対して `rlm` の使い方がどのような経路・文面で伝えられているかを整理する
- 確度ラベル: [一次確認] = 公式ブログ・論文・リポジトリの実物で確認 / [一般知識] / [推論] / [不確実] / [不明]。条件依存・推論・不確実な箇所は 🟡 で示す

---

## 1. 要約

- モデルに公開される組み込みツールは `ipython` の1本のみ。ファイル操作、シェル、サブエージェント起動は、永続 IPython カーネル内の Python コードとして実行される。[一次確認]
- `rlm` はカーネルの名前空間にプリロードされた callable。モデルはツール呼び出しスキーマを使わず `await rlm("...")` というコードを書く。[一次確認]
- 使い方は主に4経路で伝わる。
  1. システムプロンプトへの直書き(`prompts/rlm.ts` の `buildRlmPrompt`、および `buildSubagentGuidance`)
  2. カーネルのプリロード(`rlm`、`agent_message` などが import 済み)
  3. スキル文書(SKILL.md)
  4. Continual Harness(補足プロンプト、メモリ、スキル、サブエージェント仕様)
- 論文は、現行モデルが Prime Agent の機能を使うよう訓練されていないと述べている。rlm の使い方はプロンプトと文書で伝える設計になっている。[一次確認]

---

## 2. 前提: Prime Agent と rlm

| 項目 | 内容 | 確度 |
|---|---|---|
| 公開日 | 公式ブログ 2026-08-05、論文 arXiv 2608.23552(初版 2026-08-05、現行版 2026-08-24) | [一次確認] |
| ライセンス | MIT | [一次確認] |
| 基盤 | `pi`(`earendil-works/pi`)上に構築 | [一次確認] |
| 2つの中核抽象 | Recursive Language Model(RLM)と Continual Harness | [一次確認] |
| RLM の定義 | コンテキストを変数として扱い、サブエージェント委譲を REPL 内の関数呼び出しとして扱う | [一次確認] |
| サブエージェントの実体 | それぞれが独自のモデル、IPython カーネル、セッションツリー、会話履歴を持つ `prime-agent` インスタンス | [一次確認] |

---

## 3. システムプロンプトの組み立て

実装: `packages/coding-agent/src/core/system-prompt.ts` の `buildSystemPrompt`。[一次確認]

### 3.1 連結順序(カスタムプロンプトを使わない通常経路)

1. `buildRlmPrompt(...)` の出力(基本プロンプト。`src/core/prompts/rlm.ts`)
2. `buildSubagentGuidance(...)` の出力(「Delegating to sub-agents」節)。挿入条件は「再帰が許可されている(`allowRecursion` が未指定なら true 扱い)」かつ「`ipython` が有効」
3. Continual Harness の状態(`formatHarnessStateForPrompt`。サブエージェント仕様のメニューを含む)
4. `# Additional Guidance`(追加ガイドライン)
5. `# Project Context`(プロジェクトのコンテキストファイル)
6. スキル一覧(`formatSkillsForPrompt`。IPython または bash が使えるときのみ)
7. `appendSystemPrompt`(指定時)

ソース内コメントによれば、委譲ガイダンスは `buildRlmPrompt` の後ろ、ハーネス状態メニューの前に置かれる。「いつ・なぜ委譲するか」を読んだ後に、照合できる具体的なサブエージェント仕様を見せる順序とされている。[一次確認]

### 3.2 カスタムプロンプトの場合

`customPrompt` が指定されると、基本プロンプトは置き換えられる。その場合も次は付加される。[一次確認]

- プロジェクトコンテキスト、スキル一覧、日付、作業ディレクトリ
- 子エージェント向けの doctrine(`buildChildAgentDoctrine`。深さが1以上のときのみ)
- ハーネス状態、`appendSystemPrompt`

### 3.3 不変性

基本システムプロンプトはイミュータブルで、`/refine` は補足層(ハーネス層)のみを編集する。ロールバックは変更履歴 ID で可能。[一次確認]

### 3.4 再帰の無効化

深さ制限で再帰が無効なとき、システムプロンプトは `rlm` 関連 API を案内しない(`allowRecursion` による分岐が `buildRlmPrompt` にある)。デフォルトの最大深さは1で、ルートは子を作れるが、子は孫を作れない(設定で変更可)。[一次確認]

---

## 4. `buildRlmPrompt` が伝える内容(`prompts/rlm.ts`)

以下は文面の要旨(日本語による要約)。原文の引用は最小限にとどめている。

### 4.1 エージェントの位置づけ(全モデル共通の冒頭)

- コードを使ってタスクを解く汎用エージェントであること
- 問題をサブタスクに分解し、コードを書いて実行し、結果を観察し、1ステップずつ反復すること
- 完了したらツール呼び出しを止めて最終回答を述べること

### 4.2 長時間作業の扱い(`LONG_RUNNING_WORK_PROMPT`)

- 遅い作業、または独立して完結する作業は「開始 → ハンドルまたは出力先を記録 → ターン終了」という非ブロッキングの制御ループで扱う。結果は後のターン、または返信到着時に読む
- 委譲が可能で有用なら、独立した実質的タスクを別々のワーカーに割り当て、順次待機せずに並列で走らせる
- `time.sleep()` やシェルの `sleep` によるポーリングで、ターンを開いたままにしない。長い blocking `await` でポーリングを代用することも避ける。待ってよいのは、作業の開始に必要な短い操作、または既に取得可能な結果の確認だけ

### 4.3 そのほかの共通指示

- ルート(深さ0)のみ: ユーザー向けの定期的な進捗報告(`USER_PROGRESS_PROMPT`)
- ユーザー向け文章は簡素化した技術英語を既定とする(`SIMPLIFIED_TECHNICAL_ENGLISH_PROMPT`)
- 作業ディレクトリ、会話ログのパス、再帰深さ、プリインストール済み Python パッケージ、追加パッケージは `uv pip install` で入れること

### 4.4 rlm の仕様説明(`allowRecursion` かつ IPython 有効時のみ挿入)

| 項目 | 伝えられる内容 |
|---|---|
| グローバルな `rlm` | `rlm` は既にグローバル名前空間にある |
| 戻り値 | `await rlm('sub-task')` はタスク受理(admission)直後に返る。戻り値は `rlm_child_id`、`name`、`session_dir`、`model` を持つハンドル。ソースには "never waits for or returns the child's answer" とあり、子の回答は返らない |
| 命名 | `name='api-reviewer'` のように安定した名前を付けられる。兄弟間で一意。省略時はホストが読みやすい一意名を生成 |
| モデル指定 | 子は親のモデルを継承する。別モデルは `await rlm.find_models(...)` で得た正確なセレクタで指定。使えないモデルを指定すると spawn は失敗する(代替モデルへの黙示的なフォールバックなし) |
| 思考レベル | 子は親の thinking level を継承する。`thinking` オプションで、解決後の子モデルが対応する任意のレベルに上書きできる。非対応レベルは spawn 失敗 |
| 未知のオプション | 無視されず失敗する(rlm-runtime.md の記述) |

### 4.5 結果の受け取り(`agent_message` スキルがある場合)

- 子は回答が必要なとき、`await agent_message.send(message, receiver_role='parent')` で明示的に返信する。返信やフォローアップは通常のエージェントメッセージとして届く。すべてのタスクに返信が必要なわけではない
- `await agent_message.list_agents()` で家族(親・兄弟・子)を発見できる
- `await rlm.list_subagents()` で直接の子のハンドルを復元できる(コンパクションやカーネル再起動の後も有効)
- フォローアップは `agent_message.send(..., receiver_role='child', receiver_name=child.name)` で送る
- `agent_message` がない場合は `rlm.list_subagents()` と、子が書いたファイルの確認で回収する

### 4.6 観察(`agent_observe` スキルがある場合)

- `agent_observe` で子のロールアウトを確認できる。範囲は親・兄弟・直接の子に限定され、深い子孫は中間の子を介して確認する
- ない場合は、子が書いたファイルを読む

### 4.7 起動と削除

- 独立した子は、別々の呼び出しで spawn し、完了を待たずにターンを終える。返信は複数ターンにわたって届き得る
- 不要になった直接の子は `await rlm.delete_subagent(child)` で明示的に削除する

### 4.8 REPL の制御(`REPL_CONTROL_PROMPT`)

- `ipython` は永続 Python REPL で、推論、コンテキスト管理、状態、ツールのオーケストレーション、再帰サブコールのための長寿命の制御環境。トップレベルの `await` が使える
- コンパクション時に、シリアライズ後16 MiB を超える変数は個別に除去される。大きなソースデータはディスクに置き、必要時に再読込する
- Python はオーケストレーション言語。ループ、条件分岐、パース、状態管理は Python で書く。`bash()` はプログラム起動用で、シェルのループやヒアドキュメントは使わない
- `bash(command)` はバックグラウンドでシェルコマンドを起動してハンドルを返す。`h.pid`、`h.running`、`h.tail(n)`、`h.output()`、`h.poll()`、`h.kill()`、`await h` が使える。`subprocess` や `os.system` はカーネルをブロックし、ユーザーに表示されず、ハーネスから見えないプロセスを生むため使わない
- 調査対象(リポジトリ等)の依存関係を、カーネルへ入れて動かさない。対象プロジェクト固有の環境と通常コマンド(例: `uv run ...`、`.venv/bin/python ...`)で評価し、REPL は調整と分析に使う
- 読み取り・検索結果は名前付き変数に代入し、後で再利用できるようにする
- 各 `bash()` は独立プロセスのためシェル状態は持続しない。作業ディレクトリは `os.chdir(...)`、環境変数は `os.environ[...]` を使う
- `rlm.harness` と `rlm.get_harness_state()` で Continual Harness の状態を読み書きできる。メモリ、スキル、サブエージェント、プロンプトノートそれぞれに `create_*`、`update_*`、`delete_*` がある。`global_=True` は、安定したセッション横断の教訓にのみ使う(Python の予約語のため `global=True` は構文エラー)
- 用語の区別: Continual Harness は永続化されるプロンプト・メモリ・スキル・サブエージェント層の名称。RLM はランタイム、REPL カーネル、モデルに公開されるネイティブ呼び出しインターフェースの名称
- **ネイティブ呼び出し契約**: インストール済み Python スキルはプリインポート済みモジュール。対応する SKILL.md を読み、文書化された関数を `await <skill_import>.<function>(...)` で呼ぶ。`call_skill(...)` や `run_subagent(...)` のような非ネイティブなラッパーを発明しない

### 4.9 スキルの案内

- インストール済み Python スキルがプリインポート済みであることを列挙する
- 各スキルの API は SKILL.md、`help(<skill>)`、`dir(<skill>)`、`inspect.signature(...)` で調べるよう指示する
- 各スキルは同名のシェルコマンドとしても使えること(`<skill> --help`)
- `edit` スキルがある場合、既存ファイルの局所編集は REPL からの `await edit(path=..., old_str=..., new_str=...)` を優先するよう指示する(三重引用符を含むテキストの扱いにも言及あり)
- 起動時プロンプトに入るのはスキルのメタデータのみ。SKILL.md の全文は、タスクが該当したときにモデルが読み込む(docs/rlm.md)

### 4.10 refine の案内(`refine` スキルがある場合)

- 反復する失敗や再利用できる戦術を観察した後に、証拠に基づく小さな更新として扱う。診断し、最小の関連コンポーネントを更新し、次の行動で検証し、結果を記録する
- `await refine.run()` は、反復する委譲パターンをサブエージェント仕様へ、反復手順をスキルへ、永続的な事実や選好をメモリへ、狭い行動方針をプロンプト補足へ変換する。即座に戻り、現在のターン終了時に実行される
- 焦点を絞ったメモリ、スキル、プロンプトノート、サブエージェント仕様で足りる場合は、ハーネス全体を書き換えない

---

## 5. `buildSubagentGuidance` が伝える内容(「# Delegating to sub-agents」節)

導入経緯: v0.2.5 のリリースノートに、再帰が使えるときに並列・バックグラウンドの rlm 呼び出しを促す委譲ガイダンスの追加(#306)がある。[一次確認]

| 要素 | 内容 |
|---|---|
| 基本形 | 独立して完結する作業は `handle = await rlm('task', name='worker')` で起動する。戻りは完了ではなく受理時点。後で停止や確認ができるようハンドルを保持する |
| 返信(`agent_message` あり) | 必要なら明示的に返信を求める。子は `agent_message.send(..., receiver_role='parent')` で返信し、親のフォローアップは `receiver_role='child'` と子の名前または ID を使う。すべてのメッセージに返信が必要なわけではない |
| 復元 | カーネル再起動やコンパクションの後は `await rlm.list_subagents()` を使う |
| 観察(`agent_observe` あり) | 範囲を限定したトランスクリプト確認に `agent_observe` を使う |
| 集約(fan-in) | 子にファイルを書かせ、そのファイルを読む |
| 委譲の基準 | 文脈量の多い並列調査、または独立した実装は委譲する。単発で既知の検索・編集・コマンドは自分のカーネルでインライン実行する |
| refine あり | 本当に再利用できる委譲パターンは `await refine.run()` で保存する |

関連するリリースノートの変更点(いずれも [一次確認]):

- `rlm(...)` が、完了待ちからタスク受理時点での返却に変更された。`result.answer` を読む旧コードや、`asyncio.gather(...)` を fan-in として扱う旧コードは更新が必要
- サブエージェントのガイダンスが、再利用できる子を保持し、完了した直接の子は不要になったら削除する方針に変更された
- 子の終了通知が、匿名のフォローアップではなく、送信元付きのエージェントメッセージとして届くよう修正された

---

## 6. 子エージェント側に伝えられる内容(`buildChildAgentDoctrine`)

深さが1以上のときだけ挿入される。[一次確認]

- 自分が親エージェントから spawn された子であること、タスクプロンプトには `[task from parent]` のラベルが付くこと
- `agent_message` と IPython が使える場合、回答が必要なタスクでは `await agent_message.send(message, receiver_role="parent")` で明示的に返信すること。すべてのメッセージやタスクに返信が必要なわけではなく、送信後は後片付けを続けて通常どおりアイドルに入ること
- 通信と観察の範囲は、親・兄弟・直接の子に限られること。ルート同士は兄弟として扱われ、より深い通信は中間の子が中継する

---

## 7. カーネル側の仕組み(プロンプト外の「伝達」)

### 7.1 プリロード

- IPython カーネルの初期化時に、各スキル/ツールがモジュールとして事前にインポートされ、`rlm` もその一つ(公式ブログ)。[一次確認]
- `await rlm("subtask")` と `await rlm.run("subtask")` は等価(rlm-runtime.md)。[一次確認]
- v0.2.5 で、並列サブエージェント誘導が初回に失敗する問題に対して、カーネルのブートストラップで `asyncio` を事前インポートする修正が入った。[一次確認]

### 7.2 Python API(`prime-agent-runtime`)

エクスポートされるもの: `rlm`、`run(prompt, **kwargs)`、`find_models(query, limit)`、`list_subagents()`、`delete_subagent(selector)`、`host_request(request_type, payload)`、`RLMSpawnHandle`、`RLMModel`、`RLMSubagent`、`TokenUsage`。[一次確認]

`rlm.run` がサポートするオプションは `name`(一意で読みやすい子セッション名)と `model`(`rlm.find_models()` が返す正確な `provider/model`)。未知のオプションは失敗する。[一次確認]

`rlm.find_models(...)` は、認証済みモデルカタログを検索して照合する(完全一致、前方一致、部分一致のスコアリング)。カタログ全体はシステムプロンプトには入れない。[一次確認]

### 7.3 ホスト要求の経路

1. モデルが `await rlm("inspect the API", name="api-reviewer")` を実行
2. Python シムが Jupyter comm(`host.request`)経由で `rlm.run` 要求を送る
3. TypeScript の `KernelManager` が要求を親 `AgentSession` に振り分ける
4. 親が深さを確認し、モデルを解決し、タスクを受理し、レジストリを更新して、`RLMSpawnHandle` を返す
5. 子は同じ TypeScript エージェント機構で独立した `AgentSession` として動く。結果は後から `agent_message` の返信かファイルで届く

`host.request` への応答には、シェルチャネルではなくコントロールチャネルが使われる。IPython はシェルメッセージを直列処理するため、シェルで応答するとデッドロックするため(rlm-runtime.md)。[一次確認]

### 7.4 深さ制限と失敗時の挙動

| 事象 | 挙動 |
|---|---|
| 深さ制限に到達 | Python が comm を開く前に例外を送出し、ホストも再確認する |
| 未対応オプション | ホストが要求を拒否する |
| 指定モデルが利用不可 | 別モデルへ置換せず spawn が失敗する |
| 子のキャンセル | ホストが子を中断し、失敗・キャンセルした子をレジストリから外す |
| 親の終了 | 稼働中の子孫がキャンセルされ、ランタイムが閉じられる |

---

## 8. Continual Harness 経由の伝達

- ハーネス状態は H = (ρ, G, K, M)(プロンプト、サブエージェント、スキル、メモリ)として形式化され、`rlm.harness` から読み書きできる。変更はディスクにも書かれ、セッションをまたいで残る。[一次確認]
- すべての構成要素が同じ CRUD 面を持つ(`create_prompt_note`、`create_memory`、`create_skill`、`create_subagent`、`update_X`、`delete_X`、`list(kind)`、`get(kind, id)`)。[一次確認]
- `/refine` は、軌跡を読み、最小の関連 CRUD 編集を適用するパイプライン。計画(LLM 呼び出し)はバックグラウンドで走り、適用(ディスク書き込みとシステムプロンプトの再構築)は次のターン境界で行われる。[一次確認]
- セッションローカルの状態は `harness/harness_state.json`(セッションのアーティファクトディレクトリ内)、明示的にグローバルな項目は `~/.prime/agent/harness/` に置かれる。[一次確認]
- 公式ブログは「将来のモデルは手取り足取りのプロンプトへの依存を減らし、直接的なプログラム制御に頼る」と期待を述べている(趣旨の要約)。[一次確認]
- 論文付録には、`rlm` と `agent_message` による並列オーケストレーションの例がある(reviewer と tester の2つの子を非同期に起動し、`rlm.list_subagents()` で復元して後続メッセージを送る)。[一次確認]

---

## 9. 利用例(公式ブログ・docs 掲載の形)

並列ファンアウトと後続操作の概略(コード形状のみ。完全な原文は公式ブログとドキュメントを参照):

- `await rlm("<タスク文>", name="auth-expert")` のように、独立した子を別々の呼び出しで起動する
- 起動後は独立した作業を続け、子は `agent_message.send(..., receiver_role="parent")` で返信する
- 後から `children = await rlm.list_subagents()` で復元し、`agent_message.send(..., receiver_role="child", receiver_name=...)` でフォローアップを送る(`mode="follow_up"` を指定する例もある)

---

## 10. 確認できなかった点・注意事項

- 🟡 **バージョン差の可能性**: 取得できた `rlm.ts` と docs は `rlm(...)` / `rlm.run(...)` 形式。一方、検索スニペットの一つ(GitHub リポジトリの README として返されたもの)には `rlm.spawn(...)` という表記が含まれていた。最新版で API 名が変わったかどうかは確認できなかった。[不確実]
- 🟡 **取得範囲**: `rlm.ts` と `system-prompt.ts` の実物は読めた。`prompts/index.ts` は 404、GitHub の tree ページは robots により取得不可、`formatHarnessStateForPrompt`・`formatSkillsForPrompt` の本体、およびサブエージェント仕様メニューの実際の文面は未読。[不明]
- 🟡 **再帰無効時の記述**: 「深さ制限で再帰が無効なとき、システムプロンプトは API を案内しない」の根拠は、`buildRlmPrompt` の `allowRecursion` 分岐と、別リポジトリ(`nano-rlm`、`rlm-harness`)の説明の組み合わせ。prime-agent 本体のドキュメントに同文の記述は未確認。[推論]
- 🟡 **プロンプトは更新頻度が高い**: 4,500 超のコミット、頻繁なリリース(例: v0.7.0-beta 系)があり、文面は変更され得る。実運用では対象バージョンのソースで再確認が必要。[一般知識]
- 論文には、rlm の使い方を伝える文面そのものは掲載されていない。論文が述べるのは実行意味論、状態階層、オーケストレーション例、評価結果。[一次確認]
- ARC-AGI-3 の 95.5% などの性能値は、Prime Intellect 自身の報告値。独立した再現は確認できていない。本文書の主題(rlm の伝え方)には直接関係しない。[一次確認]

---

## 11. 参照元

一次情報:

- リポジトリ: https://github.com/PrimeIntellect-ai/prime-agent
- docs/rlm.md: https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm.md
- docs/rlm-runtime.md: https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm-runtime.md
- docs/architecture.md: https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/architecture.md
- `system-prompt.ts`(raw): https://raw.githubusercontent.com/PrimeIntellect-ai/prime-agent/main/packages/coding-agent/src/core/system-prompt.ts
- `prompts/rlm.ts`(raw): https://raw.githubusercontent.com/PrimeIntellect-ai/prime-agent/main/packages/coding-agent/src/core/prompts/rlm.ts
- 公式ブログ: https://www.primeintellect.ai/blog/prime-agent
- 論文: https://arxiv.org/pdf/2608.23552
- リリースノート: https://github.com/PrimeIntellect-ai/prime-agent/releases および https://github.com/PrimeIntellect-ai/prime-agent/releases/tag/v0.2.5

二次情報(補助):

- fleet-prime-agent wiki(rlm runtime の説明): https://github.com/Qredence/fleet-prime-agent/wiki/packages--coding-agent--rlm-runtime
- nano-rlm wiki: https://github.com/PrimeIntellect-ai/nano-rlm/wiki
- rlm-harness: https://github.com/PrimeIntellect-ai/rlm-harness
