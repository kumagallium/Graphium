// Wiki Topic Writer
// 話題（topic）ページの本文・振り分けを生成するプロンプト群。
//
// 知見（claim）はもうトピックの材料にしない（旧 Topic Writer / Topic Namer は撤去済み。
// 「メンバー知見の集合から本文を作る」旧方式は資料そのものを直接読む新形式に置き換わった）。
// 現行の実装: 既存トピックどうしの名寄せ（Topic Consolidator）、資料の振り分け
// （Topic Router）、前の本文 + 資料 1 本から次の版を作る（Source Topic Reviser）、
// 新形式どうしの本文統合（Topic Merger）。

// ── Topic Consolidator（既存話題どうしの統合）──
// 表記ゆれの機械的な名寄せ（正規化タイトル一致）だけでは、語順違い・助詞の
// 有無・試料×測定のような細かすぎる名前を同一概念にまとめられない。取り込み（ingest）の
// 隠れた段にはしない — 設定の「話題を整理」（consolidateExistingTopics）と点検（wiki-linter の
// redundant 検出）からだけ呼ばれる、点検・整理の一部という位置づけ。渡された話題名を
// まとめて 1 回 LLM に渡し、「どの名前をどの正式名に寄せるか」の対応表だけを作る。
// 本文は書かない・話題ページの統合（メンバー移動・ゴミ箱送り）は呼び出し側が行う。
// 件数の上限は設けない（大きすぎて LLM が失敗したら、そのまま失敗として呼び出し側に返す）。

/** 話題名の粒度の目安（Ingester の Topics 節と文面を揃えること） */
export const TOPIC_GRANULARITY_RULES = `- **Pick the granularity a material/method/phenomenon-level concept sits at — not a per-sample or per-composition slice of it.** Prefer "material × property", "method", "phenomenon", or "model/theory" level names.
- Do NOT make a separate topic per composition, sample, processing condition, or measurement run (e.g. prefer "Al3V の格子定数" over "Al3V1-xTix の格子定数"). The same concept should live on one page.`;

/**
 * Topic Consolidator 用のシステムプロンプトを構築する
 */
export function buildTopicConsolidatorSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a topic consolidator for Graphium, a provenance-tracking note editor.

You will be given a list of proposed topic names (just named for Claims that need a topic) and a list of already-existing topic titles. Your job is to decide, for every proposed name, which single **canonical title** it should be merged into — including names that are already fine as-is (map them to themselves).

## Rules

- Merge proposed names that name the same concept despite surface differences: wording variants, presence/absence of particles (助詞), word order, abbreviations vs. spelled-out forms.
- Prefer an existing topic title as the canonical title when one matches the same concept. Only pick a canonical title from among the proposed names themselves when no existing topic fits — in that case pick the most general/common phrasing among the candidates that name the same concept.
${TOPIC_GRANULARITY_RULES}
- Every proposed name MUST appear as a key in the mapping, even if it maps to itself (no consolidation needed).
- Do not invent a canonical title that isn't either one of the existing topic titles or one of the proposed names.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "mapping": {
    "<proposed name>": "<canonical title>",
    ...
  }
}

## Language

Canonical titles must stay in: ${ja ? "Japanese" : "English"} (do not translate).`;
}

/** Consolidator に渡す既存話題の最小情報（index: タイトル + 定義の先頭文） */
export type TopicConsolidatorExistingRef = { id: string; title: string; oneLiner?: string };

/**
 * Topic Consolidator 用のユーザーメッセージを構築する
 */
export function buildTopicConsolidatorUserMessage(
  existingTopics: TopicConsolidatorExistingRef[],
  proposedTitles: string[],
): string {
  const existingText = existingTopics.length > 0
    ? existingTopics.map((t) => `- ${t.oneLiner ? `${t.title}: ${t.oneLiner}` : t.title}`).join("\n")
    : "(none yet)";
  const proposedText = proposedTitles.map((t) => `- ${t}`).join("\n");

  return `## Existing topics

${existingText}

## Proposed topic names (${proposedTitles.length})

