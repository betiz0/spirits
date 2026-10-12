# binary-distribution Specification

## Purpose

spirits を Linux x86_64 の単一バイナリとして配布し、curl ベースのインストーラで導入できるようにする。これにより Bun / Node を持たない環境の利用者が、spirits 拡張を組み込んだ pi をそのまま起動できる。

## Requirements

### Requirement: コンパイル済み spirits の起動
システムは、ビルド時に生成された `spirits` 実行ファイルの起動時に、spirits 拡張を利用者による追加指定なしで既定ロードしなければならない。(SHALL)
システムは、自己更新として処理する `update` の実行を除き、`spirits` に渡された CLI 引数をそのまま pi の CLI 解釈へ渡さなければならない。(SHALL)
起動したセッションでは、モデルから `tsrepl` を他のツールと同じ経路で呼び出せなければならない。(SHALL)

#### Scenario: 引数なし起動
- **WHEN** コンパイル済み `spirits` を引数なしで起動する
- **THEN** pi の通常の起動が始まり、セッションで `tsrepl` が有効なツールとして登録されている

#### Scenario: CLI 引数の透過
- **WHEN** `spirits --help` を実行する
- **THEN** pi CLI のヘルプが表示され、終了コード 0 で終わる

#### Scenario: 追加拡張の指定
- **WHEN** ツールを登録する拡張を指定して `spirits -e <拡張パス>` を実行する
- **THEN** 組み込み spirits 拡張のツールに加えて、指定した拡張が登録するツールもセッションで利用可能になる

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

### Requirement: チェックサム検証
インストーラは、ダウンロードした実行ファイルと `.sha256` を一時ディレクトリで `sha256sum -c` により検証しなければならない。(SHALL)
検証に失敗した場合、一時ファイルを削除して非ゼロで終了し、`~/.spirits/bin/spirits` を作成・変更してはならない。(MUST)
検証に成功した場合に限り、配置処理へ進まなければならない。(SHALL)

#### Scenario: 検証失敗時に配置しない
- **WHEN** ダウンロードした実行ファイルを改変し、`.sha256` と一致しない状態でインストーラを実行する
- **THEN** 終了コードは非ゼロになり、`~/.spirits/bin/spirits` は作成されず、既存ファイルがあれば元の内容のまま残る

#### Scenario: 検証成功
- **WHEN** 実行ファイルと `.sha256` が一致する状態でインストーラを実行する
- **THEN** 配置処理が実行される

### Requirement: 配置と冪等性
インストーラは、検証済みの実行ファイルを `~/.spirits/bin/spirits` に配置し、実行ビットを付与しなければならない。(SHALL)
配置先ディレクトリが無い場合は作成しなければならない。(SHALL)
`VERSION` を指定しない実行では、インストール済みの実行ファイルの `--version` 出力の先頭行 `spirits <version>` から取り出したバージョンが、最新として解決されたバージョンと等しい場合、ダウンロードと配置を行わず、インストール済みバージョンが最新である旨を表示しなければならない。(SHALL)
インストール済みの実行ファイルが無い場合、その `--version` が非ゼロで終了した場合、または出力からバージョンを取り出せない場合、インストーラはダウンロードと配置へ進まなければならない。(SHALL)
`VERSION` を指定した実行、および異なるバージョンが解決された実行では、既存ファイルを上書きして同じ結果にならなければならない。インストール済みバージョンが解決されたバージョンより新しい場合(prerelease ビルドなど)も上書きする。この点で、置換しない `spirits update` とは挙動が異なる。(SHALL)
配置の途中のどの時点でも、`~/.spirits/bin/spirits` は元の実行ファイル全体か、検証済みの新しい実行ファイル全体のいずれかでなければならない。(SHALL)
インストーラは、失敗した場合、および SIGINT または SIGTERM を受けて中断した場合、自身が作成した一時ファイルを削除しなければならない。(SHALL)
インストーラは、開始時に、配置先ディレクトリに残っている過去のインストーラまたは自己更新の一時ファイルを削除しなければならない。ただし、実行中の別のインストーラまたは自己更新が使用している一時ファイルは削除してはならない。(SHALL)
配置には root 権限を要求してはならない。(SHALL)

#### Scenario: 初回配置
- **WHEN** `~/.spirits/bin` が無い状態でインストーラを実行する
- **THEN** ディレクトリが作成され、`~/.spirits/bin/spirits` が実行可能ファイルとして存在する

#### Scenario: 再実行
- **WHEN** `VERSION` を指定せず、インストール済みと同じバージョンが最新として解決される状態でインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は変更されず、インストール済みバージョンが最新である旨が表示される

#### Scenario: VERSION 明示での再配置
- **WHEN** 0.1.0 がインストール済みの環境で `VERSION=0.1.0` を指定してインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.1.0 の実行ファイルで置き換えられる

#### Scenario: 別バージョンへの再実行
- **WHEN** `VERSION=0.1.0` でインストール済みの環境で `VERSION=0.2.0` のインストーラを実行する
- **THEN** 処理は成功し、`~/.spirits/bin/spirits` の内容は 0.2.0 の実行ファイルに置き換わり、実行可能のままになる

#### Scenario: 新しい prerelease からの置換
- **WHEN** 0.4.0-rc.1 がインストール済みで最新 stable が 0.3.0 の環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は 0.3.0 の実行ファイルで置き換えられる

