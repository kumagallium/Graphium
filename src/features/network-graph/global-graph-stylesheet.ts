// 全体グラフの見た目（配色・形・大きさ・ズームに応じた見た目・cytoscape のスタイル）。
//
// global-graph-view.tsx（アプリの全体グラフ・チャットの横のグラフ）と、MCP の会話の中のグラフ
// （src/mcp/apps/graph-view.ts）が同じ見た目で描くために、React に依存しない形でここに置く。
// 見た目を変えるときはここだけを変える（両方に効く）。

import type cytoscape from "cytoscape";

import type { EdgeRelation, NoteNode } from "./graph-builder";
import type { GraphKind } from "./graph-kind";
import { kindOf } from "./graph-kind";
import { knowledgeKindBorder, knowledgeKindColor } from "./knowledge-colors";
import { noteContextHue } from "../note-context/context-tags";
import {
  baseEdgeStyle,
  baseNodeStyle,
  hoverFullLabelStyle,
  interactionStyles,
  nodeIconStyles,
  GRAPH_LABEL_FONT_SIZE,
  GRAPH_LABEL_MAX_WIDTH,
} from "./graph-theme";

// ── 配色（knowledge-colors.ts と view.tsx に一致） ──

export const NOTE_FILL = "#5b8fb9";
export const NOTE_BORDER = "#4a7da6";
export const EXT_FILL = "#9aa0a6";
export const EXT_BORDER = "#6e7378";

export function kindFill(kind: GraphKind): string {
  if (kind === "note") return NOTE_FILL;
  if (kind === "external") return EXT_FILL;
  return knowledgeKindColor(kind);
}
export function kindBorder(kind: GraphKind): string {
  if (kind === "note") return NOTE_BORDER;
  if (kind === "external") return EXT_BORDER;
  return knowledgeKindBorder(kind);
}

// ── 文脈タグ色モード ──
//
// 色 = 文脈タグ（noteContextHue の名前ハッシュ、ContextBadge と同系統）、形 = kind のまま。
// 種類の情報は形状（ellipse/round-rect/diamond）で残るので、色の軸だけ差し替わる。
// 外部ソースは文脈を持たないので従来のグレーのまま（形も round-rect で区別が付く）。

/** 文脈タグ未付与ノートの色。design.md の 2 ホップ色（間接・背景的の意味論）に合わせる。 */
export const UNCAT_FILL = "#b8c9be";
export const UNCAT_BORDER = "#9cb5a4";

export type GraphColorMode = "simple" | "kind" | "context";

// ── シンプル色モード（既定） ──
//
// 点も線も同じ温かい灰 1 色で描き、種類は濃さで分ける（ノートは濃く、知見・出典は薄く）。
// 形はすべて丸、種類アイコンも出さない。種類ごとの色・形は「種類」モードで見られる。
// 色が付くのは選択・検索・ホバーのときだけになり、島と島をまたぐ流れ（束ねた線）が
// 灰の濃淡で読める。塗りは不透明度でなく実色で持つ（ホバーの faded の濃さを変えないため）。

/** 線とノートの基準の灰（真っ黒は強すぎるので少し温かみのある灰） */
export const SIMPLE_INK = "#3d3b38";
/** ノートの塗り（基準の灰を紙の上で 9 割の濃さにした色） */
export const SIMPLE_NOTE_FILL = "#45433f";
/** 知見・話題・出典の塗り（基準の灰を紙の上で 4 割の濃さにした色） */
export const SIMPLE_OTHER_FILL = "#adaba6";
/** ノートの周りに畳んだ知見（衛星）の塗り（4 割よりさらに薄く） */
export const SIMPLE_SATELLITE_FILL = "#bebdb8";

/** ノードの塗り・境界色を色モードに応じて返す。
 *  彩度 40% / 明度 56% は design.md ラベル色パレット（S 10-51% / L 39-60% の
 *  「落ち着いた彩度の自然色」）の中心に合わせた値。高彩度化しないこと。
 *  注意: cytoscape のカラーパーサはモダン CSS の空白区切り hsl(h s% l%) を解釈できず
 *  黙ってデフォルト色（グレー）に落ちる。必ずカンマ区切りで渡すこと
 *  （React DOM に渡す ContextBadge / ContextLegend は空白区切りでも動くが、別系統）。 */
