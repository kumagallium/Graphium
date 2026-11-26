// チャットの修正案をブロックの配列に当てる（純粋な関数。エディタにもファイルにも触らない）
//
// - listBlocksForEdit: AI に見せるブロックの一覧（b1, b2 … の短い番号・本文・書き換えられるか）
// - applyEditChange: 1 件の変更（置き換え・後ろに追加・削除）を当てた新しい配列を返す
//
// 守ること
// - 書き換えたブロックは ID と子ブロックを残す（ラベル・メモ・リンクはブロック ID に付いているため）
// - 案を出したときの本文（before）と今の本文が違えば当てない（stale）。古い案で人の編集を消さない
// - 書き換え・削除できるのは文字だけのブロック（段落・見出し・箇条書き・引用）で、中身が平文・太字・コードだけのもの。
//   リンク・@ メンション・数式・色などを含むブロックは往復で失われ、表・画像は本文で古さを判定できないので、
//   置き換えも削除もしない（後ろに足すのは可）

import { blockToMarkdown, parseMarkdownToBlocks } from "../../skill/skill-service";

/** 文字のブロックとして書き換えを許す種別 */
const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "quote"]);

/** 往復で失われない文字の飾り */
const SAFE_STYLES = new Set(["bold", "code"]);

export type EditOp = "replace" | "insert" | "delete";

export type BlockForEdit = {
  /** AI に見せる短い番号（b1 から文書順） */
  handle: string;
  id: string;
  type: string;
  /** ブロック自身の本文（子は含まない） */
  markdown: string;
  /** 置き換えられるか */
  rewritable: boolean;
  /** 子ブロックを持つか（持つものは消せない） */
  hasChildren: boolean;
  depth: number;
};

export type EditChangeInput = {
  op: EditOp;
  /** 対象のブロック ID（insert は直前のブロック） */
  blockId: string;
  /** 案を出したときの対象のブロックの本文 */
  before: string;
  /** replace・insert の新しい本文（Markdown） */
  after?: string;
};

export type ApplyResult =
  | { ok: true; blocks: any[] }
  | { ok: false; reason: "missing" | "stale" | "not_rewritable" | "has_children" | "empty" };

/** 前後の空白と連続する空白を詰めて比べる */
export function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** ブロック自身の本文（Markdown 1 行。未対応・空は ""） */
export function blockOwnMarkdown(block: any): string {
  return blockToMarkdown({ ...block, children: [] }) ?? "";
}

/** 中身が平文・太字・コードだけか */
function hasOnlySafeInline(block: any): boolean {
  const content = block?.content;
  if (content === undefined || content === null) return true;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.every((c: any) => {
    if (c?.type !== "text") return false;
    const styles = c.styles ?? {};
    return Object.keys(styles).every((k) => !styles[k] || SAFE_STYLES.has(k));
  });
}

/** 置き換えてよいブロックか */
export function isRewritable(block: any): boolean {
  return TEXT_BLOCK_TYPES.has(block?.type) && hasOnlySafeInline(block);
}

/**
 * AI に見せるブロックの一覧。文書順に b1, b2 … を振る。
 * skip に入れた ID（スキルの区切りの見出しなど）は一覧に出さない。
 */
export function listBlocksForEdit(blocks: any[], skip: ReadonlySet<string> = new Set()): BlockForEdit[] {
  const out: BlockForEdit[] = [];
  const walk = (list: any[], depth: number) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (!skip.has(b.id)) {
        out.push({
          handle: `b${out.length + 1}`,
          id: b.id,
          type: String(b.type ?? "unknown"),
          markdown: blockOwnMarkdown(b),
          rewritable: isRewritable(b),
          hasChildren: Array.isArray(b.children) && b.children.length > 0,
          depth,
        });
      }
      if (Array.isArray(b.children) && b.children.length > 0) walk(b.children, depth + 1);
    }
  };
  walk(blocks, 0);
  return out;
}

/** AI に渡す一覧の文字列（1 ブロック 1 行。子は字下げ） */
export function formatBlocksForAi(list: BlockForEdit[]): string {
  return list
    .map((b) => {
      const indent = "  ".repeat(b.depth);
      const flags = [b.type, ...(b.rewritable ? [] : ["read-only"]), ...(b.hasChildren ? ["has children"] : [])];
      const text = b.markdown ? b.markdown.replace(/\n/g, " ⏎ ") : "(empty)";
      return `${indent}[${b.handle} | ${flags.join(", ")}] ${text}`;
    })
    .join("\n");
}

/** Markdown を新しいブロックにする（空行の段落は落とす） */
export function markdownToNewBlocks(markdown: string): any[] {
  return parseMarkdownToBlocks(markdown.trim()).filter(
    (b) => !(b.type === "paragraph" && Array.isArray(b.content) && b.content.length === 0),
  );
}

