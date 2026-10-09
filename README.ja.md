# spirits

[English](README.md) | **日本語** | [简体中文](README.zh.md) | [Deutsch (Schweiz)](README.de-CH.md)

spirits は、[Pi](https://github.com/earendil-works/pi) をフォークし、Prime Intellect の [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) が実現している実行モデルを TypeScript / Bun で再実装する派生プロジェクトです。

個々のツール呼び出しのループではなく、永続 TypeScript REPL(`tsrepl`)をモデルの主インターフェースにします。モデルは TypeScript のセルを書き、セルをまたいで状態を保持し、ホスト関数を呼び出し、子エージェントを再帰的に起動できます。さらに、セッションを跨いで自分のメモリ・スキル・code-mode プロンプトを更新できます(Continual Harness)。

> **ステータス:** M1–M4(永続 REPL、単一バイナリ配布、同期 `rlm`、Continual Harness)は実装済み。M5(Phase 2 拡張)はドッグフーディングに基づく Go/No-Go 判断待ち。リリースタグは `spirits-v*`。対応は Linux x86_64 のみ。

## 機能

- **永続 TypeScript REPL** — 主力ツールは `tsrepl`。セルは `Bun.Transpiler` で変換し `node:vm` コンテキストで実行、`globalThis` への代入はセルをまたいで永続します。`return` / `out()` で値を返し、`print()` の出力を捕捉。エラーは原因行と修正案付きで整形。`use()` は `node:` / `bun:` 組込と cwd 相対モジュールを import。`tool()` はホストのツール実行経路で他のツールを呼びます。
- **再帰的な子エージェント** — `await rlm("prompt")` がプロセス内で子エージェントを実行し、最終回答を文字列で返します。深度上限(既定 2)、同一 REPL からの直列化、中断の子への伝播、呼び出しごとの `rlm_usage` 記録(トークン・コスト集計)を行います。
- **Continual Harness** — `note()` でセッション横断メモリを追記、`goal()` でブランチのゴールを管理、codemode ツールでスキル管理(`spirits_skill_*`)、code-mode プロンプトの上書き(`spirits_prompt_set`)を行います。
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

## 既知の制約

- `await` の後に始まる同期ループは中断できず、timeout も効かずプロセス全体が応答しなくなります(再起動が必要)。
- 対応は Linux x86_64 のみ。theme / assets / HTML エクスポート / native prebuilds は同梱しません。
- 自動アップデートはありません。更新はインストーラの再実行です。`spirits update` は Pi の更新通知を表示するだけです。
- `rlm` は同期・直列です。非同期 fan-out は M5 で採否判断します。
- 設定・セッション・認証は `~/.spirits/agent/`(`PI_CODING_AGENT_DIR` 指定時はそちら)。外部拡張は `~/.spirits/agent/extensions/` に置きます。

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
