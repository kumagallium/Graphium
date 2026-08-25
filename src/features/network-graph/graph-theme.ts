// ──────────────────────────────────────────────
// Cytoscape グラフの共通見た目・共通操作。
//
// ノート周辺グラフ / 全体グラフ / 素材グラフ / ラベル / メモは、どれも同じ
// 「点と線で関係を見るグラフ」なのに、スタイル定義を各ファイルが個別に持って
// いたため、文字サイズ・折返し幅・トランジションが少しずつ違っていた
// （font-size 10/11px、text-max-width 100/120/150px、transition 180/200ms）。
// 同じものは同じ見た目に見えるべきなので、ここに 1 か所化する。
//
// 各ビューが持つのは「そのグラフ固有の色分けと形」だけ。文字・枠・アニメーション・
// ホバーの効き方・ズームの範囲は全部ここから来る。
//
// 数値の根拠（design.md「グラフインタラクション」「グラフ可視化色」が正）:
//   - トランジション 200ms ease-in-out-sine … design.md 明記
//   - ホバー時に非接続を opacity 0.15   … design.md 明記
//   - ズーム 0.2–4.0 / wheelSensitivity 0.3 … design.md 明記
//   - エッジは unbundled-bezier          … design.md 明記
//   - font-size 11px … 10px と 11px が混在していた。読みやすさを優先して大きい方に
//     揃える（design.md の dyslexia 配慮方針）
//   - text-max-width 120px … 100px は日本語ラベルの折返しが増えすぎ、150px は
//     隣のノードと重なる。その中間
// ──────────────────────────────────────────────

import type cytoscape from "cytoscape";

/** 本文と同じ書体スタック（dyslexia 配慮のため Atkinson Hyperlegible を先頭に置く） */
export const GRAPH_FONT_FAMILY =
  "Atkinson Hyperlegible Next, BIZ UDPGothic, Inter, system-ui, sans-serif";

/** ノードラベルの文字サイズ */
export const GRAPH_LABEL_FONT_SIZE = "11px";

/** ラベルの折返し幅 */
export const GRAPH_LABEL_MAX_WIDTH = "120px";

/** ノードとラベルの間隔 */
export const GRAPH_LABEL_MARGIN_Y = 6;

/** ラベルの文字色（design.md の muted-foreground） */
export const GRAPH_LABEL_COLOR = "#4a6350";

/** グラフの背景（design.md の background） */
export const GRAPH_BG_COLOR = "#fafdf7";

/** ブランドグリーン。選択・ハイライトに使う */
export const GRAPH_ACCENT_COLOR = "#4B7A52";

/** アニメーションの長さと曲線（design.md 明記） */
export const GRAPH_TRANSITION_MS = 200;
export const GRAPH_TRANSITION_EASING = "ease-in-out-sine";

/** ホバー時に非接続をどこまで薄くするか（design.md 明記） */
export const GRAPH_FADED_OPACITY = 0.15;
/** エッジは点より目立つので、ノードよりさらに薄くする */
export const GRAPH_FADED_EDGE_OPACITY = 0.08;

/**
 * ノードの共通スタイル。色・形・大きさは data() で各ビューが与える前提なので、
 * ここには含めない（`{ ...baseNodeStyle, "background-color": "data(color)" }` の形で使う）。
 */
export const baseNodeStyle = {
  label: "data(label)",
  "text-wrap": "wrap",
  // auto(既定)は折返し行の字間が崩れて描画される(cytoscape の複数行描画の不具合回避)
  "text-justification": "center" as any,
  "text-max-width": GRAPH_LABEL_MAX_WIDTH,
  "font-size": GRAPH_LABEL_FONT_SIZE,
  "font-family": GRAPH_FONT_FAMILY,
  "text-valign": "bottom",
  "text-margin-y": GRAPH_LABEL_MARGIN_Y,
  color: GRAPH_LABEL_COLOR,
  "border-width": 2,
  "transition-property": "background-color, border-color, opacity, width, height" as any,
  "transition-duration": GRAPH_TRANSITION_MS,
  "transition-timing-function": GRAPH_TRANSITION_EASING as any,
} as const;

/**
 * エッジの共通スタイル。線の色は各ビューが与える
 * （固定色のビューと data(color) で出し分けるビューがあるため）。
 */
export const baseEdgeStyle = {
  width: 1.5,
  "target-arrow-shape": "triangle",
  "arrow-scale": 0.8,
  "curve-style": "unbundled-bezier" as any,
  "control-point-distances": 30,
  "control-point-weights": 0.5,
  opacity: 1,
  "transition-property": "opacity, width, line-color" as any,
  "transition-duration": GRAPH_TRANSITION_MS,
  "transition-timing-function": GRAPH_TRANSITION_EASING as any,
} as const;

