// Cmd-K Composer R2 / PR3: verb 回答の手動取り込み（Loop M2）
//
// verb メニュー（矛盾を探す / 抜けを指摘 / 次の検証 等）の AI 回答を、ユーザーが
// 「知見にする / 洞察にする」ボタンで明示的に knowledge ノート化するための純関数。
//
// 設計の要点（[[project-synthesis-layer-withdrawal]] / [[project-cmd-k-composer-findings]]）:
//   - 砂時計の「首（synthesize）」は人間に戻す。AI 提案を自動 ingest しない（方針違反）。
//   - kind（claim / atom）は **ユーザーが選ぶ**。サーバー ingester は kind を AI に
//     決めさせるため、ここでは通さず、選ばれた kind の正規ノートを直接組み立てる。
//   - 由来は wikiMeta.derivedFromNotes に「現ノート + 引用元ノート」を入れる（PROV の素地）。
//     PROV-DM L3（snapshot hash dedup を wasDerivedFrom）は後続 PR4 で上乗せする。
//
// ブロック生成ロジックは buildAtomDocument（wiki-service.ts）の段落分割を踏襲している。
// 候補型（AtomCandidate / IngesterOutput）には依存しない（生テキストから組み立てる）。

import type { GraphiumDocument, WikiKind, WikiMeta } from "../../lib/document-types";

/** 取り込みボタンで作れる kind。verb 回答は claim（知見）か atom（洞察）に落とす。 */
export type VerbSuggestionKind = Extract<WikiKind, "claim" | "atom">;

/**
 * 「知見にする / 洞察にする」を押したときに提示する候補。
 *
 * 旧 M2（buildVerbSuggestionDocument で 1 ノート即生成）は「押すまで何が出るか
 * 見えない」問題があった。今は AI 回答を ingester / atomizer パイプラインに通して
 * 複数候補を作り、ユーザーが選んだものだけを保存する（脱ブラックボックス化、
 * [[project-knowledge-simplicity-philosophy]]）。砂時計の首＝人間の選択は維持される。
 *
 * 採用時にそのまま保存できるよう、候補生成の段階で完成ドキュメント（doc）まで作って持つ。
 */
export type KnowledgeCandidate = {
  /** React key / 選択トグル管理用の一時 ID（保存ノートの ID とは無関係） */
  key: string;
  /** ユーザーが押したボタンの kind（claim = 知見 / atom = 洞察） */
  kind: VerbSuggestionKind;
  /** 候補のタイトル（一覧の主見出し） */
  title: string;
  /** 候補本文のプレビュー（一覧に折りたたんで出す短い抜粋） */
  preview: string;
  /** 採用時にそのまま handleCreateWikiFile へ渡す完成ドキュメント */
  doc: GraphiumDocument;
};

/** verb が精査した引用ノート（claim/atom）への参照。タイトルは表示・リンク両用。 */
export type CitedNoteRef = {
  noteId: string;
  title: string;
};

export type BuildVerbSuggestionInput = {
  /** 本文ブロック配列（呼び出し側で editor.tryParseMarkdownToBlocks 済み）。
   *  これによりテーブル・見出し・@mention が正しく展開される。 */
  bodyBlocks: unknown[];
  /** ユーザーが選んだ kind（claim = 知見 / atom = 洞察） */
  kind: VerbSuggestionKind;
  /** ノートのタイトル */
  title: string;
  /** 取り込み元のノート ID（verb を発火したノート） */
  sourceNoteId: string | null;
  /** verb が精査した引用ノート（claim/atom）。タイトル付きで渡す。 */
  citedNotes: CitedNoteRef[];
  /** 生成に使われた LLM 名（記録用） */
  model?: string | null;
  /** 生成言語 */
  language?: string;
};

type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: { type: "text"; text: string; styles: Record<string, unknown> }[];
  children: unknown[];
};

type KnowledgeLink = {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  targetNoteId: string;
  type: "reference";
  layer: "knowledge";
  createdBy: "ai" | "human";
};

/**
 * verb の AI 回答を、ユーザーが選んだ kind の knowledge ノート（GraphiumDocument）に変換する。
 *
 * - 本文は呼び出し側で editor.tryParseMarkdownToBlocks 済みのブロック配列を受け取る
 *   （テーブル・見出し・@mention が正しく展開された状態）。
 * - 引用ノートがあれば「引用元」見出し + bullet を足し、knowledge reference リンクを張る
 *   （元の verb 精査が依拠した claim/atom への辿り直しを保つ）。bullet は cite-picker と
 *   同じ `@<title>`（青色）形式にして、右パネルグラフ / タイトル解決の既存経路に乗せる。
 * - PROV のリビジョン記録（recordRevision）は handleCreateWikiFile 側が行うのでここでは触らない。
 */
