// list_source_check の本体: 出典照合（Graphium が資料と照らして付けた判定）で「要確認」になっているページ。
//
// 判定はアプリが wikiMeta.sourceCheck に書いたものを読むだけで、MCP 側では照合を実行しない。
// 「要確認」の条件は Graphium の一覧と同じ（isNeedsReviewVerdict）: contradicted（出典と異なる）か
// not-in-source（出典に見当たらない）で、ユーザーが「確認した」を付けていないもの。

import type { GraphiumDocument, SourceCheckEntry, SourceCheckVerdict } from "../lib/document-types";
import {
  NEEDS_REVIEW_VERDICT_ORDER,
  isNeedsReviewVerdict,
  type NeedsReviewVerdict,
} from "../features/source-check/needs-review";
import { listKnowledgeTargets } from "./knowledge-check";
import { describeSource, formatSource } from "./sources";
import { readNote, resolveGraphiumRoot } from "./vault";

const MAX_ENTRIES = 3;
const EXCERPT_CHARS = 120;

const VERDICT_LABEL: Record<NeedsReviewVerdict, string> = {
  contradicted: "出典と異なる",
  "not-in-source": "出典に見当たらない",
};

export type NeedsReviewPage = {
  id: string;
  title: string;
  kind: string;
  verdict: NeedsReviewVerdict;
  entries: SourceCheckEntry[];
};

function clip(s: string, max = EXCERPT_CHARS): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 1 ページが「要確認」なら一覧用の行にする（照合が無い・済み・確認済みなら null） */
export function toNeedsReviewPage(id: string, doc: GraphiumDocument): NeedsReviewPage | null {
  const meta = doc.wikiMeta;
  if (!meta || (meta.kind !== "claim" && meta.kind !== "topic" && meta.kind !== "answer")) return null;
  const sc = meta.sourceCheck;
  if (!sc) return null;
  const mirror = { verdict: sc.verdict, dismissed: sc.dismissed, claimHash: sc.claimHash };
  if (!isNeedsReviewVerdict(mirror)) return null;
  return {
    id,
    title: doc.title ?? "(untitled)",
    kind: meta.kind,
    verdict: sc.verdict as NeedsReviewVerdict,
    entries: sc.entries ?? [],
  };
}

export function listSourceCheck(root = resolveGraphiumRoot()): string {
  const { wikiIds } = listKnowledgeTargets(root);
  const pages: NeedsReviewPage[] = [];
  for (const id of wikiIds) {
    const doc = readNote(id, root);
    const page = doc ? toNeedsReviewPage(id, doc) : null;
    if (page) pages.push(page);
  }
  if (pages.length === 0) {
    return (
      "出典照合で「要確認」になっているページはありません。\n" +
      "（Graphium の手入れ → 出典照合で、まだ照合していないページを確かめられます）"
    );
  }

  // 判定順（contradicted → not-in-source）、同じ判定内はタイトル順（Graphium の一覧と同じ）
  const rank = (v: SourceCheckVerdict) => NEEDS_REVIEW_VERDICT_ORDER.indexOf(v);
  pages.sort((a, b) => rank(a.verdict) - rank(b.verdict) || a.title.localeCompare(b.title, "ja"));

  const blocks = pages.map((p) => {
    // 問題のある出典を先に見せる（要確認の理由になった行）
    const flagged = p.entries.filter((e) => rank(e.verdict) >= 0);
    const shown = (flagged.length > 0 ? flagged : p.entries).slice(0, MAX_ENTRIES);
    const lines = shown.map((e) => {
      const src = formatSource(describeSource(e.sourceId, root));
      const where = e.quoteLocation?.page ? `（p.${e.quoteLocation.page}）` : "";
      const parts = [
        e.statement ? `文: ${clip(e.statement)}` : null,
        `出典: ${src}`,
        e.quote ? `出典の抜粋${where}: ${clip(e.quote)}` : null,
        e.rationale ? `理由: ${clip(e.rationale)}` : null,
      ].filter(Boolean);
      return `    - ${parts.join("\n      ")}`;
    });
    const more = p.entries.length > shown.length ? [`    …ほか ${p.entries.length - shown.length} 件`] : [];
    return [`- [${VERDICT_LABEL[p.verdict]}] ${p.title}  [id: ${p.id}]`, ...lines, ...more].join("\n");
  });

  return [
    `# 出典照合で要確認のページ（${pages.length} 件）`,
    "",
    ...blocks,
    "",
    "Graphium の手入れ → 出典照合で確かめられます（確認した印を付けると、この一覧から外れます）。",
  ].join("\n");
}
