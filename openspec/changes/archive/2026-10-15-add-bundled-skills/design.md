# Design

## Context

- pi の拡張は `resources_discover` イベントで `skillPaths` を返せる(`packages/coding-agent/src/core/extensions/runner.ts`)。イベントは `session_start` の後、起動時 (`startup`) と `/reload` (`reload`) に発火する(`agent-session.ts`)。
- 返された skillPaths は既存のスキル探索パスへ追加マージされ、ローダーは最初に見つかった名前を採用し、同名の後続は衝突警告になる(`resource-loader.ts` の `mergePaths`、`skills.ts` の `loadSkills`)。デフォルト探索(利用者の `skills/`)が先頭に残るため、後から来る同梱版は同名の利用者版に負ける。
- pi はスキルを実ファイルパスとして読む。コンパイル済みバイナリは単一ファイルで、`packages/spirits` のファイルは実行時に存在しない。同梱物は起動時にどこかへ書き出す必要がある。
- agent dir は `~/.spirits/agent`(`SPIRITS_CODING_AGENT_DIR`)。M4 で `memory/`・`skills/`・`prompts/` の配置が決まっている(`docs/spirits-m4-harness.md`)。
- 実行時の版は `resolveSpiritsVersion()`(`SPIRITS_VERSION` をビルド時に define、ソース実行は `0.0.0-dev`)。
- M4 の code-mode プロンプトは TS 定数として同梱する前例がある(`src/harness/prompt.ts`)。
- 書き出し方式と上書きの探索順は未検証。スパイクで確認し `docs/spikes/bundled-skills.md` に記録する。方針の全体像は `docs/spirits-design.md` §4.4/§5、M4 設計は `docs/spirits-m4-harness.md` を参照し、ここでは繰り返さない。

## Goals / Non-Goals

**Goals:**
- 同梱スキルをインストール直後から使えるようにし、ソース実行とコンパイル実行で同じ内容を供給する。
- 利用者の `skills/` を同梱物から守り、利用者版を常に優先する。同梱ファイルを `spirits_skill_*` から保護する。
- 同梱スキルの有効/無効、版更新を単純な規則(env 1 つ、版ディレクトリ)で扱う。
- Pi コア差分ゼロで実現する。

**Non-Goals:**
- 同梱スキルをバイナリとは独立に更新する仕組み(内容はバイナリと同時にリリースする)。
- プロジェクト単位の無効化、`spirits_skill_list` への同梱スキル表示(既存挙動を変えない)。
- スキルの自動生成・品質評価。
- `architecture-guards` が対象外プロジェクト(TypeScript を使わない)で動くこと。

## Decisions

### Decision 1: 置き場所は `<agentDir>/bundled-skills/<版>/` とし、`resources_discover` で供給する
`<agentDir>/bundled-skills/<spirits 版>/<スキル名>/` へファイル一式を書き出し、その版ディレクトリを `resources_discover` の `skillPaths` で返す。`<agentDir>/skills/` には置かない。

理由: 実ファイルが必要という pi の制約を満たしつつ、同梱物と利用者物をディレクトリ境界で分離できる。`skills/` に置くと、利用者の `spirits_skill_delete` や手編集の対象に同梱物が入り、上書きと保護が曖昧になる。

代替案(継ぎ目を増やさない): 同梱せず、README と install.sh で `skills/` への配置を案内する。実行時機構は不要だが、利用者が配置するまで使えず「インストール直後から使える」を満たさない。

代替案: `<agentDir>/skills/.bundled/<版>/` に置く。ルートが 1 つで済むが、pi のスキル探索は再帰的で、`skills/` 配下に置く限り利用者領域の管理対象に近い。

撤回条件: スパイクで `resources_discover` 経由の供給または利用者版の優先が成立しない場合は、配置と供給方式を再判断する(Decision 3 の代替へ)。

### Decision 2: 同梱内容は Markdown のまま Bun のアセット import で取り込む
同梱コンテンツは `packages/spirits/src/harness/bundled-skills/<name>/` 配下の実 Markdown ファイルとして持ち、Bun のアセット import(`import content from "./SKILL.md" with { type: "text" }`)で文字列として取り込んで書き出す。スパイクで `type: "text"` がコンパイル済みバイナリで動かない場合は `Bun.build` の `compile.assets` と `import.meta.dir` で読み出す方式、それも不可なら TS 定数へ切り替える。

