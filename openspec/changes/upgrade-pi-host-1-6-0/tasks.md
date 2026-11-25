# Tasks

## 1. 対象版の選定と型の pin

- [x] 1.1 対象版 1.6.0 の選定根拠を実測して記録する: 公式リリースの公開日時、`pi-linux-x64.tar.gz` のサイズ 58,977,130 と SHA256 `ef77dbe4379b3bdeb425a1e1b862fa3c915c255000dfe4965c98eee96a5765d1` がリリースの `SHA256SUMS` に並んでいること、`@earendil-works/pi-coding-agent@1.6.0` と `@earendil-works/pi-tui@1.6.0` の両方が公開済みで `bunfig.toml` の `[install] minimumReleaseAge = 172800` を過ぎている判定。完了確認: 4 値 (公開日時、検証ファイルの SHA256、両型パッケージの公開日時、門の判定) が揃い門が真。対象版は 1.6.0 で固定し、新しい stable が出ても本変更の対象は動かさない (design D1)。
- [x] 1.2 `packages/spirits/package.json` の devDependencies `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` を `1.6.0` に完全一致で更新し、ライフサイクルスクリプトを実行せずに導入する (`bun install --save-exact --ignore-scripts`)。完了確認: 一時の probe が `@earendil-works/pi-coding-agent` と `@earendil-works/pi-tui` の両方について `node_modules/.bun/@earendil-works+pi-*@1.6.0...` 配下へ解決し、リポジトリ内のソースへ解決しない (確認後に probe を削除)。
- [x] 1.3 `cd packages/spirits && bun run check` を 1.6.0 の型で通す。完了確認: 型エラー 0 件。型の差分は src と test の実型へ反映し、assertion を緩めたり `unknown` に潰したりしない。通せなければここで中止して 1.2 を戻す。

## 2. ホストの描画契約を実型に結ぶ

- [x] 2.1 `packages/spirits/src/branding/header.ts` の手写しの `HeaderComponent` をなくし、`src/types/host.ts` が `@earendil-works/pi-tui` から導いている `Component` を実装する形に寄せる (`HeaderTheme` と `BrandingContext` は意図的な最小 seam として残す)。完了確認: `cd packages/spirits && bun run check` が 0 件、`rg -n "interface HeaderComponent" packages/spirits/src` が 0 件。
- [x] 2.2 起動ヘッダ・TODO パネル・`/spirits-role` の一覧の component が host 由来の `Component` に代入可能である型の検査を test に加える。完了確認: `cd packages/spirits && bun test test/branding-header.test.ts test/todo-widget.test.ts test/managed-role-panel.test.ts` が成功する。
- [x] 2.3 host 由来の型で受け取った `render()` の返り値を in-place で書き換えるケースを test に置き、`tsc` が失敗すること永続で検証する (design D2。`string[]` の代入可能性だけでは 1.5.0 でも 1.6.0 でも通るため、調べる方向は逆)。完了確認: `cd packages/spirits && bun run check` が 0 件の状態で、返り値への書き込みを意図的に許可する型へ一時的に戻すと型エラーが出ることを確認し、戻したうえで 0 件に戻す。用例は test に残す。
- [x] 2.4 `packages/spirits/src` 全体で、host に渡す component の返り値を in-place で書き換えている箇所が無いことを確認する。完了確認: `rg -n "render\([^)]*\)\s*\.(push|splice|sort|reverse)\(" packages/spirits/src` が 0 件、`src/commands/role-panel.ts` と `src/todo/widget.ts` が毎回新しい配列を返していることを read で確認。

- [x] 2.5 代入可能性の用例が cast に依存していないことを強める: `test/managed-role-panel.test.ts` の component を受け取る用例で、一覧 screen を callback の時点で host 由来の `Component` 型として受け (`as` を入れず)、捕捉されなかった場合は型ではなく実行時にも失敗させる。完了確認: `cd packages/spirits && bun run check` が 0 件、`bun test test/managed-role-panel.test.ts` が成功し、用例から cast を除いても型エラーが出ない。
  記録 (2026-11-25): `test/managed-role-panel.test.ts` の用例を `driveScreen((list: Component) => void screens.push(list))` の形へ変更 (callback の仮引数と収集先の両方が host 由来の `Component`、`as` なし)。未捕捉は `if (!component) throw new Error("the command handed no component to ctx.ui.custom()")` で実行時に落ちる。`bun run check` は 0 件、`bun test test/managed-role-panel.test.ts test/branding-header.test.ts test/todo-widget.test.ts` は 122 pass / 0 fail。

## 3. 公式配布物の取得と固定値の更新