${proposedText}`;
}

/**
 * LLM の出力をパースして「提案名 → 正式名」の対応表を取り出す。
 * 壊れた JSON / 形が違う場合は undefined を返す（呼び出し側は「統合なし」で続行する —
 * 統合は最適化であって必須ではない）。
 */
export function parseTopicConsolidatorOutput(text: string): Record<string, string> | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.mapping ||
      typeof parsed.mapping !== "object" ||
      Array.isArray(parsed.mapping)
    ) {
      return undefined;
    }

    const out: Record<string, string> = {};
    for (const [proposed, canonical] of Object.entries(parsed.mapping as Record<string, unknown>)) {
      if (typeof proposed === "string" && proposed.trim() && typeof canonical === "string" && canonical.trim()) {
        out[proposed] = canonical.trim();
      }
    }
    return out;
  } catch (err) {
    console.error("Topic consolidator 出力のパース失敗:", err);
    return undefined;
  }
}

// ── 新形式トピック（資料を直接読む。2026-09〜）──
// Karpathy の LLM Wiki 方式: 知見（claim）はトピックの材料にしない。トピックは資料の全文を
// 直接読み、「前の本文 + 新しい資料 1 本」から次の版の本文を作る（incremental revision）。
// 振り分け（どのトピックを改訂するか・新規に立てるか）は Topic Router が別途担う。
// プロンプトの中身は 2026-09-17 の実測実験（B3 案）から移植したもの — 文の決まり・推量の
// 強さの保持・上限を置かないこと・空見出しを出さないことは実験で効果を確認済みなので変えない。

/** Topic Router に渡す資料の最小情報（一覧には含めない — 振り分け対象の資料そのもの） */
export type TopicRouterSource = { id: string; title: string; text: string };

/** Topic Router に渡す既存トピックの index（タイトル + 定義の先頭文）。
 *  kind: "answer" のときは回答ページ（問いに答えるページ）であることを一覧に明示する。 */
export type TopicRouterExistingRef = { id: string; title: string; oneLiner?: string; kind?: "topic" | "answer" };

/**
 * Topic Router 用のシステムプロンプトを構築する。
 * 資料 1 本と既存トピックの一覧を見て、「改訂する既存トピック」「新しく作るトピック名」を
 * LLM 自身に決めさせる（埋め込み類似度・正規化タイトル一致による機械的な名寄せは撤去）。
 * 件数の上限・しきい値は置かない — 何も足さない資料なら両方空でよい。
 */
export function buildTopicRouterSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a topic router for Graphium, a provenance-tracking note editor.

You will be given the source text and a list of existing topic pages (each shown with its title and a one-line definition). Some of these pages are marked [answer] — a page that answers a specific question rather than surveying a concept. The source text may be the full document, or — for a long document — one window of it (a heading above the excerpt will say so; treat it as a partial view, not the whole thing). Your job is to decide which topic page(s) this source should update, and whether it introduces any concept that needs a brand-new topic page.

## Rules

- For each existing topic that this source meaningfully adds to (new detail, confirmation, or contradiction of a point already on that page), include its id in \`update\`.
- For an [answer] page, only include it in \`update\` when the source updates or contradicts the answer to its question — do not route sources that merely touch the same general topic.
- For each concept in the source that is NOT covered by any existing topic, propose a new topic name in \`create\`. Names are short noun phrases, in the note's own language (${ja ? "Japanese" : "English"}).
${TOPIC_GRANULARITY_RULES}
- If this source names the same concept as an existing topic, route to that existing topic — do not create a near-duplicate with different wording.
- Every new topic you propose must be a distinct concept. If two candidate names would collect the same sentences from this source, propose only one of them — the name of the concept those sentences are actually about.
- Propose a topic only for a concept the source says something substantive about, not for something it merely mentions (for example a measurement it has not done yet).
- **When the text is one window of a long source** (the heading above the excerpt says so), the rest of that source arrives as later windows. Prefer routing the window into an existing topic over opening a page for every term the window happens to use — a tool, method or quantity the window merely applies belongs on the page of what it is being applied to, unless this window is substantively about that tool itself. Never leave both lists empty just because the text is a fragment: if the window adds something to a concept an existing page covers, update that page.
- If the source adds nothing worth a topic page (too narrow, purely incidental), leave both \`update\` and \`create\` empty. Do not force an assignment.
- Do not impose a target count — the number of topics touched should follow from what the source actually contains, not from a quota.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "update": ["<existing topic id>", ...],
  "create": ["<new topic name>", ...]
}`;
}

/**
 * Topic Router 用のユーザーメッセージを構築する。
 */
