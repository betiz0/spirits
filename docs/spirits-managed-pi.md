# managed-pi 隔離経路

公式 Pi の固定成果物と事前 bundle した spirits 拡張を 1 組として導入し、起動する仕組みが managed である。**既定の起動経路は managed** で、`spirits` を打つと agent dir を従来と同じ規則で選んでから専用 Pi が起動する。既定経路・バックアップ・fork への戻し方・修復は [spirits-default-launch.md](spirits-default-launch.md) を参照。

`spirits managed-pi` はその中でも**隔離経路**である。保存先を `<managed root>/agent`(既定は `~/.spirits/managed-pi/agent`)に固定し、既存の `~/.spirits/agent` を読み書きしない。既存 agent dir との一致・包含、symlink、managed root 外への解決、`--session` / `--fork` / `--session-dir` / `--export` を起動前に拒否するガードもここだけに効く。既定経路はこれらの拒否を受けけない(既定経路の目的は `~/.spirits/agent` を使うことだから)。隔離経路を残す理由は、互換性ランナーとテストが実データに触れずに専用 Pi を駆動できる足場が必要だからである。`~/.spirits/bin` の契約は変更しない。

## コマンド

```sh
spirits managed-pi install [--version <pi-version>]
spirits managed-pi update
spirits managed-pi repair
spirits managed-pi -- [pi の引数...]
spirits managed-pi help
```

- `install`: **起動役バイナリの版と同じリリース**（`spirits-v<version>`）の manifest を取得し、記録された Pi artifact、拡張 bundle、アセットを取得・検証して `~/.spirits/managed-pi/releases/<set-id>/` に配置する。最新リリースは既定にしない。`SPIRITS_MANAGED_PI_MANIFEST_URL` を設定したときはその URL の manifest を使う（fixture・ミラー用の差し替え）。成功時だけ `current` を切り替える。
- `update`: 同じ規則で manifest を取得し直し、同じ検証付き導入を行う。完了するまで `current` は旧 set を指す。
- `repair`: 導入済み set の `manifest.json`（導入時に取得元 URL を絶対 URL へ解決して保存してある）を使って同じ組を再導入する。bundle の欠落や破損から復旧する。リリースの解決はしない。
- 引数なしまたは `--` 以降: 管理された Pi を絶対パスで起動する。PATH 上の `pi` や既定の compiled spirits へ fallback しない。起動前に隔離 agent dir を確定し、既存 agent dir には触れない。
- `help`: この経路の wrapper help を表示する。Pi の help は `spirits managed-pi --help` または `spirits managed-pi -- --help` で起動する。

未導入、破損、checksum 不一致、非対応プラットフォームでは理由と `spirits managed-pi install` を表示して非ゼロで終了する。隔離 agent dir のパス検査または起動引数の拒否でも非ゼロで終了し、通常経路へは fallback しない。

## 対応表 (manifest)

manifest は release 資産 `spirits-managed-pi-manifest.json` として配布し、次の項目を持つ。

- `schemaVersion`: 形式版。現在は `1`。
- `setId`: release set の識別子。`releases/<set-id>/` の名前になる。
- `platform`: 対応プラットフォーム。現在は `linux-x64` のみ。
- `pi.version`: 専用 Pi の版。
- `pi.artifact.url` / `pi.artifact.sha256`: 公式 Pi artifact の取得元と SHA256。url は絶対 URL または manifest URL からの相対（リリース資産名のみ）。相対で配布するのが実際のリリースの形であり、導入時には `releases/<set-id>/manifest.json` へ**絶対 URL へ解決したうえで保存**する。`repair` は保存済み manifest だけを見るため、この解決が無いと相対 URL の set を復旧できない。
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
- `PI_CODING_AGENT_DIR` と `PI_CODING_AGENT_SESSION_DIR`: 子プロセス環境から除去する。
- `PI_APP_NAME` と `PI_CONFIG_DIR`: 立てない。公式 Pi は identity を実行ファイル隣の `package.json` の `piConfig` から決める (`APP_NAME = piConfigName || "pi"`) で、これらの環境変数自体を読まない。よって identity は overlay `package.json` のみに一本化し、fork 版のインストールが残す変数は除去する (立てても効かず、存在すれば存在するほど「効くノブがある」と誤解させる)。
- `PI_PACKAGE_DIR`: 管理された Pi の package dir に固定する。
- `PI_SKIP_VERSION_CHECK=1`: 常に固定する(呼び出し側の値は上書きし、通常起動と同じ扱い)。
- `PI_TELEMETRY=0`: 未設定時だけ既定する。明示された値は保持する。
- API キー、proxy、provider 設定など保存先以外の変数は保持する。

session dir を環境で固定するのは、継承値やプロジェクトの `settings.sessionDir` が隔離領域外へ保存先を切り替えられないようにするためである。起動は `<managed root>/current/pi/pi` を絶対パスで spawn し、stdio と終了コードを引き継ぐ。

## 設定の永続書き込み

Pi の拡張 API は settings を読むが返さないため、`/spirits-role` の永続化は Pi が書くファイルそのものへ寄せる。書き方は Pi の `FileSettingsStorage.withLock` と同じ手順に一致させる (`core/settings-manager.ts`)。