/**
 * 状態の見せ方（選択・ホバー・フェード）。どのグラフでも同じ意味・同じ強さにする。
 *
 * ノードのスタイル定義より後ろに置くこと（Cytoscape は後勝ち）。
 * `.hover` / `.faded` / `.hover-connected` はビュー側の mouseover ハンドラが付ける
 * クラスで、名前もここで固定した規約として扱う。
 */
export const interactionStyles: cytoscape.StylesheetStyle[] = [
  {
    // 範囲選択でドラッグ中に出る矩形。Cytoscape の既定は薄いグレーで、
    // このアプリの背景（#fafdf7）の上ではほとんど見えない。React Flow は
    // 既定で矩形をはっきり描くので、揃えないと「手順フローでは枠が出るのに
    // ノートのグラフでは出ない」ように見える。数値は app.css の
    // `.react-flow__selection` と対で管理すること
    selector: "core",
    // core のスタイル型は全プロパティ必須なので、一部だけ与えるにはキャストが要る
    style: {
      "selection-box-color": GRAPH_ACCENT_COLOR,
      "selection-box-opacity": 0.12,
      "selection-box-border-color": GRAPH_ACCENT_COLOR,
      "selection-box-border-width": 1,
    } as any,
  },
  {
    selector: "node:active",
    style: {
      "overlay-opacity": 0.08,
    },
  },
  // 選択中のノード。React Flow 側が選択したノードにリングを残すのに合わせ、
  // こちらも輪郭で示す。塗り（overlay）だけだとノードの色に馴染んでしまい、
  // 選択が解けたのか続いているのか分からない。
  //
  // border-width ではなく outline を使う: 枠を太らせるとノードの実寸が変わり、
  // レイアウトが動く（design.md「選択は枠の太さを変えずリング」）。outline は
  // ノードの外側に描かれるので実寸に影響しない。
  {
    selector: "node:selected",
    style: {
      "outline-width": 3,
      "outline-color": GRAPH_ACCENT_COLOR,
      "outline-opacity": 0.9,
      "outline-offset": 2,
      // うっすら塗りも足して、輪郭だけより「選ばれている」感を出す
      "overlay-opacity": 0.1,
      "overlay-color": GRAPH_ACCENT_COLOR,
      "overlay-padding": 4,
    } as any,
  },
  // ホバー中のノード
  {
    selector: "node.hover",
    style: {
      "border-width": 3,
      "overlay-opacity": 0.06,
      "overlay-color": "#000",
      "z-index": 999,
    },
  },
  { selector: "node.hover-neighbor", style: { opacity: 1 } },
  { selector: "node.faded", style: { opacity: GRAPH_FADED_OPACITY } },
  { selector: "edge.faded", style: { opacity: GRAPH_FADED_EDGE_OPACITY } },
];

/**
 * ホバー中に省略ラベルからフルラベルへ切り替える。
 *
 * `interactionStyles` から分けてあるのは、全ノードに `fullLabel` を持たせている
 * ビューでしか使えないため。持たないノードに当てると data() が undefined になり、
 * ホバーした瞬間にラベルが消える。使う側は interactionStyles の後ろに置くこと。
 */
export const hoverFullLabelStyle: cytoscape.StylesheetStyle = {
  selector: "node.hover",
  style: {
    label: "data(fullLabel)" as any,
    "font-weight": "bold" as any,
  },
};

/**
 * Cytoscape の初期化オプションのうち、全グラフで揃えるもの。
 * `cytoscape({ container, elements, style, ...GRAPH_INIT_OPTIONS })` の形で使う。
 *
 * boxSelectionEnabled: shift（または ⌘）+ 背景ドラッグで範囲選択できる。選択した
 * ノードはどれか 1 つを掴めばまとめて動く。手順フロー（React Flow）の範囲選択も
 * 同じ shift + 背景ドラッグなので、操作の覚え方が 1 つで済む。
 */
export const GRAPH_INIT_OPTIONS = {
  userZoomingEnabled: true,
  userPanningEnabled: true,
  boxSelectionEnabled: true,
  // single: 単発クリックの選択は置き換え（クリックは本来ナビゲーションなので
  // 累積させない）。矩形選択は single でも複数選択になる
  selectionType: "single",
  wheelSensitivity: 0.3,
  minZoom: 0.2,
  maxZoom: 4,
} as const;