#### Scenario: バージョンを判定できない場合の配置
- **WHEN** インストール済みの `~/.spirits/bin/spirits --version` が非ゼロで終了する環境で、`VERSION` を指定せずにインストーラを実行する
- **THEN** 成果物がダウンロードされ、`~/.spirits/bin/spirits` は最新版の実行ファイルで置き換えられる

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
インストーラは、`--uninstall` 指定時に、配置済みの `~/.spirits/bin/spirits` とデータディレクトリ `~/.spirits/agent/` を削除するためのコマンドを標準出力へ案内しなければならない。(SHALL)
`--uninstall` 指定時、インストーラはファイルとディレクトリを変更してはならず、shell rc を編集してはならない。(MUST)
`--uninstall` 指定時、インストーラはネットワークアクセスを行わず、`curl` / `sha256sum` を要求してはならない。(SHALL)
`--uninstall` は、対象が存在しない場合も終了コード 0 で終わらなければならない。(SHALL)

#### Scenario: 削除案内の出力
- **WHEN** `--uninstall` を指定してインストーラを実行する
- **THEN** `~/.spirits/bin/spirits` と `~/.spirits/agent/` を削除するコマンドが出力され、終了コードは 0 になり、インストール済みファイルとデータディレクトリは変更されない

#### Scenario: 未インストールでの案内
- **WHEN** `spirits` が配置されていない環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

#### Scenario: 依存コマンドなしでの案内
- **WHEN** `PATH` 上に `curl` も `sha256sum` も無い Linux x86_64 環境で `--uninstall` を実行する
- **THEN** 案内が表示され、終了コードは 0 になる

### Requirement: 外部拡張のロード
コンパイル済み `spirits` は、`~/.spirits/agent/extensions/` に配置された外部 TypeScript 拡張を、組み込み spirits 拡張と合わせてロードしなければならない。(SHALL)
外部拡張からバンドル済みの pi パッケージを import できなければならない。(SHALL)
外部拡張が独自の node_modules 依存を要求し、それが実行ファイル内に存在しない場合、spirits はその拡張のロード失敗を拡張パスを含むエラーとして stderr に報告し、非ゼロの終了コードで終了しなければならない。(SHALL)
`--help` のようにセッションを開始しないコマンドが指定された場合は、外部拡張のロード失敗があっても help の出力を優先し、終了コード 0 で終了しなければならない。(SHALL)
実行ファイルがパッケージマネージャを内包しないため拡張の依存解決には別途 Bun が必要である旨を、README に記載しなければならない。(SHALL)

#### Scenario: 外部拡張のロード
- **WHEN** `~/.spirits/agent/extensions/` にツールを登録する外部拡張を配置して `spirits` を起動する
- **THEN** そのツールがセッションで利用可能になる

#### Scenario: バンドル済み pi パッケージの import
- **WHEN** 外部拡張が `@earendil-works/pi-coding-agent` を import する
- **THEN** import は実行ファイルにバンドルされた pi パッケージへ解決される

#### Scenario: 依存不足の拡張
- **WHEN** 外部拡張が実行ファイルに存在しないベア指定子のパッケージを import する
- **THEN** セッションは起動せず、ロード失敗がその拡張のパスを含むエラーとして stderr に報告され、終了コードは非ゼロになる

#### Scenario: セッションを開始しないコマンドの優先
- **WHEN** 依存不足の外部拡張が存在する状態で `spirits --help` を実行する
- **THEN** help が表示され、ロード失敗のエラーは表示されず、終了コードは 0 になる

#### Scenario: README の案内
- **WHEN** `packages/spirits/README.md` を確認する
- **THEN** 外部拡張の依存解決には別途 Bun が必要である旨が記載されている

### Requirement: リリース成果物
リポジトリは `spirits-v*` 形式のタグ push を契機に、ubuntu ランナーと固定した Bun(1.4.2 以上)で依存導入・テスト・ビルドを実行し、`spirits-linux-x64` と `spirits-linux-x64.sha256` を GitHub Release に添付しなければならない。(SHALL)
リリースノートには、ビルドに使用した内包 Bun のバージョンを記載しなければならない。(SHALL)
タグのバージョン部に `-` を含む場合(例: `spirits-v0.3.0-rc.1`)、リリースは prerelease として公開しなければならない。(SHALL)
テストまたはビルドが失敗した場合、リリースを公開してはならない。(MUST)
`spirits-v*` 以外のタグ push と、タグ以外の手動起動は、このリリース処理を起動してはならない。(SHALL)

#### Scenario: タグ push によるリリース
- **WHEN** `spirits-v0.1.0` タグを push する
- **THEN** 専用の GitHub Release が作成され、`spirits-linux-x64` と `spirits-linux-x64.sha256` が添付され、リリースノートに内包 Bun のバージョンが含まれる

#### Scenario: prerelease の公開
- **WHEN** `spirits-v0.0.0-test` タグを push する
- **THEN** 作成される Release は prerelease として公開される

#### Scenario: 検証失敗時の非公開
- **WHEN** リリースビルドのテストが失敗する
- **THEN** 実行ファイルを含む Release は公開されない

#### Scenario: 既存 pi リリースとの分離
- **WHEN** `v1.0.0` のように `spirits-` で始まらないタグを push する
- **THEN** spirits のリリース処理は起動せず、既存の pi リリース処理だけが動作する

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
コンパイル用エントリは、「spirits 拡張を既定ロードして pi を起動する」責務と「自己更新として処理する `update` を自己更新へ振り分ける」責務だけを持ち、拡張内にどのツールが登録されているかを知ってはならない。(MUST)
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
