# How search works <Badge type="tip" text="Added in v0.116.0 (2026-11-04)" />

Graphium finds things in your notes in several places — the `⌘K` Composer, the note list, and the AI chat. Behind them are three ways of looking: **by words**, **by meaning**, and **by the structure you recorded**. This page explains each one briefly, where it runs, and where the idea comes from.

Everything here runs on your device or through the AI model you set up. The indexes are caches built from your notes; deleting them loses nothing, and they never change your notes.

## The big picture

<figure class="search-diagram">
<svg viewBox="0 0 720 330" role="img" aria-label="Three ways of searching and where each is used. Words (the full-text index) feed the Composer, the note list, the chat's first search and the AI's own searches. Meaning (embeddings) feeds the chat's first search and the AI's own searches. Structure (labels, steps, links) feeds the AI's structural lookups." style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <text x="110" y="24" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:12px">How it looks</text>
    <text x="560" y="24" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:12px">Where you see it</text>
    <rect x="20" y="40" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="66" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">By words</text>
    <text x="110" y="86" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">full-text index (BM25)</text>
    <rect x="20" y="132" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="158" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">By meaning</text>
    <text x="110" y="178" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">embeddings (bge-m3)</text>
    <rect x="20" y="224" width="180" height="62" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="110" y="250" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">By structure</text>
    <text x="110" y="270" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">labels, steps, links (PROV)</text>
    <rect x="440" y="40" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="65" text-anchor="middle" style="fill:var(--vp-c-text-1)">⌘K Composer · note list</text>
    <rect x="440" y="110" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="135" text-anchor="middle" style="fill:var(--vp-c-text-1)">Chat: the first search</text>
    <rect x="440" y="180" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="205" text-anchor="middle" style="fill:var(--vp-c-text-1)">Chat: the AI searches again</text>
    <rect x="440" y="250" width="240" height="40" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="560" y="275" text-anchor="middle" style="fill:var(--vp-c-text-1)">Chat: the AI follows the structure</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-1)">
    <path d="M200 64 L440 60"/><path d="M200 70 L440 130"/><path d="M200 76 L440 198"/>
    <path d="M200 160 L440 134"/><path d="M200 168 L440 202"/>
    <path d="M200 255 L440 270"/>
  </g>
  <text x="360" y="318" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">The last two only run when "Research before answering" is on (off by default).</text>
</svg>
</figure>

