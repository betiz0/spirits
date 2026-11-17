# binary-distribution Specification

## Purpose

spirits を Linux x86_64 向けに、コンパイル済み実行ファイルと pi の組み込みテーマ資産を含む配布物として提供し、curl ベースのインストーラで導入できるようにする。これにより Bun / Node を持たない環境の利用者が、spirits 拡張を組み込んだ pi をそのまま起動できる。

## Requirements
### Requirement: コンパイル済み spirits の起動
システムは、コンパイル済み `spirits` の既定の起動経路で、検証済みのホスト Pi 一式を起動し、そのホストが spirits 拡張 bundle を読み込まなければならない。(SHALL)
起動役はホストのソースやパッケージを実行ファイルに内包してはならない。(MUST)
システムは、自己更新として処理する `update`、`spirits managed-pi`、`--version` / `-v`、`--help` / `-h` を除き、`spirits` に渡された CLI 引数を `--` なしでそのままホストの CLI 解釈へ渡さなければならない。(SHALL)
`--` を指定した場合、起動役は `--` より後の引数を解釈せず、`--` を除いてホストへ渡さなければならない。(SHALL)
`SPIRITS_ROUTE=fork` が設定されている場合の扱いは「既定経路の起動役の分岐」に従う。(SHALL)

#### Scenario: 引数なし起動
- **WHEN** コンパイル済み `spirits` を引数なしで起動する
- **THEN** 検証済みのホスト Pi が起動し、セッションで `tsrepl` が有効なツールとして登録されている

#### Scenario: 起動役はホストを内包しない
- **WHEN** コンパイル済み `spirits` の実行ファイルを調べる
- **THEN** ホストのソースやパッケージは含まれず、ホストは managed root の固定 artifact から起動される

#### Scenario: CLI 引数の透過
- **WHEN** `spirits --continue` を実行する
- **THEN** `--continue` が書き換えられずにホストの CLI 解釈へ渡る

#### Scenario: 起動役の help
- **WHEN** `spirits --help` を実行する
- **THEN** 起動役自身の help が表示され、終了コード 0 で終わる

#### Scenario: Pi の引数の透過
- **WHEN** `spirits -- --continue` および `spirits -- --session <file>` を実行する
- **THEN** `--` より後がホストへそのまま渡る

#### Scenario: 追加拡張の指定
- **WHEN** ツールを登録する拡張を指定して `spirits -- -e <拡張パス>` を実行する
- **THEN** ホストがその拡張を読み込み、組み込み spirits 拡張のツールに加えてセッションで利用可能になる

### Requirement: バージョン表示
`spirits --version` と `spirits -v` は、ビルド時に埋め込まれた spirits のバージョンと、実行ファイルに内包された Bun のバージョンを出力し、終了コード 0 で終わらなければならない。(SHALL)
バージョンはビルド元の git tag から導出し、実行時に外部ファイルを読まずに表示できなければならない。(SHALL)

#### Scenario: バージョン出力
- **WHEN** コンパイル済み `spirits --version` を実行する
- **THEN** 出力にビルド元タグのバージョンと、内包 Bun のバージョン(`Bun.version` の値)が含まれ、終了コードは 0 になる

#### Scenario: 短縮形
- **WHEN** コンパイル済み `spirits -v` を実行する
- **THEN** `spirits --version` と同じ出力になり、終了コードは 0 になる

### Requirement: pi の更新通知の抑止
コンパイル済み `spirits` は、pi の最新版確認を行ってはならず、pi の更新通知を表示してはならない。(MUST)
コンパイル済み `spirits` の help は、pi 本体の更新を案内してはならず、spirits 自身の更新手段を示さなければならない。(SHALL)

#### Scenario: 更新通知が出ない
- **WHEN** ネットワークに接続できる環境でコンパイル済み `spirits` を対話モードで起動する
- **THEN** pi の "Update Available" 通知は表示されない

#### Scenario: help に pi 本体の更新を出さない
- **WHEN** コンパイル済み `spirits --help` を実行する
- **THEN** 出力に "Update pi" を含む pi 本体の更新案内は表示されない

