# fork / managed 間の `~/.spirits/agent` 読み書き互換 実測

既存の `~/.spirits/agent` 形式のデータを、fork(spirits 0.6.0 バイナリ)と managed(公式 Pi 1.5.0 +
spirits 拡張 bundle)が相互に読み書きできるかを、製品コード・ガード・既定経路を変えずに実測した
調査。実データ・実認証・実 provider は使わず、隔離 HOME とローカル fake provider のみで動かす。

- 実行結果の一覧: `summary.md`(判定表・フェーズ終了状態・ツリー差分・settings.json の中身)
- 機械可読の全証拠: `result.json`(項目ごとに方向別判定・detail・データ)
- フェーズ単位のツリー・スナップショット: `snapshots/*.json`
- 実行スクリプト: `scripts/agent-data-compat/`

## 再実行手順

```sh
# 1. 拡張 bundle と manifest を作る
bun scripts/build-managed-pi-inputs.ts --version 0.1.0 --out dist

# 2. 公式 Pi アーティファクト(manifest.json + tarball)を任意のディレクトリに用意する。
#    tarball の sha256 は製品側の信任根 `MANAGED_PI_FIRST_ARTIFACT_SHA256` と一致する必要があり、
#    不一致なら runner は結果を書く前に落ちる。
#    https://github.com/earendil-works/pi/releases/download/v1.5.0/pi-linux-x64.tar.gz

# 3. 実測を回す(結果は --out に summary.md / result.json として出る)
bun scripts/agent-data-compat/run.ts \
  --fork "$HOME/.spirits/bin/spirits" \
  --artifact-root <artifact root> \
  --bundle dist/spirits-managed-pi-extension.js \
  --out docs/agent-data-compat \
  --work /tmp/adc-work --keep
```

`--keep` を付けると work root(隔離 HOME・agent dir の実体)が残る。実行中に作られる agent dir は
`<work>/homes/<slot>/.spirits/agent`(fork)と `<work>/homes/<slot>/.spirits/managed-pi/agent`
(managed)で、スロット名はフェーズ名と同じ。

## 実測アーティファクトの来歴

`result.json` に残ったダイジェストがどのコード由来かをここで固定する。`summary.md` 冒頭の
`runner commit` は **ランナーを流した時点の HEAD** であり、拡張 bundle をビルドしたコミットでは
ない(bundle は `git status` を見ずにビルドされるため、両者は別々に記録する必要がある)。ランナーは
`identity.bundleVersion` を `local-build@<runner commit>` で上書きする
(`scripts/agent-data-compat/run.ts`)ので、結果 JSON だけからは bundle のビルド元が復元できない。

| 対象 | 値 | 来歴 |
|---|---|---|
| 拡張 bundle | `cd5f3456a1a7a0febb100a25f068ffbf629dc35093b955a87edf0446ac990ea7` | コミット `35595d326` の clean worktree(`git worktree add --detach` し、`node_modules` は実体への symlink を並べた)で `bun scripts/build-managed-pi-inputs.ts --version 0.0.0 --out <dir>` を再実行すると、この sha256 がバイト単位で再現した。よって元になったコミットは `35595d326`。`35595d326` は `2467ad412`(rlm 修正)から `packages/*/src` の変更が無いので、bundle 内の製品コードは `2467ad412` と同一 |
| 未コミットの変更 | bundle のバイト列に効果のあるものは含めない | 上の再現はコミット済みソースだけのある clean ツリーで成立する。ビルド時に作業ツリーへ未コミットの変更が有ったとしても、bundle の出力に影響の無い変更に限られる |
| artifact root の manifest | `0e3a9647b2b5f4be812cf5a495c6c689164f27f89421803471061abe21e41e08` | Pi 側の pin 専用(`extension.version` 0.1.0、`extension.artifact.sha256` は `51f306d1…` で実測 bundle `cd5f3456` とは別物)。ランナーは `--bundle` で渡したファイル自体を SHA256 して `bundleSha256` に記録し、manifest の extension digest は照合しない(`scripts/managed-pi-compat/official.ts` の `loadOfficialArtifact` / `buildOfficialIdentity` が検証するのは tarball の digest)。manifest の sha は「どの Pi pin を使ったか」の記録として読める |
| ランナー | commit `538e69997`、`clean=false` | `clean` は `git diff HEAD` が空 **かつ** `git ls-files --others --exclude-standard` が空のときだけ true(`run.ts` の `provenance()`)。この実行では前者が bun.lock のドリフト(`diffSha256 8e1eea85…`)、後者が `scratch-ag/*` と `sprt-opsx-*.SKILL.md` で、どちらも非空だった |