/** 木の中で ID のブロックを探し、入っている配列と位置を返す */
function locate(list: any[], id: string): { parent: any[]; index: number } | null {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b?.id === id) return { parent: list, index: i };
    if (Array.isArray(b?.children)) {
      const hit = locate(b.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** 1 件の変更を当てた新しい配列を返す（元の配列は変えない） */
export function applyEditChange(blocks: any[], change: EditChangeInput): ApplyResult {
  const next: any[] = structuredClone(blocks);
  const hit = locate(next, change.blockId);
  if (!hit) return { ok: false, reason: "missing" };
  const target = hit.parent[hit.index];
  if (normalizeForCompare(blockOwnMarkdown(target)) !== normalizeForCompare(change.before)) {
    return { ok: false, reason: "stale" };
  }

  if (change.op === "delete") {
    // 表・画像などは本文で古さを判定できず、カードにも中身が出ないので消さない
    if (!isRewritable(target)) return { ok: false, reason: "not_rewritable" };
    if (Array.isArray(target.children) && target.children.length > 0) return { ok: false, reason: "has_children" };
    hit.parent.splice(hit.index, 1);
    return { ok: true, blocks: next };
  }

  const fresh = markdownToNewBlocks(change.after ?? "");
  if (fresh.length === 0) return { ok: false, reason: "empty" };

  if (change.op === "insert") {
    hit.parent.splice(hit.index + 1, 0, ...fresh);
    return { ok: true, blocks: next };
  }

  // replace: 先頭の新しいブロックで中身と種別を差し替え、ID と子は残す。残りは後ろに足す
  if (!isRewritable(target)) return { ok: false, reason: "not_rewritable" };
  const [first, ...rest] = fresh;
  // 種別が変わるときは、前の種別だけの props（見出しの level など）を持ち越さない
  const keep = (p: any) => ({
    ...(p?.textColor !== undefined ? { textColor: p.textColor } : {}),
    ...(p?.backgroundColor !== undefined ? { backgroundColor: p.backgroundColor } : {}),
    ...(p?.textAlignment !== undefined ? { textAlignment: p.textAlignment } : {}),
  });
  const props = first.type === target.type
    ? { ...(target.props ?? {}), ...(first.props ?? {}) }
    : { ...(first.props ?? {}), ...keep(target.props) };
  hit.parent[hit.index] = { ...target, type: first.type, props, content: first.content };
  if (rest.length > 0) hit.parent.splice(hit.index + 1, 0, ...rest);
  return { ok: true, blocks: next };
}

// ── エディタへの当て方（開いているノート・スキル） ─────────
// 文書を丸ごと置き換えると、カーソル・元に戻すの履歴・描画が崩れるので、変わったブロックだけを当てる。
// 修正案が起こす形（1 ブロックの書き換え・兄弟の追加・削除、元に戻すでの逆）を扱えれば足りる。

export type EditorOp =
  | { kind: "remove"; ids: string[] }
  | { kind: "update"; id: string; block: { type: string; props: any; content: any } }
  | { kind: "insert"; blocks: any[]; refId: string; placement: "before" | "after" }
  | { kind: "setChildren"; parentId: string; children: any[] };

const shape = (b: any) => JSON.stringify([b?.type ?? null, b?.props ?? {}, b?.content ?? null]);

/** 前の木から後の木へ移す操作の列（エディタの removeBlocks / updateBlock / insertBlocks に当てる） */
export function diffBlocksToOps(before: any[], after: any[]): EditorOp[] {
  const prevById = new Map<string, any>();
  const walkPrev = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.id) prevById.set(b.id, b);
      if (Array.isArray(b?.children)) walkPrev(b.children);
    }
  };
  walkPrev(before);

  const nextIds = new Set<string>();
  const walkNext = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.id) nextIds.add(b.id);
      if (Array.isArray(b?.children)) walkNext(b.children);
    }
  };
  walkNext(after);

  const ops: EditorOp[] = [];
  // 消えたブロックは、親も消えるものを除いて先に消す（子は親と一緒に消える）
  const removed: string[] = [];
  const collectRemoved = (list: any[]) => {
    for (const b of list ?? []) {
      if (!nextIds.has(b.id)) removed.push(b.id);
      else if (Array.isArray(b.children)) collectRemoved(b.children);
    }
  };
  collectRemoved(before);
  if (removed.length > 0) ops.push({ kind: "remove", ids: removed });

  const walk = (list: any[], parentId: string | null) => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const prev = prevById.get(b.id);
      if (!prev) {
        // 新しいブロック: 前の兄弟の後ろ、無ければ次の既存の兄弟の前、どちらも無ければ親の子を差し替える
        if (i > 0) ops.push({ kind: "insert", blocks: [b], refId: list[i - 1].id, placement: "after" });
        else {
          const nextExisting = list.slice(1).find((x) => prevById.has(x.id));
          if (nextExisting) ops.push({ kind: "insert", blocks: [b], refId: nextExisting.id, placement: "before" });
          else if (parentId) {
            ops.push({ kind: "setChildren", parentId, children: list });
            return;
          } else ops.push({ kind: "insert", blocks: [b], refId: "", placement: "after" });
        }
        continue;
      }
      if (shape(prev) !== shape(b)) {
        ops.push({ kind: "update", id: b.id, block: { type: b.type, props: b.props ?? {}, content: b.content } });
      }
      if (Array.isArray(b.children) && b.children.length > 0) walk(b.children, b.id);
    }
  };
  walk(after, null);
  return ops;
}
