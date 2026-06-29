// AI チャット応答の引用正規化
//
// Retriever（retriever.ts formatWikiContext）が LLM に渡す wikiContext には、
// 各 knowledge セクションが `[#N | "title"]` ヘッダー + <wiki-index> のタイトル一覧として
// 含まれる。LLM は理想的には番号 [#N] で引用するが、実際には次のような揺れが出る:
//   - 番号を落として [N] にする
//   - タイトルを復唱するが言い換える / 全角【】にする / @ を付ける
//   - そもそも存在しないタイトルを捏造する（hallucination）
//
// この関数はそれらを吸収し、本文中の引用をすべて正規の `[Source: "exact title"]` 形式に
// 揃える（panel.tsx replaceSourceLinks / source-mentions.ts linkifySourceMentions が
// この形だけを解釈してクリック可能リンクにする）。解決できない引用は除去する。

export interface NormalizedCitations {
  /** 引用を [Source: "title"] に正規化し、hallucination を除去した本文。 */
  message: string;
  /** 本文で実際に引用された（解決できた）正式タイトルの一覧（重複なし、出現順）。 */
  sources: string[];
  /** Retriever が LLM に渡した候補タイトル（番号付きセクション由来）。
   *  LLM が一度も引用しなかったときの fallback 一覧に使う。 */
  candidateTitles: string[];
}

/** wikiContext から番号 → タイトルのマップと候補タイトル一覧を取り出す。 */
function parseNumberedSources(wikiContext: string): {
  candidateTitles: string[];
  numberToTitle: Map<number, string>;
} {
  const candidateTitles: string[] = [];
  const numberToTitle = new Map<number, string>();
  const numberedPattern = /\[#(\d+)\s*\|\s*"([^"]+)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = numberedPattern.exec(wikiContext)) !== null) {
    const num = parseInt(m[1], 10);
    const title = m[2];
    candidateTitles.push(title);
    numberToTitle.set(num, title);
  }
  return { candidateTitles, numberToTitle };
}

/** <wiki-index> ブロック内に列挙された全 Wiki ページタイトルを取り出す。 */
function parseIndexTitles(wikiContext: string): string[] {
  const indexTitles: string[] = [];
  const indexBlockMatch = wikiContext.match(/<wiki-index>([\s\S]*?)<\/wiki-index>/);
  if (indexBlockMatch) {
    const titleInIndex = /^- \*\*(.+?)\*\*/gm;
    let im: RegExpExecArray | null;
    while ((im = titleInIndex.exec(indexBlockMatch[1])) !== null) {
      indexTitles.push(im[1]);
    }
  }
  return indexTitles;
}

/**
 * LLM 応答内の引用（番号 [#N] / [N] ・半角 [Source: "..."] ・全角【Source: ...】）を
 * すべて正規の [Source: "exact title"] に揃える。解決できない引用は除去する。
 *
 * @param assistantMessage LLM の生応答
 * @param wikiContext      Retriever が注入した知識コンテキスト（番号付きセクション + index）
 */
export function normalizeWikiCitations(
  assistantMessage: string,
  wikiContext: string,
): NormalizedCitations {
  const { candidateTitles, numberToTitle } = parseNumberedSources(wikiContext);
  const indexTitles = parseIndexTitles(wikiContext);
  const allValidTitles = [...new Set([...candidateTitles, ...indexTitles])];

  // 引用文字列 → 正式タイトル。@ プレフィックス・前後の引用符（半角/全角）・言い換えを
  // 吸収して prefix match する。全角【Source: "..."】はキャプチャに引用符を含むので、
  // ここで剥がさないと解決できない。
  const resolveTitle = (raw: string): string | null => {
    const cleaned = raw
      .trim()
      .replace(/^@/, "")
      .replace(/^["“”'「『]+|["“”'」』]+$/g, "")
      .trim();
    const exact = allValidTitles.find((t) => t === cleaned);
    if (exact) return exact;
    const prefix = allValidTitles.find(
      (t) => t.startsWith(cleaned) || cleaned.startsWith(t),
    );
    return prefix ?? null;
  };

  let message = assistantMessage;

  // 1) 番号引用 [#N] / [N] → [Source: "title"]。numberToTitle に実在する番号だけ変換し、
  //    無関係な [1] 脚注などを巻き込まない。
  if (numberToTitle.size > 0) {
    message = message.replace(/\[#?(\d{1,2})\]/g, (full, numStr: string) => {
      const title = numberToTitle.get(parseInt(numStr, 10));
      return title ? `[Source: "${title}"]` : full;
    });
  }

  const sources = new Set<string>();
  const halfWidth = /\[Source:\s*"?([^"\]]+?)"?\]/g;
  const fullWidth = /【Source:\s*([^】]+?)】/g;

  // 2) 全角【Source: ...】→ 半角 [Source: "title"]（解決できなければ除去）
  message = message.replace(fullWidth, (_full, raw: string) => {
    const resolved = resolveTitle(raw);
    if (resolved) {
      sources.add(resolved);
      return `[Source: "${resolved}"]`;
    }
    return "";
  });

  // 3) 半角 [Source: "..."] を正式タイトルに揃える（解決できない hallucination は除去）。
  //    解決できたタイトルは sources に集める（番号引用由来 [#N] もこの段で拾われる）。
  message = message.replace(halfWidth, (_full, raw: string) => {
    const resolved = resolveTitle(raw);
    if (resolved) {
      sources.add(resolved);
      return `[Source: "${resolved}"]`;
    }
    return "";
  });

  return { message, sources: [...sources], candidateTitles };
}

/**
 * 実際に引用できた内部ノート（Wiki）を「ノート内の知識」トレーリングリストとして
 * 本文末尾に付ける。引用が 1 件も無ければ何も付けない（候補一覧の機械的な流し込みは
 * しない＝「引用していないのに参照したと主張する」誤表示を防ぐ）。
 *
 * @param label ローカライズ済みの見出し（例: "📓 ノート内の知識"）
 */
export function appendKnowledgeReferenced(
  message: string,
  sources: string[],
  label: string,
): string {
  if (sources.length === 0) return message;
  const sourceList = sources.map((s) => `  - [Source: "${s}"]`).join("\n");
  return `${message}\n\n---\n**${label}**\n${sourceList}`;
}
