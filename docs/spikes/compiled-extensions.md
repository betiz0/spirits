# スパイク: コンパイル済み拡張と pi ソース解決

- 日付: 2026-10-08
- Bun: 1.4.2 (744846f84)
- 対象 change: `add-binary-distribution`(M2 配布基盤)
- 関連: `docs/spirits-m2-distribution.md` §7、`openspec/changes/add-binary-distribution/design.md` Decision 1・5・12

## コンパイル解決

### 結論

pi ソースの解決は、**Bun.build では `tsconfig` オプションに root `tsconfig.json` を指定(a)**、**未コンパイル実行では `packages/spirits/bin/tsconfig.json`(root `tsconfig.json` を extends)を置く(b)** 方式を採用する。pi の `npm run build` の dist を入力にする(c)は不要だった。

型検査(`packages/spirits && bun run check`)は従来どおり `packages/spirits/tsconfig.json` の `paths` で `src/types/pi-coding-agent.d.ts` のミラーへ解決し、pi ソースを型検査へ巻き込まない。subpath import 用の ambient module 宣言を `src/types/` に追加する(タスク 1.3)。

### 試行結果

最小エントリ `packages/spirits/bin/spirits.ts`:

```ts
import { main } from "@earendil-works/pi-coding-agent";
import "@earendil-works/pi-coding-agent/bun/sandbox-env-setup";
import "@earendil-works/pi-coding-agent/bun/runtime-setup";

await main(process.argv.slice(2));
```

root `tsconfig.json` は `@earendil-works/pi-coding-agent/*` を `packages/coding-agent/src/*`、`@earendil-works/pi-ai/*` を `packages/ai/src/*.ts` などへ解決する。pi の `package.json` の `exports` は `dist` と一部 subpath しか公開しないため、`bun/runtime-setup` の解決には tsconfig `paths` が必要だった。

| 候補 | 実行 | 結果 |
|---|---|---|
| (a) `Bun.build` の `tsconfig: "./tsconfig.json"` | `bun /tmp/spirits-spike-build.ts` | 成功。94MB の linux-x64 バイナリを生成 |
| (b) `packages/spirits/bin/tsconfig.json` が root `tsconfig.json` を extends | `bun packages/spirits/bin/spirits.ts --version` | 成功。`1.0.0`(pi ソースの `VERSION`)を出力、exit 0 |
| (c) `npm run build` の dist を入力 | 未実施 | (a)(b) で足りたため不採用 |
| 指定なし(既存 `packages/spirits/tsconfig.json` のみ) | `bun packages/spirits/bin/spirits.ts --version` | 失敗。`Cannot find module '@earendil-works/pi-coding-agent' from .../bin/spirits.ts`。既存 `paths` は bare 指定を `src/types/pi-coding-agent.d.ts` へ向けており、実行時モジュールとして読めないため |
| `--tsconfig-override ./tsconfig.json` | 同コマンド | 成功(1.0.0)したが、フラグ必須で `bun <entry>` の素の実行にならない。また Bun が `Internal error: directory mismatch ...` を stderr に出した(動作は継続) |

(a) だけで未コンパイル実行も通す方法はない(Bun ランタイムに `tsconfig` を渡す手段が CLI フラグに限られる)ため、(a) を build、(b) を開発時実行の指定として併用する。`(b)` の config は `extends` のみで、root の `paths` をそのまま使う。

### VERSION 置換プラグイン(Decision 2 の前提)

`Bun.build` の `plugins`(`onLoad`)で `packages/coding-agent/src/config.ts` を `packages/coding-agent/package.json` の version に置換する最小プラグインがコンパイルで効くことを確認した。

- 置換対象: `export const VERSION: string = pkg.version || "0.0.0";`
- 置換なしでコンパイル: `spirits-linux-x64 --version` は `0.0.0`(実行ファイル隣の `package.json` が無いため)
- 置換ありでコンパイル: 同じコマンドが `1.0.0`(pi core の version)を出力

### 再現手順

```sh
cd <repo>

# 未コンパイル実行(b)
bun packages/spirits/bin/spirits.ts --version   # => 1.0.0
bun packages/spirits/bin/spirits.ts --help      # => pi のヘルプ、exit 0

# コンパイル(a + VERSION 置換プラグイン)
bun /tmp/spirits-spike-build.ts                 # entrypoints: bin/spirits.ts, tsconfig: root, plugin: VERSION 置換
/tmp/spirits-spike/spirits-linux-x64 --version  # => 1.0.0
/tmp/spirits-spike/spirits-linux-x64 --help     # => pi のヘルプ、exit 0
```

スパイク用スクリプトの実体は `scripts/build-binaries.ts`(タスク 1.5)と `scripts/replace-pi-version.ts` に移す。

### 補足

- `bun packages/spirits/bin/spirits.ts` はワークスペース root から実行する。`packages/spirits/tsconfig.json` は型検査専用で、実行時の解決には使わない。
- 静的 import は評価前に解決されるため、Bun 1.3 系のような古いランタイムでは pi ソースの構文解釈に失敗し、`bin/bootstrap.ts` のバージョンゲートより先にエラーになる可能性がある(タスク 1.4 で確認する)。

## 拡張ロード

コンパイル済み `dist/spirits-linux-x64`(spirits 0.1.0、pi 1.0.0 置換済み)と、`HOME=$(mktemp -d)` の下に置いた外部拡張で確認した。対話モードの確認には tmux を使い、`tmux new-session -d -s spike -c /tmp "HOME=$HOME_DIR <binary>; exec sh"` の形で起動した(ログインシェルのプロファイルを読ませない)。

外部拡張の例(`$HOME/.spirits/agent/extensions/ext-ok.ts`):

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";

