import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import {
  useCreateBlockNote,
  SideMenuController,
  SuggestionMenuController,
  FormattingToolbarController,
  TableHandlesController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { blockNoteShadCNComponents } from "./blocknote-shadcn-overrides";
import { SortableTableHandle } from "@features/table-meta/sort-handle";
import { BlockNoteSchema, createCodeBlockSpec, createHeadingBlockSpec, defaultBlockSpecs, defaultStyleSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

/**
 * シンタックスハイライトのテーマ:
 * @blocknote/code-block の codeBlockOptions は github-dark/github-light を内蔵するが、
 * github-light は彩度高め（赤・紫）で Crucible の落ち着いた自然色パレットに馴染まない。
 * design.md の「高彩度の Tailwind デフォルト色を避け、森・大地・空をイメージした自然色で統一」
 * 方針に合わせ、低彩度の `min-light` をロードして先頭に置く。
 *
 * prosemirror-highlight の shiki パーサは getLoadedThemes()[0] を採用するため、
 * ロード後に min-light を先頭に並べ替える。
 */
// 見出しブロック。BlockNote 標準の「トグル見出し」(isToggleable) は使わない。
// 折りたたみは collapsible-heading に一本化してあり、そちらは全部の見出しが対象で、
// 状態をノートに書かない。2 つの折りたたみが並ぶとユーザーが使い分けを
// 意識することになるので、標準側を切って導線を 1 本にする。
//
// prop をスキーマから外す形になるが、既存ノートに残る isToggleable: true は
// BlockNote 側が黙って捨てるだけで、本文も children も失われない
// （features/collapsible-heading/legacy-toggle-compat.test.ts で固定）。
const plainHeading = createHeadingBlockSpec({ allowToggleHeadings: false });

const lightCodeBlock = createCodeBlockSpec({
  ...codeBlockOptions,
  createHighlighter: async () => {
    const h = await codeBlockOptions.createHighlighter!();
    const minLight = await import("@shikijs/themes/min-light");
    await h.loadTheme(minLight.default);
    const original = h.getLoadedThemes.bind(h);
    h.getLoadedThemes = () => {
      const all = original();
      const preferred = all.filter((t) => t === "min-light");
      const others = all.filter((t) => t !== "min-light");
      return [...preferred, ...others];
    };
    return h;
  },
});
import { inlineLabelStyleSpecs } from "@features/inline-label/styles";
import { inlineMathSpecs } from "@features/inline-math/spec";
import {
  inlineImageSpecs,
  INLINE_IMAGE_DRAG_MIME,
  fileIdFromBlobUrl,
  getActiveImageDrag,
  setActiveImageDrag,
  type ActiveImageDrag,
} from "@features/inline-image/spec";
import { getCellSlashMenuItems } from "@features/asset-browser/slash-menu-items";
import { NodeSelection } from "prosemirror-state";
import { getActiveProvider, mediaUrlForActiveProvider } from "../lib/storage/registry";
import { filterSuggestionItems as _filterSuggestionItems } from "@blocknote/core/extensions";
import { FC, useCallback, useEffect, useMemo, useRef } from "react";
import type { CustomBlockEntry } from "./schema";
import type { SlashMenuItem } from "./slash-menu-types";
import type { SideMenuProps, FormattingToolbarProps } from "@blocknote/react";
import { MentionSuggestionMenu } from "./mention-suggestion-menu";
import { BlockSelectionManager } from "@features/block-selection";
import { DuplicateShortcut } from "@features/block-duplicate";
import { InlineAnchorController } from "../features/inline-label/inline-anchor-controller";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";
import { imeConfirmEnterGuardExtension } from "./ime-confirm-enter-guard";
import { imeCompositionHealExtension } from "./ime-composition-heal";
import { documentSearchExtension } from "@/features/document-search/search-plugin";
import { collapsibleHeadingExtension } from "@/features/collapsible-heading/collapse-plugin";
import { t, useLocaleSubscription } from "../i18n";
import { getBlockNoteDictionary } from "./blocknote-dictionary";
import { openLinkInSidePeekExtension } from "./open-link-in-side-peek";
import { stepTitleAutoformatGuardExtension } from "../blocks/step/step-title-autoformat-guard";
import { stepTitleEnterExtension } from "../blocks/step/step-title-enter";
import { columnResizeExtension } from "../blocks/multi-column/column-resize";
import { dropToColumnsExtension, columnDropCursorPosition } from "../blocks/multi-column/drop-to-columns";
import { handleInlineLabelShortcut } from "@features/inline-label/shortcuts";

type SandboxEditorProps = {
  blocks?: CustomBlockEntry[];
  initialContent?: any[];
  /**
   * カスタムSideMenuコンポーネントを渡す。
   * - undefined: デフォルトのSideMenu
   * - false: SideMenuを非表示
   * - FC: カスタムSideMenuコンポーネント
   */
  sideMenu?: FC<SideMenuProps> | false;
  /**
   * カスタムFormattingToolbarコンポーネントを渡す。
   * - undefined: デフォルトのFormattingToolbar
   * - FC: カスタムFormattingToolbar
   */
  formattingToolbar?: FC<FormattingToolbarProps>;
  /** 追加のスラッシュメニューアイテム */
  extraSlashMenuItems?: SlashMenuItem[];
  /**
   * デフォルトスラッシュメニューから除外するアイテムの辞書キー（"image" 等）。
   * タイトルは表示言語で変わるため、言語に依存しないキーで指定する。
   */
  excludeDefaultSlashKeys?: string[];
  /** エディタインスタンスを外部に公開するコールバック */
  onEditorReady?: (editor: any) => void;
  /** エディタの内容が変更されたときのコールバック */
  onChange?: () => void;
  /** メディアファイルアップロードハンドラ（File → URL を返す） */
  uploadFile?: (file: File) => Promise<string>;
  /** 保存された URL を表示用 URL に変換する（local-media:// → blob: 等） */
  resolveFileUrl?: (url: string) => Promise<string>;
  /** @ 参照リンクで選択されたときのコールバック */
  onMentionSelect?: (sourceBlockId: string, suggestion: import("@features/block-link/mention-menu").ReferenceSuggestion) => void;
  /** @ 参照リンクの候補を取得する関数（外部から注入）。query は @ の後に入力中の文字列 */
  getMentionSuggestions?: (query: string) => import("@features/block-link/mention-menu").ReferenceSuggestion[];
  /** 読み取り専用モード（アーカイブ済みノートの閲覧などで使う） */
  editable?: boolean;
};

// サンドボックス共通エディタ
// blocks を渡すだけでカスタムブロック入りエディタが立ち上がる
/**
 * セルへの画像ファイル drop / paste をインライン画像（inlineImage）として受ける。
 * セルはブロックを持てないため、既定処理に任せると画像ブロックがテーブルの外に
 * 落ちてしまう。セル内のときだけ「素材として登録 → inlineImage を挿入」に差し替え、
 * セル外は false を返して既定の画像ブロック挿入に任せる。
 */
/**
 * ノート内の画像ブロックをセルへドラッグしたときの受け口。
 *
 * BlockNote はブロックのドラッグを `dataTransfer.setData("blocknote/html")` と
 * **NodeSelection**（ドラッグ元の blockContainer を選択）で表す — ProseMirror の
 * `view.dragging` は使わない。なので落とした時点の selection からドラッグ元ノードを
 * 読み、その中の画像を取り出す（HTML をパースすると src が blob URL に解決済みで
 * fileId が取れない）。セル外なら false を返して既定のブロック移動に任せる。
 */
/**
 * ブラウザのネイティブ画像ドラッグをセルで受ける。
 * 画像ブロックの中の img をそのまま掴むと BlockNote のブロックドラッグにならず
 * （blocknote/html が乗らない）、どの経路にも当たらずセルに入らなかった。
 * 落とした先がセルなら inline 画像として入れ、掴んだ元の画像ブロックは消す。
 */
function moveNativeImageIntoCell(view: any, event: DragEvent, editor: any): boolean {
  if (event.dataTransfer?.types?.includes("blocknote/html")) return false;
  const dragged = draggedImagePayload(event);
  if (!dragged) return false;
  const cellPos = dropCellPos(view, event);
  if (cellPos === null) return false;
  const nodeType = view.state.schema.nodes.inlineImage;
  if (!nodeType) return false;
  event.preventDefault();
  clearCellDropState();
  // 掴んだ元を消す。セルの中の画像なら inline をそのまま、本文なら画像ブロックごと
  const inlineRange = dragged.inCell ? draggedInlineRange(view, dragged) : null;
  const sourceBlock = dragged.inCell ? null : draggedImageBlock(view, editor, dragged);
  const tr = view.state.tr;
  tr.insert(cellPos, nodeType.create({ fileId: dragged.fileId, name: dragged.name }));
  if (inlineRange) {
    // 挿入で位置がずれるのでマップし直す
    const from = tr.mapping.map(inlineRange.from);
    tr.delete(from, from + inlineRange.size);
  }
  view.dispatch(tr);
  if (sourceBlock) editor.removeBlocks([sourceBlock.id]);
  return true;
}

function moveImageBlockIntoCell(view: any, event: DragEvent): boolean {
  // ブロックのドラッグでなければ関与しない（ファイル drop や外部 HTML と区別する）
  if (!event.dataTransfer?.types?.includes("blocknote/html")) return false;
  const selection = view.state.selection;
  const dragged = (selection as any)?.node;
  if (!dragged) return false;
  let image: { url: string; name: string } | undefined;
  const pick = (node: any) => {
    if (image) return false;
    if (node.type?.name === "image" && typeof node.attrs?.url === "string" && node.attrs.url) {
      image = { url: node.attrs.url, name: String(node.attrs.name ?? "") };
      return false;
    }
    return true;
  };
  if (!pick(dragged)) {
    // dragged 自身が画像ではない: blockContainer なので中を探す
  }
  if (!image) dragged.descendants?.(pick);
  if (!image) return false;
  const cellPos = dropCellPos(view, event);
  if (cellPos === null) return false;
  const fileId = getActiveProvider().extractFileId(image.url);
  const nodeType = view.state.schema.nodes.inlineImage;
  if (!fileId || !nodeType) return false;
  event.preventDefault();
  clearCellDropState();
  // 挿入 → 元ブロック削除の順に組む（先に消すと挿入位置がずれる）
  const tr = view.state.tr;
  tr.insert(cellPos, nodeType.create({ fileId, name: image.name }));
  const from = tr.mapping.map(selection.from);
  const to = tr.mapping.map(selection.to);
  if (to > from) tr.delete(from, to);
  view.dispatch(tr);
  return true;
}

/**
 * 掴んだ画像を本文の画像ブロックとして置き直す受け口（ブロック → セルの逆）。
 * セルの中の画像を外に出した場合と、本文の画像を画像自体で掴んで動かした場合の両方。
 * セル内に落ちたときは扱わない（セル間の移動は inline のままでよい）。
 */
function moveCellImageToBlock(view: any, event: DragEvent, editor: any): boolean {
  if (!editor) return false;
  const payload = draggedImagePayload(event);
  if (!payload) return false;
  // ⠿ ハンドルで掴んだブロックの移動は BlockNote の既定に任せる
  if (!payload.inCell && event.dataTransfer?.types?.includes("blocknote/html")) return false;
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!at || isInsideTableCell(view, at.pos)) return false;
  // 落とし先のブロック（段落の途中には差し込まない）
  const $at = view.state.doc.resolve(at.pos);
  let targetBlockId: string | null = null;
  for (let d = $at.depth; d > 0; d--) {
    const node = $at.node(d);
    if (node.type.name === "blockContainer") {
      targetBlockId = node.attrs?.id ?? null;
      break;
    }
  }
  if (!targetBlockId) return false;
  const inlineRange = payload.inCell ? draggedInlineRange(view, payload) : null;
  const sourceBlock = payload.inCell ? null : draggedImageBlock(view, editor, payload);
  // 本文の画像を本文へ落としただけ（元が見つからない・落とし先が元自身）なら何もしない。
  // ここで preventDefault だけして取りこぼすと、既定処理が画像の名前を文字として挿す
  if (!payload.inCell && (!sourceBlock || sourceBlock.id === targetBlockId)) {
    if (sourceBlock) {
      event.preventDefault();
      clearCellDropState();
      return true;
    }
    return false;
  }
  event.preventDefault();
  clearCellDropState();
  // 掴んだインライン画像は挿入の前に消す。editor.insertBlocks は別トランザクション
  // なので、挿入後に古い位置で delete すると（挿入が前方のとき）ずれた範囲を消して
  // 文書を壊す。削除は inline だけでブロック構造を変えず、挿入・元ブロック削除は
  // id 参照なので、この順ならどちらも位置ずれの影響を受けない。
  // （挿入で万一つまずいても素材はライブラリに残る）
  if (inlineRange) {
    view.dispatch(view.state.tr.delete(inlineRange.from, inlineRange.from + inlineRange.size));
  }
  // 画像ブロックは editor API で足す。ProseMirror ノードを直接組むと BlockNote の
  // URL 解決（resolveFileUrl）を通らず、media-server:// のまま img に入って
  // ERR_UNKNOWN_URL_SCHEME になる
  editor.insertBlocks(
    // URL はプロバイダのスキームで組み立てる。media-server:// 決め打ちだと
    // デスクトップ（file-media://）で解決できず、画像がリンク切れになる
    [
      {
        type: "image",
        props: { url: mediaUrlForActiveProvider(payload.fileId), name: payload.name },
      },
    ],
    targetBlockId,
    "after",
  );
  if (sourceBlock) editor.removeBlocks([sourceBlock.id]);
  return true;
}

/**
 * 掴んでいる画像素材。カスタム MIME → 控えておいたドラッグ → ネイティブの順に見る。
 * デスクトップ（WKWebView）では dataTransfer のカスタム MIME が drop 側で空になり、
 * 控えた値だけが頼りになる（読めないと画像が名前の文字列に化ける）。
 */
function draggedImagePayload(event: DragEvent): ActiveImageDrag | null {
  const raw = event.dataTransfer?.getData(INLINE_IMAGE_DRAG_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { fileId?: string; name?: string; pos?: number | null };
      if (parsed.fileId) {
        return {
          fileId: parsed.fileId,
          name: parsed.name ?? "",
          pos: typeof parsed.pos === "number" ? parsed.pos : null,
          inCell: true,
        };
      }
    } catch {
      // 壊れていたら以降の手段に任せる
    }
  }
  const active = getActiveImageDrag();
  if (active) return active;
  const native = draggedImageFileId(event);
  return native ? { fileId: native.fileId, name: native.name, pos: null, inCell: false } : null;
}

