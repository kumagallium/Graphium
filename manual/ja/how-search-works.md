# 検索のしくみ <Badge type="tip" text="v0.116.0 (2026-11-04) で追加" />

Graphium は、`⌘K` の Composer、ノート一覧、AI チャットなど、いくつかの場所でノートの中を探します。その裏では 3 つの探し方が動いています。**言葉で探す**、**意味で探す**、**記録した構造をたどる**、の 3 つです。このページでは、それぞれの考え方と、どこで使われているか、もとになった手法を簡単に説明します。

ここに出てくる仕組みは、どれもこの端末の中か、設定した AI モデルを通して動きます。索引はノートから作り直せる控えなので、消しても何も失われず、ノートを書き換えることもありません。

## 全体像

<figure class="search-diagram">
<svg viewBox="0 0 720 330" role="img" aria-label="3 つの探し方と、使われている場所。言葉で探す（全文の索引）は Composer、ノート一覧、チャットの最初の検索、じっくり調べる機能で使われる。意味で探す（埋め込み）はチャットの最初の検索とじっくり調べる機能で使われる。構造をたどる（ラベル・手順・つながり）は AI の構造の調べもので使われる。" style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <text x="110" y="24" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:12px">探し方</text>
    <text x="560" y="24" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:12px">使われている場所</text>
    <rect x="20" y="40" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="66" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">言葉で探す</text>
    <text x="110" y="86" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">全文の索引（BM25）</text>
    <rect x="20" y="132" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="158" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">意味で探す</text>
    <text x="110" y="178" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">埋め込み（bge-m3）</text>
    <rect x="20" y="224" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="250" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">構造をたどる</text>
    <text x="110" y="270" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">ラベル・手順・つながり（PROV）</text>
    <rect x="440" y="40" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="65" text-anchor="middle" style="fill:var(--vp-c-text-1)">⌘K Composer・ノート一覧</text>
    <rect x="440" y="110" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="135" text-anchor="middle" style="fill:var(--vp-c-text-1)">チャット: 最初の検索</text>
    <rect x="440" y="180" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="205" text-anchor="middle" style="fill:var(--vp-c-text-1)">チャット: じっくり調べる</text>
    <rect x="440" y="250" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="275" text-anchor="middle" style="fill:var(--vp-c-text-1)">チャット: AI が構造をたどる</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-1)">
    <path d="M200 64 L440 60"/><path d="M200 70 L440 130"/><path d="M200 76 L440 198"/>
    <path d="M200 160 L440 134"/><path d="M200 168 L440 202"/>
    <path d="M200 255 L440 270"/>
  </g>
  <text x="360" y="318" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">下の 2 つは「じっくり調べてから答える」（既定オフ）をオンにしたときだけ動きます。</text>
</svg>
</figure>