- 対象は Pi の global settings (`<agent dir>/settings.json`)。project file は trust 判定を伴うので書かない。
- `proper-lockfile` の `lockSync(path, { realpath: false })` を取り、`ELOCKED` を再試行する。
- 取得後にファイルを読み、**変更するフィールドだけ**をマージして書き、解く。未知のキーは現内容からのマージで残る (`models.strong` と `models.role` が Pi のキーと同じ object に並べる)。`models.normal`、`models.thinking.<role>`、`models.steps.<name>.<item>` も同じ object の中の spirits のキーで、`unset` はそのキーだけを削除する。
- 階層のキーは path で書く (`models` → `thinking` → `normal` など)。中間の object が無いときは作り、既にあるものは置き換えない。`models.steps` は兄弟のステップ名を消さない。
- `withFileMutationQueue` は使わない。これは 1 プロセス内の直列化であり、競合する書き手は別のプロセス (fork 版 `spirits` や同じ agent dir を使う別の managed Pi) なので、効くのは file lock だけである。
- 書いてから `ctx.reload()` を呼ぶ。reload はその拡張 runtime を置き換えるので、コマンドの `pi` ハンドルと context は reload 後に触らない。

Pi 本体が読むのは `~/.spirits/agent/settings.json` (managed では隔離 agent dir) で、`enabledModels` など spirits が知らないキーは Pi の editor 側が保持する。spirits 側は `models.normal` / `models.strong` / `models.role` / `models.thinking.normal` / `models.thinking.strong` / `models.steps.<name>.role` / `models.steps.<name>.thinking` / `defaultProvider` / `defaultModel` を、fork 経路と同じキー名で使う。`defaultThinkingLevel` はこの中に無い。spirits はこのキーを読まず、pi の `/thinking` が書き、pi がそこからセッションの thinking level を決める。spirits の thinking の解決順は `models.steps.<name>.thinking` → `models.thinking.<role>` → そのセッションの選択であり、既定のキーそのものは引かない。

## 已知の制約

- **role badge の位置**: managed 経路の role 表示は `ui.setStatus()` の拡張 status line に出る。fork 経路の footer 右側・モデル名の隣の badge とは別の場所であり、あれと同じ配置・同じ永続化ではない。描くのは role を選んだときと、拡張の再読み込み後に session が始まったときの 2 箇所であり、reload で置き換わった runtime でも前の role が表示され続ける。
- **`rlm` の子と第三者 provider**: 子セッションは拡張を読まない。managed 経路で provider をプログラム登録している拡張 (テストの fake provider など) がある場合、その provider は子から見える形にならない。実 provider は `auth.json` / `models.json` を通すため通常は影響がないが、拡張登録に依存する provider を `rlm` の子に使うことはできない。この制限は change `add-managed-spirits-commands` で受け入れ済みとして記録する。
- **公式 Pi の帰属ヘッダー**: managed 経路の起動ヘッダーは公式 Pi のものになる。spirits 独自の branding ヘッダーに置き換える patch は入れない。
- **`/spirits-role` の補完と一覧**: 公式 `/model` の補完メニュー・曖昧検索 (name/description を跨ぐ検索) は無い。コマンド行の参照は `provider/id` と its substring に限られ、モデル名や description からは引けない。対話一覧は `provider/id` を選べるだけで、やはり name/description の検索はしない。一覧は対話 TUI 専用で、print / RPC モードでは開かない（`status` 相当の報告になる）。
- **直近のリクエストは再読み込み以降消える**: `status` と一覧が出す「直近のリクエストが選んだ role・物理モデル・thinking level」は拡張の実行環境の位相にしか無く、session 記録には書かない。設定の書き込みは `ctx.reload()` で実行環境を置き換えるので、設定を変えた**再読み込み以降**は 0 件になり、「No request since the last reload.」が出る。欠落ではなく、位相が reload のまたぎ方で失われるものの一部である。

## 既存データの書き込み互換

`~/.spirits/agent` の読み書き両方向の互換は [docs/agent-data-compat/](agent-data-compat/README.md) に実測を残す。settings の永続書き込みは上の「設定の永続書き込み」の手順で Pi と同じファイル・同じ lock を使うようになったが、sessions・auth・custom entry の書き戻しまで含めた双向の確認は、経路を変えた後も引き続き実測する必要がある。

既定経路は `~/.spirits/agent` をそのまま使うため、この実測が既定経路のデータの安全性そのものになる。実測が覆っていない範囲を「確認済み」として扱わないために、既定経路の初回起動前には agent dir のバックアップを 1 回だけ取る。

過去記録の訂正は [openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md](../openspec/changes/archive/2026-11-03-add-managed-pi-route/completion-correction.md) に残す。元のチェックボックスは書き換えていない。

## 拡張 bundle の契約

`scripts/build-managed-pi-inputs.ts` は `packages/spirits/src/index.ts` を ESM bundle にし、次の host package を external に保つ。

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

host の実体を bundle に含めないのは、rlm の子セッションが親と同じ SDK、SessionManager、config を使うためである。Markdown は文字列として埋め込み、公式 Pi の loader に `with { type: "text" }` を残さない。bundle の checksum は manifest と release 資産の checksum に現れる。

## role / `/clear` / `/model` の限定互換モード

公式 Pi 1.5.0 には `registerModelRoles` がない。spirits 拡張は API の有無を起動時に判定し、ある場合は既存の role 登録を使う。ない場合は仮想モデル `spirits/auto`、skill に基づく strong フェーズ、設定からの既定 role 読み取りを残したうえで、同じ状態に届く別コマンドを登録する。起動時に一度だけ制限内容を通知する。

`/spirits-role` は「対象 項目 値」の 1 行でロールとステップの設定をする。引数なしは対話端末なら設定一覧、それ以外なら `status` と同じ実行報告を出す。語の照合は大文字小文字を問わない。解釈できない行・項目の省略・空の参照では何も変えず、理由だけを出す。設定を書いたあとは `ctx.reload()` を呼ぶので、そのコマンドの `pi` ハンドルと context はそれ以降使わない。設定の書き込みだけが失敗したときは、session の変更を取り消さず、保存に失敗した旨を分けて伝え、reload はしない（読み直す既定値が変わっていないため）。