`scratch-ag/` とリポジトリ直下の `sprt-opsx-*.SKILL.md` は bundle の入力ではない(bundled skill は
`packages/spirits/src/harness/bundled-skills/` を inline する)。走らせた両ホストのコードにも影響し
ないので、これらの存在は `clean` フラグの判定にだけ効く。

## 実行の組み立て

双方向それぞれについて「作成 → 相手が生データを読む → 相手が同じツリーに書き込む → 作成側が読み
直す」を順にやる。プロンプトは RPC モードで流し、`-e` で読み込んだ probe 拡張
(`probe-extension.ts`)が `/adc-dump` を通じて、そのホストが実際に読んだ settings・session entries・
provider 認証状態・モデル一覧・ツール一覧を書く。プロバイダは fake provider だけで、リクエスト本文も
記録する。

| スロット | host | やること |
|---|---|---|
| `a1-fork-create` | fork | fixture ツリーを作成・書き込み・`install` で settings 実書き込み |
| `a2-managed-fresh` / `-loaded` / `-write` | managed | fork ツリーを新規セッションで読む / fork のセッションを switch して読む / 同じセッションに追記 |
| `a3-fork-reread` | fork | managed が書き終えたツリーを読み直す |
| `b1-managed-create` | managed | 同上を managed 側で作成 |
| `b2-fork-fresh` / `-loaded` / `-write` | fork | managed ツリーを読む・追記する |
| `b3-managed-reread` | managed | fork が書き終えたツリーを読み直す |
| `tw-*` | 相手側 | settings.json の test write を挟んだ双方向ラウンドトリップ |

判定は項目ごとに方向別(`forkToManaged` / `managedToFork`)で持ち、総合は次の規則:

- `bidirectional`: 両方向が `compatible`
- `one-way`: 片方が `compatible`、他方が `not-run`(相手がそのデータを作らない等、測定機会が無い)
- `incompatible`: どちらかが `incompatible`
- `not-run`: 両方向が `not-run`

## 結果の要点

数値・ダイジェストは `summary.md` の判定表とランナー来歴行を見る。不変の結論は次のとおり。

- **sessions(JSONL)は双方向互換。** 相手が作ったセッションを switch して読み、全 entry を
  id 単位で一致に読み戻し、追記は既存行をバイト単位で変更しなかった(`prefix=kept`)。セッション
  ファイルを消した・書き換えたことも無い。spirits 独自の custom entry
  (`spirits_goal` / `spirits_todo` / `spirits_memory` / `tsrepl_cell` / `rlm_usage`)は双方がそのまま
  読み、失わなかった。
- **`pi.virtual-model-state`(ルーティング状態)は片方向のみ。** fork は書く(1 件)が、managed は
  1 件も書かない。managed は fork が書いた entry を読む・保持することはできる。原因は役割 API の
  有無: bundle は `pi.registerModelRoles` が存在するときだけこの entry を追記する
  (`packages/spirits/src/routing/register.ts` の `session_start`)。probe で測ると
  `registerModelRoles` は fork=true / managed(公式 1.5.0)=false。
- **`memory/notes.md` と `prompts/spirits/code-mode.md` は双方向読める。** 相手が書いた行が、新規
  セッションのシステムプロンプト(=エージェントディレクトリから組み立てられる)に入り、fake provider
  のリクエスト本文で確認できる。追記も `memory/notes.md` は前行保持で +1 行のみ。
- **`skills/` と goal は双方向。** 相手が保存した skill が相手のコマンド一覧に出て、`goal()` が相手の
  goal を返す。
- **`bundled-skills/` は同居するだけ。** fork は `bundled-skills/0.6.0`、bundle は自分のビルド版数の
  ディレクトリ(実測では `bundled-skills/0.0.0-dev`)へ書く。互いのバージョンディレクトリには触れない(変更・削除 0)。
  どのホストも自分のバージョンしか読まない残置物は無害。
- **`auth.json` / `models.json` は読める。** 双方が相手の `auth.json` を設定済みとして報告し、
  `models.json` 定義のプロバイダを解決してそのモデルでリクエストした。制御用(プロバイダの無い
  認証)は未設定と出た。

## `pi.virtual-model-state` の書式(one-way の意味)

実測の one-way は **entry 書式の非互換ではない**。

- 公式 Pi 1.5.0 のコアもこの entry を読み書きする。書き込みは `packages/coding-agent/src/core/agent-session.ts:846`
  (v1.5.0)で `data = { provider, modelId, state }`、読み取りは `core/virtual-models.ts` の
  `getVirtualModelState`(`provider` / `modelId` 一致の最新 1 件から `data.state` を返す)。