| Where | What it matches | How it looks |
|---|---|---|
| [`⌘K` Composer](/ai-chat-and-ask#the-composer-k) | Titles, headings, labels and authors first; then the words in note bodies and in materials (text read from images, PDFs, web pages) | Words |
| [Note list](/notes-and-editor) search box | Titles, text read from images, and note bodies | Words |
| [AI chat](/ai-chat-and-ask#choosing-what-grounds-the-answer) — the first search (**Internal** / **External**) | Knowledge pages, plus short passages from notes and materials | Words + meaning, merged |
| [AI chat — the AI searches again](/ai-chat-and-ask#letting-the-ai-search-again) | The same as the first search, with words the AI picks | Words + meaning |
| AI chat — the AI follows the structure | Labeled materials, tools, conditions and outputs; steps; links between notes | Structure |

## By words: the full-text index (BM25)

When you save a note, Graphium cuts it into passages of about 600 characters and adds them to a **full-text index** on your device. Text read from images (OCR), PDF text, and web-page excerpts go into the same index. A search scores each passage with **BM25**: a word counts for more when it appears often in that passage, and for less when it appears everywhere. This is the method most search engines have used for decades.

Japanese has no spaces between words, so Graphium splits it with the word breaker built into the browser and operating system. Longer words are also stored as two-character pieces (熱電変換 → 熱電 · 電変 · 変換), so a search still matches when a word is split differently.

- **Good at:** exact names — a sample ID, a model number, a chemical formula, a person.
- **Weak at:** different wording for the same thing ("dry box" vs "desiccator").
- **Needs:** nothing — no AI model, no internet.

You can see what is in the index in [Settings → Storage → Search index](/settings).

## By meaning: embeddings

An **embedding** turns a piece of text into a list of numbers, placed so that texts with similar meaning end up close together. Graphium embeds each section of your knowledge pages and, when you ask the AI something, embeds the question too, then picks the closest sections.

On the desktop app the default embedding model, **bge-m3**, runs on your device (it is downloaded once). It handles Japanese and English and can match across them. How it compares with other models is in [Which embedding model finds the right passage?](/evaluations/embedding-models), and how much memory it uses while it works is in [Why the desktop app ate 11 GB while tidying up](/evaluations/embedding-memory).

- **Good at:** different wording, and questions in one language about notes in another.
- **Weak at:** exact names and numbers; results can look plausible without containing the word you meant.
- **Needs:** an embedding model. Without one, this part is simply skipped and the word search still works.

## Merging the two: reciprocal rank fusion

The chat's first search runs both, then merges the two ranked lists with **reciprocal rank fusion (RRF)**. RRF ignores the raw scores — which are on different scales — and adds up 1 / (60 + rank) from each list. A passage near the top of both lists comes first; one that only one list found still gets a place.

<figure class="search-diagram">
<svg viewBox="0 0 720 230" role="img" aria-label="The question goes to the word search and the meaning search; their ranked lists are merged by RRF; knowledge pages go into one block and note and material passages into another, both handed to the AI with numbers." style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <rect x="20" y="90" width="120" height="44" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="80" y="117" text-anchor="middle" style="fill:var(--vp-c-text-1)">Your question</text>
    <rect x="190" y="40" width="150" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="265" y="67" text-anchor="middle" style="fill:var(--vp-c-text-1)">By words (BM25)</text>
    <rect x="190" y="140" width="150" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="265" y="167" text-anchor="middle" style="fill:var(--vp-c-text-1)">By meaning</text>
    <rect x="390" y="90" width="110" height="44" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-2)"/>
    <text x="445" y="117" text-anchor="middle" style="fill:var(--vp-c-text-1);font-weight:600">RRF</text>
    <rect x="550" y="40" width="150" height="54" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="625" y="63" text-anchor="middle" style="fill:var(--vp-c-text-1)">Knowledge pages</text>
    <text x="625" y="81" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">up to 2,000 chars</text>
    <rect x="550" y="130" width="150" height="54" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="625" y="153" text-anchor="middle" style="fill:var(--vp-c-text-1)">Note passages</text>
    <text x="625" y="171" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">words only · up to 1,600</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-2)">
    <path d="M140 105 L190 62"/><path d="M140 120 L190 162"/>
    <path d="M340 62 L390 105"/><path d="M340 162 L390 120"/>
    <path d="M500 105 L550 67"/>
    <path d="M340 70 C 450 70, 470 157, 550 157"/>
  </g>
  <text x="360" y="218" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">Each item is numbered [#1], [#2] … so the AI can cite it and the link opens the page.</text>
</svg>
</figure>

Handing the AI the passages it needs, so it answers from your notes instead of from memory, is called **retrieval-augmented generation (RAG)**. In Graphium, the passages carry numbers, and the AI cites them: that is how the links in an answer point back to your notes.

## By structure: what you recorded

When you label a material, tool, condition or output, mark steps, or link one note to another ([Labels & provenance](/labels-and-provenance)), you record a small graph: what was used, in which step, and what came from what. Graphium writes this down following **W3C PROV**, the web standard for describing provenance.

A word or meaning search sees this only as text. Following the graph answers different questions:

- "Which runs used this furnace?" — by the label, not the word "furnace" somewhere in the text.
- "What were the steps and conditions of that run?" — the steps in order, with what was labeled in each.
- "Where did this result come from?" — the notes, samples and source files upstream of a note.

These lookups only see what you labeled and linked. An unlabeled mention is left to the word search.

### Walking the graph instead of pasting it

A common way to give an AI a graph is to find the nodes near your question and paste them, with their links, into the prompt — and let the AI make sense of the tangle. Graphium does something different: it treats your recorded graph as a place the AI **works in**, one step at a time.

| | Pasting the graph | Walking the graph (Graphium) |
|---|---|---|
| What the AI receives | A block of nearby nodes and links, all at once | The result of one lookup, then the next |
| How the steps are shaped | Generic "neighbors of this node" | Lookups that follow what the record means: which notes *used* a material, which steps *came before*, what a note was *built from* |
| Two-step questions ("which runs used X, and at what temperature?") | The AI has to spot the path in the pasted block | One lookup finds the runs, the next reads their steps |
| Where each fact in the answer comes from | Somewhere in the pasted block | A specific lookup result, cited with its number |

The direction matters. A material that a step **used** and a sample that a step **produced** are different things, even when they sit next to each other in the graph; a lookup that keeps them apart avoids answers that mix up inputs and outputs. And because every fact the AI uses arrives as a numbered result, you can check each claim in the answer against the note it came from — and see the whole trail under **How the AI looked it up**.

## Letting the AI look things up itself (agentic search)

With **Research before answering** on ([Settings](/settings) → AI → Chat), the AI gets read-only tools — searching again, reading a page, and the structural lookups above — and decides which to call. It looks at each result before choosing the next step, then answers. This pattern of alternating reasoning and actions is known from **ReAct**; using it to search is often called **agentic search**.

<figure class="search-diagram">
<svg viewBox="0 0 720 200" role="img" aria-label="The AI chooses a tool, the app runs it on your device and returns the result, the AI looks at it and either calls another tool or writes the answer. Each lookup is listed under the answer." style="width:100%;height:auto;font-family:inherit">
  <defs><marker id="hsw-arrow-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
  <g style="font-size:13px">
    <rect x="30" y="70" width="130" height="50" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
    <text x="95" y="100" text-anchor="middle" style="fill:var(--vp-c-text-1)">AI picks a tool</text>
    <rect x="240" y="70" width="170" height="50" rx="8" style="fill:var(--vp-c-bg);stroke:var(--vp-c-divider)"/>
    <text x="325" y="93" text-anchor="middle" style="fill:var(--vp-c-text-1)">Graphium runs it</text>
    <text x="325" y="110" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">on your device, read-only</text>
    <rect x="490" y="70" width="190" height="50" rx="8" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-2)"/>
    <text x="585" y="100" text-anchor="middle" style="fill:var(--vp-c-text-1)">Answer, with citations</text>
  </g>
  <g style="stroke:var(--vp-c-text-3);fill:none;stroke-width:1.2" marker-end="url(#hsw-arrow-3)">
    <path d="M160 88 L240 88"/>
    <path d="M240 104 L160 104"/>
    <path d="M95 70 C 95 20, 585 20, 585 70"/>
  </g>
  <text x="200" y="82" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">call</text>
  <text x="200" y="120" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">result</text>
  <text x="340" y="30" text-anchor="middle" style="fill:var(--vp-c-text-2);font-size:11px">enough to answer (about 5 calls at most)</text>
  <text x="360" y="170" text-anchor="middle" style="fill:var(--vp-c-text-3);font-size:11px">While it works, each lookup is listed; under the answer, "How the AI looked it up" keeps the list.</text>
</svg>
</figure>

This can answer two-step questions ("which runs used X, and at what temperature?") that a single search can't. It is also slower, costs more AI usage, and depends on how well the model uses tools — see [Letting the AI research before answering](/ai-chat-and-ask#letting-the-ai-search-again) for the trade-offs.

## Sources

- **BM25** — S. E. Robertson, S. Walker, S. Jones, M. M. Hancock-Beaulieu, M. Gatford, "Okapi at TREC-3", *Proceedings of TREC-3*, NIST, 1995 ([proceedings](https://trec.nist.gov/pubs/trec3/t3_proceedings.html)). An accessible later account: S. Robertson, H. Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", *Foundations and Trends in Information Retrieval*, 2009 ([doi:10.1561/1500000019](https://doi.org/10.1561/1500000019)).
- **Word breaking** — Unicode Standard Annex #29, "Unicode Text Segmentation" ([unicode.org](https://www.unicode.org/reports/tr29/)), which the browser's word breaker implements.
- **Embeddings (bge-m3)** — J. Chen, S. Xiao, P. Zhang et al., "M3-Embedding: Multi-Linguality, Multi-Functionality, Multi-Granularity Text Embeddings Through Self-Knowledge Distillation", 2024 ([arXiv:2402.03216](https://arxiv.org/abs/2402.03216)).
- **Reciprocal rank fusion** — G. V. Cormack, C. L. A. Clarke, S. Buettcher, "Reciprocal rank fusion outperforms Condorcet and individual rank learning methods", *SIGIR 2009* ([doi:10.1145/1571941.1572114](https://doi.org/10.1145/1571941.1572114)).
- **Retrieval-augmented generation** — P. Lewis, E. Perez, A. Piktus et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", *NeurIPS 2020* ([arXiv:2005.11401](https://arxiv.org/abs/2005.11401)).
- **Provenance** — W3C, "PROV-DM: The PROV Data Model", W3C Recommendation, 2013 ([w3.org/TR/prov-dm](https://www.w3.org/TR/prov-dm/)).
- **Reasoning with tool calls** — S. Yao, J. Zhao, D. Yu et al., "ReAct: Synergizing Reasoning and Acting in Language Models", *ICLR 2023* ([arXiv:2210.03629](https://arxiv.org/abs/2210.03629)).