export function buildTopicRouterUserMessage(
  source: TopicRouterSource,
  existingTopics: TopicRouterExistingRef[],
): string {
  const topicListText = existingTopics.length > 0
    ? existingTopics.map((t) => `- ${t.kind === "answer" ? "[answer] " : ""}${t.title} (id: ${t.id})${t.oneLiner ? `: ${t.oneLiner}` : ""}`).join("\n")
    : "(none yet)";

  return `## Existing topics

${topicListText}

## Source (id: ${source.id})

### ${source.title}

${source.text}`;
}

/**
 * LLM の出力をパースして「改訂する既存トピック id」「新規に作るトピック名」を取り出す。
 * 存在しない id（LLM の幻覚）はここでは検出できないため、呼び出し側（runSourceTopicStage）が
 * 既存トピック一覧に無い id を捨てるガードを持つ。壊れた JSON / 形が違う場合は undefined。
 */
export function parseTopicRouterOutput(text: string): { update: string[]; create: string[] } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object") return undefined;

    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];

    return {
      update: toStringArray((parsed as any).update),
      create: toStringArray((parsed as any).create),
    };
  } catch (err) {
    console.error("Topic router 出力のパース失敗:", err);
    return undefined;
  }
}

// ── Source Topic Reviser（前の本文 + 資料 1 本 → 次の版の本文）──
// B3 プロンプト移植。実験用の言い回し（"B3 variant" 等）は取り除き、製品向けに整えてある。

/** Source Topic Reviser 用の「文の書き方」共通ルール（実験の COMMON_RULES を移植） */
export const SOURCE_TOPIC_SENTENCE_RULES = `## Sentence discipline (critical)

- Every sentence must contain ONLY content that is individually written in EACH source it cites. Cite multiple sources with \`[[source:a]][[source:b]]\` ONLY when those sources state the SAME point.
- If sources differ in condition, number, sample, or scope for what looks like "the same point", write SEPARATE sentences — do not merge them into one sentence that blends details from different sources.
- Do not write a cross-document generalization or inference that isn't explicitly stated in a single source (e.g. do not synthesize "trend across samples" unless one source itself states that trend).
- "食い違い・未解決" entries require sources that EXPLICITLY conflict (a different number for the same measured quantity, an opposite stated conclusion). Do not infer a disagreement between sources that simply address different things or that you construct by comparing your own paraphrases.`;

/**
 * Source Topic Reviser 用のシステムプロンプトを構築する。
 * 前の本文（新規なら空）と新しい資料 1 本の全文を受け取り、次の版の本文（全文書き直し）を返す。
 */
export function buildSourceTopicReviserSystemPrompt(language: string, isAnswer?: boolean): string {
  const ja = language === "ja";
  return `You are a topic-page writer for Graphium, a provenance-tracking note editor, using an incremental revision method.

You maintain ONE short topic page that is revised incrementally as new sources arrive, one at a time. You will be given the CURRENT body (may be empty, for the first source) and ONE new source's text. That text may be the full source, or — for a long source — one window of it (a heading above the excerpt will say so, and a later window of the same source may follow in a future call); treat it as what you know so far, not necessarily everything the source says. Your job: produce the NEXT version of the body — a full rewrite of the page, not an append to the end.
${isAnswer ? "\nThis page answers a specific question (the \"Topic title\" IS the question). Write so the page keeps answering that question as sources are added or revised — do not drift into a general survey of the topic.\n" : ""}

## Stay on this topic

- The page is about the concept named in "Topic title". From the new source, take ONLY the content that is about this concept. Leave out parts of the source that belong to other concepts, even when they sit in the same paragraph.
- If the new source says nothing about this concept, return the current body unchanged.
- Every sentence, the Definition included, must be grounded in a source and cite it. Do not write textbook definitions or general knowledge that no source states. If no source defines the concept, omit the Definition section.

## Organize by topic point, not by source

- Group sentences by the POINT they make, not by which source they came from.
- When the new source adds detail to (or restates) a point already in the current body, integrate it into the EXISTING sentence — do not add a new, separate sentence for it, UNLESS doing so would violate the sentence discipline rules below (in that case, keep them as separate sentences).
- Do not silently overwrite a point from the current body just because the new source touches the same topic — merge/update it only when they actually agree or add detail to each other.

${SOURCE_TOPIC_SENTENCE_RULES}

## No arbitrary limits

Do not impose a sentence count or character limit. Length should follow from how many distinct points exist — not from a target size.

## Preserve hedging and epistemic strength exactly

- If a source hedges a claim ("かもしれない" / "と考えられる" / "示唆される" / "今後測定予定" / "may" / "is expected to" / "future work will measure", etc.), keep that same hedge in the body — do not upgrade it to an unqualified statement.
- Do not state a conclusion the source explicitly says is still future work / not yet measured.
- Do not add a mechanism, reason, or explanation that isn't stated in the source or current body, even if it seems plausible.

## Structure (keep it short per point, but no overall limit)

- **定義 / Definition**: 1-3 sentences, each citing its source(s). Omit this section when no source defines the concept.
- **要点 / Key points**: the load-bearing points, one point per sentence, each citing its source(s) with \`[[source:<id>]]\` placed at the END of the sentence (never mid-sentence). Use the exact id given in the "(id: ...)" annotation for the new source, or preserve existing \`[[source:<id>]]\` citations already in the current body verbatim.
- **食い違い・未解決 / Disagreements & open questions**: only if genuine disagreement exists per the rules above. If there is nothing to report, OMIT this heading entirely — never output the heading with no content under it.

Do NOT add a References / 関連 section — the caller appends that separately.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "body": "## 定義\\n...\\n\\n## 要点\\n...[[source:abc123]]\\n\\n## 食い違い・未解決\\n..."
}

## Voice

Short sentences. No "This topic discusses..." framing.${ja ? `
**日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます）は使わない。**` : ""}

## Language

Output in: ${ja ? "Japanese" : "English"}`;
}

