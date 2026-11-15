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

  モデル ID だけ(`"claude-opus-4-7"`)を書いた場合は、その時点の既定 provider で解決します。`models` は spirits のキーで、pi は他の設定を保存するときにもこのキーを保持します。
- propose / apply / verify / archive は normal で、既定 provider と既定モデルへルートします。既定が解決できないときは直近の成功レスポンスのモデルに寄り、1 回通知します。`sprt-opsx-review-change` または `sprt-opsx-verify-deep` の実行中のリクエストは strong へ、run が settled すれば**ロックしているロール**に戻します(Escape の中断でもエラーでも戻します)。
- `/spirits-role <normal|strong>` でロールをロックします。ロックはあとの入力でも続き、別のロールをロックすれば切り替わります。`/reload` は `models.role` を読み直すので、セッションだけでのロックは既定ロールに戻ります。物理モデルを選んでいる間は振り分けもバッジも無く(`/spirits-role status` は `routing: off (a physical model is selected)` と出ます)、ロックは `spirits/auto` に戻した後のリクエストから効きます。
- 既定モデル(`defaultProvider` / `defaultModel`)には物理モデルを置いてください。virtual model は normal の対象にならないため、`spirits/auto` を既定に保存すると normal が解決できるモデルを失い、新しいセッションの最初のリクエストがエラーになります。
- `models.strong` が無いときは黙って normal のままです。設定済みなのに使えない(知らない ID、資格情報のない provider)場合は normal にフォールバックし、同一 run で 1 回だけ通知します。
- バッジは拡張自身の status 行にモデル行の下へ出します。ホストの footer の中ではありません。バッジは**直近のリクエストが通ったロール**を示すので 1 リクエスト遅れます。スキル起動直後は `[normal]` のまま、スキル終了直後は次のリクエストまで `[strong]` のままです。
- `/spirits-role status` は振り分けの状態・ロック・実行中のステップ・直近のリクエスト・normal / strong の解決結果を表示します。

## 既知の制約

- `await` の後に始まる同期ループは中断できず、timeout も効かずプロセス全体が応答しなくなります(再起動が必要)。
- 対応は Linux x86_64 のみ。
- role のバッジは拡張の status 行に出すため、ホストのモデル表示とは別の行になります。role のコマンドは `/spirits-role ...` で、ホストの `/model` に role の引数はありません。
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