export function nodeColors(node: NoteNode, mode: GraphColorMode): { fill: string; border: string } {
  const kind = kindOf(node);
  if (mode === "simple") {
    const fill = kind === "note" ? SIMPLE_NOTE_FILL : SIMPLE_OTHER_FILL;
    // 枠はホバー時（border-width 3）にだけ見える。塗りより一段濃く
    return { fill, border: kind === "note" ? SIMPLE_INK : "#8f8c86" };
  }
  if (mode === "context" && kind !== "external") {
    const ctx = node.noteContexts?.[0];
    if (!ctx) return { fill: UNCAT_FILL, border: UNCAT_BORDER };
    const h = noteContextHue(ctx);
    return { fill: `hsl(${h}, 40%, 56%)`, border: `hsl(${h}, 40%, 44%)` };
  }
  return { fill: kindFill(kind), border: kindBorder(kind) };
}

export const KIND_SHAPE: Record<GraphKind, string> = {
  external: "round-rectangle",
  note: "ellipse",
  summary: "round-rectangle",
  claim: "round-rectangle",
  atom: "diamond",
  synthesis: "hexagon",
  // 話題は知見を束ねるページ。claim（角丸四角）と atom（ダイヤ）の中間として
  // 角丸四角のまま据え置き、サイズで claim / atom との中間感を出す。
  topic: "round-rectangle",
  // 問答はトピックに準じた見た目（色も同じ。knowledge-colors.ts）
  answer: "round-rectangle",
};

export const KIND_SIZE: Record<GraphKind, number> = {
  external: 26,
  note: 32,
  summary: 32,
  claim: 30,
  atom: 36,
  synthesis: 38,
  topic: 33,
  answer: 33,
};

/** これより多いノードを物理配置するときは、配置アニメーションを切る */
export const LAYOUT_ANIMATION_MAX_NODES = 300;

export const REL_COLOR: Record<EdgeRelation, string> = {
  derived: "#4B7A52",
  used: "#9aa0a6",
  reference: "#5b8fb9",
};


// ── Cytoscape スタイル ──

/** ズーム z でのラベルのフォント（モデル座標 px）。寄せたときの画面上の大きさは
 *  px·z = 11·z^0.2 で、寄せても文字はほとんど大きくならない（ノードの間が空いた分を
 *  文字で埋めない）。引くと 11·z で小さくなり、7px を切ると描かれなくなる。 */
export function labelFontSizeForZoom(zoom: number): number {
  const base = parseFloat(GRAPH_LABEL_FONT_SIZE);
  return Math.max(2, Math.min(base, base / Math.pow(Math.max(zoom, 0.05), 0.8)));
}

// ── ズームに応じた見た目（Obsidian のように寄せるとまばらに見せる） ──
//
// ノードの寸法はグラフ座標で持っているので、そのままだと寄せた分だけ間隔と一緒に
// 大きくなり、混み具合が変わらない（寄せても重なったまま）。NODE_SHRINK_FROM_ZOOM より
// 寄せたら、画面上の大きさの伸びを z^(1-NODE_SHRINK_EXPONENT) に抑える。
// 小さすぎるノード（衛星など）は、寄せたときだけ画面上 NODE_MIN_SCREEN_PX までは保つ。
// 見た目の倍率は cy.scratch(ZOOM_SCRATCH_KEY) に置き、スタイル関数が読む
// （ズームが止まったら 1 回だけ更新する。未設定＝配置前は素の大きさ）。

export const ZOOM_SCRATCH_KEY = "_graphStyleZoom";
/** これより寄せたらノードの伸びを抑え始める */
export const NODE_SHRINK_FROM_ZOOM = 0.5;
/** 伸びを抑える強さ（0 ＝ 今まで通り、1 ＝ 画面上の大きさが変わらない） */
export const NODE_SHRINK_EXPONENT = 0.7;
/** 寄せたときに保つ、画面上の最小の直径 */
export const NODE_MIN_SCREEN_PX = 8;
/** ホバーしたノードの題の画面上の大きさ（ズームに関係なく読める） */
export const HOVER_LABEL_SCREEN_PX = 13;
/** ホバーしたノードとつながる相手の題の画面上の大きさ */
export const HOVER_NEIGHBOR_LABEL_SCREEN_PX = 11;
/** ホバーで題を出す相手の上限（多すぎると文字で埋まる） */
export const HOVER_NEIGHBOR_LABEL_MAX = 12;
/** ホバーで出す題の白地の余白（画面上の px）。文字はズームで大きさを変えないので余白も揃える */
export const HOVER_LABEL_PADDING_SCREEN_PX = 4;
/** ホバー中に島の名前を薄くする度合い（題が島の名前の下に隠れないように） */
export const ISLAND_LABELS_HOVER_OPACITY = 0.12;