export function buildVerbSuggestionDocument(
  input: BuildVerbSuggestionInput,
): GraphiumDocument {
  const now = new Date().toISOString();
  const blocks: unknown[] = [...input.bodyBlocks];
  const knowledgeLinks: KnowledgeLink[] = [];

  // 引用元セクション（verb が精査した claim/atom への参照を保持）。noteId で重複排除。
  const seen = new Set<string>();
  const uniqueCited = input.citedNotes.filter((c) => {
    if (!c.noteId || seen.has(c.noteId)) return false;
    seen.add(c.noteId);
    return true;
  });
  if (uniqueCited.length > 0) {
    const heading: Block = {
      id: crypto.randomUUID(),
      type: "heading",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
      content: [{ type: "text", text: "引用元", styles: {} }],
      children: [],
    };
    blocks.push(heading);
    for (const cited of uniqueCited) {
      const blockId = crypto.randomUUID();
      const bullet: Block = {
        id: blockId,
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        // cite-picker と同じ @<title>（青色）形式。reference リンクで右パネルから辿れる。
        content: [{ type: "text", text: `@${cited.title || "(untitled)"}`, styles: { textColor: "blue" } }],
        children: [],
      };
      blocks.push(bullet);
      knowledgeLinks.push({
        id: crypto.randomUUID(),
        sourceBlockId: blockId,
        targetBlockId: "",
        targetNoteId: cited.noteId,
        type: "reference",
        layer: "knowledge",
        createdBy: "human",
      });
    }
  }

  const wikiMeta: WikiMeta = {
    kind: input.kind,
    // 由来 = verb を発火したノート（PROV の素地）。引用元 claim/atom は knowledgeLinks 側で保持。
    derivedFromNotes: input.sourceNoteId ? [input.sourceNoteId] : [],
    derivedFromChats: [],
    // 引用・精査した知見/洞察を PROV エクスポート用に記録（来歴の wasDerivedFrom 素地）。
    // derivedFromClaims/Notes と意味論が違うので専用フィールド（[[project-...]] 参照）。
    citedKnowledgeIds: uniqueCited.length > 0 ? uniqueCited.map((c) => c.noteId) : undefined,
    generatedAt: now,
    generatedBy: { model: input.model ?? "unknown", version: "1.0.0" },
    lastIngestedAt: now,
    language: input.language ?? undefined,
    // claim は新規生成時 candidate 扱い（既存 buildWikiDocument に揃える）。
    status: input.kind === "claim" ? "candidate" : undefined,
  };

  return {
    version: 2,
    title: input.title,
    pages: [{
      id: "main",
      title: input.title,
      blocks,
      labels: {},
      provLinks: [],
      knowledgeLinks,
    }],
    source: "ai",
    wikiMeta,
    generatedBy: {
      agent: "ai",
      sessionId: `verb-suggestion-${now}`,
      model: input.model ?? undefined,
    },
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * AI 回答を knowledge ノート本文に落とす前のクリーンアップ。
 *   - PROV inline marker（[[label:xxx]] / [[m]]X[[/m]] 等）を除去
 *   - 「Knowledge referenced:」以降の引用フッターを丸ごと落とす
 *     （reference は wikiMeta / knowledgeLinks 側で持つので本文に重複させない。
 *      かつ本文に残すとリンク化されないプレーンテキストになり汚いため）
 */
export function cleanSuggestionText(content: string): string {
  let text = content
    // 行頭の `[[label:xxx]]` マーカー
    .replace(/\[\[label:[a-z]+\]\][ 　]?/g, "")
    // PROV inline label: [[m]]X[[/m]] / [[t]] / [[a]] / [[o]] → 中身だけ残す
    .replace(/\[\[(m|t|a|o)\]\]([\s\S]*?)\[\[\/\1\]\]/g, "$2");
  // 末尾の引用フッター（--- 区切り + 太字見出し + [Source: ...] 一覧）を丸ごと落とす。
  // 見出し文言は i18n 化されている（「📓 ノート内の知識」等）ため、文言に依存せず
  // 「--- + 太字見出し + Source 箇条書き」という構造でマッチさせる。
  text = text.replace(/\n*---\n+\*\*[^\n]*\*\*\n+[ \t]*-[ \t]*\[Source:[\s\S]*$/, "");
  // 旧形式（「Knowledge referenced」プレースホルダのみ等）も後方互換で除去する。
  text = text.replace(/\n*---\n+(?:\*\*Knowledge referenced:\*\*|📎\s*\*?Knowledge referenced\*?)[\s\S]*$/i, "");
  return text.trim();
}

/**
 * 整形済み markdown から先頭の H1（# タイトル）を取り出し、本文と分離する。
 * H1 が無ければタイトルは空文字（呼び出し側が deriveSuggestionTitle にフォールバック）。
 */
export function splitTitleAndBody(markdown: string): { title: string; body: string } {
  const lines = markdown.split("\n");
  // 先頭の空行を読み飛ばす
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const h1 = lines[i]?.match(/^#\s+(.+?)\s*$/);
  if (h1) {
    const title = h1[1].trim();
    const body = lines.slice(i + 1).join("\n").trim();
    return { title, body };
  }
  return { title: "", body: markdown.trim() };
}

/** AI 回答テキストからノートタイトルを導出する（先頭行 or 先頭 N 文字） */
export function deriveSuggestionTitle(text: string, maxLen = 40): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    // markdown の見出し記号・箇条書き記号を落とす
    .map((l) => l.replace(/^#+\s*/, "").replace(/^[-*]\s*/, ""))
    .find((l) => l.length > 0);
  const base = (firstLine ?? text).trim();
  return base.length > maxLen ? base.slice(0, maxLen) + "…" : base || "無題";
}