| 場所 | 何に当たるか | 探し方 |
|---|---|---|
| [`⌘K` の Composer](/ja/ai-chat-and-ask#composerk) | まずタイトル・見出し・ラベル・作者。続いてノート本文と素材の文字（画像から読み取った文字、PDF、Web ページ） | 言葉 |
| [ノート一覧](/ja/notes-and-editor)の検索欄 | タイトル、画像から読み取った文字、ノート本文 | 言葉 |
| [AI チャット](/ja/ai-chat-and-ask#choosing-what-grounds-the-answer)の最初の検索（**内部参照**・**外部参照**） | ナレッジページと、ノート・素材の短い断片 | 言葉＋意味を混ぜる |
| [AI チャットでじっくり調べてから答える](/ja/ai-chat-and-ask#letting-the-ai-search-again) | 最初の検索と同じ。言葉は AI が選ぶ | 言葉＋意味 |
| AI チャットで AI が構造をたどる | ラベルを付けた材料・道具・条件・出力、手順、ノートどうしのつながり | 構造 |

## 言葉で探す: 全文の索引（BM25）

ノートを保存すると、Graphium は本文を 600 字ほどの断片に分け、この端末の中の **全文の索引** に入れます。画像から読み取った文字（OCR）、PDF の本文、Web ページの抜粋も、同じ索引に入ります。検索のときは、それぞれの断片に **BM25** で点を付けます。その断片に何度も出てくる言葉ほど点が高く、どこにでも出てくる言葉ほど点が低くなる、という考え方です。多くの検索エンジンが何十年も使ってきた方法です。

日本語は言葉の間に空白がないので、ブラウザや OS に組み込まれた分かち書きの仕組みで言葉に分けます。長い言葉は 2 文字ずつの断片（熱電変換 → 熱電・電変・変換）でも入れておくので、切れ目がずれても当たります。

- **得意なこと:** 正確な名前。試料の ID、型番、化学式、人の名前など。
- **苦手なこと:** 同じものの言い換え（「乾燥庫」と「デシケーター」など）。
- **必要なもの:** なし。AI モデルもインターネットも要りません。

索引の中身は [設定 → ストレージ → 検索インデックス](/ja/settings) で見られます。

## 意味で探す: 埋め込み

**埋め込み**（embedding）は、文章を数字の並びに変える手法です。意味の近い文章どうしが近くに並ぶように変えるので、数字の近さで意味の近さを測れます。Graphium はナレッジページの節ごとに埋め込みを作っておき、AI に質問したときは質問も埋め込みにして、近い節を選びます。

デスクトップ版の既定の埋め込みモデル **bge-m3** は、この端末の中で動きます（最初に 1 回だけダウンロードします）。日本語と英語の両方を扱え、言語をまたいでも当たります。ほかのモデルとの比べ方は [検証の記録](/ja/evaluations/embedding-models) にあります。

- **得意なこと:** 言い換え。英語のノートを日本語で探すような、言語をまたぐ質問。
- **苦手なこと:** 正確な名前や数値。もっともらしく見えても、探していた言葉を含まないことがあります。
- **必要なもの:** 埋め込みモデル。無いときはこの部分を飛ばし、言葉の検索だけで動きます。

## 2 つを混ぜる: 順位の融合（RRF）

チャットの最初の検索は両方を動かし、2 つの順位表を **RRF**（reciprocal rank fusion、順位の逆数で混ぜる方法）で 1 つにまとめます。2 つの点数は尺度が違うので、点数そのものは使いません。それぞれの表での順位から 1 / (60 + 順位) を足し合わせます。両方で上位のものが先頭に来て、片方でしか見つからなかったものにも居場所が残ります。

<figure class="search-diagram">
<svg viewBox="0 0 720 230" role="img" aria-label="質問は言葉の検索と意味の検索に渡り、2 つの順位表を RRF でまとめる。ナレッジページは 1 つの枠に、ノートと素材の断片は別の枠に入れ、番号を付けて AI に渡す。" style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <rect x="20" y="90" width="120" height="44" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="80" y="117" text-anchor="middle" style="fill:var(--vp-c-text-1)">質問</text>
    <rect x="190" y="40" width="150" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="265" y="67" text-anchor="middle" style="fill:var(--vp-c-text-1)">言葉で探す（BM25）</text>
    <rect x="190" y="140" width="150" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="265" y="167" text-anchor="middle" style="fill:var(--vp-c-text-1)">意味で探す</text>
    <rect x="390" y="90" width="110" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-2)"/>
    <text x="445" y="117" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">RRF</text>
    <rect x="550" y="40" width="150" height="54" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="625" y="63" text-anchor="middle" style="fill:var(--vp-c-text-1)">ナレッジページ</text>
    <text x="625" y="81" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">2,000 字まで</text>
    <rect x="550" y="130" width="150" height="54" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="625" y="153" text-anchor="middle" style="fill:var(--vp-c-text-1)">ノートの断片</text>
    <text x="625" y="171" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">言葉だけ・1,600 字まで</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-2)">
    <path d="M140 105 L190 62"/><path d="M140 120 L190 162"/>
    <path d="M340 62 L390 105"/><path d="M340 162 L390 120"/>
    <path d="M500 105 L550 67"/>
    <path d="M340 70 C 450 70, 470 157, 550 157"/>
  </g>
  <text x="360" y="218" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">1 つずつ [#1]、[#2] … と番号を付けるので、AI が引用でき、リンクからそのページが開きます。</text>
</svg>
</figure>

このように、AI が記憶ではなくあなたのノートから答えられるよう、必要な断片を探して渡すやり方を **RAG**（retrieval-augmented generation、検索で補った生成）と呼びます。Graphium では断片に番号を付け、AI にその番号で引用させます。回答のリンクがノートに戻れるのは、このためです。

## 構造をたどる: 記録したもの

材料・道具・条件・出力にラベルを付けたり、手順を立てたり、ノートどうしをつないだりすると（[ラベルと来歴](/ja/labels-and-provenance)）、小さなグラフが記録されます。何を使い、どの手順で、何から何ができたか、というグラフです。Graphium は、来歴を書き表す Web の標準 **W3C PROV** に沿ってこれを書き残します。

言葉や意味の検索から見ると、これはただの文字です。グラフをたどると、別の種類の質問に答えられます。

- 「この炉を使った実験はどれ？」: 本文のどこかにある「炉」という語ではなく、付けたラベルで探します。
- 「その実験の手順と条件は？」: 手順を順番に、各手順でラベルを付けたものと一緒に読みます。
- 「この結果はどこから来た？」: そのノートの上流にあるノート・試料・元の資料をたどります。

たどれるのは、ラベルを付けたもの・つないだものだけです。ラベルの無い書き方は、言葉の検索に任せます。

### グラフを「貼る」のではなく「たどる」

AI にグラフを渡すよくあるやり方は、質問に近いノードをつながりごと見つけてまとめてプロンプトに貼り、絡まった全体を AI に読み解かせる方法です。Graphium はそうしません。記録したグラフを、AI が 1 歩ずつ **作業する場所** として扱います。

| | グラフを貼る | グラフをたどる（Graphium） |
|---|---|---|
| AI が受け取るもの | 近くのノードとつながりを、一度にまとめて | 1 回の調べものの結果、次にまた 1 回分 |
| 1 歩の形 | 「このノードの近く」という汎用の取り出し | 記録の意味に沿った調べもの。どのノートがその材料を **使った** か、どの手順が **前にあった** か、そのノートが何を **もとにした** か |
| 2 段の質問（「X を使った実験はどれで、温度は？」） | 貼られた塊の中から、AI が道筋を見つける必要がある | 1 回目で実験を見つけ、2 回目でその手順を読む |
| 答えの中の事実の出どころ | 貼った塊のどこか | 特定の調べものの結果。番号付きで引用される |

向きにも意味があります。手順が **使った** 材料と、手順が **生み出した** 試料は、グラフの上で隣り合っていても別物です。この 2 つを分けて調べれば、入力と出力を取り違えた答えを避けられます。そして AI が使う事実はすべて番号付きの結果として届くので、回答の一つひとつの主張を、もとのノートと照らし合わせて確かめられます。調べた道筋は、回答の下の **調べた手順** に残ります。

## AI に自分で調べてもらう（agentic search）

**じっくり調べてから答える**（[設定](/ja/settings) → AI → チャット）をオンにすると、AI に読み取り専用の道具が渡ります。検索し直す、ページを読む、そして上の構造の調べものです。どれを呼ぶかは AI が決めます。結果を見てから次の一手を選び、最後に答えます。考えることと動くことを交互に行うこの型は、**ReAct** という手法で知られています。この型で検索することは、**agentic search** と呼ばれています。

<figure class="search-diagram">
<svg viewBox="0 0 720 200" role="img" aria-label="AI が道具を選び、Graphium がこの端末の中で実行して結果を返す。AI は結果を見て、別の道具を呼ぶか、答えを書く。調べたことは回答の下に一覧で残る。" style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <rect x="30" y="70" width="130" height="50" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="95" y="100" text-anchor="middle" style="fill:var(--vp-c-text-1)">AI が道具を選ぶ</text>
    <rect x="240" y="70" width="170" height="50" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="325" y="93" text-anchor="middle" style="fill:var(--vp-c-text-1)">Graphium が実行</text>
    <text x="325" y="110" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">この端末の中で・読むだけ</text>
    <rect x="490" y="70" width="190" height="50" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-2)"/>
    <text x="585" y="100" text-anchor="middle" style="fill:var(--vp-c-text-1)">引用つきで答える</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-3)">
    <path d="M160 88 L240 88"/>
    <path d="M240 104 L160 104"/>
    <path d="M95 70 C 95 20, 585 20, 585 70"/>
  </g>
  <text x="200" y="82" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">呼ぶ</text>
  <text x="200" y="120" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">結果</text>
  <text x="340" y="30" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">答えられるだけ集まったら（5 回ほどまで）</text>
  <text x="360" y="170" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">調べている間は 1 行ずつ並び、回答の下の「調べた手順」にも残ります。</text>