- `/spirits-role normal|strong` … モデルを変えずに session の role をロックし、badge をその role に更新する。ロックは進行中の step を終える。設定の書き込みが失敗しても session のロックは残り、保存失敗だけを別途伝える。
- `/spirits-role status` … 有効・無効、ロック、現在の step と継続指定、直近のリクエストが選んだ role・物理モデル・thinking level、両ロールの解決結果とその出どころ、既定 role と違う step、読み捨てた設定値を 1 件に出す。
- `/spirits-role <role> model <ref>` … その role のモデルを global settings に保存する。`<ref>` は行末までが参照なので空白を含む。`provider/id` の完全一致を先に試し、部分一致が 1 件ならそれを使う。0 件と複数件は変更せず理由を伝える。振り分け用の `spirits/auto` は候補から除く。
- `/spirits-role <role> thinking <level>` … その role の thinking level を保存する。`<level>` は pi の語彙（`off` `minimal` `low` `medium` `high` `xhigh` `max`）のみ。pi 自身の選択は `set_thinking_level` で、spirits は触らない。
- `/spirits-role <step> role <role>` と `/spirits-role <step> thinking <level>` … そのステップが走るときの role と thinking level を設定する。進行中のステップに限らず、そのステップが走るたびに効く。`<step>` は step 一覧の名前のみ。`unset` はそのキーだけを削除する。

ステップは、継続するものなら run が落ち着いた後も有効なままで、別の開始コマンド、一覧に無いスキル・テンプレートの起動、`/spirits-clear`、ロールのロック、セッションの開始で終わる。分岐間の移動（`/tree`）では、ステップは移動先の分岐の最新の記録に合わせて変わり、移動そのものは記録を追加しない。

一覧（`SettingsList`）は対話 TUI 専用で、ロック・2 ロールの model と thinking・step 設定を行に並べる。ステップは 1 ステップ 1 行で、値は `<role> / <thinking>` の組として出す。選択行の説明には解決結果（実際に応答する物理モデル、実際に応答するロールで解決した thinking level（strong が normal へ落ちれば normal のレベル）、ステップが走るロールと継続するかどうか、直近のリクエスト）が出る。使えない対象は「設定されているが使えない」旨・理由・代わりに応答するモデルを同じ行に出し、通知には出さない。model 行の候補は `ctx.modelRegistry.getAvailable()` から api が `pi-virtual` のモデルを除いたもので、候補が 0 件なら書き込まない。ステップの行は Enter でロールの候補を開き、確定すると同じ行で thinking の候補を続けて開く。候補の一覧も 0 件の案内部品も `Esc` で値を変えずに閉じ、一覧へ戻る。書き込みが失敗したときは理由をその行の説明に出し、一覧の内側で読める（通知ではない）。ステップのロールの書き込みが失敗したときは 2 段目を開かない。一覧でロックを変えたときは書き込みの成否にかかわらず badge をそのロールで描く。編集はコマンドと同じ書き込み経路を通り、一覧を閉じるときに 1 回だけ reload する（何も書かなかったときは reload しない）。対話 TUI 以外では一覧を開かない。

**セッションのモデル選択とその既定保存、thinking レベルの既定保存は、公式の `/model` と `/thinking` で満たせる**。`/spirits-role` が設定するのはロールの対象であり、セッションのモデル選択ではない。`/spirits-role strong model a/b` は strong の要求を `a/b` に流すだけで、session が選んでいるモデルは `spirits/auto` のままで、変わらない。両者を混ぜないため、旧コマンドの移行先も「セッションの選択」と「ロールの対象」に分けて書く。

消した旧コマンド（`spirits-model`）からの対応は次のとおり。1 行で 3 つを指定する形はやめ、対象を名前で書く形に集約した。

| 旧 `spirits-model` | 移行先 | 違い |
|---|---|---|
| `spirits-model <ref>` | 公式 `/model` | 旧 1 行が変えていたのはセッションのモデルである。それを今やるのは公式 `/model` で、`/spirits-role` はセッションの選択を変えない |
| `spirits-model <ref> <level>` | 公式 `/model` と公式 `/thinking` | セッションのモデル選択とその既定保存は公式の 2 コマンドが担う。spirits は `set_thinking_level` を呼ばない |
| ロールの対象モデルを設定する | `/spirits-role <role> model <ref>` | 設定するのはその role の要求が何を応答するかで、session が何を選んでいるかではない |
| ロールの thinking level を設定する | `/spirits-role <role> thinking <level>` | 同上。pi のセッション選択とは別に、ロールの要求に載る level を決める |
| `spirits-model <ref> <level> <role>` | ロックなら `/spirits-role <role>`、続けて `/spirits-role <role> model <ref>` と `/spirits-role <role> thinking <level>` | 保存と lock は別の行になる。ロックのみが session を変える |
| 補完なしの 1 行指定 | `/spirits-role`（対話一覧） | 一覧は `getArgumentCompletions` とは別に、選べる値を出す。公式 `/model` の曖昧検索は依然として無い |
| ステップ 1 件の指定 | `/spirits-role <step> <role\|thinking> <値>`、または一覧のステップの行 | 一覧のステップは 1 行で、Enter からロール → thinking の 2 段を選ぶ |
| `/spirits-role <role>`（従来） | `/spirits-role <role>` | 変更なし。badge と `spirits_role` エントリも同じ |
- `/spirits-clear` … 直前までの会話を LLM context から除く。`spirits_clear` の境界エントリを 1 件追加し、`context` イベントで境界より前の投影メッセージを落とす。session ID・chat 表示・TODO・goal・memory はそのまま。消した会話が要約に載って戻ってくることはない。