#### Scenario: update の案内先
- **WHEN** コンパイル済み `spirits update` を実行する
- **THEN** `github.com/earendil-works/pi/releases` は案内されず、spirits 自身の更新結果または失敗の理由が表示される

### Requirement: 設定ディレクトリ
コンパイル済み `spirits` は、環境変数 `SPIRITS_CODING_AGENT_DIR` が未設定の場合、設定・認証情報・セッション・外部拡張の保存先として `~/.spirits/agent/` を使わなければならない。(SHALL)
`SPIRITS_CODING_AGENT_DIR` が設定済みの場合は、その値を優先しなければならない。(SHALL)
旧名 `PI_CODING_AGENT_DIR` は保存先の指定として読んではならない。(MUST)
`~/.spirits/agent/` は、インストール先 `~/.spirits/bin/` と別のディレクトリでなければならない。(MUST)

#### Scenario: 既定の保存先
- **WHEN** `SPIRITS_CODING_AGENT_DIR` を設定せず、空のホームディレクトリでコンパイル済み `spirits` を起動して設定を保存する
- **THEN** 設定ファイルは `~/.spirits/agent/` 配下に作られ、`~/.pi` は作られず、`~/.spirits/bin/spirits` は変更されない

#### Scenario: 環境変数の優先
- **WHEN** `SPIRITS_CODING_AGENT_DIR=/tmp/spirits-agent` を設定してコンパイル済み `spirits` を起動し、設定を保存する
- **THEN** 設定ファイルは `/tmp/spirits-agent` 配下に作られ、`~/.spirits/agent/` は作られない

#### Scenario: 旧環境変数名の無視
- **WHEN** `PI_CODING_AGENT_DIR=/tmp/old-agent` を設定してコンパイル済み `spirits` を起動し、設定を保存する
- **THEN** 設定ファイルは `/tmp/old-agent` ではなく `~/.spirits/agent/` 配下に作られる

### Requirement: 開発時の Bun バージョンゲート
システムは、コンパイルされていない状態で起動された場合、`Bun.version` が 1.4.0 未満なら起動を拒否し、必要な最低バージョンを示すメッセージと非ゼロの終了コードを返さなければならない。(SHALL)
`Bun.version` が 1.4.0 以上 1.4.2 未満なら、警告を表示したうえで起動を続けなければならない。(SHALL)
コンパイル済み実行ファイルでは、このゲート判定を行ってはならない。(SHALL)

#### Scenario: 下限未満の拒否
- **WHEN** Bun 1.3.x で未コンパイルのエントリを起動する
- **THEN** 起動せず、最低バージョンが 1.4.0 であることを示すメッセージが表示され、終了コードは非ゼロになる

#### Scenario: 推奨未満の警告
- **WHEN** Bun 1.4.1 で未コンパイルのエントリを起動する
- **THEN** 1.4.2 以上を推奨する警告が表示され、起動は続行される

#### Scenario: コンパイル済みでのスキップ
- **WHEN** 起動判定に、コンパイル済みであることと Bun バージョン 1.3.0 を入力する
- **THEN** 拒否も警告も返らず、起動は続行される

#### Scenario: コンパイル済みの通常起動
- **WHEN** コンパイル済み `spirits --version` を実行する
- **THEN** 標準エラー出力にバージョンゲートの拒否や警告は含まれない

### Requirement: インストーラのプラットフォーム検査
インストーラは POSIX sh で動作し、`uname -s` が Linux、`uname -m` が x86_64 でなければ、「このバージョンは Linux x86_64 専用」である旨を表示して非ゼロで終了し、ファイルを配置してはならない。(SHALL)
プラットフォーム検査は、`curl` / `sha256sum` などの依存コマンドの検査より先に実行しなければならない。(SHALL)

#### Scenario: 非対応プラットフォーム
- **WHEN** `uname -s` が Darwin を返す環境でインストーラを実行する
- **THEN** Linux x86_64 専用である旨が表示され、終了コードは 1 になり、`~/.spirits/bin/spirits` は作成も変更もされない