理由: `SKILL.md` はコードフェンス(バッククォート)と `${}` を大量に含む。TS テンプレートリテラルではエスケープが壊れやすい。Markdown を実ファイルとして保てば、レビュー・diff・構文ハイライトがそのまま使える。コンパイル時には内容が文字列としてインラインされ、実行時に `$bunfs` を読む必要がない。

代替案(継ぎ目を増やさない): M4 の code-mode プロンプトと同じく TS 定数で持つ。ビルド設定と型宣言の追加が不要で前例がある。欠点はエスケープと複数ファイル管理。

代替案: ビルド時に Markdown から TS 定数を生成する。実ファイルとコードの両方を保てるが、生成ステップという継ぎ目と drift が増える。

撤回条件: スパイクでアセット import がソース実行・コンパイル実行・`bun test` のいずれかで動かない、または型検査の負担が無視できない場合は TS 定数方式へ戻す。

### Decision 3: 上書きの優先順位は pi のローダーに委ねる
拡張が返す skillPaths はデフォルト探索より後ろにマージされ、ローダーは先勝ちなので利用者の同名スキルが採用される。衝突警告は pi の診断に任せる。

理由: 新しい判定機構を足さず、pi の既存意味論(先勝ち + 衝突警告)と一致する。

代替案: 供給前に `<agentDir>/skills/<name>/SKILL.md` の存在を確認し、同名を供給対象から除外する(filter)。優先順位を実装側で確定でき警告も出ないが、`skills/` の読み取りと名前照合という結合が増える。

撤回条件: スパイクで探索順が期待どおりでない、または警告が実用上ノイズになる場合は filter へ切り替える。pi のローダー順序が変わった場合(上流追従時)も再確認する。

### Decision 4: 無効化は環境変数 `SPIRITS_BUNDLED_SKILLS=0`
未設定または `0` 以外は有効、`0` のみ無効。無効時は書き出しも供給もしない。

理由: 既存の spirits 設定は環境変数方式(`SPIRITS_MEMORY_*` / `SPIRITS_TODO_*`)で、`config.ts` と同じ読み取りで済む。セッション開始前に確定できる。

代替案: `settings.json` の spirits キー。プロジェクト単位で切り替えられるが、pi の設定読み込みを harness から参照する新しい継ぎ目が増える。

代替案: 無効化手段なし。同梱スキルを望まない利用者が回避できず、要件を満たさない。

撤回条件: プロジェクト単位の制御要求が出たら、settings.json を読む方式を別 change で追加する。

### Decision 5: 供給は現行版のみとし、現行版の更新時刻を書き出しのたびに更新して、7 日以上更新のない旧版だけを起動時に best-effort で削除する
ディレクトリ名は `resolveSpiritsVersion()` の値。書き出しのたびに(内容が同一で書き込みを省く場合も)現行版ディレクトリの mtime を現在時刻に更新する。あわせて `bundled-skills/` 直下の現行版以外のディレクトリのうち、mtime から 7 日以上経過したものを削除し、7 日未満のものは残す。削除失敗は起動を妨げない。供給するのは常に現行版ディレクトリのみ。ソース実行は `0.0.0-dev` 固定。

問題: 現行版以外を無条件に削除すると、別の版が並行して動いているときにその版のツリーを消す。pi は `/skill:<name>` の展開時に、起動時に覚えたパスの `SKILL.md` をその場で読む(`agent-session.ts` の `_expandSkillCommand`)ため、消えると展開に失敗する。

例: 0.5.0 のセッション A が動いている間に、更新後の 0.6.0 でセッション B を起動する。B の書き出しが `bundled-skills/0.5.0/` を削除すると、A の `/skill:architecture-guards` は ENOENT になり、スキルの本文がモデルに渡らない。A で `/reload` すると、今度は A が `0.6.0/` を削除する。ソース実行(`0.0.0-dev`)と配布バイナリが同じ agentDir を共有する場合も、起動のたびに互いの版を消し合う。