### `/spirits-clear` の境界が及ばない範囲

境界はリクエストに載る会話だけを削り、session ファイルは書き換えない。だから 3 つの場所で「消えたはずの会話」が再び効いてくる。

- **使用量の推定と自動 compaction の発火タイミング**。`getContextUsage()` の token 推定と閾値判定は `context` イベントを通らない。境界より前のメッセージは pi がビルドする元の context のまま計上されるので、`/spirits-clear` の直後は使用量が減って見えやすく、自動 compaction も消す前の会話量で測ったタイミングで発火する。リクエスト自体は境界より後だけを送り続けている。引き取った compaction は `firstKeptEntryId` を境界に置くため、その 1 回のあとから推算も境界より後だけで測られる(前提確認 [precondition-results.json](../openspec/changes/archive/2026-11-10-add-managed-spirits-commands/evidence/precondition-results.json) の `B(b).automatic-compaction-fired` と `B(b).projection-shrinks-after-the-intercepted-compaction`)。
- **`/tree` で境界より前のノードに移ったとき**。フィルタは現在枝上の最新境界を見るので、境界より前を指すとそこまでの会話が再び context に載る。境界より後ろへ移れば効いたままだ。
- **fork をまたいだとき**。管理経路が内部で使う fork は全 entry をコピーするので境界も引き継がれる。同じ session を fork 経路(拡張に `registerModelRoles` がある経路)で開くと、その session で managed の `context` handler は登録されず、消した会話が載り返す。fork 経路自身に `/clear` 相当の機構がないため、境界をまたいで fork 経路に持ち込んだ session をそのまま続けることは移行条件として要求しない。

また、境界より前を約対象にする自動 compaction は `session_before_compact` で引き取り、`firstKeptEntryId` を境界に置いて、消した会話を載せない summary を書く。引き取るのは「その要約範囲に、境界より前で消された会話が残っている場合」だけ。それ以外は pi の通常の要約に渡す。境界の位置だけで判定しないのは、何も消えていない会話(Clear 直後のセッション、直前の compaction 以降だけが残るセッション)まで引き取ると、本来の要約を 1 個失わせ、しかも要約が捨てるはずだったメッセージを全部 keep して閾値超過を引きずるからである。

おのおのの機能は個別に始める。仮想モデルの登録、専用コマンドの登録、startup header、role badge のいずれかが host の API 変更で失敗しても拡張全体は失われず、その機能だけが止まる。失敗した機能名は session start で 1 回通知し、中核（`tsrepl`、`rlm`、memory / goal / skills / prompts、同梱 skill、session TODO）はそのまま動く。routing だけが落ちた場合は保存済みの既定 role を読む位相に切り替えるので、`rlm` の子は物理モデルを選ぶ親では従来どおり親のモデルを、`spirits/auto` を選ぶ親では既定 role に応じた対象を受け取る。

role の所在は経路で違う。fork 経路では role は Pi の `pi.virtual-model-state` エントリに載る（fork の role patch が書く）。公式 Pi でそのエントリは core の所有物なので、managed 経路は spirits 自身の `spirits_role` エントリに書き、Pi のエントリは読むだけにする（fork が始めた session を続けるための one-way handoff）。

| 目的 | 現行機構 | 専用経路 | 代替 / 差異 |
|---|---|---|---|
| review などを strong へ自動振り分け | `spirits/auto`、skill フェーズ、`models.strong` | 利用可 | 同じ拡張側のルーティング。route が選んだ role は拡張の status line に出る |
| normal / strong の固定 | `/model` role suffix と role 登録 | 利用可 | `/spirits-role <role>`。別コマンドで、phase lock・`spirits_role` エントリ・`models.role` を書く |
| 最後の role を表示 | core footer badge | 利用可 | `ui.setStatus()` の拡張 status line。モデル名の隣ではなく footer の別の行に出る |
| 稼働状況を読む | 該当なし | 利用可 | `/spirits-role status`。有効・無効、ロック、現在の step、直近のリクエスト、両ロールの解決結果を 1 件に出す。pi は「選んでいるモデル」しか出さず、ロールが何に解決されたかを出す面はない |
| 会話だけを消す `/clear` | core `clearConversation()` | 利用可 | `/spirits-clear`。境界より前を LLM context から除く。chat 表示は残る（core の `/clear` は表示からも消す） |
| role と step の model / thinking | core `/model` parser と保存キー | 利用可 | `/spirits-role <対象> <項目> <値>`。対象は role か step。補完メニューと曖昧検索はない。保存キーは Pi と同一 |
| 設定の一覧編集 | `/model` の selector と `/settings` | 制限付き | 対話 TUI の `SettingsList`。RPC では駆動できず、互換ランナーは `not-run` にする。公式 `/model` はそのまま残る |
| step 別の role と thinking | 該当なし | 利用可 | `models.steps.<name>.<item>`。step 一覧の名前だけを読み、それ以外は `status` が無視した値として出す |

「利用可」は専用経路で同等に動作、「制限付き」は一部の目的だけ維持、「利用不可」は同等の機能がない状態を指す。この change は既定経路の機能を削除しない。既存の `openspec/specs/` の要件は変更しない。