/** ズーム z で寸法 v（グラフ座標）を縮めた値。z ≤ 基準なら素の値（線の太さにも使う） */
export function shrinkForZoom(v: number, zoom: number): number {
  const z0 = NODE_SHRINK_FROM_ZOOM;
  const z = Math.max(zoom, 0.01);
  return z <= z0 ? v : v * Math.pow(z0 / z, NODE_SHRINK_EXPONENT);
}

/** ズーム z でのノードの直径（グラフ座標）。z ≤ 基準なら素の大きさ */
export function nodeSizeForZoom(size: number, zoom: number): number {
  const z0 = NODE_SHRINK_FROM_ZOOM;
  const z = Math.max(zoom, 0.01);
  if (z <= z0) return size;
  const shrunk = shrinkForZoom(size, z);
  // 基準ちょうどで最小値が急に効いて大きさが跳ねないよう、基準の 2 倍までかけて効かせる
  const ramp = Math.min(1, (z - z0) / z0);
  return Math.max(shrunk, (NODE_MIN_SCREEN_PX * ramp) / z);
}

function styleZoomOf(ele: cytoscape.NodeSingular): number | undefined {
  const z = ele.cy().scratch(ZOOM_SCRATCH_KEY);
  return typeof z === "number" ? z : undefined;
}

/**
 * AI が使った・読んだページの、画面上の最小の直径（px）。俯瞰の倍率でも点として見えるように、
 * 使った（この答え）> 使った（前の答え）> 読んだだけ の順に大きく描く
 */
export const LIT_USED_SCREEN_PX = 16;
export const LIT_EARLIER_SCREEN_PX = 12;
export const LIT_READ_SCREEN_PX = 10;
/** 使った・読んだページは、元の大きさよりもこの倍率だけは大きくする（寄せたときも目立つように） */
const LIT_SCALE = 1.35;

/** 使った・読んだページの画面上の最小の直径（px）。どちらでもなければ 0 */
export function litScreenPx(act: number, read: boolean): number {
  if (act >= 0.999) return LIT_USED_SCREEN_PX;
  if (act > 0) return LIT_EARLIER_SCREEN_PX;
  return read ? LIT_READ_SCREEN_PX : 0;
}

function nodeDiameterStyle(ele: cytoscape.NodeSingular): number {
  const size = Number(ele.data("size")) || KIND_SIZE.note;
  const z = styleZoomOf(ele);
  const base = z === undefined ? size : nodeSizeForZoom(size, z);
  // 大きくするのはチャットの横のグラフ（usageScope が印を付ける）だけ。全体グラフの「AI に
  // 使われたところ」（30 日分）は数が多いので、色だけで大きさは変えない
  const litPx = ele.hasClass("ai-used")
    ? litScreenPx(Number(ele.data("act")) || 0, false)
    : litScreenPx(0, ele.hasClass("ai-read"));
  if (litPx === 0) return base;
  const zoom = Math.max(ele.cy().zoom(), 0.01);
  return Math.max(base * LIT_SCALE, litPx / zoom);
}

/** ラベルの折り返し幅は文字の大きさに合わせる（寄せたとき 1 行が長く伸びないように） */
function nodeLabelMaxWidthStyle(ele: cytoscape.NodeSingular): string {
  const base = parseFloat(GRAPH_LABEL_FONT_SIZE);
  const font = parseFloat(nodeFontSizeStyle(ele));
  return `${(parseFloat(GRAPH_LABEL_MAX_WIDTH) * font) / base}px`;
}

function nodeFontSizeStyle(ele: cytoscape.NodeSingular): string {
  // ホバー中は今のズームで読める大きさに（画面上で一定）
  if (ele.hasClass("hover")) return `${HOVER_LABEL_SCREEN_PX / ele.cy().zoom()}px`;
  if (ele.hasClass("hover-label")) return `${HOVER_NEIGHBOR_LABEL_SCREEN_PX / ele.cy().zoom()}px`;
  const z = styleZoomOf(ele);
  return z === undefined ? GRAPH_LABEL_FONT_SIZE : `${labelFontSizeForZoom(z)}px`;
}

