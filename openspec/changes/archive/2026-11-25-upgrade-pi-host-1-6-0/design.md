# Design

## Context

動機は `proposal.md` を参照する。ここではアプローチを決める制約だけを置く。

- 固定値は 3 か所に分散している。検査時に効く型 pin (`packages/spirits/package.json` の devDependencies)、導入する実体の pin (`PINNED_PI` の版・artifact SHA256・overlay 版・overlay SHA256)、ホスト固有の形 (`src/managed-pi/host.ts` の `HostDescriptor`)。`docs/spirits-host-upgrade.md` の手順は 3 か所を同じ版にそろえて実測で裏を取る契約で、本次元の host コマンド語の表は型 pin からも `PINNED_PI` からも決まらない (版とともに変わる観測値)。
- 1.6.0 の破壊的変更は 1 件で、拡張の描画 component が `render()` の返り値をホストに返すときの配列の所有権に関する。`Component.render` の宣言は 1.5.0 の `string[]` から `readonly string[]` へ変わり、`Container.render` は子が変わらない限り `childLines.parts` を复用する。`string[]` は `readonly string[]` に代入可能なので、手写しの契約のままでは、実装が返り値を in-place で書き換えても、また `Container` 経由で祖先が同じ配列を返すようになっても、`tsc` は何も言わない。
- spirits 側の実測状況: `src/todo/widget.ts` (`TodoPanelComponent`) と `src/commands/role-panel.ts` (`RolePanelList extends SettingsList`) は `src/types/host.ts` が `@earendil-works/pi-tui` から再 export する `Component` を実装している。`src/branding/header.ts` だけが `HeaderComponent { render(width: number): string[] }` を手写ししており、host の component 型と結ばれていない。
- 1.6.0 の診断の挙動は `AgentSessionRuntime.takeUnreportedDiagnostics()` で変わる。警告は起動時と session 置換後に 1 回ずつ報告され、`type` と `message` が既出のものは再掲しない。`enabledModels` / `--models` の不一致警告はこの経路に乗る。正常なモデル選択では警告自体が出ない。
- 1.6.0 の npm `exports` map (`.` と `./rpc-entry`) と共有 schema ライブラリ `typebox@1.3.27` は 1.5.0 から変わらない (両版の公開 `package.json` を 2026-11-25 に実測)。release notes に `registerModelRoles` の追加は無く、role / `/clear` / `/model` の限定互換は本次元でも解消しない。
- 互換性ランナーの `host version` 観測は `PINNED_PI` を読むため、pin を動かすだけで期待値が追随する。ランナーの `--commit` は来歴として書き込まれるだけで、指定された commit から何かをビルドはしない。CI は tarball を持たないので公式モードは手元実行のまま。
- 検証基盤の制約: `scripts/tmux-verify.sh` の `run` は pane が終わるまで待ち、`check` はペイン・セッション・ポートの残留を調べる判定で、画面の内容の合否は調べない。`scripts/self-update-smoke.sh` と `scripts/install.test.sh` と `scripts/tmux-verify.test.sh` の一部は `python3 -m http.server` を使う。この変更を進める作業セッションは python3 を実行できない (ハーネスが Python の実行を禁じている)。検証機自体に python3 は在る (`/usr/bin/python3`) ので、実行は利用者または許可された環境に依頼する。

## Goals / Non-Goals

**Goals:**

- 固定ホストを Pi 1.6.0 にそろえ、手順書が要求する実測 (型検査 → 公式モードの互換性ランナー → tmux 対話確認 → 起動役が予約する語の照合) を、実行環境の前提を明示したうえで通る。
- 1.6.0 の描画契約の変更を型で受けられる形にし、その形が崩れたときに型が失敗することを test で継続検証する。
- 手順書と本仕様の食い違い (fork 経路の戻し方、tmux 検証の確認対象、戻し方での一式の扱い) を同じ変更で閉じる。互換性の成功判定も `confirmed` 一本へ同期する (D12)。