/**
 * 掴んだインライン画像の位置と大きさ。
 * fileId だけで探すと、同じ素材が他のセルにもあるとき別の画像を消してしまい
 * 「複製された」ように見える（実際に起きた）。掴んだ位置での照合を優先する。
 */
function draggedInlineRange(
  view: any,
  payload: ActiveImageDrag,
): { from: number; size: number } | null {
  const matches = (node: any) =>
    node?.type?.name === "inlineImage" && node.attrs?.fileId === payload.fileId;
  const pos = payload.pos;
  if (pos !== null && pos >= 0 && pos < view.state.doc.content.size) {
    const node = view.state.doc.nodeAt(pos);
    if (matches(node)) return { from: pos, size: node.nodeSize };
  }
  let found: { from: number; size: number } | null = null;
  view.state.doc.descendants((node: any, at: number) => {
    if (found) return false;
    if (matches(node)) {
      found = { from: at, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/** 掴んだ画像ブロック。掴んだときに控えた id を優先し、素材一致の探索は最後の手段 */
function draggedImageBlock(view: any, editor: any, payload: ActiveImageDrag): { id: string } | null {
  if (payload.blockId) {
    const block = editor?.getBlock?.(payload.blockId);
    if (block?.type === "image") return { id: payload.blockId };
  }
  const pos = payload.pos;
  if (pos !== null && pos >= 0 && pos < view.state.doc.content.size) {
    const $pos = view.state.doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "blockContainer" && node.attrs?.id) {
        return { id: node.attrs.id };
      }
    }
  }
  return (
    editor?.document?.find?.(
      (b: any) =>
        b.type === "image" &&
        typeof b.props?.url === "string" &&
        b.props.url.endsWith(payload.fileId),
    ) ?? null
  );
}

// ── ドラッグゴーストの縮小 ──
//
// 画像ブロックの選択ドラッグは、既定だと画像の実寸ゴーストが出る（幅いっぱいの
// 画像だと画面を覆い、どこに落ちるのか分からなくなる）。小さな分身に差し替える。
// **dragstart の中で DOM を追加してはいけない** — Chromium はドラッグを中止する。
// body 直下に 1 個だけ常設し、dragstart では src の差し替えと setDragImage だけ行う。
let dragGhost: HTMLImageElement | null = null;

function ensureDragGhost(): HTMLImageElement {
  if (dragGhost?.isConnected) return dragGhost;
  const img = document.createElement("img");
  img.setAttribute("data-drag-ghost", "true");
  img.style.cssText =
    "position:fixed;top:-1000px;left:-1000px;width:120px;height:auto;pointer-events:none;";
  document.body.appendChild(img);
  dragGhost = img;
  return img;
}

// ── セルへの画像ドロップの見せ方 ──
//
// ブロックのドロップは青い挿入バーが出るが、セルの中への挿入にはそれが出ない。
// 受け取るセルの矩形と挿入位置のバーを描いて、どこに入るかを示す。
//
// **ProseMirror が持つ DOM（td）には触らない。** 属性を付け外しすると
// ProseMirror の DOM 監視が反応して、ドラッグ中に状態が乱れる（表示がちらつき、
// ドロップが通ったり通らなかったりする）。表示はすべて body 直下のオーバーレイで持つ。
// dragover は毎フレーム飛んでくるので、計算は rAF で 1 フレーム 1 回に間引く。

type DropIndicator = { box: HTMLElement; caret: HTMLElement };
let dropIndicator: DropIndicator | null = null;
let indicatorRaf = 0;
let pendingPoint: { x: number; y: number; view: any } | null = null;
/** 直前に描いたセル。同じセルの間は測り直さない */
let lastIndicatorCell: HTMLElement | null = null;

function ensureIndicator(): DropIndicator {
  if (dropIndicator?.box.isConnected) return dropIndicator;
  const box = document.createElement("div");
  box.setAttribute("data-cell-drop-box", "true");
  const caret = document.createElement("div");
  caret.setAttribute("data-cell-drop-caret", "true");
  document.body.append(box, caret);
  dropIndicator = { box, caret };
  return dropIndicator;
}

function hideIndicator() {
  if (!dropIndicator) return;
  dropIndicator.box.style.display = "none";
  dropIndicator.caret.style.display = "none";
  dropIndicator.box.removeAttribute("data-pending");
}

export function clearCellDropState() {
  stopDragScroll();
  draggedImageCache = null;
  if (indicatorRaf) {
    cancelAnimationFrame(indicatorRaf);
    indicatorRaf = 0;
  }
  pendingPoint = null;
  lastIndicatorCell = null;
  hideIndicator();
}

/** 受け入れ表示を描く（rAF の中から呼ばれる） */
function drawIndicator(view: any, x: number, y: number) {
  const at = view.posAtCoords({ left: x, top: y });
  if (!at || !isInsideTableCell(view, at.pos)) {
    lastIndicatorCell = null;
    hideIndicator();
    return;
  }
  const dom = view.domAtPos(at.pos)?.node as Node | undefined;
  const el = dom?.nodeType === 1 ? (dom as HTMLElement) : (dom?.parentElement ?? null);
  const cell = el?.closest("td, th") as HTMLElement | null;
  if (!cell) {
    lastIndicatorCell = null;
    hideIndicator();
    return;
  }
  const { box, caret } = ensureIndicator();
  if (cell !== lastIndicatorCell) {
    const r = cell.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.display = "block";
    lastIndicatorCell = cell;
  }
  const coords = view.coordsAtPos(at.pos);
  if (coords) {
    caret.style.left = `${coords.left - 1}px`;
    caret.style.top = `${coords.top}px`;
    caret.style.height = `${Math.max(16, coords.bottom - coords.top)}px`;
    caret.style.display = "block";
  }
}

// ── ドラッグ中の自動スクロール ──
//
// BlockNote も ProseMirror もドラッグ中のスクロールを持たないため、入れたいセルが
// 画面の外にあると、そこまで運べずウィンドウの外へ出てしまう。端に近づいている間だけ
// スクロールし続ける（マウスが止まると dragover が来なくなるのでタイマーで回す）。

const DRAG_SCROLL_MARGIN = 72;
const DRAG_SCROLL_SPEED = 14;
let dragScrollTimer = 0;
let dragScrollTarget: { el: HTMLElement | Window; dir: -1 | 1 } | null = null;

/** エディタを載せているスクロール領域（無ければウィンドウ） */
function scrollContainerOf(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}

function stopDragScroll() {
  if (dragScrollTimer) clearInterval(dragScrollTimer);
  dragScrollTimer = 0;
  dragScrollTarget = null;
}

/**
 * 端にいる間スクロールし続ける。requestAnimationFrame ではなくタイマーで回すのは、
 * rAF が止まる環境（タブが背面、埋め込みビュー）でもドラッグ中は動かしたいため。
 */
function runDragScroll() {
  const target = dragScrollTarget;
  if (!target) {
    stopDragScroll();
    return;
  }
  const delta = DRAG_SCROLL_SPEED * target.dir;
  if (target.el instanceof Window) target.el.scrollBy(0, delta);
  else target.el.scrollTop += delta;
}

/** ポインタが上下の端にある間だけスクロールを回す */
function updateDragScroll(view: any, y: number) {
  const el = scrollContainerOf(view.dom as HTMLElement);
  const rect =
    el instanceof Window
      ? { top: 0, bottom: window.innerHeight }
      : (el as HTMLElement).getBoundingClientRect();
  let dir: -1 | 1 | 0 = 0;
  if (y < rect.top + DRAG_SCROLL_MARGIN) dir = -1;
  else if (y > rect.bottom - DRAG_SCROLL_MARGIN) dir = 1;
  if (dir === 0) {
    stopDragScroll();
    return;
  }
  dragScrollTarget = { el, dir };
  if (!dragScrollTimer) dragScrollTimer = window.setInterval(runDragScroll, 16);
}

/**
 * dragover から呼ぶ。座標だけ控えて、描画は次のフレームにまとめる。
 * rAF が動かない環境（タブが背面、埋め込みビュー）でも表示が消えないよう、
 * 一定時間フレームが来なければその場で描く。
 */
const INDICATOR_FALLBACK_MS = 40;
let lastIndicatorDrawAt = 0;

function scheduleIndicator(view: any, event: DragEvent) {
  pendingPoint = { x: event.clientX, y: event.clientY, view };
  const now = Date.now();
  if (now - lastIndicatorDrawAt > INDICATOR_FALLBACK_MS) {
    lastIndicatorDrawAt = now;
    drawIndicator(view, event.clientX, event.clientY);
    return;
  }
  if (indicatorRaf) return;
  indicatorRaf = requestAnimationFrame(() => {
    indicatorRaf = 0;
    lastIndicatorDrawAt = Date.now();
    const p = pendingPoint;
    if (p) drawIndicator(p.view, p.x, p.y);
  });
}

/** アップロード中の表示（矩形を点滅させる。バーは消す） */
function markIndicatorPending() {
  if (indicatorRaf) {
    cancelAnimationFrame(indicatorRaf);
    indicatorRaf = 0;
  }
  if (!dropIndicator || dropIndicator.box.style.display === "none") return;
  dropIndicator.caret.style.display = "none";
  dropIndicator.box.setAttribute("data-pending", "true");
}

/**
 * ブラウザのネイティブ画像ドラッグ（img 要素をそのまま掴んだ場合）から素材を特定する。
 * この経路では dataTransfer に img の src（blob URL）しか乗らないので、
 * inline-image が控えている blob URL → fileId の対応で引き直す。
 */
function draggedImageFileId(event: DragEvent): { fileId: string; name: string } | null {
  const dt = event.dataTransfer;
  if (!dt) return null;
  const html = dt.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector("img");
    const fileId = fileIdFromBlobUrl(img?.getAttribute("src"));
    if (fileId) return { fileId, name: img?.getAttribute("alt") ?? "" };
  }
  const uri = dt.getData("text/uri-list") || dt.getData("text/plain");
  const fileId = fileIdFromBlobUrl(uri?.trim());
  return fileId ? { fileId, name: "" } : null;
}

/** そのドラッグがセルに入れられる画像か（ファイル / 画像ブロック / セルの画像） */
function isImageDrag(view: any, event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  // 画像自体を掴んだドラッグは types に手掛かりが出ないことがある（この判定を外すと
  // dragover で preventDefault されず、そもそも drop が発火しない）
  if (getActiveImageDrag()) return true;
  // dragover 中は file の名前が読めないため、MIME が空のファイルも受け入れ表示に含める
  // （落とした時点で画像でなければ既定処理に落ちる）
  if ([...(dt.items ?? [])].some((i) => i.kind === "file" && (i.type.startsWith("image/") || !i.type)))
    return true;
  if (dt.types?.includes("Files")) return true;
  if (dt.types?.includes(INLINE_IMAGE_DRAG_MIME)) return true;
  if (dt.types?.includes("blocknote/html")) return draggedBlockHasImage(view);
  return false;
}

/**
 * ドラッグ中のブロック（NodeSelection）が画像を含むか。
 * dragover は毎フレーム飛んでくるので、同じ選択の間は結果を使い回す。
 */
let draggedImageCache: { from: number; hasImage: boolean } | null = null;

function draggedBlockHasImage(view: any): boolean {
  const selection = view.state.selection;
  const dragged = (selection as any)?.node;
  if (!dragged) {
    draggedImageCache = null;
    return false;
  }
  const cached = draggedImageCache;
  if (cached && cached.from === selection.from) return cached.hasImage;
  let found = dragged.type?.name === "image";
  if (!found) {
    dragged.descendants?.((n: any) => {
      if (n.type?.name === "image") found = true;
      return !found;
    });
  }
  draggedImageCache = { from: selection.from, hasImage: found };
  return found;
}

/** その位置がテーブルのセルの中か */
function isInsideTableCell(view: any, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") return true;
  }
  return false;
}

/** 拡張子で画像とみなすもの。Finder からのドラッグは MIME が空のことがある */
const IMAGE_FILE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && IMAGE_FILE_EXT.test(file.name));
}