互換性ランナーはこの表を専用 Pi での目的別観測で上書きする。コマンド一覧にコマンドが掲載されていないことだけで組み込み機能の不存在を判定せず、観測できない目的は `not-run` にする。各目的の状態は結果 JSON の `role/clear/model matrix` 項目に記録する。

互換表の各行はランナーの目的定義と 1 対 1 で対応し、目的の定義は `scripts/managed-pi-compat/matrix.ts` にある（role 5 目的、`/clear` 3 目的、model 5 目的）。表の「専用経路」は観測前の見込みで、結果 JSON の各行は専用の目的観測から導出される。

`role/clear/model matrix` 項目の `confirmed` は「専用 Pi で目的の動作を観測した」ことを意味し、「全目的が利用可」を意味しない。観測の結果が `unavailable` であっても観測には変わりないため、行も項目も `confirmed` になる。行と目的の対応、および `unavailable` の件数は同じ項目の `data`(`confirmedMeans`、`rows`、`purposes`)に出るので、読み手は `confirmed` を利用可能性の宣言として扱わない。

## 互換性ランナー

```sh
# fixture モード(既定): 隔離した managed root の fixture set を測る
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root /tmp/managed-pi-fixture

# fixture でも、作業ツリーからビルドした拡張を測れる(インストール済みの release を測らない)
bun scripts/build-managed-pi-inputs.ts --version 0.0.0-0 --out /tmp/spirits-compat-bundle
bun scripts/managed-pi-compat/run.ts --mode fixture --bundle /tmp/spirits-compat-bundle/spirits-managed-pi-extension.js

# official モード: 公式 artifact を検証し、対象 commit の bundle で測る
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <staged-official-artifact-root> \
  --bundle <target-commit-bundle.js> \
  --commit <sha> \
  --bundle-version <version> \
  --out <tmp>/result.json
```

- `--mode` は `fixture`(既定)か `official`。全結果に `mode` が付き、fixture の結果は `fixture-only` として記録される。fixture の成功を公式 Pi の互換性成立の根拠にしない。
- `fixture` でも `--bundle` を受け付ける。指定すると、インストール済み set の Pi をそのままで、拡張だけを入れ替えた set を作業ルートの中に作って測る(既定はインストール済み set そのままなので、作業ツリーの変更は測らない)。set は製品の `verifyManagedSet` を通すため、起動できない set は項目の実行前に落ちる。Pi 側はコピーであって link ではない。`verifyManagedSet` は Pi ディレクトリの overlay package.json を見て、無ければ作るため、link にするとユーザーのインストール済み set まで書き換えうる。公式 tarball はコピーしない(fixture 経路は展開済みツリーを起動するだけ)。
- `official` では `--artifact-root`(`manifest.json` と公式 tarball を置いたステージング領域)、`--bundle`(対象 commit からビルドした拡張 bundle)、`--commit`(対象 commit)が必須。manifest の `pi.artifact.sha256` が製品の信頼基準 `MANAGED_PI_FIRST_ARTIFACT_SHA256` と一致しない場合、結果を書かず非ゼロで終了する。
- ランナーは一時 HOME、一時 agent dir、一時作業ディレクトリを用意し、製品の `resolveManagedAgentPaths` / `ensureManagedAgentDir` で隔離 agent dir を解決する。実 `~/.spirits/agent` などのユーザーデータは読み書きせず、PATH 上の `pi` も使わない。
- 結果は JSON と、その隣に `managed-pi-compat-result.md` の要約を出力する。通常実行でリポジトリの `docs/` を書き換えない。
- 保存前に API キー・トークン・proxy 認証をマスクする。
- 終了コードは `failed` がある場合、または official で `compatibilityMet` が false の場合に 1。既存 agent dir が書き換えられていた場合(`existingAgentDirUnchanged: false`)も `failed` 項目として記録するので 1 になる。

### 結果の読み方

結果 JSON は各項目を `confirmed` / `limited` / `unavailable` / `not-run` / `failed` で記録し、`runnerCompleted` と `compatibilityMet` を区別する。

- `runnerCompleted`: 全項目を処理したか。`not-run` が残る場合は false。互換性の成否は示さない。JSON の `runnerCompletedDefinition` に同じ定義を文字列で持つ。
- `compatibilityMet`: official で必須観測がすべて `confirmed` の場合だけ true。`failed=0` でも必須観測が `not-run` / `limited` / `unavailable` / `failed` なら false。fixture モードでは常に false。JSON では `compatibilityMetDefinition` に定義を持つ。true でも移行・既定経路の切り替え・フォーク削除を認めない。本仕様が未確認のまま置いている既存 agent dir への書き戻しと settings の永続化は必須観測の外にあり、この判定では埋まらない。
- 必須観測は専用 Pi で実測できる項目だけを含む。製品側が応えていないことを理由に項目を落とさない。`rlm child abort` は 5 段階を実測できるため必須観測に残し、製品が記録を出さない場合は項目がそれを示して判定は false のままになる。既存 agent dir への書き戻し互換(`existing agent dir write-back compatibility`)は本仕様が未確認のまま据える唯一の例外で、必須観測に入れない。
- `runnerProvenance`: ランナー自身の来歴。`git rev-parse HEAD`、`git diff HEAD` の SHA256、未追跡ファイル一覧、`clean` を収める。測定対象の bundle が持つ `targetCommit` とは別の値で、判定ロジックがどのコードだったかを示す。official の `workingTreeClean` はここから引く。
- `observationEvidence`: 観測項目と期待する証拠の対応表。
- `runtime`: ランナー側と Pi ホスト側のランタイム、必要 API の有無。観測できない値は `unknown`。
- `logs`: 実行した各項目のコマンドと、取得できた stdout・stderr。長い出力は切り詰めて保存する。
- `existingAgentDirUnchanged`: 一時 HOME の `~/.spirits/agent` に赤化した fixture を置き、全起動の前後で内容と更新時刻が変わっていないことを指紋比較で確認した結果。同じ比較は `existing agent dir untouched` という項目として記録し、`false` なら `failed` にする。要約にも 1 行出す。