**Non-Goals:**

- spirits のリリース発行と公開 (自己更新の検証は手順書どおり行うが、release は発行しない)。
- 新ホスト API の採用と限定互換の解消。
- 互換性マトリクスへの新しい観測の追加、観測のための新しい足場の追加。
- 実装の `compatibilityMet` を緩めて `limited` を成功に含めること (D12 は仕様側を締める方向で揃える)。
- 推移依存を受けるための新しい層・interface・ラッパーの追加 (D8)。
- `docs/agent-data-compat/` と `docs/spirits-managed-pi-design.md` と `docs/spirits-upstream-issues.md` の 1.5.0 実測記録の更新。

## Decisions

### D1: 対象版を 1.6.0 に固定する

選択肢は (a) 本次元の実測値として 1.6.0 に固定し、(b) apply 時点で「門を過ぎた最新の stable」を再解決する、の 2 つ。(a) を採る。SHA256・公開日時・差分の検証が 1 度きりで済み、handoff のたびに測り直さなくてよい。(b) は「新版が出ていたら決める」という条件が成果物の版・型の照合・tmux 実測・互換性ランナーのすべてに波及し、レビュー済みの対象が apply 中に動く。

apply 中またはレビュー後により新しい適格な stable が出た場合は、本変更の対象は動かさない。その版は別の計画として立ち上げ、選定・型の検査・配布物の検証・実測をやり直す。門の条件そのもの (`host-upgrade` の「ホスト版の候補選定」) は手順書に残るので、次の計画が同じ判断を再发明しない。

### D2: `HeaderComponent` をホスト由来の型に寄せる

`src/branding/header.ts` の `HeaderComponent` を消し、`src/types/host.ts` が `@earendil-works/pi-tui` から導出している `Component` を実装する形に寄せる。これで返り値の配列の所有権が変わったことが `tsc --noEmit` に出る。

代替案は (a) 現状維持 (host の型と結ばれないので、返り値を in-place で書き換える実装を型が止めない)、(b) `src/branding/header.ts` が `@earendil-works/pi-tui` を直接 import する。host boundary は型名を `src/types/host.ts` で束ねるので (b) は避け、`Component` を経由させる。`HeaderTheme` (`fg` だけの seam) と `BrandingContext` は意図的な最小 seam のままとし、本次元では host の `Theme` / UI context の全面採用をやらない (テストが painted theme で色を差し替えている)。

検証は「代入可能である」ことでは足りない。`string[]` は `readonly string[]` に代入できるので、代入可能性の検査は 1.5.0 でも 1.6.0 でも通る。検査するのは逆方向、つまり host 由来の型で受け取った返り値を in-place で書き換えたときに `tsc` が失敗することである。`Component` 型の値に対して返り値の配列を `push` するケースを test の型検査対象に置き、`bun run check` で失敗する形を保つ (実装の一時編集ではなく test に残す)。

### D3: 起動役が予約する語を新版 host の `--help` と照合する

`HostDescriptor.commandWords` は「host が自己的な第一引数でのみ dispatch し、かつ起動役が先に分類しない語」の一覧である。1.5.0 の一覧 (`install`、`remove`、`uninstall`、`list`、`config`、`auth`、`mcp`) を据え置かず、新版 host の `--help` と突合する。

照合の基準は host `--help` のコマンド一覧から、起動役が先に分類する語を除いた集合である。`update` は `src/update/classify.ts` が自己更新か拒否かを判定するので語表に入れない。host `--help` に `update` が並ぶことをもって「語が増えた」と判定してはならない。判定は追加漏れと削除漏れを分ける。

