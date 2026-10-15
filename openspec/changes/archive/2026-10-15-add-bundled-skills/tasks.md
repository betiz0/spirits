# Tasks

## 1. スパイク(書き出し方式・探索順・コンパイル実行)

- [x] 1.1 `/tmp` にスパイク用エントリを置き、アセット import(`import content from "./SKILL.md" with { type: "text" }`)が (a) `bun <entry>` のソース実行、(b) root `tsconfig.json` を指定した `Bun.build` の `compile`、(c) `bun test` の 3 経路で Markdown の文字列を返すか確認する。(a)(b)(c) の失敗時は `compile.assets` + `import.meta.dir` 方式を同じ 3 経路で試す。検証: 採用できた方式と実行したコマンド・出力を `docs/spikes/bundled-skills.md` に表で記録し、結果が design.md の Decision 2 と一致することを確認する
- [x] 1.2 隔離 HOME で、`resources_discover` が返す同梱版と利用者 `<agentDir>/skills/` の同名スキルを用意し、スキル一覧(`available_skills` の `location`)が利用者版を指すことと、衝突警告が出ることを確認する。検証: `bun scripts/build-binaries.ts --version 0.0.0` で作ったバイナリを tmux で起動し、セッション JSONL の system プロンプトで確認した内容を `docs/spikes/bundled-skills.md` に記録する
- [x] 1.3 スパイク結果で Decision 2 / 3 の採用方式(主案か代替か)を確定し、撤回条件に該当した場合は design.md の該当 Decision を更新する。あわせて、import attributes の型検査に必要だった `packages/spirits/tsconfig.json` の `module` / `moduleResolution` = `NodeNext` の変更を、`.md` の型宣言の追加と並べて結論に記録する(verify2 G-2)。検証: `docs/spikes/bundled-skills.md` の結論と design.md の Decision 2 / 3 が一致し、結論に tsconfig の変更とその理由が記載されている

## 2. 同梱の仕組みと bun test