/** DataTransfer から画像ファイルを取り出す（files が空でも items から拾う） */
function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const fromFiles = [...(dt.files ?? [])];
  if (fromFiles.length === 0) {
    // 一部の環境では files が空で items にだけ入る
    for (const item of dt.items ?? []) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) fromFiles.push(file);
    }
  }
  return fromFiles.filter(isImageFile);
}

/**
 * 落とした位置のセル。座標が罫線やセルの継ぎ目に乗ると posAtCoords が
 * セルの外を指すので、イベントの発生要素からも辿って補う。
 */
function dropCellPos(view: any, event: DragEvent): number | null {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (at && isInsideTableCell(view, at.pos)) return at.pos;
  const target = event.target as HTMLElement | null;
  const cell = target?.closest?.("td, th");
  if (!cell) return null;
  // セルの中の編集可能な位置（先頭）を使う
  const inner = cell.querySelector("p, div[data-node-type]") ?? cell;
  try {
    const pos = view.posAtDOM(inner, 0);
    return isInsideTableCell(view, pos) ? pos : null;
  } catch {
    return null;
  }
}

function insertCellImagesFromFiles(
  view: any,
  dataTransfer: DataTransfer | null | undefined,
  dropEvent: DragEvent | null,
  uploadFile: ((file: File) => Promise<string>) | undefined,
): boolean {
  if (!uploadFile) return false;
  const images = imageFilesFrom(dataTransfer);
  if (!images.length) return false;
  // 位置: drop は座標から、paste は現在のキャレット
  let pos = view.state.selection.from;
  if (dropEvent) {
    const cellPos = dropCellPos(view, dropEvent);
    if (cellPos === null) return false;
    pos = cellPos;
  } else if (!isInsideTableCell(view, pos)) {
    return false;
  }
  dropEvent?.preventDefault();
  // 大きい画像はアップロードに数秒かかる。その間セルを点滅させて受け取り中だと示す
  if (dropEvent) markIndicatorPending();
  void (async () => {
    let insertAt = pos;
    for (const file of images) {
      try {
        const url = await uploadFile(file);
        const fileId = getActiveProvider().extractFileId(url);
        const nodeType = view.state.schema.nodes.inlineImage;
        if (!fileId || !nodeType || view.isDestroyed) continue;
        // アップロード中に文書が縮んでいても範囲内に収める
        const at = Math.min(insertAt, view.state.doc.content.size);
        const node = nodeType.create({ fileId, name: file.name });
        view.dispatch(view.state.tr.insert(at, node));
        insertAt = at + node.nodeSize;
      } catch (e) {
        // 失敗した画像だけ諦めて残りは続ける（素材未登録のまま挿さない）。
        // 黙って消えると「落としたのに入らない」と見えるので、原因は残す
        console.error("[graphium] failed to insert dropped image into cell", file.name, e);
      }
    }
    clearCellDropState();
  })();
  return true;
}