#### Scenario: 依存コマンド検査より先のプラットフォーム検査
- **WHEN** `uname -s` が Darwin を返し、`PATH` 上に `sha256sum` が無い環境でインストーラを実行する
- **THEN** Linux x86_64 専用である旨が表示され、終了コードは非ゼロになり、`sha256sum` 不足のメッセージは表示されない

### Requirement: インストーラのバージョン解決
インストーラは、環境変数 `VERSION` が `0.1.0` の形式で指定されていれば、`spirits-v` を前置したタグ(`spirits-v0.1.0`)のリリースを使わなければならない。(SHALL)
`VERSION` の指定がなければ、Releases API が返す作成日時の新しい順の一覧(1 ページ 100 件)から、draft と prerelease を除いた `spirits-v*` タグのリリースの先頭を最新として使わなければならない。(SHALL)
対応するリリースを解決できない場合は、エラーを表示して非ゼロで終了し、ファイルを配置してはならない。(SHALL)

#### Scenario: VERSION 指定
- **WHEN** `VERSION=0.1.0` を設定してインストーラを実行する
- **THEN** タグ `spirits-v0.1.0` の `spirits-linux-x64` と `spirits-linux-x64.sha256` がダウンロード対象になる

#### Scenario: latest 解決
- **WHEN** `VERSION` を設定せず、作成日時の古い順に `spirits-v0.1.0`、`spirits-v0.2.0` のリリースがある環境でインストーラを実行する
- **THEN** `spirits-v0.2.0` の成果物がダウンロード対象になる

#### Scenario: pi のリリースの除外
- **WHEN** `VERSION` を設定せず、`spirits-v0.2.0` より新しい `v1.0.0` の pi リリースがある環境でインストーラを実行する
- **THEN** `spirits-v0.2.0` の成果物がダウンロード対象になる

#### Scenario: draft と prerelease の除外
- **WHEN** `VERSION` を設定せず、`spirits-v0.2.0` より新しい prerelease の `spirits-v0.3.0-rc.1` と draft の `spirits-v0.3.0` がある環境でインストーラを実行する
- **THEN** `spirits-v0.2.0` の成果物がダウンロード対象になる

#### Scenario: リリース未検出
- **WHEN** 通常の(draft でも prerelease でもない)`spirits-v*` のリリースが 1 つも無い状態でインストーラを実行する
- **THEN** 解決に失敗した旨が表示され、終了コードは非ゼロになり、ファイルは配置されない

### Requirement: 配置と冪等性
インストーラは、検証済みの実行ファイルを `~/.spirits/bin/spirits` に配置しなければならない。(SHALL)
インストーラは、配置した実行ファイルに実行ビットを付与しなければならない。(SHALL)
配置先ディレクトリが無い場合は作成しなければならない。(SHALL)
配置には root 権限を要求してはならない。(SHALL)
既存の `~/.spirits/bin/theme/` は削除も変更もしてはならない。(MUST)

#### Scenario: 初回配置
- **WHEN** `~/.spirits/bin` が無い状態でインストーラを実行する
- **THEN** ディレクトリが作成され、`~/.spirits/bin/spirits` が実行可能ファイルとして存在し、`~/.spirits/bin/theme/` は作られない

#### Scenario: 旧版のテーマ資産の残置
- **WHEN** 旧版が配置した `~/.spirits/bin/theme/dark.json` がある状態でインストーラを実行する
- **THEN** そのファイルは元の内容のまま残る

### Requirement: バージョンを明示した再配置
`VERSION` を指定した実行、および異なるバージョンが解決された実行では、既存ファイルを上書きして同じ結果にならなければならない。インストール済みバージョンが解決されたバージョンより新しい場合(prerelease ビルドなど)も上書きする。この点で、置換しない `spirits update` とは挙動が異なる。(SHALL)

#### Scenario: VERSION 明示での再配置
- **WHEN** 0.1.0 がインストール済みの環境で `VERSION=0.1.0` を指定してインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.1.0 の実行ファイルで置き換えられる

#### Scenario: 別バージョンへの再実行
- **WHEN** `VERSION=0.1.0` でインストール済みの環境で `VERSION=0.2.0` のインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は 0.2.0 の実行ファイルに置き換わり、実行可能のままになる