- [x] 2.1 同梱スキルのバンドル定義(名前、ファイル一覧、内容)と frontmatter の妥当性検証(名前・説明の存在、ディレクトリ名と frontmatter `name` の一致)を実装する。テストはフィクスチャのバンドル定義を注入して行う。検証: `cd packages/spirits && bun test test/bundled-skills.test.ts` の "bundled skill frontmatter is valid" が成功する
- [x] 2.2 書き出し(現行版ディレクトリの作成、内容が同一のファイルは再書き込みしない、一時ファイル + rename での更新)を実装する。検証: `bun test test/bundled-skills.test.ts` の "writes bundled skill files under the version directory"(書き出し後に `<agentDir>/skills/<スキル名>/` が作成されないことの assert を追加する。verify2 W-3)と "does not rewrite identical files" が成功する
- [x] 2.3 版ごとの切り替えを実装する(design Decision 5)。書き出しのたびに(内容が同一でファイルを書かない場合も)現行版ディレクトリの更新時刻を現在時刻にする。更新時刻の更新(`mkdir` と `utimes`)は、ファイルの書き出しより前に行う(verify2 再検証 W-1)。`<agentDir>/bundled-skills/` 直下の現行版以外のディレクトリのうち、更新時刻から 7 日以上経過したものだけを best-effort で削除し、7 日未満のものは残す(日数は定数にする)。版文字列が空、`.`、`..`、または `[A-Za-z0-9._+-]` 以外の文字を含む場合は版ディレクトリ名を `dev` とする(verify2 S-1, S-3)。検証: `bun test test/bundled-skills.test.ts` の "removes stale version directories"(7 日以上経過した版だけが消える)、"keeps recently used version directories"(7 日未満の別版のファイルが残る)、"touches the current version directory on every write"、"sanitizes unsafe version strings"、新設する "touches the current version directory before writing files"(現行版ディレクトリの mtime を 8 日前にし、`<versionDir>/<スキル名>` の位置に同名のファイルを置いて書き出しを失敗させても、mtime が更新されていることを assert する)が成功する
- [x] 2.4 無効化を実装する。`SPIRITS_BUNDLED_SKILLS=0` で書き出しと供給を行わず、未設定・その他の値は有効にする。定数と config の読み取りは `constants.ts` / `config.ts` の既存の層分けに従う。検証: `bun test test/config.test.ts` と `bun test test/bundled-skills.test.ts` の "disabled by SPIRITS_BUNDLED_SKILLS=0 writes nothing and returns no paths" が成功する
- [x] 2.5 `resources_discover` への配線を実装する。ハンドラ内で書き出しを行い、全ファイルの成功時だけ現行版ディレクトリを `skillPaths` として返し、失敗時は例外を伝播させずパスも返さない。旧版の削除に失敗しても現行版は返す。検証: `bun test test/bundled-skills.test.ts` の "returns the current version directory as a skill path"、"returns no skill paths when writing fails"、"keeps serving the current version when stale removal fails"(7 日以上経過した旧版ディレクトリの権限を `0o500` にして削除を失敗させる。root 以外で実行する。verify2 W-3)が成功する
- [x] 2.6 優先順位の契約をテストで固定する。pi の `loadSkills` にデフォルト探索と `skillPaths`(同梱版)を渡し、同名では利用者版が採用されることを確認する。検証: `bun test test/pi-runtime/bundled-skills.test.ts` の "agent skills directory wins over same-name bundled skill" が成功する
- [x] 2.7 `spirits_skill_save` / `spirits_skill_delete` の同梱保護を実体パス同士の比較に直す(design Decision 7。verify2 C-1, W-1, W-5)。save は、書き込み先の実体パスが同梱 root の実体パス配下ならエラーにする。比較する同梱 root も `realpath` で解決し、`<agentDir>` が symlink を経由する場合と相対パスの場合でも成立させる。書き込み先がまだ存在しない場合(`realpath` が ENOENT)は、存在する最も近い祖先を `realpath` で解決し、残りのパス要素をつないだ実体パスで比較する。現状は ENOENT を「同梱配下ではない」と扱うため、`skills/` が版ディレクトリへの symlink の状態で新しい名前を保存すると、同梱ツリーに書き込まれる(verify2 再検証 C-1)。delete は、symlink ならリンク切れを含めてリンクだけを削除し、symlink でなくても実体パスが同梱 root 配下ならエラーにする。検証: `bun test test/harness-skills.test.ts` の次が成功する: "refuses to write through a symlink into bundled-skills"、"refuses to write through a symlinked agent directory"、"refuses to write through a relative agent directory"、"deleting a symlink into bundled-skills removes only the link"(旧名 "deleting a symlinked skill removes only the link" から実在のテスト名に合わせた。verify2 G-1)、"deleting a dangling symlink removes only the link"、"refuses to delete when skills is a symlink into bundled-skills"、"save with a bundled name writes to the user skills directory and keeps the bundled file"(verify2 W-3)、新設する "refuses to save a new skill when skills is a symlink into bundled-skills"(save が拒否され、`bundled-skills/<版>/` の中身が変わらないことを assert する。verify2 再検証 C-1)
- [x] 2.8 後段フェーズ機能への非依存を確認する。検証: `rg -n "phase2|M5" packages/spirits/src/harness/` が同梱スキル実装から何も返さない
- [x] 2.9 型検査とパッケージテストを通す(2.3・2.7・7.2 の修正後に再実行する)。検証: `npm run check`(root、全出力)と `cd packages/spirits && bun test && bun run check` が成功する

## 3. architecture-guards の SKILL.md と references

- [x] 3.1 `SKILL.md` を作成する。frontmatter は `name: architecture-guards`、対象と起動方法が分かる `description`、`disable-model-invocation: true`。本文は 7 手順(スタック検出 → import 依存の実測と許可表原案の確認 → 重複・継承の計測 → 利用者テストランナーで動く検査の生成 → OpenSpec rules 追記案 → 規約正本 → 差分提示と承認後の書き込み)に絞る。検証: `bun test test/bundled-skills.test.ts` の "architecture-guards is hidden from the model-facing skill list" が成功する
- [x] 3.2 `references/principles.md` を作成する。統制対象が抽象化の追加と重複の蓄積の両方向であること、機械判定できる規約は CI で強制し人間のレビューは新しい継ぎ目を増やす変更に絞ること、規約本文を正本 1 か所に置くこと、導入前後で成果指標を比較することを書く。検証: `bun test test/bundled-skills.test.ts` の "references cover the four principles" が成功する
- [x] 3.3 `references/convention-registry.md` を作成する。規約 ID、強度、内容、例外、判定方法、根拠を持つ正本の書式を定義する。検証: `bun test test/bundled-skills.test.ts` の "convention registry format lists required fields" が成功する
- [x] 3.4 `references/check-generation.md` を作成する。依存方向検査、重複と継承の計測、型のみ import の AST 判定(Bun の `scanImports` を使わない理由)、OpenSpec rules への追記案、対象判定の詳細を書く。依存方向検査の対象は型のみの import を含む import とし、17 行目の「値の import が許可された向きだけであることを検査する」を、SKILL.md 手順 2、convention-registry.md の例、同ファイルの循環の節と矛盾しない記述に直す(verify2 W-2)。検証: `bun test test/bundled-skills.test.ts` の "check generation reference covers required guidance" と、新設する "dependency direction check includes type-only imports"(依存方向検査の節が検査対象を値の import に限定する記述を持たないことを assert する)が成功する
- [x] 3.5 対象外プロジェクト用の判定文言と、判断できない場合に質問して終了する規則を SKILL.md に書く。検証: SKILL.md を読み、TypeScript 判定と質問終了の記述があることを確認する