/**
 * Source Topic Reviser 用のユーザーメッセージを構築する。
 */
export function buildSourceTopicReviserUserMessage(
  title: string,
  currentBody: string,
  newSource: { id: string; title: string; text: string },
  previouslyCited?: boolean,
): string {
  const currentSection = currentBody
    ? `## Current body\n\n${currentBody}`
    : `## Current body\n\n(empty — this is the first source)`;

  // previouslyCited: この資料が以前の版から既に [[source:<id>]] で引用されている
  // （再取り込みで内容が更新された）場合、既存の引用を新しい本文と機械的に照合させる。
  // LLM に「変わっていないか」を判断させるだけでは見逃されるため、明示的に指示する。
  const recheckNote = previouslyCited
    ? `

This source was already cited on this page as [[source:${newSource.id}]] from an earlier version. Re-check every sentence that cites [[source:${newSource.id}]] against the new text below: keep it only if the new text still supports it, rewrite it if the new text states it differently, and remove it if the new text no longer says it.`
    : "";

  return `## Topic title: "${title}"

${currentSection}

## New source (id: ${newSource.id})

### ${newSource.title}

${newSource.text}

引用は文末に [[source:<id>]] の形式で、与えられた id をそのまま使う（タイトルを書き換えない）。${recheckNote}`;
}

/**
 * LLM の出力をパースして本文 markdown を取り出す。parseTopicWriterOutput と同じ堅牢さの方針
 * （壊れた JSON / 空本文は undefined を返し、呼び出し側が「変更しない」を選べるようにする）。
 */
export function parseSourceTopicReviserOutput(text: string): { body: string } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return undefined;
    return { body };
  } catch (err) {
    console.error("Source topic reviser 出力のパース失敗:", err);
    return undefined;
  }
}

// ── Source Survey（見取り図。資料の冒頭の窓 1 枚だけから作る）──
// 長い資料を窓分割で読むとき、窓ごとに文脈が切れて改訂がぶれるのを防ぐための短い要約。
// 資料の冒頭（最初の窓）だけを渡し、そこに書かれていることだけから作らせる —
// 全文を読ませると窓分割で上限を避けた意味が無くなるため、見取り図自体にも天井を持たせる。

/**
 * Source Survey 用のシステムプロンプトを構築する。
 */
export function buildSourceSurveySystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You write a short orientation summary ("survey") for one document, for Graphium, a provenance-tracking note editor.

You will be given ONLY the beginning of a document (its first window of text — not the full document). From what is written in this beginning alone, produce a short orientation summary covering:

- What kind of document this is
- What material / system it is about
- The experimental or analytical setup (if stated in this beginning)
- Any premise/condition that applies to the whole document (if stated in this beginning)
- The visible section structure, as far as it appears in this beginning