- 追加漏れ: host が新增した語を語表に足し忘れると、`spirits <word>` が `-e <bundle> <word>` として host に渡り、model turn と session が残る。語表への追加、`test/managed-pi-host.test.ts` の語表の期待値、`test/update-routing.test.ts` の拒否の確認、起動役の再ビルドと実測が要る。
- 削除漏れ: host がなくした語を語表に残すと、`spirits <word>` は正当な model への入力なのに拒否される。語表から除くことで、その語は拒否されずに model へ渡ることに変わる。これは利用者に見える挙動の変化なので、記録に残す。

どちらの判定も、語表を変えた後は再ビルドした起動役で `spirits <word>` と `<host> <word>` の両方を実測して裏を取る。`test/managed-pi-cli.test.ts` は語表を調べない (`classifyManagedPiArgs` と `classifyUpdateArgs` の分類を検査する) ので、完了確認のテスト対象は `test/managed-pi-host.test.ts` と `test/update-routing.test.ts` である。

### D4: 互換性マトリクスに描画の観測を増やさない

1.6.0 の配列の所有権の変更を `managed-pi-compatibility` の観測項目にはしない。`managed-pi-compatibility` は対話端末の画面操作にしかない目的 (拡張の一覧、selector の保存キー) を `not-run` と定めており、RPC から描画 component は駆動できない。観察できるのは型検査 (D2) と tmux 検証 (手順 7) で、観測のための新しい足場は追加しない。

代替案は probe extension を登録して RPC から `render()` を叩くが、足場の追加になり、画面に映るもの (折り返し、色、badge の追従) を代償にできない。

### D5: 正しい pin の証拠はテストに独立した期待値として残す

選択肢は (a) 版と SHA256 の期待を独立リテラルとして test に残し、(b) `PINNED_PI` 参照へ寄せて値の正しさは公式配布物との照合で証明する、の 2 つ。(a) を採る。`PINNED_PI` が誤った値を指していても、それを manifest へ正しく伝播させる検査だけでは緑になる。誤 pin を止める証拠は、実体から写した独立した期待値である。

- 独立した期待値として残す: `test/managed-pi-manifest.test.ts` の `pi.version` と SHA256 の期待、`test/managed-pi-compat-host-version.test.ts` の版の一致と不一致、`test/managed-pi-fixtures.ts` が模す host が返す版 (`OFFICIAL_PACKAGE` など) と set id。
- 伝播の検査として残す: `test/managed-pi-manifest.test.ts` の、`PINNED_PI` の値がそのまま manifest へ載ることを見る既存ケース。
- 据え置く: `test/managed-pi-*-test.ts` の fixture が自分で決める版 (`"9.9.9"` など) と、アーキテクチャ検査の fixture (`test/architecture/resolve.ts` は fixture の `version` を判定に使わない)。

次回の bump では独立期待値も更新しなければならない。更新漏れは失敗として出る。この手間は意図的で、D5 の根拠として手順書の記録に書く。

### D6: overlay の実測値は、照合済み配布物から生成してから書く

`overlaySha256` は `packages/spirits/src/managed-pi/overlay.ts` が展開後の `package.json` から生成する値なので、公式 tarball の取得と SHA256SUMS 照合を先に済ませてから実測する。顺序は 配布物取得・照合 → overlay 生成 → 生成物のダイジェスト実測 → `PINNED_PI` と manifest の両方へ書く → 生成値と pin の一致を検査で確認。

採らなかった算出方法は 2 つ。(a) 生成前に `PINNED_PI` だけ先へ更新し、テストの成功を以て正しいとする方法。`test/managed-pi-overlay.test.ts` は合成した `package.json` を入力にしているので、公式配布物から生成した値と pin が一致することを証明しない。(b) 前版の overlay を流用する方法。overlay には host の版が書かれるので値が合わない。

生成 manifest のキーは `overlay.version` と `overlay.sha256` である (`overlayVersion` という平坦なキーではない)。命名は `1.6.0-spirits.1` を踏襲する。

### D7: 検証は実行環境の前提を明示し、実行できない検証は合格として扱わない