- [x] 3.1 公式 `pi-linux-x64.tar.gz` (1.6.0) を公式リリースから取得し、リリースの `SHA256SUMS` と照合する。完了確認: 取得したファイルの SHA256 が `SHA256SUMS` の値と 1.1 の値に一致し、展開した `package.json` の `version` が `1.6.0`。
- [x] 3.2 `packages/spirits/src/constants.ts` の `PINNED_PI` の `version` を `1.6.0`、`artifactSha256` を 3.1 で照合した値へ更新する (`artifactName` は `pi-linux-x64.tar.gz` のまま)。完了確認: `rg -n 'version: "1.6.0"' packages/spirits/src/constants.ts` が 1 件。
- [x] 3.3 3.1 の照合済み tarball を入力に `packages/spirits/src/managed-pi/overlay.ts` で overlay を生成し、生成物のダイジェストを実測して `overlayVersion` を `1.6.0-spirits.1`、`overlaySha256` を実測値へ更新する (design D6。生成前に pin を確定させない)。完了確認: 実測値が `PINNED_PI.overlaySha256` と一致し、`cd packages/spirits && bun test test/managed-pi-overlay.test.ts test/managed-pi-host.test.ts` が成功する。
- [x] 3.4 版のリテラルを持つテストを design D5 の方針で追従させる: 独立した期待値 (実体から写した版と SHA256) はリテラルとして更新し残す、`PINNED_PI` への伝播を検査する既存ケースは据え置く、fixture が自分で決める版 (`"9.9.9"` など) とアーキテクチャ検査の fixture の版は変更しない。完了確認: `cd packages/spirits && bun test test/managed-pi-manifest.test.ts test/managed-pi-release-assets.test.ts test/managed-pi-repair.test.ts test/managed-pi-cli.test.ts test/managed-pi-compat-env.test.ts test/managed-pi-compat-host-version.test.ts test/managed-pi-compat-data.test.ts test/managed-pi-compat-runner.test.ts test/managed-pi-integration.test.ts test/update-routing.test.ts` が成功し、`rg -n '"1.5.0"' packages/spirits/test` が fixture の独立期待値として更新された値 (1.6.0) か歴史的観測だけになる。
- [x] 3.5 アーキテクチャ検査の fixture (`test/fixtures/architecture/**/node_modules/@earendil-works/*/package.json`) の版リテラルが検査の証拠でないことを確認したと記録する (`test/architecture/resolve.ts` は fixture の `version` を判定に使わない)。完了確認: `cd packages/spirits && bun test test/architecture-conventions.test.ts` が成功し、据え置いた判断をこのタスクの行に記録する。
  記録 (2026-11-25): `test/architecture/resolve.ts` は `version` という語を一度も読まない (grep 0 件)ため、`test/fixtures/architecture/**/node_modules/@earendil-works/*/package.json` の `"version": "1.5.0"` は検査の証拠ではない。据え置いた。据え置いた結果、`rg -n '"1.5.0"' packages/spirits/test` には当該 fixture の行だけが残る (テストコード側の独立期待値はすべて 1.6.0 に更新済み)。検査は成功 (`6 pass / 0 fail`)。
- [x] 3.6 版を名指しするコメント (`src/managed-pi/manifest.ts` の固定 set の注記、`src/commands/role-panel.ts` の `@earendil-works/pi-tui@1.5.0` の観測注記) を 1.6.0 の実測に合わせて更新し、1.5.0 でしか観測していないものはその旨を残す。完了確認: `rg -n "1\.5\.0" packages/spirits/src` が歴史的観測として明示した箇所だけ残る。

## 4. bundle、manifest、公式モードの互換性実測 (一次)

