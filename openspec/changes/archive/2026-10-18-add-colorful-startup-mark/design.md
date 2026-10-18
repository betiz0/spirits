# Design

## Context

起動ヘッダは spirits の `packages/spirits/src/branding/header.ts` が pi の `ctx.ui.setHeader` で差し替えている。機構そのもの(セットタイミング、`quietStartup`、`setExpanded` による展開追従、色はテーマトークン)の正本は `docs/spirits-design.md` の製品 identity 節にあり、本書は重複を避けて差分だけを書く。

現在ヘッダに ASCII アートは無い。pi 由来のロゴも spirits のセッションでは表示されない。pi 側は `APP_NAME !== "pi"` のとき built-in ヘッダのマウントを session_start 後に延期し、カスタムヘッダが入っていればそれを使うため、削除作業はすでに入っている。

アートは 4 行・最長 14 文字(`.--------.` 10 / `| Spirits \__` 13 / `| __| --------` 14 / `| : ~~~~~` 9)。色は `header.ts` の `HeaderThemeColor` に列挙した語を `theme.fg()` に渡して適用する。

## Goals / Non-Goals

**Goals:**
- 起動ヘッダの最上部に Spirits の ASCII アートをカラー表示で追加する
- 4 行すべてに互いに異なるテーマカラーを割り当てる

**Non-Goals:**
- ASCII アートの形状変更(指定された 4 行をそのまま使う)
- バージョン表記やキーヒントのレイアウト変更(従来を維持)
- 狭い端末での行折返し、色を出せない端末での描画は対象外。検証は「描画がテーマのカラー解決に従う」ことまでで、色の見た目の優劣は検証しない

## Decisions

### Decision 1: ASCII アートを `SpiritsHeader.render()` の先頭行として追加する

**選択**: `SpiritsHeader.render()` が返す行配列の先頭にアート 4 行を追加し、以下をワードマーク行から続ける。折りたみ・展開の両状態で同じ 4 行を返す。

**理由**: `SpiritsHeader` はすでに `setHeader` API 経由でヘッダ出力を完全に制御している。pi コアの変更なしで、既存の分岐(expanded / collapsed)の両方に同じ先頭行を足すだけで実現できる。

**代替案**: 新しい header コンポーネントを作成して置き換える。既存 `SpiritsHeader` で十分で、差し替えは `installBrandingHeader` と既存テストの書き直しを増やすだけ。

### Decision 2: 4 行に 4 トークンを割り当てる

**選択**: 1 行目 `.--------.` を `border`、2 行目 `| Spirits \__` を `accent`、3 行目 `| __| --------` を `dim`、4 行目 `| : ~~~~~` を `muted`。

**理由**: ワードマークを含む 2 行目を `accent` で強調し、枠は色相の違う 1 色、しりの 2 行を灰系の階調に落とす。4 トークンはビルトインテーマの全カラーモードで別解になる(`Theme.fg()` の解決値実測)。

| カラーモード | `border` | `accent` | `dim` | `muted` |
|---|---|---|---|---|
| dark truecolor | 95,168,204 | 167,152,215 | 126,136,142 | 157,165,169 |
| dark 256 | 38;5;74 | 38;5;140 | 38;5;102 | 38;5;145 |
| light truecolor | 61,142,179 | 116,89,180 | 135,144,149 | 103,113,118 |
| light 256 | 38;5;67 | 38;5;97 | 38;5;102 | 38;5;60 |

**差し替えの記録(実装中に判明した不具合)**: 当初 1 行目は `borderAccent` だった。dark テーマで `accent` = okhsl(295 50% 67%) と `borderAccent` = okhsl(295 53% 64%) は truecolor でも ΔRGB(7,10,2) で知覚不能、256 カラーでは両方 `38;5;140` に同一化し、要件「4 つの行すべてが互いに異なるテーマカラー」を満たさなかった。`border` は上表のとおり全モードで別解で、pi の `ThemeColor` に既存の語のため差し替えた。この不具合はトークン名の相違だけを見るテストでは検出できないため、ビルトインテーマの解決後の色が別解であることもテストで検証する(tasks 1.6)。

