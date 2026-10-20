// サイドメニュー（＋⠿）の置き場所を決める floating-ui の middleware。
//
// ── なぜ自前で持つか ────────────────────────────────────────────
// BlockNote 0.53 から SideMenuController は「ブロックの左上（left-start）」に置き、
// 見出しだけ段ごとの固定値で下へずらす（H1 39px / H2 27px / H3 18.5px）。この値は
// BlockNote 既定の大きな見出し用で、Graphium の見出し（H1 30px など、app.css）では
// ハンドルが文字より下に来る。
// また Graphium は見出しの左に折りたたみの ▶（features/collapsible-heading）を出すので、
// 見出しのときはハンドルを ▶ のぶん左へ逃がす。0.52 までは CSS
// （.bn-side-menu[data-block-type="heading"] に transform）でやっていたが、0.53 から
// サイドメニューに data-block-type / data-level が付かなくなって効かなくなった。
//
// ── 何をするか ──────────────────────────────────────────────────
// - 見出し: ハンドルの縦の中心を見出しの 1 行目の中心に合わせ、▶ のぶん左へ寄せる
// - それ以外: BlockNote と同じ固定のずらし（ファイル未設定 12px / ファイル 4px /
//   音声・表 15px / ほか 0）。SideMenuController は useFloatingOptions.middleware を
//   丸ごと差し替えるので、見出し以外も BlockNote と同じ値をここで返す必要がある
//
// 配置計算は floating-ui の middleware（{ name, fn }）で書く。@floating-ui/react を
// 直接の依存に足さずに済み、計算のたびに実 DOM から 1 行目の位置を読める。
//
// ⚠️ 対象ブロックは middleware に閉じ込めず、計算のたびにサイドメニューの状態から読む。
//    floating-ui の useFloating は middleware を deepEqual で比べ、関数は「ソースが同じなら
//    同じ」とみなす。ブロックごとに作り直しても差し替わらず、最初に作った（ブロックなしの）
//    middleware が使われ続ける。

import { HEADING_HANDLE_SHIFT } from "../lib/pane-layout";

/** ▶（.gph-heading-toggle）の幅ぶん、見出しのハンドルを左へ逃がす量（px）。
 *  狭いペインの余白（lib/pane-layout.ts の NARROW_GUTTER_LEFT）もこの値で取っているので、定義は向こうに 1 つ */
export const HEADING_HANDLE_SHIFT_PX = HEADING_HANDLE_SHIFT;

type SideMenuBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
};

/** BlockNote 0.56 の SideMenuController と同じ、見出し以外の縦のずらし（px） */
export function defaultCrossAxisOffset(editor: any, block: SideMenuBlock): number {
  const spec = editor?.schema?.blockSpecs?.[block.type];
  const acceptsFile = spec?.implementation?.meta?.fileBlockAccept !== undefined;
  if (acceptsFile && !block.props?.url) return 12;
  if (block.type === "file") return 4;
  if (block.type === "audio" || block.type === "table") return 15;
  return 0;
}

/** CSS.escape（無い環境ではブロック id に使われる文字だけを素通しする） */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

/** 見出しの 1 行目の縦の中心（ビューポート座標）。測れなければ null */
function headingFirstLineCenter(editor: any, blockId: string): number | null {
  const root: HTMLElement | null | undefined = editor?.domElement;
  if (!root) return null;
  const outer = root.querySelector<HTMLElement>(
    `[data-id="${cssEscape(blockId)}"][data-node-type="blockOuter"]`,
  );
  const text = outer?.querySelector<HTMLElement>(".bn-block-content .bn-inline-content");
  if (!text) return null;
  const rect = text.getBoundingClientRect();
  const style = getComputedStyle(text);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const firstLine = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : rect.height;
  return rect.top + paddingTop + firstLine / 2;
}

/**
 * サイドメニューの置き場所を BlockNote の left-start から動かす middleware。
 * x を減らすと左へ、y を増やすと下へ動く（left-start の座標系そのまま）。
 * getBlock は計算のたびに呼ぶ（今サイドメニューが付いているブロックを返す）。
 */
export function sideMenuPlacementMiddleware(
  editor: any,
  getBlock: () => SideMenuBlock | undefined,
) {
  return {
    name: "graphiumSideMenuPlacement",
    fn(state: any) {
      const { x, y } = state as { x: number; y: number };
      const block = getBlock();
      if (!block) return { x, y };
      if (block.type !== "heading") {
        return { x, y: y + defaultCrossAxisOffset(editor, block) };
      }
      const center = headingFirstLineCenter(editor, block.id);
      const referenceTop: number | undefined = state.elements?.reference?.getBoundingClientRect?.().top;
      const floatingHeight: number = state.rects?.floating?.height ?? 0;
      const dy =
        center !== null && referenceTop !== undefined
          ? center - referenceTop - floatingHeight / 2
          : 0;
      return { x: x - HEADING_HANDLE_SHIFT_PX, y: y + dy };
    },
  };
}