#### Scenario: 新しい prerelease からの置換
- **WHEN** 0.4.0-rc.1 がインストール済みで最新 stable が 0.3.0 の環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.3.0 の実行ファイルで置き換えられる

### Requirement: 配置の原子的性質と一時ファイルの掃除
配置の途中のどの時点でも、`~/.spirits/bin/spirits` は元の実行ファイル全体か、検証済みの新しい実行ファイル全体のいずれかでなければならない。(SHALL)
インストーラは、失敗した場合、および SIGINT または SIGTERM を受けて中断した場合、自身が作成した一時ファイルを削除しなければならない。(SHALL)
インストーラは、開始時に、配置先ディレクトリに残っている過去のインストーラまたは自己更新の一時ファイルを削除しなければならない。ただし、実行中の別のインストーラまたは自己更新が使用している一時ファイルは削除してはならない。(SHALL)

#### Scenario: 中断時の既存ファイル維持
- **WHEN** 既存の `~/.spirits/bin/spirits` がある状態で、ダウンロード中のインストーラに SIGINT を送る
- **THEN** `~/.spirits/bin/spirits` は元の内容と実行ビットを保ち、インストーラの一時ファイルは残らない

#### Scenario: 残った一時ファイルの削除
- **WHEN** 既に終了したプロセスが残した一時ファイルが `~/.spirits/bin` にある状態でインストーラを実行する
- **THEN** その一時ファイルは削除される

#### Scenario: 実行中の一時ファイルの保護
- **WHEN** 実行中の `spirits update` が使用している一時ファイルが `~/.spirits/bin` にある状態でインストーラを実行する
- **THEN** その一時ファイルは削除されない

### Requirement: PATH 案内と成功メッセージ
インストーラは、`~/.spirits/bin` が `PATH` に含まれていない場合、shell rc へ追記すべき行を案内しなければならない。(SHALL)
インストーラは shell rc を自動編集してはならない。(MUST)
インストーラは、成功時に、利用を開始するコマンドを表示しなければならない。(SHALL)
インストーラは、成功時に、実行環境の `PATH` 上にある `bun` のバージョンを参考情報として表示しなければならない。`bun` が見つからない場合は、拡張の依存解決には別途 Bun が必要である旨を表示しなければならない。(SHALL)
インストーラは、`bun` の有無やバージョンによって、インストールの成否を変えてはならない。(MUST)

#### Scenario: PATH 未通しの案内
- **WHEN** `PATH` に `~/.spirits/bin` を含まない状態でインストーラを実行する
- **THEN** `~/.spirits/bin` を `PATH` に追加する行が表示され、shell rc ファイルの内容は変更されない

#### Scenario: 成功表示(Bun あり)
- **WHEN** `PATH` 上に `bun` 1.4.2 がある環境でインストーラが成功する
- **THEN** 出力に `spirits` の起動コマンドと、`bun` のバージョン 1.4.2 が含まれる

#### Scenario: 成功表示(Bun なし)
- **WHEN** `PATH` 上に `bun` が無い環境でインストーラが成功する
- **THEN** 終了コードは 0 になり、出力に `spirits` の起動コマンドと、拡張の依存解決には別途 Bun が必要である旨が含まれる

### Requirement: アンインストールの案内
インストーラは、`--uninstall` 指定時に、配置済みの `~/.spirits/bin/spirits`、ホスト一式 `~/.spirits/managed-pi`、およびデータディレクトリ `~/.spirits/agent/` を削除するためのコマンドを標準出力へ案内しなければならない。(SHALL)
`--uninstall` 指定時、インストーラはファイルとディレクトリを変更してはならず、shell rc を編集してはならない。(MUST)
`--uninstall` 指定時、インストーラはネットワークアクセスを行わず、`curl` / `sha256sum` を要求してはならない。(SHALL)
`--uninstall` は、対象が存在しない場合も終了コード 0 で終わらなければならない。(SHALL)