- [x] 4.1 `bun scripts/build-managed-pi-inputs.ts --version <検証用の spirits 版> --out dist` で拡張 bundle と manifest を生成し、`pi.version` / `pi.artifact.sha256` / `overlay.version` / `overlay.sha256` が `PINNED_PI` と一致することを確認する (リリースは発行しないので版番号は検証用を使う)。完了確認: `dist/spirits-managed-pi-extension.js` と `dist/spirits-managed-pi-manifest.json` (+ `.sha256`) が存在し、4 つの値が一致する。
- [x] 4.2 3.1 の tarball を互換性ランナーの `--artifact-root` に置き、作業ツリーの bundle で公式モードを完走させる (一次、design D9)。完了確認: `bun scripts/managed-pi-compat/run.ts --inputs dist --artifact-root <dir> --commit HEAD --out /tmp/compat/primary/result.json` の結果の `Compatibility met` が真、`failed` が 0 件、`not-run` が成功として扱われていないこと、artifact / bundle / manifest / overlay の版と SHA と host のランタイム版が記録されていること。失敗した場合は 3 に戻して pin を棄てる。
- [x] 4.3 一次の実測から、手順書の 1.5.0 の記録と食い違う点を洗い出す。完了確認: ランタイム版と観測の内訳 (`confirmed` / `failed` / `not-run`) を 4.2 の結果 JSON から写し、導入後の一式の容量と導入時間は隔離した製品インストールで実測して測定範囲と単位とともに記録し、食い違い一覧 (無ければ無し) をこのタスクの行に結果 JSON のパスとともに書く。
  記録 (2026-11-25): 結果 JSON は `/tmp/compat/primary/result.json` (公式モード、ランタイム版 1.6.0、`confirmed` 38 / `failed` 0 / `not-run` 3、`Compatibility met` 真。未実行の 3 件は `registerModelRoles` 依存で 1.6.0 でも不変)。導入後の一式は 182 MB、導入時間 2,202 ms (隔離 HOME、loopback 配信、展開～`current` 切り替えまで)。手順書の 1.5.0 記録との食い違い: tarball サイズ 58,876,253 → 58,977,130 B、ランタイム版、導入後の容量と導入時間、`--models` 無一致警告の挙動 (起動時 1 回のみ、session 置換後に再掲なし)。

## 5. 起動役のビルドと tmux 対話検証

- [x] 5.1 `bun scripts/build-binaries.ts --version <検証用の spirits 版>` で起動役をビルドする。完了確認: `dist/spirits-linux-x64` が生成され、`--version` が spirits の検証用版を返す。
- [x] 5.2 design D10 の前提 (対象版の一式を隔離 agent root に据える、継承した agent dir / session dir 指定を子の環境から除く、ネットワークを要求しない provider を実際の agent dir の `models.json` に用意する、`~/.tmux.conf` に `extended-keys on` と `extended-keys-format csi-u` を書く。実 HOME と実 `~/.spirits` は触らない) を揃えて `scripts/tmux-verify.sh run --session host160 -- dist/spirits-linux-x64` を起動し、`session=` が出たら `tmux resize-window -t "=<セッション名>" -x 200 -y 60` する。完了確認: 起動 art と `spirits v<検証用版>` が画面に残り、`spirits -- --version` が `1.6.0` を返す (一式が対象版であることの確認)。
- [x] 5.3 同じ pane で `/spirits-clear` を打ち、clear 前の会話内容が後続の応答に効かないことと、`tsrepl` が実際に呼ばれてセルの値が画面に返ることを確認する。完了確認: 画面にセルの値が映り、clear 後の応答が clear 前の文脈を参照していない。
- [x] 5.4 同じ pane で `/spirits-role` の一覧を開いて role lock を変え、一覧の行順と status 行の badge と status line が操作に追従することを確認する。完了確認: 変更前後の badge の値が画面で変わり、`check` には依存しない (まだ pane を終わらせない)。
- [x] 5.5 同じ pane で `manage_todos` から TODO を追加し、折りたたみキー (既定 `ctrl+alt+p`) が効くことを確認する。完了確認: 展開表示と折りたたまれた集約行の両方が同じ pane の画面に現れる。
- [x] 5.6 5.7 で pane を終えたあと、モデル選択の 2 通りを**別 run として**起動して確認する。(a) `spirits/auto` を既定にした起動では警告が出ないこと、(b) 一致しないモデル指定 (`--models` の無一致パターン) を伴う起動では警告が起動時に 1 回だけ出ること、(c) その session で `/new` などの置き換えをしても同じ警告が再掲されないこと。完了確認: 3 点の観測を画面から手順書の記録へ写す。
- [x] 5.7 5.2〜5.5 の観測を同じ pane で終えたら host の終了コマンド `/quit` (効かなければ `C-d`) でセッションを終わらせ、`run` の回収を待ってから**同じ隔離した状態置き場**で `scripts/tmux-verify.sh check --session <session>` を実行する。5.6 の各 run も同じ手順で回収する。完了確認: 全ての `run` が 0 で終わり、`check --session <session>` が `clean` (終了コード 0)。検証が使うポートを `run --port` で予約し、そのポートの非 listen を回収の証拠として残す (`--port` を渡していない `check` の `clean` をポートの証拠にしない)。`check` は残留の判定であり画面内容の合否ではないことを手順書の記録に添える。
  記録 (2026-11-25): 未完了として reopened。pane `host160-ae5d2a10` で 5.2〜5.5 の観測を終え `/quit` → `run-exit=0` → `check` が `clean` までと、5.6 の 3 点 (正常起動に警告なし / 無一致は起動時 1 回 / `/new` 後に再掲なし) は実測済み。ただし (a) 当時の手順は `/exit` を先さに置いていた (1.6.0 では model への prompt として送信されセッションが残る)、(b) ポートを予約していない `check` の `clean` を回収の証拠にしていた。手順とコマンドを直したうえで回収を確認し直す (design D10)。
  記録 (2026-11-25、回収の再実測): `SPIRITS_VERIFY_STATE_DIR=<iso>/verify-state` に固定して `run --session collect --port 8931` で起動役を対話起動 (ヘッダの `spirits v` を画面確認) → `/quit` → `run` 終了コード 0 → `check --session collect-0773b711` が `clean` (終了コード 0)。予約ポート 8931 は `ss -ltn sport = :8931` が起動中・回収後とも該当行 0 件。検査の歯も実測: `--port 8933` のセッションで listener を生かしたまま `check --session` を実行すると `residue session=… kind=port id=8933 reason=listen` (終了コード 1)、listener を kill すると `clean` (終了コード 0)。手順書 7 の実行手順と「実測の記録」に写した。