`scripts/self-update-smoke.sh`、`scripts/install.test.sh`、`scripts/tmux-verify.test.sh` の一部は `python3 -m http.server` で検証用配信元を立てる。検証基盤を Python 不要に書き換える代替案は、置換・一式の導入・回収という同じ契約を別の足場で証明する作業が増えるので採らない。現行スクリプトを維持し、このセッションは Python を実行できないため、利用者に実行を依頼するか許可された環境で走らせ、その終了コードと実行環境の記録を受け取って初めて合格とする。受け取れない間は当該手順を未実行として記録し、変更を完了扱いしない。

`scripts/test-clean-env.sh` は CI と同じ環境での再実行を行うが、内部でインストーラのテストと呼び出し検証のテストを呼ぶため、同じ python3 の前提に乗る。python3 が無い環境で走らせた結果は、スキップと失敗を区別して記録する。

自己更新の検証 (`scripts/self-update-smoke.sh`) は、置換が成立するよう、旧版より大きく、起動役・bundle・manifest が組として揃った検証用版を用意して行う。実リリースを先行させる代替案は、失敗時に公開済みの資産を残すため採らない。

### D8: 推移依存は対象版の宣言どおり採用し、ラッパーを増やさない

1.6.0 が host 直下へ増やす `lovely-mermaid@0.3.3` は、spirits から見れば host が自分の mermaid 描画で使う外部パッケージで、spirits は import しない。選択肢は (a) 対象版の宣言する集合をそのまま採用する、(b) spirits 側に除外・pin 保持・ラッパーを入れて差分を抑える、の 2 つ。(a) を採る。(b) は host の配布物の構造に依存する層を増やし、次回 bump のたびに host の内部構成を追従させる。

採用の記録に残す実測差分: host 直下から `grok-mermaid@0.2.3` を除き `lovely-mermaid@0.3.3` を足す移動、`undici` 8.12.3 → 8.12.4、`pi-ai` 配下の `openai` 7.19.0 → 7.59.0 と `@google/genai` 2.21.0 → 2.32.0、`openai@7.59.0` の optional peer `google-auth-library` の追加。`@earendil-works/pi-mcp` / `pi-codemode` / `pi-agent-core` / `pi-tui` / `pi-ai` / `typebox` は 1.5.0 から在る (版のみ追随)。

取り消す条件: 公式 Linux x64 配布物での導入または起動が失敗する、managed 一式の導入後の容量が手順書の記録から 2 割を超える、公式モードの互換性ランナーに `failed` が出る、tmux 検証で描画・対話の壊れが出る、のいずれか。該当したら `packages/spirits/package.json` と `PINNED_PI` と `bun.lock` を 1.5.0 へ戻し、判断をこの節に追記する。

利用者に見える上流の挙動変更 (`find` のパスパターンが検索ディレクトリ基準になる、`openai` / `azure` / `openai-codex` の既定モデルが `gpt-6.2-sol` になる) も同じ記録に含める。spirits 側のコード変更はしないが、実測で現れないかを tmux 検証で確認する。

### D9: 互換性実測は一次と正式の 2 段構えにする

`scripts/managed-pi-compat/run.ts` の `--commit` は来歴として記録されるだけで、その commit から bundle をビルドしない。一方 `managed-pi-compatibility` は「対象 commit の拡張 bundle」での実行を要求する。失敗する可能性のあるピンをコミットせずに済ませ、かつ対象 commit の証拠も残すため、実測を 2 回に分ける。

1. 一次 (apply 中、作業ツリー): 失敗しても戻せるようにするため、コミット前に公式モードを完走させる。結果は一次の記録として保持し、`--commit` には作業ツリーであることが分かる値を残す。
2. 正式 (利用者が依頼したコミットの後): その commit から bundle と起動役を再生成し、`--commit <その SHA>` で再実行する。この結果 JSON のパスが対象 commit の証拠になる。

