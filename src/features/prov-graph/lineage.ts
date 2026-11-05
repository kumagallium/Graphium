// ノート間の来歴を辿る。**PROV 層**（実験ノート間のリンク）と**ナレッジ層**
// （トピック/知見/洞察の 2 ホップ）の 2 種類があり、この 2 つは意味が異なるため
// LineageEdge / LineageNode は必ず `layer` を持ち、どちらの関係かを明示する。
//
// ── PROV 層 ──────────────────────────────────────────────
// 方向の意味論は src/lib/block-link-types.ts の ProvLinkType に従う。
// リンクは「後のもの → 元のもの」に張られる（derived_from: データ→考察、
// used: 手順→試料、informed_by: 手順2→手順1）。したがってノートから出ている
// provLinks は **上流** を指す。下流は他ノートからの参照を逆引きして得る。
//
// 注意: ノート間の来歴は 2 経路ある。index の outgoingLinks は両方を layer:"prov" に
// 射影してしまう（index-file.ts）ので、向きを知るには本体を読む必要がある。
//   - page.provLinks / doc.derivedFromNoteId … このノートが元にしたもの（上流）
//   - doc.noteLinks                          … 派生させたノート（下流）と、本文の @ で
//                                              つないだだけのノート（つながり）が混ざる
// noteLinks の X→Y は、Y の derivedFromNoteId が X のときだけ派生（下流）。それ以外は
// 本文の @・リンクの貼り付け・表の行に既存のノートを紐付けたもので、後から書いたノートが
// 前のノートを引くこともあるので**向きを持たない**（lib/note-link-kind.ts）。上流・下流には
// 入れず connectionsOf で「つながり」として別に返す。
// 実データには provLinks が空で noteLinks だけを持つノートが存在するため、
// 下流は noteLinks を直接読んだうえで、相手側の上流からの逆引きも足して取りこぼしを防ぐ。
//
// ── ナレッジ層 ────────────────────────────────────────────
// topicIds / derivedFromClaims / conflictsWith は index にミラーされていない
// （index-file.ts 参照）ため doc.wikiMeta を直接読む。対象は wikiKind で絞ってから
// readNote() する（全 wiki を無条件に読まない）。
//   - topic   → derivedFromClaims: メンバー知見（上流。以前の形式）
//   - insight(atom) → derivedFromClaims: 元になった知見（上流）
//   - どの種類も → derivedFromNotes: 出どころのノート・資料（上流）。
//     資料から作ったトピックや回答ページは知見を経ず、ここに資料を直接持つ
// 下流はこの逆引き（自分を derivedFromClaims / derivedFromNotes に含む側を探す）。
//
// ── 外部資料 ──────────────────────────────────────────────
// 出どころには `pdf:` / `document:` / `url:` などの外部資料 ID が混ざる（sources.ts）。
// これらは来歴の終点（それより上流は無い）として、素材インデックスの名前つきで返す。

// ここはファイルシステムにもブラウザにも依存しない来歴の本体。データの読み口は
// ProvGraphReader で受け取る。MCP（src/mcp/lineage.ts）は vault を読む reader を、
// チャットの道具（features/ai-assistant/prov-graph-tools.ts）は noteIndex と doc キャッシュを
// 読む reader を渡す。

import type { LinkType } from "../../lib/block-link-types";
import { noteLinkKind } from "../../lib/note-link-kind";
import type { ProvGraphReader } from "./reader";
import { isExternalSourceId } from "./source-id";

/**
 * prov: PROV 層（向きのある来歴）/ knowledge: ナレッジ層 /
 * connection: 本文の @ などでつないだだけの、向きの無いつながり（connectionsOf だけが返す）
 */
export type LineageLayer = "prov" | "knowledge" | "connection";

