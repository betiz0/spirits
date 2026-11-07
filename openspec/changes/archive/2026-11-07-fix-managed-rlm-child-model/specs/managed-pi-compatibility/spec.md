# Spec Delta

## MODIFIED Requirements

### Requirement: rlm 子セッションの互換性
システムは、専用 Pi 上で rlm の子セッション生成を、物理モデル指定と `spirits/auto` 指定に分けて検証しなければならない。(SHALL)
物理モデルの子セッションは、生成、応答の取得、usage の記録、中断を個別に確認しなければならない。(SHALL)
`spirits/auto` を親が選択している場合の子セッションは、物理モデル指定の親と分けて結果を記録し、子の要求が物理モデルとして fake provider に届き、最終回答と usage が得られたときだけ成功として記録しなければならない。(SHALL)
子の要求が仮想モデルのまま届いた場合、その項目を成功として記録してはならず、failed として記録しなければならない。(MUST)
子が利用する認証・モデル設定を fixture として準備し、fixture の不足を製品不具合と断定してはならない。(MUST)
ランナーが子の対象にできる物理モデル(既定 provider、既定モデル、認証、モデル定義)を fixture に書いたのに、子の対象を解決できなかった場合、または子が完了しなかった場合は、解決エラーを含めて failed として記録しなければならない。(MUST) not-run として記録してよいのは、fixture が子の対象を用意していない場合と、provider へリクエストを送らない固定イベントの host の場合に限る。(SHALL)

#### Scenario: 物理モデルの子セッション
- **WHEN** fake provider を使い、物理モデルを選択した親から rlm を呼ぶ
- **THEN** 子セッションが生成され、最終回答と usage が記録され、中断も効く

#### Scenario: spirits/auto の子セッション
- **GIVEN** 親が選択できる `spirits/auto` に対して、既定モデルの物理モデルが fixture に揃っている
- **WHEN** 親が `spirits/auto` を選択した状態で rlm を呼ぶ
- **THEN** 子の要求がその物理モデルとして fake provider に届いたこと、最終回答、usage を根拠に状態が決まり、その根拠となったリクエストが記録される。子の要求が仮想モデルのまま届いた、または fixture が揃っているのに完了しなかった場合は failed として記録される

#### Scenario: 子の対象を解決できない spirits/auto の親
- **GIVEN** 親が `spirits/auto` を選択していて、子の対象にできる物理モデルが fixture に無い
- **WHEN** rlm を呼ぶ
- **THEN** その項目は not-run として、解決できなかった理由を記録し、成功にはならない

#### Scenario: fixture が揃っているのに子の対象を解決できない
- **GIVEN** ランナーが子の対象にできる物理モデルを fixture に書いていて、専用 Pi で親が `spirits/auto` を選択している
- **WHEN** rlm が子の対象を解決できないエラー(例: 子のモデルが無いことを名指すエラー)で終わる
- **THEN** その項目は failed として記録され、エラー文が detail に残る。not-run にはならない

#### Scenario: provider へリクエストを送らない host
- **GIVEN** 親が `spirits/auto` を選択していて、子へのリクエストもエラーも観測されない
- **WHEN** ホストが固定イベントで応答し provider へリクエストを送らない(fixture 実行)
- **THEN** 何を解決したかを読む手掛かりが無いので、その項目は not-run として記録される。専用 Pi の実行で同じ観測になった場合は、完了しなかったものとして failed として記録される

#### Scenario: 子の生成・回答・usage・中断の個別判定
- **WHEN** 物理モデルの子セッションを検証する
- **THEN** 生成、最終回答、usage、中断がそれぞれ別項目で記録され、いずれかが欠けても他の項目の成功に影響しない

#### Scenario: fixture 不足の記録
- **WHEN** 子の認証・モデル設定の fixture が不足している
- **THEN** その項目は not-run として記録され、製品不具合とは断定されない