正式の再測定の結果が揃うまで、この変更は完了として扱わない。archive も正式の結果の後。代替案の「apply は一次までとし、正式測定を後続の verify に置く」は、コミットの依頼を待たずに進められる代わりに、測っていない pin を抱えた状態で変更が完了扱いになるため採らない。

### D10: tmux 検証は実行手順を手順書に書き下す

`scripts/tmux-verify.sh` の `run` は pane の終了まで待つので、`check` を先に合格させると同じ pane で後続の操作ができない。手順は 一式の設置 → `run` 起動 → resize → 全観測 (`/spirits-clear`、`tsrepl` のセル値、role 一覧と badge、TODO の展開と折りたたみ) → pane を host の終了コマンド `/quit` (効かなければ `C-d`) で終わる → `run` の回収完了 → `check --session <session>` が `clean` の順、と手順書に書く。`check` は残留の判定であり画面内容の合否ではないことを、手順書の同じ節に明記する。

1.6.0 の host は `/exit` を model への prompt として扱い、セッションが残る (実測)。終了コマンドは `/quit` なので、手順書・タスク・design ともに `/quit` を正とし、`/exit` を案内しない。

起動引数を変える観測 (正常なモデル選択と `--models` の無一致) は、同じ pane では作れない。無一致の警告は起動時にしか出ないため、**別 run として起動する**ことを手順書に書く。`run` の既定の待ち時間は 180 秒で、検証設定の `TIMEOUT_SECONDS` の位置 (`<agent root>/../.config/spirits-verify/config` 相当) とともに書く。

`check` は `--port` を渡していない場合にポートを検査せず、`--session` 無しで呼ぶと記録が無いときに `clean` を返す。したがって回収の証拠は (a) `run` と `check` を同じ隔離した `SPIRITS_VERIFY_STATE_DIR` で呼び、(b) 検証が使うポートを `run --port` で予約し、(c) `check --session <session>` の `clean` を以てする、の 3 点セットで残す。予約したポートを持たない検証 (画面操作のみ) では、ポートの非 listen を別の確認 (listener 一覧) で示すことを手順書に書く。

環境の前提は次の 4 つを手順書に並べる。

- 対象版の一式を、隔離した agent root 配下に据える (`manifest.json` と `installed.json` の digest を新しい bundle に合わせておき、検証版を通常の配信元から取りに行かせない)。
- `HOME` の隔離に加えて、継承した agent dir / session dir 指定を子の環境から除く (`HOME` だけでは既存の `SPIRITS_CODING_AGENT_DIR` に負ける)。
- パニック回避のため、ネットワークを要求しない provider を隔離環境の `models.json` に用意する。検証用の設定は managed agent dir ではなく実際の agent dir に置く。
- pane は 80x24 ではヘッダがスクロールで消えるためリサイズし、修飾キーには tmux の `extended-keys on` と `extended-keys-format csi-u` を隔離設定に書く (実 HOME の tmux 設定は触らない)。

### D11: 自己更新と Rollback は「起動役と一式を同じ版にそろえる」操作として書く

Rollback は実行ファイルだけを戻して終わらない。`spirits managed-pi repair` は導入済み set の `manifest.json` を基準に再取得し、通常起動も検証を通る既存 `current` を使うため、新版の `current` が残ったまま旧バイナリを走らせると新版の一式を再導入し得る。手順書は、直前の spirits リリースの実行ファイルと managed 一式を同じリリースから SHA256 検証付きで戻すことを正とし、戻した後に起動役の版と一式が指す host 版の両方を確認する手順を書く。

`VERSION=<ver> curl … | sh` のような、環境変数がパイプの左のコマンドにだけ掛かる形は戻し方の案内に書かない。agent dir のデータが消えないことと、旧版がそのデータを読めることは別の事実なので、後者は未確認として分けて書く。