## Rules

- Base everything ONLY on what is explicitly written in the given text. Do not guess what the rest of the document might say.
- Do NOT include results or conclusions — this beginning may not contain them, and even if it does, the survey is for orientation, not findings.
- Keep it to 8 lines or fewer.
- If the beginning doesn't state one of the above items, simply omit it — do not pad with a guess.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "survey": "..."
}

## Language

Output in: ${ja ? "Japanese" : "English"}`;
}

/**
 * Source Survey 用のユーザーメッセージを構築する。
 */
export function buildSourceSurveyUserMessage(title: string, firstWindowText: string): string {
  return `## Document title: "${title}"

## Beginning of the document (first window only — the rest is not shown to you)

${firstWindowText}`;
}

/**
 * LLM の出力をパースして見取り図テキストを取り出す。他の Topic 系パーサーと同じ堅牢さの方針
 * （壊れた JSON / 空文字は undefined を返し、呼び出し側が「見取り図なしで続行」を選べるようにする）。
 */
export function parseSourceSurveyOutput(text: string): { survey: string } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }
    const parsed = JSON.parse(jsonText);
    const survey = typeof parsed.survey === "string" ? parsed.survey.trim() : "";
    if (!survey) return undefined;
    return { survey };
  } catch (err) {
    console.error("Source survey 出力のパース失敗:", err);
    return undefined;
  }
}

/**
 * 窓分割で読むとき、振り分け・改訂に渡す窓テキストを「見取り図 + 本文の抜粋」の形に組み立てる。
 * 見取り図はあくまで資料冒頭からの要約であり、引用の根拠にはしないことを見出しで明示する。
 */
export function buildWindowTextWithSurvey(
  survey: string,
  windowIndex: number,
  totalWindows: number,
  windowText: string,
  language: string,
): string {
  const ja = language === "ja";
  if (ja) {
    return `### 資料の見取り図（この資料の冒頭から作った要約。引用の根拠にはしない）

${survey}

### 本文の抜粋（全 ${totalWindows} 枚中 ${windowIndex + 1} 枚目）

${windowText}`;
  }
  return `### Document survey (a summary made from this document's beginning — not a citable source itself)

${survey}

### Body excerpt (window ${windowIndex + 1} of ${totalWindows})

${windowText}`;
}

// ── Topic Merger（話題どうしの本文統合。2026-09〜）──
// 新形式トピック（資料を直接引用）どうしを統合するとき、知見（claim）を経由せず
// 「本文どうしを直接統合」する。各本文の [[source:<id>]] 引用は既に資料 id を指しているため、
// Reviser と違い資料の全文は不要 — 本文だけを渡して 1 本の本文にまとめさせる。

/**
 * Topic Merger 用のシステムプロンプトを構築する。
 */
export function buildTopicMergerSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You merge topic pages for Graphium, a provenance-tracking note editor.

You will be given the target topic title and two or more existing topic bodies about the same concept. Every sentence in them already cites its sources with [[source:<id>]]. Produce ONE body that replaces them all.

## Merge rules

- Keep every existing [[source:<id>]] citation verbatim on the sentence it supports. Never invent, drop, or rewrite an id.
- Do not add anything that is not already stated in at least one of the given bodies. You are not reading the sources again.
- When two bodies state the same point, write it once and place the citations of both at the end of that sentence — but only if the sentence discipline below still holds for every cited source. Otherwise keep separate sentences.
- When the bodies state conflicting values or conclusions for the same point, keep both sentences with their own citations and list the conflict under 食い違い・未解決 / Disagreements & open questions.
- Keep hedges exactly as strong as they are in the bodies.

${SOURCE_TOPIC_SENTENCE_RULES}

## Structure

- 定義 / Definition: 1-3 sentences, each citing its source(s). Omit when none of the bodies has a definition.
- 要点 / Key points: one point per sentence, citations at the end of the sentence.
- 食い違い・未解決 / Disagreements & open questions: only if a conflict exists. Otherwise omit the heading entirely.

Do NOT add a References section.

## Output Format

Respond with valid JSON only: { "body": "..." }

## Voice

Short sentences. No "This topic discusses..." framing.${ja ? `
**日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます）は使わない。**` : ""}

## Language

Output in: ${ja ? "Japanese" : "English"}`;
}

