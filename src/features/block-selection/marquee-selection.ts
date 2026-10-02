// 矩形選択（マーキー）
// 本文の左右の余白やエディタ周りの空き地からドラッグすると矩形が出て、
// 矩形にかかったトップレベルのブロックをまとめて選ぶ。
//
// 選択は BlockNote がサイドメニューの複数ブロックドラッグで使う MultipleNodeSelection に載せる。
// - BlockNote の setSelection は TextSelection なので、両端が画像・数式など文字を持たないブロックだと作れない
// - MultipleNodeSelection ならブロック丸ごとの選択で、⠿ でつかむとそのまままとめて移動できる
// クラス自体は公開されていないので、getMultipleNodeSelectionClass で登録表から取り出す。

import { useEffect } from "react";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";

/** ドラッグとみなす移動量（px）。これ未満で離したらクリック扱い */
const DRAG_THRESHOLD = 4;
/** スクロール領域の上下端からこの距離に入ったら自動スクロールする */
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_STEP = 16;

export type Rect = { left: number; top: number; right: number; bottom: number };

/** 2 点から矩形を作る（向きを問わない） */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 矩形にかかったブロックを、文書順で最初にかかったものから最後にかかったものまでの
 * 連続範囲として返す（間に挟まったブロックを飛ばさない。移動は連続範囲でしかできないため）。
 */