内訳は `- Results: confirmed=<n> limited=<n> unavailable=<n> not-run=<n> failed=<n>` で、5 つのラベルを常に並べて出す。標準出力の 1 行も同じ形式で、0 件の状態を省略しない。省略されたラベルが「0」なのか「測らなかった」なのかを読み手に推測させないためである。

要約 `managed-pi-compat-result.md` は先頭に `Runner completed` と `Compatibility met` を定義文つきで掲げ、続けて `Note:` 行として、`confirmed` を読み違えやすい 2 項目但し書きを出す。`rlm child abort` の `confirmed` は条件付きで、`rlm_usage` は親のターンが終わってから追記されるため、記録が読めるのは子が止まった後の読みであり `agent_settled` の読みではない。`role/clear/model matrix` の `confirmed` は「いずれかの目的を専用 Pi で観測した」意味で、同じ行に観測した目的数(`2 of 13` など)を添える。`compatibilityMet` はどちらの意味も持たない。さらに `## Required observations not confirmed` と `## Outside the required list, not confirmed` の 2 節を置く。後者は必須観測以外の `failed` / `limited` / `unavailable` / `not-run` を並べるので、判定を左右しない項目の欠落も冒頭で分かる。全項目の一覧はその後ろにある。

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

物理モデルを選ぶ親と `spirits/auto` を選ぶ親を別項目にする。親が `spirits/auto` を選んでいる場合、製品は親の側で、子の起動前に子の物理モデルを決め、それを子に渡す。いずれの場合も子は親と同じ agent dir の設定を読むため、`settings.json`(`models.strong`、`models.role`、`defaultProvider`、`defaultModel`)、`auth.json`(fake provider の認証)、`models.json`(fake provider の registry)を書く。書き先は隔離 agent dir だけでよい。子セッションは拡張を読まないが、親と同じプロセス内で作られ、agent dir を host 自身の `getAgentDir()` で引く。managed の起動はそれを隔離 agent dir に固定しているため、子も同じ dir を読む。実測でも、fixture を隔離 agent dir だけに置いた子は応答し、`<home>/.pi/agent` にだけを置いた子は `No API key found for compat-fake` で失敗した。親と違い、子には fake provider をプログラム登録する拡張がないため、認証とプロバイダ表はファイルからしか届かない。子の生成・最終回答・`rlm_usage`・中断を個別に記録する。

中断は 5 段階に分けて判定する。abort を送れたか(`abortSent`)、専用 Pi が受理したか(`abortAccepted`)、セルが中断として返ったか(`cellAborted`)、子が止まったか(`childStopped`)、`rlm_usage` が残ったか(`usageAfterStop`)。子は親のリクエストと区別するため子の応答だけを遅延させ、その遅延 reply を持ったリクエストが閉じたことをもって子の停止とみなす。`agent_settled` は親の run が落ち着いた時点であり、切られたツール呼び出しはその後も走り続ける。したがって abort 後は `agent_settled` 時点で 1 回読むだけでは足りず、子が止まるか poll 窓が切れるまで `get_entries` を読み続ける。`rlm_usage` は `pi.appendEntry("rlm_usage", data)` で入るので、`outcome` は `entry.data.outcome` にある(`entry.outcome` ではない)。実測では `agent_settled` 時点の読みでは 0 件、子の要求が閉じた後の読みで 1 件(`outcome` は `aborted`)で、5 段階すべてが揃ったとして `confirmed` になる。かつて「子の最中に呼び出し元が中断されたとき `rlm_usage` の記録が残らない」と書いたのは、`agent_settled` の 1 回読みだけで判定した測定漏れであり、製品欠落ではなかった。訂正と再測定の記録は [product-defect-rlm-usage-abort.md](../openspec/changes/archive/2026-11-06-repair-managed-pi-compat-harness/product-defect-rlm-usage-abort.md)(訂正付き)と [verify2-rerun.md](../openspec/changes/archive/2026-11-06-repair-managed-pi-compat-harness/verify2-rerun.md) に残す。**いまの fixture では 5 段階は揃わない**(`abort sent=true`、`abort accepted=unknown`、`child seen=true`、`cell aborted=false`、`child stopped=true`)。切り分けは `--bundle` で測った。作業ツリーからビルドした bundle と、変更前の commit `f71b6746b` からビルドした bundle を同じ runner で測って同じ出方になり、差は無かった(測った拡張の sha256 は毎回 `runtime.extension` に残る)。したがってこれはこの変更が生んだものではなく、fixture 実行側の既存の問題として記録する。観測できない場合は `not-run` にし、他の項目の判定を変えない。fixture は親のリクエストにはツール呼び出し、子のリクエストにはテキストで応じ、子が `rlm` を再帰的に呼び出さないようにする。`spirits/auto` を選ぶ親は別項目として記録する。子セッションは拡張を読まないため仮想モデルの route はそこで再現できず、解決は親の側で、子の起動前に起こる。したがって判定は子自身のリクエストが何を要求したかで決める。fake provider は受信した各リクエストの `model` を記録し、それを `providerRequests` として result.json に残す。子のリクエストが物理モデル名として届き、最終回答と `rlm_usage` が得られたときだけ `confirmed` にする。子のリクエストが `auto` のまま届いた場合は `failed` とする。`not-run` は次の 2 場合に限る。1 つ目は子の対象にできる物理モデルが fixture に無い場合で、解決を試みた役割と不足していた設定を理由に残す。2 つ目は provider へリクエストを送らない固定イベントの host（fixture 実行）で、何を解決したかを読む手掛かりが無いため `not-run` にする。ランナーは auto の実行の前に必ず子の対象（既定 provider、既定モデル、認証、モデル定義）を fixture へ書くため、専用 Pi の実行で `has no child model` のような解決エラーが出た場合は fixture 不足ではなく、fixture が揃っているのに子が完了しなかったものとして `failed` にする。判定に使う最終回答は、エラーになったセルの文を数えない(`answerOf`)。子を起動していない失敗の文を最終回答に数えて `confirmed` にしないためで、物理モデルを選ぶ項目にも同じ扱いをする。この項目は必須観測に入れないので、状態が `compatibilityMet` を変えることはない。fake provider の成功は実 provider の互換性確認ではなく、実 provider を使うテストはこの change の対象外である。