解決: 削除の条件を「現行版以外」から「現行版以外で、7 日以上更新のない版」に変え、現行版は書き出し(起動と `/reload`)のたびに mtime を更新する。動いている版のツリーは、その版が最後に書き出されてから 7 日以内は他の版の起動で消えない。mtime の更新と猶予日数は並行セッションの保護に必要な部分。猶予日数を設定項目にすることは必須ではないので、定数にとどめる。

更新の順序: 現行版ディレクトリの mtime は、ファイルの書き出しより前に更新する。問題: ファイルの同一判定の後に更新すると、それまでの間は mtime が古いまま残る。例: `0.5.0/` の mtime が 8 日前の状態で 0.5.0 と 0.6.0 を同時に起動すると、0.5.0 側が mtime を更新する前に、0.6.0 側が古い mtime を見て `0.5.0/` を削除しうる。0.5.0 側は消えたディレクトリを `skillPaths` として返し、そのセッションでは `/reload` まで同梱スキルが使えない。解決: 先に mtime を更新すれば、片付け側が古い mtime を見るのは、起動した側が更新するまでのごく短い間に限られる。影響は 1 セッションで `/reload` で回復するため、ロックによる完全な排他は入れない。

理由: `spirits update` はバイナリを置換するだけなので、次回起動時に新しい版が書き出される。旧版を残し続けるとディレクトリが増え続けるため、使われなくなった版だけを時間で片付ける。供給対象を現行版に限定するので、旧版が残っていても古い内容は使われない。

代替案: 旧版を残し、供給だけ現行版に限定する。破壊的な削除を避けられるがディスクが増える。

代替案: 旧版を mtime の新しい順に最大 N 件残す。ディスクの上限は付くが、並行して動く版の数が N を超えると消える。判定が版の数に依存する。

代替案: 現行版以外を即時削除する(当初案)。実装は最も単純だが、上記の並行セッションが壊れる。

代替案: 単一ディレクトリ `bundled-skills/current/` を上書きする。版の区別がなく、書き込み途中のクラッシュで壊れた内容が残り得る。

撤回条件: 版ディレクトリ内の利用者編集が消えたという報告が出たら削除をやめ、残す方式へ切り替える。
補足: 版文字列が空、`.`、`..`、または `[A-Za-z0-9._+-]` 以外の文字を 1 つでも含む場合、版ディレクトリ名を `dev` に置き換えてパス脱出を防ぐ(`..` を通すと版ディレクトリが agentDir 自体になる)。

### Decision 6: 書き出しは冪等・原子的にし、失敗時は供給しない
内容が既存と同一のファイルは書かない。更新は同一ディレクトリ内の一時ファイルへ書いて rename する。いずれかの書き出しに失敗したら、そのセッションでは skillPaths を返さず、例外をセッション開始へ伝播させない。

理由: 部分的なスキルディレクトリを供給すると、frontmatter の欠けたスキルが読み込まれうる。全成功か供給なしのどちらかに倒す。rename により読み手が部分書き込みを見ない。

代替案: 常に全書き換えし、失敗は pi の拡張エラーに任せる。実装は簡単だが原因が分かりにくい診断になる。

撤回条件: 書き出し失敗が実運用で観測されず、一時ファイル方式の複雑さが問題になった場合は直接 `writeFile` に簡素化する。

### Decision 7: `spirits_skill_*` は同梱ディレクトリを指す書き込みを拒否する
`saveSkill` は書き込み先の実体パス(`realpath`)を、同梱 root(`<agentDir>/bundled-skills/`)の実体パスと比較し、配下を指す場合はエラーにする。比較する両側を実体パスにそろえる。`deleteSkill` は `lstat` で判定し、対象が symlink の場合(リンク切れを含む)はリンクだけを `unlink` する。symlink でない場合も、実体パスが同梱 root 配下ならエラーにする。それ以外の通常ディレクトリは従来どおり `rm -r`。

理由: スキル名は `^[a-z0-9]+(-[a-z0-9]+)*$` に検証済みでパス脱出はないが、`skills/<name>` を同梱ディレクトリへの symlink にすると `writeFile` がリンクをたどって同梱物を書き換える。この経路を塞がないと「同梱ファイルを変更・削除しない」を満たせない。