/** 根拠のつながりの線（ai-link）の太さ。画面上で約 1.6px に保つ */
function aiLinkWidthStyle(ele: cytoscape.EdgeSingular): number {
  return AI_LINK_SCREEN_PX / Math.max(ele.cy().zoom(), 0.01);
}
export const AI_LINK_SCREEN_PX = 1.6;
/** AI がたどった線（ai-walked）の太さ。画面上で約 2.8px */
function aiWalkedWidthStyle(ele: cytoscape.EdgeSingular): number {
  return AI_WALKED_SCREEN_PX / Math.max(ele.cy().zoom(), 0.01);
}
export const AI_WALKED_SCREEN_PX = 2.8;

/** シンプル表示の線の太さ。寄せたらノードと同じ割合で細くする（線で埋まらないように） */
function simpleEdgeWidthStyle(width: number) {
  return (ele: cytoscape.EdgeSingular): number => {
    const z = ele.cy().scratch(ZOOM_SCRATCH_KEY);
    return typeof z === "number" ? shrinkForZoom(width, z) : width;
  };
}

/**
 * ホバー中は島の名前を薄くし、マウスも素通りさせる（題の上に名前が被るのを防ぐ。
 * 素通りさせないと、名前の上に来た瞬間にホバーが外れて点滅する）。
 * 再描画を起こさないよう state でなく DOM を直接触る
 */
export function setIslandLabelsDimmed(el: HTMLElement | null, dimmed: boolean): void {
  if (!el) return;
  el.style.opacity = dimmed ? String(ISLAND_LABELS_HOVER_OPACITY) : "";
  for (const btn of el.querySelectorAll<HTMLElement>("[data-island-label]")) {
    btn.style.pointerEvents = dimmed ? "none" : "auto";
  }
}

/** ホバーの題の白地の余白。文字と同じく画面上で一定にする（引くと余白が潰れて字が切れて見えた） */
function hoverLabelPaddingStyle(ele: cytoscape.NodeSingular): string {
  return `${HOVER_LABEL_PADDING_SCREEN_PX / ele.cy().zoom()}px`;
}

function hoverEdgeWidthStyle(ele: cytoscape.EdgeSingular): number {
  return shrinkForZoom(2.5, ele.cy().zoom());
}

/** ズームが止まったら見た目の倍率を合わせる。変化が小さければ何もしない */
export function applyZoomStyle(cy: cytoscape.Core): void {
  const z = cy.zoom();
  const prev = cy.scratch(ZOOM_SCRATCH_KEY);
  if (typeof prev === "number" && Math.abs(z - prev) / prev < 0.02) return;
  cy.scratch(ZOOM_SCRATCH_KEY, z);
  // 関数で決めているノードの幅・文字の大きさと、シンプル表示の線の太さを計算し直す
  cy.batch(() => (cy.$("node, edge.simple") as any).updateStyle());
}