#### Scenario: 削除案内の出力
- **WHEN** `--uninstall` を指定してインストーラを実行する
- **THEN** `~/.spirits/bin/spirits`、`~/.spirits/managed-pi`、`~/.spirits/agent/` を削除するコマンドが出力され、終了コードは 0 になり、インストール済みファイルとデータディレクトリは変更されない

#### Scenario: 未インストールでの案内
- **WHEN** `spirits` が配置されていない環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

#### Scenario: 依存コマンドなしでの案内
- **WHEN** `PATH` 上に `curl` も `sha256sum` も無い Linux x86_64 環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

### Requirement: 外部拡張のロード
ホスト Pi は、`~/.spirits/agent/extensions/` に配置された外部 TypeScript 拡張を、組み込み spirits 拡張 bundle と合わせてロードしなければならない。(SHALL)
外部拡張からホストのパッケージを import できなければならない。(SHALL)
外部拡張が独自の node_modules 依存を要求し、それがホストに存在しない場合、ホストはその拡張のロード失敗を拡張パスを含むエラーとして stderr に報告し、非ゼロの終了コードで終了しなければならない。(SHALL)
`--help` のようにセッションを開始しないコマンドが指定された場合は、外部拡張のロード失敗があっても help の出力を優先し、終了コード 0 で終了しなければならない。(SHALL)
ホストの実行ファイルがパッケージマネージャを内包しないため拡張の依存解決には別途 Bun が必要である旨を、README に記載しなければならない。(SHALL)

#### Scenario: 外部拡張のロード
- **WHEN** `~/.spirits/agent/extensions/` にツールを登録する外部拡張を配置して `spirits` を起動する
- **THEN** そのツールがセッションで利用可能になる

#### Scenario: バンドル済み pi パッケージの import
- **WHEN** 外部拡張が `@earendil-works/pi-coding-agent` を import する
- **THEN** import はホストが提供するパッケージへ解決される

#### Scenario: 依存不足の拡張
- **WHEN** 外部拡張がホストに存在しないベア指定子のパッケージを import する
- **THEN** セッションは起動せず、ロード失敗がその拡張のパスを含むエラーとして stderr に報告され、終了コードは非ゼロになる

#### Scenario: セッションを開始しないコマンドの優先
- **WHEN** 依存不足の外部拡張が存在する状態で `spirits --help` を実行する
- **THEN** help が表示され、ロード失敗のエラーは表示されず、終了コードは 0 になる

#### Scenario: README の案内
- **WHEN** `packages/spirits/README.md` を確認する
- **THEN** 外部拡張の依存解決には別途 Bun が必要である旨が記載されている

### Requirement: リリース成果物
リポジトリは `spirits-v*` 形式のタグ push を契機に、ubuntu ランナーと固定した Bun(1.4.2 以上)で依存導入・テスト・ビルドを実行し、`spirits-linux-x64` と `spirits-linux-x64.sha256` を GitHub Release に添付しなければならない。(SHALL)
リリースは、旧版の自己更新が取得するテーマ資産 `dark.json`、`light.json` と、それぞれの `.sha256` を、互換用として引き続き添付しなければならない。(SHALL) 新しい起動役、インストーラ、自己更新はこれらを使ってはならない。(MUST)
リリースノートには、ビルドに使用した内包 Bun のバージョンを記載しなければならない。(SHALL)
タグのバージョン部に `-` を含む場合(例: `spirits-v0.3.0-rc.1`)、リリースは prerelease として公開しなければならない。(SHALL)
テストまたはビルドが失敗した場合、リリースを公開してはならない。(MUST)
`spirits-v*` 以外のタグ push と、タグ以外の手動起動は、このリリース処理を起動してはならない。(SHALL)

#### Scenario: タグ push によるリリース
- **WHEN** `spirits-v0.1.0` タグを push する
- **THEN** 専用の GitHub Release が作成され、実行ファイルとそのチェックサムが添付され、リリースノートに内包 Bun のバージョンが含まれる

#### Scenario: テーマ資産の添付
- **WHEN** `spirits-v0.1.0` タグを push してリリースが作成される
- **THEN** `dark.json`、`light.json` とそれぞれの `.sha256` が互換用として添付され、`sha256sum -c` で検証でき、どちらも JSON として解析できる