## 6. 起動役が予約する語の照合

- [x] 6.1 5.1 でビルドした起動役が使う一式の host 実行ファイルの `--help` が並べるコマンド語の一覧を記録し、起動役が先に分類する語 (`update`) を除いた集合と `OFFICIAL_PI_HOST.commandWords` を突き合わせ、追加漏れと削除漏れを分けて判定する (design D3)。完了確認: 一覧・除いた語・追加漏れ・削除漏れの 4 項目が手順書の 7b 相当の節に並び、`packages/spirits/src/managed-pi/host.ts` の語表が追加漏れ 0 件・削除漏れ 0 件になっている。
- [x] 6.2 語表を変えた場合は起動役を再ビルドし (5.1 からやり直し)、各語について `spirits <word>` が拒否されることと `<host> <word>` がコマンドとして動くことを両方実測する。判定が難しい語は host の usage 行と `spirits <word>` の実測 (拒否か model prompt か) を根拠として手順書の記録に書く。完了確認: 語ごとの実測結果が手順書の節に並び、不一致が 0 件 (不一致があれば 5 へ戻る)。
  記録 (2026-11-25): 語表は変えていない (追加漏れ 0 件・削除漏れ 0 件) ので再ビルドは不要。その上で 7 語すべてについて `spirits <word>` の拒否と `<host> <word>` の command dispatch を実測し、手順書 7b の語ごとの表に並べた (不一致 0 件)。
- [x] 6.3 語表の変更に対応するテストを更新する。完了確認: `cd packages/spirits && bun test test/managed-pi-host.test.ts test/update-routing.test.ts` が成功する (`test/managed-pi-cli.test.ts` は語表を検査しない)。語表から語を除いた場合は、その語が拒否から model への入力へ動く利用者に見える変化として手順書の記録に書く。

## 7. 自己更新経路の検証 (利用者に実行を依頼する)

- [ ] 7.1 直前のリリース `spirits-v0.8.2` の実行ファイルから検証用配信元 (`SPIRITS_API_BASE_URL` / `SPIRITS_RELEASE_BASE_URL`) で `spirits update` を実行し、新しい起動役へ置換され、同じリリースの manifest と bundle が managed root に導入されることを確認する。`scripts/self-update-smoke.sh` は検証用配信元に `python3 -m http.server` を使い、本セッションは python3 を実行できないため、実行コマンド・必要な成果物・期待する出力を揃えて利用者に実行を依頼し、結果の受領まで未実行として記録する (design D7)。検証用版は 0.8.2 より大きく、起動役・bundle・manifest が組で揃ったものを使う。完了確認: `sh scripts/self-update-smoke.sh <old-bin> <new-bin> <ver> [manifest] [bundle]` の終了コード 0 の記録 (実行した環境を含む) を手順書に写す。smoke は導入済み一式の配置と bundle の一致、launch の終了値までは見るが、ホストのランタイム版の文字列を比較しないため、終了コード 0 に加えて自己更新後の `spirits managed-pi -- --version` が `1.6.0` である実出力を別に記録する。
  記録 (2026-11-25): **未実行**。本セッションは python3 と GitHub への network を使う smoke を走らせていない。利用者の実行コマンド (リポジトリルート、`python3` と network のある環境):

  ```sh
  # 必要な成果物: dist/spirits-linux-x64、dist/spirits-managed-pi-extension.js、
  #               dist/spirits-managed-pi-manifest.json (いずれも版 0.8.99 で再生成済み)
  # 直前のリリースの実行ファイル (旧版側) を取得する
  gh release download spirits-v0.8.2 --repo betiz0/spirits --pattern 'spirits-linux-x64' --dir /tmp/smoke-old
  sh scripts/self-update-smoke.sh /tmp/smoke-old/spirits-linux-x64 dist/spirits-linux-x64 0.8.99 \
    dist/spirits-managed-pi-manifest.json dist/spirits-managed-pi-extension.js
  ```

  期待する出力: 旧実行ファイルが 0.8.99 へ自己更新して `--version` がそれを返し、`spirits managed-pi -- --version` が `1.6.0` を返し (一式の導入と launch 時検証の成功)、一時ディレクトリが残らず、終了コード 0。受け取ったら手順書の「実測の記録」に終了コードと実行環境を書く。