**system テーマで色が重なる場合(spec で許容)**: 既定の system テーマは端末の報告色から生成され、`generateSystemThemeColors` の実測では次のとおり。端末が色を報告した後は 4 色別解。報告待ち(saturation 0)では `accent` と `muted` が同じ `#9f9f9f` で 3 色。背景色を報告しない端末では `dim` と `muted` がどちらも無色 + SGR 2 で 3 色。これはテーマのカラー解決に従った結果なので、`colorful-startup-mark` の Requirement で許容範囲として明記する(当初は design にのみ書いていたため、archive 後の spec が無条件の要求になっていた)。目視確認はカラーテーマを指定した端末で行う。

**代替案**: 全行 `accent`(色差 0 で spec 要求を満たさない)。既存 3 トークンのまま 1・2 行目を共有し色差 3 に落とす(要件「4 つの行すべてに互いに異なるテーマカラー」と衝突するため却下。緩める判断はしていない)。

### Decision 3: `HeaderThemeColor` に 4 種目のトークンを追加する

**選択**: `HeaderThemeColor` を `"accent" | "border" | "dim" | "muted"` に拡張する。pi の `ThemeColor` は `border` を既に持つので、spirits 側は許容語を 1 つ増やすだけで pi コアは変更しない。

**理由**: 要件は 4 行 4 色を要求するが、現行 union は 3 語で充足できない。4 語目を置く場所として、色解決の入口である `HeaderThemeColor` より下流に置くとテーマ追従を失う。

**代替案(継ぎ目を追加しない案)**:
- 3 トークンのまま spec を色差 3 に緩める。union は増えないが、「各行に異なるカラー」という要求そのものを下げる。
- `header.ts` の外側で ANSI シーケンスを直接組み立てる。テーマに追従せず、`Theme.fg()` を使う既存の規則も壊す。
- `SpiritsHeader` に色配列を渡す新 option を設ける。呼び出し側は `installBrandingHeader` 1 か所で、使われない設定面を増やす。

**対価**: 増える間接層は union の語 1 つと、`render()` 内の `theme.fg()` 呼び出し 4 行(`packages/spirits/src/branding/header.ts`)。解消されるのは、行ごとの色差を出すために ANSI を直書きする必要性と、spec「各行に異なるカラーを適用」を満たせない矛盾。

**撤回条件**: ユーザーテーマで 4 トークンが同一色に解決され色差が消える報告が続く場合、または行ごとの色差が不要になった場合は、union を 3 語に戻し、`colorful-startup-mark` の Requirement を「テーマカラーで行を区別する(色差 3 以下を許す)」へ改訂する。

### Decision 4: 仕様を 2 capability に分担する

**選択**: `colorful-startup-mark` はアート本体(4 行の内容)と行別カラーの規定に絞る。ヘッダ全体の構成(アート最上部 → ワードマーク+バージョン → キーヒント → オンボーディング)、`quietStartup` 時の非表示、起動ヘルプの展開追従は `product-identity` の要件が単独で規定する。

**理由**: 同じ挙動を 2 つの spec に書くと、一方を直したときにもう一方が古いまま残る。`quietStartup` と展開追従は product-identity が既に規定し、既存テスト "does not install when quietStartup is true" と "installs when quietStartup is header or unset" が検証済みなので、今回の新要件にしない(`quietStartup: "header"` は従来どおりヘッダを表示する)。

**代替案**: `colorful-startup-mark` に配置・展開・quietStartup の要求も並べる(archive 後に二重の正本ができる)。または新 capability を作らず product-identity に寄せる(色だけの改訂のたびに identity 要件全体を書き直すことになる)。

## Risks / Trade-offs

- [狭い端末でアートが行折返しする] → Non-Goals で対象外。アート行は最長 14 文字で `render()` は行配列を返す
- [ユーザーテーマで 4 トークンの色差が潰れる] → 色の優劣は検証せず、テーマのカラー解決に従うことだけを Scenario「テーマカラーに従う」で検証する。潰れて問題になる場合の撤回手順は Decision 3 の撤回条件
- [pi のテーマトークン名への依存] → 使う `border` は pi の `ThemeColor` に既存の語。トークン新設や pi コアへの変更は行わないため、上流マージで消える語を選ばない
- [トークンの解決色が見た目に近い] → Decision 2 の表として解決値を記録し、カラーモードごとに別解であることを `Theme.fg()` の出力でテストする(tasks 1.6)。
- [docs と spec でアート本文と行別トークンが二重になる] → `docs/spirits-design.md` は本文と割り当てを書かず `colorful-startup-mark` を参照する(Decision 4 と同じ理由)。近づく報告が続く場合の撤回手順は Decision 3 の撤回条件