#### Scenario: prerelease の公開
- **WHEN** `spirits-v0.0.0-test` タグを push する
- **THEN** 作成される Release は prerelease として公開される

#### Scenario: 検証失敗時の非公開
- **WHEN** リリースビルドのテストが失敗する
- **THEN** 実行ファイルを含む Release は公開されない

#### Scenario: 既存 pi リリースとの分離
- **WHEN** `v1.0.0` のように `spirits-` で始まらないタグを push する
- **THEN** spirits のリリース処理は起動しない

### Requirement: 依存導入の再現性
リポジトリは root に `bun.lock` を持ち、リリースビルドは `bun install --frozen-lockfile` を成功させなければならない。(SHALL)
`--frozen-lockfile` は lockfile を書き換えてはならず、lockfile と `package.json` 群が不整合な場合は非ゼロで終了しなければならない。(SHALL)

#### Scenario: クリーンチェックアウトでの依存導入
- **WHEN** クリーンなチェックアウトで `bun install --frozen-lockfile` を実行する
- **THEN** コマンドは成功し、`bun.lock` に差分が生じない

#### Scenario: lockfile 不整合の検出
- **WHEN** lockfile と一致しない依存を `package.json` に追加した状態で `bun install --frozen-lockfile` を実行する
- **THEN** コマンドは非ゼロで終了する

### Requirement: 後段フェーズ機能への非依存
コンパイル用エントリとインストーラは、M3 以降の機能(rlm、Continual Harness、Phase 2)を import・参照してはならない。(MUST)
コンパイル用エントリは、「起動役の版と自己更新を処理する」責務、「ホスト一式の導入状態を確認し、検証して起動する」責務、「`--help` / `-h` の help を出す」責務だけを持ち、拡張内にどのツールが登録されているかを知ってはならない。(MUST)
インストーラは、バイナリの内部構成や同梱機能に依存してはならず、リリース成果物の名前とチェックサム、および `--version` の表示結果だけに依存しなければならない。(SHALL)

#### Scenario: 後段機能の非参照
- **WHEN** コンパイル用エントリとインストーラの参照を列挙する
- **THEN** rlm / harness / phase2 のモジュールやコマンドへの参照が存在しない

#### Scenario: 登録内容に依存しない起動
- **WHEN** コンパイル用エントリのソースを確認する
- **THEN** 登録済みツールの名前・一覧を参照する記述が存在しない

### Requirement: 起動ディレクトリの .env の読み込み禁止
コンパイル済み `spirits` は、起動ディレクトリにある `.env`、`.env.local`、および `NODE_ENV` の値に対応する `.env.<NODE_ENV>` (`.env.development`、`.env.production`、`.env.test`) の値を、自身の環境へ読み込んではならない。(MUST)
コンパイル済み `spirits` は、起動したシェルから受け取った環境変数を、引き続き自身の環境として扱わなければならない。(SHALL)

#### Scenario: 起動ディレクトリの .env を無視する
- **WHEN** 起動ディレクトリの `.env` に `SPIRITS_DOTENV_PROBE=1` を定義し、環境変数を読み出して記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_PROBE` は存在しない

#### Scenario: .env.local と .env.<NODE_ENV> を無視する
- **WHEN** `NODE_ENV=production` を設定し、起動ディレクトリの `.env.local` に `SPIRITS_DOTENV_LOCAL_PROBE=1`、`.env.production` に `SPIRITS_DOTENV_MODE_PROBE=1` を定義して、環境変数を記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_LOCAL_PROBE` と `SPIRITS_DOTENV_MODE_PROBE` はどちらも存在しない

#### Scenario: シェルの環境変数は反映される
- **WHEN** シェルで `SPIRITS_DOTENV_PROBE=1` を設定し、環境変数を記録する拡張を指定してコンパイル済み `spirits` を起動する
- **THEN** 記録された環境に `SPIRITS_DOTENV_PROBE=1` が存在する

