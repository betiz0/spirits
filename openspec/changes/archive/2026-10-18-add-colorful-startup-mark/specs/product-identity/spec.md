# Spec Delta

## MODIFIED Requirements

### Requirement: TUI 起動ヘッダの spirits 化
対話モードの起動ヘッダは、最上部に spirits の ASCII アート、続いて spirits のワードマークとバージョン、キーヒント、spirits 自身のオンボーディング文をこの順で表示しなければならない。(SHALL)
pi のロゴと、pi を説明するオンボーディング文(例: "Pi can explain its own features ...")を表示してはならない。(MUST)

#### Scenario: ヘッダ表示
- **WHEN** コンパイル済み `spirits` を対話モードで起動する
- **THEN** 起動ヘッダの最上部に ASCII アートがあり、続いて `spirits` とバージョンが含まれ、`Pi can explain` を含む行は表示されない