両側を実体パスにそろえる理由: `realpath(target)` だけを解決し、解決していない `bundledSkillsDir(agentDir)` と前方一致で比べると、`<agentDir>` が symlink を経由する場合に一致しない。例: `~/.spirits` が `~/dotfiles/spirits` への symlink のとき、リンク先の実体は `~/dotfiles/spirits/agent/bundled-skills/...` で、比較対象の `~/.spirits/agent/bundled-skills` と前方一致せず、保存が通って同梱 `SKILL.md` を書き換える。`SPIRITS_CODING_AGENT_DIR` が相対パスの場合も同じ(実体は絶対パス、比較対象は相対パス)。同梱 root も `realpath` で解決すれば、どちらの形でも同じ絶対パスで比べられる。同梱 root がまだ存在しない場合は、同梱物がないので拒否の対象にならない。

書き込み先がまだ無い場合も判定が要る理由: `realpath` は存在しないパスで ENOENT になる。ENOENT を「同梱配下ではない」と扱うと、新しい名前の保存が素通りする。例: `skills/` が `bundled-skills/1.0.0/` への symlink のとき、新しい名前 `my-skill` を保存すると、`skills/my-skill` はまだ無いので比較できない。続く `mkdir` と `writeFile` がリンクをたどり、`bundled-skills/1.0.0/my-skill/SKILL.md` を作る。版が変わって 7 日経つと、このスキルは片付け(Decision 5)で消える。解決: 書き込み先が存在しない場合は、存在する最も近い祖先を `realpath` で解決し、残りのパス要素をつないだ実体パスで比較する。

delete にも実体パスの比較が要る理由: `skills/` 自体が同梱の版ディレクトリへの symlink の場合、`skills/<name>` は symlink ではない実ディレクトリに見える。`lstat` だけでは symlink と判定されず、`rm -r` が同梱物を消す。

代替案: symlink のディレクトリを save 対象から一律拒否する。同梱以外への symlink(dotfiles 管理)を壊すため不採用。

代替案: symlink を検出してリンク自体を通常ディレクトリへ置き換える。利用者意図を壊すため不採用。

撤回条件: symlink 経由の上書きが起きないと利用者が判断した場合はガードを外して単純化する。

### Decision 8: `architecture-guards` は手順を SKILL.md、考え方を references/ に分ける
`SKILL.md` は 7 手順(スタック検出 → import 依存の実測と許可表原案の確認 → 重複・継承の計測 → 利用者テストランナーで動く検査の生成 → OpenSpec rules 追記案 → 規約正本 → 差分提示と承認後の書き込み)に絞る。詳細は `references/principles.md`(統制対象の両方向、CI と人間レビューの分担、正本 1 か所、導入前後の成果指標比較)、`references/convention-registry.md`(規約正本の書式: 規約ID・強度・内容・例外・判定方法・根拠)、`references/check-generation.md`(依存方向検査、重複計測、型のみ import の AST 判定、OpenSpec rules 追記)へ置く。

理由: SKILL.md は起動時に全文が読まれる。判断に必要な手順だけを置き、詳細は pi の段階読み込みで必要なときだけ読ませる。

代替案: すべて SKILL.md に置く。参照の手間は減るが起動時コンテキストを消費し、考え方の更新と手順の更新が分離できない。

撤回条件: references が読まれず手順の実行が不安定なら、最小限の内容を SKILL.md へ戻す。
補足: 対象判定は「`tsconfig.json` がある、または `.ts`/`.tsx` ソースがある」。どちらでも判断できない場合は利用者に質問し、判断がつかないまま終了する(何も書き込まない)。型のみの import は TS の AST/コンパイラ API で判定する(`Bun.Transpiler#scanImports` は `import type` を返さないため使わない。Bun 1.4.2 で確認済み)。

### Decision 9: 配線は `resources_discover` ハンドラ内で書き出しと供給を完結させる
`index.ts` から `registerBundledSkills(pi, { agentDir, env })` を呼ぶ。ハンドラは `startup` / `reload` の各回で書き出しを行い、全ファイルの成功時だけ現行版ディレクトリを返す。

理由: pi は起動時と `/reload` の両方でイベントを発火する。1 か所で完結すると `/reload` での再書き出し漏れがない。`/reload` で行われるのは、実行中の spirits が持つ現行版の内容の書き出し直し(欠けたファイルの復元と、現行版の更新時刻の更新)であり、新しい版の内容は反映されない。同梱内容は実行ファイルに埋め込まれているため、新しい内容の反映には spirits の再起動が必要。