</svg>
</figure>

「X を使った実験はどれで、温度は何度？」のような 2 段の質問にも答えられます。そのかわり、遅くなり、AI の利用量が増え、モデルが道具をうまく使えるかにも左右されます。くわしくは [じっくり調べてから答えてもらう](/ja/ai-chat-and-ask#letting-the-ai-search-again) を見てください。

## 出典

- **BM25**: S. E. Robertson, S. Walker, S. Jones, M. M. Hancock-Beaulieu, M. Gatford, "Okapi at TREC-3", *Proceedings of TREC-3*, NIST, 1995（[予稿集](https://trec.nist.gov/pubs/trec3/t3_proceedings.html)）。読みやすい解説: S. Robertson, H. Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", *Foundations and Trends in Information Retrieval*, 2009（[doi:10.1561/1500000019](https://doi.org/10.1561/1500000019)）
- **分かち書き**: Unicode Standard Annex #29 "Unicode Text Segmentation"（[unicode.org](https://www.unicode.org/reports/tr29/)）。ブラウザの分かち書きはこれに沿っています
- **埋め込み（bge-m3）**: J. Chen, S. Xiao, P. Zhang ほか, "M3-Embedding: Multi-Linguality, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation", 2024（[arXiv:2402.03216](https://arxiv.org/abs/2402.03216)）
- **RRF**: G. V. Cormack, C. L. A. Clarke, S. Buettcher, "Reciprocal rank fusion outperforms Condorcet and individual rank learning methods", *SIGIR 2009*（[doi:10.1145/1571941.1572114](https://doi.org/10.1145/1571941.1572114)）
- **RAG**: P. Lewis, E. Perez, A. Piktus ほか, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", *NeurIPS 2020*（[arXiv:2005.11401](https://arxiv.org/abs/2005.11401)）
- **来歴（PROV）**: W3C, "PROV-DM: The PROV Data Model", W3C 勧告, 2013（[w3.org/TR/prov-dm](https://www.w3.org/TR/prov-dm/)）
- **道具を呼びながら考える型**: S. Yao, J. Zhao, D. Yu ほか, "ReAct: Synergizing Reasoning and Acting in Language Models", *ICLR 2023*（[arXiv:2210.03629](https://arxiv.org/abs/2210.03629)）
