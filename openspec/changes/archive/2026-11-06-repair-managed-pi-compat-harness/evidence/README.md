# 互換性ランナーの証拠 (clean 実行 / 2026-11-07)

作業ツリーが clean な checkout だけで実行した測定結果。`runnerProvenance.clean` はいずれも `true`、
`diffSha256` は空 diff の SHA256(`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)、`untracked` は空。

| 項目 | 値 |
|---|---|
| 実行 commit | `d262a8d6fd171d3acbac05b7294bb45c883d8f98` |
| 公式 tarball sha256 | `df870ba0e344cb7b3358d8d8f19397b8b8d225a8669784736ad68a5c2169d53b` |
| 展開後実行ファイル sha256 | `61a84400938da652ed69aac9c1ad2ca23af3c9bd8cc2f46ce571ed84ae6a35e5` |
| 拡張 bundle sha256 | `51f306d132b35b1c34bebe56f157c14e5e88348366bcb6d041585d7354e28f29` |
| Pi 版 / overlay | 1.5.0 / `1.5.0-spirits.1` |
| ランナー側ランタイム | bun 1.4.2 |
| 比較した fork | `~/.spirits/bin/spirits` 0.6.0、sha256 `dc3af4cb5de45e1f96e029ed7e1c909e48556f422ed926e2a349100e8238d29d` |

## 含まれるファイル

| ファイル | サイズ | 内容 |
|---|---|---|
| `official/result.json` | 39,219 B | 公式 artifact 実行の結果 JSON(赤化済み)。`confirmed=28 limited=1 unavailable=0 not-run=3 failed=0`、`runnerCompleted=false`、`compatibilityMet=true` |
| `official/managed-pi-compat-result.md` | 7,450 B | 同じ実行の要約。先頭に定義文・5 ラベルの内訳・`Note:` の但し書きが出る |
| `fixture/managed-pi-compat-result.md` | 7,639 B | fixture 実行の要約のみ。`confirmed=19 limited=4 unavailable=0 not-run=9 failed=0`、`runnerCompleted=false`、`compatibilityMet=false`。fixture 結果は互換性の証拠にならないため JSON は置いていない |
| `q1-child-agent-dir.json` | 2,311 B | rlm 子が読む agent dir の 3 パターン比較(隔離 dir のみ / `<home>/.pi/agent` のみ / 両方) |
| `q4-fork-route.json` | 3,397 B | 現在の fork route での rlm 3 ケース。`forkSha256` に使用した fork 実行ファイルの SHA256 を記録する |

`run.log` は置いていない。リポジトリの `.gitignore` が `*.log` を対象にしているためで、サイズは official 170 B、fixture 176 B、中身は次の通り(詳細ログは結果 JSON の `logs` に入る)。

```text
# official
Compatibility result: <out>/official/result.json
confirmed=28 limited=1 unavailable=0 not-run=3 failed=0
mode=official runnerCompleted=false compatibilityMet=true

# fixture
exit 0
Compatibility result: <out>/fixture/result.json
confirmed=19 limited=4 unavailable=0 not-run=9 failed=0
mode=fixture runnerCompleted=false compatibilityMet=false
```

## 実行コマンド

```sh
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out <build>

# official
bun scripts/managed-pi-compat/run.ts --mode official \
  --artifact-root <artifact-root> \
  --bundle <build>/spirits-managed-pi-extension.js \
  --commit "$(git rev-parse HEAD)" --bundle-version 0.1.0 \
  --out <out>/official/result.json

# fixture(一時的な managed root を fixture set でインストールして実行)
bun scripts/managed-pi-compat/run.ts --mode fixture --artifact-root <fixture-managed-root> --out <out>/fixture/result.json
```

## 秘密情報とユーザーデータ

実行は一時 HOME・隔離 agent dir・ローカルの fake provider だけを使い、実認証・実 provider・実 `~/.spirits/agent`
を読んでいない。ランナーは保存前に API キー・トークン・proxy 認証をマスクする。加えて保存前に
`sk-`、`Bearer `、`api_key`、`AKIA`、`token`、`password` のパターンで走査し、fake provider の偽値以外 0 件を確認した。
残る絶対パスは一時ディレクトリ(`/tmp/spirits-managed-compat-*`)、bun 実行ファイルのパス、比較対象の fork のパス
(`q4-fork-route.json` の `fork`)だけである。