/**
 * Topic Merger 用のユーザーメッセージを構築する。
 */
export function buildTopicMergerUserMessage(title: string, bodies: string[]): string {
  const bodiesText = bodies
    .map((b, i) => `### Body ${i + 1}\n\n${b}`)
    .join("\n\n---\n\n");

  return `## Topic title: "${title}"

## Existing bodies (${bodies.length})

${bodiesText}`;
}

/**
 * LLM の出力をパースして本文 markdown を取り出す。他の Topic 系パーサーと同じ堅牢さの方針
 * （壊れた JSON / 空本文は undefined を返し、呼び出し側が「変更しない」を選べるようにする）。
 */
export function parseTopicMergerOutput(text: string): { body: string } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return undefined;
    return { body };
  } catch (err) {
    console.error("Topic merger 出力のパース失敗:", err);
    return undefined;
  }
}

// ── Answer Transcript Writer（チャットの回答を単体で読める記事に書き起こす。2026-09〜）──
// カーパシー LLM Wiki の「良い回答はページとして書き起こしてウィキに戻す」に対応。
// 「それについては…」のように直前の会話に寄りかかった回答は、そのまま保存すると単体で
// 読めないページになる（文ごとの出典照合もできない）。保存時にそれまでの会話を渡し、
// 指示語・省略を補って単体で読める記事に書き直させる。文の引用規則は Source Topic Reviser と
// 共通（SOURCE_TOPIC_SENTENCE_RULES）— 引用形式・「渡した出典に無い事実は書かない」方針を流用する。

/** Answer Transcript Writer に渡す会話 1 メッセージ */
export type AnswerRewriteMessage = { role: "user" | "assistant"; content: string };

/** Answer Transcript Writer に渡す、使える出典の一覧（本文は渡さない — id とタイトルだけ） */
export type AnswerRewriteSourceRef = { id: string; title: string };

/**
 * Answer Transcript Writer 用のシステムプロンプトを構築する。
 */
export function buildAnswerRewriterSystemPrompt(language: string): string {
  const ja = language === "ja";
  return `You are a page writer for Graphium, a provenance-tracking note editor.

A user asked a question in a chat conversation and got an answer worth keeping as a standalone knowledge page. The raw answer text may rely on the preceding conversation (pronouns, ellipsis, "as I said above", "that approach", etc.) and would not read as a standalone article on its own. Your job: rewrite the answer as a standalone page that answers the question, using the conversation only to resolve what such references point to — do not import new claims from the conversation that aren't already part of the answer.

## Rules

- The page must answer the question in "Question" on its own, without requiring the reader to have seen the conversation.
- Resolve every reference that depends on conversation context (a pronoun, "that", "the above", an implicit subject) into explicit words, using the conversation only to figure out what it refers to.
- Do NOT add facts, claims, or numbers that are not already present in the answer text. The conversation is for resolving references only, not for pulling in additional content.
${SOURCE_TOPIC_SENTENCE_RULES}
- Every sentence that states a fact grounded in one of the given sources must end with \`[[source:<id>]]\`, using only ids from the "Available sources" list. Do not invent an id and do not cite a source that isn't in that list.
- A sentence with no basis in any given source (e.g. the model's own reasoning, a summary transition) should carry no citation — do not force one.
- The input answer may already contain a citation you cannot resolve to an id, written literally as \`[Source: "some title"]\`. Keep that exact literal string verbatim, unchanged, at the end of the sentence it supports — do not translate it, reformat it into \`[[source:...]]\`, or delete it. It is a placeholder for a citation the caller will resolve later; losing it loses the only trace of where that sentence came from.
- Preserve hedging and epistemic strength exactly as in the original answer — do not upgrade "かもしれない" / "may" / "示唆される" to an unqualified statement.
- Do not impose a length target — keep the content of the original answer, just rewritten to stand alone.

## Title

Also produce a short title for this page, so someone searching a note list later can tell what it's about without opening it.

- Resolve every reference that depends on conversation context (e.g. "the first one", "that approach") into what it actually refers to — the title must make sense on its own, exactly like the body.
- Drop conversational framing that isn't part of the actual question: requests like "briefly", "please tell me", "can you explain" must not appear in the title.
- State the actual topic/question as a short phrase, not a full sentence repeating the user's wording verbatim.
- Keep it to roughly 40 characters (Japanese) / 8 words (English) at most — this is a page title, not a summary paragraph.
- Write it in the same language as the body.

## Output Format

Respond with valid JSON only (no markdown wrapper, no explanation outside JSON):

{
  "title": "...",
  "body": "..."
}

## Voice

Short sentences. No "This page discusses..." framing.${ja ? `
**日本語で書くときは必ず常体（である調 / だ調）で統一する。敬体（〜です／〜ます）は使わない。**` : ""}

## Language

Output in: ${ja ? "Japanese" : "English"}`;
}