代替案: `session_start` で書き出し、`resources_discover` はパスを返すだけ。イベント順序に依存した 2 段構成になり、`/reload` の扱いが漏れやすい。

撤回条件: イベント順序や reload の挙動が変わった場合。

### Decision 10: Pi コアは変更しない
既存の `resources_discover`・スキルローダー・`formatSkillsForPrompt` のみを使う。スパイクでコア変更が必要と判明した場合は、理由・最小パッチ・代替案をこの design に追記し、`[spirits]` プレフィックスの独立コミットに分離する。

## Risks / Trade-offs

- [Risk] コンパイル済みバイナリでアセット import が動かず、スキル内容が空で書き出される → Mitigation: スパイクで `bun build --compile` したバイナリからの書き出しとスキル一覧表示まで確認。失敗時は Decision 2 の代替(compile.assets → TS 定数)へ。
- [Risk] pi のローダーの探索順が上流追従で変わり、同梱版が利用者版を上書きする → Mitigation: 上書きの優先順位を `bun test` で固定。崩れたら Decision 3 の filter 方式へ切り替え、上流追従の確認項目に加える。
- [Risk] `bundled-skills/` の片付けが利用者のファイルを消す → Mitigation: 削除対象は `bundled-skills/` 直下の、現行版以外で 7 日以上更新のないディレクトリに限定し、現行版は残す。`bundled-skills/` は spirits の管理領域であり利用者がファイルを置く場所ではない旨を README に記載する。誤削除の報告が出たら Decision 5 の「残す」方式へ。
- [Risk] 同梱スキルを更新しても、起動中のセッションは古い内容を読む → Mitigation: 同梱内容は実行ファイルに埋め込まれているため、新しい内容の反映には spirits の再起動が必要になる。`/reload` は実行中の版のツリーを書き出し直すだけで、新しい内容にはならない。この点を README に記載する。
- [Risk] 別の版のセッションが動いている間に、その版のツリーが片付けで消える → Mitigation: Decision 5 の 7 日の猶予と、書き出しのたびの現行版の mtime 更新。残る制約: `/reload` も再起動もせずに 7 日を超えて動き続けるセッションの版は、他の版の起動で消えうる。消えた場合は、そのセッションで `/reload` すると書き出し直される。
- [Risk] `architecture-guards` が生成する検査の品質がリポジトリごとにばらつく → Mitigation: 手動 E2E を 2 系統(spirits 自身、OpenSpec 非使用の TypeScript リポジトリ)で実施して記録し、規約正本と検査の書式を references で固定する。
- [Risk] 同名の利用者スキルがあると起動時に衝突警告が出て、利用者が混乱する → Mitigation: 警告は「利用者版が採用された」ことの通知として README に記載する。
- [Risk] `spirits_skill_delete` の symlink 削除で、Node/Bun の `rm` の挙動がリンク先へ及ぶ → Mitigation: `lstat` で symlink を判定して `unlink` する実装にし、テストで同梱物が残ることを確認する。
- [Risk] `<agentDir>` が symlink を経由する場合、相対パスの場合、`skills/` 自体が同梱を指す場合に、save / delete の保護をすり抜ける → Mitigation: 実体パス同士で比較し、書き込み先がまだ無い場合(`skills/` 自体が同梱を指す状態での新しい名前の保存)は、最も近い既存の祖先の実体パスで比較する(Decision 7)。各構成をテストで固定する。

## Migration / Compatibility

- 既存の `skills/`・`memory/`・`prompts/` の内容は移動しない。`bundled-skills/` を新設するだけ。
- ロールバックは旧バイナリの再配置で行う。旧版ディレクトリは次回起動時に再書き出しされる。
- 無効化は `SPIRITS_BUNDLED_SKILLS=0`。既定は有効で、既存利用者のスキル一覧に追加分が現れる(破壊的変更ではない)。

## Open Questions

- `spirits_skill_list` が同梱スキルも返すべきか。現状は `skills/` のみで、本 change では変えない。利用者からの要望が出たら別 change で検討する。
- 同梱スキルを追加するたびに版ディレクトリの総量が増える。1 版あたりのサイズが問題になった場合、スキル単位の部分供給を検討する。
