# managed-pi Delta

## MODIFIED Requirements

### Requirement: 実験経路の明示選択
システムは、専用 Pi を使う隔離経路 `spirits managed-pi` を、利用者が明示的に指定した場合だけ起動しなければならない。(SHALL)
隔離経路は、システムの `pi`、PATH 上の `pi`、既定の managed 起動を暗黙に使用してはならない。(MUST)
専用 Pi が未導入、破損、非対応の場合、隔離経路は理由と復旧手順を表示して非ゼロで終了し、既定経路へ黙って切り替えてはならない。(MUST)
隔離経路は、起動前に実行プラットフォームが対応表の platform と一致することを確認し、一致しない場合は Pi を spawn せず理由を表示して非ゼロで終了しなければならない。(MUST)
この要件が対象にするのは隔離経路であり、既定経路の agent dir と引数の扱いは別の要件が定める。(MUST)

#### Scenario: 明示指定による起動
- **WHEN** 利用者が専用 Pi の導入後に `spirits managed-pi -- --help` を実行する
- **THEN** 絶対パスで管理された専用 Pi が起動し、システムの `pi` は使用されない

#### Scenario: 明示指定なしの通常起動
- **WHEN** 利用者が `spirits` を引数なしで実行する
- **THEN** 隔離経路の明示選択は適用されず、既定経路の managed が起動する

#### Scenario: 未導入時の失敗
- **WHEN** 専用 Pi を導入せずに `spirits managed-pi` を実行する
- **THEN** 専用 Pi が未導入である旨と導入コマンドが表示され、終了コードは非ゼロになり、システムの `pi` は起動しない

#### Scenario: 破損時の非 fallback
- **WHEN** 管理された専用 Pi の実行ファイルが改変され、記録されたチェックサムと一致しない状態で `spirits managed-pi` を実行する
- **THEN** 整合性検証の失敗が表示され、終了コードは非ゼロになり、既定経路へ切り替わらない

#### Scenario: 非対応プラットフォーム
- **WHEN** 対応表が `linux-x64` の専用 Pi を別のプラットフォームで起動しようとする
- **THEN** 非対応である旨と復旧手順が表示され、終了コードは非ゼロになり、Pi は spawn されない

### Requirement: 既存データの非破壊な利用
隔離経路は、実験期間中、既存の `~/.spirits/agent` を直接利用してはならない。(MUST)
隔離経路は、既存 agent dir の自動コピー、移行、同期、削除、バックアップ作成を行ってはならない。(MUST)
既定経路は既存の agent dir を利用し、初回起動前のバックアップだけが「初回起動前の agent dir バックアップ」の要件に従って行われる。(SHALL)
通常の `spirits` 起動は既定経路の managed であり、その保存先は agent dir の要件が定める。(SHALL)

#### Scenario: 既存設定の読み取り
- **WHEN** 既存 `~/.spirits/agent` に settings、auth、sessions、extensions がある状態で隔離経路を起動する
- **THEN** 隔離経路はそれらを自分の agent dir として読み込まず、隔離 agent dir を使い、既存ファイルを変更しない

#### Scenario: 既存 agent dir の不変
- **WHEN** 一時 HOME の `~/.spirits/agent` に settings、auth、sessions、extensions の fixture を置き、その HOME で隔離経路の install、update、repair、help、version、起動を行う
- **THEN** 既存 agent dir の内容と更新時刻は操作の前後で変わらない

#### Scenario: 自動移行をしない
- **WHEN** 隔離経路を初めて起動する
- **THEN** 既存データの自動コピー、自動変換、バックアップの自動作成、旧ディレクトリの削除は行われず、隔離 agent dir だけが使われる

#### Scenario: 変換が必要な操作の記録
- **WHEN** 互換性ランナーの書き込み互換判定に、変換を必要とする操作を渡す
- **THEN** 結果は成功ではなく `limited` と `aborted` の理由を含み、隔離経路が触れた agent dir の fixture は変更されず、書き込み互換は未確認であることを記録に残す

#### Scenario: 書き込み互換の未確認表示
- **WHEN** managed 経路の利用者向け文書 (`docs/spirits-managed-pi.md`、`packages/spirits/README.md`) と実測記録を確認する
- **THEN** 既存データの書き込み互換について `docs/agent-data-compat` の実測範囲とその未確認部分を区別して示し、実測していない範囲を実証済みとして記載しない

#### Scenario: 通常経路の維持
- **WHEN** 同じ HOME で既定経路の `spirits` を起動する
- **THEN** 保存先は `~/.spirits/agent` になり、`~/.spirits/managed-pi/agent` は使わない

### Requirement: 既定経路の agent dir
既定経路の managed は、既存の agent dir の規則で agent dir を決めなければならない。(SHALL)
すなわち `SPIRITS_CODING_AGENT_DIR` が設定済みならその値を、未設定なら `~/.spirits/agent` を使い、旧名 `PI_CODING_AGENT_DIR` は保存先の指定として読まない。(MUST)
既定経路は agent dir のコピー、移行、同期を行ってはならない。(MUST)

#### Scenario: 既定の保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せずに既定経路で managed を起動する
- **THEN** 子プロセスの agent dir は `~/.spirits/agent` になり、`~/.spirits/managed-pi/agent` は使われない

#### Scenario: 明示された保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR=/tmp/spirits-agent` を設定して既定経路で managed を起動する
- **THEN** 子プロセスの agent dir は `/tmp/spirits-agent` になる

#### Scenario: 旧環境変数の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` だけを設定して既定経路で managed を起動する
- **THEN** agent dir は `/tmp/old-agent` ではなく `~/.spirits/agent` になる