### Requirement: 既定経路の起動役の分岐
`spirits` は、起動時に経路を選ばず、常に検証済みの managed ホストを起動しなければならない。(SHALL) 未コンパイルの実行も managed ホストを起動する。(SHALL)
managed の一式が未導入のとき、コンパイル済みは同じリリースから取得して起動し、未コンパイルは導入方法を表示して非ゼロで終了しなければならない。(SHALL) 詳細は managed-pi の「既定経路の一式の欠落と失敗時の挙動」に従う。
`SPIRITS_ROUTE=fork` が設定されている場合、起動役はホストを起動する経路でだけ、フォークを起動せず、`SPIRITS_ROUTE` が廃止された理由、`unset SPIRITS_ROUTE` で managed が起動すること、旧版への戻し方を表示して非ゼロで終了しなければならない。(MUST)
`SPIRITS_ROUTE=fork` が設定されていても、`update`、`managed-pi`、`--version` / `-v`、`--help` / `-h` は通常どおり処理しなければならない。(SHALL)

#### Scenario: 既定で managed
- **WHEN** `SPIRITS_ROUTE` を設定せずにコンパイル済み `spirits` を起動する
- **THEN** 検証済みのホストが起動する

#### Scenario: SPIRITS_ROUTE=fork
- **WHEN** `SPIRITS_ROUTE=fork` を設定してコンパイル済み `spirits` を起動する
- **THEN** フォークもホストも起動せず、廃止された理由、`unset SPIRITS_ROUTE`、旧版への戻し方が表示され、終了コードは非ゼロになる

#### Scenario: SPIRITS_ROUTE=fork でもサブコマンドは動く
- **WHEN** `SPIRITS_ROUTE=fork` を設定して `spirits --version`、`spirits --help`、`spirits update`、`spirits managed-pi help` を実行する
- **THEN** それぞれ設定が無い場合と同じ出力と終了コードになり、`SPIRITS_ROUTE` の廃止エラーは出ない

#### Scenario: 未コンパイル実行
- **WHEN** managed の一式を導入済みの環境で、ソースからエントリを実行する
- **THEN** 導入済みの managed ホストが検証されて起動する

#### Scenario: その他の値は managed
- **WHEN** `SPIRITS_ROUTE` に `fork` 以外の値を設定して起動する
- **THEN** managed が起動し、不明な値であることを理由に失敗しない

#### Scenario: ホスト未導入
- **WHEN** managed ホストが未導入の状態で、ソースからエントリを実行する
- **THEN** `spirits managed-pi install` またはマニフェスト URL の指定方法が表示され、終了コードは非ゼロになる

### Requirement: managed 一式のリリース成果物
リリースは、起動役の実行ファイルに加えて、managed の一式の取得元となる manifest と spirits 拡張 bundle、およびそれぞれの `.sha256` を GitHub Release に添付しなければならない。(SHALL)
manifest が記録する拡張 bundle の版は、リリースタグの版と一致しなければならない。(SHALL)

#### Scenario: 一式の添付
- **WHEN** `spirits-v0.7.0` タグを push してリリースが作成される
- **THEN** manifest、拡張 bundle、それぞれの `.sha256` が添付され、manifest の拡張の版は `0.7.0` である

#### Scenario: 起動役と同じリリースから取得できる
- **WHEN** `spirits-v0.7.0` のリリースから manifest と bundle を取得する
- **THEN** 起動役の実行ファイルと同じタグの成果物が得られる

### Requirement: bundle へ埋め込む版
拡張 bundle のビルドは、manifest に記録する版を `SPIRITS_VERSION` として bundle に埋め込まなければならない。(SHALL)
埋め込まれた版は、起動ヘッダーの表示と、同梱スキルの版ディレクトリ名に使われる。(SHALL)

#### Scenario: 版が埋め込まれる
- **WHEN** 版 `0.7.0` で拡張 bundle をビルドする
- **THEN** bundle は `0.7.0` を埋め込み、開発用のフォールバック値を含まない

#### Scenario: 同梱スキルのディレクトリ名
- **WHEN** 埋め込み版 `0.7.0` の bundle をもつ managed 起動で同梱スキルを書き出す
- **THEN** 書き出し先は `<agent dir>/bundled-skills/0.7.0/` になる

