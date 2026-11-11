# Design

## Context

起動役は `packages/spirits/bin/spirits.ts` → `bin/bootstrap.ts` で、pi を import する前に (1) Bun ゲート、(2) 環境既定値の注入、(3) `--version`、(4) `update` の分類、(5) `managed-pi` の分類を行い、隔離経路なら spawn して終わる。それ以外は fork の pi を in-process で起動する。隔離経路は `src/managed-pi/` に検証・導入・起動・ガードが揃っており、既定経路はこれに何も触れていない。

制約:

- 層の許可向き（`docs/architecture/convention-registry.md`）で `spirits:update` は `spirits:managed-pi` を import できない。`spirits:bin` は両方を import できる。
- 版の表示と同梱スキルの版ディレクトリ名は `resolveSpiritsVersion()`（`src/version.ts`）が見る。bundle はこれまで `SPIRITS_VERSION` を define していないため、managed では `0.0.0-dev` になっていた。
- 正式な配布は Linux x86_64 の単一バイナリ + POSIX sh の install.sh のみ。install.sh は JSON を構造化して扱えない。
- ユーザー決定（変更しない）: agent dir は fork と同じ規則 / バックアップは 1 回だけ / 退避は `SPIRITS_ROUTE=fork` / 取得元は起動役と同じリリース。

## Goals / Non-Goals

**Goals:**

- 既定の起動経路を managed にし、既存 `~/.spirits/agent` をそのまま使う。
- fork は `SPIRITS_ROUTE=fork` で起動できる状態を保つ（fork 削除までは消さない）。
- 初回起動前のバックアップを「1 回だけ・失敗時は起動しない」で実装する。
- 一式の取得規則を `spirits update` / install.sh / 初回起動の 3 経路で共有する。

**Non-Goals:**

- fork の削除、薄い起動役への置き換え、Pi のパッチ、新しい機能、リリース操作。
- 試用環境（`~/.spirits/managed-pi/agent`）のセッションの自動移行。
- 隔離経路のガードの緩和（そのまま残す）。

## Decisions

### 1. ルート選択は `bin/bootstrap.ts` の分類の後、pi import の前

`selectStartupRoute({ env, compiled })` を `src/managed-pi/default-route.ts` に置き、`bootstrap.ts` は `managed` / `fork` を見て分岐する。`managed` のときは `runDefaultManagedStartup()` が child を spawn して `process.exit(code)` するため、fork の pi は import も起動もされない。

- 代替案: `src/update/run.ts` から managed を起動する。→ 層の許可向き（`update` は `managed-pi` を import できない）に反する。`src/managed-pi/` から `update/` を呼ぶ向きなら許可されているが、`update` の後に走る処理を `update` 側に置くことになり、CLI の順序責任が逆になる。
- 代替案: pi の拡張として起動後に差し替える。→ fork の pi が import され、`--help` でも fork のコードが走る。退避手段の判定が子側になり、spawn 前に失敗を決められない。

`SPIRITS_ROUTE` は `fork` の値だけ特別扱いし、その他の値は既定（managed）にする。不明な値で失敗させると、他の用途で変数を設定している環境の既定起動が壊れる。フラグ名は Pi の `--fork` と衝突するため使わない。

### 2. agent dir の規則は `src/env-defaults.ts` へ移して共有する

`bin/env-defaults.ts` の `computeEnvDefaults` を `src/env-defaults.ts`（`spirits:shared`）へ移し、`bin/env-defaults.ts` は `bin/version.ts` と同じ形での re-export にする。既定経路の agent dir はこの 1 関数の結果だけを使い、fork と managed で規則が diverge する経路をもう作らない。

- 代替案: `src/managed-pi/default-route.ts` に `env[ENV_AGENT_DIR] ?? join(home, ".spirits", "agent")` を書く。→ 同じ規則が 2 箇所になり、`PI_TELEMETRY` など他の既定値と増えていく。`src/` に新しいディレクトリを足すと `registry:layer-members` の更新も必要になる。

### 3. バックアップは spawn 直前の独立モジュール、記録は managed root

`src/managed-pi/agent-backup.ts` に `backupAgentDirOnce({ agentDir, backupsDir, statePath, io })` を置く。手順は (a) 記録があれば何もしない、(b) agent dir が無ければ何もコピーしない、(c) backups 配下の一時ディレクトリへコピーして完成後に rename、(d) 記録を書き、(e) 保存先・サイズ・リンク一覧を表示。コピーは `lstat` で種別を見て、ディレクトリは再帰、symlink は `readlink` + `symlink`（たどらない）、通常ファイルは content と mode を保つ。

