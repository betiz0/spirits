# スパイク: vm ESM modules (Bun 1.4.2)

- 日付: 2026-10-07
- ランタイム: Bun 1.4.2
- 目的: `vm.SourceTextModule` / `importModuleDynamically` が Bun 1.4.2 で動作するかを実機確認し、M5 の Phase 2 判断材料とする。

## 結論

**動作する(採用可能)**。`vm.SourceTextModule` / `vm.SyntheticModule` / `vm.Module` は Bun 1.4.2 に存在し、静的 link・トップレベル await・動的 import のいずれも動く。ただし、`importModuleDynamically` が返した `vm.SyntheticModule` はキーだけが見え、値の読み出しが `undefined` になる Bun 固有の制約がある。

この結果は採用可否の分岐ゲートではなく記録である。M1 は設計どおり Phase 1(`vm.Script` + async IIFE)を継続する。ESM を採用してもモジュールごとに字句スコープが分かれ、宣言のセル間永続(設計 Decision 4)は解決しないため。

## 確認した挙動

再現コード: 下記「再現コード」を `bun /tmp/spike-vm-esm.ts` で実行。

| 項目 | 結果 |
|---|---|
| `typeof vm.SourceTextModule` | `"function"` |
| `typeof vm.SyntheticModule` | `"function"` |
| `typeof vm.Module` | `"function"` |
| SourceTextModule 単体の evaluate + トップレベル await | `export const v = await Promise.resolve(7)` → `namespace.v === 7` |
| `SourceTextModule.link()` による静的 import | module `b` が module `a` を import → `b.namespace.doubled === 42` |
| `importModuleDynamically` フックの発火 | `await import("node:fs")` で呼ばれる(呼び出しを確認) |
| 動的 import が返した `SourceTextModule` の値 | `m.value === 42`, `m.default === 7`(値が正しく伝播) |
| 動的 import が返した `SyntheticModule` の値 | `Object.keys(m)` は `["value"]` を返すが `m.value === undefined` |
| 直接参照した `SyntheticModule.namespace` | `s.namespace.x === 5`(setExport は動く) |

## 制約の詳細

`importModuleDynamically` の返り値に `vm.SourceTextModule` を使えば値は正しく伝播する。ホストの `import()` の結果を vm 内へ橋渡しする場合、`SyntheticModule` の `setExport` だけでは値が vm 側に渡らない(Bun 1.4.2 の実装差)。Phase 2 でホストモジュールを ESM として公開する場合は、`SyntheticModule` ではなく、ホスト値を再 export する `SourceTextModule`(または同等のソース)を生成して返す必要がある。

## 再現コード

```ts
import vm from "node:vm";

console.log("Bun.version =", Bun.version);
console.log("typeof vm.SourceTextModule =", typeof (vm as any).SourceTextModule);

// 1. SourceTextModule 単体 + トップレベル await
const a = new vm.SourceTextModule("export const v = await Promise.resolve(7);");
await a.link(() => {});
await a.evaluate();
console.log("top-level await:", a.namespace.v); // 7

// 2. 静的 link
const left = new vm.SourceTextModule("export const n = 21;");
const right = new vm.SourceTextModule('import { n } from "left"; export const doubled = n * 2;');
await right.link((specifier) => {
	if (specifier === "left") return left;
	throw new Error(`unexpected ${specifier}`);
});
await Promise.all([left.evaluate(), right.evaluate()]);
console.log("static link:", right.namespace.doubled); // 42

// 3. 動的 import (返り値を SourceTextModule にすると値が伝播する)
const target = new vm.SourceTextModule("export const value = 42; export default 7;");
await target.link(() => {});
await target.evaluate();
const dyn = new vm.SourceTextModule(
	'const m = await import("host:test"); export const v = m.value; export const d = m.default;',
	{ importModuleDynamically: async () => target },
);
await dyn.link(() => {});
await dyn.evaluate();
console.log("dynamic import:", dyn.namespace.v, dyn.namespace.d); // 42 7

// 4. SyntheticModule を動的 import で返すと値が失われる
const synthetic = new vm.SyntheticModule(["value"], function (this: any) {
	this.setExport("value", 99);
});
const viaSynthetic = new vm.SourceTextModule(
	'const m = await import("host:synth"); export const keys = Object.keys(m); export const v = m.value;',
	{ importModuleDynamically: async () => synthetic },
);
await viaSynthetic.link(() => {});
await viaSynthetic.evaluate();
console.log("synthetic keys:", viaSynthetic.namespace.keys); // ["value"]
console.log("synthetic value:", viaSynthetic.namespace.v); // undefined (Bun 1.4.2 の制約)
```

## 設計書への反映

動作するため `docs/spirits-design.md` §4.2 の「検証済み・不採用」への更新は行わない。M1 は Phase 1(`vm.Script` + async IIFE)を維持し、ESM は M5 の選択肢として残す。