- fork は同じ箇所(`agent-session.ts:837`)に `role` を 1 字段足して書く(`VirtualModelStateData` の
  `role?: string`)。読み取り側は `provider` / `modelId` だけ見て `state` を取り、`role` が無ければ
  undefined のまま返す。
- spirits 拡張が `pi.appendEntry` で追記するのは `{ provider, modelId, role, state? }`
  (`packages/spirits/src/routing/register.ts`)で、`registerModelRoles` が存在するときだけ。
- したがって両者の読み取りはどちらの形でも成立する(余剰の `role` は無視、欠けた `role` は undefined)。
  実測で managed が 0 件だったのは、公式 1.5.0 に `registerModelRoles` が無く、このスロットで bundle 自身
  の追記が走らなかったためで、entry が読めなかったからではない。

## settings.json のカスタムキーは生き残るか

生き残る。2 経路で測った。

1. **テスト書き込み**(product 側 API が persistent な settings write を持たないため、Pi の手続きを
   再現した書き込みを文書化して実行): `proper-lockfile` の `lockSync(path, { realpath: false })`
   (ELOCKED リトライ 10 回 20ms)→ ロック下に読む → `stripBom` → `JSON.parse` → `migrateSettings`
   → 変更対象フィールドだけマージ → `JSON.stringify(merged, null, 2)` → release。これは
   `SettingsManager.persistScopedSettings` と同じ手順で、`writerFidelity()` が fork の HEAD と公式
   `v1.5.0` の該当領域(`FileSettingsStorage` / `migrateSettings` / `persistScopedSettings`)をハッシュ
   比較して identical だったことを evidence に記録する。
   - 相手が書き込んだ `defaultProvider` / `defaultModel` / `defaultThinkingLevel` / `models.strong` /
     `models.role` / spirits 独自キー(`adcSpiritsKey`, シードに無い新規キー `adcTestKey`)を、相手ホストが
     `pi.getSettings()` でそのまま読み、そのホスト自身の書き込み後も値が残る。
2. **実書き込み**: headless で実行できる product 自身の settings 書き込みは
   `<host> install <local package dir>` だけ(対話の `/login`・`/settings`・`/model` は TUI 専用)。
   fork→fork / 公式→fork ツリー / 公式→managed ツリー / fork→managed ツリーの 4 通りで、追跡キーの
   削除・値変更は 0。追加されたのは `install` が書く `packages` キーのみ。

## 「バックアップ + 一方方向マイグレーション」の材料

- 双方向で壊れないので、**fork → managed は「コピー + そのまま使用」で足りる**。session・memory・
  skills・prompts・settings・auth・models はいずれも相手が読め、相手の書き込みも前行保持で入る。
  形式変換(migration)を要するデータは見つかっていない。
- 唯一の非対称は `pi.virtual-model-state`。managed はこれを作らないので、デフォルトを切り替えても
  ルーティング状態は fork 側の履歴として残るが、managed 側では更新されない(役割 API が無いため
  badge・`/model <role>`・既定 role も使えない)。よって「マイグレーション時にこの entry を移植する」
  意味は薄い(移植しても managed 側は以後それを書かない)。
- バックアップで守る価値があるのは、**双方が同じファイルに追記する**ことを考えると、
  `memory/notes.md`・`prompts/spirits/code-mode.md`(と `.bak`)・`sessions/*.jsonl`・`settings.json`。
  いずれも前行保持で追記されるが、同じ `memory/notes.md` を両方が書く状態が続くと行が混ざる(実測でも
  fork ツリーに managed の memory 行が入った)。行の帰属は分かる(行頭にタイムスタンプ)が、行単位で
  分ける仕組みはない。
- managed は自分の agent dir(`~/.spirits/managed-pi/agent`)を使うので、既定切り替え後も fork 用の
  `~/.spirits/agent` は自動的に消えない。切り替え直後に「片方を単一ソースにする」なら、コピー元を
  読まない状態に置く(リネーム等)方が、混在書き込みを防げる。

## 判断が必要な項目

1. **既定切り替え時にどちらを単一ソースにするか**(コピーで併存させるのか、コピー元を無効化するのか)。
   実測は併存でも壊れないことを示すが、`memory/notes.md` が混ざることは示さない。
2. **`pi.virtual-model-state` をどう扱うか**。managed で役割 API が復活する(公式側に対応が入る)まで
   片方向と受け入れるのか、移植スクリプトで 1 回だけ持っていくのか、そもそも破棄するのか。
3. **`bundled-skills/<version>` の残置物**。無害だが溜まる。削除をマイグレーションの手順に入れるか。
4. **`auth.json` の実書き込みをどこで確認するか**。product は対話の `/login` 以外に headless な
   認証書き込み経路を持たないので、この調査では `not-run`。実機の手動確認をマイグレーション計画に
   含めるか。