記録先を `<managed root>/agent-backup.json` にする理由: 「managed へ切り替えた事実」の記録なので、守る対象の agent dir ではなく managed root に置く。agent dir 内に置くと、バックアップした直後にそのファイルをコピー対象へ含めてしまう。

記録は agent dir ごとの map（schemaVersion 2、キーは実体パス `realpath`。未存在時は解決パス）。「1 回だけ」は dir 単位で、`SPIRITS_CODING_AGENT_DIR` が別の dir を指したときはその dir の初回としてバックアップを取る。単一 dir を記録していた schemaVersion 1 の記録は読み込み時に移行する（記録済み dir は処理済み扱いのまま、新しい dir だけを追加で取得する）。

- 代替案: agent dir の中に `.managed-backup.json` を置く。→ バックアップ自己参照と、バックアップ後初めて生まれるファイルという扱いの込み入る余地が残る。
- 代替案: 保存を `cp -a` に任せる。→ 外部コマンド依存が増え、シンボリックリンクの一覧と参照先の表示に必要な情報を構造化して取り出せない。

バックアップの失敗は spawn より前に決まる。コピーの一部に失敗した場合は一時ディレクトリを削除し、記録も書かない。記録を書いた後に spawn が失敗しても再取得はしない（データは守れているため）。

### 4. 一式の取得は `src/managed-pi/release-assets.ts` に集約し、呼び出し元がタグを渡す

`installManagedSetFromRelease({ tag, root, env, fetch, io })` が `releaseArtifactUrl(tag, MANAGED_PI_MANIFEST_ASSET_NAME, …)` から manifest を取得し、既存の `installManagedSet` で検証・配置する。タグを決める責任は呼び出し元に置く:

- 既定経路の初回起動: `spirits-v<resolveSpiritsVersion()>`
- `spirits update`: 置換したら解決したリリースのタグ、しなければ `spirits-v<installedVersion>`
- install.sh: `-e SPIRITS_MANAGED_PI_MANIFEST_URL=<そのタグの manifest URL>` を付けて導入直後のバイナリの `managed-pi install` を呼ぶ

- 代替案: install.sh が manifest を自分で解析し、tar 展開と overlay 生成と `installed.json` を POSIX sh で書く。→ JSON の構造化パースと SHA256 記録を shell に実装することになり、検証手順が製品実装と二重化してズレる。
- 代替案: 常に最新リリースの manifest を使う。→ 旧バイナリが残った環境で bundle とバイナリがずれる。ユーザー決定に反する。

`spirits managed-pi install` / `update` も同じ規則（実行中バイナリの埋め込み版 → `spirits-v<version>`）を使う。最新 stable 解決（`resolveLatestStableRelease`）は自己更新と install.sh の専売とし、managed コマンドは叩かない。`SPIRITS_MANAGED_PI_MANIFEST_URL` が設定されているときはこれを優先する（fixture・ミラー用の差し替えは従来どおり。install.sh もこの差し替えでタグを固定している）。未コンパイル実行は managed コマンドに到達する前に従来どおり拒否する。対応リリースの無い版（タグの無いローカルビルド）は manifest 取得の HTTP 失敗として表示される（残課題 W-9）。

実リリースの manifest は拡張 bundle の URL をアセット名だけの相対 URL として配布する（`scripts/build-managed-pi-inputs.ts`）。取得時は manifest URL のディレクトリへ解決するが、保存する `releases/<set-id>/manifest.json` には**解決後の絶対 URL を書く**。`repair` は保存済み manifest しか見ないため、相対 URL のまま保存すると復旧時に取得元が決まらない（独立検証 C-1）。

`ENV_MANAGED_PI_MANIFEST_URL` を install.sh から使うのは、既存の fixture 用の上書きを契約として流用するためで、新しい CLI を増やさない。

### 5. 既定経路の環境は隔離経路の computeManagedEnv の派生

`computeManagedEnv` に `sessionDir` を省略可能にし、指定したときだけ pin する。既定経路は `agentDir`（規則で決めた値）を渡し、`sessionDir` は渡さない（親の値を透過し、Pi の既定は agent dir 配下）。`PI_PACKAGE_DIR` の pin、`PI_CODING_AGENT_*` / `PI_APP_NAME` / `PI_CONFIG_DIR` の除去、`PI_SKIP_VERSION_CHECK=1`、`PI_TELEMETRY` の既定は両経路で同じ。

- 代替案: 既定経路専用の環境組み立てを別に書く。→ 除去すべき変数の一覧が 2 箇所に増え、fork と managed で別々に漏れる。

