// ノート間の派生関係からネットワークグラフデータを構築
// 2ホップ以内の関係ノードを抽出

import type { GraphiumDocument, GraphiumFile, WikiKind } from "../../lib/document-types";
import type { MediaIndex, MediaType } from "../asset-browser/media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import { parseExternalSource, type ExternalSourceKind } from "./external-source";
import { summarizeWikiGrowth, type WikiGrowthSummary } from "./growth-summary";
import { normalizeNoteContexts } from "../note-context/context-tags";
import { t } from "../../i18n";

export type NoteNode = {
  id: string;
  title: string;
  isCurrent: boolean;
  /** 現在ノートからのホップ数（0=自分, 1=直接, 2=2ホップ） */
  hop: number;
  /** Knowledge（旧 Wiki）ドキュメントかどうか（グラフ上で別色・別形状にする） */
  isWiki?: boolean;
  /** Knowledge の kind（kind 別に色分けする） */
  wikiKind?: WikiKind;
  /** 外部ソース種別（pdf:/url:/document:/chat: prefix が付いた derivedFromNotes 由来 / media: prefix の使用メディア）。 */
  external?: "pdf" | "url" | "document" | "chat" | "memo" | "media";
  /** 外部リンク先 URL（PDF は CDN URL、URL は元 URL）。クリックで新規タブで開く。 */
  externalUrl?: string;
  /** external === "media" のときの MediaIndex の fileId（サムネイル解決やクリック時の参照に使う） */
  mediaFileId?: string;
  /** external === "media" のときのメディア種別（画像はサムネイル表示、それ以外はアイコン） */
  mediaType?: MediaType;
  /** wiki ノードの成長サマリ（Layer 1 の wiki_* 操作。hover のフルラベルに出す）。
   *  フル docs を持つ buildNoteGraph でのみ付与（index 駆動の buildGlobalGraph は不可）。 */
  growth?: WikiGrowthSummary;
  /** ユーザーの文脈ラベル（NoteIndexEntry.noteContexts の正規化済みコピー）。
   *  全ノードグラフの「文脈で色分け」モードと文脈絞り込みに使う。
   *  index 駆動の buildGlobalGraph でのみ付与（2ホップグラフでは未設定）。 */
  noteContexts?: string[];
};

/** エッジが表す関係種別（全ノードグラフで線種・色を分けるために使う）。
 *  - derived   : 派生（PROV 派生・ノート→Knowledge の取り込み・Concept→Atom など上流→下流）
 *  - used      : 素材利用（外部ソース pdf:/url:/document:/chat: → ノート）
 *  - reference : 参照（knowledge link）
 * 2ホップグラフ（buildNoteGraph）では未設定。全ノードグラフ（buildGlobalGraph）でのみ付与する。 */
export type EdgeRelation = "derived" | "used" | "reference";

export type NoteEdge = {
  source: string;
  target: string;
  /** 引用元ブロックのテキスト（派生元ブロック内容） */
  sourceBlockLabel?: string;
  /** 関係種別（全ノードグラフでのみ付与）。 */
  relation?: EdgeRelation;
};

export type NoteGraphData = {
  nodes: NoteNode[];
  edges: NoteEdge[];
};

/**
 * ドキュメント内のブロックからテキストを抽出する
 */
function extractBlockText(
  doc: GraphiumDocument | undefined,
  blockId: string | undefined,
): string | undefined {
  if (!doc || !blockId) return undefined;
  const MAX_LEN = 30;

  // 全ページのブロックを再帰探索
  for (const page of doc.pages) {
    const text = findBlockText(page.blocks, blockId);
    if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
  }
  return undefined;
}

