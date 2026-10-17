# spirits

[English](README.md) | **日本語** | [简体中文](README.zh.md) | [Deutsch (Schweiz)](README.de-CH.md)

spirits は、[Pi](https://github.com/earendil-works/pi) をフォークし、Prime Intellect の [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) が実現している実行モデルを TypeScript / Bun で再実装する派生プロジェクトです。

個々のツール呼び出しのループではなく、永続 TypeScript REPL(`tsrepl`)をモデルの主インターフェースにします。モデルは TypeScript のセルを書き、セルをまたいで状態を保持し、ホスト関数を呼び出し、子エージェントを再帰的に起動できます。さらに、セッションを跨いで自分のメモリ・スキル・code-mode プロンプトを更新できます(Continual Harness)。

> **ステータス:** M1–M4(永続 REPL、単一バイナリ配布、同期 `rlm`、Continual Harness)は実装済み。M5(Phase 2 拡張)はドッグフーディングに基づく Go/No-Go 判断待ち。リリースタグは `spirits-v*`。対応は Linux x86_64 のみ。

## 機能

- **永続 TypeScript REPL** — 主力ツールは `tsrepl`。セルは `Bun.Transpiler` で変換し `node:vm` コンテキストで実行、`globalThis` への代入はセルをまたいで永続します。`return` / `out()` で値を返し、`print()` の出力を捕捉。エラーは原因行と修正案付きで整形。`use()` は `node:` / `bun:` 組込と cwd 相対モジュールを import。`tool()` はホストのツール実行経路で他のツールを呼びます。
- **再帰的な子エージェント** — `await rlm("prompt")` がプロセス内で子エージェントを実行し、最終回答を文字列で返します。深度上限(既定 2)、同一 REPL からの直列化、中断の子への伝播、呼び出しごとの `rlm_usage` 記録(トークン・コスト集計)を行います。
- **Continual Harness** — `note()` でセッション横断メモリを追記、`goal()` でブランチのゴールを管理、codemode ツールでスキル管理(`spirits_skill_*`)、code-mode プロンプトの上書き(`spirits_prompt_set`)を行います。
- **セッション TODO と非破壊クリア** — `manage_todos` が現在のセッションブランチに紐づく TODO を管理し、エディタとフッターの間にパネル表示します。`/clear` はモデル・思考レベル・拡張状態を保ったまま新しい会話ブランチを開始します。
- **2 系統のモデル振り分け** — `/model spirits/auto` は 1 つの選択を保ったまま、リクエストごとに normal / strong へ振り分けます。OpenSpec のレビューと深い検証の 2 スキルだけ strong(`settings.json` の `models.strong`)、ほかは既定モデルで動きます。
- **単一バイナリ** — `bun build --compile` でコンパイル。実行環境に Bun / Node は不要です。

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
- propose / apply / verify / archive は normal で、既定 provider と既定モデルへルートします。既定が解決できないときは直近の成功レスポンスのモデルに寄り、1 回通知します。`sprt-opsx-review-change` または `sprt-opsx-verify-deep` の実行中のリクエストは strong へ、run が settled すれば normal に戻します(Escape の中断でもエラーでも戻します)。
- 既定モデル(`defaultProvider` / `defaultModel`)には物理モデルを置いてください。virtual model は normal の対象にならないため、`spirits/auto` を既定に保存すると normal が解決できるモデルを失い、新しいセッションの最初のリクエストがエラーになります。
- `models.strong` が無いときは黙って normal のままです。設定済みなのに使えない(知らない ID、資格情報のない provider)場合は normal にフォールバックし、同一 run で 1 回だけ通知します。
- フッターはモデル名の前に `[normal]` / `[strong]` を出します。バッジは**直近のリクエストが通ったロール**を示すので 1 リクエスト遅れます。スキル起動直後は `[normal]` のまま、スキル終了直後は次のリクエストまで `[strong]` のままです。

## 既知の制約

- `await` の後に始まる同期ループは中断できず、timeout も効かずプロセス全体が応答しなくなります(再起動が必要)。
- 対応は Linux x86_64 のみ。theme / assets / HTML エクスポート / native prebuilds は同梱しません。
- 自動アップデートはありません。更新はインストーラの再実行です。`spirits update` は Pi のリリース URL ではなくインストーラの再実行を案内します。
- `rlm` は同期・直列です。非同期 fan-out は M5 で採否判断します。
- 設定・セッション・認証は `~/.spirits/agent/`(`SPIRITS_CODING_AGENT_DIR` 指定時はそちら)。外部拡張は `~/.spirits/agent/extensions/` に置きます。
- **BREAKING**: 旧 `PI_CODING_AGENT_DIR` は読まれません。既定パス `~/.spirits/agent/` は変わらないため、既存データはそのまま使えます。
- **BREAKING**: コンパイル済みバイナリは起動ディレクトリの `.env` / `.env.local` / `.env.<NODE_ENV>` を読みません。API キーなどの環境変数はシェルで `export` するか、起動コマンドの前に指定してください。
- install テレメトリと Pi 名義の provider ヘッダは既定で無効です。`settings.json` では有効化できず、`PI_TELEMETRY=1` で opt-in します。

## セキュリティ

モデルが生成したコードは spirits プロセスと同じ OS ユーザ権限で実行されます。vm コンテキストおよび `node:vm` はセキュリティ境界ではありません。信頼できないリポジトリや自動化用途では、Pi の containerization 指針に従い隔離環境で実行してください。`use()` のリモート import は既定で拒否されます。

## 開発

必要なもの: Bun >= 1.4.0(1.4.2 以降を推奨)。Node.js は対象外です。

```sh
git clone https://github.com/betiz0/spirits.git
cd spirits
npm ci --ignore-scripts   # Pi をソースから起動する場合のみ
cd packages/spirits
bun install --frozen-lockfile
bun test
bun run check
```

開発ビルドの起動:

```sh
# リポジトリルートから
bun packages/spirits/bin/spirits.ts

# Pi ソースに拡張をロードする場合
bun packages/coding-agent/src/cli.ts -e packages/spirits/src/index.ts
```

`SPIRITS_DEV=1` で、各セルの description・実行時間・結果種別を stderr に出力します。

## ドキュメント

- 全体設計: [`docs/spirits-design.md`](docs/spirits-design.md)
- フェーズ別設計: [`docs/spirits-m1-repl.md`](docs/spirits-m1-repl.md), [`docs/spirits-m2-distribution.md`](docs/spirits-m2-distribution.md), [`docs/spirits-m3-rlm.md`](docs/spirits-m3-rlm.md), [`docs/spirits-m4-harness.md`](docs/spirits-m4-harness.md), [`docs/spirits-m5-phase2.md`](docs/spirits-m5-phase2.md)
- パッケージ詳細: [`packages/spirits/README.md`](packages/spirits/README.md)
- 上流 Pi: [pi.dev](https://pi.dev), [earendil-works/pi](https://github.com/earendil-works/pi)

## ライセンス

MIT。上流 Pi の著作権表示を [`LICENSE`](LICENSE) に保持しています。Prime Agent はアーキテクチャの参照のみで、コードコピーは行っていません。

## 謝辞

- [Pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors — 上流のエージェントハーネス。
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect — RLM 的実行モデルの参照アーキテクチャ。