export function pickMarqueeRange(
  marquee: Rect,
  blocks: ReadonlyArray<{ id: string; rect: Rect }>,
): string[] {
  let first = -1;
  let last = -1;
  blocks.forEach((b, i) => {
    if (!intersects(marquee, b.rect)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return [];
  return blocks.slice(first, last + 1).map((b) => b.id);
}

/** 縦にはみ出した量に応じた自動スクロール量（はみ出していなければ 0） */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  if (y < top + AUTO_SCROLL_EDGE) {
    const ratio = Math.min(1, (top + AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE);
    return -Math.ceil(ratio * AUTO_SCROLL_MAX_STEP);
  }
  if (y > bottom - AUTO_SCROLL_EDGE) {
    const ratio = Math.min(1, (y - (bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
    return Math.ceil(ratio * AUTO_SCROLL_MAX_STEP);
  }
  return 0;
}

type SelectionClass = new (...args: any[]) => Selection;
let multipleNodeSelectionClass: SelectionClass | null | undefined;

/**
 * BlockNote の MultipleNodeSelection クラスを取り出す（公開 API に無いため）。
 *
 * クラスは ProseMirror の Selection 登録表に "multiple-node" で載っているが、自前の fromJSON を
 * 持たないので Selection.fromJSON で作ると無限再帰する。そこで Selection.fromJSON を一瞬だけ
 * 差し替え、登録表から見つかったクラス（this）を受け取ったところで打ち切る。
 * BlockNote の dragging は instanceof で判定するので、同じクラスを使うことが ⠿ でのまとめ移動の条件。
 * 取り出せなければ null（呼び出し側は TextSelection に退避する）。
 */
export function getMultipleNodeSelectionClass(): SelectionClass | null {
  if (multipleNodeSelectionClass !== undefined) return multipleNodeSelectionClass;
  const original = Selection.fromJSON;
  const found = { cls: null as SelectionClass | null };
  const stop = new Error("captured");
  try {
    (Selection as any).fromJSON = function (this: unknown, doc: any, json: any) {
      if (this !== Selection) {
        found.cls = this as SelectionClass;
        throw stop;
      }
      return original.call(Selection, doc, json);
    };
    Selection.fromJSON(null as any, { type: "multiple-node" });
  } catch {
    // stop で打ち切る想定。未登録（BlockNote が名前を変えた等）の RangeError もここに来る
  } finally {
    (Selection as any).fromJSON = original;
  }
  const ok = found.cls && (found.cls.prototype as any).jsonID === "multiple-node";
  multipleNodeSelectionClass = ok ? found.cls : null;
  return multipleNodeSelectionClass;
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let cur = el.parentElement;
  while (cur && cur !== document.body) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** トップレベルのブロック（ルートの blockGroup 直下）を文書順で */
function topLevelBlocks(editorDom: HTMLElement): HTMLElement[] {
  return Array.from(
    editorDom.querySelectorAll<HTMLElement>(
      ":scope > .bn-block-group > [data-node-type='blockOuter']",
    ),
  );
}

/**
 * ブロックの当たり判定に使う矩形。blockOuter は本文の幅いっぱいに広がっているので、
 * 横方向は中身（.bn-block）の実際の幅で判定する（余白をなぞっただけで選ばれないように）
 */
function blockHitRect(outer: HTMLElement): Rect {
  const r = outer.getBoundingClientRect();
  const block = outer.querySelector<HTMLElement>(":scope > .bn-block");
  const content = block?.querySelector<HTMLElement>(
    ":scope > .bn-block-content, :scope > .react-renderer > .bn-block-content",
  );
  const first = content?.firstElementChild as HTMLElement | null;
  const inner = (first ?? content ?? outer).getBoundingClientRect();
  return { left: inner.left, right: inner.right, top: r.top, bottom: r.bottom };
}

/**
 * ドラッグの開始点として認める場所か。
 * - 本文の左右の余白（.bn-editor 自身に当たる＝どのブロックの上でもない）
 * - エディタを包むレイアウト用の要素（エディタの下・左右の空き地）
 */
function isMarqueeStart(target: HTMLElement, editorDom: HTMLElement, container: HTMLElement) {
  if (target === editorDom) return true;
  if (!container.contains(target)) return false;
  // ボタンや入力欄などの UI は除く
  if (target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']")) {
    return false;
  }
  return target.contains(editorDom);
}

function selectBlocks(editor: any, ids: string[]) {
  const view = editor._tiptapEditor?.view;
  if (!view || ids.length === 0) return;
  const { doc } = view.state;
  const positions: Array<{ pos: number; size: number }> = [];
  doc.descendants((node: any, pos: number) => {
    if (positions.length === ids.length) return false;
    if (node.type.name === "blockContainer" && ids.includes(node.attrs.id)) {
      positions.push({ pos, size: node.nodeSize });
      return false;
    }
    return true;
  });
  if (positions.length === 0) return;
  positions.sort((a, b) => a.pos - b.pos);
  const from = positions[0].pos;
  const last = positions[positions.length - 1];
  const to = last.pos + last.size;
  let sel: Selection;
  if (positions.length === 1) {
    sel = NodeSelection.create(doc, from);
  } else {
    const Multiple = getMultipleNodeSelectionClass();
    if (Multiple) {
      sel = new Multiple(doc.resolve(from), doc.resolve(to));
    } else {
      // 退避: 両端が文字を持つブロックのときだけ、BlockNote の範囲選択（TextSelection）で選ぶ
      try {
        editor.setSelection(ids[0], ids[ids.length - 1]);
      } catch {
        // 両端が画像などで作れない。選択は変えない
      }
      return;
    }
  }
  if (sel.eq(view.state.selection)) return;
  view.dispatch(view.state.tr.setSelection(sel));
}

/** 余白をクリックしただけのときは、従来どおり近い行にカーソルを置く */
function placeCaretNear(editor: any, x: number, y: number) {
  const view = editor._tiptapEditor?.view;
  if (!view) return;
  const blocks = topLevelBlocks(view.dom);
  if (blocks.length === 0) return;
  const first = blockHitRect(blocks[0]);
  const left = Math.min(Math.max(x, first.left + 1), first.right - 1);
  const hit = view.posAtCoords({ left, top: y });
  if (!hit) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
  view.focus();
}

export function useMarqueeSelection(editor: any) {
  useEffect(() => {
    const view = editor?._tiptapEditor?.view;
    const editorDom = view?.dom as HTMLElement | undefined;
    if (!editorDom) return;
    const container = findScrollContainer(editorDom);
    if (!container) return;

    let start: { x: number; y: number; scrollTop: number; onEditor: boolean } | null = null;
    let dragging = false;
    let pointer = { x: 0, y: 0 };
    let overlay: HTMLDivElement | null = null;
    let raf = 0;

    const update = () => {
      if (!start || !overlay) return;
      // 開始点はスクロール量の差分だけずらして、スクロール後も同じ文書位置を指す
      const startY = start.y - (container.scrollTop - start.scrollTop);
      const marquee = rectFromPoints(start.x, startY, pointer.x, pointer.y);
      const c = container.getBoundingClientRect();
      overlay.style.left = `${marquee.left - c.left + container.scrollLeft}px`;
      overlay.style.top = `${marquee.top - c.top + container.scrollTop}px`;
      overlay.style.width = `${marquee.right - marquee.left}px`;
      overlay.style.height = `${marquee.bottom - marquee.top}px`;
      const blocks = topLevelBlocks(editorDom).map((el) => ({
        id: el.getAttribute("data-id") ?? "",
        rect: blockHitRect(el),
      }));
      const ids = pickMarqueeRange(marquee, blocks).filter(Boolean);
      if (ids.length > 0) selectBlocks(editor, ids);
      else if (!view.state.selection.empty) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(0))));
      }
    };

    const tick = () => {
      if (!dragging) return;
      const c = container.getBoundingClientRect();
      const step = autoScrollStep(pointer.y, c.top, c.bottom);
      if (step !== 0) {
        container.scrollTop += step;
        update();
      }
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      if (!start) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        overlay = document.createElement("div");
        overlay.className = "gph-marquee";
        container.appendChild(overlay);
        // キー操作（Delete・コピー）が選択に効くように、エディタにフォーカスを渡す
        view.focus();
        raf = requestAnimationFrame(tick);
      }
      update();
    };

    const finish = (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      cancelAnimationFrame(raf);
      const wasDragging = dragging;
      const s = start;
      overlay?.remove();
      overlay = null;
      start = null;
      dragging = false;
      if (wasDragging) {
        // ドラッグの直後に来る click で、選択が崩れないようにする（1 回だけ）
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      } else if (s?.onEditor) {
        placeCaretNear(editor, e.clientX, e.clientY);
      }
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!editor.isEditable) return;
      const target = e.target as HTMLElement;
      if (!isMarqueeStart(target, editorDom, container)) return;
      // ProseMirror は defaultPrevented の mousedown を無視するので、ネイティブの文字選択も始まらない
      e.preventDefault();
      start = {
        x: e.clientX,
        y: e.clientY,
        scrollTop: container.scrollTop,
        onEditor: target === editorDom,
      };
      pointer = { x: e.clientX, y: e.clientY };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", finish);
    };

    container.addEventListener("mousedown", onDown, true);
    return () => {
      container.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      cancelAnimationFrame(raf);
      overlay?.remove();
    };
  }, [editor]);
}
