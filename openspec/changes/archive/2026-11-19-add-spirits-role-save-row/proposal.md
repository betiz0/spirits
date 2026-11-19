# Proposal: add-spirits-role-save-row

## Why

`/model` が変えるのはセッションのモデル選択だけで、`/spirits-role` が保存するのは `models.*` の設定キーだけなので、**設定ファイルがセッションの現状を語らない**状態が普通になる。実測 (`~/.spirits/managed-pi/current/pi` 1.5.0、隔離 agent dir) では、`/model` でモデルを選んでも `settings.json` は一切書き換わらず (mtime も内容も不変)、`models.role` を strong に保存したセッションでも、新しいセッションは `defaultProvider`/`defaultModel` の物理モデルで始まるため振り分けが働かず「strong にならない」に見える。Pi の `/model` の既定保存はモデルのための操作で、ロックとモデルをまとめて保存する手段が `/spirits-role` にない。

ロールを決めた利用者は、設定一覧を再度閉じる操作をせず、そのロールと現在の選択を保存して会話に戻りたい。

## What Changes

**BREAKING（操作・出力）:** 一覧の先頭行が変わり、保存成功・差分なしでは一覧が閉じる。引数なしの print は稼働状況を表示しない。

- `/spirits-role` の一覧の**最上位に `use normal` と `use strong` の操作行**を追加し、その下に **`save` の行**、直後に**空行の区切り**を置く。既存のロックの行・ロールの行・ステップの行はその後ろに並ぶ。既存の `role lock` の行は残す。
- `use normal` / `use strong` の行で Enter を押すと、**そのロールをセッションにロックし、続けて `save` と同じ保存を行い、一覧を閉じる**。ロックは `/spirits-role <role>` と同じ書き込み(記録の追記、`models.role`、badge)で、新しいコマンド語彙は増やさない。保存に差分が無いときも閉じる。ロックまたは保存に失敗したときは閉じず、その行に理由を出す。ロックだけが成立して保存が失敗した場合も閉じない。
- `save` の行で Enter を押すと、**セッションの現在の選択状況を Pi の global settings に書き込む**:
  - `models.role` ← セッションの現在のロック
  - `defaultProvider` / `defaultModel` ← そのセッションが実際に選んでいるモデル
- `save` は書き込みが成立したとき、および差分が無いときに一覧を閉じ、書き込みに失敗したときは閉じずに行に理由を出す。一覧の結果とモデルを見送った理由は元の TUI 画面の通知で確認できる。RPC は一覧を開かず、コマンドごとに結果を通知する。
- `spirits/auto` を既定に書くのは、**書き込み後の global settings と global の資格情報・カタログだけで、新規セッションの normal が解決できるときに限る**。旧既定、セッション履歴、project だけの設定、現在のセッションのカタログにだけあるモデル、project の拡張が登録した provider は根拠にしない。判別できないときはモデルのキーを書かず、理由を伝える。`models.normal` は補完・変更しない。資格情報の由来(global の保存か、このプロセスだけの環境変数か)はホストが公開していないため区別せず、環境変数だけで成立する保存は限定互換として design に記録する。
- 保存の対象は上記3キーのみ。Pi のスコープ、明示的なモデル指定、信頼済み project の上書きはそのまま尊重する。次回起動時に保存した選択が使われるのは、それらが妨げない場合に限る。`models.strong` を provider なしで書いている場合、既定 provider が `spirits` に変わると strong が解決できなくなるため、strong も `provider/id` で書くよう文書に記す。
- `save` は一覧固有の操作にしない(既存の「一覧でできる操作はすべてコマンドの文法でもできる」に従い) `/spirits-role save` を受け付け、補完語彙と共通の使用法にも加える。
- `save` は **global ファイルの現在値**と比較する。比較は Pi がファイルから読む生の値で行い、前後の空白を除いた値で同一とみなさない。行の説明は保存予定を示し、成立の結果と見送り理由は通知で伝える。通常の設定行と `status` は実効値を示す。差分がなければ書かない。
- 設定ファイルが存在しないときも、同じパスのファイルロックを先に取得し、ロック下で読んでから、書き込む内容があるときだけ作成する。ロックを取得できなければファイルを作らず、失敗として通知する。
- `save` と `use normal` / `use strong` は **Enter が確定キーのとき、その Enter だけ**で作動し、候補を開かない。Space とクリックは保存しない。確定キーを変更している場合はコマンドを使える。区行は選択できるが設定操作を行わず、既存の候補と Esc の挙動は維持する。
- 操作行の結果と理由は一覧の行、または TUI・RPC のコマンド通知で伝える。一覧を閉じる操作行は、閉じる前か直後に結果を通知する。通知の種別は結果に対応し、書き込みの成立と変更なしをエラーとして通知しない。モデル未選択のセッションを物理モデルの選択として扱わない。print でも保存するが通知は出さず、結果は global ファイルで確認する。`status` に保存履歴は増やさない。
- `save` は**再読み込みを行わない**。保存するのは次に始まるセッションの既定で、再読み込みは現在のセッションのロックやステップを project の既定へ戻し得るうえ、応答中はホストが拒否するためである。通常の設定変更は従来どおり、コマンドでは書き込み後に、一覧では閉じるときに一括で1回再読み込みする。`use` の行はロックを書く通常の設定変更として扱い、閉じるときに1回再読み込みする。`save` だけが成立した一覧は閉じても再読み込みしない。
- 一覧を閉じずに残る失敗の理由は、その後の再描画が失敗しても失わない。成立した保存の結果は通知で伝え、通常行の読取り失敗だけを `not redrawn` として示す。
- 一覧の `normal` のモデルの行は、`models.normal` が読めない場合でも、その診断と実際に応答するモデルの両方を示す。診断だけで応答モデルを隠さない。
- print の引数なし `/spirits-role` は一覧も稼働状況も出力しない。RPC は一覧を開かず稼働状況を通知する。