## 8. 全体の検査と手元のテスト

- [x] 8.1 ルートで `bun run check` をフル出力で実行する。完了確認: biome、`tsc -p tsconfig.scripts.json`、`packages/spirits` の型検査がすべて 0 件 (書き換えが必要なら `bun run fix`)。
- [x] 8.2 `cd packages/spirits && bun test` を通し、続けてリポジトリルートに戻って `bash scripts/test-clean-env.sh` で CI と同じ環境 (`PI_*` / `SPIRITS_*` を持たない) で再実行する。完了確認: 失敗 0 件。`test-clean-env.sh` が呼ぶインストーラのテストと呼び出し検証のテストは `python3 -m http.server` を要求するため、本セッションでは走らない部分を未実行として列挙し、成功として数えない (design D7)。
  記録 (2026-11-25): `bun run check` は 3 検査すべて 0 件。`cd packages/spirits && bun test` は失敗 0 件。`bash scripts/test-clean-env.sh` は check / test / install / tmux-verify の 4 suite が完走し、`all suites passed with no spirits or pi variables in the environment` (test 1461 pass / 0 fail、install 97 assertions、tmux-verify 125 assertions)。この実行環境には `python3` が在るため、`python3 -m http.server` を要求する install / tmux-verify の suite もスキップされずに走った (`/usr/bin/python3`)。python3 の無い環境ではこの 2 suite が走らないため、そちらでは未実行として扱う。
