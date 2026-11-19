# spirits

[English](README.md) | **日本語** | [简体中文](README.zh.md) | [Deutsch (Schweiz)](README.de-CH.md)

spirits は、公式 [Pi](https://github.com/earendil-works/pi) の固定 artifact の上に動く拡張 bundle と薄い起動役で、Prime Intellect の [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) が実現している実行モデルを TypeScript / Bun で再実装するプロジェクトです。Pi のソースは含みません。`~/.spirits/managed-pi` に固定した公式 Pi のリリースを置き、コンパイルした `spirits` 実行ファイルがその一式を検証してから、spirits 拡張をロードして起動します。

個々のツール呼び出しのループではなく、永続 TypeScript REPL(`tsrepl`)をモデルの主インターフェースにします。モデルは TypeScript のセルを書き、セルをまたいで状態を保持し、ホスト関数を呼び出し、子エージェントを再帰的に起動できます。さらに、セッションを跨いで自分のメモリ・スキル・code-mode プロンプトを更新できます(Continual Harness)。

> **ステータス:** M1–M4(永続 REPL、単一バイナリ配布、同期 `rlm`、Continual Harness)は実装済み。M5(Phase 2 拡張)はドッグフーディングに基づく Go/No-Go 判断待ち。リリースタグは `spirits-v*`。対応は Linux x86_64 のみ。

## 機能

- **永続 TypeScript REPL** — 主力ツールは `tsrepl`。セルは `Bun.Transpiler` で変換し `node:vm` コンテキストで実行、`globalThis` への代入はセルをまたいで永続します。`return` / `out()` で値を返し、`print()` の出力を捕捉。エラーは原因行と修正案付きで整形。`use()` は `node:` / `bun:` 組込と cwd 相対モジュールを import。`tool()` はホストのツール実行経路で他のツールを呼びます。
- **再帰的な子エージェント** — `await rlm("prompt")` がプロセス内で子エージェントを実行し、最終回答を文字列で返します。深度上限(既定 2)、同一 REPL からの直列化、中断の子への伝播、呼び出しごとの `rlm_usage` 記録(トークン・コスト集計)を行います。
- **Continual Harness** — `note()` でセッション横断メモリを追記、`goal()` でブランチのゴールを管理、codemode ツールでスキル管理(`spirits_skill_*`)、code-mode プロンプトの上書き(`spirits_prompt_set`)を行います。
- **セッション TODO と非破壊クリア** — `manage_todos` が現在のセッションブランチに紐づく TODO を管理し、エディタとフッターの間にパネル表示します。`/spirits-clear` はモデル・思考レベル・拡張状態を保ったまま新しい会話ブランチを開始します。
- **2 系統のモデル振り分け** — `/model spirits/auto` は 1 つの選択を保ったまま、リクエストごとに normal / strong へ振り分けます。OpenSpec のレビューと深い検証の 2 スキルだけ strong(`settings.json` の `models.strong`)、ほかは既定モデルで動きます。
- **単一バイナリ** — 起動役は `bun build --compile` でコンパイルし、Pi のソースを含みません。初回起動で固定したホスト一式を取得してチェックサムを検証し、そのあとに起動します。実行環境に Bun / Node は不要です。

## インストール

Linux x86_64(glibc)のみ。インストーラは配置前に SHA256 を検証します。

```sh
curl -fsSL https://raw.githubusercontent.com/betiz0/spirits/main/scripts/install.sh | sh
```

`~/.spirits/bin/spirits` に配置されます。必要なら PATH を通します:

```sh
export PATH="$HOME/.spirits/bin:$PATH"
```

バージョン指定は `VERSION=0.1.0 sh ...`、確認は `spirits --version`(spirits のバージョンと同梱 Bun のバージョンを表示)、アンインストールは `... | sh -s -- --uninstall`(削除用の `rm` コマンドを表示するだけで、自動削除はしません)。

インストール済みの実行ファイルは `spirits update` で更新します:

```sh
spirits update           # 最新の stable に交換し、その版の managed 一式を導入
spirits update self      # 同じ意味を明示した形
spirits update --force   # 最新版でもう一度ダウンロード
```

`spirits update` は SHA256 を検証し、`~/.spirits/bin/spirits` を atomic な rename で交換し、更新先のリリースの managed 一式を導入します。インストール済みの版が最新の stable と同じ (またはそれ以上) なら `spirits <version> is already up to date` と表示し、実行ファイルは触りませんが一式の導入は行います。`PI_OFFLINE=1` (`true` / `yes` も可) はネットワークを使わずに拒否します。更新の要求は 10 秒データが無ければ失敗し、`SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS` (正の整数秒) で上書きできます。

`spirits update` が受け付けるのは上の形だけです。`--all`、`--extensions`、`--models`、`-h`、未知のオプション、`self` / `pi` 以外の位置引数は案内して非ゼロで終了します。黙って透過すると扱えないフラグが更新の成功に見えてしまうためです。**0.7.x からの移行は `spirits update` を使ってください**。`spirits update --all` は自己更新形ではなくなりました。

ホストと spirits 拡張 bundle は spirits のリリースに従うので、`spirits update` がそのままホストの更新です。これとは別に実行するのは次の 2 つです:

```sh
spirits managed-pi update                                # 実行ファイルを変えずに pinned の一式を更新
~/.spirits/managed-pi/current/pi/pi update --extensions  # host の package と model catalog
```

2 つ目は host 実行ファイルで実行します。起動役は拡張 bundle を常に利用者の引数より先に渡すため、`spirits -- update ...` は model への prompt になり、host のコマンドにはなりません。host の他のコマンド (`install`、`remove`、`uninstall`、`list`、`config`、`auth`、`mcp`) も同じで、`spirits <コマンド>` は拒否され、実行すべき host 実行ファイルのパスが表示されます。

`install.sh` の再実行も従来どおり動きます: 最新版の解決ではインストール済み版が一致すればダウンロードをスキップし、`spirits <version> is already up to date` を表示します。強制的に再取得して配置するには `VERSION=x.y.z` を使います。0.1.0 のバイナリは自己更新導入前なので、0.1.0 からは 1 回 `install.sh` を実行してください。以降は `spirits update` が使えます。

テーマはホストの artifact が提供します。起動役は `~/.spirits/bin/theme/` を配置しません。旧版が置いたディレクトリは使われないので削除して構いません。

インストーラは最新の `spirits-v*` リリースを解決します。リリースがまだ無い場合はソースからビルドしてください(下記「開発」参照)。

## クイックスタート

```sh
spirits
```

モデルにタスクを依頼すると、`tsrepl` のセル経由で作業します:

```ts
// セルをまたぐ状態は globalThis に置く
globalThis.rows = await (await use("./load.ts")).load();

// 委譲: 子は独自の REPL セッションで動く
return await rlm("行を要約して JSON で返して。");
```

詳細・制約は [`packages/spirits/README.md`](packages/spirits/README.md) を参照してください。

## 同梱スキル

spirits はインストール直後から使えるスキルを同梱します。起動時に `<agentDir>/bundled-skills/<spirits の版>/` へ書き出し、pi のスキル探索へ渡します。`<agentDir>/skills/` には置きません。

- 同梱スキルは次の 3 つです。
  - `sprt-architecture-guards` は TypeScript リポジトリを実測し、アーキテクチャ規約の正本とそのリポジトリのテストランナーで動く検査を生成します。
  - `sprt-opsx-verify-deep` は OpenSpec の変更を、既定の verify とは独立に深く検証(verify2)します。
  - `sprt-opsx-review-change` は `/opsx-apply` 開始前に OpenSpec の変更をレビューし、開始可否を YES/NO で判定します。
- 同梱スキルは `/skill:sprt-architecture-guards` のように明示起動します。ほとんどの同梱スキルは `disable-model-invocation: true` を持つため、モデルが自動選択することはありません。`sprt-opsx-review-change` は例外で、モデルが自動選択することがあります。
- `<agentDir>/skills/<名前>/` に同名の利用者スキルがある場合は、利用者版が常に優先されます。pi は利用者版を採用し、衝突警告を表示します。同梱版はスキップされます。
- `SPIRITS_BUNDLED_SKILLS=0` で同梱スキル全体を無効化します(未設定・その他の値は有効)。無効時は書き出しも供給も行いません。
- spirits を更新した後、新しい同梱内容を反映するには spirits を再起動してください。同梱内容は実行中のバイナリに埋め込まれているため、`/reload` は実行中の版のツリーを書き出し直すだけです。旧版ディレクトリは、7 日以上使われなかった場合にだけ書き出し時に削除されます。
- `bundled-skills/` は spirits の管理領域です。そこのファイルを編集せず、自分のスキルは `<agentDir>/skills/` に置いてください。

## モデルの振り分け

OpenSpec ワークフローでより強いモデルを要求するのは 2 ステップだけです。変更をレビューする `sprt-opsx-review-change` と、深く検証する `sprt-opsx-verify-deep`。手でモデルを切り替えて戻し忘れる代わりに、1 つのモデルを選択したままリクエスト単位で振り分けます。

- `/model spirits/auto` で振り分け用のモデルを選択します。既定モデルの設定、`--model`、`/model` の挙動は変えず、物理モデルを直接選んでいるセッションは振り分けません。
- strong の対象は `settings.json`(`~/.spirits/agent/settings.json`、またはプロジェクトの `.pi/settings.json`)に書きます。

  ```json
  { "models": { "strong": "anthropic/claude-opus-4-7" } }
  ```

  モデル ID だけ(`"claude-opus-4-7"`)を書いた場合は、その時点の既定 provider で解決します。ただし `models.strong` は `provider/id` で書いてください。`save` が既定 provider を `spirits` に変えると、provider を省いた strong は解決できなくなるからです。`models` は spirits のキーで、pi は他の設定を保存するときにもこのキーを保持します。
- propose / apply / verify / archive は normal で、既定 provider と既定モデルへルートします。既定が解決できないときは直近の成功レスポンスのモデルに寄り、1 回通知します。`sprt-opsx-review-change` または `sprt-opsx-verify-deep` の実行中のリクエストは strong へ、run が settled すれば**ロックしているロール**に戻します(Escape の中断でもエラーでも戻します)。
- `/spirits-role <normal|strong>` でロールをロックします。ロックはあとの入力でも続き、別のロールをロックすれば切り替わります。`/reload` も開き直しもセッション自身の role 記録を読み戻すので、セッションで押したロックはそれらを越えて続きます。`models.role` は role 記録の無いセッションの既定です。物理モデルを選んでいる間は振り分けは働かず、バッジは `[off]` になります(`/spirits-role status` は off の理由のモデルを名指します)。ロックは `spirits/auto` に戻した後のリクエストから効きます。その選択には model selector の選択範囲の切り替え(`Tab`)か `/scoped-models` が必要になることがあります。セッションを独自のモデル一覧に限定している場合、その一覧に無いモデルは selector に出ないためです。
- セッションが持っているものは `/spirits-role save`、または設定一覧(`/spirits-role` 無引数)から保存します。一覧は `use normal`、`use strong`、`save` の順に開きます。`use` の行は Enter 1 回でセッションをロックしてから保存する操作で、`/spirits-role <normal|strong>` のあと `/spirits-role save` を続けるのと同じ 2 つの書き込みです。`save` は既定だけを書き、ロックは動かしません。行は操作の前に global 設定との差分を、操作の後にはファイルに届いたものを出します。保存が成立したときと差分が無いときは情報の通知を出して一覧を閉じ、失敗したとき、およびロックが成立して保存が失敗したときはその行に理由を残して開いたままにします。操作行が作動するのは Enter だけで、Space・クリック・`save` の直後の空行・一覧の確定キーを動かした場合はそのキーではファイルは変わりません。動いているセッションは何も変わりません。モデル selector・ロック・会話はいまのままです。`save` だけの操作で一覧を閉じても再読み込みは起きず、`use` の行と通常の設定変更は閉じるときに 1 回再読み込みします。ホストが再読み込みを拒否した場合は、保存は成立していて再読み込みが未完了であることを通知します。
- `save` が書くのは **pi の global 設定ファイル**(`~/.spirits/agent/settings.json`)だけで、project のファイルにもセッションの記録にも書きません。これらのキーは**新しいセッション**が始まるときの既定で、pi はモデルを `--models` / `--model` とセッション自身の選択範囲を先に、そのあと `defaultProvider` / `defaultModel` から受け、`models.role` は role 記録の無いセッションの既定のロックです。project の `.pi/settings.json` はそこで引き続き上書きするので、保存しても通常の一覧行と `/spirits-role status` は project の実効値を出し続け、ファイルの値が出るのは `save` 行だけです。
- `spirits/auto` を保存するには global ファイル自身が解決できる `models.normal` が必要です。何も尋ねていないセッションにはフォールバックになる成功レスポンスが無いからです。それが無いとき `save` はロールだけを書いて `defaultProvider` / `defaultModel` に触れず、行にも通知にもその理由が出ます。**物理モデル**は常に保存されます。物理モデルで始まるセッションは振り分けの無い通常のセッションだからです。振り分け無しで始めたいなら既定に物理モデルを置いてください。`save` の検査を通った virtual な既定以外は normal を解決できないままにし、新しいセッションの最初のリクエストがエラーになります。
- 対話端末では無い場所も同じ書き込みを通知無く行います。`--print` モードの `/spirits-role save` はファイルを更新して何も出力しません。確認はファイルか、その設定を読み込むセッションの `/spirits-role status` で行ってください。
- `models.strong` が無いときは黙って normal のままです。設定済みなのに使えない(知らない ID、資格情報のない provider)場合は normal にフォールバックし、同一 run で 1 回だけ通知します。
- バッジは**次のリクエスト**が走るロールを出します。直近のリクエストの記録ではありません。描き直すのはその状態が変わり得る時点、つまりセッションの開始・入力を送ったとき・分岐間を移動したとき・ロールをロックしたとき・run が落ち着いたとき・ホストのモデルまたは thinking レベルの選択が変わったときです。状態は `[normal]` と `[strong]`、レベルが解決できるときはそれを続けます(`[strong high]`)、物理モデルを選択中は `[off]`、振り分けが有効なのにどのモデルも解決できないときは `[!]` です。
- ロールの隣、別の status key に、応答する物理モデルを provider を除いた ID で出します。24 文字を超える場合は先頭 23 文字に `…` を付けた 24 文字です(`abcdefghijklmnopqrstuvw…`)。振り分けが無効なときと応答するモデルが無いときはここには何も出しません。セッションが座るモデルはホスト自身の統計行がすでに出しているためです。
- run の後も続くステップは、その途中で閉じたセッションを開き直したとき(`--resume`、fork、枝の末尾からの開始)に戻り、バッジはそのステップから描かれるので、開き直した後の最初の入力はステップが決めていたロールで走ります。`settings.json` を手で編集した場合は拡張の再読み込み(`/reload`)からバッジと振り分けに効きます。読み込み中の拡張が設定を読むのは読み込み時の 1 回だからです。
- `/spirits-role status` は振り分けの状態・ロック・実行中のステップ・直近のリクエスト・normal / strong の解決結果を表示します。

## 既知の制約

- `await` の後に始まる同期ループは中断できず、timeout も効かずプロセス全体が応答しなくなります(再起動が必要)。
- 対応は Linux x86_64 のみ。
- role のバッジは拡張の status 行に出すため、ホストのモデル表示とは別の行になり、表示位置も消去の有無も共有しません。role のコマンドは `/spirits-role ...` で、ホストの `/model` に role の引数はありません。
- 物理モデルを選んでいるセッションで、ロールを期待するステップを始めるときは確認を出します。確認は、そのロールが今使われないことと振り分けを元に戻す手順を書いて 10 秒待ちます。時間切れでも「続行」を選んでも入力は送られ、「中止」でも Esc でも入力は送られず、ステップは入力を受ける前の状態に戻ります。確認は対話端末だけで、拡張機能が送った入力では出ないので、スクリプトで駆動するセッションは待ちません。
- host のコマンドは `spirits` 経由で使えません。`spirits update <その他の引数>`、`spirits install`、`spirits list` などは拒否され、host 実行ファイルのパスが表示されます。起動役が拡張 bundle を先に渡すため、host はコマンドを自身の第一引数のときにだけ dispatch します。
- 自動アップデートはありません。更新は `spirits update` かインストーラの再実行です。
- 初回起動はネットワークが要ります。固定したホストの tarball (Pi 1.5.0 で 58,876,253 バイト) と spirits bundle を `~/.spirits/managed-pi` に取得し、導入後は 182 MB を使います。2 回目以降は導入済みの一式をローカルで検証し、壊れていたら `spirits managed-pi repair` で作り直します。`PI_OFFLINE=1` は `spirits update` に効き、managed 一式には効きません。
- `rlm` は同期・直列です。非同期 fan-out は M5 で採否判断します。
- 設定・セッション・認証は `~/.spirits/agent/`(`SPIRITS_CODING_AGENT_DIR` 指定時はそちら)。外部拡張は `~/.spirits/agent/extensions/` に置きます。
- **BREAKING**: 旧 `PI_CODING_AGENT_DIR` は読まれません。既定パス `~/.spirits/agent/` は変わらないため、既存データはそのまま使えます。
- **BREAKING**: コンパイル済みバイナリは起動ディレクトリの `.env` / `.env.local` / `.env.<NODE_ENV>` を読みません。API キーなどの環境変数はシェルで `export` するか、起動コマンドの前に指定してください。
- install テレメトリと Pi 名義の provider ヘッダは既定で無効です。`settings.json` では有効化できず、`PI_TELEMETRY=1` で opt-in します。

## セキュリティ

モデルが生成したコードは spirits プロセスと同じ OS ユーザ権限で実行されます。vm コンテキストおよび `node:vm` はセキュリティ境界ではありません。信頼できないリポジトリや自動化用途では、Pi の containerization 指針に従い隔離環境で実行してください。`use()` のリモート import は既定で拒否されます。

## 開発

必要なもの: Bun >= 1.4.0(1.4.2 以降を推奨)。Node.js はロックファイルの gate と数本のスクリプトだけに使います。

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
bun install --frozen-lockfile   # workspace は 1 つ、lock も bun.lock 1 本
bun run check                   # biome + scripts の tsc + packages/spirits の tsc、書き換えはしない
bun run fix                     # 書き換える側
cd packages/spirits && bun test
```

開発ビルドの起動:

```sh
# リポジトリルートから
bun packages/spirits/bin/spirits.ts
```

ソース実行は取得を行わないので、先に managed の一式が必要です:

```sh
bun packages/spirits/bin/spirits.ts managed-pi install
# またはビルド済み 2 成果物のマニフェストを指す
SPIRITS_MANAGED_PI_MANIFEST_URL=http://host/manifest.json bun packages/spirits/bin/spirits.ts -- --version
```

ホストの型は pin した `@earendil-works/pi-coding-agent` と `@earendil-works/pi-tui` の devDependencies から取るため、`tsc` は拡張をホストと同じ宣言に対して検査します。起動役のビルドは Pi のソースを必要としません (`bun scripts/build-binaries.ts --version <version>` は `packages/spirits/bin/spirits.ts` だけをコンパイルします)。

`SPIRITS_DEV=1` で、各セルの description・実行時間・結果種別を stderr に出力します。

## ドキュメント

- 全体設計: [`docs/spirits-design.md`](docs/spirits-design.md)
- 起動経路と managed の一式: [`docs/spirits-default-launch.md`](docs/spirits-default-launch.md)、[`docs/spirits-managed-pi.md`](docs/spirits-managed-pi.md)
- ホストの版の更新と Rollback: [`docs/spirits-host-upgrade.md`](docs/spirits-host-upgrade.md)
- フェーズ別設計: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- パッケージ詳細: [`packages/spirits/README.md`](packages/spirits/README.md)
- ホストの Pi: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## ライセンス

MIT。上流 Pi の著作権表示を [`LICENSE`](LICENSE) に保持しています。[`LICENSE`](LICENSE) には、spirits が Pi のソース派生ではなく、Pi の上に動く独立の成果物であることも書いています。Prime Agent はアーキテクチャの参照のみで、コードコピーは行っていません。

## 謝辞

- [Pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors — 上流のエージェントハーネス。
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect — RLM 的実行モデルの参照アーキテクチャ。