### Requirement: 既定経路の引数透過
既定経路は、ホストの CLI 引数を `--` なしでそのまま受け付け、専用 Pi へ渡さなければならない。(SHALL)
`--continue`、`--resume`、`--session`、`--fork`、`--session-dir`、`--export` を含むホストの引数を既定経路で拒否してはならない。(MUST)
spirits のサブコマンド (`update`、`managed-pi`)、`--version` / `-v`、`--help` / `-h` の扱いは起動役が定める。(SHALL)

#### Scenario: 既存 session の指定
- **WHEN** 既定経路で `spirits --session <file>` を実行する
- **THEN** 引数を書き換えずに専用 Pi へ渡し、拒否メッセージを出さない

#### Scenario: 継続と再開
- **WHEN** 既定経路で `spirits --continue` および `spirits --resume` を実行する
- **THEN** 専用 Pi にそのまま渡り、起動は拒否されない

#### Scenario: サブコマンドは従来のまま
- **WHEN** 既定経路化後に `spirits update` と `spirits managed-pi help` を実行する
- **THEN** それぞれ自己更新と managed wrapper help が従来どおり実行される

### Requirement: 既定経路の一式の欠落と失敗時の挙動
システムは、コンパイル済み `spirits` の既定経路の起動時に managed の一式が未導入の場合、起動役と同じリリースから同じ規則で取得して導入し、続いて専用 Pi を起動しなければならない。(SHALL)
未コンパイルの実行で managed の一式が未導入の場合は、取得を行わず、`spirits managed-pi install` または `SPIRITS_MANAGED_PI_MANIFEST_URL` を使った導入方法を表示して非ゼロで終了しなければならない。(MUST)
取得に失敗した場合、および導入済みの一式が破損して検証を通らない場合は、専用 Pi を spawn せず、理由、修復コマンド `spirits managed-pi repair`、および旧版への戻し方を表示して非ゼロで終了しなければならない。(MUST)
失敗を理由に黙ってフォークや別ホストへ切り替えてはならない。(MUST)

#### Scenario: 未導入時の自動取得
- **WHEN** managed の一式が未導入の環境でコンパイル済み `spirits` を起動する
- **THEN** 起動役と同じリリースの一式を取得・検証して導入し、続いて専用 Pi を起動する

#### Scenario: 未コンパイルでの未導入
- **WHEN** managed の一式が未導入の環境で `bun packages/spirits/bin/spirits.ts` を起動する
- **THEN** 一式は取得されず、`spirits managed-pi install` またはマニフェスト URL の指定方法が表示され、終了コードは非ゼロになる

#### Scenario: 破損時の非 fallback
- **WHEN** 導入済みの拡張 bundle が記録されたチェックサムと一致しない状態で既定経路の managed を起動する
- **THEN** 専用 Pi は spawn されず、理由と `spirits managed-pi repair` と旧版への戻し方が表示され、終了コードは非ゼロになる

#### Scenario: 取得失敗時の非 fallback
- **WHEN** 一式の取得中にネットワークエラーが起こる
- **THEN** 理由と修復コマンドと旧版への戻し方が表示され、終了コードは非ゼロになり、フォークは起動しない

## REMOVED Requirements

### Requirement: 不足 API の限定互換モード
**Reason**: role 登録 API の有無で経路を分ける必要がなくなり、ホスト API の不足は限定互換モードの通常の状態になるため。
**Migration**: 追加する要件「ホスト API の限定互換モード」に従う。

### Requirement: 既定の managed 起動
**Reason**: 既定経路と未コンパイル実行の双方が managed になり、フォークの起動経路が無くなるため。
**Migration**: 追加する要件「単一の managed 起動」に従う。

## ADDED Requirements

### Requirement: ホスト API の限定互換モード
システムは、ホストに spirits が必要とする任意 API が無い場合、拡張全体のロードを失敗させず、文書化された限定互換モードでロードしなければならない。(SHALL)
限定互換モードでは、利用できない機能を起動時に明示し、利用可能であるかのように表示してはならない。(MUST)
固定したホストに API が無いことは限定互換モードの通常の状態である。(SHALL)

#### Scenario: role API が無い場合のロード
- **WHEN** role 登録 API が無いホストで spirits 拡張を起動する
- **THEN** spirits 拡張はロードされ、`tsrepl` と TODO と harness のツールが登録され、role 関連機能が `/spirits-role` で提供される旨が表示される

#### Scenario: API が利用できる場合の通常動作
- **WHEN** 必要な API がすべて利用できるホストで spirits 拡張を起動する
- **THEN** 限定互換モードの通知は出さず、通常の登録が行われる

### Requirement: 単一の managed 起動
システムは、コンパイル済み・未コンパイルを問わず、`spirits` の既定の起動経路として managed を起動しなければならない。(SHALL)
managed の起動は、検証済みの専用 Pi を絶対パスで spawn し、spirits 拡張 bundle を `-e` で読み込む。(SHALL)
既定経路は PATH 上の `pi`、システムの `pi`、フォークの実行ファイルを使用してはならない。(MUST)
一式が未導入のときの扱いは「既定経路の一式の欠落と失敗時の挙動」に従う。(SHALL)

#### Scenario: 既定の起動
- **WHEN** `SPIRITS_ROUTE` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** 検証済みの専用 Pi が spirits 拡張 bundle とともに起動する

#### Scenario: 未コンパイル実行
- **WHEN** managed の一式を導入済みの環境で、ソースから `bun packages/spirits/bin/spirits.ts` を起動する
- **THEN** 導入済みの managed ホストを検証して起動する