interface SpikeApi {
	registerFlag(name: string, options: { description?: string; type: "boolean" }): void;
	on(event: "session_start", handler: () => void): void;
	getActiveTools(): string[];
}

export default function spikeOk(pi: SpikeApi): void {
	pi.registerFlag("spike-ok", { description: `spike external extension (pi ${VERSION})`, type: "boolean" });
	pi.on("session_start", () => {
		writeFileSync(
			join(process.env.HOME ?? "/tmp", ".spirits", "agent", "spike-ok.json"),
			JSON.stringify({ version: VERSION, tools: pi.getActiveTools() }),
		);
	});
}
```

### 結論

1. **バンドル済み spirits 拡張のロード: 成功。** 対話起動で `session_start` 時点の `getActiveTools()` が `["read","bash","edit","write","tsrepl"]` を返し、`tsrepl` が組み込み拡張から登録されている。`--help` ではセッションが start しないため `session_start` は発火しない。
2. **`~/.spirits/agent/extensions/` の外部 TS 拡張のロード: 成功。** `--help` 出力に登録フラグ `--spike-ok` が現れ、対話起動では `[Extensions]` に `ext-ok.ts` が表示され、sentinel `spike-ok.json` が書かれた。
3. **外部拡張からのバンドル済み pi パッケージ import: 成功。** `import { VERSION } from "@earendil-works/pi-coding-agent"` が仮想モジュール経路で解決される。
4. **存在しないベア依存を持つ外部拡張: 本体は起動を継続しない。** 実測は pi 上流の仕様どおり fatal で、`Error: Failed to load extension "<拡張パス>": ... Cannot find module '<bare specifier>'` を **stderr** に出し、`Hint: Start without extensions using "pi -ne".` を添えて exit 1 になる。エラーには拡張パスが含まれる。例外は `--help` で、help 分岐が diagnostics 処理より先に exit 0 するためエラーはどこにも出ない。spec delta の「外部拡張のロード」Requirement は、この実測(起動せず非ゼロ終了)に合わせて更新済み(末尾の「spec delta との差」参照)。
5. **`-e <拡張パス>` と組み込み拡張の併存: 成功。** `spirits -e /tmp/spirits-spike-ext/ext-e.ts` の対話起動で `[Extensions]` に `ext-e.ts, ext-ok.ts` が並び、sentinel の tools に `tsrepl` が含まれる。
6. **外部拡張から読む pi の `VERSION`: `1.0.0`。** `packages/coding-agent/package.json` の version と一致し、`replace-pi-version` プラグインがコンパイルで効いていることを確認した(フラグ description の `(pi 1.0.0)`)。

### 副次確認: `compile.assets`

最小バイナリで `compile.assets: ["./asset-probe.txt"]` を指定すると、実行時に `node:fs.readFileSync(join(import.meta.dir, "asset-probe.txt"))` が埋め込み内容を読める(`import.meta.dir` は `/$bunfs/root`)。ただし pi の `getPackageDir()` は `dirname(process.execPath)`(実ファイルの隣)を指すため、theme / `package.json` を埋め込んでもそのままでは pi から見えない。採用するなら `PI_PACKAGE_DIR` を `$bunfs` 配下へ向ける追加対応が要る。dlopen 対象(TUI native prebuilds)は埋め込めない。本 change では未採用のまま記録する。

### 再現手順

```sh
cd <repo>
bun scripts/build-binaries.ts --version 0.1.0

HOME_DIR=$(mktemp -d)
mkdir -p "$HOME_DIR/.spirits/agent/extensions"
cp /tmp/spirits-spike-ext/ext-ok.ts "$HOME_DIR/.spirits/agent/extensions/"

# (2)(3)(6): フラグ description に pi VERSION が出る
HOME="$HOME_DIR" dist/spirits-linux-x64 --help | grep spike-ok
# => --spike-ok   spike external extension (pi 1.0.0)

# (1)(2)(6): 対話起動で sentinel を書かせる
tmux new-session -d -s spike -c /tmp "HOME=$HOME_DIR $(pwd)/dist/spirits-linux-x64; exec sh"
sleep 8
tmux capture-pane -t spike -p
cat "$HOME_DIR/.spirits/agent/spike-ok.json"
# => {"version":"1.0.0","tools":["read","bash","edit","write","tsrepl"]}
tmux kill-session -t spike

# (4): 依存不足は fatal(cwd 依存を書かない拡張を置く)
printf 'import "spirits-spike-missing-package-xyz";\nexport default function () {}\n' \
  > "$HOME_DIR/.spirits/agent/extensions/ext-missing-dep.ts"
HOME="$HOME_DIR" dist/spirits-linux-x64 --help   # exit 0(エラーは出ない)
tmux new-session -d -s spike -c /tmp "HOME=$HOME_DIR $(pwd)/dist/spirits-linux-x64; echo EXIT=\$?; exec sh"
sleep 8; tmux capture-pane -t spike -p               # stderr に拡張パス付きのエラーと Hint、EXIT=1
tmux kill-session -t spike

# (5): -e 併存
tmux new-session -d -s spike -c /tmp "HOME=$HOME_DIR $(pwd)/dist/spirits-linux-x64 -e /tmp/spirits-spike-ext/ext-e.ts; exec sh"
sleep 8; tmux capture-pane -t spike -p               # [Extensions] ext-e.ts, ext-ok.ts
tmux kill-session -t spike
```

### spec delta との差(対応済み)

スパイクで、spec delta の「依存不足でも起動を継続」が pi 上流の diagnostics 処理(exit 1)と矛盾することが判明した。利用者判断により、spec の Requirement と scenario、design の Decision 10/12 を実測(拡張パス付きエラーを stderr に出して非ゼロ終了)に合わせて更新した。pi コアは変更しない。