## 4. 手動 E2E: spirits リポジトリ自身への適用

- [x] 4.1 隔離 HOME でソース実行(`bun packages/spirits/bin/spirits.ts`)とコンパイル済みバイナリ(`bun scripts/build-binaries.ts --version 0.0.0`)の両方を起動し、`<agentDir>/bundled-skills/<版>/architecture-guards/SKILL.md` が書き出されることと、`/skill:architecture-guards` で手順が読み込まれることを確認する。検証: 両実行で同じ名前・説明がスキル一覧に現れ、起動応答がスタック検出から始まることを `openspec/changes/add-bundled-skills/smoke.md` に記録する
- [x] 4.2 spirits リポジトリで手順を最後まで実行し、依存方向の許可表(後段非依存)と上流差分の検査を生成する。差分の提示段階では `git status --porcelain` が変わらないことを確認し、承認後にだけ書き込む。あわせて次を記録する(verify2 W-4): 重複と継承の計測結果が提示されたこと、実測に現れない GoF パターン名や継承の制限が原案に含まれないこと、規約本文が正本 1 か所だけにあり検査と設定が規約 ID で参照していること。上記 3 点は smoke.md に未記録のまま完了扱いになっていた(verify2 再検証 C-2)。既存の生成物から確認して転記してよい: 計測結果は `/tmp/spirits-e2e/proposal.txt` の AG-006・AG-007 の根拠(重複の実測箇所、`extends` 5 辺・`implements` 6 辺・最大深さ 1)、正本 1 か所の確認は `/tmp/spirits-e2e/gen1/test/architecture-guards.test.ts` と `gen1/openspec-config.diff` が規約 ID とパスだけを参照していること。`/tmp` が消えていた場合は手順を再実行する。検証: 生成された検査が `bun test` または生成時に指定されたコマンドで実行でき、ベースラインで通過することと、上記 3 点の確認結果を smoke.md に記録する
- [x] 4.3 生成された依存方向検査と上流差分検査が違反を検出できることを確認する。他セッションの作業ツリーを壊さないよう、リポジトリの一時コピーまたは一時ディレクトリのフィクスチャで行う。値の import の違反に加えて、型のみの import(`import type`)だけの違反を入れたフィクスチャでも確認する(verify2 W-2)。検証: 違反を入れた場合に検査が非ゼロ終了し、型のみの import の違反が検出された出力を含めて smoke.md に記録する
- [x] 4.4 撤去と再実行の確認。生成物を一時コピー側で削除し、同じ入力から同じ検査が再生成できること(冪等)を確認する。検証: 2 回目の生成物がファイル構成・規約 ID・検査名・ベースライン・違反検出で初回と一致することを smoke.md に記録する(LLM による再生成のためバイト一致は求めない)

## 5. 手動 E2E: OpenSpec を使わない TypeScript リポジトリ

- [x] 5.1 `/tmp` に OpenSpec と AGENTS.md を持たない TypeScript リポジトリ(tsconfig + テストランナー)を作り、`/skill:architecture-guards` を実行して差分提示 → 承認 → 検査生成まで通す。別に、差分の提示後に承認しない場合も実行する(verify2 W-4)。承認しない場合は未実行のまま完了扱いになっていた(verify2 再検証 C-2)。`/tmp/spirits-e2e/fixture-ts` の生成前の状態を複製して差分の提示まで進め、承認を拒否する。検証: 生成された検査がそのリポジトリの test スクリプトで動作し、`openspec/config.yaml` が作成されず、OpenSpec を使っていない旨が伝わることを smoke.md に記録する。承認しない場合は `git status --porcelain` が実行前と同じで、中止した旨が伝わることを smoke.md に記録する
- [x] 5.2 非 TypeScript プロジェクトで `/skill:architecture-guards` を実行し、何も書き込まずに対象外の旨を伝えて終了することを確認する。別に、`tsconfig.json` が無く `.ts` が vendored ディレクトリにだけあるなど対象か判断できないプロジェクトでも実行し、利用者への質問が行われ、判断がつかないまま終了した場合は何も書き込まれないことを確認する(verify2 W-4)。判断できない場合は未実行のまま完了扱いになっていた(verify2 再検証 C-2)。フィクスチャは `tsconfig.json` を置かず、`.ts` を `vendor/` 配下にだけ置いた git リポジトリとし、質問には回答せずに終了する。検証: 実行前後で `git status --porcelain` が空であり、対象外の応答と、判断できない場合の質問と終了の応答を smoke.md に記録する
- [x] 5.3 注意点(検出できなかったスタック、質問が必要だった判断)を references へフィードバックする。検証: 反映した内容と理由を smoke.md に記録し、`bun test test/bundled-skills.test.ts` が引き続き成功する