### 既存データ

redact した既存 agent dir の fixture(`scripts/managed-pi-compat/fixtures/redacted-agent/`)を隔離 agent dir にコピーし、その保存先を専用 Pi に読ませる。読み取りは settings と sessions を `pi.getSettings()` と `ctx.sessionManager.getEntries()`、auth を `ctx.modelRegistry.getProviderAuthStatus()`、外部拡張はその拡張が登録したコマンドを `pi.getCommands()` で観測する。外部拡張の読み取りだけ、host が agent dir の拡張を読むことを許す起動(`--no-extensions` を付けない)を使う。他の項目は誤読を防ぐため `--no-extensions` のままにする。API から届かない項目は `not-run` にする。Node によるファイル読み取りは行わない。

書き込みは `pi.appendEntry()`、`pi.setModel()`、`pi.setThinkingLevel()` で行い、`getEntries()` / `ctx.model` / `ctx.getThinkingLevel()` で読み戻す。この項目名は `dedicated Pi write path` で、専用 Pi の書き込み経路の実測である。既存 agent dir のデータに変換をともなう書き戻しが出来るか(`existing agent dir write-back compatibility`)は別項目のままにし、書き込み経路の成功をそのまま引き継がない。現状は `not-run` であり、未確認であることを結果に残す。settings の永続書き込みが Pi の拡張 API から届かない場合は、その項目を `not-run` にし、Node のファイル書き込みで代用しない。

保存先の解決は製品の `resolveManagedAgentPaths` と `ensureManagedAgentDir` を使う。拒否対象のパス指定は spawn 前に失敗し、隔離領域では `SPIRITS_CODING_AGENT_DIR` を経由せずに product guard が決めた dir だけを触る。書き出された `bundled-skills` が隔離 agent dir 配下に着ることも確認し、保存先が実際に使われている証拠にする。RPC の agent dir は環境変数のエコーに過ぎないため、これ自体を根拠にしない。一時 HOME の `~/.spirits/agent` には赤化した fixture を置いておき、全起動の前後で内容と更新時刻が変わっていないかを指紋比較して `existingAgentDirUnchanged` に記録する。

### アセットと環境

同梱 `SKILL.md` が raw Markdown として bundle に含まれること、`SPIRITS_CODING_AGENT_DIR` の隔離 agent dir への固定、`PI_CODING_AGENT_DIR` の無視、`PI_PACKAGE_DIR` の decoy 耐性、`--help` が隔離 HOME の外を変更しないこと、API キーと proxy が残ることを確認する。bundle 内の host 版が専用 Pi artifact の版と一致し、別 SDK の版を報告しないことも確認する。

### role / clear / model

role、`/clear`、`/model` の目的を専用 Pi で個別に観測する。判定はすべて RPC と fake provider が受けたリクエスト本体から取り、Node による session ファイルの読み取りは行わない。

- role … skill コマンドで strong フェーズに入ったリクエストがどの物理モデルで流れたかを fake provider の受信リクエストから読む。稼働状況の行は `/spirits-role status` を RPC で駆動し、host が受けた `notify` の文言そのもので判定する（`routing:` / `lock:` / `step:` / `normal:` / `strong:` のいずれかが欠ければ `unavailable`、通知が無ければ `not-run`）。ランナーが発話した最後のリクエストが status の報告なので、`step:` と `last request:` も読める状態になる。role 語彙は `/spirits-role <role>` が次に流すリクエストのモデルとして観測する。badge はターミナル上の表示そのものは読めないが、描画は `ui.setStatus()` の RPC なので、host が受けた `setStatus` の本数と文言が観測になる。モデル名の隣ではなく拡張 status line に出るという差異を残して `limited` にする。
- `/clear` … 実行前に `/spirits-clear` のない session でマーカー入りの発話を 1 つ、コマンド実行後にもう 1 つ発話し、コマンド後のリクエスト本体が後マーカーを含み前マーカーを含まないかを fake provider から読む。session ID・会話エントリ数・TODO エントリ数は probe 拡張の `/compat-purpose-state` に RPC で読み取らせ、実行前後で比較する。session ファイルは意図的に全メッセージを残すので、エントリ数だけを持って会話が消えたと判定しない。
- `/model` … 1 本の launch を stage で駆動する。`/spirits-role normal model <ref>` → `/spirits-role normal thinking <level>`（各行が `ctx.reload()` を呼ぶ）→ `set_model` で `spirits/auto` を選ぶ → 発話、という順序のあと、fake provider が受けた要求本文の `model` と reasoning level を読むのが thinking level の判定で、`pi.setThinkingLevel()` は使わない（fake provider の 2 モデルは `reasoning: true` なので level が本文に出る）。保存の成否は、コマンドの `ctx.reload()` のあとに再生成された runtime が `pi.getSettings()` で読み返した値で判定する。Node によるファイル読み取りは、Pi が実際に読み込んだ既定値の代用にしない。
- セッションのモデル選択 … `set_model` の応答が返したモデルと、`get_state` が返した session のモデルを比較する。読むのは振り分け用モデルの要求が落ち着いた後で、`set_model` と同じ stage で即 `get_state` を読むと session が開始時に選んでいたモデルが返る（選んだ値そのものは `set_model` の応答に出る）。ロールの対象の行とは別の行で、`spirits/auto` が選ばれていれば十分で、どの物理モデルに解決されたかは問わない。
- 設定一覧と公式 `/model` の既定保存は RPC で駆動できないので、その目的は理由を添えて `not-run` にする。`unavailable` は機能の欠落、`not-run` は計測経路の欠落であり、混ぜない。