export const globalGraphStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      ...baseNodeStyle,
      "font-size": nodeFontSizeStyle as any,
      "text-max-width": nodeLabelMaxWidthStyle as any,
      // 画面上のフォントがこれより小さくなる倍率ではラベルを描かない（灰色の帯にしない）
      "min-zoomed-font-size": 7,
      // 全体グラフはアニメーションを切る。ホバーで全要素（2,000 超）の不透明度が
      // 同時に 0.2 秒アニメーションし、1 回のホバーが重くなっていた（計測で約 2 倍）
      "transition-duration": 0 as any,
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      shape: "data(shape)" as any,
      width: nodeDiameterStyle as any,
      height: nodeDiameterStyle as any,
    },
  },
  {
    // 葉を畳んだ相手ノード: 枠を 1 段太くして「畳んだものを持っている」ことを示す
    // （実寸は変えたくないので width/height ではなく border-width のみ）
    selector: "node[folded > 0]",
    style: { "border-width": 3 },
  },
  {
    // 畳んだ葉を衛星として残したノード（layoutMode: islands + fold ON）。
    // 量感は出すが主役ではないので少し透過・低い z-index にする。
    selector: "node[?satellite]",
    style: { opacity: 0.85, "z-index": 1 },
  },
  {
    selector: "edge",
    style: {
      ...baseEdgeStyle,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "line-style": "data(lineStyle)" as any,
      // 全体グラフはエッジが多いので、既定より少しだけ引く
      opacity: 0.85,
      "transition-duration": 0 as any,
    },
  },
  {
    // 衛星と親（畳み先）を結ぶ実エッジ。見えるが控えめ（細め・薄め・矢印無し）。
    // 物理（fcose の 1 段目）には参加させない——2 段目の幾何配置の後に見た目だけ足す。
    selector: "edge.satellite-edge",
    style: {
      width: 0.8,
      opacity: 0.35,
      "target-arrow-shape": "none" as any,
      "line-style": "solid" as any,
    },
  },
  // 種類アイコン（出典・素材・Knowledge）。ホバー等の状態スタイルより前に置く
  ...nodeIconStyles,
  // シンプル色モード（.simple）。種類の形・アイコン・線の色を上書きするので
  // アイコンより後、ホバー・選択・検索などの状態スタイルより前に置く
  ...simpleModeStyles(),
  // 絞り込みの「周辺」（一致から 1 ホップ）は少し薄く。主役と文脈を見分けるため。
  // ホバーの faded より前に置き、ホバー時はさらに薄くなれるようにする
  { selector: "node.filter-context", style: { opacity: 0.55 } },
  { selector: "edge.filter-context", style: { opacity: 0.4 } },
  // ホバー時の faded / hover は、辺の基本スタイル（opacity 0.85）や衛星ノード（0.85）より
  // 後に置く。Cytoscape は後の規則が勝つので、前に置くと薄くならない（ホバーしても
  // 無関係な矢印と畳んだ知見が目立ったままだった）。不可視の cluster-edge / cluster-hub は
  // opacity 0 を保ちたいので faded の後ろに置く。search-hit は faded より優先するため最後。
  ...interactionStyles,
  hoverFullLabelStyle,
  {
    // ホバー中のノードとつながる相手の題は、引いた状態でも読めるように白地を敷いて出す
    // （文字の大きさは nodeFontSizeStyle が画面上で一定にする）
    selector: "node.hover, node.hover-label",
    style: {
      "min-zoomed-font-size": 0,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.88,
      "text-background-padding": hoverLabelPaddingStyle as any,
      "text-background-shape": "round-rectangle" as any,
      "z-index": 950,
    },
  },
  { selector: "node.hover", style: { "z-index": 999 } },
  // ホバーでつながる線は太くするが、寄せたときに太くなりすぎないようノードと同じ割合で抑える
  { selector: "edge.hover-connected", style: { width: hoverEdgeWidthStyle as any, opacity: 1, "z-index": 10 } },
  {
    // 「文脈で寄せる」・島の重心・射影用の不可視エッジ。描画・操作はさせず
    // fcose の引力計算にだけ効かせる（display:none だとレイアウト対象から
    // 外れるので opacity 0 で隠す）。これらの要素は data(color)/data(lineStyle)
    // を持たない（隠すだけで見た目は関係ない）ので、汎用 edge セレクタの
    // data() マッピングに任せず、ここで固定値を明示して cytoscape の
    // 「マップ先の data が無い」警告を避ける。
    selector: "edge.cluster-edge",
    style: {
      opacity: 0,
      events: "no" as any,
      "line-color": "#000" as any,
      "target-arrow-color": "#000" as any,
      "line-style": "solid" as any,
    },
  },
  {
    // クラスタ重心のダミーハブノード。見えない・触れないがレイアウトには参加し、
    // ハブ同士の反発でクラスタ間の距離を生む。
    selector: "node.cluster-hub",
    style: {
      opacity: 0,
      events: "no" as any,
      label: "",
      width: 1,
      height: 1,
      // 汎用 node セレクタの data(color)/data(borderColor)/data(shape) マッピング
      // に任せない（ダミーなので data を持たせていない）。cluster-edge と同じ理由。
      "background-color": "#000" as any,
      "border-color": "#000" as any,
      shape: "ellipse" as any,
    },
  },
  // 絞り込み（検索・フォルダ・未分類）で外れたノードは描かない。配置は保つ。
  // 端点が消えた辺は Cytoscape が描かない
  { selector: "node.filtered-out", style: { display: "none" as any } },
  {
    // 検索ヒット: 琥珀色の太枠 + フルラベル表示。faded より優先されるよう後段に置く
    selector: "node.search-hit",
    style: {
      "border-width": 4,
      "border-color": "#d99a2b",
      label: "data(fullLabel)" as any,
      "font-weight": "bold" as any,
      "z-index": 900,
    },
  },
];