### D12: 互換性の成功判定を `confirmed` 一本へ同期する

`openspec/specs/host-upgrade/spec.md` は必須観測を `confirmed` **または** `limited` としていたが、`managed-pi-compatibility` と実装 (`scripts/managed-pi-compat/evidence.ts` の `COMPATIBILITY_MET_DEFINITION`) は必須観測の `confirmed` を要求し、`limited` を成功に数えない。前回はこの食い違いを「本次元では直さない」と記録した。次の bump で同じ結果 JSON を前にして判定が割れるため、**本変更で host-upgrade 側を `confirmed` 一本へ寄せる** (delta の MODIFIED 参照)。実装を変える代替案は、`limited` を成功に含めると「目的の一部が動かないまま bump 完了」と報告できる隙を作るので採らない。実測への影響は無い (今回の一次結果は必須観測がすべて `confirmed` で、両定義を満たす)。

### D13: Rollback は「検証が通るまで配置しない」「検証した組を明示的に導入する」「隔離データに触らない」

前回の Rollback 手順には 2 つの実害がある。(a) `sha256sum -c …` の失敗を拾わず次行の `mv` に進むので、検証が失敗しても実行ファイルを差し替える。(b) 配置後の `spirits managed-pi install` は manifest を既定解決し、`SPIRITS_MANAGED_PI_MANIFEST_URL` があればそちらが優先するため、検証済みの manifest / bundle を導入する保証が無い。さらに `rm -rf ~/.spirits/managed-pi` は `managed-pi/agent` 配下の設定・セッションごと消し、その直後に取得が失敗すると動作する一式も残らない。

手順は次の順に固定する。(1) 旧リリースの実行ファイル・manifest・bundle を取得し、SHA256 を検証して**失敗したらそこで終わる** (検証と配置を `&&` または明示的な終了コード検査で結ぶ)。(2) `~/.spirits/bin` を退避する。(3) 検証済みの manifest を `SPIRITS_MANAGED_PI_MANIFEST_URL` に**明示的に**指して導入し、新旧の配信元解決に左右されない。(4) 導入後の起動役の版と一式の host 版を確認してから、退避を消す。(5) 対象は実行ファイルと `managed-pi/releases` / `current` / `manifest` までとし、`managed-pi/agent` は削除しない (必要な設定は保持し、新版が書いても旧版が読めるかは別事実として未確認のまま)。

正本は `docs/spirits-host-upgrade.md` の Rollback の節に置き、`docs/spirits-default-launch.md` は同じ順序・同じ検証の対象を参照する簡略版にとどめる (両文書にコマンド列を重複掲載し、片方だけ直す事故を防ぐ)。`agent dir` を消さないことは、検証済みの隔離 HOME で「一式を差し替えても設定とセッションが残る」確認をしてから書く。

## Risks / Trade-offs