コマンド一覧に掲載されていないことだけで組み込み機能の不存在を判定せず、観測できない目的は `not-run` にする。各目的の状態は `available` / `limited` / `unavailable` / `not-run` で記録し、代替案と差異は目的定義に一度だけ持ち、行と観測の両方へ写す。

状態の意味は次のとおりで、行と観測の両方に同じ規則が当たる。

- `available` … 目的がその経路で満たされ、利用者の目に見える違いもない。
- `limited` … 目的は満たすが、目に見える挙動が違う。理由を行の `difference` に書く。
- `unavailable` … 目的が満たされない。観測できた失敗なので `not-run` とは区別する。
- `not-run` … 観測できなかった。理由を detail に書く。

**観測手段の制約は `limited` の理由にしない**。「RPC が thinking level を返さない」は Pi の機能の欠けではなく計測経路の制約なので、detail に書き、状態は目的の成否で決める。成否そのものが読めないなら `limited` ではなく `not-run` である。代替手段で満たした観測は detail に `alternative` を語として含め、行は `alternative` と `difference` を必ず持つ。`not-run` の行は持たなくてよい。検証関数は `not-run` 以外の行にこの 2 つが揃っていること、`limited` の行が `None` で始まらない差異を挙げていること、観測した目的の detail に `alternative` が含まれていることを確認する。

マトリクスの行は目的観測から導出する。観測しなかった目的の行は `unavailable` ではなく `not-run` になり、行と目的の状態が矛盾しないことを検証関数で確認する。

### `/spirits-clear` の境界の後

境界はリクエストから会話を削り続ける。だから「その後ろで context を組み直すもの」ごとに、境界がまだ効いているかを実測する。5 つは必須観測に入っており、公式実行で `confirmed` でなければ `compatibilityMet` は false になる。判定に使うのは fake provider に届いた本文のマーカー、probe 拡張が `ctx.sessionManager.getEntries()` から書き写した compaction entry の `summary` と `fromHook`、同じく probe 拡張が記録した session ファイルの 3 つだけ。RPC の `get_entries` は compaction entry を返さないので、要約と作者はセッションを書いているプロセスの側で読むしかない。pi が自分で要約するときの prompt は 2 形ある ( span の要約と split turn の prefix の要約) ため、どちらが届いても「肩代わりしていない」と読めるようにする。

| 項目 | 駆動 | 期待 |
|---|---|---|
| `clear boundary automatic compaction` | `settings.json` に `compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 }` を書き、fake provider は後マーカーの入った最初のリクエストだけで大きい usage を返す。pi は turn の終わりに閾値を見るので、発火は clear の後ろに来る。1 回きりにするのは、後続のリクエストが同じマーカーを持っていて 2 回目の compaction が走らないようにするため | 境界の後で発火した compaction が拡張の書き込んだ entry で ( `fromHook: true`、要約は clear 用の固定文)、要約のためのモデル呼び出しが 0 件で、その後のリクエストに前マーカーが戻らない |
| `clear boundary manual compaction` | RPC `compact` を 2 通り。消した対話が要約範囲に残る場合と、境界より後ろの対話しかない場合 | 前者は肩代わりして要約 0 件、後者は肩代わりせず Pi 自身の要約ができる。pi が「Nothing to compact」「Already compacted」で断った場合は `not-run` |
| `clear boundary fork` | 境界入りのセッションを `--session <file>` でシードし、RPC `fork` に境界より後の user entry を渡す | 新しい session ファイルになり、そのセッションのリクエストに前マーカーが戻らない |
| `clear boundary tree move` | RPC にツリー移動の command は無いので、probe 拡張の `/compat-purpose-navigate <entryId>` から `ctx.navigateTree()` を呼ぶ | 境界より前へ leaf を移すと前マーカーがリクエストに復活する。docs の「境界より前に移るとフィルタが外れる」どおりの挙動 |
| `clear boundary resume` | シードした session ファイルを `--session <file>` で別プロセスとして開き直す | 前マーカーがリクエストに出ない |

シードは runner が決めたパスのセッションファイルに作るので、fork も resume も同じパスを指定して開き直す。`ctx.sessionManager.getSessionFile()` はセッションがまだファイルを持っていないと `undefined` を返すため、パスの根拠は runner 側になる。隔離 agent dir に session ファイルが増えるだけで、判定済みの既存 agent dir 不変の検査とは無関係である。RPC にも拡張 API にも操作が無い項目は `not-run` にし、観測のための足場を新しく作らない。