export type LineageEdge = {
  /** 相手側のノート ID */
  noteId: string;
  title: string;
  type: LinkType;
  /** PROV 層のリンクか、ナレッジ層（トピック/知見/洞察）の関係か */
  layer: LineageLayer;
  /** リンク元ブロック（このノート側） */
  sourceBlockId: string;
  /** リンク先ブロック（相手ノート側） */
  targetBlockId: string;
  /** リンク作成時のスナップショット（リンク切れでも文脈が残る） */
  stepTitle?: string;
  entityLabel?: string;
  createdBy?: string;
};

/** ノートから出ている PROV リンク（= 上流）を集める */
export function upstreamOf(noteId: string, r: ProvGraphReader): LineageEdge[] {
  const doc = r.readNote(noteId);
  if (!doc) return [];

  const edges: LineageEdge[] = [];
  const seen = new Set<string>();

  for (const page of doc.pages ?? []) {
    for (const link of page?.provLinks ?? []) {
      const target = link.targetNoteId;
      // 自ノート内のリンクは来歴の「ノート間」追跡では扱わない（self-loop ガード）
      if (!target || target === noteId) continue;
      const key = `${target}:${link.sourceBlockId}:${link.targetBlockId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        noteId: target,
        title: link.targetNoteTitle ?? "",
        type: link.type,
        layer: "prov",
        sourceBlockId: link.sourceBlockId,
        targetBlockId: link.targetBlockId,
        stepTitle: link.targetStepTitle,
        entityLabel: link.targetEntityLabel,
        createdBy: link.createdBy,
      });
    }
  }

  // ドキュメントレベルの派生元（ノートを「派生」で作った場合）
  if (doc.derivedFromNoteId && doc.derivedFromNoteId !== noteId) {
    const key = `${doc.derivedFromNoteId}:doc`;
    if (!seen.has(key)) {
      edges.push({
        noteId: doc.derivedFromNoteId,
        title: "",
        type: "derived_from",
        layer: "prov",
        sourceBlockId: doc.derivedFromBlockId ?? "",
        targetBlockId: doc.derivedFromBlockId ?? "",
      });
    }
  }

  // PDF・Word・URL から取り込んで作ったノートの元資料。AI 生成ノート（source === "ai"）を
  // 除く点はアプリの来歴グラフ（network-graph/graph-builder.ts）と同じ。アプリのグラフは
  // sourceUrl / sourcePdfFileId だけを見るが、ここでは Word（sourceDocumentFileId）も上流に出す
  if (doc.source !== "ai") {
    const external = [
      doc.sourcePdfFileId ? `pdf:${doc.sourcePdfFileId}` : null,
      doc.sourceDocumentFileId ? `document:${doc.sourceDocumentFileId}` : null,
      doc.sourceUrl ? `url:${doc.sourceUrl}` : null,
    ];
    for (const id of external) {
      if (!id) continue;
      edges.push({
        noteId: id,
        title: r.sourceTitle(id),
        type: "used",
        layer: "prov",
        sourceBlockId: "",
        targetBlockId: "",
      });
    }
  }

  return edges;
}

/**
 * このノートから派生した他ノート（= 下流）を集める。
 *
 * doc.noteLinks のうち派生の線（相手の derivedFromNoteId が自分）を読むのが主。加えて、
 * 相手側だけが derivedFromNoteId / provLinks を持つ場合に備えて逆引きも行う。
 * 実データでは両表現が混在しており、片方だけでは取りこぼす。
 * noteLinks のうち派生でない線（本文の @ など）は下流に入れない（connectionsOf）。
 */
export function downstreamOf(noteId: string, r: ProvGraphReader): LineageEdge[] {
  // 起点が外部資料（「この PDF から何を作ったか」）のときは、元資料の項目
  // （sourcePdfFileId 等）を持つノートを探す。この項目は索引にミラーされていないので
  // 本体を読むが、外部資料を起点にしたときだけなので全件読みは許容する
  if (isExternalSourceId(noteId)) return notesDerivedFromSource(noteId, r);

  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: LineageEdge) => {
    const key = `${edge.noteId}:${edge.sourceBlockId}:${edge.targetBlockId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  const titles = new Map(r.entries().map((e) => [e.noteId, e.title]));

  // 1) 自ノートの noteLinks が派生先を指している（相手の derivedFromNoteId が自分の線だけ）
  const doc = r.readNote(noteId);
  const parentOf = derivedFromLookup(r);
  for (const link of doc?.noteLinks ?? []) {
    if (!link.targetNoteId || link.targetNoteId === noteId) continue;
    if (noteLinkKind(noteId, parentOf(link.targetNoteId)) !== "derivation") continue;
    push({
      noteId: link.targetNoteId,
      title: titles.get(link.targetNoteId) ?? "",
      type: link.type,
      layer: "prov",
      sourceBlockId: link.sourceBlockId ?? "",
      targetBlockId: "",
    });
  }

  // 2) 相手側の上流に自分がいる場合の逆引き（noteLinks を持たないデータのため）
  const candidates = r.entries().filter(
    (e) =>
      e.noteId !== noteId &&
      (e.outgoingLinks ?? []).some(
        (l) => l.targetNoteId === noteId && l.layer === "prov",
      ),
  );
  for (const entry of candidates) {
    for (const edge of upstreamOf(entry.noteId, r)) {
      if (edge.noteId !== noteId) continue;
      push({
        ...edge,
        // 下流から見た相手は「派生した側」なので入れ替える
        noteId: entry.noteId,
        title: entry.title,
      });
    }
  }

  return edges;
}

/**
 * ノートの派生元（derivedFromNoteId）を引く関数を作る。索引（v33 以降）の写しを先に見て、
 * 無ければ本体を読む（v32 以前の索引・索引に無いノート）。
 */
function derivedFromLookup(r: ProvGraphReader): (noteId: string) => string | undefined {
  const entries = new Map(r.entries().map((e) => [e.noteId, e]));
  return (noteId) => entries.get(noteId)?.derivedFromNoteId ?? r.readNote(noteId)?.derivedFromNoteId;
}

/**
 * 本文の @ などでつないだだけの、向きの無いつながり（noteLinks のうち派生でない線）。
 * 自分の noteLinks から出ている線と、相手の noteLinks から自分に来ている線の両方を返す。
 * どちらが元かはデータからは決まらない（後から書いたノートが前のノートを引くこともある）ので、
 * 上流・下流には入れない。type は "reference"、layer は "connection"。
 * 相手が Knowledge のページでも返す（@ で入れた Knowledge は noteLinks に入らないので通常は来ない）。
 */
export function connectionsOf(noteId: string, r: ProvGraphReader): LineageEdge[] {
  if (isExternalSourceId(noteId)) return [];
  const entries = r.entries();
  const titles = new Map(entries.map((e) => [e.noteId, e.title]));
  const parentOf = derivedFromLookup(r);
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const push = (otherId: string, sourceBlockId: string) => {
    if (!otherId || otherId === noteId || seen.has(otherId)) return;
    seen.add(otherId);
    edges.push({
      noteId: otherId,
      title: titles.get(otherId) ?? "",
      type: "reference",
      layer: "connection",
      sourceBlockId,
      targetBlockId: "",
    });
  };

  // 1) 自分の noteLinks のうち、相手が自分から派生していない線
  const doc = r.readNote(noteId);
  for (const link of doc?.noteLinks ?? []) {
    if (!link.targetNoteId || link.targetNoteId === noteId) continue;
    if (noteLinkKind(noteId, parentOf(link.targetNoteId)) !== "connection") continue;
    push(link.targetNoteId, link.sourceBlockId ?? "");
  }

  // 2) 相手の noteLinks が自分を指していて、自分が相手から派生していない線。
  //    自分の派生元から来る線は派生（上流）なので除く
  const myParent = doc?.derivedFromNoteId ?? parentOf(noteId);
  for (const entry of entries) {
    if (entry.noteId === noteId || entry.noteId === myParent || seen.has(entry.noteId)) continue;
    const toMe = (entry.outgoingLinks ?? []).filter((l) => l.targetNoteId === noteId && l.layer === "prov");
    if (toMe.length === 0) continue;
    const viaNoteLink = toMe.find((l) => l.via === "noteLink");
    if (viaNoteLink) {
      push(entry.noteId, viaNoteLink.targetBlockId ?? "");
      continue;
    }
    // v32 以前の索引は noteLinks の印を持たないので、本体の noteLinks を見て確かめる
    // （provLinks・derivedFromNoteId も同じ prov 層の線として索引に入っているため）
    if (toMe.some((l) => l.via === undefined)) {
      const link = r.readNote(entry.noteId)?.noteLinks?.find((l) => l.targetNoteId === noteId);
      if (link) push(entry.noteId, link.sourceBlockId ?? "");
    }
  }
  return edges;
}

/** 外部資料 ID（pdf:/document:/url:）を元資料に持つノートを探す（upstreamOf の逆） */
function notesDerivedFromSource(sourceId: string, r: ProvGraphReader): LineageEdge[] {
  const edges: LineageEdge[] = [];
  for (const entry of r.entries()) {
    if (entry.wikiKind) continue; // ナレッジ層は downstreamKnowledgeOf が索引から引く
    const doc = r.readNote(entry.noteId);
    if (!doc || doc.source === "ai") continue;
    const ids = [
      doc.sourcePdfFileId ? `pdf:${doc.sourcePdfFileId}` : null,
      doc.sourceDocumentFileId ? `document:${doc.sourceDocumentFileId}` : null,
      doc.sourceUrl ? `url:${doc.sourceUrl}` : null,
    ];
    if (!ids.includes(sourceId)) continue;
    edges.push({
      noteId: entry.noteId,
      title: entry.title,
      type: "used",
      layer: "prov",
      sourceBlockId: "",
      targetBlockId: "",
    });
  }
  return edges;
}

/**
 * ナレッジ層の上流（このドキュメントが束ねた／抽象化した側）。
 * topic・insight(atom) は derivedFromClaims（メンバー知見）、どの種類も derivedFromNotes
 * （出どころのノート・資料）を見る。wikiMeta を持たないノートは空。
 */
export function upstreamKnowledgeOf(noteId: string, r: ProvGraphReader): LineageEdge[] {
  const doc = r.readNote(noteId);
  const meta = doc?.wikiMeta;
  if (!meta) return [];

  const titles = new Map(r.entries().map((e) => [e.noteId, e.title]));
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  const push = (targetId: string) => {
    if (!targetId || targetId === noteId || seen.has(targetId)) return;
    seen.add(targetId);
    edges.push({
      noteId: targetId,
      title: r.sourceTitle(targetId, titles),
      type: "derived_from",
      layer: "knowledge",
      sourceBlockId: "",
      targetBlockId: "",
    });
  };

  if (meta.kind === "topic" || meta.kind === "atom") {
    for (const claimId of meta.derivedFromClaims ?? []) push(claimId);
  }
  for (const sourceId of meta.derivedFromNotes ?? []) push(sourceId);
  return edges;
}

/**
 * ナレッジ層の下流（このドキュメントを束ねた／抽象化した側からの逆引き）。
 * - このノートが知見(claim)なら、それをメンバーに持つ topic / insight(atom) を探す
 * - このノートがノート/知見なら、それを出どころにする claim・トピック・回答ページなどを探す
 * 対象は wikiKind で絞ってから readNote() する（全 wiki を無条件に読まない）。
 */
export function downstreamKnowledgeOf(noteId: string, r: ProvGraphReader): LineageEdge[] {
  const entries = r.entries();
  const edges: LineageEdge[] = [];

  const push = (targetId: string, title: string) => {
    edges.push({
      noteId: targetId,
      title,
      type: "derived_from",
      layer: "knowledge",
      sourceBlockId: "",
      targetBlockId: "",
    });
  };

  // topic / insight(atom) が自分をメンバー知見にしていないか
  for (const entry of entries.filter((e) => e.wikiKind === "topic" || e.wikiKind === "atom")) {
    if (entry.noteId === noteId) continue;
    const doc = r.readNote(entry.noteId);
    if (doc?.wikiMeta?.derivedFromClaims?.includes(noteId)) push(entry.noteId, entry.title);
  }

  // ナレッジ層のページが自分を出どころにしていないか（derivedFromNotes は index に
  // ミラーされている）。claim だけでなく、資料から作ったトピックや回答ページも直接引く
  const pushed = new Set(edges.map((e) => e.noteId));
  for (const entry of entries.filter((e) => e.wikiKind)) {
    if (entry.noteId === noteId || pushed.has(entry.noteId)) continue;
    if ((entry.derivedFromNotes ?? []).includes(noteId)) push(entry.noteId, entry.title);
  }

  return edges;
}

export type LineageNode = {
  noteId: string;
  title: string;
  depth: number;
  /** この一段をどう辿ってきたか（起点ノートは undefined） */
  via?: {
    type: LinkType;
    layer: LineageLayer;
    sourceBlockId: string;
    targetBlockId: string;
    stepTitle?: string;
  };
};

export type LineageResult = {
  noteId: string;
  upstream: LineageNode[];
  downstream: LineageNode[];
  /**
   * 起点ノートと本文の @ などでつながったノート（向きなし・1 段だけ。connectionsOf）。
   * 上流・下流のどちらにも入れない。前後関係はノートの本文から判断する
   */
  connections: LineageNode[];
};

function walk(
  startId: string,
  depth: number,
  step: (id: string) => LineageEdge[],
  titleOf: (id: string) => string,
): LineageNode[] {
  const out: LineageNode[] = [];
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];

  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of step(id)) {
        if (visited.has(edge.noteId)) continue;
        visited.add(edge.noteId);
        next.push(edge.noteId);
        out.push({
          noteId: edge.noteId,
          title: edge.title || titleOf(edge.noteId),
          depth: d,
          via: {
            type: edge.type,
            layer: edge.layer,
            sourceBlockId: edge.sourceBlockId,
            targetBlockId: edge.targetBlockId,
            stepTitle: edge.stepTitle,
          },
        });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return out;
}

export function traceLineage(
  noteId: string,
  options: { direction?: "upstream" | "downstream" | "both"; depth?: number },
  r: ProvGraphReader,
): LineageResult {
  const { direction = "both", depth = 2 } = options;
  const titles = new Map(r.entries().map((e) => [e.noteId, e.title]));
  const titleOf = (id: string) => titles.get(id) ?? "";

  // PROV 層とナレッジ層を合わせて辿る。既存ノート（wikiMeta なし）では
  // ナレッジ層側は常に空を返すので、PROV 層のみの挙動は変わらない。
  const upstreamStep = (id: string) => [...upstreamOf(id, r), ...upstreamKnowledgeOf(id, r)];
  const downstreamStep = (id: string) => [
    ...downstreamOf(id, r),
    ...downstreamKnowledgeOf(id, r),
  ];

  // 上流・下流で既に出たノートは、つながりに重ねて出さない（派生の線が優先）
  const upstream = direction === "downstream" ? [] : walk(noteId, depth, upstreamStep, titleOf);
  const downstream = direction === "upstream" ? [] : walk(noteId, depth, downstreamStep, titleOf);
  const listed = new Set([...upstream, ...downstream].map((n) => n.noteId));
  const connections = walk(noteId, 1, (id) => connectionsOf(id, r), titleOf).filter((n) => !listed.has(n.noteId));

  return { noteId, upstream, downstream, connections };
}