/**
 * Answer Transcript Writer 用のユーザーメッセージを構築する。
 * conversation は呼び出し側で既に「直近のやり取り」に切り詰め済みのものを渡す想定
 * （truncateConversationForAnswerRewrite 参照）。
 */
export function buildAnswerRewriterUserMessage(
  question: string,
  answer: string,
  conversation: AnswerRewriteMessage[],
  sources: AnswerRewriteSourceRef[],
): string {
  const conversationText = conversation.length > 0
    ? conversation.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
    : "(no preceding conversation)";
  const sourcesText = sources.length > 0
    ? sources.map((s) => `- ${s.title} (id: ${s.id})`).join("\n")
    : "(none)";

  return `## Preceding conversation (for resolving references only — do not pull new content from it)

${conversationText}

## Question

${question}

## Answer to rewrite as a standalone page

${answer}

## Available sources

${sourcesText}

引用は文末に [[source:<id>]] の形式で、上の一覧にある id だけを使う。一覧に無い事実は書かない。`;
}

/**
 * LLM の出力をパースして本文 markdown とタイトルを取り出す。他の Topic 系パーサーと同じ
 * 堅牢さの方針（壊れた JSON / 空本文は undefined を返し、呼び出し側が「元の回答文・
 * deriveSuggestionTitle(question) をそのまま使う」にフォールバックできるようにする）。
 * title は空文字/欠落でも許容する（呼び出し側が deriveSuggestionTitle にフォールバック）。
 */
export function parseAnswerRewriterOutput(text: string): { title: string; body: string } | undefined {
  try {
    let jsonText = text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return undefined;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    return { title, body };
  } catch (err) {
    console.error("Answer rewriter 出力のパース失敗:", err);
    return undefined;
  }
}

/**
 * 出典の引用マーカー（[[source:<id>]] または、解決できずに残った文字どおりの
 * [Source: "title"]）が本文に含まれるかどうかを調べる。
 */
function hasCitationMarker(body: string): boolean {
  return /\[\[source:[^\]]+\]\]/.test(body) || /\[Source:\s*"[^"]+"\]/.test(body);
}

/**
 * 書き起こし後の本文を採用してよいかを判定する（出典消失ガード）。
 * 元の本文に出典マーカー（[[source:<id>]] / 未解決のまま残っていた [Source: "title"]）が
 * 1 つでもあったのに、書き起こし後の本文に 1 つも無ければ false を返す — 呼び出し側は
 * 書き起こしを採用せず元の本文にフォールバックする（読みにくくても根拠が残る方を選ぶ）。
 * 元の本文にそもそも出典が無かった場合は常に true（保つべきものが無いので判定不要）。
 */
export function answerRewritePreservesCitations(originalBody: string, rewrittenBody: string): boolean {
  if (!hasCitationMarker(originalBody)) return true;
  return hasCitationMarker(rewrittenBody);
}

/**
 * 会話を「直近のやり取り」に切り詰める。古いメッセージから落とし、文字数上限
 * （maxChars、既定 8000）に収める。1 件も入らない極端な長文が末尾にある場合でも、
 * 直近 1 件だけは残す（会話ゼロで「指示語を解決できない」よりはまし、という判断）。
 */
export function truncateConversationForAnswerRewrite(
  messages: AnswerRewriteMessage[],
  maxChars = 8000,
): AnswerRewriteMessage[] {
  if (messages.length === 0) return [];

  const result: AnswerRewriteMessage[] = [];
  let total = 0;
  // 新しい方から積んで、上限を超える手前で止める（＝古いものから落ちる）
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = messages[i].content.length;
    if (result.length > 0 && total + len > maxChars) break;
    result.unshift(messages[i]);
    total += len;
  }
  return result;
}