### 6. 破損は自動修復しない、欠落だけ取得する

既定経路は「現 set が無い」→ 取得、「有るが検証に落ちる」→ `spirits managed-pi repair` を表示して非ゼロ。破損を自動で再取得すると、ディスク故障や権限問題を每次の起動で network 付きで繰り返す。

### 7. bundle の版は `define` し、リリースで識別子の消滅と版の一致を確認する

`scripts/build-managed-pi-inputs.ts` の `Bun.build` に `define: { SPIRITS_VERSION: JSON.stringify(version) }` を追加する。確認は `scripts/check-managed-pi-bundle-version.ts` に分離し、(a) manifest の `extension.version` が期待版と一致、(b) bundle に `SPIRITS_VERSION` という識別子が残っていない（define が効けば消える）、(c) bundle に JSON 文字列化した期待版が含まれる、の 3 点を見る。ワークフローは `--version "<tag から導出>"` で呼ぶ。

- 代替案: bundle 中に版の文字列が現れることだけ grep する。→ 同梱 Markdown やエラー文に同じ文字列が現れ得て、定義の確認にならない。

## Risks / Trade-offs

- [Risk] 既定経路が network 取得に依存する（初回・欠落時） → Mitigation: 一度入れば起動時の取得はしない。失敗時は `SPIRITS_ROUTE=fork` と `spirits managed-pi repair` を表示し、fork はそのまま動く。
- [Risk] 公式 Pi が `~/.spirits/agent` に書いたデータを fork が読めない可能性 → Mitigation: 初回バックアップを必須にして戻せるようにする。実データでの読み書き確認は `docs/agent-data-compat` の手順で実測し、結果を docs に残す。
- [Risk] 同一 agent dir に fork と managed が同時に書き込む（同時起動、bundled-skills の書き合い） → Mitigation: 版ディレクトリを分けて消し合わないことをテストで確認。文書で「どちらか片方を使う」ことを明示する。
- [Risk] バックアップが大きい agent dir で重い → Mitigation: 1 回だけ・保存先とサイズを表示・失敗時は起動しない。圧縮はしない（リストアが単純になる）。
- [Risk] install.sh が導入直後のバイナリを実行する（信頼できない実行ファイルを実行するように見える） → Mitigation: 検証済みチェックサムを通った直後の配置であり、install.sh は既に `--version` で同じバイナリを実行している。取得先は install.sh が決めたタグの URL に固定する。
- [Trade-off] 隔離経路のガードは既定経路には効かない → 隔離経路は互換性ランナーとテストのための経路として残し、spec で対象を明示する。

## Migration Plan

1. 新しいバイナリを `spirits update` または install.sh で導入する（同じリリースの一式も入る）。
2. 最初の `spirits` 起動前にバックアップが 1 回取られ、保存先・サイズ・リンクが表示される。
3. 問題があれば `SPIRITS_ROUTE=fork spirits …` で fork に戻る。恒久的に戻す場合は旧バイナリを退避しておく（docs に手順）。
4. 試用環境で作ったセッションを本番 agent dir へ戻す手順は docs 側に手で従う（自動では行わない）。

## 残課題（独立検証で follow-up に回したもの）

- **W-5**: 初回起動が同時に行われると、バックアップ目録名が秒単位の UTC タイムスタンプしかないため同名衝突する（`rename` が ENOTEMPTY で失敗し、その起動はバックアップ失敗で止まる）。同一秒に 2 つの agent dir を初期化した順番実行でも同じ。別ディレクトリの逐次実行で衝突しない仕組み（衝突時の連番サフィックスなど）が要る。
- **W-6**: 互換性ランナーが `HOME` を差し替えて走るとき、ランナー内の「既存 agent dir の確認」が本物の `~/.spirits/agent` を見てしまい、隔離 HOME の dir を確認していない空振りがある。
- **W-8**: 既定経路の初回自動取得は `SPIRITS_MANAGED_PI_MANIFEST_URL` を読まない（読むのは `spirits managed-pi install` / `update` と install.sh だけ）。この「既定経路では manifest の差し替えが効かない」ことを docs に書く。
- **W-9**: タグの無いローカルビルドの版（例: `0.0.0-dev`）で対応リリースが存在せず、`spirits managed-pi install` / `update` と初回起動の自動取得は HTTP 404 の理由表示で失敗する。開発用バイナリの版の扱い（プレフィックスや案内）を決める。
- **G-1〜G-3**: 独立検証（verify2）の SUGGESTION 3 件。本文は検証レポート側にあり、この change の記録には未転記（転記後にここへ移す）。