### Requirement: リリースでの版の一致確認
リリース処理は、ビルドした拡張 bundle に埋め込まれた版と、タグから導出した `--version` の版が一致することを確認し、一致しない場合はリリースを公開してはならない。(MUST)

#### Scenario: 一致しない場合の非公開
- **WHEN** タグの版と bundle に埋め込んだ版が異なる状態でリリース処理が実行される
- **THEN** 確認手順が失敗し、リリースは公開されない

#### Scenario: 一致する場合
- **WHEN** タグの版と bundle に埋め込んだ版が一致する
- **THEN** 確認手順は成功し、後続の公開処理が進む

### Requirement: インストーラによる managed 一式の導入
インストーラは、起動役の実行ファイルを配置した後、同じリリースの manifest から managed の一式を取得し、検証して導入しなければならない。(SHALL)
導入は検証済みのバイナリを配置した後に実行し、配置済みの実行ファイルを取り替えてはならない。(MUST)
managed の一式の取得または導入に失敗した場合、インストーラは理由と修復コマンド `spirits managed-pi repair`、および旧版への戻し方を表示して非ゼロで終了しなければならない。(MUST)

#### Scenario: 同じリリースの導入
- **WHEN** `VERSION=0.7.0` を指定してインストーラを実行する
- **THEN** `spirits-v0.7.0` の manifest と bundle が使われ、`~/.spirits/managed-pi` に一式が導入される

#### Scenario: managed 導入失敗時の非ゼロ
- **WHEN** 実行ファイルの配置に成功したが managed の manifest の取得に失敗する
- **THEN** 終了コードは非ゼロになり、理由と `spirits managed-pi repair` と旧版への戻し方が表示される

#### Scenario: 実行ファイルは保持される
- **WHEN** managed の導入に失敗する
- **THEN** 配置済みの実行ファイルは検証済みの新しい内容のまま残る

### Requirement: 実行ファイルのチェックサム検証
インストーラは、ダウンロードした実行ファイルを、その `.sha256` とともに一時ディレクトリで `sha256sum -c` により検証しなければならない。(SHALL)
検証に失敗した場合、一時ファイルを削除して非ゼロで終了し、`~/.spirits/bin/spirits` を作成・変更してはならない。(MUST)
検証に成功した場合に限り、配置処理へ進まなければならない。(SHALL)
インストーラは、リリースに添付されたテーマ資産を取得してはならない。(MUST)

#### Scenario: 検証失敗時に配置しない
- **WHEN** ダウンロードした実行ファイルを改変し、`.sha256` と一致しない状態でインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` は作成されず、既存ファイルがあれば元の内容のまま残る

#### Scenario: 検証成功
- **WHEN** 実行ファイルと `.sha256` が一致する状態でインストーラを実行する
- **THEN** 配置処理が実行される

#### Scenario: テーマ資産を取得しない
- **WHEN** テーマ資産を添付したリリースを指定してインストーラを実行する
- **THEN** `dark.json` と `light.json` はダウンロードされず、`~/.spirits/bin/theme/` は作成も変更もされない

### Requirement: 再実行時の版の判定
`VERSION` を指定しない実行では、インストール済みの実行ファイルの `--version` 出力の先頭行 `spirits <version>` から取り出したバージョンが、最新として解決されたバージョンと等しい場合、実行ファイルのダウンロードと配置を行わず、インストール済みバージョンが最新である旨を表示しなければならない。(SHALL)
インストール済みの実行ファイルが無い場合、その `--version` が非ゼロで終了した場合、または出力からバージョンを取り出せない場合、インストーラはダウンロードと配置へ進まなければならない。(SHALL)

#### Scenario: 再実行
- **WHEN** `VERSION` を指定せず、インストール済みと同じバージョンが最新として解決された状態でインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は変更されず、インストール済みバージョンが最新である旨が表示される

#### Scenario: バージョンを判定できない場合の配置
- **WHEN** インストール済みの `~/.spirits/bin/spirits --version` が非ゼロで終了する環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は最新版の実行ファイルで置き換えられる