## 6. README と設計書への追記

- [x] 6.1 `README.md` と `README.ja.md` に同梱スキル節を追加する。`bundled-skills/<版>/` の配置、利用者 `skills/` の同名スキルが優先されることと衝突警告、`SPIRITS_BUNDLED_SKILLS=0` での無効化、`/skill:architecture-guards` の起動を記載する。次の 2 点は現在の記述を直す(verify2 S-1, S-2)。(1) 旧版ディレクトリは、7 日以上使われなかった場合だけ書き出し時に削除される。(2) 新しい同梱内容の反映には spirits の再起動が必要で、`/reload` は実行中の版のツリーを書き出し直すだけである。検証: 記載したコマンドを隔離 HOME で実行し、記述どおりに動くことを確認する。README に「`/reload` で新しい内容を読み込む」という記述が残っていない
- [x] 6.2 `README.zh.md` と `README.de-CH.md` に同じ内容を各言語で追加する(6.1 の修正を含む)。検証: 4 つの README で節の見出しとキー情報(配置、上書き、無効化、起動方法、旧版の片付け、再起動と `/reload` の違い)が対応していることを確認する
- [x] 6.3 `docs/spirits-design.md` を更新する。§4.4 のスキル項目に同梱スキルの配置・供給・保護を追記し、§9 のディレクトリ構成に `harness/bundled-skills/` を追加する。§4.4 の「旧版ディレクトリは書き出し時に best-effort で削除し」を、7 日以上更新のない旧版だけを削除する記述に直し、保護の記述に `<agentDir>` が symlink 経由・相対パスの場合と `skills/` 自体が同梱を指す場合を含める。検証: 記載した配置と本 change の実装・specs の記述が一致する

## 7. 周辺の修正

- [x] 7.1 `packages/spirits/src/harness/paths.ts` 冒頭のコメント「pi の値を import する harness モジュールはここだけ」を実態に合わせる(`bundled-skills/index.ts` も `parseFrontmatter` を値として import している。verify2 G-3)。検証: コメントがその事実と一致し、`cd packages/spirits && bun run check` が成功する
- [x] 7.2 `packages/spirits/src/harness/paths.ts` の未使用の `isBundledSkillsPath` を削除する。実体パスに解決せずに比較するため、使うと symlink 経由の保護漏れ(初回 verify2 C-1)を再び招く(verify2 再検証 G-1)。検証: `rg -n "isBundledSkillsPath" packages/spirits/` が何も返さず、`cd packages/spirits && bun run check` が成功する

## Workflow follow-up

- verify2(2026-10-15)の指摘は次のタスクへ反映した。C-1 → 2.7、W-1 → 2.7、W-2 → 3.4・4.3、W-3 → 2.2・2.5・2.7、W-4 → 4.2・5.1・5.2、W-5 → 2.7(specs の `continual-harness` にシナリオ追加)、S-1 → 2.3・6.1・6.2・6.3(specs・design の Decision 5 を改訂)、S-2 → 6.1・6.2・6.3(design の Risk と Decision 9 を改訂)、S-3 → 2.3(specs を改訂)、G-1 → 2.7、G-2 → 1.3、G-3 → 7.1。
- verify2 再検証(2026-10-15、2 回目)の指摘は次のタスクへ反映した。C-1 → 2.7・2.9(specs の `bundled-skills` と `continual-harness` にシナリオ追加、design の Decision 7 と Risk を改訂)、C-2 → 4.2・5.1・5.2、W-1 → 2.3・2.9(design の Decision 5 に更新の順序を追記)、G-1 → 7.2・2.9。前回の C-1・W-1〜W-3・W-5・S-1〜S-3・G-1〜G-3 は解消済みで、W-4 は C-2 として引き継いだ。
- 上記の完了後、verify2 を再検証モードで実行し、CRITICAL と SPEC が 0 件であることを確認してからアーカイブする。
- アーカイブ時に `specs/bundled-skills`、`specs/architecture-guards`、`specs/continual-harness` を本仕様へマージする。