5. **`models-store.json` / `trust.json`**。どちらも観測されたが未実施(ストアの更新は裏側で走る経路、
   trust は対話でのみ付与)。既定切り替えの計画でこの 2 つを扱う必要があるか。

## 実施しなかったこと(理由)

この 4 項目の実測の判定(`not-run`)は次の「not-run 4 項目の静的確認」でも書き換えない。静的確認は
書き込み経路とファイル形式の一致を見たもので、実測の代替ではない。

- `auth.json write`: 書き込み経路が対話 `/login` のみ。RPC プロトコルにも拡張 API にも credential
  write が無く、headless な product 書き込みが存在しない(`not-run` にした。推測で埋めていない)。
- `models.json write`: どちらのホストもどのフェーズでも `models.json` を書かなかった。ユーザー編集
  ファイルで、headless な product 書き込み経路は観測されていない。
- `models-store.json`: 生成は観測されたが、跨ぎテストを行わせていない。
- `trust.json`: プロジェクト trust は対話で付与するため、どのフェーズも作っていない。

## not-run 4 項目の静的確認

製品ソースの diff だけを見て、書き込み経路とファイル形式が fork と公式 Pi 1.5.0 で同じかを確認した。
比較は fork 側 HEAD `8ddaee8e111974fef6b46222124be7497bee01d6` と公式タグ `v1.5.0`
(`f9a26365568127461c47a07a37dcb42c140a3ac5`)。`v1.5.0` は HEAD の祖先ではない(merge base は
`v1.1.0`)ので、diff は「フォークが取り込めていない上流差分」と同じ意味になる。下に書く `-` / `+`
の向きはすべて v1.5.0 → HEAD。

| 項目 | diff を取ったファイル(blob) | 結果 |
|---|---|---|
| `auth.json` write | `packages/coding-agent/src/core/auth-storage.ts`(v1.5.0 `5a8fa417a` / HEAD `9d6495919`)、4 hunk | 差分はロック再試りのエラー処理のみ。公式 v1.5.0 には Windows で delete pending のロックに対する `EPERM` 再試り(`getRetryableLockErrorCode` と `MAX_EPERM_RETRIES = 5`)があり、fork HEAD はそれを持たず `ELOCKED` だけ再試りして `EPERM` は即 throw する。書き込み本体は同一: `proper-lockfile` の `lockSync` / `lock`(realpath: false)でロック下に取り、`JSON.stringify(data, null, 2)` を `writeFileSync(path, next, AUTH_FILE_WRITE_OPTIONS)` で書く。OAuth トークン更新も同じ書き込み経路: `packages/ai/src/auth/resolve.ts` の `refreshStoredOAuthCredential` → `credentials.modify` → `packages/coding-agent/src/core/runtime-credentials.ts:44` → `AuthStorage.modify`(`withLockAsync`) |
| `models-store.json` | `packages/coding-agent/src/core/models-store.ts`(v1.5.0 `bfac3c5e7` = HEAD `bfac3c5e7`) | ファイル完全一致。書き込み側の実装差は無い |
| `trust.json` | `packages/coding-agent/src/core/trust-manager.ts`(v1.5.0 `f0721efef` / HEAD `3396c9a39`)、4 hunk | 差分は Windows のパス大文字・小文字比較のみ。公式 v1.5.0 は `pathsEqual` でキーを大小無視で照合し、`findTrustFileKeys` で大文字違いのキーをまとめて消す。fork HEAD は `data[currentDir]` の完全一致比較で、`set()` も完全一致のキーしか消さない(Windows で大文字違いの残キーが残る余地がある)。ファイル形式は同一: `TrustFile = Record<string, boolean \| null \| undefined>`、`writeTrustFile` はキーをソートして `JSON.stringify(sorted, null, 2)` + 改行、ロックも `proper-lockfile` の同一呼び出し(`writeTrustFile` / `readTrustFile` / `withTrustFileLock` は無変更) |
| `models.json` write | `packages/coding-agent/src` 全体を `git grep "models.json"` / `getModelsPath\|modelsPath`(v1.5.0 と HEAD の両方)、加えて `packages/spirits/src` | どちらのツリーにも書き込み箇所が無い。ヒットするのは読み取り側(`core/model-config.ts` の load/parse、`core/model-runtime.ts`・`core/agent-session-services.ts`・`core/sdk.ts`・`package-manager-cli.ts` のパス受け渡し、`/logout` のメッセージ文)だけで、`modelsPath` を `write`/`save`/`persist` する呼び出しは 0 件。ユーザー編集ファイルという実測の結論どおり |
