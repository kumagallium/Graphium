# 推論型ガイド

Graphium の AI Wiki は、ノートから知識を抽出するたびに「どんな推論をして得られた主張か」をメタデータとして付与します。本ドキュメントは、その推論型を「どこに何が住んでいるか」を整理するためのものです。学習教材として読んでも、メタデータの意味を確認するときに開いても構いません。

設計の根は、Graphium の砂時計モデルです: `Notes → Claim → Atom → Synthesis`。各層は文脈の濃度が異なり、推論型もそれぞれの層に固有の意味を持ちます。

---

## 全体像

| 層 | 操作 | 主な推論型 |
|---|---|---|
| Notes → Claim | 抽出 | claimRole（finding / decision / anomaly / question / setup / interpretation / issue）|
| Claim → Atom | **抽象化（induction を含む）** | atomType（causal / mechanistic / conditional / …）|
| Atom → Synthesis | **異質な要素の統合** | synthesisMode（deductive / abductive / analogical / dialectic）|

特筆点: **induction（帰納）は Synthesis ではなく Claim → Atom 段の中核操作** として位置付けています。理由は本ページ末尾「設計判断: induction は Atom 層に住む」を参照。

---

## Synthesis の 4 モード

Synthesizer は Atom（または Claim）を入力に取り、**heterogeneous な要素から新しい繋がりを立ち上げる**層です。同じパターンの反復から一般則を抽出する操作（=induction）は Synthesizer の仕事ではなく、Atomizer の仕事です。

### `deductive`（演繹）

- 構造: 独立した複数の Claim/Atom を入力 → それらから論理的に導かれる戦略・組み合わせを出力
- 例: 「A は X を示す」「B は Y を示す」「C は Z を示す」→「A・B・C を組み合わせると新しい方法 W が成り立つ」
- 哲学的源流: アリストテレス以来の演繹推論。前提が真なら結論も真。
- 限界: 前提のどれかが誤っていれば結論も崩れる。Synthesis に \`deductive\` を付けるときは前提の確度を確認する。

### `abductive`（アブダクション）

- 構造: 観測 Claim/Atom（何かが計測された）+ 既知則 Claim/Atom（メカニズムや原理）→ 観測を最もよく説明する仮説
- 例: 「Al5Co2 で異常な符号反転が観測された」+「2 バンド伝導はこういう現象を起こす」→「Al5Co2 のフェルミ近傍 DOS は 2 バンド構造を取っているのではないか」（仮説）
- 哲学的源流: パース（C. S. Peirce）。「最良の説明への推論」。**多くの「ひらめき」型 Synthesis はこれ。**
- 限界: 説明候補は無数にあるため、確度は本質的に \`speculative\`（推測的）。検証は別途必要。

### `analogical`（類推）

- 構造: 異なる領域の Claim/Atom の間にある **構造的写像** を発見し、片方のパターンを他方に転用
- 例: 「永続ストレージの背景メンテナンスは参照構造のフラグメンテーションを段階的に回復させる」（ソフトウェア領域）↔「生体組織のターンオーバーは老廃物を段階的に除去する」（生物領域）→ 両者を貫く転用仮説
- 哲学的源流: アリストテレスの類推、Gentner の structure-mapping theory。
- 限界: 表面的な類似で誤ったマッピングを引いてしまうリスクが高い。rationale に「どの要素がどの要素に対応するか」を明示すること。

### `dialectic`（弁証法的止揚）

- 構造: 同じ効果について **逆向きの主張をする** 2 つの Claim/Atom → 両者を含む上位枠組み
- 例: 「pH を上げると還元が遅くなる」+「pH を上げると還元が速くなる」→「pH 11 を境に律速段階が水酸化物脱離から電子移動に切り替わる」
- 哲学的源流: ヘーゲルの弁証法。テーゼ・アンチテーゼの止揚。
- 限界: 真に矛盾する Claim でないと適用できない。強調の違い程度を「対立」と誤認しないこと。

---

## なぜ induction は Synthesis モードに無いのか

初期設計（提案 v4 の最初の版）では、Synthesis に \`inductive\` モードを置いていました: 「3 件以上の Claim が同じパターンを示すとき、それを一般則化する」。

しかし実装を進める中で、Atomizer の役割定義をよく読むと:

> Atom: 複数の Claim にまたがって繰り返し現れる、文脈を削いだ単一アイデアを factor out した薄い substrate

これはまさに induction です。Atomizer は「N 個の Claim の共通抽象を M 個拾い上げる discovery 層」として動いていて、これは「複数の類似事例から一般則を立てる」と同じ操作になっています。

つまり、Synthesis-inductive と Atomizer が **同じ仕事をしようとしていた**。タクソノミーとして冗長で、ユーザーには「同じ操作なのに名前が違う 2 つの選択肢」を見せてしまっていました。

そこで PR-B4 で整理し:

- Synthesis のモードを 4 つ（deductive / abductive / analogical / dialectic）に絞る
- Induction は Atom 層の核心操作として位置付ける
- Atomizer プロンプトに **「induction-from-many（多くの類似事例から）」「lift-from-few（少数だが domain-lift で）」** の二経路を明示
- UI で Atom の「derived from N 件の Claim」表示で induction の事実が見える

設計判断としての含意:
- **Claim 層**: 文脈付きの個別事実
- **Atom 層 = くびれ**: 文脈を剥ぎ、複数事例を **一般則化** する場所。induction の操作はここで起きる
- **Synthesis 層**: 異質な要素を編んで **新しい繋がり** を立てる場所

induction と他の推論型（deduction / abduction / analogy / dialectic）は、もはや同列の「Synthesis モード」ではなく、**異なる層に住む別種の操作**である、というのが今の整理です。

---

## メタデータの読み方

各 Wiki ノートの WikiBanner に表示されるバッジは、本ページの語彙とそのまま対応しています。

- **Claim** のバッジ: `claimRole` の値（発見・観察 / 決定・選択 …）
- **Atom** のバッジ: `atomType` の値（因果 / 機構 …）
- **Synthesis** のバッジ: `synthesisMode` の値（演繹 / アブダクション / 類推 / 弁証法）

バッジが表示されないノートは、AI が型を推定できなかった or 該当しないと判断したノートです。後から手動で型を付ける UI は現状ありません（必要になれば追加する予定）。

---

## 参考

- 砂時計モデル: [`docs/CONCEPT.ja.md`](./CONCEPT.ja.md)
- データモデル: [`docs/DATA_MODEL.md`](./DATA_MODEL.md) §3.5 "Semantic types (Phase 1)"
- 提案 v4（社内設計メモ、`docs/internal/` 配下）: induction を Atom 層に移した一次理由