export function SandboxEditor({
  blocks = [],
  initialContent,
  sideMenu,
  formattingToolbar,
  extraSlashMenuItems,
  excludeDefaultSlashKeys,
  onEditorReady,
  onChange,
  uploadFile,
  resolveFileUrl,
  onMentionSelect,
  getMentionSuggestions,
  editable = true,
}: SandboxEditorProps) {
  const customSpecs = Object.fromEntries(
    blocks.map((b) => [b.type, typeof b.spec === "function" ? b.spec() : b.spec])
  );

  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: lightCodeBlock,
      heading: plainHeading,
      ...customSpecs,
    } as any,
    // インライン数式（$...$）を本文中の要素として持てるようにする。
    // 未登録のまま保存済みノートを開くと BlockNote が未知 inline で throw するため、
    // エディタを作る全経路でこの spec を混ぜること。
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      ...inlineMathSpecs,
      ...inlineImageSpecs,
    } as any,
    styleSpecs: {
      ...defaultStyleSpecs,
      ...inlineLabelStyleSpecs,
    } as any,
  });

  // BlockNote 内蔵 UI の文言をアプリの言語設定に連動させる。
  // プレースホルダはエディタ生成時に CSS ルールとして固定されるため、辞書の
  // 差し替えにはエディタの作り直しが必要。deps の locale 変更で再生成し、
  // そのとき編集中の内容は editorRef 経由で新しいエディタに引き継ぐ。
  const locale = useLocaleSubscription();
  const editorRef = useRef<any>(null);

  // _tiptapOptions は useCreateBlockNote の初回実行時のクロージャに固定されるため、
  // props の uploadFile を直接参照すると後から渡された関数を見られない。ref 越しに読む
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;

  const editor = useCreateBlockNote({
    schema,
    initialContent: editorRef.current
      ? (editorRef.current.document as any)
      : initialContent?.length ? (initialContent as any) : undefined,
    dictionary: getBlockNoteDictionary(locale),
    uploadFile,
    // セル内への画像 drop / paste はインライン画像として受ける（セル外は既定処理）。
    // handleDrop/handlePaste では届かない — BlockNote 自身のファイル処理が
    // handleDOMEvents 段で先にイベントを消費する。直接 props の handleDOMEvents は
    // プラグイン（BlockNote）より優先されるので、ここで先取りして true を返す
    _tiptapOptions: {
      editorProps: {
        handleDOMEvents: {
          // 画像そのものを掴んだドラッグ（img のネイティブドラッグ）を控えておく。
          // この経路は blocknote/html もカスタム MIME も乗らないことがあり、
          // デスクトップ（WKWebView）では drop 側で素材を特定できずに既定処理へ落ちる
          // ＝ 画像が名前の文字列に化ける。ドラッグ元も先も同じドキュメントなので、
          // ここで覚えておけば dataTransfer が読めなくても素材を追える
          // 画像を掴んだドラッグを控えておく。dataTransfer のカスタム MIME は
          // デスクトップ（WKWebView）だと drop 側で読めず、画像ブロックを画像自体で
          // 掴んだドラッグには PM 標準の text/plain + text/html しか乗らない（実測。
          // blocknote/html は ⠿ ハンドル経由でしか乗らない）。ドラッグ元も先も同じ
          // ドキュメントなので、ここで覚えておけば dataTransfer が読めなくても追える
          // 画像ブロックを「クリックで選択してから」でないと掴めない問題への先回り。
          // ブラウザは mousedown の時点で選択の中にいないと選択ドラッグを開始しない
          // （選択なしで画像を掴んでもドラッグ自体が始まらない — CDP で実測）。
          // 画像の上で mousedown した瞬間に NodeSelection を張っておけば、
          // そのまま動かしたときに選択ドラッグとして始まる（BlockNote のクリック
          // 選択と同じ結果になるだけなので、クリック操作への影響はない）
          mousedown: (view: any, event: any) => {
            try {
              const el = event?.target as HTMLElement | null;
              if (!el?.closest || el.tagName !== "IMG") return false;
              if (el.closest('[data-test="inline-image"]')) return false;
              const container = el.closest('[data-node-type="blockContainer"]');
              if (!container) return false;
              const blockId = container.getAttribute("data-id");
              const block = blockId ? editorRef.current?.getBlock?.(blockId) : null;
              if (block?.type !== "image") return false;
              const pos = view.posAtDOM(container, 0);
              const $pos = view.state.doc.resolve(pos);
              const before = $pos.before($pos.depth);
              const node = view.state.doc.nodeAt(before);
              if (node?.type?.name !== "blockContainer") return false;
              // すでに同じブロックが選択済みなら何もしない（余計な tr を発行しない）
              const cur: any = view.state.selection;
              if (cur instanceof NodeSelection && cur.from === before) return false;
              const sel = NodeSelection.create(view.state.doc, before);
              view.dispatch(view.state.tr.setSelection(sel));
            } catch {
              // 選択の先張りは最善努力。失敗してもクリックの既定処理に任せる
            }
            return false;
          },
          dragstart: (view: any, event: any) => {
            setActiveImageDrag(null);
            try {
              const el = event?.target as HTMLElement | null;
              if (!el?.closest) return false;
              // セル内画像は React 側（spec.tsx の onDragStart）が記録する
              if (el.closest('[data-test="inline-image"]')) return false;
              // 掴んだ要素の blockContainer から block を引く。selection は見ない —
              // 掴んでそのままドラッグすると、dragstart 時点では NodeSelection が
              // まだ張られていないことがある（クリック確定後にしか張られない）
              const container = el.closest('[data-node-type="blockContainer"]');
              const blockId = container?.getAttribute("data-id") ?? null;
              const block = blockId ? editorRef.current?.getBlock?.(blockId) : null;
              if (block?.type !== "image" || typeof block.props?.url !== "string") return false;
              const fileId = getActiveProvider().extractFileId(block.props.url);
              if (!fileId) return false;
              setActiveImageDrag({
                fileId,
                name: String(block.props.name ?? ""),
                pos: null,
                inCell: false,
                blockId,
              });
              // 既定のゴーストは選択範囲の実寸（幅いっぱいの画像だと画面を覆う）。
              // 常設の縮小分身に差し替える（dragstart 中の DOM 追加はドラッグを殺す）
              const img = container?.querySelector?.("img");
              if (img && event.dataTransfer) {
                try {
                  const ghost = ensureDragGhost();
                  ghost.src = (img as HTMLImageElement).src;
                  event.dataTransfer.setDragImage(ghost, 24, 24);
                  event.dataTransfer.effectAllowed = "move";
                } catch {
                  // ゴーストは見た目だけ。失敗しても既定表示で続ける
                }
              }
            } catch {
              // 記録は最善努力。失敗しても既定のドラッグは邪魔しない
            }
            return false;
          },
          // 受け入れ先のセルを枠で示す（既定のドロップカーソル処理は邪魔しない）
          dragover: (view: any, event: any) => {
            if (!isImageDrag(view, event)) return false;
            // ファイルのドラッグは preventDefault しないと drop が発火しない。
            // セルの内外で出し分けると境目で挙動が変わるので、画像のドラッグなら常に呼ぶ
            event.preventDefault();
            // ノート内の画像の移動はコピー（＋カーソル）ではなく move で見せる
            if (getActiveImageDrag() && event.dataTransfer) event.dataTransfer.dropEffect = "move";
            scheduleIndicator(view, event);
            // 入れたいセルが画面の外にあっても運べるようにする
            updateDragScroll(view, event.clientY);
            return false;
          },
          dragleave: () => {
            clearCellDropState();
            return false;
          },
          dragend: () => {
            setActiveImageDrag(null);
            clearCellDropState();
            return false;
          },
          drop: (view: any, event: any) => {
            // ノート内のドラッグ（移動）を先に見て、当たらなければ外から来たファイルとして扱う。
            // 逆にすると、画像を掴んだドラッグに画像データが乗る環境（デスクトップ）で、
            // すでに素材にある画像を毎回登録し直してしまう（文字認識まで走る）
            const handled =
              moveImageBlockIntoCell(view, event) ||
              moveCellImageToBlock(view, event, editorRef.current) ||
              moveNativeImageIntoCell(view, event, editorRef.current) ||
              insertCellImagesFromFiles(view, event?.dataTransfer, event, uploadFileRef.current);
            if (!handled && isImageDrag(view, event)) {
              // 受け入れ表示（バー）を出したのに取りこぼした状態。BlockNote の既定処理に
              // 落ちるとセルの外にブロックができるので、原因を追えるよう残す
              console.warn("[graphium] image drop over a cell was not handled", {
                types: [...(event?.dataTransfer?.types ?? [])],
                files: event?.dataTransfer?.files?.length ?? 0,
              });
            }
            setActiveImageDrag(null);
            clearCellDropState();
            return handled;
          },
          paste: (view: any, event: any) => {
            const handled = insertCellImagesFromFiles(
              view,
              event?.clipboardData,
              null,
              uploadFileRef.current
            );
            // true でも PM は既定動作を止めないので、ブラウザの貼り付けを自前で止める
            if (handled) event?.preventDefault?.();
            return handled;
          },
        },
      },
    } as any,
    resolveFileUrl,
    // ブロック左右端へのドラッグで縦のドロップカーソルを出す
    // （カラム化ゾーンの判定は multi-column/drop-to-columns.ts）
    dropCursor: { hooks: { computeDropPosition: columnDropCursorPosition } },
    // Tab / Shift-Tab を常にインデント操作に振る。
    // デフォルトの "prefer-navigate-ui" は FormattingToolbar / FilePanel が
    // 開いている時に Tab/Shift-Tab を非処理にして UI 側にフォーカスを移すが、
    // 箇条書きの最中にうっかり Toolbar が残っていると Shift+Tab だけが
    // 反応しなくなり「左に戻れない」体験になる。執筆中は常にインデント
    // が効くほうが直感的。
    tabBehavior: "prefer-indent",
    // 「子持ちの空 list item を Backspace」した時に、子のインデントを保つ。
    // imeConfirmEnterGuardExtension: WKWebView の IME 確定 Enter を本文でも無害化。
    // imeCompositionHealExtension: WKWebView の変換確定でネスト箇条書きが複製/空行に
    //   壊れるのを、確定の正しい結果に自己修復する。
    // documentSearchExtension: Cmd+F のドキュメント内検索ハイライト（decoration）。
    extensions: [
      imeConfirmEnterGuardExtension,
      imeCompositionHealExtension,
      preserveChildIndentOnBackspaceExtension,
      documentSearchExtension,
      // 見出しの折りたたみ。ラベルは getter で遅らせる（拡張はエディタ生成時に
      // 1 度しか作られないので、即時評価すると言語切り替えに追従しない）。
      collapsibleHeadingExtension({
        get collapse() { return t("editor.collapseHeading"); },
        get expand() { return t("editor.expandHeading"); },
      }),
      openLinkInSidePeekExtension,
      // step タイトルで「1. 」等がリスト等へのブロック変換を起こし、カードが
      // 消えるのを防ぐ（step-title-autoformat-guard.ts 参照）
      stepTitleAutoformatGuardExtension,
      // step タイトルでの Enter を「カードの外に兄弟を作る」でなく
      // 「先頭の子ブロックへ入る」にする（step-title-enter.ts 参照）
      stepTitleEnterExtension,
      // カラム境界ドラッグでの幅リサイズ（multi-column/column-resize.ts 参照）
      columnResizeExtension,
      // ブロックの左右端へのドロップでカラム生成（multi-column/drop-to-columns.ts 参照）
      dropToColumnsExtension(),
    ],
  }, [locale]);

  // 言語切替での再生成時に内容を引き継げるよう、最新のエディタを保持する
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // エディタインスタンスを外部に公開
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // インラインラベルのキーボードショートカット（⌘⇧I/E/P/O）。
  // メイン・SidePeek どちらのエディタでも効くよう SandboxEditor で束ねる。
  // capture でブラウザ既定（Win の DevTools 等）より先に処理する。
  useEffect(() => {
    const dom: HTMLElement | undefined = (editor as any)?._tiptapEditor?.view?.dom;
    if (!dom) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (handleInlineLabelShortcut(editor, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  // カスタムSideMenuを渡した場合: デフォルトを無効にして手動レンダリング
  const usesCustomSideMenu = sideMenu !== undefined && sideMenu !== false;
  const hasExtraSlash = extraSlashMenuItems && extraSlashMenuItems.length > 0;

  // スラッシュメニューのカスタム getItems
  const excludeSet = useMemo(
    () => new Set(excludeDefaultSlashKeys ?? []),
    [excludeDefaultSlashKeys],
  );
  // デフォルトアイテムを1回だけ取得（毎回呼ぶと蓄積する問題を防ぐ）
  const defaultSlashItems = useMemo(() => {
    let items = getDefaultReactSlashMenuItems(editor as any);
    if (excludeSet.size > 0) {
      // 既定アイテムは辞書キー（"image" 等）を持つ。タイトルは言語で変わるので
      // キーで除外する
      items = items.filter((item: any) => !excludeSet.has(item.key));
    }
    return items;
  }, [editor, excludeSet]);
  // extra + default を結合（title + group で重複除去 + グループ順にソート）
  const allSlashItems = useMemo(() => {
    if (!hasExtraSlash) return defaultSlashItems;
    const combined = [...defaultSlashItems, ...extraSlashMenuItems];
    // 重複除去
    const seen = new Set<string>();
    const unique = combined.filter((item: any) => {
      const key = `${item.title}|${item.group ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // 同じグループのアイテムを隣接させる（BlockNote がグループヘッダーを重複レンダーするのを防ぐ）
    const groupOrder: string[] = [];
    for (const item of unique) {
      const g = (item as any).group ?? "";
      if (!groupOrder.includes(g)) groupOrder.push(g);
    }
    unique.sort((a: any, b: any) => {
      const ga = groupOrder.indexOf(a.group ?? "");
      const gb = groupOrder.indexOf(b.group ?? "");
      return ga - gb;
    });
    return unique;
  }, [defaultSlashItems, hasExtraSlash, extraSlashMenuItems]);
  const getSlashItems = useMemo(() => {
    if (!hasExtraSlash) return undefined;
    return async (query: string) => {
      // テーブルのセル内: ブロックを挿入する項目は出せない（セルはインライン専用）。
      // インラインで完結する項目（画像 → inlineImage）だけの短いメニューにする
      const inCell = (editor as any).getTextCursorPosition?.()?.block?.type === "table";
      const items = inCell ? getCellSlashMenuItems() : allSlashItems;
      if (!query) return items as any;
      // カスタムフィルタ: title と aliases のみでマッチ（group 名でのマッチを防ぐ）
      const q = query.toLowerCase();
      return items.filter((item: any) => {
        if (item.title?.toLowerCase().includes(q)) return true;
        if (item.aliases?.some((a: string) => a.toLowerCase().includes(q))) return true;
        return false;
      }) as any;
    };
  }, [hasExtraSlash, allSlashItems, editor]);

  // `#` のラベルオートコンプリートは廃止した。
  // 工程は step ブロック、テーブル / メディアのラベルはドラッグハンドルのメニューに
  // 集約し、PROV に乗らない自由タグも畳んだので、`#` から付けるものが無くなった。
  // 既存ノートに付いているラベルはデータとして残り、表示・PROV 生成・解除は従来どおり。

  // @ 参照リンクオートコンプリート
  const getMentionItems = useCallback(
    async (query: string) => {
      const suggestions = getMentionSuggestions?.(query) ?? [];
      const toItem = (s: any) => ({
        title: s.label,
        group: s.group,
        // 同名ノート区別用の 2 行目（shadcn の SuggestionMenu.Item が描画する）
        subtext: s.subtext,
        onItemClick: () => {
          const block = (editor as any).getTextCursorPosition?.()?.block;
          if (block && onMentionSelect) {
            onMentionSelect(block.id, s);
          }
        },
      });
      // createTitle を持つ候補（「新規ノートを作成」）は _filterSuggestionItems を通さず
      // 常に付与する。query に IME 変換中のスペース等が紛れても脱落させないため。
      const createSuggestions = suggestions.filter((s) => s.createTitle !== undefined);
      const normalSuggestions = suggestions.filter((s) => s.createTitle === undefined);
      const filtered = _filterSuggestionItems(normalSuggestions.map(toItem) as any, query);
      const createItems = createSuggestions.map(toItem);
      // `@` 直後（空クエリ）は「新しいノートを作成」を先頭＝ハイライトに出す。
      // 名前を打つ前に Enter/クリックで確定入力ダイアログへ入れるので、IME で最も確実。
      // クエリがあるときは既存ノートの一致を優先し、新規作成は末尾に置く。
      return (query.trim().length === 0
        ? [...createItems, ...(filtered as any[])]
        : [...(filtered as any[]), ...createItems]) as any;
    },
    [editor, getMentionSuggestions, onMentionSelect],
  );

  return (
    <BlockNoteView
      editor={editor as any}
      theme="light"
      editable={editable}
      // 同梱の shadcn Button は React 19 前提で ref を受け取れず、
      // テーブルハンドル / ドラッグハンドルのメニューが Radix の anchor を
      // 掴めないまま「未配置」で描画される（blocknote-shadcn-overrides.tsx 参照）。
      shadCNComponents={blockNoteShadCNComponents}
      sideMenu={sideMenu === false ? false : usesCustomSideMenu ? false : undefined}
      // 内蔵ツールバーは常に無効化し、下で strategy:"fixed" 付きの Controller を描画する。
      // これをしないと、選択時のフォーマットツールバーが overflow:auto/hidden の
      // スクロール領域でクリップされ、サイドピーク横の右パネル等に隠れる。
      formattingToolbar={false}
      slashMenu={hasExtraSlash ? false : undefined}
      // 内蔵のテーブルハンドルを無効化し、下で並べ替え付きのカスタムハンドルを描画する
      tableHandles={false}
      onChange={onChange}
    >
      {/* 列ハンドルメニューに 昇順 / 降順 の並べ替えを足したテーブルハンドル */}
      <TableHandlesController tableHandle={SortableTableHandle} />
      {/* 複数ブロック選択: ハイライト + フローティングツールバー */}
      <BlockSelectionManager />
      {/* ⌘D / Ctrl+D: カーソル位置のブロックを直下に複製 */}
      <DuplicateShortcut />
      {/* インラインハイライトのクリック導線（merge / parameter binding） */}
      <InlineAnchorController />
      {usesCustomSideMenu && (
        <SideMenuController sideMenu={sideMenu as FC<SideMenuProps>} />
      )}
      {/* strategy:"fixed" でツールバーをビューポート基準に配置し、エディタの
          overflow スクロール領域でクリップされて隠れるのを防ぐ。
          formattingToolbar 未指定時は BlockNote 既定のツールバーが描画される。 */}
      <FormattingToolbarController
        formattingToolbar={formattingToolbar}
        floatingUIOptions={{ useFloatingOptions: { strategy: "fixed" } }}
      />
      {hasExtraSlash && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems as any}
          {...({} as any)}
        />
      )}
      {onMentionSelect && (
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={getMentionItems as any}
          // 同名ノートが並んでも React の duplicate key 警告でメニューが壊れないよう、
          // key を title ではなくインデックスにするカスタムメニューを使う。
          // 同時に item.subtext（更新日時）も描画して同名ノートを見分けられる。
          suggestionMenuComponent={MentionSuggestionMenu as any}
          {...({} as any)}
        />
      )}
    </BlockNoteView>
  );
}