/** シンプル色モードのスタイル（要素に .simple が付いているときだけ効く） */
function simpleModeStyles(): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: "node.simple",
      style: {
        shape: "ellipse" as any,
        // アイコンは画像を外さず透明にする（background-image を書き換えると、
        // 背景画像に結線した key の検査 no-remote-hero.test.ts の対象になるため）
        "background-image-opacity": 0 as any,
        "background-opacity": 1,
        "border-width": 0,
      },
    },
    { selector: "node.simple[?satellite]", style: { "background-color": SIMPLE_SATELLITE_FILL } },
    {
      selector: "edge.simple",
      style: {
        "line-color": SIMPLE_INK,
        "target-arrow-color": SIMPLE_INK,
        "target-arrow-shape": "none" as any,
        width: simpleEdgeWidthStyle(0.6) as any,
        opacity: 0.16,
      },
    },
    { selector: "edge.simple.satellite-edge", style: { opacity: 0.08 } },
    // 島と島をまたぐ束は少しだけ濃く（流れが灰の濃淡で読めるように）
    { selector: "edge.simple.bundled", style: { width: simpleEdgeWidthStyle(0.7) as any, opacity: 0.22 } },
    // 最近 AI に使われたページ（data.act: 0〜1、usage-activity.ts）。最近ほど濃い緑。
    // 色が付くのはシンプル表示のときだけ（種類・フォルダの色とは混ぜない）
    {
      selector: "node.simple[act > 0]",
      style: { "background-color": "mapData(act, 0, 1, #a9bfad, #2f6b3a)" as any, "z-index": 40 },
    },
    // チャットの横のグラフで見せる「AI が探せる範囲」（usageScope）。範囲の外は薄く、
    // @ で渡したページは紫の輪、範囲の外なのに使ったページは赤い点線の輪
    // AI が読んだが答えには使わなかったページ（淡い緑の地に緑の縁）。使ったページ（act）より弱く、
    // 触れていない灰色とは常に見分けが付くように
    {
      selector: "node.simple.ai-read",
      style: { "background-color": "#c9e2ce", "border-width": 2, "border-color": "#4f8a5c", "border-opacity": 1, "z-index": 35 },
    },
    { selector: "node.simple.scope-out", style: { opacity: 0.18 } },
    { selector: "edge.simple.scope-out", style: { opacity: 0.03 } },
    // 触れたページ同士（使った・読んだページを両端に持つ）の線＝根拠のつながり。答えの光もこの線だけを
    // 走るので、光ったあとにそのまま残る。太さは画面上で一定（俯瞰でも見えるように）
    // チャットの横では、題名を出すのは AI が触れたページだけ（ほかは文字が重なって根拠が埋もれる）。
    // マウスを乗せたとき・つながる相手として出すとき・選んだときは出す
    { selector: "node.simple.label-muted", style: { "text-opacity": 0 } },
    {
      selector: "node.simple.label-muted.hover, node.simple.label-muted.hover-label, node.simple.label-muted:selected",
      style: { "text-opacity": 1 },
    },
    {
      selector: "edge.simple.ai-link",
      style: {
        "line-color": "#4f8a5c",
        "target-arrow-color": "#4f8a5c",
        width: aiLinkWidthStyle as any,
        opacity: 0.75,
        "z-index": 30,
      },
    },
    // AI が来歴の道具で実際にたどった線（じっくり調べたとき）。根拠のつながりより濃く太く。ai-link の後に置いて上書きする
    {
      selector: "edge.simple.ai-walked",
      style: {
        "line-color": "#2f6b3a",
        "target-arrow-color": "#2f6b3a",
        width: aiWalkedWidthStyle as any,
        opacity: 0.95,
        "z-index": 31,
      },
    },
    {
      selector: "node.simple.scope-attached",
      style: { "border-width": 2.5, "border-color": "#534AB7", "border-opacity": 1, "z-index": 41 },
    },
    {
      selector: "node.simple.scope-breach",
      style: { opacity: 1, "border-width": 2.5, "border-color": "#C0392B", "border-style": "dashed", "z-index": 42 },
    },
  ];
}