## Capabilities

### New Capabilities

(なし)

### Modified Capabilities

- `managed-commands` — `/spirits-role` の一覧の行の一覧に `use normal`、`use strong`、`save` とその区切りが増える。セッションのロックと選択モデルを global settings にまとめて書き込む操作が増え、その操作行は成功で一覧を閉じる。書き込める値の安全条件(normal の対象を global の設定と資格情報だけで解決できること)と、生の値の比較、ファイル作成のロック、失敗時の扱い、`save` が再読み込みしないこと、`use` の行が閉じるときに再読み込みすること、通知の種別、コマンド文法と補完への追加が要件になる。

## Impact

- コード: `packages/spirits/src/commands/{role-panel,register,role,role-write,settings-store}.ts`（一覧・操作行の配線と閉じる判定、コマンド文法、共通の保存処理、global 設定の読取りと既存ロック下の条件付き更新、ロック下のファイル作成）、`packages/spirits/src/constants.ts`（`save` の語と一覧の行 ID）。normal の判定には既存の routing resolver を使い、ルーティングの規則は変えない。global の利用可否を判別するホスト API が無い場合は、安全側でモデルを保存しない限定互換として記録する。
- テスト: `packages/spirits/test/{managed-role-panel,managed-commands,managed-role-command,managed-role-completion,managed-role-status,managed-role-warning,constants-steps}.test.ts`。実機確認には固定版 Pi と隔離フィクスチャを使い、保存前後のセッション状態、RPC 通知と print の無出力、外部更新後のディスク、別 project での起動を確認する。
- 文書: `README.md`、`README.ja.md`、`README.zh.md`、`README.de-CH.md`、`docs/spirits-managed-pi.md`、`docs/spirits-managed-pi-design.md`。一覧の操作行(`use normal` / `use strong` / `save`)が成功で閉じ、一覧の結果は TUI 通知で確認できること、失敗では開いたままで理由を出すこと、TUI・RPC は通知し print は出力しないこと、`save` は再読み込みしないこと、`use` の行は閉じるときに再読み込みすること、strong も `provider/id` で書くことを追記する。互換マトリクスの目的行は増やさない。
- ホストの公開面への依存: `@earendil-works/pi-coding-agent` の `ExtensionCommandContext`（モデル、モード、UI、再読み込み）、`ExtensionAPI.getSettings()`（実効値）、`getAgentDir()`、モデルレジストリの `getRegisteredProviderIds()`（取得不能ならモデルの既定保存を見送る）、`@earendil-works/pi-tui` の `Component`、`SettingsList`、`SettingItem`、`Key`、`matchesKey()`。**ホストのソースへの差分は0件のまま**。
- 固定値・配布物への影響: 既存の設定キーを再利用し、新しい語彙は `save` と一覧の行 ID。manifest、チェックサム、配布スクリプトは変えない。
- 設定ファイルの所有権: Pi の `Ctrl+S` とモデルの保存先2キーを共有するが、スコープ更新などの副作用は共有しない。Pi 由来のキーとロール・ステップの対象設定は保持する。
- 先行 change `improve-spirits-role-routing-visibility` はアーカイブ・仕様同期済み。その一覧・badge・復帰の契約を維持する。