- [Risk] 1.6.0 の公開型が変わり spirits が型検査で落ちる → Mitigation: 手順 3 で固定値を触る前に型だけ通す。assertion を緩めず型を `unknown` に潰さず、通せなければ中止して devDependencies と `PINNED_PI` を戻す。
- [Risk] `Container` が同じ配列を返すようになり、role panel・TODO パネル・header が stale な行を映す → Mitigation: tmux 検証で role lock の変更、TODO の追加、折りたたみキーの実操作を確認する。spirits の component が毎回新しい配列を返していることを read で確認し、D2 の型検査で返り値の変更を失敗させる。
- [Risk] コマンド語の表が新版と合わない → Mitigation: D3 の照合で追加漏れと削除漏れを分けて判定し、語表を変えたら起動役を再ビルドして実測する。不一致が 1 つでもあれば tmux 検証へ戻る。
- [Risk] 1.6.0 が agent dir に書く形式が変わり、既存 `~/.spirits/agent` と非互換になる → Mitigation: 互換性ランナーは隔離 HOME と redact したコピーだけを使い、書き戻し互換は既存仕様どおり未確認のまま成功に含めない。実 HOME と実 `~/.spirits` を触らない。
- [Risk] `--commit` に作業ツリーの実測を記録してしまい、対象 commit の証拠が残らない → Mitigation: D9 の二段階。正式の再測定の結果 JSON のパスが揃うまで完了扱いと archive を行わない。
- [Risk] python3 の無い環境で自己更新と shell 検証を走らせ、スキップを成功として通す → Mitigation: D7。実行できない検証は未実行として記録し、結果の受領を完了条件にする。
- [Risk] 導入後の容量と導入時間が手順書の 1.5.0 の記録から動く → Mitigation: 互換性ランナーの結果 JSON からランタイム版と来歴を読み、容量と導入時間は隔離した製品インストールで実測し (測定範囲と単位を添えて)、README 4 言語版と手順書の記録へ反映する。
- [Risk] `enabledModels` / `--models` の警告の期待値を誤る (正常な起動には警告が出ず、1.6.0 は診断を起動時と session 置換後に 1 回ずつ、既出を除いて出す) → Mitigation: tmux 検証を正常な選択と不一致の 2 通りに分け、不一致側で警告が 1 回であることと session 置換後に再掲されないことを確認する。
- [Risk] 互換性成功の判定が `host-upgrade` 側 (`confirmed` または `limited`) と `managed-pi-compatibility` と実装 (`compatibilityMet` は必須観測の `confirmed` を要求) で食い違う → Mitigation: D12 で host-upgrade 側を `confirmed` 一本へ同期する。手順書の記録は実装の `Compatibility met` の定義を写し、`limited` を成功に数えない。
- [Risk] Rollback 手順が検証失敗後にファイルを差し替え、または隔離した agent dir を消す → Mitigation: D13。検証と配置を終了コードで結び、導入する manifest / bundle を明示し、`managed-pi/agent` を対象に含めない。隔離 HOME で取得失敗時に一式と設定が残ることを実測してから手順書に書く。

## Migration Plan

1. 手順書の手順 2 (型の pin) → 3 (型検査) → 4 (公式配布物の取得と照合、`PINNED_PI`) → 5 (bundle と manifest) → 6 (公式モード一次) → 7 と 7b (tmux、コマンド語の照合) → 8 (`bun run check` と `bun test`) → 9 (文書) の順。いずれかで失敗したら中止し、ピンをコミットしない。
2. `bun.lock` の移動は host pin の移動を伴うので、`scripts/check-lockfile-commit.mjs` の報告を確認し、意図した移動だけを `PI_ALLOW_LOCKFILE_CHANGE=1` でコミットする。コミット自体は利用者の依頼時のみ。
3. 利用者にコミットを依頼し、その commit から bundle と起動役を再生成して公式モードを再測定し、結果 JSON のパスを手順書の記録に書く (D9)。
4. Rollback は直前の spirits リリースの実行ファイルと managed 一式を同じリリースから取得し、SHA256 検証が通るまで配置せず、検証済みの manifest / bundle を明示して導入し、起動役の版と一式の版の両方を確認する (D11・D13)。`~/.spirits/agent` も `managed-pi/agent` も消えない。
5. 正式の再測定が失敗した場合は、リリースと archive を行わず、修正した差分を改めて承認するか本変更を差し戻す (コミット済みの内容を戻す操作にはしない)。

## Open Questions

- 1.6.0 の `--help` が並べるコマンド語の一覧と、語表の増減の要否。公開 npm パッケージの `dist/cli/args.js` の表は 1.5.0 と同じ 8 語 (`install`、`remove`、`uninstall`、`update`、`list`、`config`、`auth`、`mcp`) で、起動役が先に分類する `update` を除けば増減は無さそうに見えるが、手順 7b で公式 Linux x64 配布物自身の `--help` を実測して確定する。