/** ブロック配列から指定IDのブロックを探してテキストを返す */
function findBlockText(blocks: any[], targetId: string): string | undefined {
  for (const block of blocks) {
    if (block.id === targetId) {
      // テキスト系ブロック
      if (Array.isArray(block.content)) {
        const text = block.content
          .map((c: any) => (c.type === "text" ? c.text : ""))
          .join("")
          .trim();
        if (text) return text;
      }
      return block.type ?? "";
    }
    // 子ブロックを再帰探索
    if (Array.isArray(block.children) && block.children.length > 0) {
      const found = findBlockText(block.children, targetId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 全ノートの派生関係から2ホップのネットワークグラフを構築
 */
export function buildNoteGraph(
  currentNoteId: string | null,
  files: GraphiumFile[],
  docs: Map<string, GraphiumDocument>,
  mediaIndex: MediaIndex | null = null,
): NoteGraphData {
  if (!currentNoteId) return { nodes: [], edges: [] };

  // 全エッジを収集（派生元 → 派生先の方向）
  const allEdges: NoteEdge[] = [];
  // 隣接リスト（双方向）
  const adjacency = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string, sourceBlockLabel?: string) => {
    // 自己ループ（from === to）は描画しない。
    // 再生成でリネームされた知見が自分自身を source 引用すると、
    // knowledgeLinks の targetNoteId が自分を指す自己参照リンクになり得る
    // （実データで全 knowledgeLink の過半数が該当）。lineage-builder /
    // activity-graph-adapter と同様、ここで一律に弾く。
    if (from === to) return;
    allEdges.push({ source: from, target: to, sourceBlockLabel });
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };

  // 存在するファイル ID のセット（孤児リンクを除外）
  const fileIds = new Set(files.map((f) => f.id));

  for (const [fileId, doc] of docs) {
    // derivedFromNoteId: このノートの親（存在チェック）
    if (doc.derivedFromNoteId && fileIds.has(doc.derivedFromNoteId)) {
      // 派生元ブロックのテキストを取得
      const blockLabel = extractBlockText(
        docs.get(doc.derivedFromNoteId),
        doc.derivedFromBlockId,
      );
      addEdge(doc.derivedFromNoteId, fileId, blockLabel);
    }
    // noteLinks: このノートの子（存在チェック）
    // 同じ (from,to) ペアが複数経路で来ても 1 本だけ採用するための dedup セット
    const edgeSeen = new Set<string>();
    if (doc.noteLinks) {
      for (const link of doc.noteLinks) {
        if (fileIds.has(link.targetNoteId)) {
          const key = `${fileId}->${link.targetNoteId}`;
          if (edgeSeen.has(key)) continue;
          edgeSeen.add(key);
          const blockLabel = extractBlockText(doc, link.sourceBlockId);
          addEdge(fileId, link.targetNoteId, blockLabel);
        }
      }
    }
    // knowledgeLinks(reference) もネットワークグラフではエッジとして表示する。
    // 来歴ビューは noteLinks のみ参照するため循環は起きない（PROV と知識参照を分離している）。
    for (const page of doc.pages) {
      const knowledgeLinks = page.knowledgeLinks ?? [];
      for (const link of knowledgeLinks) {
        if (!link.targetNoteId || !fileIds.has(link.targetNoteId)) continue;
        const key = `${fileId}->${link.targetNoteId}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        const blockLabel = extractBlockText(doc, link.sourceBlockId);
        addEdge(fileId, link.targetNoteId, blockLabel);
      }
    }
    // Wiki の derivedFromNotes: Wiki → 派生元ノートのエッジ
    // pdf:/url:/document:/chat: 外部ソースは仮想ノードとして追加
    if (doc.source === "ai" && doc.wikiMeta?.derivedFromNotes) {
      for (const sourceId of doc.wikiMeta.derivedFromNotes) {
        const ext = parseExternalSource(sourceId);
        if (ext) {
          // 外部ソースはエッジ追加（fileIds チェック不要）
          addEdge(sourceId, fileId, ext.kind);
        } else if (fileIds.has(sourceId)) {
          addEdge(sourceId, fileId, "ingest");
        }
      }
    }
    // Atom の derivedFromClaims: Concept → Atom のエッジ
    if (
      doc.source === "ai" &&
      doc.wikiMeta?.kind === "atom" &&
      doc.wikiMeta?.derivedFromClaims
    ) {
      for (const conceptId of doc.wikiMeta.derivedFromClaims) {
        if (fileIds.has(conceptId)) {
          addEdge(conceptId, fileId, "atomize");
        }
      }
    }
    // 通常ノートの top-level sourceUrl（url-to-prov 由来）→ 外部 URL ノードへのエッジ
    if (doc.source !== "ai" && doc.sourceUrl) {
      addEdge(`url:${doc.sourceUrl}`, fileId, "url");
    }
    // 通常ノートの top-level sourcePdfFileId（pdf-to-prov 由来）→ PDF ノードへのエッジ
    if (doc.source !== "ai" && doc.sourcePdfFileId) {
      addEdge(`pdf:${doc.sourcePdfFileId}`, fileId, "url");
    }
  }

  // 現在ノートで使用されているメディアを仮想ノードとしてエッジ追加。
  // 使用関係は MediaIndex.usedIn に集約されており、通常ノートの noteId は prefix なし、
  // Knowledge ノートは `wiki:{id}` の形で記録されている。
  if (currentNoteId && mediaIndex) {
    const usageKeys = [currentNoteId, `wiki:${currentNoteId}`];
    for (const m of mediaIndex.media) {
      if (!m.usedIn.some((u) => usageKeys.includes(u.noteId))) continue;
      if (m.type === "image" || m.type === "video" || m.type === "audio") {
        // 画像・動画・音声はサムネイル付きの media: ノードで表示する。
        addEdge(`media:${m.fileId}`, currentNoteId, "media");
      } else if (m.type === "url") {
        // URL ブックマークを本文のインラインリンクで使った場合も、PROV 由来
        // （top-level sourceUrl）と同じ url: ノードで近接グラフに出す。URL 素材の
        // fileId は "url:<生URL>" なので m.url から同じ id を組み立てる。
        // これを入れないと、アセットグラフには URL が出るのに近接グラフには出ない
        // という素材タイプ間の不一致になる（usedIn ベースで両グラフの定義を揃える）。
        addEdge(`url:${m.url}`, currentNoteId, "url");
      } else if (m.type === "pdf") {
        // PDF は埋め込み（pdf ブロック）・@リンク引用どちらも usedIn 経由でここに来る。
        // pdf: ノードとして近接グラフに出す（アセットグラフと定義を揃える）。
        addEdge(`pdf:${m.fileId}`, currentNoteId, "media");
      } else if (m.type === "document") {
        // Word(.docx) 等の document 素材。埋め込み（file ブロック）・@リンク引用とも
        // usedIn 経由で document: ノードとして近接グラフに出す。
        addEdge(`document:${m.fileId}`, currentNoteId, "media");
      }
    }
  }

  // BFS で2ホップ以内のノードを取得
  const hopMap = new Map<string, number>();
  hopMap.set(currentNoteId, 0);
  const queue = [currentNoteId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const currentHop = hopMap.get(nodeId)!;
    if (currentHop >= 2) continue;

    const neighbors = adjacency.get(nodeId);
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!hopMap.has(neighbor)) {
        hopMap.set(neighbor, currentHop + 1);
        queue.push(neighbor);
      }
    }
  }

  // ファイル名マップ
  const fileNameMap = new Map<string, string>();
  for (const f of files) {
    fileNameMap.set(f.id, f.name.replace(/\.(graphium|provnote)\.json$/, ""));
  }

  // 外部ソース解決用のメディアマップ（pdf は fileId キー、url ブックマークは url キー）。
  // 画像/動画/音声 のサムネイル表示用に type も保持する。
  const mediaByFileId = new Map<string, { name: string; url: string; type: MediaType }>();
  const mediaByUrl = new Map<string, string>();
  if (mediaIndex) {
    for (const m of mediaIndex.media) {
      mediaByFileId.set(m.fileId, { name: m.name, url: m.url, type: m.type });
      if (m.type === "url") mediaByUrl.set(m.url, m.name);
    }
  }

  // ノードを構築
  const nodeIds = new Set(hopMap.keys());
  const nodes: NoteNode[] = [];
  for (const [id, hop] of hopMap) {
    if (id.startsWith("pdf:")) {
      const fileId = id.slice(4);
      const m = mediaByFileId.get(fileId);
      nodes.push({
        id,
        title: m?.name ?? `PDF ${fileId.slice(0, 8)}`,
        isCurrent: false,
        hop,
        external: "pdf",
        externalUrl: m?.url,
      });
      continue;
    }
    if (id.startsWith("document:")) {
      // Word(.docx) など document 素材を Knowledge 化したソース。素材として開けるよう
      // fileId / 名前 / URL を解決する。
      const fileId = id.slice("document:".length);
      const m = mediaByFileId.get(fileId);
      nodes.push({
        id,
        title: m?.name ?? `Document ${fileId.slice(0, 8)}`,
        isCurrent: false,
        hop,
        external: "document",
        externalUrl: m?.url,
        mediaFileId: fileId,
        mediaType: m?.type,
      });
      continue;
    }
    if (id.startsWith("chat:")) {
      // AI チャット由来のソース。開けるアセットは無いので表示のみ。
      nodes.push({
        id,
        title: "AI Chat",
        isCurrent: false,
        hop,
        external: "chat",
      });
      continue;
    }
    if (id.startsWith("memo:")) {
      // メモ由来のソース。chat: と同じく開けるアセットは無いので表示のみ。
      nodes.push({
        id,
        title: "Memo",
        isCurrent: false,
        hop,
        external: "memo",
      });
      continue;
    }
    if (id.startsWith("url:")) {
      const url = id.slice(4);
      nodes.push({
        id,
        title: mediaByUrl.get(url) ?? url,
        isCurrent: false,
        hop,
        external: "url",
        externalUrl: url,
      });
      continue;
    }
    if (id.startsWith("media:")) {
      const fileId = id.slice(6);
      const m = mediaByFileId.get(fileId);
      nodes.push({
        id,
        title: m?.name ?? `Media ${fileId.slice(0, 8)}`,
        isCurrent: false,
        hop,
        external: "media",
        externalUrl: m?.url,
        mediaFileId: fileId,
        mediaType: m?.type,
      });
      continue;
    }
    const title =
      docs.get(id)?.title ?? fileNameMap.get(id) ?? t("graph.unknownNote");
    const doc = docs.get(id);
    const isWiki = doc?.source === "ai";
    nodes.push({
      id,
      title,
      isCurrent: id === currentNoteId,
      hop,
      isWiki,
      wikiKind: isWiki ? doc?.wikiMeta?.kind : undefined,
      growth: isWiki ? summarizeWikiGrowth(doc) : undefined,
    });
  }

  // 関連エッジのみ抽出（両端が含まれるもの）
  const edges = allEdges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  // 重複エッジ除去 + 相互参照（A→B と B→A）の片方向化。
  // 同じノード対が、PROV 由来エッジ（例: claim→atom の derivedFromClaims）と
  // Knowledge 参照（例: atom 本文の "Source Claims" の atom→claim）で二重に張られ、
  // エッジが過剰になる。無向で 1 本に畳んでグラフのごちゃつきを抑える。
  const edgeSet = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const undirectedKey =
      e.source < e.target
        ? `${e.source}|${e.target}`
        : `${e.target}|${e.source}`;
    if (edgeSet.has(undirectedKey)) return false;
    edgeSet.add(undirectedKey);
    return true;
  });

  return { nodes, edges: uniqueEdges };
}

// ── 全ノードグラフ（Obsidian 風グローバルグラフ） ──
//
// buildNoteGraph が「現在ノートから 2 ホップ」だったのに対し、こちらは
// インデックス（GraphiumIndex）を起点に全ノート・全エッジを一括構築する。
// 全 doc をメモリに載せずに済むよう、ノード／エッジはインデックスのみから組み立てる
// （外部ソース名の解決にだけ MediaIndex を任意で使う）。
//
// エッジには relation（derived / used / reference）を付与し、ビュー側で線種・色を分ける。

const RELATION_PRIORITY: Record<EdgeRelation, number> = {
  derived: 0,
  used: 1,
  reference: 2,
};

/**
 * インデックスから全ノードグラフを構築する。
 *
 * @param index     GraphiumIndex（ensureIndex で常時メモリにある想定）
 * @param mediaIndex 外部ソース（pdf:/url:）の表示名解決に使う。null なら ID から仮の名前を作る。
 */
export function buildGlobalGraph(
  index: GraphiumIndex,
  mediaIndex: MediaIndex | null = null,
): NoteGraphData {
  // ゴミ箱・アーカイブを除いた「見える」エントリだけを対象にする
  // （2ホップグラフの files 集合＝trash 除外、と揃える）。
  // 加えて、グラフ化する Knowledge は claim / atom のみに限定する。
  // summary（要約）はノートの派生物で関係グラフ上の価値が薄く、synthesis（発想）と
  // 旧 meta-atom は撤退済みレイヤ。これらは除外して「原料 → ノート → 結晶(claim/atom)」に絞る。
  const entries = index.notes.filter(
    (e) =>
      !e.deletedAt &&
      !e.archivedAt &&
      !(e.wikiKind && e.wikiKind !== "claim" && e.wikiKind !== "atom"),
  );
  const validIds = new Set(entries.map((e) => e.noteId));

  // 関係つきエッジを収集（同じ無向ペアは relation 優先度の高い 1 本に畳む）。
  type RawEdge = { source: string; target: string; relation: EdgeRelation };
  const edgeByPair = new Map<string, RawEdge>();
  const externalIds = new Map<string, ExternalSourceKind>();

  const addEdge = (source: string, target: string, relation: EdgeRelation) => {
    if (source === target) return; // 自己ループは描かない（buildNoteGraph と同様）
    const undirectedKey =
      source < target ? `${source}|${target}` : `${target}|${source}`;
    const existing = edgeByPair.get(undirectedKey);
    if (existing && RELATION_PRIORITY[existing.relation] <= RELATION_PRIORITY[relation]) {
      return; // 既により強い（または同等の）関係がある
    }
    edgeByPair.set(undirectedKey, { source, target, relation });
  };

  for (const e of entries) {
    // outgoingLinks: prov 層＝派生、knowledge 層＝参照。方向は e → target。
    for (const link of e.outgoingLinks) {
      if (!validIds.has(link.targetNoteId)) continue; // 孤児／除外ノードへのリンクは捨てる
      addEdge(e.noteId, link.targetNoteId, link.layer === "prov" ? "derived" : "reference");
    }
    // Wiki の derivedFromNotes: 外部ソース→ノートは素材利用、通常ノート→Wiki は派生。
    if (e.derivedFromNotes) {
      for (const sid of e.derivedFromNotes) {
        const ext = parseExternalSource(sid);
        if (ext) {
          externalIds.set(sid, ext.kind);
          addEdge(sid, e.noteId, "used");
        } else if (validIds.has(sid)) {
          addEdge(sid, e.noteId, "derived");
        }
      }
    }
  }

  // 外部ソースの表示名解決用（pdf は fileId、url は生 URL がキー）。
  const mediaByFileId = new Map<string, { name: string; url: string }>();
  const mediaByUrl = new Map<string, string>();
  if (mediaIndex) {
    for (const m of mediaIndex.media) {
      mediaByFileId.set(m.fileId, { name: m.name, url: m.url });
      if (m.type === "url") mediaByUrl.set(m.url, m.name);
    }
  }

  // ノード構築。全エントリ（孤立ノートも含む）＋ 参照された外部ソース。
  const nodes: NoteNode[] = [];
  for (const e of entries) {
    const isWiki = e.source === "ai";
    nodes.push({
      id: e.noteId,
      title: e.title || t("nav.untitled"),
      isCurrent: false,
      hop: 0, // 全ノードグラフではホップ概念を使わない（kind で色分けする）
      isWiki,
      wikiKind: isWiki ? e.wikiKind : undefined,
      noteContexts: normalizeNoteContexts(e.noteContexts),
    });
  }
  for (const [id, kind] of externalIds) {
    if (kind === "pdf") {
      const fileId = id.slice("pdf:".length);
      const m = mediaByFileId.get(fileId);
      nodes.push({ id, title: m?.name ?? `PDF ${fileId.slice(0, 8)}`, isCurrent: false, hop: 0, external: "pdf", externalUrl: m?.url });
    } else if (kind === "document") {
      const fileId = id.slice("document:".length);
      const m = mediaByFileId.get(fileId);
      nodes.push({ id, title: m?.name ?? `Document ${fileId.slice(0, 8)}`, isCurrent: false, hop: 0, external: "document", externalUrl: m?.url, mediaFileId: fileId });
    } else if (kind === "url") {
      const url = id.slice("url:".length);
      nodes.push({ id, title: mediaByUrl.get(url) ?? url, isCurrent: false, hop: 0, external: "url", externalUrl: url });
    } else if (kind === "memo") {
      nodes.push({ id, title: "Memo", isCurrent: false, hop: 0, external: "memo" });
    } else {
      // chat
      nodes.push({ id, title: "AI Chat", isCurrent: false, hop: 0, external: "chat" });
    }
  }

  const edges: NoteEdge[] = [...edgeByPair.values()].map((e) => ({
    source: e.source,
    target: e.target,
    relation: e.relation,
  }));

  return { nodes, edges };
}