- [x] 8.3 `bun.lock` の移動が本次元で意図した移動だけであることを確認する。完了確認: `git diff HEAD -- bun.lock` で移動した package エントリを一覧し、host pin (`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、推移的な `@earendil-works/pi-ai`、`typebox`) と 1.2 の付随移動、design D8 に記録した差分 (`grok-mermaid` の除去、`lovely-mermaid@0.3.3` の追加、`undici`、`openai`、`@google/genai`) 以外が無いこと。コミット時の門 `PI_ALLOW_LOCKFILE_CHANGE=1` はユーザーが依頼したコミットでだけ付ける。

## 9. 手順書と文書の更新

- [x] 9.1 `docs/spirits-host-upgrade.md` の手順そのものを再実行可能な形に更新する: 対象版の選定 (門の条件と記録する値)、公式配布物の取得と `SHA256SUMS` 照合を overlay SHA256 の実測より前に置く順序、互換性実測の一次 / 正式の 2 段構え、失敗時の中止の範囲。次に挙げる再実行の欠陥を全て閉じる (design D12・D13)。(a) 型の導入を `bun install --save-exact --ignore-scripts` で書いているか (ライフサイクルスクリプトを実行させない)。(b) `overlaySha256` を「展開後のホストディレクトリの digest」ではなく「**生成された overlay `package.json` の本文の SHA256**」と定義し、その計測コマンド (照合済み tarball を loopback 配信して `overlay.ts` の実関数を呼ぶ一時スクリプト) を書いているか。(c) tmux 検証など作業ディレクトリを移す手順で、`scripts/tmux-verify.sh` を相対パスで呼んで起動しない箇所が無い (絶対パスまたは実行前に確定する変数)。(d) コマンド語の照合で語表を変えた場合の起動役再ビルド、および正式再測定 (手順 10) の起動役ビルドのコマンドが並んでいるか。完了確認: 手順を読むと各手順の実行コマンド・作業ディレクトリ・前提条件・完了確認が並び、1.5.0 前提の記述が残っていない。手順に存在しないコマンド・存在しない環境変数 (例: 実在しない `SPIRITS_NO_UPDATE_CHECK`) を書いていないこと、および中国語簡体字の字形 (「隔離」を簡体で書いた語など) が混ざっていないことを grep で確認する。
  記録 (2026-11-25): (a) 手順 2 を `bun install --save-exact --ignore-scripts` に修正。(b) 4b の `overlaySha256` の定義を「展開した `pi/package.json` から生成する overlay `package.json` の本文の SHA256」に訂正し、`tar -xzf` → `readAndCreateOverlay(<extracted>/pi)` → `sha256` 実測のコマンドを追記 (実測値 `e0c6b589a26f3438c5b9224294b769a999fabee3eba06383fafceb68be031cd0` はこの経路で得た値)。(c) 7 の実行手順を `<repo>`/`$iso`/`$state` の絶対パスに書き直し、相対 `scripts/tmux-verify.sh` を呼ぶ欠陥を除去。(d) 7b に語表変更時の bundle / 起動役再ビルドと利用者に見える変化の記録、10 に `bun scripts/build-binaries.ts` を追記。(e) 9 に旧版値の検索コマンド (0 件が合格) を追加。(f) 実在しない `SPIRITS_NO_UPDATE_CHECK` を削除 (`rg -n SPIRITS_NO_UPDATE_CHECK docs` は 0 件)。(g) 中国語簡体字 6 箇所を修正 (`rg -n "隔离|證據|失败" docs` は 0 件、README.zh.md は中国語文書として別)。
- [x] 9.2 `docs/spirits-host-upgrade.md` の実測の記録を 1.6.0 の結果に更新する (固定ホストの版、tarball のサイズと SHA256、導入後の容量と導入時間と測定範囲、公式モードの `confirmed` / `failed` / `not-run` の件数と結果 JSON のパス、`spirits -- --version` の値、コマンド語の照合結果、推移依存の差分と採用の撤回条件、`enabledModels` / `--models` の警告の新版の挙動、`find` のパスパターンと既定モデルの変化の利用者への影響)。完了確認: 「実測の記録」が 1.6.0 の値で並び、1.5.0 の値が混ざらない。互換性成功の判定は design D12 どおり `confirmed` 一本へ揃え、`limited` / `unavailable` / `not-run` を成功に数えないことと、本仕様への同期が archive 前に行われることを同じ節に記録する。
  記録 (2026-11-25): 「実測の記録」の判定の項を D12 の定義 (`COMPATIBILITY_MET_DEFINITION` を写し、`limited` も成功に数えない) に書き換え、matrix 行は 1 目的でも confirmed になるため 13 中 11 の観測を併記する旨を分けて書いた。tmux の項には回収の証拠 3 件 (`run --port` 付きの `clean`、listener を置いた `residue kind=port`、`--port` 無し / 記録空の `clean` は証拠にしない) を追記。Rollback の 2c に隔離 HOME の 3 ケース実測表を追加。
- [x] 9.3 手順書の tmux 検証の節に、実行手順 (一式の設置 → `run` → resize → 全観測 → pane を `/quit` で終了 → 回収 → `check --session <session>`) と前提条件 (pane のサイズ、`extended-keys` と `extended-keys-format csi-u`、隔離 agent root と agent dir / session dir の引き継ぎ、ネットワークを要求しない provider、検証用配信元から取りに行かせないこと) を明記し、5.2〜5.7 の確認項目を追記する。回収の証拠については (a) `run` と `check` を同じ隔離した `SPIRITS_VERIFY_STATE_DIR` で呼ぶこと、(b) 検証が使うポートを `run --port` で予約し、そのポートの非 listen を確認すること、(c) `--port` 未指定の `check` の `clean` や `--session` 無しで記録が空の `clean` を証拠にしないこと、を書く。モデル警告の観測は別 run であることと、`run` の既定の待ち時間 (180 秒) と `TIMEOUT_SECONDS` の設定場所も書く。完了確認: 手順書を読むと、確認項目と前提条件と実行コマンド (tmux-verify.sh は絶対パス) が並び、`check` が残留の判定であることとポートの検査対象が書かれている。
  記録 (2026-11-25): 7 の実行手順に `SPIRITS_VERIFY_STATE_DIR` 固定・`run --port`・`check --session <session>`・予約ポートの非 listen 確認を書き、回収の証拠を 3 点セットとして明記。`/quit` で終わる手順 (`/exit` は model prompt)、モデル警告は別 run、`TIMEOUT_SECONDS` と `extend` は既存のまま維持。
- [x] 9.4 手順書の Rollback を、直前の spirits リリースの実行ファイルと managed 一式を同じリリースから SHA256 検証付きで戻す手順を正に更新する (design D11・D13)。検証と配置を同じ論理的な块にまとめ、検証の終了コードが非ゼロなら配置も削除も実行しないこと (`sha256sum -c` の失敗後に次行の `mv` / `rm` へ進まない) をコマンドの形で示す。導入は検証済みの manifest / bundle を `SPIRITS_MANAGED_PI_MANIFEST_URL` に明示して行い、既定の配信元解決に左右されないこと。`rm -rf ~/.spirits/managed-pi` のように managed agent root 配下の `agent` (設定・セッション) を消す案内を無くし、対象を実行ファイルと releases / current / manifest までに限定すること。戻した後に起動役の版と一式が指す host 版の両方を確認する手順、`spirits managed-pi repair` が導入済み set 基準で新版の一式を再導入し得る旨、環境変数がパイプの左にだけ掛かる形の案内を置かないこと、`~/.spirits/agent` のデータが消えないことと旧版がそのデータを読めることを分けて書くこと、`SPIRITS_ROUTE` を戻し方として案内しないことを含める。フォーク Era の再ビルドは managed 経路の戻し方の後続に歴史的な手段として置く。完了確認: `rg -n "SPIRITS_ROUTE" docs/spirits-host-upgrade.md` が「廃止した手順」の節だけに出る (Rollback の節に出ない)、退避・同じリリースからの取得・両版の確認・`~/.spirits/agent` が消えない旨が揃っている。Rollback のコマンドを隔離 HOME で (1) 検証が失敗するケースと (2) 配置後の取得が失敗するケースの 2 通りに流し、いずれも実行ファイルと導入済みの一式と `managed-pi/agent` の設定・セッションが残ることを実測する。
  記録 (2026-11-25): 手順を検証塊 (SHA256 3 件を `&&` で結び、失敗時に `exit 1`)・配置・`SPIRITS_MANAGED_PI_MANIFEST_URL=file://…` 付きの `managed-pi install --version` に書き換え、`rm -rf ~/.spirits/managed-pi` を削除して `releases/pi-<新版>` 限定の削除に置き換えた。隔離 HOME 3 ケース実測。実測では親の `SPIRITS_CODING_AGENT_DIR` を継承したまま走らせた run が実 `~/.spirits/managed-pi` に set を導入した (managed agent dir の指定は `HOME` に勝つ)。`current` を `releases/pi-1.5.0` へ戻し、導入された `releases/pi-1.6.0-rb` を削除して復旧した (実バイナリ・agent dir・backups は無傷)。以降は `env -i PATH=/usr/bin:/bin HOME=<iso>` で立て直して測り直した。
  - 検証失敗: 終了コード 1、`cp` も install も走らず `current` / `releases` / `managed-pi/agent` の設定とセッションマーカーが実行前と同一。
  - 手順どおり: install 0、`current` が `releases/pi-1.6.0-rb` へ切り替わり、前の `releases/pi-1.6.0` と `managed-pi/agent` の設定・セッションはそのまま。
  - 配置後の取得失敗: `PLACED` の後に `Managed Pi install failed: ENOENT …` (install-exit 1)、`current` は `releases/pi-1.6.0` のまま、`spirits managed-pi -- --version` は `1.6.0` を返し、`managed-pi/agent` の設定・セッションも残る。
  手順書の 2c に表として記録した。
- [x] 9.5 `docs/spirits-default-launch.md` の初回起動と戻し方の節、README 4 言語版 (`README.md`、`README.ja.md`、`README.zh.md`、`README.de-CH.md`) が持つ tarball のサイズと導入後の容量を 1.6.0 の実測に更新する。完了確認: `rg -n "1\.5\.0|58,876,253|58\.876\.253" README.md README.ja.md README.zh.md README.de-CH.md docs/spirits-default-launch.md` が 0 件で、`docs/spirits-default-launch.md` の戻し方が 9.4 の手順 (検証が通るまで配置しない・検証済みの manifest / bundle を明示・`managed-pi/agent` を消さない) と食い違わないこと。同文書の初回起動の節に tarball のサイズ 58,977,130 B と導入後の容量 182 MB の実測記録 (または手順書の「実測の記録」への参照) が並ぶこと。
  記録 (2026-11-25): `rg -n "1\.5\.0|58,876,253|58\.876\.253" README.md README.ja.md README.zh.md README.de-CH.md docs/spirits-default-launch.md` は 0 件。README 4 言語と `docs/spirits-default-launch.md` の初回起動の節に 58,977,130 B (README.de-CH.md はドイツ語区切りの 58.977.130) と 182 MB、および導入時間 2,202 ms が並ぶ。同文書の「前のリリースへ戻す」は 9.4 の手順 (検証塊・検証済み manifest 明示・`rm -rf ~/.spirits/managed-pi` を使わない) に揃え、正本への参照を明記した。
- [x] 9.6 `docs/spirits-design.md` の固定版の記述と `docs/spirits-managed-pi.md` の対応表を 1.6.0 の実測に更新する。完了確認: 両文書の対応 set が 1.6.0 とその SHA256 を指し、`docs/spirits-upstream-issues.md` と `docs/spirits-managed-pi-design.md`、`docs/agent-data-compat/` は 1.5.0 の実測記録としてそのまま残っている。
- [x] 9.7 ファイルの追加・削除・移動があった場合に限り、`docs/architecture/convention-registry.md` の正本と `packages/spirits/test/architecture-conventions.test.ts` の baseline を同一変更で更新する。完了確認: `cd packages/spirits && bun test test/architecture-conventions.test.ts` が成功する (無変更ならこのタスクは該当無しとして記録する)。
  記録 (2026-11-25): 該当無し。本次元は既存ソース・テスト・文書の編集だけで、ファイルの追加・削除・移動は無い (`git status` に新設の追跡ファイルは `openspec/changes/upgrade-pi-host-1-6-0/` と本変更の文書のみ)。baseline は未変更で `bun test test/architecture-conventions.test.ts` は成功。
- [x] 9.8 手順書の候補選定の節に、候補を**棄却する**側の記録手順を追加する (design D1 の門の条件を裏返した 3 ケース): `minimumReleaseAge` 不足、リリースの `SHA256SUMS` に対象 platform の配布物が無い、公式型パッケージ (両者) の一方が未公開または門前。棄却した版・満たさなかった条件・欠けていた配布物またはパッケージ名を記録し、`package.json` / `PINNED_PI` / `bun.lock` を変えずに停止することが、採用の記録と同じ書式で並ぶこと。完了確認: 手順書に 3 ケースの判定と記録の書式が並び、各ケースの照合コマンド (npm の `time`、リリースの `SHA256SUMS`、`bunfig.toml` の門) が実行できる。
  記録 (2026-11-25): 手順 1 の門の確認コマンド (`gh release view --json publishedAt,assets`、両型パッケージの `time["<版>"]`) の後に、棄却行の書式 (棄却した版 / 満たさなかった条件 / 欠けていた配布物または型パッケージ名 / 実測した値 / 処置) と 3 パターン (経過時間不足、`SHA256SUMS` に配布物が無い、型パッケージが揃わない) の判定を追記。SHA256 を `PINNED_PI` に書き写さない旨も同じ節に置いた。

## 10. 承認済み commit からの正式な再測定

- [ ] 10.1 1〜9 が揃った状態でユーザーにコミットを依頼し、コミットされた SHA を記録する (コミットは依頼時のみ行い、`PI_ALLOW_LOCKFILE_CHANGE=1` はそのコミットで付ける)。完了確認: 記録した SHA が `git log` に在り、`bun.lock` の移動を含むこと。
- [ ] 10.2 その commit から拡張 bundle と起動役を再生成し、公式モードの互換性ランナーを `--commit <その SHA>` で再実行する (design D9)。完了確認: `Compatibility met` が真、`failed` が 0 件、`not-run` が成功として扱われていないこと、結果 JSON の `commit` が 10.1 の SHA と一致すること。結果 JSON のパスを実測の記録に書く。
- [ ] 10.3 正式の再測定の結果が揃うまで、この変更を完了として扱わず、`openspec` の archive も行わないことを Workflow follow-up の状態として記録する。完了確認: 一次と正式の 2 つの結果 JSON のパスが手順書の記録に並んでいる。

## Workflow follow-up

- リリース発行 (`spirits-v*` のタグと資産、Release body の host 版の変更) は本次元のスコープ外。ユーザーが明示的に依頼した場合のみ release 手順で行う。
- アーカイブはユーザーの依頼後、かつ 10.2 の正式な再測定の結果が揃った後。アーカイブ前に `openspec validate upgrade-pi-host-1-6-0 --strict` を通し、`host-upgrade` の本仕様へ差分を同期する。同期には design D12 の互換性成功判定 (`confirmed` 一本) と design D13 の Rollback の安全性 (検証が通るまで配置しない、検証済みの組を明示、`managed-pi/agent` を消さない) を含む。本仕様の同期漏れは次の bump で同じ判定割れを起こす。
- 1.6.0 で観測した新事実は `docs/spirits-host-upgrade.md` の実測の記録に書き、`docs/agent-data-compat/` の 1.6.0 記録を取り直すかは別途判断する。
- python3 を要求する検証 (7.1 と 8.2 の一部) を実行できなかった場合、その結果の受領まで本変更は未完了として残す。
